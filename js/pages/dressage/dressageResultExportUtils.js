export function stripDressageCsvHtml(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

export function formatDressageCsvScore(value, {
  eliminated = false,
  decimals = 2,
  empty = '-'
} = {}) {
  if (eliminated) return 'ELIM';
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(decimals) : empty;
}

export function formatDressageCsvStatus(result = {}, statusHtml = '') {
  if (result.eliminated) return 'ELIM';
  return stripDressageCsvHtml(statusHtml) || '-';
}
