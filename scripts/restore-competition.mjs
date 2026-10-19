import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import {
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
  competitionRootPaths,
  fromExportValue,
  restoreWarnings,
  rewriteCompetitionId
} from '../functions/src/competitionExport.js';
import { isValidCompetitionId } from '../functions/src/adminJoin.js';
import {
  documentsNewerThanExport,
  findExtraDocuments,
  mergeRedactedFields,
  redactionsByPath
} from './restore-plan.mjs';

// Återställer en tävling från en säkerhetskopia (exportCompetition, JSON).
//
//   node scripts/restore-competition.mjs <backup.json> --project <id>
//        [--as-new-id <nyttId>] [--dry-run] [--overwrite [--prune] [--force]]
//        [--yes-production]
//
// --overwrite skriver dokumenten i kopian över de befintliga. Fält som
// kopian saknar med flit (PIN-koder, accessCode_*, personnummer) behålls från
// databasen. Dokument som bara finns i databasen (t.ex. lås satta efter
// kopian) lämnas kvar, om inte --prune anges. Har databasen ändrats efter
// att kopian togs nekas återställningen, om inte --force anges.
//
// Mot emulatorn: sätt FIRESTORE_EMULATOR_HOST (t.ex. 127.0.0.1:8080).
// Mot ett riktigt projekt: inloggning via GOOGLE_APPLICATION_CREDENTIALS
// (servicekonto) eller `gcloud auth application-default login`.

const PRODUCTION_PROJECT = 'combined-driving';
// Firestore allows 500 writes and about 10 MB per batch
const MAX_BATCH_WRITES = 450;
const MAX_BATCH_BYTES = 8 * 1024 * 1024;
const DELETION_FIELDS = ['deleting', 'deletingBy', 'deletingAt'];

const USAGE = `Användning:
  node scripts/restore-competition.mjs <backup.json> --project <projekt-id> [flaggor]

Flaggor:
  --project <id>       Firebase-projektet att skriva till (krävs)
  --as-new-id <id>     Återställ som en kopia med ett nytt Competition ID
  --dry-run            Kontrollera och visa vad som skulle skrivas, skriv inget
  --overwrite          Skriv över en tävling som redan finns (PIN-koder och
                       personnummer som saknas i kopian behålls från databasen)
  --prune              Med --overwrite: ta bort dokument som inte finns i kopian
                       (t.ex. finaliseringslås satta efter kopian)
  --force              Med --overwrite: skriv även om databasen har ändrats
                       efter att kopian togs (de ändringarna går förlorade)
  --yes-production     Krävs för att skriva till produktionen (${PRODUCTION_PROJECT});
                       --dry-run där läser bara och kräver den inte
  --help               Visa den här texten`;

function fail(message) {
  console.error(`\nFEL: ${message}\n`);
  process.exit(1);
}

let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      project: { type: 'string' },
      'as-new-id': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      overwrite: { type: 'boolean', default: false },
      prune: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      'yes-production': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false }
    }
  });
} catch (error) {
  fail(`${error.message}\n\n${USAGE}`);
}
const { values: opts, positionals } = args;
if (opts.help) {
  console.log(USAGE);
  process.exit(0);
}
if (positionals.length !== 1) fail(`Ange exakt en säkerhetskopia (JSON-fil).\n\n${USAGE}`);
const projectId = String(opts.project || '').trim();
if (!projectId) fail(`--project krävs, så att ingen återställning hamnar i fel projekt av misstag.\n\n${USAGE}`);
if ((opts.prune || opts.force) && !opts.overwrite) fail(`--prune och --force gäller bara tillsammans med --overwrite.\n\n${USAGE}`);
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '';

if (projectId === PRODUCTION_PROJECT) {
  console.warn('\n!!! VARNING: målet är PRODUKTIONSPROJEKTET combined-driving !!!');
  console.warn('!!! Återställningen skriver till den riktiga databasen som tävlingarna använder. !!!\n');
  // A dry run only reads
  if (!opts['yes-production'] && !opts['dry-run']) fail('Lägg till --yes-production om du verkligen vill skriva till produktionen (prova först med --dry-run).');
}

