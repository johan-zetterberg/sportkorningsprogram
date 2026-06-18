import {
    getSpeakerDisciplineResult,
    getSpeakerDisciplineState
} from './speakerResults.js';
import { getLeaderToBeat, getTotalRanking } from './speakerCalculations.js';
import {
    matchesDisplayClass,
    isWithdrawnOrExcluded,
    formatTime
} from './speakerHelpers.js';
import {
    calculateClassObstacleStats,
    calculateClassSplitStats
} from '../../utils/marathonUtils.js';
import { escapeHtml } from '../../utils/sharedUtils.js';
import { formatSpeakerPenalty, getSpeakerPenaltyOrNull, isFiniteSpeakerNumber } from './speakerFormatUtils.js';

const escapeAttr = (value) => escapeHtml(value ?? '');

export function renderTop3List(className, discipline, ctx) {
    if (!className) return '';
    let results = [];
    const { allEquipages } = ctx;

    if (discipline === 'dressyr') {
        allEquipages.forEach(eq => {
            if (!matchesDisplayClass(eq, className)) return;
            const sn = String(eq.startNumber);
            const result = getSpeakerDisciplineResult(eq, 'dressyr', ctx);
            const pen = result.penalty;
            if (pen != null) {
                results.push({
                    sn: sn,
                    name: eq.driverName,
                    club: eq.clubName,
                    eq: eq,
                    penalty: Number(pen),
                    percent: Number(result.percent || 0)
                });
            }
        });
        results = results.filter(r => r.penalty > 0.01);
        results.sort((a, b) => a.penalty - b.penalty);
    } else if (discipline === 'maraton') {
        allEquipages.forEach(eq => {
            if (!matchesDisplayClass(eq, className)) return;
            const sn = String(eq.startNumber);
            const result = getSpeakerDisciplineResult(eq, 'maraton', ctx);
            if (result.penalty != null) {
                results.push({
                    sn: sn,
                    name: eq.driverName,
                    club: eq.clubName,
                    eq: eq,
                    penalty: result.penalty
                });
            }
        });
        results.sort((a, b) => a.penalty - b.penalty);
    } else if (discipline === 'precision') {
        allEquipages.forEach(eq => {
            if (!matchesDisplayClass(eq, className)) return;
            const sn = String(eq.startNumber);
            const result = getSpeakerDisciplineResult(eq, 'precision', ctx);
            if (result.penalty != null) {
                results.push({
                    sn: sn,
                    name: eq.driverName,
                    club: eq.clubName,
                    eq: eq,
                    penalty: result.penalty
                });
            }
        });
        results.sort((a, b) => a.penalty - b.penalty);
    } else if (discipline === 'totalt') {
        const rows = getTotalRanking(className, null, ctx);
        rows.forEach(r => {
            if (!r.isEliminated && r.totalPenalty != null) {
                results.push({
                    sn: r.startNumber,
                    name: r.driverName,
                    club: r.clubName,
                    eq: { startNumber: r.startNumber, driverName: r.driverName, clubName: r.clubName },
                    penalty: r.totalPenalty
                });
            }
        });
        results.sort((a, b) => a.penalty - b.penalty);
    }

    if (results.length === 0) return '';

    const top3 = results.slice(0, 3);
    const cells = top3.map((r, i) => {
        const medalColor = i === 0 ? 'text-yellow-500' : (i === 1 ? 'text-gray-400' : 'text-amber-600');
        return `
            <div class="flex items-center justify-between p-2 rounded bg-gray-50 dark:bg-gray-700">
                <div class="flex items-center gap-2">
                    <span class="font-bold ${medalColor}">${i + 1}</span>
                    <span class="text-sm font-medium text-gray-900 dark:text-white">${escapeHtml(r.name || '')}</span>
                </div>
                <div class="text-sm font-bold text-gray-900 dark:text-white">
                    ${formatSpeakerPenalty(r.penalty)}
                </div>
            </div>
        `;
    }).join('');

    return `<div class="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">${cells}</div>`;
}

