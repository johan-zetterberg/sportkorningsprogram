// Rule fixes 2026-10-19: rule profile per class, Lätt A Barnklass, precision
// rebuild time, unknown pony/horse category in the marathon, precision times
// in hundredths, TR 527.1 B-section tie-break, unsupported precision formats,
// speed table gaps, ideal time rounding, team ties, para drivers in ordinary
// classes, and the owner's decisions on wrong gait (TR 523.1), whole seconds
// on TR sections (TR 523.2) and hold time in minutes (TR 525.7).
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCompetitionState } from '../js/core-engine/stateSelector.js';
import {
  normalizeClassKey,
  deriveRuleProfile,
  getClassRuleProfile,
  isFeiMarathonClass,
  stagePenaltyFromMs,
  limitsFor,
  tlSecondsFor,
  calculateMarathonResult,
  wrongGaitIncidentPenalty,
  wrongGaitPenaltyBySection,
  parseHoldTimeInput,
  formatHoldTimeMinutes,
  getTotalHoldTimeMs
} from '../js/core-engine/marathon.js';
import {
  assignPlaces,
  compareMarathonRank,
  comparePrecisionRank,
  marathonRankKey,
  precisionRankKey
} from '../js/core-engine/ranking.js';
import { calculatePrecisionResult as corePrecision } from '../js/core-engine/precision.js';
import { truncatePrecisionTimeMs, PRECISION_REBUILD_ADDED_SEC } from '../js/core-engine/rules-ledger.js';
import {
  calculatePrecisionResult,
  calculatePrecisionTimePenalty,
  computeMaxSecondsForClass,
  getClassTempoMpm,
  isLattBBarnClass,
  isYoungHorseClass,
  getPrecisionFormat,
  precisionRebuildCount,
  nextPrecisionRebuildCount,
  formatPrecisionAddedTime,
  trParaDriverTempoMpm
} from '../js/utils/precisionCalculation.js';
import { calculateTeamResults } from '../js/services/teamCalculationService.js';
import { calculateMarathonResult as serverMarathon } from '../functions/src/core-engine/marathon.js';
import { buildCompetitionState as serverState } from '../functions/src/core-engine/stateSelector.js';
import { calculatePrecisionResult as serverPrecision } from '../functions/src/utils/precisionCalculation.js';

const sec = (s) => s * 1000;

// --- 1. Rule profile per class (TR | FEI) ---

const profileConfig = {
  marathonClassData: {
    'Lätt A Enbet Häst': { distanceA: 5000, tempoA: 250, distanceB: 6000, tempoB: 240 },
    'Int Enbet Häst': { distanceA: 5000, tempoA: 250, distanceB: 6000, tempoB: 240, ruleProfile: 'FEI' },
    'Mall Enbet Häst': { distanceB: 6000, tempoB: 240, trTemplate: 'CAI2*' },
    'FEI 2* Enbet Häst': { distanceB: 6000, tempoB: 240, ruleProfile: 'TR' }
  },
  obstacleNumbers: [1]
};

test('rule profile: stored per class, else from the tempo template / class name; competitionMeta only in the admin', () => {
  assert.equal(getClassRuleProfile('Lätt A Enbet Häst', profileConfig), 'TR');
  assert.equal(getClassRuleProfile('Int Enbet Häst', profileConfig), 'FEI'); // stored
  assert.equal(getClassRuleProfile('Mall Enbet Häst', profileConfig), 'FEI'); // CAI template
  assert.equal(getClassRuleProfile('FEI 2* Enbet Häst', profileConfig), 'TR'); // stored wins over the name
  assert.equal(getClassRuleProfile('FEI 2* Enbet Häst', null), 'FEI'); // no config: the name
  assert.equal(deriveRuleProfile('Lätt B Enbet', { isInternational: true }), 'FEI');
  assert.equal(deriveRuleProfile('Lätt B Enbet', { isInternational: false }), 'TR');
  assert.equal(deriveRuleProfile('CAIO 4* Four-in-hand'), 'FEI');
  assert.equal(deriveRuleProfile('Caitlins pokal'), 'TR'); // not a CAI word
  assert.equal(isFeiMarathonClass('Int Enbet Häst', profileConfig), true);
  assert.equal(isFeiMarathonClass('Int Enbet Häst'), false); // name only
});

