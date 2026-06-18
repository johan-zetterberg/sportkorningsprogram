// js/ui/marathonModal.js
import { getGlobalState } from '../main.js';
import { getMarathonObstacleResults } from '../services/marathonService.js';
import { getClubLogoHtml } from '../services/logosService.js';
import { getFlagHtml } from '../services/flagsService.js';
import { t } from '../utils/i18n.js';

// Importera helpers
import {
  stageStartTS,
  stageStopTS,
  stageDurationMsSaved,
  stagePenaltyFromMs,
  limitsFor,
  pausedMsSince,
  formatMsLive,
  formatSec,
  toTimeLabel,
  getObstacleArray,
  obstacleValues,
  getObstacleCoefficient,
  calculateMarathonResult
} from '../utils/marathonUtils.js';

// Importera PDF-funktionen från din nya plats
import { printMarathonPdf } from '../pdf/marathonPdf.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getMomentHorseLabel(equipage) {
  const allHorsesRaw = equipage.horses || equipage.horseNames || equipage.horse || [];
  if (Array.isArray(allHorsesRaw) && allHorsesRaw.length > 0) {
    return allHorsesRaw.map(h => h.name || h).join(' & ');
  }
  return '—';
}

export function renderMarathonContent(containerElement, eq, marathonData) {
  // Använd hinderdata direkt från map, men slå upp tidsstämplar från obstacleTimes om de saknas på objektet
  const rawObstacles = getObstacleArray(marathonData);
  const obstacleTimes = marathonData.obstacleTimes || {};

  // Hämta dynamisk koefficient
  const obsCoeff = getObstacleCoefficient(eq.className);

  const obstaclesForView = rawObstacles.map(o => {
    const { timeSec, penalty, eliminated } = obstacleValues(o);
    const num = Number(o.number || o.obstacleNumber || o.id);
    const numKey = String(num);

    // Slå upp tidsstämplar från obstacleTimes-mappen
    const times = obstacleTimes[numKey] || {};
    // Prioritera exitAt/enteredAt från obstacleTimes, fallback till objektet
    const enteredAt = times.enteredAtClient || times.enteredAt || o.enteredAtClient || o.enteredAt || null;
    const exitAt = times.exitAtClient || times.exitAt || o.exitAtClient || o.exitAt || null;

    // Hämta gateSplits (kan ligga på objektet eller i times, beroende på hur det sparades)
    // Prioritera times.gateSplits (live/nytt) om det finns
    const splits = times.gateSplits || o.gateSplits || [];

    // Recalculate Time Penalty if time is available
    let calculatedTimePenalty = penalty || 0;
    if (Number.isFinite(timeSec)) {
      calculatedTimePenalty = timeSec * obsCoeff;
    }

    return {
      number: num,
      timeMs: (timeSec && Number.isFinite(timeSec)) ? Math.round(timeSec * 1000) : (o.timeMs || 0),
      timePenalty: calculatedTimePenalty,
      knockdowns: Number(o.knockdowns || 0),
      knockdownPenalty: Number(o.knockdownPenalty || o.knockDownPenalty || 0),
      otherPenalty: Number(o.otherPenalty || 0),
      comment: o.comment || '',
      routeString: o.routeString || '',
      eliminated: eliminated,
      holdTimeSec: Number(o.holdTimeSec || 0),
      enteredAtServer: enteredAt,
      exitAtServer: exitAt,
      gateSplits: splits
    };
  }).sort((a, b) => (a.number || 0) - (b.number || 0));

  // --- Renderare ---
  const renderObstacle = (obs) => {
    // Beräkna mellantider om data finns
    let splitRows = '';
    if (obs.gateSplits && obs.gateSplits.length > 0 && obs.enteredAtServer) {
      // Parsa starttid robust
      let startTs = obs.enteredAtServer;
      if (startTs && startTs.toMillis) startTs = startTs.toMillis(); // Firestore Timestamp
      else if (typeof startTs === 'string') startTs = new Date(startTs).getTime(); // ISO String e.g. from enteredAtClient

      // Validera startTs
      if (startTs && !isNaN(startTs)) {
        const validSplits = obs.gateSplits
          .map(s => {
            let ts = s.ts;
            if (ts && ts.toMillis) ts = ts.toMillis();
            else if (typeof ts === 'string') ts = new Date(ts).getTime();

            if (!ts || isNaN(ts)) return null;

            // Beräkna absolut tid från start (Cumulative)
            const diff = ts - startTs;
            return { char: s.char, diff };
          })
          .filter(x => x && /^[A-Z]$/.test(x.char) && x.diff >= 0); // Endast versaler och positva diffar

        // Deduplicera: Behåll bara första passagen per bokstav
        const uniqueSplits = [];
        const seenChars = new Set();
        for (const s of validSplits) {
          if (!seenChars.has(s.char)) {
            seenChars.add(s.char);
            uniqueSplits.push(s);
          }
        }

        // Sortera efter bokstav om det behövs, eller behåll tidsordning? 
        // Vanligtvis vill man se dem i ordning A, B, C... men om man kör fel väg...
        // Men vi filtrerar bort fel väg. Så tidsordning är nog bäst (vilket de redan är iom array order).

        if (uniqueSplits.length > 0) {
          const items = uniqueSplits.map(s => `<span>${s.char}: <span class="font-mono">${(s.diff / 1000).toFixed(1)}s</span></span>`).join('');
          splitRows = `
                  <div class="mt-2 text-xs border-t pt-1 border-gray-200 dark:border-gray-700">
                    <span class="text-gray-500 dark:text-gray-400 mr-2">${t('splits_label')}:</span>
                    <div class="inline-flex flex-wrap gap-x-3 gap-y-1 text-gray-700 dark:text-gray-300">
                      ${items}
                    </div>
                  </div>
                `;
        }
      }
    }

    return `
          <div class="p-3 rounded-lg border bg-gray-50 dark:bg-gray-700/50 dark:border-gray-600">
            <h5 class="font-semibold text-gray-900 dark:text-gray-100">${t('obstacle')} ${obs.number} ${obs.eliminated ? '<span class="text-red-600 dark:text-red-400 ml-2">ELIM</span>' : ''}</h5>
            <div class="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
              <div class="text-gray-700 dark:text-gray-300"><span class="text-gray-500 dark:text-gray-400">${t('time')}:</span> ${formatMsLive(obs.timeMs)}</div>
              <div class="text-gray-700 dark:text-gray-300"><span class="text-gray-500 dark:text-gray-400">${t('penalty')}:</span> ${obs.timePenalty.toFixed(2)}</div>
              <div class="text-gray-700 dark:text-gray-300"><span class="text-gray-500 dark:text-gray-400">${t('knockdowns')}:</span> ${obs.knockdowns} (${obs.knockdownPenalty.toFixed(2)})</div>
              ${obs.otherPenalty > 0 ? `<div class="text-gray-700 dark:text-gray-300"><span class="text-gray-500 dark:text-gray-400 font-bold text-amber-600 dark:text-amber-500">Övrigt straff:</span> <span class="font-bold text-amber-600 dark:text-amber-500">${obs.otherPenalty.toFixed(2)}</span></div>` : '<div></div>'}
              ${obs.holdTimeSec > 0 ? `<div class="col-span-2 md:col-span-4 text-gray-700 dark:text-gray-300"><span class="text-gray-500 dark:text-gray-400 font-bold text-blue-600 dark:text-blue-500">Uppehåll:</span> <span class="font-bold text-blue-600 dark:text-blue-500">${obs.holdTimeSec}s</span></div>` : ''}
            </div>
            <div class="mt-2 text-xs text-gray-500 dark:text-gray-400">
                ${t('in_label')}: ${toTimeLabel(obs.enteredAtServer)} | ${t('out_label')}: ${toTimeLabel(obs.exitAtServer)}
            </div>
             ${obs.routeString ? `<div class="mt-1 text-xs text-gray-700 dark:text-gray-300"><span class="text-gray-500 dark:text-gray-400">${t('route_label')}:</span> ${escapeHtml(obs.routeString)}</div>` : ''}
             ${obs.comment ? `<div class="mt-1 text-xs text-gray-700 dark:text-gray-300"><span class="text-gray-500 dark:text-gray-400">Kommentar:</span> ${escapeHtml(obs.comment)}</div>` : ''}
             ${splitRows}
          </div>
        `;
  };

  // --- Data Beräkning (TR-kompatibel) ---
  const res = calculateMarathonResult(eq, marathonData, marathonData);

  const renderStage = (stageKey) => {
    const stage = res.stages[stageKey] || {};
    const start = stage.start;
    const stop = stage.stop;
    const dur = stage.durationMs;
    const sp = { points: stage.timePenalty, elim: stage.eliminated };

    const limits = limitsFor(eq, stageKey);
    let stageLabel = stageKey === 'transport' ? t('transport') : t('stage') + ' ' + stageKey;

    // Detect Warm-up (Fixed Time A)
    if (stageKey === 'A' && limits && limits.ideal > 0 && limits.max === limits.ideal && limits.min === 0) {
      stageLabel = 'Warm-up';
    }

    let etaLabel = '—';
    const isRunning = start && !stop;

    if (limits && isRunning && limits.ideal) {
      const p = pausedMsSince(start);
      // ETA baseras på Ideal (som nu är Maxtid för B, men Ideal för A..?)
      // Vi använder "ideal" värdet för ETA-beräkning.
      etaLabel = new Date(start + p + limits.ideal * 1000).toLocaleTimeString('sv-SE');
    }

    // Formattera gränser
    let limitsInfo = '';
    if (limits) {
      const minStr = formatSec(limits.min);
      const maxStr = formatSec(limits.max);
      limitsInfo = `(${t('allowed_span')}: ${minStr} – ${maxStr})`;
    }

    if (!start && !stop && !Number.isFinite(dur)) return '';

    return `
          <div class="border-b dark:border-gray-700 py-2">
            <p class="font-semibold text-gray-900 dark:text-white">${stageLabel}</p>
            <div class="text-sm grid grid-cols-4 gap-2 text-gray-700 dark:text-gray-300">
               <div>${t('start_label')}: ${toTimeLabel(start)}</div>
               <div>${t('goal_label')}: ${toTimeLabel(stop)}</div>
               <div>${t('time')}: ${Number.isFinite(dur) ? formatMsLive(dur) : '—'}</div>
               <div>${t('penalty')}: <b>${sp.elim ? 'ELIM' : (sp.points ?? '—')}</b></div>
            </div>
            ${stage.holdTimeMs > 0 ? `<div class="text-xs text-blue-600 dark:text-blue-400 mt-1 font-semibold">Inkluderar avdrag för uppehåll: -${(stage.holdTimeMs / 1000).toFixed(0)}s</div>` : ''}
            <div class="text-xs text-gray-500 dark:text-gray-400 mt-1 flex gap-4">
                ${limitsInfo ? `<span>${limitsInfo}</span>` : ''}
                ${isRunning ? `<span>${t('eta_label')}: ${etaLabel}</span>` : ''}
            </div>
          </div>
        `;
  };

  const totalStagePenalty = (res.stages.A.timePenalty || 0) + (res.stages.B.timePenalty || 0);
  const totalObstaclePenalty = res.obstacles.sum;
  const isEliminated = res.eliminated;
  const globalOtherPenalty = res.otherPenalty;

  // Calculate aggregated display penalty for "Other" (matches Övr column in table)
  const displayOtherPenalty = (globalOtherPenalty || 0) + (res.wgPenalty || 0) + (res.obstacles?.items || []).reduce((acc, o) => acc + (Number(o.otherPenalty) || 0), 0);

  const grandTotal = res.totalPenalty;
  const totalLabel = isEliminated ? 'ELIM' : (Number.isFinite(grandTotal) ? grandTotal.toFixed(2) : '0.00');

  // Observer data
  const obsLog = marathonData.observerLog || {};
  const wrongGaitSec = Math.max(0, Math.round(Number(obsLog.wrongGaitSeconds || 0)));
  const halts = Array.isArray(obsLog.halts) ? obsLog.halts : [];
  const totalHaltSec = halts.reduce((acc, h) => acc + Math.max(0, Math.round(Number(h?.durSec || 0))), 0);
  const obsNotes = (obsLog.notes || '').trim();
  const hasObserverData = wrongGaitSec > 0 || totalHaltSec > 0 || obsNotes;

  // HTML Rendering
  // OBS: Vi har tagit bort den interna headern härifrån för att undvika dubbla headers i modalen.
  containerElement.innerHTML = `
        <div class="p-4 md:p-6">
          ${isEliminated || (eq && ['utgått', 'utesluten', 'retired', 'eliminated', 'elim', 'ute', 'utg'].some(s => String(eq.status || '').toLowerCase().includes(s))) ? `
            <div class="mb-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative" role="alert">
              <strong class="font-bold">Eliminerad i maraton. </strong>
              <span class="block sm:inline">Ekipaget har status eliminerad (ELIM) i denna gren.</span>
            </div>
          ` : ''}

          <div class="mb-4">
            <h4 class="font-bold border-b dark:border-gray-700 mb-2 text-gray-900 dark:text-white">${t('stage')} (s)</h4>
            ${['A', 'transport', 'B'].map(renderStage).join('')}
          </div>

          <div>
            <h4 class="font-bold border-b dark:border-gray-700 mb-2 text-gray-900 dark:text-white">${t('obstacle')}</h4>
            <div class="space-y-2">
                ${obstaclesForView.length ? obstaclesForView.map(renderObstacle).join('') : `<p class="text-sm italic">${t('no_data')}</p>`}
            </div>
          </div>
          
          ${hasObserverData ? `
            <div class="mt-4 bg-yellow-50 p-3 rounded border border-yellow-100 text-sm">
               <h5 class="font-bold text-yellow-800 mb-1">Observatörsnoteringar</h5>
               <div class="grid grid-cols-2 gap-2">
                  ${wrongGaitSec ? `<div>Fel gångart: <b>${wrongGaitSec}s</b></div>` : ''}
                  ${totalHaltSec ? `<div>Halter: <b>${halts.length}st (${totalHaltSec}s totalt)</b></div>` : ''}
               </div>
               ${obsNotes ? `<div class="mt-2 text-gray-700 italic">"${escapeHtml(obsNotes)}"</div>` : ''}
            </div>
          ` : ''}
          
          <div class="mt-6 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
             <h4 class="font-bold mb-2 text-slate-800 dark:text-slate-200">${t('summary')}</h4>
             <div class="grid grid-cols-4 gap-4 text-sm text-gray-700 dark:text-gray-300">
                <div>
                   <span class="block text-gray-500 dark:text-gray-400 text-xs">${t('penalty')} (${t('stage')})</span>
                   <span class="font-semibold text-lg">${totalStagePenalty.toFixed(2)}</span>
                </div>
                 <div>
                   <span class="block text-gray-500 dark:text-gray-400 text-xs">${t('penalty')} (${t('obstacle')})</span>
                   <span class="font-semibold text-lg">${totalObstaclePenalty.toFixed(2)}</span>
                </div>
                <div>
                   <span class="block text-gray-500 dark:text-gray-400 text-xs">${t('other_penalty')}</span>
                   <span class="font-semibold text-lg">${displayOtherPenalty.toFixed(2)}</span>
                </div>
                 <div class="text-right">
                   <span class="block text-gray-500 dark:text-gray-400 text-xs">${t('tab_total')}</span>
                   <span class="font-bold text-xl ${isEliminated ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white'}">${totalLabel}</span>
                </div>
             </div>
          </div>

          <div class="mt-4 pt-4 border-t dark:border-gray-700 flex justify-end">
             <button id="printPdfBtn" class="px-4 py-2 bg-gray-900 dark:bg-gray-800 text-white rounded hover:bg-gray-800 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
                ${t('print_pdf')}
             </button>
          </div>
        </div>
    `;

  // Koppla PDF-knappen
  const pdfBtn = containerElement.querySelector('#printPdfBtn');
  if (pdfBtn) {
    pdfBtn.onclick = async () => {
      const originalContent = pdfBtn.innerHTML;
      pdfBtn.textContent = `${t('generating_pdf')}...`;
      pdfBtn.disabled = true;
      try {
        await printMarathonPdf(eq, marathonData);
      } catch (err) {
        console.error("Fel vid PDF-generering:", err);
        alert("Kunde inte skapa PDF. Se konsolen för detaljer.");
      } finally {
        pdfBtn.innerHTML = originalContent;
        pdfBtn.disabled = false;
      }
    };
  }
}

