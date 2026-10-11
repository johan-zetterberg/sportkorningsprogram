import { readFileSync } from 'node:fs';
import { firebaseCommand, getEmulatorEnv, run } from './emulator-env.mjs';

// Kör webbläsartesterna (Playwright) mot lokala Firebase-emulatorer i stället för produktion.
//
//   node scripts/run-smoke-tests.mjs [playwright-argument...]
//
// Steg 1 (utan --in-emulators): startar emulatorerna och kör sig själv igen inuti dem,
//   eller använder emulatorer som redan körs (alla fyra måste köra).
// Steg 2 (--in-emulators): skapar (eller återanvänder) testanvändaren, kontrollerar att
//   den kan logga in som webbläsaren gör, och kör Playwright.
// Allt som skrivs under testerna försvinner när emulatorerna stängs.

const PROJECT_ID = 'demo-combined-driving';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@demo.se';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'admin123';
const START_HINT = `firebase emulators:start --only auth,firestore,functions,storage --project ${PROJECT_ID}`;

// Portarna appen ansluter till (js/config/firebase-config.js) är de i firebase.json
const configuredPorts = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8')).emulators || {};
const EMULATORS = ['auth', 'firestore', 'functions', 'storage']
  .map(name => ({ name, port: configuredPorts[name]?.port }));

// emulators:exec sätter de här variablerna till de portar som faktiskt används
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || `127.0.0.1:${configuredPorts.auth?.port}`;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || `127.0.0.1:${configuredPorts.firestore?.port}`;
const AUTH_URL = `http://${authHost}/identitytoolkit.googleapis.com/v1`;
const FIRESTORE_URL = `http://${firestoreHost}/v1`;

// "Bearer owner" ger administratörsåtkomst i emulatorerna (förbi säkerhetsreglerna).
async function emulatorRequest(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
  return res.json();
}

// Testkontot finns redan om emulatorerna kördes sedan tidigare: hämta det
async function findOrCreateSmokeUser() {
  const lookup = await emulatorRequest(`${AUTH_URL}/projects/${PROJECT_ID}/accounts:lookup`, 'POST', {
    email: [TEST_EMAIL]
  });
  const existing = lookup.users?.[0];
  if (existing) {
    await emulatorRequest(`${AUTH_URL}/projects/${PROJECT_ID}/accounts:update`, 'POST', {
      localId: existing.localId,
      password: TEST_PASSWORD
    });
    return existing.localId;
  }
  const { localId } = await emulatorRequest(`${AUTH_URL}/projects/${PROJECT_ID}/accounts`, 'POST', {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    displayName: 'Smoke Admin'
  });
  return localId;
}

// Samma behörighet som testkontot har i produktion: superadmin.
async function createSmokeUser() {
  const localId = await findOrCreateSmokeUser();
  await emulatorRequest(`${AUTH_URL}/projects/${PROJECT_ID}/accounts:update`, 'POST', {
    localId,
    customAttributes: JSON.stringify({ superadmin: true })
  });
  await emulatorRequest(
    `${FIRESTORE_URL}/projects/${PROJECT_ID}/databases/(default)/documents/users/${localId}`,
    'PATCH',
    { fields: { email: { stringValue: TEST_EMAIL }, role: { stringValue: 'superadmin' } } }
  );
}

/**
 * Logs in the way the browser does (no project in the request: the Auth
 * emulator answers for the project it was started with) and checks that it is
 * the account set up above. Emulators started without --project run as the
 * default project in .firebaserc, where the account is missing or different.
 */
async function verifyBrowserLogin() {
  const res = await fetch(`${AUTH_URL}/accounts:signInWithPassword?key=emulator`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, returnSecureToken: true })
  });
  if (!res.ok) return false;
  const { idToken } = await res.json();
  const claims = JSON.parse(Buffer.from(String(idToken).split('.')[1] || '', 'base64url').toString() || '{}');
  return claims.superadmin === true && claims.aud === PROJECT_ID;
}

// Svarar emulatorn på sin port?
async function isListening(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

if (process.argv[2] === '--in-emulators') {
  try {
    await createSmokeUser();
  } catch (error) {
    console.error(`Kunde inte förbereda testanvändaren i emulatorerna: ${error.message}`);
    console.error(`Körs emulatorerna för projektet ${PROJECT_ID}? Starta dem med: ${START_HINT}`);
    process.exit(1);
  }
  if (!await verifyBrowserLogin()) {
    console.error(`Testanvändaren ${TEST_EMAIL} kan inte logga in som webbläsaren gör.`);
    console.error(`Emulatorerna körs troligen för ett annat projekt än ${PROJECT_ID} (t.ex. startade utan --project).`);
    console.error(`Starta om dem med: ${START_HINT}`);
    process.exit(1);
  }
  console.log(`Testanvändare ${TEST_EMAIL} klar och kan logga in.`);
  if (process.env.SMOKE_SETUP_ONLY === '1') process.exit(0);

  const playwrightArgs = JSON.parse(process.env.SMOKE_PLAYWRIGHT_ARGS || '[]');
  const exitCode = await run(
    process.execPath,
    ['node_modules/@playwright/test/cli.js', 'test', 'tests/browser-smoke.spec.js', ...playwrightArgs],
    process.env
  );
  process.exit(exitCode);
}

const playwrightArgs = JSON.stringify(process.argv.slice(2));

// Emulatorer som redan körs (t.ex. firebase emulators:start) används, men bara
// om alla fyra gör det: testerna behöver även Functions (resultat) och Storage
const running = await Promise.all(EMULATORS.map(async e => ({ ...e, up: await isListening(e.port) })));
if (running.every(e => e.up)) {
  console.log('Emulatorerna körs redan; testerna använder dem.');
  const exitCode = await run(process.execPath, ['scripts/run-smoke-tests.mjs', '--in-emulators'], {
    ...process.env,
    SMOKE_PLAYWRIGHT_ARGS: playwrightArgs
  });
  process.exit(exitCode);
}
if (running.some(e => e.up)) {
  const describe = (list) => list.map(e => `${e.name} (${e.port})`).join(', ');
  console.error(`Bara en del av emulatorerna körs. Igång: ${describe(running.filter(e => e.up))}. Saknas: ${describe(running.filter(e => !e.up))}.`);
  console.error(`Starta alla med: ${START_HINT}`);
  console.error('eller stäng de som körs, så startar testerna egna.');
  process.exit(1);
}

const env = await getEmulatorEnv('test:smoke');
env.SMOKE_PLAYWRIGHT_ARGS = playwrightArgs;

const exitCode = await run(firebaseCommand, [
  'emulators:exec',
  '--only',
  'auth,firestore,functions,storage',
  '--project',
  PROJECT_ID,
  'node scripts/run-smoke-tests.mjs --in-emulators'
], env);
process.exit(exitCode);
