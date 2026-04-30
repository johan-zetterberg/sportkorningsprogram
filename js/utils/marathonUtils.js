// js/utils/marathonUtils.js
// Centrala hjälp-funktioner för maratonberäkningar
// – används av resultat, totalresultat, monitor, PDF m.m.

import { getGlobalState } from '../main.js';
import { calculateMarathonResult as _coreCalculate } from '../core-engine/marathon.js';
import { buildCompetitionState as _buildState } from '../core-engine/stateSelector.js';

import {
  PENALTY_RATE,
  MARATHON_OBSTACLE_TIME_PENALTY,
  MARATHON_TIME_LIMIT_FACTOR_A,
  MARATHON_TIME_LIMIT_FACTOR_B,
  DEFAULT_TRV_TEMPOS_KMH
} from '../core-engine/rules-ledger.js';

export {
  PENALTY_RATE,
  MARATHON_OBSTACLE_TIME_PENALTY,
  MARATHON_TIME_LIMIT_FACTOR_A,
  MARATHON_TIME_LIMIT_FACTOR_B,
  DEFAULT_TRV_TEMPOS_KMH
};

// Returnera aktiv tempo-tabell (Config > Default)
export function getActiveTempoRules() {
  return maraton_marathonConfig?.tempoRules || DEFAULT_TRV_TEMPOS_KMH;
}

// FEI Speed Tables are now merged into DEFAULT_TRV_TEMPOS_KMH above for easier configuration.

// === Konfiguration för aktuell tävling (delas mellan sidor) ===

// Här landar dokumentet du hämtar via getConfig('maratonConfig'/'marathonConfig')
export let maraton_marathonConfig = null;

export function setMarathonConfig(cfg) {
  maraton_marathonConfig = cfg || null;
}

export function getPauseTime() {
  return Number(maraton_marathonConfig?.pauseTime) || 10;
}

// === Klass- & kategori-hjälpare ===

const kmhToMmin = (kmh) => (kmh * 1000) / 60;

export function normalizeClassKey(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const lower = s.toLowerCase();
  const para = /para/.test(lower);

  // Regex helpers allowing optional leading digits/hyphens/spaces
  // Matches: start of string, optional digits/dashes/spaces, then the class name
  const match = (regex) => new RegExp(`^([\\d\\s\\.,&\;-]*)${regex.source}`, 'v').test(lower) || new RegExp(`^([\\d\\s\\.,&\;-]*)${regex.source}`).test(lower);
  // Simpler approach: Check regex against string anywhere or match specific patterns
  // Let's use flexible testing ignoring prefix:

  if (/(^|[\d\s\.,&\;-]+)l[aä]tt\s*b\b|(\b)lb\b/.test(lower)) return para ? "Lätt B Para" : "Lätt B";
  if (/(^|[\d\s\.,&\;-]+)l[aä]tt\s*a\b|(\b)la\b/.test(lower)) return para ? "Lätt A Para" : "Lätt A";
  if (/(^|[\d\s\.,&\;-]+)(msv|medelsv[aå]r)\b/.test(lower)) return para ? "Msv Para" : "Msv";
  if (/(^|[\d\s\.,&\;-]+)sv[aå]r\b/.test(lower)) return para ? "Svår Para" : "Svår";

  // FEI / CAI Detection
  if (/cai\s*3/.test(lower)) return "CAI3*";
  if (/cai\s*2/.test(lower)) return "CAI2*";
  if (/cai\s*1/.test(lower)) return "CAI1*";

  if (/children|ch-/.test(lower)) return "CAI Children";
  if (/junior|j-/.test(lower)) return "CAI Junior";
  if (/u25|young/.test(lower)) return "CAI U25";

  return null;
}

function normalizeTRCategoryKey(raw) {
  if (raw === 0 || raw) {
    const s = String(raw).trim().toLowerCase();

    if (/(häst|horse)/.test(s)) return 'horse';

    if (/(ponny|pony)/.test(s)) {
      if (/\b(a|cat[\s\-]*a)\b/.test(s)) return 'ponyA';
      if (/\b(b|cat[\s\-]*b)\b/.test(s)) return 'ponyB';
      if (/\b(c|d|cat[\s\-]*c|cat[\s\-]*d)\b/.test(s)) return 'ponyCD';
      return 'ponyCD';
    }

    if (/^\s*a\s*$/.test(s)) return 'ponyA';
    if (/^\s*b\s*$/.test(s)) return 'ponyB';
    if (/^\s*(c|d)\s*$/.test(s)) return 'ponyCD';
  }
  return null;
}

