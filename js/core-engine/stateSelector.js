// js/core-engine/stateSelector.js

/**
 * Normalizes raw Firestore document data into a strictly-typed CompetitionState object
 * that the core calculation engine can process deterministically.
 */

export function buildEquipageState(equipageDoc) {
    if (!equipageDoc) return null;
    return {
        startNumber: equipageDoc.startNumber || equipageDoc.startNo,
        className: String(equipageDoc.className || equipageDoc.class || equipageDoc.klass || '').trim(),
        category: String(equipageDoc.category || '').toLowerCase(),
        isPara: !!equipageDoc.isPara,
        status: equipageDoc.status,
        errorPoints: Number(equipageDoc.errorPoints) || 0,
        heightCm: Number(equipageDoc.heightCm) || Number(equipageDoc.horseHeightCm) || null,
        testKey: equipageDoc.testKey || equipageDoc.programKey || null
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
            judges: config.judges || [],
            marathonConfig: config.marathonConfig || {},
            precisionConfig: config.precisionConfig || {}
        }
    };
}