// --- Read and check the backup ---
let exportData;
try {
  exportData = JSON.parse(readFileSync(positionals[0], 'utf8'));
} catch (error) {
  fail(`Kunde inte läsa ${positionals[0]}: ${error.message}`);
}
if (exportData?.format !== EXPORT_FORMAT) fail(`Filen är ingen säkerhetskopia av en tävling (format "${exportData?.format}").`);
if (exportData.formatVersion !== EXPORT_FORMAT_VERSION) fail(`Okänd version av säkerhetskopian: ${exportData.formatVersion} (stöds: ${EXPORT_FORMAT_VERSION}).`);
const sourceId = String(exportData.competitionId || '');
const appId = String(exportData.appId || '');
if (!isValidCompetitionId(sourceId)) fail(`Ogiltigt Competition ID i kopian: "${sourceId}".`);
if (!appId || appId.includes('/')) fail(`Ogiltigt appId i kopian: "${appId}".`);
if (!Array.isArray(exportData.documents) || exportData.documents.length === 0) fail('Kopian innehåller inga dokument.');

// Every document must lie in the competition's own trees: a changed file
// cannot write anywhere else
const sourceRoots = competitionRootPaths(appId, sourceId);
for (const doc of exportData.documents) {
  const path = String(doc?.path || '');
  const segments = path.split('/');
  const inside = sourceRoots.some(root => path === root || path.startsWith(`${root}/`));
  if (!inside || segments.length % 2 !== 0 || segments.some(s => !s) || !doc.data || typeof doc.data !== 'object') {
    fail(`Dokumentet "${path}" hör inte till tävlingen ${sourceId} eller är trasigt.`);
  }
}

let targetId = sourceId;
let documents = exportData.documents;
let fieldsChanged = 0;
if (opts['as-new-id'] !== undefined) {
  targetId = String(opts['as-new-id']).trim();
  if (!isValidCompetitionId(targetId)) fail(`Ogiltigt nytt Competition ID: "${targetId}" (tillåtet: A-Z, a-z, 0-9, _ och -).`);
  if (targetId === sourceId) fail('--as-new-id är samma som tävlingens eget ID.');
  ({ documents, fieldsChanged } = rewriteCompetitionId(documents, sourceId, targetId));
}
const targetRoots = competitionRootPaths(appId, targetId);
const publicRoot = targetRoots[0];

// A copy taken during a deletion would stop the result triggers
const notes = [];
documents = documents.map(doc => {
  if (doc.path !== publicRoot || !DELETION_FIELDS.some(f => f in doc.data)) return doc;
  const data = { ...doc.data };
  DELETION_FIELDS.forEach(f => delete data[f]);
  notes.push('Raderingsmarkeringen (deleting) på tävlingsdokumentet togs bort.');
  return { path: doc.path, data };
});
// The competition document first: the result triggers look for it
documents = [...documents].sort((a, b) => (a.path === publicRoot ? -1 : b.path === publicRoot ? 1 : 0));

// --- Firestore (Admin SDK from functions/node_modules) ---
const requireFromFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
let adminApp;
let adminFirestore;
try {
  adminApp = requireFromFunctions('firebase-admin/app');
  adminFirestore = requireFromFunctions('firebase-admin/firestore');
} catch {
  fail('firebase-admin saknas. Kör först: npm --prefix functions install');
}
const { Timestamp, GeoPoint, getFirestore } = adminFirestore;
adminApp.initializeApp({ projectId });
const db = getFirestore();
const factories = {
  timestamp: ms => Timestamp.fromMillis(ms),
  geopoint: (lat, lng) => new GeoPoint(lat, lng),
  ref: path => db.doc(path),
  bytes: base64 => Buffer.from(base64, 'base64')
};

