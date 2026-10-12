// Safe deploy to production (combined-driving).
//
//   npm run deploy                         hosting only (the usual case)
//   npm run deploy -- --only hosting,functions
//   npm run deploy -- --skip-smoke         when the smoke emulators can't run
//   npm run deploy -- --dry-run            checks and tests only
//
// Order: committed work only -> local-only assets present -> unit tests ->
// rules tests (when rules/functions are deployed) -> smoke tests -> CSS build +
// service-worker bump (committed) -> firebase deploy with an explicit project.
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
const onlyValue = onlyArg?.includes('=') ? onlyArg.split('=')[1] : (onlyArg ? args[args.indexOf(onlyArg) + 1] : 'hosting');
const targets = String(onlyValue || 'hosting').split(',').map(s => s.trim()).filter(Boolean);
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
const status = run('git status --porcelain --untracked-files=no', { capture: true });
if (status.code !== 0) fail('Could not read git status.');
if (status.out) fail(`Uncommitted changes in tracked files — commit or stash them first:\n${status.out}`);

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

if (targets.includes('firestore') || targets.includes('functions')) {
  step('Firestore rules tests');
  mustRun('npm run test:rules', 'Rules tests');
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
  mustRun('git add service-worker.js css/tailwind.css', 'git add');
  mustRun(`git commit -q -m "chore(deploy): service worker v${version}"`, 'Deploy commit');
}

step(`firebase deploy --only ${targets.join(',')}`);
mustRun(`firebase deploy --project ${PROJECT} --only ${targets.join(',')}`, 'firebase deploy');

const ahead = run('git rev-list --count @{u}..HEAD', { capture: true });
console.log('\n✔ Deployed.');
if (ahead.code === 0 && Number(ahead.out) > 0) {
  console.log(`  GitHub is ${ahead.out} commit(s) behind — run "git push" when you want them backed up there.`);
}
