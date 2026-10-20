// Pure helpers of the precision input page for the round formats (two phases,
// drive-off): which round to show, the labels, the drive-off start list and the
// "qualified" summary. No Firestore, no DOM.

import { PRECISION_ROUNDS, readPrecisionRound } from '../../utils/precisionRounds.js';
import { buildPrecisionMergeState, resolvePrecisionMergeGrouping } from './precisionResultMerge.js';

/** i18n key of a round's tab label ("Fas 1" / "GrundomgÃ¥ng" for the first round of a drive-off class) */
export function precisionRoundLabelKey(round, format) {
    if (round === 'phase2') return 'precision_round_phase2';
    if (round === 'driveOff') return 'precision_round_driveoff';
    return format === 'driveOff' ? 'precision_round_initial' : 'precision_round_phase1';
}

/**
 * The round the page shows for a stored doc: a round whose clock runs wins
 * (the top level stays "not running" during phase 2 / drive-off), else the
 * current one when the class has it, else phase 1.
 */
export function pickPrecisionRound(doc, rounds = ['phase1'], current = 'phase1') {
    const list = rounds.filter((r) => PRECISION_ROUNDS.includes(r));
    for (const r of ['driveOff', 'phase2']) {
        if (list.includes(r) && readPrecisionRound(doc, r).running === true) return r;
    }
    if (list.includes(current)) return current;
    return 'phase1';
}

// Start order of the initial round: start time, then start number (as the page's list)
function startOrderCompare(startTimes) {
    return (a, b) => {
        const ta = startTimes?.[a.startNumber]?.precision || '99:99';
        const tb = startTimes?.[b.startNumber]?.precision || '99:99';
        if (ta !== tb) return ta.localeCompare(tb);
        return (Number(a.startNumber) || 0) - (Number(b.startNumber) || 0);
    };
}

/**
 * The equipages that drive the drive-off: the qualifiers of every placing group
 * (precisionGroupContext(...).groups), in initial-round start order (FEI 977.4.1).
 */
export function driveOffStartList(equipages, groups, startTimes = {}) {
    const qualifiers = new Set();
    for (const ctx of (groups instanceof Map ? groups.values() : [])) {
        if (!ctx?.driveOffNeeded) continue;
        ctx.driveOffQualifiers?.forEach((sn) => qualifiers.add(String(sn)));
    }
    return (equipages || [])
        .filter((e) => qualifiers.has(String(e.startNumber)))
        .sort(startOrderCompare(startTimes));
}

/**
 * Who is qualified, for the "Kvalificerade" panel.
 *   phase2:   [{ startNumber, driverName, className, state }] state 'live' | 'done' | 'waiting'
 *   driveOff: [{ key, complete, members: [{ startNumber, driverName, className, state }] }]
 * resultOf(row) is the row's calculatePrecisionResult; groups is
 * precisionGroupContext(...).groups.
 */
export function buildQualifiedSummary(rows, resultOf, groups, startTimes = {}) {
    const roundState = (round) => {
        if (round?.live) return 'live';
        if (round?.decided) return 'done';
        return 'waiting';
    };
    const phase2 = [];
    const byStart = new Map();
    (rows || []).forEach((row) => {
        byStart.set(String(row.startNumber), row);
        const result = resultOf(row);
        if (result?.phase2Qualified === true) {
            phase2.push({
                startNumber: row.startNumber,
                driverName: row.driverName || '',
                className: row.className || '',
                state: roundState(result.rounds?.phase2)
            });
        }
    });
    phase2.sort(startOrderCompare(startTimes));

    const driveOff = [];
    for (const ctx of (groups instanceof Map ? groups.values() : [])) {
        if (!ctx?.driveOffNeeded) continue;
        const members = [...ctx.driveOffQualifiers]
            .map((sn) => byStart.get(String(sn)))
            .filter(Boolean)
            .sort(startOrderCompare(startTimes))
            .map((row) => ({
                startNumber: row.startNumber,
                driverName: row.driverName || '',
                className: row.className || '',
                state: roundState(resultOf(row)?.rounds?.driveOff)
            }));
        driveOff.push({ key: ctx.key, complete: ctx.driveOffComplete === true, members });
    }
    return { phase2, driveOff };
}

/**
 * Whether a correction of a stored doc changes who qualified for phase 2
 * (secretariat warning): before/after are calculatePrecisionResult outputs.
 * Returns null, or { before, after, hasPhase2Data }.
 */
export function phase2QualificationChange(before, after) {
    if (before?.precisionFormat !== 'twoPhase' && after?.precisionFormat !== 'twoPhase') return null;
    const b = before?.phase2Qualified === true;
    const a = after?.phase2Qualified === true;
    if (a === b) return null;
    return { before: b, after: a, hasPhase2Data: (before?.rounds?.phase2?.hasData === true) || (after?.rounds?.phase2?.hasData === true) };
}

/** i18n key of a formatWarnings / group warning / start refusal code */
export function precisionWarningKey(code) {
    return `precision_warn_${code}`;
}

/**
 * The placing group of an equipage, as on the results page: a merged class
 * group (TDB class numbers merged in the competition's merge config) or the class.
 * mergeSource is mergeConfigService.loadMergeSource's result.
 */
export function precisionGroupKeyFn(mergeSource) {
    const map = buildPrecisionMergeState(mergeSource).map;
    return (equipage) => resolvePrecisionMergeGrouping(equipage, map).key;
}
