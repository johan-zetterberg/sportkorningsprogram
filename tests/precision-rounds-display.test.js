import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bannerStartNumbersLabel,
  buildPrecisionBannerItems,
  currentPrecisionRound,
  formatPrecisionPlace,
  formatPrecisionRoundCell,
  formatPrecisionSeconds,
  latestPrecisionRoundWithData,
  precisionCourseWarnings,
  precisionPlacingScore,
  precisionRoundCellPlain,
  precisionRoundColumns,
  precisionRoundLabel,
  precisionRoundSettingsIssues,
  precisionTierSeparatorKey,
  precisionTierSeparators,
  runningPrecisionRound
} from '../js/pages/precision/precisionRoundsDisplay.js';
import { renderPrecisionBanners } from '../js/pages/precision/precisionResultBanners.js';
import { renderPrecisionResultDesktopRow } from '../js/pages/precision/precisionResultDesktopRow.js';
import { renderPrecisionResultCard } from '../js/pages/precision/precisionResultMobileCard.js';
import { renderPrecisionTableHead } from '../js/pages/precision/precisionResultTable.js';
import { applyPrecisionLiveDocChanges } from '../js/pages/precision/precisionResultListeners.js';
import { buildPrecisionLiveTick } from '../js/pages/precision/precisionResultLive.js';
import { calculatePrecisionResult } from '../js/utils/precisionCalculation.js';

// Identity translation: keys come back as they are
const tr = (key) => key;

const TR_CONFIG = {
  courses: {
    'MSV Enbet Häst': {
      format: 'twoPhase',
      trackLengthMeters: 600,
      tempo: 230,
      obstacleLabels: ['1', '2'],
      phase2: { trackLengthMeters: 300, tempo: 240, obstacleLabels: ['1', '2'] }
    }
  }
};
const FEI_CONFIG = {
  courses: {
    'CAI2* Singles Horse': {
      format: 'twoPhase',
      trackLengthMeters: 650,
      tempo: 250,
      obstacleLabels: ['1'],
      phase2: { trackLengthMeters: 300, tempo: 250, obstacleLabels: ['1'] }
    }
  }
};
const TR_EQ = { startNumber: 1, className: 'MSV Enbet Häst' };
const FEI_EQ = { startNumber: 2, className: 'CAI2* Singles Horse' };

test('round columns follow the class format', () => {
  assert.deepEqual(precisionRoundColumns('normal').map(c => c.round), ['phase1']);
  assert.deepEqual(precisionRoundColumns('twoPhase').map(c => c.round), ['phase1', 'phase2']);
  assert.deepEqual(precisionRoundColumns('twoPhase', { driveOffScheduled: true }).map(c => c.round), ['phase1', 'phase2', 'driveOff']);
  assert.deepEqual(precisionRoundColumns('driveOff').map(c => c.round), ['phase1']);
  assert.deepEqual(precisionRoundColumns('driveOff', { driveOffScheduled: true }).map(c => c.labelKey), ['precision_round_initial', 'precision_round_driveoff']);
});

test('round labels are Swedish by default', () => {
  assert.equal(precisionRoundLabel('phase2', 'twoPhase'), 'Fas 2');
  assert.equal(precisionRoundLabel('phase1', 'driveOff'), 'Grundomgång');
  assert.equal(precisionRoundLabel('phase1', 'twoPhase'), 'Fas 1');
  assert.equal(precisionRoundLabel('driveOff', 'driveOff'), 'Omkörning');
});

test('the running and the followed round come from the doc', () => {
  assert.equal(runningPrecisionRound({ running: true }), 'phase1');
  assert.equal(runningPrecisionRound({ running: false, rounds: { phase2: { running: true } } }), 'phase2');
  assert.equal(runningPrecisionRound({ rounds: { driveOff: { running: true } } }), 'driveOff');
  assert.equal(runningPrecisionRound({ rounds: { phase2: { running: false } } }), null);
  assert.equal(currentPrecisionRound({ activeRound: 'phase2', rounds: { phase2: { running: false } } }), 'phase2');
  assert.equal(currentPrecisionRound({ activeRound: 'phase1' }), 'phase1');
  assert.equal(currentPrecisionRound({ running: true, activeRound: 'phase2' }), 'phase1');
});

