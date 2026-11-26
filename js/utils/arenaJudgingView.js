// How an arena class judged without timing (arenaRules.js ARENA_JUDGING) is
// shown: faults as penalty seconds, approval as a status, participation as
// "took part". Pure; read from calculatePrecisionResult.

import { t } from './i18n.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** 'timed' | 'faults' | 'participation' | 'approval' of a precision result ('timed' for anything else) */
export function arenaJudgingOf(result) {
  if (!result || result.precisionFormat !== 'arena') return 'timed';
  const j = result.arenaJudging || result.arena?.settings?.judging;
  return j === 'faults' || j === 'participation' || j === 'approval' ? j : 'timed';
}

/** True for a class without a time (faults, approval or participation) */
export function isUntimedArena(result) {
  return arenaJudgingOf(result) !== 'timed';
}

/** True when the class gets no placings (approval, participation) */
export function isUnplacedArena(result) {
  const j = arenaJudgingOf(result);
  return j === 'approval' || j === 'participation';
}

/** Seconds as "12,00" or '–' */
export function formatFaultSeconds(sec) {
  return isNum(sec) ? sec.toFixed(2).replace('.', ',') : '–';
}

/**
 * Display text of an untimed arena result: faults -> "12,00" (or '–'),
 * approval -> approved / not approved / '–', participation -> "took part"
 * (empty for a struck equipage). '' for a timed result.
 */
export function arenaJudgingCell(result) {
  switch (arenaJudgingOf(result)) {
    case 'faults':
      return formatFaultSeconds(result.score);
    case 'approval':
      if (result.approval === true) return t('arena_result_approved');
      if (result.approval === false) return t('arena_result_not_approved');
      return '–';
    case 'participation':
      return result.status === 'Struken' ? '' : t('arena_result_participated');
    default:
      return '';
  }
}

/** Key of the note under a class heading, null for a timed class */
export function arenaJudgingNoteKey(judging) {
  return judging === 'faults' || judging === 'approval' || judging === 'participation'
    ? `arena_result_note_${judging}`
    : null;
}
