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
    if (/cai2.*hp2|hp2.*2\*|2\*.*hp2/.test(nm)) return 0.615;
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

const movementNo = (mv) => Number(mv?.momentNo ?? mv?.movementNo ?? mv?.no);
const scoreOf = (mv) => (mv && mv.score !== '' && mv.score != null && Number.isFinite(Number(mv.score)))
    ? Number(mv.score)
    : null;

export function getProgramMaxScore(program) {
    return (Array.isArray(program?.movements) ? program.movements : [])
        .reduce((s, m) => s + 10 * (Number(m.coeff) || 1), 0);
}

// Movements counted for the TR general-impressions tie-break
const GENERAL_IMPRESSION_KEYWORDS = ['gångarter', 'framåtbjudning', 'lydnad', 'kusken', 'presentation', 'helhetsintryck', 'impulsion', 'athlete', 'general impression'];

function isGeneralImpressionMovement(pm) {
    const text = String(pm?.text || '').toLowerCase();
    return GENERAL_IMPRESSION_KEYWORDS.some(k => text.includes(k));
}

// Per-judge points/percent/penalty, averaged over the given protocols
export function computeFinalFromSaved(savedArr, program, allPrograms) {
    if (!Array.isArray(savedArr) || !program) return null;

    const maxScore = getProgramMaxScore(program);
    if (maxScore <= 0) return null;

    const penaltyCoeff = getDressagePenaltyCoeff(program, allPrograms);
    const finals = [];

    for (const p of savedArr) {
        const movements = Array.isArray(p.movements) ? p.movements : [];
        let total = 0;
        let general = 0;
        for (const mv of movements) {
            const pm = (program.movements || []).find(x => Number(x.no) === movementNo(mv));
            const sc = scoreOf(mv);
            if (sc == null) continue;
            const c = Number(pm?.coeff) || 1;
            total += sc * c;
            if (pm && isGeneralImpressionMovement(pm)) general += sc * c;
        }

        finals.push({
            points: total,
            percent: (total / maxScore) * 100,
            penalty: (maxScore - total) * penaltyCoeff,
            generalImpressionsSum: general
        });
    }

    if (!finals.length) return null;

    const avg = finals.reduce((a, b) => ({
        points: a.points + b.points,
        percent: a.percent + b.percent,
        penalty: a.penalty + b.penalty,
        generalImpressionsSum: a.generalImpressionsSum + b.generalImpressionsSum
    }), { points: 0, percent: 0, penalty: 0, generalImpressionsSum: 0 });

    avg.points /= finals.length;
    avg.percent /= finals.length;
    avg.penalty /= finals.length;
    avg.generalImpressionsSum /= finals.length;

    return avg;
}

export function normJudgeId(id) {
    return String(id || '').replace(/^judge_/i, '').trim().toLowerCase();
}

/**
 * Cleans the protocol list: matches protocols to configured judges (by id or
 * position) when a judge list is given, keeps one protocol per judge (last
 * wins) and drops protocols without movements. The 'general' document
 * (error points) is never a judge protocol.
 */
export function deduplicateAndFilterProtocols(protocols, validJudgesList = []) {
    if (!Array.isArray(protocols)) return [];
    const judges = Array.isArray(validJudgesList) ? validJudgesList : [];

    const normalized = protocols.filter(p => p && p.id !== 'general').map(p => {
        const cleanId = normJudgeId(p.judgeId);
        if (cleanId) {
            const byId = judges.find(j => normJudgeId(j.id) === cleanId);
            if (byId) return { ...p, judgeId: byId.id, id: byId.id, position: byId.position };
        }
        const pos = String(p.position || p.judgePosition || '').toUpperCase();
        if (pos) {
            const byPos = judges.find(j => String(j.position || '').toUpperCase() === pos);
            if (byPos) return { ...p, judgeId: byPos.id, id: byPos.id, position: pos };
        }
        return p;
    });

    const dedupMap = new Map();
    normalized.forEach((p, idx) => {
        const id = normJudgeId(p.judgeId);
        const pos = String(p.position || p.judgePosition || '').toUpperCase();
        if (id) dedupMap.set(id, p);
        else if (pos) dedupMap.set('POS:' + pos, p);
        else dedupMap.set('UNKNOWN:' + idx, p);
    });

    return Array.from(dedupMap.values())
        .filter(p => Array.isArray(p.movements) && p.movements.length > 0);
}

