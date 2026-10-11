import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

// Gemensamt för skripten som startar Firebase-emulatorerna (de kräver Java).

export const isWindows = process.platform === 'win32';
export const firebaseCommand = isWindows ? 'firebase.cmd' : 'firebase';

function findJavaHome() {
  if (process.env.JAVA_HOME && existsSync(join(process.env.JAVA_HOME, 'bin', 'java.exe'))) {
    return process.env.JAVA_HOME;
  }

  const candidates = [
    'C:\\Program Files\\Eclipse Adoptium',
    'C:\\Program Files\\Java',
    'C:\\Program Files\\Microsoft',
  ];

  for (const base of candidates) {
    if (!existsSync(base)) continue;

    const dirs = readdirSync(base)
      .map((name) => join(base, name))
      .filter((fullPath) => {
        try {
          return statSync(fullPath).isDirectory();
        } catch {
          return false;
        }
      })
      .sort()
      .reverse();

    for (const dir of dirs) {
      const javaExe = join(dir, 'bin', 'java.exe');
      if (existsSync(javaExe)) {
        return dir;
      }
    }
  }

  return null;
}

export function run(command, args, env) {
  return new Promise((resolve) => {
    const useShell = isWindows && command.toLowerCase().endsWith('.cmd');
    const quotedArgs = args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg));
    const child = spawn(useShell ? `${command} ${quotedArgs.join(' ')}` : command, useShell ? [] : args, {
      stdio: 'inherit',
      shell: useShell,
      env
    });

    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

// Returnerar en miljö där Java finns på PATH, eller avslutar processen med ett felmeddelande.
export async function getEmulatorEnv(scriptName) {
  const javaHome = findJavaHome();

  if (!javaHome) {
    console.error('Kunde inte hitta Java-installationen automatiskt.');
    console.error(`Installera Java eller satt JAVA_HOME innan du kör ${scriptName}.`);
    process.exit(1);
  }

  const env = {
    ...process.env,
    JAVA_HOME: javaHome,
    PATH: `${join(javaHome, 'bin')};${process.env.PATH || ''}`
  };

  const javaCheckCode = await run(isWindows ? 'java.exe' : 'java', ['-version'], env);

  if (javaCheckCode !== 0) {
    console.error(`Java hittades i ${javaHome} men kunde inte startas.`);
    process.exit(javaCheckCode);
  }

  return env;
}
