// Field device status: while a field input page is open and visible, the
// device overwrites one small document once a minute (its own id, kept in
// localStorage) so the secretariat sees which devices are alive, their queue
// of unsent writes and where they are. Nothing is written while the page is
// hidden or the device is offline (an offline device cannot report anyway);
// the document expires through the TTL field expireAt (docs/OPS.md).
import { collection, doc, onSnapshot, serverTimestamp, setDoc, Timestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from '../config/firebase-config.js';
import { getGlobalState } from '../main.js';
import { syncService } from './syncService.js';
import { mergeUserRoles } from '../utils/roleAccess.js';
import { APP_VERSION } from '../appVersion.js';
import {
    DEVICE_TTL_MS,
    HEARTBEAT_INTERVAL_MS,
    buildHeartbeatDoc,
    contextFromHash,
    generateDeviceId,
    isFieldPage,
    isValidDeviceId
} from './deviceHeartbeatUtils.js';

const DEVICE_ID_KEY = 'fieldDeviceId';
const devicesPath = (competitionId) => `artifacts/${appId}/private/data/competitions/${competitionId}/devices`;

let activePage = null;
let timer = null;
let pageContext = { startNumber: '', obstacle: '' };
let lastSentAt = 0;

export function getDeviceId() {
    try {
        const saved = localStorage.getItem(DEVICE_ID_KEY);
        if (isValidDeviceId(saved)) return saved;
        const fresh = generateDeviceId();
        localStorage.setItem(DEVICE_ID_KEY, fresh);
        return fresh;
    } catch (_) {
        // No storage: one id for this page load
        if (!getDeviceId.memo) getDeviceId.memo = generateDeviceId();
        return getDeviceId.memo;
    }
}

/** A page names the equipage / obstacle it has selected (shown in the panel) */
export function setFieldDeviceContext({ startNumber, obstacle } = {}) {
    pageContext = {
        startNumber: startNumber != null ? String(startNumber) : pageContext.startNumber,
        obstacle: obstacle != null ? String(obstacle) : pageContext.obstacle
    };
}

function clockSyncedAt() {
    try {
        const saved = JSON.parse(localStorage.getItem('serverClockOffset') || 'null');
        return Number.isFinite(saved?.measuredAt) ? saved.measuredAt : null;
    } catch (_) {
        return null;
    }
}

// The obstacle the marathon input page has open (it remembers it per competition)
function rememberedObstacle(competitionId) {
    if (activePage !== 'maraton-input') return '';
    try { return localStorage.getItem(`maratonLastObstacle_${competitionId}`) || ''; } catch (_) { return ''; }
}

function sendHeartbeat() {
    const user = getGlobalState('currentUser');
    const competition = getGlobalState('currentCompetition');
    if (!activePage || !user?.uid || !competition?.id) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const fromHash = contextFromHash(typeof window !== 'undefined' ? window.location.hash : '');
    const deviceId = getDeviceId();
    const roles = mergeUserRoles(user).filter((role) => role !== 'publik');
    const data = buildHeartbeatDoc({
        deviceId,
        uid: user.uid,
        userName: user.displayName || user.email || '',
        role: roles.join(', '),
        page: activePage,
        startNumber: pageContext.startNumber || fromHash.startNumber,
        obstacle: pageContext.obstacle || fromHash.obstacle || rememberedObstacle(competition.id),
        queueSize: syncService.count,
        online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
        clockSyncedAt: clockSyncedAt(),
        appVersion: APP_VERSION
    });
    lastSentAt = Date.now();
    // Overwritten, never appended; not awaited (a status line, not data)
    setDoc(doc(db, devicesPath(competition.id), deviceId), {
        ...data,
        lastSeen: serverTimestamp(),
        expireAt: Timestamp.fromMillis(Date.now() + DEVICE_TTL_MS)
    }).catch((error) => {
        // No staff role in this competition (e.g. an admin preview): stop
        if (error?.code === 'permission-denied') stopHeartbeat();
    });
}

function onVisibility() {
    // Back on the page after a while: report at once
    if (document.visibilityState === 'visible' && Date.now() - lastSentAt > HEARTBEAT_INTERVAL_MS / 2) sendHeartbeat();
}

function stopHeartbeat() {
    activePage = null;
    if (timer) clearInterval(timer);
    timer = null;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    if (typeof window !== 'undefined') window.removeEventListener('online', sendHeartbeat);
}

/**
 * Called on every navigation (navigationService): a field page starts the
 * heartbeat (or names the new page), any other page stops it.
 */
export function syncFieldHeartbeat(pageKey) {
    if (!isFieldPage(pageKey)) {
        stopHeartbeat();
        pageContext = { startNumber: '', obstacle: '' };
        return;
    }
    const changed = activePage !== pageKey;
    activePage = pageKey;
    if (changed) pageContext = { startNumber: '', obstacle: '' };
    if (!timer) {
        timer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('online', sendHeartbeat);
    }
    // The first report shortly after the page loaded (its user and competition set)
    setTimeout(sendHeartbeat, 3000);
}

/** The secretariat's panel: every device of the competition, live */
export function listenForFieldDevices(competitionId, onData, onError) {
    if (!competitionId) return () => { };
    return onSnapshot(collection(db, devicesPath(competitionId)), (snap) => {
        onData(snap.docs.map((d) => {
            const data = d.data();
            return { id: d.id, ...data, lastSeenMs: data.lastSeen?.toMillis?.() ?? null };
        }));
    }, (error) => {
        console.warn('Fältenheterna kunde inte läsas:', error);
        onError?.(error);
    });
}
