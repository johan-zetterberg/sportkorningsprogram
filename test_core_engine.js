import { buildCompetitionState } from './js/core-engine/stateSelector.js';
import { calculateTotalResult } from './js/core-engine/calculation.js';
import assert from 'assert';

console.log("=========================================");
console.log("🏁 RUNNING CORE ENGINE INTEGRATION TEST 🏁");
console.log("=========================================\n");

// --- MOCK DATA ---

const mockEquipage = {
    id: "eq1",
    className: "Msv",
    testKey: "SvMsvB",
    category: "horse", // Standardhäst
    errorPoints: 5, // 5 straff för felkörning (Dressyr)
};

// 1. Dressyr
const mockAllPrograms = {
    "SvMsvB": {
        name: "Msv 3 (B) (2020) (nr 525)",
        category: "Svenska Program",
        penaltyCoeff: 0.80, // 0.8 coefficient explicitly defined
        movements: [
            { no: 1, coeff: 1 },
            { no: 2, coeff: 2 }, // Total max points = 30
        ]
    }
};

const mockDressageProtocols = [
    {
        id: "judge1",
        programKey: "SvMsvB",
        movements: [
            { no: 1, score: 7 }, // 7 * 1 = 7
            { no: 2, score: 6 }  // 6 * 2 = 12 -> Total 19
        ]
    },
    {
        id: "judge2",
        programKey: "SvMsvB",
        movements: [
            { no: 1, score: 8 }, // 8 * 1 = 8
            { no: 2, score: 7 }  // 7 * 2 = 14 -> Total 22
        ]
    }
];

// Average score = (19 + 22) / 2 = 20.5
// Max score = 30
// Dressyr Straff = (30 - 20.5) * 0.8 = 7.6
// Felkörning = 5 * 0.8 = 4.0
// Total Dressyr Straff = 7.6 + 4.0 = 11.6

// 2. Maraton
const mockMarathonConfig = {
    marathonClassData: {
        "Msv": {
            distanceA: 3000,
            tempoA: 250, // m/min (15 km/h) -> 3000 / 250 = 12 min = 720 sec ideal.
            distanceB: 5000,
            tempoB: 233.33333333333334, // m/min (14 km/h) -> 5000 / 233.333 = 21.428 min = 1286 sec ideal.
            windowA: 2, // +/- 2 min
            windowB: 3, // +/- 3 min
            obstaclePenaltyRate: 0.25
        }
    },
    timePenaltyRate: 0.25
};

const mockMarathonTiming = {
    duration_A_ms: 780000, // 780s. Ideal 720s. Max 720s. Diff 60s. Penalty = 60 * 0.25 = 15.
    duration_B_ms: 1200000 // 1200s. Ideal 1286s. Min 1286 - 180 = 1106s. Diff = 0.
};

const mockMarathonDoc = {
    obstacles: [
        { timeSeconds: 40, knockdownPenalty: 3 }, // 40 * 0.25 + 3 = 13
        { timeSeconds: 60, knockdownPenalty: 0 }, // 60 * 0.25 = 15
    ],
    otherPenalty: 2 // Extrastraff
};

// Marathon Stages Penalty = 15.
// Marathon Obstacles Penalty = 13 + 15 = 28.
// Total Marathon Penalty (Core Engine) = 15 + 28 = 43.

// 3. Precision
const mockPrecisionConfig = {
    maxTimeByClass: {
        "Msv": 180 // Max time 180 seconds
    },
    timePenaltyRate: 0.5
};

const mockPrecisionDoc = {
    finalized: true,
    timeMs: 185000, // 185 seconds. 5 seconds over.
    obstaclePenalty: 9, // 3 knockdowns
    extraPenalty: 2
};

// Precision Time Penalty = 5 * 0.5 = 2.5.
// Total Precision Penalty = 2.5 + 9 + 2 = 13.5.

// 4. Totalt
// Dressyr: 11.6
// Maraton: 43
// Precision: 13.5
// Total = 11.6 + 43 + 13.5 = 68.1

const competitionContext = {
    allPrograms: mockAllPrograms,
    marathonConfig: mockMarathonConfig,
    precisionConfig: mockPrecisionConfig
};

// --- EXECUTE ---

console.log("🛠️ Building Competition State...");
const state = buildCompetitionState(
    mockEquipage,
    mockDressageProtocols,
    mockMarathonDoc,
    mockMarathonTiming,
    mockPrecisionDoc,
    competitionContext
);

console.log("🧮 Calculating Total Result...");
const result = calculateTotalResult(state);

// --- ASSERTIONS ---

try {
    console.log("\n📊 RESULT SUMMARY:");
    console.log(`Dressage Penalty:  ${result.dressagePenalty.toFixed(2)}  (Expected: 11.60)`);
    console.log(`Marathon Penalty:  ${result.marathonPenalty.toFixed(2)}  (Expected: 43.00)`);
    console.log(`Precision Penalty: ${result.precisionPenalty.toFixed(2)}  (Expected: 13.50)`);
    console.log(`-----------------------------------`);
    console.log(`Total Penalty:     ${result.totalPenalty.toFixed(2)}  (Expected: 68.10)`);
    console.log(`Eliminated:        ${result.isEliminated}`);

    assert.strictEqual(Math.round(result.dressagePenalty * 100) / 100, 11.6, "Dressage penalty mismatch");
    assert.strictEqual(Math.round(result.marathonPenalty * 100) / 100, 43.0, "Marathon penalty mismatch");
    assert.strictEqual(Math.round(result.precisionPenalty * 100) / 100, 13.5, "Precision penalty mismatch");
    assert.strictEqual(Math.round(result.totalPenalty * 100) / 100, 68.1, "Total penalty mismatch");
    assert.strictEqual(result.isEliminated, false, "Should not be eliminated");

    console.log("\n✅ ALL ASSERTIONS PASSED! The Core Engine is mathematically perfect.");
} catch (error) {
    console.error("\n❌ VALIDATION FAILED!");
    console.error(error.message);
    process.exit(1);
}
