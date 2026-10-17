import { VET_PHASES, getHorseStableKey, vetPhaseField } from '../shared/vetCheckUtils.js';

// A second import of the entry file must not undo what happened in the app:
// check-in, vet results, payments, a class the admin changed. For an equipage
// already in the competition only the registration data the file owns is
// updated; everything else is kept. The result is a partial update (only the
// fields that change), written with a merge.

// Registration data the file owns: always taken from the file
const FILE_OWNED_FIELDS = [
  'driverName', 'clubName',
  'licence', 'email', 'phone', 'address', 'gender', 'bornYear', 'country', 'company', 'licenseYear',
  'tdbClassNumber', 'tdbClassLabel', 'tdbHorseCode', 'tdbHorseText', 'tdbOriginalXmlClassName',
  'driverStartCount', 'hasMultipleStarts', 'driverOtherStarts'
];

// May be edited in the app (or come from elsewhere): only filled when empty
const FILL_IF_EMPTY_FIELDS = [
  'groomName', 'notes', 'adminComments', 'administrativeFees',
  'useMergedTestForDisplay', 'mergedTestKey', 'mergedTestLabel'
];

// Follow the class: taken from the file only when the class is
const CLASS_FIELDS = ['className', 'isPara', 'paraGrade', 'testKey', 'programKey'];

// The fields getHorseStableKey reads: changing one re-keys the horse
const HORSE_KEY_FIELDS = ['id', 'uid', 'chipNumber', 'chip', 'lic', 'license', 'name', 'horseName'];

const DEFAULT_STATUSES = new Set(['', 'anmäld']);