function readHeightCmFromEquipage(e) {
  const nums = [];
  if (Number.isFinite(e?.heightCm)) nums.push(e.heightCm);
  if (Number.isFinite(e?.horseHeightCm)) nums.push(e.horseHeightCm);

  if (Array.isArray(e?.horses)) {
    for (const h of e.horses) {
      if (Number.isFinite(h?.heightCm)) nums.push(h.heightCm);
    }
  }

  let h = nums.find(Number.isFinite);
  // Om någon matat in i meter (t.ex. 1.32) -> konvertera till cm
  if (h > 0 && h < 3) h = Math.round(h * 100);
  return h || null;
}

function categoryFromHeightCm(cm) {
  if (!Number.isFinite(cm) || cm <= 0) return null;
  if (cm <= 120) return 'ponyA';
  if (cm <= 130) return 'ponyB';
  if (cm <= 148) return 'ponyCD';
  return 'horse';
}

function directCategoryFromEquipage(e) {
  const candidates = [
    e?.category,
    e?.categoryName,
    e?.division,
    e?.type,
    e?.className,
  ];
  for (const r of candidates) {
    const k = normalizeTRCategoryKey(r);
    if (k) return k;
  }
  return null;
}

export function detectTRCategoryFromEquipage(e) {
  const direct = directCategoryFromEquipage(e);
  if (direct) return direct;

  const h = readHeightCmFromEquipage(e);
  const fromH = categoryFromHeightCm(h);
  if (fromH) return fromH;

  return 'horse';
}

