// Decisions of scripts/restore-competition.mjs that do not need Firestore
// (tested in tests/restore-plan.test.js).

/** "horses[0].ssn" -> ['horses', 0, 'ssn'] (the paths redactExportDocuments records) */
export function parseFieldPath(fieldPath) {
  const parts = [];
  String(fieldPath || '').split('.').forEach((segment) => {
    const re = /([^[\]]+)|\[(\d+)\]/g;
    let match;
    while ((match = re.exec(segment)) !== null) {
      parts.push(match[1] !== undefined ? match[1] : Number(match[2]));
    }
  });
  return parts;
}

const isObject = (value) => value !== null && typeof value === 'object';

function getAtPath(source, parts) {
  let current = source;
  for (const part of parts) {
    if (!isObject(current) || !(part in current)) return undefined;
    current = current[part];
  }
  return current;
}

// Sets the value inside a copy of `target`. Maps on the way are created; an
// array element must exist already (the list in the backup decides its
// length). Returns the new object, or null when the path cannot be placed.
function setAtPath(target, parts, value) {
  if (!parts.length) return null;
  const root = Array.isArray(target) ? [...target] : { ...target };
  let current = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const nextIsIndex = typeof parts[i + 1] === 'number';
    let child = current[part];
    if (child === undefined || child === null) {
      if (nextIsIndex || typeof part === 'number') return null;
      child = {};
    } else if (!isObject(child)) {
      return null;
    } else {
      child = Array.isArray(child) ? [...child] : { ...child };
    }
    if (typeof parts[i + 1] === 'number' && (!Array.isArray(child) || parts[i + 1] >= child.length)) return null;
    current[part] = child;
    current = child;
  }
  current[parts[parts.length - 1]] = value;
  return root;
}

/**
 * The fields a backup left out (PINs, accessCode_*, personal identity
 * numbers), per document path: { fieldsByPath: Map(path -> [fieldPath]),
 * wholeDocuments: Set(path) }. `mapPath` moves paths to another competition id.
 */
export function redactionsByPath(redacted = [], mapPath = (path) => path) {
  const fieldsByPath = new Map();
  const wholeDocuments = new Set();
  (Array.isArray(redacted) ? redacted : []).forEach((entry) => {
    if (!entry?.path) return;
    const path = mapPath(String(entry.path));
    if (!entry.field) {
      wholeDocuments.add(path);
      return;
    }
    if (!fieldsByPath.has(path)) fieldsByPath.set(path, []);
    fieldsByPath.get(path).push(String(entry.field));
  });
  return { fieldsByPath, wholeDocuments };
}

/**
 * The restored document with the fields the backup left out taken from the
 * document now in the database, so overwriting it does not delete PINs or
 * personal identity numbers. Returns { data, kept } (kept: field paths put back).
 */
export function mergeRedactedFields(restored = {}, live = null, fieldPaths = []) {
  let data = restored;
  const kept = [];
  if (!live) return { data, kept };
  fieldPaths.forEach((fieldPath) => {
    const parts = parseFieldPath(fieldPath);
    const value = getAtPath(live, parts);
    if (value === undefined) return;
    const next = setAtPath(data, parts, value);
    if (next) {
      data = next;
      kept.push(fieldPath);
    }
  });
  return { data, kept };
}

/**
 * Documents in the database that the backup does not have. Documents the
 * backup left out on purpose (config/secrets) are never among them.
 */
export function findExtraDocuments(livePaths = [], restoredPaths = [], keepPaths = new Set()) {
  const restored = new Set(restoredPaths);
  return livePaths.filter(path => !restored.has(path) && !keepPaths.has(path)).sort();
}

/**
 * Database documents changed after the backup was taken ({ path, updateMs }),
 * newest first. A restore over them would undo those changes.
 */
export function documentsNewerThanExport(liveDocs = [], exportedAt = null) {
  const exportedMs = Date.parse(String(exportedAt || ''));
  if (!Number.isFinite(exportedMs)) {
    // Unknown age: every document counts as possibly newer
    return liveDocs.map(d => ({ path: d.path, updateMs: d.updateMs ?? null }));
  }
  return liveDocs
    .filter(d => Number.isFinite(d.updateMs) && d.updateMs > exportedMs)
    .sort((a, b) => b.updateMs - a.updateMs)
    .map(d => ({ path: d.path, updateMs: d.updateMs }));
}