export function renderLeaderToBeat(className, ctx) {
    const leader = ctx.currentDiscipline === 'precision'
        ? getChasingTarget(className, ctx.currentRider?.data?.liveTotalPenalty || ctx.currentRider?.data?.totalPenalty || 0, ctx)
        : getLeaderToBeat(className, ctx.currentDiscipline, ctx);

    if (!leader) return '';

    const label = ctx.currentDiscipline === 'dressyr' ? 'Att slå' : (leader.isLeader ? 'Ledarresultat' : 'Jagar');
    let val = ctx.currentDiscipline === 'dressyr'
        ? (isFiniteSpeakerNumber(leader.score) ? leader.score.toFixed(1) + '%' : '—')
        : formatSpeakerPenalty(leader.score, { eliminated: leader.score === Infinity });

    if (ctx.currentDiscipline === 'precision' && leader.time) {
        val += ` <span class="text-xs font-normal">(${leader.time})</span>`;
    }

    let diffHtml = '';
    if (ctx.currentDiscipline === 'precision' && ctx.currentRider) {
        const currentPen = getSpeakerPenaltyOrNull(ctx.currentRider.data?.liveTotalPenalty);
        const leaderScore = getSpeakerPenaltyOrNull(leader.score);
        const diff = currentPen !== null && leaderScore !== null ? currentPen - leaderScore : null;
        if (diff !== null && diff > 0) {
            diffHtml = `<span class="ml-2 text-xs font-bold text-red-500">(+${diff.toFixed(2)})</span>`;
        } else if (diff !== null && diff < 0) {
            diffHtml = `<span class="ml-2 text-xs font-bold text-green-500">(${diff.toFixed(2)})</span>`;
        }
    }

    return `
    <div class="mt-2 text-sm text-gray-500 dark:text-gray-400 border-l-2 border-gray-300 dark:border-gray-600 pl-2">
        <div class="uppercase font-bold text-[10px] tracking-wider text-gray-400 dark:text-gray-500">${label}:</div>
        <div>
            <span class="tabular-nums tracking-wide font-bold text-lg text-gray-800 dark:text-gray-200">${val}</span> ${diffHtml}
        </div>
        <div class="text-xs text-gray-600 dark:text-gray-400 truncate max-w-[200px]">${escapeHtml(leader.name || '')}</div>
    </div>
    `;
}

export function getChasingTarget(className, currentPenalty, ctx) {
    if (!className) return null;
    const finished = [];
    ctx.allEquipages.forEach(eq => {
        if (!matchesDisplayClass(eq, className)) return;
        if (ctx.currentRider && eq.startNumber === ctx.currentRider.eq.startNumber) return;
        const result = getSpeakerDisciplineResult(eq, 'precision', ctx);
        const st = ctx.precisionStatusMap.get(String(eq.startNumber));
        if (result.penalty != null && getSpeakerDisciplineState(eq, 'precision', ctx).finished) {
            finished.push({
                score: result.penalty || 0,
                name: eq.driverName,
                time: st.time || '',
                timeMs: result.timeMs || st?.timeMs || 0
            });
        }
    });

    finished.sort((a, b) => {
        if (Math.abs(a.score - b.score) > 0.01) return a.score - b.score;
        return a.timeMs - b.timeMs;
    });

    if (finished.length === 0) return null;

    const better = finished.filter(r => r.score <= currentPenalty);

    if (better.length === 0) {
        const l = finished[0];
        return { ...l, isLeader: true };
    }

    const target = better[better.length - 1];
    return { ...target, isLeader: target === finished[0] };
}

export function getStartTimeForSort(sn, ctx) {
    const s = String(sn);
    let val = null;
    if (ctx.currentDiscipline === 'dressyr') val = ctx.startTimes[s]?.dressage;
    else if (ctx.currentDiscipline === 'maraton') val = ctx.startTimes[s]?.maraton;
    else if (ctx.currentDiscipline === 'precision') val = ctx.startTimes[s]?.precision;

    if (!val) return Number.MAX_SAFE_INTEGER;
    if (val.includes('T')) return new Date(val).getTime();
    return new Date('1970-01-01T' + (val.length === 5 ? val + ':00' : val)).getTime();
}

