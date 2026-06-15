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
  query,
  setDoc,
  updateDoc,
  where
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
  const ctx = testEnv.authenticatedContext('speaker-1', { email: 'speaker@example.com' });
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
  const ctx = testEnv.authenticatedContext('admin-1', { email: 'admin@example.com' });
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
  const ctx = testEnv.authenticatedContext('profile-1', { email: 'profile@example.com' });
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

  const ctx = testEnv.authenticatedContext('profile-2', { email: 'profile2@example.com' });
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

  const adminDb = testEnv.authenticatedContext('admin-reader-1', { email: 'admin-reader@example.com' }).firestore();
  const speakerDb = testEnv.authenticatedContext('speaker-reader-1', { email: 'speaker-reader@example.com' }).firestore();

  await assertSucceeds(getDoc(doc(adminDb, compPath('admins/admin-read-1'))));
  await assertFails(getDoc(doc(speakerDb, compPath('admins/admin-read-1'))));
});

test('speaker PIN join may not escalate to admin through roles array', { skip: !HAS_EMULATOR }, async () => {
  const ctx = testEnv.authenticatedContext('speaker-2', { email: 'speaker2@example.com' });
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
  const ctx = testEnv.authenticatedContext('multi-role-1', { email: 'multi@example.com' });
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
  const db = testEnv.authenticatedContext('admin-delete-1', { email: 'admin-delete@example.com' }).firestore();
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

  const ctx = testEnv.authenticatedContext('driver-1', { email: 'driver@example.com' });
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

  const ctx = testEnv.authenticatedContext('driver-1b', { email: 'driver@example.com' });
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

  const ctx = testEnv.authenticatedContext('driver-2', { email: 'other@example.com' });
  const db = ctx.firestore();

  await assertFails(updateDoc(doc(db, compPath('equipages/eq-2')), {
    clubName: 'Hacked Club'
  }));
});

test('speaker role may update equipage outside self-service restrictions', { skip: !HAS_EMULATOR }, async () => {
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

  const ctx = testEnv.authenticatedContext('speaker-eq-1', { email: 'speaker-eq@example.com' });
  const db = ctx.firestore();

  await assertSucceeds(updateDoc(doc(db, compPath('equipages/eq-speaker-1')), {
    driverName: 'Speaker Edited Driver'
  }));
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

  const ownerDb = testEnv.authenticatedContext('private-owner-1', { email: 'private-owner@example.com' }).firestore();
  await assertSucceeds(getDoc(doc(ownerDb, compPath('equipagePrivate/eq-private-1'))));
  await assertSucceeds(getDocs(query(collection(ownerDb, compPath('equipagePrivate')), where('email', '==', 'private-owner@example.com'))));

  await seedCompetitionRole('admin-private-1', 'admin', 'admin-private@example.com');
  const adminDb = testEnv.authenticatedContext('admin-private-1', { email: 'admin-private@example.com' }).firestore();
  await assertSucceeds(getDoc(doc(adminDb, compPath('equipagePrivate/eq-private-1'))));
});

test('private role email docs are not public but readable by owner and admin', { skip: !HAS_EMULATOR }, async () => {
  await seedRoleEmail('role-owner@example.com', ['dressage']);

  const anonymousDb = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(anonymousDb, compPath('roleEmails/role-owner@example.com'))));

  const ownerDb = testEnv.authenticatedContext('role-owner-1', { email: 'role-owner@example.com' }).firestore();
  await assertSucceeds(getDoc(doc(ownerDb, compPath('roleEmails/role-owner@example.com'))));

  await seedCompetitionRole('admin-role-email-1', 'admin', 'admin-role-email@example.com');
  const adminDb = testEnv.authenticatedContext('admin-role-email-1', { email: 'admin-role-email@example.com' }).firestore();
  await assertSucceeds(getDoc(doc(adminDb, compPath('roleEmails/role-owner@example.com'))));
});

test('private role email docs grant discipline access without public competition email arrays', { skip: !HAS_EMULATOR }, async () => {
  await seedRoleEmail('dressage-role@example.com', ['dressage']);

  const db = testEnv.authenticatedContext('dressage-role-1', { email: 'dressage-role@example.com' }).firestore();
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

  const ctx = testEnv.authenticatedContext('precision-1', { email: 'precision@example.com' });
  const db = ctx.firestore();

  await assertFails(setDoc(doc(db, compPath(`precision/${START_NO}`)), {
    startNumber: Number(START_NO),
    timeMs: 100000
  }));
});

test('precision result writes are allowed when the equipage is not finalized', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('precision-2', 'precision', 'precision2@example.com');
  const ctx = testEnv.authenticatedContext('precision-2', { email: 'precision2@example.com' });
  const db = ctx.firestore();

  await assertSucceeds(setDoc(doc(db, compPath(`precision/${START_NO}`)), {
    startNumber: Number(START_NO),
    timeMs: 100000
  }));
});

test('competition discipline roles may finalize only their matching discipline', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('precision-finalizer-1', 'precision', 'precision-finalizer@example.com');
  const ctx = testEnv.authenticatedContext('precision-finalizer-1', { email: 'precision-finalizer@example.com' });
  const db = ctx.firestore();

  await assertSucceeds(setDoc(doc(db, rootCompPath(`precisionFinalization/${START_NO}`)), {
    finalized: true
  }));
  await assertFails(setDoc(doc(db, rootCompPath(`dressageFinalization/${START_NO}`)), {
    finalized: true
  }));
});

