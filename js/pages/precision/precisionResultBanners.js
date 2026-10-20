// Banners above the precision result list: a drive-off still to be driven
// (places are provisional) and warnings from the result engine (ignored
// phase-2 / drive-off data, missing course settings, TR drive-off variant).
import { escapeHtml } from '../../utils/sharedUtils.js';
import { t } from '../../utils/i18n.js';
import { bannerStartNumbersLabel } from './precisionRoundsDisplay.js';

/** Items from buildPrecisionBannerItems; '' when there is nothing to say */
export function renderPrecisionBanners(items = [], { tr = t } = {}) {
  if (!items.length) return '';
  const pending = items.filter((item) => item.kind === 'pending');
  const warnings = items.filter((item) => item.kind === 'warning');
  const pendingHtml = pending.length
    ? `<div class="precision-banner-pending mb-3 rounded-lg border border-blue-300 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-100" role="status">
        <div class="font-semibold">${escapeHtml(tr('precision_provisional_banner'))}: ${pending.map((item) => escapeHtml(item.label)).join(', ')}</div>
        <div class="text-xs">${escapeHtml(tr('precision_provisional_note'))}</div>
      </div>`
    : '';
  const warningHtml = warnings.length
    ? `<div class="precision-banner-warnings mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-100" role="note">
        ${warnings.map((item) => `<div><strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(item.text)}${escapeHtml(bannerStartNumbersLabel(item))}</div>`).join('')}
      </div>`
    : '';
  return pendingHtml + warningHtml;
}
