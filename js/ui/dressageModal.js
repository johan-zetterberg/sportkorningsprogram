// js/ui/dressageModal.js
import { getGlobalState } from '../main.js';
import { getClubLogoHtml } from '../services/logosService.js';
import { getFlagHtml } from '../services/flagsService.js';
import { getDressageResultsForEquipage } from '../services/firestoreService.js';
import {
  getPrograms,
  getDressagePenaltyCoeff,
  computeFinalFromSaved,
  getMomentHorseLabel,
  getMomentHorseLabelStacked,
  fmtPct,
  fmtNum,
  normalizeMovementNo,
  normalizeMovements
} from '../utils/dressageUtils.js';
import { injectProviders, generateDressagePdf } from '../pdf/dressagePdf.js';

import {
  isMobile,
  isPrivileged
} from '../utils/sharedUtils.js';

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
    style.textContent = `.dressage-modal-overlay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:2147483647;background-color:rgba(0,0,0,0);transition:background-color .18s ease;backdrop-filter:blur(4px);pointer-events:none;padding:40px 15px;opacity:0;}.dressage-modal-overlay.visible{background-color:rgba(0,0,0,0.6);pointer-events:auto;opacity:1;}.dressage-modal-overlay.hidden{display:none;}.dressage-modal-content{background:#fff;border-radius:12px;width:100%;max-width:800px;max-height:90vh;overflow-y:auto;box-shadow:0 10px 25px rgba(0,0,0,.1);transform:scale(.95);transition:transform .18s ease,opacity .18s ease;}.dressage-modal-overlay.visible .dressage-modal-content{transform:scale(1);}`;
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

  content.innerHTML = '<div class="p-12 text-center text-gray-500"><p class="text-lg font-semibold">Hämtar protokoll...</p></div>';
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
      if (!eq) eq = { startNumber: sn, driverName: 'Okänd kusk', className: '' };

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

      protocols.forEach(p => {
        let jid = p.judgeId || p.id || p.position;
        if (!jid) return;
        if (typeof jid === 'string' && jid.startsWith('judge_')) jid = jid.slice(6);

        data.judges[jid] = {
          id: jid,
          position: (p.position || p.judgePos || '?').toUpperCase(),
          name: p.judgeName || p.name || jid,
          movements: normalizeMovements(p.movements),
          totalPoints: p.totalPoints,
          penalty: p.penalty,
          percent: p.percent,
          eliminated: p.eliminated
        };
      });
    }

    if (!data) throw new Error("Kunde inte hitta data.");

    const programs = getPrograms();
    let programKey = data.testKey || data.programKey;
    if (!programKey && data.__savedProtocols && data.__savedProtocols.length) {
      programKey = data.__savedProtocols[0]?.testKey || data.__savedProtocols[0]?.programKey;
    }
    if (!programKey && window.klassProgramMapping) {
      // Prioritate original class name which usually holds the mapping
      programKey = window.klassProgramMapping[data.originalClassName] || window.klassProgramMapping[data.className] || window.klassProgramMapping[data._mergedLabel];
    }
    const program = programKey ? programs[programKey] : null;

    // 4) Säkerställ att vi har totaler för varje enskild domare (Manuell beräkning för säkerhets skull)
    // OBS: Om vi fick datan från processedResults (som redan har räknat), skippar vi detta för att inte 
    // riskera att nolla ut resultat om programmet inte matchar exakt just nu.
    const isFromProcessed = !!opts.processedResults;
    if (!isFromProcessed && program && data.judges) {
      const pCoeff = getDressagePenaltyCoeff(program);
      const programMovements = Array.isArray(program.movements) ? program.movements : [];

      // Beräkna maxpoäng för en domare
      let singleJudgeMax = 0;
      programMovements.forEach(pm => { singleJudgeMax += 10 * (Number(pm.coeff) || 1); });

      Object.values(data.judges).forEach(jr => {
        let currentTotal = 0;
        programMovements.forEach(pm => {
          const mNo = Number(pm.no);
          const c = Number(pm.coeff) || 1;
          const found = jr.movements.find(m => Number(m.momentNo) === mNo);
          if (found && found.score != null && found.score !== '') {
            currentTotal += Number(found.score) * c;
          }
        });

        // Uppdatera värden om de saknas eller skriv över för att vara säker
        jr.totalPoints = currentTotal;
        jr.percent = singleJudgeMax > 0 ? (currentTotal / singleJudgeMax) * 100 : 0;
        jr.penalty = (singleJudgeMax - currentTotal) * pCoeff;
      });
    }

    if (!data.finalPenalty && program && data.__savedProtocols?.length) {
      const computed = computeFinalFromSaved(data.__eq || { className: data.className }, data.__savedProtocols, program);
      if (computed) {
        data.finalPercent = computed.percent;
        data.finalPoints = computed.points;
        data.finalPenalty = computed.penalty;
      }
    }


    const order = { C: 0, E: 1, B: 2, H: 3, M: 4 };
    let judgesPresent = [];

    if (Array.isArray(opts.currentJudges)) {
      judgesPresent = opts.currentJudges.map(j => ({
        id: j.id, name: j.name, position: (j.position || '').toUpperCase()
      }));
    } else if (data.judges) {
      judgesPresent = Object.values(data.judges).map(j => ({
        id: j.id, name: j.name, position: (j.position || '').toUpperCase()
      }));
    }
    judgesPresent = judgesPresent
      .filter(j => /^[CEBHM]$/.test(j.position))
      .sort((a, b) => (order[a.position] ?? 99) - (order[b.position] ?? 99));

    // VIKTIGT: PDF-generatorn (dressagePdf.js) förväntar sig data.__judgesPresent
    data.__judgesPresent = judgesPresent;

    const fakeResultsRef = Array.isArray(opts.processedResults) ? opts.processedResults : [data];

    renderModalUI(content, data, judgesPresent, program, {
      startNumber: sn,
      processedResultsRef: fakeResultsRef,
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
    content.innerHTML = `<div class="p-6 text-center text-red-500">Ett fel uppstod: ${e.message}</div>`;
  }
}

