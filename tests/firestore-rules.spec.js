import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from '@firebase/rules-unit-testing';
import {
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  Timestamp,
  FieldPath,
  getDoc,
  getDocs,
  increment,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore';

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'demo-combined-driving';
const APP_ID = 'drivelive';
const COMP_ID = 'comp-1';
const START_NO = '101';
const HAS_EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

let testEnv;

function compPath(path = '') {
  const base = `artifacts/${APP_ID}/public/data/competitions/${COMP_ID}`;
  return path ? `${base}/${path}` : base;
}

function rootCompPath(path = '') {
  const base = `competitions/${COMP_ID}`;
  return path ? `${base}/${path}` : base;
}

function privateCompPath(path = '') {
  const base = `artifacts/${APP_ID}/private/data/competitions/${COMP_ID}`;
  return path ? `${base}/${path}` : base;
}

// A lock change as finalizationService writes it: the lock names a new
// finalizationLog entry written in the same batch
function setLoggedLock(batch, db, uid, discipline, finalized, startNo = START_NO) {
  const logRef = doc(collection(db, rootCompPath('finalizationLog')));
  batch.set(logRef, {
    discipline,
    action: finalized ? 'finalize' : 'unfinalize',
    startNumber: String(startNo),
    by: uid,
    byName: null,
    at: serverTimestamp()
  });
  batch.set(doc(db, rootCompPath(`${discipline}Finalization/${startNo}`)), { finalized, lastLogId: logRef.id }, { merge: true });
  return logRef;
}

async function commitLoggedLock(db, uid, discipline, finalized) {
  const batch = writeBatch(db);
  setLoggedLock(batch, db, uid, discipline, finalized);
  return batch.commit();
}

async function seedBaseCompetition() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(doc(db, compPath()), {
      name: 'Rules Test Competition',
      createdBy: 'owner-1',
      admins: [],
      officialEmails: []
    });

    await setDoc(doc(db, compPath('config/secrets')), {
      accessCode: 'admin-pin',
      accessCode_dressage: 'dressage-pin',
      accessCode_marathon: 'marathon-pin',
      accessCode_precision: 'precision-pin',
      accessCode_speaker: 'speaker-pin'
    });
  });
}

async function seedCompetitionRole(uid, role, email = `${uid}@example.com`) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, compPath(`admins/${uid}`)), {
      role,
      roles: [role],
      email
    });
  });
}

async function seedRoleEmail(email, roles) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, compPath(`roleEmails/${String(email).trim().toLowerCase()}`)), {
      email: String(email).trim().toLowerCase(),
      roles
    });
  });
}

before(async () => {
  if (!HAS_EMULATOR) return;
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules }
  });
});

beforeEach(async () => {
  if (!HAS_EMULATOR) return;
  await testEnv.clearFirestore();
  await seedBaseCompetition();
});

after(async () => {
  if (!HAS_EMULATOR || !testEnv) return;
  await testEnv.cleanup();
});

test('firestore rules tests require the Firestore emulator', { skip: HAS_EMULATOR }, () => {
  assert.ok(true, 'Skipped because FIRESTORE_EMULATOR_HOST is not set.');
});

test('direct client writes may not create a speaker-scoped admin document even with correct PIN', { skip: !HAS_EMULATOR }, async () => {
  const ctx = testEnv.authenticatedContext('speaker-1', { email_verified: true, email: 'speaker@example.com' });
  const db = ctx.firestore();

  await assertFails(setDoc(doc(db, compPath('admins/speaker-1')), {
    role: 'speaker',
    roles: ['speaker'],
    accessCode: 'speaker-pin',
    email: 'speaker@example.com',
    joinedAt: '2026-06-08T10:00:00Z'
  }));
});

test('direct client writes may not create an admin-scoped admin document even with correct PIN', { skip: !HAS_EMULATOR }, async () => {
  const ctx = testEnv.authenticatedContext('admin-1', { email_verified: true, email: 'admin@example.com' });
  const db = ctx.firestore();

  await assertFails(setDoc(doc(db, compPath('admins/admin-1')), {
    role: 'admin',
    roles: ['admin'],
    accessCode: 'admin-pin',
    email: 'admin@example.com',
    joinedAt: '2026-06-08T10:00:00Z'
  }));
});

test('users may create only a public self profile', { skip: !HAS_EMULATOR }, async () => {
  const ctx = testEnv.authenticatedContext('profile-1', { email_verified: true, email: 'profile@example.com' });
  const db = ctx.firestore();

  await assertSucceeds(setDoc(doc(db, 'users/profile-1'), {
    email: 'profile@example.com',
    role: 'publik',
    createdAt: '2026-06-12T10:00:00Z',
    claimedEquipages: []
  }));

  await assertFails(setDoc(doc(db, 'users/profile-1'), {
    email: 'profile@example.com',
    role: 'admin',
    claimedEquipages: []
  }));
});

test('users may update claims but may not escalate their own role', { skip: !HAS_EMULATOR }, async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'users/profile-2'), {
      email: 'profile2@example.com',
      role: 'publik',
      claimedEquipages: []
    });
  });

  const ctx = testEnv.authenticatedContext('profile-2', { email_verified: true, email: 'profile2@example.com' });
  const db = ctx.firestore();

  await assertSucceeds(updateDoc(doc(db, 'users/profile-2'), {
    claimedEquipages: [{ competitionId: COMP_ID, startNumber: 1 }]
  }));
  await assertFails(updateDoc(doc(db, 'users/profile-2'), { role: 'superadmin' }));
  await assertFails(updateDoc(doc(db, 'users/profile-2'), { roles: ['superadmin'] }));
});

test('admin join documents are not publicly readable', { skip: !HAS_EMULATOR }, async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, compPath('admins/admin-public-1')), {
      role: 'admin',
      roles: ['admin'],
      email: 'admin-public@example.com'
    });
  });

  const anonymousDb = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(anonymousDb, compPath('admins/admin-public-1'))));
});

test('competition admins may read admin join documents while non-admin competition roles may not', { skip: !HAS_EMULATOR }, async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, compPath('admins/admin-read-1')), {
      role: 'admin',
      roles: ['admin'],
      email: 'admin-read@example.com'
    });
  });

  await seedCompetitionRole('admin-reader-1', 'admin', 'admin-reader@example.com');
  await seedCompetitionRole('speaker-reader-1', 'speaker', 'speaker-reader@example.com');

  const adminDb = testEnv.authenticatedContext('admin-reader-1', { email_verified: true, email: 'admin-reader@example.com' }).firestore();
  const speakerDb = testEnv.authenticatedContext('speaker-reader-1', { email_verified: true, email: 'speaker-reader@example.com' }).firestore();

  await assertSucceeds(getDoc(doc(adminDb, compPath('admins/admin-read-1'))));
  await assertFails(getDoc(doc(speakerDb, compPath('admins/admin-read-1'))));
});

test('speaker PIN join may not escalate to admin through roles array', { skip: !HAS_EMULATOR }, async () => {
  const ctx = testEnv.authenticatedContext('speaker-2', { email_verified: true, email: 'speaker2@example.com' });
  const db = ctx.firestore();

  await assertFails(setDoc(doc(db, compPath('admins/speaker-2')), {
    role: 'speaker',
    roles: ['speaker', 'admin'],
    accessCode: 'speaker-pin',
    email: 'speaker2@example.com',
    joinedAt: '2026-06-08T10:00:00Z'
  }));
});

test('existing speaker may not add a second role through direct client writes', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('multi-role-1', 'speaker', 'multi@example.com');
  const ctx = testEnv.authenticatedContext('multi-role-1', { email_verified: true, email: 'multi@example.com' });
  const db = ctx.firestore();

  await assertFails(setDoc(doc(db, compPath('admins/multi-role-1')), {
    role: 'dressage',
    roles: ['speaker', 'dressage'],
    accessCode: 'dressage-pin',
    email: 'multi@example.com',
    joinedAt: '2026-06-08T10:00:00Z'
  }));
});

test('competition admins may delete joined admin documents', { skip: !HAS_EMULATOR }, async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, compPath('admins/delete-target-1')), {
      role: 'speaker',
      roles: ['speaker'],
      email: 'delete-target@example.com'
    });
  });

  await seedCompetitionRole('admin-delete-1', 'admin', 'admin-delete@example.com');
  const db = testEnv.authenticatedContext('admin-delete-1', { email_verified: true, email: 'admin-delete@example.com' }).firestore();
  await assertSucceeds(deleteDoc(doc(db, compPath('admins/delete-target-1'))));
});

test('self-service equipage update is allowed for matching email and allowed fields', { skip: !HAS_EMULATOR }, async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, compPath('equipages/eq-1')), {
      startNumber: 1,
      driverName: 'Driver One',
      clubName: 'Old Club',
      speakerNotes: ''
    });
    await setDoc(doc(db, compPath('equipagePrivate/eq-1')), {
      email: 'driver@example.com'
    });
  });

  const ctx = testEnv.authenticatedContext('driver-1', { email_verified: true, email: 'driver@example.com' });
  const db = ctx.firestore();

  await assertSucceeds(updateDoc(doc(db, compPath('equipages/eq-1')), {
    speakerNotes: 'Updated by driver',
    updatedAt: '2026-06-08T10:00:00Z'
  }));
  // The club is part of the declaration, saved by updateEquipageDeclaration
  await assertFails(updateDoc(doc(db, compPath('equipages/eq-1')), { clubName: 'New Club' }));
});

test('self-service equipage update is denied for disallowed fields even with matching email', { skip: !HAS_EMULATOR }, async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, compPath('equipages/eq-1b')), {
      startNumber: 1,
      driverName: 'Driver One',
      clubName: 'Old Club',
      speakerNotes: ''
    });
    await setDoc(doc(db, compPath('equipagePrivate/eq-1b')), {
      email: 'driver@example.com'
    });
  });

  const ctx = testEnv.authenticatedContext('driver-1b', { email_verified: true, email: 'driver@example.com' });
  const db = ctx.firestore();

  await assertFails(updateDoc(doc(db, compPath('equipages/eq-1b')), {
    driverName: 'Changed Name'
  }));
});

test('self-service equipage update is denied for mismatched email', { skip: !HAS_EMULATOR }, async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, compPath('equipages/eq-2')), {
      startNumber: 2,
      driverName: 'Driver Two',
      clubName: 'Original Club'
    });
    await setDoc(doc(db, compPath('equipagePrivate/eq-2')), {
      email: 'owner@example.com'
    });
  });

  const ctx = testEnv.authenticatedContext('driver-2', { email_verified: true, email: 'other@example.com' });
  const db = ctx.firestore();

  await assertFails(updateDoc(doc(db, compPath('equipages/eq-2')), {
    clubName: 'Hacked Club'
  }));
});

test('speaker role may update speaker notes but no other equipage field', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('speaker-eq-1', 'speaker', 'speaker-eq@example.com');
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, compPath('equipages/eq-speaker-1')), {
      startNumber: 3,
      driverName: 'Original Driver',
      clubName: 'Original Club'
    });
    await setDoc(doc(db, compPath('equipagePrivate/eq-speaker-1')), {
      email: 'owner@example.com'
    });
  });

  const ctx = testEnv.authenticatedContext('speaker-eq-1', { email_verified: true, email: 'speaker-eq@example.com' });
  const db = ctx.firestore();

  await assertSucceeds(updateDoc(doc(db, compPath('equipages/eq-speaker-1')), {
    speakerNotes: 'Första start i klassen'
  }));
  await assertFails(updateDoc(doc(db, compPath('equipages/eq-speaker-1')), {
    driverName: 'Speaker Edited Driver'
  }));
  await assertFails(updateDoc(doc(db, compPath('equipages/eq-speaker-1')), {
    status: 'struken'
  }));
});

test('officials contact details: admins and the official, not the other competition roles', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('marathon-pin-1', 'marathon', 'marathon-pin@example.com');
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, compPath('officials/off-1')), { name: 'Anna', role: 'Hinderdomare' });
    await setDoc(doc(db, compPath('officialsPrivate/off-1')), { email: 'anna@example.com', phone: '070', icePhone: '071' });
  });
  const pinRoleDb = testEnv.authenticatedContext('marathon-pin-1', { email_verified: true, email: 'marathon-pin@example.com' }).firestore();
  await assertSucceeds(getDoc(doc(pinRoleDb, compPath('officials/off-1'))));
  await assertFails(getDoc(doc(pinRoleDb, compPath('officialsPrivate/off-1'))));
  await assertFails(getDocs(collection(pinRoleDb, compPath('officialsPrivate'))));

  const annaDb = testEnv.authenticatedContext('anna-uid', { email_verified: true, email: 'anna@example.com' }).firestore();
  await assertSucceeds(getDoc(doc(annaDb, compPath('officialsPrivate/off-1'))));
  await assertSucceeds(getDocs(query(collection(annaDb, compPath('officialsPrivate')), where('email', '==', 'anna@example.com'))));

  const ownerDb = testEnv.authenticatedContext('owner-1', { email_verified: true, email: 'owner@example.com' }).firestore();
  await assertSucceeds(getDocs(collection(ownerDb, compPath('officialsPrivate'))));
  await assertFails(getDocs(collection(testEnv.unauthenticatedContext().firestore(), compPath('officialsPrivate'))));
});

test('judges contact details are for admins and the judge only', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('speaker-pin-j', 'speaker', 'speaker-j@example.com');
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, compPath('judges/judge-1')), { name: 'Dora Domare', roles: [{ discipline: 'dressage', position: 'C' }] });
    await setDoc(doc(db, compPath('judgesPrivate/judge-1')), { email: 'dora@example.com', phone: '070' });
  });
  const speakerDb = testEnv.authenticatedContext('speaker-pin-j', { email_verified: true, email: 'speaker-j@example.com' }).firestore();
  await assertSucceeds(getDoc(doc(speakerDb, compPath('judges/judge-1'))));
  await assertFails(getDoc(doc(speakerDb, compPath('judgesPrivate/judge-1'))));
  await assertFails(getDocs(collection(speakerDb, compPath('judgesPrivate'))));

  const doraDb = testEnv.authenticatedContext('dora-uid', { email_verified: true, email: 'dora@example.com' }).firestore();
  await assertSucceeds(getDocs(query(collection(doraDb, compPath('judgesPrivate')), where('email', '==', 'dora@example.com'))));

  const ownerDb = testEnv.authenticatedContext('owner-1', { email_verified: true, email: 'owner@example.com' }).firestore();
  await assertSucceeds(getDocs(collection(ownerDb, compPath('judgesPrivate'))));
  await assertFails(setDoc(doc(speakerDb, compPath('judgesPrivate/judge-2')), { email: 'x@example.com' }));
});

