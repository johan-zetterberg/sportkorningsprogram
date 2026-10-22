// What should have come in before a result is finalized, compared with what
// did: every obstacle of the class's course, both stage times and the
// observer's log (marathon), a precision result with a time, and a dressage
// protocol from each judge assigned to the class. Finalizing locks the result,
// so late writes from the field are refused after it; the gaps are shown to
// the secretariat first. Pure (no Firestore), see finalizationService.

import { getClassCourse, stageStartTS, stageStopTS } from '../core-engine/marathon.js';
import { getClassJudgeAssignments } from '../core-engine/dressage.js';
import { mergeObstacleSources } from './secretariatPatchUtils.js';
import { PRECISION_ROUND_WARNING_TEXT } from '../utils/precisionRounds.js';

const isWithdrawn = (equipage) => /^(struken|withdrawn|scratched)$/i.test(String(equipage?.status || '').trim());
const finiteNumber = (value) => value !== null && value !== '' && value !== undefined && Number.isFinite(Number(value));

function obstacleDone(entry) {
    if (!entry) return false;
    if (entry.eliminated) return true;
    const time = entry.timeInSeconds ?? entry.timeSeconds ?? entry.timeSec
        ?? (finiteNumber(entry.timeMs) ? Number(entry.timeMs) / 1000 : null);
    return (finiteNumber(time) && Number(time) > 0) || finiteNumber(entry.penalty);
}

function stageHasTime(merged, stage) {
    const upper = stage.toUpperCase();
    const duration = merged[`duration_${upper}_ms`] ?? merged[`duration_${upper}`];
    if (finiteNumber(duration) && Number(duration) > 0) return true;
    return !!(stageStartTS(merged, stage) && stageStopTS(merged, stage));
}

/**
 * Marathon gaps for one equipage. `summary` is maraton/{sn}, `timing`
 * maraton-timing/{sn}, `savedObstacles` the obstacle result documents.
 */
export function findMarathonGaps({ equipage = {}, summary = null, timing = null, savedObstacles = [], marathonConfig = {} } = {}) {
    if (isWithdrawn(equipage)) return [];
    const gaps = [];
    const merged = { ...(timing || {}), ...(summary || {}) };
    const obstacles = mergeObstacleSources(savedObstacles, summary || {});
    const eliminated = summary?.eliminated === true || [...obstacles.values()].some(entry => entry?.eliminated);
    if (!summary && !timing && obstacles.size === 0) return ['Inga maratondata har kommit in.'];
    // An eliminated equipage does not finish the course
    if (eliminated) return gaps;

    ['A', 'B'].forEach((stage) => {
        if (!stageHasTime(merged, stage)) gaps.push(`Tid för sträcka ${stage} saknas.`);
    });

    const course = getClassCourse(equipage.className, marathonConfig || {});
    if (!course) {
        gaps.push('Klassens hinder är inte kända (inga hinder i maratoninställningarna), så hindren kan inte kontrolleras.');
    } else {
        const missing = course.filter(number => !obstacleDone(obstacles.get(Number(number))));
        if (missing.length) gaps.push(`Hinderresultat saknas för hinder ${missing.join(', ')}.`);
    }

    if (!summary?.observerLog) gaps.push('Ingen observatörslogg har kommit in (kontrollera med observatören).');
    return gaps;
}

/**
 * Precision gaps for one equipage (`result` is precision/{sn}; `calc` the
 * result engine's view of it, calculatePrecisionResult, when the caller has
 * the class config: then an undecided phase 2 is listed too)
 */
export function findPrecisionGaps({ equipage = {}, result = null, calc = null } = {}) {
    if (isWithdrawn(equipage)) return [];
    if (!result) return ['Inget precisionsresultat har kommit in.'];
    if (result.eliminated === true || result.disqualified === true) return [];
    const gaps = [];
    if (!(Number(result.timeMs) > 0)) gaps.push('Tid saknas i precisionsresultatet.');
    if (result.totalPenalty === null || result.totalPenalty === undefined) gaps.push('Totalt straff saknas (kontrollera klassens maxtid).');
    if (calc) gaps.push(...precisionFinalizeBlockers(calc), ...precisionFinalizeWarnings(calc));
    return gaps;
}