test('rule profile decides wrong gait: 10 s is 1 p under TR 523.1, 2 p under FEI 964.4', () => {
  const log = { wrongGaits: [{ atSec: 100, durSec: 10, section: 'B' }] };
  assert.equal(wrongGaitPenaltyBySection(log, 'Lätt A Enbet Häst', profileConfig).B, 1);
  assert.equal(wrongGaitPenaltyBySection(log, 'Int Enbet Häst', profileConfig).B, 2);
  // Before: the class name decided, so "Int Enbet Häst" got the TR 1 p
});

// --- owner's decision (b): TR section times in whole seconds (TR 523.2), FEI in ms (968.1.1) ---

test('TR section time is cut to whole seconds before min/max; FEI keeps milliseconds', () => {
  const tr = { className: 'Lätt A Enbet Häst' };
  const fei = { className: 'Int Enbet Häst' };
  // B: ideal = max 1500 s, min 1320 s
  assert.deepEqual(stagePenaltyFromMs(sec(1500.4), tr, 'B', profileConfig), { points: 0, elim: false }); // before 0.1
  assert.deepEqual(stagePenaltyFromMs(sec(1500.999), tr, 'B', profileConfig), { points: 0, elim: false });
  assert.deepEqual(stagePenaltyFromMs(sec(1501), tr, 'B', profileConfig), { points: 0.25, elim: false });
  assert.deepEqual(stagePenaltyFromMs(sec(1500.4), fei, 'B', profileConfig), { points: 0.1, elim: false });
  // Under the minimum: 1319.6 s is 1319 s on the TR clock = 1 s under -> 0.25 (before 0.1)
  assert.deepEqual(stagePenaltyFromMs(sec(1319.6), tr, 'B', profileConfig), { points: 0.25, elim: false });
  assert.deepEqual(stagePenaltyFromMs(sec(1319.6), fei, 'B', profileConfig), { points: 0.1, elim: false });
});

// --- owner's decision (a): TR wrong gait counting (TR 523.1) ---

test('TR 523.1 wrong gait: first 5 s free, 6-10 s 1 p, 11-15 s 2 p, 16 s 3 p', () => {
  const tr = (d) => wrongGaitIncidentPenalty(d, { fei: false });
  assert.deepEqual([5, 6, 10, 11, 15, 16].map(tr), [0, 1, 1, 2, 2, 3]);
  // FEI 964.4: 1 for the occurrence + 1 per additional completed 5 s period
  const fei = (d) => wrongGaitIncidentPenalty(d, { fei: true });
  assert.deepEqual([5, 6, 10, 11, 15, 16].map(fei), [0, 1, 2, 2, 3, 3]);
});

// --- 6. TR 527.1 B-section tie-break includes other and wrong-gait penalties on B ---

const timing = { A: { durationMs: sec(1200) }, B: { durationMs: sec(1510) } }; // A on time, B 10 s over
const bDoc = (otherSection) => ({
  obstacles: [{ number: 1, timeSeconds: 40 }],
  otherPenalty: 5,
  ...(otherSection ? { otherPenaltySection: otherSection } : {}),
  observerLog: { wrongGaits: [{ atSec: 10, durSec: 8, section: 'B' }, { atSec: 900, durSec: 8, section: 'A' }] }
});
const runMarathon = (className, doc, cfg = profileConfig) =>
  calculateMarathonResult(buildCompetitionState({ startNumber: 1, className }, null, doc, timing, null, { marathonConfig: cfg }));

