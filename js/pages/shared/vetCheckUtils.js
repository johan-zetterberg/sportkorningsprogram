export const VET_STATUS_PRIORITY = {
  ombesiktning: 0,
  incheckad: 1,
  'anmäld': 2,
  besiktigad: 3,
  struken: 4
};

export function normalizeVetStatus(status) {
  const value = String(status || 'anmäld').trim().toLowerCase();
  if (value === 'anmÃ¤ld' || value === 'anmÃƒÂ¤ld') return 'anmäld';
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

export function deriveVetStatusFromHorses(horses = [], fallbackStatus = 'anmäld') {
  const list = Array.isArray(horses) ? horses : [];
  if (!list.length) return normalizeVetStatus(fallbackStatus);

  const statuses = list.map(getHorseVetStatus);
  if (statuses.some(status => status === 'struken')) return 'struken';
  if (statuses.some(status => status === 'ombesiktning')) return 'ombesiktning';
  if (statuses.every(status => status === 'besiktigad')) return 'besiktigad';
  return normalizeVetStatus(fallbackStatus);
}

export function updateHorseVetStatus(horses = [], horseKey, status) {
  const key = String(horseKey || '');
  return (Array.isArray(horses) ? horses : []).map((horse, index) => {
    if (getHorseStableKey(horse, index) !== key) return horse;
    return {
      ...horse,
      vetStatus: normalizeVetStatus(status),
      vetCheckedAt: new Date().toISOString()
    };
  });
}

export function sortVetEquipages(equipages = []) {
  return [...(equipages || [])].sort((a, b) => {
    const statusA = deriveVetStatusFromHorses(a?.horses, a?.status);
    const statusB = deriveVetStatusFromHorses(b?.horses, b?.status);
    const priorityA = VET_STATUS_PRIORITY[statusA] ?? VET_STATUS_PRIORITY['anmäld'];
    const priorityB = VET_STATUS_PRIORITY[statusB] ?? VET_STATUS_PRIORITY['anmäld'];
    if (priorityA !== priorityB) return priorityA - priorityB;
    return Number(a?.startNumber || 0) - Number(b?.startNumber || 0);
  });
}

export function getVetRemainingCount(equipages = []) {
  return (equipages || []).filter(eq => {
    const status = deriveVetStatusFromHorses(eq?.horses, eq?.status);
    return status !== 'besiktigad' && status !== 'struken';
  }).length;
}

export function getVetSearchStartNumber(searchTerm = '') {
  const match = String(searchTerm || '').trim().match(/^(\d+)\s*-/);
  return match ? match[1] : '';
}

export function filterVetEquipages(equipages = [], searchTerm = '') {
  const term = String(searchTerm || '').trim().toLowerCase();
  if (!term) return sortVetEquipages(equipages);

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
  }));
}

export function buildVetDatalistOptions(equipages = []) {
  return sortVetEquipages(equipages).map(eq => ({
    value: `${eq.startNumber} - ${eq.driverName || ''}`.trim(),
    startNumber: String(eq.startNumber)
  }));
}

export function resolveVetFilteredState(equipages = [], searchTerm = '') {
  const jumpStartNumber = getVetSearchStartNumber(searchTerm);
  if (jumpStartNumber) {
    const sorted = sortVetEquipages(equipages);
    const index = sorted.findIndex(eq => String(eq.startNumber) === jumpStartNumber);
    if (index !== -1) return { filtered: sorted, index, clearSearch: true };
  }

  return {
    filtered: filterVetEquipages(equipages, searchTerm),
    index: 0,
    clearSearch: false
  };
}

