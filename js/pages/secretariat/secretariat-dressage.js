import { getGlobalState } from '../../main.js';
import { getCompetitionHeader, showAlert } from '../../ui/components.js';
import { ensureClubLogosLoaded, getClubLogoHtml } from '../../services/logosService.js';
import { getFlagHtml } from '../../services/flagsService.js';
import { t } from '../../utils/i18n.js';
import {
  deriveDressageStatus,
  escapeHtml,
  filterRows,
  initializeToolbarInteractions,
  renderFieldModeBanner,
  renderStatusBadge,
  renderToolbar,
  setupStickyTableHeaders,
} from './secretariat-shared.js';
import {
  loadSecretariatDressageDetail,
  loadSecretariatDressageRows,
  refinalizeResult,
  saveSecretariatDressageGeneral,
  saveSecretariatDressageProtocol,
  unlockResult,
} from '../../services/secretariatService.js';

let rootEl = null;
let competitionId = null;
let rows = [];
let selectedStartNumber = null;
let selectedProtocolId = 'general';
let detailData = null;
let modalEl = null;
let modalKeyHandler = null;
let teardownStickyHeaders = null;
let filters = {
  search: '',
  status: 'all',
  className: 'all',
};

function ensureStickyTableStyles() {
  if (document.getElementById('secretariat-sticky-table-styles')) return;

  const style = document.createElement('style');
  style.id = 'secretariat-sticky-table-styles';
  style.textContent = `
    .secretariat-page-table,
    .secretariat-modal-table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
    }
    .secretariat-page-table th,
    .secretariat-page-table td,
    .secretariat-modal-table th,
    .secretariat-modal-table td {
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
    .secretariat-modal-table thead th {
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
    html.dark .secretariat-page-table thead th,
    html.dark .secretariat-modal-table thead th {
      background: #1f2937;
    }
  `;
  document.head.appendChild(style);
}

function getDressageHorseLabel(equipage) {
  if (!equipage || typeof equipage !== 'object') return '—';

  const allHorsesRaw = equipage.horses || equipage.horseNames || equipage.horse || [];
  let allHorses = [];

  if (Array.isArray(allHorsesRaw)) {
    allHorses = allHorsesRaw
      .map(horse => (typeof horse === 'string' ? { name: horse } : horse))
      .filter(horse => horse && horse.name);
  } else if (typeof allHorsesRaw === 'string' && allHorsesRaw.trim()) {
    allHorses = allHorsesRaw
      .split(/[\/,&+]|(?:\s*&\s*)/)
      .map(name => ({ name: name.trim() }))
      .filter(horse => horse.name);
  } else if (typeof allHorsesRaw === 'object' && allHorsesRaw?.name) {
    allHorses = [allHorsesRaw];
  }

  if (allHorses.length === 0) return '—';

  const horseMap = new Map(allHorses.map(horse => [horse.id || horse.name, horse.name]));
  const selected = Array.isArray(equipage.momentHorses?.dressage) ? equipage.momentHorses.dressage : [];
  const names = selected.length > 0
    ? selected.map(id => horseMap.get(id) || id).filter(Boolean)
    : allHorses.map(horse => horse.name).filter(Boolean);

  return names.length > 0 ? names.join(' • ') : '—';
}