test('bPenalty = B time + obstacles + other/wrong-gait penalties recorded on B', () => {
  const r = runMarathon('Lätt A Enbet Häst', bDoc('B'));
  // B 10 s over = 2.5; obstacle 40 s x 0.25 = 10; other 5 (B); wrong gait 1 (B) + 1 (A)
  assert.equal(r.totalPenalty, 19.5);
  assert.equal(r.bPenalty, 18.5); // before: 12.5 (B time + obstacles only)
  assert.equal(r.bPenaltyPartial, false);
  assert.deepEqual(marathonRankKey(r), { penalty: 19.5, bPenalty: 18.5 });

  const onA = runMarathon('Lätt A Enbet Häst', bDoc('A'));
  assert.equal(onA.totalPenalty, 19.5);
  assert.equal(onA.bPenalty, 13.5);

  // Not recorded: left out of B and flagged
  const unknown = runMarathon('Lätt A Enbet Häst', bDoc(null));
  assert.equal(unknown.bPenalty, 13.5);
  assert.equal(unknown.bPenaltyPartial, true);
});

test('TR: equal totals ranked by B (527.1); FEI profile: equal place (968.1.4)', () => {
  const rows = [
    { startNumber: 1, result: runMarathon('Lätt A Enbet Häst', bDoc('B')) },
    { startNumber: 2, result: runMarathon('Lätt A Enbet Häst', bDoc('A')) }
  ];
  assignPlaces(rows, { key: (r) => marathonRankKey(r.result), compare: compareMarathonRank });
  assert.deepEqual(rows.map(r => r.plac), [2, 1]);

  const fei = [
    { startNumber: 1, result: runMarathon('Int Enbet Häst', bDoc('B')) },
    { startNumber: 2, result: runMarathon('Int Enbet Häst', bDoc('A')) }
  ];
  assert.equal(fei[0].result.feiClass, true);
  // FEI wrong gait 8 s = 1 p each, as TR: totals equal
  assert.equal(fei[0].result.totalPenalty, fei[1].result.totalPenalty);
  assignPlaces(fei, { key: (r) => marathonRankKey(r.result), compare: compareMarathonRank });
  assert.deepEqual(fei.map(r => r.plac), [1, 1]);
});

test('a class driving B only counts unrecorded sections on B', () => {
  const cfg = { marathonClassData: { OnlyB: { distanceB: 6000, tempoB: 240 } }, obstacleNumbers: [1] };
  const doc = { obstacles: [{ number: 1, timeSeconds: 40 }], otherPenalty: 5, observerLog: { wrongGaits: [{ atSec: 1, durSec: 8 }] } };
  const r = calculateMarathonResult(buildCompetitionState({ startNumber: 3, className: 'OnlyB' }, null, doc,
    { B: { durationMs: sec(1500) } }, null, { marathonConfig: cfg }));
  assert.equal(r.totalPenalty, 16);
  assert.equal(r.bPenalty, 16);
  assert.equal(r.bPenaltyPartial, false);
});

test('the Cloud Function engine copy gives the same bPenalty and whole-second TR sections', () => {
  const local = runMarathon('Lätt A Enbet Häst', bDoc('B'));
  const server = serverMarathon(serverState({ startNumber: 1, className: 'Lätt A Enbet Häst' }, null, bDoc('B'), timing, null, { marathonConfig: profileConfig }));
  assert.equal(server.bPenalty, local.bPenalty);
  assert.equal(server.totalPenalty, local.totalPenalty);
  assert.equal(server.ruleProfile, 'TR');
});

// --- 2. "Lätt A Barnklass" is Lätt A, not Lätt B Barn (TR 509.2, Bilaga 3/5/9) ---

