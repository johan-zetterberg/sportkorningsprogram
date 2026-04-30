// js/pages/dressyr-monitor.js
// En "kontrollrums"-vy som visar alla ekipage som just nu är aktiva på dressyrbanan.

import { getGlobalState } from '../../main.js';
import { t } from '../../utils/i18n.js';
import { getEquipages } from '../../services/equipageService.js';
import { getConfig } from '../../services/competitionService.js';
import { listenForJudges } from '../../services/adminService.js';
import { listenForDressageStatusCollection, listenForDressageLiveGroup, getDressageResultsForEquipage } from '../../services/dressageService.js';
import { listenForDressageProtocolsCollectionGroup } from '../../services/dressageService.js';
import { getCompetitionHeader } from '../../ui/components.js';
import { onSnapshot, doc } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { db, appId } from '../../config/firebase-config.js';
import { ensureClubLogosLoaded, getClubLogoHtml } from '../../services/logosService.js';
import { getFlagHtml } from '../../services/flagsService.js';
import { dressagePrograms as globalDressagePrograms } from '../../data/dressagePrograms.js';

import {
  getDressagePenaltyCoeff,
  normalizeMovements,
  deduplicateAndFilterProtocols,
  guessProgramKeyFromClass,
  normJudgeId
} from '../../utils/dressageUtils.js';
import { calculateDressageResult, calculateSingleJudgeDressageResult } from '../../services/calculationService.js';

import { setupDressageModalOnce, openDetails as openDetailsModal } from '../../ui/dressageModal.js';

// ================= State =================
let competitionId = null;
let allEquipages = [];
let startTimes = {};
let allJudges = [];
let mergedPrograms = {};

// Data-cachar
const judgeLiveByPos = new Map();
const dressageStatusMap = new Map();
const liveProtocolMap = new Map();
const savedProtocolsByStart = new Map();

// Render-variabler
let currentRider = null;
let leaderInClass = null;
const recentResults = [];

let unsubscribes = [];
let lastRenderedUpcomingHash = null;
let lastRenderedResultsHash = null;
let lastRiderSn = "";

// Merge-logik
let monitor_displayConfig = {};
const monitor_MERGE_MAP = new Map();

// ================= Helpers =================

function monitor_buildMergeMap(raw) {
  monitor_MERGE_MAP.clear();
  if (!raw) return;
  const maybeDisplay = raw && typeof raw === 'object' && raw.mergeByClassNumber ? raw : null;
  const source = maybeDisplay ? maybeDisplay.mergeByClassNumber : raw;

  if (source && typeof source === 'object' && !Array.isArray(source)) {
    for (const [grpKey, info] of Object.entries(source)) {
      const members = (info?.members || []).map(Number).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
      if (!members.length) continue;
      const label = String(info?.label || `Sammanslagen: TDB #${members.join('/')}`);
      const key = String(grpKey || `TDBGROUP:${members.join('+')}`);
      members.forEach(num => monitor_MERGE_MAP.set(num, { key, label }));
    }
  }
}

function monitor_resolveMergeGrouping(e) {
  if (e?.useMergedTestForDisplay && e?.mergedTestKey && e?.mergedTestLabel) {
    return { key: String(e.mergedTestKey), label: String(e.mergedTestLabel) };
  }
  const num = Number(e?.tdbClassNumber);
  const hit = Number.isFinite(num) ? monitor_MERGE_MAP.get(num) : null;
  if (hit) return hit;
  const cls = e?.className || '—';
  return { key: `CLASS:${cls}`, label: cls };
}

const formatTime = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }); } catch { return '—'; }
};

function percentBar(pct) {
  if (!Number.isFinite(pct)) return '';
  const w = Math.max(0, Math.min(100, pct));
  return `<div class="mt-2 h-3 bg-gray-200 rounded-full overflow-hidden"><div style="width:${w.toFixed(1)}%" class="h-full bg-green-500 transition-all duration-300"></div></div>`;
}

function isWithdrawnOrExcluded(state, eqLikeObj) {
  const toStr = v => String(v || '').toLowerCase();
  const badStates = new Set(['withdrawn', 'scratched', 'did-not-start', 'dns', 'retired', 'eliminated', 'excluded', 'ute', 'struken', 'struken?']);
  if (badStates.has(toStr(state))) return true;
  const flags = [eqLikeObj?.withdrawn, eqLikeObj?.scratched, eqLikeObj?.struken, eqLikeObj?.didNotStart, eqLikeObj?.dns, eqLikeObj?.eliminated, eqLikeObj?.excluded, eqLikeObj?.retired];
  if (flags.some(v => v === true)) return true;
  const textCandidates = [eqLikeObj?.status, eqLikeObj?.eqStatus, eqLikeObj?.dressageStatus, eqLikeObj?.result, eqLikeObj?.outcome, eqLikeObj?.statusText, eqLikeObj?.reason].map(toStr);
  return textCandidates.some(s => s && (s.includes('withdrawn') || s.includes('scratched') || s.includes('did-not-start') || s === 'dns' || s.includes('eliminated') || s.includes('excluded') || s.includes('struken') || s.includes(' ute')));
}

let renderTimeout = null;
function triggerRender() {
  clearTimeout(renderTimeout);
  renderTimeout = setTimeout(() => {
    findCurrentRiderAndLeader();
    renderCurrentRider();
    renderUpcomingPanel();
    renderResultsPanel();
  }, 80);
}

