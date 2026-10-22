import { getGlobalState } from '../../main.js';
import { getCompetitionHeader, showAlert, renderNoCompetitionState } from '../../ui/components.js';
import { t } from '../../utils/i18n.js';
import { vetStrikeChipHtml } from '../../ui/vetStrikeChip.js';
import { registerUnsavedWork } from '../../utils/unsavedWork.js';
import {
  confirmFinalizeWithGaps,
  finalizePrecisionDriveOff,
  unfinalizePrecisionDriveOff,
} from '../../services/finalizationService.js';
import { precisionGroupContext } from '../../core-engine/ranking.js';
import { phase2QualificationChange, precisionRoundLabelKey } from '../precision/precisionRoundInput.js';
import { formatKnockList, parseKnockListInput } from '../precision/precisionInputUtils.js';
import { listRejectedWrites } from '../../services/rejectedWritesService.js';
import { createStaffNoticesHost } from '../../ui/staffNoticesPanel.js';
import {
  askCorrectionReason,
  clearRowDirty,
  derivePrecisionStatus,
  escapeHtml,
  filterRows,
  formatEditableTime,
  initializeToolbarInteractions,
  markRowDirty,
  parseEditableTime,
  renderFieldModeBanner,
  renderRejectedWritesPanel,
  renderStatusBadge,
  renderToolbar,
  setupStickyTableHeaders,
} from './secretariat-shared.js';
import {
  loadSecretariatPrecisionRows,
  refinalizeResult,
  saveSecretariatPrecisionRow,
  calculateSecretariatPrecisionDraft,
  unlockResult,
} from '../../services/secretariatService.js';

let rootEl = null;
let competitionId = null;
let rows = [];
let rejectedWrites = [];
// Driver declaration changes and vet strikes for the ground jury (kept across renders)
let noticesHost = null;
// Round shown: phase 1 (the initial round) or the rows of phase 2 / drive-off.
// Each round keeps its own drafts (same start number, different fields).
let currentRound = 'phase1';
const ROUND_KEYS = ['phase1', 'phase2', 'driveOff'];
const newDraftStore = () => ({ phase1: new Map(), phase2: new Map(), driveOff: new Map() });
let draftStore = newDraftStore();
let drafts = draftStore.phase1;
let groupCtx = null; // precisionGroupContext: drive-off qualifiers per class
let teardownStickyHeaders = null;
let filters = {
  search: '',
  status: 'all',
  className: 'all',
};

