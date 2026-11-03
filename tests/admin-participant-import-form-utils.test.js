import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildClassMappingHtml,
  buildXmlClassItems,
  defaultClassMapping,
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
  assert.match(html, /Sammanslå för visning per testnivå/);
  assert.match(html, /Tempo, klassinställningar och beräkning fortsätter använda den faktiska klass/);
  assert.match(html, /Slutför import/);
  assert.doesNotMatch(html, /Ã|Â|Ãƒ|Ã‚/);
});

test('arena classes keep the class name from the file', () => {
  const item = { key: 'NUM:1', display: 'Arenakörning Fyrspann (TDB #1)', className: 'Arenakörning Fyrspann Häst ' };
  assert.equal(defaultClassMapping(item, { arena: true, bestMatch: 'MSV Fyrspann Häst' }), 'Arenakörning Fyrspann Häst');
  assert.equal(defaultClassMapping(item, { arena: false, bestMatch: 'MSV Fyrspann Häst' }), 'MSV Fyrspann Häst');
  const html = buildClassMappingHtml([item], ['MSV Fyrspann Häst']);
  assert.match(html, /<option value="Arenakörning Fyrspann Häst">Behåll namnet från filen: Arenakörning Fyrspann Häst<\/option>/);
  // A name already in the class list is not offered twice
  assert.doesNotMatch(buildClassMappingHtml([{ key: 'NUM:2', display: 'x', className: 'MSV Fyrspann Häst' }], ['MSV Fyrspann Häst']), /Behåll namnet/);
});