// Beräkna dominerande TR-kategori per klass från en ekipagelista
export function buildDominantTRCategoryByClass(equipages = []) {
  const groups = new Map();

  for (const e of equipages) {
    const cls = e?.className;
    if (!cls) continue;
    const cat = detectTRCategoryFromEquipage(e);
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

// === Idealtider (TL) & tidsfönster per sträcka ===

/**
 * tlSecondsFor(equipage, stage)
 * - stage: 'A', 'B' eller 'transport'
 * - använder:
 * maraton_marathonConfig.marathonClassData[className]
 * samt TRV_2025_MARATON_TEMPOS_KMH som fallback för tempo
 */
// Hjälpare för att hitta inställningar även om klassnamnet är längre än config-nyckeln
export function getClassSettings(className) {
  if (!maraton_marathonConfig || !className) return null;
  const dataMap = maraton_marathonConfig.marathonClassData || maraton_marathonConfig.maratonClassData;
  if (!dataMap) return null;

  // 1. Exakt match
  if (dataMap[className]) return dataMap[className];

  // 2. Fuzzy match (startsWith) - case-insensitive
  if (typeof className !== 'string') return null;
  const normClass = className.trim().toLowerCase().replace(/\u00A0/g, ' ');

  // Hitta nyckel som klassnamnet BÖRJAR med (t.ex. nyckel="msv 4" matchar klass="msv 4 enbet")
  const key = Object.keys(dataMap).find(k => {
    const normKey = k.trim().toLowerCase().replace(/\u00A0/g, ' ');
    return normClass.startsWith(normKey);
  });

  if (key) return dataMap[key];

  // 3. Normalized match (e.g. "LA" -> "Lätt A" match "Lätt A")
  const normClassName = normalizeClassKey(className);
  if (normClassName) {
    const normKeyMatch = Object.keys(dataMap).find(k => normalizeClassKey(k) === normClassName);
    if (normKeyMatch) return dataMap[normKeyMatch];
  }

  return null;
}

function normStage(rawStage) {
  if (!rawStage) return '';
  const s = String(rawStage).toLowerCase();
  if (s === 'warmup' || s === 'a') return 'A';
  if (s === 'b') return 'B';
  if (s === 'transport' || s === 'transfer') return 'transport';
  return String(rawStage);
}

export function tlSecondsFor(equipage, rawStage) {
  const stage = normStage(rawStage);
  const className = equipage?.className || equipage?.class || equipage?.klass || '';
  if (!className || !maraton_marathonConfig) return null;

  const classSettings = getClassSettings(className);
  if (!classSettings) {
    // Debug logging (preserve from previous step if needed, or remove if confident)
    // console.log(`[tlSecondsFor] WARN: No settings for "${className}"`, { keys: Object.keys(maraton_marathonConfig.marathonClassData || {}) });
    return null;
  }

  // robust läsning av distans
  const getDist = (s) => {
    const flatKey = `distance${s.toUpperCase()}`;     // t.ex. distanceA
    let val = classSettings[flatKey];
    if (val !== undefined && val !== null && val !== '') return Number(val);

    const nested = classSettings[s.toUpperCase()];    // t.ex. A: { distance }
    val = nested?.distance;
    if (val !== undefined && val !== null && val !== '') return Number(val);

    return null;
  };

  // robust läsning av tempo i m/min
  const getTempoMpm = (s) => {
    const nested = classSettings[s.toUpperCase()];
    let val = nested?.tempo_mpm;
    if (val !== undefined && val !== null && val !== '') return Number(val);

    const flatKey = `tempo${s.toUpperCase()}`;        // t.ex. tempoA
    val = classSettings[flatKey];
    if (val !== undefined && val !== null && val !== '') return Number(val);

    return null;
  };

  // Transport/T
  if (stage === 'transport') {
    const distM = getDist('T');
    let mpm = getTempoMpm('T');
    if (!mpm) mpm = Number(classSettings.tempoT);

    if (distM > 0 && mpm > 0) return Math.round((distM / mpm) * 60);
    return null;
  }

  // A eller B
  if (stage === 'A' || stage === 'B') {
    // === NYTT: Stöd för fast tid (WU) på A-sträckan ===
    if (stage === 'A') {
      const fixedMin = Number(classSettings.fixedTimeA);
      if (fixedMin > 0) {
        return Math.round(fixedMin * 60);
      }
    }

    const distM = getDist(stage);
    if (!(distM > 0)) return null;

    // 1) Kolla först manuellt tempo ifrån klass-inställningarna
    const manualTempo = getTempoMpm(stage);
    if (manualTempo > 0) {
      return Math.round((distM / manualTempo) * 60);
    }

    // 2) Annars Config/TRV/FEI via getActiveTempoRules()
    let baseKey = classSettings.trTemplate || className;
    if (equipage?.isPara && !/para/i.test(baseKey)) {
      baseKey += " Para";
    }
    const clsKey = normalizeClassKey(baseKey);
    const catKey = detectTRCategoryFromEquipage(equipage) || 'horse';

    const activeRules = getActiveTempoRules();

    // First try exact match in rules
    let kmh = activeRules?.[clsKey]?.[stage]?.[catKey];

    // If no match, check if it's a CAI class but we checked for specific pony category
    // (FEI rules usually just say "Pony", so we fallback to 'ponyCD' or 'pony' key if exists)
    if (!kmh && clsKey && clsKey.startsWith('CAI') && catKey.startsWith('pony')) {
      kmh = activeRules?.[clsKey]?.[stage]?.['pony']
        || activeRules?.[clsKey]?.[stage]?.['ponyCD'];
    }

    if (kmh > 0) {
      const mpm = kmhToMmin(kmh);
      return Math.round((distM / mpm) * 60);
    }

    return null;
  }

  return null;
}

/**
 * limitsFor(equipage, stage)
 * - returnerar { ideal, min, max, timeLimit } i sekunder
 * - fönsterbredd hämtas från marathonClassData[className]
 * (windowA/windowB) med vettiga standardvärden
 */
export function limitsFor(equipage, stage) {
  const idealSec = tlSecondsFor(equipage, stage);
  if (idealSec === null) return null;

  const cls = equipage?.className || equipage?.class || equipage?.klass || '';
  const classData = getClassSettings(cls) || {};

  if (stage === 'A') {
    // === NYTT: Om fast tid är satt, gäller den som "Max" och "Ideal" ===
    // Ingen minimitid (eller 0)
    if (Number(classData.fixedTimeA) > 0) {
      return {
        ideal: idealSec,
        min: 0,
        max: idealSec, // Max allowed is the fixed time (used by isFixedTimeA checks)
        timeLimit: Math.round(idealSec * 1.20), // Standard 20% margin for elimination
        isFixedTime: true
      };
    }

    const windowMinutes = classData.windowA ?? 2;
    return {
      ideal: idealSec,
      min: Math.max(0, idealSec - windowMinutes * 60),
      max: idealSec,
      timeLimit: Math.round(idealSec * 1.20),
    };
  }

  if (stage === 'B') {
    const windowMinutes = classData.windowB ?? 3; // Default 3 min for B if not set
    return {
      ideal: idealSec,
      min: Math.max(0, idealSec - windowMinutes * 60),
      max: idealSec,
      timeLimit: Math.round(idealSec * 2),
    };
  }

  if (stage === 'transport') {
    return {
      ideal: idealSec,
      min: 0,
      max: idealSec,
      timeLimit: Math.round(idealSec * 2),
    };
  }

  return null;
}

/**
 * stagePenaltyFromMs(ms, equipage, stage)
 * - tar ms för en sträcka och räknar ut tidsfel
 * - använder limitsFor + maraton_marathonConfig.timePenaltyRate (fallback PENALTY_RATE)
 * - returnerar { points, elim }
 */
export function stagePenaltyFromMs(ms, equipage, stage) {
  // if (stage === 'transport') return { points: 0, elim: false }; // REMOVED: Allow transport penalties
  if (!Number.isFinite(ms) || ms <= 0) return { points: 0, elim: false };

  const lim = limitsFor(equipage, stage);
  if (!lim) return { points: 0, elim: false };

  const sec = ms / 1000;

  // För sent (utanför absolut timeLimit) → ELIM
  if (sec > lim.timeLimit) return { points: Infinity, elim: true };

  let secondsOutsideWindow = 0;
  if (sec < lim.min) {
    secondsOutsideWindow = lim.min - sec;
  } else if (sec > lim.max && !lim.isFixedTime) {
    // Only give penalty for exceeding max if it's NOT a Fixed Time (Warmup) stage
    secondsOutsideWindow = sec - lim.max;
  }

  if (secondsOutsideWindow <= 0) return { points: 0, elim: false };

  const cfgRate = maraton_marathonConfig?.timePenaltyRate;
  const coeff = Number.isFinite(cfgRate) && cfgRate > 0 ? cfgRate : PENALTY_RATE;


  const penaltySeconds = Math.ceil(secondsOutsideWindow);
  const penaltyPoints = (penaltySeconds * coeff);
  return { points: +penaltyPoints.toFixed(2), elim: false };
}

/**
 * Checks if a duration is "suspiciously" long for a given stage.
 * Used to trigger UI warnings (e.g. forgot to stop clock before rest).
 * @returns {boolean}
 */
export function isDurationSuspicious(ms, equipage, stage) {
  if (!Number.isFinite(ms) || ms <= 0) return false;
  const lim = limitsFor(equipage, stage);
  if (!lim) return false;

  const sec = ms / 1000;
  // Suspicious if it exceeds the time limit (which is already 120% or 200% of ideal)
  // or if it's significantly longer than the max allowed window.
  return sec > lim.timeLimit;
}

// === Hinder / hinderresultat ===

// Försöker hitta rätt hinder-array oavsett fältnamn
export function getObstacleArray(res) {
  const cand =
    res?.obstacles ||
    res?.hinder ||
    res?.obstacleResults ||
    res?.maratonObstacles ||
    [];
  return Array.isArray(cand) ? cand : [];
}

// Plocka ut tid & straff från ett hinderobjekt på ett robust sätt
export function obstacleValues(o) {
  const timeSecRaw =
    o?.timeSec ??
    o?.timeInSeconds ?? // Common in Firestore
    o?.seconds ??
    o?.tidSek ??
    o?.time ??
    (Number.isFinite(o?.timeMs) ? o.timeMs / 1000 : null) ??
    null;

  const penaltyRaw =
    o?.penalty ?? o?.penalties ?? o?.straff ?? o?.sum ?? o?.totalPenalty ?? null;

  const timeSec = timeSecRaw == null ? null : Number(timeSecRaw);
  const penalty = penaltyRaw == null ? null : Number(penaltyRaw);

  return {
    timeSec: Number.isFinite(timeSec) ? timeSec : null,
    penalty: Number.isFinite(penalty) ? penalty : null,
    eliminated: !!o?.eliminated,
  };
}

// === Formatering & Tids-helpers ===

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
    // Hanterar både Firestore Timestamp och vanliga datumsträngar
    if (typeof v === 'object' && typeof v.toDate === 'function') return v.toDate().toLocaleTimeString('sv-SE');
    return new Date(v).toLocaleTimeString('sv-SE');
  } catch (_) { return '—'; }
}

