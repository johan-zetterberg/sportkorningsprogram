// Merged classes (several TDB classes shown and ranked as one) are saved by the
// admin in config/display.mergeByClassNumber. Older competitions may have them
// in tdbMergeGroups, classMergeMap or tdbMergeMap instead. Every page reads them
// through here, so they all merge the same classes.
import { db, appId } from '../config/firebase-config.js';
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getConfig } from './competitionService.js';

const LEGACY_SOURCES = ['tdbMergeGroups', 'classMergeMap', 'tdbMergeMap'];
const ALL_SOURCES = [...LEGACY_SOURCES, 'display'];

/** Whether a merge config (any of the stored shapes) holds at least one group */
export function hasMergeGroups(raw) {
    if (!raw || typeof raw !== 'object') return false;
    const source = raw.value ?? raw;
    const groups = source?.mergeByClassNumber ?? source;
    if (Array.isArray(groups)) {
        return groups.some(members => Array.isArray(members) && members.length > 0);
    }
    if (!groups || typeof groups !== 'object') return false;
    return Object.values(groups).some(info => Array.isArray(info?.members) && info.members.length > 0);
}

/**
 * The merge config to use from the latest copy of each source document: a
 * legacy document only when it holds groups, otherwise display. Returns an
 * object buildMergeMap understands (null when there is nothing).
 */
export function pickMergeSource(sources = {}) {
    for (const key of LEGACY_SOURCES) {
        const raw = sources[key];
        const data = raw?.value ?? raw;
        if (hasMergeGroups(data)) return data;
    }
    const display = sources.display?.value ?? sources.display;
    return display?.mergeByClassNumber ? { mergeByClassNumber: display.mergeByClassNumber } : null;
}

/**
 * A function giving the class group an equipage is placed in: its merge group
 * (by TDB class number) or its own class
 */
export function mergeGroupResolver(mergeSource) {
    const byNumber = new Map();
    const source = mergeSource?.value ?? mergeSource;
    const groups = source?.mergeByClassNumber ?? source;
    if (Array.isArray(groups)) {
        groups.forEach((members) => {
            if (!Array.isArray(members) || !members.length) return;
            const nums = members.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
            nums.forEach(num => byNumber.set(num, `TDBGROUP:${nums.join('+')}`));
        });
    } else if (groups && typeof groups === 'object') {
        Object.entries(groups).forEach(([key, info]) => {
            (Array.isArray(info?.members) ? info.members : [])
                .map(Number).filter(Number.isFinite)
                .forEach(num => byNumber.set(num, `GROUP:${key}`));
        });
    }
    return (eq) => {
        const num = Number(eq?.tdbClassNumber);
        const hit = Number.isFinite(num) ? byNumber.get(num) : null;
        return hit || `CLASS:${eq?.className || ''}`;
    };
}

/** The merge config of a competition, read once */
export async function loadMergeSource(competitionId) {
    if (!competitionId) return null;
    const entries = await Promise.all(ALL_SOURCES.map(async (key) => {
        try {
            return [key, await getConfig(competitionId, key)];
        } catch {
            return [key, null];
        }
    }));
    return pickMergeSource(Object.fromEntries(entries));
}

/**
 * Listens to all merge sources and calls onChange(mergeSource) with the
 * combined result whenever one changes (a deleted or emptied document counts).
 * Returns the unsubscribe function.
 */
export function listenMergeSource(competitionId, onChange) {
    if (!competitionId) return () => { };
    const latest = {};
    const unsubs = ALL_SOURCES.map((key) => onSnapshot(
        doc(db, 'artifacts', appId, 'public', 'data', 'competitions', competitionId, 'config', key),
        (snap) => {
            latest[key] = snap.exists() ? snap.data() : null;
            onChange(pickMergeSource(latest));
        },
        (err) => console.warn('[mergeConfig] snapshot error', key, err?.code || err)
    ));
    return () => unsubs.forEach(unsub => { try { unsub(); } catch { } });
}
