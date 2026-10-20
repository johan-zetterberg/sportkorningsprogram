import { getGlobalState } from '../../main.js';
import { getCompetitionHeader, showAlert, renderNoCompetitionState } from '../../ui/components.js';
import { t } from '../../utils/i18n.js';
import { registerUnsavedWork } from '../../utils/unsavedWork.js';
import { confirmFinalizeWithGaps } from '../../services/finalizationService.js';
import { listRejectedWrites } from '../../services/rejectedWritesService.js';
import { createStaffNoticesHost } from '../../ui/staffNoticesPanel.js';
import {
  askCorrectionReason,
  clearRowDirty,
  deriveMarathonStatus,
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
  loadSecretariatMarathonObstacleDetail,
  loadSecretariatMarathonRows,
  calculateSecretariatObstacle,
  refinalizeResult,
  saveSecretariatMarathonObstacle,
  saveSecretariatMarathonTiming,
  unlockResult,
} from '../../services/secretariatService.js';

let rootEl = null;
let competitionId = null;
let rows = [];
let rejectedWrites = [];
// Driver declaration changes and vet strikes for the ground jury (kept across renders)
let noticesHost = null;
let timingDrafts = new Map();
let obstacleDrafts = new Map();
let obstacleRows = [];
let obstacleCalcContext = null;
let selectedStartNumber = null;
let teardownStickyHeaders = null;
let filters = {
  search: '',
  status: 'all',
  className: 'all',
};
let activeTab = 'timing';

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
      .secretariat-marathon-tabs {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .secretariat-marathon-tab {
        width: 100%;
        justify-content: center;
      }
      .secretariat-marathon-actions {
        width: 100%;
        justify-content: stretch;
      }
      .secretariat-marathon-actions > * {
        flex: 1 1 calc(50% - 0.25rem);
      }
      .secretariat-marathon-summary {
        width: 100%;
      }
      .secretariat-marathon-obstacle-actions > * {
        flex: 1 1 100%;
      }
    }
    @media (max-width: 1100px) and (orientation: landscape) and (max-height: 760px) {
      .secretariat-marathon-tabs {
        display: flex;
        flex-wrap: wrap;
      }
      .secretariat-marathon-tab {
        flex: 1 1 0;
      }
      .secretariat-marathon-actions > * {
        flex: 0 1 auto;
      }
    }
  `;
  document.head.appendChild(style);
}

function getClassOptions() {
  return [...new Set(rows.map(row => row.className).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'sv'));
}

function getVisibleRows() {
  return filterRows(rows, filters);
}

function getRowByStartNumber(startNumber) {
  return rows.find(row => String(row.startNumber) === String(startNumber)) || null;
}

function draftTimingFor(row) {
  const draft = timingDrafts.get(String(row.startNumber));
  return draft ? { ...row, ...draft, status: deriveMarathonStatus({ ...row, ...draft }) } : row;
}

function draftObstacleFor(row) {
  const draft = obstacleDrafts.get(String(row.obstacleNumber));
  return draft ? { ...row, ...draft } : row;
}

function formatSeconds(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '';
  return num.toFixed(2).replace(/\.00$/, '');
}

function parseSeconds(value) {
  const text = String(value ?? '').trim().replace(',', '.');
  if (!text) return 0;
  const num = Number(text);
  if (!Number.isFinite(num)) throw new Error('Ogiltigt sekundformat.');
  return num;
}

function getTimingDirtyCount() {
  return Array.from(timingDrafts.values()).filter(draft => draft && !draft.__invalid).length;
}

function getObstacleDirtyCount() {
  return Array.from(obstacleDrafts.values()).filter(draft => draft && !draft.__invalid).length;
}

function hasTimingDrafts() {
  return timingDrafts.size > 0;
}

function hasObstacleDrafts() {
  return obstacleDrafts.size > 0;
}

function hasInvalidTimingDraft() {
  return Array.from(timingDrafts.values()).some(draft => draft?.__invalid);
}

function hasInvalidObstacleDraft() {
  return Array.from(obstacleDrafts.values()).some(draft => draft?.__invalid);
}

async function confirmDiscardTimingDrafts() {
  if (!hasTimingDrafts()) return true;
  return window.confirm('Du har osparade etapptider. Vill du lämna utan att spara?');
}

async function confirmDiscardObstacleDrafts() {
  if (!hasObstacleDrafts()) return true;
  return window.confirm('Du har osparade hinderändringar. Vill du lämna utan att spara?');
}

function syncDraftUiState() {
  if (!rootEl) return;

  const timingDirty = getTimingDirtyCount();
  const obstacleDirty = getObstacleDirtyCount();

  const timingBadge = rootEl.querySelector('[data-role="timing-dirty-badge"]');
  if (timingBadge) {
    timingBadge.textContent = String(timingDirty);
    timingBadge.classList.toggle('hidden', timingDirty === 0);
  }

  const obstacleBadge = rootEl.querySelector('[data-role="obstacle-dirty-badge"]');
  if (obstacleBadge) {
    obstacleBadge.textContent = String(obstacleDirty);
    obstacleBadge.classList.toggle('hidden', obstacleDirty === 0);
  }

  const timingNote = rootEl.querySelector('[data-role="timing-dirty-note"]');
  if (timingNote) {
    timingNote.textContent = `${timingDirty} osparade ändringar`;
    timingNote.classList.toggle('hidden', timingDirty === 0);
    timingNote.classList.toggle('inline-flex', timingDirty > 0);
  }

  const obstacleNote = rootEl.querySelector('[data-role="obstacle-dirty-note"]');
  if (obstacleNote) {
    obstacleNote.textContent = `${obstacleDirty} osparade hinderändringar`;
    obstacleNote.classList.toggle('hidden', obstacleDirty === 0);
    obstacleNote.classList.toggle('inline-flex', obstacleDirty > 0);
  }

  rootEl.querySelectorAll('button[data-action="save-all-timing"], button[data-action="reset-all-timing"]').forEach(button => {
    button.disabled = timingDirty === 0;
  });

  rootEl.querySelectorAll('button[data-action="save-all-obstacles"], button[data-action="reset-all-obstacles"]').forEach(button => {
    button.disabled = obstacleDirty === 0;
  });
}

function renderTabs() {
  const timingDirty = getTimingDirtyCount();
  const obstacleDirty = getObstacleDirtyCount();

  return `
    <section class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-2 mb-4">
      <div class="secretariat-marathon-tabs flex gap-2">
        <button data-tab="timing" class="secretariat-marathon-tab px-4 py-2 rounded-lg text-sm font-semibold ${activeTab === 'timing' ? 'bg-brand-darkblue text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200'}">
          Etapptider <span data-role="timing-dirty-badge" class="${timingDirty > 0 ? '' : 'hidden '}ml-1 rounded-full bg-amber-200/80 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">${timingDirty}</span>
        </button>
        <button data-tab="obstacles" class="secretariat-marathon-tab px-4 py-2 rounded-lg text-sm font-semibold ${activeTab === 'obstacles' ? 'bg-brand-darkblue text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200'}">
          Hinder <span data-role="obstacle-dirty-badge" class="${obstacleDirty > 0 ? '' : 'hidden '}ml-1 rounded-full bg-amber-200/80 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">${obstacleDirty}</span>
        </button>
      </div>
    </section>
  `;
}

function buildTimingRows() {
  const visibleRows = getVisibleRows();
  if (visibleRows.length === 0) {
    return `
      <tr>
        <td colspan="9" class="px-4 py-8 text-center text-gray-500 dark:text-gray-400">Inga ekipage matchar filtret.</td>
      </tr>
    `;
  }

  return visibleRows.map(row => {
    const view = draftTimingFor(row);
    const readOnly = row.finalized === true;
    const isDirty = timingDrafts.has(String(row.startNumber));
    const selected = String(selectedStartNumber || '') === String(row.startNumber);

    return `
      <tr data-sn="${escapeHtml(row.startNumber)}" class="border-t border-gray-200 dark:border-gray-700 ${isDirty ? 'bg-amber-50/70 dark:bg-amber-900/10' : ''} ${selected ? 'bg-blue-50/60 dark:bg-blue-900/10' : ''}">
        <td class="px-3 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100 whitespace-nowrap">#${escapeHtml(row.startNumber)}</td>
        <td class="px-3 py-3 text-sm text-gray-900 dark:text-gray-100 min-w-[14rem]">
          <div class="font-medium">${escapeHtml(row.driverName || '-')}</div>
          <div class="text-xs text-gray-500 dark:text-gray-400">${escapeHtml(row.className || '')}</div>
        </td>
        <td class="px-3 py-3 text-sm min-w-[8rem]">
          <input data-field="duration_A" value="${escapeHtml(formatEditableTime(view.duration_A))}" ${readOnly ? 'disabled' : ''} class="w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60">
        </td>
        <td class="px-3 py-3 text-sm min-w-[8rem]">
          <input data-field="duration_B" value="${escapeHtml(formatEditableTime(view.duration_B))}" ${readOnly ? 'disabled' : ''} class="w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60">
          ${row.holdTimeSec > 0 ? `<div class="text-[10px] text-blue-600 dark:text-blue-400 font-semibold mt-0.5">Avdrag: -${row.holdTimeSec}s</div>` : ''}
        </td>
        <td class="px-3 py-3 text-sm min-w-[9rem]">
          <div class="flex gap-1">
            <input data-field="otherPenalty" type="number" step="0.01" value="${escapeHtml(view.otherPenalty || 0)}" ${readOnly ? 'disabled' : ''} class="w-16 rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60">
            <select data-field="otherPenaltySection" title="Sträcka där straffet gavs (TR 527.1)" ${readOnly ? 'disabled' : ''} class="rounded border border-gray-300 dark:border-gray-600 px-1 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60">
              ${[['A', 'A'], ['transport', 'Transport'], ['B', 'B']].map(([value, label]) => `<option value="${value}"${(view.otherPenaltySection || 'B') === value ? ' selected' : ''}>${label}</option>`).join('')}
            </select>
          </div>
        </td>
        <td class="px-3 py-3 text-sm text-gray-700 dark:text-gray-200 whitespace-nowrap">${escapeHtml(String(row.obstacleCount || 0))}</td>
        <td class="px-3 py-3 text-sm whitespace-nowrap">${renderStatusBadge(view.status, row.finalized)}</td>
        <td class="px-3 py-3 text-sm whitespace-nowrap">
          <div class="flex flex-col gap-2">
            ${readOnly ? `
              <button data-action="unlock" class="rounded bg-amber-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-amber-700">${escapeHtml(t('unlock'))}</button>
            ` : `
              <button data-action="save-timing" class="rounded bg-brand-darkblue text-white px-3 py-1.5 text-xs font-semibold hover:opacity-90">Spara</button>
              <button data-action="reset-timing" class="rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">${escapeHtml(t('undo'))}</button>
              <button data-action="finalize" class="rounded border border-emerald-600 text-emerald-700 dark:text-emerald-400 px-3 py-1.5 text-xs font-semibold hover:bg-emerald-50 dark:hover:bg-emerald-900/20">Finalisera</button>
            `}
          </div>
        </td>
        <td class="px-3 py-3 text-sm whitespace-nowrap">
          <button data-action="open-obstacles" class="rounded border border-blue-300 dark:border-blue-700 px-3 py-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20">Öppna hinder</button>
        </td>
      </tr>
    `;
  }).join('');
}

function renderTimingTab() {
  const visibleRows = getVisibleRows();
  const dirtyCount = getTimingDirtyCount();

  return `
    ${renderToolbar({
      searchValue: filters.search,
      statusValue: filters.status,
      classValue: filters.className,
      classOptions: getClassOptions(),
    })}
    <section class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 mb-4">
      <div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100">Etapptider</h2>
          <p class="text-sm text-gray-600 dark:text-gray-400">Korrigera sparade tider för etapp A och B utan att röra liveflödet.</p>
          <div data-role="timing-dirty-note" class="${dirtyCount > 0 ? 'inline-flex' : 'hidden'} mt-2 items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">${dirtyCount} osparade ändringar</div>
        </div>
        <div class="secretariat-marathon-actions flex flex-wrap items-center gap-2">
          <div class="secretariat-marathon-summary text-sm text-gray-500 dark:text-gray-400">${visibleRows.length} av ${rows.length} ekipage visas</div>
          <button data-action="save-all-timing" ${dirtyCount === 0 ? 'disabled' : ''} class="rounded bg-brand-darkblue text-white px-3 py-2 text-xs font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed">${escapeHtml(t('save_all'))}</button>
          <button data-action="reset-all-timing" ${dirtyCount === 0 ? 'disabled' : ''} class="rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed">${escapeHtml(t('undo_all'))}</button>
        </div>
      </div>
    </section>
    <section class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
      <div class="secretariat-x-wrap">
        <table class="min-w-full secretariat-page-table">
          <thead class="bg-gray-50 dark:bg-gray-900/50">
            <tr class="text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
              <th class="px-3 py-3">Start</th>
              <th class="px-3 py-3">Ekipage</th>
              <th class="px-3 py-3">Tid A</th>
              <th class="px-3 py-3">Tid B</th>
              <th class="px-3 py-3" title="Övriga straff och sträckan de gavs på">Övriga straff</th>
              <th class="px-3 py-3">Hinder</th>
              <th class="px-3 py-3">${escapeHtml(t('status'))}</th>
              <th class="px-3 py-3">Åtgärder</th>
              <th class="px-3 py-3">Detalj</th>
            </tr>
          </thead>
          <tbody>${buildTimingRows()}</tbody>
        </table>
      </div>
    </section>
  `;
}

function buildObstacleRows() {
  if (!selectedStartNumber) {
    return '<div class="p-4 text-gray-500 dark:text-gray-400">Välj ett ekipage från Etapptider för att redigera hinder.</div>';
  }

  if (obstacleRows.length === 0) {
    return '<div class="p-4 text-gray-500 dark:text-gray-400">Inga sparade hinderresultat hittades för detta ekipage ännu.</div>';
  }

  const baseRow = getRowByStartNumber(selectedStartNumber);
  const readOnly = baseRow?.finalized === true;

  const rowsHtml = obstacleRows.map(row => {
    const view = draftObstacleFor(row);
    const isDirty = obstacleDrafts.has(String(row.obstacleNumber));
    const calc = view.__invalid ? row : calculateSecretariatObstacle(obstacleCalcContext, view);
    const totalPenalty = Number(calc.penalty || 0);
    const timePenaltyLabel = Number(calc.timePenalty || 0).toFixed(2).replace(/\.00$/, '');

    return `
      <tr data-obstacle="${escapeHtml(row.obstacleNumber)}" class="border-t border-gray-200 dark:border-gray-700 ${isDirty ? 'bg-amber-50/70 dark:bg-amber-900/10' : ''}">
        <td class="px-3 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100 whitespace-nowrap">${escapeHtml(row.obstacleNumber)}</td>
        <td class="px-3 py-3 text-sm min-w-[7rem]">
          <input data-field="timeInSeconds" value="${escapeHtml(formatSeconds(view.timeInSeconds))}" ${readOnly ? 'disabled' : ''} class="w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60">
        </td>
        <td data-role="obstacle-time-penalty" title="Beräknas från tiden" class="px-3 py-3 text-sm min-w-[6rem] text-gray-900 dark:text-gray-100 whitespace-nowrap">${escapeHtml(timePenaltyLabel)}</td>
        <td class="px-3 py-3 text-sm min-w-[5rem]">
          <input data-field="knockdowns" type="number" step="1" value="${escapeHtml(view.knockdowns ?? 0)}" ${readOnly ? 'disabled' : ''} class="w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60">
        </td>
        <td class="px-3 py-3 text-sm min-w-[6rem]">
          <input data-field="knockdownPenalty" type="number" step="0.01" value="${escapeHtml(view.knockdownPenalty ?? 0)}" ${readOnly ? 'disabled' : ''} class="w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60">
        </td>
        <td class="px-3 py-3 text-sm min-w-[6rem]">
          <input data-field="otherPenalty" type="number" step="0.01" value="${escapeHtml(view.otherPenalty ?? 0)}" ${readOnly ? 'disabled' : ''} class="w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60">
        </td>
        <td class="px-3 py-3 text-sm min-w-[5rem]">
          <input data-field="holdTimeSec" type="number" step="1" min="0" value="${escapeHtml(view.holdTimeSec ?? 0)}" ${readOnly ? 'disabled' : ''} class="w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60">
        </td>
        <td data-role="obstacle-total" class="px-3 py-3 text-sm text-gray-900 dark:text-gray-100 whitespace-nowrap">${escapeHtml(totalPenalty.toFixed(2).replace(/\.00$/, ''))}</td>
        <td class="px-3 py-3 text-sm text-center">
          <input data-field="eliminated" type="checkbox" ${view.eliminated ? 'checked' : ''} ${readOnly ? 'disabled' : ''} class="h-4 w-4 rounded border-gray-300 text-red-600 disabled:opacity-60">
        </td>
        <td class="px-3 py-3 text-sm min-w-[14rem]">
          <input data-field="comment" maxlength="1000" value="${escapeHtml(view.comment || '')}" ${readOnly ? 'disabled' : ''} class="w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60">
        </td>
        <td class="px-3 py-3 text-sm whitespace-nowrap">
          ${readOnly ? `
            <span class="text-xs text-gray-500 dark:text-gray-400">${escapeHtml(t('unlock_in_header'))}</span>
          ` : `
            <div class="flex flex-col gap-2">
              <button data-action="save-obstacle" class="rounded bg-brand-darkblue text-white px-3 py-1.5 text-xs font-semibold hover:opacity-90">Spara</button>
              <button data-action="reset-obstacle" class="rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">${escapeHtml(t('undo'))}</button>
            </div>
          `}
        </td>
      </tr>
    `;
  }).join('');

  return `
    <div class="secretariat-x-wrap">
      <table class="min-w-full secretariat-page-table">
        <thead class="bg-gray-50 dark:bg-gray-900/50">
          <tr class="text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
            <th class="px-3 py-3">Hinder</th>
            <th class="px-3 py-3">Sekunder</th>
            <th class="px-3 py-3">Tidstraff</th>
            <th class="px-3 py-3">KD</th>
            <th class="px-3 py-3">KD-straff</th>
            <th class="px-3 py-3">Övrigt</th>
            <th class="px-3 py-3">Uppehåll (s)</th>
            <th class="px-3 py-3">Totalt</th>
            <th class="px-3 py-3">Elim.</th>
            <th class="px-3 py-3">Kommentar</th>
            <th class="px-3 py-3">Åtgärder</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  `;
}

function renderObstacleTab() {
  const baseRow = selectedStartNumber ? getRowByStartNumber(selectedStartNumber) : null;
  const dirtyCount = getObstacleDirtyCount();

  return `
    <section class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 mb-4">
      <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100">Hinderkorrigering</h2>
          ${baseRow ? `
            <p class="text-sm text-gray-600 dark:text-gray-400">Ekipage #${escapeHtml(baseRow.startNumber)} - ${escapeHtml(baseRow.driverName || '')}</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">${escapeHtml(baseRow.className || '')}</p>
            <div data-role="obstacle-dirty-note" class="${dirtyCount > 0 ? 'inline-flex' : 'hidden'} mt-2 items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">${dirtyCount} osparade hinderändringar</div>
          ` : `
            <p class="text-sm text-gray-600 dark:text-gray-400">Öppna ett ekipage från etapptider för att redigera hinder.</p>
          `}
        </div>
        ${baseRow ? `
          <div class="secretariat-marathon-actions secretariat-marathon-obstacle-actions flex flex-wrap gap-2">
            <button data-action="save-all-obstacles" ${dirtyCount === 0 ? 'disabled' : ''} class="rounded bg-brand-darkblue text-white px-3 py-2 text-xs font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed">${escapeHtml(t('save_all'))}</button>
            <button data-action="reset-all-obstacles" ${dirtyCount === 0 ? 'disabled' : ''} class="rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed">${escapeHtml(t('undo_all'))}</button>
            ${baseRow.finalized
              ? `<button data-action="unlock-selected" class="rounded bg-amber-600 text-white px-3 py-2 text-xs font-semibold hover:bg-amber-700">${escapeHtml(t('unlock_entry'))}</button>`
              : '<button data-action="finalize-selected" class="rounded border border-emerald-600 text-emerald-700 dark:text-emerald-400 px-3 py-2 text-xs font-semibold hover:bg-emerald-50 dark:hover:bg-emerald-900/20">Finalisera ekipage</button>'}
            <button data-action="back-to-timing" class="rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">Till etapptider</button>
          </div>
        ` : ''}
      </div>
    </section>
    <section class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
      ${buildObstacleRows()}
    </section>
  `;
}

function render() {
  if (!rootEl) return;
  try { teardownStickyHeaders?.(); } catch (_) {}
  teardownStickyHeaders = null;
  const competition = getGlobalState('currentCompetition');

  rootEl.innerHTML = `
    <div class="w-full max-w-7xl mx-auto px-3 py-4 sm:px-4">
      ${getCompetitionHeader(competition, t('secretariat_marathon_title'), { quickGuideRole: 'secretariat' })}
      ${renderFieldModeBanner(competition, {
        message: 'Tävlingen körs i fältläge. Etapptider och hinder registreras manuellt, och sekretariatet används för kontroll, korrigering och finalisering.',
      })}
      ${renderRejectedWritesPanel(rejectedWrites)}
      ${noticesHost?.placeholder || ''}
      ${renderTabs()}
      ${activeTab === 'timing' ? renderTimingTab() : renderObstacleTab()}
    </div>
  `;

  noticesHost?.attach(rootEl);
  initializeToolbarInteractions(rootEl);
  wireEvents();
  syncDraftUiState();
  teardownStickyHeaders = setupStickyTableHeaders(rootEl);
}

function collectTimingPatch(rowEl, baseRow) {
  const durationA = parseEditableTime(rowEl.querySelector('[data-field="duration_A"]')?.value || '');
  const durationB = parseEditableTime(rowEl.querySelector('[data-field="duration_B"]')?.value || '');

  if ((rowEl.querySelector('[data-field="duration_A"]')?.value || '').trim() && durationA == null) {
    throw new Error('Ogiltigt tidsformat för Tid A. Använd mm:ss,cc eller sekunder.');
  }
  if ((rowEl.querySelector('[data-field="duration_B"]')?.value || '').trim() && durationB == null) {
    throw new Error('Ogiltigt tidsformat för Tid B. Använd mm:ss,cc eller sekunder.');
  }

  const otherText = String(rowEl.querySelector('[data-field="otherPenalty"]')?.value ?? '').trim().replace(',', '.');
  const otherPenalty = otherText ? Number(otherText) : 0;
  if (!Number.isFinite(otherPenalty)) throw new Error('Ogiltigt värde för övriga straff.');
  // The section select shows B when none is saved: it counts as a change only
  // when changed, or saved together with a changed penalty
  const shownSection = baseRow.otherPenaltySection || 'B';
  const selectedSection = rowEl.querySelector('[data-field="otherPenaltySection"]')?.value || shownSection;
  const penaltyChanged = Math.abs(otherPenalty - (baseRow.otherPenalty || 0)) > 1e-9;
  const otherPenaltySection = (penaltyChanged || selectedSection !== shownSection) ? selectedSection : (baseRow.otherPenaltySection || '');

  return {
    startNumber: baseRow.startNumber,
    className: baseRow.className,
    duration_A: durationA ?? 0,
    duration_B: durationB ?? 0,
    otherPenalty,
    otherPenaltySection,
  };
}

// The row a draft was edited from: kept with the draft, so reloading after
// another row's save cannot hide a change the timekeeper made meanwhile
function timingBaseFor(sn) {
  return timingDrafts.get(String(sn))?.__base || getRowByStartNumber(sn);
}

function obstacleBaseFor(obstacleNumber) {
  return obstacleDrafts.get(String(obstacleNumber))?.__base
    || obstacleRows.find(row => String(row.obstacleNumber) === String(obstacleNumber))
    || null;
}

function updateTimingDraft(rowEl) {
  const sn = String(rowEl.dataset.sn);
  const row = getRowByStartNumber(sn);
  if (!row || row.finalized) return;
  const baseRow = timingBaseFor(sn);

  try {
    const patch = collectTimingPatch(rowEl, baseRow);
    const hasChanges = JSON.stringify({
      duration_A: patch.duration_A,
      duration_B: patch.duration_B,
      otherPenalty: patch.otherPenalty,
      otherPenaltySection: patch.otherPenaltySection || '',
    }) !== JSON.stringify({
      duration_A: baseRow.duration_A || 0,
      duration_B: baseRow.duration_B || 0,
      otherPenalty: baseRow.otherPenalty || 0,
      otherPenaltySection: baseRow.otherPenaltySection || '',
    });

    if (hasChanges) {
      timingDrafts.set(sn, { ...patch, __base: baseRow });
      markRowDirty(rowEl, true);
    } else {
      timingDrafts.delete(sn);
      clearRowDirty(rowEl);
    }
  } catch {
    timingDrafts.set(sn, { __invalid: true, __base: baseRow });
    markRowDirty(rowEl, true);
  }

  syncDraftUiState();
}

function collectObstaclePatch(rowEl, baseRow) {
  const timeInSeconds = parseSeconds(rowEl.querySelector('[data-field="timeInSeconds"]')?.value || '');
  const knockdowns = Number(rowEl.querySelector('[data-field="knockdowns"]')?.value || 0);
  const knockdownPenalty = Number(rowEl.querySelector('[data-field="knockdownPenalty"]')?.value || 0);
  const otherPenalty = Number(rowEl.querySelector('[data-field="otherPenalty"]')?.value || 0);
  const holdTimeSec = Number(rowEl.querySelector('[data-field="holdTimeSec"]')?.value || 0);

  const patch = {
    obstacleNumber: baseRow.obstacleNumber,
    timeInSeconds,
    knockdowns: Number.isFinite(knockdowns) ? knockdowns : 0,
    knockdownPenalty: Number.isFinite(knockdownPenalty) ? knockdownPenalty : 0,
    otherPenalty: Number.isFinite(otherPenalty) ? otherPenalty : 0,
    holdTimeSec: Number.isFinite(holdTimeSec) ? holdTimeSec : 0,
    eliminated: !!rowEl.querySelector('[data-field="eliminated"]')?.checked,
    comment: rowEl.querySelector('[data-field="comment"]')?.value?.trim() || '',
    calcContext: obstacleCalcContext,
  };
  // Time penalty and total from the result engine
  const calc = calculateSecretariatObstacle(obstacleCalcContext, patch);
  patch.timePenalty = calc.timePenalty;
  patch.penalty = calc.penalty ?? 0;
  return patch;
}

function updateObstacleDraft(rowEl) {
  const obstacleNumber = String(rowEl.dataset.obstacle);
  const baseRow = obstacleBaseFor(obstacleNumber);
  if (!baseRow) return;

  try {
    const patch = collectObstaclePatch(rowEl, baseRow);
    const totalCell = rowEl.querySelector('[data-role="obstacle-total"]');
    if (totalCell) {
      totalCell.textContent = Number(patch.penalty || 0).toFixed(2).replace(/\.00$/, '');
    }
    const timePenaltyCell = rowEl.querySelector('[data-role="obstacle-time-penalty"]');
    if (timePenaltyCell) {
      timePenaltyCell.textContent = Number(patch.timePenalty || 0).toFixed(2).replace(/\.00$/, '');
    }

    const hasChanges = JSON.stringify({
      timeInSeconds: patch.timeInSeconds,
      knockdowns: patch.knockdowns,
      knockdownPenalty: patch.knockdownPenalty,
      otherPenalty: patch.otherPenalty,
      holdTimeSec: patch.holdTimeSec,
      eliminated: patch.eliminated,
      comment: patch.comment,
    }) !== JSON.stringify({
      timeInSeconds: baseRow.timeInSeconds || 0,
      knockdowns: baseRow.knockdowns || 0,
      knockdownPenalty: baseRow.knockdownPenalty || 0,
      otherPenalty: baseRow.otherPenalty || 0,
      holdTimeSec: baseRow.holdTimeSec || 0,
      eliminated: !!baseRow.eliminated,
      comment: baseRow.comment || '',
    });

    if (hasChanges) {
      obstacleDrafts.set(obstacleNumber, { ...patch, __base: baseRow });
      markRowDirty(rowEl, true);
    } else {
      obstacleDrafts.delete(obstacleNumber);
      clearRowDirty(rowEl);
    }
  } catch {
    obstacleDrafts.set(obstacleNumber, { __invalid: true, __base: baseRow });
    markRowDirty(rowEl, true);
  }

  syncDraftUiState();
}

// Saves every valid draft; one that fails (e.g. changed by the judge) keeps its
// draft while the others are saved. Returns the saved keys and the errors.
async function saveAllTimingDrafts(correction) {
  if (hasInvalidTimingDraft()) {
    throw new Error('Det finns ogiltiga etapptider. Rätta dem innan du sparar alla.');
  }

  const saved = [];
  const errors = [];
  const entries = Array.from(timingDrafts.entries()).filter(([, patch]) => patch && !patch.__invalid);
  for (const [sn, patch] of entries) {
    try {
      await saveSecretariatMarathonTiming(competitionId, sn, patch, correction, { baseRow: patch.__base || getRowByStartNumber(sn) });
      saved.push(sn);
    } catch (error) {
      errors.push(error.message || `#${sn} kunde inte sparas.`);
    }
  }
  return { saved, errors };
}

