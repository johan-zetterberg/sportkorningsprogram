import { firebaseCommand, getEmulatorEnv, run } from './emulator-env.mjs';

const env = await getEmulatorEnv('test:storage-rules');
const firebaseArgs = [
  'emulators:exec',
  '--only',
  'firestore,storage',
  'node --test tests/storage-rules.spec.js'
];

const exitCode = await run(firebaseCommand, firebaseArgs, env);
process.exit(exitCode);
