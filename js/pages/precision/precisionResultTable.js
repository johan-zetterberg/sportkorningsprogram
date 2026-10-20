import { escapeHtml } from '../../utils/sharedUtils.js';

const SORT_ICON_HTML = '<span class="ml-1 inline-block align-middle sort-icon"></span>';

// labels.roundHeads: extra round columns after the total ("Fas 2", "Omkörning")
export function renderPrecisionTableHead(labels = {}) {
  const thClass = 'px-2 py-2 lg:px-3 lg:py-3 text-left text-xs lg:text-xs font-medium text-gray-600 dark:text-gray-300 uppercase cursor-pointer bg-white dark:bg-gray-800';
  const thNoClass = 'px-2 py-2 lg:px-3 lg:py-3 text-left text-xs lg:text-xs font-medium text-gray-600 dark:text-gray-300 uppercase bg-white dark:bg-gray-800';

  return `<thead><tr>
        <th data-col="place" class="${thClass}">${labels.rank} ${SORT_ICON_HTML}</th>
        <th data-col="startNumber" class="${thClass} sticky-col-start bg-gray-50 dark:bg-gray-700"># ${SORT_ICON_HTML}</th>
        <th data-col="driverName" class="${thClass} sticky-col-driver bg-gray-50 dark:bg-gray-700">${labels.driver} ${SORT_ICON_HTML}</th>
        <th data-col="className" class="${thClass}">${labels.className} ${SORT_ICON_HTML}</th>
        <th class="${thNoClass}">${labels.countryClub}</th>
        <th data-col="startTime" class="${thClass}">${labels.startTime} ${SORT_ICON_HTML}</th>
        <th data-col="portWidth" class="${thClass}">${labels.obstacleWidth} ${SORT_ICON_HTML}</th>
        <th data-col="time" class="${thClass}">${labels.time} ${SORT_ICON_HTML}</th>
        <th data-col="knocks" class="${thClass}">${labels.knockdowns} ${SORT_ICON_HTML}</th>
        <th data-col="obstacle" class="${thClass}">${labels.obsPenalty} ${SORT_ICON_HTML}</th>
        <th data-col="timePenalty" class="${thClass}">${labels.timePenalty} ${SORT_ICON_HTML}</th>
        <th data-col="extra" class="${thClass}">${labels.otherPenaltyShort} ${SORT_ICON_HTML}</th>
        <th data-col="penalty" class="${thClass}">${labels.total} ${SORT_ICON_HTML}</th>
        ${(labels.roundHeads || []).map(head => `<th class="${thNoClass}" data-round-head="${escapeHtml(head.round)}">${escapeHtml(head.label)}</th>`).join('')}
        <th data-col="overall" class="${thClass}">${labels.overallStanding} ${SORT_ICON_HTML}</th>
        <th data-col="status" class="${thClass}">${labels.status} ${SORT_ICON_HTML}</th>
        <th class="${thNoClass}">${labels.finalColumn}</th>
    </tr></thead>`;
}

export function renderPrecisionGroupHeader(label, colspan = 16) {
  return `<tr class="bg-gray-200 dark:bg-gray-700 border-t-2 border-b-2 border-gray-300 dark:border-gray-600 sticky top-0 z-10"><td class="px-3 py-2 font-bold text-gray-800 dark:text-gray-200" colspan="${colspan}">${escapeHtml(label)}</td></tr>`;
}

// A separator between placing tiers inside a class ("Fas 2", "Endast fas 1")
export function renderPrecisionTierHeader(label, colspan = 16) {
  return `<tr class="precision-tier-header bg-gray-100 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-600"><td class="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-300" colspan="${colspan}">${escapeHtml(label)}</td></tr>`;
}

export function renderPrecisionTable({ headHtml, bodyHtml }) {
  return `<table id="precisionTable" class="pr-table pr-alt">${headHtml}<tbody id="precisionBody">${bodyHtml}</tbody></table>`;
}