test('a time-scored round is shown as seconds, a fault round as penalties and time', () => {
  const fei = calculatePrecisionResult({ finalized: true, timeMs: 150000, knocks: [], rounds: { phase2: { timeMs: 62000, knocks: ['3'], finalized: true } } }, FEI_EQ, FEI_CONFIG, {});
  const feiCell = formatPrecisionRoundCell(fei.rounds.phase2, { tr });
  assert.equal(feiCell.text, '65,00 s');
  assert.equal(feiCell.sub, '3,00 s precision_round_penalty_word');
  assert.equal(feiCell.tone, 'ok');

  const trRes = calculatePrecisionResult({ finalized: true, timeMs: 150000, knocks: [], rounds: { phase2: { timeMs: 70000, knocks: ['3'], finalized: true } } }, TR_EQ, TR_CONFIG, {});
  const trCell = formatPrecisionRoundCell(trRes.rounds.phase2, { tr });
  assert.equal(trCell.text, '3.00 p');
  assert.equal(trCell.sub, '70,00 s');
  assert.equal(precisionRoundCellPlain(trCell), '3.00 p 70,00 s');
});

test('round cells for live, eliminated, retired, missing and absent rounds', () => {
  assert.deepEqual(formatPrecisionRoundCell(null, { tr }), { text: '–', sub: '', tone: 'none', title: '' });
  assert.equal(formatPrecisionRoundCell({ live: true, scoring: 'time', totalPenalty: 3 }, { tr }).text, 'precision_round_live');
  assert.equal(formatPrecisionRoundCell({ live: true, scoring: 'time', totalPenalty: 3 }, { tr }).sub, '3,00 s');
  assert.equal(formatPrecisionRoundCell({ out: true, eliminated: true }, { tr }).text, 'ELIM');
  assert.equal(formatPrecisionRoundCell({ out: true, eliminated: false, retired: true }, { tr }).text, 'precision_round_retired');
  const missing = formatPrecisionRoundCell({ configMissing: true, hasData: true }, { tr });
  assert.equal(missing.tone, 'warn');
  assert.equal(missing.title, 'precision_round_config_missing');
  assert.equal(formatPrecisionRoundCell({ hasData: false, totalPenalty: null }, { tr }).text, '–');
});

test('provisional places are written in brackets', () => {
  assert.equal(formatPrecisionPlace(1, true), '(1)');
  assert.equal(formatPrecisionPlace(2, false), '2');
  assert.equal(formatPrecisionPlace(null), '–');
  assert.equal(formatPrecisionSeconds(65), '65,00 s');
});

test('tier separators are keyed by the placing tier and the format', () => {
  assert.equal(precisionTierSeparatorKey(2, 'twoPhase'), 'precision_tier_phase2');
  assert.equal(precisionTierSeparatorKey(3, 'twoPhase'), 'precision_tier_phase2_out');
  assert.equal(precisionTierSeparatorKey(4, 'twoPhase'), 'precision_tier_phase1_only');
  assert.equal(precisionTierSeparatorKey(0, 'driveOff'), 'precision_tier_driveoff');
  assert.equal(precisionTierSeparatorKey(4, 'driveOff'), 'precision_tier_initial');
  assert.equal(precisionTierSeparatorKey(4, 'normal'), null);
  assert.equal(precisionTierSeparatorKey(null, 'twoPhase'), null);

  const items = [{ sn: 1, tier: 2 }, { sn: 2, tier: 2 }, { sn: 3, tier: 4 }, { sn: 4, tier: 4 }, { sn: 5, tier: null }];
  const result = precisionTierSeparators(items, { tierOf: (i) => i.tier, formatOf: () => 'twoPhase' });
  assert.deepEqual(result.map(r => r.separatorKey), ['precision_tier_phase2', null, 'precision_tier_phase1_only', null, null]);
  // A class of one round gets no separators
  const plain = precisionTierSeparators(items, { tierOf: (i) => i.tier, formatOf: () => 'normal' });
  assert.ok(plain.every(r => r.separatorKey === null));
});

