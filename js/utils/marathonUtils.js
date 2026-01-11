// js/utils/marathonUtils.js
// Centrala hjälp-funktioner för maratonberäkningar
// – används av resultat, totalresultat, monitor, PDF m.m.

// === Grundkonstanter ===

// Standard-tidsfel/sekund om inget annat anges i tävlingskonfigurationen
export const PENALTY_RATE = 0.25;

// Hinderberäkning (0,20 straff/sek - 1 per 5s)
export const MARATHON_OBSTACLE_TIME_PENALTY = 0.20;

// Maxtids-faktorer (TR)
export const MARATHON_TIME_LIMIT_FACTOR_A = 1.2; // max + 20%
export const MARATHON_TIME_LIMIT_FACTOR_B = 2.0; // 2x max

// Tempotabell enligt TR V 2025 (km/h)
export const TRV_2025_MARATON_TEMPOS_KMH = {
  "Lätt B": {
    A: { ponyA: 10.0, ponyB: 10.5, ponyCD: 11.0, horse: 12.0 },
    B: { ponyA: 9.0, ponyB: 9.5, ponyCD: 10.0, horse: 11.0 },
  },
  "Lätt B Para": {
    A: { ponyA: 10.0, ponyB: 10.5, ponyCD: 11.0, horse: 12.0 },
    B: { ponyA: 8.5, ponyB: 9.0, ponyCD: 9.5, horse: 10.5 },
  },
  "Lätt A": {
    A: { ponyA: 11.0, ponyB: 11.5, ponyCD: 12.0, horse: 13.0 },
    B: { ponyA: 10.0, ponyB: 10.5, ponyCD: 11.0, horse: 12.0 },
  },
  "Lätt A Para": {
    A: { ponyA: 11.0, ponyB: 11.5, ponyCD: 12.0, horse: 13.0 },
    B: { ponyA: 9.0, ponyB: 9.5, ponyCD: 10.0, horse: 11.0 },
  },
  "Msv": {
    A: { ponyA: 12.0, ponyB: 12.5, ponyCD: 13.0, horse: 14.0 },
    B: { ponyA: 11.0, ponyB: 11.5, ponyCD: 12.0, horse: 13.0 },
  },
  "Msv Para": {
    A: { ponyA: 12.0, ponyB: 12.5, ponyCD: 13.0, horse: 14.0 },
    B: { ponyA: 10.0, ponyB: 10.5, ponyCD: 11.0, horse: 12.0 },
  },
  "Svår": {
    A: { ponyA: 12.5, ponyB: 13.5, ponyCD: 14.0, horse: 15.0 },
    B: { ponyA: 11.5, ponyB: 12.5, ponyCD: 13.0, horse: 14.0 },
  },
  "Svår Para": {
    A: { ponyA: 12.5, ponyB: 13.5, ponyCD: 14.0, horse: 15.0 },
    B: { ponyA: 10.5, ponyB: 11.5, ponyCD: 12.0, horse: 13.0 },
  }
};

// === Konfiguration för aktuell tävling (delas mellan sidor) ===

// Här landar dokumentet du hämtar via getConfig('maratonConfig'/'marathonConfig')
export let maraton_marathonConfig = null;

export function setMarathonConfig(cfg) {
  maraton_marathonConfig = cfg || null;
}

// === Klass- & kategori-hjälpare ===

const kmhToMmin = (kmh) => (kmh * 1000) / 60;

