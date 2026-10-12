import { db, appId } from '../config/firebase-config.js';
import { addDoc, collection, doc, getDoc, getDocs, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getGlobalState } from '../main.js';
import { getEquipages } from './equipageService.js';
import { getPrecisionResultForEquipage, getPrecisionResults, savePrecisionResult } from './precisionService.js';
import {
  getMarathonLiveDocument,
  getMarathonObstacleResults,
  getMarathonStateDocuments,
  getMarathonTimingData,
  saveMarathonObstacleResult
} from './marathonService.js';
import {
  getAllDressageProtocols,
  getDressageResultsForEquipage,
  getDressageStatusCollection,
  saveDressageGeneralData,
  saveDressageJudgeProtocol
} from './dressageService.js';
import { getCompDocRef } from './firestoreService.js';
import { findEditConflicts, isStillRunning, pickEditedFields } from './secretariatPatchUtils.js';
import { getConfig } from './competitionService.js';
import { calculatePrecisionResult } from '../utils/precisionCalculation.js';
import { calculateObstacleResult } from '../core-engine/marathon.js';
import {
  finalizePrecision,
  unfinalizePrecision,
  finalizeMarathon,
  unfinalizeMarathon,
  finalizeDressage,
  unfinalizeDressage
} from './finalizationService.js';
import { deriveDressageStatus, deriveMarathonStatus, derivePrecisionStatus, sortRows } from '../pages/secretariat/secretariat-shared.js';

function currentUserId() {
  return getGlobalState('currentUser')?.uid || null;
}

function getAuditCollectionRef(competitionId) {
  return collection(db, `artifacts/${appId}/private/data/competitions/${competitionId}/auditLog`);
}

function numberOrDefault(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function buildPrecisionDiff(before = {}, after = {}) {
  const fields = ['timeMs', 'obstaclePenalty', 'timePenalty', 'extraPenalty', 'totalPenalty', 'eliminated', 'comment', 'finalized'];
  const diff = [];

  fields.forEach(field => {
    const oldValue = before[field] ?? null;
    const newValue = after[field] ?? null;
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      diff.push({ field, oldValue, newValue });
    }
  });

  return diff;
}

function buildFieldDiff(before = {}, after = {}, fields = []) {
  const diff = [];
  fields.forEach(field => {
    const oldValue = before[field] ?? null;
    const newValue = after[field] ?? null;
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      diff.push({ field, oldValue, newValue });
    }
  });
  return diff;
}

async function getDressageFinalizationMap(competitionId) {
  const out = new Map();
  if (!competitionId) return out;
  const colRef = collection(db, `competitions/${competitionId}/dressageFinalization`);
  const snap = await getDocs(colRef);
  snap.forEach(docSnap => out.set(String(docSnap.id), docSnap.data() || {}));
  return out;
}

export async function writeSecretariatAuditLog(competitionId, entry = {}) {
  if (!competitionId) return null;

  return addDoc(getAuditCollectionRef(competitionId), {
    source: 'secretariat',
    editedBy: currentUserId(),
    editedAt: serverTimestamp(),
    ...entry,
  });
}

async function getPrecisionCalcConfig(competitionId) {
  try {
    return (await getConfig(competitionId, 'precisionConfig')) || {};
  } catch {
    return {};
  }
}

/**
 * Engine view of a secretariat row being edited: the penalties the result
 * will get when saved. `row.calcContext` comes from loadSecretariatPrecisionRows.
 */
export function calculateSecretariatPrecisionDraft(row, patch = {}) {
  const ctx = row?.calcContext || {};
  const timeMs = numberOrDefault(patch.timeMs, row?.timeMs ?? 0);
  return calculatePrecisionResult(
    {
      ...(row?.resultDoc || {}),
      ...patch,
      timeMs,
      liveTimeMs: timeMs,
      finalized: false,
      running: false
    },
    ctx.equipage || { startNumber: row?.startNumber, className: row?.className },
    ctx.config || {},
    { currentCompetition: getGlobalState('currentCompetition') }
  );
}

