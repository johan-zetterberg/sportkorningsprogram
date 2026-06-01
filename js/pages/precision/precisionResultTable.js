const SORT_ICON_HTML = '<span class="ml-1 inline-block align-middle sort-icon"></span>';

export function renderPrecisionTableHead(labels = {}) {
  const thClass = 'px-2 py-2 lg:px-3 lg:py-3 text-left text-[10px] lg:text-xs font-medium text-gray-500 dark:text-gray-400 uppercase cursor-pointer bg-white dark:bg-gray-800';
  const thNoClass = 'px-2 py-2 lg:px-3 lg:py-3 text-left text-[10px] lg:text-xs font-medium text-gray-500 dark:text-gray-400 uppercase bg-white dark:bg-gray-800';

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
        <th data-col="overall" class="${thClass}">${labels.overallStanding} ${SORT_ICON_HTML}</th>
        <th data-col="status" class="${thClass}">${labels.status} ${SORT_ICON_HTML}</th>
        <th class="${thNoClass}">${labels.finalColumn}</th>
    </tr></thead>`;
}

export function renderPrecisionGroupHeader(label, colspan = 16) {
  return `<tr class="bg-gray-200 dark:bg-gray-700 border-t-2 border-b-2 border-gray-300 dark:border-gray-600 sticky top-0 z-10"><td class="px-3 py-2 font-bold text-gray-800 dark:text-gray-200" colspan="${colspan}">${label}</td></tr>`;
}

export function renderPrecisionTable({ headHtml, bodyHtml }) {
  return `<table id="precisionTable" class="pr-table pr-alt">${headHtml}<tbody id="precisionBody">${bodyHtml}</tbody></table>`;
}