function autoSizeCommentBox(textarea) {
  if (!textarea) return;
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.max(38, textarea.scrollHeight)}px`;
}

function getClassOptions() {
  return [...new Set(rows.map(row => row.className).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'sv'));
}

// The rows of the round shown: phase 1 = the base rows; phase 2 / drive-off =
// the class's round rows (the drive-off: its qualifiers, and rows that hold
// drive-off data, which is then flagged as not counting)
function roundRows(round = currentRound) {
  if (round === 'phase1') return rows;
  const qualifiers = driveOffQualifierSet();
  return rows
    .filter(row => row.rounds?.[round])
    .map(row => row.rounds[round])
    .filter(row => round !== 'driveOff' || qualifiers.has(String(row.startNumber)) || row.status !== 'not-started' || row.retired);
}

function driveOffQualifierSet() {
  const set = new Set();
  groupCtx?.groups?.forEach(ctx => {
    if (ctx.driveOffNeeded) ctx.driveOffQualifiers.forEach(sn => set.add(String(sn)));
  });
  return set;
}

function availableRounds() {
  return ROUND_KEYS.filter(round => round === 'phase1' || rows.some(row => row.rounds?.[round]));
}

function roundLabel(round) {
  const hasTwoPhase = rows.some(row => row.format === 'twoPhase');
  const hasDriveOff = rows.some(row => row.format === 'driveOff');
  if (round === 'phase1' && hasTwoPhase && hasDriveOff) {
    return `${t('precision_round_phase1')} / ${t('precision_round_initial')}`;
  }
  return t(precisionRoundLabelKey(round, hasDriveOff && !hasTwoPhase ? 'driveOff' : 'twoPhase'));
}

function findRow(sn) {
  return roundRows().find(row => String(row.startNumber) === String(sn));
}

function getVisibleRows() {
  return filterRows(roundRows(), filters);
}

function setRound(round) {
  if (!ROUND_KEYS.includes(round) || round === currentRound) return;
  currentRound = round;
  drafts = draftStore[round];
  render();
}

function draftFor(row) {
  const draft = drafts.get(String(row.startNumber));
  return draft ? { ...row, ...draft, status: derivePrecisionStatus({ ...row, ...draft }) } : row;
}

// Under the knock list: the obstacle penalty it gives ("2 rivn. = 6 p"); a
// legacy result without a list shows its stored penalty
function obstacleSummary(row, view, isDirty) {
  const knocks = Array.isArray(view.knocks) ? view.knocks : [];
  const penalty = isDirty && !view.__invalid
    ? calculateSecretariatPrecisionDraft(row, drafts.get(String(row.startNumber))).obstaclePenalty
    : row.obstaclePenalty;
  const p = Number.isFinite(Number(penalty)) ? Number(penalty) : 0;
  if (!knocks.length && row.legacyObstaclePenalty && !isDirty) return `Lagrat: ${row.legacyObstaclePenalty} p`;
  return knocks.length ? `${knocks.length} rivn. = ${p} ${row.scoring === 'time' || row.round === 'driveOff' ? 's' : 'p'}` : '0 p';
}

function buildTableRows() {
  const visibleRows = getVisibleRows();
  if (visibleRows.length === 0) {
    return `
      <tr>
        <td colspan="12" class="px-4 py-8 text-center text-gray-500 dark:text-gray-400">Inga ekipage matchar filtret.</td>
      </tr>
    `;
  }

  return visibleRows.map(row => {
    const view = draftFor(row);
    const isDirty = drafts.has(String(row.startNumber));
    const readOnly = row.finalized === true;
    const totalPenalty = isDirty && !view.__invalid
      ? (calculateSecretariatPrecisionDraft(row, drafts.get(String(row.startNumber))).totalPenalty ?? 0)
      : (row.totalPenalty ?? 0);
    const isDriveOffRow = row.round === 'driveOff';
    // Time rounds (FEI phase 2, drive-off) count seconds
    const unit = (isDriveOffRow || row.scoring === 'time') ? ' s' : '';
    let roundNote = '';
    if (row.round === 'phase2' && row.engine && row.engine.phase2Qualified !== true) {
      roundNote = t('secretariat_precision_qualification_badge_no');
    } else if (isDriveOffRow && !driveOffQualifierSet().has(String(row.startNumber))) {
      roundNote = t('precision_warn_driveOffIgnored');
    }

    return `
      <tr data-sn="${escapeHtml(row.startNumber)}" class="border-t border-gray-200 dark:border-gray-700 align-top ${isDirty ? 'bg-amber-50/70 dark:bg-amber-900/10' : ''}">
        <td class="px-3 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100 whitespace-nowrap">#${escapeHtml(row.startNumber)}</td>
        <td class="px-3 py-3 text-sm text-gray-900 dark:text-gray-100 min-w-[14rem]">
          <div class="font-medium">${escapeHtml(row.driverName || '-')}</div>
          <div class="text-xs text-gray-500 dark:text-gray-400">${escapeHtml(row.className || '')}</div>
          ${vetStrikeChipHtml(row, { compact: true })}
          ${roundNote ? `<div class="text-xs font-semibold text-amber-700 dark:text-amber-300 whitespace-normal">${escapeHtml(roundNote)}</div>` : ''}
        </td>
        <td class="px-3 py-3 text-sm min-w-[7rem]">
          <input data-field="timeMs" value="${escapeHtml(formatEditableTime(view.timeMs))}" ${readOnly ? 'disabled' : ''} class="secretariat-precision-time-input w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60">
        </td>
        <td class="px-3 py-3 text-sm min-w-[6rem]">
          <input data-field="knocks" type="text" inputmode="text" autocomplete="off" placeholder="–" title="Rivna hinder, t.ex. 3A, 5" value="${escapeHtml(formatKnockList(view.knocks))}" ${readOnly ? 'disabled' : ''} class="secretariat-precision-knocks-input w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60">
          <div data-role="obstacle" class="mt-1 text-xs text-gray-500 dark:text-gray-400">${escapeHtml(obstacleSummary(row, view, isDirty))}</div>
        </td>
        <td class="px-3 py-3 text-sm min-w-[4.1rem]">
          <input data-field="timePenalty" type="number" step="0.1" value="${escapeHtml(view.timePenalty ?? 0)}" ${readOnly ? 'disabled' : ''} class="secretariat-precision-penalty-input w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60">
        </td>
        <td class="px-3 py-3 text-sm min-w-[4.1rem]">
          <input data-field="extraPenalty" type="number" step="0.1" value="${escapeHtml(view.extraPenalty ?? 0)}" ${readOnly ? 'disabled' : ''} class="secretariat-precision-penalty-input w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60">
        </td>
        <td class="px-3 py-3 text-sm min-w-[4.1rem]">
          <input data-field="rebuildCount" type="number" step="1" min="0" title="Ombyggda hinder, +10 s var" value="${escapeHtml(view.rebuildCount ?? 0)}" ${readOnly ? 'disabled' : ''} class="secretariat-precision-penalty-input w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60">
        </td>
        <td data-role="total" class="px-3 py-3 text-sm text-gray-900 dark:text-gray-100 whitespace-nowrap">${escapeHtml(totalPenalty.toFixed(2).replace(/\.00$/, ''))}${unit}</td>
        <td class="px-3 py-3 text-sm text-center">
          <input data-field="eliminated" type="checkbox" ${view.eliminated ? 'checked' : ''} ${readOnly ? 'disabled' : ''} class="h-4 w-4 rounded border-gray-300 text-red-600 disabled:opacity-60">
        </td>
        <td class="px-3 py-3 text-sm min-w-[12rem]">
          <textarea data-field="comment" rows="1" maxlength="1000" ${readOnly ? 'disabled' : ''} class="secretariat-precision-comment w-full resize-none overflow-hidden rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60 leading-5">${escapeHtml(view.comment || '')}</textarea>
        </td>
        <td class="px-3 py-3 text-sm whitespace-nowrap">${renderStatusBadge(view.status, row.finalized)}</td>
        <td class="px-3 py-3 text-sm whitespace-nowrap">
          <div class="secretariat-precision-actions flex flex-col gap-2">
            ${readOnly ? `
              <button data-action="${isDriveOffRow ? 'driveoff-unfinalize' : 'unlock'}" class="rounded bg-amber-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-amber-700">${escapeHtml(isDriveOffRow ? t('secretariat_precision_driveoff_unfinalize') : t('unlock'))}</button>
            ` : `
              <button data-action="save" class="rounded bg-brand-darkblue text-white px-3 py-1.5 text-xs font-semibold hover:opacity-90">Spara</button>
              <button data-action="reset" class="rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">${escapeHtml(t('undo'))}</button>
              <button data-action="${isDriveOffRow ? 'driveoff-finalize' : 'finalize'}" class="rounded border border-emerald-600 text-emerald-700 dark:text-emerald-400 px-3 py-1.5 text-xs font-semibold hover:bg-emerald-50 dark:hover:bg-emerald-900/20">${isDriveOffRow ? escapeHtml(t('secretariat_precision_driveoff_finalize')) : 'Finalisera'}</button>
            `}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Below 640 px (a phone) each equipage is a stacked card with the same fields
