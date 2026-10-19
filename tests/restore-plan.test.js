import test from 'node:test';
import assert from 'node:assert/strict';

import {
    documentsNewerThanExport,
    findExtraDocuments,
    mergeRedactedFields,
    parseFieldPath,
    redactionsByPath
} from '../scripts/restore-plan.mjs';

test('field paths of left-out fields are parsed, list positions included', () => {
    assert.deepEqual(parseFieldPath('accessCode_vet'), ['accessCode_vet']);
    assert.deepEqual(parseFieldPath('rows[0].ssn'), ['rows', 0, 'ssn']);
    assert.deepEqual(parseFieldPath('a.b[2][1].c'), ['a', 'b', 2, 1, 'c']);
});

test('fields the backup left out are kept from the database on overwrite', () => {
    const restored = { name: 'Backup', rows: [{ startNumber: 5 }, { startNumber: 7 }], nested: {} };
    const live = { name: 'Live', accessCode: '1234', rows: [{ startNumber: 5, ssn: 'x' }], nested: { pin: '9' } };
    const { data, kept } = mergeRedactedFields(restored, live, ['accessCode', 'rows[0].ssn', 'nested.pin', 'missing']);
    assert.deepEqual(kept, ['accessCode', 'rows[0].ssn', 'nested.pin']);
    assert.equal(data.name, 'Backup');
    assert.equal(data.accessCode, '1234');
    assert.equal(data.rows[0].ssn, 'x');
    assert.equal(data.nested.pin, '9');
    assert.equal(restored.accessCode, undefined, 'the restored data itself is not changed');
    // A list position the backup does not have is not created
    const short = mergeRedactedFields({ rows: [] }, live, ['rows[0].ssn']);
    assert.deepEqual(short.kept, []);
    // Nothing in the database: nothing to keep
    assert.deepEqual(mergeRedactedFields(restored, null, ['accessCode']).data, restored);
});

test('redactions are grouped per document; whole documents are never pruned', () => {
    const { fieldsByPath, wholeDocuments } = redactionsByPath([
        { path: 'c/1/config/secrets', reason: 'secret' },
        { path: 'c/1/equipages/5', field: 'driverSSN', reason: 'personalNumber' },
        { path: 'c/1/equipages/5', field: 'horses[0].ssn', reason: 'personalNumber' }
    ], path => path.replace('c/1', 'c/2'));
    assert.deepEqual(fieldsByPath.get('c/2/equipages/5'), ['driverSSN', 'horses[0].ssn']);
    assert.ok(wholeDocuments.has('c/2/config/secrets'));
    assert.deepEqual(
        findExtraDocuments(['c/2/a', 'c/2/config/secrets', 'c/2/lock'], ['c/2/a'], wholeDocuments),
        ['c/2/lock']
    );
});

test('documents changed after the backup are found, newest first', () => {
    const exportedAt = '2026-10-17T10:00:00.000Z';
    const at = Date.parse(exportedAt);
    const newer = documentsNewerThanExport([
        { path: 'old', updateMs: at - 1000 },
        { path: 'new1', updateMs: at + 1000 },
        { path: 'new2', updateMs: at + 5000 }
    ], exportedAt);
    assert.deepEqual(newer.map(d => d.path), ['new2', 'new1']);
    assert.equal(documentsNewerThanExport([{ path: 'a', updateMs: 1 }], null).length, 1, 'unknown backup time: all count');
});
