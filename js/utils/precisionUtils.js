// js/utils/precisionUtils.js
// Samlad hjälplogik för precision – används av både resultatvyn och PDF:en.

// (Borttagen import från calculationService)
import { klassTempoData, standardPortAllowance } from '../data/competitionData.js';
import { getFlagHtml } from '../services/flagsService.js';
import { getClubLogoHtml } from '../services/logosService.js';
import {
    isNum,
    msToLabel,
    horseLabel,
    horseLabelStacked,
    stackName,
    round2,
    computeTotalPenalty,
    fmt2
} from './sharedUtils.js';
import { getGlobalState } from '../main.js';
import {
    calculatePrecisionResult as _calculatePrecisionResult,
    calculatePrecisionTimePenalty as _calculatePrecisionTimePenalty,
    computeMaxSecondsForClass as _pureComputeMaxSecondsForClass
} from './precisionCalculation.js';

const _norm = (s) => String(s || '').replace(/^[\d\s\.,&\;-]+/, '').toLowerCase().replace(/[^a-z0-9åäö]/g, '');

// -------------------------------------------------------------
// Status-badge
// -------------------------------------------------------------
export function statusClass(status) {
    if (status) {
        const s = status.toLowerCase();
        if (s.includes('utesluten') || s.includes('elim')) return 'bg-red-600 text-white border-red-700 dark:bg-red-900/50 dark:text-red-300 dark:border-red-800 font-bold';
        if (s.includes('klar')) return 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800';
        if (s.includes('pågår')) return 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-800';
    }
    return 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-700/50 dark:text-gray-300 dark:border-gray-600';
}

// -------------------------------------------------------------
// Vagnbredd (spårvidd)
// -------------------------------------------------------------
export function trackWidthFromEq(eq) {
    if (!eq) return null;
    const v = Number(eq.trackWidthCm ?? eq.trackWidth);
    return Number.isFinite(v) && v > 0 ? v : null;
}

// -------------------------------------------------------------
// Straffberäkning (Tid)
// -------------------------------------------------------------
export function calculatePrecisionTimePenalty(timeMs, maxTimeSec, timePenaltyRate = 0.5) {
    return _calculatePrecisionTimePenalty(timeMs, maxTimeSec, timePenaltyRate);
}

// -------------------------------------------------------------
// Porttillägg & portbredd
// -------------------------------------------------------------
function resolveStandardPortAllowanceInternal(className) {
    if (!className) {
        return isNum(standardPortAllowance['*']) ? standardPortAllowance['*'] : null;
    }
    const normalizedClassName = _norm(className);
    const keys = Object.keys(standardPortAllowance || {}).filter((k) => k !== '*');

    // 1) exakt normaliserad match
    const exactKey = keys.find((key) => _norm(key) === normalizedClassName);
    if (exactKey && isNum(standardPortAllowance[exactKey])) {
        return standardPortAllowance[exactKey];
    }

    // 2) längsta nyckel som är prefix till klassnamnet
    const prefixKey = keys
        .filter((key) => normalizedClassName.startsWith(_norm(key)))
        .sort((a, b) => _norm(b).length - _norm(a).length)[0];
    if (prefixKey && isNum(standardPortAllowance[prefixKey])) {
        return standardPortAllowance[prefixKey];
    }

    // 3) längsta nyckel som förekommer någonstans i klassnamnet
    const containsKey = keys
        .filter((key) => normalizedClassName.includes(_norm(key)))
        .sort((a, b) => _norm(b).length - _norm(a).length)[0];
    if (containsKey && isNum(standardPortAllowance[containsKey])) {
        return standardPortAllowance[containsKey];
    }

    // 4) fallback
    return isNum(standardPortAllowance['*']) ? standardPortAllowance['*'] : null;
}

// Klassbaserat porttillägg (cm)
export function allowanceForClass(className, precisionConfig = {}) {
    // 1) admin-override vinner alltid
    const manual = precisionConfig?.portAllowanceByClass?.[className];
    if (isNum(manual)) return manual;

    // 2) annars TR-tabellen
    return resolveStandardPortAllowanceInternal(className);
}

// Porttillägg givet antingen ett ekipage eller ett klassnamn
export function getPortAllowanceCm(eqOrClass, precisionConfig = {}) {
    const cls = (typeof eqOrClass === 'string')
        ? eqOrClass
        : (eqOrClass?.className || '');
    return allowanceForClass(cls, precisionConfig);
}

