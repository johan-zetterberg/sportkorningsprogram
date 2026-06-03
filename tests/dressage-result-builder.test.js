import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeDressageProtocols } from '../js/pages/dressage/dressageResultBuilder.js';

test('mergeDressageProtocols lets live protocol replace saved protocol for same judge', () => {
  const merged = mergeDressageProtocols({
    savedProtocols: [
      {
        judgeId: 'c',
        position: 'C',
        movements: [{ momentNo: 1, score: 6 }]
      }
    ],
    liveProtocols: new Map([
      ['c', {
        judgeId: 'c',
        judgePosition: 'C',
        movements: [{ momentNo: 1, score: 8 }],
        runningTotalPoints: 8
      }]
    ]),
    preferLiveOverSaved: true
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0].movements[0].score, 8);
  assert.equal(merged[0].position, 'C');
});

test('mergeDressageProtocols preserves saved protocol over stale live protocol by default', () => {
  const merged = mergeDressageProtocols({
    savedProtocols: [
      {
        judgeId: 'c',
        position: 'C',
        movements: [{ momentNo: 1, score: 7 }]
      }
    ],
    liveProtocols: new Map([
      ['c', {
        judgeId: 'c',
        judgePosition: 'C',
        movements: [{ momentNo: 1, score: 4 }],
        runningTotalPoints: 4
      }]
    ])
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0].movements[0].score, 7);
  assert.equal(merged[0].position, 'C');
});

test('mergeDressageProtocols preserves saved general document', () => {
  const merged = mergeDressageProtocols({
    savedProtocols: [
      { id: 'general', errorPoints: 2 },
      { judgeId: 'c', movements: [{ momentNo: 1, score: 7 }] }
    ]
  });

  assert.equal(merged.some(p => p.id === 'general' && p.errorPoints === 2), true);
});
