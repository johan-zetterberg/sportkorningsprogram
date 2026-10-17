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

test('calculateTeamResults leaves out every result of a member eliminated in any phase (TR V 510.2)', () => {
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

  // TR V 510.2 (as FEI): an equipage eliminated in any phase counts in none,
  // so eq-1's marathon 40 and cones 5 do not count either.
  // Dressage 40 + 50 + 45 = 135, marathon 50 + 60 + 70 = 180, cones 10 + 15 + 20 = 45
  assert.equal(team.dressage, 135);
  assert.equal(team.marathon, 180);
  assert.equal(team.precision, 45);
  assert.equal(team.total, 360);
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

test('Lag-SM 2026 counts the best two results in each discipline', () => {
  const teams = [{
    id: 'team-1',
    name: 'Lag-SM lag',
    members: ['eq-1', 'eq-2', 'eq-3']
  }];
  const rows = [
    { id: 'eq-1', startNumber: 1, driverName: 'A', dressage: { penalty: 30 }, marathon: { totalPenalty: 90 }, precision: { totalPenalty: 5 } },
    { id: 'eq-2', startNumber: 2, driverName: 'B', dressage: { penalty: 40 }, marathon: { totalPenalty: 40 }, precision: { totalPenalty: 15 } },
    { id: 'eq-3', startNumber: 3, driverName: 'C', dressage: { penalty: 45 }, marathon: { totalPenalty: 50 }, precision: { totalPenalty: 2 } }
  ];

  const [team] = calculateTeamResults(teams, rows, 'lag_sm_2026');

  assert.equal(team.dressage, 70);
  assert.equal(team.marathon, 90);
  assert.equal(team.precision, 7);
  assert.equal(team.total, 167);
  assert.equal(team.isIncomplete, false);
  assert.equal(team.members.find(member => member.memberId === 'eq-1').isCountingMarathon, false);
  assert.equal(team.members.find(member => member.memberId === 'eq-2').isCountingPrecision, false);
});

test('Lag-SM 2026 gives 500 penalties for an eliminated phase result', () => {
  const teams = [{
    id: 'team-1',
    name: 'Lag med 500',
    members: ['eq-1', 'eq-2']
  }];
  const rows = [
    {
      id: 'eq-1', startNumber: 1, driverName: 'A', isEliminated: true,
      dressage: { penalty: null, eliminated: true },
      marathon: { totalPenalty: 55 },
      precision: { totalPenalty: 10 }
    },
    {
      id: 'eq-2', startNumber: 2, driverName: 'B',
      dressage: { penalty: 40 },
      marathon: { totalPenalty: 50 },
      precision: { totalPenalty: 5 }
    }
  ];

  const [team] = calculateTeamResults(teams, rows, 'lag_sm_2026');
  const eliminatedMember = team.members.find(member => member.memberId === 'eq-1');

  assert.equal(team.dressage, 540);
  assert.equal(team.marathon, 105);
  assert.equal(team.precision, 15);
  assert.equal(team.total, 660);
  assert.equal(team.isIncomplete, false);
  assert.equal(eliminatedMember.isDressageTeamPenalty, true);
  assert.equal(eliminatedMember.isCountingDressage, true);
});

test('Lag-SM 2026 requires two to three team members and ranks each phase', () => {
  const teams = [
    { id: 'invalid', name: 'For litet lag', members: ['eq-1'] },
    { id: 'first', name: 'Forsta laget', members: ['eq-1', 'eq-2'] },
    { id: 'second', name: 'Andra laget', members: ['eq-3', 'eq-4'] }
  ];
  const rows = [
    { id: 'eq-1', startNumber: 1, driverName: 'A', dressage: { penalty: 40 }, marathon: { totalPenalty: 50 }, precision: { totalPenalty: 10 } },
    { id: 'eq-2', startNumber: 2, driverName: 'B', dressage: { penalty: 60 }, marathon: { totalPenalty: 50 }, precision: { totalPenalty: 10 } },
    { id: 'eq-3', startNumber: 3, driverName: 'C', dressage: { penalty: 50 }, marathon: { totalPenalty: 60 }, precision: { totalPenalty: 10 } },
    { id: 'eq-4', startNumber: 4, driverName: 'D', dressage: { penalty: 60 }, marathon: { totalPenalty: 60 }, precision: { totalPenalty: 10 } }
  ];

  const results = calculateTeamResults(teams, rows, 'lag_sm_2026');
  const invalid = results.find(team => team.teamId === 'invalid');
  const first = results.find(team => team.teamId === 'first');
  const second = results.find(team => team.teamId === 'second');

  assert.equal(invalid.isInvalid, true);
  assert.equal(invalid.total, null);
  assert.equal(first.rank, 1);
  assert.equal(second.rank, 2);
  assert.equal(first.disciplineRanks.dressage, 1);
  assert.equal(second.disciplineRanks.dressage, 2);
});

test('Lag-SM 2026 tie-breakers use marathon, dressage, then lowest individual dressage penalty', () => {
  const marathonTeams = [
    { id: 'marathon-first', name: 'Marathon fore dressyr', members: ['eq-1', 'eq-2'] },
    { id: 'dressage-first', name: 'Bast dressyr men samre maraton', members: ['eq-3', 'eq-4'] }
  ];
  const marathonRows = [
    { id: 'eq-1', startNumber: 1, driverName: 'A', dressage: { penalty: 40 }, marathon: { totalPenalty: 50 }, precision: { totalPenalty: 10 } },
    { id: 'eq-2', startNumber: 2, driverName: 'B', dressage: { penalty: 60 }, marathon: { totalPenalty: 50 }, precision: { totalPenalty: 10 } },
    { id: 'eq-3', startNumber: 3, driverName: 'C', dressage: { penalty: 30 }, marathon: { totalPenalty: 55 }, precision: { totalPenalty: 10 } },
    { id: 'eq-4', startNumber: 4, driverName: 'D', dressage: { penalty: 60 }, marathon: { totalPenalty: 55 }, precision: { totalPenalty: 10 } }
  ];

  const marathonRanked = calculateTeamResults(marathonTeams, marathonRows, 'lag_sm_2026');
  assert.equal(marathonRanked[0].teamId, 'marathon-first');

  const dressageTeams = [
    { id: 'higher-individual', name: 'Hogre individuell dressyr', members: ['eq-1', 'eq-2'] },
    { id: 'lower-individual', name: 'Lagst individuell dressyr', members: ['eq-3', 'eq-4'] }
  ];
  const dressageRows = [
    { id: 'eq-1', startNumber: 1, driverName: 'A', dressage: { penalty: 40 }, marathon: { totalPenalty: 50 }, precision: { totalPenalty: 10 } },
    { id: 'eq-2', startNumber: 2, driverName: 'B', dressage: { penalty: 60 }, marathon: { totalPenalty: 50 }, precision: { totalPenalty: 10 } },
    { id: 'eq-3', startNumber: 3, driverName: 'C', dressage: { penalty: 30 }, marathon: { totalPenalty: 50 }, precision: { totalPenalty: 10 } },
    { id: 'eq-4', startNumber: 4, driverName: 'D', dressage: { penalty: 70 }, marathon: { totalPenalty: 50 }, precision: { totalPenalty: 10 } }
  ];

  const dressageRanked = calculateTeamResults(dressageTeams, dressageRows, 'lag_sm_2026');
  assert.equal(dressageRanked[0].teamId, 'lower-individual');
});

test('Lag-SM 2026 keeps equal teams on the same rank when the stated tie-breakers are equal', () => {
  const teams = [
    { id: 'team-a', name: 'Alfa', members: ['eq-1', 'eq-2'] },
    { id: 'team-b', name: 'Beta', members: ['eq-3', 'eq-4'] }
  ];
  const rows = [
    { id: 'eq-1', startNumber: 1, driverName: 'A', dressage: { penalty: 40 }, marathon: { totalPenalty: 50 }, precision: { totalPenalty: 10 } },
    { id: 'eq-2', startNumber: 2, driverName: 'B', dressage: { penalty: 60 }, marathon: { totalPenalty: 50 }, precision: { totalPenalty: 10 } },
    { id: 'eq-3', startNumber: 3, driverName: 'C', dressage: { penalty: 40 }, marathon: { totalPenalty: 50 }, precision: { totalPenalty: 10 } },
    { id: 'eq-4', startNumber: 4, driverName: 'D', dressage: { penalty: 60 }, marathon: { totalPenalty: 50 }, precision: { totalPenalty: 10 } }
  ];

  const results = calculateTeamResults(teams, rows, 'lag_sm_2026');

  assert.equal(results[0].rank, 1);
  assert.equal(results[1].rank, 1);
});

test('FEI Championship / CAIO counts the best two fully completed members in each discipline', () => {
  const teams = [{ id: 'fei-standard', name: 'Sweden', members: ['eq-1', 'eq-2', 'eq-3'] }];
  const rows = [
    { id: 'eq-1', startNumber: 1, driverName: 'A', country: 'SWE', dressage: { penalty: 30 }, marathon: { totalPenalty: 60 }, precision: { totalPenalty: 10 } },
    { id: 'eq-2', startNumber: 2, driverName: 'B', country: 'SE', dressage: { penalty: 40 }, marathon: { totalPenalty: 40 }, precision: { totalPenalty: 9 } },
    { id: 'eq-3', startNumber: 3, driverName: 'C', country: 'Sweden', dressage: { penalty: 50 }, marathon: { totalPenalty: 50 }, precision: { totalPenalty: 8 } }
  ];

  const [team] = calculateTeamResults(teams, rows, 'fei_championship_caio');

  assert.equal(team.isIncomplete, false);
  assert.equal(team.isInvalid, false);
  assert.equal(team.dressage, 70);
  assert.equal(team.marathon, 90);
  assert.equal(team.precision, 17);
  assert.equal(team.total, 177);
  assert.equal(team.members.find(member => member.memberId === 'eq-1').isCountingMarathon, false);
});

test('FEI live: the dressage standing stays when the first marathon results come in', () => {
  const teams = [
    { id: 'swe', name: 'Sweden', members: ['eq-1', 'eq-2', 'eq-3'] },
    { id: 'nor', name: 'Norway', members: ['eq-4', 'eq-5', 'eq-6'] }
  ];
  const rows = [
    { id: 'eq-1', startNumber: 1, driverName: 'A', country: 'SWE', dressage: { penalty: 30 }, marathon: { totalPenalty: 60 } },
    { id: 'eq-2', startNumber: 2, driverName: 'B', country: 'SWE', dressage: { penalty: 40 } },
    { id: 'eq-3', startNumber: 3, driverName: 'C', country: 'SWE', dressage: { penalty: 50 } },
    { id: 'eq-4', startNumber: 4, driverName: 'D', country: 'NOR', dressage: { penalty: 35 } },
    { id: 'eq-5', startNumber: 5, driverName: 'E', country: 'NOR', dressage: { penalty: 45 } },
    { id: 'eq-6', startNumber: 6, driverName: 'F', country: 'NOR', dressage: { penalty: 55 } }
  ];

  const results = calculateTeamResults(teams, rows, 'fei_championship_caio');
  const swe = results.find(team => team.teamId === 'swe');
  const nor = results.find(team => team.teamId === 'nor');

  // One marathon result anywhere used to empty every team's dressage score
  assert.equal(swe.dressage, 70);
  assert.equal(nor.dressage, 80);
  assert.equal(swe.marathon, null);
  assert.equal(swe.preliminary?.after, 'dressage');
  assert.equal(swe.preliminary?.rank, 1);
  assert.equal(nor.preliminary?.rank, 2);
});

test('FEI Championship / CAIO does not replace an eliminated member with a 500 penalty', () => {
  const teams = [{ id: 'fei-standard', name: 'Sweden', members: ['eq-1', 'eq-2', 'eq-3'] }];
  const rows = [
    { id: 'eq-1', startNumber: 1, driverName: 'A', country: 'SWE', dressage: { penalty: 30 }, marathon: { totalPenalty: 50 }, precision: { totalPenalty: 10 } },
    { id: 'eq-2', startNumber: 2, driverName: 'B', country: 'SWE', dressage: { penalty: 40 }, marathon: { totalPenalty: 40 }, precision: { totalPenalty: 9 } },
    {
      id: 'eq-3', startNumber: 3, driverName: 'C', country: 'SWE', isEliminated: true,
      dressage: { penalty: 5 }, marathon: { totalPenalty: 5 }, precision: { totalPenalty: Infinity, eliminated: true }
    }
  ];

  const [team] = calculateTeamResults(teams, rows, 'fei_championship_caio');
  const eliminatedMember = team.members.find(member => member.memberId === 'eq-3');

  assert.equal(team.total, 179);
  assert.equal(team.dressage, 70);
  assert.equal(eliminatedMember.eliminated, true);
  assert.equal(eliminatedMember.isCounting, false);
  assert.equal(eliminatedMember.penalty, null);
});

test('FEI Championship / CAIO breaks a tied total by marathon before dressage', () => {
  const teams = [
    { id: 'marathon-first', name: 'Sweden', members: ['se-1', 'se-2'] },
    { id: 'dressage-first', name: 'Denmark', members: ['dk-1', 'dk-2'] }
  ];
  const rows = [
    { id: 'se-1', startNumber: 1, driverName: 'SE A', country: 'SWE', dressage: { penalty: 50 }, marathon: { totalPenalty: 40 }, precision: { totalPenalty: 10 } },
    { id: 'se-2', startNumber: 2, driverName: 'SE B', country: 'SWE', dressage: { penalty: 50 }, marathon: { totalPenalty: 40 }, precision: { totalPenalty: 10 } },
    { id: 'dk-1', startNumber: 3, driverName: 'DK A', country: 'DEN', dressage: { penalty: 45 }, marathon: { totalPenalty: 45 }, precision: { totalPenalty: 10 } },
    { id: 'dk-2', startNumber: 4, driverName: 'DK B', country: 'DEN', dressage: { penalty: 45 }, marathon: { totalPenalty: 45 }, precision: { totalPenalty: 10 } }
  ];

  const results = calculateTeamResults(teams, rows, 'fei_championship_caio');

  assert.equal(results[0].teamId, 'marathon-first');
  assert.equal(results[0].rank, 1);
  assert.equal(results[1].rank, 2);
});

test('FEI Pony Championship requires and counts one completed member from each driving category', () => {
  const teams = [
    { id: 'pony-valid', name: 'Sweden', members: ['single', 'pair', 'four'] },
    { id: 'pony-invalid', name: 'Denmark', members: ['single-a', 'single-b', 'pair-a'] }
  ];
  const rows = [
    { id: 'single', startNumber: 1, driverName: 'Single', country: 'SWE', className: 'FEI 3* Enbet Ponny', dressage: { penalty: 35 }, marathon: { totalPenalty: 50 }, precision: { totalPenalty: 9 } },
    { id: 'pair', startNumber: 2, driverName: 'Pair', country: 'SWE', className: 'FEI 3* Par Ponny', dressage: { penalty: 40 }, marathon: { totalPenalty: 45 }, precision: { totalPenalty: 8 } },
    { id: 'four', startNumber: 3, driverName: 'Four', country: 'SWE', className: 'FEI 3* Fyrspann Ponny', dressage: { penalty: 30 }, marathon: { totalPenalty: 60 }, precision: { totalPenalty: 10 } },
    { id: 'single-a', startNumber: 4, driverName: 'Single A', country: 'DEN', className: 'FEI 3* Enbet Ponny', dressage: { penalty: 30 }, marathon: { totalPenalty: 40 }, precision: { totalPenalty: 8 } },
    { id: 'single-b', startNumber: 5, driverName: 'Single B', country: 'DEN', className: 'FEI 3* Enbet Ponny', dressage: { penalty: 35 }, marathon: { totalPenalty: 45 }, precision: { totalPenalty: 9 } },
    { id: 'pair-a', startNumber: 6, driverName: 'Pair A', country: 'DEN', className: 'FEI 3* Par Ponny', dressage: { penalty: 40 }, marathon: { totalPenalty: 50 }, precision: { totalPenalty: 10 } }
  ];

  const results = calculateTeamResults(teams, rows, 'fei_pony_championship');
  const valid = results.find(team => team.teamId === 'pony-valid');
  const invalid = results.find(team => team.teamId === 'pony-invalid');

  assert.equal(valid.total, 287);
  assert.equal(valid.members.every(member => member.isCounting), true);
  assert.equal(invalid.isInvalid, true);
  assert.match(invalid.validationIssues.join(' '), /fyrspann/);
});

test('FEI Youth Championship validates each age category and uses its best completed member', () => {
  const teams = [{ id: 'youth', name: 'Sweden', members: ['child', 'junior', 'u25'] }];
  const rows = [
    { id: 'child', startNumber: 1, driverName: 'Child', country: 'SWE', className: 'FEI Children 1*', dressage: { penalty: 30 }, marathon: { totalPenalty: 50 }, precision: { totalPenalty: 8 } },
    { id: 'junior', startNumber: 2, driverName: 'Junior', country: 'SWE', className: 'FEI Junior 2*', dressage: { penalty: 40 }, marathon: { totalPenalty: 45 }, precision: { totalPenalty: 9 } },
    { id: 'u25', startNumber: 3, driverName: 'U25', country: 'SWE', className: 'FEI U25 3*', dressage: { penalty: 50 }, marathon: { totalPenalty: 55 }, precision: { totalPenalty: 10 } }
  ];

  const [team] = calculateTeamResults(teams, rows, 'fei_youth_championship');

  assert.equal(team.isInvalid, false);
  assert.equal(team.dressage, 120);
  assert.equal(team.marathon, 150);
  assert.equal(team.precision, 27);
  assert.equal(team.total, 297);
});

test('FEI Para Driving Championship requires Grade I and no more than two members in one grade', () => {
  const teams = [
    { id: 'para-valid', name: 'Sweden', members: ['grade-1', 'grade-2'] },
    { id: 'para-invalid', name: 'Denmark', members: ['grade-2a', 'grade-2b', 'grade-2c'] }
  ];
  const rows = [
    { id: 'grade-1', startNumber: 1, driverName: 'Grade I', country: 'SWE', paraGrade: '1', dressage: { penalty: 30 }, marathon: { totalPenalty: 50 }, precision: { totalPenalty: 8 } },
    { id: 'grade-2', startNumber: 2, driverName: 'Grade II', country: 'SWE', paraGrade: '2', dressage: { penalty: 40 }, marathon: { totalPenalty: 45 }, precision: { totalPenalty: 9 } },
    { id: 'grade-2a', startNumber: 3, driverName: 'Grade II A', country: 'DEN', paraGrade: '2', dressage: { penalty: 30 }, marathon: { totalPenalty: 40 }, precision: { totalPenalty: 8 } },
    { id: 'grade-2b', startNumber: 4, driverName: 'Grade II B', country: 'DEN', paraGrade: '2', dressage: { penalty: 35 }, marathon: { totalPenalty: 45 }, precision: { totalPenalty: 9 } },
    { id: 'grade-2c', startNumber: 5, driverName: 'Grade II C', country: 'DEN', paraGrade: '2', dressage: { penalty: 40 }, marathon: { totalPenalty: 50 }, precision: { totalPenalty: 10 } }
  ];

  const results = calculateTeamResults(teams, rows, 'fei_para_championship');
  const valid = results.find(team => team.teamId === 'para-valid');
  const invalid = results.find(team => team.teamId === 'para-invalid');

  assert.equal(valid.total, 182);
  assert.equal(invalid.isInvalid, true);
  assert.match(invalid.validationIssues.join(' '), /Grade I/);
  assert.match(invalid.validationIssues.join(' '), /Högst 2 deltagare/);
});

test('FEI Championship / CAIO calculates live dressage score and preliminary standing while marathon and precision are unstarted', () => {
  const teams = [
    { id: 'swe', name: 'Sweden', members: ['se-1', 'se-2', 'se-3'] },
    { id: 'den', name: 'Denmark', members: ['dk-1', 'dk-2'] }
  ];
  const rows = [
    { id: 'se-1', startNumber: 1, driverName: 'SE A', country: 'SWE', dressage: { penalty: 30 }, marathon: {}, precision: {} },
    { id: 'se-2', startNumber: 2, driverName: 'SE B', country: 'SWE', dressage: { penalty: 40 }, marathon: {}, precision: {} },
    { id: 'se-3', startNumber: 3, driverName: 'SE C', country: 'SWE', dressage: { penalty: 50 }, marathon: {}, precision: {} },
    { id: 'dk-1', startNumber: 4, driverName: 'DK A', country: 'DEN', dressage: { penalty: 38 }, marathon: {}, precision: {} },
    { id: 'dk-2', startNumber: 5, driverName: 'DK B', country: 'DEN', dressage: { penalty: 42 }, marathon: {}, precision: {} }
  ];

  const results = calculateTeamResults(teams, rows, 'fei_championship_caio');
  assert.equal(results[0].teamId, 'swe');
  assert.equal(results[0].dressage, 70);
  assert.equal(results[0].marathon, null);
  assert.equal(results[0].total, null);
  assert.deepEqual(results[0].preliminary, { rank: 1, score: 70, after: 'dressage' });
  assert.equal(results[1].teamId, 'den');
  assert.equal(results[1].dressage, 80);
  assert.deepEqual(results[1].preliminary, { rank: 2, score: 80, after: 'dressage' });
});
