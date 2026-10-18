// Safe deploy to production (combined-driving).
//
//   npm run deploy                         everything: hosting, functions, rules
//   npm run deploy -- --only hosting       just the website (faster)
//   npm run deploy -- --skip-smoke         when the smoke emulators can't run
//   npm run deploy -- --dry-run            checks and tests only
//
// Order: committed work only -> local-only assets present -> unit tests ->
// Firestore/Storage rule tests for their deploy targets -> smoke tests -> CSS
// build + service-worker bump (committed) -> deploy with an explicit project.
// Nothing is pushed to GitHub; the script reminds you instead.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'combined-driving';
const VALID_TARGETS = new Set(['hosting', 'functions', 'firestore', 'storage']);

// Kept outside git (licensed/trademarked) and only on this computer: deploying
// hosting without them would delete them from the live site
const LOCAL_ONLY_ASSET_DIRS = ['assets/logos', 'assets/dressage'];

const args = process.argv.slice(2);
const onlyArg = args.find(a => a.startsWith('--only'));
// Without --only everything is deployed: a website that expects a function or
// rule not deployed yet is easy to ship by mistake
const ALL_TARGETS = 'hosting,functions,firestore,storage';
const onlyValue = onlyArg?.includes('=') ? onlyArg.split('=')[1] : (onlyArg ? args[args.indexOf(onlyArg) + 1] : ALL_TARGETS);
const targets = String(onlyValue || ALL_TARGETS).split(',').map(s => s.trim()).filter(Boolean);
const skipSmoke = args.includes('--skip-smoke');
const dryRun = args.includes('--dry-run'); // all checks and tests, no commit or deploy

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

function step(title) {
  console.log(`\n▶ ${title}`);
}

function run(command, { capture = false } = {}) {
  const result = spawnSync(command, {
    cwd: ROOT,
    shell: true,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8'
  });
  if (capture) return { code: result.status, out: (result.stdout || '').trim() };
  return result.status;
}

function mustRun(command, what) {
  if (run(command) !== 0) fail(`${what} failed — nothing was deployed.`);
}

for (const t of targets) {
  if (!VALID_TARGETS.has(t)) fail(`Unknown deploy target "${t}". Use: ${[...VALID_TARGETS].join(', ')}.`);
}
console.log(`Deploying ${targets.join(', ')} to ${PROJECT}${skipSmoke ? ' (smoke tests skipped)' : ''}.`);

step('Only committed work is deployed');
// Untracked files count too: hosting publishes the whole folder and functions
// uploads its folder, so a stray file would go live (gitignored files, like
// the local-only assets, are not listed)
const status = run('git status --porcelain', { capture: true });
if (status.code !== 0) fail('Could not read git status.');
if (status.out) fail(`Uncommitted or untracked files — commit, stash or remove them first:\n${status.out}`);

if (targets.includes('hosting')) {
  step('Local-only assets are present');
  for (const dir of LOCAL_ONLY_ASSET_DIRS) {
    const abs = path.join(ROOT, dir);
    const count = fs.existsSync(abs) ? fs.readdirSync(abs, { recursive: true }).length : 0;
    if (!count) fail(`${dir} is missing or empty. It is not in git; deploying would remove it from the live site.`);
    console.log(`  ${dir}: ${count} entries`);
  }
  const logoConfig = path.join(ROOT, 'assets/config/club-logos.json');
  if (fs.existsSync(logoConfig)) {
    const missing = Object.values(JSON.parse(fs.readFileSync(logoConfig, 'utf8')))
      .filter(url => typeof url === 'string' && url.startsWith('/'))
      .filter(url => !fs.existsSync(path.join(ROOT, decodeURIComponent(url))));
    if (missing.length) fail(`club-logos.json points at missing files:\n  ${missing.join('\n  ')}`);
  }
}

step('Unit tests');
mustRun('npm test', 'Unit tests');

// The same gate as GitHub Actions (.github/workflows/tests.yml): local
// commits can be deployed before they are pushed
step('Result engine copy in functions matches js/core-engine');
mustRun('node scripts/copy-core-engine.js', 'Engine copy');
if (run('git diff --exit-code --quiet -- functions/src/core-engine') !== 0) {
  fail('functions/src/core-engine differed from js/core-engine (now copied) — commit the copy first. Nothing was deployed.');
}

if (targets.includes('functions')) {
  step('Lint Cloud Functions');
  mustRun('npm --prefix functions run lint', 'Functions lint');
}

step('Translation keys');
const i18n = run('node scripts/audit_i18n.cjs', { capture: true });
console.log(i18n.out);
if (i18n.code !== 0 || !i18n.out.includes('All i18n keys')) fail('Translation keys are missing — nothing was deployed.');

if (targets.includes('hosting')) {
  step('Service-worker cache list');
  mustRun('npm run check:sw-cache', 'Service-worker cache check');
}

if (targets.includes('firestore') || targets.includes('functions')) {
  step('Firestore rules tests');
  mustRun('npm run test:rules', 'Rules tests');
}

if (targets.includes('storage')) {
  step('Storage rules tests');
  mustRun('npm run test:storage-rules', 'Storage rules tests');
}

if (!skipSmoke) {
  step('Smoke tests (emulators)');
  mustRun('npm run test:smoke', 'Smoke tests');
}

if (dryRun) {
  console.log('\n✔ Dry run: all checks passed. Nothing was committed or deployed.');
  process.exit(0);
}

if (targets.includes('hosting')) {
  step('Build CSS and bump the service worker');
  mustRun('npm run build:css', 'CSS build');
  mustRun('node scripts/bump-service-worker-version.cjs', 'Service-worker bump');
  const version = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8').match(/driving-app-v(\d+)/)?.[1];
  mustRun('git add service-worker.js js/appVersion.js css/tailwind.css', 'git add');
  mustRun(`git commit -q -m "chore(deploy): service worker v${version}"`, 'Deploy commit');
}

step(`firebase deploy --only ${targets.join(',')}`);
mustRun(`firebase deploy --project ${PROJECT} --only ${targets.join(',')}`, 'firebase deploy');

const ahead = run('git rev-list --count @{u}..HEAD', { capture: true });
console.log('\n✔ Deployed.');
if (ahead.code === 0 && Number(ahead.out) > 0) {
  console.log(`  GitHub is ${ahead.out} commit(s) behind — run "git push" when you want them backed up there.`);
}
