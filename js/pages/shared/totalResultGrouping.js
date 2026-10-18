const FALLBACK_GROUP_LABEL = '\u2014';

export function resolveTotalMergeGrouping(equipage, mergeConfig) {
  if (equipage?.useMergedTestForDisplay && equipage?.mergedTestKey && equipage?.mergedTestLabel) {
    return {
      key: String(equipage.mergedTestKey),
      label: String(equipage.mergedTestLabel)
    };
  }

  // Any shape pickMergeSource returns (mergeConfigService): display's
  // { mergeByClassNumber: { key: { label, members } } }, a legacy document
  // with the groups at the top level, or [[1, 2], [5, 6]]
  const source = mergeConfig?.value ?? mergeConfig;
  const groups = source?.mergeByClassNumber ?? source;
  const rawNumber = equipage?.tdbClassNumber;
  const tdbClassNumber = (rawNumber != null && rawNumber !== '') ? Number(rawNumber) : NaN;

  if (Number.isFinite(tdbClassNumber) && groups && typeof groups === 'object') {
    if (Array.isArray(groups)) {
      for (const members of groups) {
        const nums = (Array.isArray(members) ? members : []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
        if (nums.includes(tdbClassNumber)) {
          return { key: `TDBGROUP:${nums.join('+')}`, label: `Sammanslagen: TDB #${nums.join('/')}` };
        }
      }
    } else {
      for (const [groupKey, group] of Object.entries(groups)) {
        const members = Array.isArray(group?.members) ? group.members.map(Number) : [];
        if (members.includes(tdbClassNumber)) {
          return {
            key: String(groupKey),
            label: String(group?.label || equipage?.tdbClassLabel || equipage?.className || 'Sammanslagen klass')
          };
        }
      }
    }
  }

  const className = equipage?.className || FALLBACK_GROUP_LABEL;
  return {
    key: `CLASS:${className}`,
    label: className
  };
}

export function groupTotalEquipagesForDisplay(equipages = [], mergeConfig) {
  const groups = new Map();

  for (const equipage of equipages || []) {
    const group = resolveTotalMergeGrouping(equipage, mergeConfig);
    if (!groups.has(group.key)) {
      groups.set(group.key, {
        key: group.key,
        label: group.label,
        items: []
      });
    }
    groups.get(group.key).items.push(equipage);
  }

  return Array.from(groups.values())
    .sort((a, b) => a.label.localeCompare(b.label, 'sv', { numeric: true, sensitivity: 'base' }));
}
