import { findProgramKey, resolveDressageProgramKey } from './core-engine/dressage.js';
import { buildCompetitionState } from './core-engine/stateSelector.js';

/**
 * Engine state from the Firestore documents of one equipage, as the Cloud
 * Function reads them. The stage input writes stage times (start_A,
 * duration_A_ms, …) on the maraton document, while maraton-timing holds older
 * or separately saved timing; they are merged with the maraton document
 * winning, the same way the browser result pages merge them.
 */
export function buildServerCompetitionState({
    equipage,
    dressageProtocols = [],
    marathonDoc = {},
    timingDoc = {},
    precisionDoc = {}
} = {}, context = {}) {
    const marathon = { ...(marathonDoc || {}) };
    if (!Array.isArray(marathon.obstacles)) marathon.obstacles = [];
    const timing = { ...(timingDoc || {}), ...marathon };
    return buildCompetitionState(equipage, dressageProtocols, marathon, timing, precisionDoc || {}, context);
}

// Config documents (competitions/{id}/config/{doc}) the result engine reads
export const RESULT_CONFIG_DOCS = [
    'maratonConfig',
    'precisionConfig',
    'dressagePrograms',
    'dressyrProgramMapping',
    'dressageJudgeMapping'
];

// JSON with sorted keys, so field order cannot make equal data look changed
function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
    }
    return JSON.stringify(value ?? null);
}

/**
 * Whether a write to a competition config document changes stored results.
 * globalStatus is written for live status too; only its pause log counts.
 */
export function configChangeAffectsResults(configId, before = null, after = null) {
    if (configId === 'globalStatus') return stableJson(before?.pauseLog) !== stableJson(after?.pauseLog);
    if (!RESULT_CONFIG_DOCS.includes(configId)) return false;
    return stableJson(before) !== stableJson(after);
}

// The competition document carries the rule settings (coefficients, rates)
export function ruleSettingsChanged(before = null, after = null) {
    return stableJson(before?.ruleSettings) !== stableJson(after?.ruleSettings);
}

function normalizeStartNumber(value) {
    return String(value ?? '').trim();
}

// Same resolution as the result engine uses
export function resolveRecalculationProgramKey(record, context = {}) {
    return resolveDressageProgramKey(
        record?.equipage || {},
        Array.isArray(record?.dressageProtocols) ? record.dressageProtocols : [],
        context.allPrograms || {},
        context.dressageProgramMapping || {}
    );
}

export function buildRecalculationValidation(records = [], context = {}) {
    const criticalErrors = [];
    const warnings = [];
    const seenStartNumbers = new Set();

    for (const record of records) {
        const startNumber = normalizeStartNumber(record?.startNumber);
        const equipage = record?.equipage || {};
        const className = String(equipage.className || equipage.class || equipage.klass || '').trim();

        if (!startNumber) {
            criticalErrors.push({ startNumber: '', message: 'Ekipaget saknar startnummer.' });
        } else if (seenStartNumbers.has(startNumber)) {
            criticalErrors.push({ startNumber, message: 'Startnumret förekommer mer än en gång.' });
        } else {
            seenStartNumbers.add(startNumber);
        }

        if (!className) {
            criticalErrors.push({ startNumber, message: 'Ekipaget saknar klass.' });
        }

        if (record?.calculationError) {
            criticalErrors.push({ startNumber, message: `Resultatet kan inte beräknas: ${record.calculationError}` });
            continue;
        }

        const protocols = Array.isArray(record?.dressageProtocols) ? record.dressageProtocols : [];
        const judgeProtocols = protocols.filter((protocol) => protocol?.id !== 'general');
        if (judgeProtocols.length > 0 && !resolveRecalculationProgramKey(record, context)) {
            criticalErrors.push({ startNumber, message: 'Dressyrprotokoll finns, men inget giltigt dressyrprogram kan hittas.' });
        }

        const explicitProgramKey = equipage.testKey || equipage.programKey;
        if (explicitProgramKey && !findProgramKey(explicitProgramKey, context.allPrograms)) {
            warnings.push({ startNumber, message: `Ekipagets programnyckel "${explicitProgramKey}" finns inte; klassmappning eller reservval används.` });
        }

        // Settings the result depends on. The result engine withholds a marathon
        // result it cannot penalise correctly; these warnings say why.
        const marathon = record?.result?.marathon;
        if (marathon?.configMissing) {
            const what = marathon.missingConfig.includes('class')
                ? `klassen "${className}" saknar maratoninställningar`
                : `idealtid saknas för sträcka ${marathon.missingConfig.join(', ')} i klassen "${className}"`;
            warnings.push({ startNumber, message: `Maratonresultatet kan inte räknas: ${what}.` });
        }
        const precision = record?.result?.precision;
        if (precision && precision.timeMs > 0 && precision.maxTimeSec == null && !precision.timePenaltyOverride) {
            warnings.push({ startNumber, message: `Precisionsbana saknas för klassen "${className}"; sparat tidsstraff används.` });
        }
    }

    return {
        equipageCount: records.length,
        recalculableCount: Math.max(0, records.length - new Set(criticalErrors.map((issue) => issue.startNumber)).size),
        criticalErrors,
        warnings
    };
}
