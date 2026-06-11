import { getGlobalState } from '../../main.js';
import { getCompetitionHeader, showAlert } from '../../ui/components.js';
import { t } from '../../utils/i18n.js';
import {
  clearRowDirty,
  derivePrecisionStatus,
  escapeHtml,
  filterRows,
  formatEditableTime,
  initializeToolbarInteractions,
  markRowDirty,
  parseEditableTime,
  renderFieldModeBanner,
  renderStatusBadge,
  renderToolbar,
  setupStickyTableHeaders,
} from './secretariat-shared.js';
import {
  loadSecretariatPrecisionRows,
  refinalizeResult,
  saveSecretariatPrecisionRow,
  unlockResult,
} from '../../services/secretariatService.js';

let rootEl = null;
let competitionId = null;
let rows = [];
let drafts = new Map();
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

function getVisibleRows() {
  return filterRows(rows, filters);
}

function draftFor(row) {
  const draft = drafts.get(String(row.startNumber));
  return draft ? { ...row, ...draft, status: derivePrecisionStatus({ ...row, ...draft }) } : row;
}

function buildTableRows() {
  const visibleRows = getVisibleRows();
  if (visibleRows.length === 0) {
    return `
      <tr>
        <td colspan="10" class="px-4 py-8 text-center text-gray-500 dark:text-gray-400">Inga ekipage matchar filtret.</td>
      </tr>
    `;
  }

  return visibleRows.map(row => {
    const view = draftFor(row);
    const isDirty = drafts.has(String(row.startNumber));
    const readOnly = row.finalized === true;
    const totalPenalty = Number(view.obstaclePenalty || 0) + Number(view.timePenalty || 0) + Number(view.extraPenalty || 0);

    return `
      <tr data-sn="${escapeHtml(row.startNumber)}" class="border-t border-gray-200 dark:border-gray-700 align-top ${isDirty ? 'bg-amber-50/70 dark:bg-amber-900/10' : ''}">
        <td class="px-3 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100 whitespace-nowrap">#${escapeHtml(row.startNumber)}</td>
        <td class="px-3 py-3 text-sm text-gray-900 dark:text-gray-100 min-w-[14rem]">
          <div class="font-medium">${escapeHtml(row.driverName || '-')}</div>
          <div class="text-xs text-gray-500 dark:text-gray-400">${escapeHtml(row.className || '')}</div>
        </td>
        <td class="px-3 py-3 text-sm min-w-[8rem]">
          <input data-field="timeMs" value="${escapeHtml(formatEditableTime(view.timeMs))}" ${readOnly ? 'disabled' : ''} class="w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60">
        </td>
        <td class="px-3 py-3 text-sm min-w-[4.75rem]">
          <input data-field="obstaclePenalty" type="number" step="0.1" value="${escapeHtml(view.obstaclePenalty ?? 0)}" ${readOnly ? 'disabled' : ''} class="w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60">
        </td>
        <td class="px-3 py-3 text-sm min-w-[4.75rem]">
          <input data-field="timePenalty" type="number" step="0.1" value="${escapeHtml(view.timePenalty ?? 0)}" ${readOnly ? 'disabled' : ''} class="w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60">
        </td>
        <td class="px-3 py-3 text-sm min-w-[4.75rem]">
          <input data-field="extraPenalty" type="number" step="0.1" value="${escapeHtml(view.extraPenalty ?? 0)}" ${readOnly ? 'disabled' : ''} class="w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60">
        </td>
        <td data-role="total" class="px-3 py-3 text-sm text-gray-900 dark:text-gray-100 whitespace-nowrap">${escapeHtml(totalPenalty.toFixed(2).replace(/\.00$/, ''))}</td>
        <td class="px-3 py-3 text-sm text-center">
          <input data-field="eliminated" type="checkbox" ${view.eliminated ? 'checked' : ''} ${readOnly ? 'disabled' : ''} class="h-4 w-4 rounded border-gray-300 text-red-600 disabled:opacity-60">
        </td>
        <td class="px-3 py-3 text-sm min-w-[14rem]">
          <textarea data-field="comment" rows="1" ${readOnly ? 'disabled' : ''} class="w-full resize-none overflow-hidden rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60 leading-5">${escapeHtml(view.comment || '')}</textarea>
        </td>
        <td class="px-3 py-3 text-sm whitespace-nowrap">${renderStatusBadge(view.status, row.finalized)}</td>
        <td class="px-3 py-3 text-sm whitespace-nowrap">
          <div class="flex flex-col gap-2">
            ${readOnly ? `
              <button data-action="unlock" class="rounded bg-amber-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-amber-700">${escapeHtml(t('unlock'))}</button>
            ` : `
              <button data-action="save" class="rounded bg-brand-darkblue text-white px-3 py-1.5 text-xs font-semibold hover:opacity-90">Spara</button>
              <button data-action="reset" class="rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">${escapeHtml(t('undo'))}</button>
              <button data-action="finalize" class="rounded border border-emerald-600 text-emerald-700 dark:text-emerald-400 px-3 py-1.5 text-xs font-semibold hover:bg-emerald-50 dark:hover:bg-emerald-900/20">Finalisera</button>
            `}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function render() {
  if (!rootEl) return;
  try { teardownStickyHeaders?.(); } catch (_) {}
  teardownStickyHeaders = null;

  const competition = getGlobalState('currentCompetition');
  const classOptions = getClassOptions();
  const visibleRows = getVisibleRows();

  rootEl.innerHTML = `
    <div class="min-w-[1520px] max-w-none mx-auto px-4 py-4">
      ${getCompetitionHeader(competition, t('secretariat_precision_title'))}
      ${renderFieldModeBanner(competition, {
        message: 'Tävlingen körs i fältläge. Registrera tider och straff manuellt här och använd sekretariatet för upplåsning och återfinalisering.',
      })}
      <section class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 mb-4">
        <div class="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100">Korrigering av resultat</h2>
            <p class="text-sm text-gray-600 dark:text-gray-400">Separat sekretariatsvy för ändringar efter ordinarie inmatning.</p>
          </div>
          <div class="text-sm text-gray-500 dark:text-gray-400">${visibleRows.length} av ${rows.length} ekipage visas</div>
        </div>
      </section>
      ${renderToolbar({
        searchValue: filters.search,
        statusValue: filters.status,
        classValue: filters.className,
        classOptions,
      })}
    <section class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
      <div class="secretariat-x-wrap">
        <table class="min-w-full secretariat-page-table">
          <thead class="bg-gray-50 dark:bg-gray-900/50">
              <tr class="text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <th class="px-3 py-3">Start</th>
                <th class="px-3 py-3">Ekipage</th>
                <th class="px-3 py-3">Tid</th>
                <th class="px-3 py-3">Hinder</th>
                <th class="px-3 py-3">Tidstraff</th>
                <th class="px-3 py-3">Övrigt</th>
                <th class="px-3 py-3">Totalt</th>
                <th class="px-3 py-3">Elim.</th>
                <th class="px-3 py-3">Kommentar</th>
                <th class="px-3 py-3">${escapeHtml(t('status'))}</th>
                <th class="px-3 py-3">Åtgärder</th>
              </tr>
            </thead>
            <tbody>
              ${buildTableRows()}
            </tbody>
        </table>
      </div>
    </section>
    </div>
  `;

  initializeToolbarInteractions(rootEl);
  wireEvents();
  teardownStickyHeaders = setupStickyTableHeaders(rootEl);
}

function collectPatch(rowEl, baseRow) {
  const timeMs = parseEditableTime(rowEl.querySelector('[data-field="timeMs"]')?.value || '');
  if ((rowEl.querySelector('[data-field="timeMs"]')?.value || '').trim() && timeMs == null) {
    throw new Error('Ogiltigt tidsformat. Använd mm:ss,cc eller sekunder.');
  }

  const obstaclePenalty = Number(rowEl.querySelector('[data-field="obstaclePenalty"]')?.value || 0);
  const timePenalty = Number(rowEl.querySelector('[data-field="timePenalty"]')?.value || 0);
  const extraPenalty = Number(rowEl.querySelector('[data-field="extraPenalty"]')?.value || 0);

  return {
    startNumber: baseRow.startNumber,
    driverName: baseRow.driverName,
    className: baseRow.className,
    timeMs: timeMs ?? 0,
    obstaclePenalty: Number.isFinite(obstaclePenalty) ? obstaclePenalty : 0,
    timePenalty: Number.isFinite(timePenalty) ? timePenalty : 0,
    extraPenalty: Number.isFinite(extraPenalty) ? extraPenalty : 0,
    eliminated: !!rowEl.querySelector('[data-field="eliminated"]')?.checked,
    comment: rowEl.querySelector('[data-field="comment"]')?.value?.trim() || '',
  };
}

function updateDraft(rowEl) {
  const sn = String(rowEl.dataset.sn);
  const baseRow = rows.find(row => String(row.startNumber) === sn);
  if (!baseRow || baseRow.finalized) return;

  try {
    const patch = collectPatch(rowEl, baseRow);
    const totalCell = rowEl.querySelector('[data-role="total"]');
    if (totalCell) {
      const totalPenalty = Number(patch.obstaclePenalty || 0) + Number(patch.timePenalty || 0) + Number(patch.extraPenalty || 0);
      totalCell.textContent = totalPenalty.toFixed(2).replace(/\.00$/, '');
    }

    const hasChanges = JSON.stringify({
      timeMs: patch.timeMs,
      obstaclePenalty: patch.obstaclePenalty,
      timePenalty: patch.timePenalty,
      extraPenalty: patch.extraPenalty,
      eliminated: patch.eliminated,
      comment: patch.comment,
    }) !== JSON.stringify({
      timeMs: baseRow.timeMs || 0,
      obstaclePenalty: baseRow.obstaclePenalty || 0,
      timePenalty: baseRow.timePenalty || 0,
      extraPenalty: baseRow.extraPenalty || 0,
      eliminated: !!baseRow.eliminated,
      comment: baseRow.comment || '',
    });

    if (hasChanges) {
      drafts.set(sn, patch);
      markRowDirty(rowEl, true);
    } else {
      drafts.delete(sn);
      clearRowDirty(rowEl);
    }
  } catch {
    drafts.set(sn, { __invalid: true });
    markRowDirty(rowEl, true);
  }
}

async function refreshData() {
  rows = await loadSecretariatPrecisionRows(competitionId);
  drafts = new Map();
  render();
}

async function handleAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const rowEl = button.closest('tr[data-sn]');
  if (!rowEl) return;

  const sn = rowEl.dataset.sn;
  const baseRow = rows.find(row => String(row.startNumber) === sn);
  if (!baseRow) return;

  const action = button.dataset.action;

  try {
    if (action === 'unlock') {
      await unlockResult(competitionId, 'precision', sn);
      showAlert(`Resultat #${sn} upplåst.`);
      await refreshData();
      return;
    }

    if (action === 'reset') {
      drafts.delete(sn);
      render();
      return;
    }

    if (action === 'save') {
      const patch = collectPatch(rowEl, baseRow);
      await saveSecretariatPrecisionRow(competitionId, sn, patch, 'Sekretariatskorrigering');
      showAlert(`Ändringar sparade för #${sn}.`);
      await refreshData();
      return;
    }

    if (action === 'finalize') {
      const patch = collectPatch(rowEl, baseRow);
      await saveSecretariatPrecisionRow(competitionId, sn, patch, 'Sekretariatskorrigering före återfinalisering');
      await refinalizeResult(competitionId, 'precision', sn);
      showAlert(`Resultat #${sn} finaliserat.`);
      await refreshData();
    }
  } catch (error) {
    console.error('Secretariat precision action failed:', error);
    showAlert(error.message || 'Kunde inte genomföra åtgärden.', false);
  }
}

