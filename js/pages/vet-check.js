import { getGlobalState } from '../main.js';
import { listenForEquipages, saveEquipage } from '../services/firestoreService.js';
import { getCompetitionHeader, showAlert } from '../ui/components.js';

let competitionId = null;
let allEquipages = [];
let filteredEquipages = [];
let unsubscribe = null;
let currentIndex = 0; // Index in the filtered list
let currentSearchTerm = '';

// Status colors/labels for Vet View
const statusConfig = {
    'anmäld': { label: 'Väntar', color: 'bg-gray-100 text-gray-700', border: 'border-gray-200' },
    'incheckad': { label: 'Väntar (Incheckad)', color: 'bg-blue-50 text-blue-700', border: 'border-blue-200' },
    'besiktigad': { label: 'Godkänd', color: 'bg-green-100 text-green-800', border: 'border-green-300' },
    'ombesiktning': { label: 'Ombesiktning', color: 'bg-yellow-100 text-yellow-800', border: 'border-yellow-300' },
    'struken': { label: 'Struken/Ej Godkänd', color: 'bg-red-100 text-red-800', border: 'border-red-300' }
};

export function load() {
    const competition = getGlobalState('currentCompetition');
    const pageContainer = document.getElementById('page-vet-check');

    if (!competition) {
        if (pageContainer) pageContainer.innerHTML = `<p class="p-8 text-center text-red-500">Ingen tävling vald.</p>`;
        return;
    }
    competitionId = competition.id;

    // Render skeleton
    pageContainer.innerHTML = `
        <div class="container mx-auto p-4 max-w-3xl">
            ${getCompetitionHeader(competition, 'Veterinärbesiktning')}
            
            <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden min-h-[600px] flex flex-col">
                <!-- Header with Search and Navigation -->
                <div class="p-4 bg-gray-50 border-b z-30 shadow-sm space-y-3">
                    <div class="flex justify-between items-center">
                        <h2 class="text-xl font-bold text-gray-800">Besiktning</h2>
                        <div class="text-sm font-medium text-gray-500" id="vet-queue-count">Laddar...</div>
                    </div>
                    
                    <div class="flex gap-2 items-center">
                        <button id="btn-prev-eq" class="px-4 py-2 bg-white border rounded hover:bg-gray-100 text-gray-700 disabled:opacity-50 font-bold text-lg" title="Föregående">
                            ⬅️
                        </button>
                        
                        <div class="relative flex-1">
                            <input type="text" id="vet-search" placeholder="Sök startnr, namn..." 
                                class="w-full pl-3 pr-8 py-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                            <div class="absolute right-2 top-2 text-gray-400">🔍</div>
                        </div>
                        
                        <button id="btn-next-eq" class="px-4 py-2 bg-white border rounded hover:bg-gray-100 text-gray-700 disabled:opacity-50 font-bold text-lg" title="Nästa">
                            ➡️
                        </button>
                        
                        <div class="text-xs text-gray-500 font-mono w-16 text-center" id="index-indicator">- / -</div>
                    </div>
                </div>

                <!-- Single Card Container -->
                <div class="p-4 flex-1 bg-gray-100 flex items-start justify-center overflow-y-auto" id="vet-card-container">
                    <p class="text-center text-gray-400 py-12">Laddar ekipage...</p>
                </div>
            </div>
        </div>
    `;

    // Start Listener
    unsubscribe = listenForEquipages(competitionId, (update) => {
        allEquipages = update;
        processData(currentSearchTerm);
    });

    // Attach Listeners
    setTimeout(() => {
        const searchInput = document.getElementById('vet-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                currentSearchTerm = e.target.value.toLowerCase();
                currentIndex = 0; // Reset to start on search
                processData(currentSearchTerm);
            });
        }
        document.getElementById('btn-prev-eq')?.addEventListener('click', () => navigate(-1));
        document.getElementById('btn-next-eq')?.addEventListener('click', () => navigate(1));
    }, 100);
}

export function __unload() {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
}

function navigate(direction) {
    if (filteredEquipages.length === 0) return;

    let newIndex = currentIndex + direction;

    // Bounds check
    if (newIndex < 0) newIndex = 0;
    if (newIndex >= filteredEquipages.length) newIndex = filteredEquipages.length - 1;

    if (newIndex !== currentIndex) {
        currentIndex = newIndex;
        renderCard();
    }
}