test('banner items: pending drive-off first, warnings once per class and code', () => {
  const items = buildPrecisionBannerItems([
    { label: 'FEI A', startNumber: 1, ctx: { driveOffPending: true, warnings: [] }, formatWarnings: [] },
    { label: 'FEI A', startNumber: 2, ctx: { driveOffPending: true, warnings: [{ startNumber: '3', code: 'driveOffIgnored' }] }, formatWarnings: ['trDriveOffVariant'] },
    { label: 'TR B', startNumber: 12, ctx: null, formatWarnings: ['phase2Ignored', 'phase2ConfigMissing'] },
    { label: 'TR B', startNumber: 10, ctx: null, formatWarnings: ['phase2Ignored'] }
  ], { tr });
  assert.deepEqual(items.map(i => `${i.kind}:${i.label}:${i.code}`), [
    'pending:FEI A:driveOffPending',
    'warning:FEI A:trDriveOffVariant',
    'warning:FEI A:driveOffIgnored',
    'warning:TR B:phase2Ignored',
    'warning:TR B:phase2ConfigMissing'
  ]);
  const ignored = items.find(i => i.code === 'phase2Ignored');
  assert.deepEqual(ignored.startNumbers, ['10', '12']);
  assert.equal(bannerStartNumbersLabel(ignored), ' (#10, #12)');
  // Class-wide codes carry no start numbers
  assert.deepEqual(items.find(i => i.code === 'trDriveOffVariant').startNumbers, []);
  assert.deepEqual(buildPrecisionBannerItems([{ label: 'X', ctx: null, formatWarnings: [] }]), []);
});

test('banners render the provisional note and escape class names', () => {
  const html = renderPrecisionBanners(buildPrecisionBannerItems([
    { label: 'A <b>', startNumber: 1, ctx: { driveOffPending: true, warnings: [] }, formatWarnings: ['phase2ConfigMissing'] }
  ]));
  assert.match(html, /Preliminär – omkörning återstår/);
  assert.match(html, /A &lt;b&gt;/);
  assert.doesNotMatch(html, /<b>/);
  assert.match(html, /Fas 2 saknar banlängd eller tempo/);
  assert.equal(renderPrecisionBanners([]), '');
});

test('placing score shows the phase-2 score for a class placed on phase 2', () => {
  const fei = calculatePrecisionResult({ finalized: true, timeMs: 150000, knocks: [], rounds: { phase2: { timeMs: 62000, knocks: ['3'], finalized: true } } }, FEI_EQ, FEI_CONFIG, {});
  assert.deepEqual(precisionPlacingScore(fei), { text: '65,00 s', round: 'phase2', timeMs: 62000 });
  const phase1Only = calculatePrecisionResult({ finalized: true, timeMs: 150000, knocks: ['1'] }, TR_EQ, TR_CONFIG, {});
  assert.equal(precisionPlacingScore(phase1Only).round, 'phase1');
  assert.equal(latestPrecisionRoundWithData(fei), 'phase2');
  assert.equal(latestPrecisionRoundWithData(phase1Only), 'phase1');
});

