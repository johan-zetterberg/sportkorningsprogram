import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectDocuments,
  fromExportValue,
  redactExportDocuments,
  restoreWarnings,
  rewriteCompetitionId,
  toExportValue
} from '../functions/src/competitionExport.js';

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

// Stand-ins for the Admin SDK types, shaped as toExportValue recognises them
class FakeTimestamp {
  constructor(ms) { this.ms = ms; }
  get seconds() { return Math.floor(this.ms / 1000); }
  toMillis() { return this.ms; }
}
class FakeGeoPoint {
  constructor(lat, lng) { this._lat = lat; this._lng = lng; }
  get latitude() { return this._lat; }
  get longitude() { return this._lng; }
}
const fakeRef = (path) => ({ path, collection: () => null, firestore: {} });
const factories = {
  timestamp: ms => new FakeTimestamp(ms),
  geopoint: (lat, lng) => new FakeGeoPoint(lat, lng),
  ref: fakeRef,
  bytes: base64 => Buffer.from(base64, 'base64')
};

test('a restore recreates every exported type, also nested in arrays and maps', () => {
  const exported = toExportValue({
    at: new FakeTimestamp(1760000000123),
    where: new FakeGeoPoint(55.7, 13.2),
    link: fakeRef('artifacts/app/public/data/competitions/c1/equipages/5'),
    blob: Buffer.from([0, 1, 2, 250, 255]),
    total: Infinity,
    low: -Infinity,
    bad: NaN,
    plain: { s: 'x', n: 0, b: false, nil: null, list: [] },
    deep: [[new FakeTimestamp(5), { at: new FakeTimestamp(6), arr: [Infinity, { g: new FakeGeoPoint(1, 2) }] }]]
  });
  assert.deepEqual(exported.blob, { __type: 'bytes', base64: 'AAEC+v8=' });
  // As it travels: through JSON
  const restored = fromExportValue(JSON.parse(JSON.stringify(exported)), factories);
  assert.ok(restored.at instanceof FakeTimestamp);
  assert.equal(restored.at.toMillis(), 1760000000123);
  assert.ok(restored.where instanceof FakeGeoPoint);
  assert.equal(restored.link.path, 'artifacts/app/public/data/competitions/c1/equipages/5');
  assert.deepEqual([...restored.blob], [0, 1, 2, 250, 255]);
  assert.equal(restored.total, Infinity);
  assert.equal(restored.low, -Infinity);
  assert.ok(Number.isNaN(restored.bad));
  assert.deepEqual(restored.plain, { s: 'x', n: 0, b: false, nil: null, list: [] });
  assert.equal(restored.deep[0][0].toMillis(), 5);
  assert.equal(restored.deep[0][1].at.toMillis(), 6);
  assert.equal(restored.deep[0][1].arr[0], Infinity);
  assert.ok(restored.deep[0][1].arr[1].g instanceof FakeGeoPoint);
  // And back again gives the same export
  assert.deepEqual(toExportValue(restored), exported);
});

test('a restore stops on values it does not understand, before anything is written', () => {
  assert.throws(() => fromExportValue({ x: { __type: 'timestamp', ms: 'soon' } }, factories));
  assert.throws(() => fromExportValue({ x: { __type: 'vector', values: [1] } }, factories));
  assert.throws(() => fromExportValue({ x: { __type: 'number', value: '12' } }, factories));
  assert.throws(() => fromExportValue({ at: { __type: 'timestamp', ms: 1 } }, {}), /timestamp/);
  assert.deepEqual(fromExportValue({ a: [1, 'b', null, { c: true }] }), { a: [1, 'b', null, { c: true }] });
});

test('a copy under a new id moves every path and competition id, and nothing else', () => {
  const P = 'artifacts/app/public/data/competitions/c1';
  const docs = [
    { path: P, data: { id: 'c1', name: 'Tävling', competitionId: 'c1', logo: 'competitions/c1/logo.png' } },
    // An equipage, a judge and a class that happen to share the id
    { path: `${P}/equipages/c1`, data: { id: 'c1', startNumber: 'c1', judgeId: 'c1', note: 'c1 kör först' } },
    { path: `${P}/dressage/5/protocols/c1`, data: { judgeId: 'c1', at: { __type: 'timestamp', ms: 1 } } },
    { path: `${P}/archive/a1`, data: { rows: [{ compId: 'c1', ref: { __type: 'ref', path: `${P}/equipages/5` } }] } },
    { path: 'artifacts/app/private/data/competitions/c1/equipagePrivate/5', data: { email: 'a@x.se' } },
    { path: 'competitions/c1/dressageFinalization/5', data: { competitionId: 'c1', by: 'u1' } },
    { path: 'artifacts/app/public/data/competitions/c10/x/1', data: { competitionId: 'c10', p: 'competitions/c10/a' } }
  ];
  const before = JSON.stringify(docs);
  const { documents, fieldsChanged } = rewriteCompetitionId(docs, 'c1', 'c1-copy');
  assert.equal(JSON.stringify(docs), before, 'the input is left as it was');
  const Q = 'artifacts/app/public/data/competitions/c1-copy';
  assert.deepEqual(documents.map(d => d.path), [
    Q,
    `${Q}/equipages/c1`,
    `${Q}/dressage/5/protocols/c1`,
    `${Q}/archive/a1`,
    'artifacts/app/private/data/competitions/c1-copy/equipagePrivate/5',
    'competitions/c1-copy/dressageFinalization/5',
    'artifacts/app/public/data/competitions/c10/x/1'
  ]);
  assert.deepEqual(documents[0].data, { id: 'c1-copy', name: 'Tävling', competitionId: 'c1-copy', logo: 'competitions/c1-copy/logo.png' });
  assert.deepEqual(documents[1].data, docs[1].data);
  assert.deepEqual(documents[2].data, docs[2].data);
  assert.deepEqual(documents[3].data.rows[0], { compId: 'c1-copy', ref: { __type: 'ref', path: `${Q}/equipages/5` } });
  assert.deepEqual(documents[5].data, { competitionId: 'c1-copy', by: 'u1' });
  assert.deepEqual(documents[6].data, docs[6].data);
  assert.equal(fieldsChanged, 6);
});

test('a restore says what it cannot bring back', () => {
  const { redacted } = redactExportDocuments(exportDocs());
  const warnings = restoreWarnings({ redacted, includesPersonalNumbers: false, storageFiles: ['competitions/c1/a.pdf'] });
  assert.match(warnings.join('\n'), /PIN-koder/);
  assert.match(warnings.join('\n'), /Personnummer/);
  assert.match(warnings.join('\n'), /competitions\/c1\/a\.pdf/);
  assert.match(warnings.join('\n'), /Firebase Auth/);
  const withNumbers = restoreWarnings({ redacted: redactExportDocuments(exportDocs(), { includePersonalNumbers: true }).redacted, storageFiles: [] });
  assert.equal(withNumbers.some(w => /Personnummer/.test(w)), false);
  assert.equal(withNumbers.some(w => /Storage/.test(w)), false);
});