// and buttons as the table row; the table stays on wider screens
const phoneQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(max-width: 639px)')
  : null;
function isPhoneLayout() {
  return !!phoneQuery?.matches;
}
let phoneListenerBound = false;

const CARD_INPUT = 'w-full min-h-[44px] rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-base bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60';
const CARD_LABEL = 'block text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1';

function buildCardRows() {
  const visibleRows = getVisibleRows();
  if (visibleRows.length === 0) {
    return `<p class="px-4 py-8 text-center text-gray-500 dark:text-gray-400">Inga ekipage matchar filtret.</p>`;
  }
  return visibleRows.map(row => {
    const view = draftFor(row);
    const isDirty = drafts.has(String(row.startNumber));
    const readOnly = row.finalized === true;
    const totalPenalty = isDirty && !view.__invalid
      ? (calculateSecretariatPrecisionDraft(row, drafts.get(String(row.startNumber))).totalPenalty ?? 0)
      : (row.totalPenalty ?? 0);
    const isDriveOffRow = row.round === 'driveOff';
    const unit = (isDriveOffRow || row.scoring === 'time') ? ' s' : '';
    let roundNote = '';
    if (row.round === 'phase2' && row.engine && row.engine.phase2Qualified !== true) {
      roundNote = t('secretariat_precision_qualification_badge_no');
    } else if (isDriveOffRow && !driveOffQualifierSet().has(String(row.startNumber))) {
      roundNote = t('precision_warn_driveOffIgnored');
    }
    const dis = readOnly ? 'disabled' : '';
    const field = (label, inner) => `<div><label class="${CARD_LABEL}">${escapeHtml(label)}</label>${inner}</div>`;
    return `
      <article data-sn="${escapeHtml(row.startNumber)}" class="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 shadow-sm ${isDirty ? 'bg-amber-50/70 dark:bg-amber-900/10' : ''}">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="text-base font-bold text-gray-900 dark:text-gray-100">#${escapeHtml(row.startNumber)} ${escapeHtml(row.driverName || '-')}</div>
            <div class="text-xs text-gray-500 dark:text-gray-400">${escapeHtml(row.className || '')}</div>
            ${vetStrikeChipHtml(row, { compact: true })}
            ${roundNote ? `<div class="text-xs font-semibold text-amber-700 dark:text-amber-300">${escapeHtml(roundNote)}</div>` : ''}
          </div>
          <div class="shrink-0">${renderStatusBadge(view.status, row.finalized)}</div>
        </div>
        <div class="mt-3 grid grid-cols-2 gap-3">
          ${field(t('sp_time'), `<input data-field="timeMs" value="${escapeHtml(formatEditableTime(view.timeMs))}" inputmode="text" ${dis} class="${CARD_INPUT}">`)}
          ${field(t('sp_knocks'), `<input data-field="knocks" type="text" inputmode="text" autocomplete="off" placeholder="–" value="${escapeHtml(formatKnockList(view.knocks))}" ${dis} class="${CARD_INPUT}"><div data-role="obstacle" class="mt-1 text-xs text-gray-500 dark:text-gray-400">${escapeHtml(obstacleSummary(row, view, isDirty))}</div>`)}
          ${field(t('sp_time_penalty'), `<input data-field="timePenalty" type="number" step="0.1" inputmode="decimal" value="${escapeHtml(view.timePenalty ?? 0)}" ${dis} class="${CARD_INPUT}">`)}
          ${field(t('sp_other'), `<input data-field="extraPenalty" type="number" step="0.1" inputmode="decimal" value="${escapeHtml(view.extraPenalty ?? 0)}" ${dis} class="${CARD_INPUT}">`)}
          ${field(t('sp_rebuild'), `<input data-field="rebuildCount" type="number" step="1" min="0" inputmode="numeric" value="${escapeHtml(view.rebuildCount ?? 0)}" ${dis} class="${CARD_INPUT}">`)}
          ${field(t('sp_total'), `<div data-role="total" class="min-h-[44px] flex items-center text-lg font-bold text-gray-900 dark:text-gray-100">${escapeHtml(totalPenalty.toFixed(2).replace(/\.00$/, ''))}${unit}</div>`)}
        </div>
        <label class="mt-3 flex items-center gap-3 min-h-[44px] text-sm font-semibold text-red-700 dark:text-red-400">
          <input data-field="eliminated" type="checkbox" ${view.eliminated ? 'checked' : ''} ${dis} class="h-6 w-6 rounded border-gray-300 text-red-600 disabled:opacity-60"> ${escapeHtml(t('sp_elim'))}
        </label>
        <div class="mt-2">${field(t('sp_comment'), `<textarea data-field="comment" rows="2" maxlength="1000" ${dis} class="${CARD_INPUT} leading-5">${escapeHtml(view.comment || '')}</textarea>`)}</div>
        <div class="mt-3 grid grid-cols-1 gap-2 ${readOnly ? '' : 'sm:grid-cols-3'}">
          ${readOnly ? `
            <button type="button" data-action="${isDriveOffRow ? 'driveoff-unfinalize' : 'unlock'}" class="min-h-[44px] rounded bg-amber-600 text-white px-3 py-2 text-sm font-semibold hover:bg-amber-700">${escapeHtml(isDriveOffRow ? t('secretariat_precision_driveoff_unfinalize') : t('unlock'))}</button>
          ` : `
            <button type="button" data-action="save" class="min-h-[44px] rounded bg-brand-darkblue text-white px-3 py-2 text-sm font-semibold hover:opacity-90">${escapeHtml(t('sp_save'))}</button>
            <button type="button" data-action="reset" class="min-h-[44px] rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">${escapeHtml(t('undo'))}</button>
            <button type="button" data-action="${isDriveOffRow ? 'driveoff-finalize' : 'finalize'}" class="min-h-[44px] rounded border border-emerald-600 text-emerald-700 dark:text-emerald-400 px-3 py-2 text-sm font-semibold hover:bg-emerald-50 dark:hover:bg-emerald-900/20">${escapeHtml(isDriveOffRow ? t('secretariat_precision_driveoff_finalize') : t('sp_finalize'))}</button>
          `}
        </div>
      </article>`;
  }).join('');
}