// Total portbredd (cm) = vagnbredd + porttillägg
export function computePortWidth(eqOrDoc, precisionConfig = {}) {
    const tw = trackWidthFromEq(eqOrDoc);
    const allow = getPortAllowanceCm(eqOrDoc, precisionConfig);
    if (!isNum(tw) || !isNum(allow)) return null;
    return tw + allow;
}

// -------------------------------------------------------------
// Bana, tempo & maxtid
// -------------------------------------------------------------
export function getTrackLengthMeters(cls, config) {
    const courses = config?.courses || {};
    const c = courses[cls] || {};
    const n = Number(c.trackLengthMeters ?? c.length ?? c.trackLength);
    return Number.isFinite(n) && n > 0 ? n : null;
}

export function getClassTempoMpm(cls, config) {
    const c = config || {};
    const byClass = c.tempoByClass || c.classTempo || {};
    const courses = (c.courses && c.courses[cls]) || {};
    const tryNum = (v) => {
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : null;
    };

    // 1) i precisionConfig
    const confCand = tryNum(
        byClass[cls]
        ?? byClass[_norm(cls)]
        ?? courses.tempo
        ?? courses.tempoMpm
        ?? courses.mPerMin
    );
    if (confCand) return confCand;

    // 2) i klassTempoData (som i admin: .precision + bästa match)
    const keys = Object.keys(klassTempoData || {});
    const normCls = _norm(cls);
    // exakt
    let key = keys.find((k) => _norm(k) === normCls);
    // prefix-match, längsta först
    if (!key) {
        key = keys
            .filter((k) => normCls.startsWith(_norm(k)))
            .sort((a, b) => _norm(b).length - _norm(a).length)[0];
    }
    // innehåller
    if (!key) {
        key = keys
            .filter((k) => normCls.includes(_norm(k)))
            .sort((a, b) => _norm(b).length - _norm(a).length)[0];
    }
    if (key && klassTempoData[key]?.precision) {
        return klassTempoData[key].precision;
    }
    return null;
}

export function computeMaxSecondsForClass(cls, config) {
    const coreVal = _pureComputeMaxSecondsForClass(cls, config);
    if (coreVal !== null) return coreVal;
    
    // Fallback: Use track length and TR tempo from klassTempoData
    const len = getTrackLengthMeters(cls, config);
    const tempo = getClassTempoMpm(cls, config);
    if (len > 0 && tempo > 0) {
        return Math.round((len / tempo) * 60);
    }
    return null;
}

export function startTimeFor(startNumber, startTimes) {
    if (!startTimes) return '–';
    // Handle both { times: {...} } and raw map {...}
    const map = startTimes.times || startTimes.value?.times || startTimes;
    const timeValue = map[String(startNumber)]?.precision;

    if (!timeValue || typeof timeValue !== 'string') return '–';
    const match = timeValue.match(/(\d{2}:\d{2})/);
    return match ? match[1] : '–';
}

// -------------------------------------------------------------
// Rad-data för tabell, modal och PDF
// -------------------------------------------------------------
/**
 * Calculates the result for a single precision equipage.
 * @param {Object} data - The raw result data (from Firestore/Map).
 * @param {Object} equipage - The equipage object.
 * @param {Object} config - Configuration object (optional).
 * @returns {Object} Calculated result object.
 */
export function calculatePrecisionResult(data, equipage, config = {}) {
    const comp = getGlobalState ? getGlobalState('currentCompetition') : null;
    return _calculatePrecisionResult(data, equipage, config, { currentCompetition: comp });
}

