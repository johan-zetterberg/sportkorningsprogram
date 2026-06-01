import test from 'node:test';
import assert from 'node:assert/strict';

import { renderPrecisionResultCard } from '../js/pages/precision/precisionResultMobileCard.js';

function baseData(overrides = {}) {
  return {
    eq: {
      startNumber: 12,
      driverName: 'Anna Andersson',
      className: 'Lätt A'
    },
    d: {},
    display: { timeLabel: '01:22,30' },
    totalPenalty: 3,
    obstaclePenalty: 2,
    timePenalty: 1,
    place: 1,
    startT: '10:15',
    status: 'Klar',
    ...overrides
  };
}

test('renderPrecisionResultCard renders core mobile result card data', () => {
  const html = renderPrecisionResultCard({
    data: baseData(),
    classStarters: new Map([['Lätt A', 4]]),
    flagHtml: '<span class="flag">SE</span>',
    clubLogoHtml: '<span class="club">Club</span>',
    finalizeButtonsHtml: '<button>Finalize</button>'
  });

  assert.match(html, /data-sn="12"/);
  assert.match(html, /#12/);
  assert.match(html, /Anna Andersson/);
  assert.match(html, /01:22,30/);
  assert.match(html, /3.00/);
  assert.match(html, /<span class="flag">SE<\/span>/);
  assert.match(html, /<button>Finalize<\/button>/);
});

test('renderPrecisionResultCard renders running state with live placeholders', () => {
  const html = renderPrecisionResultCard({
    data: baseData({
      d: { running: true },
      status: 'Pågår'
    })
  });

  assert.match(html, /Running/);
  assert.match(html, /••:••,••/);
  assert.match(html, /bg-yellow-50/);
});

test('renderPrecisionResultCard renders class label in start order mode', () => {
  const html = renderPrecisionResultCard({
    data: baseData(),
    viewMode: 'startorder'
  });

  assert.match(html, /Lätt A/);
});