test('Lätt A Barnklass: Lätt A marathon tempos and normal precision; Barnklass/LB Barn unchanged', () => {
  assert.equal(normalizeClassKey('Lätt A Barnklass'), 'Lätt A'); // before 'Barnklass'
  assert.equal(normalizeClassKey('LA Barnklass'), 'Lätt A');
  assert.equal(normalizeClassKey('Barnklass'), 'Barnklass');
  assert.equal(normalizeClassKey('Barnklass Ponny'), 'Barnklass');
  assert.equal(normalizeClassKey('Lätt B Barnklass'), 'Barnklass');
  assert.equal(normalizeClassKey('Lätt B Barn Ponny'), 'Barnklass');
  assert.equal(isLattBBarnClass('Lätt A Barnklass'), false); // before true
  assert.equal(isLattBBarnClass('LA Barnklass'), false);
  assert.equal(isLattBBarnClass('Barnklass'), true);
  assert.equal(isLattBBarnClass('Barnklass Ponny'), true);
  assert.equal(isLattBBarnClass('LB Barn'), true);

  // Marathon B, 6000 m, pony C/D (140 cm): Lätt A 11 km/h -> 1964 s (before Lätt B 10 km/h -> 2160 s)
  const cfg = { marathonClassData: { 'Lätt A Barnklass': { distanceB: 6000 } } };
  assert.equal(tlSecondsFor({ className: 'Lätt A Barnklass', heightCm: 140 }, 'B', cfg), 1964);

  // Precision 600 m at the LA "Barn" tempo 180 -> 200 s; 250 s is 50 s over:
  // 25 p (before: eliminated, the Lätt B Barn limit = the time allowed)
  const pcfg = { courses: { 'Lätt A Barnklass': { trackLengthMeters: 600 } } };
  const r = calculatePrecisionResult({ finalized: true, timeMs: sec(250) }, { className: 'Lätt A Barnklass' }, pcfg);
  assert.equal(r.maxTimeSec, 200);
  assert.equal(r.eliminated, false);
  assert.equal(r.timePenalty, 25);
  // Lätt B Barn: over the time allowed is elimination (Bilaga 9, 509 2)
  const barn = calculatePrecisionResult({ finalized: true, timeMs: sec(361) }, { className: 'Barnklass' },
    { courses: { Barnklass: { trackLengthMeters: 600 } } });
  assert.equal(barn.maxTimeSec, 360);
  assert.equal(barn.eliminated, true);
});

// --- 3. Precision rebuild: +10 s per rebuild (TR 530.15/530.19, FEI 975.4.4/975.5.1/975.8.5) ---

const rebuildCfg = { courses: { X: { trackLengthMeters: 600, tempo: 250 } } }; // max 144 s, limit 288 s

test('rebuildCount adds 10 s to the time before time penalty, time limit and ranking', () => {
  assert.equal(PRECISION_REBUILD_ADDED_SEC, 10);
  const eq = { className: 'X' };
  const r = calculatePrecisionResult({ finalized: true, timeMs: sec(140), rebuildCount: 1 }, eq, rebuildCfg);
  assert.equal(r.drivenTimeMs, 140000);
  assert.equal(r.addedTimeMs, 10000);
  assert.equal(r.timeMs, 150000);
  assert.equal(r.timePenalty, 3); // 6 s over x 0.5 (before 0)
  assert.equal(r.totalPenalty, 3);

  // Time limit: 280 s + 10 s = 290 s > 288 s
  const elim = calculatePrecisionResult({ finalized: true, timeMs: sec(280), rebuildCount: 1 }, eq, rebuildCfg);
  assert.equal(elim.eliminated, true); // before: not eliminated

  // Ranking: 141 s + 10 s = 151 s (3.5 p) now ranks after 145 s (0.5 p);
  // before, 141 s (0 p) ranked first
  const a = calculatePrecisionResult({ finalized: true, timeMs: sec(141), rebuildCount: 1 }, eq, rebuildCfg);
  const b = calculatePrecisionResult({ finalized: true, timeMs: sec(145) }, eq, rebuildCfg);
  assert.equal(a.totalPenalty, 3.5);
  assert.equal(b.totalPenalty, 0.5);
  assert.ok(comparePrecisionRank(precisionRankKey(b), precisionRankKey(a)) < 0);

  // The engine adapter and the Cloud Function copy agree
  const viaCore = corePrecision({ equipage: eq, precision: { resultDoc: { finalized: true, timeMs: sec(140), rebuildCount: 1 } }, config: { precisionConfig: rebuildCfg } });
  assert.equal(viaCore.timePenalty, 3);
  assert.equal(serverPrecision({ finalized: true, timeMs: sec(140), rebuildCount: 1 }, eq, rebuildCfg).timePenalty, 3);
});

