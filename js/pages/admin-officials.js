import {
    listenForOfficials,
    saveOfficial,
    deleteOfficial,
    listenForAssignments,
    saveAssignment,
    deleteAssignment,
    listenForLocations,
    saveLocations,
    listenForVolunteerSignups,
    approveVolunteer,
    rejectVolunteer,
    updateOfficialStatus,
    serverTimestamp,
    listenForRoles,
    saveRoles
} from '../services/officialsService.js';

import { showAlert } from '../ui/components.js';
import { getGlobalState } from '../main.js';
import { generateOfficialsPdf, exportOfficialsCsv, exportAssignmentsCsv } from '../pdf/officialsReports.js';

let officials = [];
let volunteerSignups = [];
let assignments = [];
let locations = [];
let customRoles = [];
let currentSubTab = 'people'; // 'people' | 'assign' | 'overview'
let lastSelectedDate = ''; // Persist date during session


let overviewMode = 'cards'; // 'cards' | 'table'
let overviewSortCol = 'location'; // 'location' | 'role' | 'person' | 'date' | 'time'
let overviewSortAsc = true;
let checkInFilter = 'all'; // 'all' | 'not-checked-in'

export function renderOfficialsTab(container, competition) {
    if (!container) return;

    // Load data listeners if not already loaded? 
    // Ideally we should manage listeners properly, but for now we re-trigger.
    // In a full app we might cache these unsubscribers.
    listenForOfficials(competition.id, (data) => {
        officials = data;
        refreshUI(container, competition);
    });

    listenForAssignments(competition.id, (data) => {
        assignments = data;
        refreshUI(container, competition);
    });

    listenForLocations(competition.id, (data) => {
        if (!data || data.length === 0) {
            // Default generation if empty
            locations = generateDefaultLocations();
            saveLocations(competition.id, locations);
        } else {
            locations = data;
        }
        refreshUI(container, competition);
    });

    listenForVolunteerSignups(competition.id, (data) => {
        volunteerSignups = data;
        updateSignupBadge(); // New helper to show count
        refreshUI(container, competition);
    });

    listenForRoles(competition.id, (data) => {
        customRoles = data;
        refreshUI(container, competition);
    });

    // Initial Render Structure
    refreshUI(container, competition);
}

function updateSignupBadge() {
    const btn = document.getElementById('subtab-signups');
    if (!btn) return;
    const count = volunteerSignups.length;
    // Simple text update or badge injection logic would go here
    // For now, handled in refreshUI template
}

function generateDefaultLocations() {
    const locs = [];

    // --- MARATON ---
    locs.push({ id: 'SECRETARIAT', label: 'Sekretariat', type: 'section' }); // Shared/Official?
    locs.push({ id: 'START_A', label: 'Start Sträcka A', type: 'start_finish_m' });
    locs.push({ id: 'FINISH_A', label: 'Mål Sträcka A', type: 'start_finish_m' });
    locs.push({ id: 'START_B', label: 'Start Sträcka B', type: 'start_finish_m' });
    locs.push({ id: 'FINISH_B', label: 'Mål Sträcka B', type: 'start_finish_m' });
    locs.push({ id: 'WARMUP_M', label: 'Uppvärmning (Maraton)', type: 'warmup_m' });
    locs.push({ id: 'TRANSPORT_M', label: 'Transport (Maraton)', type: 'transport_m' });

    // Generate Obstacles 1-8
    for (let i = 1; i <= 8; i++) {
        locs.push({ id: `OBSTACLE_${i}`, label: `Hinder ${i}`, type: 'obstacle' });
    }

    // --- DRESSYR ---
    const dressLocs = [
        'Speaker', 'Banpersonal', 'Insläpp', 'Vetcheck',
        'Funktionskontroll', 'Domarsekreterare', 'Protokoll löpare',
        'Parkering', 'Camping', 'Catering'
    ];
    dressLocs.forEach(l => {
        // Create ID from label
        const id = l.toUpperCase().replace(/\s+/g, '_').replace(/Ö/g, 'O').replace(/Ä/g, 'A').replace(/Å/g, 'A');
        locs.push({ id: `DRESSAGE_${id}`, label: l, type: 'dressage_func' });
    });

    // --- PRECISION ---
    locs.push({ id: 'PRECISION_COURSE', label: 'Bana (Precision)', type: 'course_p' });
    locs.push({ id: 'PRECISION_WARMUP', label: 'Uppvärmning (Precision)', type: 'warmup_p' });
    locs.push({ id: 'PRECISION_IN', label: 'Insläpp (Precision)', type: 'course_p' });

    return locs;
}

function refreshUI(container, competition) {
    container.innerHTML = `
        <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
            <!-- Sidebar / Sub-nav -->
            <div class="lg:col-span-1 space-y-2">
                <button id="subtab-people" class="w-full text-left px-4 py-3 rounded-lg font-medium transition-colors ${currentSubTab === 'people' ? 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800' : 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700'}">
                    👥 Personregister
                </button>
                <button id="subtab-assign" class="w-full text-left px-4 py-3 rounded-lg font-medium transition-colors ${currentSubTab === 'assign' ? 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800' : 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700'}">
                    📋 Tilldelning
                </button>
                <button id="subtab-checkin" class="w-full text-left px-4 py-3 rounded-lg font-medium transition-colors ${currentSubTab === 'checkin' ? 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800' : 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700'}">
                    ✅ Incheckning
                </button>
                <button id="subtab-overview" class="w-full text-left px-4 py-3 rounded-lg font-medium transition-colors ${currentSubTab === 'overview' ? 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800' : 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700'}">
                    👀 Översikt & Print
                </button>
                <button id="subtab-signups" class="w-full text-left px-4 py-3 rounded-lg font-medium transition-colors ${currentSubTab === 'signups' ? 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800' : 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700'}">
                    📥 Inkorg (${volunteerSignups.length})
                </button>
                <button id="subtab-reports" class="w-full text-left px-4 py-3 rounded-lg font-medium transition-colors ${currentSubTab === 'reports' ? 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800' : 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700'}">
                    🖨️ Rapporter
                </button>
            </div>

            <!-- Content Area -->
            <div class="lg:col-span-3 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 min-h-[500px]">
                ${renderContent(competition)}
            </div>
        </div>
    `;

    // Bind events
    document.getElementById('subtab-people').onclick = () => { currentSubTab = 'people'; refreshUI(container, competition); };
    document.getElementById('subtab-assign').onclick = () => { currentSubTab = 'assign'; refreshUI(container, competition); };
    document.getElementById('subtab-checkin').onclick = () => { currentSubTab = 'checkin'; refreshUI(container, competition); };
    document.getElementById('subtab-overview').onclick = () => { currentSubTab = 'overview'; refreshUI(container, competition); };
    document.getElementById('subtab-signups').onclick = () => { currentSubTab = 'signups'; refreshUI(container, competition); };
    document.getElementById('subtab-reports').onclick = () => { currentSubTab = 'reports'; refreshUI(container, competition); };

    // Inner Events
    bindContentEvents(container, competition);

    // If overview, render it now that container exists
    if (currentSubTab === 'overview') {
        renderOverviewView();
    }
}

function renderContent(competition) {
    if (currentSubTab === 'people') return renderPeopleView(officials, competition);
    if (currentSubTab === 'assign') return renderAssignView();
    if (currentSubTab === 'overview') return '<div id="officialsOverview" data-filter="all"></div>';
    if (currentSubTab === 'checkin') return renderCheckInView(competition);
    if (currentSubTab === 'signups') return renderSignupsView(competition);
    if (currentSubTab === 'reports') return renderReportsView(competition);
    return renderPeopleView(officials, competition);
}

