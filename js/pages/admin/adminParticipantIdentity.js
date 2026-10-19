// Who an equipage document belongs to, to check before writing over it: the
// import compares the file with the stored list, and the form loads an entry,
// some time before the save. If the start number has since been given to
// another driver, the save must not land on them. Pure helpers.

const normalizeName = (value) => String(value ?? '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

/** The identity of a stored or loaded equipage */
export function equipageIdentity(equipage = {}) {
    return {
        startNumber: String(equipage?.startNumber ?? equipage?.id ?? '').trim(),
        driverName: normalizeName(equipage?.driverName)
    };
}

/**
 * Whether the stored equipage is still the one the save was planned for
 * (same driver). Without a driver name on either side there is nothing to
 * compare, which counts as the same.
 */
export function sameEquipageIdentity(stored = {}, expected = null) {
    if (!expected) return true;
    const now = equipageIdentity(stored);
    if (!now.driverName || !expected.driverName) return true;
    return now.driverName === expected.driverName;
}

/** The import's outcome as Swedish lines: what was written and what was not */
export function describeImportWrites({ written = [], failed = [] } = {}) {
    const lines = [];
    if (written.length) {
        lines.push(`Sparade (${written.length}): ${written.map(item => `#${item.startNumber}`).join(', ')}`);
    }
    if (failed.length) {
        lines.push(`Inte sparade (${failed.length}):`);
        failed.forEach(item => lines.push(`#${item.startNumber} ${item.driverName || ''}: ${item.reason}`.replace(/\s+:/, ':')));
    }
    return lines;
}
