export function resolvePrecisionMergeGrouping(equipage, mergeMap = new Map()) {
  if (equipage?.useMergedTestForDisplay && equipage?.mergedTestKey && equipage?.mergedTestLabel) {
    return { key: String(equipage.mergedTestKey), label: String(equipage.mergedTestLabel) };
  }

  const classNumber = Number(equipage?.tdbClassNumber);
  const hit = Number.isFinite(classNumber) ? mergeMap.get(classNumber) : null;
  if (hit) return hit;

  const className = equipage?.className || '-';
  return { key: `CLASS:${className}`, label: className };
}

export function groupPrecisionEquipagesForDisplay(equipages = [], mergeMap = new Map()) {
  const map = new Map();
  for (const equipage of (equipages || [])) {
    const group = resolvePrecisionMergeGrouping(equipage, mergeMap);
    if (!map.has(group.key)) map.set(group.key, { key: group.key, label: group.label, items: [] });
    map.get(group.key).items.push(equipage);
  }
  return Array.from(map.values())
    .sort((a, b) => a.label.localeCompare(b.label, 'sv', { numeric: true, sensitivity: 'base' }));
}

export function buildPrecisionMergeState(raw) {
  const groups = [];
  const map = new Map();
  if (!raw) return { groups, map };

  const normalizedRaw = raw?.value && typeof raw.value === 'object' ? raw.value : raw;
  const maybeDisplay = normalizedRaw && typeof normalizedRaw === 'object' && normalizedRaw.mergeByClassNumber ? normalizedRaw : null;
  const source = maybeDisplay ? maybeDisplay.mergeByClassNumber : normalizedRaw;

  if (source && typeof source === 'object' && !Array.isArray(source)) {
    for (const [groupKey, info] of Object.entries(source)) {
      const members = (info?.members || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
      if (!members.length) continue;
      const label = String(info?.label || `Sammanslagen: TDB #${members.join('/')}`);
      const key = String(groupKey || `TDBGROUP:${members.join('+')}`);
      groups.push({ key, label, members });
      members.forEach((member) => map.set(member, { key, label }));
    }
    return { groups, map };
  }

  if (Array.isArray(source)) {
    const groupMembers = source
      .map((item) => (Array.isArray(item) ? item.map(Number).filter(Number.isFinite) : []))
      .filter((members) => members.length > 0)
      .map((members) => members.sort((a, b) => a - b));

    groupMembers.forEach((members) => {
      const key = `TDBGROUP:${members.join('+')}`;
      const label = `Sammanslagen: TDB #${members.join('/')}`;
      groups.push({ key, label, members });
      members.forEach((member) => map.set(member, { key, label }));
    });
    return { groups, map };
  }

  if (source && typeof source === 'object') {
    const buckets = new Map();
    for (const [key, value] of Object.entries(source)) {
      const num = Number(String(key).replace(/^num:/i, ''));
      if (!Number.isFinite(num)) continue;
      const groupKey = String(value || '').trim() || `TDBGROUP:${num}`;
      if (!buckets.has(groupKey)) buckets.set(groupKey, new Set());
      buckets.get(groupKey).add(num);
    }

    for (const [groupKey, set] of buckets) {
      const members = [...set].sort((a, b) => a - b);
      const key = String(groupKey);
      const label = `Sammanslagen: TDB #${members.join('/')}`;
      groups.push({ key, label, members });
      members.forEach((member) => map.set(member, { key, label }));
    }
  }

  return { groups, map };
}
