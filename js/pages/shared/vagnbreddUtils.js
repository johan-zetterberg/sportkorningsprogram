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

export const RULE_FREE = { kind: 'free', label: 'Fri' };
export const ruleMin = (value) => ({ kind: 'min', value, label: `Minst ${value} cm` });
export const RULE_FORBIDDEN = { kind: 'forbidden', label: 'Ej tillåten enligt bilaga 2' };

export const VAGN_RULE_ROWS = {
  horse_enbet_tandem: {
    label: 'Häst enbet/tandem',
    dressagePrecision: { lb: RULE_FREE, laMsv: ruleMin(125), svar: ruleMin(138) },
    marathon: { lb: RULE_FREE, laMsvSvar: ruleMin(125) }
  },
  horse_par: {
    label: 'Häst par',
    dressagePrecision: { lb: RULE_FREE, laMsv: ruleMin(125), svar: ruleMin(148) },
    marathon: { lb: RULE_FREE, laMsvSvar: ruleMin(125) }
  },
  horse_fyrspann: {
    label: 'Häst fyrspann',
    dressagePrecision: { lb: RULE_FREE, laMsv: ruleMin(125), svar: ruleMin(158) },
    marathon: { lb: RULE_FREE, laMsvSvar: ruleMin(125) }
  },
  pony_a_enbet_tandem: {
    label: 'A-ponny enbet/tandem',
    dressagePrecision: { lb: RULE_FREE, laMsv: ruleMin(125), svar: RULE_FORBIDDEN },
    marathon: { lb: RULE_FREE, laMsvSvar: ruleMin(125) }
  },
  pony_bc_enbet_tandem: {
    label: 'B/C/D-ponny enbet/tandem',
    dressagePrecision: { lb: RULE_FREE, laMsv: ruleMin(125), svar: ruleMin(138) },
    marathon: { lb: RULE_FREE, laMsvSvar: ruleMin(125) }
  },
  pony_a_par: {
    label: 'A-ponny par',
    dressagePrecision: { lb: RULE_FREE, laMsv: ruleMin(125), svar: ruleMin(138) },
    marathon: { lb: RULE_FREE, laMsvSvar: ruleMin(125) }
  },
  pony_a_fyrspann: {
    label: 'A-ponny fyrspann',
    dressagePrecision: { lb: RULE_FREE, laMsv: ruleMin(125), svar: ruleMin(138) },
    marathon: { lb: RULE_FREE, laMsvSvar: ruleMin(125) }
  },
  pony_b_par: {
    label: 'B-ponny par',
    dressagePrecision: { lb: RULE_FREE, laMsv: ruleMin(125), svar: ruleMin(138) },
    marathon: { lb: RULE_FREE, laMsvSvar: ruleMin(125) }
  },
  pony_b_fyrspann: {
    label: 'B-ponny fyrspann',
    dressagePrecision: { lb: RULE_FREE, laMsv: ruleMin(125), svar: ruleMin(138) },
    marathon: { lb: RULE_FREE, laMsvSvar: ruleMin(125) }
  },
  pony_cd_par: {
    label: 'C/D-ponny par',
    dressagePrecision: { lb: RULE_FREE, laMsv: ruleMin(125), svar: ruleMin(138) },
    marathon: { lb: RULE_FREE, laMsvSvar: ruleMin(125) }
  },
  pony_cd_fyrspann: {
    label: 'C/D-ponny fyrspann',
    dressagePrecision: { lb: RULE_FREE, laMsv: ruleMin(125), svar: ruleMin(138) },
    marathon: { lb: RULE_FREE, laMsvSvar: ruleMin(125) }
  }
};

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function inferPonyCategory(equipage) {
  const horseTypes = (Array.isArray(equipage?.horses) ? equipage.horses : [])
    .map(horse => normalizeText(horse?.type))
    .filter(Boolean);

  if (horseTypes.some(type => type.includes('a-ponny'))) return 'a';
  if (horseTypes.some(type => type.includes('b-ponny'))) return 'b';
  if (horseTypes.some(type => type.includes('c-ponny') || type.includes('d-ponny'))) return 'cd';

  const cls = normalizeText(equipage?.className || '');
  if (cls.includes('a-ponny') || cls.includes('kat a') || cls.includes('kat. a')) return 'a';
  if (cls.includes('b-ponny') || cls.includes('kat b') || cls.includes('kat. b')) return 'b';
  if (cls.includes('c-ponny') || cls.includes('d-ponny') || cls.includes('kat c') || cls.includes('kat d')) return 'cd';
  return null;
}

export function resolveVagnRuleRow(equipage) {
  const cls = normalizeText(equipage?.className);
  if (!cls) return null;

  const hitch = cls.includes('fyrspann')
    ? 'fyrspann'
    : (cls.includes('par') ? 'par' : 'enbet_tandem');
  const species = cls.includes('ponny') ? 'pony' : (cls.includes('hast') ? 'horse' : null);
  if (!species) return null;

  if (species === 'horse') {
    return VAGN_RULE_ROWS[`horse_${hitch}`] || null;
  }

  const ponyCategory = inferPonyCategory(equipage);
  if (ponyCategory === 'a') {
    if (hitch === 'par') return VAGN_RULE_ROWS.pony_a_par;
    if (hitch === 'fyrspann') return VAGN_RULE_ROWS.pony_a_fyrspann;
    return VAGN_RULE_ROWS.pony_a_enbet_tandem;
  }
  if (ponyCategory === 'b') {
    if (hitch === 'par') return VAGN_RULE_ROWS.pony_b_par;
    if (hitch === 'fyrspann') return VAGN_RULE_ROWS.pony_b_fyrspann;
    return VAGN_RULE_ROWS.pony_bc_enbet_tandem;
  }
  if (ponyCategory === 'cd') {
    if (hitch === 'par') return VAGN_RULE_ROWS.pony_cd_par;
    if (hitch === 'fyrspann') return VAGN_RULE_ROWS.pony_cd_fyrspann;
    return VAGN_RULE_ROWS.pony_bc_enbet_tandem;
  }

  if (hitch === 'par') return VAGN_RULE_ROWS.pony_cd_par;
  if (hitch === 'fyrspann') return VAGN_RULE_ROWS.pony_cd_fyrspann;
  return VAGN_RULE_ROWS.pony_bc_enbet_tandem;
}

