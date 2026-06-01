import test from 'node:test';
import assert from 'node:assert/strict';

import {
  renderPrecisionLiveStatusPanel,
  updatePrecisionLivePanelTimer
} from '../js/pages/precision/precisionResultLivePanel.js';

test('renderPrecisionLiveStatusPanel renders active equipage details', () => {
  const html = renderPrecisionLiveStatusPanel({
    equipage: {
      startNumber: 12,
      driverName: 'Anna Andersson',
      className: 'Lätt A',
      clubName: 'Körklubben'
    },
    totalPenalty: 4.5,
    overallRank: 2,
    toBeat: { targetP: 3.25 },
    horseLabelHtml: 'Hera',
    flagHtml: '<span>SE</span>'
  });

  assert.match(html, /På banan/);
  assert.match(html, /Anna Andersson/);
  assert.match(html, /Hera/);
  assert.match(html, /4.50/);
  assert.match(html, /livePanelTimer-12/);
  assert.match(html, /För nästa: < 3.3/);
});

test('renderPrecisionLiveStatusPanel renders eliminated penalty label', () => {
  const html = renderPrecisionLiveStatusPanel({
    equipage: { startNumber: 7, driverName: 'Kusk', className: 'Msv' },
    totalPenalty: Infinity
  });

  assert.match(html, /ELIM/);
});

test('updatePrecisionLivePanelTimer updates desktop and mobile fields', () => {
  const values = new Map();
  const root = {
    getElementById(id) {
      return {
        set textContent(value) {
          values.set(id, value);
        }
      };
    }
  };

  updatePrecisionLivePanelTimer('12', '00:10,00', '2.50', '1', root);

  assert.equal(values.get('livePanelTimer-12'), '00:10,00');
  assert.equal(values.get('livePanelTimer-mob-12'), '00:10,00');
  assert.equal(values.get('livePanelPenalty-12'), '2.50');
  assert.equal(values.get('livePanelRank-mob-12'), '1');
});