export function getStartTimeForDisplay(sn, ctx) {
    const s = String(sn);
    let val = null;
    if (ctx.currentDiscipline === 'dressyr') val = ctx.startTimes[s]?.dressage;
    else if (ctx.currentDiscipline === 'maraton') val = ctx.startTimes[s]?.maraton;
    else if (ctx.currentDiscipline === 'precision') val = ctx.startTimes[s]?.precision;
    if (!val) return '—';
    if (val.includes('T')) return formatTime(val);
    return val;
}

export function renderUpcomingList(ctx) {
    const el = document.getElementById('upcoming-list-content') || document.getElementById('upcoming-list');
    if (!el) return;

    const upcoming = ctx.allEquipages.filter(eq => {
        const sn = String(eq.startNumber);

        let state = 'not-started';
        const disciplineState = getSpeakerDisciplineState(eq, ctx.currentDiscipline, ctx);

        if (ctx.currentDiscipline === 'dressyr') {
            const st = ctx.dressageStatusMap.get(sn) || {};
            state = st.state || eq.status || 'not-started';
            if (st.finalPenalty != null && st.state === 'finished') state = 'finished';
            if (ctx.currentRider && String(ctx.currentRider.eq.startNumber) === sn) return false;
        } else if (ctx.currentDiscipline === 'maraton') {
            const st = ctx.maratonStatusMap.get(sn) || {};
            if (st.times && Object.keys(st.times).length > 0) state = 'started';
            if (ctx.currentRider && String(ctx.currentRider.eq.startNumber) === sn) return false;
        } else if (ctx.currentDiscipline === 'precision') {
            const st = ctx.precisionStatusMap.get(sn) || {};
            if (st.inProgress || st.finalized || st.totalPenalty != null) state = 'started';
            if (ctx.currentRider && String(ctx.currentRider.eq.startNumber) === sn) return false;
        }

        let isFinished = disciplineState.started || disciplineState.finished || String(state).toLowerCase() === 'finished' || state === 'started';
        if (ctx.recentResults.some(r => String(r.sn) === sn)) isFinished = true;

        return !isFinished && !isWithdrawnOrExcluded(state, { ...eq });
    }).sort((a, b) => {
        const tA = getStartTimeForSort(a.startNumber, ctx);
        const tB = getStartTimeForSort(b.startNumber, ctx);
        return tA - tB;
    }).slice(0, 10);

    if (upcoming.length === 0) {
        el.innerHTML = '<div class="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">Inga fler starter.</div>';
        return;
    }

    const listHtml = upcoming.map(eq => {
        const t = getStartTimeForDisplay(eq.startNumber, ctx);
        return `
    <div class="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700 rounded hover:bg-white dark:hover:bg-gray-600 border border-transparent hover:border-gray-200 dark:hover:border-gray-500 transition-colors">
            <div class="min-w-0">
                <div class="font-bold text-gray-900 dark:text-white truncate">#${escapeHtml(String(eq.startNumber ?? ''))} ${escapeHtml(eq.driverName || '')}</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 truncate">${escapeHtml(eq.clubName || '')}</div>
            </div>
            <div class="text-right shrink-0">
                 <div class="tabular-nums tracking-wide font-bold text-brand-darkblue dark:text-blue-300">${t}</div>
            </div>
        </div>
    `}).join('');

    el.innerHTML = `
        <div class="h-full overflow-y-auto pr-2 flex flex-col gap-1" style="max-height: 250px;">
            ${listHtml}
        </div>`;
}

