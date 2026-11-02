// Result lists of arena driving (precision format 'arena', utils/arenaRules.js):
// a time competition, every penalty in seconds. One section per class (or
// merged group) and competition (1, and 2 for a World Cup style class), in
// place order, with the drive-off column and the start orders.
//
// buildArenaSections is pure (rows + results in, plain objects out); the
// *Html builders turn sections into markup for the page. Texts through t().

import { t } from '../../utils/i18n.js';
import { escapeHtml, msToLabel } from '../../utils/sharedUtils.js';
import { formatArenaKnocks } from '../../utils/arenaRules.js';
import { getPrecisionFormat } from '../../utils/precisionCalculation.js';
import {
  arenaCompetition2StartOrder,
  assignPlaces,
  comparePrecisionRank,
  precisionGroupContext
} from '../../core-engine/ranking.js';
import { formatPrecisionPlace } from './precisionRoundsDisplay.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Seconds as the lists show them: "88,23" */
export function formatArenaSeconds(sec) {
  return isNum(sec) ? sec.toFixed(2).replace('.', ',') : '—';
}

/** Whether the class of this equipage is an arena class */
export function isArenaEquipage(equipage, config = {}) {
  return getPrecisionFormat(equipage, config || {}) === 'arena';
}

/** Splits rows into { arena, other } by their class's format */
export function splitArenaEquipages(equipages = [], config = {}) {
  const arena = [];
  const other = [];
  (equipages || []).forEach((eq) => (isArenaEquipage(eq, config) ? arena : other).push(eq));
  return { arena, other };
}

const defaultGroupOf = (r) => r._mergedKey || `CLASS:${r.className || '—'}`;
const defaultLabelOf = (r) => r._mergedLabel || r.className || '—';

// Key of the explanatory note under a section heading, null without drive-off
function driveOffNoteKey(open, timing) {
  if (open !== 'top3' && open !== 'all') return null;
  return `arena_result_note_${open}_${timing === 'added' ? 'added' : 'zero'}`;
}

function driveOffCell(row, ctx, driveOff) {
  if (!ctx?.driveOffQualifiers?.has(String(row.startNumber))) return null;
  if (driveOff?.live) return { text: t('precision_round_live'), tone: 'live' };
  if (driveOff?.out) {
    return { text: driveOff.retired ? t('precision_round_retired') : t('eliminated'), tone: 'elim' };
  }
  if (driveOff?.finished && isNum(driveOff.score)) return { text: formatArenaSeconds(driveOff.score), tone: 'ok' };
  return { text: '–', tone: 'none' };
}

function knocksText(first) {
  const list = Array.isArray(first?.knocks) ? first.knocks : [];
  if (list.length) return formatArenaKnocks(list);
  return first?.knocksCount > 0 ? String(first.knocksCount) : '';
}

/**
 * The arena standings of rows (the whole competing field of arena classes).
 *
 * @param {Array} rows - equipages ({ startNumber, driverName, className, _mergedKey, _mergedLabel })
 * @param {(row) => object} resultOf - calculatePrecisionResult of the row
 * @param {object} [opts]
 * @param {(row) => string} [opts.groupOf] - placing group, default the page's
 * @param {(row) => string} [opts.labelOf] - group label
 * @param {Set<string>} [opts.visible] - start numbers to show (a search or
 *        filter changes what is shown, never the places)
 * @returns {Array<object>} sections { key, label, competition, competitions,
 *   open, timing, noteKey, entries, outEntries, empty, driveOffOrder,
 *   startOrder (competition 2: all rows in start order) }
 */
