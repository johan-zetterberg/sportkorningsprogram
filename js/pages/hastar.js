import { getEquipages } from '../services/firestoreService.js';
import { getGlobalState } from '../main.js';
import { getCompetitionHeader } from '../ui/components.js';
import { downloadCsv, sanitizeForFilename } from '../utils/sharedUtils.js';
import { generateStartListPdf } from '../pdf/startListPdf.js';
import { injectScrollStyles, initializeScrollSync } from '../ui/scrollHelper.js';

// --- Lokal state ---
let allHorses = [];
let searchTerm = '';
let viewMode = 'grid'; // 'grid' | 'table'

// --- Hjälpfunktioner ---
const exists = (v) => v && v !== '' && v !== '-';

function calculateCategory(hItem) {
    if (hItem.category) return hItem.category; // Returnera om redan satt
    if (!hItem.height) return '';

    // Parsa höjd. Hanterar "148cm", "148,5", etc.
    let hVal = parseFloat(String(hItem.height).replace(',', '.').replace(/[^\d.]/g, ''));
    if (isNaN(hVal)) return '';

    if (hVal <= 107) return 'A';
    if (hVal <= 130) return 'B';
    if (hVal <= 140) return 'C';
    if (hVal <= 148) return 'D';
    return 'H'; // Häst
}

function renderContent() {
    const container = document.getElementById('horseListContainer');
    if (!container) return;

    // Teardown scrollbar sync if active (safeguard)
    window.__teardownXbarSync?.();

    // Filtrera
    const filtered = allHorses.filter(h => {
        if (!searchTerm) return true;
        const q = searchTerm.toLowerCase();
        return (
            (h.name || '').toLowerCase().includes(q) ||
            (h.driverName || '').toLowerCase().includes(q) ||
            (h.owner || '').toLowerCase().includes(q) ||
            (h.breeder || '').toLowerCase().includes(q) ||
            (h.sire || '').toLowerCase().includes(q) ||
            (h.dam || '').toLowerCase().includes(q)
        );
    });

    // Sortera
    filtered.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'sv'));

    // Uppdatera räknare
    const countEl = document.getElementById('horseCount');
    if (countEl) countEl.textContent = `${filtered.length} hästar`;

    if (filtered.length === 0) {
        container.innerHTML = `<p class="col-span-full text-center text-gray-500 py-8">Inga hästar hittades som matchar "${searchTerm}".</p>`;
        return;
    }

    if (viewMode === 'table') {
        renderTable(filtered, container);
    } else {
        renderGrid(filtered, container);
    }
}

