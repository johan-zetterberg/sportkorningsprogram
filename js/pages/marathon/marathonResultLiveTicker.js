import { isNum } from '../../utils/sharedUtils.js';
import { formatMsMMSS, formatObstacleSeconds } from './marathonResultFormatters.js';

const localLiveTickers = {};

export function rowStageCellsHTML(res, stageCols) {
  return (stageCols || []).map(stKey => {
    const sData = res.stages[stKey];
    let val = '\u2014';
    if (sData) {
      if (sData.eliminated) val = 'ELIM';
      else if (Number.isFinite(sData.timePenalty)) val = sData.timePenalty.toFixed(2);
    }

    return `<td class="px-2 py-1.5 lg:px-3 lg:py-2 text-center text-[11px] lg:text-sm">
      <span class="tabular-nums" data-stage-pts="${res.startNumber}" data-stage="${stKey}">${val}</span>
    </td>`;
  }).join('');
}

export function stopMarathonLiveTicker(sn) {
  const key = String(sn);
  if (localLiveTickers[key]) {
    clearInterval(localLiveTickers[key]);
    delete localLiveTickers[key];
  }
}

export function clearMarathonLiveTickers() {
  Object.values(localLiveTickers).forEach(clearInterval);
  Object.keys(localLiveTickers).forEach(k => delete localLiveTickers[k]);
}