export function getCalculatedRowData(sn, placeMap, equipages, precisionMap, config, startTimes) {
    const snStr = String(sn);
    const eq = equipages.find((e) => String(e.startNumber) === snStr);
    const d = precisionMap.get(snStr) || {};

    // Central beräkning
    const calc = calculatePrecisionResult(d, eq, config) || {};

    // Bana/klassdata
    const cls = eq?.className || '';
    const trackLength = getTrackLengthMeters(cls, config);
    const tempo = getClassTempoMpm(cls, config);
    const maxSec = computeMaxSecondsForClass(cls, config);
    const allowanceCm = getPortAllowanceCm(eq, config);

    const trackW = trackWidthFromEq(eq);                       // cm vagn
    const portW = isNum(d.portWidthCm) ? d.portWidthCm : computePortWidth(eq, config); // cm hinder

    // Tid & straff
    const timeMs = isNum(calc.timeMs) ? calc.timeMs : null;
    const isElim = d.eliminated === true;
    const timeLabel = isElim ? 'ELIM' : ((timeMs != null && timeMs > 0) ? msToLabel(timeMs) : '–');

    const obstaclePenalty = isNum(calc.obstaclePenalty) ? calc.obstaclePenalty : null;
    const timePenalty = isNum(calc.timePenalty) ? calc.timePenalty : null;
    const extraPenalty = isNum(calc.extraPenalty) ? calc.extraPenalty : null;

    // Om eliminerad, sätt totalt till Infinity
    const totalPenalty = (isElim || calc.autoEliminated)
        ? Infinity
        : (isNum(calc.totalPenalty) 
            ? calc.totalPenalty 
            : (obstaclePenalty !== null || timePenalty !== null || extraPenalty !== null 
                ? (obstaclePenalty || 0) + (timePenalty || 0) + (extraPenalty || 0) 
                : null)
          );

    const knocks = Array.isArray(calc.knocks) ? calc.knocks : [];
    const knockDownTimes = calc.knockDownTimes || {};
    const knocksCount = knocks.length;

    // Rivningar grupperade per port (för PDF-tabell)
    const knockStatsMap = new Map();
    for (const p of knocks) {
        const k = String(p);
        knockStatsMap.set(k, (knockStatsMap.get(k) || 0) + 1);
    }
    const knockStats = Array.from(knockStatsMap.entries())
        .map(([port, count]) => ({ port, count }))
        .sort((a, b) => Number(a.port) - Number(b.port));

    // Status-logik
    let derivedStatus = 'Ej startat';
    if (d.eliminated === true) {
        derivedStatus = 'Utesluten';
    } else if (calc.status || d.status) {
        derivedStatus = calc.status || d.status;
    } else if (isNum(timeMs) && timeMs > 0) {
        derivedStatus = 'Klar';
    } else if (d.running || isNum(d.liveTimeMs) || obstaclePenalty > 0 || timePenalty > 0 || extraPenalty > 0 || knocksCount > 0) {
        // Om vi har data men inte gått i mål än
        derivedStatus = 'Pågående';
    }

    const status = derivedStatus;

    const place = placeMap?.get(snStr) ?? null;
    const startT = startTimeFor(eq?.startNumber, startTimes);

    // Formatera rivningar med tidsstämplar om möjligt
    const formattedKnocks = knocks
        .map((p) => {
            const portStr = String(p);
            const ts = knockDownTimes[portStr];
            if (isNum(ts)) {
                return `${portStr} (${msToLabel(ts)})`;
            }
            return portStr;
        })
        .join(', ');

    const display = {
        timeLabel,
        trackLenLabel: isNum(trackLength) ? `${trackLength} m` : '—',
        tempoLabel: isNum(tempo) ? `${tempo} m/min` : '—',
        maxTimeLabel: isNum(maxSec) ? msToLabel(maxSec * 1000) : '—',
        knocksText: formattedKnocks || '–',
        knocksSimple: (knocks.length > 0) ? knocks.join(', ') : '–',
        portWidth: isNum(portW) ? portW : null,
        allowLabel: isNum(allowanceCm) ? `${allowanceCm} cm` : '—'
    };

    return {
        sn: snStr,
        eq,
        d,
        status,
        eliminated: isElim,
        timeLabel, // NYTT: Skicka med timeLabel på toppnivå för modalen

        // Data för PDF/Tabell
        driverName: eq?.driverName || '',
        clubName: eq?.clubName || '',
        flagHtml: getFlagHtml(eq),
        timeMs,
        timeDiffFromAllowed: calc.timeDiffFromAllowed,
        timePenalty,
        obstaclePenalty,
        extraPenalty,
        totalPenalty,
        knocks,
        knockDownTimes,
        knocksCount,
        knockStats,
        place,
        startT,
        running: !!d.running,
        liveStartEpoch: d.liveStartEpoch || null,
        livePausedMs: d.livePausedMs || 0,
        display
    };
}

