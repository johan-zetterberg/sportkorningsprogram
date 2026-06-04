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

function getProtocolProgramKey(protocols = [], allPrograms = {}) {
    const counts = new Map();
    (protocols || []).forEach(protocol => {
        if (!protocol || protocol.id === 'general') return;
        const key = protocol.testKey || protocol.programKey || protocol.protocol?.testKey || protocol.protocol?.programKey;
        if (key && allPrograms[key]) counts.set(key, (counts.get(key) || 0) + 1);
    });

    let bestKey = null;
    let bestCount = 0;
    counts.forEach((count, key) => {
        if (count > bestCount) {
            bestKey = key;
            bestCount = count;
        }
    });
    return bestKey;
}

// Replaced complex regex with a simpler heuristic matching standard enum-like strings
export function guessProgramKeyFromClass(className, allPrograms) {
    if (!className || !allPrograms) return null;
    const s = String(className).toLowerCase();

    const firstExisting = (...keys) => keys.find((key) => allPrograms[key]) || null;

    // Mapping based on common structured class names. Return only keys that
    // actually exist in the supplied program dictionary.
    if (s.includes('children')) return firstExisting('FEI_Children_2025_sv');
    if (s.includes('junior')) return firstExisting('FEI_Junior_2025', 'FEIJunior');
    if (s.includes('u25')) return firstExisting('FEI_2star_HP2_2024');
    if (s.includes('para')) return firstExisting('FEIParaG1', 'FEIParaG2', 'FEI_CAI1_Para');

    if (s.includes('lätt b') || s.includes('lb')) return firstExisting('SvLB', 'LB');
    if (s.includes('lätt a') || s.includes('la')) return firstExisting('SvLA', 'LA');
    if (s.includes('lätt c')) return firstExisting('SvLC');

    if (s.includes('msv 4') || s.includes('msv a') || s.includes('medelsvår a')) {
        if (s.includes('par') || s.includes('fyrspann')) {
            return firstExisting('sv_msv_4_par_2025', 'FEI_3star_HP2_P2_2025', 'FEI_3star_HP4_2025');
        }
        return firstExisting('sv_msv_4_enb_2025', 'FEI3AHP1', 'MSV_A_4');
    }
    if (s.includes('msv 3') || s.includes('msv b') || s.includes('medelsvår b')) return firstExisting('SvMsvB', 'SvMSVB', 'MSV_B_3');
    if (s.includes('msv 2') || s.includes('msv c') || s.includes('medelsvår c')) return firstExisting('SvMsvC', 'SvMSVC');
    if (s.includes('msv') || s.includes('medelsvår')) return firstExisting('SvMsvB', 'SvMsvC');
    if (s.includes('svår')) {
        if (s.includes('fyrspann')) {
            if (s.includes('häst')) return firstExisting('FEI_3star_B_HP4_2022', 'FEI_3star_HP4_2025', 'SvSvar');
            return firstExisting('FEI_3star_HP4_2025', 'FEI_3star_B_HP4_2022', 'SvSvar');
        }
        if (s.includes('par')) return firstExisting('FEI_3star_HP2_P2_2025', 'FEI_3star_B_HP4_2022', 'SvSvar');
        return firstExisting('FEI3AHP1', 'SvSvar');
    }

    return null;
}

export function calculateDressageResult(state) {
    const { equipage, dressage, config } = state;
    if (!equipage) return { penalty: null, eliminated: false };

    const clean = deduplicateAndFilterProtocols(dressage.protocols || [], config.judges);
    const progKey = getProtocolProgramKey(clean, config.allPrograms)
        || equipage.testKey
        || equipage.programKey
        || guessProgramKeyFromClass(equipage.className, config.allPrograms);
    const program = config.allPrograms[progKey];
    const isElim = clean.some(p => p.eliminated);

    if (!program || clean.length === 0) return { penalty: null, eliminated: isElim };

    const result = computeFinalFromSaved(clean, program, config.allPrograms);
    let penalty = null;

    if (result) {
        const coeff = getDressagePenaltyCoeff(program, config.allPrograms);
        const err = Number(equipage.errorPoints) || 0;
        penalty = isElim ? null : round2(result.penalty + (err * coeff));
    }
    
    return { 
        penalty, 
        eliminated: isElim, 
        judgePenalty: isElim ? null : (result ? round2(result.penalty) : null)
    };
}