test('email-scoped discipline roles may finalize via private roleEmails docs', { skip: !HAS_EMULATOR }, async () => {
  await seedRoleEmail('dressage-role@example.com', ['dressage']);
  const ctx = testEnv.authenticatedContext('dressage-role-1', { email: 'dressage-role@example.com' });
  const db = ctx.firestore();

  await assertSucceeds(setDoc(doc(db, rootCompPath(`dressageFinalization/${START_NO}`)), {
    finalized: true
  }));
  await assertFails(setDoc(doc(db, rootCompPath(`marathonFinalization/${START_NO}`)), {
    finalized: true
  }));
});

test('global non-admin roles may not finalize competitions without a scoped role', { skip: !HAS_EMULATOR }, async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'users/global-judge-1'), {
      email: 'global-judge@example.com',
      role: 'domare'
    });
  });

  const ctx = testEnv.authenticatedContext('global-judge-1', { email: 'global-judge@example.com' });
  const db = ctx.firestore();

  await assertFails(setDoc(doc(db, rootCompPath(`dressageFinalization/${START_NO}`)), {
    finalized: true
  }));
});

test('dressage protocol writes are denied when the equipage is finalized', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('dressage-1', 'dressage', 'dressage@example.com');
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, rootCompPath(`dressageFinalization/${START_NO}`)), {
      finalized: true
    });
  });

  const ctx = testEnv.authenticatedContext('dressage-1', { email: 'dressage@example.com' });
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

  const ctx = testEnv.authenticatedContext('marathon-1', { email: 'marathon@example.com' });
  const db = ctx.firestore();

  await assertFails(setDoc(doc(db, compPath(`maraton/${START_NO}`)), {
    startNumber: Number(START_NO),
    eliminated: false
  }));
});

test('computed_equipages stays server-write-only even for admin role', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('admin-computed-1', 'admin', 'admin-computed@example.com');
  const ctx = testEnv.authenticatedContext('admin-computed-1', { email: 'admin-computed@example.com' });
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

  const adminDb = testEnv.authenticatedContext('admin-secret-1', { email: 'admin-secret@example.com' }).firestore();
  const speakerDb = testEnv.authenticatedContext('speaker-secret-1', { email: 'speaker-secret@example.com' }).firestore();

  await assertSucceeds(getDoc(doc(adminDb, compPath('config/secrets'))));
  await assertFails(getDoc(doc(speakerDb, compPath('config/secrets'))));
});

test('admin may write public config and secrets config', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('admin-config-1', 'admin', 'admin-config@example.com');
  const ctx = testEnv.authenticatedContext('admin-config-1', { email: 'admin-config@example.com' });
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
  const ctx = testEnv.authenticatedContext('speaker-config-1', { email: 'speaker-config@example.com' });
  const db = ctx.firestore();

  await assertFails(setDoc(doc(db, compPath('config/display')), {
    title: 'Speaker Updated'
  }));
});

test('auditLog writes are allowed for admin-scoped competition access', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('admin-audit-1', 'admin', 'admin-audit@example.com');
  const ctx = testEnv.authenticatedContext('admin-audit-1', { email: 'admin-audit@example.com' });
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

  const ctx = testEnv.authenticatedContext('precision-audit-read-1', { email: 'precision-audit-read@example.com' });
  const db = ctx.firestore();

  await seedCompetitionRole('precision-audit-read-1', 'precision', 'precision-audit-read@example.com');
  await assertFails(getDoc(doc(db, privateCompPath('auditLog/log-read-1'))));
});

test('auditLog writes are denied for non-admin competition roles', { skip: !HAS_EMULATOR }, async () => {
  await seedCompetitionRole('precision-audit-1', 'precision', 'precision-audit@example.com');
  const ctx = testEnv.authenticatedContext('precision-audit-1', { email: 'precision-audit@example.com' });
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
  const ctx = testEnv.authenticatedContext('admin-audit-3', { email: 'admin-audit3@example.com' });
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

test('messages and documents stay public-read but admin-write only', { skip: !HAS_EMULATOR }, async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, compPath('messages/msg-1')), {
      title: 'Public Message'
    });
    await setDoc(doc(db, compPath('documents/doc-1')), {
      title: 'Public Document'
    });
  });

  const anonymousDb = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(anonymousDb, compPath('messages/msg-1'))));
  await assertSucceeds(getDoc(doc(anonymousDb, compPath('documents/doc-1'))));

  await seedCompetitionRole('speaker-doc-1', 'speaker', 'speaker-doc@example.com');
  const speakerCtx = testEnv.authenticatedContext('speaker-doc-1', { email: 'speaker-doc@example.com' });
  const speakerDb = speakerCtx.firestore();
  await assertFails(setDoc(doc(speakerDb, compPath('messages/msg-2')), { title: 'Nope' }));
  await assertFails(setDoc(doc(speakerDb, compPath('documents/doc-2')), { title: 'Nope' }));

  await seedCompetitionRole('admin-doc-1', 'admin', 'admin-doc@example.com');
  const adminCtx = testEnv.authenticatedContext('admin-doc-1', { email: 'admin-doc@example.com' });
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
  const publicUserDb = testEnv.authenticatedContext('public-user-1', { email: 'public@example.com' }).firestore();

  await seedCompetitionRole('dressage-role-1', 'dressage', 'dressage-role@example.com');
  const dressageDb = testEnv.authenticatedContext('dressage-role-1', { email: 'dressage-role@example.com' }).firestore();

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

test('rules test environment is using the intended project id', { skip: !HAS_EMULATOR }, () => {
  assert.equal(PROJECT_ID, 'combined-driving');
});
