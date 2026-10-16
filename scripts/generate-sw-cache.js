import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SW_PATH = path.join(ROOT_DIR, 'service-worker.js');

// Only folders published by Firebase Hosting. Local-only dressage programs and
// club logos are required by the deploy script and are included when present.
const DIRS_TO_SCAN = [
    'js',
    'css',
    'icons',
    'img',
    'lib',
    'assets/config',
    'assets/dressage',
    'assets/logos'
];

// Mappar att skanna
const FILES_TO_INCLUDE = [
    'index.html',
    'manifest.json',
    'favicon.ico',
    'favicon-16x16.png',
    'favicon-32x32.png',
    'apple-touch-icon.png',
    'android-chrome-192x192.png',
    'android-chrome-512x512.png',
    'icons/DriveLive_192.png',
    'icons/DriveLive_512.png'
];

// Externa URL:er att alltid inkludera (CDNs)
const EXTRA_URLS = [
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js',
    'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js',
    'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js',
    'https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    'https://cdn.tailwindcss.com'
];

// Ignorera dessa filer/mappar
const IGNORE_PATTERNS = [
    /\.map$/,           // Source maps
    /node_modules/,
    /\.DS_Store/,
    /test/,
    /scripts/,
    /^img\/maraton-course[.]png$/,
    /^assets\/rules\//, // Regeltexterna publiceras inte (se hosting.ignore i firebase.json)
    // PDF.js-byggen som inte används (och inte publiceras, se hosting.ignore)
    /^lib\/pdfjs\/build\/(pdf\.js|pdf\.min\.js|pdf\.mjs|pdf\.sandbox.*|pdf\.worker\.min\.js|pdf\.worker\.mjs)$/
];

function scanDir(dir, fileList = []) {
    const fullPath = path.join(ROOT_DIR, dir);
    if (!fs.existsSync(fullPath)) return fileList;

    const items = fs.readdirSync(fullPath).sort((a, b) => a.localeCompare(b, 'sv'));

    items.forEach(item => {
        const itemPath = path.join(fullPath, item);
        const relativePath = path.relative(ROOT_DIR, itemPath).replace(/\\/g, '/');

        if (IGNORE_PATTERNS.some(regex => regex.test(relativePath))) return;

        if (fs.statSync(itemPath).isDirectory()) {
            scanDir(relativePath, fileList);
        } else {
            // Service Workern använder abs() helpern som förväntar sig paths som börjar med /
            fileList.push(`/${relativePath}`);
        }
    });

    return fileList;
}

export function buildServiceWorkerContent(swContent) {
    let allFiles = [...FILES_TO_INCLUDE.map(f => `/${f}`)];

    DIRS_TO_SCAN.forEach(dir => {
        scanDir(dir, allFiles);
    });

    const localFiles = [...new Set(allFiles)].sort((a, b) => a.localeCompare(b, 'sv'));
    allFiles = [...localFiles, ...EXTRA_URLS];

    const regex = /const urlsToCache = \[([\s\S]*?)\];/;
    if (!regex.test(swContent)) {
        throw new Error('Kunde inte hitta urlsToCache i service-worker.js.');
    }

    const newArrayContent = allFiles.map(f => {
        if (f.startsWith('http')) return `'${f}'`;
        return `abs('${f}')`;
    }).join(',\n  ');

    return {
        content: swContent.replace(regex, `const urlsToCache = [\n  ${newArrayContent}\n];`),
        fileCount: allFiles.length,
        externalCount: EXTRA_URLS.length
    };
}

export function generate({ check = false } = {}) {
    console.log('Genererar cache-lista för Service Worker...');
    const swContent = fs.readFileSync(SW_PATH, 'utf8');
    const generated = buildServiceWorkerContent(swContent);
    console.log(`Hittade ${generated.fileCount} filer att cacha (inklusive ${generated.externalCount} externa).`);

    if (check) {
        if (generated.content !== swContent) {
            console.error('Cache-listan är inaktuell. Kör npm run generate:sw-cache.');
            return false;
        }
        console.log('Cache-listan är aktuell.');
        return true;
    }

    fs.writeFileSync(SW_PATH, generated.content, 'utf8');
    console.log('service-worker.js uppdaterad.');
    return true;
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
    process.exitCode = generate({ check: process.argv.includes('--check') }) ? 0 : 1;
}
