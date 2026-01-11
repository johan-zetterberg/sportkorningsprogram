import { getGlobalState } from '../main.js';
import { listenForEquipages, saveEquipage } from '../services/firestoreService.js';
import { getCompetitionHeader, showAlert } from '../ui/components.js';

let competitionId = null;

let allEquipages = []; // En cachad lista över alla ekipage
let searchTerm = '';
let filterStatus = 'alla'; // 'alla', 'anmäld', 'incheckad', 'besiktigad', 'ombesiktning', 'struken';

/**
 * Visar en detaljerad modal-vy med information om ett specifikt ekipage.
 * @param {object} equipage - Det valda ekipageobjektet.
 */
function showEquipageDetailsModal(equipage) {
    const modal = document.getElementById('detailsModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalContent = document.getElementById('modalContent');
    const modalTabs = document.getElementById('modalTabs');

    modalTitle.textContent = `Detaljer för Ekipage #${equipage.startNumber}`;
    modalTabs.innerHTML = '';
    modalTabs.style.display = 'none'; // Vi använder inte flikar här
    modalContent.innerHTML = '';

    const allHorses = equipage.horses || [];
    const cls = (equipage.className || '').toLowerCase();

    // Bestäm om detta är ett ekipage som KAN byta hästar
    let horseLimit = 1;
    if (cls.includes('fyrspann')) horseLimit = 4;
    else if (cls.includes('par') || cls.includes('tandem')) horseLimit = 2;

    const isMultiHorse = horseLimit > 1;
    const canSelectHorses = isMultiHorse && allHorses.length > horseLimit;
    const selections = equipage.momentHorses || {};

    let contentHtml = '<div class="space-y-4 p-4 md:p-6">';

    // --- 1. Informations-block ---
    contentHtml += `
        <div class="p-4 bg-gray-50 rounded-lg">
            <div class="flex justify-between items-center border-b pb-2 mb-2">
                <h3 class="text-lg font-semibold">Information</h3>
                <button id="editInfoBtn" class="text-sm text-blue-600 hover:text-blue-800 font-medium">Redigera</button>
            </div>
            <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <span class="font-medium text-gray-600">Kusk:</span> <span>${equipage.driverName}</span>
                <span class="font-medium text-gray-600">E-post:</span> <span>${equipage.email || '<span class="text-gray-400 italic">Saknas</span>'}</span>
                <span class="font-medium text-gray-600">Klubb:</span> <span>${equipage.clubName}</span>
                <span class="font-medium text-gray-600">Klass:</span> <span>${equipage.className}</span>
                <span class="font-medium text-gray-600">Status:</span> <span class="font-semibold ${equipage.status === 'struken' ? 'text-red-600' : 'text-green-600'}">${equipage.status || 'anmäld'}</span>
                <span class="font-medium text-gray-600">Vagnbredd:</span> <span>${equipage.trackWidth ? `${equipage.trackWidth} cm` : 'Ej angivet'}</span>
                <span class="font-medium text-gray-600 col-span-2 mt-2">Speaker-noteringar:</span>
                <span class="col-span-2 italic text-gray-700 bg-white p-2 rounded border border-gray-200 text-xs">
                    ${equipage.speakerNotes || 'Inga noteringar angivna.'}
                </span>
                <span class="font-medium text-red-700 col-span-2 mt-2">Veterinärnotering:</span>
                <span class="col-span-2 italic text-red-900 bg-red-50 p-2 rounded border border-red-200 text-xs">
                    ${equipage.vetNotes || 'Inga noteringar.'}
                </span>
    `;

    // --- 2. Block för "Alla registrerade hästar" ---
    if (allHorses.length > 0) {
        contentHtml += `
            <div class="p-4 bg-gray-50 rounded-lg">
                <h3 class="text-lg font-semibold border-b pb-2 mb-2">Alla registrerade hästar (${allHorses.length} st)</h3>
                <div class="space-y-3">
        `;
        allHorses.forEach((horse, index) => {
            contentHtml += `
                <div class="border-t pt-2">
                    <p class-><span class="font-semibold text-base">${horse.name || 'Namn saknas'}</span> <span class="text-sm text-gray-600">(${horse.id || 'ID saknas'})</span></p>
                    <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mt-1">
                        <span class="font-medium text-gray-600">Typ:</span> <span>${horse.type || '-'}</span>
                        <span class="font-medium text-gray-600">Ålder:</span> <span>${horse.age || '-'}</span>
                        <span class="font-medium text-gray-600">Härstamning:</span> <span>${horse.lineage || '-'}</span>
                        <span class="font-medium text-gray-600">Ägare:</span> <span>${horse.owner || '-'}</span>
                    </div>
                </div>
            `;
        });
        contentHtml += '</div></div>';
    }

    // --- 3. NYTT: Block för "Valda hästar för moment" ---
    if (isMultiHorse) {
        // Skapa en lookup-map för att enkelt hitta hästnamn från ID
        const horseMap = new Map(allHorses.map(h => [h.id || h.name, h.name]));

        const getHorseNames = (key) => {
            const ids = selections[key] || [];
            if (ids.length === 0) return '<span class="italic text-gray-500">Ej valt</span>';
            return ids.map(id => horseMap.get(id) || id).join(', ');
        };

        contentHtml += `
            <div class="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div class="flex justify-between items-center border-b border-blue-200 pb-2 mb-2">
                    <h3 class="text-lg font-semibold text-blue-800">Valda hästar för moment</h3>
                    ${canSelectHorses ? '<button id="editMomentHorsesBtn" class="px-3 py-1 text-sm bg-brand-darkblue text-white rounded-md">Ändra</button>' : ''}
                </div>
                <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <span class="font-medium text-gray-600">Dressyr:</span> <span>${getHorseNames('dressage')}</span>
                    <span class="font-medium text-gray-600">Maraton:</span> <span>${getHorseNames('marathon')}</span>
                    <span class="font-medium text-gray-600">Precision:</span> <span>${getHorseNames('precision')}</span>
                </div>
                ${!canSelectHorses ? `<p class="text-xs text-gray-500 italic mt-2">Ekipaget har inte tillräckligt många reservhästar (${allHorses.length} st) för att göra val.</p>` : ''}
            </div>
        `;
    }

    contentHtml += '</div>';
    modalContent.innerHTML = contentHtml;

    // Lägg till lyssnare för "Ändra"-knappen (om den finns)
    document.getElementById('editMomentHorsesBtn')?.addEventListener('click', () => {
        renderHorseSelectionView(equipage, allHorses, horseLimit, modalContent);
    });

    // === NYTT: Lyssnare för "Redigera Info" ===
    document.getElementById('editInfoBtn')?.addEventListener('click', () => {
        renderEditInfoView(equipage, modalContent);
    });

    modal.style.display = 'block';
}

function renderEditInfoView(equipage, modalContent) {
    const html = `
    <div class="p-6">
        <h3 class="text-xl font-semibold mb-4">Redigera Information</h3>
        <div class="space-y-4">
            <div>
                <label class="block text-sm font-medium text-gray-700">Kusk</label>
                <input type="text" id="editDriverName" value="${equipage.driverName || ''}" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border">
            </div>
            <div>
                <label class="block text-sm font-medium text-gray-700">E-post (för inloggning/portal)</label>
                <input type="email" id="editEmail" value="${equipage.email || ''}" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border">
            </div>
            <div>
                <label class="block text-sm font-medium text-gray-700">Klubb</label>
                <input type="text" id="editClubName" value="${equipage.clubName || ''}" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border">
            </div>
             <div>
                <label class="block text-sm font-medium text-gray-700">Klass</label>
                <input type="text" id="editClassName" value="${equipage.className || ''}" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border">
            </div>
            <div>
                <label class="block text-sm font-medium text-gray-700">Speaker-noteringar</label>
                <textarea id="editSpeakerNotes" rows="3" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border">${equipage.speakerNotes || ''}</textarea>
                <p class="text-xs text-gray-500 mt-1">Information som visas för speakern (meriter, kuriosa etc).</p>
            </div>
            <div>
                <label class="block text-sm font-medium text-gray-700">Veterinärnotering</label>
                <textarea id="editVetNotes" rows="2" class="mt-1 block w-full rounded-md border-red-300 shadow-sm p-2 border bg-red-50">${equipage.vetNotes || ''}</textarea>
            </div>
        </div>
        <div class="flex gap-4 mt-6">
            <button id="saveInfoBtn" class="flex-1 px-4 py-2 bg-green-600 text-white rounded-md font-semibold">Spara</button>
            <button id="cancelInfoBtn" class="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-md">Avbryt</button>
        </div>
    </div>
    `;
    modalContent.innerHTML = html;

    document.getElementById('cancelInfoBtn').addEventListener('click', () => showEquipageDetailsModal(equipage));

    document.getElementById('saveInfoBtn').addEventListener('click', async () => {
        const newData = {
            driverName: document.getElementById('editDriverName').value.trim(),
            email: (document.getElementById('editEmail').value || '').trim().toLowerCase(),
            clubName: document.getElementById('editClubName').value.trim(),
            className: document.getElementById('editClassName').value.trim(),
            speakerNotes: document.getElementById('editSpeakerNotes').value.trim(),
            vetNotes: document.getElementById('editVetNotes').value.trim(),
        };

        try {
            await saveEquipage(competitionId, equipage.startNumber, newData);
            showAlert('Uppgifter sparade.');
            // Uppdatera lokalt och rendera om
            Object.assign(equipage, newData);
            showEquipageDetailsModal(equipage);
        } catch (err) {
            console.error('Kunde inte spara:', err);
            showAlert('Fel vid sparning.', false);
        }
    });
}

/**
 * Renderar redigeringsvyn för att välja hästar för olika moment.
 * @param {object} equipage - Det valda ekipageobjektet.
 * @param {Array<object>} allHorses - Hela listan med ekipagets hästar.
 * @param {number} horseLimit - Max antal hästar som får väljas per moment (t.ex. 2 för Par, 4 för Fyrspann).
 * @param {HTMLElement} modalContent - Elementet där innehållet ska renderas.
 */
function renderHorseSelectionView(equipage, allHorses, horseLimit, modalContent) {
    const currentSelections = equipage.momentHorses || {};
    const disciplines = [
        { key: 'dressage', label: 'Dressyr' },
        { key: 'marathon', label: 'Maraton' },
        { key: 'precision', label: 'Precision (Konkörning)' }
    ];

    let contentHtml = `
        <div class="p-4 md:p-6">
            <h3 class="text-xl font-semibold mb-1">Välj hästar för moment</h3>
            <p class="text-sm text-gray-600 mb-4">Välj max ${horseLimit} häst(ar) per moment. Valen sparas omedelbart.</p>
            <div class="space-y-6">
    `;

    disciplines.forEach(disc => {
        contentHtml += `
            <fieldset class="p-4 border rounded-lg">
                <legend class="font-semibold px-2">${disc.label}</legend>
                <div class="space-y-2 mt-2" data-discipline-group="${disc.key}">
        `;

        allHorses.forEach(horse => {
            const horseId = horse.id || horse.name; // Använd ID om det finns, annars namn
            const isChecked = (currentSelections[disc.key] || []).includes(horseId);
            contentHtml += `
                <label class="flex items-center p-2 rounded-md hover:bg-gray-100 cursor-pointer">
                    <input type="checkbox"
                           class="h-5 w-5 rounded border-gray-300 moment-horse-cb"
                           data-discipline="${disc.key}"
                           value="${horseId}"
                           ${isChecked ? 'checked' : ''}>
                    <span class="ml-3 text-sm font-medium">${horse.name}</span>
                </label>
            `;
        });

        contentHtml += `</div></fieldset>`;
    });

    contentHtml += `
            </div>
            <div class="flex gap-4 mt-6 border-t pt-4">
                <button id="saveMomentHorsesBtn" class="flex-1 px-4 py-2 bg-brand-darkblue text-white rounded-md font-semibold">Spara och stäng</button>
                <button id="cancelMomentHorsesBtn" class="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-md">Avbryt</button>
            </div>
        </div>
    `;

    modalContent.innerHTML = contentHtml;

    // --- Lägg till interaktivitet ---

    // 1. Logik för att begränsa antal val
    modalContent.querySelectorAll('.moment-horse-cb').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const discipline = e.target.dataset.discipline;
            const group = modalContent.querySelector(`[data-discipline-group="${discipline}"]`);
            const checkedBoxes = group.querySelectorAll('.moment-horse-cb:checked');

            if (checkedBoxes.length > horseLimit) {
                e.target.checked = false;
                showAlert(`Du kan max välja ${horseLimit} häst(ar) för detta moment.`, false);
            }
        });
    });

    // 2. Spara-knappen
    document.getElementById('saveMomentHorsesBtn').addEventListener('click', async () => {
        const newMomentHorses = {
            dressage: [],
            marathon: [],
            precision: []
        };

        modalContent.querySelectorAll('.moment-horse-cb:checked').forEach(cb => {
            newMomentHorses[cb.dataset.discipline].push(cb.value);
        });

        try {
            await saveEquipage(competitionId, equipage.startNumber, { momentHorses: newMomentHorses });
            showAlert('Hästval för moment har sparats.');

            // Uppdatera det lokala objektet och rendera om "läs-vyn"
            equipage.momentHorses = newMomentHorses;
            showEquipageDetailsModal(equipage);

        } catch (error) {
            console.error("Kunde inte spara hästval: ", error);
            showAlert("Ett fel uppstod vid sparande av hästval.", false);
        }
    });

    // 3. Avbryt-knappen
    document.getElementById('cancelMomentHorsesBtn').addEventListener('click', () => {
        // Rendera bara om "läs-vyn" med det ursprungliga objektet
        showEquipageDetailsModal(equipage);
    });
}

