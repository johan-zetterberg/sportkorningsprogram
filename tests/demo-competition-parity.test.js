// Runs the full demo competition (js/services/demoCompetitionData.js) through
// every calculation path and every list that ranks equipages, and checks that
// they agree. The demo data uses the same shapes as the real input pages.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDemoCompetitionDataset } from '../js/services/demoCompetitionData.js';
import { dressagePrograms } from '../js/data/dressagePrograms.js';
import { calculateTotalResult } from '../js/services/calculationService.js';
import { setMarathonConfig, setPauseWindows, calculateMarathonPlacements } from '../js/utils/marathonUtils.js';
import { buildPlaceMap } from '../js/utils/precisionUtils.js';
import { buildServerCompetitionState } from '../functions/src/resultRecalculationUtils.js';
import { calculateTotalResult as serverTotal } from '../functions/src/core-engine/calculation.js';
import { buildTotalResultRow } from '../js/pages/shared/totalResultRows.js';
import { placeTotalRowsWithinClass } from '../js/pages/shared/totalResultRanking.js';
import { buildMarathonPlacementsByClass } from '../js/pages/marathon/marathonResultRanking.js';
import { rankDressageRows } from '../js/pages/dressage/dressageResultRanking.js';
import { buildArchiveRowsFromData } from '../js/services/archiveRowBuilder.js';
import { calculateMarathonResult } from '../js/utils/marathonUtils.js';
import { activateCompetitionSettings, setCompetitionSetting } from '../js/services/competitionSettingsStore.js';

const NOW = 1778930000000;

function setup() {
  const data = buildDemoCompetitionDataset({ now: NOW });
  globalThis.window = {
    getGlobalState: (key) => (key === 'currentCompetition' ? data.compMeta : null)
  };
  // As the pages store them for the active competition (competitionSettingsStore)
  activateCompetitionSettings('demo-competition');
  setCompetitionSetting('demo-competition', 'klassProgramMapping', data.configs.dressyrProgramMapping);
  setCompetitionSetting('demo-competition', 'dressageJudgeMapping', data.configs.dressageJudgeMapping);
  setMarathonConfig(data.configs.maratonConfig);
  setPauseWindows([]);

  const inputs = (eq) => {
    const sn = eq.startNumber;
    return {
      protocols: data.judgeProtocols.filter(p => p.startNumber === sn),
      marathon: data.marathonRecords.find(m => m.startNumber === sn) || {},
      precision: data.precisionResults.find(p => p.startNumber === sn) || {}
    };
  };

  // Same context as functions/index.js getContext()
  const serverContext = {
    allPrograms: dressagePrograms,
    dressageProgramMapping: data.configs.dressyrProgramMapping,
    dressageJudgeMapping: data.configs.dressageJudgeMapping,
    judges: [],
    marathonConfig: data.configs.maratonConfig,
    precisionConfig: data.configs.precisionConfig,
    ruleSettings: data.compMeta.ruleSettings,
    pauseWindows: []
  };

  const browser = (eq) => {
    const { protocols, marathon, precision } = inputs(eq);
    return calculateTotalResult(eq, protocols, { obstacleData: marathon, timeData: marathon }, precision, {
      allPrograms: dressagePrograms,
      judges: data.judges,
      precisionConfig: data.configs.precisionConfig
    });
  };
  // As functions/index.js reads Firestore: stage times are on the maraton doc,
  // the separate maraton-timing doc is empty for the demo
  const server = (eq, extra = {}) => {
    const { protocols, marathon, precision } = inputs(eq);
    return serverTotal(buildServerCompetitionState({
      equipage: eq,
      dressageProtocols: protocols,
      marathonDoc: marathon,
      timingDoc: {},
      precisionDoc: precision
    }, { ...serverContext, ...extra }));
  };

  return { data, inputs, browser, server };
}

function withFixedClock(fn) {
  const realNow = Date.now;
  Date.now = () => NOW;
  try {
    return fn();
  } finally {
    Date.now = realNow;
    delete globalThis.window;
    activateCompetitionSettings(null);
  }
}

test('demo competition: browser and server calculate the same results for every equipage', () => withFixedClock(() => {
  const { data, browser, server } = setup();

  for (const eq of data.equipages) {
    const b = browser(eq);
    const s = server(eq);
    const sLive = server(eq, { nowMs: NOW });
    const label = `#${eq.startNumber}`;

    assert.equal(s.dressagePenalty, b.dressage.penalty, `${label} dressage`);
    assert.equal(sLive.marathonPenalty, b.marathon.totalPenalty, `${label} marathon (live)`);
    assert.equal(s.precisionPenalty, b.precision.totalPenalty, `${label} precision`);
    assert.equal(sLive.totalPenalty, b.totalPenalty, `${label} total (live)`);
    assert.equal(s.totalPenalty, b.totalPenalty, `${label} total`);
    assert.equal(s.isEliminated, b.isEliminated, `${label} eliminated`);
  }
}));