async function saveAllObstacleDrafts(correction) {
  if (hasInvalidObstacleDraft()) {
    throw new Error('Det finns ogiltiga hinderändringar. Rätta dem innan du sparar alla.');
  }

  const saved = [];
  const errors = [];
  const entries = Array.from(obstacleDrafts.entries()).filter(([, patch]) => patch && !patch.__invalid);
  for (const [obstacleNumber, patch] of entries) {
    try {
      await saveSecretariatMarathonObstacle(
        competitionId,
        selectedStartNumber,
        obstacleNumber,
        patch,
        correction,
        { baseRow: patch.__base || obstacleBaseFor(obstacleNumber) }
      );
      saved.push(obstacleNumber);
    } catch (error) {
      errors.push(error.message || `Hinder ${obstacleNumber} kunde inte sparas.`);
    }
  }
  return { saved, errors };
}

async function refreshRows() {
  [rows, rejectedWrites] = await Promise.all([
    loadSecretariatMarathonRows(competitionId),
    listRejectedWrites(competitionId, { discipline: 'marathon' }).catch(() => []),
  ]);
}

// Reloads the selected equipage's obstacles. With keepDrafts the unsaved
// edits of other obstacles stay (another equipage starts without drafts)
async function refreshObstacleDetail({ keepDrafts = false, savedObstacles = [] } = {}) {
  if (!keepDrafts) obstacleDrafts = new Map();
  savedObstacles.forEach(number => obstacleDrafts.delete(String(number)));
  if (!selectedStartNumber) {
    obstacleRows = [];
    return;
  }
  const baseRow = getRowByStartNumber(selectedStartNumber);
  const detail = await loadSecretariatMarathonObstacleDetail(competitionId, selectedStartNumber, {
    startNumber: selectedStartNumber,
    className: baseRow?.className || ''
  });
  obstacleRows = detail.obstacles || [];
  obstacleCalcContext = detail.calcContext || null;
}