test('rebuild helpers for the input page (field rebuildCount)', () => {
  assert.equal(precisionRebuildCount({ rebuildCount: 2 }), 2);
  assert.equal(precisionRebuildCount({ rebuildCount: -1 }), 0);
  assert.equal(precisionRebuildCount({}), 0);
  assert.equal(nextPrecisionRebuildCount(0, 1), 1);
  assert.equal(nextPrecisionRebuildCount(1, -1), 0);
  assert.equal(nextPrecisionRebuildCount(0, -1), 0);
  assert.equal(formatPrecisionAddedTime(0), '');
  assert.equal(formatPrecisionAddedTime(2), '+20 s');
});

// --- 4. Unknown pony/horse category in a mixed class: no ideal time (TR 535.1) ---

test('marathon: a mixed class without category or height gets no ideal time (configMissing) instead of horse', () => {
  const cfg = { marathonClassData: { 'Lätt B Enbet': { distanceB: 6000 } }, obstacleNumbers: [1] };
  // before: horse 11 km/h -> 1964 s
  assert.equal(tlSecondsFor({ className: 'Lätt B Enbet' }, 'B', cfg), null);
  // pony B (120 cm): 9.5 km/h -> 2274 s; horse (160 cm): 1964 s
  assert.equal(tlSecondsFor({ className: 'Lätt B Enbet', heightCm: 120 }, 'B', cfg), 2274);
  assert.equal(tlSecondsFor({ className: 'Lätt B Enbet', heightCm: 160 }, 'B', cfg), 1964);
  const r = calculateMarathonResult(buildCompetitionState({ startNumber: 5, className: 'Lätt B Enbet' }, null,
    { obstacles: [{ number: 1, timeSeconds: 40 }] }, { B: { durationMs: sec(2000) } }, null, { marathonConfig: cfg }));
  assert.equal(r.configMissing, true);
  assert.deepEqual(r.missingConfig, ['B']);
  assert.equal(r.totalPenalty, null);
  assert.notEqual(r.status, 'Klar');
});

// --- 5. Precision times in hundredths, truncated (FEI 975.10.3, TR 530.8, TR 530.1.2) ---

test('precision times are truncated to hundredths for penalty and ranking', () => {
  assert.equal(truncatePrecisionTimeMs(65009), 65000);
  assert.equal(truncatePrecisionTimeMs(65019.999), 65010);
  assert.equal(truncatePrecisionTimeMs(64999.99999999), 65000); // float noise, not a lost hundredth
  // 144.019 s over 144 s: 0.01 s x 0.5 = 0.005 -> 0.01 (before 0.0095 -> 0.01); 144.009 s: 0
  assert.equal(calculatePrecisionTimePenalty(144009, 144), 0);
  assert.equal(calculatePrecisionTimePenalty(146009, 144), 1); // before 1.0045 -> 1

  const eq = { className: 'X' };
  const a = calculatePrecisionResult({ finalized: true, timeMs: 65001 }, eq, rebuildCfg);
  const b = calculatePrecisionResult({ finalized: true, timeMs: 65009 }, eq, rebuildCfg);
  assert.equal(a.timeMs, 65000);
  assert.equal(b.timeMs, 65000);
  const rows = [{ startNumber: 1, r: b }, { startNumber: 2, r: a }];
  assignPlaces(rows, { key: (row) => precisionRankKey(row.r), compare: comparePrecisionRank });
  assert.deepEqual(rows.map(r => r.plac), [1, 1]); // before 2, 1
  // Callers with a raw time get the same key
  assert.deepEqual(precisionRankKey({ totalPenalty: 0, timeMs: 65009 }), { penalty: 0, timeMs: 65000 });
});

