// js/ui/dressageModal.js
import { getGlobalState } from '../main.js';
import { getClubLogoHtml } from '../services/logosService.js';
import { getFlagHtml } from '../services/flagsService.js';
import { getDressageResultsForEquipage } from '../services/dressageService.js';
import {
  getPrograms,
  getDressagePenaltyCoeff,
  getMomentHorseLabel,
  getMomentHorseLabelStacked,
  fmtPct,
  fmtNum,
  normalizeMovementNo,
  normalizeMovements,
  guessProgramKeyFromClass
} from '../utils/dressageUtils.js';
import { calculateDressageResult, calculateSingleJudgeDressageResult } from '../services/calculationService.js';
import { injectProviders, generateDressagePdf } from '../pdf/dressagePdf.js';
import { t, translateDressageString } from '../utils/i18n.js';

import {
  escapeHtml,
  isMobile,
  isPrivileged
} from '../utils/sharedUtils.js';

function buildDressageModalMeta(data, opts = {}) {
  const equipages = Array.isArray(opts.equipages) ? opts.equipages : [];
  const processedResults = Array.isArray(opts.processedResults) ? opts.processedResults : [];
  const statusMap = opts.statusMap instanceof Map ? opts.statusMap : new Map();
  const eq = data?.__eq || equipages.find((item) => String(item?.startNumber) === String(data?.startNumber)) || null;
  const classKey = eq?._mergedKey || `CLS:${eq?._mergedLabel || eq?.className || data?._mergedLabel || data?.className || ''}`;
  const displayClassLabel = eq?._mergedLabel || eq?.className || data?._mergedLabel || data?.className || '—';
  const originalClassLabel = eq?.className || data?.originalClassName || data?.className || '—';
  const classLabel = displayClassLabel;

  const classStarters = equipages.filter((item) => {
    if (item?.status === 'struken') return false;
    const itemKey = item._mergedKey || `CLS:${item._mergedLabel || item.className || ''}`;
    return itemKey === classKey;
  }).length;

  const processedRow = processedResults.find((row) => String(row?.startNumber) === String(data?.startNumber));
  const processedPlace = Number(processedRow?.plac);
  if (Number.isFinite(processedPlace) && processedPlace > 0) {
    return {
      classPlace: processedPlace,
      classStarters,
      classLabel,
      displayClassLabel,
      originalClassLabel,
      isMerged: !!(eq?._mergedLabel && eq._mergedLabel !== eq.className)
    };
  }

  const ranked = equipages
    .filter((item) => {
      const itemKey = item._mergedKey || `CLS:${item._mergedLabel || item.className || ''}`;
      return itemKey === classKey;
    })
    .map((item) => {
      const status = statusMap.get(String(item.startNumber)) || {};
      return {
        sn: String(item.startNumber),
        finalPercent: Number(status.finalPercent),
        finalPenalty: Number(status.finalPenalty),
        eliminated: !!status.eliminated || status.state === 'eliminated'
      };
    })
    .filter((row) => Number.isFinite(row.finalPercent) && !row.eliminated)
    .sort((a, b) => {
      if (Math.abs(b.finalPercent - a.finalPercent) > 1e-6) return b.finalPercent - a.finalPercent;
      if (Math.abs((a.finalPenalty || 0) - (b.finalPenalty || 0)) > 1e-6) return (a.finalPenalty || 0) - (b.finalPenalty || 0);
      return a.sn.localeCompare(b.sn, undefined, { numeric: true });
    });

  let classPlace = null;
  let lastPercent = null;
  let lastPenalty = null;
  let place = 0;
  ranked.forEach((row, index) => {
    const samePercent = lastPercent !== null && Math.abs(row.finalPercent - lastPercent) < 1e-6;
    const samePenalty = lastPenalty !== null && Math.abs((row.finalPenalty || 0) - lastPenalty) < 1e-6;
    if (!(samePercent && samePenalty)) {
      place = index + 1;
    }
    if (row.sn === String(data?.startNumber)) classPlace = place;
    lastPercent = row.finalPercent;
    lastPenalty = row.finalPenalty || 0;
  });

  return {
    classPlace,
    classStarters,
    classLabel,
    displayClassLabel,
    originalClassLabel,
    isMerged: !!(eq?._mergedLabel && eq._mergedLabel !== eq.className)
  };
}

