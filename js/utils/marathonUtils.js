// js/utils/marathonUtils.js
// Browser adapter for the marathon engine in core-engine/marathon.js.
// Holds the current competition's config and pause log, and binds them to
// the pure core functions. No result math lives here.

import * as core from '../core-engine/marathon.js';
import {
  getObstacleArray,
  obstacleValues,
  stageStartTS,
  stageStopTS,
  stageDurationMsSaved
} from '../core-engine/marathon.js';
import { buildCompetitionState } from '../core-engine/stateSelector.js';
import { assignPlaces, compareMarathonRank, marathonRankKey } from '../core-engine/ranking.js';
import { onCompetitionSettingsReset, getCompetitionSetting } from '../services/competitionSettingsStore.js';

import {
  PENALTY_RATE,
  MARATHON_OBSTACLE_TIME_PENALTY,
  MARATHON_TIME_LIMIT_FACTOR_A,
  MARATHON_TIME_LIMIT_FACTOR_B,
  DEFAULT_TRV_TEMPOS_KMH,
  DEFAULT_FEI_MARATHON_TEMPOS_KMH
} from '../core-engine/rules-ledger.js';

export {
  PENALTY_RATE,
  MARATHON_OBSTACLE_TIME_PENALTY,
  MARATHON_TIME_LIMIT_FACTOR_A,
  MARATHON_TIME_LIMIT_FACTOR_B,
  DEFAULT_TRV_TEMPOS_KMH,
  DEFAULT_FEI_MARATHON_TEMPOS_KMH
};

export {
  parseHoldTimeInput,
  getTotalHoldTimeMs,
  normalizeClassKey,
  detectTRCategoryFromEquipage,
  getObstacleArray,
  obstacleValues,
  stageStartTS,
  stageStopTS,
  stageDurationMsSaved
} from '../core-engine/marathon.js';

function getBrowserGlobalState(key) {
  if (typeof window !== 'undefined' && typeof window.getGlobalState === 'function') {
    return window.getGlobalState(key);
  }
  return null;
}

// === Configuration for the current competition (shared between pages) ===

// The document fetched via getConfig('maratonConfig'/'marathonConfig')
export let maraton_marathonConfig = null;

export function setMarathonConfig(cfg) {
  maraton_marathonConfig = cfg || null;
}

// Global pause log (config/globalStatus.pauseLog)
let _pauseWindows = [];

export function setPauseWindows(windows) {
  _pauseWindows = windows || [];
}

function getRuleSettings() {
  return getBrowserGlobalState('currentCompetition')?.ruleSettings || null;
}

// Another competition selected: its marathon config, pause log and class
// merges must not be calculated with the previous competition's
onCompetitionSettingsReset(() => {
  maraton_marathonConfig = null;
  _pauseWindows = [];
  MERGE_GROUPS = [];
  MERGE_MAP = new Map();
});

export function getActiveTempoRules() {
  return core.getActiveTempoRules(maraton_marathonConfig);
}

export function getPauseTime() {
  return core.getPauseTime(maraton_marathonConfig);
}

export function getStageTimePenaltyRate() {
  return core.getStageTimePenaltyRate(maraton_marathonConfig);
}

// The section time (seconds) as the engine compares it with the window: TR
// whole seconds in the driver's favour ('max' cut down, 'min' rounded up),
// FEI unrounded (core stageSecondsForPenalty, the class's rule profile)
export function stageSecondsForEquipage(ms, equipage, side = 'max') {
  const profile = core.getClassRuleProfile(equipage?.className || '', maraton_marathonConfig);
  return core.stageSecondsForPenalty(ms, profile, side);
}

export function getObstacleMaxTime() {
  return core.getObstacleMaxTime(maraton_marathonConfig);
}

export function getKnockdownPenaltyPerElement() {
  return core.getKnockdownPenaltyPerElement(maraton_marathonConfig);
}

export function shouldShowObstacleKnockdowns(obsConfig, marathonConfig = null) {
  const cfg = marathonConfig || maraton_marathonConfig;
  const isBlockedGlobally = cfg?.obstacleKnockdown?.enabled === false;
  return !isBlockedGlobally && Boolean(obsConfig?.knockdown?.enabled);
}

