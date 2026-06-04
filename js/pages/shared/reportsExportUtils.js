import {
  formatMarathonExternalOtherPenalty,
  formatMarathonPenaltyExportValue
} from '../../utils/marathonExportUtils.js';

const DRESSAGE_JUDGE_POSITION_ORDER = {
  C: 0,
  E: 1,
  B: 2,
  H: 3,
  M: 4,
  R: 5,
  S: 6,
  V: 7,
  P: 8
};

export function getReportDisplayClass(row = {}) {
  return row._mergedLabel || row.mergedTestLabel || row.className || '';
}

export function getReportClassOptions(rows = []) {
  return [...new Set(rows.map(getReportDisplayClass).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'sv'));
}

export function filterReportData({ rows = [], equipages = [], filterClass = '' } = {}) {
  const sourceRows = rows.length ? rows : equipages;
  if (!filterClass) return { rows: sourceRows, eqs: sourceRows };

  const filteredRows = sourceRows.filter(row => getReportDisplayClass(row) === filterClass);
  if (rows.length) return { rows: filteredRows, eqs: filteredRows };

  return {
    rows: filteredRows,
    eqs: equipages.filter(row => getReportDisplayClass(row) === filterClass)
  };
}

export function getReportHorseNames(row = {}) {
  if (Array.isArray(row.horses)) {
    return row.horses
      .map(horse => typeof horse === 'string' ? horse : (horse?.name || horse?.horseName || horse?.namn || ''))
      .filter(Boolean)
      .join(', ');
  }
  if (Array.isArray(row.horseNames)) return row.horseNames.filter(Boolean).join(', ');
  return row.horseName || row.horse || '';
}

export function formatReportCsvPenalty(value, {
  eliminated = false,
  empty = '',
  decimals = 2
} = {}) {
  if (eliminated || value === Infinity) return 'ELIM';
  if (typeof value === 'number' && Number.isFinite(value)) return value.toFixed(decimals).replace('.', ',');
  return empty;
}

export function formatReportCsvPercent(value, { eliminated = false, empty = '' } = {}) {
  if (eliminated) return 'ELIM';
  if (typeof value === 'number' && Number.isFinite(value)) return `${value.toFixed(2).replace('.', ',')}%`;
  return empty;
}

export function buildDressageCsvExport(rows = [], {
  filename = 'dressyr_resultat.csv',
  empty = '—'
} = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const judgePositions = [...new Set(safeRows.flatMap((row) => (
    Object.values(row?.dressage?.judges || {})
      .map((judge) => String(judge?.position || '').trim().toUpperCase())
      .filter(Boolean)
  )))].sort((a, b) => {
    const orderA = DRESSAGE_JUDGE_POSITION_ORDER[a] ?? 99;
    const orderB = DRESSAGE_JUDGE_POSITION_ORDER[b] ?? 99;
    if (orderA !== orderB) return orderA - orderB;
    return a.localeCompare(b, 'sv');
  });

  const headers = ['StartNr', 'Kusk', 'Klass', 'Häst'];
  judgePositions.forEach((position) => headers.push(`Domare ${position}`));
  headers.push('Straff', 'Procent');

  const exportRows = safeRows.map((row) => {
    const dressage = row?.dressage || {};
    const judges = Object.values(dressage?.judges || {});
    const exportRow = [
      row?.startNumber ?? '',
      row?.driverName ?? '',
      getReportDisplayClass(row),
      getReportHorseNames(row)
    ];

    judgePositions.forEach((position) => {
      const judge = judges.find((item) => String(item?.position || '').trim().toUpperCase() === position);
      if (judge?.eliminated) {
        exportRow.push('ELIM');
      } else if (typeof judge?.totalPoints === 'number' && Number.isFinite(judge.totalPoints)) {
        exportRow.push(judge.totalPoints.toFixed(1).replace('.', ','));
      } else {
        exportRow.push(empty);
      }
    });

    exportRow.push(
      formatReportCsvPenalty(dressage?.penalty, { eliminated: dressage?.eliminated }),
      formatReportCsvPercent(dressage?.percent, { eliminated: dressage?.eliminated })
    );
    return exportRow;
  });

  return {
    filename,
    headers,
    rows: exportRows
  };
}

