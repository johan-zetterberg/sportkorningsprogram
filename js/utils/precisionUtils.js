// js/utils/precisionUtils.js
// Samlad hjälplogik för precision – används av både resultatvyn och PDF:en.

// (Borttagen import från calculationService)
import { klassTempoData, standardPortAllowance } from '../data/competitionData.js';
import { getFlagHtml } from '../services/flagsService.js';
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
import {
    calculatePrecisionResult as _calculatePrecisionResult,
    calculatePrecisionTimePenalty as _calculatePrecisionTimePenalty,
    computeMaxSecondsForClass,
    getTrackLengthMeters,
    getClassTempoMpm,
    getMergedClassName,
    getCourseCandidates
} from './precisionCalculation.js';

function getBrowserGlobalState(key) {
    if (typeof window !== 'undefined' && typeof window.getGlobalState === 'function') {
        return window.getGlobalState(key);
    }
    return null;
}

function getClassName(value) {
    return typeof value === 'string' ? value : (value?.className || '');
}

export function getPrecisionDisplayClassName(value) {
    return getMergedClassName(value) || getClassName(value);
}

export function getPrecisionCourseCandidates(value) {
    return getCourseCandidates(value);
}

export function getPrecisionCourseData(value, config = {}) {
    const courses = config?.courses || {};
    const key = getPrecisionCourseCandidates(value).find((candidate) => courses[candidate]);
    return key ? { key, course: courses[key] || {} } : { key: null, course: {} };
}

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
    const v = Number(eq.trackWidthCm ?? eq.trackWidth ?? eq.vagnbredd ?? eq.spannvidd);
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
export function isFourInHand(eqOrClass) {
    if (!eqOrClass) return false;
    if (typeof eqOrClass === 'string') {
        return _norm(eqOrClass).includes('fyrspann');
    }
    const cls = getClassName(eqOrClass);
    if (_norm(cls).includes('fyrspann')) return true;
    if (Array.isArray(eqOrClass?.horses) && eqOrClass.horses.length === 4) return true;
    const hitch = _norm(eqOrClass?.hitch || eqOrClass?.division || '');
    return hitch.includes('fyrspann') || hitch.includes('four');
}

export const FEI_STANDARD_CONES_WIDTH = {
    horse_four: 190,
    horse_pair: 180,
    horse_single: 160,
    pony_four: 180,
    pony_pair: 160,
    pony_single: 150
};

export const TR_SVAR_STANDARD_CONES_WIDTH = {
    horse_four: 183,
    horse_pair: 168,
    horse_single: 158,
    pony_four: 163,
    pony_pair: 158,
    pony_single: 158
};

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
// Per TR Mom 517 Bilaga 5 fotnot *: Fyrspann i LB, LA och MSV har 10 cm bredare mellan konerna än enbet.
export function getPortAllowanceCm(eqOrClass, precisionConfig = {}) {
    const cls = getClassName(eqOrClass);
    let allow = allowanceForClass(cls, precisionConfig);

    if (isFourInHand(eqOrClass) && allow != null) {
        const normCls = _norm(cls);
        if (!normCls.includes('fyrspann')) {
            if (normCls.startsWith('lb') || normCls.startsWith('lattb') || normCls.startsWith('lättb')) {
                allow = 45;
            } else if (normCls.startsWith('la') || normCls.startsWith('latta') || normCls.startsWith('lätta')) {
                allow = 40;
            } else if (normCls.startsWith('msv') || normCls.startsWith('medelsvar') || normCls.startsWith('medelsvår')) {
                allow = 35;
            }
        }
    }
    return allow;
}

export function isStandardPortWidthClass(eqOrClass, precisionConfig = {}) {
    const cls = getClassName(eqOrClass);
    if (!cls) return false;

    // 1) Explicit course setting or class setting
    const courseData = getPrecisionCourseData(eqOrClass, precisionConfig)?.course;
    if (courseData && courseData.useStandardPortWidth != null) {
        return !!courseData.useStandardPortWidth;
    }
    if (courseData && Number.isFinite(Number(courseData.standardPortWidth)) && Number(courseData.standardPortWidth) > 0) {
        return true;
    }
    if (Number.isFinite(Number(precisionConfig?.standardPortWidthByClass?.[cls]))) {
        return true;
    }

    // 2) By rule: Svår klass (TR Bilaga 2 & 5) or FEI classes (FEI Art 974)
    const normCls = _norm(cls);
    if (normCls.includes('fei') || normCls.includes('cai') || normCls.includes('caio')) {
        return true;
    }
    if (normCls.startsWith('svar') || normCls.startsWith('svår') || normCls.includes('svarklass') || normCls.includes('svårklass')) {
        return true;
    }

    return false;
}

