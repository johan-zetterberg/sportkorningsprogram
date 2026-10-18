import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import {
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
  collectDocuments,
  competitionRootPaths,
  fromExportValue,
  restoreWarnings,
  rewriteCompetitionId
} from '../functions/src/competitionExport.js';
import { isValidCompetitionId } from '../functions/src/adminJoin.js';

// Återställer en tävling från en säkerhetskopia (exportCompetition, JSON).
//
//   node scripts/restore-competition.mjs <backup.json> --project <id>
//        [--as-new-id <nyttId>] [--dry-run] [--overwrite] [--yes-production]
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
  --overwrite          Skriv över en tävling som redan finns
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
if (existing.length) {
  const restoredPaths = new Set(prepared.map(d => d.path));
  const current = [];
  for (const root of existing) await collectDocuments(db.doc(root), { out: current });
  const extra = current.filter(d => !restoredPaths.has(d.path)).map(d => d.path);
  console.warn(`\nVARNING: --overwrite: ${current.length} befintliga dokument; dokument i kopian skrivs över helt.`);
  if (extra.length) {
    console.warn(`  ${extra.length} dokument finns bara i databasen (inte i kopian) och lämnas orörda:`);
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
  console.log(`\nTorrkörning (--dry-run): ${prepared.length} dokument skulle skrivas. Inget skrevs.`);
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
    await commit();
  } catch (error) {
    fail(`Skrivningen avbröts efter ${written} dokument: ${error.message}\nKör igen med --overwrite för att slutföra.`);
  }
  console.log(`\nKlart: ${written} dokument återställda i ${batches} omgångar till ${projectId}, tävling ${targetId}.`);
  if (!emulatorHost) console.log('Molnfunktionerna räknar om resultaten när dokumenten skrivs.');
}

console.log('\nDetta återställs INTE:');
[...notes, ...restoreWarnings(exportData)].forEach(line => console.warn(`  - ${line}`));
if (targetId !== sourceId) {
  console.warn(`  - Kopian heter samma sak som originalet (${exportData.name || sourceId}); byt namn i appen så att de går att skilja åt.`);
}
process.exit(0);
