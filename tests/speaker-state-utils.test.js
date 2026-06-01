import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applySpeakerMarathonDocChanges,
  applySpeakerPrecisionDocChanges,
  applySpeakerDressageCalculatedResult,
  applySpeakerDressageLiveDoc,
  applySpeakerDressageStatusDocs,
  groupSpeakerDressageProtocolsByStartNumber,
  isSpeakerDressageFinishedStatus,
  normalizeSpeakerDressageStatus
} from '../js/pages/shared/speakerStateUtils.js';

function change(type, id, data) {
  return {
    type,
    doc: {
      id,
      data: () => data
    }
  };
}

test('speaker marathon doc changes clear active state when a document is removed', () => {
  const marathonMap = new Map([
    ['12', { running: true }]
  ]);
  const activeMap = new Map([
    ['12', { task: { type: 'obstacle' } }]
  ]);
  let evaluated = 0;

  const changed = applySpeakerMarathonDocChanges([
    change('removed', '12', {})
  ], marathonMap, activeMap, () => { evaluated += 1; });

  assert.deepEqual(changed, ['12']);
  assert.equal(marathonMap.has('12'), false);
  assert.equal(activeMap.has('12'), false);
  assert.equal(evaluated, 0);
});

test('speaker marathon doc changes update maps and evaluate active state for current data', () => {
  const marathonMap = new Map();
  const activeMap = new Map();
  const evaluated = [];

  applySpeakerMarathonDocChanges([
    change('modified', '14', { running: true, currentObstacle: 2 })
  ], marathonMap, activeMap, (sn, data) => evaluated.push([sn, data.currentObstacle]));

  assert.equal(marathonMap.get('14').currentObstacle, 2);
  assert.deepEqual(evaluated, [['14', 2]]);
});

test('speaker precision doc changes timestamp current data and delete removed rows', () => {
  const precisionMap = new Map([
    ['8', { finalized: true }]
  ]);

  applySpeakerPrecisionDocChanges([
    change('removed', '8', {}),
    change('added', '9', { inProgress: true })
  ], precisionMap, 12345);

  assert.equal(precisionMap.has('8'), false);
  assert.equal(precisionMap.get('9').inProgress, true);
  assert.equal(precisionMap.get('9')._receivedLocalAt, 12345);
});

test('speaker dressage status normalization resolves final fields and finished state', () => {
  const normalized = normalizeSpeakerDressageStatus({
    id: '4',
    penalty: 44.5,
    percent: 67.8
  });

  assert.equal(normalized.finalPenalty, 44.5);
  assert.equal(normalized.finalPercent, 67.8);
  assert.equal(normalized.state, 'finished');
  assert.equal(isSpeakerDressageFinishedStatus({ state: 'klar' }), true);
});

test('speaker dressage status docs clear stale live protocols when finished', () => {
  const dressageMap = new Map([
    ['7', { state: 'active' }]
  ]);
  const liveMap = new Map([
    ['7', new Map([['judge-1', { score: 7 }]])]
  ]);

  const changed = applySpeakerDressageStatusDocs([
    { id: '7', totalPenalty: 38.2, state: 'done' }
  ], dressageMap, liveMap);

  assert.deepEqual(changed, ['7']);
  assert.equal(dressageMap.get('7').finalPenalty, 38.2);
  assert.equal(dressageMap.get('7').state, 'finished');
  assert.equal(liveMap.has('7'), false);
});

test('speaker calculated dressage result updates final fields and clears live protocols', () => {
  const dressageMap = new Map([
    ['11', { state: 'active', finalPenalty: 50 }]
  ]);
  const liveMap = new Map([
    ['11', new Map([['judge-1', { score: 6 }]])]
  ]);

  const updated = applySpeakerDressageCalculatedResult(dressageMap, liveMap, 11, {
    percent: 69.5,
    points: 139,
    penalty: 45.75,
    errorPoints: 0
  }, { _verified: true });

  assert.equal(updated, true);
  assert.equal(dressageMap.get('11').finalPenalty, 45.75);
  assert.equal(dressageMap.get('11').finalPercent, 69.5);
  assert.equal(dressageMap.get('11')._verified, true);
  assert.equal(liveMap.has('11'), false);
});

test('speaker dressage live doc stores judge protocol and status', () => {
  const dressageMap = new Map();
  const liveMap = new Map();

  const changed = applySpeakerDressageLiveDoc({
    startNumber: 15,
    judgeUid: 'judge-1',
    protocol: { movements: [], updatedAt: 2000 }
  }, dressageMap, liveMap, [
    { id: 'judge-1', position: 'C' }
  ], value => String(value || '').trim());

  assert.equal(changed, true);
  assert.equal(dressageMap.get('15').state, 'ongoing');
  assert.equal(liveMap.get('15').get('judge-1').position, 'C');
  assert.equal(liveMap.get('15').get('judge-1').judgePosition, 'C');
});

test('speaker dressage live doc ignores finished equipages', () => {
  const dressageMap = new Map([
    ['16', { state: 'finished', finalPenalty: 42 }]
  ]);
  const liveMap = new Map();

  const changed = applySpeakerDressageLiveDoc({
    startNumber: 16,
    judgeUid: 'judge-1'
  }, dressageMap, liveMap, [], value => String(value || '').trim());

  assert.equal(changed, false);
  assert.equal(liveMap.has('16'), false);
  assert.equal(dressageMap.get('16').finalPenalty, 42);
});

test('speaker dressage protocols are grouped by normalized start number', () => {
  const grouped = groupSpeakerDressageProtocolsByStartNumber([
    { startNumber: 3, judgeId: 'C' },
    { startNumber: '3', judgeId: 'B' },
    { startNumber: 4, judgeId: 'C' },
    { judgeId: 'ignored' }
  ]);

  assert.equal(grouped.get('3').length, 2);
  assert.equal(grouped.get('4').length, 1);
  assert.equal(grouped.has(''), false);
});
