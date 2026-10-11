import { firebaseCommand, getEmulatorEnv, run } from './emulator-env.mjs';

// Kör webbläsartesterna (Playwright) mot lokala Firebase-emulatorer i stället för produktion.
//
//   node scripts/run-smoke-tests.mjs [playwright-argument...]
//
// Steg 1 (utan --in-emulators): startar emulatorerna och kör sig själv igen inuti dem,
//   eller använder emulatorer som redan körs.
// Steg 2 (--in-emulators): skapar (eller återanvänder) testanvändaren och kör Playwright.
// Allt som skrivs under testerna försvinner när emulatorerna stängs.

const PROJECT_ID = 'demo-combined-driving';
const AUTH_URL = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const FIRESTORE_URL = 'http://127.0.0.1:8080/v1';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@demo.se';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'admin123';

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
  console.log(`Testanvändare ${TEST_EMAIL} klar i emulatorerna.`);
}

// Svarar emulatorn på sin port?
async function isListening(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

if (process.argv[2] === '--in-emulators') {
  await createSmokeUser();
  const playwrightArgs = JSON.parse(process.env.SMOKE_PLAYWRIGHT_ARGS || '[]');
  const exitCode = await run(
    process.execPath,
    ['node_modules/@playwright/test/cli.js', 'test', 'tests/browser-smoke.spec.js', ...playwrightArgs],
    process.env
  );
  process.exit(exitCode);
}

const playwrightArgs = JSON.stringify(process.argv.slice(2));

// Emulatorer som redan körs (t.ex. firebase emulators:start) används som de är
const [authUp, firestoreUp] = await Promise.all([
  isListening('http://127.0.0.1:9099/'),
  isListening('http://127.0.0.1:8080/')
]);
if (authUp && firestoreUp) {
  console.log('Emulatorerna körs redan; testerna använder dem.');
  const exitCode = await run(process.execPath, ['scripts/run-smoke-tests.mjs', '--in-emulators'], {
    ...process.env,
    SMOKE_PLAYWRIGHT_ARGS: playwrightArgs
  });
  process.exit(exitCode);
}
if (authUp || firestoreUp) {
  console.error('Bara en del av emulatorerna körs (auth på 9099, firestore på 8080).');
  console.error('Starta alla med: firebase emulators:start --only auth,firestore,functions,storage --project demo-combined-driving');
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
