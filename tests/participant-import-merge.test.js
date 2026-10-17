import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildImportMerge,
  summarizeImportPlan
} from '../js/pages/admin/adminParticipantImportMerge.js';
import { getHorseStableKey } from '../js/pages/shared/vetCheckUtils.js';

const fileEntry = (overrides = {}) => ({
  startNumber: 4,
  driverName: 'Anna Ek',
  clubName: 'Lunds KK',
  className: 'Lätt B Enbet Häst',
  tdbClassNumber: 3,
  status: 'anmäld',
  email: 'anna@example.se',
  phone: '0701',
  payment: { status: '', amount: null, method: '', reference: '' },
  useMergedTestForDisplay: true,
  mergedTestKey: 'LATT_B',
  horses: [{ name: 'Ella', chip: '', regNo: 'SE-1', color: 'brun' }],
  ...overrides
});

const stored = (overrides = {}) => ({
  id: '4',
  startNumber: 4,
  driverName: 'Anna Ek',
  clubName: 'Lunds KK',
  className: 'Lätt B Enbet Häst',
  importedClassName: 'Lätt B Enbet Häst',
  importedStatus: 'anmäld',
  tdbClassNumber: 3,
  status: 'anmäld',
  email: 'anna@example.se',
  phone: '0701',
  payment: { status: '', amount: null, method: '', reference: '' },
  useMergedTestForDisplay: true,
  mergedTestKey: 'LATT_B',
  horses: [{ name: 'Ella', chip: '', regNo: 'SE-1', color: 'brun' }],
  ...overrides
});

test('a new entry is imported whole and remembers the file class', () => {
  const result = buildImportMerge(null, fileEntry());
  assert.equal(result.kind, 'new');
  assert.equal(result.patch.driverName, 'Anna Ek');
  assert.equal(result.patch.importedClassName, 'Lätt B Enbet Häst');
  assert.equal(result.patch.importedStatus, 'anmäld');
});

test('the same file again changes nothing', () => {
  const result = buildImportMerge(stored(), fileEntry());
  assert.equal(result.kind, 'unchanged');
  assert.deepEqual(result.patch, {});
  assert.deepEqual(result.conflicts, []);
});

test('a status set in the app is kept and reported', () => {
  const result = buildImportMerge(stored({ status: 'besiktigad' }), fileEntry({ clubName: 'Malmö KK' }));
  assert.equal('status' in result.patch, false);
  assert.equal(result.patch.clubName, 'Malmö KK');
  assert.deepEqual(result.conflicts, [{ type: 'status', existing: 'besiktigad', imported: 'anmäld' }]);
});

test('a withdrawal in the file is taken while the status is still the initial one', () => {
  const result = buildImportMerge(stored(), fileEntry({ status: 'struken' }));
  assert.equal(result.patch.status, 'struken');
  assert.equal(result.kind, 'updated');
});

test('payment recorded in the app is kept, empty payment fields are filled', () => {
  const existing = stored({ payment: { status: 'paid', amount: null, method: 'swish', reference: '123' } });
  const result = buildImportMerge(existing, fileEntry({ payment: { status: '', amount: 850, method: '', reference: '' } }));
  // Only the empty amount: the merge write leaves status/method/reference alone
  assert.deepEqual(result.patch.payment, { amount: 850 });

  const unpaidInFile = buildImportMerge(stored({ payment: { status: 'paid', method: 'kontant' } }), fileEntry());
  assert.equal('payment' in unpaidInFile.patch, false);
});

test('a horse with vet results is updated in place and keeps its key', () => {
  const existing = stored({
    horses: [{ name: 'Ella', regNo: 'SE-1', color: 'brun' }],
    vetInspection_initial: { status: 'besiktigad', horses: { Ella: { status: 'besiktigad', checkedAt: 'x' } } }
  });
  // The file now has a chip number: by getHorseStableKey it would re-key Ella
  const result = buildImportMerge(existing, fileEntry({
    horses: [{ name: 'Ella', chip: '752000', regNo: 'SE-1', color: 'fux' }]
  }));
  const [ella] = result.patch.horses;
  assert.equal(getHorseStableKey(ella, 0), 'Ella');
  assert.equal(ella.color, 'fux');
  assert.equal(result.patch.horses.length, 1);
  assert.equal('vetInspection_initial' in result.patch, false);
  const conflict = result.conflicts.find(c => c.type === 'vetHorses');
  assert.deepEqual(conflict.keptKeys, ['Ella']);
});

