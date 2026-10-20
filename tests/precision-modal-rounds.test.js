import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPrecisionModalRoundRows } from '../js/ui/precisionModalRounds.js';
import { precisionSettingsIssues } from '../js/ui/resultSettingsNotice.js';
import { calculatePrecisionResult } from '../js/utils/precisionCalculation.js';

const tr = (key) => key;

const CONFIG = {
  courses: {
    'MSV Enbet Häst': {
      format: 'twoPhase',
      trackLengthMeters: 600,
      tempo: 230,
      phase2: { trackLengthMeters: 300, tempo: 240 }
    },
    'Lätt B': { format: 'twoPhase', trackLengthMeters: 500, tempo: 220, phase2: { trackLengthMeters: 250, tempo: 230 }, driveOff: { scheduled: true } },
    'Enkel': { trackLengthMeters: 500, tempo: 220 }
  }
};
const eq = (className, sn = 1) => ({ startNumber: sn, className });

test('a class of one round has no modal round rows', () => {
  assert.deepEqual(buildPrecisionModalRoundRows({}, 'normal', { tr }), []);
});

test('modal rows show both phases with time, knocks, rebuilds and status', () => {
  const doc = {
    finalized: true,
    timeMs: 90000,
    knocks: [1],
    rounds: { phase2: { finalized: true, timeMs: 60000, knocks: [2, 3], rebuildCount: 1 } }
  };
  const result = calculatePrecisionResult(doc, eq('MSV Enbet Häst'), CONFIG, {});
  const rows = buildPrecisionModalRoundRows(result, 'twoPhase', { tr });
  assert.deepEqual(rows.map(r => r.round), ['phase1', 'phase2']);
  assert.equal(rows[0].label, 'precision_round_phase1');
  assert.equal(rows[0].knocks, '1');
  assert.equal(rows[1].time, '70,00 s'); // 60 s + 10 s for the rebuild
  assert.equal(rows[1].knocks, '2');
  assert.equal(rows[1].rebuilds, '1');
  assert.equal(rows[1].tone, 'ok');
});

test('a phase 2 that was not driven shows dashes', () => {
  const result = calculatePrecisionResult({ finalized: true, timeMs: 90000 }, eq('MSV Enbet Häst'), CONFIG, {});
  const rows = buildPrecisionModalRoundRows(result, 'twoPhase', { tr });
  assert.equal(rows[1].time, '–');
  assert.equal(rows[1].knocks, '–');
  assert.equal(rows[1].penalty, '–');
  assert.equal(rows[1].tone, 'none');
});

test('settings issues report a missing phase 2 length and a drive-off class without a course', () => {
  const broken = {
    courses: {
      'MSV Enbet Häst': { format: 'twoPhase', trackLengthMeters: 600, tempo: 230 },
      'Lätt B': { format: 'driveOff', tempo: 220 }
    }
  };
  const issues = precisionSettingsIssues([eq('MSV Enbet Häst'), eq('Lätt B', 2), eq('Enkel', 3)], broken);
  const msv = [...(issues.get('MSV Enbet Häst') || [])].join('|');
  assert.match(msv, /Fas 2 saknar/);
  const latt = [...(issues.get('Lätt B') || [])].join('|');
  assert.match(latt, /saknar banlängd|maxtid saknas/);
  assert.equal(issues.has('Enkel'), true); // no length: the phase-1 issue as before
});

test('complete two-phase settings give no round issues', () => {
  const issues = precisionSettingsIssues([eq('MSV Enbet Häst'), eq('Lätt B', 2)], CONFIG);
  assert.equal(issues.size, 0);
});
