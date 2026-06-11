import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildProcessedTotalTeams,
  buildTeamDisciplineBests,
  formatTeamScore,
  getTeamCardBorderClass,
  getTeamMemberTextClass,
  getTeamMemberTotalTextClass,
  isBestTeamDiscipline,
  renderTeamDisciplineSummaryCell,
  renderTeamCard,
  renderTeamMemberRow,
  renderTeamMemberStatusIcon,
  renderTeamRankBadge,
  renderTeamSummaryFooter
} from '../js/pages/shared/totalResultTeams.js';
import { calculateTeamResults } from '../js/services/teamCalculationService.js';

test('buildProcessedTotalTeams delegates to team calculation service', () => {
  const rawTeams = [{ id: 'team-1' }];
  const processedResults = [{ id: 'eq-1', totalPenalty: 10 }];
  const calls = [];

  const result = buildProcessedTotalTeams({
    rawTeams,
    processedResults,
    calculateTeamResults: (...args) => {
      calls.push(args);
      return [{ teamId: 'team-1', total: 10 }];
    }
  });

  assert.deepEqual(calls[0], [rawTeams, processedResults]);
  assert.deepEqual(result, [{ teamId: 'team-1', total: 10 }]);
});

test('buildProcessedTotalTeams requires a calculation function', () => {
  assert.throws(() => buildProcessedTotalTeams(), /calculateTeamResults saknas/);
});

test('calculateTeamResults keeps dressage-only teams incomplete instead of eliminated', () => {
  const teams = [{
    id: 'team-1',
    name: 'Dressyrklubb',
    members: ['eq-1', 'eq-2']
  }];
  const rows = [
    { id: 'eq-1', startNumber: 1, driverName: 'Anna', dressage: { penalty: 42.5 }, marathon: {}, precision: {}, totalPenalty: null, isEliminated: false },
    { id: 'eq-2', startNumber: 2, driverName: 'Bo', dressage: { penalty: 40 }, marathon: {}, precision: {}, totalPenalty: null, isEliminated: false }
  ];

  const [team] = calculateTeamResults(teams, rows);

  assert.equal(team.isEliminated, false);
  assert.equal(team.isIncomplete, true);
  assert.equal(team.total, null);
  assert.equal(team.dressage, 82.5);
  assert.equal(team.members[0].isCounting, true);
  assert.equal(team.members[0].penalty, null);
});

test('buildTeamDisciplineBests ignores eliminated teams', () => {
  const bests = buildTeamDisciplineBests([
    { teamName: 'A', dressage: 30, marathon: 40, precision: 5, isEliminated: false },
    { teamName: 'B', dressage: 20, marathon: 30, precision: 4, isEliminated: true },
    { teamName: 'C', dressage: 28, marathon: 42, precision: 3, isEliminated: false }
  ]);

  assert.deepEqual(bests, {
    dressage: 28,
    marathon: 40,
    precision: 3
  });
});

test('isBestTeamDiscipline matches finite best values with tolerance', () => {
  const bests = { dressage: 28 };

  assert.equal(isBestTeamDiscipline({ dressage: 28.004, isEliminated: false }, 'dressage', bests), true);
  assert.equal(isBestTeamDiscipline({ dressage: 28.02, isEliminated: false }, 'dressage', bests), false);
  assert.equal(isBestTeamDiscipline({ dressage: 28, isEliminated: true }, 'dressage', bests), true);
  assert.equal(isBestTeamDiscipline({ dressage: 0, isEliminated: true }, 'dressage', bests), false);
});

test('renderTeamRankBadge renders elimination, podium and numeric rank states', () => {
  assert.match(renderTeamRankBadge({ isEliminated: true }, 0), /ELIM/);
  assert.match(renderTeamRankBadge({ isEliminated: false, isIncomplete: true }, 0), /Pågår/);
  assert.match(renderTeamRankBadge({ isEliminated: false, rank: 1 }, 0), /1:a plats/);
  assert.match(renderTeamRankBadge({ isEliminated: false, rank: 2 }, 1), /2:a plats/);
  assert.match(renderTeamRankBadge({ isEliminated: false, rank: 3 }, 2), /3:e plats/);
  assert.match(renderTeamRankBadge({ isEliminated: false, rank: 4 }, 3), />4</);
});

