// Obstacle controllers' reports in arena driving (js/utils/arenaChecks.js):
// artifacts/{appId}/public/data/competitions/{compId}/arenaChecks/{sn__round__obstacle}
import { db, appId } from '../config/firebase-config.js';
import { collection, doc, onSnapshot, setDoc } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { arenaCheckId } from '../utils/arenaChecks.js';
import { awaitWriteOrQueue } from '../utils/offlineWrite.js';

function checksCollection(competitionId) {
    return collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/arenaChecks`);
}

function checkRef(competitionId, startNumber, round, obstacle) {
    return doc(checksCollection(competitionId), arenaCheckId(startNumber, round, obstacle));
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

/** A controller's report ({ result, knocks }); 'saved' | 'queued' */
export function saveArenaCheck(competitionId, { startNumber, className, round, obstacle, result, knocks, by }, { onLateError } = {}) {
    const now = Date.now();
    return awaitWriteOrQueue(setDoc(checkRef(competitionId, startNumber, round, obstacle), {
        startNumber: Number(startNumber),
        className: String(className || ''),
        round,
        obstacle: String(obstacle),
        result,
        knocks,
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
