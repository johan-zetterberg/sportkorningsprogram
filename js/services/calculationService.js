
import { getPrograms } from '../utils/dressageUtils.js';
import {
    calculateMarathonResult as _calcMarathon,
    getMarathonEngineConfig
} from '../utils/marathonUtils.js';
import {
    calculatePrecisionResult as _calcPrecision
} from '../utils/precisionUtils.js';

import { buildCompetitionState } from '../core-engine/stateSelector.js';
import { getCompetitionSetting } from './competitionSettingsStore.js';
import { calculateDressageResult as _coreDressage } from '../core-engine/dressage.js';
import { calculateMarathonResult as _coreMarathon } from '../core-engine/marathon.js';
import { calculateTotalResult as _coreTotal } from '../core-engine/calculation.js';

// =========================================================================
// CALCULATION SERVICE
// -------------------------------------------------------------------------
// Browser entry point to the result engine in js/core-engine (the same code
// the Cloud Function runs). This file only gathers browser-side inputs
// (program list, class mapping, marathon config, pause log, rule settings)
// and builds the engine state. No result math lives here.
// =========================================================================

function getRuleSettings() {
    if (typeof window !== 'undefined' && typeof window.getGlobalState === 'function') {
        return window.getGlobalState('currentCompetition')?.ruleSettings || null;
    }
    return null;
}

function hasClassData(marathonConfig) {
    return !!(marathonConfig && (marathonConfig.marathonClassData || marathonConfig.maratonClassData));
}

// Marathon inputs for this browser session; an explicitly passed config wins
// (e.g. the archive, which runs without the marathon pages' setMarathonConfig)
function marathonInputsWith(marathonConfig) {
    const inputs = getMarathonEngineConfig();
    if (hasClassData(marathonConfig)) inputs.marathonConfig = marathonConfig;
    return inputs;
}

// The active competition's settings (competitionSettingsStore): never another
// competition's, also right after switching competitions
function getProgramMapping() {
    const m = getCompetitionSetting('klassProgramMapping');
    return (m && typeof m === 'object') ? m : {};
}

// Judges each class expects (config/dressageJudgeMapping); an explicitly passed mapping wins
function getJudgeMapping(explicit) {
    const m = explicit || getCompetitionSetting('dressageJudgeMapping');
    return (m && typeof m === 'object') ? m : {};
}

// --- DRESSAGE ---

/**
 * Calculates the final dressage result for an equipage based on their protocols.
 * @param {Object} equipage - The equipage object (should contain errorPoints).
 * @param {Array} protocols - List of protocol objects, including the 'general' doc (deduplicated by the engine).
 * @param {Array} validJudges - List of valid judges for the competition (optional).
 * @param {Object} programsOverride - Optional dictionary of programs.
 * @returns {Object} Comprehensive result object.
 */
export function calculateDressageResult(equipage, protocols, validJudges = [], programsOverride = null) {
    const { marathonConfig, dressyrClassConfig } = getMarathonEngineConfig();
    const state = buildCompetitionState(equipage, protocols, null, null, null, {
        // Clear round of the class (isClearRoundClass): no dressage placing
        marathonConfig,
        dressyrClassConfig,
        allPrograms: programsOverride || getPrograms(),
        dressageProgramMapping: getProgramMapping(),
        dressageJudgeMapping: getJudgeMapping(),
        judges: validJudges
    });
    return _coreDressage(state);
}

/**
 * Helper to calculate details for a single judge's protocol.
 * Useful for modal detail views and live input feedback.
 */
export function calculateSingleJudgeDressageResult(protocol, program, equipage = {}) {
    if (!protocol || !program) return null;

    // Use a unique enforced key for the one-off calculation to ensure
    // calculateDressageResult finds exactly this program object.
    const uniqueKey = 'forced_program_override';

    // Patch protocol to point to this key, and equipage to fall back to it
    const patchedProtocol = { ...protocol, testKey: uniqueKey, programKey: uniqueKey };
    const patchedEquipage = { ...equipage, errorPoints: 0, testKey: uniqueKey };

    return calculateDressageResult(
        patchedEquipage,
        [patchedProtocol],
        [], // validJudges ignored for single judge calc usually
        { [uniqueKey]: program }
    );
}

// --- MARATHON ---

/**
 * Calculates marathon result including time penalties, obstacle penalties, and elimination status.
 * @param {Object} equipage - The equipage object.
 * @param {Object} obstacleData - Marathon result doc (obstacles etc).
 * @param {Object} timingData - Object containing stage times (A/T/B).
 * @param {Object} [marathonConfig] - Marathon config; defaults to the one set via setMarathonConfig.
 * @returns {Object} Standardized marathon result object.
 */
export function calculateMarathonResult(equipage, obstacleData, timingData, marathonConfig = null) {
    if (!hasClassData(marathonConfig)) return _calcMarathon(equipage, obstacleData, timingData);
    const state = buildCompetitionState(equipage, null, obstacleData, timingData, null, marathonInputsWith(marathonConfig));
    return _coreMarathon(state);
}

// --- PRECISION ---

/**
 * Calculates precision result.
 * @param {Object} data - The raw precision result data (from DB).
 * @param {Object} equipage - The equipage object.
 * @param {Object} config - Precision configuration (max time, widths, etc).
 * @param {Object} [options] - e.g. { marathonConfig } for the class's rule profile
 * @returns {Object} Standardized precision result object.
 */
export function calculatePrecisionResult(data, equipage, config, options = {}) {
    return _calcPrecision(data, equipage, config, options);
}

// --- TOTAL ---

/**
 * Orchestrates result calculation for all disciplines and aggregates the total.
 * @param {Object} equipage - The equipage object.
 * @param {Array} dressageProtocols - Raw dressage protocols.
 * @param {Object} marathonData - { obstacleData: Object, timeData: Object }
 * @param {Object} precisionData - Raw precision data.
 * @param {Object} context - { allPrograms, judges, dressageJudgeMapping, marathonConfig, precisionConfig }
 * @returns {Object} Comprehensive result including sub-results and total.
 */
export function calculateTotalResult(equipage, dressageProtocols, marathonData, precisionData, context = {}) {
    const marathonInputs = marathonInputsWith(context.marathonConfig);
    const state = buildCompetitionState(
        equipage,
        dressageProtocols,
        marathonData?.obstacleData || {},
        marathonData?.timeData || {},
        precisionData,
        {
            ...marathonInputs,
            // Clear round per class (dressage admin); an explicitly passed config wins
            dressyrClassConfig: context.dressyrClassConfig || marathonInputs.dressyrClassConfig || null,
            allPrograms: context.allPrograms || getPrograms(),
            dressageProgramMapping: getProgramMapping(),
            dressageJudgeMapping: getJudgeMapping(context.dressageJudgeMapping),
            judges: context.judges,
            precisionConfig: context.precisionConfig,
            drivenPhases: context.drivenPhases || null,
            ruleSettings: marathonInputs.ruleSettings || getRuleSettings()
        }
    );
    return _coreTotal(state);
}
