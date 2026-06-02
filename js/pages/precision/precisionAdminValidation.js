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

export function validatePrecisionClassSettings(row = {}, { hasStandardTempo = false } = {}) {
  const errors = [];

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
