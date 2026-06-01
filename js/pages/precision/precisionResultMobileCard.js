function defaultFormatPenalty(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—';
}

export function renderPrecisionResultCard({
  data,
  viewMode = 'class',
  classStarters = new Map(),
  flagHtml = '',
  clubLogoHtml = '',
  finalizeButtonsHtml = '',
  formatPenalty = defaultFormatPenalty
}) {
  const eq = data.eq;
  const sn = String(eq.startNumber);
  const timeLabel = data.display.timeLabel;
  const penaltyLabel = data.d?.eliminated
    ? '<span class="text-red-600 dark:text-red-400 font-bold">ELIM</span>'
    : formatPenalty(data.totalPenalty);
  const obstacleLabel = formatPenalty(data.obstaclePenalty);
  const timePenaltyLabel = formatPenalty(data.timePenalty);

  const isActive = data.d?.running === true || (data.status && data.status.includes('Påg'));
  const isStruken = data.status === 'Struken' || eq.status === 'struken';
  const cls = eq._mergedLabel || eq.className || 'Okänd Klass';
  const startersCount = classStarters.get(cls) || 1;
  const numPlaced = Math.ceil(startersCount / 4) || 1;
  const rankNum = Number(data.place);
  const isPlaced = !Number.isNaN(rankNum) && rankNum > 0 && rankNum <= numPlaced;

  let placColor = 'text-gray-600 dark:text-gray-400';
  let placBg = 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700';

  if (isStruken) {
    placBg = 'bg-red-50 dark:bg-red-900/10 border-red-100 opacity-75';
  } else if (isActive) {
    placBg = 'bg-yellow-50 dark:bg-yellow-900/40 border-yellow-500 shadow-sm border-l-4 border-2';
  } else if (isPlaced) {
    if (rankNum === 1) {
      placColor = 'text-yellow-600 dark:text-yellow-400 drop-shadow-sm';
      placBg = 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-400 dark:border-yellow-500/80 border-2';
    } else if (rankNum === 2) {
      placColor = 'text-slate-600 dark:text-slate-300 drop-shadow-sm';
      placBg = 'bg-slate-100 dark:bg-slate-800/80 border-slate-400 dark:border-slate-500/80 border-2';
    } else if (rankNum === 3) {
      placColor = 'text-orange-700 dark:text-orange-400 drop-shadow-sm';
      placBg = 'bg-orange-100 dark:bg-orange-950/40 border-orange-500 dark:border-orange-600/80 border-2';
    } else {
      placColor = 'text-emerald-600 dark:text-emerald-400';
      placBg = 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700/50 border-2';
    }
  }

  const placBlock = `
      <div class="text-[8px] uppercase text-gray-500 dark:text-gray-400 leading-none mb-0.5 font-bold tracking-wider">Plac</div>
      <div class="text-base font-black ${placColor} leading-none">${data.place || '—'}</div>
  `;

  return `
      <div class="m-1 mb-1.5 rounded-lg border shadow-sm overflow-hidden cursor-pointer ${placBg}" data-sn="${sn}" role="button" tabindex="0">
        <div class="p-1.5 flex items-center justify-between gap-1 border-b dark:border-gray-700/50 ${(isPlaced || isActive || isStruken) ? '' : 'bg-gray-50 dark:bg-gray-800/50'}">
           <div class="flex flex-col min-w-0 pr-1">
              <div class="font-bold text-[13px] dark:text-white leading-tight truncate flex items-center gap-1">
                 <span class="text-gray-500 dark:text-gray-400 text-[10px]">#${eq.startNumber}</span>
                 <span class="truncate">${eq.driverName}</span>
              </div>
              <div class="flex items-center gap-1 mt-0.5">
                 ${flagHtml} ${clubLogoHtml}
                 ${viewMode === 'startorder' ? `<span class="text-[9px] text-gray-500 dark:text-gray-400 truncate ml-1">${cls}</span>` : ''}
              </div>
           </div>

           <div class="flex items-center gap-2 shrink-0">
              <div class="text-right">
                  <div class="text-[8px] uppercase text-gray-500 dark:text-gray-400 leading-none mb-0.5">Totalt</div>
                  <div class="font-bold text-[13px] text-blue-800 dark:text-blue-300 leading-none live-total-penalty-card" data-sn="${sn}">${penaltyLabel}</div>
              </div>
              <div class="text-right border-l dark:border-gray-300 dark:border-gray-600 pl-2">
                  ${placBlock}
              </div>
           </div>
        </div>

        <div class="px-1.5 py-1.5 bg-white dark:bg-gray-800">
           <div class="flex justify-between items-center text-[10px] mb-1">
              <span class="text-gray-500 dark:text-gray-400">Start: <strong class="text-gray-700 dark:text-gray-200">${data.startT || '—'}</strong></span>
              ${isActive
                ? `
                  <div class="flex items-center gap-1">
                      <span class="inline-flex items-center px-1 py-0.5 rounded text-[8px] uppercase font-bold bg-yellow-100 text-yellow-800 animate-pulse">Running</span>
                  </div>
                  `
                : `<span class="text-gray-500 dark:text-gray-400 font-medium">${data.status || '–'}</span>`
              }
           </div>

           <div class="flex gap-1 text-[10px] tabular-nums">
              <div class="flex-1 text-center py-0.5 rounded bg-gray-50 dark:bg-gray-700 border border-gray-100 dark:border-gray-600">
                 <div class="text-[8px] uppercase tracking-wider opacity-70 leading-none">Tid</div>
                 <div class="font-bold live-time-card text-[10px] leading-tight" data-sn="${sn}">${isActive ? '••:••,••' : timeLabel}</div>
              </div>
              <div class="flex-1 text-center py-0.5 rounded bg-gray-50 dark:bg-gray-700 border border-gray-100 dark:border-gray-600">
                 <div class="text-[8px] uppercase tracking-wider opacity-70 leading-none">Hinder</div>
                 <div class="font-bold live-obstacle-penalty-card text-[10px] leading-tight" data-sn="${sn}">${obstacleLabel}</div>
              </div>
              <div class="flex-1 text-center py-0.5 rounded bg-gray-50 dark:bg-gray-700 border border-gray-100 dark:border-gray-600">
                 <div class="text-[8px] uppercase tracking-wider opacity-70 leading-none">Tidsfel</div>
                 <div class="font-bold live-time-penalty-card text-[10px] leading-tight" data-sn="${sn}">${timePenaltyLabel}</div>
              </div>
           </div>
           ${finalizeButtonsHtml ? `
             <div class="mt-1 flex justify-end">${finalizeButtonsHtml}</div>
           ` : ''}
        </div>
      </div>
  `;
}
