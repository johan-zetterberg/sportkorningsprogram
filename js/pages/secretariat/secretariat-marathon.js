import { getGlobalState } from '../../main.js';
import { getCompetitionHeader, showAlert } from '../../ui/components.js';
import {
  clearRowDirty,
  deriveMarathonStatus,
  escapeHtml,
  filterRows,
  formatEditableTime,
  markRowDirty,
  parseEditableTime,
  renderStatusBadge,
  renderToolbar,
  setupStickyTableHeaders,
} from './secretariat-shared.js';
import {
  loadSecretariatMarathonObstacleDetail,
  loadSecretariatMarathonRows,
  refinalizeResult,
  saveSecretariatMarathonObstacle,
  saveSecretariatMarathonTiming,
  unlockResult,
} from '../../services/secretariatService.js';

let rootEl = null;
let competitionId = null;
let rows = [];
let timingDrafts = new Map();
let obstacleDrafts = new Map();
let obstacleRows = [];
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
      <div class="flex gap-2">
        <button data-tab="timing" class="px-4 py-2 rounded-lg text-sm font-semibold ${activeTab === 'timing' ? 'bg-brand-darkblue text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200'}">
          Etapptider <span data-role="timing-dirty-badge" class="${timingDirty > 0 ? '' : 'hidden '}ml-1 rounded-full bg-amber-200/80 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">${timingDirty}</span>
        </button>
        <button data-tab="obstacles" class="px-4 py-2 rounded-lg text-sm font-semibold ${activeTab === 'obstacles' ? 'bg-brand-darkblue text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200'}">
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
        <td colspan="8" class="px-4 py-8 text-center text-gray-500 dark:text-gray-400">Inga ekipage matchar filtret.</td>
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
        </td>
        <td class="px-3 py-3 text-sm text-gray-700 dark:text-gray-200 whitespace-nowrap">${escapeHtml(String(row.obstacleCount || 0))}</td>
        <td class="px-3 py-3 text-sm whitespace-nowrap">${renderStatusBadge(view.status, row.finalized)}</td>
        <td class="px-3 py-3 text-sm whitespace-nowrap">
          <div class="flex flex-col gap-2">
            ${readOnly ? `
              <button data-action="unlock" class="rounded bg-amber-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-amber-700">Lås upp</button>
            ` : `
              <button data-action="save-timing" class="rounded bg-brand-darkblue text-white px-3 py-1.5 text-xs font-semibold hover:opacity-90">Spara</button>
              <button data-action="reset-timing" class="rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">Ångra</button>
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
        <div class="flex flex-wrap items-center gap-2">
          <div class="text-sm text-gray-500 dark:text-gray-400">${visibleRows.length} av ${rows.length} ekipage visas</div>
          <button data-action="save-all-timing" ${dirtyCount === 0 ? 'disabled' : ''} class="rounded bg-brand-darkblue text-white px-3 py-2 text-xs font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed">Spara alla</button>
          <button data-action="reset-all-timing" ${dirtyCount === 0 ? 'disabled' : ''} class="rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed">Ångra alla</button>
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
              <th class="px-3 py-3">Hinder</th>
              <th class="px-3 py-3">Status</th>
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
    const totalPenalty = Number(view.timePenalty || 0) + Number(view.knockdownPenalty || 0) + Number(view.otherPenalty || 0);

    return `
      <tr data-obstacle="${escapeHtml(row.obstacleNumber)}" class="border-t border-gray-200 dark:border-gray-700 ${isDirty ? 'bg-amber-50/70 dark:bg-amber-900/10' : ''}">
        <td class="px-3 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100 whitespace-nowrap">${escapeHtml(row.obstacleNumber)}</td>
        <td class="px-3 py-3 text-sm min-w-[7rem]">
          <input data-field="timeInSeconds" value="${escapeHtml(formatSeconds(view.timeInSeconds))}" ${readOnly ? 'disabled' : ''} class="w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60">
        </td>
        <td class="px-3 py-3 text-sm min-w-[6rem]">
          <input data-field="timePenalty" type="number" step="0.01" value="${escapeHtml(view.timePenalty ?? 0)}" ${readOnly ? 'disabled' : ''} class="w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60">
        </td>
        <td class="px-3 py-3 text-sm min-w-[5rem]">
          <input data-field="knockdowns" type="number" step="1" value="${escapeHtml(view.knockdowns ?? 0)}" ${readOnly ? 'disabled' : ''} class="w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60">
        </td>
        <td class="px-3 py-3 text-sm min-w-[6rem]">
          <input data-field="knockdownPenalty" type="number" step="0.01" value="${escapeHtml(view.knockdownPenalty ?? 0)}" ${readOnly ? 'disabled' : ''} class="w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60">
        </td>
        <td class="px-3 py-3 text-sm min-w-[6rem]">
          <input data-field="otherPenalty" type="number" step="0.01" value="${escapeHtml(view.otherPenalty ?? 0)}" ${readOnly ? 'disabled' : ''} class="w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60">
        </td>
        <td data-role="obstacle-total" class="px-3 py-3 text-sm text-gray-900 dark:text-gray-100 whitespace-nowrap">${escapeHtml(totalPenalty.toFixed(2).replace(/\.00$/, ''))}</td>
        <td class="px-3 py-3 text-sm text-center">
          <input data-field="eliminated" type="checkbox" ${view.eliminated ? 'checked' : ''} ${readOnly ? 'disabled' : ''} class="h-4 w-4 rounded border-gray-300 text-red-600 disabled:opacity-60">
        </td>
        <td class="px-3 py-3 text-sm min-w-[14rem]">
          <input data-field="comment" value="${escapeHtml(view.comment || '')}" ${readOnly ? 'disabled' : ''} class="w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60">
        </td>
        <td class="px-3 py-3 text-sm whitespace-nowrap">
          ${readOnly ? `
            <span class="text-xs text-gray-500 dark:text-gray-400">Lås upp i headern</span>
          ` : `
            <div class="flex flex-col gap-2">
              <button data-action="save-obstacle" class="rounded bg-brand-darkblue text-white px-3 py-1.5 text-xs font-semibold hover:opacity-90">Spara</button>
              <button data-action="reset-obstacle" class="rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">Ångra</button>
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
          <div class="flex flex-wrap gap-2">
            <button data-action="save-all-obstacles" ${dirtyCount === 0 ? 'disabled' : ''} class="rounded bg-brand-darkblue text-white px-3 py-2 text-xs font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed">Spara alla</button>
            <button data-action="reset-all-obstacles" ${dirtyCount === 0 ? 'disabled' : ''} class="rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed">Ångra alla</button>
            ${baseRow.finalized
              ? '<button data-action="unlock-selected" class="rounded bg-amber-600 text-white px-3 py-2 text-xs font-semibold hover:bg-amber-700">Lås upp ekipage</button>'
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
    <div class="min-w-[1240px] max-w-7xl mx-auto px-4 py-4">
      ${getCompetitionHeader(competition, 'Sekretariat Maraton')}
      ${renderTabs()}
      ${activeTab === 'timing' ? renderTimingTab() : renderObstacleTab()}
    </div>
  `;

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

  return {
    startNumber: baseRow.startNumber,
    className: baseRow.className,
    duration_A: durationA ?? 0,
    duration_B: durationB ?? 0,
  };
}

function updateTimingDraft(rowEl) {
  const sn = String(rowEl.dataset.sn);
  const baseRow = getRowByStartNumber(sn);
  if (!baseRow || baseRow.finalized) return;

  try {
    const patch = collectTimingPatch(rowEl, baseRow);
    const hasChanges = JSON.stringify({
      duration_A: patch.duration_A,
      duration_B: patch.duration_B,
    }) !== JSON.stringify({
      duration_A: baseRow.duration_A || 0,
      duration_B: baseRow.duration_B || 0,
    });

    if (hasChanges) {
      timingDrafts.set(sn, patch);
      markRowDirty(rowEl, true);
    } else {
      timingDrafts.delete(sn);
      clearRowDirty(rowEl);
    }
  } catch {
    timingDrafts.set(sn, { __invalid: true });
    markRowDirty(rowEl, true);
  }

  syncDraftUiState();
}

function collectObstaclePatch(rowEl, baseRow) {
  const timeInSeconds = parseSeconds(rowEl.querySelector('[data-field="timeInSeconds"]')?.value || '');
  const timePenalty = Number(rowEl.querySelector('[data-field="timePenalty"]')?.value || 0);
  const knockdowns = Number(rowEl.querySelector('[data-field="knockdowns"]')?.value || 0);
  const knockdownPenalty = Number(rowEl.querySelector('[data-field="knockdownPenalty"]')?.value || 0);
  const otherPenalty = Number(rowEl.querySelector('[data-field="otherPenalty"]')?.value || 0);

  return {
    obstacleNumber: baseRow.obstacleNumber,
    timeInSeconds,
    timePenalty: Number.isFinite(timePenalty) ? timePenalty : 0,
    knockdowns: Number.isFinite(knockdowns) ? knockdowns : 0,
    knockdownPenalty: Number.isFinite(knockdownPenalty) ? knockdownPenalty : 0,
    otherPenalty: Number.isFinite(otherPenalty) ? otherPenalty : 0,
    penalty: (Number.isFinite(timePenalty) ? timePenalty : 0)
      + (Number.isFinite(knockdownPenalty) ? knockdownPenalty : 0)
      + (Number.isFinite(otherPenalty) ? otherPenalty : 0),
    eliminated: !!rowEl.querySelector('[data-field="eliminated"]')?.checked,
    comment: rowEl.querySelector('[data-field="comment"]')?.value?.trim() || '',
  };
}

function updateObstacleDraft(rowEl) {
  const obstacleNumber = String(rowEl.dataset.obstacle);
  const baseRow = obstacleRows.find(row => String(row.obstacleNumber) === obstacleNumber);
  if (!baseRow) return;

  try {
    const patch = collectObstaclePatch(rowEl, baseRow);
    const totalCell = rowEl.querySelector('[data-role="obstacle-total"]');
    if (totalCell) {
      totalCell.textContent = Number(patch.penalty || 0).toFixed(2).replace(/\.00$/, '');
    }

    const hasChanges = JSON.stringify({
      timeInSeconds: patch.timeInSeconds,
      timePenalty: patch.timePenalty,
      knockdowns: patch.knockdowns,
      knockdownPenalty: patch.knockdownPenalty,
      otherPenalty: patch.otherPenalty,
      eliminated: patch.eliminated,
      comment: patch.comment,
    }) !== JSON.stringify({
      timeInSeconds: baseRow.timeInSeconds || 0,
      timePenalty: baseRow.timePenalty || 0,
      knockdowns: baseRow.knockdowns || 0,
      knockdownPenalty: baseRow.knockdownPenalty || 0,
      otherPenalty: baseRow.otherPenalty || 0,
      eliminated: !!baseRow.eliminated,
      comment: baseRow.comment || '',
    });

    if (hasChanges) {
      obstacleDrafts.set(obstacleNumber, patch);
      markRowDirty(rowEl, true);
    } else {
      obstacleDrafts.delete(obstacleNumber);
      clearRowDirty(rowEl);
    }
  } catch {
    obstacleDrafts.set(obstacleNumber, { __invalid: true });
    markRowDirty(rowEl, true);
  }

  syncDraftUiState();
}

async function saveAllTimingDrafts() {
  if (hasInvalidTimingDraft()) {
    throw new Error('Det finns ogiltiga etapptider. Rätta dem innan du sparar alla.');
  }

  const entries = Array.from(timingDrafts.entries()).filter(([, patch]) => patch && !patch.__invalid);
  for (const [sn, patch] of entries) {
    await saveSecretariatMarathonTiming(competitionId, sn, patch, 'Sekretariatskorrigering etapptid');
  }
}

async function saveAllObstacleDrafts() {
  if (hasInvalidObstacleDraft()) {
    throw new Error('Det finns ogiltiga hinderändringar. Rätta dem innan du sparar alla.');
  }

  const entries = Array.from(obstacleDrafts.entries()).filter(([, patch]) => patch && !patch.__invalid);
  for (const [obstacleNumber, patch] of entries) {
    await saveSecretariatMarathonObstacle(
      competitionId,
      selectedStartNumber,
      obstacleNumber,
      patch,
      'Sekretariatskorrigering hinder'
    );
  }
}

async function refreshRows() {
  rows = await loadSecretariatMarathonRows(competitionId);
}

async function refreshObstacleDetail() {
  obstacleDrafts = new Map();
  if (!selectedStartNumber) {
    obstacleRows = [];
    return;
  }
  const detail = await loadSecretariatMarathonObstacleDetail(competitionId, selectedStartNumber);
  obstacleRows = detail.obstacles || [];
}

async function refreshAll() {
  await refreshRows();
  if (selectedStartNumber) {
    const stillExists = getRowByStartNumber(selectedStartNumber);
    if (!stillExists) selectedStartNumber = null;
  }
  if (activeTab === 'obstacles' || selectedStartNumber) {
    await refreshObstacleDetail();
  }
  timingDrafts = new Map();
  render();
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
      await saveAllTimingDrafts();
      showAlert('Alla etapptider sparade.');
      await refreshAll();
      return;
    }

    if (action === 'reset-all-timing') {
      if (!(await confirmDiscardTimingDrafts())) return;
      timingDrafts = new Map();
      render();
      return;
    }

    if (action === 'save-all-obstacles' && selectedStartNumber) {
      await saveAllObstacleDrafts();
      showAlert(`Alla hinder sparade för #${selectedStartNumber}.`);
      await refreshAll();
      activeTab = 'obstacles';
      await refreshObstacleDetail();
      render();
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
      await refreshAll();
      activeTab = 'obstacles';
      await refreshObstacleDetail();
      render();
      return;
    }

    if (action === 'finalize-selected' && selectedStartNumber) {
      if (hasObstacleDrafts()) {
        showAlert('Spara hinderändringarna innan du finaliserar ekipaget.', false);
        return;
      }
      await refinalizeResult(competitionId, 'marathon', selectedStartNumber);
      showAlert(`Maraton #${selectedStartNumber} finaliserat.`);
      await refreshAll();
      activeTab = 'obstacles';
      await refreshObstacleDetail();
      render();
      return;
    }

    const timingRow = button.closest('tr[data-sn]');
    if (timingRow) {
      const sn = timingRow.dataset.sn;
      const baseRow = getRowByStartNumber(sn);
      if (!baseRow) return;

      if (action === 'open-obstacles') {
        if (!(await confirmDiscardTimingDrafts())) return;
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

      if (action === 'save-timing') {
        const patch = collectTimingPatch(timingRow, baseRow);
        await saveSecretariatMarathonTiming(competitionId, sn, patch, 'Sekretariatskorrigering etapptid');
        showAlert(`Etapptider sparade för #${sn}.`);
        await refreshAll();
        return;
      }

      if (action === 'finalize') {
        if (timingDrafts.has(sn) && timingDrafts.get(sn)?.__invalid) {
          throw new Error('Rätta ogiltiga tider innan du finaliserar.');
        }
        const patch = collectTimingPatch(timingRow, baseRow);
        await saveSecretariatMarathonTiming(competitionId, sn, patch, 'Sekretariatskorrigering före återfinalisering');
        await refinalizeResult(competitionId, 'marathon', sn);
        showAlert(`Maraton #${sn} finaliserat.`);
        await refreshAll();
        return;
      }
    }

    const obstacleRow = button.closest('tr[data-obstacle]');
    if (obstacleRow && selectedStartNumber) {
      const obstacleNumber = obstacleRow.dataset.obstacle;
      const baseRow = obstacleRows.find(row => String(row.obstacleNumber) === obstacleNumber);
      if (!baseRow) return;

      if (action === 'reset-obstacle') {
        obstacleDrafts.delete(obstacleNumber);
        render();
        return;
      }

      if (action === 'save-obstacle') {
        const patch = collectObstaclePatch(obstacleRow, baseRow);
        await saveSecretariatMarathonObstacle(competitionId, selectedStartNumber, obstacleNumber, patch, 'Sekretariatskorrigering hinder');
        showAlert(`Hinder ${obstacleNumber} sparat för #${selectedStartNumber}.`);
        await refreshAll();
        activeTab = 'obstacles';
        await refreshObstacleDetail();
        render();
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
      filters.search = value;
      render();
      const searchInput = rootEl.querySelector('#secretariatSearch');
      searchInput?.focus();
      try {
        searchInput?.setSelectionRange(value.length, value.length);
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

    rootEl.querySelectorAll('tbody tr[data-sn] input').forEach(input => {
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
    rootEl.innerHTML = '<div class="max-w-4xl mx-auto p-6 text-center text-gray-500">Ingen tävling vald.</div>';
    return;
  }

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
  timingDrafts = new Map();
  obstacleDrafts = new Map();
  obstacleRows = [];
  selectedStartNumber = null;
  activeTab = 'timing';
}