// Reloads rows (and the selected equipage's obstacles). Unsaved edits are
// kept, except those just saved (savedTiming: start numbers, savedObstacles:
// obstacle numbers of the selected equipage)
async function refreshAll({ savedTiming = [], savedObstacles = [] } = {}) {
  await refreshRows();
  if (selectedStartNumber) {
    const stillExists = getRowByStartNumber(selectedStartNumber);
    if (!stillExists) selectedStartNumber = null;
  }
  if (activeTab === 'obstacles' || selectedStartNumber) {
    await refreshObstacleDetail({ keepDrafts: !!selectedStartNumber, savedObstacles });
  }
  savedTiming.forEach(sn => timingDrafts.delete(String(sn)));
  // A draft of an equipage no longer listed has nothing to be saved to
  [...timingDrafts.keys()].forEach(sn => { if (!getRowByStartNumber(sn)) timingDrafts.delete(sn); });
  render();
}

function showSaveAllResult(saved, errors, what) {
  if (errors.length === 0) {
    showAlert(`${saved.length} ${what} sparade.`);
    return;
  }
  showAlert(`${saved.length} ${what} sparade. Ej sparade (ändringarna finns kvar): ${errors.join(' ')}`, false);
}

async function handleAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const action = button.dataset.action;

  try {
    if (action === 'back-to-timing') {
      if (!(await confirmDiscardObstacleDrafts())) return;
      activeTab = 'timing';
      render();
      return;
    }

    if (action === 'save-all-timing') {
      if (hasInvalidTimingDraft()) throw new Error('Det finns ogiltiga etapptider. Rätta dem innan du sparar alla.');
      const correction = await askCorrectionReason({ summary: `Etapptider för ${getTimingDirtyCount()} ekipage` });
      if (!correction) return;
      const { saved, errors } = await saveAllTimingDrafts(correction);
      await refreshAll({ savedTiming: saved });
      showSaveAllResult(saved, errors, 'etapptider');
      return;
    }

    if (action === 'reset-all-timing') {
      if (!(await confirmDiscardTimingDrafts())) return;
      timingDrafts = new Map();
      render();
      return;
    }

    if (action === 'save-all-obstacles' && selectedStartNumber) {
      if (hasInvalidObstacleDraft()) throw new Error('Det finns ogiltiga hinderändringar. Rätta dem innan du sparar alla.');
      const correction = await askCorrectionReason({ summary: `Hinder för #${selectedStartNumber}` });
      if (!correction) return;
      const { saved, errors } = await saveAllObstacleDrafts(correction);
      activeTab = 'obstacles';
      await refreshAll({ savedObstacles: saved });
      showSaveAllResult(saved, errors, `hinder för #${selectedStartNumber}`);
      return;
    }

    if (action === 'reset-all-obstacles') {
      if (!(await confirmDiscardObstacleDrafts())) return;
      obstacleDrafts = new Map();
      render();
      return;
    }

    if (action === 'unlock-selected' && selectedStartNumber) {
      await unlockResult(competitionId, 'marathon', selectedStartNumber);
      showAlert(`Maraton #${selectedStartNumber} upplåst.`);
      activeTab = 'obstacles';
      await refreshAll();
      return;
    }

    if (action === 'finalize-selected' && selectedStartNumber) {
      if (hasObstacleDrafts()) {
        showAlert('Spara hinderändringarna innan du finaliserar ekipaget.', false);
        return;
      }
      if (!(await confirmFinalizeWithGaps(competitionId, 'marathon', selectedStartNumber))) return;
      await refinalizeResult(competitionId, 'marathon', selectedStartNumber);
      showAlert(`Maraton #${selectedStartNumber} finaliserat.`);
      activeTab = 'obstacles';
      await refreshAll();
      return;
    }

    const timingRow = button.closest('tr[data-sn]');
    if (timingRow) {
      const sn = timingRow.dataset.sn;
      const baseRow = getRowByStartNumber(sn);
      if (!baseRow) return;

      if (action === 'open-obstacles') {
        if (!(await confirmDiscardTimingDrafts())) return;
        // Another equipage's obstacles: earlier obstacle drafts do not apply
        if (String(selectedStartNumber) !== String(sn) && hasObstacleDrafts() && !(await confirmDiscardObstacleDrafts())) return;
        selectedStartNumber = sn;
        activeTab = 'obstacles';
        await refreshObstacleDetail();
        render();
        return;
      }

      if (action === 'unlock') {
        await unlockResult(competitionId, 'marathon', sn);
        showAlert(`Maraton #${sn} upplåst.`);
        await refreshAll();
        return;
      }

      if (action === 'reset-timing') {
        timingDrafts.delete(sn);
        render();
        return;
      }

      const editBase = timingBaseFor(sn) || baseRow;

      if (action === 'save-timing') {
        if (timingDrafts.get(sn)?.__invalid) throw new Error('Rätta ogiltiga tider innan du sparar.');
        if (!timingDrafts.has(sn)) return;
        const patch = collectTimingPatch(timingRow, editBase);
        const correction = await askCorrectionReason({ summary: `Etapptider #${sn}` });
        if (!correction) return;
        await saveSecretariatMarathonTiming(competitionId, sn, patch, correction, { baseRow: editBase });
        showAlert(`Etapptider sparade för #${sn}.`);
        await refreshAll({ savedTiming: [sn] });
        return;
      }

      if (action === 'finalize') {
        if (timingDrafts.has(sn) && timingDrafts.get(sn)?.__invalid) {
          throw new Error('Rätta ogiltiga tider innan du finaliserar.');
        }
        if (!(await confirmFinalizeWithGaps(competitionId, 'marathon', sn))) return;
        // Only edited times are saved; without edits finalizing just locks
        if (timingDrafts.has(sn)) {
          const patch = collectTimingPatch(timingRow, editBase);
          const correction = await askCorrectionReason({ summary: `Etapptider #${sn}, före finalisering` });
          if (!correction) return;
          await saveSecretariatMarathonTiming(competitionId, sn, patch, correction, { baseRow: editBase });
        }
        await refinalizeResult(competitionId, 'marathon', sn);
        showAlert(`Maraton #${sn} finaliserat.`);
        await refreshAll({ savedTiming: [sn] });
        return;
      }
    }

    const obstacleRow = button.closest('tr[data-obstacle]');
    if (obstacleRow && selectedStartNumber) {
      const obstacleNumber = obstacleRow.dataset.obstacle;
      const baseRow = obstacleBaseFor(obstacleNumber);
      if (!baseRow) return;

      if (action === 'reset-obstacle') {
        obstacleDrafts.delete(obstacleNumber);
        render();
        return;
      }

      if (action === 'save-obstacle') {
        if (obstacleDrafts.get(obstacleNumber)?.__invalid) throw new Error('Rätta ogiltiga värden innan du sparar.');
        if (!obstacleDrafts.has(obstacleNumber)) return;
        const patch = collectObstaclePatch(obstacleRow, baseRow);
        const correction = await askCorrectionReason({ summary: `Hinder ${obstacleNumber}, #${selectedStartNumber}` });
        if (!correction) return;
        await saveSecretariatMarathonObstacle(competitionId, selectedStartNumber, obstacleNumber, patch, correction, { baseRow });
        showAlert(`Hinder ${obstacleNumber} sparat för #${selectedStartNumber}.`);
        activeTab = 'obstacles';
        await refreshAll({ savedObstacles: [obstacleNumber] });
      }
    }
  } catch (error) {
    console.error('Secretariat marathon action failed:', error);
    showAlert(error.message || 'Kunde inte genomföra åtgärden.', false);
  }
}

