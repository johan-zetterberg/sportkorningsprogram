// js/core-engine/precision.js
// Adapter to the shared precision calculation so total/archive and UI calculate alike.

import {
    calculatePrecisionResult as calculatePrecisionResultFromData,
    calculatePrecisionTimePenalty,
    computeMaxSecondsForClass
} from '../utils/precisionCalculation.js';
import { isClearRoundClass } from './marathon.js';

export {
    calculatePrecisionTimePenalty,
    computeMaxSecondsForClass
};

export function calculatePrecisionResult(state) {
    const { equipage, precision, config } = state || {};
    // Clear round applies to the whole class (TR V 509.3): no precision placing
    const isClearRound = isClearRoundClass(equipage?.className, {
        marathonConfig: config?.marathonConfig,
        dressyrClassConfig: config?.dressyrClassConfig
    });
    return calculatePrecisionResultFromData(
        precision?.resultDoc || {},
        equipage,
        config?.precisionConfig || {},
        {
            currentCompetition: config?.ruleSettings ? { ruleSettings: config.ruleSettings } : null,
            isClearRound,
            // The class's rule profile (TR/FEI) is in the marathon class settings
            marathonConfig: config?.marathonConfig || null
        }
    );
}
