import { firebaseCommand, getEmulatorEnv, run } from './emulator-env.mjs';

const env = await getEmulatorEnv('test:storage-rules');
// A demo project: the emulator needs no login (CI) and never reaches the real one
const firebaseArgs = [
  'emulators:exec',
  '--project',
  'demo-combined-driving',
  '--only',
  'firestore,storage',
  'node --test tests/storage-rules.spec.js'
];

const exitCode = await run(firebaseCommand, firebaseArgs, env);
process.exit(exitCode);
