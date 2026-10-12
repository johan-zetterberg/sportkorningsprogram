import test from 'node:test';
import assert from 'node:assert/strict';

import { stackName, horseLabelStacked, isSafeImageUrl, escapeHtml, jsStringAttr } from '../js/utils/sharedUtils.js';
import { getMomentHorseLabelStacked } from '../js/pages/marathon/marathonResultFormatters.js';

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

test('escapeHtml covers attribute breakouts', () => {
    assert.equal(escapeHtml(`"' onmouseover=x`), '&quot;&#39; onmouseover=x');
});
