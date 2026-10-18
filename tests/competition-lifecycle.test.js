import test from 'node:test';
import assert from 'node:assert/strict';

import { getCarriageCompliance } from '../js/pages/shared/vagnbreddUtils.js';
import {
  isPulseWarning,
  buildVetStatusUpdate,
  getViloboxBadgeInfo
} from '../js/pages/shared/vetCheckUtils.js';
import {
  setMarathonConfig,
  calculateMarathonResult
} from '../js/utils/marathonUtils.js';
import {
  buildPrecisionResultOrderRows,
  adjustStartOrderForDriverBuffer,
  findDriverStartConflicts
} from '../js/pages/admin/starttiderUtils.js';
import {
  computePortWidth,
  getPortAllowanceCm,
  getStandardPortWidth,
  isStandardPortWidthClass
} from '../js/utils/precisionUtils.js';
import { calculatePrecisionResult } from '../js/utils/precisionCalculation.js';
import { calculateTeamResults } from '../js/services/teamCalculationService.js';
import { getTeamScoringProfile, TEAM_SCORING_PROFILE_IDS } from '../js/services/teamRuleProfiles.js';

test('Competition Lifecycle End-to-End: full 3-day competition workflow', async (t) => {
  // -------------------------------------------------------------
  // 1. Ekipage & Anmälningar
  // -------------------------------------------------------------
  const equipages = [
    {
      startNumber: 1,
      driverName: 'Anna Andersson',
      clubName: 'Körklubben A',
      className: 'Svår Häst Enbet',
      trackWidth: 142, // Giltig (min 138 cm)
      safetyCheck: { approved: true, comment: 'Godkänd vagn' },
      horses: [{ id: 'h1', name: 'Thunder', type: 'Häst' }]
    },
    {
      startNumber: 2,
      driverName: 'Bengt Bengtsson',
      clubName: 'Körklubben B',
      className: 'Medelsvår Fyrspann Häst',
      trackWidth: 126, // Giltig (min 125 cm)
      hitch: 'fyrspann',
      safetyCheck: { approved: true },
      horses: [
        { id: 'h2a', name: 'Star 1', type: 'Häst' },
        { id: 'h2b', name: 'Star 2', type: 'Häst' },
        { id: 'h2c', name: 'Star 3', type: 'Häst' },
        { id: 'h2d', name: 'Star 4', type: 'Häst' }
      ]
    },
    {
      startNumber: 3,
      driverName: 'Anna Andersson', // SAMMA KUSK som Ekipage 1!
      clubName: 'Körklubben A',
      className: 'Lätt B Häst Enbet',
      trackWidth: 118, // Fri bredd i LB
      safetyCheck: { approved: true },
      horses: [{ id: 'h3', name: 'Lightning', type: 'Häst' }]
    },
    {
      startNumber: 4,
      driverName: 'Cecilia Ceder',
      clubName: 'Körklubben A',
      className: 'Svår Häst Enbet',
      trackWidth: 130, // FÖR SMAL för Svår Häst (krav min 138 cm!)
      safetyCheck: { approved: false, comment: 'Underkänd spårvidd' },
      horses: [{ id: 'h4', name: 'Comet', type: 'Häst' }]
    }
  ];

  // -------------------------------------------------------------
  // 2. Vagnmätning & Funktionskontroll (TR Mom 504 / Bilaga 2)
  // -------------------------------------------------------------
  await t.test('2. Carriage compliance evaluation matches TR rules', () => {
    // Eq 1: Svår häst 142 cm -> Godkänd (min 138 cm)
    const comp1 = getCarriageCompliance(equipages[0], 'dressagePrecision');
    assert.equal(comp1.compliant, true);
    assert.equal(comp1.status, 'ok');
    assert.equal(comp1.minWidth, 138);

    // Eq 2: MSV fyrspann 126 cm -> Godkänd (min 125 cm)
    const comp2 = getCarriageCompliance(equipages[1], 'dressagePrecision');
    assert.equal(comp2.compliant, true);
    assert.equal(comp2.status, 'ok');

    // Eq 3: LB 118 cm -> Fri spårvidd
    const comp3 = getCarriageCompliance(equipages[2], 'dressagePrecision');
    assert.equal(comp3.compliant, true);
    assert.equal(comp3.status, 'free');

    // Eq 4: Svår häst 130 cm -> FÖR SMAL (min 138 cm) + ej godkänd funktionskontroll
    const comp4 = getCarriageCompliance(equipages[3], 'dressagePrecision');
    assert.equal(comp4.compliant, false);
    assert.equal(comp4.status, 'too_narrow');
    assert.equal(comp4.minWidth, 138);
    assert.equal(comp4.safetyApproved, false);
  });

  // -------------------------------------------------------------
  // 3. Veterinärbesiktning (TR Mom 526 & FEI Art 948)
  // -------------------------------------------------------------
  await t.test('3. Veterinary phases and vilobox pulse checks', () => {
    // Förbesiktning (the public result, vetInspection_initial)
    const initial = buildVetStatusUpdate(equipages[0], 'initial', { status: 'besiktigad', horseKeys: ['h1'] });
    const eq1WithVet = { ...equipages[0], ...initial.payload };
    assert.equal(initial.horses[0].inspections.initial.status, 'besiktigad');
    assert.equal(eq1WithVet.status, 'besiktigad');

    // Vilobox (10-minuterspaus)
    // Eq 1: Puls 56 bpm -> Godkänd (<= 64 bpm)
    assert.equal(isPulseWarning(56), false);
    const rest = buildVetStatusUpdate(eq1WithVet, 'restArea', { status: 'besiktigad', horseKeys: ['h1'] });
    const badge1 = getViloboxBadgeInfo({ ...eq1WithVet, ...rest.payload });
    assert.equal(badge1.status, 'approved');
    assert.match(badge1.label, /Godkänd/);

    // Eq 4: Puls 72 bpm -> Varning (>64 bpm) och startförbud
    assert.equal(isPulseWarning(72), true);
    const unfit = buildVetStatusUpdate(equipages[3], 'restArea', { status: 'struken', horseKeys: ['h4'] });
    assert.equal(unfit.payload.vetUnfitStageB, true);
    const badge4 = getViloboxBadgeInfo({ ...equipages[3], ...unfit.payload });
    assert.equal(badge4.status, 'unfit');
    assert.match(badge4.label, /Startförbud B/);
  });

  // -------------------------------------------------------------
  // 5. Maraton: Moment B med Hinderuppehåll (TR Mom 523 / FEI Art 964.3)
  // -------------------------------------------------------------
  await t.test('5. Marathon calculation with obstacle held time deduction', () => {
    setMarathonConfig({
      timePenaltyRate: 0.25,
      marathonClassData: {
        'Svår Häst Enbet': {
          distanceB: 6000,
          tempoB: 240
        }
      }
    });

    const rawElapsedMs = 1550 * 1000;
    const marathonDoc = {
      obstacles: [
        { number: 1, timeSeconds: 45.0, ballsDown: 0 },
        { number: 2, timeSeconds: 50.0, ballsDown: 0, holdTimeSec: 60, holdTimeReason: 'Föregående ekipage i hinder' }
      ]
    };

    const timingDoc = {
      duration_B_ms: rawElapsedMs
    };

    const resMarathon = calculateMarathonResult(equipages[0], marathonDoc, timingDoc);
    assert.ok(resMarathon.stages.B);
    assert.equal(resMarathon.stages.B.rawDurationMs, 1550 * 1000, 'Preserves raw gross duration');
    assert.equal(resMarathon.stages.B.holdTimeMs, 60 * 1000, 'Tracks applied hold time in milliseconds');
    assert.equal(resMarathon.stages.B.durationMs, 1490 * 1000, 'Deducts hold time from net driving duration');
  });

  // -------------------------------------------------------------
  // 6. Startordning Precision: Omvänd ordning & 30 min kuskbuffert (TR Mom 535)
  // -------------------------------------------------------------
  await t.test('6. Precision start order generation with 30 min driver buffer', () => {
    const rows = [
      { startNumber: 1, driverName: 'Anna Andersson' },
      { startNumber: 2, driverName: 'Bengt Bengtsson' },
      { startNumber: 3, driverName: 'Anna Andersson' },
      { startNumber: 4, driverName: 'Cecilia Ceder' }
    ];
    const dressage = new Map([
      ['1', { penalty: 48.50 }],
      ['2', { penalty: 52.00 }],
      ['3', { penalty: 55.20 }],
      ['4', { penalty: 60.00 }]
    ]);
    const marathon = new Map([
      ['1', { totalPenalty: 72.30 }], // total 120.80
      ['2', { totalPenalty: 68.40 }], // total 120.40 (ledare)
      ['3', { totalPenalty: 75.60 }], // total 130.80
      ['4', { totalPenalty: 80.00 }]  // total 140.00 (sämst)
    ]);

    const initialOrder = buildPrecisionResultOrderRows(rows, {
      includeEliminated: true,
      getDressageResult: row => dressage.get(String(row.startNumber)),
      getMarathonData: row => marathon.get(String(row.startNumber)),
      getMarathonResult: (_row, data) => data
    });

    // Förväntad omvänd ordning före kuskbuffert:
    // 1:a start: Eq 4 (140.00 p)
    // 2:a start: Eq 3 (130.80 p - Anna)
    // 3:e start: Eq 1 (120.80 p - Anna)
    // 4:e start: Eq 2 (120.40 p - Bengt ledare)
    assert.deepEqual(initialOrder.map(r => r.startNumber), [4, 3, 1, 2]);

    // Antag starttidsintervall 10 minuter mellan ekipage (kl 14:00, 14:10, 14:20, 14:30)
    // Anna startar 14:10 (Eq 3) och 14:20 (Eq 1) -> bara 10 min mellanrum! (Konflikt < 30 min)
    const initialTimes = {
      '4': { precision: '2026-05-20T14:00' },
      '3': { precision: '2026-05-20T14:10' },
      '1': { precision: '2026-05-20T14:20' },
      '2': { precision: '2026-05-20T14:30' }
    };
    const conflicts = findDriverStartConflicts(initialTimes, initialOrder, { minBufferMinutes: 30 });
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].driverName, 'Anna Andersson');
    assert.equal(conflicts[0].diffMinutes, 10);

    // Applicera TR Mom 535.4 automatisk kuskbuffert (min 30 min):
    // Ekipage 3 (tidigare start) flyttas framåt till startplats 0
    const bufferedResult = adjustStartOrderForDriverBuffer(initialOrder, { intervalMin: 10, minBufferMinutes: 30 });
    assert.equal(bufferedResult.rows[bufferedResult.rows.length - 1].startNumber, 2, 'Klassledaren (Eq 2) rubbas inte');
    assert.equal(bufferedResult.adjustedCount, 1);
  });

  // -------------------------------------------------------------
  // 7. Precision: Portbredder, Hinderfel & Tidsstraff (TR Mom 517 / 530 & FEI 974)
  // -------------------------------------------------------------
  await t.test('7. Precision cone widths, standard widths and penalty scoring', () => {
    // Portbreddsvalidering:
    // Eq 1: Svår Häst Enbet -> Fast standardbredd 158 cm (TR Bilaga 2 & 5) oavsett kuskens 142 cm vagn
    assert.equal(isStandardPortWidthClass(equipages[0]), true);
    assert.equal(getStandardPortWidth(equipages[0]), 158);
    assert.equal(computePortWidth(equipages[0]), 158);

    // Eq 2: MSV Fyrspann Häst -> Fyrspannstillägg (+10 cm = 35 cm) på spårvidd 126 cm = 161 cm
    assert.equal(getPortAllowanceCm(equipages[1]), 35);
    assert.equal(computePortWidth(equipages[1]), 126 + 35); // 161 cm

    // Eq 3: Lätt B Häst Enbet -> Tillägg 35 cm på spårvidd 118 cm = 153 cm
    assert.equal(getPortAllowanceCm(equipages[2]), 35);
    assert.equal(computePortWidth(equipages[2]), 118 + 35); // 153 cm

    // Precisionsresultat:
    // Eq 1: Tid 125s (maxtid 120s -> 5s över * 0.5 = 2.5 tidsstraff), 1 boll ned (3 straff) -> 5.5 straff
    const precConfig = { maxTimeByClass: { 'Svår Häst Enbet': 120 }, knockdownPenalty: 3, timePenaltyRate: 0.5 };
    const precRes1 = calculatePrecisionResult(
      { finalized: true, timeMs: 125000, knocks: ['4'] },
      equipages[0],
      precConfig
    );
    assert.equal(precRes1.obstaclePenalty, 3);
    assert.equal(precRes1.timePenalty, 2.5);
    assert.equal(precRes1.totalPenalty, 5.5);
  });

  // -------------------------------------------------------------
  // 8. Totalresultat & Lagtävling (Lag-SM 2026)
  // -------------------------------------------------------------
  await t.test('8. Combined total results and Lag-SM 2026 team ranking', () => {
    const teams = [
      {
        id: 'team-a',
        name: 'Körklubben A Lag 1',
        members: ['1', '3', '4']
      }
    ];

    const processedRows = [
      { id: '1', startNumber: 1, driverName: 'Anna Andersson', dressage: { penalty: 48.50 }, marathon: { totalPenalty: 72.30 }, precision: { totalPenalty: 5.50 }, totalPenalty: 126.30, isEliminated: false },
      { id: '3', startNumber: 3, driverName: 'Anna Andersson (2)', dressage: { penalty: 55.20 }, marathon: { totalPenalty: 75.60 }, precision: { totalPenalty: 3.00 }, totalPenalty: 133.80, isEliminated: false },
      { id: '4', startNumber: 4, driverName: 'Cecilia Ceder', dressage: { penalty: 60.00 }, marathon: { totalPenalty: 80.00 }, precision: { totalPenalty: 6.00 }, totalPenalty: 146.00, isEliminated: false }
    ];

    const profile = getTeamScoringProfile(TEAM_SCORING_PROFILE_IDS.LAG_SM_2026);
    const teamResults = calculateTeamResults(teams, processedRows, profile);
    assert.equal(teamResults.length, 1);
    const teamA = teamResults[0];

    // I Lag-SM räknas de två bästa i respektive gren separat:
    // Dressyr: 48.50 + 55.20 = 103.70
    assert.equal(teamA.dressage, 103.70);
    // Maraton: 72.30 + 75.60 = 147.90
    assert.equal(teamA.marathon, 147.90);
    // Precision: 3.00 + 5.50 = 8.50
    assert.equal(teamA.precision, 8.50);

    // Lagtotal = 103.70 + 147.90 + 8.50 = 260.10
    assert.equal(teamA.total, 260.10);
  });
});
