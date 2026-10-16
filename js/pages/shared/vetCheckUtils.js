export const VET_STATUS_PRIORITY = {
  ombesiktning: 0,
  incheckad: 1,
  'anmäld': 2,
  besiktigad: 3,
  struken: 4
};

export const VET_PHASES = {
  initial: {
    id: 'initial',
    label: 'Förbesiktning',
    shortLabel: 'Förbesiktning',
    trRule: 'TR Mom 526.1 / FEI Art 948.1',
    desc: 'Vid ankomst / före dressyr. Mönstring vid hand, ID och temp.'
  },
  harness: {
    id: 'harness',
    label: 'Selningskontroll',
    shortLabel: 'Selning',
    trRule: 'TR Mom 526.3 / FEI Art 948.2',
    desc: 'Före start i maraton. Seldon, bett, vagn och utrustning.'
  },
  restArea: {
    id: 'restArea',
    label: 'Vilobox (Maraton)',
    shortLabel: 'Vilobox',
    trRule: 'TR Mom 526.4 / FEI Art 948.3',
    desc: '10 min obligatorisk vila mellan A/T och B. Puls och andning.'
  },
  final: {
    id: 'final',
    label: 'Slutbesiktning',
    shortLabel: 'Slutbesiktning',
    trRule: 'TR Mom 526.5 / FEI Art 948.4',
    desc: 'Före precision. Säkerställer att hästen är i fullgott skick efter maraton.'
  }
};

export const MAX_RECOMMENDED_PULSE_BPM = 64;

export function normalizeVetStatus(status) {
  const value = String(status || 'anmäld').trim().toLowerCase();
  if (['withdrawn', 'scratched', 'struken'].includes(value)) return 'struken';
  if (['reinspection', 're-inspection', 'ombesiktning'].includes(value)) return 'ombesiktning';
  if (['approved', 'passed', 'godkänd'].includes(value)) return 'godkänd';
  if (['registered', 'entered', 'anmäld'].includes(value)) return 'anmäld';
  return value;
}

export function getHorseVetStatus(horse = {}) {
  return normalizeVetStatus(horse.vetStatus || horse.inspectionStatus || horse.status || '');
}

export function getHorseStableKey(horse = {}, index = 0) {
  return String(
    horse.id
    || horse.uid
    || horse.chipNumber
    || horse.chip
    || horse.lic
    || horse.license
    || horse.name
    || horse.horseName
    || index
  );
}

export function getHorsePhaseInspection(horse = {}, phase = 'initial') {
  if (phase === 'initial') {
    const directStatus = getHorseVetStatus(horse);
    const stored = horse.inspections?.[phase] || {};
    return {
      status: normalizeVetStatus(stored.status || directStatus),
      checkedAt: stored.checkedAt || horse.vetCheckedAt || null,
      ...stored
    };
  }
  return horse.inspections?.[phase] || {
    status: 'anmäld',
    checkedAt: null
  };
}

export function isPulseWarning(pulse) {
  const bpm = Number(pulse);
  return Number.isFinite(bpm) && bpm > MAX_RECOMMENDED_PULSE_BPM;
}

/**
 * keepWithdrawn: an equipage withdrawn as a whole (status 'struken', e.g. by
 * the secretariat) stays withdrawn in every phase. The vet's own write passes
 * false when the withdrawal was the vet's (a horse was struck): undoing it
 * then gives the status the horses have.
 */
export function deriveVetStatusFromHorses(horses = [], fallbackStatus = 'anmäld', phase = 'initial', { keepWithdrawn = true } = {}) {
  const list = Array.isArray(horses) ? horses : [];
  const withdrawn = normalizeVetStatus(fallbackStatus) === 'struken';
  if (withdrawn && keepWithdrawn) return 'struken';
  const normalizedFallback = withdrawn ? 'anmäld' : normalizeVetStatus(fallbackStatus);
  if (!list.length) return phase === 'initial' ? normalizedFallback : 'anmäld';

  const statuses = list.map(horse => {
    if (phase === 'initial') return getHorseVetStatus(horse);
    const pData = horse.inspections?.[phase] || horse.phases?.[phase];
    return normalizeVetStatus(pData?.status || 'anmäld');
  });

  if (statuses.some(status => status === 'struken')) return 'struken';
  if (statuses.some(status => status === 'ombesiktning')) return 'ombesiktning';
  if (statuses.every(status => status === 'besiktigad')) return 'besiktigad';
  if (statuses.some(status => status === 'incheckad')) return 'incheckad';
  return phase === 'initial' ? normalizedFallback : 'anmäld';
}

/** Whether the vet struck a horse in the first inspection (the equipage's
 *  'struken' then comes from the vet, not from a withdrawal) */
export function hasVetStruckHorse(horses = []) {
  return (Array.isArray(horses) ? horses : []).some(horse => getHorseVetStatus(horse) === 'struken');
}