function render() {
  if (!rootEl) return;
  if (phoneQuery && !phoneListenerBound) {
    phoneListenerBound = true;
    // Rotating or resizing across the breakpoint swaps cards and table
    const onChange = () => { if (rootEl) render(); };
    if (phoneQuery.addEventListener) phoneQuery.addEventListener('change', onChange);
    else if (phoneQuery.addListener) phoneQuery.addListener(onChange);
  }
  try { teardownStickyHeaders?.(); } catch (_) {}
  teardownStickyHeaders = null;

  const competition = getGlobalState('currentCompetition');
  // The shown round may have gone (rows reloaded without it)
  if (!availableRounds().includes(currentRound)) {
    currentRound = 'phase1';
    drafts = draftStore.phase1;
  }
  const classOptions = getClassOptions();
  const visibleRows = getVisibleRows();

  rootEl.innerHTML = `
    <div class="w-full max-w-7xl mx-auto px-3 py-4 sm:px-4">
      ${getCompetitionHeader(competition, t('secretariat_precision_title'), { quickGuideRole: 'secretariat' })}
      ${renderFieldModeBanner(competition, {
        message: 'Tävlingen körs i fältläge. Registrera tider och straff manuellt här och använd sekretariatet för upplåsning och återfinalisering.',
      })}
      ${renderRejectedWritesPanel(rejectedWrites)}
      ${noticesHost?.placeholder || ''}
      <section class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 mb-4">
        <div class="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100">Korrigering av resultat</h2>
            <p class="text-sm text-gray-600 dark:text-gray-400">Separat sekretariatsvy för ändringar efter ordinarie inmatning.</p>
          </div>
          <div class="text-sm text-gray-500 dark:text-gray-400">${visibleRows.length} av ${roundRows().length} ekipage visas</div>
        </div>
        ${availableRounds().length > 1 ? `
        <div role="tablist" aria-label="${escapeHtml(t('secretariat_precision_round'))}" class="mt-3 flex flex-wrap gap-2">
          ${availableRounds().map(round => `
            <button type="button" role="tab" aria-selected="${round === currentRound}" data-round-tab="${escapeHtml(round)}" class="min-h-[44px] px-4 rounded-lg border text-sm font-bold ${round === currentRound ? 'bg-brand-darkblue border-brand-darkblue text-white' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600'}">${escapeHtml(roundLabel(round))}</button>
          `).join('')}
        </div>` : ''}
      </section>
      ${renderToolbar({
        searchValue: filters.search,
        statusValue: filters.status,
        classValue: filters.className,
        classOptions,
      })}
    ${isPhoneLayout() ? `<section class="space-y-3" data-rows-host data-precision-cards>${buildCardRows()}</section>` : `
    <section class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
      <div class="secretariat-x-wrap">
        <table class="min-w-full secretariat-page-table">
          <thead class="bg-gray-50 dark:bg-gray-900/50">
              <tr class="text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <th class="px-3 py-3">Start</th>
                <th class="px-3 py-3">Ekipage</th>
                <th class="px-3 py-3">Tid</th>
                <th class="px-3 py-3" title="Rivna hinder (hinderstraffet räknas från listan)">Rivningar</th>
                <th class="px-3 py-3">Tidstraff</th>
                <th class="px-3 py-3">Övrigt</th>
                <th class="px-3 py-3" title="Ombyggda hinder, +10 s var">Ombyggn.</th>
                <th class="px-3 py-3">Totalt</th>
                <th class="px-3 py-3">Elim.</th>
                <th class="px-3 py-3">Kommentar</th>
                <th class="px-3 py-3">${escapeHtml(t('status'))}</th>
                <th class="px-3 py-3">Åtgärder</th>
              </tr>
            </thead>
            <tbody data-rows-host>
              ${buildTableRows()}
            </tbody>
        </table>
      </div>
    </section>`}
    </div>
  `;

  noticesHost?.attach(rootEl);
  initializeToolbarInteractions(rootEl);
  wireEvents();
  teardownStickyHeaders = setupStickyTableHeaders(rootEl);
}

