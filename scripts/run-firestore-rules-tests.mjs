import { firebaseCommand, getEmulatorEnv, run } from './emulator-env.mjs';

const env = await getEmulatorEnv('test:rules');

// A demo project: the emulator needs no login (CI) and never reaches the real one
const firebaseArgs = [
  'emulators:exec',
  '--project',
  'demo-combined-driving',
  '--only',
  'firestore',
  // The staff spec uses its own project id: the two files can run side by side
  'node --test tests/firestore-rules.spec.js tests/firestore-rules-staff.spec.js'
];

const exitCode = await run(firebaseCommand, firebaseArgs, env);
process.exit(exitCode);