test('drivers cannot write their horse entries directly (vet results live there)', { skip: !HAS_EMULATOR }, async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, compPath('equipages/eq-horse-1')), {
      startNumber: 5,
      horses: [{ name: 'Ella', id: 'SE001', vetStatus: 'underkänd' }]
    });
    await setDoc(doc(db, compPath('equipagePrivate/eq-horse-1')), { email: 'horse-driver@example.com' });
  });
  const db = testEnv.authenticatedContext('horse-driver', { email_verified: true, email: 'horse-driver@example.com' }).firestore();
  await assertFails(updateDoc(doc(db, compPath('equipages/eq-horse-1')), {
    horses: [{ name: 'Ella', id: 'SE001', vetStatus: 'godkänd' }]
  }));
  // The declaration goes through updateEquipageDeclaration (lock before the start, lengths)
  await assertFails(updateDoc(doc(db, compPath('equipages/eq-horse-1')), { groom: 'Anna' }));
  await assertFails(updateDoc(doc(db, compPath('equipages/eq-horse-1')), { speakerNotes: 'x'.repeat(2001) }));
  // Temperatures are not public: not on the equipage document any more
  await assertFails(updateDoc(doc(db, compPath('equipages/eq-horse-1')), {
    horseTemperatures: { SE001: { '2026-10-13_morning': { temperatureC: 37.8 } } }
  }));
  // ...but in their own private document
  await assertSucceeds(setDoc(doc(db, compPath('horseTemperatures/eq-horse-1')), {
    horseTemperatures: { SE001: { '2026-10-13_morning': { temperatureC: 37.8 } } },
    updatedAt: serverTimestamp()
  }, { merge: true }));
  await assertFails(setDoc(doc(db, compPath('horseTemperatures/eq-horse-1')), { horseTemperatures: 'x' }, { merge: true }));
});

test('the declaration cannot be changed directly; temperatures stay open while locked', { skip: !HAS_EMULATOR }, async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, compPath('equipages/eq-lock-1')), { startNumber: 6, groom: 'Bo' });
    await setDoc(doc(db, compPath('equipagePrivate/eq-lock-1')), { email: 'lock-driver@example.com' });
    await setDoc(doc(db, compPath('config/competitionMeta')), { manualLockdown: true });
  });
  const db = testEnv.authenticatedContext('lock-driver', { email_verified: true, email: 'lock-driver@example.com' }).firestore();
  await assertFails(updateDoc(doc(db, compPath('equipages/eq-lock-1')), { groom: 'Anna' }));
  await assertFails(updateDoc(doc(db, compPath('equipages/eq-lock-1')), { carriage: 'Ny vagn' }));
  await assertSucceeds(setDoc(doc(db, compPath('horseTemperatures/eq-lock-1')), {
    horseTemperatures: { SE002: { '2026-10-13_morning': { temperatureC: 37.6 } } }
  }, { merge: true }));
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), compPath('config/competitionMeta')), { manualLockdown: false });
  });
  await assertFails(updateDoc(doc(db, compPath('equipages/eq-lock-1')), { groom: 'Anna' }));
});

test('horse temperatures: owner driver, officials and admins only; the driver not once archived', { skip: !HAS_EMULATOR }, async () => {
  const temps = { SE001: { '2026-10-13_morning': { temperatureC: 37.8 } } };
  await seedCompetitionRole('temp-admin', 'admin', 'temp-admin@example.com');
  await seedCompetitionRole('temp-speaker', 'speaker', 'temp-speaker@example.com');
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, compPath('equipages/201')), { startNumber: 201 });
    await setDoc(doc(db, compPath('equipagePrivate/201')), { email: 'temp-owner@example.com' });
    await setDoc(doc(db, compPath('equipages/202')), { startNumber: 202 });
    await setDoc(doc(db, compPath('equipagePrivate/202')), { email: 'temp-other@example.com' });
    await setDoc(doc(db, compPath('horseTemperatures/201')), { horseTemperatures: temps });
  });
  const tempDoc = (db, id = '201') => doc(db, compPath(`horseTemperatures/${id}`));
  const slotPath = (slot) => new FieldPath('horseTemperatures', 'SE001', slot);

  // Public: neither anonymous nor any signed-in account
  const anonymousDb = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(tempDoc(anonymousDb)));
  await assertFails(getDocs(collection(anonymousDb, compPath('horseTemperatures'))));
  const publicDb = testEnv.authenticatedContext('temp-public', { email_verified: true, email: 'temp-public@example.com' }).firestore();
  await assertFails(getDoc(tempDoc(publicDb)));

  // Another driver: not this equipage's temperatures
  const otherDb = testEnv.authenticatedContext('temp-other', { email_verified: true, email: 'temp-other@example.com' }).firestore();
  await assertFails(getDoc(tempDoc(otherDb)));
  await assertFails(updateDoc(tempDoc(otherDb), slotPath('2026-10-13_evening'), { temperatureC: 38 }));
  await assertFails(setDoc(tempDoc(otherDb), { horseTemperatures: temps }, { merge: true }));
  // ...but their own (a new document)
  await assertSucceeds(setDoc(tempDoc(otherDb, '202'), { horseTemperatures: temps, updatedAt: serverTimestamp() }, { merge: true }));

  // The owner: per-slot writes and reads, not the whole collection, nothing else
  const ownerDb = testEnv.authenticatedContext('temp-owner', { email_verified: true, email: 'temp-owner@example.com' }).firestore();
  await assertSucceeds(updateDoc(tempDoc(ownerDb), slotPath('2026-10-13_evening'), { temperatureC: 38.1 }, 'updatedAt', serverTimestamp()));
  const ownSnap = await assertSucceeds(getDoc(tempDoc(ownerDb)));
  assert.equal(ownSnap.data().horseTemperatures.SE001['2026-10-13_evening'].temperatureC, 38.1);
  await assertFails(getDocs(collection(ownerDb, compPath('horseTemperatures'))));
  await assertFails(updateDoc(tempDoc(ownerDb), { note: 'x' }));
  const tooMany = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`H${i}`, {}]));
  await assertFails(updateDoc(tempDoc(ownerDb), { horseTemperatures: tooMany }));
  await assertFails(deleteDoc(tempDoc(ownerDb)));

  // Officials (the vet page is open to every official role) read, do not write
  const speakerDb = testEnv.authenticatedContext('temp-speaker', { email_verified: true, email: 'temp-speaker@example.com' }).firestore();
  await assertSucceeds(getDoc(tempDoc(speakerDb)));
  await assertSucceeds(getDocs(collection(speakerDb, compPath('horseTemperatures'))));
  await assertFails(updateDoc(tempDoc(speakerDb), slotPath('2026-10-14_morning'), { temperatureC: 37.5 }));
  // ...also an official by role email
  await seedRoleEmail('temp-marathon@example.com', ['marathon']);
  const roleEmailDb = testEnv.authenticatedContext('temp-marathon', { email_verified: true, email: 'temp-marathon@example.com' }).firestore();
  await assertSucceeds(getDocs(collection(roleEmailDb, compPath('horseTemperatures'))));

  // Admins read, list and write (portal admin mode)
  const adminDb = testEnv.authenticatedContext('temp-admin', { email_verified: true, email: 'temp-admin@example.com' }).firestore();
  await assertSucceeds(getDoc(tempDoc(adminDb)));
  await assertSucceeds(getDocs(collection(adminDb, compPath('horseTemperatures'))));
  await assertSucceeds(updateDoc(tempDoc(adminDb), slotPath('2026-10-14_morning'), { temperatureC: 37.5 }));

  // Archived (locked) competition: the driver reads but no longer writes
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), compPath()), { locked: true }, { merge: true });
  });
  await assertSucceeds(getDoc(tempDoc(ownerDb)));
  await assertFails(updateDoc(tempDoc(ownerDb), slotPath('2026-10-14_evening'), { temperatureC: 37.9 }));
  await assertSucceeds(updateDoc(tempDoc(adminDb), slotPath('2026-10-14_evening'), { temperatureC: 37.9 }));
  await assertSucceeds(deleteDoc(tempDoc(adminDb, '202')));
});

test('vet role: writes the vet results on the equipage, clinical findings and notes in private docs', { skip: !HAS_EMULATOR }, async () => {
  const findings = { SE001: { restArea: { pulseBpm: 60, respiration: 'normal', mucosa: 'ok', checkedAt: '2026-10-14T10:00:00Z' } } };
  await seedCompetitionRole('vet-1', 'vet', 'vet-1@example.com');
  await seedCompetitionRole('vet-admin', 'admin', 'vet-admin@example.com');
  await seedCompetitionRole('vet-speaker', 'speaker', 'vet-speaker@example.com');
  await seedCompetitionRole('vet-marathon', 'marathon', 'vet-marathon@example.com');
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, compPath('equipages/301')), {
      startNumber: 301, driverName: 'Vera', status: 'anmäld', horses: [{ name: 'Ella', id: 'SE001' }]
    });
    await setDoc(doc(db, compPath('equipagePrivate/301')), { email: 'vet-owner@example.com' });
    await setDoc(doc(db, compPath('equipages/302')), { startNumber: 302 });
    await setDoc(doc(db, compPath('equipagePrivate/302')), { email: 'vet-other@example.com' });
    await setDoc(doc(db, compPath('vetInspections/301')), { horses: findings });
    await setDoc(doc(db, compPath('vetNotes/301')), { notes: { initial: 'Lätt hälta vä bak' } });
  });
  const eqDoc = (db) => doc(db, compPath('equipages/301'));
  const findingsDoc = (db, id = '301') => doc(db, compPath(`vetInspections/${id}`));
  const notesDoc = (db, id = '301') => doc(db, compPath(`vetNotes/${id}`));
  const result = {
    status: 'besiktigad',
    updatedAt: '2026-10-14T09:00:00Z',
    horses: { SE001: { status: 'besiktigad', checkedAt: '2026-10-14T09:00:00Z' } }
  };

  // The vet: the public result and status, and the private documents
  const vetDb = testEnv.authenticatedContext('vet-1', { email_verified: true, email: 'vet-1@example.com' }).firestore();
  await assertSucceeds(setDoc(eqDoc(vetDb), { vetInspection_initial: result, status: 'besiktigad' }, { merge: true }));
  await assertSucceeds(setDoc(eqDoc(vetDb), {
    vetInspection_restArea: { ...result, status: 'struken' }, vetUnfitStageB: true
  }, { merge: true }));
  await assertSucceeds(getDoc(findingsDoc(vetDb)));
  await assertSucceeds(getDocs(collection(vetDb, compPath('vetInspections'))));
  await assertSucceeds(setDoc(findingsDoc(vetDb), {
    horses: { SE001: { final: { status: 'besiktigad', checkedAt: 'x' } } }, updatedAt: serverTimestamp()
  }, { merge: true }));
  await assertSucceeds(setDoc(findingsDoc(vetDb, '302'), { horses: findings, updatedAt: serverTimestamp() }, { merge: true }));
  await assertSucceeds(getDocs(collection(vetDb, compPath('vetNotes'))));
  await assertSucceeds(setDoc(notesDoc(vetDb), { notes: { restArea: 'Puls ok efter 10 min' }, updatedAt: serverTimestamp() }, { merge: true }));
  // ...but nothing else on the equipage, no other status, no clinical data on it
  await assertFails(updateDoc(eqDoc(vetDb), { driverName: 'Edited' }));
  await assertFails(updateDoc(eqDoc(vetDb), { horses: [{ name: 'Annan', id: 'SE001' }] }));
  await assertFails(updateDoc(eqDoc(vetDb), { status: 'reserv' }));
  await assertFails(updateDoc(eqDoc(vetDb), { vetInspection_final: { ...result, pulseBpm: 60 } }));
  await assertFails(updateDoc(eqDoc(vetDb), { trackWidth: 140 }));
  await assertFails(setDoc(notesDoc(vetDb), { notes: { other: 'x' } }, { merge: true }));
  await assertFails(setDoc(findingsDoc(vetDb), { email: 'x@example.com' }, { merge: true }));
  // A limited role: no admin data (contact details, PINs), no temperature writes
  await assertFails(getDoc(doc(vetDb, compPath('equipagePrivate/301'))));
  await assertFails(getDoc(doc(vetDb, compPath('config/secrets'))));
  await assertSucceeds(getDocs(collection(vetDb, compPath('horseTemperatures'))));
  await assertFails(setDoc(doc(vetDb, compPath('horseTemperatures/301')), { horseTemperatures: {} }, { merge: true }));
  await assertFails(setDoc(doc(vetDb, compPath('precision/301')), { totalPenalty: 0 }));
  await assertFails(deleteDoc(findingsDoc(vetDb)));

  // Other officials: neither the findings nor the notes, no vet writes
  for (const uid of ['vet-speaker', 'vet-marathon']) {
    const db = testEnv.authenticatedContext(uid, { email_verified: true, email: `${uid}@example.com` }).firestore();
    await assertFails(getDoc(findingsDoc(db)));
    await assertFails(getDoc(notesDoc(db)));
    await assertFails(setDoc(findingsDoc(db), { horses: findings }, { merge: true }));
    await assertFails(setDoc(notesDoc(db), { notes: { initial: 'x' } }, { merge: true }));
    await assertFails(setDoc(eqDoc(db), { vetInspection_initial: result, status: 'struken' }, { merge: true }));
  }

  // The public: the result on the equipage, never the findings or notes
  const anonymousDb = testEnv.unauthenticatedContext().firestore();
  const publicEq = await assertSucceeds(getDoc(eqDoc(anonymousDb)));
  assert.equal(publicEq.data().vetInspection_initial.horses.SE001.status, 'besiktigad');
  assert.equal(publicEq.data().pulseBpm, undefined);
  await assertFails(getDoc(findingsDoc(anonymousDb)));
  await assertFails(getDocs(collection(anonymousDb, compPath('vetInspections'))));
  await assertFails(getDoc(notesDoc(anonymousDb)));
  await assertFails(getDocs(collection(anonymousDb, compPath('vetNotes'))));
  const publicDb = testEnv.authenticatedContext('vet-public', { email_verified: true, email: 'vet-public@example.com' }).firestore();
  await assertFails(getDoc(findingsDoc(publicDb)));

  // The driver: reads their own findings (not others', not the list, not the
  // notes) and writes nothing of the vet's
  const ownerDb = testEnv.authenticatedContext('vet-owner', { email_verified: true, email: 'vet-owner@example.com' }).firestore();
  const own = await assertSucceeds(getDoc(findingsDoc(ownerDb)));
  assert.equal(own.data().horses.SE001.restArea.pulseBpm, 60);
  await assertFails(getDoc(findingsDoc(ownerDb, '302')));
  await assertFails(getDocs(collection(ownerDb, compPath('vetInspections'))));
  await assertFails(getDoc(notesDoc(ownerDb)));
  await assertFails(setDoc(findingsDoc(ownerDb), { horses: findings }, { merge: true }));
  await assertFails(setDoc(eqDoc(ownerDb), { vetInspection_initial: { ...result, status: 'ombesiktning' }, status: 'ombesiktning' }, { merge: true }));
  const unverifiedDb = testEnv.authenticatedContext('vet-owner-2', { email_verified: false, email: 'vet-owner@example.com' }).firestore();
  await assertFails(getDoc(findingsDoc(unverifiedDb)));

  // Admins: everything, deletes included
  const adminDb = testEnv.authenticatedContext('vet-admin', { email_verified: true, email: 'vet-admin@example.com' }).firestore();
  await assertSucceeds(getDocs(collection(adminDb, compPath('vetInspections'))));
  await assertSucceeds(getDoc(notesDoc(adminDb)));
  await assertSucceeds(setDoc(notesDoc(adminDb), { notes: { initial: 'Admin' } }, { merge: true }));
  await assertSucceeds(deleteDoc(findingsDoc(adminDb, '302')));

  // Archived: the vet no longer writes
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), compPath()), { locked: true }, { merge: true });
  });
  await assertFails(setDoc(findingsDoc(vetDb), { horses: findings }, { merge: true }));
  await assertFails(setDoc(eqDoc(vetDb), { status: 'ombesiktning' }, { merge: true }));
  await assertSucceeds(getDoc(findingsDoc(vetDb)));
});

