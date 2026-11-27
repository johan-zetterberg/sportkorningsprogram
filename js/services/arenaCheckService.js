// Obstacle controllers' reports in arena driving (js/utils/arenaChecks.js):
// artifacts/{appId}/public/data/competitions/{compId}/arenaChecks/{sn__round__obstacle}
import { db, appId } from '../config/firebase-config.js';
import { collection, doc, getDocs, onSnapshot, query, setDoc, where } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { arenaCheckId } from '../utils/arenaChecks.js';
import { awaitWriteOrQueue } from '../utils/offlineWrite.js';

function checksCollection(competitionId) {
    return collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/arenaChecks`);
}

function checkRef(competitionId, startNumber, round, obstacle) {
    return doc(checksCollection(competitionId), arenaCheckId(startNumber, round, obstacle));
}

/** The reports of one equipage (result details, protocol PDF); [] when they cannot be read */
export async function getArenaChecksFor(competitionId, startNumber) {
    if (!competitionId) return [];
    try {
        const snap = await getDocs(query(checksCollection(competitionId), where('startNumber', '==', Number(startNumber))));
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (error) {
        console.warn('[arenaChecks] read:', error?.message || error);
        return [];
    }
}

/** All reports of the competition, live; returns the unsubscribe */
export function listenArenaChecks(competitionId, onData, onError = null) {
    return onSnapshot(checksCollection(competitionId), (snap) => {
        onData(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (error) => {
        console.warn('[arenaChecks] listener:', error?.message || error);
        onError?.(error);
    });
}

/**
 * A controller's report: only the fields given are written (merged), so the
 * gate verdict and knocks, the route and a passage written from different
 * devices never overwrite each other. fields: { result, knocks } | { route }
 * | { passMs, passAt }. 'saved' | 'queued'
 */
export function saveArenaCheck(competitionId, { startNumber, className, round, obstacle, by }, fields, { onLateError } = {}) {
    const now = Date.now();
    return awaitWriteOrQueue(setDoc(checkRef(competitionId, startNumber, round, obstacle), {
        startNumber: Number(startNumber),
        className: String(className || ''),
        round,
        obstacle: String(obstacle),
        ...fields,
        by: String(by || ''),
        at: now,
        updatedAt: now
    }, { merge: true }), { onLateError });
}

/** The judge has added the report's penalties: { knocks, wrongCourse } */
export function markArenaCheckApplied(competitionId, { startNumber, round, obstacle }, applied, { onLateError } = {}) {
    return awaitWriteOrQueue(setDoc(checkRef(competitionId, startNumber, round, obstacle), {
        applied: { knocks: Number(applied.knocks) || 0, wrongCourse: applied.wrongCourse === true },
        updatedAt: Date.now()
    }, { merge: true }), { onLateError });
}
