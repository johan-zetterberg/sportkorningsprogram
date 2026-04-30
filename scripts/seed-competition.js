import { auth, db, appId } from '../js/config/firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, setDoc, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { createCompetition, updateCompetition, saveConfig } from '../js/services/competitionService.js';
import { saveEquipage } from '../js/services/equipageService.js';
import { saveJudge, saveOfficial } from '../js/services/adminService.js';
import { saveVolunteerSignup, saveAssignment, saveLocations, saveRoles } from '../js/services/officialsService.js';
import { saveDressageJudgeProtocol, saveDressageGeneralData, setDressageStatus } from '../js/services/dressageService.js';
import { saveMarathonTimingData, saveMarathonObstacleResult } from '../js/services/marathonService.js';
import { savePrecisionResult } from '../js/services/precisionService.js';
import { dressagePrograms } from '../js/data/dressagePrograms.js';

const CLASS_DEFS = {
  'Latt B': {
    testKey: findProgramKey('SvLB'),
    precisionMaxTime: 200,
    marathon: { distanceA: 2000, tempoA: 250, distanceT: 800, tempoT: 200, distanceB: 3500, tempoB: 200, windowA: 2, windowB: 3, obstaclePenaltyRate: 0.25 }
  },
  'Latt A': {
    testKey: findProgramKey('SvLA'),
    precisionMaxTime: 190,
    marathon: { distanceA: 2500, tempoA: 250, distanceT: 1000, tempoT: 200, distanceB: 4000, tempoB: 216.666, windowA: 2, windowB: 3, obstaclePenaltyRate: 0.25 }
  },
  'Msv': {
    testKey: findProgramKey('sv_msv_4_enb_2025', 'SvMsvB'),
    pairTestKey: findProgramKey('sv_msv_4_par_2025', 'SvMsvB'),
    precisionMaxTime: 180,
    marathon: { distanceA: 3000, tempoA: 250, distanceT: 1200, tempoT: 200, distanceB: 5000, tempoB: 233.333, windowA: 2, windowB: 3, obstaclePenaltyRate: 0.25 }
  }
};

const DRESSAGE_GENERAL = {
  dressage_finalized: { errorPoints: 0, errorComment: 'Rent program. Endast mindre spanningsmoment i forsta halten.' },
  dressage_pending: { errorPoints: 2, errorComment: 'Felkorning i overgangen till skritt, i ovrigt korrekt program.' },
  dressage_pending_multi: { errorPoints: 1, errorComment: 'Smarre miss i hallen, dubbelkollas vid attest.' },
  dressage_ongoing_multi: { errorPoints: 0, errorComment: 'En domare klar, invantar sista protokollet.' },
  dressage_eliminated: { errorPoints: 0, errorComment: 'Eliminering efter avbrott i programmet.' },
  dressage_missing_judge: { errorPoints: 1, errorComment: 'Endast domare C har sparat protokoll, skall inte visas som klar.' },
  all_complete: { errorPoints: 1, errorComment: 'Liten linjemiss mot slutet men inom ramen for godkant resultat.' }
};

function makeLogger(log) {
  return (msg) => {
    if (typeof log === 'function') log(msg);
  };
}

function addMinutes(baseDate, minutes) {
  return new Date(baseDate.getTime() + (minutes * 60 * 1000));
}