export async function loadSecretariatPrecisionRows(competitionId) {
  if (!competitionId) return [];

  const [equipages, results, precisionConfig] = await Promise.all([
    getEquipages(competitionId),
    getPrecisionResults(competitionId),
    getPrecisionCalcConfig(competitionId),
  ]);

  const resultMap = new Map(results.map(result => [String(result.startNumber || result.id), result]));
  const rows = equipages.map(eq => {
    const sn = String(eq.startNumber);
    const result = resultMap.get(sn) || {};
    const row = {
      startNumber: eq.startNumber,
      driverName: eq.driverName || '',
      className: eq.className || '',
      running: !!result.running,
      finalized: !!result.finalized,
      timeMs: numberOrDefault(result.timeMs, 0),
      obstaclePenalty: numberOrDefault(result.obstaclePenalty, 0),
      timePenalty: numberOrDefault(result.timePenalty, 0),
      timePenaltyOverride: result.timePenaltyOverride === true,
      extraPenalty: numberOrDefault(result.extraPenalty, 0),
      totalPenalty: result.totalPenalty == null ? null : numberOrDefault(result.totalPenalty, 0),
      eliminated: !!result.eliminated,
      comment: result.comment || '',
      resultDoc: result,
      calcContext: { equipage: eq, config: precisionConfig },
    };

    row.status = derivePrecisionStatus(row);
    if (row.status !== 'not-started') {
      // Show the penalties the engine gives this result
      const calc = calculateSecretariatPrecisionDraft(row);
      row.timePenalty = calc.timePenalty ?? 0;
      row.totalPenalty = calc.totalPenalty ?? 0;
    }

    return row;
  });

  return sortRows(rows, 'startNumber');
}

export async function loadSecretariatMarathonRows(competitionId) {
  if (!competitionId) return [];

  const [equipages, timingMap, stateMap] = await Promise.all([
    getEquipages(competitionId),
    getMarathonTimingData(competitionId),
    getMarathonStateDocuments(competitionId),
  ]);

  const rows = equipages.map(eq => {
    const sn = String(eq.startNumber);
    const timing = timingMap.get(sn) || {};
    const state = stateMap.get(sn) || {};
    const obstacles = Array.isArray(state.obstacles) ? state.obstacles : [];

    const holdTimeSec = obstacles.reduce((sum, o) => {
      const s = Number(o?.holdTimeSec);
      return Number.isFinite(s) && s > 0 ? sum + s : sum;
    }, 0);

    const row = {
      startNumber: eq.startNumber,
      driverName: eq.driverName || '',
      className: eq.className || '',
      finalized: !!state.finalized,
      running: !!state.running,
      start_A: state.start_A ?? timing.start_A ?? null,
      finish_A: state.finish_A ?? timing.finish_A ?? null,
      start_B: state.start_B ?? timing.start_B ?? null,
      finish_B: state.finish_B ?? timing.finish_B ?? null,
      duration_A: numberOrDefault(state.duration_A_ms ?? timing.duration_A, 0),
      duration_B: numberOrDefault(state.duration_B_ms ?? timing.duration_B, 0),
      holdTimeSec,
      obstacleCount: obstacles.length,
      stateDoc: state,
      timingDoc: timing,
      hasTimingData: Object.keys(timing).length > 0 || Number(state.duration_A_ms || 0) > 0 || Number(state.duration_B_ms || 0) > 0,
    };

    row.status = deriveMarathonStatus(row);
    return row;
  });

  return sortRows(rows, 'startNumber');
}

