import test from 'node:test';
import assert from 'node:assert/strict';
import { precisionSettingsIssues } from '../js/ui/resultSettingsNotice.js';

test('an arena class is not flagged for a missing max time (no length or tempo)', () => {
  const equipages = [
    { className: 'Arena', status: 'anmäld' },
    { className: 'Normal', status: 'anmäld' }
  ];
  const config = { courses: { Arena: { format: 'arena', arena: { rules: 'FEI', obstacles: [{ label: '1', type: 'cone' }] } } } };
  const issues = precisionSettingsIssues(equipages, config);
  assert.equal(issues.has('Arena'), false);
  assert.equal(issues.has('Normal'), true);
});
