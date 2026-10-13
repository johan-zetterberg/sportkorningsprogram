import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCompetitionDeletionPlan,
  canResumeCompetitionDeletion,
  isGlobalAdminIdentity
} from '../functions/src/competitionDeletion.js';

test('competition deletion starts from the live competition document', () => {
  const plan = buildCompetitionDeletionPlan('comp-1', {
    appId: 'combined-driving',
    ref: { path: 'artifacts/combined-driving/public/data/competitions/comp-1' },
    data: { name: 'Test' }
  });

  assert.equal(plan.hasCompetitionDocument, true);
  assert.equal(plan.publicPath, 'artifacts/combined-driving/public/data/competitions/comp-1');
  assert.equal(plan.competitionData.name, 'Test');
});

test('competition deletion resumes from a tombstone after the public document is gone', () => {
  const plan = buildCompetitionDeletionPlan('comp-1', null, {
    appId: 'drivelive',
    name: 'Test',
    status: 'failed'
  });

  assert.equal(plan.hasCompetitionDocument, false);
  assert.equal(plan.alreadyDone, false);
  assert.equal(plan.publicPath, 'artifacts/drivelive/public/data/competitions/comp-1');
  assert.equal(buildCompetitionDeletionPlan('comp-1', null, null), null);
});

test('completed deletion is idempotent and resume permission stays restricted', () => {
  const tombstone = { appId: 'combined-driving', deletedBy: 'owner-1', status: 'done' };
  assert.equal(buildCompetitionDeletionPlan('comp-1', null, tombstone).alreadyDone, true);
  assert.equal(canResumeCompetitionDeletion('owner-1', {}, {}, tombstone), true);
  assert.equal(canResumeCompetitionDeletion('other', { superadmin: true }, {}, tombstone), true);
  assert.equal(canResumeCompetitionDeletion('other', {}, { roles: ['admin'] }, tombstone), true);
  assert.equal(canResumeCompetitionDeletion('other', {}, { role: 'funktionar' }, tombstone), false);
  assert.equal(isGlobalAdminIdentity({ role: 'admin' }), true);
});