function getPrevNextEq(currentEq) {
  if (!currentEq) return { prev: null, next: null };
  const withTs = allEquipages
    .map(eq => ({ eq, ts: new Date(startTimes[String(eq.startNumber)]?.dressage || 0).getTime() }))
    .sort((a, b) => a.ts - b.ts);
  const idx = withTs.findIndex(x => x.eq.startNumber === currentEq.startNumber);
  return { prev: idx > 0 ? withTs[idx - 1].eq : null, next: idx >= 0 && idx < withTs.length - 1 ? withTs[idx + 1].eq : null };
}

function pickFinalPenalty(data) { const n = Number(data?.finalJudgeScore?.penalty ?? data?.finalPenalty ?? data?.final?.penalty ?? data?.penalty?.total ?? data?.penalty); return Number.isFinite(n) ? n : null; }
function pickFinalPercent(data) { const n = Number(data?.finalJudgeScore?.percent ?? data?.finalPercent ?? data?.final?.percent); return Number.isFinite(n) ? n : null; }
function pickFinalPoints(data) { const n = Number(data?.finalJudgeScore?.points ?? data?.finalPoints ?? data?.final?.points ?? data?.points?.total ?? data?.points); return Number.isFinite(n) ? n : null; }

function expandDressagePosition(j) {
  if (Array.isArray(j?.roles)) {
    const withPos = j.roles.find(r => r && r.discipline === 'dressage' && r.position);
    if (withPos) return String(withPos.position).toUpperCase();
  }
  if (j?.position) return String(j.position).toUpperCase();
  return '';
}

// ================= BERÄKNING (Använder utils) =================
// function calcLiveJudgeProjection moved to utils

// Helper to merge saved and live protocols consistently
// Helper to merge saved and live protocols consistently
function getMergedProtocols(sn) {
  // 1. Start with saved protocols
  let rawList = [];
  const saved = savedProtocolsByStart.get(sn);
  if (saved) rawList = Array.isArray(saved) ? [...saved] : [saved];

  // 2. Apply strict deduplication and filtering (uses helper!)
  let cleanList = deduplicateAndFilterProtocols(rawList, window.currentJudgesPresent || []);

  // 3. Merge Live (Overwriting saved if matches)
  const liveMap = liveProtocolMap.get(sn); // Now a Map<judgeId, proto>
  if (liveMap) {
    liveMap.forEach(liveProto => {
      // Ensure we have a valid judge ID
      const jid = liveProto.judgeId || liveProto.id || '';
      const rawPos = liveProto.judgePosition || liveProto.position || '';
      const pos = String(rawPos).trim().toUpperCase();

      const finalLive = {
        ...liveProto,
        judgeId: jid,
        id: jid,
        position: pos,
        movements: Array.isArray(liveProto.movements) ? liveProto.movements : [],
        programKey: liveProto.testKey || liveProto.programKey || liveProto.protocol?.testKey
      };

      // If matches an existing judge, replace it. Otherwise add it.
      const idx = cleanList.findIndex(p =>
        (p.judgeId && String(p.judgeId) === String(jid)) ||
        (p.position && String(p.position).toUpperCase() === pos)
      );

      if (idx >= 0) {
        cleanList[idx] = finalLive;
      } else {
        cleanList.push(finalLive);
      }
    });
  }

  // 4. Final filter pass
  return deduplicateAndFilterProtocols(cleanList, window.currentJudgesPresent || []);
}

// ================= UI =================

function renderLayout() {
  const comp = getGlobalState('currentCompetition');
  const root = document.getElementById('page-dressyr-monitor');
  if (!root) return;
  root.innerHTML = `
    <div class="container mx-auto p-4 md:p-8">
      ${getCompetitionHeader(comp, t('dressage_title'))}
      <div id="dressage-current-rider-panel" class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg mb-8 min-h-[320px]"></div>
      <div class="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div id="dressage-upcoming-panel" class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow xl:col-span-1"></div>
        <div id="dressage-results-panel" class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow xl:col-span-2"></div>
      </div>
    </div>
  `;
  injectMonitorStylesOnce();
}

function injectMonitorStylesOnce() {
  if (document.getElementById('dressageMonitorStyles')) return;
  const s = document.createElement('style');
  s.id = 'dressageMonitorStyles';
  s.textContent = `
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
    #liveUpdateTicker { background-color:#1a202c; color:#f7fafc; padding:12px 16px; border-radius:8px; margin-bottom:16px; font-size:14px; display:none; }
    .ticker-grid { display:grid; grid-template-columns:2fr 3fr 3fr; align-items:center; gap:16px; }
    .ticker-header { grid-column:1; font-size:1.1em; display:flex; align-items:center; gap:8px; }
    .latest-score-section { grid-column:2; display:flex; align-items:center; justify-content:space-between; gap:16px; border-left:1px solid #4a5568; border-right:1px solid #4a5568; padding:0 16px; min-height:48px; }
    .latest-score-display .score { font-size:2.1em; font-weight:800; color:#63b3ed; }
    .prognosis-section { grid-column:3; display:flex; align-items:center; justify-content:space-around; gap:16px; flex-wrap:wrap; }
    .main-prognosis .value { font-size:1.6em; font-weight:700; color:#fff; text-align:center; }
    @media (max-width: 768px) { .ticker-grid { grid-template-columns:1fr; gap:10px; } .latest-score-section { grid-column:auto; border:0; } .prognosis-section { grid-column:auto; } }
  `;
  document.head.appendChild(s);
}

// Plocka fram "senaste moment" per domare
function getLastByJudge(protocol, lastUpdate) {
  const out = {};
  const src = protocol?.lastByJudge && typeof protocol.lastByJudge === 'object' ? protocol.lastByJudge : null;
  if (src) {
    Object.entries(src).forEach(([pos, v]) => {
      if (!v) return;
      out[String(pos).toUpperCase()] = { momentText: v.momentText ?? '', score: Number.isFinite(v.score) ? Number(v.score) : null };
    });
  }
  const p = (lastUpdate?.judgePosition || '').toUpperCase();
  if (p) {
    out[p] = { momentText: lastUpdate?.momentText ?? '', score: Number.isFinite(lastUpdate?.score) ? Number(lastUpdate.score) : null };
  }
  return out;
}

