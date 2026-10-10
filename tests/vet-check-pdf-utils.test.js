import test from 'node:test';
import assert from 'node:assert/strict';

import { buildVetCheckPdfRows, formatVetInspectionStatus } from '../js/pdf/vetCheckPdfUtils.js';

test('formatVetInspectionStatus translates statuses to standardized Swedish labels', () => {
    assert.equal(formatVetInspectionStatus('besiktigad'), 'Godkänd');
    assert.equal(formatVetInspectionStatus('ombesiktning'), 'Ombes');
    assert.equal(formatVetInspectionStatus('struken'), 'Ej godkänd');
    assert.equal(formatVetInspectionStatus('incheckad'), 'Incheckad');
    assert.equal(formatVetInspectionStatus(null), '[   ]');
});

test('buildVetCheckPdfRows builds inspection rows with 4 phases and vilobox pulse', () => {
    const equipages = [
        {
            startNumber: 2,
            driverName: 'Anna Kusk',
            clubName: 'Körklubben',
            className: 'Msv B',
            horses: [
                {
                    name: 'Blansen',
                    type: 'Häst',
                    vetStatus: 'besiktigad',
                    phases: {
                        harness: { status: 'besiktigad' },
                        restArea: { pulseBpm: 60, status: 'besiktigad', notes: 'Pigg och alert' },
                        final: { status: 'besiktigad' }
                    }
                }
            ]
        },
        {
            startNumber: 1,
            driverName: 'Bo Förare',
            clubName: 'Föreningen',
            className: 'Svår Enbet',
            horses: [
                {
                    name: 'Hero',
                    vetStatus: 'ombesiktning',
                    phases: {
                        restArea: { pulseBpm: 68, status: 'ombesiktning' }
                    },
                    vetNote: 'Taktfel höger bak'
                }
            ]
        }
    ];

    const rows = buildVetCheckPdfRows(equipages);
    assert.equal(rows.length, 2);

    // Sorted by start number: Bo (1) comes before Anna (2)
    assert.equal(rows[0][0], '1');
    assert.match(rows[0][1], /Bo Förare/);
    assert.equal(rows[0][3], 'Hero');
    assert.equal(rows[0][4], 'Ombes');
    assert.match(rows[0][6], /68 bpm \(!\)/); // Pulse warning since > 64 bpm
    assert.match(rows[0][8], /Taktfel höger bak/);

    assert.equal(rows[1][0], '2');
    assert.match(rows[1][1], /Anna Kusk/);
    assert.equal(rows[1][3], 'Blansen (Häst)');
    assert.equal(rows[1][4], 'Godkänd');
    assert.equal(rows[1][5], 'Godkänd');
    assert.match(rows[1][6], /60 bpm/);
    assert.equal(rows[1][7], 'Godkänd');
    assert.match(rows[1][8], /Pigg och alert/);
});
