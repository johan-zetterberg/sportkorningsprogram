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