test('vet role by role email and in a draft competition', { skip: !HAS_EMULATOR }, async () => {
  await seedRoleEmail('vet-mail@example.com', ['vet']);
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, compPath()), { published: false }, { merge: true });
    await setDoc(doc(db, compPath('equipages/401')), { startNumber: 401, status: 'anmäld' });
  });
  const vetDb = testEnv.authenticatedContext('vet-mail', { email_verified: true, email: 'vet-mail@example.com' }).firestore();
  await assertSucceeds(getDoc(doc(vetDb, compPath('equipages/401'))));
  await assertSucceeds(setDoc(doc(vetDb, compPath('equipages/401')), { status: 'ombesiktning' }, { merge: true }));
  await assertSucceeds(setDoc(doc(vetDb, compPath('vetNotes/401')), { notes: { initial: 'Ombesiktning kl 16' } }, { merge: true }));
  // An unverified address does not get the role
  const unverifiedDb = testEnv.authenticatedContext('vet-mail-2', { email_verified: false, email: 'vet-mail@example.com' }).firestore();
  await assertFails(getDoc(doc(unverifiedDb, compPath('vetNotes/401'))));
});

test('precision officials record carriage widths, nothing else on the equipage', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('width-precision', 'precision', 'width-precision@example.com');
  await seedCompetitionRole('width-speaker', 'speaker', 'width-speaker@example.com');
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), compPath('equipages/501')), { startNumber: 501, driverName: 'Wilma' });
  });
  const widths = { trackWidth: 140, marathonTrackWidth: 128, safetyCheck: { approved: true, comment: '' } };
  const precisionDb = testEnv.authenticatedContext('width-precision', { email_verified: true, email: 'width-precision@example.com' }).firestore();
  await assertSucceeds(setDoc(doc(precisionDb, compPath('equipages/501')), widths, { merge: true }));
  await assertFails(updateDoc(doc(precisionDb, compPath('equipages/501')), { driverName: 'X' }));
  await assertFails(updateDoc(doc(precisionDb, compPath('equipages/501')), { status: 'struken' }));
  const speakerDb = testEnv.authenticatedContext('width-speaker', { email_verified: true, email: 'width-speaker@example.com' }).firestore();
  await assertFails(setDoc(doc(speakerDb, compPath('equipages/501')), { ...widths, trackWidth: 150 }, { merge: true }));
});

test('private equipage data is not public but readable by owner and admin', { skip: !HAS_EMULATOR }, async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, compPath('equipagePrivate/eq-private-1')), {
      email: 'private-owner@example.com',
      phone: '0700000000'
    });
  });

  const anonymousDb = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(anonymousDb, compPath('equipagePrivate/eq-private-1'))));

  const ownerDb = testEnv.authenticatedContext('private-owner-1', { email_verified: true, email: 'private-owner@example.com' }).firestore();
  await assertSucceeds(getDoc(doc(ownerDb, compPath('equipagePrivate/eq-private-1'))));
  await assertSucceeds(getDocs(query(collection(ownerDb, compPath('equipagePrivate')), where('email', '==', 'private-owner@example.com'))));

  await seedCompetitionRole('admin-private-1', 'admin', 'admin-private@example.com');
  const adminDb = testEnv.authenticatedContext('admin-private-1', { email_verified: true, email: 'admin-private@example.com' }).firestore();
  await assertSucceeds(getDoc(doc(adminDb, compPath('equipagePrivate/eq-private-1'))));
});

test('private role email docs are not public but readable by owner and admin', { skip: !HAS_EMULATOR }, async () => {
  await seedRoleEmail('role-owner@example.com', ['dressage']);

  const anonymousDb = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(anonymousDb, compPath('roleEmails/role-owner@example.com'))));

  const ownerDb = testEnv.authenticatedContext('role-owner-1', { email_verified: true, email: 'role-owner@example.com' }).firestore();
  await assertSucceeds(getDoc(doc(ownerDb, compPath('roleEmails/role-owner@example.com'))));

  await seedCompetitionRole('admin-role-email-1', 'admin', 'admin-role-email@example.com');
  const adminDb = testEnv.authenticatedContext('admin-role-email-1', { email_verified: true, email: 'admin-role-email@example.com' }).firestore();
  await assertSucceeds(getDoc(doc(adminDb, compPath('roleEmails/role-owner@example.com'))));
});

test('private role email docs grant discipline access without public competition email arrays', { skip: !HAS_EMULATOR }, async () => {
  await seedRoleEmail('dressage-role@example.com', ['dressage']);

  const db = testEnv.authenticatedContext('dressage-role-1', { email_verified: true, email: 'dressage-role@example.com' }).firestore();
  await assertSucceeds(setDoc(doc(db, compPath(`dressage/${START_NO}/protocols/c`)), {
    judgeId: 'c',
    movements: [{ momentNo: 1, score: 8 }]
  }));
});

test('precision result writes are denied when the equipage is finalized', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('precision-1', 'precision', 'precision@example.com');
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, rootCompPath(`precisionFinalization/${START_NO}`)), {
      finalized: true
    });
  });

  const ctx = testEnv.authenticatedContext('precision-1', { email_verified: true, email: 'precision@example.com' });
  const db = ctx.firestore();

  await assertFails(setDoc(doc(db, compPath(`precision/${START_NO}`)), {
    startNumber: Number(START_NO),
    timeMs: 100000
  }));
});

test('an archived competition takes no result writes at all; the admin reopens it first', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('precision-arch', 'precision', 'precision-arch@example.com');
  await seedCompetitionRole('dressage-arch', 'dressage', 'dressage-arch@example.com');
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), compPath()), { locked: true, status: 'completed' });
  });
  const precisionDb = testEnv.authenticatedContext('precision-arch', { email_verified: true, email: 'precision-arch@example.com' }).firestore();
  const dressageDb = testEnv.authenticatedContext('dressage-arch', { email_verified: true, email: 'dressage-arch@example.com' }).firestore();
  await assertFails(setDoc(doc(precisionDb, compPath(`precision/${START_NO}`)), { timeMs: 1 }));
  await assertFails(setDoc(doc(dressageDb, compPath(`dressage/${START_NO}/protocols/judge_x`)), { movements: [] }));

  // Not even the owner while archived
  const ownerDb = testEnv.authenticatedContext('owner-1', { email_verified: true, email: 'owner@example.com' }).firestore();
  await assertFails(setDoc(doc(ownerDb, compPath(`precision/${START_NO}`)), { timeMs: 2 }));

  // The owner reopens it; then results can be written again
  await assertSucceeds(updateDoc(doc(ownerDb, compPath()), { locked: false, status: 'active' }));
  await assertSucceeds(setDoc(doc(ownerDb, compPath(`precision/${START_NO}`)), { timeMs: 2 }));
  await assertSucceeds(setDoc(doc(precisionDb, compPath(`precision/${START_NO}`)), { timeMs: 3 }));
});

test('a draft competition is hidden from the public but open to its staff', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('precision-draft', 'precision', 'precision-draft@example.com');
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await updateDoc(doc(db, compPath()), { published: false, createdAt: 1, admins: ['co-admin-1'] });
    await setDoc(doc(db, compPath(`equipages/${START_NO}`)), { startNumber: Number(START_NO), driverName: 'Draft Driver' });
    await setDoc(doc(db, compPath('startTimes/dressage')), { times: {} });
    await setDoc(doc(db, compPath('config/maratonConfig')), { classes: {} });
    await setDoc(doc(db, `artifacts/${APP_ID}/public/data/competitions/comp-pub`), { name: 'Published', published: true, createdAt: 2 });
    await setDoc(doc(db, `artifacts/${APP_ID}/public/data/competitions/comp-legacy`), { name: 'Legacy', createdAt: 3 });
  });
  const publicDb = testEnv.unauthenticatedContext().firestore();
  const strangerDb = testEnv.authenticatedContext('stranger-1', { email_verified: true, email: 'stranger@example.com' }).firestore();
  const staffDb = testEnv.authenticatedContext('precision-draft', { email_verified: true, email: 'precision-draft@example.com' }).firestore();
  const ownerDb = testEnv.authenticatedContext('owner-1', { email_verified: true, email: 'owner@example.com' }).firestore();
  const competitions = `artifacts/${APP_ID}/public/data/competitions`;

  for (const db of [publicDb, strangerDb]) {
    await assertFails(getDoc(doc(db, compPath())));
    await assertFails(getDoc(doc(db, compPath(`equipages/${START_NO}`))));
    await assertFails(getDocs(collection(db, compPath('equipages'))));
    await assertFails(getDoc(doc(db, compPath('startTimes/dressage'))));
    await assertFails(getDoc(doc(db, compPath('config/maratonConfig'))));
    // An unfiltered list could return the draft, so it is refused as a whole
    await assertFails(getDocs(collection(db, competitions)));
    await assertSucceeds(getDocs(query(collection(db, competitions), where('published', '==', true))));
    // Published and older competitions (no field) stay public
    await assertSucceeds(getDoc(doc(db, `${competitions}/comp-pub`)));
    await assertSucceeds(getDoc(doc(db, `${competitions}/comp-legacy`)));
  }

  for (const db of [staffDb, ownerDb]) {
    await assertSucceeds(getDoc(doc(db, compPath())));
    await assertSucceeds(getDoc(doc(db, compPath(`equipages/${START_NO}`))));
    await assertSucceeds(getDocs(collection(db, compPath('equipages'))));
    await assertSucceeds(getDoc(doc(db, compPath('startTimes/dressage'))));
  }
  // The creator and a co-admin list their own drafts
  const coAdminDb = testEnv.authenticatedContext('co-admin-1', { email_verified: true, email: 'co-admin@example.com' }).firestore();
  await assertSucceeds(getDocs(query(collection(coAdminDb, competitions), where('admins', 'array-contains', 'co-admin-1'))));
  await assertFails(getDocs(query(collection(strangerDb, competitions), where('admins', 'array-contains', 'co-admin-1'))));
  await assertSucceeds(getDocs(query(collection(ownerDb, competitions), where('createdBy', '==', 'owner-1'))));

  // Published again: public as before
  await assertSucceeds(updateDoc(doc(ownerDb, compPath()), { published: true }));
  await assertSucceeds(getDoc(doc(publicDb, compPath(`equipages/${START_NO}`))));
});

test('archive snapshots are created by admins and never changed', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('precision-snap', 'precision', 'precision-snap@example.com');
  const ownerDb = testEnv.authenticatedContext('owner-1', { email_verified: true, email: 'owner@example.com' }).firestore();
  const judgeDb = testEnv.authenticatedContext('precision-snap', { email_verified: true, email: 'precision-snap@example.com' }).firestore();
  const snapshot = compPath('archive/snapshot_1');

  await assertFails(setDoc(doc(judgeDb, snapshot), { rows: [] }));
  await assertSucceeds(setDoc(doc(ownerDb, snapshot), { rows: [], archivedAt: 1 }));
  await assertFails(setDoc(doc(ownerDb, snapshot), { rows: [{ startNumber: '1' }] }));
  await assertFails(deleteDoc(doc(ownerDb, snapshot)));
  await assertSucceeds(getDoc(doc(testEnv.unauthenticatedContext().firestore(), snapshot)));
});

test('precision result writes are allowed when the equipage is not finalized', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('precision-2', 'precision', 'precision2@example.com');
  const ctx = testEnv.authenticatedContext('precision-2', { email_verified: true, email: 'precision2@example.com' });
  const db = ctx.firestore();

  await assertSucceeds(setDoc(doc(db, compPath(`precision/${START_NO}`)), {
    startNumber: Number(START_NO),
    timeMs: 100000
  }));
});

