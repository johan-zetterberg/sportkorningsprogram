// js/core-engine/precision.js
// Adapter mot den delade precision-kalkylen så total/arkiv och UI räknar lika.

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
        config?.precisionConfig || {}
    );
}