// Most common TR category per class in a list of equipages
export function buildDominantTRCategoryByClass(equipages = []) {
  const groups = new Map();

  for (const e of equipages) {
    const cls = e?.className;
    if (!cls) continue;
    const cat = core.detectTRCategoryFromEquipage(e);
    if (!groups.has(cls)) groups.set(cls, {});
    const bucket = groups.get(cls);
    bucket[cat] = (bucket[cat] || 0) + 1;
  }

  const out = new Map();
  for (const [cls, counts] of groups.entries()) {
    let best = 'horse';
    let n = -1;
    for (const [k, v] of Object.entries(counts)) {
      if (v > n) { best = k; n = v; }
    }
    out.set(cls, best);
  }
  return out;
}

// === Ideal times, windows & penalties (bound to the current config) ===

export function getClassSettings(className) {
  return core.getClassSettings(className, maraton_marathonConfig);
}

export function tlSecondsFor(equipage, rawStage) {
  return core.tlSecondsFor(equipage, rawStage, maraton_marathonConfig);
}

export function limitsFor(equipage, stage) {
  return core.limitsFor(equipage, stage, maraton_marathonConfig);
}

export function stagePenaltyFromMs(ms, equipage, stage) {
  return core.stagePenaltyFromMs(ms, equipage, stage, maraton_marathonConfig);
}

export function isDurationSuspicious(ms, equipage, stage) {
  return core.isDurationSuspicious(ms, equipage, stage, maraton_marathonConfig);
}

export function getObstacleCoefficient(className) {
  return core.getObstacleCoefficient(className, maraton_marathonConfig, getRuleSettings());
}

// One obstacle's penalties (see core-engine calculateObstacleResult)
export function calculateObstacleResult(obstacle, equipage, opts = {}) {
  return core.calculateObstacleResult(obstacle, equipage, maraton_marathonConfig, getRuleSettings(), opts);
}

export function getClassDrivenObstacles(className) {
  return core.getClassDrivenObstacles(className, maraton_marathonConfig);
}

export function pausedMsSince(ts, nowMs = Date.now()) {
  return core.pausedMsSince(ts, _pauseWindows, nowMs);
}

// nowMs closes a pause still open: pages stamped in server time pass serverNow()
export function pausedMsBetween(a, b, nowMs = Date.now()) {
  return core.pausedMsBetween(a, b, _pauseWindows, nowMs);
}

// === Formatting & time helpers ===

