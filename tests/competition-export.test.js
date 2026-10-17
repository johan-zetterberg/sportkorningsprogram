import test from 'node:test';
import assert from 'node:assert/strict';
import { collectDocuments, toExportValue } from '../functions/src/competitionExport.js';

test('Firestore types are written so a restore can recreate them', () => {
  const timestamp = { seconds: 10, nanoseconds: 0, toMillis: () => 10000 };
  const geo = { latitude: 55.7, longitude: 13.2 };
  const ref = { path: 'a/b', collection: () => null, firestore: {} };
  assert.deepEqual(toExportValue({ at: timestamp, where: geo, link: ref, list: [timestamp, 1, 'x'], nested: { n: null } }), {
    at: { __type: 'timestamp', ms: 10000 },
    where: { __type: 'geopoint', lat: 55.7, lng: 13.2 },
    link: { __type: 'ref', path: 'a/b' },
    list: [{ __type: 'timestamp', ms: 10000 }, 1, 'x'],
    nested: { n: null }
  });
  // Stored Infinity/NaN (e.g. an eliminated total) cannot be written as JSON
  assert.deepEqual(toExportValue({ total: Infinity, low: -Infinity, bad: NaN, ok: 1.5 }), {
    total: { __type: 'number', value: 'Infinity' },
    low: { __type: 'number', value: '-Infinity' },
    bad: { __type: 'number', value: 'NaN' },
    ok: 1.5
  });
  assert.doesNotThrow(() => JSON.stringify(toExportValue({ total: Infinity })));
});

// A tiny in-memory stand-in for the Admin SDK's document references
function fakeTree(docs) {
  const ref = (path) => ({
    path,
    async get() { return { exists: path in docs, data: () => docs[path] }; },
    async listCollections() {
      const names = new Set(Object.keys(docs)
        .filter(p => p.startsWith(path + '/'))
        .map(p => p.slice(path.length + 1).split('/')[0]));
      return [...names].map(name => ({
        async listDocuments() {
          const prefix = `${path}/${name}/`;
          const ids = new Set(Object.keys(docs).filter(p => p.startsWith(prefix)).map(p => p.slice(prefix.length).split('/')[0]));
          return [...ids].map(id => ref(prefix + id));
        }
      }));
    }
  });
  return ref;
}

test('the export includes documents below parents without data (dressage protocols)', async () => {
  const ref = fakeTree({
    'c/1': { name: 'Tävling' },
    'c/1/equipages/5': { driverName: 'Anna' },
    'c/1/dressage/5/protocols/C': { total: 200 },
    'c/1/equipagePrivate/5': { email: 'anna@x.se' }
  });
  const docs = await collectDocuments(ref('c/1'));
  assert.deepEqual(docs.map(d => d.path).sort(), ['c/1', 'c/1/dressage/5/protocols/C', 'c/1/equipagePrivate/5', 'c/1/equipages/5']);
});

test('a runaway export stops', async () => {
  const many = { 'c/1': {} };
  for (let i = 0; i < 20; i++) many[`c/1/x/${i}`] = { i };
  await assert.rejects(collectDocuments(fakeTree(many)('c/1'), { maxDocuments: 5 }));
});
