import { formatObstacleClock, formatObstacleSeconds } from './marathonResultFormatters.js';

export function rowObstacleCells(res, eq, maxObs, obstaclePlacementMap, getObstaclePlacement) {
  if (typeof eq === 'number' && maxObs === undefined) {
    maxObs = eq;
    eq = null;
  }

  return Array.from({ length: maxObs }, (_, i) => {
    const n = i + 1;
    const obsItem = (res.obstacles.items || []).find(o => Number(o.number) === n);
    const timeSec = (obsItem && Number.isFinite(Number(obsItem.timeSec))) ? Number(obsItem.timeSec) : null;
    const finalP = (obsItem && Number.isFinite(Number(obsItem.penalty))) ? Number(obsItem.penalty) : null;
    const label = timeSec !== null ? formatObstacleSeconds(timeSec) : (obsItem?.eliminated ? 'ELIM' : '\u2014');
    const place = timeSec !== null && typeof getObstaclePlacement === 'function'
      ? getObstaclePlacement(obstaclePlacementMap, eq, n)
      : null;
    const placeMarkup = Number.isFinite(place)
      ? `<div class="text-[9px] lg:text-[10px] leading-tight text-gray-500 dark:text-gray-400">(${place})</div>`
      : '';
    const title = [
      `Hinder ${n}`,
      timeSec !== null ? `Tid: ${formatObstacleSeconds(timeSec)} s (${formatObstacleClock(timeSec)})` : null,
      finalP !== null ? `Straff: ${finalP.toFixed(2)}` : null,
      Number.isFinite(place) ? `Plac i klassen: ${place}` : null
    ].filter(Boolean).join(' | ');

    return `<td class="px-2 py-1.5 lg:px-3 lg:py-2 text-center text-[11px] lg:text-sm font-normal tabular-nums" data-sn="${res.startNumber}" data-obs="${n}" title="${title}">
                    <span data-cell="obsVal">${label}</span>
                    ${placeMarkup}
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
    thSort(thCenter, `obs-${i + 1}`, `${t('obstacle_lbl')} ${i + 1} (<span class="normal-case lowercase">s</span>)`)
      .replace('<th ', '<th title="Hindertid i sekunder" ')
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