test('finalizing writes result and lock in one batch, after which the judge is locked out', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('precision-fin-3', 'precision', 'precision3@example.com');
  const db = testEnv.authenticatedContext('precision-fin-3', { email_verified: true, email: 'precision3@example.com' }).firestore();
  await assertSucceeds(setDoc(doc(db, compPath(`precision/${START_NO}`)), { startNumber: Number(START_NO), timeMs: 100000 }));

  for (const [result, discipline] of [
    [compPath(`precision/${START_NO}`), 'precision'],
    [compPath(`maraton/${START_NO}`), 'marathon']
  ]) {
    const adminDb = testEnv.authenticatedContext('owner-1', { email_verified: true, email: 'owner@example.com' }).firestore();
    const batch = writeBatch(adminDb);
    batch.set(doc(adminDb, result), { finalized: true }, { merge: true });
    setLoggedLock(batch, adminDb, 'owner-1', discipline, true);
    await assertSucceeds(batch.commit());
  }
  await assertFails(setDoc(doc(db, compPath(`precision/${START_NO}`)), { timeMs: 1 }, { merge: true }));
});

test('unlocking writes lock and result in one batch; a locked result alone stays refused', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('precision-unlock-1', 'precision', 'precision-unlock@example.com');
  const db = testEnv.authenticatedContext('precision-unlock-1', { email_verified: true, email: 'precision-unlock@example.com' }).firestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();
    await setDoc(doc(adminDb, compPath(`precision/${START_NO}`)), { startNumber: Number(START_NO), timeMs: 100000, finalized: true });
    await setDoc(doc(adminDb, rootCompPath(`precisionFinalization/${START_NO}`)), { finalized: true });
  });

  // Locked: the result alone cannot be written
  await assertFails(setDoc(doc(db, compPath(`precision/${START_NO}`)), { finalized: false }, { merge: true }));

  // Unlock lock and result together
  const batch = writeBatch(db);
  setLoggedLock(batch, db, 'precision-unlock-1', 'precision', false);
  batch.set(doc(db, compPath(`precision/${START_NO}`)), { finalized: false }, { merge: true });
  await assertSucceeds(batch.commit());
});

test('a lock change must come with its own finalizationLog entry', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('precision-log-1', 'precision', 'precision-log@example.com');
  const db = testEnv.authenticatedContext('precision-log-1', { email_verified: true, email: 'precision-log@example.com' }).firestore();
  const lock = doc(db, rootCompPath(`precisionFinalization/${START_NO}`));

  // Without a log entry, or naming one that is not written
  await assertFails(setDoc(lock, { finalized: true }));
  await assertFails(setDoc(lock, { finalized: true, lastLogId: 'missing' }));

  // Logged: accepted
  const logRef = await (async () => { const b = writeBatch(db); const r = setLoggedLock(b, db, 'precision-log-1', 'precision', true); await assertSucceeds(b.commit()); return r; })();

  // Unlocking by pointing at the old (finalize) entry is refused, and so is a
  // log entry that says the wrong action or result
  await assertFails(setDoc(lock, { finalized: false, lastLogId: logRef.id }, { merge: true }));
  const wrong = writeBatch(db);
  const wrongLog = doc(collection(db, rootCompPath('finalizationLog')));
  wrong.set(wrongLog, { discipline: 'precision', action: 'finalize', startNumber: START_NO, by: 'precision-log-1', byName: null, at: serverTimestamp() });
  wrong.set(lock, { finalized: false, lastLogId: wrongLog.id }, { merge: true });
  await assertFails(wrong.commit());

  // An optional reason is kept; anything else unknown, or an overlong reason, is refused
  const withReason = writeBatch(db);
  const reasonLog = doc(collection(db, rootCompPath('finalizationLog')));
  withReason.set(reasonLog, { discipline: 'precision', action: 'unfinalize', startNumber: START_NO, by: 'precision-log-1', byName: null, reason: 'Protest godkänd', at: serverTimestamp() });
  withReason.set(lock, { finalized: false, lastLogId: reasonLog.id }, { merge: true });
  await assertSucceeds(withReason.commit());
  await assertFails(setDoc(doc(collection(db, rootCompPath('finalizationLog'))), { discipline: 'precision', action: 'finalize', startNumber: START_NO, by: 'precision-log-1', byName: null, reason: 'x'.repeat(501), at: serverTimestamp() }));
  await assertFails(setDoc(doc(collection(db, rootCompPath('finalizationLog'))), { discipline: 'precision', action: 'finalize', startNumber: START_NO, by: 'precision-log-1', byName: null, extra: 1, at: serverTimestamp() }));

  // A valid entry on its own (no lock change naming it) is refused
  await assertFails(setDoc(doc(collection(db, rootCompPath('finalizationLog'))), { discipline: 'precision', action: 'finalize', startNumber: START_NO, by: 'precision-log-1', byName: null, at: serverTimestamp() }));

  // Entries cannot be forged for someone else, changed or removed
  await assertFails(setDoc(doc(collection(db, rootCompPath('finalizationLog'))), { discipline: 'precision', action: 'unfinalize', startNumber: START_NO, by: 'someone-else', byName: null, at: serverTimestamp() }));
  await assertFails(updateDoc(doc(db, rootCompPath(`finalizationLog/${logRef.id}`)), { byName: 'x' }));
  await assertFails(deleteDoc(doc(db, rootCompPath(`finalizationLog/${logRef.id}`))));
  await assertFails(deleteDoc(lock));

  // Readable by the competition's admins only
  const ownerDb = testEnv.authenticatedContext('owner-1', { email_verified: true, email: 'owner@example.com' }).firestore();
  await assertSucceeds(getDoc(doc(ownerDb, rootCompPath(`finalizationLog/${logRef.id}`))));
  await assertFails(getDoc(doc(db, rootCompPath(`finalizationLog/${logRef.id}`))));
  await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), rootCompPath(`finalizationLog/${logRef.id}`))));
});

test('competition discipline roles may finalize only their matching discipline', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('precision-finalizer-1', 'precision', 'precision-finalizer@example.com');
  const ctx = testEnv.authenticatedContext('precision-finalizer-1', { email_verified: true, email: 'precision-finalizer@example.com' });
  const db = ctx.firestore();

  await assertSucceeds(commitLoggedLock(db, 'precision-finalizer-1', 'precision', true));
  await assertFails(commitLoggedLock(db, 'precision-finalizer-1', 'dressage', true));
});

test('email-scoped discipline roles may finalize via private roleEmails docs', { skip: !HAS_EMULATOR }, async () => {
  await seedRoleEmail('dressage-role@example.com', ['dressage']);
  const ctx = testEnv.authenticatedContext('dressage-role-1', { email_verified: true, email: 'dressage-role@example.com' });
  const db = ctx.firestore();

  await assertSucceeds(commitLoggedLock(db, 'dressage-role-1', 'dressage', true));
  await assertFails(commitLoggedLock(db, 'dressage-role-1', 'marathon', true));
});

test('global non-admin roles may not finalize competitions without a scoped role', { skip: !HAS_EMULATOR }, async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'users/global-judge-1'), {
      email: 'global-judge@example.com',
      role: 'domare'
    });
  });

  const ctx = testEnv.authenticatedContext('global-judge-1', { email_verified: true, email: 'global-judge@example.com' });
  const db = ctx.firestore();

  await assertFails(commitLoggedLock(db, 'global-judge-1', 'dressage', true));
});

test('dressage protocol writes are denied when the equipage is finalized', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('dressage-1', 'dressage', 'dressage@example.com');
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, rootCompPath(`dressageFinalization/${START_NO}`)), {
      finalized: true
    });
  });

  const ctx = testEnv.authenticatedContext('dressage-1', { email_verified: true, email: 'dressage@example.com' });
  const db = ctx.firestore();

  await assertFails(setDoc(doc(db, compPath(`dressage/${START_NO}/protocols/c`)), {
    judgeId: 'c',
    movements: [{ momentNo: 1, score: 8 }]
  }));
});

test('marathon writes are denied when the equipage is finalized', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('marathon-1', 'marathon', 'marathon@example.com');
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, rootCompPath(`marathonFinalization/${START_NO}`)), {
      finalized: true
    });
  });

  const ctx = testEnv.authenticatedContext('marathon-1', { email_verified: true, email: 'marathon@example.com' });
  const db = ctx.firestore();

  await assertFails(setDoc(doc(db, compPath(`maraton/${START_NO}`)), {
    startNumber: Number(START_NO),
    eliminated: false
  }));
  // Nor a per-obstacle result or live entry
  await assertFails(setDoc(doc(db, compPath(`maraton/${START_NO}`)), {
    obstacleResults: { 2: { number: 2, timeMs: 30000 } }
  }, { merge: true }));
  await assertFails(setDoc(doc(db, compPath(`maraton/${START_NO}`)), {
    obstacleLive: { 2: { running: true } }
  }, { merge: true }));
});

test('marathon officials write per-obstacle results and live entries; the public reads, others may not write', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('marathon-2', 'marathon', 'marathon2@example.com');
  const judge = testEnv.authenticatedContext('marathon-2', { email_verified: true, email: 'marathon2@example.com' }).firestore();
  const ref = doc(judge, compPath(`maraton/${START_NO}`));
  // Two obstacles, each its own entry (merge)
  await assertSucceeds(setDoc(ref, { obstacleLive: { 3: { running: true, inProgress: true } } }, { merge: true }));
  await assertSucceeds(setDoc(ref, {
    obstacleResults: { 2: { number: 2, timeMs: 30000 } },
    obstacleLive: { 2: { running: false, inProgress: false } }
  }, { merge: true }));
  await assertSucceeds(setDoc(doc(judge, compPath(`maratonResults/${START_NO}/obstacles/2`)), { obstacleNumber: 2, timeMs: 30000 }, { merge: true }));

  const anon = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(anon, compPath(`maraton/${START_NO}`))));
  await assertFails(setDoc(doc(anon, compPath(`maraton/${START_NO}`)), { obstacleLive: { 3: { running: false } } }, { merge: true }));
});

test('computed_equipages stays server-write-only even for admin role', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('admin-computed-1', 'admin', 'admin-computed@example.com');
  const ctx = testEnv.authenticatedContext('admin-computed-1', { email_verified: true, email: 'admin-computed@example.com' });
  const db = ctx.firestore();

  await assertFails(setDoc(doc(db, compPath('computed_equipages/eq-1')), {
    startNumber: 1,
    totalPenalty: 12.5
  }));
});

test('public competition config is readable while secrets config is not', { skip: !HAS_EMULATOR }, async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, compPath('config/display')), {
      title: 'Visible Config'
    });
  });

  const anonymousDb = testEnv.unauthenticatedContext().firestore();

  await assertSucceeds(getDoc(doc(anonymousDb, compPath('config/display'))));
  await assertFails(getDoc(doc(anonymousDb, compPath('config/secrets'))));
});

test('competition admins may read secrets config while non-admin competition roles may not', { skip: !HAS_EMULATOR }, async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, compPath('config/secrets')), {
      adminCode: '1234',
      speakerCode: '5678'
    });
  });

  await seedCompetitionRole('admin-secret-1', 'admin', 'admin-secret@example.com');
  await seedCompetitionRole('speaker-secret-1', 'speaker', 'speaker-secret@example.com');

  const adminDb = testEnv.authenticatedContext('admin-secret-1', { email_verified: true, email: 'admin-secret@example.com' }).firestore();
  const speakerDb = testEnv.authenticatedContext('speaker-secret-1', { email_verified: true, email: 'speaker-secret@example.com' }).firestore();

  await assertSucceeds(getDoc(doc(adminDb, compPath('config/secrets'))));
  await assertFails(getDoc(doc(speakerDb, compPath('config/secrets'))));
});

test('admin may write public config and secrets config', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('admin-config-1', 'admin', 'admin-config@example.com');
  const ctx = testEnv.authenticatedContext('admin-config-1', { email_verified: true, email: 'admin-config@example.com' });
  const db = ctx.firestore();

  await assertSucceeds(setDoc(doc(db, compPath('config/display')), {
    title: 'Admin Updated'
  }));

  await assertSucceeds(setDoc(doc(db, compPath('config/secrets')), {
    accessCode_speaker: 'ABCDEFGHJK'
  }));
});

test('secrets: role codes must be strong, the admin PIN can only be removed, expiry is a day', { skip: !HAS_EMULATOR }, async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), compPath('config/secrets')), {
      accessCode: '12345678',
      accessCode_marathon: '87654321'
    });
  });
  await seedCompetitionRole('admin-codes-1', 'admin', 'admin-codes@example.com');
  const db = testEnv.authenticatedContext('admin-codes-1', { email_verified: true, email: 'admin-codes@example.com' }).firestore();
  const ref = doc(db, compPath('config/secrets'));

  // Strong codes (10-12 symbols, no 0/O/1/I), grouped dashes are not stored
  await assertSucceeds(setDoc(ref, { accessCode_marathon: 'MNPQRSTUVW', accessCode_vet: 'ABCDEFGHJKLM' }, { merge: true }));
  await assertFails(setDoc(ref, { accessCode_dressage: '12345678' }, { merge: true }));
  await assertFails(setDoc(ref, { accessCode_dressage: 'ABCD-EFGH-JK' }, { merge: true }));
  await assertFails(setDoc(ref, { accessCode_dressage: 'ABCDEFGHJ0' }, { merge: true }));
  // Untouched old fields do not block other writes
  await assertSucceeds(setDoc(ref, { updatedAt: 1 }, { merge: true }));
  // The admin PIN: no new value, removing it is fine
  await assertFails(setDoc(ref, { accessCode: 'NEWADMINPIN' }, { merge: true }));
  await assertSucceeds(setDoc(ref, { accessCode: deleteField() }, { merge: true }));
  // Expiry: a day or nothing
  await assertSucceeds(setDoc(ref, { accessCodesExpireAt: '2026-05-18' }, { merge: true }));
  await assertSucceeds(setDoc(ref, { accessCodesExpireAt: null }, { merge: true }));
  await assertFails(setDoc(ref, { accessCodesExpireAt: 'tomorrow' }, { merge: true }));
});