function ensureModal() {
  if (modalEl && document.body.contains(modalEl)) return modalEl;

  if (!document.getElementById('secretariat-dressage-modal-styles')) {
    const style = document.createElement('style');
    style.id = 'secretariat-dressage-modal-styles';
    style.textContent = `
      .secretariat-dressage-modal-overlay {
        position: fixed;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 20px;
        background: rgba(15, 23, 42, 0.58);
        backdrop-filter: blur(6px);
        z-index: 2147483647;
      }
      .secretariat-dressage-modal-overlay.visible {
        display: flex;
      }
      .secretariat-dressage-modal-card {
        width: min(1100px, 100%);
        height: min(92vh, calc(100vh - 40px));
        max-height: calc(100vh - 40px);
        overflow: hidden;
        border-radius: 18px;
        background: #ffffff;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.35);
        display: flex;
        flex-direction: column;
        min-height: 0;
      }
      .secretariat-dressage-modal-shell {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-height: 0;
        height: 100%;
      }
      .secretariat-dressage-modal-head {
        position: sticky;
        top: 0;
        z-index: 1;
        padding: 16px 20px;
        border-bottom: 1px solid #e5e7eb;
        background: rgba(255,255,255,0.94);
        backdrop-filter: blur(10px);
      }
      .secretariat-dressage-modal-body {
        overflow: auto;
        padding: 20px;
        flex: 1 1 auto;
        min-height: 0;
      }
      .secretariat-dressage-sticky-actions {
        position: sticky;
        bottom: -20px;
        margin-top: 20px;
        margin-left: -20px;
        margin-right: -20px;
        padding: 14px 20px;
        border-top: 1px solid #e5e7eb;
        background: rgba(255,255,255,0.96);
        backdrop-filter: blur(10px);
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }
      .secretariat-dressage-shortcuts {
        margin-top: 8px;
        font-size: 11px;
        color: #6b7280;
      }
      html.dark .secretariat-dressage-modal-card {
        background: #1f2937;
        color: #f3f4f6;
      }
      html.dark .secretariat-dressage-modal-head {
        background: rgba(31,41,55,0.94);
        border-bottom-color: #374151;
      }
      html.dark .secretariat-dressage-sticky-actions {
        border-top-color: #374151;
        background: rgba(31,41,55,0.96);
      }
      html.dark .secretariat-dressage-shortcuts {
        color: #9ca3af;
      }
    `;
    document.head.appendChild(style);
  }

  modalEl = document.createElement('div');
  modalEl.className = 'secretariat-dressage-modal-overlay';
  modalEl.innerHTML = `
    <div class="secretariat-dressage-modal-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(t('secretariat_dressage_details'))}">
      <div id="secretariatDressageModalContent" class="secretariat-dressage-modal-shell"></div>
    </div>
  `;

  modalEl.addEventListener('click', async event => {
    if (event.target === modalEl) {
      if (await confirmDiscardIfDirty()) closeDetailModal();
    }
  });

  document.body.appendChild(modalEl);
  return modalEl;
}

function closeDetailModal() {
  if (!modalEl) return;
  modalEl.classList.remove('visible');
  document.body.classList.remove('modal-open');
}

function getDetailScope() {
  if (modalEl?.classList.contains('visible')) return modalEl;
  return rootEl;
}

function getSelectedProtocol() {
  if (selectedProtocolId === 'general') return null;
  return (detailData?.protocols || []).find(item => item.id === selectedProtocolId) || detailData?.protocols?.[0] || null;
}

function buildGeneralStateFromDom() {
  const scope = getDetailScope();
  return {
    errorPoints: Number(scope?.querySelector('#dressageGeneralErrorPoints')?.value || 0),
    errorComment: scope?.querySelector('#dressageGeneralErrorComment')?.value || '',
  };
}

function buildProtocolStateFromDom(protocol) {
  const scope = getDetailScope();
  const movements = Array.from(scope?.querySelectorAll('[data-movement-score]') || []).map(input => {
    const index = Number(input.dataset.movementScore);
    const score = Number(input.value || 0);
    const comment = scope?.querySelector(`[data-movement-comment="${index}"]`)?.value || '';
    const baseMovement = protocol?.movements?.[index] || {};
    return {
      momentNo: baseMovement.momentNo ?? index + 1,
      score: Number.isFinite(score) ? score : 0,
      comment,
    };
  });

  return {
    eliminated: !!scope?.querySelector('#dressageProtocolEliminated')?.checked,
    movements,
  };
}

function isCurrentDetailDirty() {
  if (!modalEl?.classList.contains('visible') || !detailData) return false;

  if (selectedProtocolId === 'general') {
    const current = buildGeneralStateFromDom();
    const base = {
      errorPoints: Number(detailData.general?.errorPoints || 0),
      errorComment: detailData.general?.errorComment || '',
    };
    return JSON.stringify(current) !== JSON.stringify(base);
  }

  const protocol = getSelectedProtocol();
  if (!protocol) return false;
  const current = buildProtocolStateFromDom(protocol);
  const base = {
    eliminated: !!protocol.eliminated,
    movements: Array.isArray(protocol.movements) ? protocol.movements.map(movement => ({
      momentNo: movement.momentNo ?? null,
      score: Number.isFinite(Number(movement.score)) ? Number(movement.score) : 0,
      comment: movement.comment || '',
    })) : [],
  };

  return JSON.stringify(current) !== JSON.stringify(base);
}

