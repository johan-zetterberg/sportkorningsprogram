import { getEquipages } from '../../services/firestoreService.js';
import { getGlobalState } from '../../main.js';
import { getCompetitionHeader } from '../../ui/components.js';
import { downloadCsv, sanitizeForFilename } from '../../utils/sharedUtils.js';
import { generateStartListPdf } from '../../pdf/startListPdf.js';
import { injectScrollStyles, initializeScrollSync } from '../../ui/scrollHelper.js';
import { t } from '../../utils/i18n.js';

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

function getHorseColorHex(colorString) {
    if (!colorString) return '#6b7280'; // fallback grå
    const c = colorString.toLowerCase().trim();
    if (c.includes('skm') || c.includes('skimmel')) return '#e5e7eb'; // ljusgrå/vit
    if (c.includes('mbr') || c.includes('mörkbr')) return '#452c20'; // mörkbrun
    if (c.includes('ljbr')) return '#d2b48c'; // ljusbrun
    if (c.includes('svbr')) return '#2d2424'; // svartbrun
    if (c.includes('br') || c.includes('brun')) return '#8b4513'; // brun
    if (c.includes('mörkfux') || c.includes('mfux')) return '#8b3a3a'; // mörkfux
    if (c.includes('ljfux')) return '#deb887'; // ljusfux
    if (c.includes('fux')) return '#c25a3a'; // fux
    if (c.includes('sv') || c.includes('svart')) return '#1a1a1a'; // svart
    if (c.includes('isab')) return '#f4a460'; // isabell
    if (c.includes('bork')) return '#f5deb3'; // bork
    if (c.includes('gbr')) return '#daa520'; // gulbrun
    if (c.includes('tig')) return '#a89f91'; // tigrerad
    if (c.includes('skäck') || c.includes('skack')) return '#b58b66'; // skäck
    return '#8b4513'; // Standardbrun för okända
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
            (h.dam || '').toLowerCase().includes(q) ||
            (h.breed || '').toLowerCase().includes(q) ||
            (h.chip || h.chipNo || '').toLowerCase().includes(q) ||
            (h.ueln || '').toLowerCase().includes(q)
        );
    });

    // Sortera
    filtered.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'sv'));

    // Uppdatera räknare
    const countEl = document.getElementById('horseCount');
    if (countEl) countEl.textContent = `${filtered.length} hästar`;

    if (filtered.length === 0) {
        container.innerHTML = `<p class="col-span-full text-center text-gray-500 dark:text-gray-400 py-8">Inga hästar hittades som matchar "${searchTerm}".</p>`;
        return;
    }

    if (viewMode === 'table') {
        renderTable(filtered, container);
    } else {
        renderGrid(filtered, container);
    }
}