// (renderJudgeGrid moved below)

function renderCurrentRider() {
  const panel = document.getElementById('dressage-current-rider-panel');
  if (!panel) return;
  if (!currentRider) { panel.innerHTML = `<div class="text-center p-8 text-gray-500 dark:text-gray-400 text-xl">${t('dressage_monitor_waiting')}</div>`; return; }

  const { eq, liveData } = currentRider;
  // liveData is now Map<jid, proto>
  const liveProtoArray = liveData ? Array.from(liveData.values()) : [];

  // Calculate "Global Moment" (Minimum progress)
  let currentMomentIdx = -1;
  const activeJudges = liveProtoArray.filter(p => p.movements && p.movements.length > 0);

  if (activeJudges.length > 0) {
    // Find the MINIMUM last index across all active judges
    const progressInts = activeJudges.map(j => {
      // Find last index with a score
      const m = j.movements || [];
      for (let i = m.length - 1; i >= 0; i--) {
        if (m[i] && (m[i].score !== null && m[i].score !== '' && m[i].score !== undefined)) return i;
      }
      return -1;
    });
    // If any judge hasn't started (-1), the global moment is effectively "Waiting" (-1)
    // But usually we want to show what the *slowest* judge is doing.
    // If progress is mixed (e.g. 5, 5, 2), min is 2.
    currentMomentIdx = Math.min(...progressInts);
  }

  // Get text for this moment
  let lastMomentTxt = '—';
  if (currentMomentIdx >= 0 && activeJudges.length > 0) {
    // Pick text from the judge that defined the min, or just the first judge's protocol at that index
    // Ideally use the program structure if available, but fallback to protocol text
    const judgeWithMov = activeJudges.find(j => j.movements[currentMomentIdx]);
    if (judgeWithMov) {
      // Try to find the program definition for better text (description)
      const activeM = judgeWithMov.movements[currentMomentIdx];
      const momentNo = activeM.momentNo;

      let pText = '';
      // We need the program object. We can try to reuse logic from calcLiveJudgeProjection
      // Or find it via helper.
      const testKey = judgeWithMov.testKey || judgeWithMov.programKey || eq?.testKey;
      const allProgs = mergedPrograms || {};
      const pObj = allProgs[testKey] || (eq?.className ? allProgs[guessProgramKeyFromClass(eq.className, allProgs)] : null);

      if (pObj && pObj.movements) {
        const pm = pObj.movements.find(m => m.no === momentNo);
        if (pm) pText = pm.text || pm.description || pm.movement || '';
      }

      lastMomentTxt = pText || activeM.momentText || activeM.comment || `Moment ${momentNo}`;
    }
  } else if (activeJudges.length > 0) {
    lastMomentTxt = 'Startar strax...';
  }

  const clubImg = getClubLogoHtml(eq);
  const flagImg = getFlagHtml(eq);

  // Live Aggregate Prognosis
  const programs = getPrograms();
  const result = calculateDressageResult(eq, liveProtoArray, allJudges, programs);
  const currentPenalty = (result && result.projectedPenalty != null) ? result.projectedPenalty : ((result && result.penalty != null) ? result.penalty : null);

  let avgPercent = (result && result.projectedPercent != null) ? result.projectedPercent : (result ? result.percent : null);
  let avgPoints = (result && result.pointsNow) ? result.pointsNow : null;

  const isSameRider = lastRiderSn === String(eq.startNumber);
  lastRiderSn = String(eq.startNumber);

  if (!isSameRider) {
    panel.innerHTML = `
      <div class="flex items-start gap-6">
        <div class="flex-1">
          <div class="flex items-center gap-3 mb-1 dark:text-gray-100">
            ${clubImg}<div class="text-2xl font-bold">#${eq.startNumber} ${eq.driverName || ''}</div>${flagImg}
          </div>
          <div class="text-sm text-gray-600 dark:text-gray-400 mb-3">
            ${eq._mergedLabel || eq.className || ''}${eq.clubName ? ' • ' + eq.clubName : ''}
          </div>
          <div class="grid grid-cols-1 md:grid-cols-6 gap-3">
            <div class="p-3 rounded bg-gray-50 dark:bg-gray-700 md:col-span-4">
              <div class="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">${t('dressage_live_moment_label')}</div>
              <div id="live-moment-text" class="font-semibold leading-snug text-lg dark:text-gray-200">${lastMomentTxt}</div>
              <div class="mt-1 text-[12px] text-gray-700 dark:text-gray-300">${t('dressage_live_moment_desc')}</div>
            </div>
            <div class="p-3 rounded bg-gray-50 dark:bg-gray-700 md:col-span-2">
              <div class="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">${t('dressage_prognosis')}</div>
              <div id="live-prognosis-percent" class="font-semibold text-2xl dark:text-white">${Number.isFinite(avgPercent) ? avgPercent.toFixed(1) + ' %' : '—'}</div>
              <div id="live-prognosis-bar">${percentBar(avgPercent)}</div>
              <div class="mt-1 text-[11px] text-gray-600 dark:text-gray-300">
                ${t('dressage_points_now')}: <span id="live-points-now" class="font-semibold">${Number.isFinite(avgPoints) ? avgPoints.toFixed(1) : '–'}</span> •
                ${t('dressage_penalty_header')}: <span id="live-penalty-now" class="font-semibold text-blue-700 dark:text-blue-400 text-lg">${Number.isFinite(currentPenalty) ? currentPenalty.toFixed(2) : '–'}</span>
              </div>
            </div>
          </div>
          <div id="judge-grid-container">${renderJudgeGrid(liveProtoArray, currentMomentIdx, eq.startNumber)}</div>
        </div>
      </div>`;
  } else {
    // Atomic updates
    const momentTextEl = document.getElementById('live-moment-text');
    if (momentTextEl && momentTextEl.textContent !== lastMomentTxt) momentTextEl.textContent = lastMomentTxt;

    const progPctEl = document.getElementById('live-prognosis-percent');
    if (progPctEl) progPctEl.textContent = Number.isFinite(avgPercent) ? avgPercent.toFixed(1) + ' %' : '—';

    const progBarEl = document.getElementById('live-prognosis-bar');
    if (progBarEl) progBarEl.innerHTML = percentBar(avgPercent);

    const ptsNowEl = document.getElementById('live-points-now');
    if (ptsNowEl) ptsNowEl.textContent = Number.isFinite(avgPoints) ? avgPoints.toFixed(1) : '–';

    const penNowEl = document.getElementById('live-penalty-now');
    if (penNowEl) penNowEl.textContent = Number.isFinite(currentPenalty) ? currentPenalty.toFixed(2) : '–';

    const gridEl = document.getElementById('judge-grid-container');
    if (gridEl) gridEl.innerHTML = renderJudgeGrid(liveProtoArray, currentMomentIdx, eq.startNumber);
  }
}

