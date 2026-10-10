const fs = require('node:fs');
const path = require('node:path');

const serviceWorkerPath = path.resolve(__dirname, '..', 'service-worker.js');
const source = fs.readFileSync(serviceWorkerPath, 'utf8');
const match = source.match(/const CACHE_NAME = 'driving-app-v(\d+)'/);

if (!match) {
  throw new Error('Kunde inte hitta CACHE_NAME i service-worker.js.');
}

const nextVersion = Number(match[1]) + 1;
const updated = source.replace(match[0], `const CACHE_NAME = 'driving-app-v${nextVersion}'`);
fs.writeFileSync(serviceWorkerPath, updated, 'utf8');
console.log(`Service worker-cache uppdaterad till driving-app-v${nextVersion}.`);