// --- 7. Precision formats and FEI Young Horse: not calculated, no placing ---

test('unsupported precision formats get no placing; time competition and Young Horse no total', () => {
  const eq = { className: 'X' };
  const withFormat = (format) => ({ courses: { X: { trackLengthMeters: 600, tempo: 250, format } } });
  const normal = calculatePrecisionResult({ finalized: true, timeMs: sec(140) }, eq, withFormat('normal'));
  assert.equal(normal.formatUnsupported, false);
  assert.deepEqual(precisionRankKey(normal), { penalty: 0, timeMs: 140000 });

  for (const format of ['time', 'twoPhase', 'winningRound', 'driveOff', 'youngHorse']) {
    const r = calculatePrecisionResult({ finalized: true, timeMs: sec(140) }, eq, withFormat(format));
    assert.equal(r.precisionFormat, format);
    assert.equal(r.formatUnsupported, true, format);
    assert.equal(precisionRankKey(r), null, format);
    assert.equal(r.formatExcludesTotal, format === 'time' || format === 'youngHorse', format);
  }
  // A Young Horse/Pony class is flagged by its name (FEI Annex 13), Young Drivers is not
  assert.equal(isYoungHorseClass('CAI-YH 6 years'), true);
  assert.equal(isYoungHorseClass('Young Ponies 5yo'), true);
  assert.equal(isYoungHorseClass('FEI U25 Young Drivers'), false);
  assert.equal(getPrecisionFormat({ className: 'CAI-YH 6 years' }, {}), 'youngHorse');
  assert.equal(getPrecisionFormat({ className: 'Lätt A Enbet Häst' }, {}), 'normal');
});

// --- 9. Speed table gaps (TR Bilaga 5 / FEI 974.1) ---

test('precision tempo for classes without a row of their own', () => {
  // before: null for all of these (no max time, result withheld)
  assert.equal(getClassTempoMpm('Msv Enbet Ponny'), 230);
  assert.equal(getClassTempoMpm('Msv Par Häst'), 230);
  assert.equal(getClassTempoMpm('Lätt B Par Ponny'), 160);
  assert.equal(getClassTempoMpm('Lätt B Par Häst'), 180);
  assert.equal(getClassTempoMpm('Svår J Enbet Ponny'), 260);
  assert.equal(getClassTempoMpm('Svår J Enbet Häst'), 250);
  assert.equal(getClassTempoMpm('CAI Children Ponny Enbet'), 220);
  // unchanged rows
  assert.equal(getClassTempoMpm('MSV 3 Enbet Ponny'), 230);
  assert.equal(getClassTempoMpm('Svår Par Ponny'), 250);
  assert.equal(getClassTempoMpm('Lätt B Barn Ponny'), 100);
  // a mixed class still needs the category (TR 535.1)
  assert.equal(getClassTempoMpm({ className: 'Lätt B Par' }), null);
  assert.equal(getClassTempoMpm({ className: 'Lätt B Par', heightCm: 120 }), 160);
});

// --- 10. Rounding of ideal times (documented) ---

test('ideal times: marathon rounds to the nearest second, precision rounds up', () => {
  // 6000 m at 11 km/h = 1963.6 s -> 1964 s (bounds both min and max)
  const cfg = { marathonClassData: { 'Lätt B Enbet Häst': { distanceB: 6000 } } };
  assert.equal(limitsFor({ className: 'Lätt B Enbet Häst' }, 'B', cfg).ideal, 1964);
  // 610 m at 250 m/min = 146.4 s -> 147 s (an upper bound only, driver's favour)
  assert.equal(computeMaxSecondsForClass({ className: 'X' }, { courses: { X: { trackLengthMeters: 610, tempo: 250 } } }), 147);
  assert.equal(computeMaxSecondsForClass({ className: 'X' }, { courses: { X: { trackLengthMeters: 600, tempo: 250 } } }), 144);
});