// --- CHECK-IN VIEW ---
function renderCheckInView(competition) {
    const list = officials.sort((a, b) => a.name.localeCompare(b.name));

    // Stats
    const total = list.length;
    const checkedIn = list.filter(p => p.isCheckedIn).length;
    const vestCount = list.filter(p => p.hasVest).length;
    const radioCount = list.filter(p => p.hasRadio).length;
    const progress = total > 0 ? Math.round((checkedIn / total) * 100) : 0;

    // Filter
    let displayList = list;
    if (checkInFilter === 'not-checked-in') {
        displayList = list.filter(p => !p.isCheckedIn);
    }

    // Toggle global filter
    window.toggleCheckInFilter = (val) => {
        checkInFilter = val;
        refreshUI(document.getElementById('reportsContainer')?.parentNode?.parentNode, competition);
    };

    return `
        <div class="space-y-6">
            <!-- Top Bar: Stats & Filter -->
            <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gray-50 dark:bg-gray-700 p-4 rounded-lg border dark:border-gray-600">
                <div>
                    <h3 class="text-lg font-bold dark:text-white">Sekretariat / Incheckning</h3>
                    <div class="text-sm text-gray-500 dark:text-gray-300 flex gap-4 mt-1">
                        <span>✅ Incheckade: <strong>${checkedIn}/${total}</strong></span>
                        <span>🦺 Västar: <strong>${vestCount}</strong></span>
                        <span>📻 Radio: <strong>${radioCount}</strong></span>
                    </div>
                    <div class="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2.5 mt-2 max-w-md">
                        <div class="bg-green-600 h-2.5 rounded-full transition-all duration-500" style="width: ${progress}%"></div>
                    </div>
                </div>

                <div class="flex gap-2">
                     <button onclick="window.toggleCheckInFilter('all')" class="px-3 py-1 text-sm rounded border ${checkInFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600'}">
                        Visa Alla
                    </button>
                    <button onclick="window.toggleCheckInFilter('not-checked-in')" class="px-3 py-1 text-sm rounded border ${checkInFilter === 'not-checked-in' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600'}">
                        Ej Incheckade (${total - checkedIn})
                    </button>
                </div>
            </div>

            <!-- List -->
            <div class="grid grid-cols-1 gap-3">
                ${displayList.map(p => {
        const statusClass = p.isCheckedIn ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800' : 'bg-white border-gray-200 dark:bg-gray-800 dark:border-gray-700';
        return `
                    <div class="border rounded-lg p-3 shadow-sm ${statusClass} transition-colors flex flex-col sm:flex-row justify-between items-center gap-3">
                        <div class="flex-grow text-center sm:text-left">
                            <div class="font-bold text-lg dark:text-white">${p.name}</div>
                            <div class="text-sm text-gray-600 dark:text-gray-400">${p.role || p.notes || '-'}</div>
                            ${p.isCheckedIn ? `<div class="text-xs text-green-700 dark:text-green-400 font-medium">🕒 ${new Date(p.checkInTime || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>` : ''}
                        </div>
                        
                        <div class="flex flex-wrap justify-center gap-2">
                            <button data-toggle-checkin="${p.id}" class="px-4 py-2 rounded font-bold border flex items-center gap-2 ${p.isCheckedIn ? 'bg-green-600 text-white border-green-700 shadow-inner' : 'bg-white text-gray-400 border-gray-300 hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-600'}">
                                ${p.isCheckedIn ? '✅ Incheckad' : '⚪ Checka in'}
                            </button>
                            
                            <button data-toggle-vest="${p.id}" class="px-3 py-2 rounded font-bold border flex items-center gap-2 ${p.hasVest ? 'bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-200 dark:border-yellow-700' : 'bg-white text-gray-300 border-gray-200 hover:bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:hover:bg-gray-600'}" title="Har fått väst">
                                🦺
                            </button>
                            
                            <button data-toggle-radio="${p.id}" class="px-3 py-2 rounded font-bold border flex items-center gap-2 ${p.hasRadio ? 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-200 dark:border-blue-700' : 'bg-white text-gray-300 border-gray-200 hover:bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:hover:bg-gray-600'}" title="Har fått radio">
                                📻
                            </button>
                        </div>
                    </div>
                `;
    }).join('')}
                ${displayList.length === 0 ? '<div class="text-center text-gray-500 py-8">Inga personer matchar filtret.</div>' : ''}
            </div>
        </div>
    `;
}

// --- VIEWS ---

