// js/core-engine/dressage.js
import { DRESSAGE_COEFFICIENTS_BY_CODE, round2 } from './rules-ledger.js';

export function getDressagePenaltyCoeff(programOrKey, allPrograms = {}) {
    const p = (typeof programOrKey === 'string') ? (allPrograms[programOrKey] || null) : programOrKey || null;

    const raw = p?.penaltyCoeff ?? p?.penaltyFactor ?? p?.coeffPenalty;
    if (raw != null) {
        const n = Number(String(raw).replace(',', '.'));
        if (Number.isFinite(n) && n > 0) return n;
    }

    const name = String(p?.name || p?.title || p?.id || '');
    const category = String(p?.category || '');
    const m = name.match(/^(\d{3})\b/);
    const code = m ? m[1] : null;

    if (code && DRESSAGE_COEFFICIENTS_BY_CODE[code] != null) return DRESSAGE_COEFFICIENTS_BY_CODE[code];

    const nm = `${name} ${category}`.toLowerCase();
    if (/\bdot\b.*coefficient/.test(nm)) return 0.615;
    if (/cai1|para/.test(nm)) return 0.80;
    if (/cai2/.test(nm)) return 0.76;
    if (/cai3/.test(nm)) {
        if (/singles|enbet|single/.test(nm)) return 0.666;
        if (/hp2|p2|pairs|hp4|p4|four/.test(nm)) return 0.615;
    }
    if (/children/.test(nm)) return 0.80;
    if (/junior/.test(nm)) return 0.80;

    if (/svensk|svenska/.test(nm)) {
        if (/l[äa]tt\s*a|l[âa]tt\s*a|lb|la/.test(nm)) return 1.00;
        return 0.80;
    }

    return 1.00;
}

export function computeFinalFromSaved(savedArr, program, allPrograms) {
    if (!Array.isArray(savedArr) || !program) return null;

    const maxScore = (Array.isArray(program.movements) ? program.movements : [])
        .reduce((s, m) => s + 10 * (Number(m.coeff) || 1), 0);

    if (maxScore <= 0) return null;

    const penaltyCoeff = getDressagePenaltyCoeff(program, allPrograms);
    const finals = [];

    for (const p of savedArr) {
        const movements = Array.isArray(p.movements) ? p.movements : [];
        const total = movements.reduce((sum, mv) => {
            const pm = (program.movements || []).find(x => Number(x.no) === Number(mv.momentNo ?? mv.movementNo ?? mv.no));
            const c = Number(pm?.coeff) || 1;
            const sc = (mv.score !== '' && mv.score != null) ? Number(mv.score) : null;
            return (sc != null ? (sum + sc * c) : sum);
        }, 0);

        finals.push({
            points: total,
            percent: maxScore ? (total / maxScore) * 100 : 0,
            penalty: (maxScore - total) * penaltyCoeff
        });
    }

    if (!finals.length) return null;

    const avg = finals.reduce((a, b) => ({
        points: a.points + b.points,
        percent: a.percent + b.percent,
        penalty: a.penalty + b.penalty
    }), { points: 0, percent: 0, penalty: 0 });

    avg.points /= finals.length;
    avg.percent /= finals.length;
    avg.penalty /= finals.length;

    return avg;
}

export function deduplicateAndFilterProtocols(protocols, validJudgesList) {
    if (!Array.isArray(protocols)) return [];

    const dedupMap = new Map();
    protocols.forEach(p => {
        if (p.judgeId) dedupMap.set(String(p.judgeId), p);
        else if (p.position) dedupMap.set('POS:' + String(p.position).toUpperCase(), p);
        else dedupMap.set('UNKNOWN:' + Math.random(), p);
    });

    return Array.from(dedupMap.values()).filter(p => {
        const hasMoves = Array.isArray(p.movements) && p.movements.length > 0;
        return hasMoves;
    });
}

// Replaced complex regex with a simpler heuristic matching standard enum-like strings
export function guessProgramKeyFromClass(className, allPrograms) {
    if (!className || !allPrograms) return null;
    const s = String(className).toLowerCase();

    // Mapping based on common structured class names rather than complex regex
    if (s.includes('lätt b') || s.includes('lb')) return 'LB';
    if (s.includes('lätt a') || s.includes('la')) return 'LA';
    if (s.includes('msv a') || s.includes('medelsvår a')) return 'MSV_A_4';
    if (s.includes('msv') || s.includes('medelsvår')) return 'MSV_B_3';
    if (s.includes('svår')) return 'FEI';
    
    return null;
}

export function calculateDressageResult(state) {
    const { equipage, dressage, config } = state;
    if (!equipage) return { penalty: null, eliminated: false };

    const progKey = equipage.testKey || guessProgramKeyFromClass(equipage.className, config.allPrograms);
    const program = config.allPrograms[progKey];

    const clean = deduplicateAndFilterProtocols(dressage.protocols || [], config.judges);
    const isElim = clean.some(p => p.eliminated);

    if (!program || clean.length === 0) return { penalty: null, eliminated: isElim };

    const result = computeFinalFromSaved(clean, program, config.allPrograms);
    let penalty = null;

    if (result) {
        const coeff = getDressagePenaltyCoeff(program, config.allPrograms);
        const err = Number(equipage.errorPoints) || 0;
        penalty = round2(result.penalty + err);
    }
    
    return { 
        penalty, 
        eliminated: isElim, 
        judgePenalty: result?.penalty 
    };
}
