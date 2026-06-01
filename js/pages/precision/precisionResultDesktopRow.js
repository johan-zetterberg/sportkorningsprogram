function defaultFormatPenalty(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—';
}

export function renderPrecisionResultDesktopRow({
  data,
  index = 0,
  allowanceDisplay = '—',
  startTime = '',
  horseLabelHtml = '',
  flagHtml = '',
  clubLogoHtml = '',
  overallResult = null,
  statusBadgeClass = '',
  finalizeButtonsHtml = '',
  formatPenalty = defaultFormatPenalty
}) {
  const sn = String(data.eq.startNumber);
  const isStruken = data.eq.status === 'struken';
  const isActive = data.status && data.status.includes('Påg');

  let rowBgClass;
  if (isStruken) {
    rowBgClass = 'opacity-50 bg-red-50 dark:bg-red-900/10';
  } else if (isActive) {
    rowBgClass = 'bg-yellow-50 dark:bg-yellow-900/40 border-l-4 border-yellow-500 shadow-sm relative z-10';
  } else {
    rowBgClass = index % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-800/50';
  }

  const overTime = data.d?.finalized && typeof data.timePenalty === 'number' && Number.isFinite(data.timePenalty) && data.timePenalty > 0;
  const timeAlertCls = overTime ? 'text-red-600 dark:text-red-400 font-semibold' : '';
  const rowStyle = isActive ? 'border-left: 4px solid #eab308;' : '';
  const overallLabel = !overallResult
    ? '—'
    : (overallResult.total === Infinity ? 'ELIM' : `${formatPenalty(overallResult.total)} (${overallResult.rank})`);

  return `
           <tr class="${rowBgClass} hover:bg-blue-100 dark:hover:bg-gray-700 cursor-pointer text-gray-900 dark:text-gray-200" data-sn="${sn}" style="${rowStyle}">
                <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 font-semibold text-[11px] lg:text-sm">${data.place || '–'}</td>
                <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-[11px] lg:text-sm sticky-col-start ${rowBgClass || ''}">${data.eq.startNumber}</td>
                <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-left align-top sticky-col-driver ${rowBgClass || ''}">
                    <button type="button" class="text-xs lg:text-base font-bold text-gray-900 dark:text-white hover:text-blue-700 dark:hover:text-blue-400 hover:underline text-left transition-colors truncate block w-full" title="${data.eq.driverName}">${data.eq.driverName}</button>
                    <div class="hidden lg:block text-[10px] lg:text-xs text-gray-600 dark:text-gray-400 leading-tight whitespace-nowrap">${horseLabelHtml}</div>
                </td>
                <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-[11px] lg:text-sm"><div class="truncate max-w-[100px] lg:max-w-none" title="${data.eq._mergedLabel || data.eq.className || ''}">${data.eq._mergedLabel || data.eq.className}</div></td>
                <td class="px-2 py-1.5 lg:px-3 lg:py-2.5">
                    <div class="flex items-center gap-2">
                        ${flagHtml} ${clubLogoHtml} <span class="truncate max-w-[80px] lg:max-w-[120px] text-[11px] lg:text-sm" title="${data.eq.clubName || ''}">${data.eq.clubName || ''}</span>
                    </div>
                </td>
                <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-[11px] lg:text-sm whitespace-nowrap">${startTime}</td>
                <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-[11px] lg:text-sm whitespace-nowrap">${allowanceDisplay}</td>
                <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 time-cell align-top" data-sn="${sn}">
                    <span class="tabular-nums ${timeAlertCls} text-[11px] lg:text-sm whitespace-nowrap">${data.d?.running === true ? '••:••,••' : data.display.timeLabel}</span>
                </td>
                <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-[11px] lg:text-sm">${data.display.knocksSimple}</td>
                <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 tabular-nums text-[11px] lg:text-sm obstacle-penalty-cell" data-sn="${sn}">${formatPenalty(data.obstaclePenalty)}</td>
                <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 tabular-nums text-[11px] lg:text-sm time-penalty-cell" data-sn="${sn}">${formatPenalty(data.timePenalty)}</td>
                <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 tabular-nums text-[11px] lg:text-sm">${formatPenalty(data.extraPenalty)}</td>
                <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 tabular-nums font-semibold text-[11px] lg:text-sm total-penalty-cell" data-sn="${sn}">${formatPenalty(data.totalPenalty)}</td>
                <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 tabular-nums font-bold text-[11px] lg:text-sm text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                    ${overallLabel}
                </td>
                <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-center">
                    <span class="inline-block px-1.5 py-0.5 rounded-md text-[10px] lg:text-xs font-medium whitespace-nowrap ${statusBadgeClass}">${data.status}</span>
                </td>
                <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-right whitespace-nowrap">
                  ${finalizeButtonsHtml}
                </td>
            </tr>`;
}
