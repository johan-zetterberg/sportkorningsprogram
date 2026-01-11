// js/ui/marathonModal.js
import { getGlobalState } from '../main.js';
import { getMarathonObstacleResults } from '../services/firestoreService.js';
import { getClubLogoHtml } from '../services/logosService.js';
import { getFlagHtml } from '../services/flagsService.js';

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
  getObstacleCoefficient // Ny import för dynamisk straffberäkning
} from '../utils/marathonUtils.js';

// Importera PDF-funktionen från din nya plats
import { printMarathonPdf } from '../pdf/marathonPdf.js';

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
    const splits = o.gateSplits || times.gateSplits || [];

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
          .filter(x => x && /^[A-Z]$/.test(x.char)); // Endast versaler (rätt håll)

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
                  <div class="mt-2 text-xs border-t pt-1 border-gray-200">
                    <span class="text-gray-500 mr-2">Mellantider:</span>
                    <div class="inline-flex flex-wrap gap-x-3 gap-y-1 text-gray-700">
                      ${items}
                    </div>
                  </div>
                `;
        }
      }
    }

    return `
          <div class="p-3 rounded-lg border bg-gray-50">
            <h5 class="font-semibold">Hinder ${obs.number} ${obs.eliminated ? '<span class="text-red-600 ml-2">ELIM</span>' : ''}</h5>
            <div class="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
              <div><span class="text-gray-500">Tid:</span> ${formatMsLive(obs.timeMs)}</div>
              <div><span class="text-gray-500">Straff:</span> ${obs.timePenalty.toFixed(2)}</div>
              <div><span class="text-gray-500">Rivn:</span> ${obs.knockdowns} (${obs.knockdownPenalty.toFixed(2)})</div>
            </div>
            <div class="mt-2 text-xs text-gray-500">
                In: ${toTimeLabel(obs.enteredAtServer)} | Ut: ${toTimeLabel(obs.exitAtServer)}
            </div>
             ${obs.routeString ? `<div class="mt-1 text-xs"><span class="text-gray-500">Väg:</span> ${obs.routeString}</div>` : ''}
             ${splitRows}
          </div>
        `;
  };

  const renderStage = (stage) => {
    const start = stageStartTS(marathonData, stage);
    const stop = stageStopTS(marathonData, stage);
    let dur = stageDurationMsSaved(marathonData, stage);

    // Fallback: Om duration inte är sparat, men vi har start och mål, räkna ut det live
    if (!Number.isFinite(dur) && start && stop) {
      dur = (stop - start) - pausedMsSince(start); // Enkel diff (med pausjustering om möjligt)
      // Notera: pausedMsSince räknar paus från start till NU. 
      // pausedMsBetween(from, to) vore bättre om vi hade den importerad här.
      // Men duration_A och B brukar sparas. Om det saknas är detta en rimlig "live approximation".
    }

    const sp = Number.isFinite(dur) ? stagePenaltyFromMs(dur, eq, stage) : { points: null, elim: false };

    const limits = limitsFor(eq, stage);
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
      limitsInfo = `(Tillåtet: ${minStr} – ${maxStr})`;
    }

    if (!start && !stop && !Number.isFinite(dur)) return '';

    return `
          <div class="border-b py-2">
            <p class="font-semibold">${stage === 'transport' ? 'Transport' : 'Etapp ' + stage}</p>
            <div class="text-sm grid grid-cols-4 gap-2">
               <div>Start: ${toTimeLabel(start)}</div>
               <div>Mål: ${toTimeLabel(stop)}</div>
               <div>Tid: ${Number.isFinite(dur) ? formatMsLive(dur) : '—'}</div>
               <div>Straff: <b>${sp.elim ? 'ELIM' : (sp.points ?? '—')}</b></div>
            </div>
            <div class="text-xs text-gray-500 mt-1 flex gap-4">
                ${limitsInfo ? `<span>${limitsInfo}</span>` : ''}
                ${isRunning ? `<span>ETA: ${etaLabel}</span>` : ''}
            </div>
          </div>
        `;
  };

  // --- Totalberäkning (flyttas internt för modalen) ---
  let totalStagePenalty = 0;
  let totalObstaclePenalty = 0;
  let isEliminated = false;

  // 1. Summera Hinder
  obstaclesForView.forEach(o => {
    if (o.eliminated) isEliminated = true;
    totalObstaclePenalty += (o.timePenalty || 0) + (o.knockdownPenalty || 0) + (o.otherPenalty || 0);
  });

  // 2. Summera Etapper
  ['A', 'B'].forEach(stageKey => {
    const dur = stageDurationMsSaved(marathonData, stageKey);
    // För modalens totalberäkning använder vi samma logik som för visning
    let effectiveDur = dur;
    if (!Number.isFinite(dur)) {
      const s = stageStartTS(marathonData, stageKey);
      const e = stageStopTS(marathonData, stageKey);
      if (s && e) effectiveDur = (e - s) - pausedMsSince(s);
    }

    if (Number.isFinite(effectiveDur)) {
      const res = stagePenaltyFromMs(effectiveDur, eq, stageKey);
      if (res.elim) isEliminated = true;
      else if (Number.isFinite(res.points)) totalStagePenalty += res.points;
    }
  });

  // Lägg till eventuella "otherPenalty" som ligger på maraton-dokumentet root
  const globalOtherPenalty = Number(marathonData.otherPenalty || 0);

  const grandTotal = totalStagePenalty + totalObstaclePenalty + globalOtherPenalty;
  const totalLabel = isEliminated ? 'ELIM' : grandTotal.toFixed(2);

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
          <div class="mb-4">
            <h4 class="font-bold border-b mb-2">Etapper</h4>
            ${['A', 'transport', 'B'].map(renderStage).join('')}
          </div>

          <div>
            <h4 class="font-bold border-b mb-2">Hinder</h4>
            <div class="space-y-2">
                ${obstaclesForView.length ? obstaclesForView.map(renderObstacle).join('') : '<p class="text-sm italic">Inga hinderresultat.</p>'}
            </div>
          </div>
          
          ${hasObserverData ? `
            <div class="mt-4 bg-yellow-50 p-3 rounded border border-yellow-100 text-sm">
               <h5 class="font-bold text-yellow-800 mb-1">Observatörsnoteringar</h5>
               <div class="grid grid-cols-2 gap-2">
                  ${wrongGaitSec ? `<div>Fel gångart: <b>${wrongGaitSec}s</b></div>` : ''}
                  ${totalHaltSec ? `<div>Halter: <b>${halts.length}st (${totalHaltSec}s totalt)</b></div>` : ''}
               </div>
               ${obsNotes ? `<div class="mt-2 text-gray-700 italic">"${obsNotes}"</div>` : ''}
            </div>
          ` : ''}
          
          <div class="mt-6 bg-slate-50 p-4 rounded-lg border border-slate-200">
             <h4 class="font-bold mb-2 text-slate-800">Summering</h4>
             <div class="grid grid-cols-4 gap-4 text-sm">
                <div>
                   <span class="block text-gray-500 text-xs">Straff (Etapper)</span>
                   <span class="font-semibold text-lg">${totalStagePenalty.toFixed(2)}</span>
                </div>
                 <div>
                   <span class="block text-gray-500 text-xs">Straff (Hinder)</span>
                   <span class="font-semibold text-lg">${totalObstaclePenalty.toFixed(2)}</span>
                </div>
                <div>
                   <span class="block text-gray-500 text-xs">Övrigt</span>
                   <span class="font-semibold text-lg">${globalOtherPenalty.toFixed(2)}</span>
                </div>
                 <div class="text-right">
                   <span class="block text-gray-500 text-xs">Totalt</span>
                   <span class="font-bold text-xl ${isEliminated ? 'text-red-600' : 'text-slate-900'}">${totalLabel}</span>
                </div>
             </div>
          </div>

          <div class="mt-4 pt-4 border-t flex justify-end">
             <button id="printPdfBtn" class="px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700 flex items-center gap-2">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
                Skriv ut Protokoll
             </button>
          </div>
        </div>
    `;

  // Koppla PDF-knappen
  const pdfBtn = containerElement.querySelector('#printPdfBtn');
  if (pdfBtn) {
    pdfBtn.onclick = async () => {
      const originalContent = pdfBtn.innerHTML;
      pdfBtn.textContent = "Skapar PDF...";
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
    return {
      name: key === 'transport' ? 'Transport' : 'Etapp ' + key,
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
      name: 'Hinder ' + num,
      start, stop,
      dur: (timeSec && Number.isFinite(timeSec)) ? timeSec * 1000 : (o.timeMs || 0),
      fee: { points: totalPenaltyForObs },
      splits: o.gateSplits || times.gateSplits || []
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
        .filter(x => x && /^[A-Z]$/.test(x.char)) // Endast versaler (rätt håll) och icke-null
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
        splitsHtml = `<div class="text-xs text-gray-500 mt-1 font-normal">${items}</div>`;
      }
    }

    return `
        <tr class="border-b ${isBold ? 'font-semibold bg-gray-50' : ''}">
            <td class="p-2 border-r">
                ${label}
            </td>
            <td class="p-2 border-r text-center">${startStr}</td>
            <td class="p-2 border-r text-center">${stopStr}</td>
            <td class="p-2 border-r text-right tabular-nums">
                ${timeStr}
                ${splitsHtml}
            </td>
            <td class="p-2 text-right tabular-nums">${penaltyStr}</td>
        </tr>`;
  };

  container.innerHTML = `
    <div class="p-4 md:p-6 overflow-x-auto">
        <h4 class="font-bold mb-4 text-center uppercase tracking-widest text-gray-500">Digitalt Tidkort</h4>
        <div class="border rounded-lg overflow-hidden shadow-sm">
            <table class="w-full text-sm text-left whitespace-nowrap">
                <thead class="bg-gray-800 text-white">
                    <tr>
                        <th class="p-2 font-semibold">Moment</th>
                        <th class="p-2 font-semibold text-center">Starttid</th>
                        <th class="p-2 font-semibold text-center">Måltid</th>
                        <th class="p-2 font-semibold text-right">Tid</th>
                        <th class="p-2 font-semibold text-right">Straff</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-200">
                    ${stages.map(s => renderRow(s.name, s, true)).join('')}
                    <tr class="bg-gray-100"><td colspan="5" class="p-1"></td></tr>
                    ${obstacles.length ? obstacles.map(o => renderRow(o.name, o)).join('') : '<tr><td colspan="5" class="p-4 text-center italic text-gray-500">Inga hinderresultat</td></tr>'}
                </tbody>
            </table>
        </div>
        <p class="mt-4 text-xs text-center text-gray-400">Automatgenererat från systemets loggar.</p>
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
    inner.innerHTML = `<div style="padding:16px">Hämtar detaljer för startnr <b>${String(sn)}</b>…</div>`;
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
            <h3 class="text-xl font-bold">#${eq.startNumber} ${eq.driverName}</h3>
            <div class="text-sm text-gray-600 flex items-center gap-2 mt-1">
               ${getFlagHtml(eq)} ${eq.className} • ${eq.clubName || ''}
            </div>
            <div class="text-xs italic text-gray-500">${getMomentHorseLabel(eq)}</div>
          </div>
          <button id="closeMarathonModalBtn" class="text-2xl leading-none">&times;</button>
        </div>
      </div>
      <div id="marathon-content-container"></div>
    `;

    // --- Events & Toggle Logic ---
    const contentContainer = inner.querySelector('#marathon-content-container');
    const toggleBtnWrapper = document.createElement('div');
    toggleBtnWrapper.className = 'flex justify-end px-4 md:px-6 mb-2';
    toggleBtnWrapper.innerHTML = `
        <button id="toggleTimeCardBtn" class="text-sm font-semibold text-blue-700 hover:underline flex items-center gap-1">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>
            Visa Tidkort
        </button>
    `;
    inner.querySelector('.pb-0').appendChild(toggleBtnWrapper); // Insert after header

    let isTimeCard = false;
    const toggleView = () => {
      isTimeCard = !isTimeCard;
      const btn = inner.querySelector('#toggleTimeCardBtn');
      if (isTimeCard) {
        renderTimeCard(contentContainer, eq, d);
        btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7"></path></svg> Visa Detaljer`;
      } else {
        renderMarathonContent(contentContainer, eq, d);
        btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg> Visa Tidkort`;
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
      `;
    document.head.appendChild(s);
  }
}