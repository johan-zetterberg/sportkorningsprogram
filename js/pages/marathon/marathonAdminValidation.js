function isPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function isPositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0;
}

function addError(errors, field, message) {
  errors.push({ field, message });
}

export function validateDrivenObstacles(value) {
  const text = String(value || '').trim();
  if (!text) return true;

  return text
    .split(',')
    .map(part => part.trim())
    .every(part => /^\d+$/.test(part) && Number(part) > 0);
}

export function validateMarathonClassSettings(row = {}, {
  hasTempoA = false,
  hasTempoB = false
} = {}) {
  const errors = [];
  const fixedTimeA = Number(row.fixedTimeA);
  const hasFixedWarmup = Number.isFinite(fixedTimeA) && fixedTimeA > 0;

  if (!hasFixedWarmup && !isPositiveNumber(row.distanceA)) {
    addError(errors, 'distanceA', 'Etapp A saknar distans eller fast warm-up-tid.');
  }

  if (!hasFixedWarmup && !hasTempoA) {
    addError(errors, 'tempoA', 'Etapp A saknar tempo och ingen TR-mall ger tempo.');
  }

  if (!isPositiveNumber(row.windowA)) {
    addError(errors, 'windowA', 'Etapp A saknar tidsfönster i minuter.');
  }

  if (!isPositiveNumber(row.distanceB)) {
    addError(errors, 'distanceB', 'Etapp B saknar distans.');
  }

  if (!hasTempoB) {
    addError(errors, 'tempoB', 'Etapp B saknar tempo och ingen TR-mall ger tempo.');
  }

  if (!isPositiveNumber(row.windowB)) {
    addError(errors, 'windowB', 'Etapp B saknar tidsfönster i minuter.');
  }

  if (row.includeTransport === true) {
    if (!isPositiveNumber(row.distanceT)) {
      addError(errors, 'distanceT', 'Transport saknar distans.');
    }

    if (!isPositiveNumber(row.tempoT)) {
      addError(errors, 'tempoT', 'Transport saknar tempo.');
    }
  }

  if (!isPositiveInteger(Number(row.gateCount))) {
    addError(errors, 'gateCount', 'Antal portar måste vara ett heltal större än 0.');
  }

  if (!validateDrivenObstacles(row.drivenObstacles)) {
    addError(errors, 'drivenObstacles', 'Körda hinder ska anges som kommaseparerade nummer, t.ex. 1,2,3,4.');
  }

  return errors;
}

export function validateMarathonAdminSettings(classData = {}, getTempoState = () => ({})) {
  const result = {};

  for (const [className, row] of Object.entries(classData || {})) {
    const errors = validateMarathonClassSettings(row, getTempoState(className, row));
    if (errors.length) result[className] = errors;
  }

  return result;
}

export function hasMarathonValidationErrors(validationResult = {}) {
  return Object.values(validationResult).some(errors => Array.isArray(errors) && errors.length > 0);
}
