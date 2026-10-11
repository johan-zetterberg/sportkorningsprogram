import { firebaseCommand, getEmulatorEnv, run } from './emulator-env.mjs';

// Kör webbläsartesterna (Playwright) mot lokala Firebase-emulatorer i stället för produktion.
//
//   node scripts/run-smoke-tests.mjs [playwright-argument...]
//
// Steg 1 (utan --in-emulators): startar emulatorerna och kör sig själv igen inuti dem.
// Steg 2 (--in-emulators): skapar testanvändaren och kör Playwright.
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

// Samma behörighet som testkontot har i produktion: superadmin.
async function createSmokeUser() {
  const { localId } = await emulatorRequest(`${AUTH_URL}/projects/${PROJECT_ID}/accounts`, 'POST', {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    displayName: 'Smoke Admin'
  });
  await emulatorRequest(`${AUTH_URL}/projects/${PROJECT_ID}/accounts:update`, 'POST', {
    localId,
    customAttributes: JSON.stringify({ superadmin: true })
  });
  await emulatorRequest(
    `${FIRESTORE_URL}/projects/${PROJECT_ID}/databases/(default)/documents/users/${localId}`,
    'PATCH',
    { fields: { email: { stringValue: TEST_EMAIL }, role: { stringValue: 'superadmin' } } }
  );
  console.log(`Testanvändare ${TEST_EMAIL} skapad i emulatorerna.`);
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

const env = await getEmulatorEnv('test:smoke');
env.SMOKE_PLAYWRIGHT_ARGS = JSON.stringify(process.argv.slice(2));

const exitCode = await run(firebaseCommand, [
  'emulators:exec',
  '--only',
  'auth,firestore,functions,storage',
  '--project',
  PROJECT_ID,
  'node scripts/run-smoke-tests.mjs --in-emulators'
], env);
process.exit(exitCode);