test('course warnings: TR and FEI obstacle counts, short drive-off course', () => {
  assert.deepEqual(precisionCourseWarnings({ profile: 'TR', format: 'twoPhase', phase1Count: 16, phase2Count: 8 }), []);
  assert.deepEqual(precisionCourseWarnings({ profile: 'TR', format: 'twoPhase', phase1Count: 16, phase2Count: 10 }).map(w => w.n), [26]);
  assert.deepEqual(precisionCourseWarnings({ profile: 'TR', format: 'twoPhase', phase1Count: 17, phase2Count: 7 }).map(w => w.code), ['phase1', 'phase2']);
  assert.deepEqual(precisionCourseWarnings({ profile: 'TR', format: 'twoPhase', phase1Count: 15, phase2Count: 10 }).map(w => w.code), ['total']);
  assert.deepEqual(precisionCourseWarnings({ profile: 'TR', format: 'twoPhase', phase1Count: 14, phase2Count: 10 }), []);
  assert.deepEqual(precisionCourseWarnings({ profile: 'FEI', format: 'twoPhase', phase1Count: 14, phase2Count: 9 }), []);
  assert.deepEqual(precisionCourseWarnings({ profile: 'FEI', format: 'twoPhase', phase1Count: 13, phase2Count: 10 }).map(w => w.code), ['phase1', 'phase2']);
  assert.deepEqual(precisionCourseWarnings({ profile: 'FEI', format: 'twoPhase', phase1Count: 16, phase2Count: 8 }).map(w => w.code), ['total']);
  // Nothing entered yet: no warning
  assert.deepEqual(precisionCourseWarnings({ profile: 'TR', format: 'twoPhase' }), []);
  // The drive-off course: at most 50 % shorter
  assert.deepEqual(precisionCourseWarnings({ profile: 'FEI', format: 'driveOff', trackLength: 600, driveOffLength: 300 }), []);
  assert.deepEqual(precisionCourseWarnings({ profile: 'FEI', format: 'driveOff', trackLength: 600, driveOffLength: 299 }).map(w => w.code), ['driveOffShort']);
  assert.deepEqual(precisionCourseWarnings({ profile: 'FEI', format: 'normal', trackLength: 600, driveOffLength: 100 }), []);
  // Phase counts are not checked for a format without phases
  assert.deepEqual(precisionCourseWarnings({ profile: 'TR', format: 'driveOff', phase1Count: 30 }), []);
});

test('settings issues name classes whose phase 2 or drive-off has no max time', () => {
  const lb = { startNumber: 5, className: 'Lätt B Enbet Häst' };
  const noPhase2Tempo = { courses: { 'Lätt B Enbet Häst': { format: 'twoPhase', trackLengthMeters: 500, tempo: 180, phase2: { trackLengthMeters: 250 } } } };
  const issues = precisionRoundSettingsIssues([lb], noPhase2Tempo, { tr });
  assert.deepEqual([...issues.get('Lätt B Enbet Häst')], ['precision_warn_phase2configmissing']);
  const withTempo = { courses: { 'Lätt B Enbet Häst': { format: 'twoPhase', trackLengthMeters: 500, tempo: 180, phase2: { trackLengthMeters: 250, tempo: 190 } } } };
  assert.equal(precisionRoundSettingsIssues([lb], withTempo, { tr }).size, 0);
  assert.equal(precisionRoundSettingsIssues([TR_EQ], { courses: {} }, { tr }).size, 0);
  const driveOffCls = { startNumber: 6, className: 'CAI2* Singles Horse' };
  const driveOffNoLength = { courses: { 'CAI2* Singles Horse': { format: 'driveOff', tempo: 250 } } };
  assert.deepEqual([...precisionRoundSettingsIssues([driveOffCls], driveOffNoLength, { tr }).get('CAI2* Singles Horse')], ['precision_warn_driveoffconfigmissing']);
  assert.equal(precisionRoundSettingsIssues([{ ...driveOffCls, status: 'struken' }], driveOffNoLength, { tr }).size, 0);
});

test('desktop row shows round cells, a provisional place and stays live in phase 2', () => {
  const data = {
    eq: { startNumber: 7, driverName: 'Eva', className: 'MSV Enbet Häst' },
    d: {},
    display: { timeLabel: '02:30,00', knocksSimple: '–' },
    place: 1,
    status: 'Klar',
    liveRound: 'phase2',
    totalPenalty: 0
  };
  const html = renderPrecisionResultDesktopRow({
    data,
    placeLabel: '(1)',
    roundCells: [{ round: 'phase2', cell: { text: '3.00 p', sub: '70,00 s', tone: 'ok', title: '' } }]
  });
  assert.match(html, />\(1\)</);
  assert.match(html, /data-round="phase2"/);
  assert.match(html, /3\.00 p/);
  assert.match(html, /70,00 s/);
  assert.match(html, /bg-yellow-50/);
});

