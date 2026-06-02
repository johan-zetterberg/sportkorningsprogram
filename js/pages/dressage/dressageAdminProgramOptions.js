export function getDressageProgramTrNumber(program = {}) {
  const candidates = [
    program.trNumber,
    program.programNumber,
    program.number,
    program.name,
    program.source,
    program.title
  ];

  for (const value of candidates) {
    const match = String(value || '').match(/\b(?:nr|nummer|program)?\s*#?\s*(\d{3})\b/i);
    if (match) return match[1];
  }

  return '';
}

export function formatDressageProgramOptionLabel(key, program = {}) {
  const trNumber = getDressageProgramTrNumber(program);
  const name = String(program.name || program.title || key || '')
    .replace(/\s*\(\s*nr\s*\d{3}\s*\)\s*/ig, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const version = program.version && !name.includes(String(program.version))
    ? `, ${program.version}`
    : '';
  const arena = program.arena ? `, ${program.arena}` : '';
  const prefix = trNumber ? `nr ${trNumber} - ` : '';
  const suffix = key ? ` - ${key}` : '';

  return `${prefix}${name}${version}${arena}${suffix}`.trim();
}

export function sortDressageProgramKeys(programs = {}) {
  return Object.keys(programs).sort((a, b) => {
    const rawNrA = getDressageProgramTrNumber(programs[a]);
    const rawNrB = getDressageProgramTrNumber(programs[b]);
    const hasNrA = rawNrA !== '';
    const hasNrB = rawNrB !== '';
    const nrA = Number(rawNrA);
    const nrB = Number(rawNrB);
    if (hasNrA && hasNrB && nrA !== nrB) return nrA - nrB;
    if (hasNrA && !hasNrB) return -1;
    if (!hasNrA && hasNrB) return 1;
    return formatDressageProgramOptionLabel(a, programs[a]).localeCompare(
      formatDressageProgramOptionLabel(b, programs[b]),
      'sv',
      { numeric: true }
    );
  });
}