// Class names in the judge mapping may differ in case and spacing ("1. Lätt B" / "1.Lätt B")
const classKeyOf = (name) => String(name || '').toLowerCase().replace(/\s+/g, '');

/**
 * Judge positions assigned to a class in the dressageJudgeMapping config
 * ({ [className]: { C: judgeId, E: judgeId, ... } }, stored flat or under
 * .mapping). Empty when the class has no mapping.
 */
export function getClassJudgeAssignments(className, judgeMapping = {}) {
    const mapping = (judgeMapping?.mapping && typeof judgeMapping.mapping === 'object')
        ? judgeMapping.mapping
        : (judgeMapping || {});
    let assigned = mapping[className];
    if (!assigned || typeof assigned !== 'object') {
        const wanted = classKeyOf(className);
        const key = wanted ? Object.keys(mapping).find(k => classKeyOf(k) === wanted) : null;
        assigned = key ? mapping[key] : null;
    }
    if (!assigned || typeof assigned !== 'object') return {};
    const out = {};
    Object.entries(assigned).forEach(([pos, judgeId]) => {
        if (judgeId && String(judgeId).trim() !== '') out[String(pos).toUpperCase()] = String(judgeId);
    });
    return out;
}

// A judge's protocol is complete when every movement of the program is scored
function isProtocolComplete(protocol, program) {
    const movs = Array.isArray(program?.movements) ? program.movements : [];
    if (movs.length === 0) return false;
    const scored = new Set((protocol?.movements || [])
        .filter(m => scoreOf(m) != null)
        .map(movementNo));
    return movs.every(pm => scored.has(Number(pm.no)));
}

/**
 * Expected judge positions for the class with no complete protocol yet.
 * A protocol counts for a position by its position or by the assigned judge's id.
 */
export function getMissingJudgePositions(assignments, judgeProtocols, program) {
    const complete = (judgeProtocols || []).filter(p => isProtocolComplete(p, program));
    return Object.entries(assignments || {})
        .filter(([pos, judgeId]) => !complete.some(p =>
            String(p.position || p.judgePosition || '').toUpperCase() === pos
            || (normJudgeId(p.judgeId) && normJudgeId(p.judgeId) === normJudgeId(judgeId))))
        .map(([pos]) => pos);
}

/**
 * Error points (felkörning) from C. Stored on the 'general' protocol doc;
 * an equipage-level value is also honoured. The highest value wins.
 */
export function resolveDressageErrorPoints(equipage, protocols = []) {
    const values = [Number(equipage?.errorPoints) || 0];
    for (const p of protocols || []) {
        if (p && (p.id === 'general' || typeof p.errorPoints === 'number')) {
            values.push(Number(p.errorPoints) || 0);
        }
    }
    return Math.max(...values);
}

/**
 * The program dictionary's own key for `key`, or null. Older data can hold a
 * key with other capitalisation (e.g. "SvMSVB" for "SvMsvB"); an exact match
 * wins, otherwise the match ignores case.
 */
export function findProgramKey(key, allPrograms = {}) {
    if (!key || !allPrograms) return null;
    if (allPrograms[key]) return key;
    const wanted = String(key).toLowerCase();
    return Object.keys(allPrograms).find((k) => k.toLowerCase() === wanted) || null;
}

