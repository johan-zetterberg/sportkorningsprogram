import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildClassMappingHtml,
  buildXmlClassItems,
  escapeAdminImportHtml
} from '../js/pages/admin/adminParticipantImportFormUtils.js';

test('escapeAdminImportHtml escapes xml-provided labels for import UI', () => {
  assert.equal(
    escapeAdminImportHtml('LA "Par" <Häst> & Ponny'),
    'LA &quot;Par&quot; &lt;Häst&gt; &amp; Ponny'
  );
});

test('buildXmlClassItems groups imported classes by TDB number before label', () => {
  const items = buildXmlClassItems([
    { className: 'Lätt A Häst', tdbClassNumber: 1, tdbClassLabel: 'LA H' },
    { className: 'Lätt A Ponny', tdbClassNumber: 1, tdbClassLabel: 'LA P' },
    { className: 'Msv B' }
  ]);

  assert.deepEqual(items.map(item => item.key), ['NUM:1', 'NAME:Msv B']);
  assert.equal(items[0].display, 'LA P (TDB #1)');
});

test('buildClassMappingHtml escapes option values and xml class metadata', () => {
  const html = buildClassMappingHtml(
    [{ key: 'NAME:"><img src=x>', display: '"><script>alert(1)</script>', className: 'Bad' }],
    ['Lätt A "Par" <Häst>']
  );

  assert.match(html, /data-key="NAME:&quot;&gt;&lt;img src=x&gt;"/);
  assert.match(html, /&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /value="Lätt A &quot;Par&quot; &lt;Häst&gt;"/);
  assert.doesNotMatch(html, /<script>alert/);
});

test('buildClassMappingHtml renders readable Swedish import labels', () => {
  const html = buildClassMappingHtml(
    [{ key: 'NUM:1', display: 'Lätt A Häst (TDB #1)', className: 'Lätt A Häst' }],
    ['Lätt A Häst']
  );

  assert.match(html, /Från fil:/);
  assert.match(html, /-- Välj klass --/);
  assert.match(html, /Steg 2: Mappa tävlingsklasser/);
  assert.match(html, /Sammanslå per test/);
  assert.match(html, /Slutför import/);
  assert.doesNotMatch(html, /Ã|Â/);
});