test('admins/{uid} (code joins) are written by the server only; admins may delete them', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('admin-joins-1', 'admin', 'admin-joins@example.com');
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), compPath('admins/joined-speaker')), { role: 'speaker', roles: ['speaker'], email: 's@example.com' });
  });
  const adminDb = testEnv.authenticatedContext('admin-joins-1', { email_verified: true, email: 'admin-joins@example.com' }).firestore();
  const selfDb = testEnv.authenticatedContext('self-joiner', { email_verified: true, email: 'self@example.com' }).firestore();
  await assertFails(setDoc(doc(selfDb, compPath('admins/self-joiner')), { role: 'admin', roles: ['admin'] }));
  await assertFails(updateDoc(doc(adminDb, compPath('admins/joined-speaker')), { roles: ['speaker', 'admin'] }));
  await assertSucceeds(deleteDoc(doc(adminDb, compPath('admins/joined-speaker'))));
});

test('an admins/{uid} doc without role or roles grants nothing', { skip: !HAS_EMULATOR }, async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, compPath('admins/no-role-user')), { email: 'norole@example.com', joinedAt: 1 });
    await setDoc(doc(db, compPath('config/secrets')), { accessCode_speaker: 'ABCDEFGHJK' });
  });
  const db = testEnv.authenticatedContext('no-role-user', { email_verified: true, email: 'norole@example.com' }).firestore();
  // Not an admin: no secrets, no private collections, no competition settings
  await assertFails(getDoc(doc(db, compPath('config/secrets'))));
  await assertFails(getDocs(collection(db, compPath('volunteerSignups'))));
  await assertFails(setDoc(doc(db, compPath('config/display')), { title: 'x' }));
  // Not staff either: no officials list
  await assertFails(getDocs(collection(db, compPath('officials'))));
  // The own doc stays readable (the hub lists it)
  await assertSucceeds(getDoc(doc(db, compPath('admins/no-role-user'))));
});

test('volunteer signups: admins set the approval status only', { skip: !HAS_EMULATOR }, async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), compPath('volunteerSignups/signup-status')), {
      name: 'Volunteer', email: 'v@example.com', status: 'new', createdAt: 1
    });
  });
  await seedCompetitionRole('admin-signups-1', 'admin', 'admin-signups@example.com');
  await seedCompetitionRole('speaker-signups-1', 'speaker', 'speaker-signups@example.com');
  const adminDb = testEnv.authenticatedContext('admin-signups-1', { email_verified: true, email: 'admin-signups@example.com' }).firestore();
  const speakerDb = testEnv.authenticatedContext('speaker-signups-1', { email_verified: true, email: 'speaker-signups@example.com' }).firestore();
  const adminRef = doc(adminDb, compPath('volunteerSignups/signup-status'));

  await assertFails(updateDoc(doc(speakerDb, compPath('volunteerSignups/signup-status')), { status: 'approved' }));
  await assertFails(updateDoc(adminRef, { email: 'other@example.com' }));
  await assertFails(updateDoc(adminRef, { status: 'whatever' }));
  await assertFails(updateDoc(adminRef, { status: 'approved', statusBy: 'someone-else' }));
  await assertSucceeds(updateDoc(adminRef, { status: 'approved', statusAt: 2, statusBy: 'admin-signups-1', officialId: 'off-1' }));
});

test('non-admin competition role may not write config documents', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('speaker-config-1', 'speaker', 'speaker-config@example.com');
  const ctx = testEnv.authenticatedContext('speaker-config-1', { email_verified: true, email: 'speaker-config@example.com' });
  const db = ctx.firestore();

  await assertFails(setDoc(doc(db, compPath('config/display')), {
    title: 'Speaker Updated'
  }));
});

// A correction entry as secretariatService writes it
function auditEntry(uid, overrides = {}) {
  return {
    source: 'secretariat',
    discipline: 'precision',
    startNumber: '12',
    entityType: 'result',
    entityId: '12',
    reason: 'Domaren rättade tiden',
    reference: { type: 'judgeRequest', value: '' },
    changes: [{ field: 'timeMs', oldValue: 100000, newValue: 101000 }],
    editedBy: uid,
    editedAt: serverTimestamp(),
    ...overrides
  };
}

test('auditLog writes are allowed for admin-scoped competition access', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('admin-audit-1', 'admin', 'admin-audit@example.com');
  const ctx = testEnv.authenticatedContext('admin-audit-1', { email_verified: true, email: 'admin-audit@example.com' });
  const db = ctx.firestore();

  await assertSucceeds(setDoc(doc(db, privateCompPath('auditLog/log-1')), auditEntry('admin-audit-1')));
  // Only in the writer's own name, with the server's time and known fields
  await assertFails(setDoc(doc(db, privateCompPath('auditLog/log-1b')), auditEntry('someone-else')));
  await assertFails(setDoc(doc(db, privateCompPath('auditLog/log-1c')), auditEntry('admin-audit-1', { editedAt: 123 })));
  await assertFails(setDoc(doc(db, privateCompPath('auditLog/log-1d')), auditEntry('admin-audit-1', { extra: true })));
  await assertFails(setDoc(doc(db, privateCompPath('auditLog/log-1e')), auditEntry('admin-audit-1', { reference: { type: 'other', value: '' } })));
});

test('auditLog: officials log their own corrections of their discipline only', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('marathon-audit-1', 'marathon', 'marathon-audit@example.com');
  const ctx = testEnv.authenticatedContext('marathon-audit-1', { email_verified: true, email: 'marathon-audit@example.com' });
  const db = ctx.firestore();

  await assertSucceeds(setDoc(doc(db, privateCompPath('auditLog/log-m1')), auditEntry('marathon-audit-1', {
    discipline: 'marathon', entityType: 'obstacle', entityId: '12:3', reference: { type: 'protest', value: '4' }
  })));
  await assertFails(setDoc(doc(db, privateCompPath('auditLog/log-m2')), auditEntry('marathon-audit-1', { discipline: 'precision' })));
  await assertFails(setDoc(doc(db, privateCompPath('auditLog/log-m3')), auditEntry('other-uid', { discipline: 'marathon' })));
  // Still not readable for them
  await assertFails(getDoc(doc(db, privateCompPath('auditLog/log-m1'))));
});

test('rejectedWrites: officials record refused writes of their discipline; staff read them; never changed', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('marathon-rej-1', 'marathon', 'marathon-rej@example.com');
  await seedCompetitionRole('speaker-rej-1', 'speaker', 'speaker-rej@example.com');
  const db = testEnv.authenticatedContext('marathon-rej-1', { email_verified: true, email: 'marathon-rej@example.com' }).firestore();
  const entry = (overrides = {}) => ({
    discipline: 'marathon',
    startNumber: '12',
    obstacle: 3,
    payloadSummary: 'timeInSeconds=41.2, knockdowns=1',
    errorCode: 'permission-denied',
    source: 'maraton-input',
    reportedBy: 'marathon-rej-1',
    reportedAt: serverTimestamp(),
    ...overrides
  });
  const ref = doc(db, privateCompPath('rejectedWrites/r1'));
  await assertSucceeds(setDoc(ref, entry()));
  await assertSucceeds(getDoc(ref));
  await assertFails(updateDoc(ref, { payloadSummary: 'x' }));
  await assertFails(deleteDoc(ref));
  await assertFails(setDoc(doc(db, privateCompPath('rejectedWrites/r2')), entry({ discipline: 'dressage' })));
  await assertFails(setDoc(doc(db, privateCompPath('rejectedWrites/r3')), entry({ reportedBy: 'someone-else' })));
  await assertFails(setDoc(doc(db, privateCompPath('rejectedWrites/r4')), entry({ obstacle: 'three' })));
  await assertFails(setDoc(doc(db, privateCompPath('rejectedWrites/r5')), entry({ payloadSummary: 'x'.repeat(1001) })));

  const speakerDb = testEnv.authenticatedContext('speaker-rej-1', { email_verified: true, email: 'speaker-rej@example.com' }).firestore();
  await assertSucceeds(getDoc(doc(speakerDb, privateCompPath('rejectedWrites/r1'))));
  await assertFails(setDoc(doc(speakerDb, privateCompPath('rejectedWrites/r6')), entry({ reportedBy: 'speaker-rej-1' })));
  // Not public
  await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), privateCompPath('rejectedWrites/r1'))));
});

test('equipages of an archived competition are not edited, also not by admins (fields may only be removed)', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('admin-arch-1', 'admin', 'admin-arch@example.com');
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, compPath(`equipages/${START_NO}`)), { startNumber: 101, driverName: 'Anna', phone: '070-1' });
    await updateDoc(doc(db, compPath()), { locked: true, status: 'completed' });
  });
  const db = testEnv.authenticatedContext('admin-arch-1', { email_verified: true, email: 'admin-arch@example.com' }).firestore();
  await assertFails(updateDoc(doc(db, compPath(`equipages/${START_NO}`)), { driverName: 'Bo' }));
  await assertFails(setDoc(doc(db, compPath('equipages/202')), { startNumber: 202, driverName: 'Ny' }));
  // Moving private data off the public document still works
  await assertSucceeds(updateDoc(doc(db, compPath(`equipages/${START_NO}`)), { phone: deleteField() }));

  // Reopened: editable again
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), compPath()), { locked: false, status: 'active' });
  });
  await assertSucceeds(updateDoc(doc(db, compPath(`equipages/${START_NO}`)), { driverName: 'Bo' }));
});

test('while the competition is being archived (finalizing) results are not written; a stale mark stops counting', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('precision-fin-1', 'precision', 'precision-fin@example.com');
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), compPath()), { finalizing: true, finalizingAt: Timestamp.now() });
  });
  const db = testEnv.authenticatedContext('precision-fin-1', { email_verified: true, email: 'precision-fin@example.com' }).firestore();
  await assertFails(setDoc(doc(db, compPath(`precision/${START_NO}`)), { timeMs: 90000 }));

  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), compPath()), { finalizingAt: Timestamp.fromMillis(Date.now() - 20 * 60 * 1000) });
  });
  await assertSucceeds(setDoc(doc(db, compPath(`precision/${START_NO}`)), { timeMs: 90000 }));
});

test('auditLog reads are denied for non-admin competition roles', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('admin-audit-2', 'admin', 'admin-audit2@example.com');
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, privateCompPath('auditLog/log-read-1')), {
      discipline: 'dressage',
      startNumber: 44
    });
  });

  const ctx = testEnv.authenticatedContext('precision-audit-read-1', { email_verified: true, email: 'precision-audit-read@example.com' });
  const db = ctx.firestore();

  await seedCompetitionRole('precision-audit-read-1', 'precision', 'precision-audit-read@example.com');
  await assertFails(getDoc(doc(db, privateCompPath('auditLog/log-read-1'))));
});

test('auditLog writes are denied for roles without the discipline', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('speaker-audit-1', 'speaker', 'speaker-audit@example.com');
  const ctx = testEnv.authenticatedContext('speaker-audit-1', { email_verified: true, email: 'speaker-audit@example.com' });
  const db = ctx.firestore();

  await assertFails(setDoc(doc(db, privateCompPath('auditLog/log-2')), auditEntry('speaker-audit-1')));
});

test('auditLog is append-only for admins', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('admin-audit-3', 'admin', 'admin-audit3@example.com');
  const ctx = testEnv.authenticatedContext('admin-audit-3', { email_verified: true, email: 'admin-audit3@example.com' });
  const db = ctx.firestore();
  const ref = doc(db, privateCompPath('auditLog/log-append-1'));

  await assertSucceeds(setDoc(ref, auditEntry('admin-audit-3', { discipline: 'marathon' })));
  await assertFails(updateDoc(ref, {
    newValue: 62000
  }));
  await assertFails(deleteDoc(ref));
});

test('messages and documents expose only public audience anonymously and remain admin-write only', { skip: !HAS_EMULATOR }, async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, compPath('messages/msg-1')), {
      title: 'Public Message',
      timestamp: '2026-06-08T10:00:00Z',
      audience: { public: true, drivers: true }
    });
    await setDoc(doc(db, compPath('messages/msg-driver-1')), {
      title: 'Driver Message',
      timestamp: '2026-06-08T10:01:00Z',
      audience: { public: false, drivers: true }
    });
    await setDoc(doc(db, compPath('documents/doc-1')), {
      title: 'Public Document',
      timestamp: '2026-06-08T10:00:00Z',
      audience: { public: true, drivers: true }
    });
    await setDoc(doc(db, compPath('documents/doc-driver-1')), {
      title: 'Driver Document',
      timestamp: '2026-06-08T10:01:00Z',
      audience: { public: false, drivers: true }
    });
  });

  const anonymousDb = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(anonymousDb, compPath('messages/msg-1'))));
  await assertSucceeds(getDoc(doc(anonymousDb, compPath('documents/doc-1'))));
  await assertFails(getDoc(doc(anonymousDb, compPath('messages/msg-driver-1'))));
  await assertFails(getDoc(doc(anonymousDb, compPath('documents/doc-driver-1'))));
  await assertSucceeds(getDocs(query(collection(anonymousDb, compPath('messages')), where('audience.public', '==', true))));
  await assertSucceeds(getDocs(query(collection(anonymousDb, compPath('documents')), where('audience.public', '==', true))));
  await assertFails(getDocs(query(collection(anonymousDb, compPath('messages')), orderBy('timestamp', 'desc'))));
  await assertFails(getDocs(query(collection(anonymousDb, compPath('documents')), orderBy('timestamp', 'desc'))));

  // Any signed-in account (anyone can register one) no longer reads
  // driver-only items: drivers get theirs from the getDriverInbox function
  const accountCtx = testEnv.authenticatedContext('driver-doc-1', { email_verified: true, email: 'driver-doc@example.com' });
  const accountDb = accountCtx.firestore();
  await assertFails(getDoc(doc(accountDb, compPath('messages/msg-driver-1'))));
  await assertFails(getDoc(doc(accountDb, compPath('documents/doc-driver-1'))));
  await assertFails(getDocs(query(collection(accountDb, compPath('messages')), orderBy('timestamp', 'desc'))));
  await assertFails(getDocs(query(collection(accountDb, compPath('documents')), orderBy('timestamp', 'desc'))));
  await assertSucceeds(getDocs(query(collection(accountDb, compPath('messages')), where('audience.public', '==', true))));

  // Admins list everything (admin communication page)
  const ownerDb = testEnv.authenticatedContext('owner-1', { email_verified: true, email: 'owner@example.com' }).firestore();
  await assertSucceeds(getDocs(query(collection(ownerDb, compPath('messages')), orderBy('timestamp', 'desc'))));
  await assertSucceeds(getDoc(doc(ownerDb, compPath('documents/doc-driver-1'))));

  await seedCompetitionRole('speaker-doc-1', 'speaker', 'speaker-doc@example.com');
  const speakerCtx = testEnv.authenticatedContext('speaker-doc-1', { email_verified: true, email: 'speaker-doc@example.com' });
  const speakerDb = speakerCtx.firestore();
  await assertFails(setDoc(doc(speakerDb, compPath('messages/msg-2')), { title: 'Nope' }));
  await assertFails(setDoc(doc(speakerDb, compPath('documents/doc-2')), { title: 'Nope' }));

  await seedCompetitionRole('admin-doc-1', 'admin', 'admin-doc@example.com');
  const adminCtx = testEnv.authenticatedContext('admin-doc-1', { email_verified: true, email: 'admin-doc@example.com' });
  const adminDb = adminCtx.firestore();
  await assertSucceeds(setDoc(doc(adminDb, compPath('messages/msg-3')), { title: 'Admin OK' }));
  await assertSucceeds(setDoc(doc(adminDb, compPath('documents/doc-3')), { title: 'Admin OK' }));
});