test('a horse with only private clinical findings is protected too', () => {
  const existing = stored({ horses: [{ name: 'Ella', regNo: 'SE-1' }] });
  const result = buildImportMerge(existing, fileEntry({ horses: [{ name: 'Ella', chip: '752000', regNo: 'SE-1' }] }), {
    clinicalByHorse: { Ella: { initial: { pulseBpm: 40 } } }
  });
  // Only the chip differed: kept for the key, so the horses are not written
  assert.equal('horses' in result.patch, false);
  assert.deepEqual(result.conflicts.find(c => c.type === 'vetHorses').keptKeys, ['Ella']);
});

test('a horse without vet results takes the file data, also its chip', () => {
  const result = buildImportMerge(stored(), fileEntry({ horses: [{ name: 'Ella', chip: '752000', regNo: 'SE-1' }] }));
  assert.equal(result.patch.horses[0].chip, '752000');
});

test('a new horse is added and no stored horse is dropped', () => {
  const existing = stored({
    horses: [{ name: 'Ella', regNo: 'SE-1', vetStatus: 'besiktigad' }, { name: 'Reserv', regNo: 'SE-9' }]
  });
  const result = buildImportMerge(existing, fileEntry({ horses: [{ name: 'Ella', regNo: 'SE-1' }, { name: 'Max', regNo: 'SE-2' }] }));
  assert.deepEqual(result.patch.horses.map(h => h.name), ['Ella', 'Reserv', 'Max']);
  assert.equal(result.patch.horses[0].vetStatus, 'besiktigad');
});

test('a class the admin changed after the import is kept and reported', () => {
  const existing = stored({ className: 'Lätt A Enbet Häst', testKey: 'LA' });
  const result = buildImportMerge(existing, fileEntry({ testKey: 'LB' }));
  assert.equal('className' in result.patch, false);
  assert.equal('testKey' in result.patch, false);
  assert.deepEqual(result.conflicts, [{ type: 'class', existing: 'Lätt A Enbet Häst', imported: 'Lätt B Enbet Häst' }]);
});

test('a class changed in the file is updated when the admin did not change it', () => {
  const result = buildImportMerge(stored(), fileEntry({ className: 'Lätt A Enbet Häst', testKey: 'LA' }));
  assert.equal(result.patch.className, 'Lätt A Enbet Häst');
  assert.equal(result.patch.testKey, 'LA');
  assert.equal(result.patch.importedClassName, 'Lätt A Enbet Häst');
  assert.deepEqual(result.conflicts, []);
});

test('an equipage from before importedClassName keeps a differing class (unsure)', () => {
  const existing = stored({ importedClassName: undefined, className: 'Lätt A Enbet Häst' });
  delete existing.importedClassName;
  const result = buildImportMerge(existing, fileEntry());
  assert.equal('className' in result.patch, false);
  assert.equal(result.conflicts[0].type, 'class');
  // Remembered now, so the next import can tell
  assert.equal(result.patch.importedClassName, 'Lätt B Enbet Häst');
});

test('merge flags, vet fields and other app data are not overwritten', () => {
  const existing = stored({
    useMergedTestForDisplay: false,
    mergedTestKey: 'TDBGROUP:3+4',
    groomName: 'Bo',
    trackWidth: 138,
    trackWidthSource: 'manual',
    vetInspection_final: { status: 'besiktigad', horses: {} }
  });
  const result = buildImportMerge(existing, fileEntry({ groomName: 'Cia', trackWidth: 125, trackWidthSource: 'xml' }));
  ['useMergedTestForDisplay', 'mergedTestKey', 'groomName', 'trackWidth', 'trackWidthSource', 'vetInspection_final']
    .forEach(field => assert.equal(field in result.patch, false, field));
});

test('an empty value in the file does not clear stored contact data', () => {
  const result = buildImportMerge(stored(), fileEntry({ phone: '' }));
  assert.equal('phone' in result.patch, false);
});

test('the summary counts the plan and lists the conflicts', () => {
  const summary = summarizeImportPlan([
    { kind: 'new', conflicts: [], startNumber: 1 },
    { kind: 'updated', conflicts: [{ type: 'status', existing: 'incheckad', imported: 'anmäld' }], startNumber: 2, driverName: 'Bo' },
    { kind: 'unchanged', conflicts: [], startNumber: 3 }
  ]);
  assert.deepEqual([summary.new, summary.updated, summary.unchanged], [1, 1, 1]);
  assert.deepEqual(summary.conflicts, [{ startNumber: 2, driverName: 'Bo', type: 'status', existing: 'incheckad', imported: 'anmäld' }]);
});