console.log(`Säkerhetskopia: ${positionals[0]}`);
console.log(`  Tävling: ${exportData.name || '(namn saknas)'} (${sourceId}), app ${appId}`);
console.log(`  Exporterad: ${exportData.exportedAt || 'okänt'}, ${documents.length} dokument`);
console.log(`Mål: projekt ${projectId}${emulatorHost ? ` (EMULATOR ${emulatorHost})` : ''}, Competition ID ${targetId}`);
if (targetId !== sourceId) console.log(`  Kopia med nytt ID: ${fieldsChanged} fält med det gamla ID:t skrevs om.`);
if (!emulatorHost && projectId !== PRODUCTION_PROJECT) console.warn('  Obs: ingen emulator (FIRESTORE_EMULATOR_HOST), skriver till ett riktigt projekt.');

// Converting everything first: a broken value stops before anything is written
let prepared;
try {
  prepared = documents.map(doc => ({ path: doc.path, data: fromExportValue(doc.data, factories), size: JSON.stringify(doc.data).length }));
} catch (error) {
  fail(error.message);
}

// --- Does the competition already exist? ---
async function treeExists(path) {
  const ref = db.doc(path);
  const [snap, collections] = await Promise.all([ref.get(), ref.listCollections()]);
  return snap.exists || collections.length > 0;
}
const existing = [];
for (const root of targetRoots) {
  if (await treeExists(root)) existing.push(root);
}
if (existing.length && !opts.overwrite) {
  fail(`Tävlingen ${targetId} finns redan (${existing.join(', ')}).\n` +
    'Använd --overwrite för att skriva över den, eller --as-new-id <id> för att återställa en kopia bredvid.');
}
// Every document under the roots, as stored (Firestore types) with its last
// change time
async function collectLive(docRef, out) {
  const snap = await docRef.get();
  if (snap.exists) out.push({ path: docRef.path, data: snap.data(), updateMs: snap.updateTime?.toMillis?.() ?? null });
  const collections = await docRef.listCollections();
  for (const collection of collections) {
    const refs = await collection.listDocuments();
    for (const ref of refs) await collectLive(ref, out);
  }
  return out;
}

// What the backup left out on purpose, under the target's paths
const mapRedactedPath = targetId === sourceId
  ? (path) => path
  : (path) => rewriteCompetitionId([{ path, data: {} }], sourceId, targetId).documents[0].path;
const { fieldsByPath: redactedFields, wholeDocuments: redactedDocuments } = redactionsByPath(exportData.redacted, mapRedactedPath);
let toPrune = [];
let keptRedacted = 0;
if (existing.length) {
  const live = [];
  for (const root of existing) await collectLive(db.doc(root), live);
  const liveByPath = new Map(live.map(d => [d.path, d]));

  // Changed after the backup was taken: the restore would undo it
  const newer = documentsNewerThanExport(live, exportData.exportedAt);
  if (newer.length) {
    const list = newer.slice(0, 10).map(d => `    ${d.path}${d.updateMs ? ` (${new Date(d.updateMs).toISOString()})` : ''}`).join('\n');
    const message = `${newer.length} dokument i databasen har ändrats efter att kopian togs (${exportData.exportedAt || 'okänd tid'}):\n${list}${newer.length > 10 ? '\n    ...' : ''}`;
    if (!opts.force && !opts['dry-run']) {
      fail(`${message}\nÅterställningen skulle skriva över de ändringarna. Ta en ny kopia, eller kör med --force om de verkligen ska skrivas över.`);
    }
    console.warn(`\nVARNING: ${message}${opts.force ? '\n  --force: de skrivs över.' : '\n  (Utan --force nekas återställningen.)'}`);
  }

  // Fields the backup left out are kept from the database (a plain overwrite
  // would delete PINs and personal identity numbers)
  prepared = prepared.map((doc) => {
    const fields = redactedFields.get(doc.path);
    const current = liveByPath.get(doc.path);
    if (!fields || !current) return doc;
    const { data, kept } = mergeRedactedFields(doc.data, current.data, fields);
    keptRedacted += kept.length;
    return { ...doc, data };
  });

  const extra = findExtraDocuments(live.map(d => d.path), prepared.map(d => d.path), redactedDocuments);
  console.warn(`\nVARNING: --overwrite: ${live.length} befintliga dokument; dokument i kopian skrivs över (${keptRedacted} fält som kopian saknar behålls från databasen).`);
  if (extra.length) {
    if (opts.prune) {
      toPrune = extra;
      console.warn(`  --prune: ${extra.length} dokument finns bara i databasen (inte i kopian) och tas bort:`);
    } else {
      console.warn(`  ${extra.length} dokument finns bara i databasen (inte i kopian) och lämnas orörda (--prune tar bort dem):`);
    }
    extra.slice(0, 10).forEach(path => console.warn(`    ${path}`));
    if (extra.length > 10) console.warn('    ...');
  }
}
const tombstone = await db.doc(`deletedCompetitions/${targetId}`).get();
if (tombstone.exists) {
  notes.push(`Tävlingen har raderats tidigare (deletedCompetitions/${targetId}, status ${tombstone.data()?.status || 'okänd'}); posten lämnas kvar som historik.`);
}