export function getLevelBucket(className) {
  const cls = normalizeText(className);
  if (!cls) return null;
  if (cls.includes('latt b')) return 'lb';
  if (cls.includes('latt a') || cls.includes('msv') || cls.includes('medelsvar')) return 'laMsv';
  if (cls.includes('svar')) return 'svar';
  return null;
}

export function getDressageRule(row, className) {
  if (!row) return null;
  const bucket = getLevelBucket(className);
  if (bucket === 'lb') return row.dressagePrecision.lb;
  if (bucket === 'laMsv') return row.dressagePrecision.laMsv;
  if (bucket === 'svar') return row.dressagePrecision.svar;
  return null;
}

export function getMarathonRule(row, className) {
  if (!row) return null;
  const bucket = getLevelBucket(className);
  if (bucket === 'lb') return row.marathon.lb;
  if (bucket === 'laMsv' || bucket === 'svar') return row.marathon.laMsvSvar;
  return null;
}

export function matchesRule(value, rule) {
  if (!Number.isFinite(value)) return null;
  if (!rule || rule.kind === 'free') return true;
  if (rule.kind === 'forbidden') return false;
  if (rule.kind === 'min') return value >= rule.value;
  return false;
}

export function formatAllowedRuleValues(rule) {
  if (!rule || rule.kind !== 'min' || !Number.isFinite(rule.value)) {
    return '';
  }
  return `minst ${rule.value} cm`;
}

export function getRuleWarning(value, rule, label) {
  if (!Number.isFinite(value) || !rule || rule.kind === 'free') return '';
  if (rule.kind === 'forbidden') {
    return `${label} är inte tillåten för den här klassen enligt TR-bilaga 2.`;
  }

  const allowedText = formatAllowedRuleValues(rule);
  if (!allowedText || matchesRule(value, rule)) return '';

  return `${label} är för smal. Kravet här är ${allowedText} enligt TR.`;
}

export function getCarriageCompliance(equipage, discipline = 'dressagePrecision') {
  if (!equipage) {
    return {
      compliant: null,
      status: 'no_equipage',
      message: 'Inget ekipage valt'
    };
  }

  const row = resolveVagnRuleRow(equipage);
  const rule = discipline === 'marathon'
    ? getMarathonRule(row, equipage.className)
    : getDressageRule(row, equipage.className);

  const actualWidth = discipline === 'marathon'
    ? Number(equipage.marathonTrackWidth ?? equipage.marathonWidth ?? NaN)
    : Number(equipage.trackWidth ?? equipage.trackWidthCm ?? equipage.vagnbredd ?? equipage.spannvidd ?? NaN);

  const hasWidth = Number.isFinite(actualWidth) && actualWidth > 0;
  const safetyApproved = equipage?.safetyCheck?.approved ?? null;

  if (!rule) {
    return {
      compliant: hasWidth ? true : null,
      status: hasWidth ? 'ok' : 'missing',
      rule: null,
      actualWidth: hasWidth ? actualWidth : null,
      minWidth: null,
      safetyApproved,
      message: hasWidth ? `${actualWidth} cm` : 'Spårvidd ej angiven'
    };
  }

  if (rule.kind === 'forbidden') {
    return {
      compliant: false,
      status: 'forbidden',
      rule,
      actualWidth: hasWidth ? actualWidth : null,
      minWidth: null,
      safetyApproved,
      message: 'Ekipaget/vagnen är inte tillåten enligt TR Bilaga 2'
    };
  }

  if (rule.kind === 'free') {
    return {
      compliant: true,
      status: 'free',
      rule,
      actualWidth: hasWidth ? actualWidth : null,
      minWidth: null,
      safetyApproved,
      message: hasWidth ? `${actualWidth} cm (Fri spårvidd)` : 'Fri spårvidd'
    };
  }

  const minWidth = rule.value;
  if (!hasWidth) {
    return {
      compliant: null,
      status: 'missing',
      rule,
      actualWidth: null,
      minWidth,
      safetyApproved,
      message: `Spårvidd ej angiven (Krav: minst ${minWidth} cm)`
    };
  }

  if (actualWidth >= minWidth) {
    return {
      compliant: true,
      status: 'ok',
      rule,
      actualWidth,
      minWidth,
      safetyApproved,
      message: `${actualWidth} cm (Godkänd, minst ${minWidth} cm)`
    };
  }

  return {
    compliant: false,
    status: 'too_narrow',
    rule,
    actualWidth,
    minWidth,
    safetyApproved,
    message: `Vagn för smal: ${actualWidth} cm (Krav: minst ${minWidth} cm per TR Bilaga 2)`
  };
}