function collectPatch(rowEl, baseRow) {
  const timeMs = parseEditableTime(rowEl.querySelector('[data-field="timeMs"]')?.value || '');
  if ((rowEl.querySelector('[data-field="timeMs"]')?.value || '').trim() && timeMs == null) {
    throw new Error('Ogiltigt tidsformat. Använd mm:ss,cc eller sekunder.');
  }

  // The knock list (the obstacle penalty follows from it in the result engine)
  const knocks = parseKnockListInput(rowEl.querySelector('[data-field="knocks"]')?.value || '');
  const timePenalty = Number(rowEl.querySelector('[data-field="timePenalty"]')?.value || 0);
  const extraPenalty = Number(rowEl.querySelector('[data-field="extraPenalty"]')?.value || 0);
  // Editing the time penalty itself makes it a manual override; otherwise
  // the engine calculates it from the time.
  const timePenaltyEdited = Math.abs((Number.isFinite(timePenalty) ? timePenalty : 0) - (baseRow.timePenalty || 0)) > 1e-9;

  return {
    startNumber: baseRow.startNumber,
    driverName: baseRow.driverName,
    className: baseRow.className,
    equipage: baseRow.calcContext?.equipage,
    timeMs: timeMs ?? 0,
    knocks,
    timePenalty: Number.isFinite(timePenalty) ? timePenalty : 0,
    timePenaltyOverride: timePenaltyEdited || baseRow.timePenaltyOverride === true,
    extraPenalty: Number.isFinite(extraPenalty) ? extraPenalty : 0,
    // Obstacle rebuilds (+10 s each), a whole number >= 0
    rebuildCount: Math.max(0, Math.floor(Number(rowEl.querySelector('[data-field="rebuildCount"]')?.value || 0) || 0)),
    eliminated: !!rowEl.querySelector('[data-field="eliminated"]')?.checked,
    comment: rowEl.querySelector('[data-field="comment"]')?.value?.trim() || '',
  };
}