export function formatMsLive(ms) {
  const t = Math.max(0, ms || 0);
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const cs = Math.floor((t % 1000) / 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(cs).padStart(2, '0')}`;
}

export function formatSec(ss) {
  const s = Math.max(0, Math.round(Number(ss) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export function signedSecLabel(sec) {
  if (!Number.isFinite(sec)) return '—';
  const v = Math.round(sec);
  return (v > 0 ? `+${v}` : `${v}`);
}

export function toTimeLabel(v) {
  if (!v) return '—';
  try {
    // Handles both Firestore Timestamp and plain date strings
    if (typeof v === 'object' && typeof v.toDate === 'function') return v.toDate().toLocaleTimeString('sv-SE');
    return new Date(v).toLocaleTimeString('sv-SE');
  } catch (_) { return '—'; }
}

// === Result ===

// Engine inputs held by this browser session (see buildCompetitionState)
export function getMarathonEngineConfig() {
  return {
    marathonConfig: maraton_marathonConfig,
    // Clear round set in the dressage admin applies to the class's marathon too (TR V 509.3)
    dressyrClassConfig: getCompetitionSetting('dressyrClassConfig') || null,
    pauseWindows: _pauseWindows,
    ruleSettings: getRuleSettings(),
    nowMs: Date.now()
  };
}

export function calculateMarathonResult(equipage, marathonDoc, timingDoc) {
  const state = buildCompetitionState(equipage, null, marathonDoc, timingDoc, null, getMarathonEngineConfig());
  return core.calculateMarathonResult(state);
}

// === MERGE LOGIC (Shared between Results & Reports) ===

export let MERGE_GROUPS = [];
export let MERGE_MAP = new Map();

/**
 * Bygg merge-map från flera möjliga konfigformat.
 */
export function buildMergeMap(raw) {
  MERGE_GROUPS = [];
  MERGE_MAP.clear();

  if (!raw) return;

  // 0) Om vi direkt får hela display-objektet
  const maybeDisplay = raw && typeof raw === 'object' && raw.mergeByClassNumber ? raw : null;
  const source = maybeDisplay ? maybeDisplay.mergeByClassNumber : raw;

  // 1) Nytt format: { "<grpKey>": { label: string, members: number[] }, ... }
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    for (const [grpKey, info] of Object.entries(source)) {
      const members = (info?.members || []).map(Number).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
      if (!members.length) continue;
      const label = String(info?.label || `Sammanslagen: TDB #${members.join('/')}`);
      const key = String(grpKey || `TDBGROUP:${members.join('+')}`);
      MERGE_GROUPS.push({ key, label, members });
      members.forEach(num => MERGE_MAP.set(num, { key, label }));
    }
    return;
  }

  // 2) Arrayformat [[1,2,4], [6,8], ...]
  if (Array.isArray(source)) {
    const groups = source
      .map(arr => (Array.isArray(arr) ? arr.map(Number).filter(n => Number.isFinite(n)) : []))
      .filter(arr => arr.length > 0)
      .map(arr => arr.sort((a, b) => a - b));

    groups.forEach(members => {
      const key = `TDBGROUP:${members.join('+')}`;
      const label = `Sammanslagen: TDB #${members.join('/')}`;
      MERGE_GROUPS.push({ key, label, members });
      members.forEach(num => MERGE_MAP.set(num, { key, label }));
    });
    return;
  }

  // 3) Äldre map-format: { "NUM:1":"MERGE:1", ... }
  if (source && typeof source === 'object') {
    const buckets = new Map();
    for (const [k, v] of Object.entries(source)) {
      const num = Number(String(k).replace(/^num:/i, ''));
      if (!Number.isFinite(num)) continue;
      const gk = String(v || '').trim() || `TDBGROUP:${num}`;
      if (!buckets.has(gk)) buckets.set(gk, new Set());
      buckets.get(gk).add(num);
    }
    for (const [gk, set] of buckets) {
      const members = [...set].sort((a, b) => a - b);
      const key = String(gk);
      const label = `Sammanslagen: TDB #${members.join('/')}`;
      MERGE_GROUPS.push({ key, label, members });
      members.forEach(num => MERGE_MAP.set(num, { key, label }));
    }
  }
}

export function mergedClassKeyFor(eq) {
  if (eq?.useMergedTestForDisplay && eq?.mergedTestKey) return eq.mergedTestKey;
  const num = Number(eq?.tdbClassNumber);
  const hit = Number.isFinite(num) ? MERGE_MAP.get(num) : null;
  if (hit) return hit.key;
  return `CLS:${eq?.className || 'Okänd klass'}`;
}

export function mergedClassLabelFor(eq) {
  if (eq?.useMergedTestForDisplay && eq?.mergedTestLabel) return eq.mergedTestLabel;
  const num = Number(eq?.tdbClassNumber);
  const hit = Number.isFinite(num) ? MERGE_MAP.get(num) : null;
  if (hit) return hit.label;
  return eq?.className || 'Okänd klass';
}

/**
 * Ensures equipages have _mergedKey and _mergedLabel property.
 * Returns a NEW array if changes were made, or the same array if no changes.
 */
export function ensureMergeDecorations(equipages) {
  if (!Array.isArray(equipages) || equipages.length === 0) return equipages;
  let changed = false;
  const next = equipages.map(e => {
    const newKey = mergedClassKeyFor(e);
    const newLabel = mergedClassLabelFor(e);
    if (e._mergedKey !== newKey || e._mergedLabel !== newLabel) {
      changed = true;
      return { ...e, _mergedKey: newKey, _mergedLabel: newLabel };
    }
    return e;
  });
  return changed ? next : equipages;
}

