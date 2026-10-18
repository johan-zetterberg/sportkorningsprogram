// The dressage programs and class->program mapping of a competition, loaded the
// same way on every page that computes dressage results: the built-in programs
// with the competition's own (config/dressagePrograms) on top, as the Cloud
// Function's getContext does. Stored in competitionSettingsStore, where
// getPrograms() and calculationService read them.
import { onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getConfig } from './competitionService.js';
import { getCompDocRef } from './firestoreService.js';
import { getCompetitionSetting, setCompetitionSetting } from './competitionSettingsStore.js';
import { mergeCompetitionPrograms, normalizeProgramMapping } from '../utils/dressageUtils.js';

function storePrograms(competitionId, ownPrograms) {
    const programs = mergeCompetitionPrograms(ownPrograms);
    setCompetitionSetting(competitionId, 'dressagePrograms', programs);
    return programs;
}

function storeMapping(competitionId, rawMapping) {
    const mapping = normalizeProgramMapping(rawMapping);
    setCompetitionSetting(competitionId, 'klassProgramMapping', mapping);
    return mapping;
}

// A failed read keeps what the page already has (never falls back to the
// built-in programs only)
function currentPrograms(competitionId) {
    return getCompetitionSetting('dressagePrograms', competitionId) || mergeCompetitionPrograms(null);
}

function currentMapping(competitionId) {
    return getCompetitionSetting('klassProgramMapping', competitionId) || {};
}

/**
 * Reads the competition's programs and class mapping once and stores them.
 * Returns { programs, mapping }.
 */
export async function loadDressageProgramSettings(competitionId) {
    if (!competitionId) return { programs: mergeCompetitionPrograms(null), mapping: {} };
    const failed = Symbol('failed');
    const [ownPrograms, rawMapping] = await Promise.all([
        getConfig(competitionId, 'dressagePrograms').catch((err) => {
            console.warn('[dressagePrograms] read failed', err?.code || err);
            return failed;
        }),
        getConfig(competitionId, 'dressyrProgramMapping').catch((err) => {
            console.warn('[dressyrProgramMapping] read failed', err?.code || err);
            return failed;
        })
    ]);
    return {
        programs: ownPrograms === failed ? currentPrograms(competitionId) : storePrograms(competitionId, ownPrograms),
        mapping: rawMapping === failed ? currentMapping(competitionId) : storeMapping(competitionId, rawMapping)
    };
}

/**
 * Listens to the competition's programs and class mapping: stores each change
 * and calls onChange({ programs, mapping }). Returns the unsubscribe function.
 */
export function listenDressageProgramSettings(competitionId, onChange) {
    if (!competitionId) return () => { };
    const notify = () => {
        if (typeof onChange === 'function') {
            onChange({ programs: currentPrograms(competitionId), mapping: currentMapping(competitionId) });
        }
    };
    const watch = (configName, store) => onSnapshot(
        getCompDocRef(competitionId, 'config', configName),
        (snap) => {
            store(competitionId, snap.exists() ? snap.data() : null);
            notify();
        },
        (err) => console.warn(`[${configName}] snapshot error`, err?.code || err)
    );
    const unsubs = [
        watch('dressagePrograms', storePrograms),
        watch('dressyrProgramMapping', storeMapping)
    ];
    return () => unsubs.forEach(unsub => { try { unsub(); } catch { } });
}
