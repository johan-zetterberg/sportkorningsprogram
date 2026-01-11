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
  getDressagePenaltyCoeff,
  normalizeMovementNo,
  fmtPct
} from '../utils/dressageUtils.js';

import { renderMarathonContent } from './marathonModal.js';
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
  .tr-close{border:0;background:transparent;font-size:20px;cursor:pointer}
  `;
  const el = document.createElement('style'); el.id = 'equipage-modal-styles'; el.textContent = css; document.head.appendChild(el);
}

// === Exporterad funktion ===
// ctx ska innehålla: { competitionId, equipages, resultRows, precisionMap, allCompetitionJudges, marathonConfig, precisionConfig, limitsFor?, secondsToMMSS? }
export async function openEquipageModal(startNumber, ctx) {
  injectModalStyles();

  // Data för detta ekipage
  const r = (ctx?.resultRows || []).find(x => String(x.startNumber) === String(startNumber)) || {};
  const eq = (ctx?.equipages || []).find(e => String(e.startNumber) === String(startNumber)) || {};
  const precisionRow = ctx?.precisionMap?.get?.(String(startNumber)) || {};
  const limFor = ctx?.limitsFor || (() => null);
  const secToMMSS = ctx?.secondsToMMSS || secondsToMMSS;
  const kdDefault = Number(ctx?.marathonConfig?.knockdownPenaltyDefault ?? 0);

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
          <div class="text-sm text-gray-600 flex items-center gap-2 mt-1">
             ${getFlagHtml(eq)} ${escapeHtml(eq.className || r.className || '')} • ${eq.clubName ? escapeHtml(eq.clubName) : ''}
          </div>
          <div class="text-xs italic text-gray-500">${horsesLabel ? escapeHtml(horsesLabel) : '—'}</div>
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
          <div class="p-3 rounded-md bg-emerald-50">
            <div class="text-xs text-gray-600">Plac</div>
            <div class="text-xl font-bold">${r.plac ?? '—'}</div>
          </div>
          <div class="p-3 rounded-md bg-blue-50">
            <div class="text-xs text-gray-600">Diff mot ledare</div>
            <div class="text-xl font-bold">${diffLead}</div>
          </div>
          <div class="p-3 rounded-md bg-gray-50"><div class="text-xs text-gray-600">Dressyr (plac)</div><div class="text-lg font-semibold">${posDress}</div></div>
          <div class="p-3 rounded-md bg-gray-50"><div class="text-xs text-gray-600">Maraton (plac)</div><div class="text-lg font-semibold">${posMar}</div></div>
          <div class="p-3 rounded-md bg-gray-50 col-span-2 md:col-span-1"><div class="text-xs text-gray-600">Precision (plac)</div><div class="text-lg font-semibold">${posPrec}</div></div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div class="p-3 rounded-md bg-white border"><div class="text-xs text-gray-600">Dressyr (straff)</div><div class="text-xl font-bold tabular-nums">${fmt2(r?.dressage?.penalty)}</div></div>
          <div class="p-3 rounded-md bg-white border"><div class="text-xs text-gray-600">Maraton (straff)</div><div class="text-xl font-bold tabular-nums">${fmt2(r?.marathon?.totalPenalty)}</div></div>
          <div class="p-3 rounded-md bg-white border"><div class="text-xs text-gray-600">Precision (straff)</div><div class="text-xl font-bold tabular-nums">${fmt2(r?.precision?.pen)}</div></div>
          <div class="p-3 rounded-md bg-amber-50 border-amber-200 border">
            <div class="text-xs text-gray-600">Totalt</div>
            <div class="text-2xl font-extrabold tabular-nums">${fmt2(r.totalPenalty)}</div>
            <div class="text-xs mt-1 ${r.isEliminated ? 'text-red-600' : 'text-gray-600'}">
              ${r.isEliminated ? escapeHtml(r.elimReason || 'Eliminerad') : 'Fullföljt'}
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

    // Logga vad vi hittade
    console.log('[ModalDebug] Program Lookup:', {
      fromEq: eq.dressageProgramKey,
      fromProto: p1.testKey || p1.programKey,
      finalKey: programKey
    });

    const program = programKey ? getPrograms()[programKey] : null;

    if (!program) {
      console.warn('[ModalDebug] Program NOT found for key:', programKey, 'Available:', Object.keys(getPrograms()));
    }

    // 1. Normalisera protokoll
    const normalized = (dressageProtocols || []).map(d => {
      if (!d) return null;
      const base = (d.protocol && typeof d.protocol === 'object') ? d.protocol :
        (d.value && typeof d.value === 'object') ? d.value : d;
      return { ...d, ...base };
    }).filter(Boolean);

    // 2. Bygg "data"-objektet
    const judgesMap = {};
    normalized.forEach(p => {
      const docId = p.id || '';
      let realJudgeId = p.judgeId;

      // Fallback: Om judgeId saknas men docId heter "judge_XYZ"
      if (!realJudgeId && docId.startsWith('judge_')) {
        realJudgeId = docId.replace(/^judge_/, '');
      }

      const jid = realJudgeId || docId || p.position;

      if (!jid) {
        console.warn('Skipping protocol, no ID found:', p);
        return;
      }

      const availableJudges = ctx?.allCompetitionJudges || [];
      const full = availableJudges.find(j => j.id === realJudgeId || j.id === jid) || {};

      if (!availableJudges.length) console.warn('[ModalDebug] ctx.allCompetitionJudges is empty!');

      const expandedPos = expandDressagePosition(full);
      let pos = (p.position || p.judgePos || expandedPos || full.position || '?').toUpperCase();

      if (pos === '?' && /^[CEBHM]$/.test(jid)) pos = jid;

      console.log(`Mapping judge ${jid} (Real: ${realJudgeId}): Found pos '${pos}'`);

      if (jid === 'general') return;

      judgesMap[jid] = {
        id: jid,
        position: pos,
        name: p.judgeName || p.name || full.name || jid,
        movements: p.movements || [],
        totalPoints: p.totalPoints,
        penalty: p.penalty,
        percent: p.percent,
        eliminated: p.eliminated
      };
    });

    const data = {
      startNumber: String(startNumber),
      driverName: r.driverName || eq.driverName,
      clubName: r.clubName || eq.clubName,
      className: r.className || eq.className,
      country: eq.country,
      _mergedLabel: eq._mergedLabel,
      horseName: horsesLabel,
      finalPercent: r?.dressage?.percentAvg,
      finalPoints: null,
      finalPenalty: r?.dressage?.penalty,
      errorPoints: r?.dressage?.errorPoints,
      eliminated: r.isEliminated,
      judges: judgesMap,
      __savedProtocols: dressageProtocols,
      __eq: eq
    };

    const order = { C: 0, E: 1, B: 2, H: 3, M: 4 };
    let judgesPresent = Object.values(judgesMap).map(j => ({
      id: j.id, name: j.name, position: (j.position || '').toUpperCase()
    })).filter(j => /^[CEBHM]$/.test(j.position))
      .sort((a, b) => (order[a.position] ?? 99) - (order[b.position] ?? 99));

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

    renderDressageContent(bodyEl, data, judgesPresent, program, pdfContext);
  }

  async function renderMaratonTab() {
    // Vi hämtar all data som krävs (inklusive hinderresultat via Firestore om så behövs)
    const timing = marathonTiming || {};
    // Förbered maraton-data objektet så det matchar vad renderMarathonContent förväntar sig
    // Vi kombinerar 'r.marathon' (computed) med 'timing' (rådata)
    // OBS: renderMarathonContent hämtar själv hinderdata om det behövs, men här har vi ingen "map" redo för det
    // Så vi kanske bör hämta allt och bygga ett objekt.
    // Eller ännu hellre: Vi skickar in ett "merged" objekt.

    // Vi får göra så här: renderMarathonContent tar "marathonData" som är ett objekt med { map, ... }?
    // NEJ, den tar "marathonData" som är ett objekt med { duration_A, duration_B, obstacles... }
    // I marathonModal.js hämtades det från map.get(sn).
    // Här får vi bygga ihop det.

    // Hämta hinder (async) - försök både "live" dokumentet och subkollektionen
    // "Live"-dokumentet (maraton/{sn}) används av input-appen och är oftast det som är aktuellt.
    const [liveDoc, storedObstacles] = await Promise.all([
      getMarathonLiveDocument(ctx.competitionId, String(startNumber)).catch(() => null),
      getMarathonObstacleResults(ctx.competitionId, String(startNumber)).catch(() => [])
    ]);

    // Använd array från liveDoc i första hand, annars storedObstacles
    const obstacles = (liveDoc && Array.isArray(liveDoc.obstacles) && liveDoc.obstacles.length > 0)
      ? liveDoc.obstacles
      : storedObstacles;

    // Bygg "marathonData" (likt vad map.get(sn) ger i marathonModal)
    // VIKTIGT: Slå ihop liveDoc data (som kan innehålla starttider etc) med marathonTiming
    const marathonData = {
      ...(liveDoc || {}), // Basen: live-dokumentet (om det finns)
      ...timing,          // Ovanpå: timing-data (start_A, finish_A etc)
      duration_A: timing.duration_A,
      duration_B: timing.duration_B,
      // Vi ska skicka arrayen direkt
      obstacles: obstacles
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
          <div class="p-3 rounded border bg-white">
            <div class="text-xs text-gray-600">Startnummer</div>
            <div>#${escapeHtml(String(eq.startNumber || ''))}</div>
          </div>
          <div class="p-3 rounded border bg-white">
            <div class="text-xs text-gray-600">Klass</div>
            <div>${escapeHtml(eq.className || r.className || '—')}</div>
          </div>
          <div class="p-3 rounded border bg-white">
            <div class="text-xs text-gray-600">Klubb/Förening</div>
            <div class="flex items-center gap-2">${getFlagHtml(eq) || ''}${getClubLogoHtml(eq) || ''}<span>${escapeHtml(eq.clubName || '—')}</span></div>
          </div>
          <div class="p-3 rounded border bg-white">
            <div class="text-xs text-gray-600">Hästar</div>
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
}