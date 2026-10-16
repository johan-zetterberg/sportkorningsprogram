import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore';

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'combined-driving';
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
    clubName: 'New Club',
    speakerNotes: 'Updated by driver',
    updatedAt: '2026-06-08T10:00:00Z'
  }));
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
  await assertSucceeds(updateDoc(doc(db, compPath('equipages/eq-horse-1')), { groom: 'Anna' }));
  // Their horses' temperatures they may enter
  await assertSucceeds(updateDoc(doc(db, compPath('equipages/eq-horse-1')), {
    horseTemperatures: { SE001: { '2026-10-13_morning': { temperatureC: 37.8 } } }
  }));
  await assertFails(updateDoc(doc(db, compPath('equipages/eq-horse-1')), { horseTemperatures: 'x' }));
});

test('a locked declaration cannot be changed directly; temperatures stay open', { skip: !HAS_EMULATOR }, async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, compPath('equipages/eq-lock-1')), { startNumber: 6, groom: 'Bo' });
    await setDoc(doc(db, compPath('equipagePrivate/eq-lock-1')), { email: 'lock-driver@example.com' });
    await setDoc(doc(db, compPath('config/competitionMeta')), { manualLockdown: true });
  });
  const db = testEnv.authenticatedContext('lock-driver', { email_verified: true, email: 'lock-driver@example.com' }).firestore();
  await assertFails(updateDoc(doc(db, compPath('equipages/eq-lock-1')), { groom: 'Anna' }));
  await assertFails(updateDoc(doc(db, compPath('equipages/eq-lock-1')), { carriage: 'Ny vagn' }));
  await assertSucceeds(updateDoc(doc(db, compPath('equipages/eq-lock-1')), {
    horseTemperatures: { SE002: { '2026-10-13_morning': { temperatureC: 37.6 } } }
  }));
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), compPath('config/competitionMeta')), { manualLockdown: false });
  });
  await assertSucceeds(updateDoc(doc(db, compPath('equipages/eq-lock-1')), { groom: 'Anna' }));
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
    accessCode: 'updated-admin-pin'
  }));
});

test('non-admin competition role may not write config documents', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('speaker-config-1', 'speaker', 'speaker-config@example.com');
  const ctx = testEnv.authenticatedContext('speaker-config-1', { email_verified: true, email: 'speaker-config@example.com' });
  const db = ctx.firestore();

  await assertFails(setDoc(doc(db, compPath('config/display')), {
    title: 'Speaker Updated'
  }));
});

test('auditLog writes are allowed for admin-scoped competition access', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('admin-audit-1', 'admin', 'admin-audit@example.com');
  const ctx = testEnv.authenticatedContext('admin-audit-1', { email_verified: true, email: 'admin-audit@example.com' });
  const db = ctx.firestore();

  await assertSucceeds(setDoc(doc(db, privateCompPath('auditLog/log-1')), {
    discipline: 'precision',
    startNumber: 12,
    field: 'timeMs',
    oldValue: 100000,
    newValue: 101000
  }));
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

test('auditLog writes are denied for non-admin competition roles', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('precision-audit-1', 'precision', 'precision-audit@example.com');
  const ctx = testEnv.authenticatedContext('precision-audit-1', { email_verified: true, email: 'precision-audit@example.com' });
  const db = ctx.firestore();

  await assertFails(setDoc(doc(db, privateCompPath('auditLog/log-2')), {
    discipline: 'precision',
    startNumber: 12,
    field: 'timeMs',
    oldValue: 100000,
    newValue: 101000
  }));
});

test('auditLog is append-only for admins', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('admin-audit-3', 'admin', 'admin-audit3@example.com');
  const ctx = testEnv.authenticatedContext('admin-audit-3', { email_verified: true, email: 'admin-audit3@example.com' });
  const db = ctx.firestore();
  const ref = doc(db, privateCompPath('auditLog/log-append-1'));

  await assertSucceeds(setDoc(ref, {
    discipline: 'marathon',
    startNumber: 7,
    field: 'duration_A',
    oldValue: 60000,
    newValue: 61000
  }));
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
  const protectedCollections = ['equipagePrivate', 'roleEmails', 'judges', 'officials', 'assignments', 'admins', 'auditLog', 'volunteerSignups', 'maintenanceRuns'];
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
  assert.equal(PROJECT_ID, 'combined-driving');
});
