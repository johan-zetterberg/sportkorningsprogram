// js/ui/precisionModal.js

import { getGlobalState } from '../main.js';
import { getClubLogoHtml } from '../services/logosService.js';
import { getFlagHtml } from '../services/flagsService.js';
import { t } from '../utils/i18n.js';

// HÄR VAR FELET: statusClass ska importeras härifrån
import {
  getCalculatedRowData,
  getPortAllowanceCm,
  statusClass
} from '../utils/precisionUtils.js';

import {
  escapeHtml,
  fmt2,
  horseLabel,
  isNum
} from '../utils/sharedUtils.js';

// Importera PDF-funktionen
import { generateAndPrintPdf } from '../pdf/precisionPdf.js';

/**
 * Öppnar detaljmodalen för ett specifikt ekipage i Precision.
 */
export function renderPrecisionContent(containerElement, eq, precisionData, config, startTimes, equipages) {
  if (!eq) {
    containerElement.innerHTML = `
          <div class="p-4 md:p-6">
            <div class="flex justify-between items-start">
              <h3 class="text-xl font-bold">${t('equipage_not_found')}</h3>
            </div>
          </div>`;
    return;
  }

  // Beräkna data för detta ekipage
  const data = getCalculatedRowData(String(eq.startNumber), new Map(), equipages, new Map([[String(eq.startNumber), precisionData]]), config, startTimes);

  // Porttillägg
  const baseAllowance = getPortAllowanceCm(eq.className, config);
  const allowLabel = isNum(baseAllowance)
    ? `${baseAllowance} cm`
    : (data.allowLabel || data.display?.allowLabel || '—');

  // Fixa CSS-klasser för status
  const statusCss = statusClass(data.status);

  containerElement.innerHTML = `
      <div class="p-4 md:p-6">
        
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-center mb-6">
            <div class="bg-gray-50 dark:bg-gray-700/50 p-3 rounded-lg">
                <div class="text-xs text-gray-500 dark:text-gray-400 uppercase font-semibold">${t('status')}</div>
                <div class="text-lg font-bold mt-1 inline-block px-3 py-1 rounded ${statusCss}">${escapeHtml(data.status)}</div>
            </div>
            <div class="bg-gray-50 dark:bg-gray-700/50 p-3 rounded-lg">
                <div class="text-xs text-gray-500 dark:text-gray-400 uppercase font-semibold">${t('time')}</div>
                <div class="text-lg font font-bold mt-1 text-gray-900 dark:text-gray-100">${escapeHtml(data.timeLabel)}</div>
            </div>
            <div class="bg-gray-50 dark:bg-gray-700/50 p-3 rounded-lg">
                <div class="text-xs text-gray-500 dark:text-gray-400 uppercase font-semibold">${t('start_time')}</div>
                <div class="text-lg font-bold mt-1 text-gray-900 dark:text-gray-100">${data.startT || '–'}</div>
            </div>
            <div class="bg-blue-50 dark:bg-blue-900/30 p-3 rounded-lg border border-blue-100 dark:border-blue-900 flex flex-col items-center justify-center">
                <div class="text-xs text-blue-600 dark:text-blue-300 uppercase font-semibold">${t('total_penalty_title')}</div>
                <div class="text-xl font-extrabold text-blue-900 dark:text-blue-100 mt-1">${fmt2(data.totalPenalty)}</div>
            </div>
        </div>
        
        <div class="border-t dark:border-gray-700 pt-4 mb-4">
            <h4 class="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase mb-3">${t('spec_penalty')}</h4>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-gray-900 dark:text-gray-100">
                <div><span class="text-gray-500 dark:text-gray-400 block">${t('obs_penalty')}</span> <span class="font-semibold text-lg">${fmt2(data.obstaclePenalty)}</span></div>
                <div><span class="text-gray-500 dark:text-gray-400 block">${t('time_penalty')}</span> <span class="font-semibold text-lg">${fmt2(data.timePenalty)}</span></div>
                <div><span class="text-gray-500 dark:text-gray-400 block">${t('other_penalty')}</span> <span class="font-semibold text-lg">${fmt2(data.extraPenalty)}</span></div>
                <div>
                  <span class="text-gray-500 dark:text-gray-400 block">${t('knockdowns')}</span>
                  ${(() => {
                    const simple = data.display?.knocksSimple || data.knocksSimple;
                    const full   = data.display?.knocksText   || data.knocksText;
                    const hasDetail = full && full !== simple && full !== '–';
                    if (!simple || simple === '–') return `<span class="font-semibold text-lg">–</span>`;
                    if (hasDetail) {
                      return `<span class="font-semibold text-lg" style="border-bottom:1px dotted currentColor;cursor:default;" title="${escapeHtml(full)}">${escapeHtml(simple)}</span>`;
                    }
                    return `<span class="font-semibold text-lg">${escapeHtml(simple)}</span>`;
                  })()}
                </div>
            </div>
        </div>
        
        <div class="border-t dark:border-gray-700 pt-4 mb-6">
            <h4 class="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase mb-3">${t('course_facts')}</h4>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm bg-gray-50 dark:bg-gray-700/50 p-3 rounded text-gray-700 dark:text-gray-300">
                <div><span class="text-gray-500 dark:text-gray-400">${t('track_len')}:</span> <span class="font-medium">${escapeHtml(data.trackLenLabel || data.display?.trackLenLabel)}</span></div>
                <div><span class="text-gray-500 dark:text-gray-400">${t('tempo')}:</span> <span class="font-medium">${escapeHtml(data.tempoLabel || data.display?.tempoLabel)}</span></div>
                <div><span class="text-gray-500 dark:text-gray-400">${t('max_time')}:</span> <span class="font-medium">${escapeHtml(data.maxTimeLabel || data.display?.maxTimeLabel)}</span></div>
                <div><span class="text-gray-500 dark:text-gray-400">${t('port_allowance')}:</span> <span class="font-medium">${escapeHtml(allowLabel)}</span></div>
            </div>
        </div>
        
        ${(() => {
            const splits = precisionData?.gateSplits || {};
            const splitKeys = Object.keys(splits).filter(k => k === 'start' || k === 'finish' || k.startsWith('gate_'))
              .sort((a, b) => {
                  if (a === 'start') return -1;
                  if (b === 'start') return 1;
                  if (a === 'finish') return 1;
                  if (b === 'finish') return -1;
                  return (parseInt(a.replace('gate_', '')) || 0) - (parseInt(b.replace('gate_', '')) || 0);
              });
              
            if (splitKeys.length === 0) return '';
            
            return `
            <div class="border-t dark:border-gray-700 pt-4 mb-6">
                <h4 class="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase mb-3 flex items-center gap-2">
                    <i class="fas fa-map-marker-alt text-blue-500"></i> Passertider
                </h4>
                <div class="flex flex-wrap gap-2">
                    ${splitKeys.map(k => {
                        let label = k;
                        if (label === 'start') label = 'Start';
                        else if (label === 'finish') label = 'Mål';
                        else label = 'Gate ' + label.replace('gate_', '');
                        
                        const startAbs = splits['start'] || precisionData?.liveStartEpoch;
                        let timeStr = '';
                        if (k === 'start' || !startAbs) {
                            timeStr = 'kl. ' + new Date(splits[k]).toLocaleTimeString('sv-SE', {hour12: false, hour:'2-digit', minute:'2-digit', second:'2-digit'});
                        } else {
                            const elapsed = Math.max(0, splits[k] - startAbs);
                            const m = Math.floor(elapsed / 60000);
                            const s = Math.floor((elapsed % 60000) / 1000);
                            const ds = Math.floor((elapsed % 1000) / 100);
                            timeStr = `+${m > 0 ? m + ':' : ''}${String(s).padStart(m > 0 ? 2 : 1, '0')},${ds}s`;
                        }
                        
                        return `<div class="bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-3 py-1.5 rounded-lg text-sm flex items-center gap-2 border dark:border-gray-600">
                            <span class="font-bold">${escapeHtml(label)}</span>
                            <span class="font-mono text-xs opacity-75">${escapeHtml(timeStr)}</span>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        })()}

        <div class="border-t dark:border-gray-700 pt-4 flex justify-end">
             <button id="printPrecPdfBtn" class="px-4 py-2 bg-gray-900 dark:bg-gray-800 text-white rounded hover:bg-gray-800 dark:hover:bg-gray-700 flex items-center gap-2 text-sm font-medium transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
                ${t('print_pdf')}
             </button>
        </div>
      </div>`;

  // Koppla PDF-knappen
  const pdfBtn = containerElement.querySelector('#printPrecPdfBtn');
  if (pdfBtn) {
    pdfBtn.addEventListener('click', async () => {
      const originalText = pdfBtn.innerHTML;
      pdfBtn.disabled = true;
      pdfBtn.innerHTML = `${t('generating_pdf')}...`;
      try {
        await generateAndPrintPdf(eq, precisionData, equipages, new Map([[String(eq.startNumber), precisionData]]), config, startTimes);
      } catch (e) {
        console.error('PDF fel:', e);
        alert('Kunde inte skapa PDF.');
      } finally {
        pdfBtn.disabled = false;
        pdfBtn.innerHTML = originalText;
      }
    });
  }
}

export async function showDetailsModal(sn, equipages, precisionMap, config, startTimes) {
  try {
    ensureModalExists();

    const modal = document.getElementById('precisionDetailsModal');
    const content = document.getElementById('precisionDetailsContent');

    if (!modal || !content) return;

    // Hämta data
    const id = String(sn);
    const eq = equipages.find(e => String(e.startNumber) === id);

    if (!eq) {
      content.innerHTML = `
          <div class="p-4 md:p-6">
            <div class="flex justify-between items-start">
              <h3 class="text-xl font-bold">#${escapeHtml(id)} – ${t('equipage_not_found')}</h3>
              <button id="closePrecModalBtn" class="px-2 py-1 text-2xl leading-none">&times;</button>
            </div>
          </div>`;

      document.getElementById('closePrecModalBtn')?.addEventListener('click', closeDetailsModal);
      modal.classList.add('visible');
      return;
    }

    content.dataset.isModal = 'true';

    // RENDER HEADER MANUELLT (då den togs bort från renderPrecisionContent)
    content.innerHTML = `
      <div class="p-4 md:p-6 pb-0">
        <div class="flex justify-between items-start gap-3 mb-4">
          <div>
            <h3 class="text-xl font-bold text-gray-900 dark:text-white">#${escapeHtml(eq.startNumber)} ${escapeHtml(eq.driverName || '')}</h3>
            <div class="text-sm text-gray-500 dark:text-gray-400 italic">${escapeHtml(horseLabel(eq))}</div>
            <div class="text-gray-600 dark:text-gray-300 flex items-center gap-2 mt-1">
              ${getFlagHtml(eq)}
              ${getClubLogoHtml(eq)}
              <span>${escapeHtml(eq._mergedLabel || eq.className || '')} • ${escapeHtml(eq.clubName || '')}</span>
            </div>
          </div>
          <button id="closePrecModalBtn" class="text-gray-500 hover:text-gray-800 text-3xl leading-none" aria-label="Stäng">&times;</button>
        </div>
      </div>
      <div id="precision-content-container"></div>
    `;

    renderPrecisionContent(content.querySelector('#precision-content-container'), eq, precisionMap.get(id), config, startTimes, equipages);

    // Koppla stäng-knappen
    content.querySelector('#closePrecModalBtn')?.addEventListener('click', closeDetailsModal);

    // Visa modalen
    modal.classList.add('visible');

  } catch (err) {
    console.error("Fel i precision modal:", err);
  }
}

export function closeDetailsModal() {
  const modal = document.getElementById('precisionDetailsModal');
  if (modal) {
    modal.classList.remove('visible');
  }
  try {
    document.body.classList.remove('modal-open', 'no-scroll');
  } catch { }
}

function ensureModalExists() {
  if (document.getElementById('precisionDetailsModal')) return;

  // CSS
  if (!document.getElementById('precisionModalBaseStyle')) {
    const style = document.createElement('style');
    style.id = 'precisionModalBaseStyle';
    style.textContent = `
      .precision-modal-overlay {
        position: fixed; inset: 0;
        display: none;
        align-items: center; justify-content: center;
        background: rgba(17,24,39,.65);
        backdrop-filter: blur(4px);
        z-index: 2147483647;
        padding: 20px;
        opacity: 0;
        transition: opacity .2s ease;
      }
      html.dark .precision-modal-overlay { background: rgba(0,0,0,0.8); }
      .precision-modal-overlay.visible {
        display: flex;
        opacity: 1;
      }
      .precision-modal-content {
        max-width: 900px;
        width: 100%;
        max-height: 90vh;
        overflow-y: auto;
        background: #fff;
        color: #111827;
        border-radius: 16px;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        position: relative;
        transform: scale(.96);
        transition: transform .2s ease;
      }
      html.dark .precision-modal-content { background: #1f2937; color: #f3f4f6; }
      .precision-modal-overlay.visible .precision-modal-content {
        transform: scale(1);
      }
    `;
    document.head.appendChild(style);
  }

  // DOM
  const modalDiv = document.createElement('div');
  modalDiv.id = 'precisionDetailsModal';
  modalDiv.className = 'precision-modal-overlay';
  modalDiv.dataset.owner = 'precision-results';
  modalDiv.innerHTML = `<div id="precisionDetailsContent" class="precision-modal-content"></div>`;
  document.body.appendChild(modalDiv);

  // Stäng vid klick utanför
  modalDiv.addEventListener('click', (e) => {
    if (e.target === modalDiv) closeDetailsModal();
  });

  // Stäng med ESC
  const escHandler = (e) => {
    if (e.key === 'Escape' && modalDiv.classList.contains('visible')) closeDetailsModal();
  };
  document.addEventListener('keydown', escHandler);

  window.__precisionEscHandler = escHandler;
}
