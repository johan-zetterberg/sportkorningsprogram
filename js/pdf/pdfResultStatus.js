// The status of a printed result list: reads the finalization locks of the
// disciplines on the list (one read per discipline; the lock documents are
// public) and decides with resultStatusUtils. Any read error gives
// "provisional": a list is never called official without the approvals.
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db } from '../config/firebase-config.js';
import { getGlobalState } from '../main.js';
import { RESULT_STATUS, decideResultStatus, isCompetitionArchived } from './resultStatusUtils.js';

async function finalizedStartNumbers(competitionId, discipline) {
    const snap = await getDocs(collection(db, `competitions/${competitionId}/${discipline}Finalization`));
    const out = new Set();
    snap.forEach((d) => { if (d.data()?.finalized === true) out.add(String(d.id).trim()); });
    return out;
}

/**
 * { status, printedAt } for a list.
 * required: [{ discipline, startNumber }] (resultStatusUtils.requiredFor*)
 * override: 'official' | 'provisional' decided by the caller
 */
export async function resolveResultListStatus(competition, { required = [], override = null } = {}) {
    const printedAt = new Date();
    const comp = competition?.id ? competition : (getGlobalState('currentCompetition') || competition || {});
    // The page's copy of the competition may lack the lock fields
    const globalComp = getGlobalState('currentCompetition');
    const archived = isCompetitionArchived(comp)
        || (globalComp?.id && globalComp.id === comp?.id && isCompetitionArchived(globalComp));
    let status = decideResultStatus({ archived, override, required, finalized: {} });
    if (status === RESULT_STATUS.OFFICIAL || override || !comp?.id) return { status, printedAt };

    try {
        const disciplines = [...new Set(required.map((item) => item.discipline))];
        const finalized = {};
        await Promise.all(disciplines.map(async (discipline) => {
            finalized[discipline] = await finalizedStartNumbers(comp.id, discipline);
        }));
        status = decideResultStatus({ archived, required, finalized });
    } catch (error) {
        console.warn('Kunde inte läsa finaliseringen för PDF-status:', error);
        status = RESULT_STATUS.PROVISIONAL;
    }
    return { status, printedAt };
}