// Exported helper for shared rendering
export function renderDressageContent(container, data, judgesPresent, program, pdfContext) {
  // Rensa container men behåll struktur om vi vill? Nej bygg inre struktur.
  // Vi behöver tabs container och content container.
  container.innerHTML = `
      <div class="mb-4 flex justify-end">
        <button id="printPdfBtn" class="flex items-center gap-2 px-3 py-1.5 border border-transparent rounded-md hover:bg-gray-800 text-sm font-medium text-white bg-gray-900">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
          </svg>
          Skriv ut PDF
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
    if (!jr) { modalBody.innerHTML = '<div class="p-8 text-center text-gray-500 italic">Inget protokoll för denna domare.</div>'; return; }
    if (!program) { modalBody.innerHTML = '<div class="p-8 text-center text-amber-600">Program saknas för denna klass.</div>'; return; }
    modalBody.innerHTML = renderJudgeDetailHTML(jr, program, data);
    setActive('judge:' + jid);
  }

  function renderTotal() {
    if (!program) { modalBody.innerHTML = '<div class="p-8 text-center text-amber-600">Program saknas.</div>'; return; }
    modalBody.innerHTML = renderTotalDetailHTML(data, judgesPresent, program);
    setActive('total');
  }

  function setActive(id) {
    judgeTabs.querySelectorAll('.tab-btn').forEach(btn => {
      const act = btn.dataset.id === id;
      btn.classList.toggle('border-blue-600', act);
      btn.classList.toggle('text-blue-700', act);
    });
  }

  if (judgesPresent.length > 0) {
    if (judgesPresent.length > 1) {
      const totalBtn = document.createElement('button');
      totalBtn.className = 'tab-btn px-3 py-2 border-b-2 text-sm font-medium whitespace-nowrap font-bold border-transparent hover:text-gray-700';
      totalBtn.dataset.id = 'total'; totalBtn.textContent = 'Total';
      totalBtn.addEventListener('click', renderTotal);
      judgeTabs.appendChild(totalBtn);
      const sep = document.createElement('span'); sep.className = 'border-l h-5 mx-1 border-gray-300';
      judgeTabs.appendChild(sep);
    }

    judgesPresent.forEach(j => {
      const b = document.createElement('button');
      b.className = 'tab-btn px-3 py-2 border-b-2 text-sm font-medium whitespace-nowrap border-transparent hover:text-gray-700';
      b.dataset.id = 'judge:' + j.id;
      b.textContent = `${j.position} – ${j.name}`;
      b.addEventListener('click', () => renderForJudge(j.id));
      judgeTabs.appendChild(b);
    });

    if (judgesPresent.length > 1) renderTotal();
    else renderForJudge(judgesPresent[0].id);

  } else {
    modalBody.innerHTML = '<div class="p-8 text-center text-gray-500">Ingen data att visa.</div>';
  }
}

function renderModalUI(content, data, judgesPresent, program, pdfContext) {
  let horseLabel = '—';
  try { horseLabel = getMomentHorseLabelStacked(data); } catch (e) { }

  // Header structure for standalone modal
  content.innerHTML = `
      <div id="modalCard" class="p-4 md:p-6">
        <div class="flex justify-between items-start gap-3">
          <div>
            <h3 class="text-xl font-bold">#${data.startNumber} ${data.driverName || ''}</h3>
            <div class="text-sm text-gray-500 italic">${horseLabel}</div>
            <div class="text-gray-600 flex items-center gap-2 mt-1">
              ${getFlagHtml(data)}
              ${getClubLogoHtml(data)}
              <span>${data.className || ''} • ${data.clubName || ''}</span>
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

function renderJudgeDetailHTML(jr, program, data) {
  const scoresByMovementNo = new Map((jr.movements || []).map(m => [normalizeMovementNo(m), m]));
  const programMovements = Array.isArray(program?.movements) ? program.movements : [];

  // Logic for comment visibility
  // Admins/Secretariat can see all.
  // Drivers can only see their own.
  const user = getGlobalState('currentUser') || {};
  const role = user.role || '';
  const isAdmin = role === 'admin' || role === 'sekretariat';

  const eq = (data && data.__eq) ? data.__eq : {};
  // Check against email or driverEmail
  const userEmail = (user.email || '').toLowerCase();
  const eqEmail = (eq.email || '').toLowerCase();
  const eqDriverEmail = (eq.driverEmail || '').toLowerCase();

  const isMyEquipage = userEmail && (userEmail === eqEmail || userEmail === eqDriverEmail);

  const showComments = isAdmin || isMyEquipage;

  let html = `<div class="overflow-x-auto"><table class="min-w-full text-sm"><thead class="bg-gray-50"><tr><th class="p-2 text-left w-2/12">Moment</th><th class="hidden md:table-cell p-2 text-left w-3/12">Att bedöma</th>${showComments ? '<th class="p-2 text-left w-5/12">Kommentar</th>' : ''}<th class="p-2 text-center w-1/12">Poäng</th><th class="p-2 text-center w-1/12">Resultat</th></tr></thead><tbody class="bg-white divide-y divide-gray-200">`;

  let calculatedSum = 0;
  let calculatedMax = 0;

  if (jr && jr.eliminated) {
    html += `<tr><td colspan="${showComments ? 5 : 4}" class="p-4 text-center text-red-600 font-bold bg-red-50">ELIMINERAD</td></tr>`;
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

      html += `<tr><td class="p-2 align-top"><p class="font-semibold">${moment.no}. ${moment.text || ''}</p><p class="text-xs text-blue-800">${moment.letters || ''}</p></td><td class="hidden md:table-cell p-2 align-top text-gray-600">${moment.judge || ''}</td>${showComments ? `<td class="p-2 align-top italic text-gray-700">${com}</td>` : ''}<td class="p-2 text-center align-top font-semibold text-lg">${scTxt}</td><td class="p-2 text-center align-top font-bold text-lg">${resTxt}</td></tr>`;
    });
  }

  // Calculate finals if not eliminated
  let totalPoints = 0, percent = 0, penalty = 0;

  if (jr && !jr.eliminated) {
    const pCoeff = getDressagePenaltyCoeff(program);
    totalPoints = calculatedSum;
    percent = calculatedMax > 0 ? (calculatedSum / calculatedMax) * 100 : 0;
    penalty = (calculatedMax - calculatedSum) * pCoeff;
  }

  const colspan = isMobile() ? (showComments ? 3 : 2) : (showComments ? 4 : 3);
  html += `</tbody><tfoot class="font-semibold"><tr class="border-t-2 bg-gray-50"><td colspan="${colspan}" class="p-2 text-right">Totalpoäng:</td><td class="p-2 text-center text-lg">${jr?.eliminated ? '–' : fmtNum(totalPoints)}</td></tr><tr class="bg-blue-50"><td colspan="${colspan}" class="p-2 text-right">Procent:</td><td class="p-2 text-center">${jr?.eliminated ? '–' : fmtPct(percent)}</td></tr><tr class="bg-blue-100 font-bold"><td colspan="${colspan}" class="p-2 text-right">Straffpoäng:</td><td class="p-2 text-center text-lg">${jr?.eliminated ? '–' : fmtNum(penalty)}</td></tr></tfoot></table></div>`; return html;
}
function renderTotalDetailHTML(data, judges, program) {
  const programMovements = Array.isArray(program?.movements) ? program.movements : [];
  let html = `<div class="overflow-x-auto"><table class="min-w-full text-sm"><thead class="bg-gray-50"><tr><th class="p-2 text-left">Moment</th><th class="hidden md:table-cell p-2 text-left">Att bedöma</th><th class="p-2 text-center">Snitt (0-10)</th><th class="p-2 text-center">Tot (m. koeff)</th></tr></thead><tbody class="bg-white divide-y divide-gray-200">`;
  let calculatedTotalScore = 0;
  if (data.eliminated) { html += `<tr><td colspan="4" class="p-4 text-center text-red-600 font-bold bg-red-50">ELIMINERAD</td></tr>`; } else if (programMovements.length) { programMovements.forEach(moment => { const scores = judges.map(j => { const jr = data.judges[j.id]; const m = (jr?.movements || []).find(mv => normalizeMovementNo(mv) === moment.no); return m?.score; }).filter(s => s != null).map(Number); const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length) : null; const res = (avg != null) ? avg * (moment.coeff || 1) : null; if (res != null) calculatedTotalScore += res; html += `<tr><td class="p-2 align-top"><p class="font-semibold">${moment.no}. ${moment.text || ''}</p><p class="text-xs text-blue-800">${moment.letters || ''}</p></td><td class="hidden md:table-cell p-2 align-top text-gray-600">${moment.judge || ''}</td><td class="p-2 text-center align-top font-semibold text-lg">${avg != null ? avg.toFixed(2) : '–'}</td><td class="p-2 text-center align-top font-bold text-lg">${res != null ? res.toFixed(2) : '–'}</td></tr>`; }); }
  const colspan = isMobile() ? 2 : 3;
  html += `</tbody><tfoot class="font-semibold"><tr class="border-t-2 bg-gray-50"><td colspan="${colspan}" class="p-2 text-right">Totalt:</td><td class="p-2 text-center text-lg">${data.eliminated ? '–' : calculatedTotalScore.toFixed(1)}</td></tr><tr class="bg-green-50"><td colspan="${colspan}" class="p-2 text-right">Snittprocent:</td><td class="p-2 text-center">${fmtPct(data.finalPercent || data.avgPercent)}</td></tr><tr class="bg-orange-50"><td colspan="${colspan}" class="p-2 text-right">Felkörningspoäng:</td><td class="p-2 text-center">${(Number(data.errorPoints) || 0).toFixed(1)}</td></tr><tr class="bg-red-100 font-bold"><td colspan="${colspan}" class="p-2 text-right">Totalt Straff:</td><td class="p-2 text-center text-lg">${fmtNum(data.finalPenalty)}</td></tr></tfoot></table></div>`; return html;
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
      Skapar PDF...`;
    btn.disabled = true;
    try { await generateDressagePdf(String(startNumber), processedResultsRef || [], { providers: (providers || null) }); } catch (e) { console.error('PDF-fel', e); alert('Ett fel uppstod vid skapande av PDF.'); } finally { btn.innerHTML = orig; btn.disabled = false; }
  });
}

// === GLOBAL EXPORT (LÖSER IMPORTPROBLEMET) ===
window.DressageModal = { openDetails };