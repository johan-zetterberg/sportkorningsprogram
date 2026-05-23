// js/core-engine/marathon.js
import { 
    PENALTY_RATE, 
    MARATHON_OBSTACLE_TIME_PENALTY, 
    DEFAULT_TRV_TEMPOS_KMH 
} from './rules-ledger.js';

const kmhToMmin = (kmh) => (kmh * 1000) / 60;
const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

export function getClassSettings(className, marathonConfig) {
    if (!marathonConfig || !className) return null;
    const dataMap = marathonConfig.marathonClassData || marathonConfig.maratonClassData;
    if (!dataMap) return null;
    if (dataMap[className]) return dataMap[className];
    const normClass = String(className).trim().toLowerCase();
    const key = Object.keys(dataMap).find(k => normClass.startsWith(k.trim().toLowerCase()));
    if (key) return dataMap[key];
    return null;
}

export function detectTRCategory(categoryString) {
    const cat = String(categoryString || '').toLowerCase();
    if (cat.includes('ponny') || cat.includes('pony')) {
        if (cat.includes('a')) return 'ponyA';
        if (cat.includes('b')) return 'ponyB';
        return 'ponyCD';
    }
    return 'horse';
}

export function normalizeClassKey(className) {
    const s = String(className || '').trim().toLowerCase();
    if (s.includes('lätt b')) return "Lätt B";
    if (s.includes('lätt a')) return "Lätt A";
    if (s.includes('msv')) return "Msv";
    if (s.includes('svår')) return "Svår";
    return null;
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
        
        if (stage === 'A' || stage === 'B') {
            const dist = classSettings[`distance${stage}`] || classSettings[stage]?.distance;
            if (!dist) return null;

            const manualTempo = classSettings[`tempo${stage}`] || classSettings[stage]?.tempo_mpm;
            if (manualTempo > 0) {
                return Math.round((dist / manualTempo) * 60);
            }

            const activeRules = marathonConfig?.tempoRules || DEFAULT_TRV_TEMPOS_KMH;
            const clsKey = normalizeClassKey(classSettings.trTemplate || className);
            const catKey = detectTRCategory(equipage.category);

            const kmh = activeRules?.[clsKey]?.[stage]?.[catKey];
            if (kmh > 0) {
                const mpm = kmhToMmin(kmh);
                return Math.round((dist / mpm) * 60);
            }
        }
    }

    return null;
}

export function limitsFor(equipage, stage, marathonConfig) {
    const idealSec = tlSecondsFor(equipage, stage, marathonConfig);
    if (idealSec === null) return null;
    const cls = equipage?.className;
    const classData = getClassSettings(cls, marathonConfig) || {};

    if (stage === 'A') {
        if (Number(classData.fixedTimeA) > 0) {
            return { ideal: idealSec, min: 0, max: idealSec, timeLimit: Math.round(idealSec * 1.2), isFixedTime: true };
        }
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
    if (!Number.isFinite(ms) || ms <= 0) return { points: 0, elim: false };

    const lim = limitsFor(equipage, stage, marathonConfig);
    if (!lim) return { points: 0, elim: false }; // No limits = no penalties

    const sec = ms / 1000;
    if (sec > lim.timeLimit) return { points: Infinity, elim: true };

    let diff = 0;
    if (sec < lim.min) {
        diff = lim.min - sec;
    } else if (sec > lim.max && !lim.isFixedTime) {
        diff = sec - lim.max;
    }

    if (diff <= 0) return { points: 0, elim: false };

    const rate = marathonConfig?.timePenaltyRate ?? PENALTY_RATE;
    const pts = diff * rate;
    return { points: round2(pts), elim: false };
}

export function getObstacleCoefficient(className, marathonConfig) {
    const s = getClassSettings(className, marathonConfig);
    if (s && Number.isFinite(s.obstaclePenaltyRate) && s.obstaclePenaltyRate > 0) return s.obstaclePenaltyRate;
    if (marathonConfig && Number.isFinite(marathonConfig.obstaclePenaltyRate) && marathonConfig.obstaclePenaltyRate > 0) return marathonConfig.obstaclePenaltyRate;
    
    // ENFORCED: Always fallback to exactly 0.25 for obstacle time. 
    return MARATHON_OBSTACLE_TIME_PENALTY; 
}

function getTotalHoldTimeMs(obstacles) {
    if (!Array.isArray(obstacles)) return 0;
    return obstacles.reduce((sum, obstacle) => {
        const seconds = Number(obstacle?.holdTimeSec);
        return Number.isFinite(seconds) && seconds > 0 ? sum + seconds * 1000 : sum;
    }, 0);
}

export function calculateMarathonResult(state) {
    const { equipage: eq, marathon, config } = state;
    const d = marathon.resultDoc || {};
    const t = marathon.timingDoc || {};
    const marathonConfig = config.marathonConfig;

    if (eq.status === 'struken') return { totalPenalty: null, status: 'Struken', eliminated: false };

    const obsArr = d.obstacles || d.hinder || [];
    const totalHoldTimeMs = getTotalHoldTimeMs(obsArr);

    // Stages
    let stagesPenalty = 0;
    let stagesElim = false;
    const stages = {};
    
    ['A', 'transport', 'B'].forEach(s => {
        const dur = t?.[s]?.durationMs || t?.[`duration_${s}_ms`];
        const effectiveDur = (s === 'B' && Number.isFinite(dur))
            ? Math.max(0, dur - totalHoldTimeMs)
            : dur;
        let res = { points: 0, elim: false };
        if (effectiveDur) {
            res = stagePenaltyFromMs(effectiveDur, eq, s, marathonConfig);
        }
        if (res.elim) stagesElim = true;
        stagesPenalty += res.points;
        stages[s] = {
            durationMs: effectiveDur,
            rawDurationMs: dur,
            holdTimeMs: s === 'B' ? totalHoldTimeMs : 0,
            timePenalty: res.points,
            eliminated: res.elim
        };
    });

    // Obstacles
    let obsPenalty = 0;
    let obsElim = false;
    const obsCoeff = getObstacleCoefficient(eq.className, marathonConfig);
    const obsItems = []; 
    let obsTimeTotal = 0;
    let obsOtherTotal = 0;

    obsArr.forEach(o => {
        if (o.eliminated) obsElim = true;
        const sec = Number(o.timeSeconds || o.timeSec || o.seconds);
        let currentObsPenalty = 0;

        if (Number.isFinite(sec)) {
            obsTimeTotal += sec;
            currentObsPenalty = (sec * obsCoeff);
        }

        const kp = Number(o.knockdownPenalty || o.knockDownPenalty || 0);
        const op = Number(o.otherPenalty || 0); 
        obsOtherTotal += (kp + op);
        currentObsPenalty += (kp + op);

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
