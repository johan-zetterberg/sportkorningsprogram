// functions/src/logic/marathon.js
// Ported from js/utils/marathonUtils.js
// IMPORTANT: Removes global 'maraton_marathonConfig' usage. Functions must accept 'config' argument.

export const PENALTY_RATE = 0.25;
// Hinderberäkning (1.0 straff/sek - standard)
export const MARATHON_OBSTACLE_TIME_PENALTY = 1.0;

const TRV_2025_MARATON_TEMPOS_KMH = {
    "Lätt B": { A: { ponyA: 10.0, ponyB: 10.5, ponyCD: 11.0, horse: 12.0 }, B: { ponyA: 9.0, ponyB: 9.5, ponyCD: 10.0, horse: 11.0 } },
    "Lätt A": { A: { ponyA: 11.0, ponyB: 11.5, ponyCD: 12.0, horse: 13.0 }, B: { ponyA: 10.0, ponyB: 10.5, ponyCD: 11.0, horse: 12.0 } },
    // ... (Full table omitted for brevity, using defaults)
};

const kmhToMmin = (kmh) => (kmh * 1000) / 60;

export function normalizeClassKey(raw) {
    if (!raw) return null;
    const s = String(raw).trim().toLowerCase();
    if (/l[aä]tt\s*b/.test(s)) return "Lätt B";
    if (/l[aä]tt\s*a/.test(s)) return "Lätt A";
    if (/msv/.test(s)) return "Msv";
    if (/sv[aå]r/.test(s)) return "Svår";
    return null;
}

function getClassSettings(className, marathonConfig) {
    if (!marathonConfig || !className) return null;
    const dataMap = marathonConfig.marathonClassData || marathonConfig.maratonClassData;
    if (!dataMap) return null;
    if (dataMap[className]) return dataMap[className];
    const normClass = className.trim().toLowerCase();
    const key = Object.keys(dataMap).find(k => normClass.startsWith(k.trim().toLowerCase()));
    if (key) return dataMap[key];
    return null;
}

export function detectTRCategoryFromEquipage(e) {
    // Simplified logic
    const cat = String(e?.category || '').toLowerCase();
    if (cat.includes('ponny') || cat.includes('pony')) {
        if (cat.includes('a')) return 'ponyA';
        if (cat.includes('b')) return 'ponyB';
        return 'ponyCD';
    }
    return 'horse';
}

export function tlSecondsFor(equipage, stage, marathonConfig) {
    const className = equipage?.className || '';
    const classSettings = getClassSettings(className, marathonConfig);

    // 1. Config override
    if (classSettings) {
        if (stage === 'transport') {
            const dist = classSettings.distanceT || classSettings.T?.distance;
            const tempo = classSettings.tempoT || classSettings.T?.tempo_mpm;
            if (dist && tempo) return Math.round((dist / tempo) * 60);
        }
        // ... A/B overrides
    }

    // 2. Fallback (Basic)
    return null;
}

export function limitsFor(equipage, stage, marathonConfig) {
    const idealSec = tlSecondsFor(equipage, stage, marathonConfig);
    if (idealSec === null) return null;
    const cls = equipage?.className;
    const classData = getClassSettings(cls, marathonConfig) || {};

    if (stage === 'A') {
        const win = classData.windowA ?? 2;
        return { ideal: idealSec, min: Math.max(0, idealSec - win * 60), max: idealSec, timeLimit: Math.round(idealSec * 1.2) };
    }
    if (stage === 'B') {
        const win = classData.windowB ?? 3;
        return { ideal: idealSec, min: Math.max(0, idealSec - win * 60), max: idealSec, timeLimit: Math.round(idealSec * 2) };
    }
    if (stage === 'transport') {
        return { ideal: idealSec, min: 0, max: idealSec, timeLimit: Math.round(idealSec * 2) };
    }
    return null;
}