test('formatTeamScore handles eliminated and missing values', () => {
  assert.equal(formatTeamScore(12.345), '12.35');
  assert.equal(formatTeamScore(12.345, { eliminated: true }), '-');
  assert.equal(formatTeamScore(12.345, { eliminated: true, eliminatedLabel: 'ELIM' }), 'ELIM');
  assert.equal(formatTeamScore(null), '-');
});

test('getTeamCardBorderClass highlights only the leading active team', () => {
  assert.match(getTeamCardBorderClass({ isEliminated: false }, 0), /border-amber/);
  assert.equal(getTeamCardBorderClass({ isEliminated: false }, 1), 'dark:border-gray-700');
  assert.equal(getTeamCardBorderClass({ isEliminated: true }, 0), 'dark:border-gray-700');
  assert.equal(getTeamCardBorderClass({ isEliminated: false, isIncomplete: true }, 0), 'dark:border-gray-700');
});

test('renderTeamMemberStatusIcon renders eliminated, counting and non-counting states', () => {
  assert.match(renderTeamMemberStatusIcon({ eliminated: true }), /fa-times/);
  assert.match(renderTeamMemberStatusIcon({ isCounting: true }), /fa-check-circle/);
  assert.match(renderTeamMemberStatusIcon({ isCounting: false }), /text-gray-300/);
});

test('team member class helpers distinguish counting and non-counting members', () => {
  assert.match(getTeamMemberTextClass({ isCounting: true }), /font-semibold/);
  assert.match(getTeamMemberTextClass({ isCounting: false }), /italic/);
  assert.match(getTeamMemberTotalTextClass({ isCounting: true }), /text-gray-800/);
  assert.equal(getTeamMemberTotalTextClass({ isCounting: false }), 'text-gray-400');
});

test('renderTeamMemberRow renders member details and injected assets', () => {
  const html = renderTeamMemberRow({
    startNumber: 12,
    name: 'Anna Andersson',
    penalty: 15.5,
    dressage: 8,
    marathon: 5,
    precision: 2.5,
    isCounting: true,
    eliminated: false
  }, {
    flagHtml: '<span>SE</span>',
    clubLogoHtml: '<img alt="club">',
    clubName: 'Lunds KK'
  });

  assert.match(html, /data-start="12"/);
  assert.match(html, /Anna Andersson/);
  assert.match(html, /Lunds KK/);
  assert.match(html, /15.50/);
  assert.match(html, /<span>SE<\/span>/);
  assert.match(html, /<img alt="club">/);
});

test('renderTeamMemberRow renders eliminated member scores', () => {
  const html = renderTeamMemberRow({
    startNumber: 13,
    name: 'Bo',
    penalty: 15.5,
    dressage: 8,
    marathon: 5,
    precision: 2.5,
    eliminated: true
  });

  assert.match(html, /ELIM/);
  assert.match(html, /fa-times/);
});

test('renderTeamDisciplineSummaryCell highlights best score', () => {
  const html = renderTeamDisciplineSummaryCell({
    value: 12.3,
    isBest: true,
    title: 'Best'
  });

  assert.match(html, /12.30/);
  assert.match(html, /fa-star/);
  assert.match(html, /Best/);
});

test('renderTeamSummaryFooter renders team sums and eliminated totals', () => {
  const active = renderTeamSummaryFooter({
    dressage: 10,
    marathon: 20,
    precision: 3,
    total: 33,
    isEliminated: false
  }, {
    isBestDressage: true
  });

  assert.match(active, /Bästa 3/);
  assert.match(active, /10.00/);
  assert.match(active, /33.00/);
  assert.match(active, /fa-star/);

  const eliminated = renderTeamSummaryFooter({
    dressage: 10,
    marathon: 20,
    precision: 3,
    total: 33,
    isEliminated: true
  });

  assert.doesNotMatch(eliminated, /33.00/);
  assert.match(eliminated, />\s*-\s*<\/div>/);
});

test('renderTeamCard renders header, members and summary footer', () => {
  const html = renderTeamCard({
    teamName: 'Lunds KK',
    rank: 1,
    total: 33,
    dressage: 10,
    marathon: 20,
    precision: 3,
    isEliminated: false
  }, {
    index: 0,
    teamBests: { dressage: 10, marathon: 20, precision: 3 },
    teamAssetHtml: '<img alt="team">',
    membersHtml: '<div data-start="12">Anna</div>'
  });

  assert.match(html, /Lunds KK/);
  assert.match(html, /Lagtotal/);
  assert.match(html, /33.00/);
  assert.match(html, /<img alt="team">/);
  assert.match(html, /data-start="12"/);
  assert.match(html, /fa-star/);
});