/**
 * Whether a precision result can be finalized at all (the results page shows
 * Finalisera only then): a driven time or an explicit eliminated / retired
 * result, and no clock running. "Ej startat" is no result: not started
 * counts as withdrawn (TR 532.4). `calc` is calculatePrecisionResult.
 */
export function precisionHasResult(calc) {
    if (!calc || calc.running === true) return false;
    if (calc.eliminated === true || calc.status === 'Utgått') return true;
    return finiteNumber(calc.timeMs) && Number(calc.timeMs) > 0;
}

/**
 * What stops a precision result from being finalized (Swedish lines; empty:
 * nothing). `calc` is calculatePrecisionResult of the doc. round 'phase1'
 * (finalizePrecision, which closes phase 2 with it): a phase 2 of a qualified
 * equipage that runs, is stopped but not saved, has data without a decided
 * result (time, eliminated, retired). A phase 2 without a max time (no
 * course config) does not block (owner 2026-10-23): it is a warning
 * (precisionFinalizeWarnings), and the class's precision placing stays
 * provisional until the config exists; the total counts phase 1 only. round
 * 'driveOff' (finalizePrecisionDriveOff): the same for the drive-off, where a
 * missing max time still blocks.
 */
export function precisionFinalizeBlockers(calc, { round = 'phase1' } = {}) {
    if (!calc) return [];
    const check = (r, prefix) => {
        if (!r) return [];
        if (r.live) return [PRECISION_ROUND_WARNING_TEXT[`${prefix}Live`]];
        if (!r.hasData) return [];
        if (roundLacksMaxTime(r)) return prefix === 'phase2' ? [] : [PRECISION_ROUND_WARNING_TEXT[`${prefix}ConfigMissing`]];
        if (!r.decided) return [PRECISION_ROUND_WARNING_TEXT[`${prefix}Undecided`]];
        return [];
    };
    if (round === 'driveOff') return check(calc.rounds?.driveOff, 'driveOff');
    if (calc.precisionFormat !== 'twoPhase' || calc.phase2Qualified !== true) return [];
    return check(calc.rounds?.phase2, 'phase2');
}

const roundLacksMaxTime = (r) => r.configMissing || (!finiteNumber(r.maxTimeSec) && r.timePenaltyOverride !== true);

export const PHASE2_CONFIG_MISSING_FINALIZE_WARNING = 'Fas 2 saknar baninställningar – placeringarna i precision blir preliminära tills de fyllts i.';

/**
 * What finalizing a precision result goes on with but should be known
 * (Swedish lines for the confirmation): a qualified phase 2 driven without
 * course config (no max time).
 */
export function precisionFinalizeWarnings(calc) {
    if (!calc || calc.precisionFormat !== 'twoPhase' || calc.phase2Qualified !== true) return [];
    const r = calc.rounds?.phase2;
    if (!r || r.live || !r.hasData || !roundLacksMaxTime(r)) return [];
    return [PHASE2_CONFIG_MISSING_FINALIZE_WARNING];
}

const protocolBody = (protocol) => (protocol?.protocol && typeof protocol.protocol === 'object' ? { ...protocol, ...protocol.protocol } : protocol || {});

/**
 * Dressage gaps for one equipage: a protocol per judge position assigned to
 * the class (config/dressageJudgeMapping). `protocols` are the documents of
 * dressage/{sn}/protocols with their ids ('general' holds error points).
 */
export function findDressageGaps({ equipage = {}, protocols = [], judgeMapping = {} } = {}) {
    if (isWithdrawn(equipage)) return [];
    const assignments = getClassJudgeAssignments(equipage.className, judgeMapping || {});
    const positions = Object.keys(assignments);
    const judged = (protocols || []).filter(p => p && p.id !== 'general').map(protocolBody);
    if (positions.length === 0) {
        return ['Inga domare är kopplade till klassen, så protokollen kan inte kontrolleras.'];
    }
    const received = (position) => judged.find(p => {
        const judgeId = String(p.judgeId ?? String(p.id || '').replace(/^judge_/, ''));
        const pos = String(p.judgePosition ?? p.position ?? '').toUpperCase();
        return judgeId === assignments[position] || pos === position;
    });
    const gaps = [];
    const missing = positions.filter(position => !received(position));
    if (missing.length) gaps.push(`Protokoll saknas från domare ${missing.join(', ')}.`);
    positions.forEach((position) => {
        const protocol = received(position);
        if (!protocol || protocol.eliminated) return;
        const scored = (protocol.movements || []).some(m => finiteNumber(m?.score ?? m?.points));
        if (!scored) gaps.push(`Protokollet från domare ${position} har inga poäng.`);
    });
    return gaps;
}