export function getStandardPortWidth(eqOrClass, precisionConfig = {}) {
    const cls = getClassName(eqOrClass);
    if (!cls) return null;

    // 1) Explicit course standardPortWidth
    const courseData = getPrecisionCourseData(eqOrClass, precisionConfig)?.course;
    if (courseData && Number.isFinite(Number(courseData.standardPortWidth)) && Number(courseData.standardPortWidth) > 0) {
        return Number(courseData.standardPortWidth);
    }
    const classOverride = precisionConfig?.standardPortWidthByClass?.[cls];
    if (Number.isFinite(Number(classOverride)) && Number(classOverride) > 0) {
        return Number(classOverride);
    }

    if (!isStandardPortWidthClass(eqOrClass, precisionConfig)) {
        return null;
    }

    const normCls = _norm(cls);
    const isFei = normCls.includes('fei') || normCls.includes('cai');
    const isPony = normCls.includes('ponny') || normCls.includes('pony');
    const isFour = isFourInHand(eqOrClass);
    const isPair = normCls.includes('par') && !isFour;

    const table = isFei ? FEI_STANDARD_CONES_WIDTH : TR_SVAR_STANDARD_CONES_WIDTH;

    if (isPony) {
        if (isFour) return table.pony_four;
        if (isPair) return table.pony_pair;
        return table.pony_single;
    } else {
        if (isFour) return table.horse_four;
        if (isPair) return table.horse_pair;
        return table.horse_single;
    }
}

// Total portbredd (cm):
// Om fast standardbredd gäller (Svår / FEI / banoverride): standardbredd per TR Bilaga 5 / FEI Art 974
// Annars: vagnbredd + porttillägg per TR Bilaga 5
export function computePortWidth(eqOrDoc, precisionConfig = {}) {
    const stdWidth = getStandardPortWidth(eqOrDoc, precisionConfig);
    if (Number.isFinite(stdWidth) && stdWidth > 0) {
        return stdWidth;
    }

    const tw = trackWidthFromEq(eqOrDoc);
    const allow = getPortAllowanceCm(eqOrDoc, precisionConfig);
    if (!isNum(tw) || !isNum(allow)) return null;
    return tw + allow;
}

// -------------------------------------------------------------
// Bana, tempo & maxtid
// -------------------------------------------------------------
// Course length, tempo and max time come from the shared precision calculation
export { getTrackLengthMeters, getClassTempoMpm, computeMaxSecondsForClass };

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
    const comp = getBrowserGlobalState('currentCompetition');
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
    const trackLength = getTrackLengthMeters(eq || cls, config);
    const tempo = getClassTempoMpm(eq || cls, config);
    const maxSec = computeMaxSecondsForClass(eq || cls, config);
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
        const timeMs = isNum(d.timeMs) ? d.timeMs : (isNum(d.liveTimeMs) ? d.liveTimeMs : null);

        byClass.get(cls).push({ sn: String(r.startNumber), penalty, eliminated, timeMs });
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

            // TR Mom 530.1.2 & FEI Art 977: Vid lika straff vinner snabbast tid (lägst timeMs)
            const t1 = isNum(a.timeMs) ? a.timeMs : Infinity;
            const t2 = isNum(b.timeMs) ? b.timeMs : Infinity;
            return t1 - t2;
        });

        let place = 1;
        let prevItem = null;

        sorted.forEach((item, index) => {
            if (item.eliminated || item.penalty === null) {
                placeMap.set(item.sn, null);
                return;
            }
            let isTie = false;
            if (prevItem && prevItem.penalty !== null) {
                const penaltyTie = Math.abs(item.penalty - prevItem.penalty) < 1e-6;
                const timeTie = (isNum(item.timeMs) && isNum(prevItem.timeMs))
                    ? Math.abs(item.timeMs - prevItem.timeMs) < 1e-3
                    : false;
                if (penaltyTie && timeTie) {
                    isTie = true;
                }
            }
            if (!isTie) {
                place = index + 1;
            }
            placeMap.set(item.sn, place);
            prevItem = item;
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
