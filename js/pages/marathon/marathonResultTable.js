export function rowObstacleCells(res, maxObs) {
  return Array.from({ length: maxObs }, (_, i) => {
    const n = i + 1;
    const obsItem = (res.obstacles.items || []).find(o => Number(o.number) === n);
    const finalP = (obsItem && Number.isFinite(Number(obsItem.penalty))) ? Number(obsItem.penalty) : null;
    const label = (finalP !== null) ? finalP.toFixed(2) : '\u2014';

    return `<td class="px-2 py-1.5 lg:px-3 lg:py-2 text-center text-[11px] lg:text-sm font-normal tabular-nums" data-sn="${res.startNumber}" data-obs="${n}">
                    <span data-cell="obsVal">${label}</span>
                </td>`;
  }).join('');
}

export function stageLabel(s) {
  return s === 'transport' ? 'T' : String(s || '').toUpperCase();
}

export function renderTableHead(thead, {
  maxObs,
  viewMode,
  sortState,
  stageCols,
  translate
}) {
  const isClass = viewMode === 'byclass';
  const thClass = "px-2 py-2 lg:px-3 lg:py-3 text-left text-[10px] lg:text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider align-middle";
  const thCenter = "px-2 py-2 lg:px-3 lg:py-3 text-center text-[10px] lg:text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider align-middle";
  const t = translate;

  const getSortIcon = (k) => {
    if (sortState.key !== k) return '<span class="text-gray-300 dark:text-gray-600 opacity-50 text-[10px] w-3 text-center">\u2194</span>';
    return sortState.dir === 'asc'
      ? '<span class="text-gray-800 dark:text-gray-200 text-[10px] w-3 text-center">\u2193</span>'
      : '<span class="text-gray-800 dark:text-gray-200 text-[10px] w-3 text-center">\u2191</span>';
  };

  const thSort = (cls, key, txt) => {
    const justify = cls.includes('text-center') ? 'justify-center' : 'justify-start';
    return `<th class="${cls} cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 select-none" data-sort-key="${key}">
                <div class="flex items-center gap-1 ${justify}">
                  <span>${txt}</span>${getSortIcon(key)}
                </div>
              </th>`;
  };

  const stageHead = stageCols
    .map(st => thSort(thCenter, `stage-${st}`, stageLabel(st)))
    .join('');
  const obsHead = Array.from({ length: maxObs }, (_, i) =>
    thSort(thCenter, `obs-${i + 1}`, `${t('obstacle_lbl')} ${i + 1}`)
  ).join('');
  const klassTH = isClass ? '' : thSort(thClass, 'className', t('class'));

  thead.innerHTML = `
        <tr>
            ${thSort(`${thClass} w-10 text-center`, 'place', t('rank_short'))}
            ${thSort(`${thClass} w-12 sticky-col-start bg-gray-50 dark:bg-gray-700`, 'startNumber', t('startno'))}
            ${thSort(`${thClass} sticky-col-driver bg-gray-50 dark:bg-gray-700`, 'driverName', t('driver'))}
            ${klassTH}
            ${thSort(thClass, 'clubName', t('club'))}
            ${thSort(thClass, 'startTime', t('start_time'))}
            ${thSort(thClass, 'eta', t('eta'))}
            ${thSort(thClass, 'live', t('live'))}
            ${stageHead}
            ${obsHead}
            ${thSort(thCenter, 'obsSum', t('penalty_obstacle_short'))}
            ${thSort(thCenter, 'otherPenalty', t('penalty_other_short'))}
            ${thSort(thCenter, 'totalPenalty', t('total'))}
            ${thSort(thClass, 'status', t('status'))}
            <th class="${thClass}">Admin</th>
        </tr>
      `;
}