// === Statistik och Prognos (Speaker Support) ===

/**
 * calculateClassObstacleStats(className, obstacleNumber, allStatusMap, allEquipages)
 * - Räknar ut snitt, bäst och sämst för ett specifikt hider i en klass.
 * - Används för 'Target to Beat' och jämförelser.
 */
export function calculateClassObstacleStats(className, obstacleNumber, allStatusMap, allEquipages) {
  if (!className || !obstacleNumber || !allStatusMap) return null;

  let bestTime = Infinity;
  let totalTime = 0;
  let count = 0;

  for (const [sn, data] of allStatusMap.entries()) {
    const eq = allEquipages.find(e => String(e.startNumber) === String(sn));
    if (!eq || eq.className !== className) continue;
    const obsArr = getObstacleArray(data);
    const obs = obsArr.find(o => Number(o.number || o.id) === Number(obstacleNumber));

    if (obs && !obs.eliminated) {
      // Försök hitta rå tid
      const { timeSec } = obstacleValues(obs);
      if (Number.isFinite(timeSec)) {
        if (timeSec < bestTime) bestTime = timeSec;
        totalTime += timeSec;
        count++;
      }
    }
  }

  if (count === 0) return null;

  return {
    bestTime: bestTime === Infinity ? null : bestTime,
    avg: totalTime / count,
    count
  };
}


/**
 * calculateProjectedPenalty(driverData, className, marathonConfig, allStatusMap, allEquipages)
 * - Prognos för slutresultat.
 * - Tar nuvarande straff + (kvarvarande hinder * klassens snittstraff).
 */
export function calculateProjectedPenalty(driverData, className, marathonConfig, allStatusMap, allEquipages) {
  const d = driverData || {};
  const obsArr = getObstacleArray(d);

  // 1. Identifiera klara hinder
  const doneObs = new Set(obsArr.map(o => Number(o.number || o.id)));

  // Hämta specifika hinder (om definierat)
  const drivenObs = getClassDrivenObstacles(className);

  let maxObs = 0;
  if (!drivenObs) {
    // OLD FALLBACK LOGIC IF NO EXPLICIT DRIVEN OBSTACLES 
    // 2. Hitta max antal hinder för klassen (genom att scanna alla)
    for (const [sn, data] of allStatusMap.entries()) {
      const eq = allEquipages.find(e => String(e.startNumber) === String(sn));
      if (eq && eq.className === className) {
        const obsArr = getObstacleArray(data);
        obsArr.forEach(o => {
          const n = Number(o.number || o.id);
          if (n > maxObs) maxObs = n;
        });
      }
    }
    const config = marathonConfig || maraton_marathonConfig;
    if (maxObs === 0) maxObs = config?.maxObstacles || 6;
  }

  // 3. Beräkna nuvarande total (inklusive tidsfel på sträckor hittills)
  let currentTotal = 0;
  if (Number.isFinite(driverData.totalPenalty)) {
    currentTotal = driverData.totalPenalty;
  } else {
    return null;
  }

  if (driverData.eliminated) return Infinity;

  // 4. Summera snitt för återstående (klassens snittid som hindertid i motorn)
  let added = 0;
  let remaining = 0;

  const calculateForTarget = (i) => {
    if (!doneObs.has(i)) {
      const stats = calculateClassObstacleStats(className, i, allStatusMap, allEquipages);
      if (stats && stats.avg) {
        added += calculateObstacleResult({ timeSec: stats.avg }, { className }).timePenalty || 0;
      }
      remaining++;
    }
  };

  if (drivenObs) {
    // Nya logiken: Endast specifika hinder
    for (const targetObs of drivenObs) {
      calculateForTarget(targetObs);
    }
  } else {
    // Gamla logiken: 1 till maxObs
    for (let i = 1; i <= maxObs; i++) {
      calculateForTarget(i);
    }
  }

  return {
    projectedTotal: currentTotal + added,
    remainingCount: remaining,
    basedOnStats: (remaining > 0)
  };
}


