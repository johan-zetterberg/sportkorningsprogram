import { assignPlaces, compareDressageRank } from '../../core-engine/ranking.js';

function toFinitePenalty(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// Dressage placings: lowest penalty, equal penalties share the place.
export function rankDressageRows(rows = [], {
  penaltyPicker = (row) => row?.finalPenalty,
  eliminatedPicker = (row) => !!row?.eliminated,
  groupPicker = () => '',
  outputField = 'plac'
} = {}) {
  const { ranked } = assignPlaces(rows, {
    key: (row) => {
      const penalty = toFinitePenalty(penaltyPicker(row));
      return (eliminatedPicker(row) || penalty === null) ? null : { penalty };
    },
    compare: compareDressageRank,
    group: groupPicker,
    outField: outputField
  });
  return ranked;
}