test('official staffing documents are not public but remain readable to authenticated competition roles', { skip: !HAS_EMULATOR }, async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, compPath('judges/judge-1')), {
      id: 'judge-1',
      name: 'Judge One',
      email: 'judge1@example.com',
      position: 'C'
    });
    await setDoc(doc(db, compPath('officials/official-1')), {
      id: 'official-1',
      name: 'Official One',
      email: 'official1@example.com',
      phone: '0700000000'
    });
    await setDoc(doc(db, compPath('assignments/assignment-1')), {
      officialId: 'official-1',
      officialName: 'Official One',
      roleLabel: 'Hinderchef',
      locationLabel: 'Hinder 5'
    });
  });

  const anonymousDb = testEnv.unauthenticatedContext().firestore();
  const publicUserDb = testEnv.authenticatedContext('public-user-1', { email_verified: true, email: 'public@example.com' }).firestore();

  await seedCompetitionRole('dressage-role-1', 'dressage', 'dressage-role@example.com');
  const dressageDb = testEnv.authenticatedContext('dressage-role-1', { email_verified: true, email: 'dressage-role@example.com' }).firestore();

  await assertFails(getDoc(doc(anonymousDb, compPath('judges/judge-1'))));
  await assertFails(getDoc(doc(anonymousDb, compPath('officials/official-1'))));
  await assertFails(getDoc(doc(anonymousDb, compPath('assignments/assignment-1'))));

  await assertFails(getDoc(doc(publicUserDb, compPath('judges/judge-1'))));
  await assertFails(getDoc(doc(publicUserDb, compPath('officials/official-1'))));
  await assertFails(getDoc(doc(publicUserDb, compPath('assignments/assignment-1'))));

  await assertSucceeds(getDoc(doc(dressageDb, compPath('judges/judge-1'))));
  await assertSucceeds(getDoc(doc(dressageDb, compPath('officials/official-1'))));
  await assertSucceeds(getDoc(doc(dressageDb, compPath('assignments/assignment-1'))));
});

test('volunteer signups may not be created directly from Firestore clients', { skip: !HAS_EMULATOR }, async () => {
  const anonymousDb = testEnv.unauthenticatedContext().firestore();

  await assertFails(setDoc(doc(anonymousDb, compPath('volunteerSignups/signup-1')), {
    name: 'Volunteer',
    email: 'volunteer@example.com'
  }));
});

test('volunteer signups and the recalculation log are readable only by competition admins', { skip: !HAS_EMULATOR }, async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, compPath('volunteerSignups/signup-1')), {
      name: 'Volontär', phone: '0701234567', email: 'volunteer@example.com', icePhone: '0707654321'
    });
    await setDoc(doc(db, compPath('maintenanceRuns/run-1')), {
      type: 'result-recalculation', initiatedBy: { uid: 'admin-x', email: 'admin-x@example.com' }
    });
  });
  await seedCompetitionRole('speaker-signups-1', 'speaker');
  await seedCompetitionRole('admin-signups-1', 'admin');

  const anonymousDb = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(anonymousDb, compPath('volunteerSignups/signup-1'))));
  await assertFails(getDocs(collection(anonymousDb, compPath('volunteerSignups'))));
  await assertFails(getDoc(doc(anonymousDb, compPath('maintenanceRuns/run-1'))));

  const publicUserDb = testEnv.authenticatedContext('public-signups-1', { email_verified: true, email: 'public-signups@example.com' }).firestore();
  await assertFails(getDocs(collection(publicUserDb, compPath('volunteerSignups'))));

  const speakerDb = testEnv.authenticatedContext('speaker-signups-1', { email_verified: true, email: 'speaker-signups-1@example.com' }).firestore();
  await assertFails(getDocs(collection(speakerDb, compPath('volunteerSignups'))));

  const adminDb = testEnv.authenticatedContext('admin-signups-1', { email_verified: true, email: 'admin-signups-1@example.com' }).firestore();
  await assertSucceeds(getDocs(collection(adminDb, compPath('volunteerSignups'))));
});

test('protected competition collections cannot be listed anonymously', { skip: !HAS_EMULATOR }, async () => {
  const protectedCollections = ['equipagePrivate', 'roleEmails', 'judges', 'officials', 'assignments', 'admins', 'auditLog', 'volunteerSignups', 'maintenanceRuns', 'horseTemperatures', 'vetInspections', 'vetNotes'];
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const name of protectedCollections) {
      await setDoc(doc(db, compPath(`${name}/doc-1`)), { email: 'someone@example.com', phone: '070' });
    }
  });

  const anonymousDb = testEnv.unauthenticatedContext().firestore();
  const readable = [];
  for (const name of protectedCollections) {
    for (const [kind, read] of [['list', () => getDocs(collection(anonymousDb, compPath(name)))], ['get', () => getDoc(doc(anonymousDb, compPath(`${name}/doc-1`)))]]) {
      try {
        await read();
        readable.push(`${kind} ${name}`);
      } catch {
        // denied, as it should be
      }
    }
  }
  assert.deepEqual(readable, []);
});

test('the config collection cannot be listed, so the PINs in config/secrets stay hidden', { skip: !HAS_EMULATOR }, async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), compPath('config/display')), { a: 1 });
  });
  const anonymousDb = testEnv.unauthenticatedContext().firestore();
  const signedInDb = testEnv.authenticatedContext('random-user', { email_verified: true, email: 'x@example.com' }).firestore();
  for (const db of [anonymousDb, signedInDb]) {
    await assertFails(getDocs(collection(db, compPath('config'))));
    await assertFails(getDoc(doc(db, compPath('config/secrets'))));
    await assertSucceeds(getDoc(doc(db, compPath('config/display'))));
  }
});

test('email-based access needs a verified email address', { skip: !HAS_EMULATOR }, async () => {
  // An admin role granted to an address before its owner signed up
  await seedRoleEmail('kansli@example.com', ['admin']);
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, compPath(`equipages/${START_NO}`)), { startNumber: Number(START_NO), driverName: 'Kusk' });
    await setDoc(doc(db, compPath(`equipagePrivate/${START_NO}`)), { email: 'driver-verify@example.com', phone: '070' });
  });

  // Someone else registered the address but never confirmed it
  const impostorDb = testEnv.authenticatedContext('impostor-1', { email_verified: false, email: 'kansli@example.com' }).firestore();
  await assertFails(getDoc(doc(impostorDb, compPath('config/secrets'))));
  await assertFails(setDoc(doc(impostorDb, compPath('config/maratonConfig')), { x: 1 }));
  await assertFails(getDoc(doc(impostorDb, compPath('roleEmails/kansli@example.com'))));

  const verifiedDb = testEnv.authenticatedContext('kansli-1', { email_verified: true, email: 'kansli@example.com' }).firestore();
  await assertSucceeds(getDoc(doc(verifiedDb, compPath('config/secrets'))));

  // A driver's private data and self-service only with the confirmed address
  const unverifiedDriverDb = testEnv.authenticatedContext('driver-unverified-1', { email_verified: false, email: 'driver-verify@example.com' }).firestore();
  await assertFails(getDoc(doc(unverifiedDriverDb, compPath(`equipagePrivate/${START_NO}`))));
  await assertFails(updateDoc(doc(unverifiedDriverDb, compPath(`equipages/${START_NO}`)), { speakerNotes: 'x' }));

  const verifiedDriverDb = testEnv.authenticatedContext('driver-verified-1', { email_verified: true, email: 'driver-verify@example.com' }).firestore();
  await assertSucceeds(getDoc(doc(verifiedDriverDb, compPath(`equipagePrivate/${START_NO}`))));
  await assertSucceeds(updateDoc(doc(verifiedDriverDb, compPath(`equipages/${START_NO}`)), { speakerNotes: 'x' }));
});

test('marathon officials may record the global pause, other roles may not', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('marathon-pause-1', 'marathon');
  await seedCompetitionRole('speaker-pause-1', 'speaker');
  const pause = { isPaused: true, pauseLog: [{ start: '2026-10-11T10:00:00.000Z', end: null, durationSec: null }] };

  const marathonDb = testEnv.authenticatedContext('marathon-pause-1', { email_verified: true, email: 'marathon-pause-1@example.com' }).firestore();
  await assertSucceeds(setDoc(doc(marathonDb, compPath('config/globalStatus')), pause, { merge: true }));
  // ...but no other config documents
  await assertFails(setDoc(doc(marathonDb, compPath('config/maratonConfig')), { x: 1 }, { merge: true }));

  const speakerDb = testEnv.authenticatedContext('speaker-pause-1', { email_verified: true, email: 'speaker-pause-1@example.com' }).firestore();
  await assertFails(setDoc(doc(speakerDb, compPath('config/globalStatus')), pause, { merge: true }));

  const anonymousDb = testEnv.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(anonymousDb, compPath('config/globalStatus')), pause, { merge: true }));
  await assertSucceeds(getDoc(doc(anonymousDb, compPath('config/globalStatus'))));

  // The open pause may be closed, and a new one added
  const closed = { start: '2026-10-11T10:00:00.000Z', end: '2026-10-11T10:05:00.000Z', durationSec: 300 };
  await assertSucceeds(setDoc(doc(marathonDb, compPath('config/globalStatus')), { isPaused: false, pauseLog: [closed] }, { merge: true }));
  const second = { start: '2026-10-11T11:00:00.000Z', end: null, durationSec: null };
  await assertSucceeds(setDoc(doc(marathonDb, compPath('config/globalStatus')), { isPaused: true, pauseLog: [closed, second] }, { merge: true }));
  // Earlier pauses cannot be changed, removed or added closed (they shorten every stage time)
  await assertFails(setDoc(doc(marathonDb, compPath('config/globalStatus')), { pauseLog: [second] }, { merge: true }));
  await assertFails(setDoc(doc(marathonDb, compPath('config/globalStatus')), { pauseLog: [{ ...closed, end: '2026-10-11T10:50:00.000Z' }, second] }, { merge: true }));
  await assertFails(setDoc(doc(marathonDb, compPath('config/globalStatus')), { pauseLog: [closed, second, { start: '2026-10-11T12:00:00.000Z', end: '2026-10-11T13:00:00.000Z', durationSec: 3600 }] }, { merge: true }));
  await assertFails(setDoc(doc(marathonDb, compPath('config/globalStatus')), { pauseLog: [closed, { ...second, from: 0 }] }, { merge: true }));
  // Status text without touching the log is fine
  await assertSucceeds(setDoc(doc(marathonDb, compPath('config/globalStatus')), { statusText: 'Paus' }, { merge: true }));
  // The competition's admin may correct the log
  const ownerDb = testEnv.authenticatedContext('owner-1', { email_verified: true, email: 'owner@example.com' }).firestore();
  await assertSucceeds(setDoc(doc(ownerDb, compPath('config/globalStatus')), { isPaused: false, pauseLog: [closed] }, { merge: true }));
});