// === Timestamp-helpers (läsa från timing-doc) ===

function parseTS(v) {
  if (!v) return null;
  try {
    if (typeof v?.toMillis === 'function') {
      const t = v.toMillis();
      return Number.isFinite(t) ? t : null;
    }
    if (v instanceof Date) {
      const t = v.getTime();
      return Number.isFinite(t) ? t : null;
    }
    if (typeof v === 'number') {
      return Number.isFinite(v) ? v : null;
    }
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : null;
  }
  catch { return null; }
}

export function stageStartTS(t, s) {
  const upper = String(s).toUpperCase();
  const flat = (s === 'transport') ? 'transfer' : s;
  let val = t?.[`start_${upper}`] || t?.[`start_${flat}`] || t?.stages?.[s]?.startClock || t?.timing?.[s]?.startClock;
  if (!val && s === 'A') val = t?.timing?.['warmup']?.startClock;
  return parseTS(val);
}

export function stageStopTS(t, s) {
  if (!t) return null;
  const upper = String(s).toUpperCase();
  const flat = (s === 'transport') ? 'transfer' : s;
  let val = t?.[`finish_${upper}`] || t?.[`finish_${flat}`] || t?.stages?.[s]?.stopClock || t?.timing?.[s]?.stopClock;
  if (!val && s === 'A') val = t?.timing?.['warmup']?.stopClock;
  return parseTS(val);
}