export async function loadSecretariatDressageRows(competitionId) {
  if (!competitionId) return [];

  const equipages = await getEquipages(competitionId);
  const [statusDocs, allProtocolsMap, finalizationMap] = await Promise.all([
    getDressageStatusCollection(competitionId),
    getAllDressageProtocols(competitionId, equipages),
    getDressageFinalizationMap(competitionId),
  ]);

  const statusMap = new Map(statusDocs.map(docRow => [String(docRow.id || docRow.startNumber), docRow]));
  const rows = equipages.map(eq => {
    const sn = String(eq.startNumber);
    const status = statusMap.get(sn) || {};
    const protocols = allProtocolsMap.get(sn) || [];
    const finalization = finalizationMap.get(sn) || {};

    const row = {
      startNumber: eq.startNumber,
      driverName: eq.driverName || '',
      className: eq.className || '',
      clubName: eq.clubName || '',
      country: eq.country || eq.nation || eq.nationality || '',
      horses: Array.isArray(eq.horses) ? eq.horses : [],
      horseNames: eq.horseNames || eq.horseName || eq.horse || '',
      momentHorses: eq.momentHorses || {},
      finalized: !!finalization.finalized,
      state: status.state || 'not-started',
      protocolCount: protocols.length,
      judgeNames: protocols.map(protocol => protocol.judgeName).filter(Boolean),
      errorPoints: Number(status.errorPoints || 0),
      finalPenalty: Number.isFinite(Number(status.finalPenalty)) ? Number(status.finalPenalty) : null,
      statusDoc: status,
    };
    row.status = deriveDressageStatus(row);
    return row;
  });

  return sortRows(rows, 'startNumber');
}

