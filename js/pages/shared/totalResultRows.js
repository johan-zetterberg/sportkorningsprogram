export function buildTotalCalculationContext({
  allPrograms = {},
  judges = [],
  marathonConfig = {},
  precisionConfig = {}
} = {}) {
  return {
    allPrograms,
    judges,
    marathonConfig,
    precisionConfig
  };
}

export function buildTotalResultRow({
  equipage,
  rawProtocols = [],
  marDoc = {},
  timeDocRaw = {},
  precisionDoc = {},
  allPrograms = {},
  judges = [],
  marathonConfig = {},
  precisionConfig = {},
  displayConfig = null,
  calculateTotalResult,
  resolveMergeGrouping
}) {
  if (!equipage) return null;
  if (typeof calculateTotalResult !== 'function') {
    throw new Error('buildTotalResultRow: calculateTotalResult saknas');
  }
  if (typeof resolveMergeGrouping !== 'function') {
    throw new Error('buildTotalResultRow: resolveMergeGrouping saknas');
  }

  const timeDoc = { ...timeDocRaw, ...marDoc };
  const res = calculateTotalResult(
    equipage,
    rawProtocols,
    { obstacleData: marDoc, timeData: timeDoc },
    precisionDoc,
    buildTotalCalculationContext({
      allPrograms,
      judges,
      marathonConfig,
      precisionConfig
    })
  );
  const group = resolveMergeGrouping(equipage, displayConfig);
  const cls = equipage.className || '';
  const dressage = res.dressage || {};
  const marathon = res.marathon || {};
  const precision = res.precision || {};

  return {
    id: equipage.id,
    startNumber: equipage.startNumber,
    driverName: equipage.driverName || equipage.name || '',
    // A horse without a name (older or imported data) must not show as [object Object]
    horseName: equipage.horseName || (Array.isArray(equipage.horses) ? equipage.horses.map((h => (typeof h === 'string' ? h : (h?.name || h?.namn || h?.horseName || '')))).filter(Boolean).join(', ') : ''),
    horses: Array.isArray(equipage.horses) ? equipage.horses : [],
    clubName: equipage.clubName || '',
    className: cls,
    country: equipage.country || equipage.nation || equipage.nationality || '',
    nation: equipage.nation || '',
    nationality: equipage.nationality || '',
    isPara: Boolean(equipage.isPara),
    paraGrade: equipage.paraGrade || '',
    displayGroupKey: group.key,
    displayGroupLabel: group.label,
    // The team calculation (teamCalculationService) tells a withdrawn member
    // by these fields, as on the report pages
    status: equipage.status || '',
    struken: equipage.struken === true,
    withdrawn: equipage.withdrawn === true,

    dressage: {
      penalty: dressage.judgePenalty,
      ...dressage,
      percentAvg: dressage.percentAvg ?? dressage.percent ?? null
    },
    dressageStatus: (dressage.penalty != null || dressage.percent != null) ? 'finished' : 'missing',
    marathonStatus: (marathon.status === 'Klar' || marathon.status === 'Färdig' || marathon.status === 'Eliminerad')
      ? 'finished'
      : (marathon.status === 'Pågår' ? 'ongoing' : 'missing'),
    precisionStatus: (precision.status === 'Klar' || precision.status === 'Utesluten')
      ? 'finished'
      : ((precision.status === 'Pågår' || precision.running) ? 'ongoing' : 'missing'),

    marathon: {
      ...marathon,
      totalPenalty: marathon.totalPenalty
    },
    precision: {
      ...precision,
      pen: precision.totalPenalty,
      obstPen: precision.obstPen ?? precision.obstaclePenalty ?? null,
      timePen: precision.timePen ?? precision.timePenalty ?? null
    },

    totalPenalty: res.totalPenalty,
    isEliminated: res.isEliminated,
    elimReason: res.elimReason,
    isOngoing: res.isOngoing,
    // Whether each phase is finished, from the result engine (statuses, teams)
    dressageComplete: res.dressageComplete,
    marathonComplete: res.marathonComplete,
    precisionComplete: res.precisionComplete,
    plac: null
  };
}

// 'ok' (green check) only for a phase the result engine calls finished; a phase
// with a value that is not finished yet is 'partial'. Rows without the
// engine's flags keep the value-based status.
function phaseStatus(complete, hasValue, hasPartial = false) {
  if (complete === true) return 'ok';
  if (complete === false) return (hasValue || hasPartial) ? 'partial' : 'missing';
  return hasValue ? 'ok' : (hasPartial ? 'partial' : 'missing');
}

export function resolveTotalDisciplineStatuses(row = {}) {
  // Per-discipline flags decide. A row eliminated as a whole with no flag set
  // (an older archive snapshot) marks dressage and marathon as before, so the
  // total's ELIM is never shown with no discipline marked. Team scores do not
  // depend on this: an eliminated member counts in no discipline (see
  // teamCalculationService, TR V 510.2 / FEI).
  const anyPhaseFlag = row?.dressage?.eliminated === true
    || row?.marathon?.eliminated === true
    || row?.precision?.eliminated === true;
  const legacyElim = !anyPhaseFlag && row?.isEliminated === true;
  const dressageElim = Boolean(row?.dressage?.eliminated) || legacyElim;
  const marathonElim = Boolean(row?.marathon?.eliminated) || legacyElim;
  const precisionElim = Boolean(row?.precision?.eliminated);

  const dressageStatus = dressageElim
    ? 'elim'
    : phaseStatus(row.dressageComplete, row?.dressage?.penalty != null || row?.dressage?.percentAvg != null);

  const marathonStatus = marathonElim
    ? 'elim'
    : phaseStatus(
      row.marathonComplete,
      row?.marathon?.totalPenalty != null,
      Object.values(row?.marathon?.stages || {}).some(stage => stage?.timePenalty != null)
        || row?.marathon?.obstacles?.sum != null
        || row?.marathon?.timePenalty != null
        || row?.marathon?.obstaclePenalty != null
    );

  const precisionStatus = precisionElim
    ? 'elim'
    : phaseStatus(row.precisionComplete, row?.precision?.pen != null);

  return {
    dressageStatus,
    marathonStatus,
    precisionStatus
  };
}

export function applyTotalDisciplineStatuses(rows = []) {
  rows.forEach((row) => {
    Object.assign(row, resolveTotalDisciplineStatuses(row));
  });
  return rows;
}

export function getMarathonPenaltyBreakdown(marathon = {}) {
  const stageTimePenalty = Object.values(marathon.stages || {})
    .reduce((sum, stage) => sum + (Number.isFinite(stage?.timePenalty) ? stage.timePenalty : 0), 0);
  const obstacleItems = Array.isArray(marathon?.obstacles?.items) ? marathon.obstacles.items : [];
  const obstacleTimePenalty = obstacleItems
    .reduce((sum, item) => sum + (Number.isFinite(item?.timePenalty) ? item.timePenalty : 0), 0);
  const knockdownPenalty = obstacleItems
    .reduce((sum, item) => sum + (Number(item?.knockdownPenalty ?? item?.knockDownPenalty) || 0), 0);
  const otherObstaclePenalty = obstacleItems
    .reduce((sum, item) => sum + (Number(item?.otherPenalty) || 0), 0);

  return {
    stageTimePenalty,
    obstacleTimePenalty,
    knockdownPenalty,
    otherObstaclePenalty,
    obstaclePenalty: Number.isFinite(marathon?.obstacles?.sum) ? marathon.obstacles.sum : null
  };
}
