import { buildEquipageImportKey } from './adminParticipantXmlValueUtils.js';

// The file numbers its entries 1, 2, 3… in file order, so on a second import
// the same number can be another driver: saved over it, that driver would take
// the first one's results and contact details. An entry already in the
// competition keeps its number; a new one gets a number nobody has.

function importKeyOf(eq = {}) {
  const horse = Array.isArray(eq.horses) ? eq.horses[0] : null;
  return buildEquipageImportKey({
    driverName: eq.driverName,
    classNumber: eq.tdbClassNumber ?? '',
    horseName: horse?.name || horse?.regNo || '',
    className: eq.tdbOriginalXmlClassName || eq.className
  });
}

const driverClassKeyOf = (eq = {}) => `${String(eq.driverName || '').trim()}|${eq.tdbClassNumber ?? ''}`;

/**
 * Returns a function giving each imported entry (after its class is mapped)
 * the start number to save it under.
 */
export function createImportNumberResolver(existingEquipages = []) {
  const used = new Set();
  const byKey = new Map();
  const byDriverClass = new Map();
  existingEquipages.forEach((eq) => {
    const sn = Number(eq?.startNumber ?? eq?.id);
    if (!Number.isFinite(sn)) return;
    used.add(sn);
    const key = importKeyOf(eq);
    if (!byKey.has(key)) byKey.set(key, sn);
    const dc = driverClassKeyOf(eq);
    byDriverClass.set(dc, byDriverClass.has(dc) ? null : sn); // null: not unique
  });
  const taken = new Set(); // existing numbers already matched in this import
  let next = Math.max(0, ...used) + 1;

  return (eq) => {
    let sn = byKey.get(importKeyOf(eq));
    // The horse renamed since (declaration): the driver's only entry in the class
    if (sn == null) sn = byDriverClass.get(driverClassKeyOf(eq)) ?? null;
    if (sn != null && !taken.has(sn)) {
      taken.add(sn);
      return sn;
    }
    const proposed = Number(eq.startNumber);
    if (Number.isFinite(proposed) && !used.has(proposed)) {
      used.add(proposed);
      taken.add(proposed);
      return proposed;
    }
    while (used.has(next)) next++;
    used.add(next);
    taken.add(next);
    return next++;
  };
}
