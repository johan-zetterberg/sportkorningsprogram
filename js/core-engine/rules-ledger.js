// js/core-engine/rules-ledger.js

// --- MARATHON CONSTANTS ---

// Standard time penalty rate per second (0.25)
export const PENALTY_RATE = 0.25;

// Obstacle time penalty rate per second (0.25 according to TR)
export const MARATHON_OBSTACLE_TIME_PENALTY = 0.25;

// Time limit factors for elimination (TR rules)
export const MARATHON_TIME_LIMIT_FACTOR_A = 1.2; // max + 20%
export const MARATHON_TIME_LIMIT_FACTOR_B = 2.0; // 2x max
export const MARATHON_TIME_LIMIT_FACTOR_TRANSPORT = 2.0;

// Default time windows below the ideal time (minutes)
export const MARATHON_DEFAULT_WINDOW_A_MIN = 2;
export const MARATHON_DEFAULT_WINDOW_B_MIN = 3;

// Obstacle time above this is elimination (seconds)
export const MARATHON_OBSTACLE_MAX_TIME_SEC = 300;

// Penalty per knocked-down breakable element/ball in an obstacle
export const MARATHON_KNOCKDOWN_PENALTY = 2;

// Wrong gait, per incident: corrected within the grace time, no penalty;
// otherwise 1 penalty per period (TR V 523.1: "ska det korrigeras inom 5
// sekunder, annars tilldelas 1 straffpoäng/påbörjad period om 5 sekunder":
// 0-5 s free, 6-10 s 1 p, 11-15 s 2 p (owner's decision 2026-10-19); FEI
// 964.4: 1 for the occurrence plus 1 per additional completed 5 s period)
export const MARATHON_WRONG_GAIT_GRACE_SEC = 5;
export const MARATHON_WRONG_GAIT_PERIOD_SEC = 5;

// Swedish pony categories by height (TR V Moment 163), cm (upper limits, inclusive)
export const PONY_CATEGORY_MAX_HEIGHT_CM = { ponyA: 107, ponyB: 130, ponyCD: 148 };

// Default compulsory halt between A and B (minutes)
export const MARATHON_DEFAULT_PAUSE_MIN = 10;

// Marathon Speeds Table (TR V 2025) - km/h
export const DEFAULT_TRV_TEMPOS_KMH = {
  "Lätt B": {
    A: { ponyA: 10.0, ponyB: 10.5, ponyCD: 11.0, horse: 12.0 },
    B: { ponyA: 9.0, ponyB: 9.5, ponyCD: 10.0, horse: 11.0 },
  },
  "Lätt B Para": {
    A: { ponyA: 10.0, ponyB: 10.5, ponyCD: 11.0, horse: 12.0 },
    B: { ponyA: 8.5, ponyB: 9.0, ponyCD: 9.5, horse: 10.5 },
  },
  "Barnklass": {
    A: { ponyA: 10.0, ponyB: 10.5, ponyCD: 11.0, horse: 12.0 },
    B: { ponyA: 9.0, ponyB: 9.5, ponyCD: 10.0, horse: 11.0 },
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
  },
  // FEI / CAI - Default Speeds
  "CAI1*": {
    A: { ponyA: 10.0, ponyB: 11.0, ponyCD: 12.0, horse: 13.0 },
    B: { ponyA: 13.0, ponyB: 13.0, ponyCD: 13.0, horse: 14.0 }
  },
  "CAI2*": {
    A: { ponyA: 10.0, ponyB: 11.0, ponyCD: 12.0, horse: 13.0 },
    B: { ponyA: 11.0, ponyB: 12.0, ponyCD: 13.0, horse: 14.0 }
  },
  "CAI3*": {
    A: { ponyA: 11.0, ponyB: 12.0, ponyCD: 13.0, horse: 14.0 },
    B: { ponyA: 13.0, ponyB: 13.0, ponyCD: 13.0, horse: 14.0 }
  },
  "CAI Children": {
    A: { ponyA: 10.0, ponyB: 11.0, ponyCD: 12.0, horse: 14.0 },
    B: { ponyA: 11.0, ponyB: 12.0, ponyCD: 13.0, horse: 13.0 }
  },
  "CAI Junior": {
    A: { ponyA: 10.0, ponyB: 11.0, ponyCD: 12.0, horse: 13.0 },
    B: { ponyA: 11.0, ponyB: 12.0, ponyCD: 13.0, horse: 14.0 }
  },
  "CAI U25": {
    A: { ponyA: 10.0, ponyB: 11.0, ponyCD: 12.0, horse: 13.0 },
    B: { ponyA: 11.0, ponyB: 12.0, ponyCD: 13.0, horse: 14.0 }
  }
};

