import test from 'node:test';
import assert from 'node:assert/strict';

import { renderPrecisionResultDesktopRow } from '../js/pages/precision/precisionResultDesktopRow.js';

function baseData(overrides = {}) {
  return {
    eq: {
      startNumber: 12,
      driverName: 'Anna Andersson',
      horseName: 'Hera',
      className: 'Lätt A',
      clubName: 'Körklubben'
    },
    d: { finalized: true },
    display: {
      timeLabel: '01:22,30',
      knocksSimple: '1'
    },
    place: 2,
    status: 'Klar',
    obstaclePenalty: 3,
    timePenalty: 0.5,
    extraPenalty: 1,
    totalPenalty: 4.5,
    ...overrides
  };
}

test('renderPrecisionResultDesktopRow renders core row data', () => {
  const html = renderPrecisionResultDesktopRow({
    data: baseData(),
    allowanceDisplay: '+ 30 cm',
    startTime: '10:15',
    horseLabelHtml: 'Hera',
    flagHtml: '<span>SE</span>',
    clubLogoHtml: '<img alt="">',
    overallResult: { total: 18.25, rank: 3 },
    statusBadgeClass: 'status-ok',
    finalizeButtonsHtml: '<button>Finalize</button>'
  });

  assert.match(html, /data-sn="12"/);
  assert.match(html, /Anna Andersson/);
  assert.match(html, /Hera/);
  assert.match(html, /Körklubben/);
  assert.match(html, /\+ 30 cm/);
  assert.match(html, /18.25 \(3\)/);
  assert.match(html, /<button>Finalize<\/button>/);
});

test('renderPrecisionResultDesktopRow renders running row with live placeholder', () => {
  const html = renderPrecisionResultDesktopRow({
    data: baseData({
      d: { running: true },
      status: 'Pågår'
    })
  });

  assert.match(html, /bg-yellow-50/);
  assert.match(html, /••:••,••/);
  assert.match(html, /border-left: 4px solid #eab308/);
});

test('renderPrecisionResultDesktopRow renders eliminated overall result', () => {
  const html = renderPrecisionResultDesktopRow({
    data: baseData(),
    overallResult: { total: Infinity, rank: null }
  });

  assert.match(html, /ELIM/);
});