async function confirmDiscardIfDirty() {
  if (!isCurrentDetailDirty()) return true;
  return window.confirm('Du har osparade andringar. Vill du lamna utan att spara?');
}

function updateDetailDirtyUi() {
  if (!modalEl?.classList.contains('visible')) return;
  const dirty = isCurrentDetailDirty();
  const indicator = modalEl.querySelector('[data-role="detail-dirty-indicator"]');
  const note = modalEl.querySelector('[data-role="detail-dirty-note"]');
  const saveButton = modalEl.querySelector('button[data-action="save-detail"]');

  if (indicator) {
    indicator.classList.toggle('hidden', !dirty);
  }

  if (note) {
    note.classList.toggle('hidden', !dirty);
  }

  if (saveButton) {
    saveButton.classList.toggle('ring-2', dirty);
    saveButton.classList.toggle('ring-amber-300', dirty);
  }
}

function shouldIgnoreModalShortcut(event) {
  const target = event.target;
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function ensureModalKeyboardSupport() {
  if (modalKeyHandler) return;

  modalKeyHandler = async (event) => {
    if (!modalEl?.classList.contains('visible')) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      if (await confirmDiscardIfDirty()) closeDetailModal();
      return;
    }

    if (shouldIgnoreModalShortcut(event)) return;

    if (event.altKey && event.key === 'ArrowLeft') {
      event.preventDefault();
      await selectRelativeEquipage(-1);
      return;
    }

    if (event.altKey && event.key === 'ArrowRight') {
      event.preventDefault();
      await selectRelativeEquipage(1);
    }
  };

  document.addEventListener('keydown', modalKeyHandler);
}

function teardownModalKeyboardSupport() {
  if (!modalKeyHandler) return;
  document.removeEventListener('keydown', modalKeyHandler);
  modalKeyHandler = null;
}

function openDetailModal() {
  ensureModal();
  ensureModalKeyboardSupport();
  renderModalContent();
  modalEl.classList.add('visible');
  document.body.classList.add('modal-open');
}

function getClassOptions() {
  return [...new Set(rows.map(row => row.className).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'sv'));
}

function getVisibleRows() {
  return filterRows(rows, filters);
}

function getSelectedRow() {
  return rows.find(row => String(row.startNumber) === String(selectedStartNumber)) || null;
}

function getNavigableRows() {
  const visibleRows = getVisibleRows();
  return visibleRows.length > 0 ? visibleRows : rows;
}

function getSelectedRowPosition() {
  const navigable = getNavigableRows();
  const index = navigable.findIndex(row => String(row.startNumber) === String(selectedStartNumber));
  return {
    rows: navigable,
    index,
    total: navigable.length,
  };
}

function renderOverviewRows() {
  const visibleRows = getVisibleRows();
  if (visibleRows.length === 0) {
    return `
      <tr>
        <td colspan="8" class="px-4 py-8 text-center text-gray-500 dark:text-gray-400">Inga ekipage matchar filtret.</td>
      </tr>
    `;
  }

  return visibleRows.map(row => {
    const selected = String(selectedStartNumber || '') === String(row.startNumber);
    const penaltyLabel = row.finalPenalty == null ? '—' : String(row.finalPenalty);
    return `
      <tr data-sn="${escapeHtml(row.startNumber)}" class="border-t border-gray-200 dark:border-gray-700 ${selected ? 'bg-blue-50/60 dark:bg-blue-900/10' : ''}">
        <td class="px-3 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100 whitespace-nowrap">#${escapeHtml(row.startNumber)}</td>
        <td class="px-3 py-3 text-sm text-gray-900 dark:text-gray-100 min-w-[14rem]">
          <div class="font-medium">${escapeHtml(row.driverName || '-')}</div>
          <div class="text-xs text-gray-500 dark:text-gray-400">${escapeHtml(row.className || '')}</div>
        </td>
        <td class="px-3 py-3 text-sm text-gray-700 dark:text-gray-200 whitespace-nowrap">${escapeHtml(String(row.protocolCount || 0))}</td>
        <td class="px-3 py-3 text-sm text-gray-700 dark:text-gray-200 whitespace-nowrap">${escapeHtml(String(row.errorPoints || 0))}</td>
        <td class="px-3 py-3 text-sm text-gray-700 dark:text-gray-200 whitespace-nowrap">${escapeHtml(penaltyLabel)}</td>
        <td class="px-3 py-3 text-sm whitespace-nowrap">${renderStatusBadge(deriveDressageStatus(row), row.finalized)}</td>
        <td class="px-3 py-3 text-sm text-gray-600 dark:text-gray-300">${escapeHtml((row.judgeNames || []).join(', '))}</td>
        <td class="px-3 py-3 text-sm whitespace-nowrap">
          <button data-action="open-detail" class="rounded border border-blue-300 dark:border-blue-700 px-3 py-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20">Öppna</button>
        </td>
      </tr>
    `;
  }).join('');
}

