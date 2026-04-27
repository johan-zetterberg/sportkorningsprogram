const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const SW_PATH = path.join(ROOT_DIR, 'service-worker.js');

// Mappar att skanna
const DIRS_TO_SCAN = ['js', 'css', 'assets', 'lib'];
const FILES_TO_INCLUDE = ['index.html', 'manifest.json', 'favicon.ico', 'icon-192.png', 'icon-512.png'];

// Externa URL:er att alltid inkludera (CDNs)
const EXTRA_URLS = [
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
    /scripts/
];

function scanDir(dir, fileList = []) {
    const fullPath = path.join(ROOT_DIR, dir);
    if (!fs.existsSync(fullPath)) return fileList;

    const items = fs.readdirSync(fullPath);

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

function generate() {
    console.log('Genererar cache-lista för Service Worker...');

    let allFiles = [...FILES_TO_INCLUDE.map(f => `/${f}`)];

    DIRS_TO_SCAN.forEach(dir => {
        scanDir(dir, allFiles);
    });

    // Lägg till externa
    allFiles = [...allFiles, ...EXTRA_URLS];

    // Unika filer
    allFiles = [...new Set(allFiles)];

    console.log(`Hittade ${allFiles.length} filer att cacha (inklusive ${EXTRA_URLS.length} externa).`);

    // Läs in service-worker.js
    let swContent = fs.readFileSync(SW_PATH, 'utf8');

    // Regex för att hitta urlsToCache-arrayen
    // Vi letar efter: const urlsToCache = [ ... ];
    const regex = /const urlsToCache = \[([\s\S]*?)\];/;

    if (!regex.test(swContent)) {
        console.error('Kunde inte hitta urlsToCache i service-worker.js!');
        process.exit(1);
    }

    // Bygg ny sträng. Vi använder abs() wrappern för lokala filer om de inte är http
    const newArrayContent = allFiles.map(f => {
        if (f.startsWith('http')) return `'${f}'`;
        return `abs('${f}')`;
    }).join(',\n  ');

    const newContent = swContent.replace(regex, `const urlsToCache = [\n  ${newArrayContent}\n];`);

    fs.writeFileSync(SW_PATH, newContent, 'utf8');
    console.log('service-worker.js uppdaterad!');
}

generate();