export function renderRecentResultsList(ctx) {
    const el = document.getElementById('recent-results-list');
    if (!el) return;

    const list = [...ctx.recentResults].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    if (list.length === 0) {
        el.innerHTML = '<div class="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">Inga resultat ännu.</div>';
        return;
    }

    el.innerHTML = list.map(r => {
        const eq = ctx.allEquipages.find(e => String(e.startNumber) === String(r.sn));
        const className = eq?.className;

        let gapHtml = '';
        if (className && Number.isFinite(r.finalPenalty)) {
            const classResults = ctx.recentResults.filter(rr => {
                const re = ctx.allEquipages.find(e => String(e.startNumber) === String(rr.sn));
                return re && matchesDisplayClass(re, className) && Number.isFinite(rr.finalPenalty);
            });

            if (classResults.length > 0) {
                const best = Math.min(...classResults.map(cr => cr.finalPenalty));
                const diff = r.finalPenalty - best;
                if (diff > 0.001) {
                    gapHtml = `<span class="text-[10px] text-red-500 tabular-nums tracking-wide ml-2">(+${diff.toFixed(2)})</span>`;
                } else {
                    gapHtml = `<span class="text-[10px] text-green-600 font-bold ml-2">LEDER</span>`;
                }
            }
        }

        return `
        <div onclick="showRiderDetails('${escapeAttr(String(r.sn ?? ''))}')" class="p-2 border-b dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors">
            <div class="flex justify-between items-baseline mb-1">
                <div class="flex items-center">
                     <span class="font-bold text-gray-900 dark:text-gray-200 mr-2">#${escapeHtml(String(r.sn ?? ''))} ${escapeHtml(r.name || '')}</span>
                     ${gapHtml}
                </div>
                <span class="font-bold text-blue-600 dark:text-blue-400">${Number.isFinite(r.finalPenalty) ? r.finalPenalty.toFixed(2) : '-'} p</span>
            </div>
            <div class="flex justify-between items-center text-xs text-gray-500 dark:text-gray-400">
                <span>${escapeHtml(r.clubName || '')}</span>
                <span>${Number.isFinite(r.finalPercent) && ctx.currentDiscipline === 'dressyr' ? r.finalPercent.toFixed(1) + '%' : ''}</span>
            </div>
        </div>
    `}).join('');
}

function getValidFirstPasses(splits) {
    if (!splits || !Array.isArray(splits)) return [];
    const valid = [];
    const seen = new Set();
    for (const s of splits) {
        if (!s.char || s.char !== s.char.toUpperCase()) continue;
        if (!seen.has(s.char)) {
            seen.add(s.char);
            valid.push(s);
        }
    }
    return valid;
}