export function normalizeClassKey(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const lower = s.toLowerCase();
  const para = /para/.test(lower);

  if (/^l[aä]tt\s*b/.test(lower)) return para ? "Lätt B Para" : "Lätt B";
  if (/^l[aä]tt\s*a/.test(lower)) return para ? "Lätt A Para" : "Lätt A";
  if (/^msv/.test(lower) || /medelsv[aå]r/.test(lower)) return para ? "Msv Para" : "Msv";
  if (/^sv[aå]r/.test(lower)) return para ? "Svår Para" : "Svår";

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
function getClassSettings(className) {
  if (!maraton_marathonConfig || !className) return null;
  const dataMap = maraton_marathonConfig.marathonClassData || maraton_marathonConfig.maratonClassData;
  if (!dataMap) return null;

  // 1. Exakt match
  if (dataMap[className]) return dataMap[className];

  // 2. Fuzzy match (startsWith) - case-insensitive
  const normClass = className.trim().toLowerCase();

  // Hitta nyckel som klassnamnet BÖRJAR med (t.ex. nyckel="msv 4" matchar klass="msv 4 enbet")
  const key = Object.keys(dataMap).find(k => {
    return normClass.startsWith(k.trim().toLowerCase());
  });

  if (key) return dataMap[key];

  return null;
}

export function tlSecondsFor(equipage, stage) {
  const className = equipage?.className || '';
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
    if (typeof classSettings[flatKey] === 'number') return classSettings[flatKey];

    const nested = classSettings[s.toUpperCase()];    // t.ex. A: { distance }
    if (nested && typeof nested.distance === 'number') return nested.distance;

    return null;
  };

  // robust läsning av tempo i m/min
  const getTempoMpm = (s) => {
    const nested = classSettings[s.toUpperCase()];
    if (nested && typeof nested.tempo_mpm === 'number') return nested.tempo_mpm;

    const flatKey = `tempo${s.toUpperCase()}`;        // t.ex. tempoA
    if (typeof classSettings[flatKey] === 'number') return classSettings[flatKey];

    return null;
  };

  // Transport/T
  if (stage === 'transport') {
    const distM = getDist('T');
    const mpm = getTempoMpm('T') ?? Number(classSettings.tempoT);
    if (distM > 0 && mpm > 0) return Math.round((distM / mpm) * 60);
    return null;
  }

  // A eller B
  if (stage === 'A' || stage === 'B') {
    const distM = getDist(stage);
    if (!(distM > 0)) return null;

    // 1) Försök ta tempo direkt ur konfigurationen
    const mpmCfg = getTempoMpm(stage);
    if (mpmCfg > 0) {
      return Math.round((distM / mpmCfg) * 60);
    }

    // 2) Annars TRV-fallback (km/h -> m/min)
    const clsKey = normalizeClassKey(className);
    const catKey = detectTRCategoryFromEquipage(equipage) || 'horse';

    const kmh = TRV_2025_MARATON_TEMPOS_KMH?.[clsKey]?.[stage]?.[catKey];
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

  const cls = equipage?.className || '';
  const classData = getClassSettings(cls) || {};

  if (stage === 'A') {
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
  if (stage === 'transport') return { points: 0, elim: false };
  if (!Number.isFinite(ms) || ms <= 0) return { points: 0, elim: false };

  const lim = limitsFor(equipage, stage);
  if (!lim) return { points: 0, elim: false };

  const sec = ms / 1000;

  // För sent (utanför absolut timeLimit) → ELIM
  if (sec > lim.timeLimit) return { points: Infinity, elim: true };

  let secondsOutsideWindow = 0;
  if (sec < lim.min) {
    secondsOutsideWindow = lim.min - sec;
  } else if (sec > lim.max) {
    secondsOutsideWindow = sec - lim.max;
  }

  if (secondsOutsideWindow <= 0) return { points: 0, elim: false };

  const cfgRate = maraton_marathonConfig?.timePenaltyRate;
  const coeff = Number.isFinite(cfgRate) && cfgRate > 0 ? cfgRate : PENALTY_RATE;

  const penaltySeconds = Math.ceil(secondsOutsideWindow);
  const pts = penaltySeconds * coeff;

  return { points: +pts.toFixed(2), elim: false };
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
  try { const t = new Date(v).getTime(); return Number.isFinite(t) ? t : null; }
  catch { return null; }
}

export function stageStartTS(t, s) {
  const upper = String(s).toUpperCase();
  const flat = (s === 'transport') ? 'transfer' : s;
  return parseTS(
    t?.[`start_${upper}`] || t?.[`start_${flat}`] || t?.stages?.[s]?.startClock || t?.timing?.[s]?.startClock
  );
}

export function stageStopTS(t, s) {
  if (!t) return null;
  const upper = String(s).toUpperCase();
  const flat = (s === 'transport') ? 'transfer' : s;
  return parseTS(
    t?.[`finish_${upper}`] || t?.[`finish_${flat}`] || t?.stages?.[s]?.stopClock || t?.timing?.[s]?.stopClock
  );
}

export function stageDurationMsSaved(t, s) {
  if (!t) return null;
  const upper = String(s).toUpperCase();
  const flat = (s === 'transport') ? 'transfer' : s;
  const v = t?.[`duration_${flat}_ms`] || t?.[`duration_${s}_ms`] || t?.[s]?.durationMs || t?.timing?.[s]?.durationMs;
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

  // 2. Global inställning (nytt fält)
  const globalVal = maraton_marathonConfig?.obstaclePenaltyRate;
  if (Number.isFinite(globalVal) && globalVal > 0) return globalVal;

  // 3. Fallback (TR standard = 1.0, dvs straff = tid)
  // Men eftersom admin tidigare styrde ALLT med timePenaltyRate (ofta 0.25)
  // kan man överväga att fallbacka dit om man vill vara super-compat.
  // Men målet här var att separera. Default 1.0 är mest korrekt för hinder.
  return 1.0;
}

export function pausedMsSince(ts) {
  if (!Number.isFinite(ts)) return 0;
  let sum = 0;
  const now = Date.now();
  for (const w of _pauseWindows) {
    const from = w.from;
    const to = (w.to == null ? now : w.to);
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
    if (Number.isFinite(savedDuration)) {
      ms = savedDuration;
    } else if (start && stop) {
      ms = (stop - start) - pausedMsBetween(start, stop);
    } else if (start) {
      // Live-tid
      ms = (Date.now() - start) - pausedMsSince(start);
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
  const obsArr = getObstacleArray(d);
  let obsPenalty = 0;
  let obsElim = false;
  let maxObsNumber = 0;

  // Hämta koefficient för denna klass (t.ex. 1.0 eller 0.25)
  const obsCoeff = getObstacleCoefficient(eq.className);

  obsArr.forEach(o => {
    if (o.eliminated) obsElim = true;

    // Helper extracting timeSec and stored penalty
    const { timeSec, penalty: storedPenalty } = obstacleValues(o);

    // Recalculate if possible to respect Admin Settings live
    if (Number.isFinite(timeSec)) {
      // Har vi tid -> räkna ut Time Penalty live
      const tp = timeSec * obsCoeff;

      // Lägg till separata straff (rivning/övrigt) explicit
      const kp = Number(o.knockdownPenalty || o.knockDownPenalty || 0);
      const op = Number(o.otherPenalty || 0);

      obsPenalty += (tp + kp + op);
    } else {
      // Fallback: Om ingen tid finns, lita på sparat straffvärde
      // (Detta kan vara "Time Penalty" eller "Total Sum" beroende på legacy-data, 
      // men utan tid kan vi inte göra bättre).
      if (Number.isFinite(storedPenalty)) {
        obsPenalty += storedPenalty;
      }
    }

    if (Number.isFinite(Number(o.number))) maxObsNumber = Math.max(maxObsNumber, Number(o.number));
  });

  // Kontrollera om alla hinder är körda (för status "Klar")
  // Vi antar maxHinder = 8 om inget annat hittas, men kollar vad vi fått in.
  // En enkel heuristik: "Klar" om B är stoppad och inga hinder saknas upp till det högsta hindret vi sett (eller minst 1).
  // Men statusFromDoc använde en loop upp till max hittad.
  // Vi gör så här:
  const obstaclesComplete = (() => {
    if (obsArr.length === 0) return false;
    // Kolla att vi har nummer 1..maxObsNumber utan luckor och med giltiga straff
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

  // 4b. Totalt
  const eliminated = !!d.eliminated || stagesElim || obsElim;
  let totalPenalty = null;

  if (eliminated) {
    totalPenalty = Infinity;
  } else {
    // Endast om vi har startat någon etapp börjar vi räkna poäng?
    // Eller om vi har straff.
    // Vi visar poäng om vi har NÅGON sorts data.
    if (started || obsArr.length > 0) {
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

  return {
    startNumber: sn,
    status,
    totalPenalty, // Infinity om eliminerad
    eliminated,
    stages, // { A: { durationMs, timePenalty, ... }, ... }
    obstacles: {
      sum: obsPenalty,
      eliminated: obsElim,
      items: obsArr,
      maxNumber: maxObsNumber
    },
    otherPenalty: other,
    // Helpers för ETA
    eta: {
      A: (stages.A.start && !stages.A.stop) ? stages.A.start + (stages.A.limits?.ideal * 1000 || 0) : null,
      B: (stages.B.start && !stages.B.stop) ? stages.B.start + (stages.B.limits?.ideal * 1000 || 0) : null
    }
  };
}

function isFinalizedDoc(d) {
  return d?.finalized === true || d?.status === 'finalized' || d?.isFinal === true;
}

export function pausedMsBetween(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  let sum = 0;
  const now = Date.now();
  for (const w of _pauseWindows) {
    const from = w.from;
    const to = (w.to == null ? now : w.to);
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

  // 2. Hitta max antal hinder för klassen (genom att scanna alla)
  let maxObs = 0;
  for (const [sn, data] of allStatusMap.entries()) {
    const eq = allEquipages.find(e => String(e.startNumber) === String(sn));
    if (eq && eq.className === className) {
      const oArr = getObstacleArray(data);
      oArr.forEach(o => {
        const n = Number(o.number || o.id);
        if (n > maxObs) maxObs = n;
      });
    }
  }
  // Fallback om tävlingen precis börjat
  const config = marathonConfig || maraton_marathonConfig;
  if (maxObs === 0) maxObs = config?.maxObstacles || 6;

  // 3. Beräkna nuvarande total (inklusive tidsfel på sträckor hittills)
  let currentTotal = 0;
  if (Number.isFinite(driverData.totalPenalty)) {
    currentTotal = driverData.totalPenalty;
  } else {
    // Fallback calculation?
    // Om vi anropar från speaker.js har vi ofta redan kört calculateMarathonResult en gång.
    // Om totalPenalty saknas kan vi inte gissa.
    return null;
  }

  if (driverData.eliminated) return Infinity;

  // 4. Summera snitt för återstående
  let added = 0;
  let remaining = 0;
  const obsCoeff = getObstacleCoefficient(className);

  for (let i = 1; i <= maxObs; i++) {
    if (!doneObs.has(i)) {
      // Hinder i är inte klart.
      const stats = calculateClassObstacleStats(className, i, allStatusMap, allEquipages);
      if (stats && stats.avg) {
        added += (stats.avg * obsCoeff);
      }
      remaining++;
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

      target.gateSplits.forEach(s => {
        if (!s.char || s.char !== s.char.toUpperCase()) return;
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