export function setupDressageModalOnce() {
  const existing = document.getElementById('dressageDetailsModal');
  if (existing) {
    // ✅ Self-heal: modal finns men content saknas/är fel (t.ex. vid sidbyte där unload inte kördes rent)
    if (!document.getElementById('dressageDetailsContent')) {
      existing.innerHTML = `<div id="dressageDetailsContent" class="dressage-modal-content"></div>`;
    }
    // Se till att className är rimlig (om den tappats)
    if (!existing.classList.contains('dressage-modal-overlay')) {
      existing.classList.add('dressage-modal-overlay');
    }
    return;
  }
  if (!document.getElementById('dressageModalBaseStyle')) {
    const style = document.createElement('style');
    style.id = 'dressageModalBaseStyle';
    style.textContent = `.dressage-modal-overlay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:2147483647;background-color:rgba(0,0,0,0);transition:background-color .18s ease;backdrop-filter:blur(4px);pointer-events:none;padding:40px 15px;opacity:0;}.dressage-modal-overlay.visible{background-color:rgba(0,0,0,0.6);pointer-events:auto;opacity:1;}.dressage-modal-overlay.hidden{display:none;}.dressage-modal-content{background:#fff;border-radius:12px;width:100%;max-width:800px;max-height:90vh;overflow-y:auto;box-shadow:0 10px 25px rgba(0,0,0,.1);transform:scale(.95);transition:transform .18s ease,opacity .18s ease;}html.dark .dressage-modal-content{background:#1f2937;color:#f3f4f6;}.dressage-modal-overlay.visible .dressage-modal-content{transform:scale(1);}`;
    document.head.appendChild(style);
  }
  const modalDiv = document.createElement('div');
  modalDiv.id = 'dressageDetailsModal';
  modalDiv.className = 'dressage-modal-overlay hidden';
  modalDiv.innerHTML = `<div id="dressageDetailsContent" class="dressage-modal-content"></div>`;
  document.body.appendChild(modalDiv);

  modalDiv.addEventListener('click', e => { if (e.target === modalDiv) closeDetailsModal(); });
  if (window.__dressyrKeydownHandler) { try { document.removeEventListener('keydown', window.__dressyrKeydownHandler); } catch { } }
  window.__dressyrKeydownHandler = (e) => { if (e.key === 'Escape' && modalDiv.classList.contains('visible')) closeDetailsModal(); };
  document.addEventListener('keydown', window.__dressyrKeydownHandler);
}

export function closeDetailsModal() {
  const modal = document.getElementById('dressageDetailsModal'); if (!modal) return;
  modal.classList.remove('visible'); document.body.classList.remove('modal-open');
  setTimeout(() => { modal.classList.add('hidden'); }, 200);
}

