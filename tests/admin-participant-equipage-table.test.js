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