function renderDetailTabs() {
  const protocols = detailData?.protocols || [];
  const protocolTabs = protocols.map(protocol => `
    <button
      data-tab="${escapeHtml(protocol.id)}"
      class="px-3 py-2 rounded-lg text-xs font-semibold ${selectedProtocolId === protocol.id ? 'bg-brand-darkblue text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200'}"
    >
      ${escapeHtml(protocol.judgePosition || protocol.judgeName || protocol.judgeId || protocol.id)}
    </button>
  `).join('');

  return `
    <div class="flex flex-wrap gap-2">
      <button
        data-tab="general"
        class="px-3 py-2 rounded-lg text-xs font-semibold ${selectedProtocolId === 'general' ? 'bg-brand-darkblue text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200'}"
      >
        Allmänt
      </button>
      ${protocolTabs}
    </div>
  `;
}

function renderGeneralEditor(readOnly) {
  const general = detailData?.general || {};
  return `
    <div class="grid gap-4 md:grid-cols-[12rem,1fr]">
      <label class="block">
        <span class="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Felpoäng</span>
        <input id="dressageGeneralErrorPoints" type="number" step="1" min="0" value="${escapeHtml(general.errorPoints ?? 0)}" ${readOnly ? 'disabled' : ''} class="w-full rounded border border-gray-300 dark:border-gray-600 p-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60">
      </label>
      <label class="block">
        <span class="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Kommentar</span>
        <textarea id="dressageGeneralErrorComment" rows="3" ${readOnly ? 'disabled' : ''} class="w-full rounded border border-gray-300 dark:border-gray-600 p-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60">${escapeHtml(general.errorComment || '')}</textarea>
      </label>
    </div>
  `;
}

function renderProtocolEditor(protocol, readOnly) {
  const movementRows = (protocol.movements || []).map((movement, index) => `
    <tr class="border-t border-gray-200 dark:border-gray-700">
      <td class="px-3 py-2 text-sm text-gray-700 dark:text-gray-200 whitespace-nowrap">${escapeHtml(String(movement.momentNo ?? index + 1))}</td>
      <td class="px-3 py-2 text-sm min-w-[7rem]">
        <input data-movement-score="${index}" type="number" step="0.1" min="0" max="10" value="${escapeHtml(movement.score ?? 0)}" ${readOnly ? 'disabled' : ''} class="w-full rounded border border-gray-300 dark:border-gray-600 p-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60">
      </td>
      <td class="px-3 py-2 text-sm min-w-[18rem]">
        <input data-movement-comment="${index}" value="${escapeHtml(movement.comment || '')}" ${readOnly ? 'disabled' : ''} class="w-full rounded border border-gray-300 dark:border-gray-600 p-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-60">
      </td>
    </tr>
  `).join('');

  return `
    <div class="grid gap-4 md:grid-cols-[12rem,12rem,1fr] mb-4">
      <label class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200">
        <input id="dressageProtocolEliminated" type="checkbox" ${protocol.eliminated ? 'checked' : ''} ${readOnly ? 'disabled' : ''} class="h-4 w-4 rounded border-gray-300 text-red-600 disabled:opacity-60">
        Eliminerad
      </label>
      <div class="text-sm text-gray-500 dark:text-gray-400">
        <div>Domare: ${escapeHtml(protocol.judgeName || protocol.judgeId || '')}</div>
        <div>Position: ${escapeHtml(protocol.judgePosition || '—')}</div>
      </div>
      <div class="text-sm text-gray-500 dark:text-gray-400">Program: ${escapeHtml(protocol.programKey || '—')}</div>
    </div>
    <table class="min-w-full secretariat-modal-table">
      <thead class="bg-gray-50 dark:bg-gray-900/50">
          <tr class="text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
            <th class="px-3 py-3">Moment</th>
            <th class="px-3 py-3">Poäng</th>
            <th class="px-3 py-3">Kommentar</th>
          </tr>
        </thead>
        <tbody>${movementRows}</tbody>
      </table>
  `;
}

