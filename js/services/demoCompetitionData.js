/**
 * demoCompetitionData.js
 * 
 * Ren datagenerator för ett komplett, realistiskt svenskt sportkörningsdataset
 * enligt Svenska Ridsportförbundets TR V 2025 och FEI Driving Rules 2026.
 * Helt fri från Firebase/webb-beroenden för att kunna köras i både Node.js-tester och browser.
 */

import { TEAM_SCORING_PROFILE_IDS } from './teamRuleProfiles.js';

export function buildDemoCompetitionDataset(customOverrides = {}) {
  const compMeta = {
    name: customOverrides.name || 'SM & Nationell Körning Flyinge (Demo)',
    place: customOverrides.place || 'Flyinge Kungsgård',
    dates: customOverrides.dates || '2026-05-15 - 2026-05-17',
    club: customOverrides.club || 'Skånska Körsällskapet',
    competitionMode: 'live',
    published: true,
    ruleSettings: {
      marathonObstaclePenaltyRate: 0.25,
      precisionTimePenaltyRate: 0.5
    }
  };

  const configs = {
    maratonConfig: {
      stages: {
        A: { minSec: 2100, idealSec: 2400, maxSec: 2700, distanceM: 6000, speedKmh: 15 },
        T: { minSec: 600, idealSec: 720, maxSec: 900, distanceM: 1000, speedKmh: 5 },
        B: { minSec: 3600, idealSec: 4200, maxSec: 4800, distanceM: 7000, speedKmh: 14 }
      },
      restAreaDurationSec: 600, // 10 minuter obligatorisk vila (TR Mom 526.4)
      obstaclesCount: 6,
      classes: {
        'Svår Häst Enbet': { speedA: 15, speedB: 14 },
        'Medelsvår Häst Fyrspann': { speedA: 15, speedB: 14 },
        'Svår Ponny Enbet': { speedA: 14, speedB: 13 },
        'Medelsvår Ponny Par': { speedA: 14, speedB: 13 },
        'Lätt Häst Enbet': { speedA: 14, speedB: 13 },
        'Para Körning Grade I': { speedA: 13, speedB: 12 }
      }
    },
    precisionConfig: {
      defaultAllowanceCm: 20,
      classes: {
        'Svår Häst Enbet': { allowanceCm: 20, speedMpm: 250, distanceM: 600, timeAllowedSec: 144, timeLimitSec: 288 },
        'Medelsvår Häst Fyrspann': { allowanceCm: 30, speedMpm: 240, distanceM: 650, timeAllowedSec: 163, timeLimitSec: 326 },
        'Svår Ponny Enbet': { allowanceCm: 20, speedMpm: 250, distanceM: 580, timeAllowedSec: 140, timeLimitSec: 280 },
        'Medelsvår Ponny Par': { allowanceCm: 25, speedMpm: 240, distanceM: 600, timeAllowedSec: 150, timeLimitSec: 300 },
        'Lätt Häst Enbet': { allowanceCm: 30, speedMpm: 230, distanceM: 550, timeAllowedSec: 144, timeLimitSec: 288 },
        'Para Körning Grade I': { allowanceCm: 30, speedMpm: 220, distanceM: 500, timeAllowedSec: 137, timeLimitSec: 274 }
      }
    },
    teamRules: {
      profileId: TEAM_SCORING_PROFILE_IDS.LAG_SM_2026,
      name: 'Lag-SM 2026'
    },
    dressyrProgramMapping: {
      'Svår Häst Enbet': 'FEI 3* B HP1',
      'Medelsvår Häst Fyrspann': 'FEI 3* B HP4',
      'Svår Ponny Enbet': 'FEI 3* B HP1',
      'Medelsvår Ponny Par': 'FEI 2* B HP2',
      'Lätt Häst Enbet': 'Msv Lätt',
      'Para Körning Grade I': 'FEI Para Test 1'
    }
  };

  const officials = [
    { id: 'off-1', name: 'Göran Gustafsson', role: 'överdomare', contact: '070-1112233' },
    { id: 'off-2', name: 'Bertil Byggare', role: 'banbyggare', contact: '070-2223344' },
    { id: 'off-3', name: 'Veterinär Eva Vet', role: 'veterinär', contact: '070-3334455' }
  ];

  const judges = [
    { id: 'judge-C', name: 'Carina Domare', position: 'C', level: 'Nationell' },
    { id: 'judge-E', name: 'Erik Domare', position: 'E', level: 'Nationell' },
    { id: 'judge-B', name: 'Birgitta Domare', position: 'B', level: 'Svår' }
  ];

  const obstacles = [
    { number: 1, name: 'Vattenhindret', gates: ['A', 'B', 'C', 'D'] },
    { number: 2, name: 'Skogshindret', gates: ['A', 'B', 'C', 'D', 'E'] },
    { number: 3, name: 'Brohindret', gates: ['A', 'B', 'C', 'D'] },
    { number: 4, name: 'Kullarna', gates: ['A', 'B', 'C', 'D', 'E'] },
    { number: 5, name: 'Labyrinten', gates: ['A', 'B', 'C', 'D'] },
    { number: 6, name: 'Slutspurten', gates: ['A', 'B', 'C', 'D', 'E'] }
  ];

  const equipages = [
    {
      startNumber: 1,
      driverName: 'Anna Andersson',
      clubName: 'Skånska Körsällskapet',
      className: 'Svår Häst Enbet',
      horseName: 'Thunder',
      trackWidth: 142,
      marathonTrackWidth: 126,
      safetyCheck: { approved: true, comment: 'Utrustning och vagn godkänd' },
      hasMultipleStarts: true,
      driverStartCount: 2,
      horses: [
        {
          id: 'h1',
          name: 'Thunder',
          type: 'Häst',
          chipNumber: '752098100123456',
          inspections: {
            initial: { status: 'besiktigad', checkedAt: '2026-05-15T08:00:00Z', notes: 'UA' },
            harness: { status: 'besiktigad', checkedAt: '2026-05-16T09:00:00Z', notes: 'Godkänd sele' },
            restArea: { status: 'besiktigad', pulse: 56, respiration: 28, checkedAt: '2026-05-16T11:45:00Z', notes: 'Pigg och alert' },
            final: { status: 'besiktigad', checkedAt: '2026-05-17T08:00:00Z', notes: 'UA' }
          }
        }
      ]
    },
    {
      startNumber: 2,
      driverName: 'Bengt Bengtsson',
      clubName: 'Mälardalens Körsällskap',
      className: 'Medelsvår Häst Fyrspann',
      horseName: 'Star 1, Star 2, Star 3, Star 4',
      hitch: 'fyrspann',
      trackWidth: 158,
      marathonTrackWidth: 126,
      safetyCheck: { approved: true, comment: 'Godkänd vagn' },
      hasMultipleStarts: false,
      horses: [
        {
          id: 'h2a',
          name: 'Star 1',
          type: 'Häst',
          inspections: {
            initial: { status: 'besiktigad' },
            harness: { status: 'besiktigad' },
            restArea: { status: 'besiktigad', pulse: 60 },
            final: { status: 'besiktigad' }
          }
        },
        {
          id: 'h2b',
          name: 'Star 2',
          type: 'Häst',
          inspections: {
            initial: { status: 'besiktigad' },
            harness: { status: 'besiktigad' },
            restArea: { status: 'besiktigad', pulse: 58 },
            final: { status: 'besiktigad' }
          }
        },
        {
          id: 'h2c',
          name: 'Star 3',
          type: 'Häst',
          inspections: {
            initial: { status: 'besiktigad' },
            harness: { status: 'besiktigad' },
            restArea: { status: 'besiktigad', pulse: 62 },
            final: { status: 'besiktigad' }
          }
        },
        {
          id: 'h2d',
          name: 'Star 4',
          type: 'Häst',
          inspections: {
            initial: { status: 'besiktigad' },
            harness: { status: 'besiktigad' },
            restArea: { status: 'besiktigad', pulse: 60 },
            final: { status: 'besiktigad' }
          }
        }
      ]
    },
    {
      startNumber: 3,
      driverName: 'Anna Andersson', // SAMMA KUSK som #1!
      clubName: 'Skånska Körsällskapet',
      className: 'Svår Ponny Enbet',
      horseName: 'Ponnyblixten',
      trackWidth: 138,
      safetyCheck: { approved: true },
      hasMultipleStarts: true,
      driverStartCount: 2,
      horses: [
        {
          id: 'h3',
          name: 'Ponnyblixten',
          type: 'Ponny',
          inspections: {
            initial: { status: 'besiktigad' },
            harness: { status: 'besiktigad' },
            restArea: {
              status: 'ombesiktning',
              pulse: 68,
              respiration: 34,
              notes: 'Puls 68 bpm (>64 bpm gräns). Ombesiktning om 10 minuter.'
            }
          }
        }
      ]
    },
    {
      startNumber: 4,
      driverName: 'Cecilia Ceder',
      clubName: 'Skånska Körsällskapet',
      className: 'Medelsvår Ponny Par',
      horseName: 'Castor & Pollux',
      hitch: 'par',
      trackWidth: 130,
      safetyCheck: { approved: true },
      horses: [
        {
          id: 'h4a',
          name: 'Castor',
          type: 'Ponny',
          inspections: {
            initial: { status: 'besiktigad' },
            harness: { status: 'besiktigad' },
            restArea: { status: 'besiktigad', pulse: 54 }
          }
        },
        {
          id: 'h4b',
          name: 'Pollux',
          type: 'Ponny',
          inspections: {
            initial: { status: 'besiktigad' },
            harness: { status: 'besiktigad' },
            restArea: { status: 'besiktigad', pulse: 58 }
          }
        }
      ]
    },
    {
      startNumber: 5,
      driverName: 'David Dahl',
      clubName: 'Mälardalens Körsällskap',
      className: 'Lätt Häst Enbet',
      horseName: 'Dunder',
      trackWidth: 140,
      safetyCheck: { approved: true },
      horses: [
        {
          id: 'h5',
          name: 'Dunder',
          type: 'Häst',
          inspections: {
            initial: { status: 'besiktigad' },
            harness: { status: 'besiktigad' },
            restArea: { status: 'besiktigad', pulse: 52 },
            final: { status: 'besiktigad' }
          }
        }
      ]
    },
    {
      startNumber: 6,
      driverName: 'Elsa Ek',
      clubName: 'Göteborgs Körklubb',
      className: 'Para Körning Grade I',
      horseName: 'Eagle',
      isPara: true,
      paraGrade: 'Grade I',
      trackWidth: 140,
      safetyCheck: { approved: true },
      horses: [
        {
          id: 'h6',
          name: 'Eagle',
          type: 'Häst',
          inspections: {
            initial: { status: 'besiktigad' },
            harness: { status: 'besiktigad' },
            restArea: { status: 'besiktigad', pulse: 55 },
            final: { status: 'besiktigad' }
          }
        }
      ]
    },
    {
      startNumber: 7,
      driverName: 'Filip Frost',
      clubName: 'Skånska Körsällskapet',
      className: 'Svår Häst Enbet',
      horseName: 'Firefox',
      trackWidth: 142,
      safetyCheck: { approved: true },
      horses: [
        {
          id: 'h7',
          name: 'Firefox',
          type: 'Häst',
          inspections: {
            initial: { status: 'besiktigad' },
            harness: { status: 'besiktigad' },
            restArea: { status: 'besiktigad', pulse: 58 },
            final: { status: 'besiktigad' }
          }
        }
      ]
    },
    {
      startNumber: 8,
      driverName: 'Greta Gran',
      clubName: 'Mälardalens Körsällskap',
      className: 'Medelsvår Ponny Enbet',
      horseName: 'Gullviva',
      trackWidth: 138,
      safetyCheck: { approved: true },
      horses: [
        {
          id: 'h8',
          name: 'Gullviva',
          type: 'Ponny',
          inspections: {
            initial: { status: 'besiktigad' },
            harness: { status: 'besiktigad' },
            restArea: { status: 'besiktigad', pulse: 50 },
            final: { status: 'besiktigad' }
          }
        }
      ]
    }
  ];

  const dressageScores = [
    { startNumber: 1, finalPenalty: 46.20, finalPercent: 71.13, finalPoints: 113.8 },
    { startNumber: 2, finalPenalty: 54.80, finalPercent: 65.75, finalPoints: 105.2 },
    { startNumber: 3, finalPenalty: 50.10, finalPercent: 68.69, finalPoints: 109.9 },
    { startNumber: 4, finalPenalty: 52.40, finalPercent: 67.25, finalPoints: 107.6 },
    { startNumber: 5, finalPenalty: 58.00, finalPercent: 63.75, finalPoints: 102.0 },
    { startNumber: 6, finalPenalty: 49.50, finalPercent: 69.06, finalPoints: 110.5 },
    { startNumber: 7, finalPenalty: 51.30, finalPercent: 67.94, finalPoints: 108.7 },
    { startNumber: 8, finalPenalty: 48.90, finalPercent: 69.44, finalPoints: 111.1 }
  ];

  const marathonRecords = [
    {
      startNumber: 1,
      running: false,
      finalized: true,
      status: 'Slutförd',
      times: {
        A: { start: '10:00:00', finish: '10:39:40', timeSec: 2380, penalty: 0 },
        T: { start: '10:39:40', finish: '10:51:40', timeSec: 720, penalty: 0 },
        B: { start: '11:01:40', finish: '12:10:50', timeSec: 4150, penalty: 0 }
      },
      obstacles: [
        { number: 1, timeSec: 42.5, penalty: 10.63 },
        { number: 2, timeSec: 46.0, penalty: 11.50 },
        { number: 3, timeSec: 54.2, holdTimeSec: 8.5, penalty: 13.55 }, // Demonstrerar hold deduction
        { number: 4, timeSec: 48.4, penalty: 12.10 },
        { number: 5, timeSec: 43.1, penalty: 10.78 },
        { number: 6, timeSec: 38.9, penalty: 9.73 }
      ],
      totalPenalty: 68.29
    },
    {
      startNumber: 2,
      running: false,
      finalized: true,
      status: 'Slutförd',
      times: {
        A: { start: '10:20:00', finish: '11:00:20', timeSec: 2420, penalty: 0 },
        T: { start: '11:00:20', finish: '11:12:20', timeSec: 720, penalty: 0 },
        B: { start: '11:22:20', finish: '12:32:30', timeSec: 4210, penalty: 0 }
      },
      obstacles: [
        { number: 1, timeSec: 48.2, penalty: 12.05 },
        { number: 2, timeSec: 52.4, penalty: 13.10 },
        { number: 3, timeSec: 49.0, penalty: 12.25 },
        { number: 4, timeSec: 55.1, penalty: 13.78 },
        { number: 5, timeSec: 47.8, penalty: 11.95 },
        { number: 6, timeSec: 44.5, penalty: 11.13 }
      ],
      totalPenalty: 74.26
    },
    {
      startNumber: 3,
      running: true,
      finalized: false,
      status: 'Pågår',
      times: {
        A: { start: '11:00:00', finish: '11:39:50', timeSec: 2390, penalty: 0 },
        T: { start: '11:39:50', finish: '11:51:50', timeSec: 720, penalty: 0 }
      },
      obstacles: [],
      totalPenalty: 0
    },
    {
      startNumber: 5,
      running: false,
      finalized: true,
      status: 'Slutförd',
      times: {
        A: { start: '11:30:00', finish: '12:15:30', timeSec: 2730, penalty: 6.0 },
        T: { start: '12:15:30', finish: '12:27:30', timeSec: 720, penalty: 0 },
        B: { start: '12:37:30', finish: '13:48:00', timeSec: 4230, penalty: 0 }
      },
      obstacles: [
        { number: 1, timeSec: 45.0, penalty: 11.25 },
        { number: 2, timeSec: 48.2, penalty: 12.05 },
        { number: 3, timeSec: 51.0, penalty: 12.75 },
        { number: 4, timeSec: 47.5, penalty: 11.88 },
        { number: 5, timeSec: 46.1, penalty: 11.53 },
        { number: 6, timeSec: 42.0, penalty: 10.50 }
      ],
      totalPenalty: 75.96
    },
    {
      startNumber: 7,
      running: false,
      finalized: true,
      status: 'Slutförd',
      times: {
        A: { start: '12:00:00', finish: '12:39:30', timeSec: 2370, penalty: 0 },
        T: { start: '12:39:30', finish: '12:51:30', timeSec: 720, penalty: 0 },
        B: { start: '13:01:30', finish: '14:10:40', timeSec: 4150, penalty: 0 }
      },
      obstacles: [
        { number: 1, timeSec: 41.2, penalty: 10.30 },
        { number: 2, timeSec: 44.8, penalty: 11.20 },
        { number: 3, timeSec: 43.5, penalty: 10.88 },
        { number: 4, timeSec: 46.0, penalty: 11.50 },
        { number: 5, timeSec: 42.2, penalty: 10.55 },
        { number: 6, timeSec: 39.1, penalty: 9.78 }
      ],
      totalPenalty: 64.21
    },
    {
      startNumber: 8,
      running: false,
      finalized: true,
      status: 'Slutförd',
      times: {
        A: { start: '12:30:00', finish: '13:09:45', timeSec: 2385, penalty: 0 },
        T: { start: '13:09:45', finish: '13:21:45', timeSec: 720, penalty: 0 },
        B: { start: '13:31:45', finish: '14:41:00', timeSec: 4155, penalty: 0 }
      },
      obstacles: [
        { number: 1, timeSec: 43.0, penalty: 10.75 },
        { number: 2, timeSec: 45.5, penalty: 11.38 },
        { number: 3, timeSec: 44.0, penalty: 11.00 },
        { number: 4, timeSec: 47.1, penalty: 11.78 },
        { number: 5, timeSec: 43.5, penalty: 10.88 },
        { number: 6, timeSec: 40.2, penalty: 10.05 }
      ],
      totalPenalty: 65.84
    }
  ];

  const precisionResults = [
    { startNumber: 1, timeSec: 138.2, timePenalty: 0.0, knocks: [], obstaclePenalty: 0, totalPenalty: 0.0, finalized: true },
    { startNumber: 2, timeSec: 168.0, timePenalty: 2.5, knocks: ['4', '12'], obstaclePenalty: 6, totalPenalty: 8.5, finalized: true },
    { startNumber: 5, timeSec: 142.5, timePenalty: 0.0, knocks: ['8'], obstaclePenalty: 3, totalPenalty: 3.0, finalized: true },
    { startNumber: 7, timeSec: 136.4, timePenalty: 0.0, knocks: ['2'], obstaclePenalty: 3, totalPenalty: 3.0, finalized: true },
    { startNumber: 8, timeSec: 139.1, timePenalty: 0.0, knocks: [], obstaclePenalty: 0, totalPenalty: 0.0, finalized: true }
  ];

  const teams = [
    {
      id: 'team-skane-1',
      name: 'Skånska Körsällskapet Lag 1',
      members: ['1', '4', '7'] // Ekipage 1, 4, 7
    },
    {
      id: 'team-malardalen-1',
      name: 'Mälardalens Körsällskap',
      members: ['2', '5', '8'] // Ekipage 2, 5, 8
    }
  ];

  return {
    compMeta,
    configs,
    officials,
    judges,
    obstacles,
    equipages,
    dressageScores,
    marathonRecords,
    precisionResults,
    teams
  };
}