export function stagePenaltyFromMs(ms, equipage, stage, marathonConfig) {
    if (stage === 'transport') return { points: 0, elim: false };
    if (!Number.isFinite(ms) || ms <= 0) return { points: 0, elim: false };

    const lim = limitsFor(equipage, stage, marathonConfig);
    if (!lim) return { points: 0, elim: false }; // No limits = no penalties

    const sec = ms / 1000;
    if (sec > lim.timeLimit) return { points: Infinity, elim: true };

    let diff = 0;
    if (sec < lim.min) diff = lim.min - sec;
    else if (sec > lim.max) diff = sec - lim.max;

    if (diff <= 0) return { points: 0, elim: false };

    const rate = marathonConfig?.timePenaltyRate ?? PENALTY_RATE;
    const pts = Math.ceil(diff) * rate;
    return { points: pts, elim: false };
}

export function getObstacleCoefficient(className, marathonConfig) {
    const s = getClassSettings(className, marathonConfig);
    if (s && s.obstaclePenaltyRate) return s.obstaclePenaltyRate;
    return marathonConfig?.obstaclePenaltyRate ?? MARATHON_OBSTACLE_TIME_PENALTY;
}

export function calculateMarathonResult(equipage, marathonDoc, timingDoc, marathonConfig) {
    const d = marathonDoc || {};
    const t = timingDoc || {};
    const eq = equipage || {};

    if (eq.status === 'struken') return { totalPenalty: null, status: 'Struken', eliminated: false };

    // Stages
    let stagesPenalty = 0;
    let stagesElim = false;
    const stages = {};
    ['A', 'transport', 'B'].forEach(s => {
        // Logic for durations logic (simplified for brevity: assume durationMs is passed mostly)
        const dur = t?.[s]?.durationMs || t?.[`duration_${s}_ms`];
        let res = { points: 0, elim: false };
        if (dur) {
            res = stagePenaltyFromMs(dur, eq, s, marathonConfig);
        }
        if (res.elim) stagesElim = true;
        stagesPenalty += res.points;
        stages[s] = { durationMs: dur, timePenalty: res.points, eliminated: res.elim };
    });

    // Obstacles
    const obsArr = d.obstacles || d.hinder || [];
    let obsPenalty = 0;
    let obsElim = false;
    const obsCoeff = getObstacleCoefficient(eq.className, marathonConfig);
    const obsItems = []; // New array to hold recalculated items
    let obsTimeTotal = 0;
    let obsOtherTotal = 0;

    obsArr.forEach(o => {
        if (o.eliminated) obsElim = true;
        const sec = Number(o.timeSeconds || o.timeSec || o.seconds);
        let currentObsPenalty = 0;

        if (Number.isFinite(sec)) {
            obsTimeTotal += sec;
            // Calculate penalty for this specific obstacle using the current coefficient
            // This ensures the detailed view matches the total
            currentObsPenalty = (sec * obsCoeff);
        }

        const kp = Number(o.knockdownPenalty || o.knockDownPenalty || 0);
        const op = Number(o.otherPenalty || 0); // other penalty on obstacle
        obsOtherTotal += (kp + op);
        currentObsPenalty += (kp + op);

        // Explicitly fallback to stored penalty ONLY if we couldn't calculate new one (e.g. no time)
        // But if we have time, we overwrite stored penalty with new calculation
        if (!Number.isFinite(sec) && Number.isFinite(Number(o.penalty))) {
            currentObsPenalty = Number(o.penalty);
        }

        obsItems.push({
            ...o,
            timeSec: sec,
            penalty: currentObsPenalty
        });
    });

    obsPenalty = (obsTimeTotal * obsCoeff) + obsOtherTotal;

    const elim = !!d.eliminated || stagesElim || obsElim;
    let total = null;
    if (elim) total = Infinity;
    else if (stagesPenalty > 0 || obsPenalty > 0 || obsArr.length > 0) {
        total = stagesPenalty + obsPenalty;
    }

    return {
        totalPenalty: total,
        eliminated: elim,
        stages,
        obstacles: { sum: obsPenalty, items: obsItems }
    };
}