function renderJudgeGrid(liveProtocolsArray, currentMomentIdx, startNumber) {
  // Build grid from live protocols directly
  // Sort by position
  const sorted = deduplicateAndFilterProtocols(liveProtocolsArray || [], window.currentJudgesPresent || []);
  // Sort: C, E, B, H, M
  const posOrder = { 'C': 0, 'E': 1, 'B': 2, 'H': 3, 'M': 4 };
  sorted.sort((a, b) => (posOrder[String(a.position).toUpperCase()] ?? 99) - (posOrder[String(b.position).toUpperCase()] ?? 99));

  const cells = sorted.map(d => {
    const pos = String(d.position || d.judgePosition || '?').toUpperCase();

    // --- LOOKUP JUDGE NAME ---
    let judgeName = '';
    const cleanId = String(d.judgeId || '').replace(/^judge_/i, '').trim().toLowerCase();
    // 1. Try match by ID in currentJudgesPresent (official list for this competition)
    let judgeObj = (window.currentJudgesPresent || []).find(j => String(j.id).toLowerCase() === cleanId);
    // 2. Fallback: match by Position in currentJudgesPresent
    if (!judgeObj) judgeObj = (window.currentJudgesPresent || []).find(j => String(j.position).toUpperCase() === pos);
    // 3. Fallback: match by ID in allJudges (global list)
    if (!judgeObj) judgeObj = (allJudges || []).find(j => String(j.id).toLowerCase() === cleanId);

    if (judgeObj) judgeName = judgeObj.name || judgeObj.fullname || '';

    // Display formatting
    const nameHtml = judgeName ? `<div class="text-[10px] text-gray-400 truncate -mt-0.5 mb-1">${judgeName}</div>` : '';

    // Calculate projection for this specific judge
    const eq = allEquipages.find(e => String(e.startNumber) === String(startNumber)) || {};
    const programs = getPrograms();
    const testKey = d.testKey || d.programKey || eq?.testKey;
    const pObj = programs[testKey] || (eq?.className ? programs[guessProgramKeyFromClass(eq.className, programs)] : null);

    const jr = calculateSingleJudgeDressageResult(d, pObj, eq);

    const pTxt = jr && Number.isFinite(jr.projectedPercent) ? `${jr.projectedPercent.toFixed(1)}%` : (jr && Number.isFinite(jr.percent) ? `${jr.percent.toFixed(1)}%` : '–');
    const ptsTxt = jr && Number.isFinite(jr.pointsNow) ? jr.pointsNow.toFixed(1) : '–';
    const penTxt = jr && Number.isFinite(jr.projectedPenalty) ? `${jr.projectedPenalty.toFixed(1)} p` : (jr && Number.isFinite(jr.penalty) ? `${jr.penalty.toFixed(1)} p` : '');

    // Get Score for "Current Moment" if active
    let lastTxt = '—', lastScoreTxt = '';
    if (currentMomentIdx >= 0 && d.movements && d.movements[currentMomentIdx]) {
      const m = d.movements[currentMomentIdx];

      let pText = '';
      if (pObj && pObj.movements) {
        const pm = pObj.movements.find(mov => mov.no === m.momentNo);
        if (pm) pText = pm.text || pm.description || pm.movement || '';
      }

      lastTxt = pText || m.momentText || `M${m.momentNo}`;
      if (Number.isFinite(m.score)) lastScoreTxt = ` (${Number(m.score).toFixed(1)})`;
    }

    return `
      <div class="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-700 border dark:border-gray-600">
        <div class="flex flex-col items-center">
             <div class="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">${t('judge')} ${pos}</div>
             ${nameHtml}
        </div>
        <div class="grid grid-cols-3 gap-1.5 text-center mt-1 dark:text-gray-200">
          <div><div class="text-[10px] text-gray-500 dark:text-gray-400">%</div><div class="text-sm font-bold tabular-nums">${pTxt}</div></div>
          <div><div class="text-[10px] text-gray-500 dark:text-gray-400">${t('dressage_points')}</div><div class="text-sm font-bold tabular-nums">${ptsTxt}</div></div>
          <div><div class="text-[10px] text-gray-500 dark:text-gray-400">${t('dressage_penalty_header')}</div><div class="text-sm font-semibold tabular-nums text-blue-700 dark:text-blue-400">${penTxt || '–'}</div></div>
        </div>
        <div class="mt-1.5 text-[10.5px] text-gray-700 dark:text-gray-300 truncate" title="${lastTxt}${lastScoreTxt}"><span class="text-gray-500 dark:text-gray-400">${t('dressage_monitor_moment_label')}:</span> ${lastScoreTxt ? '<b>' + lastScoreTxt + '</b>' : ''}</div>
      </div>`;
  }).join('');

  return `<div class="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">${cells}</div>`;
}

