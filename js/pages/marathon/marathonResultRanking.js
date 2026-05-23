import { isNum } from '../../utils/sharedUtils.js';
import { safeLower } from './marathonResultFormatters.js';

export function isFinalizedMarathonDoc(d) {
  return d?.finalized === true || d?.status === 'finalized' || d?.isFinal === true;
}

export function matchesMarathonSearch(eq, searchQuery) {
  if (!searchQuery) return true;
  const q = safeLower(searchQuery);
  const sn = String(eq.startNumber);
  if (sn.includes(q)) return true;
  if (safeLower(eq.driverName).includes(q)) return true;
  if (safeLower(eq.className).includes(q)) return true;
  if (safeLower(eq._mergedLabel || '').includes(q)) return true;
  const horses = Array.isArray(eq.horses)
    ? eq.horses.map(h => h?.name || h).join(' ')
    : (eq.horse || '');
  return safeLower(horses).includes(q);
}

export function buildMarathonPlacementsByClass({
  equipages,
  marathonMap,
  timingDocFor,
  calculateResult
}) {
  const byGroup = {};
  const map = new Map();

  for (const eq of equipages) {
    const sn = String(eq.startNumber);
    const d = marathonMap.get(sn) || {};
    const t = timingDocFor(sn);
    const res = calculateResult(eq, d, t);

    const finalized = isFinalizedMarathonDoc(d);
    const finished = res.status === 'Klar' || finalized;
    const tot = res.totalPenalty;

    if (!finished || !Number.isFinite(tot) || tot === Infinity) continue;

    const grpKey = eq._mergedKey || `CLS:${eq.className || 'Ok\u00e4nd klass'}`;
    (byGroup[grpKey] ||= []).push({ sn, tot, res });
  }

  for (const grpKey of Object.keys(byGroup)) {
    const arr = byGroup[grpKey];
    arr.sort((a, b) => {
      const diff = a.tot - b.tot;
      if (Math.abs(diff) > 1e-6) return diff;

      const obsPenDiff = (a.res.obstaclePenaltySum || 0) - (b.res.obstaclePenaltySum || 0);
      if (Math.abs(obsPenDiff) > 1e-6) return obsPenDiff;

      const aTimes = a.res.obstacleTimes || [];
      const bTimes = b.res.obstacleTimes || [];
      const maxLen = Math.max(aTimes.length, bTimes.length);
      for (let j = 0; j < maxLen; j++) {
        const ta = aTimes[j] || 0;
        const tb = bTimes[j] || 0;
        if (Math.abs(ta - tb) > 1e-6) return ta - tb;
      }

      return 0;
    });

    let place = 1;
    let prevTot = -1;
    let prevObsPen = -1;
    let prevTimes = null;

    arr.forEach((row, i) => {
      let isTie = false;
      if (prevTot !== -1) {
        const totTie = Math.abs(row.tot - prevTot) < 1e-6;
        const obsPenTie = Math.abs((row.res.obstaclePenaltySum || 0) - prevObsPen) < 1e-6;
        const rTimes = row.res.obstacleTimes || [];
        const pTimes = prevTimes || [];
        let timesTie = rTimes.length === pTimes.length;

        if (timesTie) {
          for (let j = 0; j < rTimes.length; j++) {
            if (Math.abs(rTimes[j] - pTimes[j]) > 1e-6) {
              timesTie = false;
              break;
            }
          }
        }

        if (totTie && obsPenTie && timesTie) {
          isTie = true;
        }
      }

      if (!isTie) {
        place = i + 1;
      }

      map.set(row.sn, place);
      prevTot = row.tot;
      prevObsPen = row.res.obstaclePenaltySum || 0;
      prevTimes = row.res.obstacleTimes || [];
    });
  }

  return map;
}

export function filterAndSortMarathonEquipages({
  equipages,
  searchQuery,
  activeClassFilters,
  showOnlyFinalized,
  showOnlyOnB,
  sortState,
  viewMode,
  marathonMap,
  isMarathonFinalized,
  calculateResult,
  timingDocFor,
  startTimeFor,
  placeMap
}) {
  let list = equipages.slice();

  list = list.filter(eq => matchesMarathonSearch(eq, searchQuery));

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(e =>
      String(e.startNumber).includes(q) ||
      (e.driverName || '').toLowerCase().includes(q) ||
      (e.className || '').toLowerCase().includes(q)
    );
  }

  list = list.filter(e => {
    const s = String(e.status || '').toLowerCase();
    return !['struken', 'withdrawn', 'scratched'].includes(s) && !e.struken && !e.withdrawn;
  });

  if (activeClassFilters.size > 0) {
    list = list.filter(e => activeClassFilters.has(e._mergedLabel || e.className));
  }

  if (showOnlyFinalized) {
    list = list.filter(e => isMarathonFinalized(e.startNumber));
  } else if (showOnlyOnB) {
    list = list.filter(eq => {
      const sn = String(eq.startNumber);
      const d = marathonMap.get(sn) || {};
      const res = calculateResult(eq, d, timingDocFor(sn));
      return res.status === 'P\u00e5g\u00e5r' || d.running === true;
    });
  }

  const key = sortState.key;
  const dir = sortState.dir === 'asc' ? 1 : -1;

  const getVal = (eq, k) => {
    const sn = String(eq.startNumber);
    const d = marathonMap.get(sn) || {};
    const res = calculateResult(eq, d, timingDocFor(sn));

    if (k === 'place') return placeMap.get(sn) || 9999;
    if (k === 'startNumber') return Number(eq.startNumber) || 0;
    if (k === 'driverName') return (eq.driverName || '').toLowerCase();
    if (k === 'className') return (eq._mergedLabel || eq.className || '').toLowerCase();
    if (k === 'clubName') return (eq.clubName || '').toLowerCase();
    if (k === 'startTime') return startTimeFor(sn) || '99:99';
    if (k === 'eta') {
      const eta = res.eta.B || res.eta.A;
      return eta ? new Date(eta).getTime() : 9999999999999;
    }
    if (k === 'live') return 0;
    if (k === 'obsSum') return isNum(res.obstacles.sum) ? res.obstacles.sum : 9999;
    if (k === 'otherPenalty') return isNum(res.otherPenalty) ? res.otherPenalty : 9999;
    if (k === 'totalPenalty') return (res.totalPenalty === Infinity) ? 99999 : (res.totalPenalty || 0);
    if (k === 'status') return res.status || '';

    if (k.startsWith('stage-')) {
      const st = k.split('stage-')[1];
      const p = res.stages[st]?.timePenalty;
      return isNum(p) ? p : 9999;
    }
    if (k.startsWith('obs-')) {
      const n = parseInt(k.split('obs-')[1]);
      const item = (res.obstacles.items || []).find(o => Number(o.number) === n);
      return (item && isNum(item.penalty)) ? Number(item.penalty) : 9999;
    }
    return 0;
  };

  list.sort((a, b) => {
    if (viewMode === 'byclass' && key === 'place') {
      const aLabel = safeLower(a._mergedLabel || a.className || '');
      const bLabel = safeLower(b._mergedLabel || b.className || '');
      const classCompare = aLabel.localeCompare(bLabel, 'sv');
      if (classCompare !== 0) return classCompare;
    }

    const va = getVal(a, key);
    const vb = getVal(b, key);

    if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb, 'sv') * dir;
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });

  return list;
}