// --- 11. Teams: equal totals share the place (TR V 510.2 has no tie-break) ---

test('legacy team profile: equal totals share the place', () => {
  const member = (id, d, m, p) => ({ id, startNumber: id, driverName: id, dressage: { penalty: d }, marathon: { totalPenalty: m }, precision: { totalPenalty: p }, totalPenalty: d + m + p });
  const rows = [
    member('a1', 40, 50, 10), member('a2', 40, 50, 10), member('a3', 40, 50, 10),
    member('b1', 30, 60, 10), member('b2', 30, 60, 10), member('b3', 30, 60, 10),
    member('c1', 50, 60, 10), member('c2', 50, 60, 10), member('c3', 50, 60, 10)
  ];
  const teams = [
    { id: 'A', name: 'Alfa', members: ['a1', 'a2', 'a3'] },
    { id: 'B', name: 'Beta', members: ['b1', 'b2', 'b3'] },
    { id: 'C', name: 'Gamma', members: ['c1', 'c2', 'c3'] }
  ];
  const results = calculateTeamResults(teams, rows);
  // A and B 300 each: before, A ranked 1 and B 2 (marathon 150 vs 180 as a tie-break)
  assert.deepEqual(results.map(t => [t.teamId, t.total, t.rank]), [['A', 300, 1], ['B', 300, 1], ['C', 360, 3]]);
});

// --- 12. Para driver in an ordinary TR class: para cones tempo (TR 534.9, Bilaga 5) ---

test('para driver in an ordinary MSV/Svår class drives the Bilaga 5 PARA tempo', () => {
  assert.equal(getClassTempoMpm({ className: 'Msv Enbet Häst', isPara: true }), 220); // before 230
  assert.equal(getClassTempoMpm({ className: 'MSV 3 Enbet Ponny', isPara: true }), 210); // before 230
  assert.equal(getClassTempoMpm({ className: 'Svår Enbet Ponny', isPara: true }), 230); // before 260
  assert.equal(getClassTempoMpm({ className: 'Lätt A Enbet Häst', isPara: true }), 210); // LA: no para row
  assert.equal(getClassTempoMpm({ className: 'Msv Enbet Häst' }), 230);
  assert.equal(trParaDriverTempoMpm({ className: 'Msv Para Ponny', isPara: true }), null); // own table row 210
  assert.equal(getClassTempoMpm({ className: 'Msv Para Ponny', isPara: true }), 210);
  // FEI profile: FEI Annex 8 para speed 230
  assert.equal(getClassTempoMpm({ className: 'FEI 2* Enbet Häst', isPara: true }), 230);
});

// --- owner's decision (c): hold time typed in minutes (TR 525.7, FEI 965.8.2) ---

test('hold time input is minutes; stored holdTimeSec stays seconds', () => {
  assert.equal(parseHoldTimeInput('2'), 120); // before 2 s
  assert.equal(parseHoldTimeInput('2,5'), 150);
  assert.equal(parseHoldTimeInput('2.5'), 150);
  assert.equal(parseHoldTimeInput('1:30'), 90);
  assert.equal(formatHoldTimeMinutes(120), '2');
  assert.equal(formatHoldTimeMinutes(150), '2,5');
  assert.equal(formatHoldTimeMinutes(150, { decimal: '.' }), '2.5');
  assert.equal(formatHoldTimeMinutes(90), '1,5');
  assert.equal(formatHoldTimeMinutes(70), '1:10');
  assert.equal(parseHoldTimeInput(formatHoldTimeMinutes(70)), 70);
  assert.equal(formatHoldTimeMinutes(0), '');
  // Stored values (seconds) are read as seconds
  assert.equal(getTotalHoldTimeMs([{ holdTimeSec: 120 }, { holdTimeSec: '30' }, { holdTimeSec: 8.5 }]), 158500);
});