function renderUpcomingPanel() {
  try {
    const el = document.getElementById('dressage-upcoming-panel');
    if (!el) return;
    const upcoming = allEquipages.filter(eq => {
      const sn = String(eq.startNumber);
      const st = dressageStatusMap.get(sn) || {};
      const stateStr = String(st.state || eq.status || 'not-started').toLowerCase();

      if (stateStr === 'finished') return false;
      if (isWithdrawnOrExcluded(stateStr, { ...eq, ...st })) return false;

      // Check if all expected judges have submitted protocols (isDone logic)
      let isDone = false;
      if (window.currentJudgesPresent && window.currentJudgesPresent.length > 0) {
        const merged = getMergedProtocols(sn);
        const uniquePos = new Set(merged.map(p => (p.position || p.judgePosition || '').toUpperCase()).filter(x => x));

        let expectedPos = new Set(window.currentJudgesPresent.map(j => (j.position || '').toUpperCase()));

        // Try class specific override
        if (window.dressageJudgeMapping) {
          const className = eq._mergedLabel || eq.className;
          const assigned = window.dressageJudgeMapping[className] || window.dressageJudgeMapping[eq.className];
          if (assigned) {
            const clsPos = Object.keys(assigned).filter(p => assigned[p] && String(assigned[p]).trim() !== '');
            if (clsPos.length > 0) {
              expectedPos = new Set(clsPos.map(p => p.toUpperCase()));
            }
          }
        }

        if (uniquePos.size >= expectedPos.size && uniquePos.size > 0) {
          isDone = true;
        }
      }

      return !isDone;
    }).sort((a, b) => new Date(startTimes[String(a.startNumber)]?.dressage || 0).getTime() - new Date(startTimes[String(b.startNumber)]?.dressage || 0).getTime()).slice(0, 8);

    const currentHash = upcoming.map(eq => `${eq.startNumber}:${startTimes[String(eq.startNumber)]?.dressage}`).join('|');
    if (currentHash === lastRenderedUpcomingHash) return;
    lastRenderedUpcomingHash = currentHash;

    let html = `<h3 class="text-lg font-bold mb-2 dark:text-white">${t('dressage_upcoming_title')}</h3>`;
    if (!upcoming.length) { html += `<p class="text-sm text-gray-500 dark:text-gray-400">${t('dressage_all_started')}</p>`; } else {
      html += upcoming.map(eq => `
      <div class="w-full text-left flex items-center justify-between text-sm py-1.5 border-b dark:border-gray-700 last:border-0 rounded px-1">
        <div class="flex items-center gap-2 min-w-0"><span class="font-bold w-8 shrink-0 dark:text-gray-200">#${eq.startNumber}</span><span class="truncate dark:text-gray-300">${eq.driverName}</span></div>
        <div class="flex items-center gap-2 shrink-0">${getFlagHtml(eq)}${getClubLogoHtml(eq)}<span class="font-semibold text-gray-800 dark:text-gray-200 w-12 text-right tabular-nums">${formatTime(startTimes[String(eq.startNumber)]?.dressage)}</span></div>
      </div>`).join('');
    }
    el.innerHTML = html;
  } catch (err) {
    console.error('Error rendering upcoming panel:', err);
    const el = document.getElementById('dressage-upcoming-panel');
    if (el) el.innerHTML = '<p class="text-xs text-red-500">Fel vid rendering av kommande.</p>';
  }
}

