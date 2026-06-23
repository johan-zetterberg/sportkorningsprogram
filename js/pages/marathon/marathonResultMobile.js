import { isNum } from '../../utils/sharedUtils.js';
import { formatObstacleSeconds, formatStartTimeLabel } from './marathonResultFormatters.js';
import { stageLabel } from './marathonResultTable.js';

function buildCardData(eq, {
  marathonMap,
  calculateResult,
  timingDocFor,
  startTimeFor,
  fmtClock
}) {
  const sn = String(eq.startNumber);
  const d = marathonMap.get(sn) || {};
  const res = calculateResult(eq, d, timingDocFor(sn));

  const totalPen = res.totalPenalty;
  const totalLabel = (totalPen === Infinity) ? 'ELIM' : (isNum(totalPen) ? totalPen.toFixed(2) : '\u2014');
  const etaLabel = res.eta.B ? fmtClock(res.eta.B) : (res.eta.A ? fmtClock(res.eta.A) : '\u2014');
  const startVal = startTimeFor(sn);
  const startLabel = formatStartTimeLabel(startVal);

  return { sn, d, status: res.status, totalLabel, etaLabel, startLabel };
}

export function renderMarathonMobileCards({
  cards,
  list,
  viewMode,
  placeMap,
  obstaclePlaceMap,
  getObstaclePlacement,
  marathonMap,
  stageKeys,
  stageEnabled,
  calculateResult,
  timingDocFor,
  startTimeFor,
  fmtClock,
  getFlagHtml,
  getClubLogoHtml,
  startLiveTicker,
  translate
}) {
  if (!cards) return;

  const t = translate;
  if (list.length === 0) {
    cards.innerHTML = `<div class="p-6 text-center text-gray-400 italic bg-white dark:bg-gray-800 rounded-lg shadow-sm w-full">${t('dressage_no_results') || t('no_results') || 'Inga resultat.'}</div>`;
    return;
  }

  const classStarters = new Map();
  list.forEach(eq => {
    const cls = eq.className || 'Ok\u00e4nd Klass';
    classStarters.set(cls, (classStarters.get(cls) || 0) + 1);
  });

  let lastClass = null;
  let html = '';

  list.forEach(eq => {
    const cls = eq.className || 'Ok\u00e4nd Klass';

    if (viewMode === 'byclass' && cls !== lastClass) {
      html += `<div class="px-2 py-1.5 mt-2 bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 font-bold text-sm rounded-md shadow-sm">${cls}</div>`;
      lastClass = cls;
    }

    const { sn, d, status, totalLabel, etaLabel, startLabel } = buildCardData(eq, {
      marathonMap,
      calculateResult,
      timingDocFor,
      startTimeFor,
      fmtClock
    });
    const place = placeMap.get(sn);
    const isActive = status && status.includes('P\u00e5g');
    const isStruken = eq.status === 'struken';
    const res = calculateResult(eq, d, timingDocFor(sn));

    const startersCount = classStarters.get(cls) || 1;
    const numPlaced = Math.ceil(startersCount / 4) || 1;
    const rankNum = Number(place);
    const isPlaced = !isNaN(rankNum) && rankNum > 0 && rankNum <= numPlaced;

    let placColor = 'text-gray-600 dark:text-gray-400';
    let placBg = 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700';

    if (isStruken) {
      placBg = 'bg-red-50 dark:bg-red-900/10 border-red-100 opacity-75';
    } else if (isActive) {
      placBg = 'bg-yellow-50 dark:bg-yellow-900/40 border-yellow-500 shadow-sm border-l-4 border-2';
    } else if (isPlaced) {
      if (rankNum === 1) { placColor = 'text-yellow-600 dark:text-yellow-400 drop-shadow-sm'; placBg = 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-400 dark:border-yellow-500/80 border-2'; }
      else if (rankNum === 2) { placColor = 'text-slate-600 dark:text-slate-300 drop-shadow-sm'; placBg = 'bg-slate-100 dark:bg-slate-800/80 border-slate-400 dark:border-slate-500/80 border-2'; }
      else if (rankNum === 3) { placColor = 'text-orange-700 dark:text-orange-400 drop-shadow-sm'; placBg = 'bg-orange-100 dark:bg-orange-950/40 border-orange-500 dark:border-orange-600/80 border-2'; }
      else { placColor = 'text-emerald-600 dark:text-emerald-400'; placBg = 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700/50 border-2'; }
    }

    const placBlock = `
        <div class="text-[8px] uppercase text-gray-500 dark:text-gray-400 leading-none mb-0.5 font-bold tracking-wider">Plac</div>
        <div class="text-base font-black ${placColor} leading-none">${place || '\u2014'}</div>
    `;
    const obstacleChips = (res.obstacles?.items || [])
      .filter(obs => Number.isFinite(Number(obs?.timeSec)) && !obs?.eliminated)
      .sort((a, b) => Number(a?.number || 0) - Number(b?.number || 0))
      .map((obs) => {
        const obstacleNo = Number(obs?.number);
        const obstaclePlace = typeof getObstaclePlacement === 'function'
          ? getObstaclePlacement(obstaclePlaceMap, eq, obstacleNo)
          : null;
        const placeLabel = Number.isFinite(obstaclePlace) ? ` (${obstaclePlace})` : '';
        return `
          <span class="inline-flex items-center gap-1 rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-[9px] text-gray-700 dark:text-gray-200 tabular-nums">
            <span class="font-semibold">H${obstacleNo}</span>
            <span>${formatObstacleSeconds(Number(obs.timeSec))}${placeLabel}</span>
          </span>
        `;
      }).join('');

    html += `
      <div class="m-1 mb-1.5 rounded-lg border shadow-sm overflow-hidden cursor-pointer ${placBg}" data-sn="${sn}" style="cursor: pointer;">
        <div class="p-1.5 flex items-center justify-between gap-1 border-b dark:border-gray-700/50 ${(isPlaced || isActive || isStruken) ? '' : 'bg-gray-50 dark:bg-gray-800/50'}">
           <div class="flex flex-col min-w-0 pr-1">
              <div class="font-bold text-[13px] dark:text-white leading-tight truncate flex items-center gap-1">
                 <span class="text-gray-500 dark:text-gray-400 text-[10px]">#${eq.startNumber}</span>
                 <span class="truncate">${eq.driverName}</span>
              </div>
              <div class="flex items-center gap-1 mt-0.5">
                 ${getFlagHtml(eq)} ${getClubLogoHtml(eq)}
                 ${viewMode === 'startorder' ? `<span class="text-[9px] text-gray-500 dark:text-gray-400 truncate ml-1">${cls}</span>` : ''}
              </div>
           </div>
           <div class="flex items-center gap-2 shrink-0">
              <div class="text-right">
                  <div class="text-[8px] uppercase text-gray-500 dark:text-gray-400 leading-none mb-0.5">Totalt</div>
                  <div class="font-bold text-[13px] text-blue-800 dark:text-blue-300 leading-none" data-total-pen="${sn}">${totalLabel}</div>
              </div>
              <div class="text-right border-l dark:border-gray-300 dark:border-gray-600 pl-2">
                  ${placBlock}
              </div>
           </div>
        </div>

        <div class="px-1.5 py-1 bg-white dark:bg-gray-800">
           <div class="flex justify-between items-center text-[9px] mb-1">
              <div class="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                 <span>Start: <strong class="text-gray-700 dark:text-gray-200">${startLabel}</strong></span>
                 <span>ETA M\u00e5l: <strong class="text-gray-700 dark:text-gray-200">${etaLabel}</strong></span>
              </div>
              ${isActive
                ? `
                  <div class="flex items-center gap-1">
                      <span class="inline-flex items-center px-1 py-0.5 rounded text-[8px] uppercase font-bold bg-yellow-100 text-yellow-800 animate-pulse">Running</span>
                      <span data-live-time="${sn}" class="font-bold text-yellow-700 animate-pulse">\u2014</span>
                  </div>
                  `
                : `<span class="text-gray-500 dark:text-gray-400 font-medium">${status || '\u2013'}</span>`
              }
           </div>

           <div class="flex gap-1">
               ${stageKeys.filter(stageEnabled).map(st => {
                 const sData = res.stages[st];
                 let val = '\u2014';
                 let valClass = "bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-400";

                 if (sData) {
                   if (sData.eliminated) { val = 'ELIM'; valClass = "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 font-bold"; }
                   else if (isNum(sData.timePenalty)) {
                     val = sData.timePenalty.toFixed(2);
                     if (sData.timePenalty > 0) valClass = "bg-gray-100 dark:bg-gray-600 text-gray-800 dark:text-gray-200";
                   }
                 }
                 return `
                    <div class="flex-1 text-center py-0.5 rounded ${valClass} border border-gray-100 dark:border-gray-600">
                       <div class="text-[8px] uppercase tracking-wider opacity-70 leading-none">${stageLabel(st)}</div>
                       <div class="font-bold text-[10px] tabular-nums leading-tight" data-stage-pts="${sn}" data-stage="${st}">${val}</div>
                    </div>
                  `;
               }).join('')}
           </div>
           ${obstacleChips ? `
             <div class="mt-1.5 flex flex-wrap gap-1">
               ${obstacleChips}
             </div>
           ` : ''}
        </div>
      </div>
    `;
  });

  cards.innerHTML = html;

  try { list.forEach(eq => startLiveTicker(eq.startNumber)); } catch (err) { console.error('LiveTicker error:', err); }
}
