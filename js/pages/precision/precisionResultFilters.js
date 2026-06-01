function normalizedText(value) {
  return String(value || '').toLowerCase();
}

export function isWithdrawnPrecisionEquipage(equipage) {
  const status = normalizedText(equipage?.status);
  return ['struken', 'withdrawn', 'scratched'].includes(status)
    || !!equipage?.struken
    || !!equipage?.withdrawn;
}

export function matchesPrecisionSearch(equipage, searchText = '') {
  const query = normalizedText(searchText).trim();
  if (!query) return true;

  return String(equipage?.startNumber || '').includes(query)
    || normalizedText(equipage?.driverName).includes(query)
    || normalizedText(equipage?.className).includes(query)
    || normalizedText(equipage?._mergedLabel).includes(query);
}

export function isFinalizedPrecisionEquipage(equipage, precisionMap = new Map()) {
  const result = precisionMap.get(String(equipage?.startNumber)) || {};
  return result.finalized === true && typeof result.totalPenalty === 'number' && Number.isFinite(result.totalPenalty);
}

export function isInActivePrecisionClassFilter(equipage, activeClassFilters = new Set()) {
  if (!activeClassFilters || activeClassFilters.size === 0) return true;
  return activeClassFilters.has(equipage?._mergedLabel || equipage?.className || '—');
}

export function filterPrecisionEquipages(equipages = [], options = {}) {
  const {
    searchText = '',
    showOnlyFinalized = false,
    activeClassFilters = new Set(),
    precisionMap = new Map()
  } = options;

  return (equipages || []).filter((equipage) => {
    if (!matchesPrecisionSearch(equipage, searchText)) return false;
    if (isWithdrawnPrecisionEquipage(equipage)) return false;
    if (showOnlyFinalized && !isFinalizedPrecisionEquipage(equipage, precisionMap)) return false;
    if (!isInActivePrecisionClassFilter(equipage, activeClassFilters)) return false;
    return true;
  });
}
