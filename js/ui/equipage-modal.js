// ui/equipage-modal.js
// Ekipage-modal utdragen till egen modul.

// --- Importer (identiska källor som totalsidan använder) ---
import {
  getDressageResultsForEquipage,
  getMarathonTimingForEquipage,
  getMarathonObstacleResults,
  getMarathonLiveDocument,
  getPrecisionResultForEquipage,
  getConfig
} from '../services/firestoreService.js';
import { getClubLogoHtml } from '../services/logosService.js';
import { getFlagHtml } from '../services/flagsService.js';
import {
  getPrograms,
  normalizeMovementNo,
  fmtPct,
  guessProgramKeyFromClass,
  normalizeMovements,
  deduplicateAndFilterProtocols
} from '../utils/dressageUtils.js';
import { calculateDressageResult, calculateSingleJudgeDressageResult } from '../services/calculationService.js';

import {
  renderMarathonContent,
  // We need to set config if not already set globally or by other modules
} from './marathonModal.js';

import { setMarathonConfig } from '../utils/marathonUtils.js';
import { renderPrecisionContent } from './precisionModal.js';
import { renderDressageContent } from './dressageModal.js';

// --- Små hjälpare (lokala till modalen, så totalfilen slipper exportera dem) ---
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt2 = (v) => (Number.isFinite(+v) ? (+v).toFixed(2) : '—');
const secondsToMMSS = (s) => { if (s == null || isNaN(s)) return null; const m = Math.floor(s / 60); const ss = Math.round(s % 60).toString().padStart(2, '0'); return `${m}:${ss}`; };
const _msToLabel = (ms, withCs = true) => {
  ms = Math.max(0, Math.floor(ms || 0));
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), cs = Math.floor((ms % 1000) / 10);
  return withCs ? `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(cs).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

// Dressyrprogram & koefficient (kopierat i miniform från totalfilen)
function expandDressagePosition(j) {
  const r = (j?.roles || []).find(r => r?.discipline === 'dressage' && r.position);
  return r ? String(r.position).toUpperCase() : (j?.position ? String(j.position).toUpperCase() : '');
}

// --- Modalens egna stilar (injiceras en gång) ---
function injectModalStyles() {
  if (document.getElementById('equipage-modal-styles')) return;
  const css = `
  .tr-modal-backdrop{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:2147483647;background:rgba(0,0,0,.0);backdrop-filter:blur(4px);pointer-events:none;opacity:0;transition:background .18s ease,opacity .18s ease;padding:40px 15px;}
  .tr-modal-backdrop.visible{background:rgba(0,0,0,.45);pointer-events:auto;opacity:1;}
  .tr-modal{background:#fff;border-radius:12px;width:100%;max-width:1100px;max-height:90vh;overflow:auto;box-shadow:0 10px 25px rgba(0,0,0,.10);transform:scale(.96);transition:transform .18s ease;}
  .tr-modal-backdrop.visible .tr-modal{transform:scale(1);}
  .tr-modal header{position:sticky;top:0;background:#fff;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid #eee;}
  .tr-modal .tabs{display:flex;gap:8px;padding:10px 16px;border-bottom:1px solid #eee;}
  .tr-modal .tabs button{padding:8px 12px;border-radius:999px;border:1px solid #ddd;background:#fff;cursor:pointer}
  .tr-modal .tabs button.active{background:#111;color:#fff;border-color:#111}
  .tr-modal .content{padding:16px}
  .tr-close{border:0;background:transparent;font-size:20px;cursor:pointer;color:inherit}
  
  /* Dark Mode Overrides */
  html.dark .tr-modal { background: #1f2937; color: #f3f4f6; }
  html.dark .tr-modal header { background: #1f2937; border-bottom-color: #374151; }
  html.dark .tr-modal .tabs { border-bottom-color: #374151; }
  html.dark .tr-modal .tabs button { background: #374151; border-color: #4b5563; color: #e5e7eb; }
  html.dark .tr-modal .tabs button.active { background: #e5e7eb; color: #111827; border-color: #e5e7eb; }
  `;
  const el = document.createElement('style'); el.id = 'equipage-modal-styles'; el.textContent = css; document.head.appendChild(el);
}

// === Exporterad funktion ===
// ctx ska innehålla: { competitionId, equipages, resultRows, precisionMap, allCompetitionJudges, marathonConfig, precisionConfig, limitsFor?, secondsToMMSS? }
export async function openEquipageModal(startNumber, ctx) {
  try {
    console.log('[ModalDebug] OPENING startNumber:', startNumber, 'CTX:', ctx);

    // Robust context Check
    if (!ctx) ctx = {};
    if (!ctx.competitionId) {
      ctx.competitionId = window.currentCompetitionId || (window.marathonConfig ? window.marathonConfig.competitionId : null);
      console.warn('[ModalDebug] Recovered competitionId from global:', ctx.competitionId);
    }

    if (!ctx.competitionId) {
      alert('Kunde inte öppna deltagare: Tävlings-ID saknas. Prova att ladda om sidan.');
      return;
    }

    injectModalStyles();

    // Data för detta ekipage
    const r = (ctx?.resultRows || []).find(x => String(x.startNumber) === String(startNumber)) || {};
    const eq = (ctx?.equipages || []).find(e => String(e.startNumber) === String(startNumber)) || {};
    const precisionRow = ctx?.precisionMap?.get?.(String(startNumber)) || {};
    const limFor = ctx?.limitsFor || (() => null);
    const secToMMSS = ctx?.secondsToMMSS || secondsToMMSS;
    const kdDefault = Number(ctx?.marathonConfig?.knockdownPenaltyDefault ?? 0);


    // Set config for utils
    if (ctx.marathonConfig) {
      setMarathonConfig(ctx.marathonConfig);
    }

    // Hästnamn
    const horseNames = [];
    if (eq?.horseName) horseNames.push(String(eq.horseName));
    if (Array.isArray(eq?.horses)) {
      for (const h of eq.horses) {
        const n = h?.name || h?.horseName || h?.namn || h?.id;
        if (n) horseNames.push(String(n));
      }
    }
    if (!horseNames.length && eq?.hästnamn) horseNames.push(String(eq.hästnamn));
    const horsesLabel = horseNames.join(' • ');

    // --- Skapa modal ---
    document.querySelectorAll('.tr-modal-backdrop').forEach(el => { try { el.remove(); } catch { } });
    const backdrop = document.createElement('div'); backdrop.className = 'tr-modal-backdrop';
    const modal = document.createElement('div'); modal.className = 'tr-modal';

    modal.innerHTML = `
    <header>
      <div class="flex justify-between items-start w-full">
        <div>
          <h3 class="text-xl font-bold">#${escapeHtml(String(startNumber))} ${escapeHtml(r.driverName || eq.driverName || '')}</h3>
          <div class="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-2 mt-1">
             ${getFlagHtml(eq)} ${escapeHtml(eq.className || r.className || '')} • ${eq.clubName ? escapeHtml(eq.clubName) : ''}
          </div>
          <div class="text-xs italic text-gray-500 dark:text-gray-500">${horsesLabel ? escapeHtml(horsesLabel) : '—'}</div>
        </div>
        <button class="tr-close text-2xl leading-none" aria-label="Stäng">×</button>
      </div>
    </header>
    <div id="tr-tabs" class="tabs"></div>
    <div id="tr-modal-body" class="content"><div class="p-8 text-center text-gray-500">Hämtar detaljerade resultat...</div></div>
  `;
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('visible'));

    // Stäng
    const close = () => { document.removeEventListener('keydown', onKey); backdrop.classList.remove('visible'); setTimeout(() => { try { backdrop.remove(); } catch { } }, 180); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    modal.querySelector('.tr-close')?.addEventListener('click', (e) => { e.stopPropagation(); close(); });
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) { e.stopPropagation(); close(); } });
    modal.addEventListener('click', (e) => e.stopPropagation());

    // Tabs
    const tabsEl = modal.querySelector('#tr-tabs');
    const bodyEl = modal.querySelector('#tr-modal-body');

    console.log('[ModalDebug] Opening for:', startNumber, 'Competition:', ctx.competitionId);

    // Förbereda datakällor (dressyr, tider, precision)
    const [dressageProtocols, marathonTiming, precisionResult] = await Promise.all([
      getDressageResultsForEquipage(ctx.competitionId, startNumber)
        .then(res => {
          console.log('[ModalDebug] Fetched protocols:', res);
          return res;
        })
        .catch(err => {
          console.error('[ModalDebug] Fetch error:', err);
          return [];
        }),
      getMarathonTimingForEquipage(ctx.competitionId, startNumber).catch(() => ({})),
      Promise.resolve(precisionRow || {})
    ]);

    console.log('[ModalDebug] Protocols count:', dressageProtocols.length);

    // === TAB-innehåll ===
    async function renderTotalTab() {
      const diffLead = (r.diffFromLeader != null && r.diffFromLeader > 0) ? `+${r.diffFromLeader.toFixed(2)}` : '—';
      const posDress = Number.isFinite(r.posDress) ? `#${r.posDress}` : '—';
      const posMar = Number.isFinite(r.posMar) ? `#${r.posMar}` : '—';
      const posPrec = Number.isFinite(r.posPrec) ? `#${r.posPrec}` : '—';

      bodyEl.innerHTML = `
      <div class="p-2 space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div class="p-3 rounded-md bg-emerald-50 dark:bg-emerald-900 border border-transparent dark:border-emerald-800">
            <div class="text-xs text-gray-600 dark:text-emerald-100">Plac</div>
            <div class="text-xl font-bold text-emerald-900 dark:text-emerald-50">${r.plac ?? '—'}</div>
          </div>
          <div class="p-3 rounded-md bg-blue-50 dark:bg-blue-900 border border-transparent dark:border-blue-800">
            <div class="text-xs text-gray-600 dark:text-blue-100">Diff</div>
            <div class="text-xl font-bold text-blue-900 dark:text-blue-50">${diffLead}</div>
          </div>
          <div class="p-3 rounded-md bg-gray-50 dark:bg-gray-700"><div class="text-xs text-gray-600 dark:text-gray-300">Dressyr</div><div class="text-lg font-semibold dark:text-gray-100">${posDress}</div></div>
          <div class="p-3 rounded-md bg-gray-50 dark:bg-gray-700"><div class="text-xs text-gray-600 dark:text-gray-300">Maraton</div><div class="text-lg font-semibold dark:text-gray-100">${posMar}</div></div>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div class="p-3 rounded-md bg-white dark:bg-gray-800 border dark:border-gray-700"><div class="text-xs text-gray-600 dark:text-gray-400">Dressyr (str)</div><div class="text-lg font-bold tabular-nums dark:text-gray-100">${fmt2(r?.dressage?.penalty)}</div></div>
          <div class="p-3 rounded-md bg-white dark:bg-gray-800 border dark:border-gray-700"><div class="text-xs text-gray-600 dark:text-gray-400">Maraton (str)</div><div class="text-lg font-bold tabular-nums dark:text-gray-100">${fmt2(r?.marathon?.totalPenalty)}</div></div>
          <div class="p-3 rounded-md bg-white dark:bg-gray-800 border dark:border-gray-700"><div class="text-xs text-gray-600 dark:text-gray-400">Precision (str)</div><div class="text-lg font-bold tabular-nums dark:text-gray-100">${fmt2(r?.precision?.pen)}</div></div>
          <div class="p-3 rounded-md bg-amber-50 dark:bg-amber-900 border border-amber-200 dark:border-amber-800 col-span-2">
            <div class="flex items-center justify-between">
              <div>
                <div class="text-xs text-gray-600 dark:text-amber-100">Totalt</div>
                <div class="text-2xl font-extrabold tabular-nums text-amber-900 dark:text-amber-50 leading-none">${fmt2(r.totalPenalty)}</div>
              </div>
              <div class="text-xs font-medium px-2 py-1 rounded bg-amber-100 dark:bg-amber-800 text-amber-900 dark:text-amber-100 ${r.isEliminated ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' : ''}">
                ${r.isEliminated ? escapeHtml(r.elimReason || 'Elim') : 'Fullföljt'}
              </div>
            </div>
          </div>
        </div>
      </div>`;
    }

    async function renderDressyrTab() {
      // Försök hitta programnyckel från ekipaget, eller från första protokollet
      const p1 = dressageProtocols[0] || {};
      let programKey = eq.dressageProgramKey || p1.programKey || p1.testKey || p1.protocol?.testKey;

      // Fallback: Slå upp via klassnamn från config (om definierat)
      // Fallback: Slå upp via klassnamn från config (om definierat)
      if (!programKey) {
        // 1. Kolla ctx.classProgramMapping (från total-resultat.js)
        const mapping = ctx.classProgramMapping || window.klassProgramMapping;
        const cls = eq._mergedLabel || eq.className || '';

        if (mapping && mapping[cls]) {
          programKey = mapping[cls];
          console.log('[ModalDebug] Resolved program via mapping:', cls, '=>', programKey);
        } else {
          // 2. Kolla ctx.competitionConfig (legacy)
          const conf = ctx.competitionConfig;
          if (conf?.classes && conf.classes[cls]) {
            programKey = conf.classes[cls];
            console.log('[ModalDebug] Resolved program via competitionConfig:', cls, '=>', programKey);
          }
        }
      }

      // Fallback: Gissa via heuristik (fuzzy match)
      if (!programKey) {
        const cls = eq._mergedLabel || eq.className || '';
        const guessed = guessProgramKeyFromClass(cls, getPrograms());
        if (guessed) {
          programKey = guessed;
          console.log('[ModalDebug] Guessed program via heuristics:', cls, '=>', programKey);
        }
      }

      // Logga vad vi hittade
      console.log('[ModalDebug] Program Lookup:', {
        fromEq: eq.dressageProgramKey,
        fromProto: p1.testKey || p1.programKey,
        finalKey: programKey
      });

      const programs = getPrograms();
      const program = programKey ? programs[programKey] : null;

      // 1. Clean Protocols
      const validProtocols = deduplicateAndFilterProtocols(dressageProtocols || [], ctx.allCompetitionJudges || []);

      // 2. Build Judges Map using Service
      const judgesMap = {};
      validProtocols.forEach(p => {
        const jid = p.judgeId || p.id || p.position;
        if (!jid) return;

        // Use helper to get single judge result
        let jr = null;
        if (program) {
          jr = calculateSingleJudgeDressageResult(p, program, eq);
        }

        let safePos = (jr?.position || p.position || '').toUpperCase();

        // Fallback: If position is missing in protocol, try to find it in judge registry
        if (!safePos && ctx.allCompetitionJudges) {
          const foundJ = ctx.allCompetitionJudges.find(j => j.id === jid || j.id === `judge_${jid}`);
          if (foundJ) {
            if (foundJ.position) safePos = foundJ.position.toUpperCase();
            else if (Array.isArray(foundJ.roles)) {
              const r = foundJ.roles.find(x => x && x.discipline === 'dressage');
              if (r && r.position) safePos = r.position.toUpperCase();
            } else if (foundJ.disciplines && foundJ.disciplines.dressage) {
              safePos = foundJ.disciplines.dressage.toUpperCase();
            }
          }
        }

        // Always create entry, even if calc failed (e.g. missing program)
        // so that the UI can show "Program Missing" instead of empty
        // Name formatting
        let safeName = p.judgeName || p.name;
        // If name is missing or looks like an ID, try to find better name
        if (!safeName || safeName === jid || safeName.includes('_') || safeName.includes('-')) {
          if (ctx.allCompetitionJudges) {
            const foundJ = ctx.allCompetitionJudges.find(j => j.id === jid || j.id === `judge_${jid}`);
            if (foundJ && foundJ.name) {
              safeName = foundJ.name;
            }
          }
        }
        // Final fallback: format the ID
        if (!safeName || safeName === jid || safeName.includes('_')) {
          let temp = jid.replace(/^judge_/, '').replace(/[_-]/g, ' ');
          safeName = temp.replace(/\b\w/g, c => c.toUpperCase());
        }

        // Always create entry, even if calc failed (e.g. missing program)
        // so that the UI can show "Program Missing" instead of empty
        judgesMap[jid] = {
          id: jid,
          position: safePos,
          name: safeName,
          movements: normalizeMovements(p.movements),
          totalPoints: jr ? jr.points : p.totalPoints,
          penalty: jr ? jr.penalty : p.penalty,
          percent: jr ? jr.percent : p.percent,
          eliminated: jr ? jr.eliminated : (p.eliminated || false)
        };
      });

      // 3. Final Aggregated Result
      const result = calculateDressageResult(eq, validProtocols, ctx.allCompetitionJudges || [], programs);

      const data = {
        startNumber: String(startNumber),
        driverName: r.driverName || eq.driverName,
        clubName: r.clubName || eq.clubName,
        className: r.className || eq.className,
        country: eq.country,
        _mergedLabel: eq._mergedLabel,
        horseName: horsesLabel,
        finalPercent: result?.percent,
        finalPoints: result?.points,
        finalPenalty: result?.penalty,
        errorPoints: result?.errorPoints,
        errorPenalty: result?.errorPenalty,
        eliminated: result?.eliminated || r.isEliminated,
        judges: judgesMap,
        __savedProtocols: validProtocols,
        __eq: eq
      };

      const order = { C: 0, E: 1, B: 2, H: 3, M: 4 };
      let judgesPresent = Object.values(judgesMap).map(j => ({
        id: j.id, name: j.name, position: (j.position || '?').toUpperCase()
      })).filter(j => String(j.id).toLowerCase() !== 'general' && String(j.name).toLowerCase() !== 'general')
        .sort((a, b) => {
          const valA = order[a.position] ?? 99;
          const valB = order[b.position] ?? 99;
          if (valA !== valB) return valA - valB;
          return a.position.localeCompare(b.position);
        });

      data.__judgesPresent = judgesPresent;

      const computedFinalFallback = n => n;
      const pdfContext = {
        startNumber: String(startNumber),
        processedResultsRef: [data],
        providers: {
          getStatus: () => ({ finalPenalty: data.finalPenalty }),
          getSavedProtocols: () => data.__savedProtocols || [],
          getPrograms: () => getPrograms(),
          getProgramForEq: () => program,
          getEquipage: () => eq,
          computeFinalFromSaved: computedFinalFallback
        }
      };

      renderDressageContent(bodyEl, data, judgesPresent, program, pdfContext, ctx.competitionConfig?.isInternational);
    }

    async function renderMaratonTab() {
      // Vi hämtar all data som krävs (inklusive hinderresultat via Firestore om så behövs)
      // 1. Get Timing Data
      let timing = {};
      if (ctx.marathonTimeMap && ctx.marathonTimeMap.has(String(startNumber))) {
        timing = ctx.marathonTimeMap.get(String(startNumber));
      } else {
        timing = marathonTiming || {};
      }

      // 2. Get Obstacle Data & Observer Log
      let obstacles = [];
      let observerLog = {}; // [FIX] Declare variable

      if (ctx.marathonObstacleMap && ctx.marathonObstacleMap.has(String(startNumber))) {
        const rawObs = ctx.marathonObstacleMap.get(String(startNumber));
        if (rawObs) {
          if (rawObs.observerLog) observerLog = rawObs.observerLog;

          if (Array.isArray(rawObs.obstacles)) {
            obstacles = rawObs.obstacles;
          } else if (rawObs.obstacles && typeof rawObs.obstacles === 'object') {
            // [FIX] Handle objects (Firebase maps)
            obstacles = Object.values(rawObs.obstacles);
          } else if (Array.isArray(rawObs)) {
            obstacles = rawObs;
          }
        }
      }

      let liveDocForMerge = null;

      // If context map was empty/missing, try Async logic:
      if (!obstacles || obstacles.length === 0) {
        const [liveDoc, storedObstacles] = await Promise.all([
          getMarathonLiveDocument(ctx.competitionId, String(startNumber)).catch(() => null),
          getMarathonObstacleResults(ctx.competitionId, String(startNumber)).catch(() => [])
        ]);

        if (liveDoc) {
          liveDocForMerge = liveDoc;
          if (Array.isArray(liveDoc.obstacles) && liveDoc.obstacles.length > 0) {
            obstacles = liveDoc.obstacles;
          } else if (liveDoc.obstacles && typeof liveDoc.obstacles === 'object') {
             // [FIX] Handle objects from liveDoc
             obstacles = Object.values(liveDoc.obstacles);
          }
          if (liveDoc.observerLog) observerLog = liveDoc.observerLog; // [FIX] Extract from livedoc fallback
        }

        if (!obstacles || obstacles.length === 0) {
          obstacles = storedObstacles;
        }
      }

      // 3. Merge for Display
      // [FIX] Ensure we merge the raw obstacle/live document into the data 
      // because manual stage times might be stored there (similar to total-resultat.js fix)
      let mergedData = { ...timing };

      if (liveDocForMerge) {
          mergedData = { ...mergedData, ...liveDocForMerge };
      }

      // If we have a raw document from the map, merge it
      if (ctx.marathonObstacleMap && ctx.marathonObstacleMap.has(String(startNumber))) {
        const raw = ctx.marathonObstacleMap.get(String(startNumber));
        if (raw) mergedData = { ...mergedData, ...raw };
      }

      const marathonData = {
        ...mergedData, // Includes timing AND raw obstacle doc properties
        obstacles: obstacles,
        observerLog: observerLog,
        // Explicitly map durations if needed
        duration_A: timing.duration_A || mergedData.duration_A,
        duration_B: timing.duration_B || mergedData.duration_B
      };

      // Rendera direkt i bodyEl
      renderMarathonContent(bodyEl, eq, marathonData);
    }

    async function renderPrecisionTab() {
      // Rendera via den delade funktionen
      // Hämta färsk data (live update)
      const latestPrecision = await getPrecisionResultForEquipage(ctx.competitionId, startNumber).catch(() => precisionResult);

      // STARTTIDER: ctx.startTimes kanske inte finns i ctx, så vi skickar tomt objekt { times: {} } om det saknas
      const st = ctx.startTimes || { times: {} };
      // EQUIPAGES: ctx.equipages behövs för beräkningar
      const eqs = ctx.equipages || [];

      // Vi skickar med precisionsresultatet vi just hämtade (eller fallback)
      renderPrecisionContent(bodyEl, eq, latestPrecision || {}, ctx.precisionConfig, st, eqs);
    }

    async function renderInfoTab() {
      bodyEl.innerHTML = `
      <div class="p-4">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div class="p-3 rounded border bg-white dark:bg-gray-800 dark:border-gray-700">
            <div class="text-xs text-gray-600 dark:text-gray-400">Startnummer</div>
            <div>#${escapeHtml(String(eq.startNumber || ''))}</div>
          </div>
          <div class="p-3 rounded border bg-white dark:bg-gray-800 dark:border-gray-700">
            <div class="text-xs text-gray-600 dark:text-gray-400">Klass</div>
            <div>${escapeHtml(eq.className || r.className || '—')}</div>
          </div>
          <div class="p-3 rounded border bg-white dark:bg-gray-800 dark:border-gray-700">
            <div class="text-xs text-gray-600 dark:text-gray-400">Klubb/Förening</div>
            <div class="flex items-center gap-2">${getFlagHtml(eq) || ''}${getClubLogoHtml(eq) || ''}<span>${escapeHtml(eq.clubName || '—')}</span></div>
          </div>
          <div class="p-3 rounded border bg-white dark:bg-gray-800 dark:border-gray-700">
            <div class="text-xs text-gray-600 dark:text-gray-400">Hästar</div>
            <div>${horsesLabel ? escapeHtml(horsesLabel) : '—'}</div>
          </div>
        </div>
      </div>`;
    }

    // Tablayout
    const tabs = [
      { id: 'total', label: 'Total', render: renderTotalTab },
      { id: 'dressyr', label: 'Dressyr', render: renderDressyrTab },
      { id: 'maraton', label: 'Maraton', render: renderMaratonTab },
      { id: 'precision', label: 'Precision', render: renderPrecisionTab },
      { id: 'info', label: 'Info', render: renderInfoTab },
    ];
    tabsEl.innerHTML = tabs.map(t => `<button data-tab="${t.id}">${t.label}</button>`).join('');
    const switchTab = (id) => {
      tabsEl.querySelectorAll('button[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
      bodyEl.innerHTML = `<div class="p-8 text-center text-gray-500">Laddar…</div>`;
      tabs.find(t => t.id === id)?.render();
    };
    tabsEl.addEventListener('click', (e) => { const btn = e.target.closest('button[data-tab]'); if (btn) switchTab(btn.dataset.tab); });
    switchTab('total');

  } catch (err) {
    console.error('[ModalDebug] CRITICAL ERROR in openEquipageModal:', err);
    alert('Ett fel uppstod när modalen skulle öppnas:\\n' + err.message);
  }
}