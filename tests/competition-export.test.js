import test from 'node:test';
import assert from 'node:assert/strict';
import { collectDocuments, redactExportDocuments, toExportValue } from '../functions/src/competitionExport.js';

const C = 'artifacts/app/public/data/competitions/c1';
const exportDocs = () => [
  { path: C, data: { name: 'Tävling', accessCode: '12345678', createdBy: 'u1' } },
  { path: `${C}/config/secrets`, data: { accessCode: '12345678', accessCode_vet: '87654321' } },
  { path: `${C}/config/general`, data: { pinned: true, dressageJudges: 2 } },
  { path: `${C}/equipagePrivate/5`, data: { email: 'anna@x.se', ssn: '19800101-1234', personnummer: '198001011234' } },
  { path: `${C}/equipages/5`, data: { driverName: 'Anna', driverSSN: '19800101-1234', horses: [{ name: 'Blixt', PIN: '1' }] } },
  { path: `${C}/archive/s1`, data: { rows: [{ startNumber: 5, ssn: 'x', at: { __type: 'timestamp', ms: 1 } }], settings: { accessCode_dressage: '1' } } },
  { path: `${C}/officialsPrivate/o1`, data: { phone: '070', personalNumber: 'y', password: 'p', token: 't' } }
];

test('the export never contains access PINs, and says what was left out', () => {
  const { documents, redacted } = redactExportDocuments(exportDocs(), { includePersonalNumbers: true });
  const json = JSON.stringify(documents);
  assert.equal(json.includes('12345678'), false);
  assert.equal(json.includes('87654321'), false);
  assert.equal(documents.some(d => d.path.endsWith('/config/secrets')), false);
  assert.deepEqual(redacted.filter(r => r.reason === 'secret'), [
    { path: C, field: 'accessCode', reason: 'secret' },
    { path: `${C}/config/secrets`, reason: 'secret' },
    { path: `${C}/equipages/5`, field: 'horses[0].PIN', reason: 'secret' },
    { path: `${C}/archive/s1`, field: 'settings.accessCode_dressage', reason: 'secret' },
    { path: `${C}/officialsPrivate/o1`, field: 'password', reason: 'secret' },
    { path: `${C}/officialsPrivate/o1`, field: 'token', reason: 'secret' }
  ]);
  // Fields that only look alike are kept, and so is everything else
  assert.equal(documents.find(d => d.path.endsWith('/config/general')).data.pinned, true);
  assert.deepEqual(documents.find(d => d.path.endsWith('/equipagePrivate/5')).data,
    { email: 'anna@x.se', ssn: '19800101-1234', personnummer: '198001011234' });
  assert.deepEqual(documents.find(d => d.path.endsWith('/archive/s1')).data.rows[0].at, { __type: 'timestamp', ms: 1 });
});

test('personal identity numbers are left out unless the admin asks for them', () => {
  for (const options of [undefined, {}, { includePersonalNumbers: 'yes' }]) {
    const { documents, redacted } = redactExportDocuments(exportDocs(), options);
    const json = JSON.stringify(documents);
    assert.equal(json.includes('19800101'), false);
    assert.equal(/"(ssn|personnummer|driverSSN|personalNumber)"/.test(json), false);
    assert.deepEqual(redacted.filter(r => r.reason === 'personalNumber').map(r => `${r.path.slice(C.length)}#${r.field}`), [
      '/equipagePrivate/5#ssn',
      '/equipagePrivate/5#personnummer',
      '/equipages/5#driverSSN',
      '/archive/s1#rows[0].ssn',
      '/officialsPrivate/o1#personalNumber'
    ]);
    assert.equal(documents.find(d => d.path.endsWith('/equipagePrivate/5')).data.email, 'anna@x.se');
  }
});

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