export function renderTimeCard(container, eq, marathonData) {
  // Helper to get raw data
  const getStageData = (stage) => {
    const start = stageStartTS(marathonData, stage);
    const stop = stageStopTS(marathonData, stage);
    let dur = stageDurationMsSaved(marathonData, stage);
    if (!Number.isFinite(dur) && start && stop) dur = (stop - start) - pausedMsSince(start);

    const fee = Number.isFinite(dur) ? stagePenaltyFromMs(dur, eq, stage) : { points: 0 };
    return { start, stop, dur, fee };
  };

  const stages = ['A', 'transport', 'B'].map(key => {
    const d = getStageData(key);
    let name = key === 'transport' ? t('transport') : t('stage') + ' ' + key;

    // Check Warmup fix
    if (key === 'A') {
      const lim = limitsFor(eq, 'A');
      if (lim && lim.ideal > 0 && lim.max === lim.ideal && lim.min === 0) {
        name = 'Warm-up';
      }
    }

    return {
      name,
      ...d
    };
  });

  const rawObstacles = getObstacleArray(marathonData);
  // Hämta dynamisk koefficient
  const obsCoeff = getObstacleCoefficient(eq.className);

  const obstacles = rawObstacles.map(o => {
    const { timeSec, penalty } = obstacleValues(o);
    const num = Number(o.number || o.obstacleNumber || o.id);

    // Look up reliable times
    const times = marathonData.obstacleTimes?.[String(num)] || {};
    const start = times.enteredAtClient || times.enteredAt || o.enteredAtClient || o.enteredAt;
    const stop = times.exitAtClient || times.exitAt || o.exitAtClient || o.exitAt;

    // Recalculate Time Penalty dynamically if time is available
    let totalPenaltyForObs = penalty || 0;
    if (Number.isFinite(timeSec)) {
      const tp = timeSec * obsCoeff;
      const kp = Number(o.knockdownPenalty || o.knockDownPenalty || 0);
      const op = Number(o.otherPenalty || 0);
      totalPenaltyForObs = tp + kp + op;
    }

    return {
      name: t('obstacle') + ' ' + num,
      start, stop,
      dur: (timeSec && Number.isFinite(timeSec)) ? timeSec * 1000 : (o.timeMs || 0),
      fee: { points: totalPenaltyForObs },
      otherPenalty: Number(o.otherPenalty || 0),
      splits: times.gateSplits || o.gateSplits || []
    };
  }).sort((a, b) => {
    const nA = parseInt(a.name.replace(/\D/g, '')) || 0;
    const nB = parseInt(b.name.replace(/\D/g, '')) || 0;
    return nA - nB;
  });

  // Merge lists? Or separate? 
  // Time Card usually has stages first, then obstacles list.

  // Render Table
  const renderRow = (label, d, isBold = false) => {
    const startStr = d.start ? toTimeLabel(d.start) : '—';
    const stopStr = d.stop ? toTimeLabel(d.stop) : '—';
    const timeStr = Number.isFinite(d.dur) ? formatMsLive(d.dur) : '—';
    const penaltyStr = d.fee.points ? d.fee.points.toFixed(2) : '0.00';

    // --- SPLITS ----
    let splitsHtml = '';
    if (d.splits && d.splits.length > 0) {
      // Calculate diffs
      const validSplits = d.splits
        .map(s => {
          let ts = s.ts;
          if (ts && ts.toMillis) ts = ts.toMillis();
          else if (typeof ts === 'string') ts = new Date(ts).getTime();

          let startTs = d.start;
          if (startTs && startTs.toMillis) startTs = startTs.toMillis();
          else if (typeof startTs === 'string') startTs = new Date(startTs).getTime();

          if (!ts || !startTs) return null;
          return { char: s.char, diff: ts - startTs, ts };
        })
        .filter(x => x && /^[A-Z]$/.test(x.char) && x.diff >= 0) // Endast versaler och positva diffar
        .sort((a, b) => a.ts - b.ts); // Sortera i tidsordning

      // Deduplicera: Behåll bara första passagen per bokstav
      const uniqueSplits = [];
      const seenChars = new Set();
      for (const s of validSplits) {
        if (!seenChars.has(s.char)) {
          seenChars.add(s.char);
          uniqueSplits.push(s);
        }
      }

      const finals = uniqueSplits;

      if (finals.length > 0) {
        const items = finals.map(s => `<span class="mr-2">${s.char}: ${(s.diff / 1000).toFixed(1)}</span>`).join('');
        splitsHtml = `<div class="text-xs text-gray-500 dark:text-gray-400 mt-1 font-normal">${items}</div>`;
      }
    }

    const otherPenaltyHtml = d.otherPenalty > 0 ? `<div class="text-xs text-amber-600 dark:text-amber-500 mt-1">Övrigt: ${d.otherPenalty.toFixed(2)}</div>` : '';

    return `
        <tr class="border-b ${isBold ? 'font-semibold bg-gray-50 dark:bg-gray-700' : 'dark:border-gray-700'}">
            <td class="p-2 border-r">
                ${label}
            </td>
            <td class="p-2 border-r text-center">${startStr}</td>
            <td class="p-2 border-r text-center">${stopStr}</td>
            <td class="p-2 border-r text-right tabular-nums">
                ${timeStr}
                ${splitsHtml}
            </td>
            <td class="p-2 text-right tabular-nums">
                <div>${penaltyStr}</div>
                ${otherPenaltyHtml}
            </td>
        </tr>`;
  };

  container.innerHTML = `
    <div class="p-4 md:p-6 overflow-x-auto">
        <h4 class="font-bold mb-4 text-center uppercase tracking-widest text-gray-500 dark:text-gray-400">${t('digital_timecard')}</h4>
        <div class="border dark:border-gray-700 rounded-lg overflow-hidden shadow-sm">
            <table class="w-full text-sm text-left whitespace-nowrap">
                <thead class="bg-gray-900 dark:bg-gray-700 text-white">
                    <tr>
                        <th class="p-2 font-semibold">Moment</th>
                        <th class="p-2 font-semibold text-center">${t('start_time')}</th>
                        <th class="p-2 font-semibold text-center">${t('goal_label')}</th>
                        <th class="p-2 font-semibold text-right">${t('time')}</th>
                        <th class="p-2 font-semibold text-right">${t('penalty')}</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
                    ${stages.map(s => renderRow(s.name, s, true)).join('')}
                    <tr class="bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100"><td colspan="5" class="p-1"></td></tr>
                    ${obstacles.length ? obstacles.map(o => renderRow(o.name, o)).join('') : `<tr><td colspan="5" class="p-4 text-center italic text-gray-500 dark:text-gray-400">${t('no_data')}</td></tr>`}
                </tbody>
            </table>
        </div>
        <p class="mt-4 text-xs text-center text-gray-400">${t('auto_generated_log')}</p>
    </div>
    `;
}