export function buildMarathonCsvExport(rows = [], {
  filename = 'maraton_resultat.csv',
  maxObstacleCount = null,
  empty = ''
} = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];

  const getObstacleItems = (row, marathon) => {
    if (Array.isArray(row?._csvObstacleItems) && row._csvObstacleItems.length) return row._csvObstacleItems;
    if (Array.isArray(marathon?.obstacles?.items) && marathon.obstacles.items.length) return marathon.obstacles.items;
    if (Array.isArray(row?.obstacles) && row.obstacles.length) return row.obstacles;
    return [];
  };

  const getObstacleNumber = (obstacle) => Number(
    obstacle?.number
    ?? obstacle?.obstacleNumber
    ?? obstacle?.nr
    ?? obstacle?.hinderNr
  );

  const getObstaclePenalty = (obstacle) => {
    const value = Number(obstacle?.penalty);
    return Number.isFinite(value) ? value : null;
  };

  let maxObstacles = 0;
  safeRows.forEach((row) => {
    const marathon = row?.marathon || row?.results?.marathon || {};
    const items = getObstacleItems(row, marathon);
    items.forEach((obstacle) => {
      const number = getObstacleNumber(obstacle);
      if (Number.isFinite(number) && number > maxObstacles) maxObstacles = number;
    });
  });
  if (Number.isFinite(Number(maxObstacleCount)) && Number(maxObstacleCount) > maxObstacles) {
    maxObstacles = Number(maxObstacleCount);
  }

  const headers = [
    'StartNr',
    'Kusk',
    'Klass',
    'Häst',
    'Straff A',
    'Straff T',
    'Straff B'
  ];

  for (let i = 1; i <= maxObstacles; i += 1) {
    headers.push(`H${i}`);
  }

  headers.push('Hinderstraff', 'Övrigt', 'Totalt');

  const exportRows = safeRows.map((row) => {
    const marathon = row?.marathon || row?.results?.marathon || {};
    const obstacleItems = getObstacleItems(row, marathon);
    const exportRow = [
      row?.startNumber ?? '',
      row?.driverName ?? '',
      getReportDisplayClass(row),
      getReportHorseNames(row),
      formatMarathonPenaltyExportValue(marathon?.stages?.A?.timePenalty, { equipage: row, marathonResult: marathon, empty }),
      formatMarathonPenaltyExportValue(marathon?.stages?.transport?.timePenalty, { equipage: row, marathonResult: marathon, empty }),
      formatMarathonPenaltyExportValue(marathon?.stages?.B?.timePenalty, { equipage: row, marathonResult: marathon, empty })
    ];

    for (let i = 1; i <= maxObstacles; i += 1) {
      const obstacle = obstacleItems.find((item) => getObstacleNumber(item) === i);
      const obstaclePenalty = getObstaclePenalty(obstacle);

      if (obstacle?.eliminated) {
        exportRow.push('ELIM');
      } else if (Number.isFinite(obstaclePenalty)) {
        exportRow.push(obstaclePenalty.toFixed(2));
      } else {
        exportRow.push(empty);
      }
    }

    const fallbackObstacleSum = obstacleItems.reduce((sum, obstacle) => {
      const penalty = getObstaclePenalty(obstacle);
      return sum + (Number.isFinite(penalty) ? penalty : 0);
    }, 0);
    const obstacleTotal = Number.isFinite(Number(marathon?.obstacles?.sum))
      ? Number(marathon.obstacles.sum)
      : (fallbackObstacleSum > 0 ? fallbackObstacleSum : null);

    exportRow.push(
      formatMarathonPenaltyExportValue(obstacleTotal, { equipage: row, marathonResult: marathon, empty }),
      formatMarathonExternalOtherPenalty(marathon, { equipage: row, marathonResult: marathon, empty }),
      formatMarathonPenaltyExportValue(marathon?.totalPenalty, { equipage: row, marathonResult: marathon, empty })
    );

    return exportRow;
  });

  return {
    filename,
    headers,
    rows: exportRows
  };
}
