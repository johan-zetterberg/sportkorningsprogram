// Pure display helpers for the precision rounds (two phases, drive-off): which
// round columns a class has, how a round's result is shown, placing-tier
// separators, banners. No DOM and no Firestore: the pages and the PDF use them
// and node tests cover them. Texts come through t() (pass `tr` in tests).

import { t } from '../../utils/i18n.js';
import { computePrecisionRoundMaxSec, getPrecisionFormat, isPrecisionDriveOffScheduled } from '../../utils/precisionCalculation.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Formats a number of seconds as "65,00 s" (two decimals, comma) */
export function formatPrecisionSeconds(sec) {
  return isNum(sec) ? `${sec.toFixed(2).replace('.', ',')} s` : '—';
}

/** Formats penalty points as "3.00 p" */
export function formatPrecisionPoints(points) {
  return isNum(points) ? `${points.toFixed(2)} p` : '—';
}

/** Whether a precision format has more rounds than one (two phases, drive-off) */
export function isMultiRoundPrecisionFormat(format) {
  return format === 'twoPhase' || format === 'driveOff';
}

/**
 * The rounds a result shows as columns: Fas 1 + Fas 2 (+ Omkörning when
 * scheduled) for two phases, Grundomgång + Omkörning for a drive-off class,
 * only phase 1 for the rest. Entries { round, labelKey }.
 */
export function precisionRoundColumns(format, { driveOffScheduled = false } = {}) {
  if (format === 'twoPhase') {
    const list = [
      { round: 'phase1', labelKey: 'precision_round_phase1' },
      { round: 'phase2', labelKey: 'precision_round_phase2' }
    ];
    if (driveOffScheduled) list.push({ round: 'driveOff', labelKey: 'precision_round_driveoff' });
    return list;
  }
  if (format === 'driveOff') {
    const list = [{ round: 'phase1', labelKey: 'precision_round_initial' }];
    if (driveOffScheduled) list.push({ round: 'driveOff', labelKey: 'precision_round_driveoff' });
    return list;
  }
  return [{ round: 'phase1', labelKey: 'precision_round_phase1' }];
}

/** The round's name for a class of this format ("Fas 2", "Omkörning", "Grundomgång") */
export function precisionRoundLabel(round, format = 'normal', tr = t) {
  if (round === 'phase2') return tr('precision_round_phase2');
  if (round === 'driveOff') return tr('precision_round_driveoff');
  return tr(format === 'driveOff' ? 'precision_round_initial' : 'precision_round_phase1');
}

/** The round whose clock runs in a precision doc: 'phase1' (top level), 'phase2', 'driveOff', else null */
export function runningPrecisionRound(doc) {
  if (!doc) return null;
  if (doc.running === true) return 'phase1';
  if (doc.rounds?.phase2?.running === true) return 'phase2';
  if (doc.rounds?.driveOff?.running === true) return 'driveOff';
  return null;
}

/**
 * The round a live view follows: the running round, else doc.activeRound while
 * a round is in progress, else 'phase1'.
 */
export function currentPrecisionRound(doc) {
  const running = runningPrecisionRound(doc);
  if (running) return running;
  const active = doc?.activeRound;
  if (active === 'phase2' || active === 'driveOff') return active;
  return 'phase1';
}

/** The last round with data (drive-off, then phase 2, else phase 1): the one a "latest results" list shows */
export function latestPrecisionRoundWithData(result) {
  const rounds = result?.rounds;
  if (rounds?.driveOff?.hasData) return 'driveOff';
  if (rounds?.phase2?.hasData) return 'phase2';
  return 'phase1';
}

/**
 * One round's cell: { text, sub, tone, title }. `r` is result.rounds[round]
 * from calculatePrecisionResult (or null: the class has no such round).
 * Time-scored rounds show seconds ("65,00 s", the penalty seconds as sub),
 * fault rounds penalty points with the round's time as sub.
 * tone: 'none' | 'live' | 'elim' | 'ok' | 'warn'
 */
export function formatPrecisionRoundCell(r, { tr = t } = {}) {
  if (!r) return { text: '–', sub: '', tone: 'none', title: '' };
  if (r.configMissing === true && !r.live) {
    return { text: '–', sub: '', tone: 'warn', title: tr('precision_round_config_missing') };
  }
  if (r.live) {
    const score = isNum(r.totalPenalty)
      ? (r.scoring === 'time' ? formatPrecisionSeconds(r.totalPenalty) : formatPrecisionPoints(r.totalPenalty))
      : '';
    return { text: tr('precision_round_live'), sub: score, tone: 'live', title: '' };
  }
  if (r.out) {
    return { text: r.eliminated ? 'ELIM' : tr('precision_round_retired'), sub: '', tone: 'elim', title: '' };
  }
  if (r.hasData && isNum(r.totalPenalty)) {
    if (r.scoring === 'time') {
      const sub = isNum(r.penaltySec) && r.penaltySec > 0
        ? `${formatPrecisionSeconds(r.penaltySec)} ${tr('precision_round_penalty_word')}`
        : '';
      return { text: formatPrecisionSeconds(r.totalPenalty), sub, tone: 'ok', title: '' };
    }
    return {
      text: formatPrecisionPoints(r.totalPenalty),
      sub: isNum(r.timeMs) && r.timeMs > 0 ? formatPrecisionSeconds(r.timeMs / 1000) : '',
      tone: 'ok',
      title: ''
    };
  }
  return { text: '–', sub: '', tone: 'none', title: '' };
}

