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
    round2
} from './sharedUtils.js';

// Normalisera klassnamn för jämförelser (samma som i admin)
const _norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9åäö]/g, '');

// -------------------------------------------------------------
// Status-badge
// -------------------------------------------------------------
export function statusClass(status) {
    if (status) {
        const s = status.toLowerCase();
        if (s.includes('utesluten') || s.includes('elim')) return 'bg-red-600 text-white border-red-700 font-bold';
        if (s.includes('klar')) return 'bg-green-100 text-green-800 border-green-200';
        if (s.includes('pågår')) return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    }
    return 'bg-gray-100 text-gray-700 border-gray-200';
}

// -------------------------------------------------------------
// Vagnbredd (spårvidd)
// -------------------------------------------------------------
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
export function calculatePrecisionTimePenalty(timeMs, maxTimeSec) {
    if (!Number.isFinite(timeMs) || !Number.isFinite(maxTimeSec) || maxTimeSec <= 0) return 0;

    // Convert maxTime to ms
    const maxMs = maxTimeSec * 1000;

    // If under max time, 0 penalty
    if (timeMs <= maxMs) return 0;

    const diffMs = timeMs - maxMs;
    // 0.5 penalty per commenced second
    // ceil(diff / 1000) * 0.5
    const secondsOver = Math.ceil(diffMs / 1000);
    return secondsOver * 0.5;
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
    // 1) direkt maxtid i precisionConfig
    const direct = config?.maxTimeByClass?.[cls]
        ?? config?.maxTimeByClass?.[_norm(cls)];
    if (direct) {
        const m = String(direct).match(/^(\d{1,2}):(\d{2})$/);
        if (m) return Number(m[1]) * 60 + Number(m[2]);
        const n = Number(direct);
        if (Number.isFinite(n) && n > 0) return n;
    }
    // 2) räkna från banlängd & tempo (m/min)
    const len = getTrackLengthMeters(cls, config);
    const tempo = getClassTempoMpm(cls, config);
    if (Number.isFinite(len) && Number.isFinite(tempo) && tempo > 0) {
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
    const d = data || {};

    // Basic status
    const finalized = d.finalized === true;
    const eliminated = !!d.eliminated;
    const running = d.running === true;

    // Time
    const liveMs = isNum(d.liveTimeMs) ? d.liveTimeMs : null;
    const finalMs = isNum(d.timeMs) ? d.timeMs : null;
    const timeMs = finalized ? finalMs : (liveMs ?? null);

    // Penalties
    // Knocks: array of port numbers
    const knocksArr = Array.isArray(d.knocks) ? d.knocks.slice() : [];
    const knocksCount = knocksArr.length;

    // Obstacle Penalty
    // Priority: 1. Explicit obstaclePenalty, 2. Calculated from knocks (3 pts/knock), 3. Live value
    const inferredObstacle = knocksCount > 0 ? knocksCount * 3 : null;
    const obstaclePenalty = isNum(d.obstaclePenalty) ? d.obstaclePenalty
        : (isNum(inferredObstacle) ? inferredObstacle
            : (isNum(d.liveObstaclePenalty) ? d.liveObstaclePenalty : null));

    // Time Penalty
    const timePenalty = isNum(d.timePenalty) ? d.timePenalty
        : (isNum(d.liveTimePenalty) ? d.liveTimePenalty : null);

    // Extra Penalty
    const extraPenalty = isNum(d.extraPenalty) ? d.extraPenalty : 0;

    // Total Penalty
    // If finalized: use explicit totalPenalty if available, else sum parts.
    // If not finalized: use liveTotalPenalty if available, else sum parts.
    const sumParts = (isNum(obstaclePenalty) || isNum(timePenalty))
        ? ((obstaclePenalty || 0) + (timePenalty || 0) + extraPenalty)
        : null;

    let totalPenalty = null;
    if (finalized) {
        totalPenalty = isNum(d.totalPenalty) ? d.totalPenalty : sumParts;
    } else {
        totalPenalty = isNum(d.liveTotalPenalty) ? d.liveTotalPenalty : sumParts;
    }

    // Status string (UI helper, but logic related)
    let status = 'Ej startat';
    if (equipage?.status === 'struken') status = 'Struken';
    else if (running) status = 'Pågår';
    else if (finalized || (isNum(timeMs) && timeMs > 0)) status = 'Klar';

    return {
        finalized,
        eliminated,
        running,
        status,

        timeMs,
        liveMs,
        finalMs,

        knocks: knocksArr,
        knocksCount: knocksCount || (isNum(d.liveObstaclePenalty) ? Math.floor(d.liveObstaclePenalty / 3) : 0),

        obstaclePenalty: isNum(obstaclePenalty) ? round2(obstaclePenalty) : null,
        timePenalty: isNum(timePenalty) ? round2(timePenalty) : null,
        extraPenalty: round2(extraPenalty),
        totalPenalty: isNum(totalPenalty) ? round2(totalPenalty) : null
    };
}

export function getCalculatedRowData(sn, placeMap, equipages, precisionMap, config, startTimes) {
    const snStr = String(sn);
    const eq = equipages.find((e) => String(e.startNumber) === snStr);
    const d = precisionMap.get(snStr) || {};

    // Central beräkning
    const calc = calculatePrecisionResult(d, eq, config) || {};
    // Exportera den också så att andra kan använda den via denna modul
    // (Men jag måste deklarera den som export function överst, eller assigna till export)
    // Vänta, jag kan inte exportera inuti funktion.
    // Jag lägger den utanför.

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

    const obstaclePenalty = isNum(calc.obstaclePenalty) ? calc.obstaclePenalty : 0;
    const timePenalty = isNum(calc.timePenalty) ? calc.timePenalty : 0;
    const extraPenalty = isNum(calc.extraPenalty) ? calc.extraPenalty : 0;

    // Om eliminerad, sätt totalt till Infinity
    const totalPenalty = isElim
        ? Infinity
        : (isNum(calc.totalPenalty) ? calc.totalPenalty : obstaclePenalty + timePenalty + extraPenalty);

    const knocks = Array.isArray(calc.knocks) ? calc.knocks : [];
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

    const display = {
        timeLabel,
        trackLenLabel: isNum(trackLength) ? `${trackLength} m` : '—',
        tempoLabel: isNum(tempo) ? `${tempo} m/min` : '—',
        maxTimeLabel: isNum(maxSec) ? msToLabel(maxSec * 1000) : '—',
        knocksText: knocksCount
            ? knocks
                .map((p) => String(p))
                .sort((a, b) => Number(a) - Number(b))
                .join(', ')
            : '–',
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
        timePenalty,
        obstaclePenalty,
        extraPenalty,
        totalPenalty,
        knocks,
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

// -------------------------------------------------------------
// Placering per klass
// -------------------------------------------------------------
export function buildPlaceMap(rows, precisionMap) {
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
            return a.penalty - b.penalty;
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
// Ranking (Live & Final)
// -------------------------------------------------------------
export function getPrecisionRanking(allEquipages, precisionStatusMap, className, liveRiderInjection = null) {
    if (!className) return [];

    // 1. Gather all candidates
    const results = [];

    // Helper to add/parse
    const addFn = (eq, st, isLiveInjection = false) => {
        // Must have totalPenalty OR be the live injection
        if ((st && st.totalPenalty != null) || isLiveInjection) {
            const pen = st.totalPenalty != null ? st.totalPenalty : (isLiveInjection ? st.liveTotalPenalty : 0);
            const tm = st.timeMs || (isLiveInjection ? st.liveTimeMs : 0);

            results.push({
                sn: eq.startNumber,
                name: eq.driverName,
                club: eq.clubName,
                eq: eq, // Keep full ref
                penalty: pen,
                time: st.time || '—', // String label
                timeMs: tm,
                finished: !!st.finalized,
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
            time: liveRiderInjection.timeLabel, // e.g. from msToLabel
            liveTotalPenalty: liveRiderInjection.totalPenalty,
            liveTimeMs: liveRiderInjection.timeMs,
            finalized: false
        };
        addFn(liveRiderInjection.eq, fakeSt, true);
    }

    // 4. Sort
    return results.sort((a, b) => {
        // Eliminated always last? (Here assuming penalty is Infinity if elim)
        // If penalty is equal, lower time is better?
        if (Math.abs(a.penalty - b.penalty) > 0.01) return a.penalty - b.penalty;
        return a.timeMs - b.timeMs;
    });
}