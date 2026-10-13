import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDeclarationUpdate, mergeDeclaredHorses } from '../functions/src/declarationUtils.js';

const inspected = {
    name: 'Ella', id: 'SE001', chip: '752', ueln: 'UE1',
    inspections: { first: { status: 'godkänd' } }, vetStatus: 'godkänd', vetCheckedAt: '2026-10-12T08:00:00Z'
};

test('a driver can rename an uninspected horse and add one; vet data and chip are kept', () => {
    const horses = mergeDeclaredHorses(
        [inspected, { name: 'Bo', id: '', chip: '999' }],
        [{ name: 'Ella', id: 'SE001' }, { name: 'Bosse', id: '' }, { name: 'Ny', id: 'SE003' }]
    );
    assert.deepEqual(horses[0], inspected);
    assert.equal(horses[1].name, 'Bosse');
    assert.deepEqual(horses[2], { name: 'Ny', id: 'SE003' });
});

test('the portal sending only names and ids no longer wipes the vet data', () => {
    const [ella] = mergeDeclaredHorses([inspected], [{ name: 'Ella', id: 'SE001' }]);
    assert.equal(ella.vetStatus, 'godkänd');
    assert.deepEqual(ella.inspections, inspected.inspections);
});

test('a driver cannot set vet fields: only name and id are taken from the declaration', () => {
    const [ella] = mergeDeclaredHorses([{ name: 'Ella', id: 'SE001' }], [{ name: 'Ella', id: 'SE001', vetStatus: 'godkänd', inspections: { x: 1 } }]);
    assert.deepEqual(ella, { name: 'Ella', id: 'SE001' });
});

test('an inspected horse cannot be renamed or removed by the driver', () => {
    assert.throws(() => mergeDeclaredHorses([inspected], [{ name: 'Annan', id: 'SE001' }]), /besiktad/);
    assert.throws(() => mergeDeclaredHorses([inspected, { name: 'Bo' }], [{ name: 'Bo' }]), /kan inte tas bort/);
});

test('text is cleaned and the number of horses is limited', () => {
    const update = buildDeclarationUpdate({ groom: '  Anna   Berg ', carriage: 'x'.repeat(300), clubName: 'Klubb', horses: [] });
    assert.equal(update.groom, 'Anna Berg');
    assert.equal(update.carriage.length, 120);
    assert.throws(() => mergeDeclaredHorses([], Array.from({ length: 9 }, (_, i) => ({ name: `H${i}` }))), /Högst/);
});
