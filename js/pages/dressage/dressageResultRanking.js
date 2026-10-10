const DEFAULT_TOLERANCE = 0.0001;

function toFinitePenalty(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function rankDressageRows(rows = [], {
  penaltyPicker = (row) => row?.finalPenalty,
  eliminatedPicker = (row) => !!row?.eliminated,
  groupPicker = () => '',
  outputField = 'plac',
  tolerance = DEFAULT_TOLERANCE
} = {}) {
  const groups = new Map();
  rows.forEach((row) => {
    const groupKey = String(groupPicker(row) ?? '');
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(row);
    if (Object.hasOwn(row, outputField)) row[outputField] = null;
  });

  const sortedRankedRows = [];
  groups.forEach((groupRows) => {
    const rankableRows = groupRows
      .filter((row) => !eliminatedPicker(row) && toFinitePenalty(penaltyPicker(row)) !== null)
      .sort((a, b) => {
        const penaltyDiff = toFinitePenalty(penaltyPicker(a)) - toFinitePenalty(penaltyPicker(b));
        if (Math.abs(penaltyDiff) > tolerance) return penaltyDiff;
        return (Number(a.startNumber) || 0) - (Number(b.startNumber) || 0);
      });

    let place = 0;
    let previousPenalty = null;
    rankableRows.forEach((row, index) => {
      const penalty = toFinitePenalty(penaltyPicker(row));
      if (previousPenalty == null || Math.abs(penalty - previousPenalty) > tolerance) {
        place = index + 1;
      }
      row[outputField] = place;
      previousPenalty = penalty;
    });
    sortedRankedRows.push(...rankableRows);
  });

  return sortedRankedRows;
}