// === HUVUDFUNKTION ===
export async function openDetails(startNumber, arg2 = {}, arg3 = null) {
  setupDressageModalOnce();
  const modal = document.getElementById('dressageDetailsModal');
  let content = document.getElementById('dressageDetailsContent');

  // Guard: om content saknas trots setup (extremfall), försök laga igen eller avbryt
  if (!content) {
    setupDressageModalOnce();
    content = document.getElementById('dressageDetailsContent');
    if (!content) {
      console.error('CRITICAL: dressageDetailsContent could not be created/found.');
      return;
    }
  }

  content.innerHTML = `<div class="p-12 text-center text-gray-500"><p class="text-lg font-semibold">${t('fetching_protocol')}</p></div>`;
  modal.classList.remove('hidden');
  void modal.offsetHeight;
  modal.classList.add('visible');
  document.body.classList.add('modal-open');

  try {
    const sn = String(startNumber);
    const compId = getGlobalState('currentCompetition')?.id || window.currentCompetitionId;

    let opts = {};
    if (Array.isArray(arg2)) {
      opts = { processedResults: arg2, currentJudges: arg3 };
    } else {
      opts = arg2 || {};
    }

    let data = null;

    if (opts.processedResults) {
      data = opts.processedResults.find(r => String(r.startNumber) === sn);
    }

    if (!data) {
      let eq = null;
      if (Array.isArray(opts.equipages)) {
        eq = opts.equipages.find(e => String(e.startNumber) === sn);
      }
      if (!eq) eq = { startNumber: sn, driverName: t('unknown_driver'), className: '' };

      let protocols = null;

      // 1) Försök läsa från savedProtocolsMap (t.ex. från monitor-sidan)
      if (opts.savedProtocolsMap instanceof Map) {
        const raw = opts.savedProtocolsMap.get(sn) ?? opts.savedProtocolsMap.get(Number(sn));
        protocols = Array.isArray(raw) ? raw : (raw ? [raw] : []);
      }

      // 2) Tvinga hämtning från DB om vi fortfarande inte har något
      if ((!protocols || protocols.length === 0) && compId) {
        try {
          const fetched = await getDressageResultsForEquipage(compId, Number(sn));
          protocols = Array.isArray(fetched) ? fetched : (fetched ? [fetched] : []);
        } catch (e) {
          protocols = [];
        }
      }

      // 3) Normalisera protokollobjekten så att data hamnar på toppnivå
      //    oavsett om det ligger direkt på dokumentet eller under t.ex. "protocol" eller "value".
      protocols = (Array.isArray(protocols) ? protocols : []).map(d => {
        if (!d) return null;

        // Om dokumentet har fältet "protocol" eller "value" så är det där själva protokollet ligger.
        const base =
          (d.protocol && typeof d.protocol === 'object') ? d.protocol :
            (d.value && typeof d.value === 'object') ? d.value :
              d;

        // Slå ihop meta-fält från doc + själva protokollet.
        // base får “vinna” om samma nyckel finns på båda.
        return {
          ...d,
          ...base
        };
      }).filter(Boolean);


      let st = opts.statusMap instanceof Map ? opts.statusMap.get(sn) : null;

      data = {
        startNumber: sn,
        driverName: eq.driverName,
        clubName: eq.clubName,
        className: eq._mergedLabel || eq.className,
        originalClassName: eq.className,
        country: eq.country,
        _mergedLabel: eq._mergedLabel,
        horseName: getMomentHorseLabel(eq),
        finalPercent: st?.finalPercent,
        finalPoints: st?.finalPoints,
        finalPenalty: st?.finalPenalty,
        errorPoints: st?.errorPoints,
        eliminated: st?.eliminated || (st?.state === 'eliminated'),
        judges: {},
        __savedProtocols: protocols,
        __eq: eq
      };

      // 3b) Helper to find judge info
      const findJudgeInfo = (jid) => {
        if (Array.isArray(opts.currentJudges)) {
          return opts.currentJudges.find(j => j.id === jid || j.id === `judge_${jid}`);
        }
        return null;
      };

      protocols.forEach(p => {
        if (p.id === 'general' || p.judgeId === 'general') return; // Skip general document, it's not a judge

        let jid = p.judgeId || p.id || p.position;
        if (!jid) return;
        if (typeof jid === 'string' && jid.startsWith('judge_')) jid = jid.slice(6);

        const foundJ = findJudgeInfo(jid);

        // Fix Name: Prefer protocol name, then found judge name, then formatted ID
        let safeName = p.judgeName || p.name;
        if (!safeName || safeName === jid || safeName.includes('-')) {
          if (foundJ && foundJ.name) safeName = foundJ.name;
          else safeName = jid.charAt(0).toUpperCase() + jid.slice(1).replace(/-/g, ' '); // simple fallback formatting
        }

        // Fix Pos
        let safePos = (p.position || p.judgePos || '').toUpperCase();
        if (!safePos || safePos === '?') {
          if (foundJ) {
            if (foundJ.position) safePos = foundJ.position;
            else if (Array.isArray(foundJ.roles)) {
              const r = foundJ.roles.find(x => x && x.discipline === 'dressage');
              if (r && r.position) safePos = r.position;
            } else if (foundJ.disciplines && foundJ.disciplines.dressage) {
              safePos = foundJ.disciplines.dressage;
            }
          }
        }
        if (!safePos) safePos = '?';

        data.judges[jid] = {
          id: jid,
          position: safePos.toUpperCase(),
          name: safeName,
          movements: normalizeMovements(p.movements),
          totalPoints: p.totalPoints,
          penalty: p.penalty,
          percent: p.percent,
          eliminated: p.eliminated
        };
      });
    }

    if (!data) throw new Error(t('no_data'));

    const programs = getPrograms();
    const protocolProgramKey = (data.__savedProtocols || [])
      .find(p => p && p.id !== 'general' && (p.testKey || p.programKey));
    let programKey = protocolProgramKey?.testKey || protocolProgramKey?.programKey || data.testKey || data.programKey;
    if (!programKey && window.klassProgramMapping) {
      // Prioritate original class name which usually holds the mapping
      const mapped = window.klassProgramMapping[data.originalClassName] || window.klassProgramMapping[data.className] || window.klassProgramMapping[data._mergedLabel];
      if (mapped) programKey = mapped;
    }

    // Fallback: Guess from class name if still missing
    if (!programKey && !programs[programKey]) {
      const clsName = data.className || data.originalClassName || '';
      // Use shared utility for robust guessing
      const scannedKey = guessProgramKeyFromClass(clsName, programs);
      if (scannedKey) programKey = scannedKey;
      else {
        // Backup: exact name match
        const found = Object.values(programs).find(p => p.name === clsName);
        if (found) programKey = Object.keys(programs).find(k => programs[k] === found);
      }
    }

    const program = programKey ? programs[programKey] : null;

    const isFromProcessed = !!opts.processedResults;
    if (!isFromProcessed && program && data.judges) {
      Object.values(data.judges).forEach(jr => {
        const computed = calculateSingleJudgeDressageResult(jr, program, data.__eq || {});
        if (computed) {
          jr.totalPoints = computed.points;
          jr.percent = computed.percent;
          jr.penalty = computed.penalty;
          jr.eliminated = computed.eliminated;
        }
      });
    }

    if (!data.finalPenalty && program && data.__savedProtocols?.length) {
      const result = calculateDressageResult(data.__eq || { className: data.className }, data.__savedProtocols, [], programs);
      if (result) {
        data.finalPercent = result.percent;
        data.finalPoints = result.points;
        data.finalPenalty = result.penalty;
        data.errorPoints = result.errorPoints;
        data.errorPenalty = result.errorPenalty;
      }
    }


    const order = { C: 0, E: 1, B: 2, H: 3, M: 4 };
    let judgesPresent = [];

    // === FIX FOR MODAL TABS ===
    // Priority 1: Use strictly the judges that exist in the DATA (ignoring class-level list if data exists)
    // This solves the issue where 2 judges are assigned to 'C' in the class, but only one judged this specific driver.
    const dataJudgeIds = Object.keys(data.judges || {});
    if (dataJudgeIds.length > 0) {
      judgesPresent = Object.values(data.judges).map(j => ({
        id: j.id, name: j.name, position: (j.position || '').toUpperCase()
      }));
    } else if (Array.isArray(opts.currentJudges)) {
      // Fallback: If no data yet, show all possible judges
      // Must derive position from roles if needed
      const getPos = (j) => {
        if (j.position) return j.position;
        if (Array.isArray(j.roles)) {
          const r = j.roles.find(x => x && x.discipline === 'dressage');
          if (r && r.position) return r.position;
        }
        if (j.disciplines && j.disciplines.dressage) return j.disciplines.dressage;
        return '';
      };

      const seenPos = new Set();
      judgesPresent = opts.currentJudges
        .map(j => ({ id: j.id, name: j.name, position: (getPos(j) || '').toUpperCase() }))
        .filter(j => {
          const p = j.position;
          if (!p || !/^[CEBHM]$/.test(p)) return false;
          if (seenPos.has(p)) return false;
          seenPos.add(p);
          return true;
        });
    }

    judgesPresent = judgesPresent
      .filter(j => {
        const id = (j.id || '').toLowerCase();
        const pos = (j.position || '').toUpperCase();

        // Exclude "General" explicitly
        if (id === 'general' || id.includes('general') || pos === 'GENERAL') return false;

        // Return true if position exists (legacy safe behavior)
        return !!j.position;
      })
      .sort((a, b) => {
        const pA = a.position;
        const pB = b.position;
        const valA = order[pA] ?? 99;
        const valB = order[pB] ?? 99;
        if (valA !== valB) return valA - valB;
        return pA.localeCompare(pB);
      });

    // VIKTIGT: PDF-generatorn (dressagePdf.js) förväntar sig data.__judgesPresent
    data.__judgesPresent = judgesPresent;

    const fakeResultsRef = Array.isArray(opts.processedResults) ? opts.processedResults : [data];

    renderModalUI(content, data, judgesPresent, program, {
      startNumber: sn,
      processedResultsRef: fakeResultsRef,
      modalMeta: buildDressageModalMeta(data, opts),
      providers: {
        getStatus: () => ({ finalPenalty: data.finalPenalty }),
        getSavedProtocols: () => data.__savedProtocols || [],
        getPrograms: () => programs,
        getProgramForEq: () => program,
        getEquipage: () => data.__eq || { startNumber: sn, driverName: data.driverName },
        computeFinalFromSaved: computeFinalFromSaved
      }
    });

  } catch (e) {
    console.error('Modal Error:', e);
    content.innerHTML = `<div class="p-6 text-center text-red-500">${t('error_fetching')} ${escapeHtml(e.message)}</div>`;
  }
}