/**
 * analyzeSectorProgress(timingDoc, stage, equipage)
 * - Returns status for an ongoing or finished sector (A or T).
 * - Deviation: +/- seconds vs Ideal Time.
 */
export function analyzeSectorProgress(timingDoc, stage, equipage) {
  if (!timingDoc || !equipage) return null;
  const lim = limitsFor(equipage, stage);
  if (!lim) return null;

  const start = stageStartTS(timingDoc, stage);
  const stop = stageStopTS(timingDoc, stage);
  const savedDur = stageDurationMsSaved(timingDoc, stage);

  let ms = 0;
  let isLive = false;

  if (savedDur != null && savedDur > 0) {
    ms = savedDur;
  } else if (start && stop) {
    ms = (stop - start) - pausedMsBetween(start, stop);
  } else if (start) {
    // If savedDur is explicitly 0 but we are running (start but no stop), treat as live
    ms = (Date.now() - start) - pausedMsSince(start);
    isLive = true;
  } else {
    return null; // Not started
  }

  const sec = ms / 1000;
  const diff = sec - lim.ideal;
  // Compared with the window as the engine counts it (TR whole seconds in the
  // driver's favour, FEI unrounded)
  const secMax = stageSecondsForEquipage(ms, equipage, 'max');
  const secMin = stageSecondsForEquipage(ms, equipage, 'min');

  let status = 'ok';
  let color = 'text-green-600';
  let label = 'I fönster';

  if (secMin < lim.min) {
    status = 'fast';
    color = 'text-red-500';
    label = 'FÖR SNABB';
  } else if (secMax > lim.timeLimit) {
    status = 'elim';
    color = 'text-red-700 font-bold';
    label = 'LIM/ELIM';
  } else if (secMax > lim.max) {
    status = 'slow';
    color = 'text-amber-600';
    label = 'FÖR LÅNGSAM';
  }

  return {
    stage,
    ms,
    sec,
    ideal: lim.ideal,
    diff,
    status,
    color,
    label,
    isLive
  };
}

// Beräknar statistik (Best & Avg) för varje gate (A, B...) i ett hinder för en given klass
export function calculateClassSplitStats(className, obstacleNumber, allStatusMap, allEquipages) {
  const stats = {}; // { 'A': { min: 1234, sum: 5000, count: 4 }, 'B': ... }

  if (!allStatusMap || !allEquipages) return {};

  for (const [sn, data] of allStatusMap.entries()) {
    const eq = allEquipages.find(e => String(e.startNumber) === String(sn));
    if (!eq || eq.className !== className) continue;

    const obsResults = getObstacleArray(data); // Använd helper för att normalisera
    const res = obsResults.find(o => Number(o.number || o.id) === Number(obstacleNumber));

    // Vi gör en best effort.
    const rawObs = (data.obstacles || []).find(o => Number(o.number) === Number(obstacleNumber));
    const target = rawObs || res;

    if (target && target.gateSplits && target.gateSplits.length > 0) {
      // Hitta starttid
      let startTs = target.enteredAt;
      if (!startTs && data.obstacleTimes && data.obstacleTimes[String(obstacleNumber)]) {
        const ot = data.obstacleTimes[String(obstacleNumber)];
        startTs = ot.enteredAt || ot.enteredAtClient;
      }

      if (startTs && startTs.toMillis) startTs = startTs.toMillis();
      else if (typeof startTs === 'string') startTs = new Date(startTs).getTime();

      if (!startTs || isNaN(startTs)) continue;

      const seen = new Set();
      target.gateSplits.forEach(s => {
        if (!s.char || s.char !== s.char.toUpperCase()) return;
        if (seen.has(s.char)) return;
        seen.add(s.char);

        let ts = s.ts;
        if (ts && ts.toMillis) ts = ts.toMillis();
        else if (typeof ts === 'string') ts = new Date(ts).getTime();

        if (!ts) return;

        const diff = ts - startTs;
        if (diff <= 0) return;

        if (!stats[s.char]) stats[s.char] = { min: Infinity, sum: 0, count: 0 };
        if (diff < stats[s.char].min) stats[s.char].min = diff;
        stats[s.char].sum += diff;
        stats[s.char].count++;
      });
    }
  }

  // Summera
  const result = {};
  for (const char in stats) {
    if (stats[char].count > 0) {
      result[char] = {
        best: stats[char].min,
        avg: stats[char].sum / stats[char].count,
        count: stats[char].count
      };
    }
  }
  return result;
}

