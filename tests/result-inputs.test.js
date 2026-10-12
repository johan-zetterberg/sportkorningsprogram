import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCompetitionState } from '../js/core-engine/stateSelector.js';
import { calculateMarathonResult, legacyDurationToMs, stageDurationMsSaved } from '../js/core-engine/marathon.js';
import { buildOverallStanding } from '../js/utils/precisionUtils.js';

// Inputs the result pages feed the engine: stage durations in the units the
// writers use, and the precision "to beat" standing.

test('maraton-timing durations: milliseconds from the secretariat, seconds in older data', () => {
  assert.equal(legacyDurationToMs(25 * 60 * 1000), 25 * 60 * 1000, '25 min in ms stays ms');
  assert.equal(legacyDurationToMs(25 * 60), 25 * 60 * 1000, '25 min in seconds becomes ms');
  assert.equal(legacyDurationToMs(null), null);
  // The saved ms field always wins
  assert.equal(stageDurationMsSaved({ duration_A_ms: 1_200_000, duration_A: 999 }, 'A'), 1_200_000);
  assert.equal(stageDurationMsSaved({ duration_A: 1_500_000 }, 'A'), 1_500_000);
  assert.equal(stageDurationMsSaved({ duration_A: 1500 }, 'A'), 1_500_000);
});

test('a secretariat correction in ms is a 25-minute stage, not 25 000 minutes', () => {
  const config = {
    marathonConfig: {
      marathonClassData: { K: { distanceA: 6000, tempoA: 250, distanceB: 6000, tempoB: 250 } },
      obstacleNumbers: [1]
    }
  };
  // Stage reset left duration_A_ms empty; the secretariat's duration_A is ms
  const timing = { duration_A_ms: null, duration_A: 25 * 60 * 1000, duration_B_ms: 24 * 60 * 1000 };
  const result = calculateMarathonResult(buildCompetitionState(
    { startNumber: 1, className: 'K' }, [], { obstacles: [{ number: 1, timeSec: 30 }] }, timing, {}, config
  ));
  assert.equal(result.stages.A.durationMs, 25 * 60 * 1000);
  assert.equal(result.eliminated, false);
});

test('the precision "to beat" standing ranks only finished dressage and marathon, with shared places', () => {
  const eq = (sn) => ({ startNumber: sn, className: 'A', driverName: `Kusk ${sn}` });
  const entries = [
    { eq: eq(1), dressagePenalty: 40, marathonPenalty: 60 },
    { eq: eq(2), dressagePenalty: 45, marathonPenalty: 55 },
    { eq: eq(3), dressagePenalty: null, marathonPenalty: 50 }, // dressage not finished
    { eq: eq(4), dressagePenalty: 30, marathonPenalty: 80 }
  ];
  const precisionMap = new Map([['4', { finalized: true, timeMs: 90_000, obstaclePenalty: 3 }]]);
  const { map } = buildOverallStanding(entries, precisionMap, { maxTimeByClass: { A: 120 } });

  assert.equal(map.get('1').total, 100);
  assert.equal(map.get('1').rank, 1);
  assert.equal(map.get('2').rank, 1, 'equal totals share the place');
  assert.equal(map.get('3').total, null, 'an unfinished dressage is unknown, not 0');
  assert.equal(map.get('3').rank, null);
  assert.equal(map.get('4').total, 113);
  assert.equal(map.get('4').rank, 3);
});

test('team scoring counts only phases the result engine calls finished', async () => {
  const { onlyFinishedPhases, calculateTeamResults } = await import('../js/services/teamCalculationService.js');
  const row = {
    startNumber: 1,
    dressage: { penalty: 40, judgePenalty: 40 },
    marathon: { totalPenalty: 55 },          // still on course
    precision: { totalPenalty: 3, pen: 3 },
    dressageComplete: true, marathonComplete: false, precisionComplete: true
  };
  const cleaned = onlyFinishedPhases(row);
  assert.equal(cleaned.dressage.penalty, 40);
  assert.equal(cleaned.marathon.totalPenalty, null);
  assert.equal(cleaned.precision.pen, 3);
  assert.equal(row.marathon.totalPenalty, 55, 'the input row is not changed');

  // An elimination stays an elimination
  const elim = onlyFinishedPhases({ marathon: { totalPenalty: Infinity, eliminated: true }, marathonComplete: false });
  assert.equal(elim.marathon.totalPenalty, Infinity);

  // A team whose member is still on course gets no total and no place
  const members = [1, 2, 3].map(sn => ({
    ...row, startNumber: sn, id: `e${sn}`,
    marathonComplete: sn !== 2
  }));
  const teams = [{ id: 't1', name: 'Lag', members: ['e1', 'e2', 'e3'] }];
  const [team] = calculateTeamResults(teams, members);
  assert.equal(team.total ?? null, null);

  // ...and gets one once every member has finished
  const [finished] = calculateTeamResults(teams, members.map(m => ({ ...m, marathonComplete: true })));
  assert.equal(finished.total, 294);
});

