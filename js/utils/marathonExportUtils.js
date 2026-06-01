function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isWithdrawnMarathonExport(equipage = {}, marathonResult = {}) {
  const values = [equipage.status, marathonResult.status].map(value => String(value || '').toLowerCase());
  return values.some(value => value.includes('struken') || value.includes('withdrawn'));
}

export function formatMarathonPenaltyExportValue(value, {
  equipage = {},
  marathonResult = {},
  empty = '—',
  decimals = 2
} = {}) {
  if (isWithdrawnMarathonExport(equipage, marathonResult)) return 'STR';
  if (marathonResult.eliminated || value === Infinity) return 'ELIM';
  if (isFiniteNumber(value)) return value.toFixed(decimals);
  return empty;
}

export function getMarathonExternalOtherPenalty(marathonResult = {}) {
  const globalOther = Number(marathonResult.otherPenalty || 0);
  const wrongGait = Number(marathonResult.wgPenalty || 0);
  return globalOther + wrongGait;
}

export function formatMarathonExternalOtherPenalty(marathonResult = {}, options = {}) {
  return formatMarathonPenaltyExportValue(getMarathonExternalOtherPenalty(marathonResult), {
    marathonResult: options.marathonResult || {},
    ...options
  });
}

export function localizeCsvDecimal(value) {
  return String(value ?? '').replace('.', ',');
}
