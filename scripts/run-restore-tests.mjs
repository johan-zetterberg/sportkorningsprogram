import { firebaseCommand, getEmulatorEnv, run } from './emulator-env.mjs';

const env = await getEmulatorEnv('test:restore');

// Export, delete and restore a competition in the Firestore emulator (demo
// project), the personal data retention run and the e-mail queue
const firebaseArgs = [
  'emulators:exec',
  '--project',
  'demo-combined-driving',
  '--only',
  'firestore',
  // One file at a time: the retention run deletes counters and retry entries
  // of every competition, which the mail test checks
  'node --test --test-concurrency=1 tests/restore-roundtrip.emulator.mjs tests/retention.emulator.mjs tests/mail.emulator.mjs'
];

const exitCode = await run(firebaseCommand, firebaseArgs, env);
process.exit(exitCode);