function renderResultsPanel() {
  try {
    const el = document.getElementById('dressage-results-panel');
    if (!el) return;
    const activeClass = currentRider?.eq?._mergedLabel || currentRider?.eq?.className || null;

    let list = recentResults.map(r => ({
      ...r,
      name: r.name || `#${r.sn || r.startNumber}`,
      sn: String(r.sn || r.startNumber)
    }));

    if (activeClass) list = list.filter(r => r.className === activeClass);
    list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    const currentHash = list.map(r => `${r.sn}:${r.finalPenalty}:${r.finalPercent}`).join('|');
    if (currentHash === lastRenderedResultsHash) return;
    lastRenderedResultsHash = currentHash;

    let html = `<div class="flex items-baseline justify-between mb-2"><h3 class="text-lg font-bold dark:text-white">${t('dressage_recent_results_title')}</h3></div>`;
    if (!list.length) { html += `<p class="text-sm text-gray-500 dark:text-gray-400">${t('dressage_no_results')}</p>`; el.innerHTML = html; return; }

    html += `<div class="flex items-center justify-end text-xs font-medium text-gray-500 dark:text-gray-400 uppercase pr-1" style="padding-right: 0.25rem;"><span class="w-16 text-right">${t('dressage_avg_percent')}</span><span class="w-16 text-right ml-3">${t('dressage_points')}</span><span class="w-18 text-right ml-3">${t('dressage_penalty_header')}</span></div>`;
    html += list.map(res => `
    <div class="result-row-interactive hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer w-full text-left flex items-center justify-between text-sm py-1.5 border-b dark:border-gray-700 last:border-0 rounded px-1" data-sn="${res.sn}">
      <div class="flex items-center gap-2 min-w-0"><span class="font-bold w-8 shrink-0 dark:text-gray-200">#${res.sn}</span><span class="truncate max-w-[22ch] dark:text-gray-300">${res.name || ''}</span><span class="text-gray-400 shrink-0">•</span><span class="hidden sm:inline text-gray-600 dark:text-gray-400 truncate max-w-[20ch]">${res.className || ''}</span></div>
      <div class="flex items-center gap-3 shrink-0">
        <div class="hidden md:flex items-center gap-1" title="${res.clubName || ''}">${getFlagHtml({ country: res.country })}${getClubLogoHtml({ clubName: res.clubName })}</div>
        <span class="w-16 text-right text-gray-600 dark:text-gray-300 tabular-nums">${Number.isFinite(res.finalPercent) ? res.finalPercent.toFixed(1) + ' %' : '—'}</span>
        <span class="w-16 text-right text-gray-600 dark:text-gray-300 tabular-nums">${Number.isFinite(res.finalPoints) ? res.finalPoints.toFixed(1) + ' p' : '—'}</span>
        <span class="font-bold text-blue-700 dark:text-blue-400 w-18 text-right tabular-nums">${Number.isFinite(res.finalPenalty) ? res.finalPenalty.toFixed(2) + ' p' : '—'}</span>
      </div>
    </div>`).join('');
    const container = el;
    container.innerHTML = html;

    // Efter HTML-injektion, loopa igenom och lägg till click-listeners för modal
    const rows = container.querySelectorAll('.result-row-interactive');
    rows.forEach(row => {
      row.addEventListener('click', () => {
        const sn = row.dataset.sn;
        if (!sn) return;
        const eq = allEquipages.find(e => String(e.startNumber) === sn);
        if (eq) {
          const strategies = getMergedProtocols(sn);

          // Create a temporary map to mimic the expected structure for saved protocols
          const tempProtocolMap = new Map();
          tempProtocolMap.set(sn, strategies);

          openDetailsModal(sn, {
            savedProtocolsMap: tempProtocolMap, // Pass as map so modal calc logic triggers
            statusMap: dressageStatusMap,
            equipages: allEquipages,
            currentJudges: window.currentJudgesPresent
          });
        }
      });
    });
  } catch (err) {
    console.error('Error rendering results panel:', err);
    const el = document.getElementById('results-panel');
    if (el) el.innerHTML = '<p class="text-xs text-red-500">Fel vid rendering av resultat.</p>';
  }
}

// ================= Logic =================
function findCurrentRiderAndLeader() {
  let latest = null;
  let latestTs = 0;
  for (const [sn, data] of dressageStatusMap.entries()) {
    if (data?.state === 'ongoing') {
      const ts = new Date(data.updatedAt || 0).getTime();
      if (Number.isFinite(ts) && ts > latestTs) {
        latestTs = ts;
        const eq = allEquipages.find(e => String(e.startNumber) === sn);
        if (eq) latest = { eq, statusData: data, liveData: liveProtocolMap.get(sn) };
      }
    }
  }
  currentRider = latest;
  leaderInClass = null;
  if (currentRider) {
    let best = Infinity;
    const currentLabel = currentRider.eq._mergedLabel || currentRider.eq.className;
    for (const [sn, data] of dressageStatusMap.entries()) {
      if (data?.state === 'finished' && data?.finalJudgeScore) {
        const eq = allEquipages.find(e => String(e.startNumber) === sn);
        if (eq && (eq._mergedLabel || eq.className) === currentLabel) {
          const pen = Number(data.finalJudgeScore.penalty);
          if (Number.isFinite(pen) && pen < best) {
            best = pen;
            leaderInClass = { name: `#${sn} ${eq.driverName}`, finalPenalty: pen };
          }
        }
      }
    }
  }
}

function getEqClassLabel(eq) { return (eq && (eq._mergedLabel || eq.className)) ? (eq._mergedLabel || eq.className) : ''; }