function renderDetailPanel() {
  const selectedRow = getSelectedRow();
  if (!selectedRow || !detailData) {
    return '';
  }

  const readOnly = selectedRow.finalized === true;
  const protocol = selectedProtocolId === 'general'
    ? null
    : (detailData.protocols || []).find(item => item.id === selectedProtocolId) || detailData.protocols?.[0] || null;
  const { index, total } = getSelectedRowPosition();
  const hasMultiple = total > 1;
  const positionLabel = index >= 0 ? `${index + 1} / ${total}` : `1 / ${total || 1}`;

  return `
      <div class="secretariat-dressage-modal-head">
        <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100">Detaljredigering</h2>
          <p class="text-sm text-gray-600 dark:text-gray-400">Ekipage #${escapeHtml(selectedRow.startNumber)} - ${escapeHtml(selectedRow.driverName || '')}</p>
          <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
            <span>${escapeHtml(selectedRow.className || '')}</span>
            <span class="inline-flex items-center gap-1.5" title="${escapeHtml(selectedRow.clubName || '')}">
              ${getFlagHtml(selectedRow)}
              ${getClubLogoHtml(selectedRow, { className: 'inline-block h-4 w-auto', style: 'max-height:16px;' })}
              <span>${escapeHtml(selectedRow.clubName || '—')}</span>
            </span>
            <span class="truncate max-w-[28rem]">${escapeHtml(getDressageHorseLabel(selectedRow))}</span>
          </div>
          <div class="mt-2">
            <span data-role="detail-dirty-indicator" class="hidden inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Osparat</span>
          </div>
          <div class="secretariat-dressage-shortcuts">Kortkommandon: Esc stanger, Alt + vanster/hoger byter ekipage</div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          ${hasMultiple ? `
            <div class="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 px-2 py-1">
              <button data-action="prev-equipage" class="rounded border border-gray-300 dark:border-gray-600 px-2.5 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-white dark:hover:bg-gray-700">Föregående</button>
              <span class="text-xs font-medium text-gray-500 dark:text-gray-400 min-w-[3rem] text-center">${escapeHtml(positionLabel)}</span>
              <button data-action="next-equipage" class="rounded border border-gray-300 dark:border-gray-600 px-2.5 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-white dark:hover:bg-gray-700">Nästa</button>
            </div>
          ` : ''}
          <button data-action="close-modal" class="rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">Stäng</button>
          ${readOnly
            ? `<button data-action="unlock" class="rounded bg-amber-600 text-white px-3 py-2 text-xs font-semibold hover:bg-amber-700">${escapeHtml(t('unlock'))}</button>`
            : '<button data-action="finalize" class="rounded border border-emerald-600 text-emerald-700 dark:text-emerald-400 px-3 py-2 text-xs font-semibold hover:bg-emerald-50 dark:hover:bg-emerald-900/20">Finalisera</button>'}
        </div>
      </div>
      </div>
      <div class="secretariat-dressage-modal-body">
      <div class="mb-4">${renderDetailTabs()}</div>
      <div class="space-y-4">
        ${selectedProtocolId === 'general' ? renderGeneralEditor(readOnly) : renderProtocolEditor(protocol, readOnly)}
      </div>
      ${readOnly ? '' : `
        <div class="secretariat-dressage-sticky-actions">
          <div data-role="detail-dirty-note" class="hidden mr-auto inline-flex items-center text-sm font-medium text-amber-700 dark:text-amber-300">Andringar ej sparade</div>
          <button data-action="save-detail" class="rounded bg-brand-darkblue text-white px-4 py-2 text-sm font-semibold hover:opacity-90">Spara</button>
          <button data-action="reload-detail" class="rounded border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">Ladda om</button>
        </div>
      `}
      </div>
  `;
}

