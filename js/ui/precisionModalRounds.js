// Pure rows for the precision details modal: one per round (Fas 1 / Fas 2 or
// Grundomgång / Omkörning) with time, knocks, rebuilds, penalty and status.
// No DOM, so node tests cover it; texts come through t() (pass `tr` in tests).

import { t } from '../utils/i18n.js';
import {
  formatPrecisionPoints,
  formatPrecisionRoundCell,
  formatPrecisionSeconds,
  isMultiRoundPrecisionFormat,
  precisionRoundCellPlain,
  precisionRoundColumns,
  precisionRoundLabel
} from '../pages/precision/precisionRoundsDisplay.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Rows for the rounds table of a result (calculatePrecisionResult / the row
 * data of getCalculatedRowData). Empty for a class of one round.
 * Row: { round, label, time, knocks, rebuilds, penalty, status, tone, title }
 */
export function buildPrecisionModalRoundRows(result, format, { tr = t } = {}) {
  if (!isMultiRoundPrecisionFormat(format)) return [];
  const columns = precisionRoundColumns(format, { driveOffScheduled: result?.driveOffScheduled === true });
  return columns.map(({ round }) => {
    const r = result?.rounds?.[round] || null;
    const cell = formatPrecisionRoundCell(r, { tr });
    const driven = !!r && (r.hasData || r.live) && !(r.configMissing && !r.live);
    let penalty = '–';
    if (driven && r.scoring === 'time' && isNum(r.penaltySec)) penalty = formatPrecisionSeconds(r.penaltySec);
    else if (driven && isNum(r.totalPenalty) && r.scoring !== 'time') penalty = formatPrecisionPoints(r.totalPenalty);
    return {
      round,
      label: precisionRoundLabel(round, format, tr),
      time: driven && isNum(r.timeMs) && r.timeMs > 0 ? formatPrecisionSeconds(r.timeMs / 1000) : '–',
      knocks: driven ? String(r.knocksCount ?? (Array.isArray(r.knocks) ? r.knocks.length : 0)) : '–',
      rebuilds: driven ? String(r.rebuildCount || 0) : '–',
      penalty,
      status: precisionRoundCellPlain(cell, { sep: ' / ' }),
      tone: cell.tone,
      title: cell.title
    };
  });
}
