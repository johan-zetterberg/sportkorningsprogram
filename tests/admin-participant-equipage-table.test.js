import test from 'node:test';
import assert from 'node:assert/strict';

import { renderAdminEquipageTable } from '../js/pages/admin/adminParticipantEquipageTable.js';

function createTableDom() {
  const head = { innerHTML: '' };
  const body = { innerHTML: '', rows: [] };

  global.document = {
    getElementById(id) {
      if (id === 'adminEquipageTableHead') return head;
      if (id === 'adminEquipageTableBody') return body;
      return null;
    }
  };

  return { head, body };
}

test('renderAdminEquipageTable shows TDB class number with each equipage', () => {
  const { head, body } = createTableDom();

  renderAdminEquipageTable([
    {
      startNumber: 2,
      driverName: 'Kusk',
      clubName: 'Klubb',
      className: 'Lätt A',
      tdbClassNumber: 12,
      status: 'anmäld'
    }
  ]);

  assert.match(head.innerHTML, />TDB</);
  assert.match(body.innerHTML, />#12</);
});

test('renderAdminEquipageTable renders multi-start badge and saved carriage source indicator', () => {
  const { head, body } = createTableDom();

  renderAdminEquipageTable([
    {
      startNumber: 1,
      driverName: 'Anna Andersson',
      clubName: 'Körklubben',
      className: 'Svår Enbet',
      tdbClassNumber: 1,
      hasMultipleStarts: true,
      driverStartCount: 2,
      trackWidth: 138,
      trackWidthSource: 'registry',
      status: 'anmäld'
    }
  ]);

  assert.match(body.innerHTML, /2 starter/);
  assert.match(body.innerHTML, /138 cm/);
  assert.match(body.innerHTML, /\(sparad\)/);
});

