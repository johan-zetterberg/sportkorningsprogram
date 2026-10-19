import test from 'node:test';
import assert from 'node:assert/strict';

import { stackName, horseLabelStacked, isSafeImageUrl, escapeHtml, jsStringAttr } from '../js/utils/sharedUtils.js';
import { getMomentHorseLabelStacked } from '../js/pages/marathon/marathonResultFormatters.js';
import { rowObstacleCells } from '../js/pages/marathon/marathonResultTable.js';
import { rowStageCellsHTML } from '../js/pages/marathon/marathonResultLiveTicker.js';
import { renderMarathonMobileCards } from '../js/pages/marathon/marathonResultMobile.js';
import { renderTeamMemberRow } from '../js/pages/shared/totalResultTeams.js';
import { renderStarttiderActionButtons } from '../js/pages/admin/starttiderUtils.js';
import { renderAdminEquipageTable } from '../js/pages/admin/adminParticipantEquipageTable.js';

const evil = '<img src=x onerror=alert(1)>';

test('stackName escapes the name parts', () => {
    assert.equal(stackName('Anna <b>Berg</b>'), '<span class="block">Anna</span><span class="block">&lt;b&gt;Berg&lt;/b&gt;</span>');
    assert.ok(!stackName(evil).includes('<img'));
    assert.equal(stackName('Anna Berg'), '<span class="block">Anna</span><span class="block">Berg</span>');
});

test('horse label helpers escape horse names', () => {
    assert.ok(!horseLabelStacked({ horseName: evil }).includes('<img'));
    assert.equal(horseLabelStacked({ horseName: 'Ella & Bo' }), '<span class="block">Ella</span><span class="block">Bo</span>');
    const stacked = getMomentHorseLabelStacked({ horses: [{ id: 'h1', name: evil }] }, 'marathon');
    assert.ok(!stacked.includes('<img'));
    assert.ok(stacked.includes('&lt;img'));
});

test('isSafeImageUrl accepts logo URLs and rejects script URLs', () => {
    for (const ok of ['/assets/logos/a.png', 'assets/logos/a b.png', './a.png', 'https://firebasestorage.googleapis.com/v0/b/x/o/a.png?alt=media',
        'data:image/png;base64,AAAA', 'data:image/svg+xml,%3Csvg%3E']) {
        assert.equal(isSafeImageUrl(ok), true, ok);
    }
    for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,<script>', '//evil.example/x.png', 'vbscript:x', '', null]) {
        assert.equal(isSafeImageUrl(bad), false, String(bad));
    }
});

test('jsStringAttr survives HTML decoding as one JS string', () => {
    const attr = jsStringAttr(`12'); alert(1); //"`);
    assert.ok(!/['"<>]/.test(attr));
    // What the browser hands to the JS engine after decoding the attribute
    const decoded = attr.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    assert.equal(JSON.parse(decoded), `12'); alert(1); //"`);
    assert.equal(jsStringAttr(7), '&quot;7&quot;');
});

// A start number that breaks out of an attribute and injects markup
const evilSn = '1"><img src=x onerror=alert(1)>';

function assertNoInjection(html, label) {
    assert.ok(!html.includes('<img'), `${label}: raw <img> in output`);
    assert.ok(!html.includes(evilSn) && !html.includes('1"&gt;'), `${label}: attribute break-out in output`);
    assert.ok(html.includes('&lt;img'), `${label}: escaped start number missing`);
}

test('marathon result cells escape the start number', () => {
    const res = {
        startNumber: evilSn,
        obstacles: { items: [{ number: 1, timeSec: 42.5, penalty: 1 }] },
        stages: { A: { timePenalty: 0 } }
    };
    assertNoInjection(rowObstacleCells(res, 1), 'rowObstacleCells');
    assertNoInjection(rowStageCellsHTML(res, ['A']), 'rowStageCellsHTML');
});

test('marathon mobile cards escape the start number', () => {
    const cards = { innerHTML: '' };
    const eq = { startNumber: evilSn, driverName: 'Kusk', className: 'Klass' };
    renderMarathonMobileCards({
        cards,
        list: [eq],
        viewMode: 'startorder',
        placeMap: new Map(),
        obstaclePlaceMap: new Map(),
        getObstaclePlacement: () => null,
        marathonMap: new Map(),
        stageKeys: ['A'],
        stageEnabled: () => true,
        calculateResult: () => ({ status: 'Klar', totalPenalty: 1, eta: {}, stages: { A: { timePenalty: 0 } }, obstacles: { items: [] } }),
        timingDocFor: () => ({}),
        startTimeFor: () => null,
        fmtClock: () => '',
        getFlagHtml: () => '',
        getClubLogoHtml: () => '',
        startLiveTicker: () => {},
        translate: (key) => key
    });
    assertNoInjection(cards.innerHTML, 'renderMarathonMobileCards');
});

test('team member rows escape the start number', () => {
    assertNoInjection(renderTeamMemberRow({ startNumber: evilSn, name: 'Kusk' }), 'renderTeamMemberRow');
});

test('start time action buttons escape the start number', () => {
    for (const variant of ['desktop', 'mobile']) {
        assertNoInjection(renderStarttiderActionButtons({ discipline: 'dressage', startNumber: evilSn, variant }), variant);
    }
});

test('admin equipage table escapes the start number', () => {
    const body = { innerHTML: '', rows: [] };
    const prevDocument = global.document;
    global.document = { getElementById: (id) => (id === 'adminEquipageTableBody' ? body : { innerHTML: '' }) };
    try {
        renderAdminEquipageTable([{ startNumber: evilSn, driverName: 'Kusk', hasMultipleStarts: true, driverStartCount: evilSn }]);
    } finally {
        global.document = prevDocument;
    }
    assertNoInjection(body.innerHTML, 'renderAdminEquipageTable');
});

test('escapeHtml covers attribute breakouts', () => {
    assert.equal(escapeHtml(`"' onmouseover=x`), '&quot;&#39; onmouseover=x');
});
