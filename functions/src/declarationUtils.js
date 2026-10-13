// A driver's own declaration from the portal (groom, carriage, club, horses).
// The horse entries also hold what the vet and the secretariat record (vet
// inspections and status, temperatures, chip, UELN), so a driver may only set
// names and ids: everything else on a horse is kept, and a horse that has been
// inspected can neither be renamed nor removed by the driver.

export const MAX_DECLARED_HORSES = 8;
const MAX_TEXT = 120;

const cleanText = (value, max = MAX_TEXT) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function isInspectedHorse(horse = {}) {
    return !!(horse && (
        (horse.inspections && typeof horse.inspections === 'object' && Object.keys(horse.inspections).length > 0)
        || horse.vetStatus
        || horse.vetCheckedAt
    ));
}

const sameText = (a, b) => cleanText(a).toLowerCase() === cleanText(b).toLowerCase();

/**
 * The horses to store: declared names/ids merged into the existing entries.
 * Throws an Error with a user-facing (Swedish) message for a refused change.
 */
export function mergeDeclaredHorses(existing = [], declared = []) {
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
        if (isInspectedHorse(before) && (!sameText(before.name, horse.name) || (before.id && horse.id && !sameText(before.id, horse.id)))) {
            throw new Error(`${before.name || 'Hästen'} är redan besiktad och kan inte ändras här. Kontakta sekretariatet.`);
        }
        return { ...before, name: horse.name, id: horse.id || before.id || '' };
    });

    const removedInspected = current.filter((horse, i) => !used.has(i) && isInspectedHorse(horse));
    if (removedInspected.length) {
        throw new Error(`${removedInspected.map(h => h.name || 'En häst').join(', ')} är redan besiktad och kan inte tas bort här. Kontakta sekretariatet.`);
    }
    return result;
}

/** The fields a driver may set in their declaration, cleaned */
export function buildDeclarationUpdate(raw = {}, existingHorses = []) {
    return {
        groom: cleanText(raw.groom),
        carriage: cleanText(raw.carriage),
        clubName: cleanText(raw.clubName),
        horses: mergeDeclaredHorses(existingHorses, raw.horses)
    };
}
