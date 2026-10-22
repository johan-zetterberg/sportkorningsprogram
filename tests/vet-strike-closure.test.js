import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VET_CLOSURE_TEXTS,
  buildIncidentClosureUpdate,
  closureForNewIncident,
  closureFromEquipageChange
} from '../functions/src/vetStrikeClosure.js';
import { buildVetDecisionDriverMessage, vetDecisionNoticeKey } from '../functions/src/vetDecisionNotify.js';

const pending = { phase: 'harness', at: '2026-10-22T08:00:00Z', by: 'vet1', horseKeys: [], incidentId: 'inc1' };
const decision = (outcome) => ({ outcome, phase: 'harness', at: '2026-10-22T09:00:00Z', by: 'td1', byName: 'TD Tina', incidentId: 'inc1' });
const openIncident = { type: 'vet', status: 'open', startNumber: '12', vetStrike: { phase: 'harness', outcome: 'pending' }, decidedBy: '' };

test('equipage change: confirmed / overturned by a new decision, withdrawn without one', () => {
  const before = { vetStrikePending: pending };
  assert.deepEqual(closureFromEquipageChange(before, { vetStrikePending: null, status: 'struken', vetStrikeDecision: decision('confirmed') }),
    { incidentId: 'inc1', outcome: 'confirmed', text: VET_CLOSURE_TEXTS.confirmed, byName: 'TD Tina' });
  assert.equal(closureFromEquipageChange(before, { vetStrikePending: null, vetStrikeDecision: decision('overturned') }).outcome, 'overturned');
  assert.equal(closureFromEquipageChange(before, { vetStrikePending: null }).outcome, 'withdrawn');
  // An old decision (unchanged) does not count: the vet withdrew this one
  const old = decision('overturned');
  assert.equal(closureFromEquipageChange({ ...before, vetStrikeDecision: old }, { vetStrikePending: null, vetStrikeDecision: old }).outcome, 'withdrawn');
  // Still pending, never pending, deleted, or no incident id: nothing
  assert.equal(closureFromEquipageChange(before, { vetStrikePending: pending }), null);
  assert.equal(closureFromEquipageChange({}, { vetStrikePending: null }), null);
  assert.equal(closureFromEquipageChange(before, null), null);
  assert.equal(closureFromEquipageChange({ vetStrikePending: { ...pending, incidentId: '' } }, { vetStrikePending: null }), null);
  assert.equal(closureFromEquipageChange({ vetStrikePending: { ...pending, incidentId: 'a/b' } }, { vetStrikePending: null }), null);
});

test('a late incident entry is closed from the equipage state', () => {
  assert.equal(closureForNewIncident('inc1', openIncident, { vetStrikePending: pending }), null);
  assert.equal(closureForNewIncident('inc1', openIncident, { vetStrikeDecision: decision('confirmed'), status: 'struken' }).outcome, 'confirmed');
  assert.equal(closureForNewIncident('inc1', openIncident, { vetStrikePending: null, vetInspection_harness: { status: 'godkänd' } }).outcome, 'withdrawn');
  assert.equal(closureForNewIncident('inc1', openIncident, { startNumber: '12' }), null);
  assert.equal(closureForNewIncident('inc1', openIncident, null), null);
  assert.equal(closureForNewIncident('inc1', { ...openIncident, type: 'protest' }, { vetStrikePending: null }), null);
});

test('the closure update is idempotent and makes the driver notice', () => {
  const closure = closureFromEquipageChange({ vetStrikePending: pending }, { vetStrikePending: null, status: 'struken', vetStrikeDecision: decision('confirmed') });
  const update = buildIncidentClosureUpdate(openIncident, closure, 'TS');
  assert.deepEqual(update, {
    status: 'decided',
    decision: VET_CLOSURE_TEXTS.confirmed,
    decidedBy: 'TD Tina',
    'vetStrike.outcome': 'confirmed',
    updatedBy: 'system',
    updatedByName: 'DriveLive',
    updatedAt: 'TS'
  });
  const after = { ...openIncident, status: update.status, vetStrike: { ...openIncident.vetStrike, outcome: 'confirmed' } };
  assert.equal(vetDecisionNoticeKey(openIncident, after), 'confirmed');
  assert.ok(buildVetDecisionDriverMessage(openIncident, after));
  // Already closed (by a device or an earlier run): nothing
  assert.equal(buildIncidentClosureUpdate(after, closure, 'TS'), null);
  const withdrawn = buildIncidentClosureUpdate(openIncident, { incidentId: 'inc1', outcome: 'withdrawn', text: VET_CLOSURE_TEXTS.withdrawn, byName: '' }, 'TS');
  assert.equal(withdrawn.status, 'closed');
  assert.equal(withdrawn['vetStrike.outcome'], 'withdrawn');
});
