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
    clubName: equipage.clubName || '',
    className: cls,
    country: equipage.country || equipage.nation || equipage.nationality || '',
    nation: equipage.nation || '',
    nationality: equipage.nationality || '',
    isPara: Boolean(equipage.isPara),
    paraGrade: equipage.paraGrade || '',
    displayGroupKey: group.key,
    displayGroupLabel: group.label,

    dressage: {
      penalty: dressage.judgePenalty,
      ...dressage
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
      pen: precision.totalPenalty
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
  const dressageStatus = row.isEliminated
    ? 'elim'
    : phaseStatus(row.dressageComplete, row?.dressage?.penalty != null || row?.dressage?.percentAvg != null);

  const marathonStatus = row.isEliminated
    ? 'elim'
    : phaseStatus(
      row.marathonComplete,
      row?.marathon?.totalPenalty != null,
      row?.marathon?.timePenalty != null || row?.marathon?.obstaclePenalty != null
    );

  const precisionStatus = row?.precision?.eliminated
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