function updateDraft(rowEl) {
  const sn = String(rowEl.dataset.sn);
  const baseRow = findRow(sn);
  if (!baseRow || baseRow.finalized) return;

  try {
    const patch = collectPatch(rowEl, draftBaseFor(sn, baseRow));
    const totalCell = rowEl.querySelector('[data-role="total"]');
    const draftCalc = calculateSecretariatPrecisionDraft(baseRow, patch);
    if (totalCell) {
      const totalPenalty = draftCalc.totalPenalty ?? 0;
      totalCell.textContent = totalPenalty.toFixed(2).replace(/\.00$/, '');
    }
    const obstacleCell = rowEl.querySelector('[data-role="obstacle"]');
    if (obstacleCell) {
      const unit = baseRow.scoring === 'time' || baseRow.round === 'driveOff' ? 's' : 'p';
      obstacleCell.textContent = patch.knocks.length ? `${patch.knocks.length} rivn. = ${draftCalc.obstaclePenalty ?? 0} ${unit}` : '0 p';
    }

    // The row as it was when editing began: kept with the draft, so a reload
    // after another row's save cannot hide what the judge changed meanwhile
    const draftBase = drafts.get(sn)?.__base || baseRow;
    const hasChanges = JSON.stringify({
      timeMs: patch.timeMs,
      knocks: formatKnockList(patch.knocks),
      timePenalty: patch.timePenalty,
      extraPenalty: patch.extraPenalty,
      rebuildCount: patch.rebuildCount,
      eliminated: patch.eliminated,
      comment: patch.comment,
    }) !== JSON.stringify({
      timeMs: draftBase.timeMs || 0,
      knocks: formatKnockList(draftBase.knocks),
      timePenalty: draftBase.timePenalty || 0,
      extraPenalty: draftBase.extraPenalty || 0,
      rebuildCount: draftBase.rebuildCount || 0,
      eliminated: !!draftBase.eliminated,
      comment: draftBase.comment || '',
    });

    if (hasChanges) {
      drafts.set(sn, { ...patch, __base: draftBase });
      markRowDirty(rowEl, true);
    } else {
      drafts.delete(sn);
      clearRowDirty(rowEl);
    }
  } catch {
    drafts.set(sn, { __invalid: true, __base: drafts.get(sn)?.__base || baseRow });
    markRowDirty(rowEl, true);
  }
}

// The row a draft was edited from (the loaded row when there is no draft)
function draftBaseFor(sn, row) {
  return drafts.get(String(sn))?.__base || row;
}

// Reloads the rows. Unsaved edits of other rows are kept (each with the row
// it was edited from); `savedStartNumber` drops the draft just saved
async function refreshData({ savedStartNumber = null, keepDrafts = true } = {}) {
  [rows, rejectedWrites] = await Promise.all([
    loadSecretariatPrecisionRows(competitionId),
    listRejectedWrites(competitionId, { discipline: 'precision' }).catch(() => []),
  ]);
  groupCtx = precisionGroupContext(
    rows,
    row => row.engine,
    row => row.groupKey,
    { requireFinished: true }
  );
  if (!keepDrafts) { draftStore = newDraftStore(); drafts = draftStore[currentRound]; }
  else if (savedStartNumber != null) drafts.delete(String(savedStartNumber));
  render();
}