test('a pause records why, who and where; only the writer may be named and the record cannot be changed on resume', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('marathon-pause-2', 'marathon');
  await seedCompetitionRole('admin-pause-2', 'admin');
  await seedCompetitionRole('dressage-pause-2', 'dressage');
  const ref = (db) => doc(db, compPath('config/globalStatus'));
  const marathonDb = testEnv.authenticatedContext('marathon-pause-2', { email_verified: true, email: 'marathon-pause-2@example.com' }).firestore();
  const entry = {
    start: '2026-10-11T10:00:00.000Z', end: null, durationSec: null,
    reason: 'accident', note: 'Häst omkullkörd vid hinder 3',
    by: { uid: 'marathon-pause-2', name: 'Anna', role: 'observer' }, where: 'section:B'
  };

  // Not someone else as the one who pressed, no unknown reason, no long text
  await assertFails(setDoc(ref(marathonDb), { isPaused: true, pauseLog: [{ ...entry, by: { uid: 'someone-else', role: 'observer' } }] }, { merge: true }));
  await assertFails(setDoc(ref(marathonDb), { isPaused: true, pauseLog: [{ ...entry, reason: 'lunch' }] }, { merge: true }));
  await assertFails(setDoc(ref(marathonDb), { isPaused: true, pauseLog: [{ ...entry, note: 'x'.repeat(201) }] }, { merge: true }));
  await assertSucceeds(setDoc(ref(marathonDb), { isPaused: true, pauseLog: [entry] }, { merge: true }));

  // The dressage role does not pause the marathon
  const dressageDb = testEnv.authenticatedContext('dressage-pause-2', { email_verified: true, email: 'dressage-pause-2@example.com' }).firestore();
  const closedByDressage = { ...entry, end: '2026-10-11T10:05:00.000Z', durationSec: 300, endedBy: { uid: 'dressage-pause-2' } };
  await assertFails(setDoc(ref(dressageDb), { isPaused: false, pauseLog: [closedByDressage] }, { merge: true }));

  // The secretariat (a competition admin) resumes; the reason cannot be rewritten on the way
  const adminDb = testEnv.authenticatedContext('admin-pause-2', { email_verified: true, email: 'admin-pause-2@example.com' }).firestore();
  const closed = { ...entry, end: '2026-10-11T10:05:00.000Z', durationSec: 300, endedBy: { uid: 'admin-pause-2', role: 'sekretariat' } };
  await assertSucceeds(setDoc(ref(adminDb), { isPaused: false, pauseLog: [closed] }, { merge: true }));

  // A marathon official may not rewrite why when closing a pause
  const second = { start: '2026-10-11T11:00:00.000Z', end: null, durationSec: null, reason: 'weather', by: { uid: 'marathon-pause-2', role: 'observer' } };
  await assertSucceeds(setDoc(ref(marathonDb), { isPaused: true, pauseLog: [closed, second] }, { merge: true }));
  const rewritten = { ...second, reason: 'other', end: '2026-10-11T11:10:00.000Z', durationSec: 600, endedBy: { uid: 'marathon-pause-2', role: 'observer' } };
  await assertFails(setDoc(ref(marathonDb), { isPaused: false, pauseLog: [closed, rewritten] }, { merge: true }));
  await assertSucceeds(setDoc(ref(marathonDb), { isPaused: false, pauseLog: [closed, { ...rewritten, reason: 'weather' }] }, { merge: true }));

  // The technical delegate pauses from the secretariat's marathon page
  await seedCompetitionRole('td-pause-2', 'td');
  const tdDb = testEnv.authenticatedContext('td-pause-2', { email_verified: true, email: 'td-pause-2@example.com' }).firestore();
  const third = { start: '2026-10-11T12:00:00.000Z', end: null, durationSec: null, reason: 'course', by: { uid: 'td-pause-2', role: 'sekretariat' }, where: 'secretariat' };
  await assertSucceeds(setDoc(ref(tdDb), { isPaused: true, pauseLog: [closed, { ...rewritten, reason: 'weather' }, third] }, { merge: true }));
});

test('messages for officials are read by the competition officials only', { skip: !HAS_EMULATOR }, async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, compPath('messages/msg-officials-1')), {
      title: 'Lunch 12:30', timestamp: '2026-06-08T10:00:00Z',
      audience: { public: false, drivers: false, officials: true, officialRoles: [] }
    });
    await setDoc(doc(db, compPath('messages/msg-vet-1')), {
      title: 'Veterinär till hinder 3', timestamp: '2026-06-08T10:01:00Z', type: 'alert',
      audience: { public: false, drivers: false, officials: true, officialRoles: ['vet'] }
    });
  });
  const officialsQuery = (db) => query(collection(db, compPath('messages')), where('audience.officials', '==', true));

  await seedCompetitionRole('speaker-msg-1', 'speaker');
  const speakerDb = testEnv.authenticatedContext('speaker-msg-1', { email_verified: true, email: 'speaker-msg-1@example.com' }).firestore();
  await assertSucceeds(getDocs(officialsQuery(speakerDb)));
  await assertSucceeds(getDoc(doc(speakerDb, compPath('messages/msg-officials-1'))));
  // ...but not driver or other non-official messages
  await assertFails(getDocs(query(collection(speakerDb, compPath('messages')), orderBy('timestamp', 'desc'))));

  // An official through a verified role e-mail
  await seedRoleEmail('vet-msg@example.com', ['vet']);
  const vetDb = testEnv.authenticatedContext('vet-msg-1', { email_verified: true, email: 'vet-msg@example.com' }).firestore();
  await assertSucceeds(getDocs(officialsQuery(vetDb)));

  // The public and any signed-in account (anyone can register one) cannot
  const anonymousDb = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDocs(officialsQuery(anonymousDb)));
  await assertFails(getDoc(doc(anonymousDb, compPath('messages/msg-officials-1'))));
  const accountDb = testEnv.authenticatedContext('driver-msg-1', { email_verified: true, email: 'driver-msg@example.com' }).firestore();
  await assertFails(getDocs(officialsQuery(accountDb)));
  await assertFails(getDoc(doc(accountDb, compPath('messages/msg-vet-1'))));

  // Admins write and edit them; the shape is checked
  const ownerDb = testEnv.authenticatedContext('owner-1', { email_verified: true, email: 'owner@example.com' }).firestore();
  await assertSucceeds(setDoc(doc(ownerDb, compPath('messages/msg-officials-2')), {
    title: 'Banan öppnar', body: 'Kl 9', titleEn: 'Course opens', bodyEn: 'At 9', type: 'info',
    audience: { public: false, drivers: false, officials: true, officialRoles: ['marathon'] }, targetStartNumbers: []
  }));
  await assertSucceeds(updateDoc(doc(ownerDb, compPath('messages/msg-officials-2')), { body: 'Kl 9.30' }));
  await assertFails(setDoc(doc(ownerDb, compPath('messages/msg-bad-type')), { title: 'x', type: 'html' }));
  await assertFails(setDoc(doc(ownerDb, compPath('messages/msg-bad-audience')), { title: 'x', audience: { public: true, everyone: true } }));
  await assertFails(setDoc(doc(speakerDb, compPath('messages/msg-officials-3')), { title: 'Nope', audience: { officials: true } }));
});

test('PIN join attempt counters are not readable or writable by clients', { skip: !HAS_EMULATOR }, async () => {
  const db = testEnv.authenticatedContext('pin-guesser-1', { email_verified: true, email: 'pin-guesser@example.com' }).firestore();
  await assertFails(getDoc(doc(db, `pinJoinAttempts/${COMP_ID}`)));
  await assertFails(setDoc(doc(db, `pinJoinAttempts/${COMP_ID}__pin-guesser-1`), { failures: [] }));
});

test('orphaned subcollection data without parent competition doc is not publicly readable', { skip: !HAS_EMULATOR }, async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, `artifacts/${APP_ID}/public/data/competitions/orphan-comp/equipages/1`), {
      startNumber: 1,
      driverName: 'Orphan Kusk'
    });
  });

  const anonymousDb = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(anonymousDb, `artifacts/${APP_ID}/public/data/competitions/orphan-comp/equipages/1`)));
});

test('finalization locks cannot be changed on an archived competition', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('dressage-arch-1', 'dressage');
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, compPath()), { locked: true, status: 'completed' }, { merge: true });
  });

  const officialDb = testEnv.authenticatedContext('dressage-arch-1', { email_verified: true, email: 'dressage-arch-1@example.com' }).firestore();
  const batch = writeBatch(officialDb);
  setLoggedLock(batch, officialDb, 'dressage-arch-1', 'dressage', true, START_NO);
  await assertFails(batch.commit());
});

test('competition admins via roleEmails can update competition settings but not ownership', { skip: !HAS_EMULATOR }, async () => {
  await seedRoleEmail('compadmin@example.com', ['admin']);
  const adminDb = testEnv.authenticatedContext('comp-admin-uid', { email_verified: true, email: 'compadmin@example.com' }).firestore();

  await assertSucceeds(updateDoc(doc(adminDb, compPath()), { place: 'Ny tävlingsplats' }));
  await assertFails(updateDoc(doc(adminDb, compPath()), { createdBy: 'comp-admin-uid' }));
  await assertFails(updateDoc(doc(adminDb, compPath()), { ownerId: 'comp-admin-uid' }));
  // Nor who administers it: adding themselves to admins[] was the first step
  // to taking ownership (the admins[] branch had no restriction)
  await assertFails(updateDoc(doc(adminDb, compPath()), { admins: ['comp-admin-uid'] }));
  await assertFails(updateDoc(doc(adminDb, compPath()), { staffUids: ['comp-admin-uid'] }));
  await assertFails(updateDoc(doc(adminDb, compPath()), { deleting: true, deletingBy: 'comp-admin-uid' }));
});

test('a co-admin in admins[] cannot take ownership or delete the competition', { skip: !HAS_EMULATOR }, async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), compPath()), { admins: ['co-admin-2'], staffUids: ['co-admin-2'] });
  });
  const coDb = testEnv.authenticatedContext('co-admin-2', { email_verified: true, email: 'co2@example.com' }).firestore();
  const ownerDb = testEnv.authenticatedContext('owner-1', { email_verified: true, email: 'owner@example.com' }).firestore();

  await assertSucceeds(updateDoc(doc(coDb, compPath()), { place: 'Annan plats' }));
  await assertFails(updateDoc(doc(coDb, compPath()), { createdBy: 'co-admin-2' }));
  await assertFails(updateDoc(doc(coDb, compPath()), { admins: ['co-admin-2', 'friend'] }));
  await assertFails(updateDoc(doc(coDb, compPath()), { staffUids: [] }));
  await assertFails(deleteDoc(doc(coDb, compPath())));
  // The owner manages the lists
  await assertSucceeds(updateDoc(doc(ownerDb, compPath()), { admins: [] }));
  await assertFails(updateDoc(doc(ownerDb, compPath()), { deleting: true, deletingAt: Date.now() }));
});

test('rules test environment is using the intended project id', { skip: !HAS_EMULATOR }, () => {
  // A demo project (scripts/run-firestore-rules-tests.mjs): never the real one
  assert.equal(PROJECT_ID, 'demo-combined-driving');
});

// ---- Shape and size of result and live documents -------------------------

function officialDb(uid) {
  return testEnv.authenticatedContext(uid, { email_verified: true, email: `${uid}@example.com` }).firestore();
}

const movements = (n) => Array.from({ length: n }, (_, i) => ({ momentNo: i + 1, score: 7, comment: '' }));

test('precision results take the fields the app writes, nothing else and nothing oversized', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('prec-shape-1', 'precision');
  const db = officialDb('prec-shape-1');
  const ref = doc(db, compPath(`precision/${START_NO}`));
  // savePrecisionResult
  await assertSucceeds(setDoc(ref, {
    startNumber: 101, className: 'Häst', driverName: 'Anna', trackWidthCm: 140,
    timeMs: 120000, liveTimeMs: 120000, livePausedMs: 0, liveStartEpoch: null,
    obstaclePenalty: 3, timePenalty: 0, extraPenalty: 0, totalPenalty: 3,
    liveObstaclePenalty: 3, liveTimePenalty: 0, liveTotalPenalty: 3,
    eliminated: false, disqualified: false, running: false, inProgress: false, finalized: false,
    status: 'Klar', comment: 'Bra', updatedAt: Date.now(), knocks: ['1', '4A'], timePenaltyOverride: false
  }, { merge: true }));
  // precision-input knock toggle, rebuild count, split timing
  await assertSucceeds(setDoc(ref, {
    startNumber: 101, className: 'Häst', knocks: arrayUnion('5'), knockDownTimes: { 5: 4100 },
    obstaclePenalty: deleteField(), liveObstaclePenalty: 6, liveTotalPenalty: 6, extraPenalty: 0, updatedAt: Date.now()
  }, { merge: true }));
  await assertSucceeds(setDoc(ref, { rebuildCount: increment(1), updatedAt: Date.now() }, { merge: true }));
  await assertSucceeds(setDoc(ref, { gateSplits: { start: Date.now() }, running: true, status: 'Pågår' }, { merge: true }));

  await assertFails(setDoc(ref, { isAdmin: true }, { merge: true }));
  await assertFails(setDoc(ref, { comment: 'x'.repeat(1001) }, { merge: true }));
  await assertFails(setDoc(ref, { timeMs: '120000' }, { merge: true }));
  await assertFails(setDoc(ref, { knocks: Array.from({ length: 101 }, (_, i) => String(i)) }, { merge: true }));
  await assertFails(setDoc(doc(db, compPath('precision/102')), { startNumber: 102, html: '<img src=x onerror=alert(1)>' }));
});

test('dressage protocols, status and live documents are checked for shape and size', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('dre-shape-1', 'dressage');
  const db = officialDb('dre-shape-1');
  const judgeRef = doc(db, compPath(`dressage/${START_NO}/protocols/judge_j1`));
  await assertSucceeds(setDoc(judgeRef, {
    startNumber: START_NO, judgeId: 'j1', judgeName: 'Dora', judgePosition: 'C', position: 'C',
    testKey: 'FEI_2star_HP2_2024', programKey: 'FEI_2star_HP2_2024', eliminated: false,
    movements: movements(26), updatedAt: serverTimestamp()
  }, { merge: true }));
  await assertSucceeds(setDoc(doc(db, compPath(`dressage/${START_NO}/protocols/general`)), {
    errorPoints: 2, errorComment: 'Fel väg', updatedAt: serverTimestamp()
  }, { merge: true }));
  await assertFails(setDoc(judgeRef, { movements: movements(61) }, { merge: true }));
  await assertFails(setDoc(judgeRef, { finalScore: 99 }, { merge: true }));
  await assertFails(setDoc(doc(db, compPath(`dressage/${START_NO}/protocols/general`)), { errorComment: 'x'.repeat(1001) }, { merge: true }));

  const statusRef = doc(db, compPath(`dressageStatus/${START_NO}`));
  await assertSucceeds(setDoc(statusRef, {
    state: 'finished', judgeId: 'j1', judgeName: 'Dora', judgePosition: 'C', updatedAt: serverTimestamp(),
    finishedAt: serverTimestamp(), protocol: null, lastUpdate: null,
    finalJudgeScore: { judgeId: 'j1', judgeName: 'Dora', judgePosition: 'C', points: 180, totalPoints: 260, penalty: 30.8, percent: 69.2, eliminated: false },
    judgesDone: { C: true }, judgeScores: { C: { points: 180 } }, expectedPositions: ['C', 'E']
  }, { merge: true }));
  await assertFails(setDoc(statusRef, { winner: true }, { merge: true }));
  await assertFails(setDoc(statusRef, { judgesDone: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`J${i}`, true])) }, { merge: true }));

  const liveRef = doc(db, compPath(`dressageStatus/${START_NO}/live/C`));
  await assertSucceeds(setDoc(liveRef, {
    state: 'ongoing',
    protocol: { judgeId: 'j1', judgeName: 'Dora', judgePosition: 'C', testKey: 'x', eliminated: false, movements: movements(26) },
    lastUpdate: { momentNo: 3, momentText: 'Halt', score: 7, judgeId: 'j1', judgeName: 'Dora', judgePosition: 'C' },
    updatedAt: serverTimestamp()
  }, { merge: true }));
  await assertFails(setDoc(liveRef, { protocol: { movements: movements(61) } }, { merge: true }));
  await assertFails(setDoc(liveRef, { other: 'x' }, { merge: true }));

  // Older paths the app no longer writes
  await assertFails(setDoc(doc(db, compPath(`dressageResults/${START_NO}/protocols/judge_j1`)), { movements: [] }));
  await assertFails(setDoc(doc(db, compPath(`dressage/${START_NO}/meta/status`)), { state: 'x' }));
});

