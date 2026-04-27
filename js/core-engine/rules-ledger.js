// js/core-engine/rules-ledger.js

// --- MARATHON CONSTANTS ---

// Standard time penalty rate per second (0.25)
export const PENALTY_RATE = 0.25;

// Obstacle time penalty rate per second (0.25 according to TR)
export const MARATHON_OBSTACLE_TIME_PENALTY = 0.25;

// Time limit factors for elimination (TR rules)
export const MARATHON_TIME_LIMIT_FACTOR_A = 1.2; // max + 20%
export const MARATHON_TIME_LIMIT_FACTOR_B = 2.0; // 2x max

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
    A: { ponyA: 12.0, ponyB: 12.0, ponyCD: 12.0, horse: 13.0 },
    B: { ponyA: 11.0, ponyB: 11.0, ponyCD: 11.0, horse: 12.0 }
  },
  "CAI2*": {
    A: { ponyA: 13.0, ponyB: 13.0, ponyCD: 13.0, horse: 14.0 },
    B: { ponyA: 12.0, ponyB: 12.0, ponyCD: 12.0, horse: 13.0 }
  },
  "CAI3*": {
    A: { ponyA: 14.0, ponyB: 14.0, ponyCD: 14.0, horse: 15.0 },
    B: { ponyA: 13.0, ponyB: 13.0, ponyCD: 13.0, horse: 14.0 }
  },
  "CAI Children": {
    A: { ponyA: 12.0, ponyB: 12.0, ponyCD: 12.0, horse: 13.0 },
    B: { ponyA: 11.0, ponyB: 11.0, ponyCD: 11.0, horse: 12.0 }
  },
  "CAI Junior": {
    A: { ponyA: 13.0, ponyB: 13.0, ponyCD: 13.0, horse: 14.0 },
    B: { ponyA: 12.0, ponyB: 12.0, ponyCD: 12.0, horse: 13.0 }
  },
  "CAI U25": {
    A: { ponyA: 14.0, ponyB: 14.0, ponyCD: 14.0, horse: 15.0 },
    B: { ponyA: 13.0, ponyB: 13.0, ponyCD: 13.0, horse: 14.0 }
  }
};

// --- PRECISION CONSTANTS ---

// Precision time penalty rate (0.5)
export const PRECISION_TIME_PENALTY_RATE = 0.5;

// Precision standard knockdown penalty (3)
export const PRECISION_KNOCKDOWN_PENALTY = 3;

// --- DRESSAGE CONSTANTS ---

export const DRESSAGE_COEFFICIENTS_BY_CODE = {
  '522': 1.00, '523': 1.00, '524': 0.80, '530': 0.80,
  '509': 0.84, '510': 0.80, '518': 0.666, '526': 0.76, '527': 0.76, '528': 0.73, '529': 0.80
};

// Pure utilities used widely in logic
export function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

export function round2(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}
