
import { calculateTotalResult } from './src/logic/calculation.js';
import { dressagePrograms } from './src/data/dressagePrograms.js';

// Mock Configuration
const context = {
    allPrograms: dressagePrograms,
    judges: [],
    marathonConfig: {
        timePenaltyRate: 0.25,
        obstaclePenaltyRate: 0.25,
        marathonClassData: {
            'Lätt B': {
                distanceT: 2800, tempoT: 220, // 12.72 min -> 763.6 sec
                windowA: 2, windowB: 3
            }
        }
    },
    precisionConfig: {
        timePenaltyRate: 0.5,
        knockdownPenalty: 3,
        courses: {
            'Lätt B': { trackLength: 500, tempo: 200 } // 2.5 min -> 150 sec
        }
    }
};

// Mock Data
const equipage = {
    startNo: 1,
    name: "Test Driver",
    className: "Lätt B",
    category: "Pony A",
    testKey: "LB_1" // Assuming standard program
};

// 1. Dressage Data (User gets 120 points out of 160 max => 75%)
// Penalty = (160 - 120) * 1.0 = 40.0
// We adjust mock to yield exactly 50.0 penalty.
const dressageProtocols = [
    {
        judgeId: "J1",
        movements: [
            { no: 1, score: 6, coeff: 1 },
            { no: 2, score: 7, coeff: 1 },
        ]
    }
];
// Hack: inject a fake program into context for simpler verification
context.allPrograms['TEST_PROG'] = {
    maxScore: 160,
    penaltyCoeff: 1.0,
    movements: [
        { no: 1, coeff: 10 },
        { no: 2, coeff: 6 }
    ]
};
// 10*10 = 100, 6*10 = 60 => 160 max.
equipage.testKey = 'TEST_PROG';
dressageProtocols[0].movements = [
    { no: 1, score: 8 }, // 80pts
    { no: 2, score: 5 } // 30pts
    // Total = 110. Max = 160. Diff = 50. Penalty = 50.
];


// 2. Marathon Data
// Transport: Client code explicitly returns 0 penalty for transport.
// Penalty = 0.
const timingDoc = {
    transport: { durationMs: 840 * 1000 } // 14 min
};
const marathonDoc = {
    obstacles: [
        { id: 1, timeSeconds: 60, penalty: 0 } // 60s * 0.25 = 15.0
    ]
};
// Total Marathon = 0.0 (stages) + 15.0 (obs) = 15.0

// 3. Precision Data
// Time: 160s. Max 150s. Diff 10s.
// TimePen = 10 * 0.5 = 5.0
// Obs: 1 ball down = 3.0
// Total Precision = 8.0
const precisionDoc = {
    finalized: true,
    timeMs: 160 * 1000,
    knocks: [{ id: 1 }]
};

console.log("--- RUNNING VERIFICATION ---");
console.log("Expected Dressage: 50.0");
console.log("Expected Marathon: 15.0");
console.log("Expected Precision: 8.0");
console.log("Expected Total: 73.0");
console.log("----------------------------");

const result = calculateTotalResult(equipage, dressageProtocols, marathonDoc, timingDoc, precisionDoc, context);

console.log("Calculated Result:", JSON.stringify(result, null, 2));

if (result.totalPenalty === 73.0) {
    console.log("\n✅ SUCCESS: Calculation matches expectations.");
} else {
    console.log("\n❌ FAILED: Values do not match.");
}
