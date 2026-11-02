function isBlank(value) {
  return String(value ?? '').trim() === '';
}

function parseNumber(value) {
  const text = String(value ?? '').trim().replace(',', '.');
  if (text === '') return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function isPositiveNumber(value) {
  const number = parseNumber(value);
  return number != null && number > 0;
}

function addError(errors, field, message) {
  errors.push({ field, message });
}

export function parsePrecisionObstacleLabels(value) {
  return String(value ?? '')
    .split(/[,\n\r]+/)
    .map(label => label.trim())
    .filter(Boolean);
}

// Arena driving (format 'arena'): no track length or tempo; the course is the
// obstacle list. row.arena = { rules, knockSec, incidentSec: { key: raw }, obstacles: [{ label, type }] }
export function validatePrecisionArenaSettings(arena = {}) {
  const errors = [];
  const labels = (Array.isArray(arena.obstacles) ? arena.obstacles : [])
    .map(o => String(o?.label ?? '').trim())
    .filter(Boolean);

  if (!labels.length) {
    addError(errors, 'arenaObstacles', 'Banan saknar hinder. Lägg till minst ett hinder med namn.');
  } else {
    if (labels.some(label => label.includes('#'))) {
      addError(errors, 'arenaObstacles', 'Hindernamn får inte innehålla #.');
    }
    if (labels.some(label => label.length > 12)) {
      addError(errors, 'arenaObstacles', 'Hindernamn får vara högst 12 tecken.');
    }
    const seen = new Set();
    const duplicates = new Set();
    labels.forEach((label) => {
      const key = label.toLowerCase();
      if (seen.has(key)) duplicates.add(label);
      seen.add(key);
    });
    if (duplicates.size) {
      addError(errors, 'arenaObstacles', `Hindernamnen måste vara unika (dubbletter: ${[...duplicates].join(', ')}).`);
    }
  }

  // The FEI seconds are fixed; TR's are the organiser's
  if (arena.rules === 'TR') {
    const values = [arena.knockSec, ...Object.values(arena.incidentSec || {})];
    const invalid = values.some((value) => {
      const number = parseNumber(value);
      return number == null || number < 0;
    });
    if (invalid) addError(errors, 'arenaSeconds', 'Straffsekunder måste vara tal som är 0 eller större.');
  }

  return errors;
}

export function validatePrecisionClassSettings(row = {}, { hasStandardTempo = false } = {}) {
  const errors = [];

  if (row.format === 'arena') {
    errors.push(...validatePrecisionArenaSettings(row.arena));
    if (!isBlank(row.allowanceOverride) && !isPositiveNumber(row.allowanceOverride)) {
      addError(errors, 'allowanceOverride', 'Manuellt port-tillagg maste vara ett tal storre an 0.');
    }
    return errors;
  }

  if (!isPositiveNumber(row.trackLengthMeters)) {
    addError(errors, 'trackLengthMeters', 'Banlangd saknas eller ar inte storre an 0 meter.');
  }

  if (!hasStandardTempo && !isPositiveNumber(row.tempo)) {
    addError(errors, 'tempo', 'Tempo saknas och ingen TR-mall ger tempo for klassen.');
  }

  if (!parsePrecisionObstacleLabels(row.obstacleLabelsText ?? row.obstacleLabels).length) {
    addError(errors, 'obstacleLabels', 'Hinderetiketter saknas.');
  }

  if (!isBlank(row.allowanceOverride) && !isPositiveNumber(row.allowanceOverride)) {
    addError(errors, 'allowanceOverride', 'Manuellt port-tillagg maste vara ett tal storre an 0.');
  }

  for (const [label, value] of Object.entries(row.specialPortAllowance || {})) {
    if (isBlank(value)) continue;
    if (parseNumber(value) == null) {
      addError(errors, 'specialPortAllowance', `Sarskild port for ${label} maste vara ett giltigt tal.`);
    }
  }

  return errors;
}

export function validatePrecisionGlobalSettings(global = {}) {
  const errors = [];

  if (!isBlank(global.knockdownPenalty) && !isPositiveNumber(global.knockdownPenalty)) {
    addError(errors, 'knockdownPenalty', 'Straff per nedslag maste vara ett tal storre an 0.');
  }

  if (!isBlank(global.timePenaltyRate) && !isPositiveNumber(global.timePenaltyRate)) {
    addError(errors, 'timePenaltyRate', 'Tidsstraff per sekund maste vara ett tal storre an 0.');
  }

  return errors;
}

export function validatePrecisionMapSettings(map = {}) {
  const errors = [];

  if (!map.enabled) return errors;

  if (map.entitiesParseError) {
    addError(errors, 'entities', 'Koordinater maste vara giltig JSON.');
    return errors;
  }

  const entities = map.entities || {};
  if (!Array.isArray(entities.start) || !Array.isArray(entities.finish)) {
    addError(errors, 'entities', 'Aktiverad karta behover minst start och mal.');
  }

  return errors;
}

export function validatePrecisionAdminSettings(settings = {}, getTempoState = () => ({})) {
  const result = {
    classes: {},
    global: validatePrecisionGlobalSettings(settings.global),
    map: validatePrecisionMapSettings(settings.map)
  };

  for (const [className, row] of Object.entries(settings.classes || {})) {
    const errors = validatePrecisionClassSettings(row, getTempoState(className, row));
    if (errors.length) result.classes[className] = errors;
  }

  return result;
}

export function hasPrecisionValidationErrors(result = {}) {
  return Boolean(
    result.global?.length ||
    result.map?.length ||
    Object.values(result.classes || {}).some(errors => Array.isArray(errors) && errors.length > 0)
  );
}
