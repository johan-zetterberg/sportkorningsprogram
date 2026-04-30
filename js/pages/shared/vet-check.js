import { getGlobalState } from '../../main.js';
import { listenForEquipages } from '../../services/equipageService.js';
import { saveEquipage } from '../../services/equipageService.js';
import { getCompetitionHeader, showAlert } from '../../ui/components.js';

let competitionId = null;
let allEquipages = [];
let filteredEquipages = [];
let unsubscribe = null;
let currentIndex = 0; // Index in the filtered list
let currentSearchTerm = '';

// Status colors/labels for Vet View
const statusConfig = {
    'anmäld': { label: 'Väntar', color: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300', border: 'border-gray-200 dark:border-gray-600' },
    'incheckad': { label: 'Väntar (Incheckad)', color: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200', border: 'border-blue-200 dark:border-blue-800' },
    'besiktigad': { label: 'Godkänd', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200', border: 'border-green-300 dark:border-green-700' },
    'ombesiktning': { label: 'Ombesiktning', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200', border: 'border-yellow-300 dark:border-yellow-700' },
    'struken': { label: 'Struken/Ej Godkänd', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200', border: 'border-red-300 dark:border-red-700' }
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
        <style>
            @media (max-width: 640px) {
                #page-vet-check .container { padding: 0.5rem; }
                .vet-card { padding: 1rem !important; }
                .vet-sticky-header {
                    top: 63px;
                    margin-left: -0.5rem;
                    margin-right: -0.5rem;
                    padding: 0.75rem !important;
                }
                .horse-id-grid { font-size: 11px !important; }
            }
        </style>

        <div class="container mx-auto p-4 md:p-8 max-w-3xl">
            ${getCompetitionHeader(competition, 'Veterinärbesiktning')}
            
            <div class="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col h-[85vh]">
                <!-- Fixed Header -->
                <div class="vet-header shrink-0 p-4 bg-white dark:bg-gray-900 border-b dark:border-gray-700 z-30 shadow-sm space-y-4">
                    <div class="flex justify-between items-center">
                        <h2 class="text-lg font-black text-gray-800 dark:text-white uppercase tracking-tighter">Besiktning</h2>
                        <div class="text-[10px] font-bold uppercase text-blue-600 dark:text-blue-400" id="vet-queue-count">Laddar...</div>
                    </div>
                    
                    <div class="flex gap-2 items-center">
                        <button id="btn-prev-eq" class="w-10 h-10 flex items-center justify-center bg-gray-50 dark:bg-gray-800 border dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-30 transition-all font-bold" title="Föregående">
                            ⟨
                        </button>
                        
                        <div class="relative flex-1">
                            <input type="text" id="vet-search" list="vet-search-list" placeholder="Sök ekipage..." 
                                class="w-full pl-3 pr-8 py-2.5 border rounded-lg text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400 transition-all">
                            <datalist id="vet-search-list"></datalist>
                            <div class="absolute right-3 top-3 text-gray-400 text-xs">🔍</div>
                        </div>
                        
                        <button id="btn-next-eq" class="w-10 h-10 flex items-center justify-center bg-gray-50 dark:bg-gray-800 border dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-30 transition-all font-bold" title="Nästa">
                            ⟩
                        </button>
                    </div>

                    <div class="flex justify-center pb-1">
                        <div class="text-[10px] font-black uppercase text-gray-400 tracking-widest bg-gray-50 dark:bg-gray-800 px-3 py-1 rounded-full border dark:border-gray-700" id="index-indicator">- / -</div>
                    </div>
                </div>

                <!-- Scrollable Content -->
                <div class="flex-1 bg-gray-100 dark:bg-gray-950 overflow-y-auto p-4 pt-6 pb-20 flex flex-col items-center" id="vet-card-container">
                    <p class="text-center text-gray-400 py-12">Laddar ekipage...</p>
                </div>
            </div>
        </div>
    `;

    // Start Listener
    unsubscribe = listenForEquipages(competitionId, (update) => {
        allEquipages = update;
        updateDatalist();
        processData(currentSearchTerm);
    });

    // Attach Listeners
    setTimeout(() => {
        const searchInput = document.getElementById('vet-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                currentSearchTerm = e.target.value.toLowerCase();
                currentIndex = 0;
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
    // Check if input follows "StartNo - Name" format (from dropdown)
    if (/^\d+\s-\s/.test(searchTerm)) {
        const startNo = searchTerm.split('-')[0].trim();
        const foundIndex = allEquipages.findIndex(e => String(e.startNumber) === startNo);

        if (foundIndex !== -1) {
            // JUMP MODE: Show all, but jump to index
            filteredEquipages = [...allEquipages];
            // We need to sort filteredEquipages exactly how 'allEquipages' effectively is?
            // Wait, 'allEquipages' comes from Firestore unsorted or default sorted.
            // Our normal view applies a specific sort (Status priority).
            // We must apply the SAME sort to 'filteredEquipages' to find the correct new 'currentIndex'.

            // Let's re-use the sort logic:
            applySort(filteredEquipages); // Helper needed or inline

            // Now find where our guy ended up
            const newIndex = filteredEquipages.findIndex(e => String(e.startNumber) === startNo);
            if (newIndex !== -1) {
                currentIndex = newIndex;

                // Reset search input visually to show we are browsing the full list
                const searchInput = document.getElementById('vet-search');
                if (searchInput) searchInput.value = '';

                updateQueueDisplay();
                renderCard();
                return;
            }
        }
    }

    // 1. Filter
    let filtered = allEquipages.filter(eq => {
        if (!searchTerm) return true;
        // Basic search if not a "Jump" command
        // Remove trailing " - " if user is typing manually... 
        let cleanTerm = searchTerm;
        if (cleanTerm.includes('-')) cleanTerm = cleanTerm.split('-')[0].trim();

        const hay = [
            eq.startNumber,
            eq.driverName,
            eq.clubName,
            (eq.horses || []).map(h => h.name).join(' ')
        ].join(' ').toLowerCase();
        return hay.includes(cleanTerm); // Use cleaned term to allow finding "12" even if input is "12 - Kalle"
    });

    applySort(filtered);
    filteredEquipages = filtered;

    currentIndex = 0; // Reset index on new filter
    updateQueueDisplay();
    renderCard();
}

function applySort(list) {
    const priority = {
        'ombesiktning': 0, 'incheckad': 1, 'anmäld': 2, 'besiktigad': 3, 'struken': 4
    };
    list.sort((a, b) => {
        const sa = a.status || 'anmäld';
        const sb = b.status || 'anmäld';
        if (priority[sa] !== priority[sb]) return priority[sa] - priority[sb];
        return a.startNumber - b.startNumber;
    });
}

function updateQueueDisplay() {
    const countEl = document.getElementById('vet-queue-count');
    const remaining = allEquipages.filter(e => !['besiktigad', 'struken'].includes(e.status || 'anmäld')).length;
    if (countEl) countEl.textContent = `${remaining} kvar`;
}

function updateDatalist() {
    const dataList = document.getElementById('vet-search-list');
    if (!dataList) return;

    dataList.innerHTML = allEquipages.map(eq => {
        return `<option value="${eq.startNumber} - ${eq.driverName}">`;
    }).join('');
}

function renderCard() {
    const container = document.getElementById('vet-card-container');
    const indexInd = document.getElementById('index-indicator');
    const prevBtn = document.getElementById('btn-prev-eq');
    const nextBtn = document.getElementById('btn-next-eq');

    if (!container) return;

    if (filteredEquipages.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-500 dark:text-gray-400 mt-12 bg-white dark:bg-gray-800 p-8 rounded shadow">Inga ekipage matchar sökningen.</div>`;
        if (indexInd) indexInd.textContent = "0 / 0";
        return;
    }

    if (currentIndex >= filteredEquipages.length) currentIndex = filteredEquipages.length - 1;
    if (currentIndex < 0) currentIndex = 0;

    if (indexInd) indexInd.textContent = `${currentIndex + 1} / ${filteredEquipages.length}`;
    if (prevBtn) prevBtn.disabled = currentIndex === 0;
    if (nextBtn) nextBtn.disabled = currentIndex === filteredEquipages.length - 1;

    const eq = filteredEquipages[currentIndex];
    const status = eq.status || 'anmäld';
    const conf = statusConfig[status] || statusConfig['anmäld'];

    // Horses Section - Condensed for Mobile
    const horses = eq.horses || [];
    const horsesHtml = horses.map(h => {
        const ids = [];
        if (h.chipNumber) ids.push(`Chip: ${h.chipNumber}`);
        else if (h.chip) ids.push(`Chip: ${h.chip}`);
        
        if (h.lic) ids.push(`Lic: ${h.lic}`);
        else if (h.license) ids.push(`Lic: ${h.license}`);
        
        if (ids.length === 0 && (h.uid || h.id)) ids.push(`ID: ${h.uid || h.id}`);

        const idString = ids.length > 0 ? ids.join(' • ') : '<span class="text-red-400 italic">ID saknas</span>';
        const vacc = h.vaccinationDate ? `<span class="text-[10px] font-bold text-blue-600 dark:text-blue-400">💉 ${h.vaccinationDate}</span>` : '';

        return `
        <div class="horse-id-grid flex flex-col bg-gray-50 dark:bg-gray-800/50 border dark:border-gray-700 rounded-lg p-2.5 text-xs">
            <div class="flex justify-between items-start gap-2">
                <div class="min-w-0">
                    <div class="font-black text-gray-900 dark:text-white truncate text-sm uppercase">${h.name || '-'}</div>
                    <div class="text-[10px] font-mono text-gray-500 mt-0.5">${idString}</div>
                </div>
                <div class="text-right shrink-0">
                    <div class="text-[10px] font-bold text-gray-400 uppercase">${h.age ? `${h.age} år` : ''} ${h.gender ? h.gender.slice(0,1).toUpperCase() : ''}</div>
                    ${vacc}
                </div>
            </div>
        </div>
        `;
    }).join('');

    const isProcessable = ['anmäld', 'incheckad', 'ombesiktning'].includes(status);
    const cardOpacity = !isProcessable ? 'opacity-70' : '';

    container.innerHTML = `
        <div class="vet-card w-full max-w-2xl bg-white dark:bg-gray-800 rounded-xl shadow-lg border dark:border-gray-700 p-6 ${cardOpacity} transition-all relative">
            
            <div class="mb-5">
                <div class="flex flex-col gap-1">
                    <div class="flex items-center justify-between">
                         <span class="text-4xl font-black text-gray-900 dark:text-white tracking-tighter">#${eq.startNumber}</span>
                         <span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${conf.border} ${conf.color}">${conf.label}</span>
                    </div>
                    <div class="mt-1">
                        <h2 class="text-2xl font-black text-gray-800 dark:text-gray-100 leading-tight uppercase tracking-tight">${eq.driverName}</h2>
                        <div class="text-[10px] font-bold text-gray-400 uppercase mt-1 tracking-wider">${eq.className} • ${eq.clubName}</div>
                    </div>
                </div>
            </div>

            <div class="mb-5">
                <div class="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                    <span class="w-8 h-[1px] bg-gray-200 dark:bg-gray-700"></span>
                    Hästar & Identitet
                </div>
                <div class="grid gap-2">
                ${horsesHtml || '<div class="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border dark:border-gray-700 text-gray-500 italic text-center text-xs">Inga hästar registrerade</div>'}
                </div>
            </div>
            
            <div class="mb-5 relative group">
                 <label class="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Veterinärnotering</label>
                 <textarea class="w-full text-sm border dark:border-gray-700 rounded-lg p-3 vet-notes focus:ring-2 focus:ring-blue-500/20 transition-all min-h-[60px] dark:bg-gray-900/40 dark:text-white placeholder-gray-500"
                    placeholder="Anteckna t.ex. rörelsestörning..." 
                    data-sn="${eq.startNumber}">${eq.vetNotes || ''}</textarea>
                 <div class="absolute right-2 bottom-2">
                    <button class="text-[10px] font-black bg-brand-darkblue text-white px-3 py-1.5 rounded-lg shadow-sm save-notes-btn hidden uppercase tracking-wide" data-sn="${eq.startNumber}">Spara</button>
                 </div>
            </div>

            <div class="grid grid-cols-2 gap-3 pt-4 border-t dark:border-gray-700">
                <button class="bg-emerald-600 text-white font-black py-4 px-3 rounded-xl shadow-lg active:scale-95 transition-all flex flex-col items-center justify-center gap-1 group"
                    onclick="window.setVetStatus('${eq.startNumber}', 'besiktigad')">
                    <span class="text-xl">✅</span> 
                    <span class="text-sm tracking-widest">GODKÄND</span>
                </button>
                <button class="bg-amber-500 text-white font-black py-4 px-3 rounded-xl shadow-lg active:scale-95 transition-all flex flex-col items-center justify-center gap-1 group"
                    onclick="window.setVetStatus('${eq.startNumber}', 'ombesiktning')">
                    <span class="text-xl">🤚</span> 
                    <span class="text-sm tracking-widest">HÅLL</span>
                </button>
            </div>

            ${isProcessable ? `
            <div class="mt-4 flex justify-center">
                 <button class="text-[10px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-widest flex items-center gap-1.5 opacity-60 hover:opacity-100 transition-opacity"
                    onclick="window.setVetStatus('${eq.startNumber}', 'struken')">
                    <span>🛑</span> Stryk ekipage
                </button>
            </div>` : ''}
        </div>
    `;

    const textArea = container.querySelector('.vet-notes');
    const saveBtn = container.querySelector('.save-notes-btn');
    if (textArea && saveBtn) {
        textArea.addEventListener('input', () => saveBtn.classList.remove('hidden'));
        saveBtn.addEventListener('click', async () => {
            const note = textArea.value;
            try {
                await saveEquipage(competitionId, eq.startNumber, { vetNotes: note });
                saveBtn.innerText = 'KLART!';
                setTimeout(() => {
                    saveBtn.innerText = 'SPARA';
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