// === PLACERINGAR & PDF-PREP ===

// Placings per class/merged group from eq.results.marathon (TR 527.1, see core-engine/ranking.js)
export function calculateMarathonPlacements(equipages) {
  const { placeOf } = assignPlaces(equipages, {
    key: (eq) => marathonRankKey(eq.results?.marathon),
    compare: compareMarathonRank,
    group: (eq) => eq._mergedKey || `CLS:${eq.className || 'Okänd klass'}`,
    outField: null
  });

  const map = new Map();
  equipages.forEach((eq) => {
    const place = placeOf.get(eq);
    if (place != null) map.set(String(eq.startNumber), place);
  });
  return map;
}

/**
 * prepareMarathonResults
 * Central funktion för att sammanställa maratonresultat för listor/PDFer.
 * - Sätter config
 * - Bygger merge-map
 * - Beräknar resultat (calculateMarathonResult)
 * - Applicerar sammanslagningar (ensureMergeDecorations)
 * - Beräknar placeringar
 */
// calculateResult: the result page passes its own (an archived competition
// gives the values it was archived with); the default calculates
export function prepareMarathonResults(equipages, config, { timingMap, stateMap, obstaclesMap, calculateResult = calculateMarathonResult }) {
  // 1. Initiera config. Merge groups only from a config that has them (the
  // marathon config has none: the page has built the map from the merge
  // sources, see mergeConfigService)
  if (config) {
    setMarathonConfig(config);
    if (config.mergeByClassNumber) buildMergeMap(config);
  }

  // 2. Beräknad data
  let computed = equipages.map(e => {
    // Normalisera vid behov (enkel variant)
    const sn = String(e.startNumber || 0);

    // Hämta data
    // Om stateMap saknas men timingMap har "allt" (t.ex. maraton-resultat.js), använd timingMap som fallback för state
    const t = timingMap ? (timingMap.get(sn) || {}) : {};
    const s = stateMap ? (stateMap.get(sn) || {}) : (t || {});

    // Hinder
    let obs = [];
    // Prioritize obstaclesMap if it has data for this equipage
    if (obstaclesMap && obstaclesMap.has(sn)) {
      obs = obstaclesMap.get(sn) || [];
    } else {
      // Fallback to state document (live data)
      obs = getObstacleArray(s);
    }

    const mDoc = {
      ...s,
      obstacles: obs,
      // Se till att 'isFinalized' respekteras om det finns i state
      // (calculateMarathonResult kollar d.finalized/d.status)
    };

    // Merge state and timing for time lookup (let state override/augment raw timing)
    // This ensures manual times in 's' (maraton collection) are found by date helpers
    const mergedTiming = { ...t, ...s };

    const res = calculateResult(e, mDoc, mergedTiming);

    return {
      ...e,
      startNumber: e.startNumber || 0, // ensure basic props
      className: e.className || '',
      driverName: e.driverName || '',
      // Behåll eventuella befintliga merge-keys om de redan satts, annars null
      _mergedKey: e._mergedKey,
      _mergedLabel: e._mergedLabel,
      results: {
        ...(e.results || {}),
        marathon: res
      }
    };
  });

  // 3. Applicera merge-logik (sätter _mergedKey/_mergedLabel)
  computed = ensureMergeDecorations(computed);

  // 4. Beräkna placeringar
  const placeMap = calculateMarathonPlacements(computed);

  // 5. Tilldela placering (sortera ej här, överlåt till visning/pdf)
  return computed.map(e => ({
    ...e,
    place: placeMap.get(String(e.startNumber)) || null
  }));
}