/**
 * Renderar listan med ekipage baserat på globala filter och sökterm.
 */
function renderList() {
    const listContainer = document.getElementById('equipageStatusList');
    if (!listContainer) return;

    // --- NY FILTERING OCH SÖK-LOGIK ---
    let filteredEquipages = [...allEquipages];

    // 1. Applicera status-filter
    if (filterStatus !== 'alla') {
        filteredEquipages = filteredEquipages.filter(e => (e.status || 'anmäld') === filterStatus);
    }

    // 2. Applicera sökterm
    if (searchTerm) {
        filteredEquipages = filteredEquipages.filter(e => {
            const hay = [
                e.startNumber,
                e.driverName,
                e.clubName,
                e.className
            ].join(' ').toLowerCase();
            return hay.includes(searchTerm);
        });
    }

    // Uppdatera UI för knappar
    updateFilterButtonsUI();
    // --- SLUT PÅ NY LOGIK ---


    listContainer.innerHTML = '';
    const sortedEquipages = filteredEquipages.sort((a, b) => a.startNumber - b.startNumber);

    if (sortedEquipages.length === 0) {
        if (searchTerm || filterStatus !== 'alla') {
            listContainer.innerHTML = '<p class="text-center text-gray-500">Inga ekipage matchar din sökning/filter.</p>';
        } else {
            listContainer.innerHTML = '<p class="text-center text-gray-500">Inga ekipage tillagda ännu.</p>';
        }
        return;
    }

    // Definiera våra nya statusar
    const statusOptions = [
        { value: 'anmäld', text: 'Anmäld', color: 'text-gray-700' },
        { value: 'incheckad', text: 'Incheckad', color: 'text-blue-600' },
        { value: 'besiktigad', text: 'Besiktigad (OK)', color: 'text-green-600' },
        { value: 'ombesiktning', text: 'Ombesiktning (Håll)', color: 'text-yellow-600' },
        { value: 'struken', text: 'Struken', color: 'text-red-600' }
    ];

    sortedEquipages.forEach(e => {
        const currentStatus = e.status || 'anmäld';
        const isStruken = currentStatus === 'struken';

        // Bestäm bakgrundsfärg baserat på status
        let bgColor = 'bg-gray-50';
        if (isStruken) bgColor = 'bg-red-50';
        else if (currentStatus === 'besiktigad') bgColor = 'bg-green-50';
        else if (currentStatus === 'ombesiktning') bgColor = 'bg-yellow-50';
        else if (currentStatus === 'incheckad') bgColor = 'bg-blue-50';

        const element = document.createElement('div');
        element.className = `p-3 rounded-lg flex items-center justify-between transition-colors duration-200 ${bgColor} hover:bg-gray-100`;

        // Skapa HTML för dropdown-menyn
        let selectHtml = `<select class="status-select text-sm font-medium border-gray-300 rounded-md shadow-sm" data-start-number="${e.startNumber}">`;
        statusOptions.forEach(opt => {
            const selected = opt.value === currentStatus ? 'selected' : '';
            selectHtml += `<option value="${opt.value}" class="${opt.color}" ${selected}>${opt.text}</option>`;
        });
        selectHtml += '</select>';

        element.innerHTML = `
            <div class="clickable-area flex-1 min-w-0 cursor-pointer">
                <div class="${isStruken ? 'line-through text-gray-500' : ''}">
                    <span class="font-bold">#${e.startNumber}</span> - ${e.driverName}
                    <span classV="text-sm text-gray-600">(${e.className})</span>
                </div>
            </div>
            <div class="flex items-center space-x-3 ml-4">
                ${selectHtml}
            </div>
        `;

        // Lyssnare för att öppna modalen (om man klickar *inte* på dropdownen)
        element.querySelector('.clickable-area').addEventListener('click', () => {
            showEquipageDetailsModal(e);
        });

        listContainer.appendChild(element);
    });

    // Lägg till lyssnare på alla dropdown-menyer efter att de har skapats
    listContainer.querySelectorAll('.status-select').forEach(select => {
        // Behåll den visuella färg-feedbacken från optionen
        const updateColor = () => {
            select.className = select.className.replace(/text-(gray|blue|green|red)-(\d{3})/g, '');
            select.classList.add(select.options[select.selectedIndex].className);
        };
        updateColor(); // Kör direkt vid laddning

        select.addEventListener('change', async (event) => {
            const startNumber = event.target.dataset.startNumber;
            const newStatus = event.target.value;
            updateColor(); // Uppdatera färg på dropdown

            try {
                await saveEquipage(competitionId, startNumber, { status: newStatus });
                showAlert(`Status för ekipage #${startNumber} har uppdaterats till: ${newStatus}.`);
                // Notera: Vi behöver inte anropa renderList() manuellt här,
                // eftersom listenForEquipages kommer att fånga ändringen
                // och anropa renderList() åt oss, vilket bevarar vårt filter.
            } catch (error) {
                console.error("Kunde inte uppdatera status: ", error);
                showAlert("Ett fel uppstod.", false);
            }
        });
    });
}