// Exported helper for shared rendering
export function renderDressageContent(container, data, judgesPresent, program, pdfContext, isInternational = false) {
  // Rensa container men behåll struktur om vi vill? Nej bygg inre struktur.
  // Vi behöver tabs container och content container.
  container.innerHTML = `
      <div class="mb-4 flex justify-end">
        <button id="printPdfBtn" class="flex items-center gap-2 px-3 py-1.5 border border-transparent rounded-md hover:bg-gray-800 text-sm font-medium text-white bg-gray-900">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
          </svg>
          ${t('print_pdf', isInternational)}
        </button>
      </div>
      <div id="judgeTabs" class="mt-4 border-b border-gray-200 flex items-center gap-2 overflow-x-auto"></div>
      <div id="modalBody" class="mt-4"></div>
    `;

  const judgeTabs = container.querySelector('#judgeTabs');
  const modalBody = container.querySelector('#modalBody');

  // Attach PDF handler
  if (pdfContext) {
    const btn = container.querySelector('#printPdfBtn');
    if (btn) attachPdfButtonHandler(btn, pdfContext.startNumber, pdfContext.processedResultsRef, pdfContext.providers);
  } else {
    const btn = container.querySelector('#printPdfBtn');
    if (btn) btn.style.display = 'none';
  }

  function renderForJudge(jid) {
    const jr = data.judges[jid];
    if (!jr) { modalBody.innerHTML = `<div class="p-8 text-center text-gray-500 italic">${t('no_protocol', isInternational)}</div>`; return; }
    if (!program) { modalBody.innerHTML = `<div class="p-8 text-center text-amber-600">${t('program_missing', isInternational)}</div>`; return; }
    modalBody.innerHTML = renderJudgeDetailHTML(jr, program, data, isInternational);
    setActive('judge:' + jid);
  }

  function renderTotal() {
    if (!program) { modalBody.innerHTML = `<div class="p-8 text-center text-amber-600">${t('program_missing', isInternational)}</div>`; return; }
    modalBody.innerHTML = renderTotalDetailHTML(data, judgesPresent, program, isInternational);
    setActive('total');
  }

  function setActive(id) {
    judgeTabs.querySelectorAll('.tab-btn').forEach(btn => {
      const act = btn.dataset.id === id;
      btn.classList.toggle('border-blue-600', act);
      btn.classList.toggle('text-blue-600', act);
      btn.classList.toggle('dark:text-blue-400', act);
      btn.classList.toggle('text-gray-500', !act);
      btn.classList.toggle('dark:text-gray-400', !act);
    });
  }

  if (judgesPresent.length > 0) {
    // Always show the Total tab so that error points and final computed penalties are visible
    const totalBtn = document.createElement('button');
    totalBtn.className = 'tab-btn px-3 py-2 border-b-2 text-sm font-bold whitespace-nowrap border-transparent hover:text-gray-700 dark:hover:text-gray-200 text-gray-500 dark:text-gray-400';
    totalBtn.dataset.id = 'total'; totalBtn.textContent = 'Total';
    totalBtn.addEventListener('click', renderTotal);
    judgeTabs.appendChild(totalBtn);
    const sep = document.createElement('span'); sep.className = 'border-l h-5 mx-1 border-gray-300 dark:border-gray-600';
    judgeTabs.appendChild(sep);

    judgesPresent.forEach(j => {
      const b = document.createElement('button');
      b.className = 'tab-btn px-3 py-2 border-b-2 text-sm font-medium whitespace-nowrap border-transparent hover:text-gray-700 dark:hover:text-gray-200 text-gray-500 dark:text-gray-400';
      b.dataset.id = 'judge:' + j.id;
      const label = (j.position === '?' || !j.position) ? j.name : `${j.position} – ${j.name}`;
      b.textContent = label;
      b.addEventListener('click', () => renderForJudge(j.id));
      judgeTabs.appendChild(b);
    });

    // Default to the Total tab, as it contains aggregated error points
    renderTotal();

  } else {
    modalBody.innerHTML = `<div class="p-8 text-center text-gray-500">${t('no_data')}</div>`;
  }
}

