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
        horses: Array.isArray(equipageDoc.horses)
            ? equipageDoc.horses.map(h => ({ heightCm: horseHeight(h) }))
            : [],
        testKey: equipageDoc.testKey || equipageDoc.programKey || null,
        // Merged classes (precision course lookup)
        _mergedLabel: equipageDoc._mergedLabel || null,
        useMergedTestForDisplay: !!equipageDoc.useMergedTestForDisplay,
        mergedTestLabel: equipageDoc.mergedTestLabel || null
    };
}

export function buildCompetitionState(equipageDoc, dressageProtocols, marathonDoc, timingDoc, precisionDoc, config = {}) {
    return {
        equipage: buildEquipageState(equipageDoc),
        dressage: {
            protocols: Array.isArray(dressageProtocols) ? dressageProtocols : []
        },
        marathon: {
            resultDoc: marathonDoc || {},
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
            precisionConfig: config.precisionConfig || {},
            ruleSettings: config.ruleSettings || null,
            pauseWindows: Array.isArray(config.pauseWindows) ? config.pauseWindows : [],
            // Current time for live stages; omitted on the server
            nowMs: Number.isFinite(config.nowMs) ? config.nowMs : null
        }
    };
}
