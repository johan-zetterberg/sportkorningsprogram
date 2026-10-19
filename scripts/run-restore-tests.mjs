import { firebaseCommand, getEmulatorEnv, run } from './emulator-env.mjs';

const env = await getEmulatorEnv('test:restore');

// Export, delete and restore a competition in the Firestore emulator (demo
// project), and the personal data retention run
const firebaseArgs = [
  'emulators:exec',
  '--project',
  'demo-combined-driving',
  '--only',
  'firestore',
  'node --test tests/restore-roundtrip.emulator.mjs tests/retention.emulator.mjs'
];

const exitCode = await run(firebaseCommand, firebaseArgs, env);
process.exit(exitCode);