function maybePushRecent(sn) {
  const S = String(sn);
  const st = dressageStatusMap.get(S) || {};
  const eq = allEquipages.find(e => String(e.startNumber) === S) || null;
  if (!eq) return false;

  const stateStr = String(st.state || eq.status || '').toLowerCase();

  // If withdrawn or excluded, ensure they are NOT in the list
  if (isWithdrawnOrExcluded(stateStr, { ...eq, ...st })) {
    const rmIdx = recentResults.findIndex(r => String(r.sn) === S);
    if (rmIdx >= 0) {
      recentResults.splice(rmIdx, 1);
      return true; // Lists changed
    }
    return false;
  }

  let finished = stateStr === 'finished';

  // 1. Get ALL available protocols (Saved + Live)
  const merged = getMergedProtocols(S);

  // Auto-detect finished status if we have enough judges
  if (!finished && window.currentJudgesPresent && window.currentJudgesPresent.length > 0) {
    // Logic: count unique positions in merged protocols
    const uniquePos = new Set(merged.map(p => (p.position || p.judgePosition || '').toUpperCase()).filter(x => x));
    // Compare against expected unique positions
    const expectedPos = new Set(window.currentJudgesPresent.map(j => (j.position || '').toUpperCase()));

    // If we have protocols for all expected positions, treat as finished
    if (uniquePos.size >= expectedPos.size && uniquePos.size > 0) {
      finished = true;
    }
  }

  // 2. Attempt calculation if we have ANY data
  let computed = null;
  if (merged.length > 0) {
    const programKey = st?.testKey || st?.programKey || eq?.testKey || (window.klassProgramMapping?.[eq?.className] ?? null);
    // Use robust guesser if missing
    const programs = mergedPrograms || getGlobalState('dressagePrograms') || globalDressagePrograms || {};
    let programObj = programKey ? programs[programKey] : null;

    if (!programObj && eq?.className) {
      const g = guessProgramKeyFromClass(eq.className, programs);
      if (g) programObj = programs[g];
    }

    if (programObj) {
      const result = calculateDressageResult(eq, merged, window.currentJudgesPresent || [], programs);
      if (result) {
        st.finalJudgeScore = { percent: result.percent, points: result.points, penalty: result.judgePenalty };
        st.finalPercent = result.percent;
        st.finalPoints = result.points;
        st.finalPenalty = result.penalty;
        st.errorPoints = result.errorPoints;
        st.errorPenalty = result.errorPenalty;
        dressageStatusMap.set(S, st);
        computed = result; // For the check below
      }
    }
  }

  // 4. Check if we have meaningful data to show
  let hasMeaningfulData = false;
  if (finished) {
    // If finished (explicit or detected), we show it if we have ANY score
    hasMeaningfulData = (st.finalPercent != null || st.finalPoints != null || st.finalPenalty != null);
  } else {
    // For ongoing, we only show if we have actual scores > 0
    hasMeaningfulData = (st.finalPercent != null && st.finalPercent > 0) ||
      (st.finalPoints != null && st.finalPoints > 0) ||
      (st.finalPenalty != null && st.finalPenalty > 0);
  }

  // 5. Determine if eligible for the list
  // We show if we have meaningful data OR if it's finished and we have protocols (even if calc failed/scored 0)
  const okToShow = hasMeaningfulData || (finished && merged.length > 0);

  if (!okToShow) {
    const rmIdx = recentResults.findIndex(r => String(r.sn) === S);
    if (rmIdx >= 0) {
      recentResults.splice(rmIdx, 1);
      return true;
    }
    return false;
  }

  // 6. Add/Update in recentResults
  const entry = {
    sn: S,
    name: eq.driverName || `#${S}`,
    className: getEqClassLabel(eq),
    clubName: eq.clubName || '',
    country: eq.country || '',
    finalPercent: hasMeaningfulData ? st.finalPercent : null,
    finalPoints: hasMeaningfulData ? st.finalPoints : null,
    finalPenalty: hasMeaningfulData ? st.finalPenalty : null,
    updatedAt: st.updatedAt || Date.now()
  };

  let changed = false;
  const idx = recentResults.findIndex(r => String(r.sn) === S);
  if (idx >= 0) {
    const old = recentResults[idx];
    const diff = (old.finalPercent !== entry.finalPercent) ||
      (old.finalPoints !== entry.finalPoints) ||
      (old.finalPenalty !== entry.finalPenalty);
    if (diff) {
      recentResults[idx] = entry;
      changed = true;
    }
  } else {
    recentResults.unshift(entry);
    if (recentResults.length > 30) recentResults.length = 30;
    changed = true;
  }

  if (changed) triggerRender();
  return changed;
}

// ================= Listeners =================
function setupAllListeners() {
  unsubscribes.forEach(u => { try { u(); } catch { } });
  unsubscribes = [];

  // 0) Judges Listener (Non-blocking)
  const unJudges = listenForJudges(competitionId, (judges) => {
    allJudges = Array.isArray(judges) ? judges : [];
    window.currentJudgesPresent = allJudges.map(j => ({
      id: j.id,
      name: j.name || j.id,
      position: (expandDressagePosition(j) || j.position || '').toUpperCase()
    }))
      .filter(j => /^[CEBHM]$/.test(j.position))
      .sort((a, b) => ({ C: 0, E: 1, B: 2, H: 3, M: 4 }[a.position] - ({ C: 0, E: 1, B: 2, H: 3, M: 4 }[b.position])));

    // Refresh protocols / lists when judges update (to re-filter/deduplicate)
    triggerRender();
  });
  unsubscribes.push(unJudges);

  {
    let changed = false;
    for (const sn of savedProtocolsByStart.keys()) { if (maybePushRecent(sn)) changed = true; }
    if (changed) triggerRender();
  }

  // 1) Status Collection Listener (Ersätter N unsubStatus-lyssnare)
  const unStatusCol = listenForDressageStatusCollection(competitionId, (docs) => {
    docs.forEach(stDoc => {
      const sn = String(stDoc.id);
      dressageStatusMap.set(sn, { ...stDoc });
      maybePushRecent(sn);
    });
    triggerRender();
  });
  unsubscribes.push(unStatusCol);

  // 2) Live Group Listener
  const unLiveGroup = listenForDressageLiveGroup(competitionId, allEquipages, (docs) => {
    docs.forEach(st => {
      const sn = String(st.startNumber);
      const known = dressageStatusMap.get(sn);
      if (known?.state === 'finished') return;

      if (st?.updatedAt) {
        const age = Date.now() - new Date(st.updatedAt).getTime();
        if (Number.isFinite(age) && age > 120000) return;
      }

      let proto = st;
      // Some live sources wrap data in "protocol"
      if (st.protocol && typeof st.protocol === 'object') {
        proto = { ...st, ...st.protocol };
      }

      const rawJid = proto?.judgeId || proto?.judgeUid || proto?.judge || null;
      const jid = normJudgeId(rawJid);

      if (proto && jid) {
        proto = { ...proto, judgeId: jid };

        // Ensure Map-of-Maps structure
        if (!liveProtocolMap.has(sn)) liveProtocolMap.set(sn, new Map());

        // MERGE with existing to prevent overwriting history with partial updates
        const existing = liveProtocolMap.get(sn).get(jid) || {};
        const merged = { ...existing, ...proto };
        liveProtocolMap.get(sn).set(jid, merged);

        // Update projection in judgeLiveByPos (legacy cache, maybe irrelevant now but good for debug)
        if (!judgeLiveByPos.has(sn)) judgeLiveByPos.set(sn, {});
        // Note: judgeLiveByPos logic assumes simple structure, could be deprecated if we rely on liveProtocolMap
      }

      const cur = dressageStatusMap.get(sn) || {};
      dressageStatusMap.set(sn, {
        ...cur,
        ...st,
        state: st?.state || cur.state,
        updatedAt: st?.updatedAt || cur.updatedAt
      });
    });
    triggerRender();
  });
  unsubscribes.push(unLiveGroup);

  // 3) Protocols (NU COLLECTION GROUP)
  const unProtoGroup = listenForDressageProtocolsCollectionGroup(competitionId, allEquipages, (docs) => {
    // Gruppera docs efter startNumber
    const grouped = new Map();
    docs.forEach(d => {
      const sn = String(d.startNumber);
      if (!grouped.has(sn)) grouped.set(sn, []);
      grouped.get(sn).push(d);
    });

    // Uppdatera savedProtocolsByStart
    savedProtocolsByStart.clear();
    grouped.forEach((list, sn) => {
      savedProtocolsByStart.set(sn, list);
      maybePushRecent(sn);
    });
    triggerRender();
  });
  unsubscribes.push(unProtoGroup);
}

