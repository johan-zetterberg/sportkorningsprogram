// js/ui/precisionModal.js

import { getGlobalState } from '../main.js';
import { getClubLogoHtml } from '../services/logosService.js';
import { getFlagHtml } from '../services/flagsService.js';

// HÄR VAR FELET: statusClass ska importeras härifrån
import {
  getCalculatedRowData,
  getPortAllowanceCm,
  statusClass
} from '../utils/precisionUtils.js';

import {
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
              <h3 class="text-xl font-bold">Ekipaget hittades inte</h3>
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
            <div class="bg-gray-50 p-3 rounded-lg">
                <div class="text-xs text-gray-500 uppercase font-semibold">Status</div>
                <div class="text-lg font-bold mt-1 inline-block px-3 py-1 rounded ${statusCss}">${data.status}</div>
            </div>
            <div class="bg-gray-50 p-3 rounded-lg">
                <div class="text-xs text-gray-500 uppercase font-semibold">Tid</div>
                <div class="text-lg font font-bold mt-1">${data.timeLabel}</div>
            </div>
            <div class="bg-gray-50 p-3 rounded-lg">
                <div class="text-xs text-gray-500 uppercase font-semibold">Starttid</div>
                <div class="text-lg font-bold mt-1">${data.startT || '–'}</div>
            </div>
            <div class="bg-blue-50 p-3 rounded-lg border border-blue-100">
                <div class="text-xs text-blue-600 uppercase font-semibold">Totalt Straff</div>
                <div class="text-xl font-extrabold text-blue-900 mt-1">${fmt2(data.totalPenalty)}</div>
            </div>
        </div>
        
        <div class="border-t pt-4 mb-4">
            <h4 class="text-sm font-bold text-gray-700 uppercase mb-3">Straffspecifikation</h4>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div><span class="text-gray-500 block">Hinderstraff</span> <span class="font-semibold text-lg">${fmt2(data.obstaclePenalty)}</span></div>
                <div><span class="text-gray-500 block">Tidsstraff</span> <span class="font-semibold text-lg">${fmt2(data.timePenalty)}</span></div>
                <div><span class="text-gray-500 block">Övrigt</span> <span class="font-semibold text-lg">${fmt2(data.extraPenalty)}</span></div>
                <div><span class="text-gray-500 block">Rivningar</span> <span class="font-semibold text-lg">${data.knocksText || data.display?.knocksText || '–'}</span></div>
            </div>
        </div>
        
        <div class="border-t pt-4 mb-6">
            <h4 class="text-sm font-bold text-gray-700 uppercase mb-3">Banfakta</h4>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm bg-gray-50 p-3 rounded">
                <div><span class="text-gray-500">Längd:</span> <span class="font-medium">${data.trackLenLabel || data.display?.trackLenLabel}</span></div>
                <div><span class="text-gray-500">Tempo:</span> <span class="font-medium">${data.tempoLabel || data.display?.tempoLabel}</span></div>
                <div><span class="text-gray-500">Maxtid:</span> <span class="font-medium">${data.maxTimeLabel || data.display?.maxTimeLabel}</span></div>
                <div><span class="text-gray-500">Porttillägg:</span> <span class="font-medium">${allowLabel}</span></div>
            </div>
        </div>

        <div class="border-t pt-4 flex justify-end">
             <button id="printPrecPdfBtn" class="px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700 flex items-center gap-2 text-sm font-medium transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
                Skriv ut Protokoll
             </button>
        </div>
      </div>`;

  // Koppla PDF-knappen
  const pdfBtn = containerElement.querySelector('#printPrecPdfBtn');
  if (pdfBtn) {
    pdfBtn.addEventListener('click', async () => {
      const originalText = pdfBtn.innerHTML;
      pdfBtn.disabled = true;
      pdfBtn.innerHTML = 'Genererar PDF...';
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
              <h3 class="text-xl font-bold">#${id} – Ekipaget hittades inte</h3>
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
            <h3 class="text-xl font-bold">#${eq.startNumber} ${eq.driverName || ''}</h3>
            <div class="text-sm text-gray-500 italic">${horseLabel(eq)}</div>
            <div class="text-gray-600 flex items-center gap-2 mt-1">
              ${getFlagHtml(eq)}
              ${getClubLogoHtml(eq)}
              <span>${eq._mergedLabel || eq.className || ''} • ${eq.clubName || ''}</span>
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