export function stageDurationMsSaved(t, s) {
  if (!t) return null;
  const upper = String(s).toUpperCase();
  const flat = (s === 'transport') ? 'transfer' : s;
  let v = t?.[`duration_${flat}_ms`] || t?.[`duration_${s}_ms`] || t?.[s]?.durationMs || t?.timing?.[s]?.durationMs;
  if (v == null && s === 'A') v = t?.timing?.['warmup']?.durationMs;
  return Number.isFinite(v) ? Number(v) : null;
}

// === Hantering av global paus (för att modalen ska kunna räkna live-tid) ===
let _pauseWindows = [];

export function setPauseWindows(windows) {
  _pauseWindows = windows || [];
}

// === NYTT: Hinderstraffskoeff (separerar hinder från sträcka) ===
export function getObstacleCoefficient(className) {
  // 1. Specifik klassinställning
  const clsConfig = getClassSettings(className);
  if (clsConfig) {
    const classVal = clsConfig.obstaclePenaltyRate;
    if (Number.isFinite(classVal) && classVal > 0) return classVal;
  }

  // 2. Global inställning (Custom override från admin-settings)
  const globalVal = maraton_marathonConfig?.obstaclePenaltyRate;
  if (Number.isFinite(globalVal) && globalVal > 0) return globalVal;

  // 3. Ruleset Fallback (Tävlingens grundregel från när den skapades)
  const comp = getGlobalState ? getGlobalState('currentCompetition') : null;
  const rulesVal = comp?.ruleSettings?.marathonObstaclePenaltyRate;
  if (Number.isFinite(rulesVal) && rulesVal > 0) return rulesVal;

  // 3. Fallback REMOVED to avoid coupling with section penalties
  // const legacyVal = maraton_marathonConfig?.timePenaltyRate;
  // if (Number.isFinite(legacyVal) && legacyVal > 0) return legacyVal;

  // 4. Ultimate fallback (TR standard = 0.25)
  return MARATHON_OBSTACLE_TIME_PENALTY;
}

// === NYTT: Körda Hinder per klass (Specific Obstacles) ===
export function getClassDrivenObstacles(className) {
  const clsConfig = getClassSettings(className);
  if (clsConfig && clsConfig.drivenObstacles) {
    // Ex. "1, 2, 4, 5" -> [1, 2, 4, 5]
    const parsed = String(clsConfig.drivenObstacles)
      .split(',')
      .map(s => parseInt(s.trim()))
      .filter(n => Number.isFinite(n) && n > 0);
    if (parsed.length > 0) return parsed;
  }
  return null; // Betyder "alla"
}

export function pausedMsSince(ts, nowMs = Date.now()) {
  if (!Number.isFinite(ts)) return 0;
  let sum = 0;
  for (const w of _pauseWindows) {
    const from = w.from || (w.start ? new Date(w.start).getTime() : 0);
    const to = w.to || (w.end ? new Date(w.end).getTime() : nowMs);
    if (to <= ts) continue;
    const start = Math.max(ts, from);
    if (to > start) sum += (to - start);
  }
  return Math.max(0, sum);
}

// === NY CENTRAL BERÄKNINGSFUNKTION ===
// Samlar all logik för status, straff och resultat på ett ställe.