function renderModalUI(content, data, judgesPresent, program, pdfContext) {
  let horseLabel = '—';
  try { horseLabel = getMomentHorseLabelStacked(data.__eq || data); } catch (e) { }
  const modalMeta = pdfContext?.modalMeta || null;
  const classPlacementLabel = modalMeta?.classPlace
    ? `${modalMeta.classPlace}${modalMeta.classStarters ? ` / ${modalMeta.classStarters}` : ''}`
    : '—';
  const classMetaHtml = modalMeta?.isMerged
    ? `
              <div class="inline-flex items-center gap-2 rounded-full bg-blue-50 dark:bg-blue-900/20 px-3 py-1.5 text-sm text-blue-800 dark:text-blue-200 border border-blue-100 dark:border-blue-900/50">
                <span class="text-[10px] uppercase tracking-widest font-semibold text-blue-500 dark:text-blue-300">Visningsklass</span>
                <span class="font-semibold">${escapeHtml(modalMeta.displayClassLabel || '—')}</span>
              </div>
              <div class="inline-flex items-center gap-2 rounded-full bg-indigo-50 dark:bg-indigo-900/20 px-3 py-1.5 text-sm text-indigo-800 dark:text-indigo-200 border border-indigo-100 dark:border-indigo-900/50">
                <span class="text-[10px] uppercase tracking-widest font-semibold text-indigo-500 dark:text-indigo-300">Ursprungsklass</span>
                <span class="font-semibold">${escapeHtml(modalMeta.originalClassLabel || '—')}</span>
              </div>
    `
    : `
              <div class="inline-flex items-center gap-2 rounded-full bg-blue-50 dark:bg-blue-900/20 px-3 py-1.5 text-sm text-blue-800 dark:text-blue-200 border border-blue-100 dark:border-blue-900/50">
                <span class="text-[10px] uppercase tracking-widest font-semibold text-blue-500 dark:text-blue-300">Klass</span>
                <span class="font-semibold">${escapeHtml(modalMeta?.displayClassLabel || modalMeta?.classLabel || data.className || '—')}</span>
              </div>
    `;

  // Header structure for standalone modal
  content.innerHTML = `
      <div id="modalCard" class="p-4 md:p-6">
        <div class="flex justify-between items-start gap-3">
          <div>
            <h3 class="text-xl font-bold text-gray-900 dark:text-white">#${escapeHtml(data.startNumber)} ${escapeHtml(data.driverName || '')}</h3>
            <div class="text-sm text-gray-500 dark:text-gray-400 italic">${horseLabel}</div>
            <div class="text-gray-600 dark:text-gray-300 flex items-center gap-2 mt-1">
              ${getFlagHtml(data)}
              ${getClubLogoHtml(data)}
              <span>${escapeHtml(data.clubName || '—')}</span>
            </div>
            <div class="flex flex-wrap gap-2 mt-3">
              <div class="inline-flex items-center gap-2 rounded-full bg-slate-100 dark:bg-slate-800 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700">
                <span class="text-[10px] uppercase tracking-widest font-semibold text-slate-500 dark:text-slate-400">Plac i klass</span>
                <span class="font-bold tabular-nums">${escapeHtml(classPlacementLabel)}</span>
              </div>
              ${classMetaHtml}
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button id="closeModalBtn" class="px-2 py-1 text-2xl leading-none" aria-label="Stäng">&times;</button>
          </div>
        </div>
        <div id="dressageContentContainer"></div>
      </div>`;

  content.querySelector('#closeModalBtn')?.addEventListener('click', closeDetailsModal);

  // Render content into the container
  const container = content.querySelector('#dressageContentContainer');
  renderDressageContent(container, data, judgesPresent, program, pdfContext);
}