// --- Summary per tree and collection ---
function summarize(docs) {
  const counts = new Map();
  docs.forEach(({ path }) => {
    const root = targetRoots.find(r => path === r || path.startsWith(`${r}/`));
    const rest = path.slice(root.length + 1);
    const key = `${root}${rest ? `/${rest.split('/')[0]}` : ''}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
}
console.log('\nDokument per samling:');
summarize(prepared).forEach(([key, n]) => console.log(`  ${String(n).padStart(5)}  ${key}`));

if (opts['dry-run']) {
  console.log(`\nTorrkörning (--dry-run): ${prepared.length} dokument skulle skrivas${toPrune.length ? ` och ${toPrune.length} tas bort` : ''}. Inget skrevs.`);
} else {
  let batch = db.batch();
  let ops = 0;
  let bytes = 0;
  let written = 0;
  let batches = 0;
  const commit = async () => {
    if (!ops) return;
    await batch.commit();
    written += ops;
    batches++;
    console.log(`  skrev ${written}/${prepared.length}`);
    batch = db.batch();
    ops = 0;
    bytes = 0;
  };
  console.log('\nSkriver...');
  try {
    for (const doc of prepared) {
      if (ops >= MAX_BATCH_WRITES || (ops && bytes + doc.size > MAX_BATCH_BYTES)) await commit();
      batch.set(db.doc(doc.path), doc.data);
      ops++;
      bytes += doc.size;
    }
    // --prune: what only the database had (deleted last, after the restore)
    for (const path of toPrune) {
      if (ops >= MAX_BATCH_WRITES) await commit();
      batch.delete(db.doc(path));
      ops++;
    }
    await commit();
  } catch (error) {
    fail(`Skrivningen avbröts efter ${written} dokument: ${error.message}\nKör igen med --overwrite --force för att slutföra (databasen är nu nyare än kopian).`);
  }
  console.log(`\nKlart: ${written - toPrune.length} dokument återställda${toPrune.length ? ` och ${toPrune.length} borttagna` : ''} i ${batches} omgångar till ${projectId}, tävling ${targetId}.`);
  if (!emulatorHost) console.log('Molnfunktionerna räknar om resultaten när dokumenten skrivs.');
}

console.log('\nDetta återställs INTE:');
[...notes, ...restoreWarnings(exportData)].forEach(line => console.warn(`  - ${line}`));
if (targetId !== sourceId) {
  console.warn(`  - Kopian heter samma sak som originalet (${exportData.name || sourceId}); byt namn i appen så att de går att skilja åt.`);
}
process.exit(0);
