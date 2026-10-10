// js/core-engine/precision.js
// Adapter to the shared precision calculation so total/archive and UI calculate alike.

import {
    calculatePrecisionResult as calculatePrecisionResultFromData,
    calculatePrecisionTimePenalty,
    computeMaxSecondsForClass
} from '../utils/precisionCalculation.js';

export {
    calculatePrecisionTimePenalty,
    computeMaxSecondsForClass
};

export function calculatePrecisionResult(state) {
    const { equipage, precision, config } = state || {};
    return calculatePrecisionResultFromData(
        precision?.resultDoc || {},
        equipage,
        config?.precisionConfig || {},
        { currentCompetition: config?.ruleSettings ? { ruleSettings: config.ruleSettings } : null }
    );
}
