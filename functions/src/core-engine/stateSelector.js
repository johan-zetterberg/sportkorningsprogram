// js/core-engine/stateSelector.js

/**
 * Normalizes raw Firestore document data into a strictly-typed CompetitionState object
 * that the core calculation engine can process deterministically.
 * Browser adapters and the Cloud Function both build state here, so every
 * field an engine reads must be carried over.
 */

// Heights are often typed as text ("128", "128 cm", "1,32"): the pony
// category (and with it the marathon and precision tempo) comes from them
const toHeight = (v) => {
    if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
    const n = parseFloat(String(v ?? '').replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : null;
};
const horseHeight = (h) => toHeight(h?.heightCm) || toHeight(h?.withersHeightCm) || toHeight(h?.height);

export function buildEquipageState(equipageDoc) {
    if (!equipageDoc) return null;
    return {
        startNumber: equipageDoc.startNumber || equipageDoc.startNo,
        className: String(equipageDoc.className || equipageDoc.class || equipageDoc.klass || '').trim(),
        category: String(equipageDoc.category || '').toLowerCase(),
        categoryName: equipageDoc.categoryName || null,
        division: equipageDoc.division || null,
        animalCategory: equipageDoc.animalCategory || null,
        equineCategory: equipageDoc.equineCategory || null,
        ponyCategory: equipageDoc.ponyCategory || null,
        horseCategory: equipageDoc.horseCategory || null,
        type: equipageDoc.type || null,
        equineType: equipageDoc.equineType || null,
        isPara: !!equipageDoc.isPara,
        status: equipageDoc.status,
        eliminated: !!equipageDoc.eliminated,
        errorPoints: Number(equipageDoc.errorPoints) || 0,
        heightCm: toHeight(equipageDoc.heightCm) || toHeight(equipageDoc.horseHeightCm) || toHeight(equipageDoc.withersHeightCm),
        // Type/category and reserve decide the FEI cones speed (FEI 975.10.5:
        // single pony 260, single horse 250; a reserve is not driven)
        horses: Array.isArray(equipageDoc.horses)
            ? equipageDoc.horses.map(h => ({
                heightCm: horseHeight(h),
                type: h?.type || null,
                category: h?.category || null,
                reserve: h?.reserve === true || h?.isReserve === true
            }))
            : [],
        testKey: equipageDoc.testKey || equipageDoc.programKey || null,
        // Merged classes (precision course lookup)
        _mergedLabel: equipageDoc._mergedLabel || null,
        useMergedTestForDisplay: !!equipageDoc.useMergedTestForDisplay,
        mergedTestLabel: equipageDoc.mergedTestLabel || null
    };
}

// --- Marathon document (maraton/{sn}) ---
// Each obstacle's saved result is its own map entry (obstacleResults.{n}) and
// its live clock its own entry (obstacleLive.{n}). Both are written with
// merge, so two obstacles saving or timing the same equipage never overwrite
// each other. Older documents carry obstacles[] and flat live fields; they are
// still read, and a map entry wins over the array entry.

const isPlainMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// Live fields of one obstacle, with the values meaning "nothing going on"
export const MARATHON_LIVE_DEFAULTS = Object.freeze({
    running: false,
    inProgress: false,
    pausedByGlobalPause: false,
    liveObstacleTimeMs: 0,
    liveObstacleStartAt: null,
    live_staticStartAt: null,
    live_routeString: '',
    live_knockdowns: '0',
    live_otherPenalty: '0',
    live_holdTimeSec: '',
    live_comment: '',
    live_eliminated: false,
    live_gateSplits: Object.freeze([])
});

function anyTimeMs(value) {
    if (value == null || value === '') return 0;
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') {
        const ms = Date.parse(value);
        return Number.isFinite(ms) ? ms : 0;
    }
    // A Timestamp kept as JSON (local backup): { seconds, nanoseconds }
    if (Number.isFinite(value?.seconds)) return value.seconds * 1000 + Math.floor((Number(value.nanoseconds) || 0) / 1e6);
    return 0;
}

/** The saved obstacle results: obstacles[] merged with obstacleResults.{n} (map wins), by number */
export function mergeMarathonObstacles(doc) {
    const legacy = Array.isArray(doc?.obstacles) ? doc.obstacles : [];
    const map = isPlainMap(doc?.obstacleResults) ? doc.obstacleResults : {};
    const byNumber = new Map();
    const unnumbered = [];
    legacy.forEach((o) => {
        const n = Number(o?.number ?? o?.obstacleNumber);
        if (Number.isFinite(n) && n > 0) byNumber.set(n, o);
        else if (o) unnumbered.push(o);
    });
    Object.entries(map).forEach(([key, entry]) => {
        const n = Number(entry?.number ?? key);
        if (!isPlainMap(entry) || !Number.isFinite(n) || n <= 0) return;
        byNumber.set(n, { ...(byNumber.get(n) || {}), ...entry, number: n });
    });
    return [...[...byNumber.entries()].sort((a, b) => a[0] - b[0]).map(([, o]) => o), ...unnumbered];
}

function liveMapEntries(doc) {
    const map = isPlainMap(doc?.obstacleLive) ? doc.obstacleLive : {};
    return Object.entries(map)
        .map(([key, entry]) => ({ entry, number: Number(key) }))
        .filter(({ entry, number }) => isPlainMap(entry) && Number.isFinite(number) && number > 0)
        .map(({ entry, number }) => ({ ...entry, number }));
}