// Extracted from formatMsLive or pausedMsSince dependencies for ActiveList:
// We use ctx.formatMsLive and ctx.pausedMsSince to avoid importing all of sharedUtils/marathonUtils again.
export function renderActiveListNew(ctx) {
    const container = document.getElementById('active-list-container');
    const el = document.getElementById('active-list-content') || document.getElementById('active-list');

    if (ctx.currentDiscipline !== 'maraton' && ctx.currentDiscipline !== 'totalt') {
        if (container) container.classList.add('hidden');
        const upcoming = document.getElementById('upcoming-list-container');
        if (upcoming) {
            upcoming.style.height = '50%';
            upcoming.classList.remove('h-1/4');
        }
        return;
    }

    if (!container || !el) return;

    container.classList.remove('hidden');
    container.style.display = 'flex';
    container.classList.add('flex-1');
    container.style.height = 'auto';
    container.style.minHeight = '300px';

    const upcoming = document.getElementById('upcoming-list-container');
    if (upcoming) {
        upcoming.style.height = '15%';
        upcoming.classList.remove('h-1/3', 'h-1/4', 'hidden');
    }

    const sourceArr = ctx.activeEquipages.size > 0 ? Array.from(ctx.activeEquipages.values()) : [];
    const hotList = [];
    const onCourseList = [];

    sourceArr.forEach(c => {
        if (c.task && (c.task.type === 'obstacle' || c.task.type === 'result_flash')) hotList.push(c);
        else onCourseList.push(c);
    });

    if (hotList.length === 0 && onCourseList.length === 0) {
        el.innerHTML = '<div class="text-xs text-gray-500 dark:text-gray-400 text-center p-8 bg-gray-50 dark:bg-gray-800 rounded italic">Inga aktiva på banan (Väntar på start). <br>Klicka ⚡ för test.</div>';
        return;
    }

    let html = '';

    if (hotList.length > 0) {
        html += `<div class="mb-2 space-y-2">`;
        html += hotList.map(c => {
            const isSelected = (ctx.manualFocusId && String(ctx.manualFocusId) === String(c.sn));
            const obsNum = c.task.type === 'result_flash' ? c.task.data.number : c.task.key;
            const stats = calculateClassObstacleStats(c.eq.className, obsNum, ctx.maratonStatusMap, ctx.allEquipages);

            let statsHtml = '';
            if (stats && stats.bestTime) {
                statsHtml = `
                 <div class="flex items-center gap-2 mt-1 bg-white/50 dark:bg-gray-800/50 p-1 rounded">
                    <span class="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-bold">Mål att slå:</span>
                    <span class="tabular-nums tracking-wide font-bold text-green-700 dark:text-green-400">${stats.bestTime.toFixed(2)}s</span>
                 </div>`;
            }

            let splitText = '';
            const rawSplitsArray = c.task.type === 'result_flash' ? c.task.data.gateSplits : c.data.live_gateSplits;
            const splitsArray = getValidFirstPasses(rawSplitsArray);
            if (splitsArray && splitsArray.length > 0) {
                const classStats = calculateClassSplitStats(c.eq.className, obsNum, ctx.maratonStatusMap, ctx.allEquipages);
                const recentSplits = splitsArray.slice(-3);

                splitText = recentSplits.map(s => {
                    let colorClass = 'text-gray-500';
                    let title = '';

                    let obsStart = null;
                    if (c.task.type === 'result_flash' && c.task.data.enteredAt) {
                        obsStart = c.task.data.enteredAt;
                    } else {
                        obsStart = c.data.liveObstacleStartAt || c.data.live_staticStartAt;
                    }

                    if (obsStart && obsStart.toMillis) obsStart = obsStart.toMillis();
                    else if (typeof obsStart === 'string') obsStart = new Date(obsStart).getTime();

                    if (!obsStart && c.data.obstacleTimes && c.data.obstacleTimes[obsNum]) {
                        const ot = c.data.obstacleTimes[obsNum];
                        obsStart = ot.enteredAt || ot.enteredAtClient;
                        if (typeof obsStart === 'string') obsStart = new Date(obsStart).getTime();
                    }

                    let splitTs = s.ts?.toMillis ? s.ts.toMillis() : (typeof s.ts === 'string' ? new Date(s.ts).getTime() : s.ts);
                    let displayTime = s.time;

                    if (obsStart && splitTs && !Number.isFinite(displayTime)) {
                        displayTime = (splitTs - obsStart) / 1000;
                    }

                    if (s.char && classStats[s.char] && obsStart && splitTs) {
                        const stat = classStats[s.char];
                        const diff = splitTs - obsStart;
                        if (diff <= stat.best + 100) {
                            colorClass = 'text-green-600 dark:text-green-400 font-bold bg-green-50 dark:bg-green-900/30 px-1 rounded';
                            title = `Bäst! (${(stat.best / 1000).toFixed(1)}s)`;
                        } else if (diff < stat.avg) {
                            colorClass = 'text-blue-600 dark:text-blue-400 font-semibold';
                            title = `Bättre än snitt (${(stat.avg / 1000).toFixed(1)}s)`;
                        } else {
                            colorClass = 'text-amber-600 dark:text-amber-400';
                            title = `Sämre än snitt (${(stat.avg / 1000).toFixed(1)}s)`;
                        }
                    }

                    return `<span class="text-[10px] tabular-nums tracking-wide ml-1 ${colorClass}" title="${title}">(${s.char}: ${Number.isFinite(displayTime) ? displayTime.toFixed(1) : '-'})</span>`;
                }).join('');
            }

            let timeTxt = '00:00,00';
            if (c.timerBaseMs > 0 || c.fixedElapsedMs != null) {
                const tickTimeNow = ctx.isGloballyPaused ? ctx.pauseStartTime : Date.now();
                const ms = Math.max(0, c.fixedElapsedMs != null ? c.fixedElapsedMs : (c.timerBaseMs ? (tickTimeNow - c.timerBaseMs) - ctx.pausedMsSince(c.timerBaseMs, tickTimeNow) : 0));
                timeTxt = ctx.formatMsLive(ms);
            }

            return `
            <div onclick="selectSpeakerRider('${escapeAttr(String(c.sn ?? ''))}')" class="cursor-pointer bg-amber-50 dark:bg-amber-900/20 border-l-4 border-amber-500 dark:border-amber-600 p-3 rounded shadow-sm hover:shadow-md transition-all ${isSelected ? 'ring-2 ring-amber-400' : ''}">
                <div class="flex justify-between items-start">
                    <div>
                        <div class="font-black text-lg text-gray-900 dark:text-white leading-none">#${escapeHtml(String(c.sn ?? ''))} ${escapeHtml(c.eq?.driverName || '')}</div>
                        <div class="text-xs text-amber-800 dark:text-amber-200 font-bold mt-1 uppercase tracking-wide">${c.task.type === 'result_flash' ? 'Resultat Hinder' : 'Hinder'} ${obsNum} ${splitText}</div>
                    </div>
                    <div class="text-3xl tabular-nums tracking-wide font-black text-gray-800 dark:text-gray-200 tracking-tight" id="maraton-timer-${c.sn}">${timeTxt}</div>
                </div>
                ${statsHtml}
            </div>`;
        }).join('');
        html += `</div>`;
    }

    if (onCourseList.length > 0) {
        if (hotList.length > 0) {
            html += `<div class="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1 mt-3 px-1">Övriga på banan</div>`;
        }

        html += `<div class="space-y-1">`;
        html += onCourseList.map(c => {
            const isSelected = (ctx.manualFocusId && String(ctx.manualFocusId) === String(c.sn));
            let timeTxt = '--:--';
            let limitsHtml = '';

            if (c.timerBaseMs > 0 || c.fixedElapsedMs != null) {
                const tickTimeNow = ctx.isGloballyPaused ? ctx.pauseStartTime : Date.now();
                const ms = Math.max(0, c.fixedElapsedMs != null ? c.fixedElapsedMs : (c.timerBaseMs ? (tickTimeNow - c.timerBaseMs) - ctx.pausedMsSince(c.timerBaseMs, tickTimeNow) : 0));
                timeTxt = ctx.formatMsLive(ms);

                if (c.task && (c.task.key === 'A' || c.task.key === 'B')) {
                    const limits = ctx.limitsFor(c.eq, c.task.key);
                    if (limits && limits.max) {
                        const allowedMs = limits.max * 1000;
                        const allowedTxt = ctx.formatMsLive(allowedMs);

                        let color = 'text-gray-400 dark:text-gray-500';
                        if (ms > allowedMs) color = 'text-red-600 dark:text-red-400 font-bold';
                        else if (limits.min && ms < (limits.min * 1000) && ms > (allowedMs * 0.8)) color = 'text-yellow-600 dark:text-yellow-400';
                        const remaining = allowedMs - ms;
                        if (remaining < 60000 && remaining > 0) color = 'text-amber-600 dark:text-amber-400';

                        limitsHtml = `<span class="text-[10px] ${color} ml-1">/ ${allowedTxt}</span>`;
                    }
                }
            }

            return `
             <div onclick="selectSpeakerRider('${escapeAttr(String(c.sn ?? ''))}')" class="flex items-center justify-between p-2 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-500 cursor-pointer ${isSelected ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700' : ''}">
                <div class="flex items-center gap-2 overflow-hidden">
                    <span class="font-bold text-gray-700 dark:text-gray-300 text-xs w-8">#${escapeHtml(String(c.sn ?? ''))}</span>
                    <span class="text-sm font-semibold text-gray-900 dark:text-white truncate">${escapeHtml(c.eq?.driverName || '')}</span>
                </div>
                <div class="flex items-center gap-3">
                    <span class="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 tabular-nums tracking-wide">${c.task.name}</span>
                    <div class="text-right">
                         <span class="text-xs tabular-nums tracking-wide font-bold text-gray-800 dark:text-gray-200" id="maraton-timer-${c.sn}">${timeTxt}</span>
                         ${limitsHtml}
                    </div>
                </div>
             </div>`;
        }).join('');
        html += `</div>`;
    }

    el.innerHTML = html;
}