function wireEvents() {
  rootEl.querySelectorAll('button[data-tab]').forEach(button => {
    button.addEventListener('click', async () => {
      const nextTab = button.dataset.tab;
      if (nextTab === activeTab) return;

      if (activeTab === 'timing' && !(await confirmDiscardTimingDrafts())) return;
      if (activeTab === 'obstacles' && !(await confirmDiscardObstacleDrafts())) return;

      activeTab = nextTab;
      if (activeTab === 'obstacles' && selectedStartNumber) {
        await refreshObstacleDetail();
      }
      render();
    });
  });

  if (activeTab === 'timing') {
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
      } catch (_) {}
    });

    rootEl.querySelector('#secretariatStatusFilter')?.addEventListener('change', event => {
      filters.status = event.target.value || 'all';
      render();
    });

    rootEl.querySelector('#secretariatClassFilter')?.addEventListener('change', event => {
      filters.className = event.target.value || 'all';
      render();
    });

    rootEl.querySelectorAll('tbody tr[data-sn] input, tbody tr[data-sn] select').forEach(input => {
      input.addEventListener('input', event => updateTimingDraft(event.target.closest('tr[data-sn]')));
      input.addEventListener('change', event => updateTimingDraft(event.target.closest('tr[data-sn]')));
    });
  }

  if (activeTab === 'obstacles') {
    rootEl.querySelectorAll('tbody tr[data-obstacle] input').forEach(input => {
      input.addEventListener('input', event => updateObstacleDraft(event.target.closest('tr[data-obstacle]')));
      input.addEventListener('change', event => updateObstacleDraft(event.target.closest('tr[data-obstacle]')));
    });
  }

  rootEl.querySelector('tbody')?.addEventListener('click', handleAction);
  rootEl.querySelectorAll('section button[data-action]').forEach(button => {
    if (!button.closest('tbody')) {
      button.addEventListener('click', handleAction);
    }
  });
}

export async function load(container) {
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
  rootEl.innerHTML = '<div class="max-w-4xl mx-auto p-6 text-center text-gray-500">Laddar sekretariat Maraton...</div>';

  try {
    ensureStickyTableStyles();
    await refreshAll();
  } catch (error) {
    console.error('Failed to load secretariat marathon:', error);
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
  timingDrafts = new Map();
  obstacleDrafts = new Map();
  obstacleRows = [];
  selectedStartNumber = null;
  activeTab = 'timing';
  filters = { search: '', status: 'all', className: 'all' };
}

// A new version of the app asks before reloading while there are unsaved changes
registerUnsavedWork('secretariat-marathon', () => hasTimingDrafts() || hasObstacleDrafts());