function legacyLiveEntry(doc) {
    if (!doc || doc.currentObstacle == null || doc.currentObstacle === '') return null;
    const number = Number(doc.currentObstacle);
    if (!Number.isFinite(number) || number <= 0) return null;
    const entry = { number };
    Object.keys(MARATHON_LIVE_DEFAULTS).forEach((field) => {
        if (doc[field] !== undefined) entry[field] = doc[field];
    });
    return entry;
}

/** One obstacle's live state (obstacleLive.{n}, or the older flat fields), or null */
export function obstacleLiveEntry(doc, obstacleNumber) {
    const n = Number(obstacleNumber);
    if (!doc || !Number.isFinite(n) || n <= 0) return null;
    const entries = liveMapEntries(doc);
    if (entries.length) return entries.find((e) => e.number === n) || null;
    const legacy = legacyLiveEntry(doc);
    return legacy && legacy.number === n ? legacy : null;
}

const isActiveLive = (e) => !!e && (e.running === true || e.inProgress === true);

/** Every obstacle with a running clock or unsaved work for this equipage */
export function activeObstacleLiveEntries(doc) {
    const entries = liveMapEntries(doc);
    const list = entries.length ? entries : [legacyLiveEntry(doc)].filter(Boolean);
    return list.filter(isActiveLive);
}

/**
 * The obstacle a monitor shows for this equipage: a running clock (the latest
 * started), else unsaved work (the latest touched), else null.
 */
export function activeObstacleLive(doc) {
    const active = activeObstacleLiveEntries(doc);
    const latest = (list, field) => list.reduce((best, e) => (!best || anyTimeMs(e[field]) > anyTimeMs(best[field]) ? e : best), null);
    const running = active.filter((e) => e.running === true);
    if (running.length) return latest(running, 'liveObstacleStartAt');
    return latest(active, 'updatedAt');
}

/**
 * The document as older readers expect it: obstacles[] holds every saved
 * result and the flat live fields (currentObstacle, running, live_*) show the
 * active obstacle. A document without the maps is returned as it is.
 */
export function normalizeMarathonDoc(doc) {
    if (!isPlainMap(doc)) return doc;
    const out = { ...doc };
    if (isPlainMap(doc.obstacleResults) || Array.isArray(doc.obstacles)) {
        out.obstacles = mergeMarathonObstacles(doc);
    }
    if (liveMapEntries(doc).length) {
        const active = activeObstacleLive(doc);
        Object.entries(MARATHON_LIVE_DEFAULTS).forEach(([field, fallback]) => {
            out[field] = active && active[field] !== undefined ? active[field] : fallback;
        });
        out.currentObstacle = active ? active.number : null;
    }
    return out;
}

/**
 * The writes of one obstacle save: obstacleResults.{n} and obstacleLive.{n}
 * (cleared: the result is saved) on maraton/{sn}, and the obstacle document.
 * gateSplits and enteredAt are left out when the save has none (the
 * secretariat's correction keeps the judge's). `stamp` gives the server time.
 */
export function buildObstacleSaveWrites(obstacleNumber, resultData, stamp = () => null) {
    const key = String(Number(obstacleNumber));
    const entry = { ...resultData };
    if (entry.gateSplits == null) delete entry.gateSplits;
    if (entry.enteredAt == null) delete entry.enteredAt;
    return {
        entry,
        summaryUpdate: {
            obstacleResults: { [key]: { ...entry, updatedAt: stamp() } },
            obstacleLive: { [key]: { ...MARATHON_LIVE_DEFAULTS, live_gateSplits: [], updatedAt: stamp() } },
            updatedAt: stamp()
        },
        obstacleDoc: { ...entry, obstacleNumber: Number(obstacleNumber), updatedAt: stamp() }
    };
}

export function buildCompetitionState(equipageDoc, dressageProtocols, marathonDoc, timingDoc, precisionDoc, config = {}) {
    return {
        equipage: buildEquipageState(equipageDoc),
        dressage: {
            protocols: Array.isArray(dressageProtocols) ? dressageProtocols : []
        },
        marathon: {
            resultDoc: normalizeMarathonDoc(marathonDoc || {}),
            timingDoc: timingDoc || {}
        },
        precision: {
            resultDoc: precisionDoc || {}
        },
        config: {
            allPrograms: config.allPrograms || {},
            dressageProgramMapping: config.dressageProgramMapping || {},
            // { [className]: { C: judgeId, E: judgeId, ... } }: judges each class expects
            dressageJudgeMapping: config.dressageJudgeMapping || {},
            judges: config.judges || [],
            marathonConfig: config.marathonConfig || {},
            // config/dressyrClassConfig: its clearRound makes the class clear
            // round in all phases (isClearRoundClass)
            dressyrClassConfig: config.dressyrClassConfig || null,
            precisionConfig: config.precisionConfig || {},
            ruleSettings: config.ruleSettings || null,
            // Phases the class drives (['D','M','P']) when the caller knows
            // them; else derived from the configs (calculation.js classDrivenPhases)
            drivenPhases: config.drivenPhases || null,
            pauseWindows: Array.isArray(config.pauseWindows) ? config.pauseWindows : [],
            // Current time for live stages; omitted on the server
            nowMs: Number.isFinite(config.nowMs) ? config.nowMs : null
        }
    };
}
