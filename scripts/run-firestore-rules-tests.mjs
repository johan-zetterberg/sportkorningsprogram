import { firebaseCommand, getEmulatorEnv, run } from './emulator-env.mjs';

const env = await getEmulatorEnv('test:rules');

// A demo project: the emulator needs no login (CI) and never reaches the real one
const firebaseArgs = [
  'emulators:exec',
  '--project',
  'demo-combined-driving',
  '--only',
  'firestore',
  'node --test tests/firestore-rules.spec.js'
];

const exitCode = await run(firebaseCommand, firebaseArgs, env);
process.exit(exitCode);