test('mobile card shows round tiles', () => {
  const html = renderPrecisionResultCard({
    data: { eq: { startNumber: 7, driverName: 'Eva', className: 'A' }, d: {}, display: { timeLabel: '01:00,00' }, place: 2, status: 'Klar', totalPenalty: 0 },
    placeLabel: '(2)',
    roundCells: [{ round: 'driveOff', label: 'Omkörning', cell: { text: 'ELIM', sub: '', tone: 'elim', title: '' } }]
  });
  assert.match(html, /\(2\)/);
  assert.match(html, /Omkörning/);
  assert.match(html, /ELIM/);
});

test('table head adds the round columns after the total', () => {
  const html = renderPrecisionTableHead({
    rank: 'Plac', driver: 'Kusk', className: 'Klass', countryClub: 'Klubb', startTime: 'Start', obstacleWidth: 'Bredd', time: 'Tid',
    knockdowns: 'Riv', obsPenalty: 'Hinder', timePenalty: 'Tidsfel', otherPenaltyShort: 'Övr', total: 'Totalt', overallStanding: 'Tot', status: 'Status', finalColumn: 'Final',
    roundHeads: [{ round: 'phase2', label: 'Fas 2' }, { round: 'driveOff', label: 'Omkörning' }]
  });
  const totalAt = html.indexOf('Totalt');
  assert.ok(totalAt > 0);
  assert.ok(html.indexOf('Fas 2') > totalAt);
  assert.ok(html.indexOf('Omkörning') > html.indexOf('Fas 2'));
  assert.ok(html.indexOf('Omkörning') < html.indexOf('Tot '));
});

test('live listener re-renders when phase 2 starts, changes or stops and keeps the ticker', () => {
  const map = new Map([['1', { finalized: true }]]);
  const change = (data, type = 'modified') => [{ type, doc: { id: '1', data: () => data } }];

  const started = applyPrecisionLiveDocChanges(change({ finalized: true, activeRound: 'phase2', rounds: { phase2: { running: true, liveStartEpoch: 5 } } }), map);
  assert.equal(started.needsFullRender, true);
  assert.equal(started.anyRunning, true);

  // A change that does not touch the rounds does not re-render
  const same = applyPrecisionLiveDocChanges(change({ finalized: true, activeRound: 'phase2', rounds: { phase2: { running: true, liveStartEpoch: 5 } } }), map);
  assert.equal(same.needsFullRender, false);

  const knock = applyPrecisionLiveDocChanges(change({ finalized: true, activeRound: 'phase2', rounds: { phase2: { running: true, liveStartEpoch: 5, knocks: ['3'] } } }), map);
  assert.equal(knock.needsFullRender, true);

  const stopped = applyPrecisionLiveDocChanges(change({ finalized: true, activeRound: 'phase2', rounds: { phase2: { running: false, timeMs: 60000 } } }), map);
  assert.equal(stopped.needsFullRender, true);
  assert.equal(stopped.anyRunning, false);
});

test('the live tick of a running phase 2 uses the round clock, max time and score', () => {
  const data = {
    finalized: true,
    timeMs: 150000,
    knocks: [],
    activeRound: 'phase2',
    rounds: { phase2: { running: true, inProgress: true, liveStartEpoch: 1000, livePausedMs: 0, knocks: ['3'] } }
  };
  const tick = buildPrecisionLiveTick(data, {
    now: 81000,
    equipage: TR_EQ,
    config: TR_CONFIG,
    allEquipages: [TR_EQ],
    precisionMap: new Map()
  });
  // 80 s on a phase 2 of 300 m at 240 m/min (max 75 s): 5 s over = 2.5 p, plus one knock
  assert.equal(tick.round, 'phase2');
  assert.equal(tick.scoring, 'fault');
  assert.equal(tick.elapsedMs, 80000);
  assert.equal(tick.overTime, true);
  assert.equal(tick.penalty.timePenalty, 2.5);
  assert.equal(tick.penalty.totalPenalty, 5.5);
});