export function calculateMarathonResult(equipage, marathonDoc, timingDoc) {
  const sn = String(equipage.startNumber);
  const d = marathonDoc || {};
  const t = timingDoc || {};
  const eq = equipage || {};

  // 1. Struken?
  if (eq.status === 'struken') {
    return {
      startNumber: sn,
      status: 'Struken',
      totalPenalty: null,
      eliminated: false,
      stages: { A: {}, B: {}, transport: {} },
      obstacles: { sum: 0, items: [], eliminated: false },
      otherPenalty: 0,
      eta: { A: null, B: null }
    };
  }

  // 2. Beräkna etapper (A, T, B)
  const stages = {};
  let stagesPenalty = 0;
  let stagesElim = false;
  let running = false;
  let started = false;

  const STAGE_KEYS = ['A', 'transport', 'B'];

  for (const s of STAGE_KEYS) {
    const start = stageStartTS(t, s);
    const stop = stageStopTS(t, s);
    const savedDuration = stageDurationMsSaved(t, s);  // Manuellt korrigerad tid

    if (start) started = true;
    if (start && !stop && !savedDuration) running = true;

    // Beräkna effektiv tid (ms)
    let ms = null;
    if (start && stop) {
      // Om sträckan är klar: Prioritera savedDuration (manuell tid) om den finns
      ms = (Number.isFinite(savedDuration) ? savedDuration : (stop - start)) - pausedMsBetween(start, stop);
    } else if (start) {
      // Live-tid: Kombinera eventuell sparad (pausad/manuell) tid med live-ticking
      ms = (Number.isFinite(savedDuration) ? savedDuration : 0) + (Date.now() - start) - pausedMsSince(start);
    } else if (Number.isFinite(savedDuration)) {
      // Stoppad men med tid (t.ex. pausad på monitor)
      ms = savedDuration;
    }

    // Straffberäkning
    const { points, elim } = stagePenaltyFromMs(ms, eq, s);
    if (elim) stagesElim = true;
    if (Number.isFinite(points)) stagesPenalty += points;

    // Spara detaljer för denna etapp
    stages[s] = {
      start,
      stop,
      durationMs: ms,
      timePenalty: points,
      eliminated: elim,
      // Idealtider för referens (till ETA m.m.)
      limits: limitsFor(eq, s)
    };
  }

  // 3. Hinder
  let obsArr = getObstacleArray(d);

  let totalObstacleSeconds = 0;
  let totalOtherObstaclePenalty = 0;
  let obsElim = false;
  let maxObsNumber = 0;

  // Hämta info för klassen
  const obsCoeff = getObstacleCoefficient(eq.className);
  const drivenObs = getClassDrivenObstacles(eq.className);

  // Filtrera bort hinder som denna klass inte ska köra
  if (drivenObs) {
    obsArr = obsArr.filter(o => drivenObs.includes(Number(o.number || o.id)));
  }

  const obsItems = [];

  obsArr.forEach(o => {

    if (o.eliminated) obsElim = true;

    // Helper extracting timeSec and stored penalty
    const { timeSec, penalty: storedPenalty } = obstacleValues(o);
    let currentObsPenalty = 0;

    // TR: Sum all times first, then convert.
    if (Number.isFinite(timeSec)) {
      totalObstacleSeconds += timeSec;

      // Calculate individual for display consistency
      currentObsPenalty = (timeSec * obsCoeff);

      // Add knockdown and other penalties directly (linear)
      const kp = Number(o.knockdownPenalty || o.knockDownPenalty || 0);
      const op = Number(o.otherPenalty || 0);
      totalOtherObstaclePenalty += (kp + op);
      currentObsPenalty += (kp + op);
    } else {
      // Fallback: If no time, use stored penalty (could be time+knockdown sum)
      if (Number.isFinite(storedPenalty)) {
        totalOtherObstaclePenalty += storedPenalty;
        currentObsPenalty = storedPenalty;
      }
    }

    if (Number.isFinite(Number(o.number))) maxObsNumber = Math.max(maxObsNumber, Number(o.number));

    obsItems.push({
      ...o,
      timeSec,
      penalty: currentObsPenalty
    });
  });

  const obsPenalty = (totalObstacleSeconds * obsCoeff) + totalOtherObstaclePenalty;

  // Kontrollera om alla hinder är körda (för status "Klar")
  const obstaclesComplete = (() => {
    // Om specifika hinder definierats, verifiera att vi har ett protokoll för vart och ett
    if (drivenObs) {
      for (const reqNum of drivenObs) {
        const hit = obsArr.find(x => Number(x.number) === reqNum);
        if (!hit || (!hit.eliminated && !Number.isFinite(Number(hit.penalty)) && !Number.isFinite(Number(hit.timeSec)))) {
          return false;
        }
      }
      return true;
    }

    // Gammal fallback: Kolla att vi har nummer 1..maxObsNumber utan luckor
    if (obsArr.length === 0) return false;
    if (maxObsNumber === 0) return false;
    for (let i = 1; i <= maxObsNumber; i++) {
      const hit = obsArr.find(x => Number(x.number) === i);
      if (!hit || (!hit.eliminated && !Number.isFinite(Number(hit.penalty)))) return false;
    }
    return true;
  })();

  // 4a. Fel gångart (från observerLog)
  const obsLog = d.observerLog || {};
  const wgSec = Number(obsLog.wrongGaitSeconds) || 0;
  // Default för fel gångart är ofta 0.2 straff/sekund enl TR/FEI
  const wgRate = maraton_marathonConfig?.wrongGaitPenaltyRate ?? 0.2;
  const wgPenalty = wgSec * wgRate;

  const other = Number(d.otherPenalty ?? d.miscPenalty ?? d.others ?? d.other ?? d.penalty_other) || 0;

  // 4b. Totalt (Via Core Engine)
  const state = _buildState(eq, null, d, t, null, { marathonConfig: maraton_marathonConfig });
  const coreRes = _coreCalculate(state);

  const eliminated = coreRes.eliminated || !!d.eliminated || stagesElim || obsElim;
  let totalPenalty = null;

  if (eliminated) {
    totalPenalty = Infinity;
  } else {
    if (coreRes.totalPenalty !== null) {
      totalPenalty = coreRes.totalPenalty + other + wgPenalty;
    } else if (started || obsArr.length > 0) {
      totalPenalty = stagesPenalty + obsPenalty + other + wgPenalty;
    }
  }

  // 5. Status
  let status = 'Ej startat';
  if (isFinalizedDoc(d)) {
    status = 'Färdig'; // Eller 'Klar'? Behåller 'Klar' för UI-kompatibilitet om så önskas
    // Men "Finaliserad" är en starkare status.
    // Låt oss replikera den gamla logiken men robustare.
  }

  // Vi matchar 'statusFromDoc' logik men använder vår uträknade data
  if (eliminated) {
    status = 'Eliminerad';
  } else if (stages.B && stages.B.stop && obstaclesComplete) {
    status = 'Klar';
  } else if (running || started) {
    status = 'Pågår';
  }

  // Om dokumentet är finaliserat överrider det
  if (d.finalized || d.status === 'finalized' || d.isFinal) {
    // Behåll "Eliminerad" om faktiskt eliminerad, annars "Klar" (eller "Godkänd"?)
    // Resultatlistan visade bara status-badge "Klar" eller "Eliminerad".
    // Finaliserad-flaggan visas oftast separat (lås-ikon eller liknande).
    // Men om man är finaliserad är man per definition klar.
    if (status !== 'Eliminerad') status = 'Klar';
  }

  // Helpers för ETA
  let etaA = (stages.A.start && !stages.A.stop && stages.A.limits?.ideal > 0) ? stages.A.start + (stages.A.limits.ideal * 1000) : null;
  let etaB = (stages.B.start && !stages.B.stop && stages.B.limits?.ideal > 0) ? stages.B.start + (stages.B.limits.ideal * 1000) : null;

  if (stages.A.start && stages.A.stop && stages.A.limits?.isFixedTime && !stages.B.start) {
    const pauseTimeMs = getPauseTime() * 60 * 1000;
    etaB = stages.A.start + (stages.A.limits.ideal * 1000) + pauseTimeMs + pausedMsSince(stages.A.start);
  }

  return {
    startNumber: sn,
    status,
    totalPenalty, // Infinity om eliminerad
    eliminated,
    stages, // { A: { durationMs, timePenalty, ... }, ... }
    obstacles: {
      sum: obsPenalty,
      eliminated: obsElim,
      items: obsItems,
      maxNumber: maxObsNumber
    },
    otherPenalty: other,
    wgPenalty: wgPenalty,
    eta: {
      A: etaA,
      B: etaB
    },
    // TR Tie-breakers
    obstaclePenaltySum: obsPenalty,
    obstacleTimes: obsItems.sort((a, b) => Number(a.number) - Number(b.number)).map(o => o.timeSec || 0)
  };
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

function isFinalizedDoc(d) {
  return d?.finalized === true || d?.status === 'finalized' || d?.status === 'Klar' || d?.isFinal === true;
}

export function pausedMsBetween(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  let sum = 0;
  const now = Date.now();
  for (const w of _pauseWindows) {
    const from = w.from || (w.start ? new Date(w.start).getTime() : 0);
    const to = w.to || (w.end ? new Date(w.end).getTime() : now);
    const start = Math.max(a, from);
    const end = Math.min(b, to);
    if (end > start) sum += (end - start);
  }
  return Math.max(0, sum);
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
    // 4. Hinder
    const obsArr = getObstacleArray(data);

    // DEBUG LOG
    if (sn === '1' || sn === '2') {
    }

    let totalObstacleSeconds = 0;
    let totalOtherObstaclePenalty = 0;
    let obsElim = false;
    let maxObsNumber = 0;

    // Hämta koefficient för denna klass (t.ex. 1.0 eller 0.25)
    const obsCoeff = getObstacleCoefficient(eq.className);

    const obsItems = [];

    obsArr.forEach(o => {

      if (o.eliminated) obsElim = true;

      // Helper extracting timeSec and stored penalty
      const { timeSec, penalty: storedPenalty } = obstacleValues(o);
      let currentObsPenalty = 0;

      // TR: Sum all times first, then convert.
      // BUT we also store individual penalties for display.
      if (Number.isFinite(timeSec)) {
        totalObstacleSeconds += timeSec;

        // Calculate individual for display consistency
        currentObsPenalty = (timeSec * obsCoeff);

        // Add knockdown and other penalties directly (linear)
        const kp = Number(o.knockdownPenalty || o.knockDownPenalty || 0);
        const op = Number(o.otherPenalty || 0);
        totalOtherObstaclePenalty += (kp + op);
        currentObsPenalty += (kp + op);
      } else {
        // Fallback: If no time, use stored penalty (could be time+knockdown sum)
        if (Number.isFinite(storedPenalty)) {
          totalOtherObstaclePenalty += storedPenalty;
          currentObsPenalty = storedPenalty;
        }
      }

      const n = Number(o.number || o.id);
      if (Number.isFinite(n)) maxObsNumber = Math.max(maxObsNumber, n);

      obsItems.push({
        ...o,
        number: n, // Ensure number is set explicitly
        timeSec,
        penalty: currentObsPenalty
      });
    });

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

  // 4. Summera snitt för återstående
  let added = 0;
  let remaining = 0;
  const obsCoeff = getObstacleCoefficient(className);

  const calculateForTarget = (i) => {
    if (!doneObs.has(i)) {
      const stats = calculateClassObstacleStats(className, i, allStatusMap, allEquipages);
      if (stats && stats.avg) {
        added += (stats.avg * obsCoeff);
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

  let status = 'ok';
  let color = 'text-green-600';
  let label = 'I fönster';

  if (sec < lim.min) {
    status = 'fast';
    color = 'text-red-500';
    label = 'FÖR SNABB';
  } else if (sec > lim.timeLimit) {
    status = 'elim';
    color = 'text-red-700 font-bold';
    label = 'LIM/ELIM';
  } else if (sec > lim.max) {
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

export function calculateMarathonPlacements(equipages) {
  const byGroup = {};
  const map = new Map();

  for (const eq of equipages) {
    const sn = String(eq.startNumber);
    const res = eq.results?.marathon;
    if (!res) continue;

    // Bedöm om ekipaget ska ha en placering
    // Kriterium: Status 'Klar' (eller 'Färdig') och ett giltigt totalstraff.
    const finished = res.status === 'Klar' || res.status === 'Färdig';
    const tot = res.totalPenalty;

    if (!finished || !Number.isFinite(tot) || tot === Infinity) continue;

    // Gruppnyckel
    const grpKey = eq._mergedKey || `CLS:${eq.className || 'Okänd klass'}`;
    (byGroup[grpKey] ||= []).push({ sn, tot });
  }

  for (const grpKey of Object.keys(byGroup)) {
    const arr = byGroup[grpKey].sort((a, b) => a.tot - b.tot);
    let place = 1;
    let prev = null;
    arr.forEach((row, i) => {
      if (prev !== null && Math.abs(row.tot - prev) < 1e-6) {
        // delad
      } else {
        place = i + 1;
        prev = row.tot;
      }
      map.set(row.sn, place);
    });
  }

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
export function prepareMarathonResults(equipages, config, { timingMap, stateMap, obstaclesMap }) {
  // 1. Initiera config
  if (config) {
    setMarathonConfig(config);
    buildMergeMap(config);
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

    const res = calculateMarathonResult(e, mDoc, mergedTiming);

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
