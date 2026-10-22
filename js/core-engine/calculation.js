// js/core-engine/calculation.js
import { calculateDressageResult } from './dressage.js';
import { calculateMarathonResult } from './marathon.js';
import { calculatePrecisionResult } from './precision.js';
import { getClassSettings } from './marathon.js';
import { getClassJudgeAssignments } from './dressage.js';
import { getCourseCandidates } from '../utils/precisionCalculation.js';
import { round2, isNum, clearRoundPhaseApproved, combineClearRoundPhases } from './rules-ledger.js';

const PHASES = ['D', 'M', 'P'];

function phaseListOf(value) {
    if (Array.isArray(value)) return value.map((p) => String(p).toUpperCase()).filter((p) => PHASES.includes(p));
    if (value && typeof value === 'object') return PHASES.filter((p) => value[p] === true);
    return null;
}

/**
 * The phases (D, M, P) a class drives, for the clear round (TR V 509.3) and
 * the TDB sheet. configs.drivenPhases (['D','M','P'] or { D: true, ... })
 * wins; else from the configs: a dressage program or judge mapping for the
 * class, marathon class settings, a precision course or max time. A class no
 * config knows drives all three (combined driving).
 * @param {string|object} cls - class name, or an equipage / row (className,
 *        _mergedLabel / mergedTestLabel)
 * @param {object} configs - { drivenPhases, dressageProgramMapping,
 *        dressageJudgeMapping, marathonConfig, precisionConfig }
 * @returns {string[]} e.g. ['D', 'M', 'P']
 */
export function classDrivenPhases(cls, configs = {}) {
    const explicit = phaseListOf(configs?.drivenPhases);
    if (explicit && explicit.length) return explicit;
    const className = String((typeof cls === 'string' ? cls : cls?.className) || '').trim();
    const names = typeof cls === 'string' ? [className] : getCourseCandidates(cls || {});
    if (!className) return PHASES.slice();

    const programMapping = configs?.dressageProgramMapping?.mapping && typeof configs.dressageProgramMapping.mapping === 'object'
        ? configs.dressageProgramMapping.mapping
        : (configs?.dressageProgramMapping || {});
    const dressage = names.some((name) => !!programMapping[name])
        || names.some((name) => Object.keys(getClassJudgeAssignments(name, configs?.dressageJudgeMapping || {})).length > 0);
    const marathon = names.some((name) => !!getClassSettings(name, configs?.marathonConfig || null));
    const precisionConfig = configs?.precisionConfig || {};
    const precision = names.some((name) => !!precisionConfig.courses?.[name]
        || (isNum(Number(precisionConfig.maxTimeByClass?.[name])) && Number(precisionConfig.maxTimeByClass[name]) > 0));

    const derived = PHASES.filter((p, i) => [dressage, marathon, precision][i]);
    return derived.length ? derived : PHASES.slice();
}

// The whole clear round (true / false / null undecided), see calculateTotalResult
function clearRoundDecision(state, { dr, ma, pr, isEliminated, dressageComplete, marathonComplete }) {
    if (isEliminated) return false;
    if (state?.equipage?.status === 'struken') return false;
    const driven = new Set(classDrivenPhases(state?.equipage || {}, state?.config || {}));
    // A phase with a result is driven, whatever the configs say
    if (isNum(dr.penalty) || dr.eliminated) driven.add('D');
    if (isNum(ma.totalPenalty) || ma.status === 'Pågår' || ma.status === 'Klar') driven.add('M');
    if (isNum(pr.totalPenalty) || pr.running === true || pr.status === 'Utgått') driven.add('P');

    const dressage = dressageComplete ? clearRoundPhaseApproved('D', dr.penalty) : null;
    const marathon = marathonComplete ? clearRoundPhaseApproved('M', ma.totalPenalty) : null;
    let precision = null;
    if (pr.status === 'Utgått') precision = false;
    else if (pr.finalized === true && !pr.running && pr.status === 'Ej startat') precision = false; // finalized without a result: not started
    else if (isNum(pr.totalPenalty) && !pr.running && !pr.configMissing && (pr.finalized || pr.status === 'Klar')) {
        precision = clearRoundPhaseApproved('P', pr.totalPenalty);
    }
    const byPhase = { D: dressage, M: marathon, P: precision };
    return combineClearRoundPhases(PHASES.filter((p) => driven.has(p)).map((p) => byPhase[p]));
}

export function calculateTotalResult(state) {
    const dr = calculateDressageResult(state);
    const ma = calculateMarathonResult(state);
    const pr = calculatePrecisionResult(state);

    const elimD = !!dr.eliminated;
    const elimM = !!ma.eliminated;
    const elimP = !!pr.eliminated;
    const isEliminated = elimD || elimM || elimP;
    // Clear round: the class is not ranked, in any phase or the total (TR V 509.3)
    const isClearRound = dr.isClearRound === true || ma.isClearRound === true || pr.isClearRound === true;

    let elimReason = null;
    if (elimD) elimReason = 'ELIM (DR)';
    else if (elimM) elimReason = 'ELIM (MA)';
    else if (elimP) elimReason = 'ELIM (PR)';

    // A total (and so a placing) requires all three disciplines to be finished:
    // dressage fully judged by every judge assigned to the class, marathon
    // finished, precision not running
    const dressageComplete = isNum(dr.penalty) && !dr.isLive && dr.judgesComplete !== false;
    const marathonComplete = isNum(ma.totalPenalty) && ma.status === 'Klar';
    // A precision format whose result cannot be added to a combined total
    // (time competition, FEI 971.2.1; Young Horse marks, FEI Annex 13): no total
    const precisionComplete = isNum(pr.totalPenalty) && !pr.running && !pr.configMissing
        && pr.formatExcludesTotal !== true
        && (pr.finalized || pr.status === 'Klar');

    let total = null;
    if (!isEliminated && dressageComplete && marathonComplete && precisionComplete) {
        total = round2(dr.penalty + ma.totalPenalty + pr.totalPenalty);
    }

    const hasAnyData = (dr.points != null) || (ma.totalPenalty != null) || (pr.totalPenalty != null) || !!pr.running;
    const isOngoing = !isEliminated && total === null && hasAnyData;

    // TR V 509.3: "Kriterier för clear round är i dressyr högst 80
    // straffpoäng, i maraton och precision 0 straffpoäng. Tid i maratonhinder
    // ger inte straffpoäng." Over the phases the class drives
    // (classDrivenPhases; a phase with a result counts as driven). A finished
    // phase is approved by its criterion; eliminated, retired or not started
    // (TR 532.4: "Kusk som inte startar i en deltävling bedöms vara struken")
    // is not approved; a phase not finished yet (being driven or judged, a
    // judge missing, no max time) leaves it undecided: null
    const clearRoundApproved = isClearRound
        ? clearRoundDecision(state, { dr, ma, pr, isEliminated, dressageComplete, marathonComplete })
        : false;

    return {
        totalPenalty: total,
        isEliminated,
        elimReason,
        isOngoing,
        isClearRound,
        clearRoundApproved,
        dressageComplete,
        marathonComplete,
        precisionComplete,
        dressagePenalty: dr.penalty,
        marathonPenalty: ma.totalPenalty,
        precisionPenalty: pr.totalPenalty,
        dressage: dr,
        marathon: ma,
        precision: pr
    };
}
