import test from 'node:test';
import assert from 'node:assert/strict';

import { rowObstacleCells } from '../js/pages/marathon/marathonResultTable.js';

test('marathon result obstacle cells display obstacle time and keep penalty in tooltip', () => {
  const html = rowObstacleCells({
    startNumber: 12,
    obstacles: {
      items: [
        { number: 1, timeSec: 43.82, penalty: 10.955 },
        { number: 2, penalty: 8 }
      ]
    }
  }, 2);

  assert.match(html, />43,82</);
  assert.match(html, /Tid: 43,82 s/);
  assert.match(html, /Straff: 10.96/);
  assert.doesNotMatch(html, />10\.96</);
});
