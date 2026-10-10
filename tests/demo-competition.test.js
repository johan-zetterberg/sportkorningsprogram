import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDemoCompetitionDataset } from '../js/services/demoCompetitionData.js';
import { getCarriageCompliance } from '../js/pages/shared/vagnbreddUtils.js';
import { getViloboxBadgeInfo } from '../js/pages/shared/vetCheckUtils.js';
import { calculateTeamResults } from '../js/services/teamCalculationService.js';
import { getTeamScoringProfile } from '../js/services/teamRuleProfiles.js';
import { calculateDressageResult } from '../js/services/calculationService.js';
import { dressagePrograms } from '../js/data/dressagePrograms.js';

test('buildDemoCompetitionDataset generates valid 3-day competition structure', () => {
  const data = buildDemoCompetitionDataset();

  assert.equal(data.compMeta.name, 'SM & Nationell Körning Flyinge (Demo)');
  assert.equal(data.compMeta.competitionMode, 'live');
  assert.equal(data.equipages.length, 8);
  assert.equal(data.obstacles.length, 6);
  assert.equal(data.teams.length, 2);
  assert.equal(data.officials.length, 3);
  assert.equal(data.judges.length, 3);
});

test('buildDemoCompetitionDataset includes multi-start driver per TR Mom 535.4', () => {
  const data = buildDemoCompetitionDataset();
  const eq1 = data.equipages.find(e => e.startNumber === 1);
  const eq3 = data.equipages.find(e => e.startNumber === 3);

  assert.equal(eq1.driverName, 'Anna Andersson');
  assert.equal(eq3.driverName, 'Anna Andersson');
  assert.equal(eq1.hasMultipleStarts, true);
  assert.equal(eq3.hasMultipleStarts, true);
  assert.equal(eq1.driverStartCount, 2);
});

test('buildDemoCompetitionDataset includes veterinary inspection and vilobox pulse per TR Mom 526', () => {
  const data = buildDemoCompetitionDataset();
  const eq1 = data.equipages.find(e => e.startNumber === 1);
  const eq3 = data.equipages.find(e => e.startNumber === 3);

  const horse1 = eq1.horses[0];
  assert.equal(horse1.inspections.initial.status, 'besiktigad');
  assert.equal(horse1.inspections.restArea.pulse, 56);
  const badge1 = getViloboxBadgeInfo(eq1);
  assert.equal(badge1.status, 'approved');

  const horse3 = eq3.horses[0];
  assert.equal(horse3.inspections.restArea.status, 'ombesiktning');
  assert.equal(horse3.inspections.restArea.pulse, 68);
  const badge3 = getViloboxBadgeInfo(eq3);
  assert.equal(badge3.status, 'hold');
});

test('buildDemoCompetitionDataset includes carriage compliance per TR Bilaga 2', () => {
  const data = buildDemoCompetitionDataset();
  const eq1 = data.equipages.find(e => e.startNumber === 1);
  const eq2 = data.equipages.find(e => e.startNumber === 2);

  const comp1 = getCarriageCompliance(eq1, 'marathon');
  assert.equal(comp1.compliant, true);
  assert.equal(comp1.status, 'ok');

  const comp2 = getCarriageCompliance(eq2, 'marathon');
  assert.equal(comp2.compliant, true);
  assert.equal(comp2.status, 'ok');
});

test('buildDemoCompetitionDataset includes obstacle hold deduction per TR Mom 542', () => {
  const data = buildDemoCompetitionDataset();
  const m1 = data.marathonRecords.find(m => m.startNumber === 1);
  const obs3 = m1.obstacles.find(o => o.number === 3);

  assert.equal(obs3.holdTimeSec, 8.5);
  assert.ok(obs3.penalty > 0);
});

test('buildDemoCompetitionDataset calculates valid Lag-SM 2026 team results', () => {
  const data = buildDemoCompetitionDataset();
  const rows = [
    { id: '1', startNumber: 1, driverName: 'Anna', dressage: { penalty: 46.2 }, marathon: { totalPenalty: 68.29 }, precision: { totalPenalty: 0.0 }, totalPenalty: 114.49 },
    { id: '4', startNumber: 4, driverName: 'Cecilia', dressage: { penalty: 52.4 }, marathon: { totalPenalty: 70.0 }, precision: { totalPenalty: 3.0 }, totalPenalty: 125.4 },
    { id: '7', startNumber: 7, driverName: 'Filip', dressage: { penalty: 51.3 }, marathon: { totalPenalty: 64.21 }, precision: { totalPenalty: 3.0 }, totalPenalty: 118.51 },
    { id: '2', startNumber: 2, driverName: 'Bengt', dressage: { penalty: 54.8 }, marathon: { totalPenalty: 74.26 }, precision: { totalPenalty: 8.5 }, totalPenalty: 137.56 },
    { id: '5', startNumber: 5, driverName: 'David', dressage: { penalty: 58.0 }, marathon: { totalPenalty: 75.96 }, precision: { totalPenalty: 3.0 }, totalPenalty: 136.96 },
    { id: '8', startNumber: 8, driverName: 'Greta', dressage: { penalty: 48.9 }, marathon: { totalPenalty: 65.84 }, precision: { totalPenalty: 0.0 }, totalPenalty: 114.74 }
  ];

  const profile = getTeamScoringProfile(data.configs.teamRules.profileId);
  const teamResults = calculateTeamResults(data.teams, rows, { profile });

  assert.equal(teamResults.length, 2);
  assert.equal(teamResults[0].rank, 1);
  assert.equal(teamResults[1].rank, 2);
  assert.ok(teamResults[0].total < teamResults[1].total);
});

test('buildDemoCompetitionDataset includes full judge protocols with movements for all equipages and judges', () => {
  const data = buildDemoCompetitionDataset();

  assert.equal(data.judgeProtocols.length, 24, 'Should have 24 protocols (8 equipages * 3 judges)');

  for (const eq of data.equipages) {
    const protocols = data.judgeProtocols.filter(p => p.startNumber === eq.startNumber);
    assert.equal(protocols.length, 3, `Equipage #${eq.startNumber} should have 3 judge protocols`);

    const judgePositions = protocols.map(p => p.judgePosition).sort();
    assert.deepEqual(judgePositions, ['B', 'C', 'E'], `Equipage #${eq.startNumber} should have judges B, C, E`);

    for (const proto of protocols) {
      assert.ok(Array.isArray(proto.movements) && proto.movements.length > 0, `Protocol ${proto.judgePosition} for #${eq.startNumber} must have movements`);
      for (const m of proto.movements) {
        assert.ok(m.momentNo > 0, 'Movement must have momentNo');
        assert.ok(typeof m.score === 'number' && m.score > 0, 'Movement must have numerical score');
        assert.ok(typeof m.comment === 'string', 'Movement should have comment');
      }
    }

    const dressRes = calculateDressageResult(eq, protocols, data.judges, dressagePrograms);
    assert.ok(dressRes.penalty !== null, `Equipage #${eq.startNumber} dressage penalty must not be null`);
    assert.ok(dressRes.penalty > 35 && dressRes.penalty < 75, `Equipage #${eq.startNumber} penalty (${dressRes.penalty}) must be in realistic range`);
    assert.ok(dressRes.percent > 50 && dressRes.percent < 85, `Equipage #${eq.startNumber} percent (${dressRes.percent}) must be in realistic range`);
    assert.equal(dressRes.eliminated, false);
  }
});
