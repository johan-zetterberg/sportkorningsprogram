import { getObstacleArray } from '../../utils/marathonUtils.js';

export function normalizeMarathonEquipage(e) {
  const startNumber =
    Number(e?.startNumber ?? e?.startnr ?? e?.nr ?? e?.start ?? e?.startNo ?? e?.bib ?? 0);
  const driverName =
    e?.driverName ?? e?.driver ?? e?.name ?? e?.kusk ?? '';
  const className =
    e?.className ?? e?.class ?? e?.klass ?? '';
  return { ...e, startNumber, driverName, className };
}

export function getMaxObstacleNoFromMap(marathonMap) {
  let maxN = 0;
  marathonMap.forEach(d => {
    const arr = getObstacleArray(d);
    arr.forEach(o => {
      const nr = Number(o?.number ?? o?.no ?? o?.nr ?? o?.hinderNr);
      if (Number.isFinite(nr)) maxN = Math.max(maxN, nr);
    });
  });
  if (maxN <= 0) maxN = 6;
  return Math.min(maxN, 8);
}

export function calculateMarathonDateStr(startTimes) {
  const dateCounts = {};
  Object.values(startTimes || {}).forEach(timeEntry => {
    const marathonTime = timeEntry?.marathon || timeEntry?.maraton;
    if (marathonTime) {
      const datePart = marathonTime.split('T')[0];
      if (datePart) dateCounts[datePart] = (dateCounts[datePart] || 0) + 1;
    }
  });

  let mostCommonDate = null;
  let maxCount = 0;
  for (const date in dateCounts) {
    if (dateCounts[date] > maxCount) {
      maxCount = dateCounts[date];
      mostCommonDate = date;
    }
  }

  if (mostCommonDate) {
    return new Date(mostCommonDate).toLocaleDateString('sv-SE', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }
  return '';
}