// Overall Standings & "To Beat"
// -------------------------------------------------------------
/**
 * Beräknar totalställning (Dressyr + Maraton + Precision) för en lista med ekipage.
 * @param {Array} entries - En lista av { eq, dressagePenalty, marathonPenalty, isElim }
 * @param {Map} precisionMap - Map med precisionsresultat
 * @param {Object} config - Precisionskonfiguration
 */
export function buildOverallStanding(entries, precisionMap, config) {
    const list = entries.map(entry => {
        const { eq, dressagePenalty, marathonPenalty, isElim: phaseElim } = entry;
        const sn = String(eq.startNumber);
        
        const dScore = isNum(dressagePenalty) ? dressagePenalty : 0;
        const mScore = isNum(marathonPenalty) ? marathonPenalty : 0;
        
        const pRes = precisionMap.get(sn);
        const pData = calculatePrecisionResult(pRes || {}, eq, config); // Corrected order of args
        const pScore = isNum(pData.totalPenalty) ? pData.totalPenalty : 0;
        
        const isElim = phaseElim || !!pData.eliminated;
        const total = isElim ? Infinity : (dScore + mScore + pScore);
        
        return {
            sn,
            name: eq.driverName,
            total,
            sortTotal: total === null ? Infinity : total,
            pScore,
            isElim
        };
    });

    const results = [...list].sort((a, b) => {
        if (a.isElim !== b.isElim) return a.isElim ? 1 : -1;
        if (a.sortTotal !== b.sortTotal) return a.sortTotal - b.sortTotal;
        return a.sn.localeCompare(b.sn, undefined, { numeric: true });
    });

    const map = new Map();
    results.forEach((r, idx) => {
        map.set(r.sn, { ...r, rank: r.isElim ? null : (idx + 1) });
    });
    return { results, map };
}

/**
 * Calculates what score is needed to reach a certain rank or beat the person above.
 */
export function getToBeatInfo(sn, standings) {
    const myRes = standings.map.get(sn);
    if (!myRes || myRes.rank === null || myRes.rank === 1) return null;

    // Person strictly above me (rank - 1)
    const sorted = standings.results.filter(r => !r.isElim && r.total !== null);
    const myIndex = sorted.findIndex(r => r.sn === sn);
    if (myIndex <= 0) return null;

    const above = sorted[myIndex - 1];
    
    // totalAbove = dScore + mScore + pScoreAbove
    // totalMeTarget = dScore + mScore + pScoreMeTarget <= totalAbove
    // pScoreMeTarget <= totalAbove - (dScore + mScore)
    
    // However, if we are in the middle of precision, pScore is already partial.
    // If I have pScore 5.0 and the above person has total 100.0, and my D+M is 90.0, 
    // then I need pScore < 10.0 total.
    
    // Let's refine: myTotalPenalty_without_precision = myRes.total - (myRes.pScore || 0)
    // we use a targetTotal = above.total (to tie)
    // targetP = above.total - (myRes.total - (myRes.pScore || 0))
    
    const currentBase = myRes.total - (myRes.pScore || 0);
    const targetP = above.total - currentBase;
    
    return {
        targetP,
        aboveName: above.name, // Need to add name to standings for this
        aboveSn: above.sn,
        aboveTotal: above.total
    };
}