// A phase-1 correction that changes who qualified for phase 2 (phase 2 then
// counts or stops counting): the secretariat confirms it first
function confirmQualificationChange(editBase, patch) {
  if (currentRound !== 'phase1') return true;
  const change = phase2QualificationChange(editBase.engine, calculateSecretariatPrecisionDraft(editBase, patch));
  if (!change) return true;
  const what = change.after ? t('secretariat_precision_qualification_gained') : t('secretariat_precision_qualification_lost');
  return window.confirm(t('secretariat_precision_qualification_changed').replace('{sn}', String(editBase.startNumber)).replace('{what}', what));
}

async function handleAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const rowEl = button.closest('[data-sn]');
  if (!rowEl) return;

  const sn = rowEl.dataset.sn;
  const baseRow = findRow(sn);
  if (!baseRow) return;

  const action = button.dataset.action;
  const round = currentRound;

  try {
    if (action === 'unlock') {
      await unlockResult(competitionId, 'precision', sn);
      showAlert(`Resultat #${sn} upplåst.`);
      await refreshData({ savedStartNumber: sn });
      return;
    }

    if (action === 'reset') {
      drafts.delete(sn);
      render();
      return;
    }

    const editBase = draftBaseFor(sn, baseRow);

    if (action === 'save') {
      if (drafts.get(sn)?.__invalid) throw new Error('Rätta ogiltiga värden innan du sparar.');
      if (!drafts.has(sn)) return;
      const patch = collectPatch(rowEl, editBase);
      if (!confirmQualificationChange(editBase, patch)) return;
      const correction = await askCorrectionReason({ summary: `Precision #${sn}${round === 'phase1' ? '' : ` (${roundLabel(round)})`}` });
      if (!correction) return;
      await saveSecretariatPrecisionRow(competitionId, sn, patch, correction, { baseRow: editBase, round });
      showAlert(`Ändringar sparade för #${sn}.`);
      await refreshData({ savedStartNumber: sn });
      return;
    }

    if (action === 'finalize') {
      // Only edited fields are saved; without edits finalizing just locks
      if (drafts.get(sn)?.__invalid) throw new Error('Rätta ogiltiga värden innan du finaliserar.');
      if (!(await confirmFinalizeWithGaps(competitionId, 'precision', sn))) return;
      if (drafts.has(sn)) {
        const patch = collectPatch(rowEl, editBase);
        if (!confirmQualificationChange(editBase, patch)) return;
        const correction = await askCorrectionReason({ summary: `Precision #${sn}, före finalisering` });
        if (!correction) return;
        await saveSecretariatPrecisionRow(competitionId, sn, patch, correction, { baseRow: editBase, round });
      }
      await refinalizeResult(competitionId, 'precision', sn);
      showAlert(`Resultat #${sn} finaliserat.`);
      await refreshData({ savedStartNumber: sn });
      return;
    }

    if (action === 'driveoff-finalize') {
      // The drive-off has its own lock: edited fields are saved first, then it is closed
      if (drafts.get(sn)?.__invalid) throw new Error('Rätta ogiltiga värden innan du finaliserar.');
      if (drafts.has(sn)) {
        const patch = collectPatch(rowEl, editBase);
        const correction = await askCorrectionReason({ summary: `Precision #${sn} (${roundLabel(round)}), före finalisering` });
        if (!correction) return;
        await saveSecretariatPrecisionRow(competitionId, sn, patch, correction, { baseRow: editBase, round });
      }
      await finalizePrecisionDriveOff(competitionId, sn);
      showAlert(t('secretariat_precision_driveoff_finalized').replace('{sn}', sn));
      await refreshData({ savedStartNumber: sn });
      return;
    }

    if (action === 'driveoff-unfinalize') {
      await unfinalizePrecisionDriveOff(competitionId, sn);
      showAlert(t('secretariat_precision_driveoff_unfinalized').replace('{sn}', sn));
      await refreshData({ savedStartNumber: sn });
    }
  } catch (error) {
    console.error('Secretariat precision action failed:', error);
    showAlert(error.message || 'Kunde inte genomföra åtgärden.', false);
  }
}