// FEI manual helper table for marathon hold-times pages.
// These defaults are intended for FEI/CAI manual calculations when no
// competition-specific override exists.
export const DEFAULT_FEI_MARATHON_TEMPOS_KMH = {
  "CAI 1*": {
    A: { ponyA: 10.0, ponyB: 11.0, ponyCD: 12.0, horse: 13.0 },
    B: { ponyA: 13.0, ponyB: 13.0, ponyCD: 13.0, horse: 14.0 }
  },
  "CAI 2*": {
    A: { ponyA: 10.0, ponyB: 11.0, ponyCD: 12.0, horse: 13.0 },
    B: { ponyA: 11.0, ponyB: 12.0, ponyCD: 13.0, horse: 14.0 }
  },
  "CAI 3*": {
    A: { ponyA: 11.0, ponyB: 12.0, ponyCD: 13.0, horse: 14.0 },
    B: { ponyA: 13.0, ponyB: 13.0, ponyCD: 13.0, horse: 14.0 }
  },
  "CAI 4*": {
    A: { ponyA: null, ponyB: null, ponyCD: null, horse: null },
    B: { ponyA: null, ponyB: null, ponyCD: null, horse: null }
  },
  "Children": {
    A: { ponyA: 10.0, ponyB: 11.0, ponyCD: 12.0, horse: 14.0 },
    B: { ponyA: 11.0, ponyB: 12.0, ponyCD: 13.0, horse: 13.0 }
  },
  "Junior": {
    A: { ponyA: 10.0, ponyB: 11.0, ponyCD: 12.0, horse: 13.0 },
    B: { ponyA: 11.0, ponyB: 12.0, ponyCD: 13.0, horse: 14.0 }
  },
  "Young Drivers (U25)": {
    A: { ponyA: 10.0, ponyB: 11.0, ponyCD: 12.0, horse: 13.0 },
    B: { ponyA: 11.0, ponyB: 12.0, ponyCD: 13.0, horse: 14.0 }
  },
  "U25": {
    A: { ponyA: 10.0, ponyB: 11.0, ponyCD: 12.0, horse: 13.0 },
    B: { ponyA: 11.0, ponyB: 12.0, ponyCD: 13.0, horse: 14.0 }
  },
  "CAICH 1*": {
    A: { ponyA: 10.0, ponyB: 11.0, ponyCD: 12.0, horse: 14.0 },
    B: { ponyA: 11.0, ponyB: 12.0, ponyCD: 13.0, horse: 13.0 }
  },
  "CAIJ 1*": {
    A: { ponyA: 10.0, ponyB: 11.0, ponyCD: 12.0, horse: 13.0 },
    B: { ponyA: 11.0, ponyB: 12.0, ponyCD: 13.0, horse: 14.0 }
  },
  "CAIJ 2*": {
    A: { ponyA: 10.0, ponyB: 11.0, ponyCD: 12.0, horse: 13.0 },
    B: { ponyA: 11.0, ponyB: 12.0, ponyCD: 13.0, horse: 14.0 }
  },
  "CAIY 2*": {
    A: { ponyA: 10.0, ponyB: 11.0, ponyCD: 12.0, horse: 13.0 },
    B: { ponyA: 11.0, ponyB: 12.0, ponyCD: 13.0, horse: 14.0 }
  },
  "Horse Singles": { A: { ponyA: null, ponyB: null, ponyCD: null, horse: 14.0 }, B: { ponyA: null, ponyB: null, ponyCD: null, horse: 13.0 } },
  "Horse Pairs": { A: { ponyA: null, ponyB: null, ponyCD: null, horse: 14.0 }, B: { ponyA: null, ponyB: null, ponyCD: null, horse: 13.0 } },
  "Horse Four-in-Hand": { A: { ponyA: null, ponyB: null, ponyCD: null, horse: 14.0 }, B: { ponyA: null, ponyB: null, ponyCD: null, horse: 13.0 } },
  "Pony Singles": { A: { ponyA: 10.0, ponyB: 11.0, ponyCD: 12.0, horse: null }, B: { ponyA: 11.0, ponyB: 12.0, ponyCD: 13.0, horse: null } },
  "Pony Pairs": { A: { ponyA: 10.0, ponyB: 11.0, ponyCD: 12.0, horse: null }, B: { ponyA: 11.0, ponyB: 12.0, ponyCD: 13.0, horse: null } },
  "Pony Four-in-Hand": { A: { ponyA: 10.0, ponyB: 11.0, ponyCD: 12.0, horse: null }, B: { ponyA: 11.0, ponyB: 12.0, ponyCD: 13.0, horse: null } }
};