/**
 * Uppdaterar UI för filterknapparna baserat på 'filterStatus'
 */
function updateFilterButtonsUI() {
    const buttons = document.querySelectorAll('#statusFilterButtons .filter-btn');
    buttons.forEach(btn => {
        if (btn.dataset.status === filterStatus) {
            btn.classList.add('bg-brand-darkblue', 'text-white');
            btn.classList.remove('bg-gray-200', 'text-gray-700');
        } else {
            btn.classList.add('bg-gray-200', 'text-gray-700');
            btn.classList.remove('bg-brand-darkblue', 'text-white');
        }
    });
}

/**
 * Huvudfunktionen som anropas av routern.
 */
export function load() {
    const competition = getGlobalState('currentCompetition');
    const page = document.getElementById('page-ekipage');

    if (!competition) {
        page.innerHTML = `<p class="p-8 text-center text-red-500">Ingen tävling vald.</p>`;
        return;
    }
    competitionId = competition.id;

    // Nollställ filter vid omladdning
    allEquipages = [];
    searchTerm = '';
    filterStatus = 'alla';

    page.innerHTML = `
        <div class="container mx-auto p-4 md:p-8">
            ${getCompetitionHeader(competition, 'Hantera Ekipage')}
            <div class="bg-white p-6 rounded-xl shadow-md">
                <h2 class="text-2xl font-semibold mb-4 border-b pb-2">Ändra Status för Ekipage</h2>
                
                <div classm="mb-4 space-y-3 md:space-y-0 md:flex md:items-center md:justify-between">
                    <div>
                        <input type="text" id="equipageSearchInput" placeholder="Sök på startnr, kusk, klubb..."
                               class="w-full md:w-72 p-2 border rounded-md shadow-sm">
                    </div>
                    <div id="statusFilterButtons" class="flex items-center flex-wrap gap-2 pt-3 md:pt-0">
                        <button class="filter-btn" data-status="alla">Visa Alla</button>
                        <button class="filter-btn" data-status="anmäld">Anmälda</button>
                        <button class="filter-btn" data-status="incheckad">Incheckade</button>
                        <button class="filter-btn" data-status="ombesiktning">Håll (Omb.)</button>
                        <button class="filter-btn" data-status="besiktigad">Besiktigade</button>
                        <button class="filter-btn" data-status="struken">Struken</button>
                    </div>
                </div>
                <div id="equipageStatusList" class="space-y-2 mt-6 border-t pt-4">
                    <p class="text-center text-gray-500">Laddar ekipage...</p>
                </div>
            </div>
        </div>
    `;

    // --- UPPDATERAD LYSSNARE ---
    // Starta realtids-lyssnaren.
    // Den uppdaterar bara den globala listan och anropar sedan renderList.
    listenForEquipages(competitionId, (equipages) => {
        allEquipages = equipages;
        renderList(); // renderList kommer nu själv att applicera filter
    });

    // --- NYA EVENT-LYSSNARE ---
    const searchInput = document.getElementById('equipageSearchInput');
    searchInput.addEventListener('input', (e) => {
        searchTerm = e.target.value.toLowerCase();
        renderList();
    });

    const filterButtonContainer = document.getElementById('statusFilterButtons');
    filterButtonContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('filter-btn')) {
            filterStatus = e.target.dataset.status;
            renderList();
        }
    });

    // Funktion för att uppdatera knapparnas utseende
    updateFilterButtonsUI();
}