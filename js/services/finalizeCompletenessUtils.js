// What should have come in before a result is finalized, compared with what
// did: every obstacle of the class's course, both stage times and the
// observer's log (marathon), a precision result with a time, and a dressage
// protocol from each judge assigned to the class. Finalizing locks the result,
// so late writes from the field are refused after it; the gaps are shown to
// the secretariat first. Pure (no Firestore), see finalizationService.

import { getClassCourse, stageStartTS, stageStopTS } from '../core-engine/marathon.js';
import { getClassJudgeAssignments } from '../core-engine/dressage.js';
import { mergeObstacleSources } from './secretariatPatchUtils.js';

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

/** Precision gaps for one equipage (`result` is precision/{sn}) */
export function findPrecisionGaps({ equipage = {}, result = null } = {}) {
    if (isWithdrawn(equipage)) return [];
    if (!result) return ['Inget precisionsresultat har kommit in.'];
    if (result.eliminated === true || result.disqualified === true) return [];
    const gaps = [];
    if (!(Number(result.timeMs) > 0)) gaps.push('Tid saknas i precisionsresultatet.');
    if (result.totalPenalty === null || result.totalPenalty === undefined) gaps.push('Totalt straff saknas (kontrollera klassens maxtid).');
    return gaps;
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
