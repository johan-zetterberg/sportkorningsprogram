import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCompetitionState } from '../js/core-engine/stateSelector.js';
import { calculateDressageResult as calculateBrowserDressage } from '../js/core-engine/dressage.js';
import { calculateMarathonResult as calculateBrowserMarathon } from '../js/core-engine/marathon.js';
import { calculatePrecisionResult as calculateBrowserPrecision } from '../js/core-engine/precision.js';
import { calculateTotalResult as calculateBrowserTotal } from '../js/core-engine/calculation.js';
import { calculateDressageResult as calculateFunctionsDressage } from '../functions/src/core-engine/dressage.js';
import { calculateMarathonResult as calculateFunctionsMarathon } from '../functions/src/core-engine/marathon.js';
import { calculatePrecisionResult as calculateFunctionsPrecision } from '../functions/src/core-engine/precision.js';
import { calculateTotalResult as calculateFunctionsTotal } from '../functions/src/core-engine/calculation.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const synchronizedPaths = [
  ['js/core-engine', 'functions/src/core-engine'],
  ['js/data/dressagePrograms.js', 'functions/src/data/dressagePrograms.js'],
  ['js/data/competitionData.js', 'functions/src/data/competitionData.js'],
  ['js/utils/precisionCalculation.js', 'functions/src/utils/precisionCalculation.js']
];

function listFiles(relativePath) {
  const absolutePath = path.resolve(projectRoot, relativePath);
  const stat = fs.statSync(absolutePath);
  if (stat.isFile()) return [relativePath.replaceAll('\\', '/')];

  return fs.readdirSync(absolutePath, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(relativePath, entry.name);
    return entry.isDirectory() ? listFiles(child) : [child.replaceAll('\\', '/')];
  }).sort();
}

function createParityState() {
  return buildCompetitionState(
    {
      startNumber: 42,
      className: 'Testklass',
      category: 'horse',
      errorPoints: 2,
      testKey: 'TEST'
    },
    [
      { judgeId: 'c', movements: [{ momentNo: 1, score: 8 }, { momentNo: 2, score: 7 }] },
      { judgeId: 'e', movements: [{ momentNo: 1, score: 6 }, { momentNo: 2, score: 7 }] }
    ],
    {
      obstacles: [{ obstacleNumber: 1, timeSeconds: 20, otherPenalty: 1, knockdownPenalty: 0 }]
    },
    {
      A: { durationMs: 1200000 },
      B: { durationMs: 1200000 }
    },
    {
      finalized: true,
      timeMs: 105000,
      knocks: [3, 7]
    },
    {
      allPrograms: {
        TEST: {
          id: 'TEST',
          penaltyCoeff: 0.8,
          movements: [{ no: 1, coeff: 1 }, { no: 2, coeff: 1 }]
        }
      },
      marathonConfig: {
        marathonClassData: {
          Testklass: {
            distanceA: 5000,
            tempoA: 250,
            distanceB: 6000,
            tempoB: 300,
            obstaclePenaltyRate: 0.25
          }
        }
      },
      precisionConfig: {
        maxTimeByClass: { Testklass: 100 },
        knockdownPenalty: 3,
        timePenaltyRate: 0.5
      }
    }
  );
}

test('Functions result-engine files are synchronized with the browser source', () => {
  for (const [sourceRelative, targetRelative] of synchronizedPaths) {
    const sourceFiles = listFiles(sourceRelative);
    const targetFiles = listFiles(targetRelative);
    const sourceRoot = path.resolve(projectRoot, sourceRelative);
    const targetRoot = path.resolve(projectRoot, targetRelative);
    const sourceIsFile = fs.statSync(sourceRoot).isFile();

    if (!sourceIsFile) {
      assert.deepEqual(
        targetFiles.map((file) => path.relative(targetRoot, path.resolve(projectRoot, file)).replaceAll('\\', '/')),
        sourceFiles.map((file) => path.relative(sourceRoot, path.resolve(projectRoot, file)).replaceAll('\\', '/'))
      );
    }

    for (const sourceFile of sourceFiles) {
      const sourceAbsolute = path.resolve(projectRoot, sourceFile);
      const targetAbsolute = sourceIsFile
        ? targetRoot
        : path.resolve(targetRoot, path.relative(sourceRoot, sourceAbsolute));
      assert.equal(fs.readFileSync(targetAbsolute, 'utf8'), fs.readFileSync(sourceAbsolute, 'utf8'));
    }
  }
});

test('Functions and browser engines calculate identical discipline and total results', () => {
  const state = createParityState();

  assert.deepEqual(calculateFunctionsDressage(state), calculateBrowserDressage(state));
  assert.deepEqual(calculateFunctionsMarathon(state), calculateBrowserMarathon(state));
  assert.deepEqual(calculateFunctionsPrecision(state), calculateBrowserPrecision(state));
  assert.deepEqual(calculateFunctionsTotal(state), calculateBrowserTotal(state));
});