function renderGrid(filtered, container) {
    container.className = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6";

    container.innerHTML = filtered.map(h => {
        const details = [];
        if (exists(h.age)) details.push(`<span class="text-gray-600">Ålder:</span> <span class="font-medium">${h.age} år</span>`);
        if (exists(h.gender)) details.push(`<span class="text-gray-600">Kön:</span> <span class="font-medium">${h.gender}</span>`);
        if (exists(h.breed)) details.push(`<span class="text-gray-600">Ras:</span> <span class="font-medium">${h.breed}</span>`);
        if (exists(h.height)) details.push(`<span class="text-gray-600">Mkh:</span> <span class="font-medium">${h.height} cm (${calculateCategory(h)})</span>`);

        const lineage = [h.sire, h.dam, h.damsire].filter(exists).join(' x ');
        const lineageStr = h.lineage || lineage;

        return `
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow flex flex-col h-full">
            <div class="p-4 bg-gray-50 border-b border-gray-100 flex justify-between items-start">
                <div>
                    <h3 class="text-lg font-bold text-gray-900 leading-tight">${h.name || 'Namnlös'}</h3>
                    ${h.id ? `<span class="text-xs text-gray-400 font-mono">#${h.id}</span>` : ''}
                </div>
                <div class="text-2xl opacity-20">🐴</div>
            </div>
            
            <div class="p-4 flex-1 space-y-3 text-sm">
                ${details.length ? `<div class="flex flex-wrap gap-x-4 gap-y-1">${details.join('<span class="text-gray-300">|</span>')}</div>` : ''}

                ${lineageStr ? `
                <div class="pt-2 border-t border-dashed">
                    <p class="text-xs text-gray-500 uppercase tracking-wide">Härstamning</p>
                    <p class="font-medium text-gray-800">${lineageStr}</p>
                </div>` : ''}

                <div class="pt-2">
                    ${exists(h.breeder) ? `
                    <div class="flex flex-col mb-1">
                        <span class="text-xs text-gray-500">Uppfödare</span>
                        <span class="text-gray-800 font-medium truncate" title="${h.breeder}">${h.breeder}</span>
                    </div>` : ''}
                    
                    ${exists(h.owner) ? `
                    <div class="flex flex-col">
                        <span class="text-xs text-gray-500">Ägare</span>
                        <span class="text-gray-800 font-medium truncate" title="${h.owner}">${h.owner}</span>
                    </div>` : ''}
                </div>
            </div>

            <div class="px-4 py-3 bg-blue-50/50 border-t border-blue-100 flex items-center gap-2">
                <span class="text-xs text-blue-600 font-semibold uppercase">Köres av</span>
                <span class="text-sm font-bold text-gray-900 truncate flex-1">${h.driverName || '—'}</span>
            </div>
        </div>
        `;
    }).join('');
}

function renderTable(filtered, container) {
    // Structure matches marathon-resultat.js
    container.className = ""; // Reset container class as we build the wrapper manually inside

    const rows = filtered.map(h => {
        const cat = calculateCategory(h);
        const lineage = [h.sire, h.dam].filter(exists).join(' x ') || h.lineage || '-';
        return `
            <tr class="hover:bg-gray-50 transition-colors">
                <td class="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">${h.name}</td>
                <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${h.breed || '-'}</td>
                <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${h.gender || '-'}</td>
                <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500 text-center">${h.age || '-'}</td>
                <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500 text-center">${h.height ? `${h.height} (${cat})` : '-'}</td>
                <td class="px-4 py-3 text-sm text-gray-500 truncate max-w-xs" title="${lineage}">${lineage}</td>
                <td class="px-4 py-3 text-sm text-gray-500 truncate max-w-xs" title="${h.owner || ''}">${h.owner || '-'}</td>
                <td class="px-4 py-3 text-sm text-gray-500 truncate max-w-xs">${h.driverName || '-'}</td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <div class="bg-white shadow-lg rounded-lg overflow-hidden border border-gray-200">
            <div id="hastar-x-wrap" class="x-scroll-wrap bg-white w-full overflow-x-auto">
                <table class="min-w-full divide-y divide-gray-200">
                    <thead class="bg-gray-50">
                        <tr>
                            <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Häst</th>
                            <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ras</th>
                            <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Kön</th>
                            <th scope="col" class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Ålder</th>
                            <th scope="col" class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Mkh (Kat)</th>
                            <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Härstamning</th>
                            <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ägare</th>
                            <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Kusk</th>
                        </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
                        ${rows}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    // Activate Sticky X Scrollbar
    const hostEl = container.querySelector('#hastar-x-wrap');
    if (hostEl && window.__setupXbarSync) {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                window.__setupXbarSync({
                    barClass: 'fixed-xbar',
                    innerId: 'hastarXbarInner',
                    hostEl
                });
            });
        });
    }
}

// --- Hanterare ---

function handleExportCsv() {
    const filtered = allHorses.filter(h => {
        if (!searchTerm) return true;
        const q = searchTerm.toLowerCase();
        return (
            (h.name || '').toLowerCase().includes(q) ||
            (h.driverName || '').toLowerCase().includes(q)
        );
    });
    filtered.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'sv'));

    const headers = ['Häst', 'Hästnr', 'Ras', 'Kön', 'Ålder', 'Mkh', 'Kat', 'Härstamning', 'Uppfödare', 'Ägare', 'Kusk'];
    const rows = filtered.map(h => [
        h.name,
        h.id || '',
        h.breed || '',
        h.gender || '',
        h.age || '',
        h.height || '',
        calculateCategory(h),
        h.lineage || [h.sire, h.dam].filter(exists).join(' x '),
        h.breeder || '',
        h.owner || '',
        h.driverName || ''
    ]);

    const comp = getGlobalState('currentCompetition');
    const compName = sanitizeForFilename(comp?.name || 'tavling');
    const date = new Date().toISOString().split('T')[0];
    const filename = `hast_lista_${compName}_${date}.csv`;
    downloadCsv(filename, headers, rows);
}

async function handleExportPdf() {
    const comp = getGlobalState('currentCompetition');

    // Filtrera
    const filtered = allHorses.filter(h => {
        if (!searchTerm) return true;
        const q = searchTerm.toLowerCase();
        return (h.name || '').toLowerCase().includes(q) || (h.driverName || '').toLowerCase().includes(q);
    });
    filtered.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'sv'));

    // Berika med beräknad kategori för PDF:en
    const enriched = filtered.map(h => ({
        ...h,
        category: calculateCategory(h)
    }));

    try {
        await generateStartListPdf(enriched, 'horselist', comp, { title: 'Hästar' });
    } catch (e) {
        console.error(e);
        alert('Fel vid PDF-generering: ' + e.message);
    }
}