// --- PRECISION CONSTANTS ---

// Precision time penalty rate (0.5)
export const PRECISION_TIME_PENALTY_RATE = 0.5;

// Precision standard knockdown penalty (3)
export const PRECISION_KNOCKDOWN_PENALTY = 3;

// Seconds added to the precision time for each obstacle rebuild: TR V 530.15
// and 530.19 (Bilaga 9: "Rivning på grund av olydnad 5 straffp. + 10 sek",
// "River del av hinder som ska köras 3 straffp. + 10 sek"); FEI 975.4.4,
// 975.5.1, 975.5.3, 975.8.5 ("10 seconds will be added to their time")
export const PRECISION_REBUILD_ADDED_SEC = 10;

// Precision times count in hundredths of a second (FEI 975.10.3 "Times must
// be recorded to hundredths of a second"; TR V 530.8 stopwatch tenths or
// electronic hundredths). A timer shows the elapsed time cut off at its last
// digit, so a time is truncated (not rounded) to hundredths.
export const PRECISION_TIME_RESOLUTION_MS = 10;

/** A precision time in ms truncated to hundredths (null when not a number). */
export function truncatePrecisionTimeMs(ms) {
  if (!isNum(ms)) return null;
  // The small margin keeps float noise (64.99999 s) from losing a hundredth
  return Math.floor(ms / PRECISION_TIME_RESOLUTION_MS + 1e-6) * PRECISION_TIME_RESOLUTION_MS;
}

// --- DRESSAGE CONSTANTS ---

export const DRESSAGE_COEFFICIENTS_BY_CODE = {
  '501': 1.00, '503': 1.00, '505': 1.00, '507': 1.00,
  '509': 0.84, '510': 0.80, '518': 0.666, '522': 1.00,
  '523': 1.00, '524': 0.80, '525': 0.666, '526': 0.76,
  '527': 0.76, '528': 0.73, '529': 0.80, '530': 0.80,
  '531': 0.80, '532': 0.615, '533': 0.80, '534': 0.615
};

// Pure utilities used widely in logic
export function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

export function round2(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

// --- CLEAR ROUND (TR V 509.3) ---
// "Vid bedömning clear round rangordnas inte ekipagen. Kriterier för clear
// round är i dressyr högst 80 straffpoäng, i maraton och precision 0
// straffpoäng. Tid i maratonhinder ger inte straffpoäng."
export const CLEAR_ROUND_MAX_DRESSAGE_PENALTY = 80;

// One phase of a clear-round class: null when the phase has no result (not
// driven, or not yet), else whether it meets the 509.3 criterion. The
// dressage penalty includes the error points (TR 518.9), the marathon
// penalty is computed with the obstacle time free (TR 526.1)
export function clearRoundPhaseApproved(phase, penalty, { eliminated = false } = {}) {
  if (eliminated) return false;
  if (!isNum(penalty)) return null;
  const p = round2(penalty);
  if (phase === 'D') return p <= CLEAR_ROUND_MAX_DRESSAGE_PENALTY;
  return p === 0;
}

// The whole clear round (TR V 509.3) over the phases the class drives:
// phases maps 'D' | 'M' | 'P' to { penalty, eliminated } or null for a phase
// the class does not drive. A driven phase without a result is not approved;
// with no driven phase at all, false
export function clearRoundApprovedOver(phases = {}) {
  const driven = ['D', 'M', 'P'].filter((k) => phases[k]);
  if (driven.length === 0) return false;
  return driven.every((k) => clearRoundPhaseApproved(k, phases[k].penalty, { eliminated: phases[k].eliminated === true }) === true);
}
