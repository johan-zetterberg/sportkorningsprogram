// A driver's own declaration from the portal (groom, carriage, club, horses).
// The horse entries also hold what the secretariat records (chip, UELN; older
// data also the vet's results), so a driver may only set names and ids:
// everything else on a horse is kept, and a horse that has been inspected (the
// vet's results are on the equipage per horse key, vetInspection_<phase>) can
// neither be renamed nor removed by the driver.

export const MAX_DECLARED_HORSES = 8;
const MAX_TEXT = 120;

const cleanText = (value, max = MAX_TEXT) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const VET_PHASE_FIELDS = ['vetInspection_initial', 'vetInspection_harness', 'vetInspection_restArea', 'vetInspection_final'];

// The vet's key for a horse (as getHorseStableKey in js/pages/shared/vetCheckUtils.js):
// the vet's results are stored per key, so an inspected horse must keep it
export function horseStableKey(horse = {}, index = 0) {
    return String(
        horse.id || horse.uid || horse.chipNumber || horse.chip || horse.lic
        || horse.license || horse.name || horse.horseName || index
    );
}

/** Keys of the horses the vet has a result for on the equipage (vetInspection_<phase>.horses) */
export function inspectedHorseKeys(equipage = {}) {
    const keys = new Set();
    VET_PHASE_FIELDS.forEach(field => {
        const horses = equipage?.[field]?.horses;
        if (horses && typeof horses === 'object') Object.keys(horses).forEach(key => keys.add(key));
    });
    return keys;
}

export function isInspectedHorse(horse = {}, index = 0, inspectedKeys = new Set()) {
    return !!(horse && (
        (horse.inspections && typeof horse.inspections === 'object' && Object.keys(horse.inspections).length > 0)
        || horse.vetStatus
        || horse.vetCheckedAt
        || inspectedKeys.has(horseStableKey(horse, index))
    ));
}

const sameText = (a, b) => cleanText(a).toLowerCase() === cleanText(b).toLowerCase();

/**
 * The horses to store: declared names/ids merged into the existing entries.
 * `inspectedKeys`: horses with a vet result on the equipage (inspectedHorseKeys).
 * Throws an Error with a user-facing (Swedish) message for a refused change.
 */
export function mergeDeclaredHorses(existing = [], declared = [], inspectedKeys = new Set()) {
    const current = Array.isArray(existing) ? existing.filter(h => h && typeof h === 'object') : [];
    const wanted = (Array.isArray(declared) ? declared : [])
        .map(h => ({ name: cleanText(h?.name), id: cleanText(h?.id, 60) }))
        .filter(h => h.name);
    if (wanted.length > MAX_DECLARED_HORSES) {
        throw new Error(`Högst ${MAX_DECLARED_HORSES} hästar kan anges.`);
    }

    const used = new Set();
    const findMatch = (horse) => {
        const byId = horse.id ? current.findIndex((h, i) => !used.has(i) && h.id && sameText(h.id, horse.id)) : -1;
        if (byId >= 0) return byId;
        return current.findIndex((h, i) => !used.has(i) && sameText(h.name, horse.name));
    };

    const result = wanted.map((horse) => {
        const index = findMatch(horse);
        if (index < 0) return { name: horse.name, id: horse.id };
        used.add(index);
        const before = current[index];
        const merged = { ...before, name: horse.name, id: horse.id || before.id || '' };
        if (isInspectedHorse(before, index, inspectedKeys) && (
            !sameText(before.name, horse.name)
            || (before.id && horse.id && !sameText(before.id, horse.id))
            // e.g. an id added to a horse the vet knew by its chip or name
            || horseStableKey(merged, index) !== horseStableKey(before, index)
        )) {
            throw new Error(`${before.name || 'Hästen'} är redan besiktad och kan inte ändras här. Kontakta sekretariatet.`);
        }
        return merged;
    });

    const removedInspected = current.filter((horse, i) => !used.has(i) && isInspectedHorse(horse, i, inspectedKeys));
    if (removedInspected.length) {
        throw new Error(`${removedInspected.map(h => h.name || 'En häst').join(', ')} är redan besiktad och kan inte tas bort här. Kontakta sekretariatet.`);
    }
    return result;
}

/** The fields a driver may set in their declaration, cleaned */
export function buildDeclarationUpdate(raw = {}, existingHorses = [], inspectedKeys = new Set()) {
    return {
        groom: cleanText(raw.groom),
        carriage: cleanText(raw.carriage),
        clubName: cleanText(raw.clubName),
        horses: mergeDeclaredHorses(existingHorses, raw.horses, inspectedKeys)
    };
}