function renderModalContent() {
  if (!modalEl) return;
  const content = modalEl.querySelector('#secretariatDressageModalContent');
  if (!content) return;

  if (!selectedStartNumber || !detailData) {
    content.innerHTML = `
      <div class="secretariat-dressage-modal-head">
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100">Detaljredigering</h2>
          <button data-action="close-modal" class="rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">Stäng</button>
        </div>
      </div>
      <div class="secretariat-dressage-modal-body text-gray-500 dark:text-gray-400">Ingen detalj vald.</div>
    `;
  } else {
    content.innerHTML = renderDetailPanel();
  }

  content.onclick = handleAction;
  content.oninput = () => updateDetailDirtyUi();
  content.onchange = () => updateDetailDirtyUi();
  updateDetailDirtyUi();
}

function render() {
  if (!rootEl) return;
  try { teardownStickyHeaders?.(); } catch (_) {}
  teardownStickyHeaders = null;
  const competition = getGlobalState('currentCompetition');
  const visibleRows = getVisibleRows();

  rootEl.innerHTML = `
    <div class="w-full max-w-7xl mx-auto px-3 py-4 sm:px-4">
      ${getCompetitionHeader(competition, t('secretariat_dressage_title'))}
      ${renderFieldModeBanner(competition, {
        message: 'Tävlingen körs i fältläge. Protokoll och allmänna fel hanteras manuellt här innan ekipagen åter finaliseras.',
      })}
      ${renderToolbar({
        searchValue: filters.search,
        statusValue: filters.status,
        classValue: filters.className,
        classOptions: getClassOptions(),
      })}
      <section class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 mb-4">
        <div class="px-4 py-4 flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100">Översikt</h2>
            <p class="text-sm text-gray-600 dark:text-gray-400">Öppna ett ekipage i modal för att korrigera protokoll eller allmänna fel utan att tappa din plats i översikten.</p>
          </div>
          <div class="text-sm text-gray-500 dark:text-gray-400">${visibleRows.length} av ${rows.length} ekipage visas</div>
        </div>
        <div class="secretariat-x-wrap">
        <table class="min-w-full secretariat-page-table">
          <thead class="bg-gray-50 dark:bg-gray-900/50">
              <tr class="text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <th class="px-3 py-3">Start</th>
                <th class="px-3 py-3">Ekipage</th>
                <th class="px-3 py-3">Protokoll</th>
                <th class="px-3 py-3">Felpoäng</th>
                <th class="px-3 py-3">Slutstraff</th>
                <th class="px-3 py-3">${escapeHtml(t('status'))}</th>
                <th class="px-3 py-3">Domare</th>
                <th class="px-3 py-3">Åtgärd</th>
              </tr>
            </thead>
            <tbody>${renderOverviewRows()}</tbody>
          </table>
        </div>
      </section>
    </div>
  `;

  initializeToolbarInteractions(rootEl);
  wireEvents();
  teardownStickyHeaders = setupStickyTableHeaders(rootEl);
  if (modalEl?.classList.contains('visible')) {
    renderModalContent();
  }
}

function collectProtocolPayload(protocol) {
  return {
    judgeId: protocol.judgeId,
    judgeName: protocol.judgeName,
    judgePosition: protocol.judgePosition,
    programKey: protocol.programKey,
    ...buildProtocolStateFromDom(protocol),
  };
}

async function refreshRows() {
  rows = await loadSecretariatDressageRows(competitionId);
}

async function refreshDetail() {
  if (!selectedStartNumber) {
    detailData = null;
    return;
  }
  detailData = await loadSecretariatDressageDetail(competitionId, selectedStartNumber);
  if (selectedProtocolId !== 'general') {
    const stillExists = detailData.protocols.some(protocol => protocol.id === selectedProtocolId);
    if (!stillExists) selectedProtocolId = detailData.protocols[0]?.id || 'general';
  }
}

async function selectRelativeEquipage(delta) {
  const { rows: navigableRows, index, total } = getSelectedRowPosition();
  if (total === 0) return;

  const safeIndex = index >= 0 ? index : 0;
  const nextIndex = (safeIndex + delta + total) % total;
  const nextRow = navigableRows[nextIndex];
  if (!nextRow) return;

  selectedStartNumber = String(nextRow.startNumber);
  selectedProtocolId = 'general';
  await refreshDetail();
  render();
  openDetailModal();
}

