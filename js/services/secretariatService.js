import { db, appId, auth } from '../config/firebase-config.js';
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
import {
  buildCorrectionReason,
  findEditConflicts,
  isStillRunning,
  mergeObstacleSources,
  mergeProtocolEdits,
  normalizeSecretariatObstacle,
  pickEditedFields,
  planObstacleCorrection
} from './secretariatPatchUtils.js';
import { getConfig } from './competitionService.js';
import {
  calculatePrecisionResult,
  calculatePrecisionRoundResult,
  getPrecisionFormat,
  isPrecisionDriveOffScheduled,
  nextPrecisionRebuildCount,
  precisionRebuildCount
} from '../utils/precisionCalculation.js';
import { loadMergeSource } from './mergeConfigService.js';
import { precisionGroupKeyFn } from '../pages/precision/precisionRoundInput.js';
import { nestPrecisionRoundPayload, precisionRoundsForFormat, readPrecisionRound } from '../utils/precisionRounds.js';
import { calculateObstacleResult } from '../core-engine/marathon.js';
import { obstacleLiveEntry } from '../core-engine/stateSelector.js';
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
  const fields = ['timeMs', 'obstaclePenalty', 'timePenalty', 'extraPenalty', 'rebuildCount', 'totalPenalty', 'eliminated', 'comment', 'finalized'];
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

// The 'general' protocol document (error points) per start number, from the
// protocols path or, when only that exists, the older dressageResults path
async function getDressageGeneralMap(competitionId, equipages = []) {
  const out = new Map();
  const base = `artifacts/${appId}/public/data/competitions/${competitionId}`;
  const startNumbers = equipages.map(eq => String(eq.startNumber ?? eq.id ?? '').trim()).filter(Boolean);
  const chunkSize = 20;
  for (let i = 0; i < startNumbers.length; i += chunkSize) {
    await Promise.all(startNumbers.slice(i, i + chunkSize).map(async (sn) => {
      try {
        let snap = await getDoc(doc(db, `${base}/dressage/${sn}/protocols/general`));
        if (!snap.exists()) snap = await getDoc(doc(db, `${base}/dressageResults/${sn}/protocols/general`));
        if (snap.exists()) out.set(sn, snap.data() || {});
      } catch (error) {
        console.warn(`Kunde inte läsa felpoäng för #${sn}:`, error);
      }
    }));
  }
  return out;
}

async function getDressageFinalizationMap(competitionId) {
  const out = new Map();
  if (!competitionId) return out;
  const colRef = collection(db, `competitions/${competitionId}/dressageFinalization`);
  const snap = await getDocs(colRef);
  snap.forEach(docSnap => out.set(String(docSnap.id), docSnap.data() || {}));
  return out;
}

/**
 * The reason of a correction as { reason, reference }: from the reason dialog
 * ({ reason, reference }) or a plain text. A correction needs a reason.
 */
function requireCorrectionReason(reason) {
  if (reason && typeof reason === 'object') {
    return buildCorrectionReason({
      reason: reason.reason,
      referenceType: reason.reference?.type || reason.referenceType,
      referenceValue: reason.reference?.value || reason.referenceValue,
    });
  }
  return buildCorrectionReason({ reason });
}

/**
 * Logs a correction in the competition's change log. Best effort, after the
 * save: the save itself has gone through, so a log entry that cannot be
 * written (no signal, no permission) must not turn it into an error, and the
 * page does not wait for it (offline it would wait until the signal is back).
 */