function wireEvents() {
  rootEl.querySelectorAll('[data-round-tab]').forEach(tab => {
    tab.addEventListener('click', () => setRound(tab.dataset.roundTab));
  });

  rootEl.querySelector('#secretariatSearch')?.addEventListener('input', event => {
    const value = event.target.value || '';
    const selStart = event.target.selectionStart ?? value.length;
    const selEnd = event.target.selectionEnd ?? value.length;
    filters.search = value;
    render();
    const searchInput = rootEl.querySelector('#secretariatSearch');
    searchInput?.focus();
    try {
      searchInput?.setSelectionRange(selStart, selEnd);
    } catch (_) { }
  });

  rootEl.querySelector('#secretariatStatusFilter')?.addEventListener('change', event => {
    filters.status = event.target.value || 'all';
    render();
  });

  rootEl.querySelector('#secretariatClassFilter')?.addEventListener('change', event => {
    filters.className = event.target.value || 'all';
    render();
  });

  rootEl.querySelectorAll('[data-rows-host] [data-sn] input').forEach(input => {
    input.addEventListener('input', event => updateDraft(event.target.closest('[data-sn]')));
    input.addEventListener('change', event => updateDraft(event.target.closest('[data-sn]')));
  });

  rootEl.querySelectorAll('[data-rows-host] [data-sn] textarea[data-field="comment"]').forEach(textarea => {
    // The table's comment box grows with its text; the card's keeps its two rows
    if (textarea.closest('tr')) autoSizeCommentBox(textarea);
    textarea.addEventListener('input', event => {
      if (event.target.closest('tr')) autoSizeCommentBox(event.target);
      updateDraft(event.target.closest('[data-sn]'));
    });
    textarea.addEventListener('change', event => {
      if (event.target.closest('tr')) autoSizeCommentBox(event.target);
      updateDraft(event.target.closest('[data-sn]'));
    });
  });

  rootEl.querySelector('[data-rows-host]')?.addEventListener('click', handleAction);
}

function ensureStickyTableStyles() {
  if (document.getElementById('secretariat-sticky-table-styles')) return;

  const style = document.createElement('style');
  style.id = 'secretariat-sticky-table-styles';
  style.textContent = `
    .secretariat-page-table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
    }
    .secretariat-page-table th,
    .secretariat-page-table td {
      white-space: nowrap;
      vertical-align: middle;
    }
    .secretariat-page-table thead th {
      position: sticky;
      top: 0;
      z-index: 20;
      background: #f9fafb;
      box-shadow: 0 1px 0 rgba(0,0,0,0.04);
    }
    .secretariat-x-wrap {
      width: 100%;
      overflow-x: auto;
      background: #fff;
    }
    html.dark .secretariat-x-wrap {
      background: #111827;
    }
    html.dark .secretariat-page-table thead th {
      background: #1f2937;
    }
    @media (max-width: 640px) {
      .secretariat-precision-actions {
        min-width: 5.5rem;
      }
      .secretariat-precision-actions button {
        width: 100%;
      }
      .secretariat-precision-penalty-input {
        min-width: 3.75rem;
        padding-left: 0.45rem;
        padding-right: 0.45rem;
      }
      .secretariat-precision-time-input {
        min-width: 6.25rem;
      }
      .secretariat-precision-knocks-input {
        min-width: 5.5rem;
      }
      .secretariat-precision-comment {
        min-width: 10rem;
      }
    }
    @media (max-width: 1100px) and (orientation: landscape) and (max-height: 760px) {
      .secretariat-precision-actions {
        min-width: 5rem;
      }
      .secretariat-precision-actions button {
        padding: 0.4rem 0.65rem;
      }
      .secretariat-precision-penalty-input {
        min-width: 3.6rem;
      }
      .secretariat-precision-time-input {
        min-width: 5.75rem;
      }
    }
  `;
  document.head.appendChild(style);
}

export async function load(container) {
  ensureStickyTableStyles();
  rootEl = container;
  const competition = getGlobalState('currentCompetition');
  competitionId = competition?.id || null;

  if (!rootEl) return;
  if (!competitionId) {
    rootEl.innerHTML = renderNoCompetitionState();
    return;
  }

  noticesHost?.destroy();
  noticesHost = createStaffNoticesHost({ competitionId });
  rootEl.innerHTML = '<div class="max-w-4xl mx-auto p-6 text-center text-gray-500">Laddar sekretariat Precision...</div>';

  try {
    await refreshData();
  } catch (error) {
    console.error('Failed to load secretariat precision:', error);
    rootEl.innerHTML = '<div class="max-w-4xl mx-auto p-6 text-center text-red-600">Kunde inte ladda sekretariatssidan.</div>';
  }
}

export function unload() {
  try { teardownStickyHeaders?.(); } catch (_) {}
  teardownStickyHeaders = null;
  rootEl = null;
  competitionId = null;
  rows = [];
  rejectedWrites = [];
  noticesHost?.destroy();
  noticesHost = null;
  currentRound = 'phase1';
  draftStore = newDraftStore();
  drafts = draftStore.phase1;
  groupCtx = null;
  filters = { search: '', status: 'all', className: 'all' };
}

// A new version of the app asks before reloading while there are unsaved changes
registerUnsavedWork('secretariat-precision', () => ROUND_KEYS.some(round => draftStore[round].size > 0));
