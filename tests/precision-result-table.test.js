import test from 'node:test';
import assert from 'node:assert/strict';

import {
  renderPrecisionGroupHeader,
  renderPrecisionTable,
  renderPrecisionTableHead
} from '../js/pages/precision/precisionResultTable.js';

const labels = {
  rank: 'Plac',
  driver: 'Kusk',
  className: 'Klass',
  countryClub: 'Land/Klubb',
  startTime: 'Starttid',
  obstacleWidth: 'Hinderbredd',
  time: 'Tid',
  knockdowns: 'Nedslag',
  obsPenalty: 'Hinderfel',
  timePenalty: 'Tidsfel',
  otherPenaltyShort: 'Övrigt',
  total: 'Totalt',
  overallStanding: 'Total ställning',
  status: 'Status',
  finalColumn: 'Final'
};

test('renderPrecisionTableHead renders sortable precision columns', () => {
  const html = renderPrecisionTableHead(labels);

  assert.match(html, /<thead><tr>/);
  assert.match(html, /data-col="place"/);
  assert.match(html, /data-col="overall"/);
  assert.match(html, /Total ställning/);
  assert.match(html, /sort-icon/);
});

test('renderPrecisionGroupHeader renders a class group row', () => {
  const html = renderPrecisionGroupHeader('Lätt A', 16);

  assert.match(html, /Lätt A/);
  assert.match(html, /colspan="16"/);
});

test('renderPrecisionTable wraps head and body html', () => {
  const html = renderPrecisionTable({
    headHtml: '<thead></thead>',
    bodyHtml: '<tr><td>Rad</td></tr>'
  });

  assert.match(html, /id="precisionTable"/);
  assert.match(html, /<tbody id="precisionBody"><tr><td>Rad<\/td><\/tr><\/tbody>/);
});
