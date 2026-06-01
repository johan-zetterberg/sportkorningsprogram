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
    plac: null
  };
}

export function resolveTotalDisciplineStatuses(row = {}) {
  const dressageStatus = row.isEliminated
    ? 'elim'
    : ((row?.dressage?.penalty != null || row?.dressage?.percentAvg != null) ? 'ok' : 'missing');

  const marathonStatus = row.isEliminated
    ? 'elim'
    : (row?.marathon?.totalPenalty != null
      ? 'ok'
      : ((row?.marathon?.timePenalty != null || row?.marathon?.obstaclePenalty != null) ? 'partial' : 'missing'));

  const precisionStatus = row?.precision?.eliminated
    ? 'elim'
    : (row?.precision?.pen != null ? 'ok' : 'missing');

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