export function buildPlaceMap(rows, precisionMap, config = {}) {
    const placeMap = new Map();
    const byClass = new Map();

    // Gruppera efter klass
    rows.forEach((r) => {
        const cls = r._mergedKey || `CLASS:${r.className || '—'}`;

        if (!byClass.has(cls)) byClass.set(cls, []);
        // Hämta totalPenalty från precisionMap eller beräkna om det behövs
        const d = precisionMap.get(String(r.startNumber)) || {};

        // FIX: Räkna placering även för preliminära resultat så länge vi har straffpoäng
        const hasScore = isNum(d.totalPenalty); // || (d.running === false && isNum(d.timePenalty));
        const penalty = hasScore ? d.totalPenalty : null;

        const eliminated = !!d.eliminated;

        byClass.get(cls).push({ sn: String(r.startNumber), penalty, eliminated });
    });

    // Beräkna placering inom varje klass
    for (const [cls, arr] of byClass) {
        const sorted = arr.sort((a, b) => {
            if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
            if (a.penalty === null && b.penalty === null) return 0;
            if (a.penalty === null) return 1;
            if (b.penalty === null) return -1;
            
            if (Math.abs(a.penalty - b.penalty) > 1e-6) {
                return a.penalty - b.penalty;
            }

            // TR Tie-breaker: Time closest to allowed time
            const d1 = precisionMap.get(a.sn) || {};
            const d2 = precisionMap.get(b.sn) || {};
            const eq1 = rows.find(r => String(r.startNumber) === a.sn);
            const eq2 = rows.find(r => String(r.startNumber) === b.sn);
            
            // Re-calculate to get timeDiffFromAllowed which is robust
            const c1 = calculatePrecisionResult(d1, eq1, config);
            const c2 = calculatePrecisionResult(d2, eq2, config);
            
            return (c1.timeDiffFromAllowed || Infinity) - (c2.timeDiffFromAllowed || Infinity);
        });

        let place = 0;
        let lastPenalty = -Infinity;

        sorted.forEach((item, index) => {
            if (item.eliminated || item.penalty === null) {
                placeMap.set(item.sn, null);
                return;
            }
            if (Math.abs(item.penalty - lastPenalty) > 1e-6) {
                place = index + 1;
            }
            placeMap.set(item.sn, place);
            lastPenalty = item.penalty;
        });
    }
    return placeMap;
}

// -------------------------------------------------------------
/**
 * Ranking (Live & Final)
 * @param {Array} allEquipages 
 * @param {Map} precisionStatusMap 
 * @param {string} className 
 * @param {Object} liveRiderInjection 
 * @param {Object} config - Optional. If provided, used to RECALCULATE penalties for correctness.
 */
export function getPrecisionRanking(allEquipages, precisionStatusMap, className, liveRiderInjection = null, config = null) {
    if (!className) return [];

    // 1. Gather all candidates
    const results = [];

    // Helper to add/parse
    const addFn = (eq, st, isLiveInjection = false) => {
        // Must have data OR be the live injection
        if (st || isLiveInjection) {
            let pen = 0;
            let tm = 0;
            let timeLabel = '—';

            if (config && eq && (st || isLiveInjection)) {
                // RECALCULATE for maximum accuracy (avoids stale Firestore data issues)
                const calc = calculatePrecisionResult(st, eq, config);
                pen = calc.totalPenalty ?? 0;
                tm = calc.timeMs ?? 0;
                timeLabel = calc.timeLabel ?? (tm > 0 ? msToLabel(tm) : '—');
            } else {
                // Fallback to stored values
                pen = st?.totalPenalty != null ? st.totalPenalty : (isLiveInjection ? st?.liveTotalPenalty : 0);
                tm = st?.timeMs || (isLiveInjection ? st?.liveTimeMs : 0);
                timeLabel = st?.time || '—';
            }

            results.push({
                sn: eq.startNumber,
                name: eq.driverName,
                club: eq.clubName,
                eq: eq, // Keep full ref
                penalty: pen,
                time: timeLabel,
                timeMs: tm,
                finished: !!st?.finalized,
                isLive: isLiveInjection
            });
        }
    };

    // 2. Add normal participants
    allEquipages.forEach(eq => {
        if (eq.className !== className) return;
        const sn = String(eq.startNumber);

        // If we are injecting a live rider, skip their "normal" entry to avoid dupe
        if (liveRiderInjection && String(liveRiderInjection.sn) === sn) return;

        const st = precisionStatusMap.get(sn);
        addFn(eq, st, false);
    });

    // 3. Add Live Rider Injection (if any)
    if (liveRiderInjection) {
        // construct a "fake" status object
        const fakeSt = {
            totalPenalty: liveRiderInjection.totalPenalty,
            timeMs: liveRiderInjection.timeMs,
            timeLabel: liveRiderInjection.timeLabel,
            liveTotalPenalty: liveRiderInjection.totalPenalty,
            liveTimeMs: liveRiderInjection.timeMs,
            finalized: false,
            // also include the raw fields for calculatePrecisionResult if we have them
            ...liveRiderInjection.d
        };
        addFn(liveRiderInjection.eq, fakeSt, true);
    }

    // 4. Sort
    return results.sort((a, b) => {
        // Eliminated (Infinity) always last
        if (Math.abs(a.penalty - b.penalty) > 0.001) return a.penalty - b.penalty;
        return a.timeMs - b.timeMs;
    });
}
