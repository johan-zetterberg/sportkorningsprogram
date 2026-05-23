import { computeMaxSecondsForClass, calculatePrecisionTimePenalty } from '../../utils/precisionUtils.js';
import { stageStartTS } from '../../utils/marathonUtils.js';
import { calculateLiveInjection, getTotalRanking } from './speakerCalculations.js';

export function updateLiveClocks(context) {
    const {
        currentRider,
        isGloballyPaused,
        pauseStartTime,
        currentDiscipline,
        precisionConfig,
        activeEquipages,
        formatMsLive,
        pausedMsSince
    } = context;

    if (!currentRider) return;

    // Precision Live Time
    const pTimeEl = document.getElementById('precision-live-time');
    const pPenEl = document.getElementById('precision-live-time-penalty');
    const pTotEl = document.getElementById('precision-live-total');

    const tickTimeNow = isGloballyPaused ? pauseStartTime : Date.now();

    if (pTimeEl && currentDiscipline === 'precision') {
        const d = currentRider.data || currentRider.statusData || {};
        const eq = currentRider.eq;

        if (d.running && d.liveStartEpoch) {
            const ms = (d.livePausedMs || 0) + (tickTimeNow - d.liveStartEpoch);
            pTimeEl.textContent = formatMsLive(ms);

            // Live Penalty Ticker
            if (pPenEl && pTotEl) {
                const maxSec = computeMaxSecondsForClass(eq.className, precisionConfig);
                const liveTimePen = calculatePrecisionTimePenalty(ms, maxSec);

                // Update Time Penalty Display
                pPenEl.textContent = liveTimePen > 0 ? liveTimePen.toFixed(2) : (d.timePenalty || 0).toFixed(2);

                // Update Total Penalty Display (Obstacle + Time + Extra)
                const obsPen = d.liveObstaclePenalty || d.obstaclePenalty || 0;
                const extraPen = d.extraPenalty || 0;
                const total = obsPen + liveTimePen + extraPen;

                if (!d.eliminated) {
                    pTotEl.textContent = total.toFixed(2);
                }
            }
        }
    }

    // 3. Central Speaker Card (Rank, Margin, etc)
    const cardRankEl = document.getElementById('speaker-live-rank');
    const cardTotalEl = document.getElementById('speaker-live-total');
    const cardMarginEl = document.getElementById('speaker-live-margin');

    if (currentRider && currentRider.eq && (cardRankEl || cardTotalEl || cardMarginEl)) {
        const eq = currentRider.eq;
        const liveInjection = calculateLiveInjection(eq, context);
        const totalRanking = getTotalRanking(eq.className, liveInjection, context);
        const myIdx = totalRanking.findIndex(r => String(r.sn) === String(eq.startNumber));

        if (myIdx !== -1) {
            const myR = totalRanking[myIdx];
            if (cardRankEl) cardRankEl.textContent = (myIdx + 1);
            if (cardTotalEl && myR.total != null && myR.total !== Infinity) cardTotalEl.textContent = myR.total.toFixed(2);

            if (cardMarginEl && totalRanking.length > 1) {
                const others = totalRanking.filter(r => String(r.sn) !== String(eq.startNumber) && !r.isEliminated);
                if (others.length > 0 && myR.total != null) {
                    const leader = others[0];
                    const diff = myR.total - leader.total;
                    const isLeader = myIdx === 0;

                    if (isLeader) {
                        const nextBest = others[0].total; // Wait, if I'm leader, others[0] IS the next best
                        if (nextBest != null) {
                            const margin = nextBest - myR.total;
                            cardMarginEl.textContent = `Segermarginal: ${Math.abs(margin).toFixed(2)}`;
                            cardMarginEl.className = "text-xs mt-1 font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded border border-green-200";
                        }
                    } else {
                        const leaderTotal = totalRanking[0].total;
                        if (leaderTotal != null) {
                            const behind = myR.total - leaderTotal;
                            cardMarginEl.textContent = `Upp till ledning: +${behind.toFixed(2)}`;
                            cardMarginEl.className = "text-xs mt-1 font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded border border-red-200";
                        }
                    }
                }
            }
        }
    }

    // Marathon Live Time
    const mTimeEl = document.getElementById('marathon-live-time');


    if (currentDiscipline === 'maraton') {
        const d = currentRider ? (currentRider.data || currentRider.statusData || {}) : {};
        const active = currentRider ? activeEquipages.get(String(currentRider.eq.startNumber)) : null;

        // 1. Rider Card Timer
        if (mTimeEl) {
            let handled = false;

            // Priority: Active Equipage (Source of Truth)
            if (active && (active.timerBaseMs > 0 || active.fixedElapsedMs != null)) {
                const ms = Math.max(0, active.fixedElapsedMs != null ? active.fixedElapsedMs : (active.timerBaseMs ? (tickTimeNow - active.timerBaseMs) - pausedMsSince(active.timerBaseMs, tickTimeNow) : 0));
                mTimeEl.textContent = formatMsLive(ms);
                handled = true;
            }

            // Fallback: Legacy Logic (if not found in active list but looks running)
            if (!handled && d.running) {
                // ... (Existing fallback logic or simplified) ...
                if (d.liveObstacleStartAt) {
                    const start = d.liveObstacleStartAt.toMillis ? d.liveObstacleStartAt.toMillis() : d.liveObstacleStartAt;
                    if (start > 0) {
                        mTimeEl.textContent = formatMsLive(tickTimeNow - start);
                        handled = true;
                    }
                }
                if (!handled && d.currentStage) {
                    const rawStage = d.currentStage;
                    let s = String(rawStage || '').trim();
                    s = s.replace(/^etapp\s+/i, '').trim();
                    if (/^transport/i.test(s)) s = 'transport';
                    if (s.length > 1 && /[ABT]$/i.test(s)) s = s.slice(-1);
                    if (s.toUpperCase() === 'T') s = 'transport';

                    const start = stageStartTS(d, s);
                    if (start > 0) {
                        mTimeEl.textContent = formatMsLive(tickTimeNow - start - pausedMsSince(start, tickTimeNow));
                        handled = true;
                    }
                }
            }
        }

        // 2. Sector Analysis Timers
        const sectorTimers = document.querySelectorAll('.sector-live-timer');
        sectorTimers.forEach(el => {
            const sn = el.dataset.sn;
            const startStr = el.dataset.start;
            const idealStr = el.dataset.ideal;
            const targetStage = el.dataset.stage;

            if (!idealStr) return;

            const ideal = Number(idealStr);
            let sec = 0;
            let handled = false;

            // Check ActiveEquipages first (Strict Stage Match)
            const act = sn ? activeEquipages.get(String(sn)) : null;
            if (act && (act.timerBaseMs > 0 || act.fixedElapsedMs != null)) {
                // Robust Match: If active task started at approximately the same time as the sector timer (data-start),
                // then we can trust the active record's pausedMs and startTime.
                // This avoids issues with key naming ('wait_b' vs 'transport' vs 'A') or case sensitivity.
                if (startStr && Math.abs((act.startTime || act.timerBaseMs) - Number(startStr)) < 2000) {
                    const ms = Math.max(0, act.fixedElapsedMs != null ? act.fixedElapsedMs : (act.timerBaseMs ? (tickTimeNow - act.timerBaseMs) - pausedMsSince(act.timerBaseMs, tickTimeNow) : 0));
                    sec = ms / 1000;
                    handled = true;
                } else {
                    // If start times don't match, the driver is likely in an obstacle (new start time).
                    // We must fall back to the stage timer using the stored stage start time.
                }
            }

            if (!handled && startStr && !isNaN(Number(startStr))) {
                // Fallback to data-start (calculated via stageStartTS)
                const start = Number(startStr);
                const ms = tickTimeNow - start - pausedMsSince(start, tickTimeNow);
                sec = ms / 1000;
            }

            const diff = sec - ideal;

            // Update Text
            const diffSign = diff > 0 ? '+' : '';
            const absDiff = Math.abs(diff);
            const m = Math.floor(absDiff / 60);
            const s = Math.floor(absDiff % 60);
            const renderTime = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

            el.textContent = `${diffSign}${renderTime}`;
            el.textContent = `${diffSign}${renderTime}`;
        });

        // 3. Sector Live Elapsed Time (The "Live / Result" column)
        const sectorElapsed = document.querySelectorAll('.sector-live-elapsed');
        sectorElapsed.forEach(el => {
            const sn = el.dataset.sn;
            const startStr = el.dataset.start;

            let ms = 0;
            let handled = false;

            const act = sn ? activeEquipages.get(String(sn)) : null;
            if (act && (act.timerBaseMs > 0 || act.fixedElapsedMs != null)) {
                // Robust Match: Proximity check (same as above)
                if (startStr && Math.abs((act.startTime || act.timerBaseMs) - Number(startStr)) < 2000) {
                    ms = Math.max(0, act.fixedElapsedMs != null ? act.fixedElapsedMs : (act.timerBaseMs ? (tickTimeNow - act.timerBaseMs) - pausedMsSince(act.timerBaseMs, tickTimeNow) : 0));
                    handled = true;
                }
            }

            if (!handled && startStr && !isNaN(Number(startStr))) {
                const start = Number(startStr);
                ms = tickTimeNow - start - pausedMsSince(start, tickTimeNow);
            }

            if (ms > 0) {
                el.textContent = formatMsLive(ms);
            }
        });
    }
}

export function ensureMainTicker(getContext) {
    if (window.marathonLiveInterval) return;
    window.marathonLiveInterval = setInterval(() => {
        const ctx = getContext();
        updateLiveClocks(ctx);
    }, 100);
}

export function stopLiveClock() {
    if (window.marathonLiveInterval) clearInterval(window.marathonLiveInterval);
    window.marathonLiveInterval = null;
}