test('marathon summary, timing and obstacle documents are checked for shape and size', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('mar-shape-1', 'marathon');
  const db = officialDb('mar-shape-1');
  const ref = doc(db, compPath(`maraton/${START_NO}`));
  const entry = {
    number: 3, timeInSeconds: 95, timeSeconds: 95, timeMs: 95000, timePenalty: 0, knockdowns: 0,
    knockdownPenalty: 0, otherPenalty: 0, penalty: 0, comment: '', eliminated: false, holdTimeSec: 0,
    routeString: 'ABCDEF', gateSplits: [{ char: 'A', ts: 1000 }]
  };
  const live = {
    running: false, inProgress: false, pausedByGlobalPause: false, liveObstacleTimeMs: 0, liveObstacleStartAt: null,
    live_staticStartAt: null, live_routeString: '', live_knockdowns: '0', live_otherPenalty: '0', live_holdTimeSec: '',
    live_comment: '', live_eliminated: false, live_gateSplits: [], updatedAt: serverTimestamp()
  };
  // saveMarathonObstacleResult (both documents in one batch)
  const batch = writeBatch(db);
  batch.set(ref, { obstacleResults: { 3: { ...entry, updatedAt: serverTimestamp() } }, obstacleLive: { 3: live }, updatedAt: serverTimestamp() }, { merge: true });
  batch.set(doc(db, compPath(`maratonResults/${START_NO}/obstacles/3`)), { ...entry, obstacleNumber: 3, updatedAt: serverTimestamp() }, { merge: true });
  await assertSucceeds(batch.commit());
  // maraton-input live push and obstacle times
  await assertSucceeds(setDoc(ref, { startNumber: 101, className: 'Häst', obstacleLive: { 4: { ...live, running: true } } }, { merge: true }));
  await assertSucceeds(setDoc(ref, { obstacleTimes: { 4: { enteredAt: serverTimestamp(), enteredAtClient: '2026-10-19T10:00:00Z' } } }, { merge: true }));
  // maraton-stages-input (flat keys, the older spellings and literal dotted keys)
  await assertSucceeds(setDoc(ref, {
    startNumber: 101, className: 'Häst', start_A: '2026-10-19T10:00:00Z', start_TRANSPORT: null,
    startClock_A: '2026-10-19T10:00:00Z', runningSince_A: '2026-10-19T10:00:00Z', commentStart_A: 'ok',
    runningStage: 'A', 'stages.A.startClock': '2026-10-19T10:00:00Z', 'timing.A.startClock': '2026-10-19T10:00:00Z',
    updatedAt: serverTimestamp()
  }, { merge: true }));
  await assertSucceeds(setDoc(ref, { eliminated: false, otherPenalty: 5, otherPenaltySection: 'B', bitCheckOk: true, bettOk: true, bitCheckComment: '', bettComment: '', updatedAt: serverTimestamp() }, { merge: true }));
  // observator-input
  await assertSucceeds(setDoc(ref, { observerLog: { wrongGaitSeconds: increment(5), notes: 'Galopp vid B' }, updatedAt: serverTimestamp() }, { merge: true }));
  await assertSucceeds(setDoc(ref, { observerLog: { halts: arrayUnion({ atSec: 30, durSec: 4 }) }, updatedAt: serverTimestamp() }, { merge: true }));

  await assertFails(setDoc(ref, { hacked: true }, { merge: true }));
  await assertFails(setDoc(ref, { commentStart_A: 'x'.repeat(1001) }, { merge: true }));
  await assertFails(setDoc(ref, { observerLog: { notes: 'x'.repeat(2001) } }, { merge: true }));
  await assertFails(setDoc(ref, { observerLog: { other: 1 } }, { merge: true }));
  await assertFails(setDoc(ref, { obstacleResults: Object.fromEntries(Array.from({ length: 41 }, (_, i) => [String(i + 1), entry])) }, { merge: true }));
  await assertFails(setDoc(ref, { otherPenalty: '5' }, { merge: true }));

  const obsRef = doc(db, compPath(`maratonResults/${START_NO}/obstacles/3`));
  await assertFails(setDoc(obsRef, { comment: 'x'.repeat(1001) }, { merge: true }));
  await assertFails(setDoc(obsRef, { penalty: 'none' }, { merge: true }));
  await assertFails(setDoc(obsRef, { extra: 1 }, { merge: true }));

  const timingRef = doc(db, compPath(`maraton-timing/${START_NO}`));
  await assertSucceeds(setDoc(timingRef, { startNumber: 101, className: 'Häst', duration_A: 1800000, updatedAt: serverTimestamp() }, { merge: true }));
  await assertFails(setDoc(timingRef, { duration_A: '30 min' }, { merge: true }));
  await assertFails(setDoc(timingRef, { note: 'x' }, { merge: true }));

  // Obstacle definitions (maraton-admin): a full overwrite
  const defRef = doc(db, compPath('maratonObstacles/3'));
  await assertSucceeds(setDoc(defRef, { number: 3, name: 'Vattnet', gateCount: 6, classOverrides: { Ponny: 5 }, knockdown: { enabled: true, penaltySec: 5 } }));
  await assertFails(setDoc(defRef, { number: 3, name: 'x'.repeat(201) }));
  await assertFails(setDoc(defRef, { number: 3, name: 'Vattnet', script: '<b>' }));
  await assertSucceeds(deleteDoc(defRef));

  // Older live documents: no writes
  await assertFails(setDoc(doc(db, compPath(`maratonLive/${START_NO}`)), { running: true }));
});

test('equipage start numbers are digits equal to the document id, and private fields stay off', { skip: !HAS_EMULATOR }, async () => {
  const ownerDb = testEnv.authenticatedContext('owner-1', { email_verified: true, email: 'owner@example.com' }).firestore();
  await assertSucceeds(setDoc(doc(ownerDb, compPath('equipages/12')), { startNumber: 12, driverName: 'Anna', className: 'Häst' }));
  await assertSucceeds(setDoc(doc(ownerDb, compPath('equipages/13')), { startNumber: '13', driverName: 'Bo', className: 'Häst' }));
  await assertSucceeds(setDoc(doc(ownerDb, compPath('equipages/007')), { startNumber: 7, driverName: 'Cia', className: 'Häst' }));
  await assertFails(setDoc(doc(ownerDb, compPath('equipages/14')), { startNumber: 15, driverName: 'Fel' }));
  await assertFails(setDoc(doc(ownerDb, compPath('equipages/16')), { driverName: 'Inget nummer' }));
  await assertFails(setDoc(doc(ownerDb, compPath('equipages/17')), { startNumber: '17"><img src=x onerror=alert(1)>' }));
  await assertFails(setDoc(doc(ownerDb, compPath('equipages/x1')), { startNumber: 'x1' }));
  await assertFails(setDoc(doc(ownerDb, compPath('equipages/1234567')), { startNumber: 1234567 }));
  // Private fields belong on equipagePrivate
  for (const field of ['email', 'driverEmail', 'driverSSN', 'ssn', 'personnummer', 'phone', 'payment', 'icePhone']) {
    await assertFails(setDoc(doc(ownerDb, compPath('equipages/18')), { startNumber: 18, [field]: 'x' }));
    await assertFails(updateDoc(doc(ownerDb, compPath('equipages/12')), { [field]: 'x' }));
  }
  // Updates: the start number only checked when written
  await assertSucceeds(updateDoc(doc(ownerDb, compPath('equipages/12')), { clubName: 'Klubben' }));
  await assertFails(updateDoc(doc(ownerDb, compPath('equipages/12')), { startNumber: '<b>12</b>' }));
  // An older document holding a private field: other updates work, and the
  // privacy migration may remove it
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), compPath('equipages/20')), { startNumber: 20, email: 'old@example.com' });
  });
  await assertSucceeds(updateDoc(doc(ownerDb, compPath('equipages/20')), { clubName: 'Klubben' }));
  await assertSucceeds(updateDoc(doc(ownerDb, compPath('equipages/20')), { email: deleteField() }));
  await assertFails(updateDoc(doc(ownerDb, compPath('equipages/20')), { email: 'new@example.com' }));
});

test('speaker notes from the speaker are capped like the driver\'s', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('speaker-cap-1', 'speaker');
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), compPath('equipages/30')), { startNumber: 30, driverName: 'Dan' });
  });
  const db = officialDb('speaker-cap-1');
  await assertSucceeds(updateDoc(doc(db, compPath('equipages/30')), { speakerNotes: 'x'.repeat(2000) }));
  await assertFails(updateDoc(doc(db, compPath('equipages/30')), { speakerNotes: 'x'.repeat(2001) }));
});

test('finalization locks of a draft competition are not public', { skip: !HAS_EMULATOR }, async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, rootCompPath(`precisionFinalization/${START_NO}`)), { finalized: true });
    await setDoc(doc(db, compPath()), { published: false }, { merge: true });
  });
  const anonDb = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(anonDb, rootCompPath(`precisionFinalization/${START_NO}`))));
  await assertFails(getDocs(collection(anonDb, rootCompPath('precisionFinalization'))));
  const ownerDb = testEnv.authenticatedContext('owner-1', { email_verified: true, email: 'owner@example.com' }).firestore();
  await assertSucceeds(getDoc(doc(ownerDb, rootCompPath(`precisionFinalization/${START_NO}`))));

  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), compPath()), { published: true }, { merge: true });
  });
  await assertSucceeds(getDoc(doc(anonDb, rootCompPath(`precisionFinalization/${START_NO}`))));
  await assertSucceeds(getDocs(collection(anonDb, rootCompPath('dressageFinalization'))));
  // No competition at all: nothing to show
  await assertFails(getDoc(doc(anonDb, 'competitions/no-such-comp/marathonFinalization/1')));
});

test('finalization log names and claimed equipage lists are capped', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('prec-byname-1', 'precision');
  const db = officialDb('prec-byname-1');
  const lock = doc(db, rootCompPath(`precisionFinalization/${START_NO}`));
  const logEntry = (byName) => {
    const b = writeBatch(db);
    const logRef = doc(collection(db, rootCompPath('finalizationLog')));
    b.set(logRef, { discipline: 'precision', action: 'finalize', startNumber: START_NO, by: 'prec-byname-1', byName, at: serverTimestamp() });
    b.set(lock, { finalized: true, lastLogId: logRef.id }, { merge: true });
    return b.commit();
  };
  await assertFails(logEntry('x'.repeat(201)));
  await assertFails(logEntry(42));
  await assertSucceeds(logEntry('Anna Andersson'));

  const userDb = testEnv.authenticatedContext('claim-cap-1', { email_verified: true, email: 'claim@example.com' }).firestore();
  await assertSucceeds(setDoc(doc(userDb, 'users/claim-cap-1'), { email: 'claim@example.com', role: 'publik', claimedEquipages: [] }));
  const claims = (n) => Array.from({ length: n }, (_, i) => ({ competitionId: `c${i}`, startNumber: i, competitionName: 'T' }));
  await assertSucceeds(updateDoc(doc(userDb, 'users/claim-cap-1'), { claimedEquipages: claims(200) }));
  await assertFails(updateDoc(doc(userDb, 'users/claim-cap-1'), { claimedEquipages: claims(201) }));
});
test('competition privacy settings: retentionMonths 1-120 whole months, short privacy contact', { skip: !HAS_EMULATOR }, async () => {
  const ownerDb = testEnv.authenticatedContext('owner-1', { email_verified: true, email: 'owner@example.com' }).firestore();
  await assertSucceeds(updateDoc(doc(ownerDb, compPath()), { retentionMonths: 24, privacyContact: 'sekreterare@klubben.se' }));
  await assertFails(updateDoc(doc(ownerDb, compPath()), { retentionMonths: 0 }));
  await assertFails(updateDoc(doc(ownerDb, compPath()), { retentionMonths: 121 }));
  await assertFails(updateDoc(doc(ownerDb, compPath()), { retentionMonths: 6.5 }));
  await assertFails(updateDoc(doc(ownerDb, compPath()), { retentionMonths: '12' }));
  await assertFails(updateDoc(doc(ownerDb, compPath()), { privacyContact: 'x'.repeat(201) }));
  await assertSucceeds(updateDoc(doc(ownerDb, compPath()), { retentionMonths: deleteField(), privacyContact: deleteField() }));
});

test('retention and account deletion records are server only', { skip: !HAS_EMULATOR }, async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'retentionRuns/r1'), { startedAt: 1 });
    await setDoc(doc(db, 'personalDataRetention/a__b'), { purgedAt: 1 });
    await setDoc(doc(db, 'accountDeletions/d1'), { deletedAt: 1 });
  });
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users/global-admin-r'), { email: 'ga@example.com', role: 'admin' });
  });
  const adminDb = testEnv.authenticatedContext('global-admin-r', { email_verified: true, email: 'ga@example.com' }).firestore();
  for (const path of ['retentionRuns/r1', 'personalDataRetention/a__b', 'accountDeletions/d1']) {
    await assertFails(getDoc(doc(adminDb, path)));
    await assertFails(setDoc(doc(adminDb, path), { x: 1 }));
    await assertFails(deleteDoc(doc(adminDb, path)));
  }
});

test('competition admins may not delete result lock documents directly (clearEquipageFinalizationLocks does)', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('lock-admin-1', 'admin');
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), rootCompPath(`dressageFinalization/${START_NO}`)), { finalized: true });
  });
  const adminDb = testEnv.authenticatedContext('lock-admin-1', { email_verified: true, email: 'lock-admin-1@example.com' }).firestore();
  await assertFails(deleteDoc(doc(adminDb, rootCompPath(`dressageFinalization/${START_NO}`))));
});