test('renderTeamCard renders eliminated team total label', () => {
  const html = renderTeamCard({
    teamName: 'Eliminerat lag',
    total: 33,
    isEliminated: true
  });

  assert.match(html, /ELIM/);
  assert.doesNotMatch(html, /Lagtotal/);
});

test('calculateTeamResults calculates team results per discipline separately (different members counting)', () => {
  const teams = [{
    id: 'team-1',
    name: 'Blandklubb',
    members: ['eq-1', 'eq-2', 'eq-3', 'eq-4']
  }];
  const rows = [
    // eq-1 is best in dressage (30), bad in marathon (90), ok in cones (5)
    { id: 'eq-1', startNumber: 1, driverName: 'A', dressage: { penalty: 30 }, marathon: { totalPenalty: 90 }, precision: { totalPenalty: 5 }, totalPenalty: 125, isEliminated: false },
    // eq-2 is ok in dressage (40), best in marathon (40), bad in cones (15)
    { id: 'eq-2', startNumber: 2, driverName: 'B', dressage: { penalty: 40 }, marathon: { totalPenalty: 40 }, precision: { totalPenalty: 15 }, totalPenalty: 95, isEliminated: false },
    // eq-3 is ok in dressage (50), ok in marathon (50), best in cones (2)
    { id: 'eq-3', startNumber: 3, driverName: 'C', dressage: { penalty: 50 }, marathon: { totalPenalty: 50 }, precision: { totalPenalty: 2 }, totalPenalty: 102, isEliminated: false },
    // eq-4 is average (45, 60, 8)
    { id: 'eq-4', startNumber: 4, driverName: 'D', dressage: { penalty: 45 }, marathon: { totalPenalty: 60 }, precision: { totalPenalty: 8 }, totalPenalty: 113, isEliminated: false }
  ];

  const [team] = calculateTeamResults(teams, rows);

  // Best 3 dressage should be: eq-1 (30), eq-2 (40), eq-4 (45) = 115
  // Best 3 marathon should be: eq-2 (40), eq-3 (50), eq-4 (60) = 150
  // Best 3 precision should be: eq-3 (2), eq-1 (5), eq-4 (8) = 15
  // Total: 115 + 150 + 15 = 280
  assert.equal(team.dressage, 115);
  assert.equal(team.marathon, 150);
  assert.equal(team.precision, 15);
  assert.equal(team.total, 280);

  // Check which members are counting in which disciplines
  const m1 = team.members.find(m => m.memberId === 'eq-1');
  const m2 = team.members.find(m => m.memberId === 'eq-2');
  const m3 = team.members.find(m => m.memberId === 'eq-3');
  const m4 = team.members.find(m => m.memberId === 'eq-4');

  assert.equal(m1.isCountingDressage, true);
  assert.equal(m1.isCountingMarathon, false);
  assert.equal(m1.isCountingPrecision, true);
  assert.equal(m1.isCounting, true);

  assert.equal(m2.isCountingDressage, true);
  assert.equal(m2.isCountingMarathon, true);
  assert.equal(m2.isCountingPrecision, false);
  assert.equal(m2.isCounting, true);

  assert.equal(m3.isCountingDressage, false);
  assert.equal(m3.isCountingMarathon, true);
  assert.equal(m3.isCountingPrecision, true);
  assert.equal(m3.isCounting, true);

  assert.equal(m4.isCountingDressage, true);
  assert.equal(m4.isCountingMarathon, true);
  assert.equal(m4.isCountingPrecision, true);
  assert.equal(m4.isCounting, true);
});