/** A cell as one plain string (CSV, PDF): "text" or "text\nsub" */
export function precisionRoundCellPlain(cell, { sep = ' ' } = {}) {
  if (!cell) return '–';
  return cell.sub ? `${cell.text}${sep}${cell.sub}` : cell.text;
}

/** A place for display: "3", provisional "(1)", none "–" */
export function formatPrecisionPlace(place, provisional = false) {
  if (!isNum(place) || place <= 0) return '–';
  return provisional ? `(${place})` : String(place);
}

/**
 * i18n key of the separator before a placing tier (precisionRankKey tiers:
 * 0 drive-off, 1 drive-off out, 2 phase 2, 3 phase 2 out, 4 phase 1 only),
 * null for a class of one round or an unplaced row.
 */
export function precisionTierSeparatorKey(tier, format) {
  if (!isMultiRoundPrecisionFormat(format) || tier == null) return null;
  if (tier === 0) return 'precision_tier_driveoff';
  if (tier === 1) return 'precision_tier_driveoff_out';
  if (format === 'twoPhase') {
    if (tier === 2) return 'precision_tier_phase2';
    if (tier === 3) return 'precision_tier_phase2_out';
    return 'precision_tier_phase1_only';
  }
  return tier === 4 ? 'precision_tier_initial' : null;
}

/**
 * Items in rank order with a separator key on the first item of each new
 * placing tier: [{ item, separatorKey }]. tierOf(item) and formatOf(item) give
 * the tier and the class format; unplaced items (tier null) get none.
 */
export function precisionTierSeparators(items = [], { tierOf, formatOf }) {
  let lastKey = null;
  return items.map((item) => {
    const key = precisionTierSeparatorKey(tierOf(item), formatOf(item));
    const separatorKey = key && key !== lastKey ? key : null;
    if (key) lastKey = key;
    return { item, separatorKey };
  });
}

const FORMAT_WARNING_KEYS = {
  trDriveOffVariant: 'precision_warn_trdriveoffvariant',
  phase2Ignored: 'precision_warn_phase2ignored',
  phase2ConfigMissing: 'precision_warn_phase2configmissing',
  driveOffConfigMissing: 'precision_warn_driveoffconfigmissing',
  driveOffIgnored: 'precision_warn_driveoffignored'
};

/**
 * Banner items for the result list and the PDF. rows: one per equipage
 * { label (class or merged class), startNumber, ctx (precisionGroupContext
 * contextOf(row), may be null), formatWarnings (engine codes) }.
 * Returns [{ kind: 'pending' | 'warning', label, code, text, startNumbers }]:
 * pending first (drive-off still to be driven in the group), then warnings,
 * one per class and code with the start numbers it concerns.
 */
export function buildPrecisionBannerItems(rows = [], { tr = t } = {}) {
  const pending = new Map();
  const warnings = new Map();
  const addWarning = (label, code, startNumber) => {
    if (!FORMAT_WARNING_KEYS[code]) return;
    const key = `${label}|${code}`;
    if (!warnings.has(key)) warnings.set(key, { kind: 'warning', label, code, text: tr(FORMAT_WARNING_KEYS[code]), startNumbers: new Set() });
    if (startNumber != null && startNumber !== '') warnings.get(key).startNumbers.add(String(startNumber));
  };
  for (const row of rows) {
    const label = row.label || '';
    if (row.ctx?.driveOffPending && !pending.has(label)) {
      pending.set(label, { kind: 'pending', label, code: 'driveOffPending', text: tr('precision_provisional_banner'), startNumbers: new Set() });
    }
    for (const code of row.formatWarnings || []) {
      // Class-wide codes carry no start number; the phase-2 ones belong to one equipage
      addWarning(label, code, code === 'phase2Ignored' ? row.startNumber : null);
    }
    for (const w of row.ctx?.warnings || []) {
      if (w.code === 'driveOffIgnored') addWarning(label, w.code, w.startNumber);
    }
  }
  const sortNumbers = (set) => [...set].sort((a, b) => (Number(a) || 0) - (Number(b) || 0));
  return [...pending.values(), ...warnings.values()].map((item) => ({ ...item, startNumbers: sortNumbers(item.startNumbers) }));
}

