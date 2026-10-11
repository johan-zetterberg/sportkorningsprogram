import { firebaseCommand, getEmulatorEnv, run } from './emulator-env.mjs';

const env = await getEmulatorEnv('test:rules');

const firebaseArgs = [
  'emulators:exec',
  '--only',
  'firestore',
  'node --test tests/firestore-rules.spec.js'
];

const exitCode = await run(firebaseCommand, firebaseArgs, env);
process.exit(exitCode);