// ================= Entry/Exit =================
export async function load() {
  const comp = getGlobalState('currentCompetition');
  competitionId = comp?.id;
  const root = document.getElementById('page-dressyr-monitor');
  if (!competitionId) {
    if (root) root.innerHTML = `<p class="p-8 text-center text-gray-600">${t('no_competition_selected')}</p>`;
    return;
  }
  renderLayout();

  try {
    setupDressageModalOnce(); // Ensure modal CSS/HTML is present

    const [equipagesRaw, startTimesData, mappingCfg, overrides, displayCfg, judgeMappingCfg] = await Promise.all([
      getEquipages(competitionId),
      getConfig(competitionId, 'startTimes').catch(() => ({})),
      getConfig(competitionId, 'dressyrProgramMapping').catch(() => ({})),
      getConfig(competitionId, 'dressagePrograms').catch(() => ({})),
      getConfig(competitionId, 'display').catch(() => ({})),
      getConfig(competitionId, 'dressageJudgeMapping').catch(() => ({}))
    ]);

    const cfgData = (displayCfg && typeof displayCfg === 'object') ? (displayCfg.value ?? displayCfg) : {};
    monitor_displayConfig = cfgData || {};
    monitor_buildMergeMap(monitor_displayConfig);

    window.dressageJudgeMapping = (judgeMappingCfg && typeof judgeMappingCfg === 'object') ? (judgeMappingCfg.value ?? judgeMappingCfg) : {};

    allEquipages = (equipagesRaw || []).filter(e => e && e.startNumber != null).map(e => {
      const g = monitor_resolveMergeGrouping(e);
      return {
        startNumber: Number(e.startNumber),
        driverName: e.driverName || e.driver || e.name || '',
        className: e.className || e.class || e.klass || '',
        clubName: e.clubName || e.club || '',
        country: e.country || e.nation || '',
        status: e.status || e.eqStatus || e.dressageStatus || '',
        withdrawn: Boolean(e.withdrawn || e.scratched || e.struken || e.didNotStart || e.dns),
        tdbClassNumber: e.tdbClassNumber ?? null,
        useMergedTestForDisplay: e.useMergedTestForDisplay ?? false,
        mergedTestKey: e.mergedTestKey ?? null,
        mergedTestLabel: e.mergedTestLabel ?? null,
        _mergedKey: g.key,
        _mergedLabel: g.label,
        email: e.email,
        driverEmail: e.driverEmail,
        horses: e.horses || [],
        horseNames: e.horseNames || e.horse || '',
        momentHorses: e.momentHorses || {}
      };
    });

    // Robust startTimes parsing
    const stVal = startTimesData?.value ?? startTimesData;
    startTimes = stVal?.times ?? stVal ?? {};

    const base = (typeof globalDressagePrograms !== 'undefined' ? globalDressagePrograms : {});
    mergedPrograms = { ...base, ...(window.dressagePrograms || {}), ...(overrides || {}) };

    setupAllListeners();

    window.klassProgramMapping = (mappingCfg && typeof mappingCfg === 'object') ? mappingCfg : {};
    window.dressagePrograms = mergedPrograms;

    // Remove redundant call, ensure logos loaded then trigger render
    await ensureClubLogosLoaded().catch(() => { });

    // Check if we found any equipages
    if (allEquipages.length === 0) {
      console.warn('DressyrMonitor: Inga ekipage hittades.');
      if (document.getElementById('dressage-current-rider-panel')) {
        document.getElementById('dressage-current-rider-panel').innerHTML = `<div class="p-8 text-center text-gray-500">${t('no_equipages_found_for_competition')}</div>`;
      }
    }

    triggerRender();
  } catch (err) {
    console.error('Kunde inte ladda data för dressyr-monitor:', err);
    if (root) root.innerHTML = `<p class="p-8 text-center text-red-500">Kunde inte ladda nödvändig data: ${err.message}</p>`;
  }
}

export function __unload() {
  unsubscribes.forEach(u => { try { u(); } catch { } });
  unsubscribes = [];
  currentRider = null;
  leaderInClass = null;
  dressageStatusMap.clear();
  liveProtocolMap.clear();
  recentResults.length = 0;
  monitor_displayConfig = {};
  monitor_MERGE_MAP.clear();
  lastRenderedUpcomingHash = null;
  lastRenderedResultsHash = null;
  lastRiderSn = "";
}
export default { load };