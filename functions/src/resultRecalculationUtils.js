import { findProgramKey, resolveDressageProgramKey } from './core-engine/dressage.js';
import { buildCompetitionState, normalizeMarathonDoc } from './core-engine/stateSelector.js';

/**
 * Engine state from the Firestore documents of one equipage, as the Cloud
 * Function reads them. The stage input writes stage times (start_A,
 * duration_A_ms, …) on the maraton document, while maraton-timing holds older
 * or separately saved timing; they are merged with the maraton document
 * winning, the same way the browser result pages merge them. Obstacle results
 * saved per obstacle (obstacleResults.{n}) are merged into obstacles[].
 */
export function buildServerCompetitionState({
    equipage,
    dressageProtocols = [],
    marathonDoc = {},
    timingDoc = {},
    precisionDoc = {}
} = {}, context = {}) {
    const marathon = normalizeMarathonDoc({ ...(marathonDoc || {}) });
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
    'dressageJudgeMapping',
    'dressyrClassConfig'
];

// JSON with sorted keys, so field order cannot make equal data look changed
export function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
    }
    return JSON.stringify(value ?? null);
}

// Config fields only used for display (the course maps); saving them must not
// recalculate every equipage
const DISPLAY_ONLY_CONFIG_FIELDS = ['mapSettings'];

export function withoutDisplayOnlyConfig(data) {
    if (!data || typeof data !== 'object') return data ?? null;
    const copy = { ...data };
    DISPLAY_ONLY_CONFIG_FIELDS.forEach((field) => { delete copy[field]; });
    return copy;
}

/**
 * The pause log as the results see it: without who pressed (by, endedBy), so
 * a name replaced or removed (account deletion, retention) recalculates nothing
 */
export function pauseLogForResults(pauseLog) {
    if (!Array.isArray(pauseLog)) return pauseLog ?? null;
    return pauseLog.map((entry) => {
        if (!entry || typeof entry !== 'object') return entry;
        const rest = { ...entry };
        delete rest.by;
        delete rest.endedBy;
        // The note moved to the private pause details: not part of a result
        delete rest.note;
        return rest;
    });
}

/**
 * Whether a write to a competition config document changes stored results.
 * globalStatus is written for live status too; only its pause log counts.
 */
export function configChangeAffectsResults(configId, before = null, after = null) {
    if (configId === 'globalStatus') return stableJson(pauseLogForResults(before?.pauseLog)) !== stableJson(pauseLogForResults(after?.pauseLog));
    if (!RESULT_CONFIG_DOCS.includes(configId)) return false;
    return stableJson(withoutDisplayOnlyConfig(before)) !== stableJson(withoutDisplayOnlyConfig(after));
}

// The competition document carries the rule settings (coefficients, rates)
export function ruleSettingsChanged(before = null, after = null) {
    return stableJson(before?.ruleSettings) !== stableJson(after?.ruleSettings);
}

const isArchivedCompetition = (comp) => comp?.locked === true || comp?.status === 'completed';

/**
 * An archived competition opened again: settings changed while it was archived
 * were not applied to the stored results (automatic runs skip archived
 * competitions), so they are recalculated now.
 */
export function competitionReopened(before = null, after = null) {
    return !!before && !!after && isArchivedCompetition(before) && !isArchivedCompetition(after);
}

/**
 * Fingerprint of everything a change of which triggers a full recalculation:
 * the result config documents, the rule settings and the pause log. A run whose
 * fingerprint is outdated when it is about to write can skip the write, since a
 * full recalculation with the newer settings follows.
 */
export function resultSettingsFingerprint({ competition = null, configs = {}, globalStatus = null } = {}) {
    return stableJson({
        ruleSettings: competition?.ruleSettings ?? null,
        pauseLog: pauseLogForResults(globalStatus?.pauseLog ?? null),
        configs: Object.fromEntries(RESULT_CONFIG_DOCS.map((id) => [id, withoutDisplayOnlyConfig(configs[id] ?? null)]))
    });
}