export function updateHorseVetStatus(horses = [], horseKey, status) {
  const key = String(horseKey || '');
  return (Array.isArray(horses) ? horses : []).map((horse, index) => {
    if (getHorseStableKey(horse, index) !== key) return horse;
    const nowIso = new Date().toISOString();
    return {
      ...horse,
      vetStatus: normalizeVetStatus(status),
      vetCheckedAt: nowIso,
      inspections: {
        ...(horse.inspections || {}),
        initial: {
          ...(horse.inspections?.initial || {}),
          status: normalizeVetStatus(status),
          checkedAt: nowIso
        }
      }
    };
  });
}

export function updateHorsePhaseInspection(horses = [], horseKey, phase = 'initial', updateData = {}) {
  const key = String(horseKey || '');
  return (Array.isArray(horses) ? horses : []).map((horse, index) => {
    if (getHorseStableKey(horse, index) !== key) return horse;
    const nowIso = new Date().toISOString();
    const currentPhaseData = horse.inspections?.[phase] || {};
    const newPhaseData = {
      ...currentPhaseData,
      ...updateData,
      checkedAt: nowIso
    };
    if (updateData.status) {
      newPhaseData.status = normalizeVetStatus(updateData.status);
    }
    const updatedHorse = {
      ...horse,
      inspections: {
        ...(horse.inspections || {}),
        [phase]: newPhaseData
      }
    };
    if (phase === 'initial' && updateData.status) {
      updatedHorse.vetStatus = normalizeVetStatus(updateData.status);
      updatedHorse.vetCheckedAt = nowIso;
    }
    return updatedHorse;
  });
}

export function sortVetEquipages(equipages = [], phase = 'initial') {
  return [...(equipages || [])].sort((a, b) => {
    const statusA = deriveVetStatusFromHorses(a?.horses, a?.status, phase);
    const statusB = deriveVetStatusFromHorses(b?.horses, b?.status, phase);
    const priorityA = VET_STATUS_PRIORITY[statusA] ?? VET_STATUS_PRIORITY['anmäld'];
    const priorityB = VET_STATUS_PRIORITY[statusB] ?? VET_STATUS_PRIORITY['anmäld'];
    if (priorityA !== priorityB) return priorityA - priorityB;
    return Number(a?.startNumber || 0) - Number(b?.startNumber || 0);
  });
}

export function getVetRemainingCount(equipages = [], phase = 'initial') {
  return (equipages || []).filter(eq => {
    const status = deriveVetStatusFromHorses(eq?.horses, eq?.status, phase);
    return status !== 'besiktigad' && status !== 'struken';
  }).length;
}

export function getVetSearchStartNumber(searchTerm = '') {
  const match = String(searchTerm || '').trim().match(/^(\d+)\s*-/);
  return match ? match[1] : '';
}

export function filterVetEquipages(equipages = [], searchTerm = '', phase = 'initial') {
  const term = String(searchTerm || '').trim().toLowerCase();
  if (!term) return sortVetEquipages(equipages, phase);

  const jumpStartNumber = getVetSearchStartNumber(term);
  const cleanTerm = jumpStartNumber || (term.includes('-') ? term.split('-')[0].trim() : term);

  return sortVetEquipages((equipages || []).filter(eq => {
    const horseNames = Array.isArray(eq?.horses)
      ? eq.horses.map(h => h?.name || h?.horseName || '').join(' ')
      : '';
    const haystack = [
      eq?.startNumber,
      eq?.driverName,
      eq?.clubName,
      eq?.className,
      horseNames
    ].join(' ').toLowerCase();
    return haystack.includes(cleanTerm);
  }), phase);
}

export function buildVetDatalistOptions(equipages = [], phase = 'initial') {
  return sortVetEquipages(equipages, phase).map(eq => ({
    value: `${eq.startNumber} - ${eq.driverName || ''}`.trim(),
    startNumber: String(eq.startNumber)
  }));
}

export function resolveVetFilteredState(equipages = [], searchTerm = '', phase = 'initial') {
  const jumpStartNumber = getVetSearchStartNumber(searchTerm);
  if (jumpStartNumber) {
    const sorted = sortVetEquipages(equipages, phase);
    const index = sorted.findIndex(eq => String(eq.startNumber) === jumpStartNumber);
    if (index !== -1) return { filtered: sorted, index, clearSearch: true };
  }

  return {
    filtered: filterVetEquipages(equipages, searchTerm, phase),
    index: 0,
    clearSearch: false
  };
}

export function getViloboxBadgeInfo(equipage = {}) {
  const horses = Array.isArray(equipage.horses) ? equipage.horses : [];
  const status = deriveVetStatusFromHorses(horses, equipage.status, 'restArea');
  if (status === 'besiktigad') {
    return { status: 'approved', label: 'Godkänd för B', colorClass: 'bg-emerald-100 text-emerald-800 border-emerald-300' };
  }
  if (status === 'ombesiktning') {
    return { status: 'hold', label: 'Ombesiktning', colorClass: 'bg-amber-100 text-amber-800 border-amber-300' };
  }
  if (status === 'struken') {
    return { status: 'unfit', label: 'Startförbud B', colorClass: 'bg-rose-100 text-rose-800 border-rose-300' };
  }
  return { status: 'waiting', label: 'Väntar', colorClass: 'bg-gray-100 text-gray-700 border-gray-300' };
}