// ... (existing imports)

// ... (skip down to renderJudgeDetailHTML)

function renderJudgeDetailHTML(jr, program, data, isInternational = false) {
  const scoresByMovementNo = new Map((jr.movements || []).map(m => [normalizeMovementNo(m), m]));
  const programMovements = Array.isArray(program?.movements) ? program.movements : [];

  // Logic for comment visibility
  // Admins/Secretariat can see all.
  // Drivers can only see their own.
  const user = getGlobalState('currentUser') || {};
  const role = user.role || '';
  const isAdmin = role === 'admin' || role === 'superadmin' || role === 'sekretariat';

  const eq = (data && data.__eq) ? data.__eq : {};
  // Check against email or driverEmail
  const userEmail = (user.email || '').toLowerCase();
  const eqEmail = (eq.email || '').toLowerCase();
  const eqDriverEmail = (eq.driverEmail || '').toLowerCase();

  const isMyEquipage = userEmail && (userEmail === eqEmail || userEmail === eqDriverEmail);

  const showComments = isAdmin || isMyEquipage;

  let html = `<div class="overflow-x-auto"><table class="min-w-full text-sm rounded-lg overflow-hidden"><thead class="bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-200"><tr><th class="p-2 text-left w-2/12">${t('moment', isInternational)}</th><th class="hidden md:table-cell p-2 text-left w-3/12">${t('to_judge', isInternational)}</th>${showComments ? `<th class="p-2 text-left w-5/12">${t('comment', isInternational)}</th>` : ''}<th class="p-2 text-center w-1/12">${t('points', isInternational)}</th><th class="p-2 text-center w-1/12">${t('result', isInternational)}</th></tr></thead><tbody class="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700 text-gray-900 dark:text-gray-100">`;

  let calculatedSum = 0;
  let calculatedMax = 0;

  if (jr && jr.eliminated) {
    html += `<tr><td colspan="${showComments ? 5 : 4}" class="p-4 text-center text-red-600 font-bold bg-red-50">${t('eliminated', isInternational).toUpperCase()}</td></tr>`;
  } else if (programMovements.length) {
    programMovements.forEach(moment => {
      const c = Number(moment.coeff) || 1;
      calculatedMax += 10 * c;
      const hit = scoresByMovementNo.get(moment.no);
      const sc = hit?.score;
      const scTxt = (sc != null) ? Number(sc).toFixed(1) : '–';
      const rawRes = (sc != null) ? (Number(sc) * c) : null;
      const resTxt = (rawRes != null) ? rawRes.toFixed(1) : '–';

      if (rawRes != null) calculatedSum += rawRes;

      const com = (hit?.comment || '').trim();

      // Translate content
      const momText = translateDressageString(moment.text, isInternational);
      const momJudge = translateDressageString(moment.judge, isInternational);

      html += `<tr><td class="p-2 align-top"><p class="font-semibold text-gray-900 dark:text-gray-100">${escapeHtml(moment.no)}. ${escapeHtml(momText || '')}</p><p class="text-xs text-blue-800 dark:text-blue-300">${escapeHtml(moment.letters || '')}</p></td><td class="hidden md:table-cell p-2 align-top text-gray-600 dark:text-gray-400">${escapeHtml(momJudge || '')}</td>${showComments ? `<td class="p-2 align-top italic text-gray-700 dark:text-gray-300">${escapeHtml(com)}</td>` : ''}<td class="p-2 text-center align-top font-semibold text-lg text-gray-900 dark:text-white">${scTxt}</td><td class="p-2 text-center align-top font-bold text-lg text-gray-900 dark:text-white">${resTxt}</td></tr>`;
    });
  }

  // Use pre-calculated finals from the service (hydrated in openDetails or processAndAggregateResults)
  const isLive = jr.isLive || (jr.projectedPercent != null && jr.projectedPercent !== jr.percent);
  const totalPoints = jr.totalPoints ?? 0;
  const percent = (isLive && jr.projectedPercent != null) ? jr.projectedPercent : (jr.percent ?? 0);
  const penalty = (isLive && jr.projectedPenalty != null) ? jr.projectedPenalty : (jr.penalty ?? 0);

  const colspan = isMobile() ? (showComments ? 3 : 2) : (showComments ? 4 : 3);
  html += `</tbody><tfoot class="font-semibold"><tr class="border-t-2 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white"><td colspan="${colspan}" class="p-2 text-right">${t('total_score', isInternational)}:</td><td class="p-2 text-center text-lg">${jr?.eliminated ? '–' : fmtNum(totalPoints)}</td></tr><tr class="bg-blue-50 dark:bg-blue-900/30 text-gray-900 dark:text-white"><td colspan="${colspan}" class="p-2 text-right">${isLive ? 'Prognos %' : t('percent', isInternational)}:</td><td class="p-2 text-center">${jr?.eliminated ? '–' : fmtPct(percent)}</td></tr><tr class="bg-blue-100 dark:bg-blue-900 text-gray-900 dark:text-white font-bold"><td colspan="${colspan}" class="p-2 text-right">${isLive ? 'Prognos Straff' : t('penalty', isInternational)}:</td><td class="p-2 text-center text-lg">${jr?.eliminated ? '–' : fmtNum(penalty)}</td></tr></tfoot></table></div>`;
  return html;
}
function renderTotalDetailHTML(data, judges, program, isInternational = false) {
  const programMovements = Array.isArray(program?.movements) ? program.movements : [];
  let html = `<div class="overflow-x-auto"><table class="min-w-full text-sm rounded-lg overflow-hidden"><thead class="bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-200"><tr><th class="p-2 text-left">${t('moment', isInternational)}</th><th class="hidden md:table-cell p-2 text-left">${t('to_judge', isInternational)}</th><th class="p-2 text-center">${t('avg_score', isInternational)}</th><th class="p-2 text-center">${t('total_coeff', isInternational)}</th></tr></thead><tbody class="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700 text-gray-900 dark:text-gray-100">`;
  let calculatedTotalScore = 0;
  if (data.eliminated) { html += `<tr><td colspan="4" class="p-4 text-center text-red-600 font-bold bg-red-50 dark:bg-red-900/30">${t('eliminated', isInternational).toUpperCase()}</td></tr>`; } else if (programMovements.length) { programMovements.forEach(moment => { const scores = judges.map(j => { const jr = data.judges[j.id]; const m = (jr?.movements || []).find(mv => normalizeMovementNo(mv) === moment.no); return m?.score; }).filter(s => s != null).map(Number); const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length) : null; const res = (avg != null) ? avg * (moment.coeff || 1) : null; if (res != null) calculatedTotalScore += res; const momText = translateDressageString(moment.text, isInternational); const momJudge = translateDressageString(moment.judge, isInternational); html += `<tr><td class="p-2 align-top"><p class="font-semibold text-gray-900 dark:text-gray-100">${escapeHtml(moment.no)}. ${escapeHtml(momText || '')}</p><p class="text-xs text-blue-800 dark:text-blue-300">${escapeHtml(moment.letters || '')}</p></td><td class="hidden md:table-cell p-2 align-top text-gray-600 dark:text-gray-400">${escapeHtml(momJudge || '')}</td><td class="p-2 text-center align-top font-semibold text-lg text-gray-900 dark:text-white">${avg != null ? avg.toFixed(2) : '–'}</td><td class="p-2 text-center align-top font-bold text-lg text-gray-900 dark:text-white">${res != null ? res.toFixed(2) : '–'}</td></tr>`; }); }
  const isLive = data.isLive || (data.projectedPercent != null && data.projectedPercent !== data.finalPercent);
  const colspan = isMobile() ? 2 : 3;
  const displayPercent = (isLive && data.projectedPercent != null) ? data.projectedPercent : (data.finalPercent || data.avgPercent);
  const displayPenalty = (isLive && data.projectedPenalty != null) ? data.projectedPenalty : data.finalPenalty;
  const errorPts = data.errorPoints ?? data.dressage?.errorPoints ?? data.__eq?.errorPoints ?? 0;

  html += `</tbody><tfoot class="font-semibold"><tr class="border-t-2 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white"><td colspan="${colspan}" class="p-2 text-right">${t('total', isInternational)}:</td><td class="p-2 text-center text-lg">${data.eliminated ? '–' : fmtNum(data.finalPoints ?? calculatedTotalScore)}</td></tr><tr class="bg-green-50 dark:bg-green-900/30 text-gray-900 dark:text-white"><td colspan="${colspan}" class="p-2 text-right">${isLive ? 'Prognos %' : t('avg_percent', isInternational)}:</td><td class="p-2 text-center">${data.eliminated ? '–' : fmtPct(displayPercent)}</td></tr><tr class="bg-orange-50 dark:bg-orange-900/30 text-gray-900 dark:text-white"><td colspan="${colspan}" class="p-2 text-right">${t('error_points', isInternational)}:</td><td class="p-2 text-center">${(Number(errorPts) || 0).toFixed(1)}</td></tr><tr class="bg-red-100 dark:bg-red-900 text-gray-900 dark:text-white font-bold"><td colspan="${colspan}" class="p-2 text-right">${isLive ? 'Prognos Straff' : t('total_penalty', isInternational)}:</td><td class="p-2 text-center text-lg">${data.eliminated ? '–' : fmtNum(displayPenalty)}</td></tr></tfoot></table></div>`;
  return html;
}
function attachPdfButtonHandler(buttonEl, startNumber, processedResultsRef, providers) {
  if (!buttonEl) return;
  injectProviders(providers || null);
  buttonEl.addEventListener('click', async (e) => {
    e.preventDefault(); const btn = buttonEl; const orig = btn.textContent;
    btn.innerHTML = `
      <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-gray-700" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      ${t('generating_pdf')}...`;
    btn.disabled = true;
    try { await generateDressagePdf(String(startNumber), processedResultsRef || [], { providers: (providers || null) }); } catch (e) { console.error('PDF-fel', e); alert(t('critical_error')); } finally { btn.innerHTML = orig; btn.disabled = false; }
  });
}

// === GLOBAL EXPORT (LÖSER IMPORTPROBLEMET) ===
window.DressageModal = { openDetails };