// Most common valid program key among the saved protocols
export function getProtocolProgramKey(protocols = [], allPrograms = {}) {
    const counts = new Map();
    (protocols || []).forEach(protocol => {
        if (!protocol || protocol.id === 'general') return;
        const key = findProgramKey(
            protocol.testKey || protocol.programKey || protocol.protocol?.testKey || protocol.protocol?.programKey,
            allPrograms
        );
        if (key) counts.set(key, (counts.get(key) || 0) + 1);
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

/**
 * Program for an equipage: saved protocols first (a single equipage may
 * deliberately use another program than its class), then the equipage's own
 * key, then the competition's class mapping, then a guess from the class name.
 */
export function resolveDressageProgramKey(equipage, protocols = [], allPrograms = {}, programMapping = {}) {
    const fromProtocols = getProtocolProgramKey(protocols, allPrograms);
    if (fromProtocols) return fromProtocols;

    const explicitKey = findProgramKey(equipage?.testKey || equipage?.programKey, allPrograms);
    if (explicitKey) return explicitKey;

    const className = String(equipage?.className || equipage?.class || equipage?.klass || '').trim();
    // The dressyrProgramMapping doc is stored either flat or under .mapping
    const mapping = (programMapping?.mapping && typeof programMapping.mapping === 'object')
        ? programMapping.mapping
        : (programMapping || {});
    const mappedKey = findProgramKey(
        mapping[className] || (equipage?._mergedLabel ? mapping[equipage._mergedLabel] : null),
        allPrograms
    );
    if (mappedKey) return mappedKey;

    return guessProgramKeyFromClass(className, allPrograms);
}

// Live prognosis: average of the judged movements, projected over the program
function computePrognosis(judgeProtocols, program) {
    const movs = program.movements || [];
    let pointsNow = 0;
    let maxPointsNow = 0;

    for (const pm of movs) {
        const scores = judgeProtocols
            .map(p => scoreOf((p.movements || []).find(m => movementNo(m) === Number(pm.no))))
            .filter(s => s != null);
        if (scores.length === 0) continue;
        const c = Number(pm.coeff) || 1;
        pointsNow += (scores.reduce((a, b) => a + b, 0) / scores.length) * c;
        maxPointsNow += 10 * c;
    }

    return { pointsNow, maxPointsNow };
}

export function calculateDressageResult(state) {
    const { equipage, dressage, config } = state;
    if (!equipage) {
        return { penalty: null, percent: null, points: null, judgePenalty: null, errorPoints: 0, errorPenalty: 0, eliminated: false };
    }

    const allPrograms = config.allPrograms || {};
    const rawProtocols = dressage?.protocols || [];
    const judgeProtocols = deduplicateAndFilterProtocols(rawProtocols, config.judges);
    const programKey = resolveDressageProgramKey(
        equipage,
        judgeProtocols.length ? judgeProtocols : rawProtocols,
        allPrograms,
        config.dressageProgramMapping
    );
    const program = programKey ? allPrograms[programKey] : null;
    const eliminated = !!equipage.eliminated || judgeProtocols.some(p => p.eliminated);

    // TR Mom 518.9 & FEI Art 958.1.4: error points from C are added directly 1:1
    const errorPoints = resolveDressageErrorPoints(equipage, rawProtocols);

    // Judges the class is assigned (dressageJudgeMapping); without a mapping
    // the received protocols are all there is to go on
    const assignments = getClassJudgeAssignments(equipage.className, config.dressageJudgeMapping);
    const expectedJudgePositions = Object.keys(assignments);
    const missingJudgePositions = getMissingJudgePositions(assignments, judgeProtocols, program);
    const judgesComplete = missingJudgePositions.length === 0;

    if (!program || judgeProtocols.length === 0) {
        return {
            penalty: null,
            judgePenalty: null,
            percent: eliminated ? 0 : null,
            points: eliminated ? 0 : null,
            eliminated,
            programKey: programKey || null,
            programName: program ? program.name : null,
            errorPoints,
            errorPenalty: errorPoints,
            expectedJudgePositions,
            missingJudgePositions,
            judgesComplete
        };
    }

    const result = computeFinalFromSaved(judgeProtocols, program, allPrograms);
    const coeff = getDressagePenaltyCoeff(program, allPrograms);
    const totalMaxPoints = getProgramMaxScore(program);
    const { pointsNow, maxPointsNow } = computePrognosis(judgeProtocols, program);

    const isLive = maxPointsNow > 0 && maxPointsNow < totalMaxPoints;
    const projPercent = maxPointsNow > 0 ? (pointsNow / maxPointsNow) * 100 : null;
    const projPoints = projPercent != null ? (projPercent / 100) * totalMaxPoints : null;
    const projPenalty = projPoints != null ? round2(((totalMaxPoints - projPoints) * coeff) + errorPoints) : null;

    return {
        penalty: eliminated || !result ? null : round2(result.penalty + errorPoints),
        judgePenalty: eliminated || !result ? null : round2(result.penalty),
        percent: eliminated ? 0 : (result ? round2(result.percent) : null),
        points: eliminated ? 0 : (result ? round2(result.points) : null),

        projectedPercent: eliminated ? 0 : (projPercent != null ? round2(projPercent) : null),
        projectedPoints: eliminated ? 0 : (projPoints != null ? round2(projPoints) : null),
        projectedPenalty: eliminated ? 0 : projPenalty,

        isLive,
        eliminated,
        programKey,
        programName: program.name,
        coeff,
        errorPoints,
        errorPenalty: errorPoints,
        judgeCount: judgeProtocols.length,
        expectedJudgePositions,
        missingJudgePositions,
        judgesComplete,
        pointsNow,
        // TR tie-break
        generalImpressionsSum: result ? result.generalImpressionsSum : null
    };
}