function wireEvents() {
  rootEl.querySelector('#secretariatSearch')?.addEventListener('input', event => {
    const value = event.target.value || '';
    filters.search = value;
    render();
    const searchInput = rootEl.querySelector('#secretariatSearch');
    searchInput?.focus();
    try {
      searchInput?.setSelectionRange(value.length, value.length);
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

  rootEl.querySelectorAll('tbody tr[data-sn] input').forEach(input => {
    input.addEventListener('input', event => updateDraft(event.target.closest('tr[data-sn]')));
    input.addEventListener('change', event => updateDraft(event.target.closest('tr[data-sn]')));
  });

  rootEl.querySelectorAll('tbody tr[data-sn] textarea[data-field="comment"]').forEach(textarea => {
    autoSizeCommentBox(textarea);
    textarea.addEventListener('input', event => {
      autoSizeCommentBox(event.target);
      updateDraft(event.target.closest('tr[data-sn]'));
    });
    textarea.addEventListener('change', event => {
      autoSizeCommentBox(event.target);
      updateDraft(event.target.closest('tr[data-sn]'));
    });
  });

  rootEl.querySelector('tbody')?.addEventListener('click', handleAction);
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
    rootEl.innerHTML = '<div class="max-w-4xl mx-auto p-6 text-center text-gray-500">Ingen tävling vald.</div>';
    return;
  }

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
  drafts = new Map();
}