function renderPeopleView() {
    // Definiera nyckelroller
    const keyRoles = ['Tävlingsledare', 'Domarordförande', 'Banbyggare', 'Säkerhetsansvarig', 'Pressansvarig', 'Veterinär', 'Resultatansvarig'];

    // Filtrera fram nyckelpersoner
    const keyOfficials = officials.filter(p => keyRoles.some(role => (p.role || '').includes(role)));
    // Övriga
    const otherOfficials = officials.filter(p => !keyOfficials.includes(p));

    return `
        <div class="space-y-6">
            <div class="flex justify-between items-center">
                <h3 class="text-xl font-bold">Funktionärer</h3>
                <div class="flex gap-2">
                    <input type="file" id="csvImportInput" accept=".csv" class="hidden">
                    <button id="btnImportCsv" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium text-sm">📂 Importera CSV</button>
                    <button id="btnAddOfficial" class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 font-medium text-sm">+ Lägg till person</button>
                </div>
            </div>

            <!-- Add Form (Hidden by default, or simple inline) -->
            <div id="addOfficialForm" class="hidden bg-gray-50 dark:bg-gray-700 p-4 rounded border dark:border-gray-600 mb-4">
                <h4 class="font-bold text-sm mb-3 dark:text-gray-200" id="formTitle">Ny Funktionär</h4>
                <input type="hidden" id="editOfficialId">
                <input type="hidden" id="linkSignupId"> <!-- For approving signups -->
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <input type="text" id="newOffName" placeholder="Namn *" class="p-2 border rounded dark:bg-gray-600 dark:border-gray-500 dark:text-white dark:placeholder-gray-400">
                    <input type="email" id="newOffEmail" placeholder="Email" class="p-2 border rounded dark:bg-gray-600 dark:border-gray-500 dark:text-white dark:placeholder-gray-400">
                    <input type="text" id="newOffPhone" placeholder="Telefon" class="p-2 border rounded dark:bg-gray-600 dark:border-gray-500 dark:text-white dark:placeholder-gray-400">
                    <input type="text" id="newOffClub" placeholder="Klubb" class="p-2 border rounded dark:bg-gray-600 dark:border-gray-500 dark:text-white dark:placeholder-gray-400">
                    <div class="col-span-2 md:col-span-1 grid grid-cols-2 gap-2">
                         <input type="text" id="newOffIceName" placeholder="ICE Namn" class="p-2 border rounded text-sm dark:bg-gray-600 dark:border-gray-500 dark:text-white dark:placeholder-gray-400">
                         <input type="text" id="newOffIcePhone" placeholder="ICE Tel" class="p-2 border rounded text-sm dark:bg-gray-600 dark:border-gray-500 dark:text-white dark:placeholder-gray-400">
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <input type="text" id="newOffDiet" placeholder="Kost/Allergi" class="p-2 border rounded text-sm dark:bg-gray-600 dark:border-gray-500 dark:text-white dark:placeholder-gray-400">
                        <select id="newOffShirt" class="p-2 border rounded text-sm dark:bg-gray-600 dark:border-gray-500 dark:text-white">
                            <option value="">- Tröja -</option>
                            <option value="XS">XS</option>
                            <option value="S">S</option>
                            <option value="M">M</option>
                            <option value="L">L</option>
                            <option value="XL">XL</option>
                            <option value="XXL">XXL</option>
                        </select>
                    </div>
                    <div class="col-span-2">
                         <input type="text" id="newOffNotes" placeholder="Notering / Kompetens / Roll" class="w-full p-2 border rounded dark:bg-gray-600 dark:border-gray-500 dark:text-white dark:placeholder-gray-400">
                    </div>
                </div>
                <div class="flex gap-2">
                    <button id="btnSaveNewOfficial" class="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 dark:hover:bg-blue-500">Spara</button>
                    <button id="btnCancelNewOfficial" class="px-4 py-2 bg-gray-300 text-gray-800 rounded text-sm hover:bg-gray-400 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500">Avbryt</button>
                </div>
            </div>

            <!-- KEY OFFICIALS TABLE -->
             <div class="bg-blue-50 border border-blue-200 dark:bg-blue-900/20 dark:border-blue-800 rounded-lg p-4 mb-6">
                <h4 class="text-lg font-bold text-blue-900 dark:text-blue-100 mb-2">Tävlingsledning & Nyckelroller</h4>
                <div class="overflow-x-auto">
                    <table class="min-w-full divide-y divide-blue-200 dark:divide-blue-800">
                        <thead class="bg-blue-100 dark:bg-blue-900/40">
                            <tr>
                                <th class="px-3 py-2 text-left text-xs font-bold text-blue-800 dark:text-blue-200 uppercase">Roll</th>
                                <th class="px-3 py-2 text-left text-xs font-bold text-blue-800 dark:text-blue-200 uppercase">Namn</th>
                                <th class="px-3 py-2 text-left text-xs font-bold text-blue-800 dark:text-blue-200 uppercase">Kontakt</th>
                                <th class="px-3 py-2 w-10"></th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-blue-100 dark:divide-blue-900/40 bg-white dark:bg-gray-800">
                            ${keyOfficials.length > 0 ? keyOfficials.map(p => `
                                <tr>
                                    <td class="px-3 py-2 font-bold text-blue-900 dark:text-blue-300">${p.role}</td>
                                    <td class="px-3 py-2 dark:text-gray-300">${p.name} ${p.club ? `<span class="text-xs text-gray-500 dark:text-gray-400">(${p.club})</span>` : ''}</td>
                                    <td class="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">${p.phone || '-'} <br> <a href="mailto:${p.email}" class="text-xs text-blue-600 hover:underline dark:text-blue-400">${p.email || ''}</a></td>
                                    <td class="px-3 py-2 text-right">
                                        <button class="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300" data-edit-official="${p.id}">✏️</button>
                                    </td>
                                </tr>
                            `).join('') : '<tr><td colspan="4" class="p-3 text-center text-sm text-gray-500 dark:text-gray-400">Inga nyckelpersoner inlagda. (Använd "Lägg till person" och ange roll t.ex. Tävlingsledare)</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- ALL OFFICIALS LIST -->
            <div>
                 <h4 class="text-lg font-bold text-gray-800 dark:text-gray-200 mb-2">Alla Funktionärer</h4>
                 <div class="overflow-x-auto border dark:border-gray-600 rounded-lg">
                    <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                        <thead class="bg-gray-50 dark:bg-gray-700/50">
                            <tr>
                                <th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Namn / Klubb</th>
                                <th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Kontakt</th>
                                <th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">ICE (Nödkontakt)</th>
                                <th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Kost & Tröja</th>
                                <th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Roll / Notering</th>
                                <th class="px-3 py-2 w-20"></th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                            ${otherOfficials.map(p => `
                            <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/50 group text-sm dark:bg-gray-800">
                                <td class="px-3 py-2 align-top">
                                    <div class="font-bold text-gray-900 dark:text-white">${p.name}</div>
                                    ${p.club ? `<div class="text-xs text-gray-500 dark:text-gray-400">${p.club}</div>` : ''}
                                </td>
                                <td class="px-3 py-2 align-top">
                                    <div class="dark:text-gray-300">${p.phone || '-'}</div>
                                    <div class="text-xs truncate max-w-[150px]"><a href="mailto:${p.email}" class="text-blue-600 hover:underline dark:text-blue-400">${p.email || ''}</a></div>
                                </td>
                                <td class="px-3 py-2 align-top">
                                    ${p.iceName ? `
                                        <div class="font-medium dark:text-gray-300">${p.iceName}</div>
                                        <div class="text-xs text-gray-500 dark:text-gray-400">${p.icePhone || ''}</div>
                                    ` : `<span class="text-gray-300 dark:text-gray-600">-</span>`}
                                </td>
                                <td class="px-3 py-2 align-top">
                                    ${p.diet ? `<div class="text-amber-700 dark:text-amber-400 font-medium text-xs mb-1">🍽️ ${p.diet}</div>` : ''}
                                    ${p.shirtSize ? `<div class="text-xs"><span class="bg-gray-100 dark:bg-gray-700 border dark:border-gray-600 px-1 rounded dark:text-gray-300">👕 ${p.shirtSize}</span></div>` : ''}
                                    ${!p.diet && !p.shirtSize ? '<span class="text-gray-300 dark:text-gray-600">-</span>' : ''}
                                </td>
                                <td class="px-3 py-2 align-top">
                                    <div class="max-w-[200px] break-words text-gray-700 dark:text-gray-300">${[p.role, p.notes].filter(Boolean).join(', ') || '-'}</div>
                                </td>
                                <td class="px-3 py-2 text-right align-top">
                                    <button class="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 mr-2 opacity-0 group-hover:opacity-100 transition-opacity" data-edit-official="${p.id}" title="Redigera">✏️</button>
                                    <button class="text-red-400 hover:text-red-700 dark:hover:text-red-300 opacity-0 group-hover:opacity-100 transition-opacity" data-delete-official="${p.id}" title="Ta bort">🗑️</button>
                                </td>
                            </tr>
                            `).join('')}
                            ${otherOfficials.length === 0 ? '<tr><td colspan="6" class="p-4 text-center text-gray-400">Inga övriga funktionärer.</td></tr>' : ''}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

function renderAssignView() {
    const defaultRoles = [
        'Hinderchef', 'Tidtagare (Start/Mål)', 'Tidtagare (Hinder)',
        'Observatör', 'Protokollskrivare', 'Domare', 'Veterinär',
        'Sekretariat', 'Speaker', 'Säkerhetschef', 'Banbyggare'
    ];
    // Merge unique
    const roles = Array.from(new Set([...defaultRoles, ...customRoles])).sort();

    return `
        <div class="space-y-8">
            <div class="bg-blue-50 dark:bg-blue-900/20 p-4 md:p-6 rounded-lg border border-blue-100 dark:border-blue-800 shadow-sm">
                <h3 class="text-xl font-bold text-blue-900 dark:text-blue-100 mb-6 flex items-center gap-2">
                    <span class="text-2xl">📋</span> Skapa Tilldelning
                </h3>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    
                    <!-- 1. Välj Person -->
                    <div class="space-y-2">
                        <label class="block text-sm font-bold text-blue-900 dark:text-blue-200 uppercase tracking-wide">Person</label>
                        <div class="relative">
                            <select id="assignOfficial" class="w-full p-3 md:p-2 border border-blue-300 dark:border-blue-700 rounded-lg bg-white dark:bg-gray-700 shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base dark:text-white">
                                <option value="">-- Välj person --</option>
                                ${officials.map(o => {
        const label = [o.role, o.notes].filter(Boolean).join(', ');
        return `<option value="${o.id}">${o.name} ${label ? `(${label})` : ''}</option>`;
    }).join('')}
                            </select>
                            <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700 dark:text-gray-300">
                                <svg class="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                            </div>
                        </div>
                    </div>

                    <!-- 2. Välj Roll -->
                    <div id="assignRoleContainer" class="space-y-2">
                        <label class="block text-sm font-bold text-blue-900 dark:text-blue-200 uppercase tracking-wide">Roll</label>
                         <div class="relative">
                            <select id="assignRole" class="w-full p-3 md:p-2 border border-blue-300 dark:border-blue-700 rounded-lg bg-white dark:bg-gray-700 shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base dark:text-white">
                                <option value="">-- Välj roll --</option>
                                ${roles.map(r => `<option value="${r}">${r}</option>`).join('')}
                                <option value="MANUAL_ROLE" class="font-bold text-blue-600 dark:text-blue-400">+ Lägg till ny roll...</option>
                            </select>
                             <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700 dark:text-gray-300">
                                <svg class="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                            </div>
                        </div>
                          <div id="manualRoleContainer" class="hidden mt-3">
                            <input type="text" id="manualRoleName" placeholder="Ange namn på ny roll..." class="w-full p-3 border border-yellow-300 rounded-lg text-base bg-yellow-50 focus:ring-2 focus:ring-yellow-500 dark:bg-yellow-900/20 dark:border-yellow-700 dark:text-white dark:placeholder-gray-400">
                        </div>
                    </div>
                
                    <!-- 3. Välj Gren (Discipline) -->
                    <div class="space-y-2">
                        <label class="block text-sm font-bold text-blue-900 dark:text-blue-200 uppercase tracking-wide">Gren / Område</label>
                        <select id="assignDiscipline" class="w-full p-3 md:p-2 border border-blue-300 dark:border-blue-700 rounded-lg bg-white dark:bg-gray-700 shadow-sm text-base dark:text-white">
                            <option value="all">Alla / Övergripande</option>
                            <option value="marathon">Maraton</option>
                            <option value="dressage">Dressyr</option>
                            <option value="precision">Precision</option>
                        </select>
                    </div>

                    <!-- 4. Välj Plats -->
                    <div id="assignLocationContainer" class="space-y-2">
                        <label class="block text-sm font-bold text-blue-900 dark:text-blue-200 uppercase tracking-wide">Plats / Uppgift</label>
                         <div class="relative">
                            <select id="assignLocation" class="w-full p-3 md:p-2 border border-blue-300 dark:border-blue-700 rounded-lg bg-white dark:bg-gray-700 shadow-sm text-base dark:text-white">
                                <!-- Fylls på dynamiskt -->
                            </select>
                             <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700 dark:text-gray-300">
                                <svg class="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                            </div>
                        </div>
                        <div id="manualLocationContainer" class="hidden mt-3">
                            <input type="text" id="manualLocationName" placeholder="Ange namn på ny plats..." class="w-full p-3 border border-yellow-300 rounded-lg text-base bg-yellow-50 focus:ring-2 focus:ring-yellow-500 dark:bg-yellow-900/20 dark:border-yellow-700 dark:text-white dark:placeholder-gray-400">
                        </div>
                    </div>

                    <!-- 5. Välj Tid (Datum + Start - Slut) -->
                    <div class="col-span-1 md:col-span-2 bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                        <h4 class="font-bold text-gray-700 dark:text-gray-200 mb-3 border-b dark:border-gray-600 pb-1">Tidpunkt</h4>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label class="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Datum</label>
                                <input type="date" id="assignDate" class="w-full p-3 md:p-2 border rounded-lg text-base dark:bg-gray-700 dark:border-gray-600 dark:text-white" value="${lastSelectedDate}">
                            </div>
                            
                            <div>
                                <label class="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Tid</label>
                                <div class="flex items-center gap-2">
                                     <input type="time" id="assignStartTime" class="w-full p-3 md:p-2 border rounded-lg text-base dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                                     <span class="text-gray-400 font-bold">-</span>
                                     <input type="time" id="assignEndTime" class="w-full p-3 md:p-2 border rounded-lg text-base dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- 6. Knapp -->
                    <div class="col-span-1 md:col-span-2 flex justify-end mt-4">
                        <button id="btnSaveAssignment" class="w-full md:w-auto px-8 py-3 md:py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 shadow-md transform active:scale-95 transition-all text-lg md:text-base flex justify-center items-center gap-2">
                           <span>💾</span> Tilldela Uppgift
                        </button>
                    </div>
                </div>
            </div>

            <!-- List of Assignments -->
            <div>
                <h3 class="text-lg font-bold mb-4 dark:text-white">Aktuella Uppdrag</h3>
                <div class="overflow-x-auto border dark:border-gray-600 rounded-lg">
                    <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                        <thead class="bg-gray-50 dark:bg-gray-700/50">
                            <tr>
                                <th class="px-4 py-2 text-left font-semibold text-gray-600 dark:text-gray-300">Person</th>
                                <th class="px-4 py-2 text-left font-semibold text-gray-600 dark:text-gray-300">Roll</th>
                                <th class="px-4 py-2 text-left font-semibold text-gray-600 dark:text-gray-300">Plats</th>
                                <th class="px-4 py-2 text-left font-semibold text-gray-600 dark:text-gray-300">Datum</th>
                                <th class="px-4 py-2 text-left font-semibold text-gray-600 dark:text-gray-300">Tid</th>
                                <th class="px-4 py-2 w-16"></th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-100 dark:divide-gray-700 bg-white dark:bg-gray-800">
                            ${assignments.map(a => {
        const person = officials.find(o => o.id === a.officialId);
        const locale = locations.find(l => l.id === a.locationId);
        return `
                                <tr class="dark:text-gray-200">
                                    <td class="px-4 py-2 font-medium">${person ? person.name : 'Okänd'}</td>
                                    <td class="px-4 py-2">${a.roleLabel}</td>
                                    <td class="px-4 py-2 text-gray-500 dark:text-gray-400">${locale ? locale.label : '-'}</td>
                                    <td class="px-4 py-2 text-gray-500 dark:text-gray-400 font-mono text-xs">${a.dateString || '-'}</td>
                                    <td class="px-4 py-2 text-gray-500 dark:text-gray-400 font-mono text-xs">
                                        ${a.startTime ? `${a.startTime} - ${a.endTime || '?'}` : (a.shift !== 'all' ? a.shift : '-')}
                                    </td>
                                    <td class="px-4 py-2 text-right">
                                        <button class="text-red-400 hover:text-red-600 dark:hover:text-red-300" data-delete-assignment="${a.id}">🗑️</button>
                                    </td>
                                </tr>`;
    }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}


function renderOverviewView() {
    const container = document.getElementById('officialsOverview');
    if (!container) return;

    // Filter Controls
    const currentFilter = container.dataset.filter || 'all';

    const filterHtml = `
        <div class="flex gap-2 mb-4 print:hidden">
            <button class="px-3 py-1 rounded border ${currentFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-white hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700'}" onclick="document.getElementById('officialsOverview').dataset.filter='all'; window.renderOverviewView()">Alla</button>
            <button class="px-3 py-1 rounded border ${currentFilter === 'marathon' ? 'bg-blue-600 text-white' : 'bg-white hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700'}" onclick="document.getElementById('officialsOverview').dataset.filter='marathon'; window.renderOverviewView()">Maraton</button>
            <button class="px-3 py-1 rounded border ${currentFilter === 'dressage' ? 'bg-blue-600 text-white' : 'bg-white hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700'}" onclick="document.getElementById('officialsOverview').dataset.filter='dressage'; window.renderOverviewView()">Dressyr</button>
            <button class="px-3 py-1 rounded border ${currentFilter === 'precision' ? 'bg-blue-600 text-white' : 'bg-white hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700'}" onclick="document.getElementById('officialsOverview').dataset.filter='precision'; window.renderOverviewView()">Precision</button>
        </div>
    `;

    // Filter Logic
    // Marathon: obstacles, start_finish_m
    // Dressage: court, warmup
    // Precision: course, start_finish_p
    // General: general (always show? or only on 'all'? Let's show on All and their specific map if we assign a type to general roles?)
    // Actually, user wants specific maps. Let's filter strictly. 'General' roles usually apply to the whole event, so maybe show them at the bottom of all? 
    // Let's include 'general' in all views for now as they are "Övergripande".

    const isVisible = (type) => {
        if (currentFilter === 'all') return true;
        if (type === 'general') return true; // Always show general
        if (currentFilter === 'marathon' && (type === 'obstacle' || type.includes('_m'))) return true;
        if (currentFilter === 'dressage' && (type === 'court' || type === 'warmup')) return true;
        if (currentFilter === 'precision' && (type === 'course' || type.includes('_p'))) return true;
        return false;
    };

    container.innerHTML = `
        <div class="flex justify-between items-center mb-4">
            <div>
                <h3 class="text-lg font-bold dark:text-white">Funktionärsöversikt ${currentFilter !== 'all' ? `(${currentFilter})` : ''}</h3>
                <p class="text-sm text-gray-500 dark:text-gray-400">Utskriftsvänlig vy grupperad per plats.</p>
            </div>
             <button onclick="window.exportOverviewCsv()" class="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 border px-4 py-2 rounded flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-600 print:hidden mr-2">
                📂 CSV
            </button>
             <button onclick="window.exportOverviewPdf()" class="bg-gray-800 dark:bg-gray-900 border border-transparent dark:border-gray-700 text-white px-4 py-2 rounded flex items-center gap-2 hover:bg-gray-700 dark:hover:bg-gray-800 print:hidden">
                📄 Skriv ut PDF
            </button>
        </div>
        ${filterHtml}
        <div class="columns-1 md:columns-2 lg:columns-3 gap-4 space-y-4">
            <!-- Cards injected here -->
        </div>
    `;

    // Make render function available globally for the inline onclicks
    window.renderOverviewView = renderOverviewView;
    window.toggleOverviewMode = (mode) => {
        overviewMode = mode;
        renderOverviewView();
    };
    window.sortOverview = (col) => {
        if (overviewSortCol === col) overviewSortAsc = !overviewSortAsc;
        else {
            overviewSortCol = col;
            overviewSortAsc = true;
        }
        renderOverviewView();
    };

    // NEW: Trigger PDF export
    window.exportOverviewPdf = () => {
        const comp = getGlobalState('currentCompetition') || {}; // Should be passed in or grabbed
        generateOfficialsPdf('overview', comp, officials, assignments, locations, currentFilter);
    };

    // NEW: Trigger CSV export
    window.exportOverviewCsv = () => {
        const comp = getGlobalState('currentCompetition') || {};
        exportAssignmentsCsv(assignments, officials, locations, comp, currentFilter);
    };

    // Generate grouped Data
    const byLocation = {};

    // Init locations
    locations.forEach(l => {
        if (isVisible(l.type)) {
            byLocation[l.id] = { label: l.label, type: l.type, folks: [] };
        }
    });
    // Add 'General' bucket
    if (isVisible('general')) {
        byLocation['GENERAL'] = { label: 'Övergripande / Ingen plats', type: 'general', folks: [] };
    }

    assignments.forEach(a => {
        const key = a.locationId || 'GENERAL';
        // Only process if location is visible
        if (!byLocation[key]) return;

        const person = officials.find(o => o.id === a.officialId);

        byLocation[key].folks.push({
            pName: person ? person.name : '???',
            role: a.roleLabel,
            shift: a.startTime ? `${a.startTime}-${a.endTime}` : (a.shift !== 'all' ? a.shift : ''),
            startTime: a.startTime || '00:00',
            dateString: a.dateString || '', // Include date
            pPhone: person?.phone,
            locLabel: byLocation[key].label // For table sorting
        });
    });

    // Sort folks by startTime within each location (default for cards)
    Object.values(byLocation).forEach(loc => {
        loc.folks.sort((a, b) => a.startTime.localeCompare(b.startTime));
    });

    // Render HTML cards helper - Improved Layout
    const renderCard = (locData) => `
        <div class="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg p-4 break-inside-avoid mb-4 shadow-md bg-opacity-90">
            <h4 class="font-bold text-gray-900 dark:text-white border-b dark:border-gray-700 pb-2 mb-3 flex justify-between items-center text-lg">
                ${locData.label}
            </h4>
            ${locData.folks.length > 0 ? `
                <div class="space-y-4">
                    ${locData.folks.map(f => `
                        <div class="border-b dark:border-gray-700 last:border-0 pb-3 last:pb-0">
                            <div class="flex justify-between items-start mb-1">
                                <span class="font-bold text-gray-800 dark:text-gray-200 text-sm">${f.role}</span>
                                <div class="text-right">
                                    ${f.dateString ? `<div class="text-xs text-gray-500 dark:text-gray-400 font-mono mb-0.5">${f.dateString}</div>` : ''}
                                    ${f.shift ? `<span class="inline-block bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 text-xs font-bold px-2 py-1 rounded shadow-sm font-mono whitespace-nowrap">🕒 ${f.shift}</span>` : ''}
                                </div>
                            </div>
                            <div class="flex justify-between items-center text-sm mt-1">
                                <span class="text-gray-700 dark:text-gray-300 font-medium">${f.pName}</span>
                                ${f.pPhone ? `<a href="tel:${f.pPhone}" class="text-gray-400 dark:text-gray-500 text-xs hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-1">📞 ${f.pPhone}</a>` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            ` : `<p class="text-sm text-gray-400 italic bg-gray-50 dark:bg-gray-700/50 p-2 rounded text-center">Ingen tilldelad</p>`}
        </div>
    `;

    // Render Table Helper
    const renderTable = (allFolks) => {
        // Sort folks
        allFolks.sort((a, b) => {
            let valA = '', valB = '';
            switch (overviewSortCol) {
                case 'location': valA = a.locLabel || ''; valB = b.locLabel || ''; break;
                case 'role': valA = a.role || ''; valB = b.role || ''; break;
                case 'person': valA = a.pName || ''; valB = b.pName || ''; break;
                case 'date': valA = a.dateString || ''; valB = b.dateString || ''; break;
                case 'time': valA = a.startTime || ''; valB = b.startTime || ''; break;
            }
            if (valA < valB) return overviewSortAsc ? -1 : 1;
            if (valA > valB) return overviewSortAsc ? 1 : -1;
            return 0;
        });

        const sortIcon = (col) => overviewSortCol === col ? (overviewSortAsc ? '🔼' : '🔽') : '↕️';

        return `
            <div class="overflow-x-auto border dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 shadow-sm mt-4">
                <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                    <thead class="bg-gray-50 dark:bg-gray-700/50">
                        <tr>
                            <th class="px-4 py-3 text-left font-bold text-gray-700 dark:text-gray-200 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600" onclick="window.sortOverview('location')">Plats <span class="text-xs text-gray-400">${sortIcon('location')}</span></th>
                            <th class="px-4 py-3 text-left font-bold text-gray-700 dark:text-gray-200 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600" onclick="window.sortOverview('role')">Roll <span class="text-xs text-gray-400">${sortIcon('role')}</span></th>
                            <th class="px-4 py-3 text-left font-bold text-gray-700 dark:text-gray-200 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600" onclick="window.sortOverview('person')">Person <span class="text-xs text-gray-400">${sortIcon('person')}</span></th>
                            <th class="px-4 py-3 text-left font-bold text-gray-700 dark:text-gray-200 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600" onclick="window.sortOverview('date')">Datum <span class="text-xs text-gray-400">${sortIcon('date')}</span></th>
                            <th class="px-4 py-3 text-left font-bold text-gray-700 dark:text-gray-200 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600" onclick="window.sortOverview('time')">Tid <span class="text-xs text-gray-400">${sortIcon('time')}</span></th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-100 dark:divide-gray-700">
                        ${allFolks.map(f => `
                            <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                <td class="px-4 py-3 font-medium text-gray-900 dark:text-gray-200">${f.locLabel}</td>
                                <td class="px-4 py-3 text-gray-800 dark:text-gray-300">${f.role}</td>
                                <td class="px-4 py-3">
                                    <div class="font-medium dark:text-white">${f.pName}</div>
                                    ${f.pPhone ? `<div class="text-xs text-gray-400 dark:text-gray-500">${f.pPhone}</div>` : ''}
                                </td>
                                <td class="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">${f.dateString || '-'}</td>
                                <td class="px-4 py-3 text-gray-600 dark:text-gray-400 font-mono text-xs whitespace-nowrap">
                                    ${f.shift ? `<span class="bg-blue-50 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200 px-2 py-1 rounded">${f.shift}</span>` : '-'}
                                </td>
                            </tr>
                        `).join('')}
                         ${allFolks.length === 0 ? '<tr><td colspan="5" class="p-8 text-center text-gray-400 italic">Inga uppdrag matchar filtret.</td></tr>' : ''}
                    </tbody>
                </table>
            </div>
        `;
    };

    // Build the Grid HTML
    let gridHtml = '';
    const renderedIds = new Set();

    // 1. Obstacles (if visible)
    const visibleObstacles = locations.filter(l => l.type === 'obstacle' && byLocation[l.id]);
    if (visibleObstacles.length > 0) {
        gridHtml += `<h3 class="font-bold text-xl mb-4 mt-8 print:mt-4 col-span-full dark:text-white">Hinder</h3>`;
        visibleObstacles.forEach(l => {
            gridHtml += renderCard(byLocation[l.id]);
            renderedIds.add(l.id);
        });
    }

    // 2. Sections/Other (if visible)
    const visibleSections = locations.filter(l => l.type !== 'obstacle' && byLocation[l.id]);
    if (visibleSections.length > 0) {
        gridHtml += `<h3 class="font-bold text-xl mb-4 mt-8 col-span-full break-before-avoid dark:text-white">Tävlingsplatser</h3>`;
        visibleSections.forEach(l => {
            gridHtml += renderCard(byLocation[l.id]);
            renderedIds.add(l.id);
        });
    }

    // 3. General (if visible and not rendered)
    if (byLocation['GENERAL']) {
        gridHtml += `<h3 class="font-bold text-xl mb-4 mt-8 col-span-full break-before-avoid dark:text-white">Övriga Roller</h3>`;
        gridHtml += renderCard(byLocation['GENERAL']);
    }

    // Compose Final HTML
    let viewContent = '';
    if (overviewMode === 'table') {
        const allFolks = [];
        Object.values(byLocation).forEach(loc => {
            loc.folks.forEach(f => {
                allFolks.push({ ...f, locLabel: loc.label, locType: loc.type });
            });
        });
        viewContent = renderTable(allFolks);
    } else {
        viewContent = `
        <div class="columns-1 md:columns-2 lg:columns-3 gap-4 space-y-4 print:block print:columns-2 box-border">
            ${gridHtml || '<p class="text-gray-500 italic">Inga platser att visa för detta filter.</p>'}
        </div>
        `;
    }

    container.innerHTML = `
        <div class="flex justify-between items-center mb-4 flex-wrap gap-4">
            <div>
                <h3 class="text-lg font-bold">Funktionärsöversikt ${currentFilter !== 'all' ? `(${currentFilter})` : ''}</h3>
                <p class="text-sm text-gray-500">
                    ${overviewMode === 'cards' ? 'Utskriftsvänlig vy grupperad per plats.' : 'Tabellvy med sortering.'}
                </p>
            </div>
            
            <div class="flex gap-2 items-center">
                 <!-- View Toggle -->
                <div class="inline-flex rounded-md shadow-sm role='group' mr-4 print:hidden">
                    <button type="button" onclick="window.toggleOverviewMode('cards')" class="px-3 py-1.5 text-sm font-medium border border-gray-300 rounded-l-lg ${overviewMode === 'cards' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 hover:bg-gray-50'}">
                        🗳️ Kort
                    </button>
                    <button type="button" onclick="window.toggleOverviewMode('table')" class="px-3 py-1.5 text-sm font-medium border border-gray-300 rounded-r-lg ${overviewMode === 'table' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 hover:bg-gray-50'}">
                        📄 Tabell
                    </button>
                </div>

                <button onclick="window.exportOverviewCsv()" class="bg-white border-gray-300 text-gray-700 border px-4 py-2 rounded flex items-center gap-2 hover:bg-gray-50 print:hidden mr-2 text-sm">
                   📂 CSV
                </button>
                <button onclick="window.exportOverviewPdf()" class="bg-gray-800 text-white px-4 py-2 rounded flex items-center gap-2 hover:bg-gray-700 print:hidden text-sm">
                    📄 Skriv ut PDF
                </button>
            </div>
        </div>
        ${filterHtml}
        ${viewContent}
        <style>
            @media print {
                body * { visibility: hidden; }
                #page-admin, #page-admin * { visibility: visible; }
                /* Hide sidebar and navigation */
                nav, aside, .lg\\:col-span-1 { display: none !important; }
                /* Expand content */
                .lg\\:col-span-3 { width: 100% !important; margin: 0 !important; padding: 0 !important; border: none !important; box-shadow: none !important; }
                /* Hide filter buttons */
                .print\\:hidden { display: none !important; }
                /* Reset columns for print */
                .columns-1, .columns-2, .columns-3 { column-count: 2 !important; }
                /* Fix absolute positioning issue from previous css */
                .print-official-list { position: static !important; }
                 /* Ensure main container is visible */
                #officialsOverview { visibility: visible !important; position: absolute; top: 0; left: 0; width: 100%; padding: 20px; }
            }
        </style>
    `;
}

function renderSignupsView(competition) {
    if (volunteerSignups.length === 0) {
        return `
            <div class="text-center py-10 bg-gray-50 rounded border border-dashed border-gray-300">
                <p class="text-gray-500 font-medium">Inga nya anmälningar just nu</p>
                <p class="text-xs text-gray-400 mt-1">Dela länken <span class="font-mono bg-gray-100 p-1 rounded">/volunteer-signup.html?id=${competition?.id || 'ID'}</span></p>
            </div>
        `;
    }

    return `
        <div class="space-y-6">
            <h3 class="text-lg font-bold text-gray-800">Inkomna anmälningar (${volunteerSignups.length})</h3>
            <div class="grid grid-cols-1 gap-4">
                ${volunteerSignups.map(signup => `
                    <div class="bg-white border rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow">
                        <div class="flex justify-between items-start">
                            <div>
                                <h4 class="font-bold text-lg">${signup.name}</h4>
                                <div class="text-sm text-gray-600 flex gap-4 mt-1">
                                    <span>📞 ${signup.phone}</span>
                                    <span>📧 <a href="mailto:${signup.email}" class="text-blue-600 hover:underline">${signup.email}</a></span>
                                    <span>🏠 ${signup.club || '-'}</span>
                                </div>
                                <div class="mt-2 text-sm bg-blue-50 p-2 rounded inline-block text-blue-800 font-medium">
                                    Önskar: ${signup.role || 'Inget specifikt'}
                                </div>
                                ${signup.notes ? `<div class="mt-2 text-sm text-gray-700 italic">"${signup.notes}"</div>` : ''}
                                
                                <div class="mt-3 grid grid-cols-2 gap-x-8 gap-y-1 text-xs text-gray-500">
                                    <div><span class="font-bold">ICE:</span> ${signup.iceName} (${signup.icePhone})</div>
                                    <div><span class="font-bold">Kost:</span> ${signup.diet || '-'}</div>
                                    <div><span class="font-bold">Tröja:</span> ${signup.shirtSize || '-'}</div>
                                </div>
                            </div>
                            <div class="flex flex-col gap-2">
                                <button data-approve-signup="${signup.id}" class="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 font-bold whitespace-nowrap">
                                    ✅ Granska & Godkänn
                                </button>
                                <button data-reject-signup="${signup.id}" class="px-3 py-1 bg-red-100 text-red-700 rounded text-sm hover:bg-red-200 whitespace-nowrap">
                                    🗑️ Ta bort
                                </button>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

// --- LOGIC BINDING ---

function bindContentEvents(container, competition) {
    if (currentSubTab === 'people') {
        const btnAdd = container.querySelector('#btnAddOfficial');
        const form = container.querySelector('#addOfficialForm');
        const btnCancel = container.querySelector('#btnCancelNewOfficial');
        const btnSave = container.querySelector('#btnSaveNewOfficial');

        // CSV Import Setup
        setupCsvImport(container, competition);

        if (btnAdd) btnAdd.onclick = () => {
            container.querySelector('#editOfficialId').value = '';
            container.querySelector('#formTitle').textContent = 'Ny Funktionär';
            container.querySelector('#btnSaveNewOfficial').textContent = 'Spara';
            form.classList.remove('hidden');
        };
        if (btnCancel) btnCancel.onclick = () => {
            container.querySelector('#editOfficialId').value = '';
            // Clear inputs
            container.querySelector('#newOffName').value = '';
            container.querySelector('#newOffEmail').value = '';
            container.querySelector('#newOffPhone').value = '';
            container.querySelector('#newOffClub').value = '';
            container.querySelector('#newOffNotes').value = '';
            form.classList.add('hidden');
        };
    }

    const btnSave = container.querySelector('#btnSaveNewOfficial'); // Re-query btnSave outside the if block
    if (btnSave) btnSave.onclick = async () => {
        const name = container.querySelector('#newOffName').value;
        const id = container.querySelector('#editOfficialId').value;
        const signupId = container.querySelector('#linkSignupId').value; // Check linked signup

        if (!name) return showAlert('Ange namn!', 'error');

        const newOff = {
            id: id || null,
            name,
            email: container.querySelector('#newOffEmail').value,
            phone: container.querySelector('#newOffPhone').value,
            club: container.querySelector('#newOffClub').value,
            notes: container.querySelector('#newOffNotes').value,
            // New Fields
            iceName: container.querySelector('#newOffIceName').value,
            icePhone: container.querySelector('#newOffIcePhone').value,
            diet: container.querySelector('#newOffDiet').value,
            shirtSize: container.querySelector('#newOffShirt').value,
        };

        if (signupId) {
            // Determine logic: Approved from signup
            await approveVolunteer(competition.id, signupId, newOff);
            showAlert('Anmälan godkänd & person sparad', 'success');
        } else {
            await saveOfficial(competition.id, newOff);
            showAlert('Person sparad', 'success');
        }

        // Reset and close
        container.querySelector('#newOffName').value = '';
        container.querySelector('#newOffEmail').value = '';
        container.querySelector('#newOffPhone').value = '';
        container.querySelector('#newOffClub').value = '';
        container.querySelector('#newOffNotes').value = '';
        container.querySelector('#newOffIceName').value = '';
        container.querySelector('#newOffIcePhone').value = '';
        container.querySelector('#newOffDiet').value = '';
        container.querySelector('#newOffShirt').value = '';

        container.querySelector('#editOfficialId').value = '';
        container.querySelector('#linkSignupId').value = '';
        const form = container.querySelector('#addOfficialForm'); // Re-query form
        if (form) form.classList.add('hidden'); // Check if form exists before trying to hide it
    };

    // Edit buttons
    container.querySelectorAll('[data-edit-official]').forEach(btn => {
        btn.onclick = (e) => {
            const id = e.target.dataset.editOfficial;
            const person = officials.find(p => p.id === id);
            if (person) {
                container.querySelector('#editOfficialId').value = person.id;
                container.querySelector('#newOffName').value = person.name || '';
                container.querySelector('#newOffEmail').value = person.email || '';
                container.querySelector('#newOffPhone').value = person.phone || '';
                container.querySelector('#newOffClub').value = person.club || '';
                container.querySelector('#newOffClub').value = person.club || '';
                container.querySelector('#newOffNotes').value = person.notes || '';

                container.querySelector('#newOffIceName').value = person.iceName || '';
                container.querySelector('#newOffIcePhone').value = person.icePhone || '';
                container.querySelector('#newOffDiet').value = person.diet || '';
                container.querySelector('#newOffShirt').value = person.shirtSize || '';

                container.querySelector('#formTitle').textContent = 'Redigera Funktionär';
                container.querySelector('#btnSaveNewOfficial').textContent = 'Uppdatera';
                const form = container.querySelector('#addOfficialForm');
                form.classList.remove('hidden');
                form.scrollIntoView({ behavior: 'smooth' });
            }
        };
    });

    // Delete buttons
    container.querySelectorAll('[data-delete-official]').forEach(btn => {
        btn.onclick = async (e) => {
            if (confirm('Ta bort person?')) {
                await deleteOfficial(competition.id, e.target.dataset.deleteOfficial);
            }
        };
    });

    if (currentSubTab === 'assign') {
        const selDiscipline = container.querySelector('#assignDiscipline');
        const selLocation = container.querySelector('#assignLocation');
        const manualLocContainer = container.querySelector('#manualLocationContainer');
        const manualLocInput = container.querySelector('#manualLocationName');
        const assignRole = container.querySelector('#assignRole');
        const manualRoleContainer = container.querySelector('#manualRoleContainer');
        const manualRoleInput = container.querySelector('#manualRoleName');

        const updateLocationSelect = () => {
            const disc = selDiscipline.value;
            let filtered = locations;

            if (disc === 'marathon') {
                filtered = locations.filter(l => l.type === 'obstacle' || l.type.includes('_m') || l.type === 'section');
            } else if (disc === 'dressage') {
                filtered = locations.filter(l => l.type === 'dressage_func' || l.type === 'court' || l.type.includes('_d'));
            } else if (disc === 'precision') {
                filtered = locations.filter(l => l.type.includes('_p') || l.type === 'course_p');
            }

            selLocation.innerHTML = `<option value="">-- Välj plats --</option>`;
            filtered.forEach(l => {
                selLocation.innerHTML += `<option value="${l.id}">${l.label}</option>`;
            });
            selLocation.innerHTML += `<option value="MANUAL_ENTRY" class="font-bold text-blue-600">+ Lägg till ny plats...</option>`;
            manualLocContainer.classList.add('hidden');
        };

        if (selDiscipline) {
            selDiscipline.addEventListener('change', updateLocationSelect);
            updateLocationSelect(); // Run once
        }

        if (selLocation) {
            selLocation.addEventListener('change', () => {
                if (selLocation.value === 'MANUAL_ENTRY') {
                    manualLocContainer.classList.remove('hidden');
                    manualLocInput.focus();
                } else {
                    manualLocContainer.classList.add('hidden');
                }
            });
        }

        if (assignRole) {
            assignRole.addEventListener('change', () => {
                if (assignRole.value === 'MANUAL_ROLE') {
                    manualRoleContainer.classList.remove('hidden');
                    manualRoleInput.focus();
                } else {
                    manualRoleContainer.classList.add('hidden');
                }
            });
        }

        const btnSave = container.querySelector('#btnSaveAssignment');
        if (btnSave) btnSave.onclick = async () => {
            const officialId = container.querySelector('#assignOfficial').value;
            let role = assignRole.value;
            let locationId = selLocation.value;
            const startTime = container.querySelector('#assignStartTime').value;
            const endTime = container.querySelector('#assignEndTime').value;
            const dateString = container.querySelector('#assignDate').value;
            const discipline = selDiscipline.value;

            // Manual Role Logic
            if (role === 'MANUAL_ROLE') {
                role = manualRoleInput.value.trim();
                if (!role) return showAlert('Ange namn på den nya rollen!', 'error');

                // Save if not exists
                if (!customRoles.includes(role)) {
                    const defaultRoles = [
                        'Hinderchef', 'Tidtagare (Start/Mål)', 'Tidtagare (Hinder)',
                        'Observatör', 'Protokollskrivare', 'Domare', 'Veterinär',
                        'Sekretariat', 'Speaker', 'Säkerhetschef', 'Banbyggare'
                    ];
                    // Verify it's not a default role either
                    if (!defaultRoles.includes(role)) {
                        customRoles.push(role);
                        await saveRoles(competition.id, customRoles);
                    }
                }
            }

            if (!officialId || !role) return showAlert('Välj person och roll!', 'error');

            // Persist date
            if (dateString) lastSelectedDate = dateString;

            // Handle Manual Location
            if (locationId === 'MANUAL_ENTRY') {
                const newLabel = manualLocInput.value.trim();
                if (!newLabel) return showAlert('Ange namn på den nya platsen!', 'error');

                const newId = 'CUSTOM_' + Date.now();
                let newType = 'general';
                if (discipline === 'marathon') newType = 'section_m_custom';
                else if (discipline === 'dressage') newType = 'dressage_func';
                else if (discipline === 'precision') newType = 'course_p_custom';

                const newLoc = { id: newId, label: newLabel, type: newType, isCustom: true };
                locations.push(newLoc);
                await saveLocations(competition.id, locations);
                locationId = newId;
            }

            const locObj = locations.find(l => l.id === locationId);

            const assignment = {
                officialId,
                role,
                locationId: locationId || null,
                locationType: locObj ? locObj.type : 'general',
                locationLabel: locObj ? locObj.label : null,
                shift: startTime ? `${startTime} -${endTime} ` : 'all',
                startTime,
                endTime,
                dateString,
                discipline
            };

            await saveAssignment(competition.id, assignment);
            showAlert('Tilldelning sparad', 'success');

            // Reset simplified
            manualLocInput.value = '';
            manualRoleInput.value = '';
            assignRole.value = '';
            selLocation.value = '';
            // updateLocationSelect(); 
        };

        container.querySelectorAll('[data-delete-assignment]').forEach(btn => {
            btn.onclick = async (e) => {
                if (confirm('Ta bort uppdrag?')) {
                    await deleteAssignment(competition.id, e.target.dataset.deleteAssignment);
                }
            };
        });
    }
    if (currentSubTab === 'signups') {
        container.querySelectorAll('[data-approve-signup]').forEach(btn => {
            btn.onclick = (e) => {
                const sId = e.target.dataset.approveSignup;
                const signup = volunteerSignups.find(s => s.id === sId);
                if (!signup) return;

                // Open modal "People" style manually
                // We need to switch tab context visually or just open the modal on top?
                // Easiest: Just use the modal logic. But the modal lives in 'people' view.
                // Re-render to People view, then open modal with data? That's clunky.
                // Better: Just inject the Modal HTML here if needed, OR force switch to People tab + Open Modal.

                // Let's force switch to People tab and trigger the flow.
                currentSubTab = 'people';
                refreshUI(container, competition);

                // After refresh, the DOM is new. We must find the elements again.
                // We can use a timeout, or better, pass "pendingAction" state.
                // But for now, let's just hack it:
                setTimeout(() => {
                    const form = container.querySelector('#addOfficialForm');
                    if (form) {
                        form.classList.remove('hidden');
                        container.querySelector('#formTitle').textContent = 'Godkänn Anmälan (Redigera vid behov)';
                        container.querySelector('#btnSaveNewOfficial').textContent = 'Godkänn & Spara';

                        // Fill data
                        container.querySelector('#newOffName').value = signup.name || '';
                        container.querySelector('#newOffEmail').value = signup.email || '';
                        container.querySelector('#newOffPhone').value = signup.phone || '';
                        container.querySelector('#newOffClub').value = signup.club || '';
                        container.querySelector('#newOffNotes').value = signup.notes || ''; // Add role preference here?
                        if (signup.role) {
                            container.querySelector('#newOffNotes').value += (container.querySelector('#newOffNotes').value ? `. Önskar: ${signup.role}` : `Önskar: ${signup.role}`);
                        }

                        container.querySelector('#newOffIceName').value = signup.iceName || '';
                        container.querySelector('#newOffIcePhone').value = signup.icePhone || '';
                        container.querySelector('#newOffDiet').value = signup.diet || '';
                        container.querySelector('#newOffShirt').value = signup.shirtSize || '';

                        container.querySelector('#editOfficialId').value = ''; // New ID will be gen
                        container.querySelector('#linkSignupId').value = signup.id; // Correctly link

                        form.scrollIntoView({ behavior: 'smooth' });
                    }
                }, 50);
            };
        });

        container.querySelectorAll('[data-reject-signup]').forEach(btn => {
            btn.onclick = async (e) => {
                if (confirm('Vill du ta bort denna anmälan permanent?')) {
                    const sId = e.target.dataset.rejectSignup;
                    await rejectVolunteer(competition.id, sId);
                }
            };
        });
    }
    if (currentSubTab === 'checkin') {
        container.querySelectorAll('[data-toggle-checkin]').forEach(btn => {
            btn.onclick = (e) => {
                const id = e.currentTarget.dataset.toggleCheckin;
                const person = officials.find(p => p.id === id);
                if (!person) return;

                const updates = { isCheckedIn: !person.isCheckedIn };
                if (updates.isCheckedIn) {
                    updates.checkInTime = serverTimestamp();
                } else {
                    updates.checkInTime = null;
                }
                updateOfficialStatus(competition.id, id, updates);
            };
        });

        container.querySelectorAll('[data-toggle-vest]').forEach(btn => {
            btn.onclick = (e) => {
                const id = e.currentTarget.dataset.toggleVest;
                const person = officials.find(p => p.id === id);
                if (person) {
                    updateOfficialStatus(competition.id, id, { hasVest: !person.hasVest });
                }
            };
        });

        container.querySelectorAll('[data-toggle-radio]').forEach(btn => {
            btn.onclick = (e) => {
                const id = e.currentTarget.dataset.toggleRadio;
                const person = officials.find(p => p.id === id);
                if (person) {
                    updateOfficialStatus(competition.id, id, { hasRadio: !person.hasRadio });
                }
            };
        });
    }
}

// --- CSV IMPORT LOGIC ---

function setupCsvImport(container, competition) {
    const btnImport = container.querySelector('#btnImportCsv');
    const inputFn = container.querySelector('#csvImportInput');

    if (!btnImport || !inputFn) return;

    btnImport.onclick = () => inputFn.click();

    inputFn.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const result = parseCsvFriends(text);

            if (result.length === 0) {
                showAlert('Hittade inga giltiga rader i CSV-filen.', 'warning');
                return;
            }

            let importedCount = 0;
            for (const row of result) {
                // Skapa objekt
                const newOff = {
                    name: row.name || 'Okänd',
                    email: row.email || '',
                    phone: row.phone || '',
                    club: row.club || '',
                    notes: [row.role, row.notes].filter(Boolean).join('. ') || ''
                };

                // Om roll finns med i CSV, kanske vi vill använda den.
                // saveOfficial sparar "role" endast för simple list, men vi lägger den i notes också för säkerhets skull.
                // Om du vill spara rollen "på riktigt" i official-objektet för framtida bruk:
                if (row.role) newOff.role = row.role;

                await saveOfficial(competition.id, newOff);
                importedCount++;
            }

            showAlert(`Importerade ${importedCount} funktionärer!`, 'success');
            inputFn.value = ''; // Reset
        } catch (err) {
            console.error(err);
            showAlert('Kunde inte importera filen: ' + err.message, 'error');
        }
    };
}

function parseCsvFriends(csvText) {
    // Enkel CSV-parser som hanterar grundläggande "citat"
    const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length < 2) return [];

    // Hitta headers och normalisera dem
    const rawHeaders = lines[0].split((/,|;/)).map(h => h.trim().toLowerCase().replace(/["']/g, '')); // Hanterar både , och ;
    const headers = minimizeHeaders(rawHeaders);

    const data = [];

    // Loopa rader
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        // Enkel split på separator (detta är inte 100% robust för citat med separator i, men funkar för enkla listor)
        // Försöker gissa separator baserat på första raden eller default ','
        const separator = lines[0].includes(';') ? ';' : ',';
        const cols = line.split(separator).map(c => c.trim().replace(/^["']|["']$/g, ''));

        const rowObj = {};
        headers.forEach((h, idx) => {
            if (cols[idx]) rowObj[h] = cols[idx];
        });

        if (rowObj.name) {
            data.push(rowObj);
        }
    }
    return data;
}

function minimizeHeaders(headerList) {
    // Mappar CSV-rubriker till våra interna fältnamn
    return headerList.map(h => {
        if (h.includes('namn') || h.includes('name')) return 'name';
        if (h.includes('tel') || h.includes('mobil') || h.includes('phone')) return 'phone';
        if (h.includes('mail') || h.includes('e-post')) return 'email';
        if (h.includes('klubb') || h.includes('club') || h.includes('förening')) return 'club';
        if (h.includes('notan') || h.includes('roll') || h.includes('uppdrag') || h.includes('role') || h.includes('befattning') || h.includes('funktion') || h.includes('titel')) return 'role';
        if (h.includes('kommentar') || h.includes('notering')) return 'notes';
        return 'ignore';
    });
}

// --- REPORTS VIEW ---

function renderReportsView(competition) {
    if (officials.length === 0) {
        return `<div class="p-8 text-center text-gray-500">Lägg till funktionärer först för att skapa rapporter.</div>`;
    }

    setTimeout(() => {
        const container = document.getElementById('reportsContainer');
        if (!container) return;

        // PDF Buttons
        container.querySelectorAll('[data-report-type]').forEach(btn => {
            btn.onclick = () => {
                const type = btn.dataset.reportType;
                generateOfficialsPdf(type, competition, officials);
            };
        });

        // CSV Export
        const btnCsv = container.querySelector('#btnExportCsv');
        if (btnCsv) {
            btnCsv.onclick = () => {
                exportOfficialsCsv(officials, competition);
            };
        }
    }, 50);

    return `
        <div id="reportsContainer" class="space-y-8">
            <div class="flex justify-between items-center mb-6">
                 <div>
                    <h3 class="text-xl font-bold">Rapporter & Utskrifter</h3>
                    <p class="text-sm text-gray-500">Skapa PDF-listor eller exportera till Excel.</p>
                 </div>
                 <button id="btnExportCsv" class="px-4 py-2 bg-gray-100 text-gray-700 border rounded hover:bg-gray-200 flex items-center gap-2">
                    📊 Exportera allt till CSV
                 </button>
            </div>
            
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <!-- Phone List -->
                <div class="bg-white border rounded-lg p-6 hover:shadow-md transition-shadow flex flex-col items-center text-center">
                    <div class="text-4xl mb-4">📒</div>
                    <h4 class="font-bold text-lg mb-2">Telefonlista</h4>
                    <p class="text-gray-600 text-sm mb-6 flex-grow">"Lilla Gula". Kompakt lista med namn, roll och telefonnummer.</p>
                    <button data-report-type="phone" class="w-full py-2 bg-yellow-100 text-yellow-800 font-bold rounded border border-yellow-200 hover:bg-yellow-200 transition-colors">
                        🖨️ Skriv ut PDF
                    </button>
                </div>

                <!-- Catering -->
                <div class="bg-white border rounded-lg p-6 hover:shadow-md transition-shadow flex flex-col items-center text-center">
                    <div class="text-4xl mb-4">🍽️</div>
                    <h4 class="font-bold text-lg mb-2">Catering & Kost</h4>
                    <p class="text-gray-600 text-sm mb-6 flex-grow">Sammanställning av antal portioner och lista på allergier.</p>
                    <button data-report-type="catering" class="w-full py-2 bg-green-100 text-green-800 font-bold rounded border border-green-200 hover:bg-green-200 transition-colors">
                        🖨️ Skriv ut PDF
                    </button>
                </div>

                <!-- Check-in -->
                <div class="bg-white border rounded-lg p-6 hover:shadow-md transition-shadow flex flex-col items-center text-center">
                    <div class="text-4xl mb-4">✅</div>
                    <h4 class="font-bold text-lg mb-2">Incheckningslista</h4>
                    <p class="text-gray-600 text-sm mb-6 flex-grow">För sekretariatet. Avprickning, västutdelning och radio.</p>
                    <button data-report-type="checkin" class="w-full py-2 bg-blue-100 text-blue-800 font-bold rounded border border-blue-200 hover:bg-blue-200 transition-colors">
                        🖨️ Skriv ut PDF
                    </button>
                </div>
            </div>
        </div>
    `;
}