export function startOrUpdateMarathonLiveTicker(sn, {
  getIsGloballyPaused,
  equipages,
  marathonMap,
  timingDocFor,
  stageKeys,
  stageStartTS,
  stageStopTS,
  stageDurationMsSaved,
  pausedMsSince,
  formatMsLive,
  limitsFor,
  getPauseTime,
  stagePenaltyFromMs,
  getObstacleCoefficient,
  calculateResult
}) {
  const key = String(sn);
  if (localLiveTickers[key]) return;

  const eq = equipages.find(e => String(e.startNumber) === key);

  const run = () => {
    if (getIsGloballyPaused()) {
      return;
    }

    const d = marathonMap.get(key) || {};
    const t = timingDocFor(key);

    let isAnythingRunning = false;
    let labelText = '';
    let timeText = '';
    let liveStageP = 0;
    let runningStage = null;

    for (const stage of stageKeys) {
      const s = stageStartTS(t, stage);
      const e = stageStopTS(t, stage);
      if (s && !e) {
        isAnythingRunning = true;
        runningStage = stage;
        const elapsedMs = (stageDurationMsSaved(t, stage) || 0) + (Date.now() - s - pausedMsSince(s));

        if (stage === 'A') {
          const limitsA = limitsFor(eq, 'A');
          const isFixedTimeA = limitsA && limitsA.isFixedTime;
          labelText = isFixedTimeA ? 'W' : 'A';
        } else if (stage === 'transport') {
          labelText = 'T';
        } else {
          labelText = stage;
        }
        timeText = formatMsLive(elapsedMs);

        const { points, elim } = stagePenaltyFromMs(elapsedMs, eq, stage);
        liveStageP = elim ? Infinity : (isNum(points) ? points : 0);
        document.querySelectorAll(`[data-stage-pts="${key}"][data-stage="${stage}"]`).forEach(el => {
          el.textContent = elim ? 'ELIM' : (isNum(points) ? points.toFixed(2) : '\u2014');
        });
        break;
      }
    }

    if (!isAnythingRunning) {
      const aStart = stageStartTS(t, 'A');
      const aStop = stageStopTS(t, 'A');
      const bStart = stageStartTS(t, 'B');
      if (aStart && aStop && !bStart) {
        const limitsA = limitsFor(eq, 'A');
        if (limitsA && limitsA.isFixedTime) {
          isAnythingRunning = true;
          const pauseTimeMs = getPauseTime() * 60 * 1000;
          const tlMs = limitsA.ideal * 1000;
          const etaBTimestamp = aStart + tlMs + pauseTimeMs + pausedMsSince(aStart);
          const timeLeftMs = etaBTimestamp - Date.now();
          labelText = 'ETA B';
          timeText = timeLeftMs >= 0
            ? formatMsMMSS(timeLeftMs)
            : '-' + formatMsMMSS(Math.abs(timeLeftMs));
        }
      }
    }

    let liveObsP = 0;
    const obsNr = Number(d.currentObstacle);
    if (d.running === true && Number.isFinite(obsNr)) {
      isAnythingRunning = true;
      const lastUpdateMs = Number(d.liveObstacleTimeMs) || 0;
      const lastUpdateTime = d.updatedAt?.toMillis ? d.updatedAt.toMillis() : Date.now();
      const obsTimeMs = lastUpdateMs + (Date.now() - lastUpdateTime - pausedMsSince(lastUpdateTime));

      labelText = `H${d.currentObstacle}`;
      timeText = formatMsLive(obsTimeMs);

      const obsCoeff = (typeof getObstacleCoefficient === 'function')
        ? (getObstacleCoefficient(eq.className) || 1.0)
        : 1.0;
      liveObsP = (obsTimeMs / 1000) * obsCoeff;
    }

    document.querySelectorAll(`td[data-sn="${key}"] span[data-cell="obsVal"]`).forEach(el => {
      el.classList.remove('text-amber-700', 'animate-pulse', 'font-bold');
    });

    if (isAnythingRunning) {
      document.querySelectorAll(`[data-live-label="${key}"]`).forEach(el => {
        el.textContent = labelText;
      });
      document.querySelectorAll(`[data-live-time="${key}"]`).forEach(el => {
        el.textContent = timeText;
        el.classList.add('text-amber-700', 'animate-pulse', 'font-semibold');
      });

      if (d.running === true && Number.isFinite(obsNr)) {
        document.querySelectorAll(`td[data-sn="${key}"][data-obs="${obsNr}"] span[data-cell="obsVal"]`).forEach(el => {
          el.textContent = formatObstacleSeconds(obsTimeMs / 1000);
          el.classList.add('text-amber-700', 'animate-pulse', 'font-bold');
        });
      }

      try {
        const baseRes = calculateResult(eq, d, t);
        let liveTotal = baseRes.totalPenalty;
        let liveObsSum = baseRes.obstacles.sum || 0;

        if (runningStage && Number.isFinite(liveStageP) && liveStageP > 0) {
          const baseStageP = baseRes.stages[runningStage]?.timePenalty || 0;
          if (baseStageP === 0) {
            const base = Number.isFinite(liveTotal) ? liveTotal : 0;
            liveTotal = (liveTotal === Infinity) ? Infinity : (base + liveStageP);
          }
        }

        if (Number.isFinite(liveObsP) && liveObsP > 0) {
          const base = Number.isFinite(liveTotal) ? liveTotal : 0;
          liveTotal = (liveTotal === Infinity) ? Infinity : (base + liveObsP);
          liveObsSum += liveObsP;
        }

        const liveTotalLabel = (liveTotal === Infinity) ? 'ELIM' : (isNum(liveTotal) ? liveTotal.toFixed(2) : '\u2014');

        document.querySelectorAll(`td[data-sn="${key}"][data-cell="obsSum"]`).forEach(el => {
          el.textContent = liveObsSum.toFixed(2);
        });

        document.querySelectorAll(`[data-total-pen="${key}"]`).forEach(el => {
          el.textContent = liveTotalLabel;
        });
      } catch (err) {
        console.error('Total penalty tick error:', err);
      }
    } else {
      document.querySelectorAll(`[data-live-time="${key}"]`).forEach(el => {
        el.textContent = '\u2014';
        el.classList.remove('text-amber-700', 'animate-pulse', 'font-semibold');
      });
      document.querySelectorAll(`[data-live-label="${key}"]`).forEach(el => el.textContent = '');
      stopMarathonLiveTicker(key);
    }
  };

  run();
  localLiveTickers[key] = setInterval(run, 95);
}