function renderGrid(filtered, container) {
    const user = getGlobalState('currentUser');
    const role = (user?.role || '').toLowerCase();
    const isAuth = ['admin', 'organizer', 'official', 'judge', 'domare', 'funktionar'].includes(role);

    container.className = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6";

    container.innerHTML = filtered.map(h => {
        const details = [];
        if (exists(h.age)) details.push(`<span class="text-gray-600 dark:text-gray-400">${t('alder')}:</span> <span class="font-medium dark:text-gray-200">${h.age} ${t('ar')}</span>`);
        if (exists(h.gender) || exists(h.sex)) details.push(`<span class="text-gray-600 dark:text-gray-400">${t('kon')}:</span> <span class="font-medium dark:text-gray-200">${h.gender || h.sex}</span>`);
        if (exists(h.breed)) details.push(`<span class="text-gray-600 dark:text-gray-400">${t('ras')}:</span> <span class="font-medium dark:text-gray-200">${h.breed}</span>`);
        if (exists(h.color)) details.push(`<span class="text-gray-600 dark:text-gray-400">${t('farg')}:</span> <span class="font-medium dark:text-gray-200">${h.color}</span>`);
        if (exists(h.studbook)) details.push(`<span class="text-gray-600 dark:text-gray-400">${t('stambok')}:</span> <span class="font-medium dark:text-gray-200">${h.studbook}</span>`);
        if (exists(h.height)) details.push(`<span class="text-gray-600 dark:text-gray-400">${t('mkh')}:</span> <span class="font-medium dark:text-gray-200">${h.height} cm (${calculateCategory(h)})</span>`);

        const lineage = [h.sire, h.dam, h.damsire].filter(exists).join(' x ');
        const lineageStr = h.lineage || lineage;

        // ID-block (Endast inloggade funktionärer/admins)
        const idParts = [];
        if (isAuth) {
            if (h.chip || h.chipNo) idParts.push(`Chip: ${h.chip || h.chipNo}`);
            if (h.ueln) idParts.push(`UELN: ${h.ueln}`);
            if (h.license) idParts.push(`Lic: ${h.license}`);
        }

        return `
        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden hover:shadow-md transition-shadow flex flex-col h-full">
            <div class="p-4 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700 flex justify-between items-start">
                <div>
                    <h3 class="text-lg font-bold text-gray-900 dark:text-white leading-tight">${h.name || t('namn_saknas')}</h3>
                    ${h.id ? `<span class="text-xs text-gray-400 font-mono">#${h.id}</span>` : ''}
                </div>
                <div class="text-right">
                    <div class="text-3xl opacity-60 dark:opacity-80 drop-shadow-sm" style="color: ${getHorseColorHex(h.color)};" title="${h.color || 'Okänd färg'}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="currentColor" class="w-8 h-8 opacity-80"><path d="M509.8 332.5l-69.9-164.3c-14.9-41.2-50.4-71-93-79.2 18-10.6 46.3-35.9 34.2-82.3-1.3-5-7.1-7.9-12-6.1L166.9 76.3C35.9 123.4 0 238.9 0 398.8V480c0 17.7 14.3 32 32 32h236.2c23.8 0 39.3-25 28.6-46.3L256 384v-.7c-45.6-3.5-84.6-30.7-104.3-69.6-1.6-3.1-.9-6.9 1.6-9.3l12.1-12.1c3.9-3.9 10.6-2.7 12.9 2.4 14.8 33.7 48.2 57.4 87.4 57.4 17.2 0 33-5.1 46.8-13.2l46 63.9c6 8.4 15.7 13.3 26 13.3h50.3c8.5 0 16.6-3.4 22.6-9.4l45.3-39.8c8.9-9.1 11.7-22.6 7.1-34.4zM328 224c-13.3 0-24-10.7-24-24s10.7-24 24-24 24 10.7 24 24-10.7 24-24 24z"/></svg></div>
                    ${(isAuth && h.vaccinationDate) ? `<div class="text-[10px] bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 px-1.5 py-0.5 rounded mt-1 whitespace-nowrap">💉 ${h.vaccinationDate}</div>` : ''}
                </div>
            </div>
            
            <div class="p-4 flex-1 space-y-3 text-sm">
                ${details.length ? `<div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-700 dark:text-gray-300">${details.join('<span class="text-gray-300 dark:text-gray-600">|</span>')}</div>` : ''}

                ${lineageStr ? `
                <div class="pt-2 border-t border-dashed dark:border-gray-700">
                    <p class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">${t('harstamning')}</p>
                    <p class="font-medium text-gray-800 dark:text-gray-200">${lineageStr}</p>
                </div>` : ''}

                ${idParts.length ? `
                <div class="pt-2 border-t border-dashed dark:border-gray-700">
                     <p class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">ID & Data</p>
                     <div class="text-xs text-mono text-gray-600 dark:text-gray-300 break-all space-y-0.5">
                        ${idParts.map(p => `<div>${p}</div>`).join('')}
                     </div>
                </div>` : ''}

                <div class="pt-2">
                    ${exists(h.breeder) ? `
                    <div class="flex flex-col mb-1">
                        <span class="text-xs text-gray-500 dark:text-gray-400">${t('uppfodare')}</span>
                        <span class="text-gray-800 dark:text-gray-200 font-medium truncate" title="${h.breeder}">${h.breeder}</span>
                    </div>` : ''}
                    
                    ${exists(h.owner) ? `
                    <div class="flex flex-col">
                        <span class="text-xs text-gray-500 dark:text-gray-400">${t('agare')}</span>
                        <span class="text-gray-800 dark:text-gray-200 font-medium truncate" title="${h.owner}">${h.owner}</span>
                    </div>` : ''}
                </div>
            </div>

            <div class="px-4 py-3 bg-blue-50/50 dark:bg-blue-900/20 border-t border-blue-100 dark:border-blue-900/30 flex items-center gap-2">
                <span class="text-xs text-blue-600 dark:text-blue-400 font-semibold uppercase">${t('kores_av')}</span>
                <span class="text-sm font-bold text-gray-900 dark:text-white truncate flex-1">${h.driverName || '—'}</span>
            </div>
        </div>
        `;
    }).join('');
}

function renderTable(filtered, container) {
    const user = getGlobalState('currentUser');
    const role = (user?.role || '').toLowerCase();
    const isAuth = ['admin', 'organizer', 'official', 'judge', 'domare', 'funktionar'].includes(role);

    // Structure matches marathon-resultat.js
    container.className = ""; // Reset container class as we build the wrapper manually inside

    const rows = filtered.map(h => {
        const cat = calculateCategory(h);
        const lineage = [h.sire, h.dam].filter(exists).join(' x ') || h.lineage || '-';
        return `
            <tr class="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                <td class="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white bg-white dark:bg-gray-800 sticky left-0 z-10">${h.name}</td>
                <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">${h.breed || '-'}</td>
                <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">${h.color || '-'}</td>
                <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">${h.gender || '-'}</td>
                <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 text-center">${h.age || '-'}</td>
                <td class="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 truncate max-w-xs" title="${lineage}">${lineage}</td>
                <td class="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 truncate max-w-xs" title="${h.owner || ''}">${h.owner || '-'}</td>
                <td class="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 truncate max-w-xs">${h.driverName || '-'}</td>
                ${isAuth ? `<td class="px-4 py-3 text-sm text-green-700 dark:text-green-400 whitespace-nowrap text-right">${h.vaccinationDate || '-'}</td>` : ''}
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <div class="bg-white dark:bg-gray-800 shadow-lg rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
            <div id="hastar-x-wrap" class="x-scroll-wrap bg-white dark:bg-gray-800 w-full overflow-x-auto">
                <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead class="bg-gray-50 dark:bg-gray-700">
                        <tr>
                            <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider sticky left-0 z-20 bg-gray-50 dark:bg-gray-700">${t('hast_ponny')}</th>
                            <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">${t('ras')}</th>
                            <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">${t('farg')}</th>
                            <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">${t('kon')}</th>
                            <th scope="col" class="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">${t('alder')}</th>
                            <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">${t('harstamning')}</th>
                            <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">${t('agare')}</th>
                            <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">${t('kusk')}</th>
                            ${isAuth ? `<th scope="col" class="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">${t('vaccination')}</th>` : ''}
                        </tr>
                    </thead>
                    <tbody class="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
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
        page.innerHTML = `<div class="container mx-auto p-4"><p class="p-8 text-center text-red-500 bg-white dark:bg-gray-800 rounded shadow dark:shadow-none dark:border dark:border-red-900">${t('no_competition_selected')}</p></div>`;
        return;
    }

    // Initialize shared scrollbar helper
    injectScrollStyles();
    // Initialize specifically for this view so it snatches ownership
    initializeScrollSync('hastar');

    page.innerHTML = `
        <div class="container mx-auto p-4 md:p-8">
            ${getCompetitionHeader(competition, t('hastlista'))}

            <div class="bg-white dark:bg-gray-800 p-4 md:p-6 rounded-xl shadow-md mb-6 transition-colors">
                <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                     <!-- Sökfält -->
                     <div class="relative w-full md:w-96">
                        <span class="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-500">
                           <svg fill="currentColor" viewBox="0 0 20 20" class="w-5 h-5"><path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd"></path></svg>
                        </span>
                        <input id="horseSearch" type="text" placeholder="${t('search_horse_placeholder')}" class="w-full py-2 pl-10 pr-4 text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white dark:focus:bg-gray-600 text-base placeholder-gray-400">
                     </div>

                     <div class="flex flex-wrap items-center gap-3">
                        <span class="text-sm text-gray-500 dark:text-gray-400 hidden md:inline" id="horseCount"></span>

                        <!-- Vy-väljare -->
                         <div class="inline-flex rounded-md shadow-sm" role="group">
                            <button id="viewGridBtn" type="button" class="px-3 py-2 text-sm font-medium border border-gray-300 dark:border-gray-600 rounded-l-lg ${viewMode === 'grid' ? 'bg-gray-900 text-white dark:bg-gray-600' : 'bg-white text-gray-700 dark:bg-gray-800 dark:text-gray-300'} hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                                <i class="fas fa-th-large"></i> Panels
                            </button>
                            <button id="viewTableBtn" type="button" class="px-3 py-2 text-sm font-medium border-t border-b border-r border-gray-300 dark:border-gray-600 rounded-r-lg ${viewMode === 'table' ? 'bg-gray-900 text-white dark:bg-gray-600' : 'bg-white text-gray-700 dark:bg-gray-800 dark:text-gray-300'} hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                                <i class="fas fa-table"></i> Tabell
                            </button>
                        </div>

                        <!-- Export -->
                        <div class="flex items-center gap-2">
                            <button id="btnExportCsv" type="button" class="inline-flex items-center px-3 py-2 border border-gray-300 dark:border-gray-600 shadow-sm text-sm font-medium rounded-md text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors">
                                <i class="fas fa-file-csv mr-2 text-gray-500"></i> CSV
                            </button>
                            <button id="btnExportPdf" type="button" class="inline-flex items-center px-3 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-gray-600 hover:bg-gray-700 dark:bg-gray-600 dark:hover:bg-gray-500 transition-colors">
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
        btnG.className = `px-3 py-2 text-sm font-medium border border-gray-300 dark:border-gray-600 rounded-l-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${viewMode === 'grid' ? 'bg-gray-900 text-white dark:bg-gray-600' : 'bg-white text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`;
        btnT.className = `px-3 py-2 text-sm font-medium border-t border-b border-r border-gray-300 dark:border-gray-600 rounded-r-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${viewMode === 'table' ? 'bg-gray-900 text-white dark:bg-gray-600' : 'bg-white text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`;
    }
}