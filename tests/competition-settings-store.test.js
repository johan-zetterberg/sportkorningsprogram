import test from 'node:test';
import assert from 'node:assert/strict';

import {
  activateCompetitionSettings,
  getActiveCompetitionId,
  getCompetitionSetting,
  installWindowSettingAccessors,
  onCompetitionSettingsReset,
  setCompetitionSetting
} from '../js/services/competitionSettingsStore.js';

test('settings belong to the active competition and are cleared on a switch', () => {
  activateCompetitionSettings('comp-A');
  assert.equal(setCompetitionSetting('comp-A', 'dressageJudgeMapping', { K: { C: 'j1' } }), true);
  assert.deepEqual(getCompetitionSetting('dressageJudgeMapping'), { K: { C: 'j1' } });

  // Same competition again (e.g. its document updated): kept
  activateCompetitionSettings('comp-A');
  assert.deepEqual(getCompetitionSetting('dressageJudgeMapping'), { K: { C: 'j1' } });

  // Another competition: nothing from A is visible
  activateCompetitionSettings('comp-B');
  assert.equal(getActiveCompetitionId(), 'comp-B');
  assert.equal(getCompetitionSetting('dressageJudgeMapping'), undefined);
  assert.equal(getCompetitionSetting('dressageJudgeMapping', 'comp-A'), undefined);
});

test('a late write for a competition that is no longer active is ignored', () => {
  activateCompetitionSettings('comp-B');
  const warn = console.warn; console.warn = () => {};
  try {
    // A page still loading comp-A finishes after the switch to comp-B
    assert.equal(setCompetitionSetting('comp-A', 'klassProgramMapping', { K: 'SvLA' }), false);
  } finally { console.warn = warn; }
  assert.equal(getCompetitionSetting('klassProgramMapping'), undefined);
  assert.equal(setCompetitionSetting('comp-B', 'klassProgramMapping', { K: 'SvLB' }), true);
  assert.deepEqual(getCompetitionSetting('klassProgramMapping'), { K: 'SvLB' });
});

test('window globals are accessors to the active competition and reset listeners run on a switch', () => {
  const fakeWindow = {};
  installWindowSettingAccessors(fakeWindow);
  let resetTo = null;
  onCompetitionSettingsReset((id) => { resetTo = id; });

  activateCompetitionSettings('comp-C');
  assert.equal(resetTo, 'comp-C');
  fakeWindow.klassProgramMapping = { K: 'SvMsvB' };
  assert.deepEqual(fakeWindow.klassProgramMapping, { K: 'SvMsvB' });
  assert.deepEqual(getCompetitionSetting('klassProgramMapping'), { K: 'SvMsvB' });

  activateCompetitionSettings('comp-D');
  assert.equal(fakeWindow.klassProgramMapping, undefined, 'the previous competition\'s value is gone');
  activateCompetitionSettings(null);
});