function isEmpty(value) {
  if (value == null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.values(value).every(isEmpty);
  return false;
}

function sameValue(a, b) {
  if (a === b) return true;
  if (isEmpty(a) && isEmpty(b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every(key => sameValue(a[key], b[key]));
}

const normName = value => String(value ?? '').trim().toLowerCase();

/** Whether the horse (stable key `key`) has any vet result on the equipage or in the vet's private findings */
export function horseHasVetResults(equipage = {}, horse = {}, key = '', clinicalByHorse = {}) {
  if (horse?.vetStatus || (horse?.inspections && !isEmpty(horse.inspections))) return true;
  if (clinicalByHorse?.[key] && !isEmpty(clinicalByHorse[key])) return true;
  return Object.keys(VET_PHASES).some(phase => equipage?.[vetPhaseField(phase)]?.horses?.[key]);
}

function findExistingHorse(existingHorses, fileHorse, used) {
  const fileKey = getHorseStableKey(fileHorse, -1);
  const candidates = existingHorses
    .map((horse, index) => ({ horse, index }))
    .filter(({ index }) => !used.has(index));
  const byKey = candidates.find(({ horse, index }) => getHorseStableKey(horse, index) === fileKey);
  if (byKey) return byKey;
  const name = normName(fileHorse.name || fileHorse.horseName);
  if (name) {
    const byName = candidates.find(({ horse }) => normName(horse?.name || horse?.horseName) === name);
    if (byName) return byName;
  }
  const regNo = normName(fileHorse.regNo);
  if (regNo) return candidates.find(({ horse }) => normName(horse?.regNo) === regNo) || null;
  return null;
}

/**
 * The horses updated in place: a file horse matching an existing one (stable
 * key, name or reg. no.) updates its data; a horse with vet results keeps the
 * fields of its key, so its results stay attached. Existing horses the file
 * does not list are kept; new ones are added at the end.
 */
export function mergeImportedHorses(existing = {}, fileHorses = [], clinicalByHorse = {}) {
  const existingHorses = Array.isArray(existing.horses) ? existing.horses : [];
  const merged = existingHorses.map(horse => horse);
  const used = new Set();
  const added = [];
  const keptKeys = []; // vet horses whose key the file would have changed
  const vetHorses = []; // vet horses updated in place

  (Array.isArray(fileHorses) ? fileHorses : []).forEach(fileHorse => {
    if (!fileHorse || typeof fileHorse !== 'object') return;
    const match = findExistingHorse(existingHorses, fileHorse, used);
    if (!match) {
      merged.push({ ...fileHorse });
      added.push(fileHorse.name || fileHorse.regNo || '');
      return;
    }
    used.add(match.index);
    const old = match.horse || {};
    const oldKey = getHorseStableKey(old, match.index);
    const next = { ...old };
    // An empty value in the file does not clear what is stored
    Object.entries(fileHorse).forEach(([field, value]) => {
      if (!isEmpty(value)) next[field] = value;
    });
    if (horseHasVetResults(existing, old, oldKey, clinicalByHorse)) {
      if (getHorseStableKey(next, match.index) !== oldKey) {
        // The results are stored under the old key: keep the fields giving it
        HORSE_KEY_FIELDS.forEach(field => {
          if (field in old) next[field] = old[field];
          else delete next[field];
        });
        keptKeys.push(old.name || old.horseName || oldKey);
      }
      if (!sameValue(old, next)) vetHorses.push(old.name || old.horseName || oldKey);
    }
    merged[match.index] = next;
  });

  return { horses: merged, added, keptKeys, vetHorses };
}

/**
 * The decision for one imported entry. `existing` is the stored equipage
 * (public and private fields), null for a new one; `imported` the entry from
 * the file with its class mapped. Returns { kind: 'new'|'updated'|'unchanged',
 * patch, conflicts }: patch holds only the fields to write.
 */
export function buildImportMerge(existing, imported = {}, { clinicalByHorse = {} } = {}) {
  const fileClass = imported.className ?? '';
  const fileStatus = imported.status || 'anmäld';

  if (!existing) {
    return {
      kind: 'new',
      patch: { ...imported, importedClassName: fileClass, importedStatus: fileStatus },
      conflicts: []
    };
  }

  const patch = {};
  const conflicts = [];
  const set = (field, value) => {
    if (!sameValue(existing[field], value)) patch[field] = value;
  };

  // An empty value in the file does not clear what is stored
  FILE_OWNED_FIELDS.forEach(field => {
    if (field in imported && !isEmpty(imported[field])) set(field, imported[field]);
  });

  // false counts as set (useMergedTestForDisplay turned off in the app)
  FILL_IF_EMPTY_FIELDS.forEach(field => {
    if (field in imported && isEmpty(existing[field]) && !isEmpty(imported[field])) {
      set(field, imported[field]);
    }
  });

  // Track widths come in pairs with their source
  if (isEmpty(existing.trackWidth) && !isEmpty(imported.trackWidth)) {
    set('trackWidth', imported.trackWidth);
    set('trackWidthSource', imported.trackWidthSource ?? null);
  }
  if (isEmpty(existing.marathonTrackWidth) && !isEmpty(imported.marathonTrackWidth)) {
    set('marathonTrackWidth', imported.marathonTrackWidth);
    set('marathonTrackWidthSource', imported.marathonTrackWidthSource ?? null);
  }

  // Payment: what is recorded in the app is kept, only empty fields are filled
  if (imported.payment && typeof imported.payment === 'object') {
    const current = existing.payment && typeof existing.payment === 'object' ? existing.payment : {};
    const fill = {};
    Object.entries(imported.payment).forEach(([key, value]) => {
      if (isEmpty(current[key]) && !isEmpty(value)) fill[key] = value;
    });
    if (Object.keys(fill).length) patch.payment = fill;
  }

  // Class: the file's change is taken, the admin's change is kept
  const currentClass = existing.className ?? '';
  const lastImportedClass = existing.importedClassName;
  if (currentClass !== fileClass) {
    const adminChanged = lastImportedClass === undefined || currentClass !== lastImportedClass;
    if (adminChanged) {
      conflicts.push({ type: 'class', existing: currentClass, imported: fileClass });
    } else {
      CLASS_FIELDS.forEach(field => {
        if (field in imported) set(field, imported[field]);
      });
    }
  }
  set('importedClassName', fileClass);

  // Status: set in the app (checked in, inspected, withdrawn) is kept
  const currentStatus = existing.status ?? '';
  if (currentStatus !== fileStatus) {
    const fromFile = DEFAULT_STATUSES.has(currentStatus)
      || (existing.importedStatus !== undefined && currentStatus === existing.importedStatus);
    if (fromFile) set('status', fileStatus);
    else conflicts.push({ type: 'status', existing: currentStatus, imported: fileStatus });
  }
  set('importedStatus', fileStatus);

  if (Array.isArray(imported.horses)) {
    const { horses, keptKeys, vetHorses } = mergeImportedHorses(existing, imported.horses, clinicalByHorse);
    set('horses', horses);
    if (vetHorses.length || keptKeys.length) conflicts.push({ type: 'vetHorses', horses: vetHorses, keptKeys });
  }

  // Only the bookkeeping fields: nothing the admin sees changed
  const visible = Object.keys(patch).filter(field => field !== 'importedClassName' && field !== 'importedStatus');
  return { kind: visible.length ? 'updated' : 'unchanged', patch, conflicts };
}

/** Counts and conflicts of a planned import, for the summary shown to the admin */
export function summarizeImportPlan(plan = []) {
  const summary = { new: 0, updated: 0, unchanged: 0, conflicts: [] };
  plan.forEach(item => {
    summary[item.kind] = (summary[item.kind] || 0) + 1;
    (item.conflicts || []).forEach(conflict => summary.conflicts.push({
      startNumber: item.startNumber,
      driverName: item.driverName,
      ...conflict
    }));
  });
  return summary;
}
