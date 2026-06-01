export function normalizeVagnbreddEquipages(equipages = []) {
  const valid = [];
  const invalid = [];

  [...(equipages || [])]
    .sort((a, b) => Number(a?.startNumber || 0) - Number(b?.startNumber || 0))
    .forEach(eq => {
      if (eq && eq.startNumber != null && typeof eq.driverName === 'string' && eq.driverName.trim() !== '') {
        valid.push(eq);
      } else {
        invalid.push(eq);
      }
    });

  return { valid, invalid };
}

export function buildVagnbreddDropdownItems(equipages = []) {
  let checkedCount = 0;
  const items = (equipages || []).map(eq => {
    const isChecked = eq?.safetyCheck && eq.safetyCheck.approved != null;
    if (isChecked) checkedCount++;
    return {
      value: eq.startNumber,
      label: `${isChecked ? 'OK ' : ''}#${eq.startNumber} ${eq.driverName}`
    };
  });

  return { items, checkedCount, totalCount: items.length };
}

export function parseWidthValue(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function buildVagnbreddSavePayload({
  precisionWidth,
  marathonWidth,
  approved,
  comment
} = {}) {
  return {
    trackWidth: parseWidthValue(precisionWidth),
    marathonTrackWidth: parseWidthValue(marathonWidth),
    safetyCheck: {
      approved: !!approved,
      comment: String(comment ?? '').trim()
    }
  };
}