export function writeSecretariatAuditLog(competitionId, entry = {}) {
  if (!competitionId) return Promise.resolve(null);
  // The rules require the writer's own uid
  const uid = auth?.currentUser?.uid || currentUserId();
  const { reason = '', reference = null, ...rest } = entry;
  return addDoc(getAuditCollectionRef(competitionId), {
    source: 'secretariat',
    ...rest,
    reason: String(reason || ''),
    reference: reference || null,
    editedBy: uid,
    editedAt: serverTimestamp(),
  }).catch((error) => {
    console.warn('Ändringsloggen kunde inte sparas:', error);
    return null;
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
  const equipage = ctx.equipage || { startNumber: row?.startNumber, className: row?.className };
  const options = { currentCompetition: getGlobalState('currentCompetition'), marathonConfig: ctx.marathonConfig || null };
  const round = row?.round || 'phase1';
  if (round !== 'phase1') {
    // A phase 2 / drive-off row: that round alone, scored with its own max time
    return calculatePrecisionRoundResult(
      { ...readPrecisionRound(row?.resultDoc, round), ...patch, timeMs, liveTimeMs: timeMs, finalized: false, running: false },
      equipage,
      ctx.config || {},
      round,
      options
    );
  }
  return calculatePrecisionResult(
    {
      ...(row?.resultDoc || {}),
      ...patch,
      timeMs,
      liveTimeMs: timeMs,
      finalized: false,
      running: false
    },
    equipage,
    ctx.config || {},
    options
  );
}

// One round's editable row (phase 2 / drive-off), in the shape of the phase-1 row
function buildPrecisionRoundRow(base, result, round) {
  const rd = readPrecisionRound(result, round);
  const row = {
    startNumber: base.startNumber,
    driverName: base.driverName,
    className: base.className,
    round,
    running: rd.running === true,
    // A drive-off is finalized on its own (own lock), phase 2 with the whole result
    finalized: round === 'driveOff' ? rd.finalized === true : base.finalized,
    retired: rd.retired === true,
    timeMs: numberOrDefault(rd.timeMs ?? rd.liveTimeMs, 0),
    obstaclePenalty: numberOrDefault(rd.obstaclePenalty, 0),
    timePenalty: numberOrDefault(rd.timePenalty, 0),
    timePenaltyOverride: rd.timePenaltyOverride === true,
    extraPenalty: numberOrDefault(rd.extraPenalty, 0),
    rebuildCount: precisionRebuildCount(rd),
    totalPenalty: rd.totalPenalty == null ? null : numberOrDefault(rd.totalPenalty, 0),
    eliminated: rd.eliminated === true,
    comment: rd.comment || '',
    resultDoc: result,
    calcContext: base.calcContext,
  };
  row.status = derivePrecisionStatus(row);
  if (row.status !== 'not-started') {
    const calc = calculateSecretariatPrecisionDraft(row);
    row.timePenalty = calc.timePenalty ?? 0;
    row.totalPenalty = calc.totalPenalty ?? 0;
    row.scoring = calc.scoring || 'fault';
  }
  return row;
}

export async function loadSecretariatPrecisionRows(competitionId) {
  if (!competitionId) return [];

  const [equipages, results, precisionConfig, marathonConfig, mergeSource] = await Promise.all([
    getEquipages(competitionId),
    getPrecisionResults(competitionId),
    getPrecisionCalcConfig(competitionId),
    // The rule profile (TR/FEI) of a class decides how phase 2 is scored
    getConfig(competitionId, 'marathonConfig').catch(() => null),
    // Placing groups (merged classes) as on the results page
    loadMergeSource(competitionId).catch(() => null),
  ]);
  const groupKeyOf = precisionGroupKeyFn(mergeSource);

  const resultMap = new Map(results.map(result => [String(result.startNumber || result.id), result]));
  const rows = equipages.map(eq => {
    const sn = String(eq.startNumber);
    const result = resultMap.get(sn) || {};
    const row = {
      startNumber: eq.startNumber,
      groupKey: groupKeyOf(eq),
      driverName: eq.driverName || '',
      className: eq.className || '',
      running: !!result.running,
      finalized: !!result.finalized,
      timeMs: numberOrDefault(result.timeMs, 0),
      obstaclePenalty: numberOrDefault(result.obstaclePenalty, 0),
      timePenalty: numberOrDefault(result.timePenalty, 0),
      timePenaltyOverride: result.timePenaltyOverride === true,
      extraPenalty: numberOrDefault(result.extraPenalty, 0),
      // Obstacle rebuilds, +10 s each on the time
      rebuildCount: precisionRebuildCount(result),
      totalPenalty: result.totalPenalty == null ? null : numberOrDefault(result.totalPenalty, 0),
      eliminated: !!result.eliminated,
      comment: result.comment || '',
      resultDoc: result,
      calcContext: { equipage: eq, config: precisionConfig, marathonConfig: marathonConfig || null },
    };

    row.status = derivePrecisionStatus(row);
    // The engine's view of the whole result (phase 2 / drive-off qualification, warnings)
    row.engine = calculateSecretariatPrecisionDraft(row);
    if (row.status !== 'not-started') {
      // Show the penalties the engine gives this result
      const calc = calculateSecretariatPrecisionDraft(row);
      row.timePenalty = calc.timePenalty ?? 0;
      row.totalPenalty = calc.totalPenalty ?? 0;
    }

    // The other rounds of the class's format (rounds.phase2 / rounds.driveOff)
    row.format = getPrecisionFormat(eq, precisionConfig);
    row.roundKeys = precisionRoundsForFormat(row.format, { driveOffScheduled: isPrecisionDriveOffScheduled(eq, precisionConfig) });
    row.rounds = {};
    row.roundKeys.filter((round) => round !== 'phase1').forEach((round) => {
      row.rounds[round] = buildPrecisionRoundRow(row, result, round);
      // The whole result's engine view (qualification) next to the round
      row.rounds[round].engine = row.engine;
    });

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
      // Other penalties and the section they were given on (TR 527.1)
      otherPenalty: numberOrDefault(state.otherPenalty, 0),
      otherPenaltySection: state.otherPenaltySection || '',
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
  const [statusDocs, allProtocolsMap, finalizationMap, generalMap] = await Promise.all([
    getDressageStatusCollection(competitionId),
    getAllDressageProtocols(competitionId, equipages),
    getDressageFinalizationMap(competitionId),
    getDressageGeneralMap(competitionId, equipages),
  ]);

  const statusMap = new Map(statusDocs.map(docRow => [String(docRow.id || docRow.startNumber), docRow]));
  const rows = equipages.map(eq => {
    const sn = String(eq.startNumber);
    const status = statusMap.get(sn) || {};
    // The error points are kept in the 'general' protocol document (the
    // status document's copy may be older)
    const protocols = (allProtocolsMap.get(sn) || []).filter(protocol => protocol?.id !== 'general');
    const finalization = finalizationMap.get(sn) || {};
    const general = generalMap.get(sn) || null;

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
      errorPoints: Number((general ? general.errorPoints : status.errorPoints) || 0),
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

  const byNumber = mergeObstacleSources(savedObstacles, summary);

  const obstacles = Array.from(byNumber.entries())
    .map(([number, obstacle]) => normalizeSecretariatObstacle(obstacle, number))
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

/**
 * Saves the edited fields of a phase 2 / drive-off row: written to
 * rounds.<round> only (a merge), the top level (phase 1, the combined total)
 * is not touched. Phase 2 is closed with the whole result (finalized), a
 * drive-off by its own lock (rounds.driveOff.finalized).
 */
async function saveSecretariatPrecisionRoundRow(competitionId, startNumber, patch, reason, { baseRow = null, round }) {
  const current = await getPrecisionResultForEquipage(competitionId, startNumber);
  const currentRound = readPrecisionRound(current, round);
  const locked = round === 'driveOff' ? currentRound.finalized === true : current?.finalized === true;
  if (locked) {
    throw new Error(round === 'driveOff'
      ? 'Omkörningen är finaliserad. Öppna den innan ändring.'
      : 'Resultatet är finaliserat. Lås upp innan ändring.');
  }
  if (isStillRunning(current)) {
    throw new Error(`#${startNumber} kör just nu. Vänta tills domaren har stoppat tiden.`);
  }

  const edited = pickEditedFields(patch, baseRow || currentRound, PRECISION_EDIT_FIELDS, PRECISION_EDIT_DEFAULTS);
  if (baseRow) {
    const conflicts = findEditConflicts(edited, baseRow, currentRound, PRECISION_EDIT_DEFAULTS);
    if (conflicts.length) {
      throw new Error(`Domaren har ändrat ${conflicts.join(', ')} för #${startNumber} efter att sidan laddades. Uppdatera sidan och gör ändringen igen.`);
    }
  }
  if (!Object.keys(edited).length) return current;
  const correction = requireCorrectionReason(reason);

  const fields = {
    timeMs: numberOrDefault(edited.timeMs, currentRound.timeMs ?? 0),
    obstaclePenalty: numberOrDefault(edited.obstaclePenalty, currentRound.obstaclePenalty ?? 0),
    timePenalty: numberOrDefault(edited.timePenalty, currentRound.timePenalty ?? 0),
    timePenaltyOverride: 'timePenalty' in edited || currentRound.timePenaltyOverride === true,
    extraPenalty: numberOrDefault(edited.extraPenalty, currentRound.extraPenalty ?? 0),
    rebuildCount: 'rebuildCount' in edited ? nextPrecisionRebuildCount(edited.rebuildCount, 0) : precisionRebuildCount(currentRound),
    eliminated: edited.eliminated ?? currentRound.eliminated ?? false,
    comment: edited.comment ?? currentRound.comment ?? '',
    running: false,
    inProgress: false,
    liveStartEpoch: null,
    status: 'Klar',
  };
  // A time entered for a round marked "not started" means it was driven
  if ('timeMs' in edited && fields.timeMs > 0 && currentRound.retired === true) fields.retired = false;
  fields.liveTimeMs = fields.timeMs;
  fields.livePausedMs = fields.timeMs;

  const precisionConfig = await getPrecisionCalcConfig(competitionId);
  const marathonConfig = await getConfig(competitionId, 'marathonConfig').catch(() => null);
  const equipage = { startNumber: Number(startNumber), className: patch.className ?? current?.className ?? null, ...(patch.equipage || {}) };
  const calc = calculatePrecisionRoundResult(
    { ...currentRound, ...fields },
    equipage,
    precisionConfig,
    round,
    { currentCompetition: getGlobalState('currentCompetition'), marathonConfig: marathonConfig || null }
  );
  fields.timePenalty = calc.configMissing ? null : (calc.timePenalty ?? 0);
  fields.totalPenalty = calc.configMissing ? null : (calc.totalPenalty ?? 0);
  fields.liveTimePenalty = fields.timePenalty;
  fields.liveObstaclePenalty = fields.obstaclePenalty;
  fields.liveTotalPenalty = fields.totalPenalty;
  if (calc.configMissing) fields.status = 'Pågår';
  fields.updatedAt = Date.now();

  await setDoc(
    getCompDocRef(competitionId, 'precision', String(startNumber)),
    nestPrecisionRoundPayload(round, fields, { startNumber: Number(startNumber), className: equipage.className, updatedAt: fields.updatedAt }),
    { merge: true }
  );

  const after = { ...currentRound, ...fields };
  const changes = buildPrecisionDiff(currentRound, after).map((change) => ({ ...change, field: `${round}.${change.field}` }));
  if (changes.length > 0) {
    writeSecretariatAuditLog(competitionId, {
      discipline: 'precision',
      startNumber: String(startNumber),
      entityType: 'result',
      entityId: String(startNumber),
      ...correction,
      changes,
    });
  }
  return { ...current, rounds: { ...(current?.rounds || {}), [round]: after } };
}

const PRECISION_EDIT_FIELDS = ['timeMs', 'obstaclePenalty', 'timePenalty', 'extraPenalty', 'rebuildCount', 'eliminated', 'comment'];
const PRECISION_EDIT_DEFAULTS = { timeMs: 0, obstaclePenalty: 0, timePenalty: 0, extraPenalty: 0, rebuildCount: 0, eliminated: false, comment: '' };

/**
 * Saves the fields the secretariat edited in a row. `baseRow` is the row as
 * loaded on the page: only fields that differ from it are written, the rest
 * keep the current server values (a judge may have saved since the page was
 * loaded), and an edit of a field the judge changed meanwhile is refused.
 */
export async function saveSecretariatPrecisionRow(competitionId, startNumber, patch = {}, reason = '', { baseRow = null, round = 'phase1' } = {}) {
  if (!competitionId) throw new Error('Ingen tävling vald.');
  if (startNumber == null) throw new Error('Startnummer saknas.');
  if (round && round !== 'phase1') {
    return saveSecretariatPrecisionRoundRow(competitionId, startNumber, patch, reason, { baseRow, round });
  }

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
  const correction = requireCorrectionReason(reason);

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
    rebuildCount: 'rebuildCount' in edited ? nextPrecisionRebuildCount(edited.rebuildCount, 0) : precisionRebuildCount(current),
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
  // savePrecisionResult does not carry the rebuild count: written on its own
  if ('rebuildCount' in edited) {
    await setDoc(getCompDocRef(competitionId, 'precision', String(startNumber)), { rebuildCount: payload.rebuildCount }, { merge: true });
  }

  const after = {
    ...current,
    ...payload,
    finalized: false,
  };

  const changes = buildPrecisionDiff(current || {}, after);
  if (changes.length > 0) {
    writeSecretariatAuditLog(competitionId, {
      discipline: 'precision',
      startNumber: String(startNumber),
      entityType: 'result',
      entityId: String(startNumber),
      ...correction,
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
    otherPenalty: numberOrDefault(summary.otherPenalty, 0),
    otherPenaltySection: summary.otherPenaltySection || '',
  };
  const fields = ['duration_A', 'duration_B', 'otherPenalty', 'otherPenaltySection'];
  const defaults = { duration_A: 0, duration_B: 0, otherPenalty: 0, otherPenaltySection: '' };
  const edited = pickEditedFields(patch, baseRow || serverNow, fields, defaults);
  // The section of the other penalty (TR 527.1, the B-section tie-break) is
  // saved with every change of the penalty
  if ('otherPenalty' in edited && !('otherPenaltySection' in edited) && patch.otherPenaltySection) {
    edited.otherPenaltySection = patch.otherPenaltySection;
  }
  if (baseRow) {
    const conflicts = findEditConflicts(edited, baseRow, serverNow, defaults);
    if (conflicts.length) {
      const labels = { duration_A: 'sträcka A', duration_B: 'sträcka B', otherPenalty: 'övriga straff', otherPenaltySection: 'övriga straffs sträcka' };
      throw new Error(`${conflicts.map(f => labels[f] || f).join(', ')} på #${startNumber} har ändrats efter att sidan laddades. Uppdatera sidan och gör ändringen igen.`);
    }
  }
  if (!Object.keys(edited).length) return { ...current, ...summary };
  const correction = requireCorrectionReason(reason);

  const payload = {
    startNumber: Number(startNumber),
    className: patch.className ?? summary.className ?? current.className ?? null,
    duration_A: numberOrDefault(edited.duration_A, serverNow.duration_A),
    duration_B: numberOrDefault(edited.duration_B, serverNow.duration_B),
    otherPenalty: numberOrDefault(edited.otherPenalty, serverNow.otherPenalty),
    otherPenaltySection: ['A', 'transport', 'B'].includes(edited.otherPenaltySection) ? edited.otherPenaltySection : (serverNow.otherPenaltySection || null),
  };

  const summaryWrite = { startNumber: payload.startNumber, className: payload.className, updatedAt: serverTimestamp() };
  const timingWrite = { startNumber: payload.startNumber, className: payload.className, updatedAt: serverTimestamp() };
  ['duration_A', 'duration_B'].filter(field => field in edited).forEach((field) => {
    summaryWrite[`${field}_ms`] = payload[field];
    timingWrite[field] = payload[field];
  });
  // Other penalties live on the maraton document only
  if ('otherPenalty' in edited) summaryWrite.otherPenalty = payload.otherPenalty;
  if ('otherPenaltySection' in edited) summaryWrite.otherPenaltySection = payload.otherPenaltySection;
  await setDoc(getCompDocRef(competitionId, 'maraton', String(startNumber)), summaryWrite, { merge: true });
  if (Object.keys(timingWrite).length > 3) {
    await setDoc(getCompDocRef(competitionId, 'maraton-timing', String(startNumber)), timingWrite, { merge: true });
  }

  const beforeForDiff = { ...serverNow };
  const after = { ...current, ...summary, ...payload, duration_A_ms: payload.duration_A, duration_B_ms: payload.duration_B };
  const afterForDiff = {
    duration_A: payload.duration_A,
    duration_B: payload.duration_B,
    otherPenalty: payload.otherPenalty,
    otherPenaltySection: payload.otherPenaltySection || '',
  };
  const changes = buildFieldDiff(beforeForDiff, afterForDiff, fields);
  if (changes.length > 0) {
    writeSecretariatAuditLog(competitionId, {
      discipline: 'marathon',
      startNumber: String(startNumber),
      entityType: 'timing',
      entityId: String(startNumber),
      ...correction,
      changes,
    });
  }

  return after;
}

const OBSTACLE_FIELD_LABELS = {
  timeInSeconds: 'tiden',
  knockdowns: 'nedslagna element',
  knockdownPenalty: 'nedslagsstraffet',
  otherPenalty: 'övriga straff',
  holdTimeSec: 'uppehållet',
  eliminated: 'eliminering',
  comment: 'kommentaren',
};

/**
 * Saves the secretariat's correction of one obstacle (see
 * saveSecretariatPrecisionRow for `baseRow`, here the obstacle row as loaded):
 * only the edited fields change, the rest of the entry and the other
 * obstacles stay as the judges saved them.
 */
export async function saveSecretariatMarathonObstacle(competitionId, startNumber, obstacleNumber, patch = {}, reason = '', { baseRow = null } = {}) {
  if (!competitionId) throw new Error('Ingen tävling vald.');
  if (startNumber == null) throw new Error('Startnummer saknas.');
  if (obstacleNumber == null) throw new Error('Hindernummer saknas.');

  const currentSummary = await getMarathonLiveDocument(competitionId, startNumber);
  if (currentSummary?.finalized === true) {
    throw new Error('Resultatet är finaliserat. Lås upp innan ändring.');
  }
  // This obstacle's own clock and form (each obstacle has its own live
  // entry): a running time, or one stopped but not saved yet, is the judge's
  // work, which saving now would clear
  const live = obstacleLiveEntry(currentSummary, obstacleNumber);
  if (live?.running === true) {
    throw new Error(`#${startNumber} kör hinder ${obstacleNumber} just nu. Vänta tills hindertiden är stoppad.`);
  }
  if (live?.inProgress === true) {
    throw new Error(`Hinderdomaren har en osparad tid för #${startNumber} i hinder ${obstacleNumber}. Vänta tills den är sparad.`);
  }

  // The obstacle as stored now, from the same sources as the page loaded it
  const savedObstacles = await getMarathonObstacleResults(competitionId, startNumber);
  const current = mergeObstacleSources(savedObstacles, currentSummary).get(Number(obstacleNumber)) || {};
  // Only the fields edited on the page (compared with the row as loaded) are
  // written, on top of the server's values; an edit of a field the judge
  // changed since is refused instead of overwriting it
  const loadedRow = baseRow || normalizeSecretariatObstacle(current, obstacleNumber);
  const plan = planObstacleCorrection(patch, loadedRow, current);
  if (plan.conflicts.length) {
    throw new Error(`Hinderdomaren har ändrat ${plan.conflicts.map(field => OBSTACLE_FIELD_LABELS[field] || field).join(', ')} i hinder ${obstacleNumber} för #${startNumber} efter att sidan laddades. Uppdatera sidan och gör ändringen igen.`);
  }
  if (!Object.keys(plan.edited).length) return { ...plan.current, obstacleNumber: Number(obstacleNumber) };
  const correction = requireCorrectionReason(reason);

  const payload = { ...plan.payload };
  delete payload.obstacleNumber;
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

  const after = { ...plan.current, ...payload, obstacleNumber: Number(obstacleNumber) };
  const changes = buildFieldDiff(plan.current, after, ['timeInSeconds', 'timePenalty', 'knockdowns', 'knockdownPenalty', 'otherPenalty', 'holdTimeSec', 'penalty', 'eliminated', 'comment']);
  if (changes.length > 0) {
    writeSecretariatAuditLog(competitionId, {
      discipline: 'marathon',
      startNumber: String(startNumber),
      entityType: 'obstacle',
      entityId: `${startNumber}:${obstacleNumber}`,
      ...correction,
      changes,
    });
  }

  return after;
}

/**
 * `loaded` is the protocol as the secretariat page loaded it. When given, only
 * the movements the secretariat changed are saved on top of the protocol now
 * on the server, and a movement the judge changed in between is refused.
 */
export async function saveSecretariatDressageProtocol(competitionId, startNumber, judgeId, patch = {}, reason = '', loaded = null) {
  if (!competitionId) throw new Error('Ingen tävling vald.');
  if (startNumber == null) throw new Error('Startnummer saknas.');
  if (judgeId == null) throw new Error('Domare saknas.');

  const finalizationDoc = await getDoc(doc(db, `competitions/${competitionId}/dressageFinalization/${String(startNumber)}`));
  if (finalizationDoc.data()?.finalized === true) {
    throw new Error('Resultatet är finaliserat. Lås upp innan ändring.');
  }

  const detail = await loadSecretariatDressageDetail(competitionId, startNumber);
  const current = detail.protocols.find(protocol => String(protocol.judgeId) === String(judgeId)) || {};

  let eliminated = patch.eliminated ?? current.eliminated ?? false;
  let movements = Array.isArray(patch.movements) ? patch.movements : (current.movements || []);
  if (loaded && Array.isArray(patch.movements)) {
    const merged = mergeProtocolEdits(patch, loaded, current);
    if (merged.conflicts.length > 0) {
      throw new Error('Domaren har ändrat samma moment sedan protokollet öppnades. Läs in protokollet igen och gör ändringen på nytt.');
    }
    if (merged.changedFields.length === 0) return current;
    eliminated = merged.eliminated;
    movements = merged.movements;
  }
  const correction = requireCorrectionReason(reason);

  const payload = {
    judgeId: String(judgeId),
    judgeName: patch.judgeName ?? current.judgeName ?? '',
    judgePosition: patch.judgePosition ?? current.judgePosition ?? '',
    programKey: patch.programKey ?? current.programKey ?? '',
    eliminated,
    movements,
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
    writeSecretariatAuditLog(competitionId, {
      discipline: 'dressage',
      startNumber: String(startNumber),
      entityType: 'protocol',
      entityId: `${startNumber}:${judgeId}`,
      ...correction,
      changes,
    });
  }

  return payload;
}

export async function saveSecretariatDressageGeneral(competitionId, startNumber, patch = {}, reason = '', loaded = null) {
  if (!competitionId) throw new Error('Ingen tävling vald.');
  if (startNumber == null) throw new Error('Startnummer saknas.');

  const finalizationDoc = await getDoc(doc(db, `competitions/${competitionId}/dressageFinalization/${String(startNumber)}`));
  if (finalizationDoc.data()?.finalized === true) {
    throw new Error('Resultatet är finaliserat. Lås upp innan ändring.');
  }

  const detail = await loadSecretariatDressageDetail(competitionId, startNumber);
  const current = detail.general || {};
  // Same rule as for protocols: only what was edited, never over a newer change
  let effectivePatch = patch;
  if (loaded) {
    const defaults = { errorPoints: 0, errorComment: '' };
    const edited = pickEditedFields(patch, loaded, ['errorPoints', 'errorComment'], defaults);
    if (findEditConflicts(edited, loaded, current, defaults).length > 0) {
      throw new Error('Felpoängen har ändrats sedan protokollet öppnades. Läs in igen och gör ändringen på nytt.');
    }
    if (Object.keys(edited).length === 0) return current;
    effectivePatch = edited;
  }
  const correction = requireCorrectionReason(reason);
  const payload = {
    errorPoints: Number.isFinite(Number(effectivePatch.errorPoints)) ? Number(effectivePatch.errorPoints) : Number(current.errorPoints || 0),
    errorComment: effectivePatch.errorComment ?? current.errorComment ?? '',
  };

  await saveDressageGeneralData(competitionId, startNumber, payload);

  const changes = buildFieldDiff(current, payload, ['errorPoints', 'errorComment']);
  if (changes.length > 0) {
    writeSecretariatAuditLog(competitionId, {
      discipline: 'dressage',
      startNumber: String(startNumber),
      entityType: 'general',
      entityId: String(startNumber),
      ...correction,
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
