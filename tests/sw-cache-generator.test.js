import test from 'node:test';
import assert from 'node:assert/strict';

import { buildServiceWorkerContent } from '../scripts/generate-sw-cache.js';

test('service-worker cache generation is deterministic and includes published entry points', () => {
  const source = "const urlsToCache = [\n  abs('/old.js')\n];\nconst marker = true;\n";
  const first = buildServiceWorkerContent(source);
  const second = buildServiceWorkerContent(first.content);

  assert.equal(second.content, first.content);
  assert.match(first.content, /abs\('\/index[.]html'\)/);
  assert.match(first.content, /abs\('\/js\/main[.]js'\)/);
  assert.match(first.content, /abs\('\/css\/tailwind[.]css'\)/);
  assert.doesNotMatch(first.content, /img\/maraton-course[.]png/);
  assert.match(first.content, /const marker = true/);
});

test('service-worker cache generation rejects a file without a cache array', () => {
  assert.throws(
    () => buildServiceWorkerContent('const other = [];'),
    /Kunde inte hitta urlsToCache/
  );
});
