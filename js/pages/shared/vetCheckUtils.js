export const VET_STATUS_PRIORITY = {
  ombesiktning: 0,
  incheckad: 1,
  'anmäld': 2,
  besiktigad: 3,
  struken: 4
};

export function normalizeVetStatus(status) {
  return String(status || 'anmäld').trim().toLowerCase();
}

export function sortVetEquipages(equipages = []) {
  return [...(equipages || [])].sort((a, b) => {
    const statusA = normalizeVetStatus(a?.status);
    const statusB = normalizeVetStatus(b?.status);
    const priorityA = VET_STATUS_PRIORITY[statusA] ?? VET_STATUS_PRIORITY['anmäld'];
    const priorityB = VET_STATUS_PRIORITY[statusB] ?? VET_STATUS_PRIORITY['anmäld'];
    if (priorityA !== priorityB) return priorityA - priorityB;
    return Number(a?.startNumber || 0) - Number(b?.startNumber || 0);
  });
}

export function getVetRemainingCount(equipages = []) {
  return (equipages || []).filter(eq => {
    const status = normalizeVetStatus(eq?.status);
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
