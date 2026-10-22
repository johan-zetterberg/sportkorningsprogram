// "PAUSA TÄVLINGEN" / "ÅTERUPPTA": the competition's global pause
// (config/globalStatus). Pressed on the observer page and the secretariat's
// marathon page. The pause log is subtracted from the stage times, so it is
// updated in a transaction: two officials pressing at once cannot overwrite
// each other, and pausing during an open pause (or resuming without one)
// changes nothing. Each entry records why, who and where (globalPauseUtils).
// Without connection a pause event is queued instead (append-only, folded
// into the log by the server: functions/src/pauseEvents.js).

import { db, appId, auth } from '../config/firebase-config.js';
import { collection, doc, getDoc, serverTimestamp, runTransaction, deleteField, writeBatch } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { trackWrite } from './firestoreService.js';
import { awaitWriteOrQueue, queuedNotice } from '../utils/offlineWrite.js';
import { showAlert } from '../ui/components.js';
import { t } from '../utils/i18n.js';
import { serverNow } from '../utils/serverClock.js';
import { buildPauseEntry, nextPauseLog, pauseActor } from '../utils/globalPauseUtils.js';

/** Who presses the button: the account's uid, display name (if any) and the role code */
export function currentPauseActor(role) {
  const user = auth?.currentUser;
  return pauseActor({ uid: user?.uid || '', name: user?.displayName || '', role });
}

export function globalStatusDocRef(competitionId) {
  if (!competitionId) throw new Error('competitionId saknas');
  return doc(db, 'artifacts', appId, 'public', 'data', 'competitions', competitionId, 'config', 'globalStatus');
}

/** A new pause event (private pauseEvents/{eventId}, a unique id: safe to queue offline) */
export function pauseEventRef(competitionId) {
  if (!competitionId) throw new Error('competitionId saknas');
  return doc(collection(db, 'artifacts', appId, 'private', 'data', 'competitions', competitionId, 'pauseEvents'));
}

/** The event for a press: the same reason, who and where as a log entry */
export function pauseEventDoc(isPaused, nowIso, details = {}) {
  const entry = buildPauseEntry(nowIso, details);
  const event = { type: isPaused ? 'start' : 'end', at: String(nowIso), atServer: serverTimestamp(), processed: false };
  if (entry.by) event.by = entry.by;
  if (isPaused) {
    event.reason = entry.reason;
    if (entry.note) event.note = entry.note;
    if (entry.where) event.where = entry.where;
  }
  return event;
}

// As saveMarathonObstacleResult: a transaction on weak signal can hang for long
const PAUSE_TRANSACTION_TIMEOUT_MS = 5000;

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'deadline-exceeded' })), ms);
    })
  ]);
}

// No (usable) connection, as opposed to a refusal such as permission-denied
function isConnectionError(error) {
  return ['unavailable', 'deadline-exceeded', 'failed-precondition'].includes(error?.code)
    || /offline|network/i.test(String(error?.message || ''));
}

/**
 * Pauses (isPaused true) or resumes the competition.
 * details: { reason, note, by: { uid, name, role }, where } for a pause,
 * { by } for a resume. Tells the user how it went (toast or error dialog).
 */
export async function setGlobalPause(competitionId, isPaused, details = {}) {
  try {
    const statusRef = globalStatusDocRef(competitionId);
    // The pause log is subtracted from stage times stamped in server time
    const now = new Date(serverNow());
    const nowIso = now.toISOString();
    const doneText = isPaused
      ? t('observer_pause_time').replace('{time}', now.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }))
      : t('observer_resume');

    const statusDoc = (pauseLog) => ({
      isPaused: !!isPaused,
      // The text is made in each viewer's language from the log
      // (globalPauseUtils); an older status text in one language goes
      statusText: deleteField(),
      pauseLog,
      updatedAt: serverTimestamp()
    });

    // Transactions need the network. Offline: queue a pause event (its own
    // document, so it cannot overwrite another official's entry); the server
    // folds it into the log in the order things happened (functions
    // src/pauseEvents.js). isPaused is set along with it, in the same batch,
    // so this device's own screen (banner, clocks) follows the press at once;
    // the fold sets it from the log again.
    const writeFromDeviceCopy = async () => {
      const docSnap = await getDoc(statusRef);
      const pauseLog = nextPauseLog(docSnap.exists() ? docSnap.data()?.pauseLog : [], isPaused, nowIso, details);
      if (!pauseLog) return 'saved';
      const batch = writeBatch(db);
      batch.set(pauseEventRef(competitionId), pauseEventDoc(isPaused, nowIso, details));
      batch.set(statusRef, { isPaused: !!isPaused, updatedAt: serverTimestamp() }, { merge: true });
      // Not awaited until the server answers: the official gets feedback now.
      // Not reported to rejectedWrites: a pause belongs to no start number
      return awaitWriteOrQueue(trackWrite('Sparar tävlingspaus', batch.commit()), {
        onLateError: () => showAlert(t('observer_pause_error'), false)
      });
    };

    let queued = false;
    let slowSignal = false;
    if (navigator.onLine === false) {
      queued = (await writeFromDeviceCopy()) === 'queued';
    } else {
      const transactionDone = runTransaction(db, async (tx) => {
        const docSnap = await tx.get(statusRef);
        const pauseLog = nextPauseLog(docSnap.exists() ? docSnap.data()?.pauseLog : [], isPaused, nowIso, details);
        if (pauseLog) tx.set(statusRef, statusDoc(pauseLog), { merge: true });
      });
      try {
        await withTimeout(transactionDone, PAUSE_TRANSACTION_TIMEOUT_MS);
      } catch (e) {
        if (!isConnectionError(e)) throw e;
        if (e?.message === 'timeout') {
          // Weak signal: the transaction is slow, not failed, and may still
          // commit. The official is told now (the button no longer hangs);
          // the log is written from the device copy only if the transaction
          // itself fails for lack of connection, since a second write of the
          // whole log could erase another official's entry
          slowSignal = true;
          transactionDone.catch(async (txError) => {
            if (!isConnectionError(txError)) {
              console.error('Kunde inte ändra paus-status:', txError);
              showAlert(t('observer_pause_error'), false);
              return;
            }
            try {
              await writeFromDeviceCopy();
            } catch (copyError) {
              console.error('Kunde inte ändra paus-status:', copyError);
              showAlert(t('observer_pause_error'), false);
            }
          });
        } else {
          queued = (await writeFromDeviceCopy()) === 'queued';
        }
      }
    }

    if (slowSignal) {
      // Not on the device yet (a transaction is applied only when it commits)
      showAlert(`${doneText} ${t('pause_slow_signal')}`, 'offline');
      return;
    }
    showAlert(`${doneText}${queuedNotice(queued ? 'queued' : 'saved')}`, queued ? 'offline' : true);
  } catch (e) {
    console.error('Kunde inte ändra paus-status:', e);
    showAlert(t('observer_pause_error'), false);
  }
}