export function buildArenaSections(rows = [], resultOf = (row) => row, opts = {}) {
  const { groupOf = defaultGroupOf, labelOf = defaultLabelOf, visible = null } = opts;
  const results = new Map();
  const result = (row) => {
    if (!results.has(row)) results.set(row, resultOf(row));
    return results.get(row);
  };
  const groups = new Map();
  for (const row of rows || []) {
    if (result(row)?.precisionFormat !== 'arena') continue;
    const key = String(groupOf(row) ?? '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const sections = [];
  for (const [key, groupRows] of groups) {
    const label = labelOf(groupRows[0]);
    const settings = result(groupRows[0]).arena?.settings || {};
    const competitions = settings.competitions === 2 ? 2 : 1;
    const bySn = new Map(groupRows.map((r) => [String(r.startNumber), r]));
    const startOrderSns = competitions === 2
      ? (arenaCompetition2StartOrder(groupRows, result, () => key).get(key) || [])
      : [];
    const comp1Started = groupRows.some((r) => result(r).rounds?.phase1?.hasData);

    for (let competition = 1; competition <= competitions; competition += 1) {
      const firstKey = competition === 1 ? 'phase1' : 'phase2';
      const driveOffKey = competition === 1 ? 'driveOff' : 'driveOff2';
      const open = (competition === 1 ? settings.driveOff1 : settings.driveOff2) || 'none';
      const timing = (competition === 1 ? settings.driveOff1Timing : settings.driveOff2Timing) || 'fromZero';

      const ctx = precisionGroupContext(groupRows, result, () => key, { requireFinished: true, competition });
      const groupCtx = ctx.groups.get(key) || null;
      const { ranked, placeOf } = assignPlaces(groupRows, {
        key: (r) => ctx.rankKey(r),
        compare: comparePrecisionRank,
        group: () => key,
        outField: null
      });

      const toEntry = (row) => {
        const res = result(row);
        const first = res.rounds?.[firstKey] || null;
        const driveOff = res.rounds?.[driveOffKey] || null;
        const sn = String(row.startNumber);
        const place = placeOf.get(row) ?? null;
        const provisional = place != null && ctx.isProvisional(row);
        let state = 'wait';
        if (first?.out) state = 'out';
        else if (first?.live) state = 'live';
        else if (place != null) state = 'placed';
        return {
          row,
          sn,
          name: row.driverName || '',
          state,
          place,
          provisional,
          placeLabel: place != null ? formatPrecisionPlace(place, provisional) : '',
          hasData: first?.hasData === true || first?.live === true,
          timeMs: isNum(first?.timeMs) && first.timeMs > 0 ? first.timeMs : null,
          timeLabel: isNum(first?.timeMs) && first.timeMs > 0 ? msToLabel(first.timeMs) : '',
          knocks: knocksText(first),
          penaltySec: first?.hasData && isNum(first?.penaltySec) ? first.penaltySec : null,
          score: isNum(first?.score) && (first?.finished || first?.live) ? first.score : null,
          outText: state === 'out' ? (first.retired ? t('precision_round_retired') : t('eliminated')) : '',
          driveOff: open !== 'none' ? driveOffCell(row, groupCtx, driveOff) : null
        };
      };

      const visibleOk = (r) => !visible || visible.has(String(r.startNumber));
      const bySnNum = (a, b) => (Number(a.sn) || 0) - (Number(b.sn) || 0);
      const all = groupRows.map(toEntry);
      const placed = ranked.map((r) => all.find((e) => e.row === r)).filter(Boolean);
      const live = all.filter((e) => e.state === 'live').sort(bySnNum);
      // Competition 2: rows not yet driven are in the start order instead
      const wait = all.filter((e) => e.state === 'wait' && (competition === 1 || e.hasData)).sort(bySnNum);
      const outEntries = all.filter((e) => e.state === 'out').sort(bySnNum);
      const entries = [...placed, ...live, ...wait];

      const shownEntries = entries.filter((e) => visibleOk(e.row));
      const shownOut = outEntries.filter((e) => visibleOk(e.row));
      const startOrder = competition === 2 && comp1Started
        ? startOrderSns.map((sn) => bySn.get(sn)).filter(Boolean).map((r) => ({ sn: String(r.startNumber), name: r.driverName || '' }))
        : null;
      const pendingOrder = groupCtx?.driveOffPending
        ? (groupCtx.qualifierStartNumbers || []).map((sn) => bySn.get(String(sn))).filter(Boolean)
          .map((r) => ({ sn: String(r.startNumber), name: r.driverName || '' }))
        : [];
      const anyShown = shownEntries.length + shownOut.length > 0;
      // A section with nothing to show (filter hides the group) is left out
      if (!anyShown && !(startOrder && groupRows.some(visibleOk))) continue;
      sections.push({
        key: `${key}|${competition}`,
        groupKey: key,
        label,
        competition,
        competitions,
        open,
        timing,
        noteKey: driveOffNoteKey(open, timing),
        entries: shownEntries,
        outEntries: shownOut,
        // Competition 2 not driven by anyone yet: only the start order
        empty: competition === 2 && !entries.some((e) => e.hasData) && outEntries.length === 0,
        driveOffOrder: pendingOrder,
        startOrder
      });
    }
  }
  return sections.sort((a, b) => a.label.localeCompare(b.label, 'sv', { numeric: true, sensitivity: 'base' })
    || a.competition - b.competition);
}

// ---------- HTML ----------

/** "Fyrspann Arena - Tävling 2" (without the competition part with one competition) */
export function arenaSectionTitle(section) {
  return section.competitions === 2
    ? `${section.label} – ${t(section.competition === 1 ? 'arena_input_round_c1' : 'arena_input_round_c2')}`
    : section.label;
}

function driveOffHead(section) {
  if (section.competitions === 2) return t(section.competition === 1 ? 'arena_input_round_do1' : 'arena_input_round_do2');
  return t('arena_input_round_do');
}

const nameChips = (list) => list
  .map((e) => `<li class="arena-chip"><span class="arena-chip-no">${escapeHtml(e.sn)}</span> ${escapeHtml(e.name)}</li>`)
  .join('');

/** Heading, drive-off note and start orders of a section (shared by phone and desktop) */
export function arenaSectionIntroHtml(section) {
  const parts = [`<h3 class="arena-title">${escapeHtml(arenaSectionTitle(section))}</h3>`];
  if (section.noteKey) parts.push(`<p class="arena-note">${escapeHtml(t(section.noteKey))}</p>`);
  if (section.startOrder && section.startOrder.length) {
    parts.push(`<div class="arena-order"><strong>${escapeHtml(t('arena_result_start_order_c2'))}</strong><ol>${nameChips(section.startOrder)}</ol></div>`);
  }
  if (section.driveOffOrder.length) {
    parts.push(`<div class="arena-order"><strong>${escapeHtml(t('arena_result_start_order_driveoff'))}</strong><ol>${nameChips(section.driveOffOrder)}</ol></div>`);
  }
  return parts.join('');
}

function cellHtml(text, tone = '') {
  if (text === '' || text == null || text === '—') return '<span class="arena-muted">—</span>';
  return tone ? `<span class="arena-tone-${tone}">${escapeHtml(String(text))}</span>` : escapeHtml(String(text));
}

// The result cell of an entry: score, "Pågår" while running, "—" before
function resultOf(entry) {
  if (entry.state === 'live') return { text: t('precision_round_live'), sub: isNum(entry.score) ? formatArenaSeconds(entry.score) : '', tone: 'live' };
  if (entry.state === 'out') return { text: entry.outText, sub: '', tone: 'elim' };
  if (isNum(entry.score)) return { text: formatArenaSeconds(entry.score), sub: '', tone: '' };
  return { text: '', sub: '', tone: '' };
}

/** Desktop: heading + table for each section */
export function arenaDesktopHtml(sections = []) {
  return sections.map((section) => {
    const hasDriveOff = section.open !== 'none';
    const head = `<thead><tr>
        <th class="arena-c">${escapeHtml(t('arena_result_col_place'))}</th>
        <th class="arena-c">${escapeHtml(t('arena_result_col_no'))}</th>
        <th>${escapeHtml(t('arena_result_col_driver'))}</th>
        <th class="arena-n">${escapeHtml(t('arena_result_col_time'))}</th>
        <th class="arena-n">${escapeHtml(t('arena_result_col_knocks'))}</th>
        <th class="arena-n">${escapeHtml(t('arena_result_col_penalty'))}</th>
        <th class="arena-n">${escapeHtml(t('arena_result_col_result'))}</th>
        ${hasDriveOff ? `<th class="arena-n">${escapeHtml(driveOffHead(section))}</th>` : ''}
      </tr></thead>`;
    const rowHtml = (e, out = false) => {
      const res = resultOf(e);
      const rowClass = e.state === 'live' ? 'arena-live' : (out ? 'arena-out' : '');
      return `<tr class="${rowClass}" data-sn="${escapeHtml(e.sn)}" tabindex="0">
        <td class="arena-c arena-place">${out ? '—' : cellHtml(e.placeLabel)}</td>
        <td class="arena-c arena-muted-text">${escapeHtml(e.sn)}</td>
        <td class="arena-driver">${escapeHtml(e.name)}${e.row.clubName ? `<span class="arena-sub">${escapeHtml(e.row.clubName)}</span>` : ''}</td>
        <td class="arena-n">${out ? cellHtml('') : cellHtml(e.timeLabel)}</td>
        <td class="arena-n">${out ? cellHtml('') : cellHtml(e.knocks)}</td>
        <td class="arena-n">${out || e.penaltySec == null ? cellHtml('') : cellHtml(formatArenaSeconds(e.penaltySec))}</td>
        <td class="arena-n arena-total">${cellHtml(res.text, res.tone)}${res.sub ? `<span class="arena-sub">${escapeHtml(res.sub)}</span>` : ''}</td>
        ${hasDriveOff ? `<td class="arena-n">${e.driveOff ? cellHtml(e.driveOff.text, e.driveOff.tone) : ''}</td>` : ''}
      </tr>`;
    };
    const span = hasDriveOff ? 8 : 7;
    let body = section.entries.map((e) => rowHtml(e)).join('');
    if (section.outEntries.length) {
      body += `<tr class="arena-group"><td colspan="${span}">${escapeHtml(t('arena_result_eliminated'))}</td></tr>`;
      body += section.outEntries.map((e) => rowHtml(e, true)).join('');
    }
    const table = section.empty
      ? ''
      : `<div class="arena-scroll"><table class="arena-table">${head}<tbody>${body}</tbody></table></div>`;
    return `<section class="arena-section" data-arena-section="${escapeHtml(section.key)}">${arenaSectionIntroHtml(section)}${table}</section>`;
  }).join('');
}

/**
 * Phone: per section the heading/notes, then the page's compact list (one
 * compactResultListHtml call per section). compactList is the function from
 * ui/compactResultList.js, passed in so this module stays free of the DOM.
 */
export function arenaMobileHtml(sections = [], compactList, { density } = {}) {
  return sections.map((section) => {
    const hasDriveOff = section.open !== 'none';
    const item = (e, out = false) => {
      const res = resultOf(e);
      const cell = (text, tone) => (text === '' || text == null ? '<span class="cr-muted">—</span>'
        : (tone ? `<span class="arena-tone-${tone}">${escapeHtml(String(text))}</span>` : escapeHtml(String(text))));
      return {
        startNumber: e.sn,
        place: out ? 'E' : e.placeLabel,
        name: e.name,
        sub: e.row.clubName || '',
        state: e.state === 'live' ? 'live' : (out ? 'elim' : (e.place === 1 && !e.provisional ? 'leader' : '')),
        cells: {
          result: `<span class="cr-total">${cell(res.text, res.tone)}</span>${res.sub ? `<span class="cr-sub">${escapeHtml(res.sub)}</span>` : ''}`,
          driveOff: e.driveOff ? cell(e.driveOff.text, e.driveOff.tone) : '<span class="cr-muted">—</span>',
          time: cell(out ? '' : e.timeLabel),
          knocks: cell(out ? '' : e.knocks),
          penalty: cell(out || e.penaltySec == null ? '' : formatArenaSeconds(e.penaltySec))
        }
      };
    };
    const items = section.entries.map((e) => item(e));
    if (section.outEntries.length) {
      items.push({ type: 'group', label: t('arena_result_eliminated') });
      section.outEntries.forEach((e) => items.push(item(e, true)));
    }
    const columns = [
      { key: 'result', label: t('arena_result_short_result'), title: t('arena_result_col_result') },
      ...(hasDriveOff ? [{ key: 'driveOff', label: t('arena_result_short_driveoff'), title: driveOffHead(section) }] : []),
      { key: 'time', label: t('arena_result_short_time'), title: t('arena_result_col_time'), extra: true },
      { key: 'knocks', label: t('arena_result_short_knocks'), title: t('arena_result_col_knocks'), extra: true },
      { key: 'penalty', label: t('arena_result_short_penalty'), title: t('arena_result_col_penalty'), extra: true }
    ];
    const list = section.empty
      ? ''
      : compactList({
        columns,
        items,
        emptyText: t('search_no_match'),
        scrollKey: `precision-arena-${section.key}`,
        ...(density ? { density } : {})
      });
    return `<section class="arena-section" data-arena-section="${escapeHtml(section.key)}">${arenaSectionIntroHtml(section)}${list}</section>`;
  }).join('');
}