test('classes without a judge mapping are listed for the notice', async () => {
  const { classesWithoutJudgeMapping, judgeMappingNoticeHtml } = await import('../js/ui/judgeMappingNotice.js');
  const equipages = [
    { className: '1. Lätt B' }, { className: '2.Lätt A' }, { className: '2.Lätt A' },
    { className: 'Svår', status: 'struken' }
  ];
  const missing = classesWithoutJudgeMapping(equipages, { '1.Lätt B': { C: 'judge-c' } });
  assert.deepEqual(missing, ['2.Lätt A'], 'mapped (spacing aside), duplicate and withdrawn classes left out');
  assert.match(judgeMappingNoticeHtml(missing), /domarfördelning saknas/);
  assert.equal(judgeMappingNoticeHtml([]), '');
  // Class names are escaped
  assert.ok(!judgeMappingNoticeHtml(['<img src=x>']).includes('<img'));
});

test('teams get a preliminary position after the phases every team has finished', async () => {
  const { calculateTeamResults } = await import('../js/services/teamCalculationService.js');
  const member = (id, d, m, p, done = {}) => ({
    id, startNumber: id,
    dressage: { penalty: d, judgePenalty: d }, marathon: { totalPenalty: m }, precision: { totalPenalty: p, pen: p },
    dressageComplete: done.d ?? true, marathonComplete: done.m ?? true, precisionComplete: done.p ?? true
  });
  const teams = [
    { id: 'A', name: 'Lag A', members: ['a1', 'a2', 'a3'] },
    { id: 'B', name: 'Lag B', members: ['b1', 'b2', 'b3'] },
    { id: 'C', name: 'Lag C', members: ['c1', 'c2', 'c3'] }
  ];
  // Everyone has finished dressage; team B is through the marathon, A and C are not
  const rows = [
    member('a1', 40, 50, 3, { m: false, p: false }), member('a2', 41, 50, 3, { p: false }), member('a3', 42, 50, 3, { p: false }),
    member('b1', 45, 60, 0, { p: false }), member('b2', 45, 60, 0, { p: false }), member('b3', 45, 60, 0, { p: false }),
    member('c1', 38, 70, 0, { m: false, p: false }), member('c2', 39, 70, 0, { m: false, p: false }), member('c3', 41, 70, 0, { m: false, p: false })
  ];
  const result = calculateTeamResults(teams, rows);
  const byId = Object.fromEntries(result.map(t => [t.teamId, t]));

  // Standing after dressage (the last phase all teams finished): C 118, A 123, B 135
  assert.deepEqual(result.map(t => t.teamId), ['C', 'A', 'B'], 'listed in preliminary order');
  assert.deepEqual(byId.C.preliminary, { rank: 1, score: 118, after: 'dressage' });
  assert.equal(byId.A.preliminary.rank, 2);
  assert.equal(byId.B.preliminary.rank, 3, 'B\'s finished marathon does not count until all teams have it');
  assert.equal(byId.A.total, null);

  // Nobody has finished dressage: no standing yet
  const none = calculateTeamResults(teams, rows.map(r => ({ ...r, dressageComplete: false })));
  assert.ok(none.every(t => t.preliminary === null));

  // All final: normal ranks, no preliminary
  const final = calculateTeamResults(teams, rows.map(r => ({ ...r, dressageComplete: true, marathonComplete: true, precisionComplete: true })));
  assert.ok(final.every(t => t.preliminary === null));
  assert.ok(final.every(t => Number.isFinite(t.total)));
});