export async function showDetailsModal(sn, equipages, marathonMap) {
  try {
    ensureModalExists();

    const modal = document.getElementById('marathonDetailsModal');
    const inner = document.getElementById('marathonDetailsModalInner');

    if (!modal || !inner) return;

    // Visa modalen
    modal.classList.remove('hidden');
    modal.classList.add('visible');
    modal.style.display = 'flex';
    modal.style.opacity = '1';
    modal.style.zIndex = '2147483647';
    inner.innerHTML = `<div style="padding:16px">Hämtar detaljer för startnr <b>${escapeHtml(String(sn))}</b>…</div>`;
    inner.dataset.isModal = 'true'; // Flagga för att visa stäng-knapp

    // Hämta data
    const id = String(sn);
    let d = marathonMap.get(id) || {};
    const eq = equipages.find(e => String(e.startNumber) === id) || { startNumber: id, driverName: 'Okänd', className: '' };

    // BYGG RESULTAT-HEADER MANUELLT (eftersom vi tog bort den från renderMarathonContent)
    // Detta bevarar utseendet för den fristående maraton-vyn
    inner.innerHTML = `
      <div class="p-4 md:p-6 pb-0">
        <div class="flex justify-between items-start mb-4">
          <div>
            <h3 class="text-xl font-bold text-gray-900 dark:text-white">#${escapeHtml(eq.startNumber)} ${escapeHtml(eq.driverName)}</h3>
            <div class="text-sm text-gray-600 dark:text-gray-300 flex items-center gap-2 mt-1">
               ${getFlagHtml(eq)} ${getClubLogoHtml(eq)} ${escapeHtml(eq.className || '')} • ${escapeHtml(eq.clubName || '')}
            </div>
            <div class="text-xs italic text-gray-500 dark:text-gray-400">${escapeHtml(getMomentHorseLabel(eq))}</div>
          </div>
          <button id="closeMarathonModalBtn" class="text-2xl leading-none text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200" aria-label="Stäng">&times;</button>
        </div>
      </div>
      <div id="marathon-content-container"></div>
    `;

    // --- Events & Toggle Logic ---
    const contentContainer = inner.querySelector('#marathon-content-container');
    const toggleBtnWrapper = document.createElement('div');
    toggleBtnWrapper.className = 'flex justify-end px-4 md:px-6 mb-2';
    toggleBtnWrapper.innerHTML = `
        <button id="toggleTimeCardBtn" class="text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>
            ${t('view_timecard')}
        </button>
    `;
    inner.querySelector('.pb-0').appendChild(toggleBtnWrapper); // Insert after header

    let isTimeCard = false;
    const toggleView = () => {
      isTimeCard = !isTimeCard;
      const btn = inner.querySelector('#toggleTimeCardBtn');
      if (isTimeCard) {
        renderTimeCard(contentContainer, eq, d);
        btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7"></path></svg> ${t('view_details')}`;
      } else {
        renderMarathonContent(contentContainer, eq, d);
        btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg> ${t('view_timecard')}`;
      }
    };

    inner.querySelector('#toggleTimeCardBtn').addEventListener('click', toggleView);

    // Default view
    renderMarathonContent(contentContainer, eq, d);

    // Events
    const close = () => {
      modal.classList.remove('visible');
      setTimeout(() => { modal.classList.add('hidden'); modal.style.display = 'none'; }, 200);
    };
    inner.querySelector('#closeMarathonModalBtn')?.addEventListener('click', close);
    modal.onclick = (e) => { if (e.target === modal) close(); };

  } catch (err) {
    console.error("Fel i modal:", err);
    alert("Kunde inte öppna detaljer.");
  }
}

function ensureModalExists() {
  if (document.getElementById('marathonDetailsModal')) return;

  const div = document.createElement('div');
  div.id = 'marathonDetailsModal';
  div.className = 'modal-overlay hidden';
  div.dataset.owner = 'marathon-results';
  div.innerHTML = `<div id="marathonDetailsModalContent" class="modal-content"><div id="marathonDetailsModalInner"></div></div>`;
  document.body.appendChild(div);

  if (!document.getElementById('marathonModalStyles')) {
    const s = document.createElement('style');
    s.id = 'marathonModalStyles';
    s.textContent = `
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: none; justify-content: center; align-items: center; z-index: 9999; }
        .modal-overlay.visible { display: flex !important; }
        .modal-content { background: white; border-radius: 8px; max-width: 900px; width: 95%; max-height: 90vh; overflow-y: auto; position: relative; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1); }
        /* Dark Mode Support */
        html.dark .modal-content { background: #1f2937; color: #f3f4f6; border: 1px solid #374151; }
        html.dark .modal-overlay { background: rgba(0,0,0,0.7); }
      `;
    document.head.appendChild(s);
  }
}