function processData(searchTerm = '') {
    // 1. Filter
    let filtered = allEquipages.filter(eq => {
        if (!searchTerm) return true;
        const hay = [
            eq.startNumber,
            eq.driverName,
            eq.clubName,
            (eq.horses || []).map(h => h.name).join(' ')
        ].join(' ').toLowerCase();
        return hay.includes(searchTerm);
    });

    // 2. Sort (Prioritera 'ombesiktning', 'incheckad', 'anmäld')
    const priority = {
        'ombesiktning': 0,
        'incheckad': 1,
        'anmäld': 2,
        'besiktigad': 3,
        'struken': 4
    };

    filtered.sort((a, b) => {
        const sa = a.status || 'anmäld';
        const sb = b.status || 'anmäld';
        if (priority[sa] !== priority[sb]) return priority[sa] - priority[sb];
        return a.startNumber - b.startNumber;
    });

    filteredEquipages = filtered;

    // Update queue count
    const countEl = document.getElementById('vet-queue-count');
    const remaining = allEquipages.filter(e => !['besiktigad', 'struken'].includes(e.status || 'anmäld')).length;
    if (countEl) countEl.textContent = `${remaining} kvar`;

    renderCard();
}

function renderCard() {
    const container = document.getElementById('vet-card-container');
    const indexInd = document.getElementById('index-indicator');
    const prevBtn = document.getElementById('btn-prev-eq');
    const nextBtn = document.getElementById('btn-next-eq');

    if (!container) return;

    if (filteredEquipages.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-500 mt-12 bg-white p-8 rounded shadow">Inga ekipage matchar sökningen.</div>`;
        if (indexInd) indexInd.textContent = "0 / 0";
        return;
    }

    // Ensure index is valid
    if (currentIndex >= filteredEquipages.length) currentIndex = filteredEquipages.length - 1;
    if (currentIndex < 0) currentIndex = 0;

    // Update UI Controls
    if (indexInd) indexInd.textContent = `${currentIndex + 1} / ${filteredEquipages.length}`;
    if (prevBtn) prevBtn.disabled = currentIndex === 0;
    if (nextBtn) nextBtn.disabled = currentIndex === filteredEquipages.length - 1;

    const eq = filteredEquipages[currentIndex];
    const status = eq.status || 'anmäld';
    const conf = statusConfig[status] || statusConfig['anmäld'];

    // Horses Section
    const horses = eq.horses || [];
    const horsesHtml = horses.map(h => {
        const ids = [];
        if (h.chipNumber) ids.push(`Chip: ${h.chipNumber}`);
        if (h.chip) ids.push(`Chip: ${h.chip}`);
        if (h.uid) ids.push(`UID: ${h.uid}`);
        if (h.id) ids.push(`ID: ${h.id}`);
        if (h.lic) ids.push(`Lic: ${h.lic}`);

        const uniqueIds = [...new Set(ids)];
        const idString = uniqueIds.length > 0 ? uniqueIds.join(' • ') : '<span class="text-red-400 italic">ID/Chip saknas</span>';

        return `
        <div class="flex flex-col sm:flex-row sm:items-center justify-between bg-gray-50 border border-gray-200 rounded p-3 text-sm mt-2">
            <div>
                <span class="font-bold text-gray-900 text-lg">${h.name || '-'}</span>
                <div class="text-sm text-gray-700 font-mono mt-0.5 select-all bg-white inline-block px-1 rounded border border-gray-200">${idString}</div>
            </div>
            <div class="text-xs text-gray-500 whitespace-nowrap ml-2 mt-1 sm:mt-0">
                    ${h.age ? `${h.age} år` : ''} ${h.gender ? `(${h.gender})` : ''}
            </div>
        </div>
        `;
    }).join('');

    const isProcessable = ['anmäld', 'incheckad', 'ombesiktning'].includes(status);
    const cardOpacity = !isProcessable ? 'opacity-80' : '';
    const statusClass = !isProcessable ? 'grayscale' : '';

    container.innerHTML = `
        <div class="w-full max-w-2xl bg-white rounded-xl shadow-lg border border-gray-200 p-6 ${cardOpacity} transition-all relative">
            
            <div class="absolute top-0 right-0 p-4">
                 <span class="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide border ${conf.border} ${conf.color}">${conf.label}</span>
            </div>

            <div class="mb-6 pr-8">
                <div class="flex items-baseline gap-3 mb-1">
                    <span class="text-4xl font-black text-gray-900">#${eq.startNumber}</span>
                </div>
                <h2 class="text-2xl font-bold text-gray-800 leading-tight">${eq.driverName}</h2>
                <div class="text-sm text-gray-500 mt-1 font-medium">${eq.clubName} • ${eq.className}</div>
            </div>

            <div class="mb-6">
                <div class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Hästar & Identitet</div>
                <div class="space-y-1">
                ${horsesHtml || '<div class="p-4 bg-gray-50 rounded border border-gray-200 text-gray-500 italic text-center">Inga hästar registrerade</div>'}
                </div>
            </div>
            
            <div class="mb-6 relative group">
                 <label class="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Veterinärnotering</label>
                 <textarea class="w-full text-base border-gray-300 rounded-lg p-3 vet-notes focus:ring-2 focus:ring-blue-100 transition-shadow min-h-[80px]"
                    placeholder="Skriv notering här (t.ex. 'Ojämn gång vänster bak')..." 
                    data-sn="${eq.startNumber}">${eq.vetNotes || ''}</textarea>
                 <div class="absolute right-3 bottom-3">
                    <button class="text-xs bg-brand-darkblue text-white px-3 py-1.5 rounded hover:bg-opacity-90 save-notes-btn hidden shadow-sm" data-sn="${eq.startNumber}">Spara</button>
                 </div>
            </div>

            <div class="grid grid-cols-2 gap-4 pt-4 border-t border-gray-100 ${statusClass}">
                <button class="bg-green-600 text-white font-bold py-4 px-4 rounded-xl shadow-md active:scale-[0.98] transition-all hover:bg-green-700 hover:shadow-lg flex items-center justify-center gap-2 group"
                    onclick="window.setVetStatus('${eq.startNumber}', 'besiktigad')">
                    <span class="text-2xl group-hover:scale-110 transition-transform">✅</span> 
                    <span class="text-lg tracking-wide">GODKÄND</span>
                </button>
                <button class="bg-yellow-500 text-white font-bold py-4 px-4 rounded-xl shadow-md active:scale-[0.98] transition-all hover:bg-yellow-600 hover:shadow-lg flex items-center justify-center gap-2 group"
                    onclick="window.setVetStatus('${eq.startNumber}', 'ombesiktning')">
                    <span class="text-2xl group-hover:scale-110 transition-transform">🖐️</span> 
                    <span class="text-lg tracking-wide">HÅLL</span>
                </button>
            </div>
             ${isProcessable ? `
            <div class="mt-4 flex justify-center">
                 <button class="text-xs text-red-600 hover:text-red-800 hover:underline flex items-center gap-1 opacity-60 hover:opacity-100 transition-opacity"
                    onclick="window.setVetStatus('${eq.startNumber}', 'struken')">
                    🛑 Stryk ekipage (Ej godkänd)
                </button>
            </div>` : ''}
        </div>
    `;

    // Reupdatera index-indicator om HTML nollställdes
    // (gjordes ovan, men för säkerhets skull)

    // Attach Note Listener (only one card now, easier)
    const textArea = container.querySelector('.vet-notes');
    const saveBtn = container.querySelector('.save-notes-btn');
    if (textArea && saveBtn) {
        textArea.addEventListener('input', () => saveBtn.classList.remove('hidden'));
        saveBtn.addEventListener('click', async () => {
            const note = textArea.value;
            try {
                await saveEquipage(competitionId, eq.startNumber, { vetNotes: note });
                saveBtn.innerText = 'Sparad!';
                setTimeout(() => {
                    saveBtn.innerText = 'Spara';
                    saveBtn.classList.add('hidden');
                }, 1500);
            } catch (err) {
                console.error(err);
                showAlert('Fel vid sparning', false);
            }
        });
    }
}

// Global helper for the onclick handlers in HTML string
window.setVetStatus = async (startNumber, status) => {
    if (!competitionId) return;

    // If setting to 'struken', maybe confirm?
    if (status === 'struken') {
        if (!confirm(`Är du säker på att ekipage #${startNumber} ska strykas (EJ GODKÄND)?`)) return;
    }

    try {
        await saveEquipage(competitionId, startNumber, { status: status });
        showAlert(`Ekipage #${startNumber}: ${status.toUpperCase()}`);
    } catch (err) {
        console.error('Vet update failed', err);
        showAlert('Kunde inte uppdatera status', false);
    }
};
