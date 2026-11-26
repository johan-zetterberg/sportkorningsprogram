import test from 'node:test';
import assert from 'node:assert/strict';

import { listGlobalAdmins, setGlobalAdminRole } from '../functions/src/globalAdmins.js';

function fakes({ users = {}, accounts = {} } = {}) {
  const docs = { ...users };
  const writes = [];
  const db = {
    doc: (path) => {
      const uid = path.split('/')[1];
      return {
        get: async () => ({ exists: uid in docs, data: () => docs[uid] }),
        set: async (data, opts) => { writes.push({ uid, data, opts }); docs[uid] = { ...(docs[uid] || {}), ...data }; }
      };
    },
    collection: () => ({
      where: (field, op, values) => ({
        get: async () => ({ docs: Object.entries(docs).filter(([, d]) => values.includes(d[field])).map(([id, d]) => ({ id, data: () => d })) })
      })
    })
  };
  const auth = {
    getUserByEmail: async (email) => {
      const account = accounts[email];
      if (!account) throw Object.assign(new Error('nope'), { code: 'auth/user-not-found' });
      return account;
    }
  };
  return { deps: { db, auth, now: () => 'T' }, docs, writes };
}

test('global admin: granted to a confirmed account, by e-mail in any case', async () => {
  const f = fakes({ users: { u1: { email: 'a@b.se', role: 'publik' } }, accounts: { 'a@b.se': { uid: 'u1', emailVerified: true } } });
  const result = await setGlobalAdminRole(f.deps, { email: ' A@B.se ', admin: true }, { byUid: 'boss' });
  assert.deepEqual(result, { uid: 'u1', email: 'a@b.se', role: 'admin', changed: true });
  assert.equal(f.docs.u1.role, 'admin');
  assert.equal(f.docs.u1.roleChangedBy, 'boss');
  // Again: nothing written
  const again = await setGlobalAdminRole(f.deps, { email: 'a@b.se', admin: true }, { byUid: 'boss' });
  assert.equal(again.changed, false);
  assert.equal(f.writes.length, 1);
  // Removed: back to publik
  await setGlobalAdminRole(f.deps, { email: 'a@b.se', admin: false }, { byUid: 'boss' });
  assert.equal(f.docs.u1.role, 'publik');
});

test('global admin: refused for unknown, unconfirmed, superadmin and own accounts', async () => {
  const f = fakes({
    users: { s1: { email: 's@b.se', role: 'superadmin' }, u2: { email: 'n@b.se', role: 'publik' } },
    accounts: {
      's@b.se': { uid: 's1', emailVerified: true },
      'c@b.se': { uid: 'c1', emailVerified: true, customClaims: { superadmin: true } },
      'n@b.se': { uid: 'u2', emailVerified: false },
      'me@b.se': { uid: 'boss', emailVerified: true }
    }
  });
  const codeOf = (promise) => promise.then(() => 'ok', (e) => e.code);
  assert.equal(await codeOf(setGlobalAdminRole(f.deps, { email: 'x@b.se', admin: true }, { byUid: 'boss' })), 'not-found');
  assert.equal(await codeOf(setGlobalAdminRole(f.deps, { email: 'n@b.se', admin: true }, { byUid: 'boss' })), 'failed-precondition');
  assert.equal(await codeOf(setGlobalAdminRole(f.deps, { email: 's@b.se', admin: false }, { byUid: 'boss' })), 'failed-precondition');
  assert.equal(await codeOf(setGlobalAdminRole(f.deps, { email: 'c@b.se', admin: true }, { byUid: 'boss' })), 'failed-precondition');
  assert.equal(await codeOf(setGlobalAdminRole(f.deps, { email: 'me@b.se', admin: false }, { byUid: 'boss' })), 'failed-precondition');
  assert.equal(await codeOf(setGlobalAdminRole(f.deps, { email: 'not-an-email', admin: true }, { byUid: 'boss' })), 'invalid-argument');
  assert.equal(await codeOf(setGlobalAdminRole(f.deps, { email: 'n@b.se' }, { byUid: 'boss' })), 'invalid-argument');
  // An unconfirmed account can still lose the role
  assert.equal(await codeOf(setGlobalAdminRole(f.deps, { email: 'n@b.se', admin: false }, { byUid: 'boss' })), 'ok');
  assert.equal(f.writes.length, 0);
});

test('global admin: an account without a users doc gets one', async () => {
  const f = fakes({ accounts: { 'new@b.se': { uid: 'u9', emailVerified: true } } });
  await setGlobalAdminRole(f.deps, { email: 'new@b.se', admin: true }, { byUid: 'boss' });
  assert.deepEqual(f.docs.u9, { role: 'admin', roleChangedAt: 'T', roleChangedBy: 'boss', email: 'new@b.se', createdAt: 'T', claimedEquipages: [] });
});

test('global admin: the list holds admins and superadmins, sorted by e-mail', async () => {
  const f = fakes({ users: { a: { email: 'z@b.se', role: 'admin' }, b: { email: 'a@b.se', role: 'superadmin' }, c: { email: 'm@b.se', role: 'publik' } } });
  assert.deepEqual(await listGlobalAdmins(f.deps), [
    { uid: 'b', email: 'a@b.se', role: 'superadmin' },
    { uid: 'a', email: 'z@b.se', role: 'admin' }
  ]);
});