/** "#12, #14" for a banner item's start numbers ('' when none) */
export function bannerStartNumbersLabel(item) {
  return item?.startNumbers?.length ? ` (${item.startNumbers.map((n) => `#${n}`).join(', ')})` : '';
}

/**
 * The placing score of a result for a short display (monitor, speaker): the
 * phase-2 score when the equipage is placed on phase 2, else phase 1's total.
 * { text, round, timeMs }
 */
export function precisionPlacingScore(result) {
  const placing = result?.placing;
  const p2 = result?.rounds?.phase2;
  if (placing?.stage === 'phase2' && p2 && isNum(p2.totalPenalty)) {
    return { text: p2.scoring === 'time' ? formatPrecisionSeconds(p2.totalPenalty) : formatPrecisionPoints(p2.totalPenalty), round: 'phase2', timeMs: isNum(p2.timeMs) ? p2.timeMs : null };
  }
  const total = result?.totalPenalty;
  return { text: isNum(total) ? formatPrecisionPoints(total) : '—', round: 'phase1', timeMs: isNum(result?.timeMs) ? result.timeMs : null };
}

/**
 * Obstacle-count warnings of a two-phase class (TR 529.2: phase 1 at most 16,
 * phase 2 8-10, together at most 24; FEI 979.3.1: 14-16, 7-9, together at
 * most 23) and the drive-off course (FEI 977.2.1: at most 50 % shorter).
 * Pure: counts and lengths in, codes out. Entries
 * { code: 'phase1' | 'phase2' | 'total' | 'driveOffShort', n, min, max, rule }.
 */
export function precisionCourseWarnings({
  profile = 'TR',
  format = 'normal',
  phase1Count = 0,
  phase2Count = 0,
  trackLength = null,
  driveOffLength = null,
  driveOffScheduled = false
} = {}) {
  const warnings = [];
  const fei = profile === 'FEI';
  if (format === 'twoPhase') {
    const rule = fei ? 'FEI 979.3.1' : 'TR 529.2';
    const p1 = fei ? { min: 14, max: 16 } : { min: null, max: 16 };
    const p2 = fei ? { min: 7, max: 9 } : { min: 8, max: 10 };
    const total = fei ? 23 : 24;
    if (phase1Count > 0 && ((p1.min != null && phase1Count < p1.min) || phase1Count > p1.max)) {
      warnings.push({ code: 'phase1', n: phase1Count, ...p1, rule });
    }
    if (phase2Count > 0 && (phase2Count < p2.min || phase2Count > p2.max)) {
      warnings.push({ code: 'phase2', n: phase2Count, ...p2, rule });
    }
    if (phase1Count + phase2Count > total) {
      warnings.push({ code: 'total', n: phase1Count + phase2Count, min: null, max: total, rule });
    }
  }
  if ((driveOffScheduled || format === 'driveOff') && isNum(trackLength) && trackLength > 0
    && isNum(driveOffLength) && driveOffLength > 0 && driveOffLength < trackLength * 0.5 - 1e-9) {
    warnings.push({ code: 'driveOffShort', n: driveOffLength, min: null, max: null, rule: 'FEI 977.2.1' });
  }
  return warnings;
}

/**
 * Classes whose phase 2 / drive-off cannot get a max time (no length or tempo):
 * Map className -> Set of texts, as precisionSettingsIssues does for phase 1.
 * profileOf(equipage) gives 'TR' | 'FEI' (default: from the class name).
 */
export function precisionRoundSettingsIssues(equipages = [], config = null, { tr = t, profileOf = null } = {}) {
  const issues = new Map();
  if (!config) return issues;
  const add = (className, text) => {
    if (!issues.has(className)) issues.set(className, new Set());
    issues.get(className).add(text);
  };
  (equipages || []).forEach((eq) => {
    if (String(eq?.status || '').toLowerCase().includes('struken')) return;
    const className = String(eq?.className || '').trim();
    if (!className) return;
    const format = getPrecisionFormat(eq, config);
    if (!isMultiRoundPrecisionFormat(format)) return;
    const ruleProfile = profileOf ? profileOf(eq) : null;
    if (format === 'twoPhase' && !(computePrecisionRoundMaxSec(eq, config, 'phase2', { ruleProfile }) > 0)) {
      add(className, tr('precision_warn_phase2configmissing'));
    }
    if (isPrecisionDriveOffScheduled(eq, config) && !(computePrecisionRoundMaxSec(eq, config, 'driveOff', { ruleProfile }) > 0)) {
      add(className, tr('precision_warn_driveoffconfigmissing'));
    }
  });
  return issues;
}