function isoLocal(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function findProgramKey(...keys) {
  return keys.find((key) => key && dressagePrograms[key]) || Object.keys(dressagePrograms)[0];
}

function buildDressageComment(movement, score, judgePosition, idx) {
  const movementRef = movement.letters || movement.text || `Moment ${movement.no || idx + 1}`;
  if (score >= 8) return `${judgePosition}: Stabilt genom ${movementRef}. God form och tydlig precision.`;
  if (score >= 7) return `${judgePosition}: Jamt genomfort i ${movementRef}. Mindre anmarkning pa precisionen.`;
  if (score >= 6) return `${judgePosition}: Godkant i ${movementRef}, men behov av battre balans och noggrannhet.`;
  return `${judgePosition}: Miss i ${movementRef}. Behover lugnare vag och battre eftergift.`;
}

function buildProtocol(programKey, options = {}) {
  const program = dressagePrograms[programKey];
  const {
    scorePattern = [7],
    judgePosition = 'C',
    commentFrequency = 2,
    trailingComments = true
  } = options;

  if (!program?.movements?.length) {
    return [{ momentNo: 1, score: 7, comment: `${judgePosition}: Testprotokoll.` }];
  }

  return program.movements.map((movement, index) => {
    const score = scorePattern[index % scorePattern.length] ?? 7;
    return {
      momentNo: movement.no,
      score,
      comment: (index % commentFrequency === 0 || (trailingComments && index >= program.movements.length - 2))
        ? buildDressageComment(movement, score, judgePosition, index)
        : ''
    };
  });
}

function getProgramForClass(className, category = 'horse', forcePair = false) {
  if (className === 'Msv') {
    return forcePair || category === 'pair' ? CLASS_DEFS.Msv.pairTestKey : CLASS_DEFS.Msv.testKey;
  }
  return CLASS_DEFS[className]?.testKey || Object.keys(dressagePrograms)[0];
}

function createEquipage(sn, className, driverName, horseName, profile, options = {}) {
  const category = options.category || 'horse';
  return {
    sn,
    className,
    driverName,
    horseName,
    category,
    testKey: options.testKey || getProgramForClass(className, category, options.forcePair),
    profile,
    ...options
  };
}

function getBaseProfiles() {
  return [
    createEquipage(1, 'Latt B', 'Seeder Kusk 1', 'Atlas', 'dressage_finalized'),
    createEquipage(2, 'Latt B', 'Seeder Kusk 2', 'Blixt', 'dressage_pending'),
    createEquipage(3, 'Msv', 'Seeder Kusk 3', 'Comet', 'dressage_ongoing_multi'),
    createEquipage(10, 'Msv', 'Seeder Kusk 10', 'Jasmin', 'dressage_pending_multi'),
    createEquipage(4, 'Latt A', 'Seeder Kusk 4', 'Disa', 'marathon_stage_running'),
    createEquipage(5, 'Latt A', 'Seeder Kusk 5', 'Echo', 'marathon_obstacle_live'),
    createEquipage(6, 'Msv', 'Seeder Kusk 6', 'Fenix', 'marathon_finalized', { category: 'pair', forcePair: true }),
    createEquipage(7, 'Latt B', 'Seeder Kusk 7', 'Gloria', 'precision_finalized'),
    createEquipage(8, 'Latt B', 'Seeder Kusk 8', 'Hero', 'precision_running'),
    createEquipage(9, 'Msv', 'Seeder Kusk 9', 'Indra', 'all_complete')
  ];
}

function getEdgeCaseProfiles() {
  return [
    createEquipage(11, 'Msv', 'Seeder Kusk 11', 'Komet', 'dressage_missing_judge'),
    createEquipage(12, 'Latt B', 'Seeder Kusk 12', 'Luna', 'dressage_eliminated'),
    createEquipage(13, 'Latt A', 'Seeder Kusk 13', 'Mira', 'marathon_eliminated_obstacle'),
    createEquipage(14, 'Latt B', 'Seeder Kusk 14', 'Nova', 'precision_incomplete'),
    createEquipage(15, 'Latt B', 'Seeder Kusk 15', 'Orkan', 'precision_eliminated'),
    createEquipage(16, 'Msv', 'Seeder Kusk 16', 'Pegasus', 'all_complete', { category: 'pair', forcePair: true, tieVariant: 'a' }),
    createEquipage(17, 'Msv', 'Seeder Kusk 17', 'Quatro', 'all_complete', { tieVariant: 'b' })
  ];
}

function getStressProfiles(startSn = 30, count = 30) {
  const classCycle = ['Latt B', 'Latt A', 'Msv'];
  const profileCycle = [
    'dressage_pending',
    'dressage_finalized',
    'marathon_stage_running',
    'precision_finalized',
    'all_complete',
    'dressage_pending_multi',
    'precision_running',
    'marathon_finalized'
  ];

  return Array.from({ length: count }, (_, index) => {
    const sn = startSn + index;
    const className = classCycle[index % classCycle.length];
    const profile = profileCycle[index % profileCycle.length];
    const forcePair = className === 'Msv' && index % 4 === 0;
    return createEquipage(
      sn,
      className,
      `Stress Kusk ${sn}`,
      `Stress Hast ${sn}`,
      profile,
      { category: forcePair ? 'pair' : 'horse', forcePair }
    );
  });
}

function buildGeneralDressageData(profile) {
  return DRESSAGE_GENERAL[profile] || { errorPoints: 0, errorComment: '' };
}

function buildStressVolunteerSignups() {
  return [
    {
      name: 'Cedric Funktionar',
      phone: '070-333 44 55',
      email: 'cedric.funktionar@example.com',
      club: 'Laholms Ryttarforening',
      role: 'Strackobservator',
      notes: 'Kan ta langa pass pa maratonet.',
      iceName: 'Nina Funktionar',
      icePhone: '070-222 11 00',
      diet: 'Laktosfritt',
      shirtSize: 'L'
    },
    {
      name: 'Disa Reserv',
      phone: '070-555 66 77',
      email: 'disa.reserv@example.com',
      club: 'Morums Ryttarforening',
      role: 'Konvakt',
      notes: 'Tillganglig hela eftermiddagen.',
      iceName: 'Per Reserv',
      icePhone: '070-111 22 44',
      diet: 'Veganskt',
      shirtSize: 'M'
    }
  ];
}

async function upsertLiveMarathonState(competitionId, startNumber, data) {
  const ref = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/maraton/${String(startNumber)}`);
  await setDoc(ref, {
    ...data,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function finalizeDressageSeed(competitionId, startNumber, user) {
  const ref = doc(db, `competitions/${competitionId}/dressageFinalization/${String(startNumber)}`);
  await setDoc(ref, {
    finalized: true,
    finalizedAt: Date.now(),
    finalizedBy: user?.uid || null
  }, { merge: true });
}

async function finalizeMarathonSeed(competitionId, startNumber, user) {
  const ref = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/maraton/${String(startNumber)}`);
  await setDoc(ref, {
    finalized: true,
    status: 'Klar',
    finalizedBy: user?.uid || null,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function finalizePrecisionSeed(competitionId, startNumber, user) {
  const ref = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/precision/${String(startNumber)}`);
  await setDoc(ref, {
    prioritized: true,
    finalized: true,
    finalizedAt: Date.now(),
    finalizedBy: user?.uid || null
  }, { merge: true });
}

async function ensureAuthenticated(log) {
  if (auth.currentUser) return auth.currentUser;

  log('Vantar pa autentisering...');
  await new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        unsub();
        resolve();
      }
    });
    setTimeout(resolve, 5000);
  });

  if (!auth.currentUser) {
    throw new Error('Du maste vara inloggad for att kora seedern.');
  }
  return auth.currentUser;
}

async function seedCoreConfigs(competitionId, user) {
  await updateCompetition(competitionId, {
    published: true,
    adminEmails: user.email ? [String(user.email).toLowerCase()] : []
  });

  await saveConfig(competitionId, 'competitionMeta', {
    manualLockdown: false,
    isInternational: false,
    seededBy: user.email || user.uid,
    seededAt: Date.now()
  });

  await saveConfig(competitionId, 'maratonConfig', {
    marathonClassData: {
      'Latt B': CLASS_DEFS['Latt B'].marathon,
      'Latt A': CLASS_DEFS['Latt A'].marathon,
      'Msv': CLASS_DEFS['Msv'].marathon
    },
    timePenaltyRate: 0.25
  });

  await saveConfig(competitionId, 'precisionConfig', {
    maxTimeByClass: {
      'Latt B': CLASS_DEFS['Latt B'].precisionMaxTime,
      'Latt A': CLASS_DEFS['Latt A'].precisionMaxTime,
      'Msv': CLASS_DEFS['Msv'].precisionMaxTime
    },
    timePenaltyRate: 0.5,
    knockdownPenalty: 3
  });

  await saveConfig(competitionId, 'dressageJudgeMapping', {
    'Latt B': { C: 'judge-c' },
    'Latt A': { C: 'judge-c' },
    'Msv': { C: 'judge-c', E: 'judge-e' }
  });
}

async function seedOfficialsAndSetup(competitionId, user, includeStress) {
  await saveJudge(competitionId, 'judge-c', {
    id: 'judge-c',
    name: 'Domare C',
    email: user.email || '',
    position: 'C',
    roles: [{ discipline: 'dressage', position: 'C' }]
  });
  await saveJudge(competitionId, 'judge-e', {
    id: 'judge-e',
    name: 'Domare E',
    email: 'judge.e@example.com',
    position: 'E',
    roles: [{ discipline: 'dressage', position: 'E' }]
  });

  const officials = [
    {
      id: 'official-self',
      name: 'Seeder Funktionar',
      email: user.email || '',
      role: 'dressage',
      phone: '070-000 11 22',
      club: 'Seeder Club',
      notes: 'Har funktionarsportalen som huvudtest.',
      area: 'Dressyrbana',
      isActive: true
    },
    {
      id: 'official-marathon',
      name: 'Maraton Funktionar',
      email: 'maraton.test@example.com',
      role: 'marathon',
      phone: '070-111 22 33',
      club: 'Seeder Club',
      notes: 'Skall synas i funktionarsoversikten.',
      area: 'Stracka B',
      isActive: true
    },
    {
      id: 'official-precision',
      name: 'Precision Funktionar',
      email: 'precision.test@example.com',
      role: 'precision',
      phone: '070-222 33 44',
      club: 'Seeder Club',
      notes: 'Har ansvar for final bana och hinderkontroll.',
      area: 'Precisionbana',
      isActive: true
    }
  ];

  if (includeStress) {
    officials.push(
      {
        id: 'official-speaker',
        name: 'Speaker Funktionar',
        email: 'speaker.test@example.com',
        role: 'speaker',
        phone: '070-333 11 22',
        club: 'Seeder Club',
        notes: 'Skall testa speaker- och monitorfloden.',
        area: 'Speakerplats',
        isActive: true
      },
      {
        id: 'official-admin',
        name: 'Sekretariat Reserv',
        email: 'admin.test@example.com',
        role: 'admin',
        phone: '070-444 22 11',
        club: 'Seeder Club',
        notes: 'Testar bredare adminatkomst.',
        area: 'Sekretariat',
        isActive: true
      }
    );
  }

  for (const official of officials) {
    await saveOfficial(competitionId, official);
  }

  const roles = [
    { id: 'dressage_writer', label: 'Protokollskrivare', discipline: 'dressage' },
    { id: 'warmup_host', label: 'Framridning / framkorning', discipline: 'dressage' },
    { id: 'obstacle_judge', label: 'Hinderdomare', discipline: 'marathon' },
    { id: 'stage_observer', label: 'Strackobservator', discipline: 'marathon' },
    { id: 'precision_gate', label: 'Konvakt', discipline: 'precision' }
  ];

  const locations = [
    { id: 'dressage_court', label: 'Dressyrbana', type: 'court' },
    { id: 'dressage_warmup', label: 'Framkorning dressyr', type: 'dressage_func' },
    { id: 'obstacle_3', label: 'Hinder 3', type: 'obstacle' },
    { id: 'section_b', label: 'Stracka B', type: 'section' },
    { id: 'precision_arena', label: 'Precisionbana', type: 'course_p' }
  ];

  if (includeStress) {
    locations.push(
      { id: 'obstacle_5', label: 'Hinder 5', type: 'obstacle' },
      { id: 'section_a', label: 'Stracka A', type: 'section' },
      { id: 'speaker_tower', label: 'Speakerplats', type: 'office' }
    );
  }

  await saveRoles(competitionId, roles);
  await saveLocations(competitionId, locations);

  const volunteerSignups = [
    {
      name: 'Anna Reserv',
      phone: '070-444 55 66',
      email: 'anna.reserv@example.com',
      club: 'Skanska Korskallskapet',
      role: 'Hinderdomare',
      notes: 'Kan ta sen eftermiddag och hjalpa till med speakerstod.',
      iceName: 'Lars Reserv',
      icePhone: '070-777 88 99',
      diet: 'Vegetarisk',
      shirtSize: 'M'
    },
    {
      name: 'Beata Funktionar',
      phone: '070-123 45 67',
      email: 'beata.funktionar@example.com',
      club: 'Trolleholms Ryttarforening',
      role: 'Protokollskrivare',
      notes: 'Har arbetat med tvadomarsklasser tidigare.',
      iceName: 'Eva Funktionar',
      icePhone: '070-765 43 21',
      diet: 'Glutenfritt',
      shirtSize: 'S'
    }
  ];

  if (includeStress) {
    volunteerSignups.push(...buildStressVolunteerSignups());
  }

  const signupIds = [];
  for (const signup of volunteerSignups) {
    signupIds.push(await saveVolunteerSignup(competitionId, signup));
  }

  return { signupCount: signupIds.length };
}

async function seedAssignments(competitionId, today, includeStress) {
  const assignments = [
    {
      id: 'assign-dressage-self',
      officialId: 'official-self',
      role: 'dressage_writer',
      roleLabel: 'Protokollskrivare',
      locationType: 'court',
      locationId: 'dressage_court',
      locationLabel: 'Dressyrbana',
      moment: 'dressage',
      shift: 'fm',
      startTime: '08:00',
      endTime: '12:30',
      dateString: today.toISOString().slice(0, 10)
    },
    {
      id: 'assign-marathon',
      officialId: 'official-marathon',
      role: 'obstacle_judge',
      roleLabel: 'Hinderdomare',
      locationType: 'obstacle',
      locationId: 'obstacle_3',
      locationLabel: 'Hinder 3',
      moment: 'marathon',
      shift: 'em',
      startTime: '13:00',
      endTime: '17:30',
      dateString: today.toISOString().slice(0, 10)
    },
    {
      id: 'assign-precision',
      officialId: 'official-precision',
      role: 'precision_gate',
      roleLabel: 'Konvakt',
      locationType: 'course_p',
      locationId: 'precision_arena',
      locationLabel: 'Precisionbana',
      moment: 'precision',
      shift: 'em',
      startTime: '15:00',
      endTime: '18:00',
      dateString: today.toISOString().slice(0, 10)
    }
  ];

  if (includeStress) {
    assignments.push(
      {
        id: 'assign-speaker',
        officialId: 'official-speaker',
        role: 'speaker',
        roleLabel: 'Speaker',
        locationType: 'office',
        locationId: 'speaker_tower',
        locationLabel: 'Speakerplats',
        moment: 'all',
        shift: 'all',
        startTime: '08:00',
        endTime: '18:00',
        dateString: today.toISOString().slice(0, 10)
      },
      {
        id: 'assign-obstacle-5',
        officialId: 'official-marathon',
        role: 'obstacle_judge',
        roleLabel: 'Hinderdomare',
        locationType: 'obstacle',
        locationId: 'obstacle_5',
        locationLabel: 'Hinder 5',
        moment: 'marathon',
        shift: 'em',
        startTime: '14:00',
        endTime: '17:00',
        dateString: today.toISOString().slice(0, 10)
      }
    );
  }

  for (const assignment of assignments) {
    await saveAssignment(competitionId, assignment);
  }
}

async function seedEquipagesAndTimes(competitionId, equipages, baseTime, log) {
  const startTimes = {};

  for (const [index, eq] of equipages.entries()) {
    log(`Skapar ekipage #${eq.sn}: ${eq.profile}`);
    await saveEquipage(competitionId, eq.sn, {
      startNumber: eq.sn,
      driverName: eq.driverName,
      horseName: eq.horseName,
      className: eq.className,
      category: eq.category,
      testKey: eq.testKey
    });

    startTimes[String(eq.sn)] = {
      dressage: isoLocal(addMinutes(baseTime, index * 7)),
      maraton: isoLocal(addMinutes(baseTime, 120 + index * 6)),
      marathon: isoLocal(addMinutes(baseTime, 120 + index * 6)),
      precision: isoLocal(addMinutes(baseTime, 240 + index * 5))
    };
  }

  await saveConfig(competitionId, 'startTimes', { times: startTimes });
}

async function seedDressageForEquipage(competitionId, eq, user) {
  if (['dressage_finalized', 'dressage_pending', 'all_complete'].includes(eq.profile)) {
    await saveDressageGeneralData(competitionId, eq.sn, buildGeneralDressageData(eq.profile));
    await saveDressageJudgeProtocol(competitionId, eq.sn, 'judge-c', {
      testKey: eq.testKey,
      movements: buildProtocol(eq.testKey, {
        scorePattern: eq.tieVariant ? [8, 7, 8, 7] : (eq.profile === 'all_complete' ? [8, 8, 7, 8] : [7, 7, 8, 6]),
        judgePosition: 'C',
        commentFrequency: 2
      })
    });
    await setDressageStatus(competitionId, eq.sn, { state: 'finished', judgeId: 'judge-c', judgeName: 'Domare C' });
    if (eq.profile === 'dressage_finalized') {
      await finalizeDressageSeed(competitionId, eq.sn, user);
    }
    return;
  }

  if (eq.profile === 'dressage_ongoing_multi') {
    await saveDressageGeneralData(competitionId, eq.sn, buildGeneralDressageData(eq.profile));
    await saveDressageJudgeProtocol(competitionId, eq.sn, 'judge-c', {
      testKey: eq.testKey,
      movements: buildProtocol(eq.testKey, {
        scorePattern: [7, 6, 7, 6, 7],
        judgePosition: 'C',
        commentFrequency: 3
      })
    });
    await setDressageStatus(competitionId, eq.sn, { state: 'ongoing', judgeId: 'judge-c', judgeName: 'Domare C' });
    return;
  }

  if (eq.profile === 'dressage_pending_multi') {
    await saveDressageGeneralData(competitionId, eq.sn, buildGeneralDressageData(eq.profile));
    await saveDressageJudgeProtocol(competitionId, eq.sn, 'judge-c', {
      testKey: eq.testKey,
      movements: buildProtocol(eq.testKey, {
        scorePattern: [7, 7, 8, 7, 6],
        judgePosition: 'C',
        commentFrequency: 3
      })
    });
    await saveDressageJudgeProtocol(competitionId, eq.sn, 'judge-e', {
      testKey: eq.testKey,
      movements: buildProtocol(eq.testKey, {
        scorePattern: [7, 8, 7, 7, 6],
        judgePosition: 'E',
        commentFrequency: 4
      })
    });
    await setDressageStatus(competitionId, eq.sn, { state: 'finished', judgeId: 'judge-e', judgeName: 'Domare E' });
    return;
  }

  if (eq.profile === 'dressage_missing_judge') {
    await saveDressageGeneralData(competitionId, eq.sn, buildGeneralDressageData(eq.profile));
    await saveDressageJudgeProtocol(competitionId, eq.sn, 'judge-c', {
      testKey: eq.testKey,
      movements: buildProtocol(eq.testKey, {
        scorePattern: [7, 6, 7, 7, 6],
        judgePosition: 'C',
        commentFrequency: 3
      })
    });
    await setDressageStatus(competitionId, eq.sn, { state: 'ongoing', judgeId: 'judge-c', judgeName: 'Domare C' });
    return;
  }

  if (eq.profile === 'dressage_eliminated') {
    await saveDressageGeneralData(competitionId, eq.sn, buildGeneralDressageData(eq.profile));
    await saveDressageJudgeProtocol(competitionId, eq.sn, 'judge-c', {
      testKey: eq.testKey,
      eliminated: true,
      movements: buildProtocol(eq.testKey, {
        scorePattern: [4, 5, 0, 0],
        judgePosition: 'C',
        commentFrequency: 1
      })
    });
    await setDressageStatus(competitionId, eq.sn, { state: 'finished', judgeId: 'judge-c', judgeName: 'Domare C' });
  }
}

async function seedMarathonForEquipage(competitionId, eq, user) {
  if (['all_complete', 'marathon_finalized'].includes(eq.profile)) {
    const durationA = eq.tieVariant === 'a' ? 11 * 60 : 12 * 60;
    const durationB = eq.tieVariant === 'a' ? 19 * 60 : 20 * 60;
    await saveMarathonTimingData(competitionId, eq.sn, {
      className: eq.className,
      duration_A: durationA,
      duration_B: durationB
    });
    await saveMarathonObstacleResult(competitionId, eq.sn, 1, {
      timeInSeconds: eq.tieVariant === 'b' ? 21 : 20,
      penalty: eq.tieVariant === 'b' ? 1 : 0,
      routeString: 'A-B-C-D',
      comment: eq.profile === 'all_complete'
        ? 'Rent hinder med jamn rytm genom hela linjen.'
        : 'Godkant hinder, sparat som finaliseringsfall.'
    });
    if (eq.profile === 'marathon_finalized') {
      await finalizeMarathonSeed(competitionId, eq.sn, user);
    }
    return;
  }

  if (eq.profile === 'marathon_stage_running') {
    await upsertLiveMarathonState(competitionId, eq.sn, {
      start_A: Timestamp.fromMillis(Date.now() - 120000),
      finish_A: null,
      currentObstacle: null,
      running: false,
      status: 'Pagar'
    });
    return;
  }

  if (eq.profile === 'marathon_obstacle_live') {
    await upsertLiveMarathonState(competitionId, eq.sn, {
      start_B: Timestamp.fromMillis(Date.now() - 300000),
      currentObstacle: 3,
      running: true,
      liveObstacleStartAt: Timestamp.fromMillis(Date.now() - 9000),
      live_staticStartAt: Timestamp.fromMillis(Date.now() - 9000),
      liveObstacleTimeMs: 0,
      status: 'Pagar'
    });
    return;
  }

  if (eq.profile === 'marathon_eliminated_obstacle') {
    await saveMarathonTimingData(competitionId, eq.sn, {
      className: eq.className,
      duration_A: 13 * 60,
      duration_B: 0
    });
    await saveMarathonObstacleResult(competitionId, eq.sn, 2, {
      timeInSeconds: 240,
      penalty: 60,
      routeString: 'A-C-D',
      comment: 'Eliminerad efter stopp och felvag i hinder 2.',
      eliminated: true
    });
    await upsertLiveMarathonState(competitionId, eq.sn, {
      finalized: false,
      status: 'Pagar',
      currentObstacle: 2,
      running: false,
      obstacles: [{ number: 2, eliminated: true, timeSeconds: 240, otherPenalty: 60 }]
    });
  }
}

async function seedPrecisionForEquipage(competitionId, eq, user) {
  if (['precision_finalized', 'all_complete'].includes(eq.profile)) {
    await savePrecisionResult(competitionId, eq.sn, {
      className: eq.className,
      driverName: eq.driverName,
      finalized: true,
      timeMs: eq.tieVariant === 'a' ? 98000 : (eq.profile === 'all_complete' ? 99000 : 103000),
      knocks: eq.tieVariant === 'a' ? 1 : (eq.profile === 'all_complete' ? 0 : 1),
      extraPenalty: eq.tieVariant === 'a' ? 0 : (eq.profile === 'all_complete' ? 0 : 2),
      comment: eq.profile === 'all_complete'
        ? 'Ren runda med bra flyt genom sista linjen.'
        : 'Liten touch pa kona 4 och sent utslag i sista svangen.',
      eliminated: false
    });
    if (eq.profile === 'precision_finalized') {
      await finalizePrecisionSeed(competitionId, eq.sn, user);
    }
    return;
  }

  if (eq.profile === 'precision_running') {
    await savePrecisionResult(competitionId, eq.sn, {
      className: eq.className,
      driverName: eq.driverName,
      running: true,
      finalized: false,
      timeMs: 0,
      knocks: 0,
      extraPenalty: 0,
      comment: 'Ekipaget ar pa bana och anvands for live-monitor test.',
      eliminated: false
    });
    const precRef = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/precision/${String(eq.sn)}`);
    await setDoc(precRef, {
      liveTimeMs: 42000,
      liveTimePenalty: 0,
      liveObstaclePenalty: 3,
      liveTotalPenalty: 3,
      running: true,
      updatedAt: serverTimestamp()
    }, { merge: true });
    return;
  }

  if (eq.profile === 'precision_incomplete') {
    await savePrecisionResult(competitionId, eq.sn, {
      className: eq.className,
      driverName: eq.driverName,
      running: false,
      finalized: false,
      timeMs: 0,
      knocks: 0,
      extraPenalty: 0,
      comment: 'Startad men inte sparad som klar. Anvands for ofullstandigt resultat.',
      eliminated: false
    });
    return;
  }

  if (eq.profile === 'precision_eliminated') {
    await savePrecisionResult(competitionId, eq.sn, {
      className: eq.className,
      driverName: eq.driverName,
      running: false,
      finalized: true,
      timeMs: 125000,
      knocks: 2,
      extraPenalty: 10,
      comment: 'Eliminerad efter felvag och overskriden tid.',
      eliminated: true
    });
  }
}

async function seedScenarioData(competitionId, equipages, user, log) {
  for (const eq of equipages) {
    log(`Seedar scenario #${eq.sn}: ${eq.profile}`);
    await seedDressageForEquipage(competitionId, eq, user);
    await seedMarathonForEquipage(competitionId, eq, user);
    await seedPrecisionForEquipage(competitionId, eq, user);
  }
}

function buildCompetitionName(today, includeStress, includeEdgeCases) {
  const parts = ['AUTO-TEST'];
  if (includeStress) parts.push('STRESS');
  if (includeEdgeCases) parts.push('EDGE');
  parts.push(today.toISOString().slice(0, 16).replace('T', ' '));
  return parts.join(' ');
}

export async function seedCompetition({ log, includeStress = false, includeEdgeCases = false } = {}) {
  const info = makeLogger(log);
  const user = await ensureAuthenticated(info);
  info(`Inloggad som: ${user.email || user.uid}`);

  const today = new Date();
  const compRef = await createCompetition({
    name: buildCompetitionName(today, includeStress, includeEdgeCases),
    place: includeStress ? 'Stress Test Arena' : 'Virtual Arena',
    dates: today.toISOString().slice(0, 10),
    club: 'Seeder Club'
  });

  const competitionId = compRef.id;
  info(`Tavling skapad: ${competitionId}`);

  await seedCoreConfigs(competitionId, user);
  const { signupCount } = await seedOfficialsAndSetup(competitionId, user, includeStress);
  await seedAssignments(competitionId, today, includeStress);

  const equipages = [
    ...getBaseProfiles(),
    ...(includeEdgeCases ? getEdgeCaseProfiles() : []),
    ...(includeStress ? getStressProfiles(30, 30) : [])
  ].sort((a, b) => a.sn - b.sn);

  const baseTime = new Date();
  baseTime.setHours(8, 0, 0, 0);

  await seedEquipagesAndTimes(competitionId, equipages, baseTime, info);
  await seedScenarioData(competitionId, equipages, user, info);

  info(`Seeder klar. ${equipages.length} ekipage och ${signupCount} funktionarsanmalningar skapades.`);
  return {
    competitionId,
    stats: {
      equipages: equipages.length,
      volunteerSignups: signupCount,
      includeStress,
      includeEdgeCases
    },
    links: {
      totalResults: 'index.html#total-resultat',
      officialPortal: 'index.html#official',
      officialsAdmin: 'index.html#admin'
    }
  };
}
