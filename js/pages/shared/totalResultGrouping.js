const FALLBACK_GROUP_LABEL = '\u2014';

export function resolveTotalMergeGrouping(equipage, mergeConfig) {
  if (equipage?.useMergedTestForDisplay && equipage?.mergedTestKey && equipage?.mergedTestLabel) {
    return {
      key: String(equipage.mergedTestKey),
      label: String(equipage.mergedTestLabel)
    };
  }

  const groupsByClassNumber = mergeConfig?.mergeByClassNumber || {};
  const tdbClassNumber = equipage?.tdbClassNumber != null ? Number(equipage.tdbClassNumber) : null;

  if (tdbClassNumber != null) {
    for (const [groupKey, group] of Object.entries(groupsByClassNumber)) {
      if (Array.isArray(group?.members) && group.members.includes(tdbClassNumber)) {
        return {
          key: String(groupKey),
          label: String(group?.label || equipage?.tdbClassLabel || equipage?.className || 'Sammanslagen klass')
        };
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