export async function loadSecretariatDressageDetail(competitionId, startNumber) {
  if (!competitionId || startNumber == null) return { finalized: false, protocols: [], general: {}, status: null };

  const [protocolDocs, statusDoc, finalizationDoc] = await Promise.all([
    getDressageResultsForEquipage(competitionId, startNumber),
    getDoc(doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/dressageStatus/${String(startNumber)}`)),
    getDoc(doc(db, `competitions/${competitionId}/dressageFinalization/${String(startNumber)}`)),
  ]);

  let general = {};
  const protocols = [];
  protocolDocs.forEach(protocol => {
    if (protocol.id === 'general') {
      general = {
        errorPoints: Number(protocol.errorPoints || 0),
        errorComment: protocol.errorComment || '',
      };
      return;
    }

    protocols.push({
      id: protocol.id,
      judgeId: protocol.judgeId || String(protocol.id || '').replace(/^judge_/, ''),
      judgeName: protocol.judgeName || '',
      judgePosition: protocol.judgePosition || protocol.position || '',
      programKey: protocol.programKey || protocol.testKey || '',
      eliminated: !!protocol.eliminated,
      movements: Array.isArray(protocol.movements) ? protocol.movements.map(movement => ({
        momentNo: movement.momentNo ?? movement.movementNo ?? null,
        score: Number.isFinite(Number(movement.score)) ? Number(movement.score) : 0,
        comment: movement.comment || '',
      })) : [],
    });
  });

  return {
    finalized: !!finalizationDoc.data()?.finalized,
    protocols: protocols.sort((a, b) => String(a.judgePosition || '').localeCompare(String(b.judgePosition || ''), 'sv')),
    general,
    status: statusDoc.exists() ? statusDoc.data() : null,
  };
}

async function getMarathonCalcConfig(competitionId) {
  try {
    return (await getConfig(competitionId, 'maratonConfig')) || {};
  } catch {
    return {};
  }
}

/**
 * Engine view of one obstacle (time penalty and obstacle total). Obstacle
 * time penalty always follows the time (TR 526), it is not entered by hand.
 */
export function calculateSecretariatObstacle(calcContext, obstacle) {
  const ctx = calcContext || {};
  return calculateObstacleResult(
    { ...obstacle, timeSec: numberOrDefault(obstacle?.timeInSeconds ?? obstacle?.timeSeconds, 0) },
    ctx.equipage || {},
    ctx.marathonConfig || {},
    getGlobalState('currentCompetition')?.ruleSettings || null
  );
}

export async function loadSecretariatMarathonObstacleDetail(competitionId, startNumber, equipage = null) {
  if (!competitionId || startNumber == null) return { finalized: false, obstacles: [], summary: null };

  const [summary, savedObstacles, marathonConfig] = await Promise.all([
    getMarathonLiveDocument(competitionId, startNumber),
    getMarathonObstacleResults(competitionId, startNumber),
    getMarathonCalcConfig(competitionId),
  ]);
  const calcContext = { equipage: equipage || { startNumber }, marathonConfig };

  const byNumber = new Map();
  savedObstacles.forEach(obstacle => {
    const key = Number(obstacle.obstacleNumber ?? obstacle.number);
    if (Number.isFinite(key)) byNumber.set(key, { ...obstacle });
  });

  const summaryObstacles = Array.isArray(summary?.obstacles) ? summary.obstacles : [];
  summaryObstacles.forEach(obstacle => {
    const key = Number(obstacle.obstacleNumber ?? obstacle.number);
    if (!Number.isFinite(key)) return;
    const existing = byNumber.get(key) || {};
    byNumber.set(key, { ...existing, ...obstacle, obstacleNumber: key });
  });

  const obstacles = Array.from(byNumber.values())
    .map(obstacle => {
      const number = Number(obstacle.obstacleNumber ?? obstacle.number);
      return {
        obstacleNumber: number,
        timeInSeconds: numberOrDefault(obstacle.timeInSeconds ?? obstacle.timeSeconds, 0),
        knockdowns: numberOrDefault(obstacle.knockdowns, 0),
        knockdownPenalty: numberOrDefault(obstacle.knockdownPenalty ?? obstacle.knockDownPenalty, 0),
        otherPenalty: numberOrDefault(obstacle.otherPenalty, 0),
        timePenalty: numberOrDefault(obstacle.timePenalty, 0),
        penalty: numberOrDefault(obstacle.penalty, 0),
        holdTimeSec: numberOrDefault(obstacle.holdTimeSec, 0),
        eliminated: !!obstacle.eliminated,
        comment: obstacle.comment || '',
        routeString: obstacle.routeString || '',
      };
    })
    .map(row => {
      const calc = calculateSecretariatObstacle(calcContext, row);
      return { ...row, timePenalty: calc.timePenalty, penalty: calc.penalty ?? row.penalty };
    })
    .sort((a, b) => a.obstacleNumber - b.obstacleNumber);

  return {
    finalized: !!summary?.finalized,
    summary: summary || null,
    obstacles,
    calcContext,
  };
}

const PRECISION_EDIT_FIELDS = ['timeMs', 'obstaclePenalty', 'timePenalty', 'extraPenalty', 'eliminated', 'comment'];
const PRECISION_EDIT_DEFAULTS = { timeMs: 0, obstaclePenalty: 0, timePenalty: 0, extraPenalty: 0, eliminated: false, comment: '' };

/**
 * Saves the fields the secretariat edited in a row. `baseRow` is the row as
 * loaded on the page: only fields that differ from it are written, the rest
 * keep the current server values (a judge may have saved since the page was
 * loaded), and an edit of a field the judge changed meanwhile is refused.
 */
export async function saveSecretariatPrecisionRow(competitionId, startNumber, patch = {}, reason = '', { baseRow = null } = {}) {
  if (!competitionId) throw new Error('Ingen tävling vald.');
  if (startNumber == null) throw new Error('Startnummer saknas.');

  const current = await getPrecisionResultForEquipage(competitionId, startNumber);
  if (current?.finalized === true) {
    throw new Error('Resultatet är finaliserat. Lås upp innan ändring.');
  }
  if (isStillRunning(current)) {
    throw new Error(`#${startNumber} kör just nu. Vänta tills domaren har stoppat tiden.`);
  }

  const edited = pickEditedFields(patch, baseRow || current || {}, PRECISION_EDIT_FIELDS, PRECISION_EDIT_DEFAULTS);
  if (baseRow) {
    const conflicts = findEditConflicts(edited, baseRow, current || {}, PRECISION_EDIT_DEFAULTS);
    if (conflicts.length) {
      throw new Error(`Domaren har ändrat ${conflicts.join(', ')} för #${startNumber} efter att sidan laddades. Uppdatera sidan och gör ändringen igen.`);
    }
  }
  if (!Object.keys(edited).length) return current;

  const payload = {
    startNumber: Number(startNumber),
    className: patch.className ?? current?.className ?? null,
    driverName: patch.driverName ?? current?.driverName ?? null,
    timeMs: numberOrDefault(edited.timeMs, current?.timeMs ?? 0),
    obstaclePenalty: numberOrDefault(edited.obstaclePenalty, current?.obstaclePenalty ?? 0),
    timePenalty: numberOrDefault(edited.timePenalty, current?.timePenalty ?? 0),
    // An edited time penalty becomes a manual override; otherwise it follows the time
    timePenaltyOverride: 'timePenalty' in edited || current?.timePenaltyOverride === true,
    extraPenalty: numberOrDefault(edited.extraPenalty, current?.extraPenalty ?? 0),
    eliminated: edited.eliminated ?? current?.eliminated ?? false,
    comment: edited.comment ?? current?.comment ?? '',
    // savePrecisionResult would otherwise reset these two
    disqualified: current?.disqualified === true,
    trackWidthCm: current?.trackWidthCm ?? null,
    running: false,
    inProgress: false,
    finalized: false,
    status: 'Klar',
  };

  // Stored penalties come from the result engine
  const precisionConfig = await getPrecisionCalcConfig(competitionId);
  const calc = calculatePrecisionResult(
    { ...current, ...payload, liveTimeMs: payload.timeMs },
    { startNumber: payload.startNumber, className: payload.className, ...(patch.equipage || {}) },
    precisionConfig,
    { currentCompetition: getGlobalState('currentCompetition') }
  );
  // Without a max time for the class the engine gives no total: save it empty
  // and not as 'Klar' (a hand-set time penalty, timePenaltyOverride, counts)
  payload.timePenalty = calc.configMissing ? null : (calc.timePenalty ?? 0);
  payload.totalPenalty = calc.configMissing ? null : (calc.totalPenalty ?? 0);
  if (calc.configMissing) payload.status = 'Pågår';

  await savePrecisionResult(competitionId, startNumber, payload);

  const after = {
    ...current,
    ...payload,
    finalized: false,
  };

  const changes = buildPrecisionDiff(current || {}, after);
  if (changes.length > 0) {
    await writeSecretariatAuditLog(competitionId, {
      discipline: 'precision',
      startNumber: String(startNumber),
      entityType: 'result',
      entityId: String(startNumber),
      reason: reason || '',
      changes,
    });
  }

  return after;
}

/**
 * Saves the stage times the secretariat edited (see saveSecretariatPrecisionRow
 * for `baseRow`). Only edited stages are written; start/finish clocks and the
 * other stage are left as the timekeepers saved them.
 */
export async function saveSecretariatMarathonTiming(competitionId, startNumber, patch = {}, reason = '', { baseRow = null } = {}) {
  if (!competitionId) throw new Error('Ingen tävling vald.');
  if (startNumber == null) throw new Error('Startnummer saknas.');

  const currentSummary = await getMarathonLiveDocument(competitionId, startNumber);
  if (currentSummary?.finalized === true) {
    throw new Error('Resultatet är finaliserat. Lås upp innan ändring.');
  }
  if (isStillRunning(currentSummary)) {
    throw new Error(`#${startNumber} är ute på banan just nu. Vänta tills tiden är stoppad.`);
  }

  const currentRows = await getMarathonTimingData(competitionId);
  const current = currentRows.get(String(startNumber)) || {};
  const summary = currentSummary || {};
  const serverNow = {
    duration_A: numberOrDefault(summary.duration_A_ms ?? current.duration_A, 0),
    duration_B: numberOrDefault(summary.duration_B_ms ?? current.duration_B, 0),
  };
  const fields = ['duration_A', 'duration_B'];
  const defaults = { duration_A: 0, duration_B: 0 };
  const edited = pickEditedFields(patch, baseRow || serverNow, fields, defaults);
  if (baseRow) {
    const conflicts = findEditConflicts(edited, baseRow, serverNow, defaults);
    if (conflicts.length) {
      throw new Error(`Tiden för ${conflicts.map(f => f.replace('duration_', 'sträcka ')).join(', ')} på #${startNumber} har ändrats efter att sidan laddades. Uppdatera sidan och gör ändringen igen.`);
    }
  }
  if (!Object.keys(edited).length) return { ...current, ...summary };

  const payload = {
    startNumber: Number(startNumber),
    className: patch.className ?? summary.className ?? current.className ?? null,
    duration_A: numberOrDefault(edited.duration_A, serverNow.duration_A),
    duration_B: numberOrDefault(edited.duration_B, serverNow.duration_B),
  };

  const summaryWrite = { startNumber: payload.startNumber, className: payload.className, updatedAt: serverTimestamp() };
  const timingWrite = { startNumber: payload.startNumber, className: payload.className, updatedAt: serverTimestamp() };
  Object.keys(edited).forEach((field) => {
    summaryWrite[`${field}_ms`] = payload[field];
    timingWrite[field] = payload[field];
  });
  await setDoc(getCompDocRef(competitionId, 'maraton', String(startNumber)), summaryWrite, { merge: true });
  await setDoc(getCompDocRef(competitionId, 'maraton-timing', String(startNumber)), timingWrite, { merge: true });

  const beforeForDiff = {
    duration_A: numberOrDefault(summary.duration_A_ms ?? current.duration_A, 0),
    duration_B: numberOrDefault(summary.duration_B_ms ?? current.duration_B, 0),
  };
  const after = { ...current, ...summary, ...payload, duration_A_ms: payload.duration_A, duration_B_ms: payload.duration_B };
  const afterForDiff = {
    duration_A: payload.duration_A,
    duration_B: payload.duration_B,
  };
  const changes = buildFieldDiff(beforeForDiff, afterForDiff, ['duration_A', 'duration_B']);
  if (changes.length > 0) {
    await writeSecretariatAuditLog(competitionId, {
      discipline: 'marathon',
      startNumber: String(startNumber),
      entityType: 'timing',
      entityId: String(startNumber),
      reason: reason || '',
      changes,
    });
  }

  return after;
}

export async function saveSecretariatMarathonObstacle(competitionId, startNumber, obstacleNumber, patch = {}, reason = '') {
  if (!competitionId) throw new Error('Ingen tävling vald.');
  if (startNumber == null) throw new Error('Startnummer saknas.');
  if (obstacleNumber == null) throw new Error('Hindernummer saknas.');

  const currentSummary = await getMarathonLiveDocument(competitionId, startNumber);
  if (currentSummary?.finalized === true) {
    throw new Error('Resultatet är finaliserat. Lås upp innan ändring.');
  }

  const currentObstacles = await getMarathonObstacleResults(competitionId, startNumber);
  const current = currentObstacles.find(item => Number(item.obstacleNumber ?? item.number) === Number(obstacleNumber)) || {};
  const payload = {
    timeInSeconds: numberOrDefault(patch.timeInSeconds, current.timeInSeconds ?? current.timeSeconds ?? 0),
    timePenalty: numberOrDefault(patch.timePenalty, current.timePenalty ?? 0),
    knockdowns: numberOrDefault(patch.knockdowns, current.knockdowns ?? 0),
    knockdownPenalty: numberOrDefault(patch.knockdownPenalty ?? patch.knockDownPenalty, current.knockdownPenalty ?? current.knockDownPenalty ?? 0),
    otherPenalty: numberOrDefault(patch.otherPenalty, current.otherPenalty ?? 0),
    penalty: numberOrDefault(patch.penalty, current.penalty ?? 0),
    holdTimeSec: numberOrDefault(patch.holdTimeSec, current.holdTimeSec ?? 0),
    eliminated: patch.eliminated ?? current.eliminated ?? false,
    comment: patch.comment ?? current.comment ?? '',
    routeString: patch.routeString ?? current.routeString ?? '',
  };
  payload.timeMs = Math.round(payload.timeInSeconds * 1000);

  // Time penalty and obstacle total come from the result engine
  const calcContext = patch.calcContext || {
    equipage: { startNumber },
    marathonConfig: await getMarathonCalcConfig(competitionId),
  };
  const calc = calculateSecretariatObstacle(calcContext, payload);
  payload.timePenalty = calc.timePenalty;
  payload.penalty = calc.penalty ?? 0;

  await saveMarathonObstacleResult(competitionId, startNumber, obstacleNumber, payload);

  const after = { ...current, ...payload, obstacleNumber: Number(obstacleNumber) };
  const changes = buildFieldDiff(current, after, ['timeInSeconds', 'timePenalty', 'knockdowns', 'knockdownPenalty', 'otherPenalty', 'holdTimeSec', 'penalty', 'eliminated', 'comment']);
  if (changes.length > 0) {
    await writeSecretariatAuditLog(competitionId, {
      discipline: 'marathon',
      startNumber: String(startNumber),
      entityType: 'obstacle',
      entityId: `${startNumber}:${obstacleNumber}`,
      reason: reason || '',
      changes,
    });
  }

  return after;
}

export async function saveSecretariatDressageProtocol(competitionId, startNumber, judgeId, patch = {}, reason = '') {
  if (!competitionId) throw new Error('Ingen tävling vald.');
  if (startNumber == null) throw new Error('Startnummer saknas.');
  if (judgeId == null) throw new Error('Domare saknas.');

  const finalizationDoc = await getDoc(doc(db, `competitions/${competitionId}/dressageFinalization/${String(startNumber)}`));
  if (finalizationDoc.data()?.finalized === true) {
    throw new Error('Resultatet är finaliserat. Lås upp innan ändring.');
  }

  const detail = await loadSecretariatDressageDetail(competitionId, startNumber);
  const current = detail.protocols.find(protocol => String(protocol.judgeId) === String(judgeId)) || {};
  const payload = {
    judgeId: String(judgeId),
    judgeName: patch.judgeName ?? current.judgeName ?? '',
    judgePosition: patch.judgePosition ?? current.judgePosition ?? '',
    programKey: patch.programKey ?? current.programKey ?? '',
    eliminated: patch.eliminated ?? current.eliminated ?? false,
    movements: Array.isArray(patch.movements) ? patch.movements : (current.movements || []),
  };

  await saveDressageJudgeProtocol(competitionId, startNumber, judgeId, payload);

  const changes = buildFieldDiff(
    {
      eliminated: !!current.eliminated,
      movements: current.movements || [],
    },
    {
      eliminated: !!payload.eliminated,
      movements: payload.movements || [],
    },
    ['eliminated', 'movements']
  );
  if (changes.length > 0) {
    await writeSecretariatAuditLog(competitionId, {
      discipline: 'dressage',
      startNumber: String(startNumber),
      entityType: 'protocol',
      entityId: `${startNumber}:${judgeId}`,
      reason: reason || '',
      changes,
    });
  }

  return payload;
}

export async function saveSecretariatDressageGeneral(competitionId, startNumber, patch = {}, reason = '') {
  if (!competitionId) throw new Error('Ingen tävling vald.');
  if (startNumber == null) throw new Error('Startnummer saknas.');

  const finalizationDoc = await getDoc(doc(db, `competitions/${competitionId}/dressageFinalization/${String(startNumber)}`));
  if (finalizationDoc.data()?.finalized === true) {
    throw new Error('Resultatet är finaliserat. Lås upp innan ändring.');
  }

  const detail = await loadSecretariatDressageDetail(competitionId, startNumber);
  const current = detail.general || {};
  const payload = {
    errorPoints: Number.isFinite(Number(patch.errorPoints)) ? Number(patch.errorPoints) : Number(current.errorPoints || 0),
    errorComment: patch.errorComment ?? current.errorComment ?? '',
  };

  await saveDressageGeneralData(competitionId, startNumber, payload);

  const changes = buildFieldDiff(current, payload, ['errorPoints', 'errorComment']);
  if (changes.length > 0) {
    await writeSecretariatAuditLog(competitionId, {
      discipline: 'dressage',
      startNumber: String(startNumber),
      entityType: 'general',
      entityId: String(startNumber),
      reason: reason || '',
      changes,
    });
  }

  return payload;
}

export async function unlockResult(competitionId, discipline, startNumber) {
  if (discipline === 'precision') return unfinalizePrecision(competitionId, startNumber);
  if (discipline === 'marathon') return unfinalizeMarathon(competitionId, startNumber);
  if (discipline === 'dressage') return unfinalizeDressage(competitionId, startNumber);
  throw new Error(`Okänd disciplin: ${discipline}`);
}

export async function refinalizeResult(competitionId, discipline, startNumber) {
  if (discipline === 'precision') return finalizePrecision(competitionId, startNumber);
  if (discipline === 'marathon') return finalizeMarathon(competitionId, startNumber);
  if (discipline === 'dressage') return finalizeDressage(competitionId, startNumber);
  throw new Error(`Okänd disciplin: ${discipline}`);
}