const DISCIPLINE_LABELS = { marathon: 'maraton', precision: 'precision', dressage: 'dressyr' };

/** The confirmation shown before finalizing (Swedish UI text) */
export function finalizeConfirmMessage(discipline, startNumber, gaps = []) {
    const label = DISCIPLINE_LABELS[discipline] || discipline;
    if (!gaps.length) return `Finalisera ${label} för #${startNumber}? Resultatet låses och sena inmatningar nekas.`;
    return `Följande saknas för ${label} #${startNumber}:\n\n- ${gaps.join('\n- ')}\n\nResultatet låses och sena inmatningar nekas. Finalisera ändå?`;
}

// --- Open ground jury matters (vet strikes waiting for a decision, open
// protests): they block finalizing, archiving and the TDB report until
// decided; an admin may override with a typed word and a reason (logged in
// the auditLog) ---

export const JURY_OVERRIDE_WORD = 'ÅSIDOSÄTT';

const PHASE_LABELS_SV = { initial: 'första besiktningen', harness: 'selningskontrollen', restArea: 'viloboxen', final: 'slutbesiktningen' };
const sameStartNumber = (a, b) => String(a ?? '').trim() !== '' && String(a ?? '').trim() === String(b ?? '').trim();

/**
 * The open ground jury matters as Swedish lines. `equipages`: [{ startNumber,
 * className, driverName, vetStrikePending }]; `incidents`: the incident log.
 * Narrowed to one start number (`startNumber`) or to the equipages of some
 * classes (`classNames`); neither: the whole competition. An open protest
 * names a start number to count for an equipage or a class; one without a
 * start number counts for the whole competition only.
 */
export function findOpenJuryMatters({ equipages = [], incidents = [], startNumber = null, classNames = null } = {}) {
    const classes = Array.isArray(classNames) ? new Set(classNames.map(String)) : null;
    const scoped = (equipages || []).filter((e) => {
        if (startNumber !== null && startNumber !== undefined) return sameStartNumber(e?.startNumber ?? e?.id, startNumber);
        if (classes) return classes.has(String(e?.className || ''));
        return true;
    });
    const numbers = new Set(scoped.map((e) => String(e?.startNumber ?? e?.id ?? '').trim()).filter(Boolean));
    if (startNumber !== null && startNumber !== undefined) numbers.add(String(startNumber).trim());
    const whole = (startNumber === null || startNumber === undefined) && !classes;
    const lines = [];
    scoped.forEach((e) => {
        const pending = e?.vetStrikePending;
        if (!pending || typeof pending !== 'object') return;
        const sn = String(e.startNumber ?? e.id ?? '');
        const who = [`#${sn}`, String(e.driverName || '').trim()].filter(Boolean).join(' ');
        lines.push(`${who}: veterinärens beslut (${PHASE_LABELS_SV[pending.phase] || 'veterinärbesiktningen'}) väntar på domarkollegiets beslut.`);
    });
    (incidents || []).forEach((incident) => {
        if (incident?.type !== 'protest' || incident?.status !== 'open') return;
        const sn = String(incident.startNumber || '').trim();
        if (sn ? !numbers.has(sn) && !whole : !whole) return;
        lines.push(`Öppen protest nr ${incident.number ?? '?'}${sn ? ` (#${sn})` : ''} är inte avgjord.`);
    });
    return lines;
}

/** Whether the typed confirmation is the override word (case and spaces ignored) */
export function isJuryOverrideConfirmed(typed) {
    return String(typed || '').trim().toLocaleUpperCase('sv-SE') === JURY_OVERRIDE_WORD;
}

/** The text shown when open jury matters block (Swedish UI text) */
export function juryBlockMessage(what, matters = [], { canOverride = false } = {}) {
    const head = `${what} kan inte göras medan domarkollegiet har öppna ärenden:\n\n- ${matters.join('\n- ')}\n\nAvgör dem i händelseloggen först.`;
    return canOverride
        ? `${head}\n\nSom administratör kan du göra det ändå: skriv ${JURY_OVERRIDE_WORD} för att fortsätta.`
        : head;
}