export async function load() {
    const competition = getGlobalState('currentCompetition');
    const page = document.getElementById('page-hastar');

    if (!competition) {
        page.innerHTML = `<div class="container mx-auto p-4"><p class="p-8 text-center text-red-500 bg-white rounded shadow">Ingen tävling vald. Gå tillbaka till hubben.</p></div>`;
        return;
    }

    // Initialize shared scrollbar helper
    injectScrollStyles();
    // Initialize specifically for this view so it snatches ownership
    initializeScrollSync('hastar');

    page.innerHTML = `
        <div class="container mx-auto p-4 md:p-8">
            ${getCompetitionHeader(competition, 'Hästlista')}

            <div class="bg-white p-4 md:p-6 rounded-xl shadow-md mb-6">
                <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                     <!-- Sökfält -->
                     <div class="relative w-full md:w-96">
                        <span class="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-500">
                           <svg fill="currentColor" viewBox="0 0 20 20" class="w-5 h-5"><path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd"></path></svg>
                        </span>
                        <input id="horseSearch" type="text" placeholder="Sök häst, ras, ägare, kusk..." class="w-full py-2 pl-10 pr-4 text-gray-700 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white text-base">
                     </div>

                     <div class="flex flex-wrap items-center gap-3">
                        <span class="text-sm text-gray-500 hidden md:inline" id="horseCount"></span>

                        <!-- Vy-väljare -->
                         <div class="inline-flex rounded-md shadow-sm" role="group">
                            <button id="viewGridBtn" type="button" class="px-3 py-2 text-sm font-medium border border-gray-300 rounded-l-lg ${viewMode === 'grid' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700'} hover:bg-gray-100">
                                <i class="fas fa-th-large"></i> Panels
                            </button>
                            <button id="viewTableBtn" type="button" class="px-3 py-2 text-sm font-medium border-t border-b border-r border-gray-300 rounded-r-lg ${viewMode === 'table' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700'} hover:bg-gray-100">
                                <i class="fas fa-table"></i> Tabell
                            </button>
                        </div>

                        <!-- Export -->
                        <div class="flex items-center gap-2">
                            <button id="btnExportCsv" type="button" class="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">
                                <i class="fas fa-file-csv mr-2 text-gray-500"></i> CSV
                            </button>
                            <button id="btnExportPdf" type="button" class="inline-flex items-center px-3 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-gray-600 hover:bg-gray-700">
                                <svg class="mr-2 -ml-1 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 1 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg> PDF
                            </button>
                        </div>
                     </div>
                </div>
            </div>

            <div id="horseListContainer">
                 <!-- Injected here -->
                 <div class="py-12 flex justify-center">
                    <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                 </div>
            </div>
        </div>
    `;

    // Listeners
    document.getElementById('viewGridBtn').addEventListener('click', () => {
        viewMode = 'grid';
        updateViewButtons();
        renderContent();
    });
    document.getElementById('viewTableBtn').addEventListener('click', () => {
        viewMode = 'table';
        updateViewButtons();
        renderContent();
    });

    document.getElementById('btnExportCsv').addEventListener('click', handleExportCsv);
    document.getElementById('btnExportPdf').addEventListener('click', handleExportPdf);

    document.getElementById('horseSearch').addEventListener('input', (e) => {
        searchTerm = e.target.value.trim();
        renderContent();
    });

    try {
        const equipages = await getEquipages(competition.id);

        let flattened = [];
        equipages.forEach(e => {
            if (Array.isArray(e.horses)) {
                e.horses.forEach(h => {
                    if (h.name) {
                        flattened.push({ ...h, driverName: e.driverName });
                    }
                });
            }
        });

        allHorses = flattened;
        renderContent();

    } catch (error) {
        console.error("Kunde inte ladda data: ", error);
        const container = document.getElementById('horseListContainer');
        if (container) container.innerHTML = `<p class="col-span-full text-red-500 text-center">Kunde inte ladda data.</p>`;
    }
}

function updateViewButtons() {
    const btnG = document.getElementById('viewGridBtn');
    const btnT = document.getElementById('viewTableBtn');
    if (btnG && btnT) {
        btnG.className = `px-3 py-2 text-sm font-medium border border-gray-300 rounded-l-lg hover:bg-gray-100 ${viewMode === 'grid' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700'}`;
        btnT.className = `px-3 py-2 text-sm font-medium border-t border-b border-r border-gray-300 rounded-r-lg hover:bg-gray-100 ${viewMode === 'table' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700'}`;
    }
}