test('calculateTeamResults handles partially eliminated members (eliminated in one discipline but counting in another)', () => {
  const teams = [{
    id: 'team-1',
    name: 'Klubb A',
    members: ['eq-1', 'eq-2', 'eq-3', 'eq-4']
  }];
  const rows = [
    // eq-1 is eliminated in dressage but has 40 in marathon, 5 in cones
    { id: 'eq-1', startNumber: 1, driverName: 'A', dressage: { penalty: null }, dressageStatus: 'elim', marathon: { totalPenalty: 40 }, precision: { totalPenalty: 5 }, totalPenalty: null, isEliminated: true },
    // eq-2 has 40, 50, 10
    { id: 'eq-2', startNumber: 2, driverName: 'B', dressage: { penalty: 40 }, marathon: { totalPenalty: 50 }, precision: { totalPenalty: 10 }, totalPenalty: 100, isEliminated: false },
    // eq-3 has 50, 60, 15
    { id: 'eq-3', startNumber: 3, driverName: 'C', dressage: { penalty: 50 }, marathon: { totalPenalty: 60 }, precision: { totalPenalty: 15 }, totalPenalty: 125, isEliminated: false },
    // eq-4 has 45, 70, 20
    { id: 'eq-4', startNumber: 4, driverName: 'D', dressage: { penalty: 45 }, marathon: { totalPenalty: 70 }, precision: { totalPenalty: 20 }, totalPenalty: 135, isEliminated: false }
  ];

  const [team] = calculateTeamResults(teams, rows);

  // Dressage: eq-1 is elim, so only eq-2 (40), eq-3 (50), eq-4 (45) count = 135
  // Marathon: eq-1 (40) is valid and best! eq-1 (40) + eq-2 (50) + eq-3 (60) = 150
  // Precision: eq-1 (5) is valid and best! eq-1 (5) + eq-2 (10) + eq-3 (15) = 30
  // Total should be: 135 + 150 + 30 = 315
  assert.equal(team.dressage, 135);
  assert.equal(team.marathon, 150);
  assert.equal(team.precision, 30);
  assert.equal(team.total, 315);
  assert.equal(team.isEliminated, false);
});

test('calculateTeamResults correctly ranks teams with tie-breakers', () => {
  const teams = [
    { id: 'team-tied-1', name: 'Tied Team 1', members: ['eq-1', 'eq-2', 'eq-3'] },
    { id: 'team-tied-2', name: 'Tied Team 2', members: ['eq-4', 'eq-5', 'eq-6'] }
  ];
  const rows = [
    // Team 1 members
    { id: 'eq-1', startNumber: 1, driverName: 'A1', dressage: { penalty: 40 }, marathon: { totalPenalty: 50 }, precision: { totalPenalty: 10 }, totalPenalty: 100, isEliminated: false, plac: 3 },
    { id: 'eq-2', startNumber: 2, driverName: 'B1', dressage: { penalty: 45 }, marathon: { totalPenalty: 55 }, precision: { totalPenalty: 15 }, totalPenalty: 115, isEliminated: false, plac: 5 },
    { id: 'eq-3', startNumber: 3, driverName: 'C1', dressage: { penalty: 50 }, marathon: { totalPenalty: 60 }, precision: { totalPenalty: 20 }, totalPenalty: 130, isEliminated: false, plac: 8 },

    // Team 2 members (same totals for dressage, marathon, precision sum, but best individual placement is better: 2nd place vs 3rd place)
    { id: 'eq-4', startNumber: 4, driverName: 'A2', dressage: { penalty: 35 }, marathon: { totalPenalty: 60 }, precision: { totalPenalty: 5 }, totalPenalty: 100, isEliminated: false, plac: 2 },
    { id: 'eq-5', startNumber: 5, driverName: 'B2', dressage: { penalty: 50 }, marathon: { totalPenalty: 50 }, precision: { totalPenalty: 15 }, totalPenalty: 115, isEliminated: false, plac: 6 },
    { id: 'eq-6', startNumber: 6, driverName: 'C2', dressage: { penalty: 50 }, marathon: { totalPenalty: 55 }, precision: { totalPenalty: 25 }, totalPenalty: 130, isEliminated: false, plac: 9 }
  ];

  // Team 1: dressage = 135, marathon = 165, precision = 45. Total = 345. Best individual plac = 3.
  // Team 2: dressage = 135, marathon = 165, precision = 45. Total = 345. Best individual plac = 2.
  // Team 2 should rank first (rank 1) due to better best individual member placement (2 < 3).
  const sortedTeams = calculateTeamResults(teams, rows);

  assert.equal(sortedTeams[0].teamId, 'team-tied-2');
  assert.equal(sortedTeams[0].rank, 1);
  assert.equal(sortedTeams[1].teamId, 'team-tied-1');
  assert.equal(sortedTeams[1].rank, 2);
});