test('demo competition: totals match hand-checked values; unfinished equipages get no total', () => withFixedClock(() => {
  const { data, browser } = setup();
  const totals = Object.fromEntries(data.equipages.map(eq => [eq.startNumber, browser(eq)]));

  // dressage + marathon (obstacle seconds x 0.25 + stage time) + precision
  assert.equal(totals[1].totalPenalty, 111.95); // 43.67 (FEI 958: 160 − points × 0.666) + 273.10 s x 0.25 = 68.28 + 0
  assert.equal(totals[2].totalPenalty, 136.97); // 54.22 (FEI 958: 160 − points × 0.615) + 74.25 + 8.50 (6 knocks + 5 s over x 0.5)
  assert.equal(totals[5].totalPenalty, 143.45); // 57.00 + 69.95 + A 24 s over (6.00) + B 30 s over (7.50) + 3.00
  assert.equal(totals[7].totalPenalty, 116.2); // dressage by FEI 958 (160 − points × 0.666)
  assert.equal(totals[8].totalPenalty, 113.30);

  // #3 on section B, #4 in the vet box with precision running, #6 on section A
  for (const sn of [3, 4, 6]) {
    assert.equal(totals[sn].totalPenalty, null, `#${sn} has no total yet`);
    assert.equal(totals[sn].isOngoing, true, `#${sn} is ongoing`);
  }
  // A running stage is not "too fast" while it runs
  assert.equal(totals[3].marathon.stages.B.timePenalty, 0);
  assert.equal(totals[6].marathon.stages.A.timePenalty, 0);
}));

test('demo competition: every list places equipages the same way', () => withFixedClock(() => {
  const { data, inputs } = setup();
  const { equipages } = data;

  // Total results page
  const totalRows = equipages.map(eq => {
    const { protocols, marathon, precision } = inputs(eq);
    return buildTotalResultRow({
      equipage: eq,
      rawProtocols: protocols,
      marDoc: marathon,
      timeDocRaw: marathon,
      precisionDoc: precision,
      allPrograms: dressagePrograms,
      judges: data.judges,
      marathonConfig: data.configs.maratonConfig,
      precisionConfig: data.configs.precisionConfig,
      calculateTotalResult,
      resolveMergeGrouping: (e) => ({ key: `CLASS:${e.className}`, label: e.className })
    });
  });
  placeTotalRowsWithinClass(totalRows);
  const totalPlace = Object.fromEntries(totalRows.map(r => [r.startNumber, r.plac]));

  // Svår Häst Enbet: #1 111.79 ahead of #7 116.04; unfinished equipages get no place
  assert.equal(totalPlace[1], 1);
  assert.equal(totalPlace[7], 2);
  for (const sn of [3, 4, 6]) assert.equal(totalPlace[sn], null, `#${sn} not placed`);

  // Archive (stored archive and its PDF)
  const archiveRows = buildArchiveRowsFromData({
    equipages,
    dressageProtocols: new Map(equipages.map(eq => [String(eq.startNumber), inputs(eq).protocols])),
    marathonTimingMap: new Map(),
    marathonStateMap: new Map(data.marathonRecords.map(m => {
      const { obstacles, ...state } = m;
      return [String(m.startNumber), state];
    })),
    marathonObstacleRows: data.marathonRecords.flatMap(m => (m.obstacles || []).map(o => ({ ...o, equipageId: String(m.startNumber) }))),
    precisionRows: data.precisionResults,
    marathonConfig: data.configs.maratonConfig,
    precisionConfig: data.configs.precisionConfig,
    dressageJudgeMapping: data.configs.dressageJudgeMapping,
    allPrograms: dressagePrograms,
    judges: data.judges
  });
  for (const row of archiveRows) {
    const expected = totalPlace[row.startNumber] ?? '';
    assert.equal(row.plac, expected, `archive place #${row.startNumber}`);
  }

  // Marathon: results page vs PDF/reports
  const marathonMap = new Map(data.marathonRecords.map(m => [String(m.startNumber), m]));
  const pagePlaces = buildMarathonPlacementsByClass({
    equipages,
    marathonMap,
    timingDocFor: (sn) => marathonMap.get(String(sn)) || {},
    calculateResult: calculateMarathonResult
  });
  const pdfPlaces = calculateMarathonPlacements(equipages.map(eq => {
    const m = marathonMap.get(String(eq.startNumber)) || {};
    return { ...eq, results: { marathon: calculateMarathonResult(eq, m, m) } };
  }));
  assert.deepEqual([...pdfPlaces.entries()].sort(), [...pagePlaces.entries()].sort());
  assert.equal(pagePlaces.get('7'), 1); // 64.20 ahead of #1 68.28
  assert.equal(pagePlaces.get('1'), 2);
  assert.equal(pagePlaces.has('3'), false); // still driving

  // Precision placings from the engine (running #4 not placed)
  const precisionMap = new Map(data.precisionResults.map(p => [String(p.startNumber), p]));
  const precisionPlaces = buildPlaceMap(equipages, precisionMap, data.configs.precisionConfig);
  assert.equal(precisionPlaces.get('1'), 1); // 0 penalties
  assert.equal(precisionPlaces.get('7'), 2); // 3 penalties
  assert.equal(precisionPlaces.get('4'), null);

  // Dressage placings on the total page equal the dressage ranking
  const dressageRows = totalRows.map(r => ({ startNumber: r.startNumber, className: r.className, finalPenalty: r.dressage.penalty }));
  rankDressageRows(dressageRows, { groupPicker: r => r.className });
  assert.equal(dressageRows.find(r => r.startNumber === 1).plac, 1); // 43.51
  assert.equal(dressageRows.find(r => r.startNumber === 7).plac, 2); // 48.84
}));
