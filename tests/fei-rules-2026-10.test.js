import test from 'node:test';
import assert from 'node:assert/strict';
import { marathonRankKey, compareMarathonRank } from '../js/core-engine/ranking.js';
import { feiConesTempoMpm, computeMaxSecondsForClass } from '../js/utils/precisionCalculation.js';

test('FEI marathon: equal penalties share the place (FEI 968.1.4); TR breaks the tie on B', () => {
  const fei = (b) => marathonRankKey({ totalPenalty: 85, status: 'Klar', feiClass: true, stages: { B: { timePenalty: b } } });
  const tr = (b) => marathonRankKey({ totalPenalty: 85, status: 'Klar', stages: { B: { timePenalty: b } } });
  assert.equal(compareMarathonRank(fei(60), fei(70)), 0);
  assert.equal(compareMarathonRank(tr(60), tr(70)), -1);
  // Different totals still rank for FEI
  const lower = marathonRankKey({ totalPenalty: 80, status: 'Klar', feiClass: true });
  assert.equal(compareMarathonRank(lower, fei(60)), -1);
});

test('FEI cones speed by hitch and horse/pony (FEI 975.10.5)', () => {
  assert.equal(feiConesTempoMpm('FEI 3* Fyrspann Häst'), 240);
  assert.equal(feiConesTempoMpm('FEI 3* Fyrspann Ponny'), 240);
  assert.equal(feiConesTempoMpm('FEI 2* Par Häst'), 250);
  assert.equal(feiConesTempoMpm('FEI 2* Par Ponny'), 250);
  assert.equal(feiConesTempoMpm('FEI 2* Enbet Häst'), 250);
  assert.equal(feiConesTempoMpm('FEI 2* Enbet Ponny'), 260);
  // Junior/U25: hitch and category from the equipage
  assert.equal(feiConesTempoMpm({ className: 'FEI Junior 2*', horses: [{ type: 'B-ponny' }] }), 260);
  assert.equal(feiConesTempoMpm({ className: 'FEI Junior 2*', horses: [{ type: 'Häst' }] }), 250);
  assert.equal(feiConesTempoMpm({ className: 'FEI U25 2*', horses: [{ type: 'Häst' }, { type: 'Häst' }] }), 250);
  // Not decidable, Children (own speed) and national classes: the class table applies
  assert.equal(feiConesTempoMpm('FEI Junior 2*'), null);
  assert.equal(feiConesTempoMpm('FEI Children 1*'), null);
  assert.equal(feiConesTempoMpm('Lätt A Enbet Häst'), null);
});

test('Time Allowed is rounded up to a whole second', () => {
  const max = (length, tempo) => computeMaxSecondsForClass('X', { courses: { X: { trackLengthMeters: length, tempo } } });
  assert.equal(max(640, 180), 214); // 213.33 s
  assert.equal(max(600, 250), 144); // exact
  assert.equal(max(650, 180), 217); // 216.67 s
});

test('a clear round class gets no total placing (TR V 500.3)', async () => {
  const { totalRankKey } = await import('../js/core-engine/ranking.js');
  assert.equal(totalRankKey({ totalPenalty: 40, marathonPenalty: 0, dressagePenalty: 40, isClearRound: true }), null);
  assert.deepEqual(totalRankKey({ totalPenalty: 40, marathonPenalty: 0, dressagePenalty: 40 }), { penalty: 40, marathon: 0, dressage: 40 });
});