async function refreshAll() {
  await refreshRows();
  if (selectedStartNumber) {
    const row = getSelectedRow();
    if (!row) selectedStartNumber = null;
  }
  await refreshDetail();
  render();
}

async function handleAction(event) {
  const button = event.target.closest('button[data-action], button[data-tab]');
  if (!button) return;

  const tab = button.dataset.tab;
  if (tab) {
    if (!(await confirmDiscardIfDirty())) return;
    selectedProtocolId = tab;
    render();
    openDetailModal();
    return;
  }

  const action = button.dataset.action;
  try {
    if (action === 'close-modal') {
      if (await confirmDiscardIfDirty()) closeDetailModal();
      return;
    }

    if (action === 'open-detail') {
      const rowEl = button.closest('tr[data-sn]');
      if (!rowEl) return;
      if (modalEl?.classList.contains('visible') && !(await confirmDiscardIfDirty())) return;
      selectedStartNumber = rowEl.dataset.sn;
      selectedProtocolId = 'general';
      await refreshDetail();
      render();
      openDetailModal();
      return;
    }

    if (action === 'prev-equipage') {
      if (!(await confirmDiscardIfDirty())) return;
      await selectRelativeEquipage(-1);
      return;
    }

    if (action === 'next-equipage') {
      if (!(await confirmDiscardIfDirty())) return;
      await selectRelativeEquipage(1);
      return;
    }

    const selectedRow = getSelectedRow();
    if (!selectedRow || !selectedStartNumber) return;

    if (action === 'unlock') {
      await unlockResult(competitionId, 'dressage', selectedStartNumber);
      showAlert(`Dressyr #${selectedStartNumber} upplåst.`);
      await refreshAll();
      openDetailModal();
      return;
    }

    if (action === 'finalize') {
      if (isCurrentDetailDirty()) {
        showAlert('Spara andringarna innan du finaliserar.', false);
        return;
      }
      await refinalizeResult(competitionId, 'dressage', selectedStartNumber);
      showAlert(`Dressyr #${selectedStartNumber} finaliserad.`);
      await refreshAll();
      openDetailModal();
      return;
    }

    if (action === 'reload-detail') {
      if (!(await confirmDiscardIfDirty())) return;
      await refreshDetail();
      render();
      openDetailModal();
      return;
    }

    if (action === 'save-detail') {
      if (selectedProtocolId === 'general') {
        const scope = getDetailScope();
        await saveSecretariatDressageGeneral(competitionId, selectedStartNumber, {
          errorPoints: Number(scope?.querySelector('#dressageGeneralErrorPoints')?.value || 0),
          errorComment: scope?.querySelector('#dressageGeneralErrorComment')?.value || '',
        }, 'Sekretariatskorrigering allmänt');
        showAlert(`Allmän dressyrdata sparad för #${selectedStartNumber}.`);
      } else {
        const protocol = detailData?.protocols.find(item => item.id === selectedProtocolId);
        if (!protocol) return;
        await saveSecretariatDressageProtocol(
          competitionId,
          selectedStartNumber,
          protocol.judgeId,
          collectProtocolPayload(protocol),
          'Sekretariatskorrigering protokoll'
        );
        showAlert(`Dressyrprotokoll sparat för #${selectedStartNumber}.`);
      }
      await refreshAll();
      openDetailModal();
      updateDetailDirtyUi();
    }
  } catch (error) {
    console.error('Secretariat dressage action failed:', error);
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

  rootEl.onclick = handleAction;
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

  rootEl.innerHTML = '<div class="max-w-4xl mx-auto p-6 text-center text-gray-500">Laddar sekretariat Dressyr...</div>';

  try {
    await ensureClubLogosLoaded(competitionId);
    await refreshAll();
  } catch (error) {
    console.error('Failed to load secretariat dressage:', error);
    rootEl.innerHTML = '<div class="max-w-4xl mx-auto p-6 text-center text-red-600">Kunde inte ladda sekretariatssidan.</div>';
  }
}

export function unload() {
  try { teardownStickyHeaders?.(); } catch (_) {}
  teardownStickyHeaders = null;
  closeDetailModal();
  teardownModalKeyboardSupport();
  try { modalEl?.remove(); } catch (_) { }
  modalEl = null;
  rootEl = null;
  competitionId = null;
  rows = [];
  selectedStartNumber = null;
  selectedProtocolId = 'general';
  detailData = null;
}