/**
 * One transaction attempt of a result recalculation. The settings and every
 * input are read through `read` (tx.get) and the results staged with `write`
 * (tx.set) in the same attempt, so a concurrent change to any of them makes
 * Firestore retry it: the stored result always reflects the latest data, and
 * an older run finishing last can no longer overwrite a newer result.
 *
 * - loadContext(read): the result settings (getContext)
 * - loadInputs(startNumber, read): the equipage's input documents
 * - calculate(inputs, context): the record, or null when the equipage is gone
 * - remove(ref): with it, the stored result of an equipage that is gone is
 *   deleted (tx.delete) in the same attempt, so no orphan result stays
 * - buildDoc(record): the stored result document
 * - isUnchanged(stored, doc): with it, an equal stored result is left alone
 * - settingsFingerprint: when given, nothing is written if the settings
 *   changed since (a manual run writes only what was validated)
 * - onCalculateError(startNumber, error): with it, one equipage the engine
 *   cannot calculate is skipped instead of failing the others
 *
 * Returns { written: true, count } (count: results written or deleted) or
 * { written: false, reason }.
 */
export async function stageResultRecalculation({
    read,
    write,
    remove = null,
    startNumbers = [],
    loadContext,
    loadInputs,
    calculate,
    targetRef,
    buildDoc,
    isUnchanged = null,
    settingsFingerprint = null,
    onCalculateError = null
}) {
    const context = await loadContext(read);
    if (context.competitionGone) return { written: false, reason: 'competition-gone' };
    // Archived: stored results stay as archived (an admin reopens first)
    if (context.archived) return { written: false, reason: 'archived' };
    if (settingsFingerprint !== null && context.settingsFingerprint !== settingsFingerprint) {
        return { written: false, reason: 'settings-changed' };
    }
    // Every read before the first write, as a transaction requires
    const entries = await Promise.all(startNumbers.map(async (startNumber) => {
        const [inputs, stored] = await Promise.all([
            loadInputs(startNumber, read),
            isUnchanged ? read(targetRef(startNumber)) : null
        ]);
        return { startNumber, inputs, stored };
    }));
    let count = 0;
    for (const { startNumber, inputs, stored } of entries) {
        let record;
        try {
            record = calculate(inputs, context);
        } catch (error) {
            if (!onCalculateError) throw error;
            onCalculateError(startNumber, error);
            continue;
        }
        if (!record) {
            // The equipage is gone: its stored result goes too (archived and
            // deleted competitions returned above and keep theirs)
            if (!remove) continue;
            if (isUnchanged && !stored?.exists) continue; // nothing stored
            remove(targetRef(startNumber));
            count += 1;
            continue;
        }
        const doc = buildDoc(record);
        if (isUnchanged && isUnchanged(stored?.exists ? stored.data() : null, doc)) continue;
        write(targetRef(startNumber), doc);
        count += 1;
    }
    return { written: true, count };
}

// Start numbers split into groups, one transaction each: a short transaction
// holds its read locks briefly and is rarely retried
export function chunkStartNumbers(startNumbers = [], size = 25) {
    const step = Math.max(1, Math.floor(size) || 1);
    const chunks = [];
    for (let offset = 0; offset < startNumbers.length; offset += step) {
        chunks.push(startNumbers.slice(offset, offset + step));
    }
    return chunks;
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

        // Settings the result depends on. The result engine withholds results
        // it cannot complete or penalise correctly; these warnings say why.
        const dressage = record?.result?.dressage;
        if (dressage?.judgeMappingMissing && judgeProtocols.length > 0) {
            warnings.push({ startNumber, message: `Dressyren kan inte bli klar: klassen "${className}" saknar domarfördelning. Ange klassens domare i dressyradministrationen.` });
        }
        const marathon = record?.result?.marathon;
        if (marathon?.configMissing) {
            const what = marathon.missingConfig.includes('class')
                ? `klassen "${className}" saknar maratoninställningar`
                : `idealtid saknas för sträcka ${marathon.missingConfig.join(', ')} i klassen "${className}"`;
            warnings.push({ startNumber, message: `Maratonresultatet kan inte räknas: ${what}.` });
        }
        if (marathon?.obstacleListMissing && marathon.obstacles?.items?.length > 0) {
            warnings.push({ startNumber, message: `Maratonresultatet kan inte bli klart: banan är okänd för klassen "${className}". Ange körda hinder för klassen eller öppna maratonadministrationen så att hinderlistan sparas.` });
        }
        const precision = record?.result?.precision;
        if (precision?.configMissing) {
            warnings.push({ startNumber, message: `Precisionsresultatet kan inte räknas: maxtid (banlängd och tempo) saknas för klassen "${className}".` });
        }
    }

    return {
        equipageCount: records.length,
        recalculableCount: Math.max(0, records.length - new Set(criticalErrors.map((issue) => issue.startNumber)).size),
        criticalErrors,
        warnings
    };
}
