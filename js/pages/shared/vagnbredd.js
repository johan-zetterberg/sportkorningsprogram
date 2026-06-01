// vagnbredd.js - funktionskontroll och vagnbredd

import { getGlobalState } from '../../main.js';
import { getEquipages, saveEquipage } from '../../services/equipageService.js';
import { getCompetitionHeader, createSearchableDropdown, showAlert } from '../../ui/components.js';
import {
    buildVagnbreddDropdownItems,
    buildVagnbreddSavePayload,
    normalizeVagnbreddEquipages
} from './vagnbreddUtils.js';

let competitionId = null;
let allEquipages = [];
let sortedEquipages = [];
let equipageSearchDropdown = null;
let currentIndex = -1;

function byId(id) {
    return document.getElementById(id);
}

function displayEquipageData(equipage) {
    const precisionInput = byId('precisionBreddInput');
    const marathonInput = byId('maratonBreddInput');
    const approvedInput = byId('safetyCheckApproved');
    const commentInput = byId('safetyCheckComment');

    if (!precisionInput || !marathonInput || !approvedInput || !commentInput) return;

    if (!equipage) {
        precisionInput.value = '';
        marathonInput.value = '';
        approvedInput.checked = false;
        commentInput.value = '';
        return;
    }

    precisionInput.value = equipage.trackWidth ?? '';
    marathonInput.value = equipage.marathonTrackWidth ?? '';

    const safetyCheck = equipage.safetyCheck || {};
    approvedInput.checked = safetyCheck.approved === true;
    commentInput.value = safetyCheck.comment || '';
    precisionInput.focus();
}

function updateStatus() {
    const progressIndicator = byId('progressIndicator');
    if (!sortedEquipages || sortedEquipages.length === 0) {
        if (progressIndicator) progressIndicator.textContent = 'Inga ekipage att kontrollera.';
        return;
    }

    const { checkedCount, totalCount } = buildVagnbreddDropdownItems(sortedEquipages);
    if (progressIndicator) {
        progressIndicator.textContent = `${checkedCount} av ${totalCount} ekipage kontrollerade.`;
    }

    if (equipageSearchDropdown && typeof equipageSearchDropdown.updateData === 'function') {
        equipageSearchDropdown.updateData(sortedEquipages);
    }
}

function onEquipageSelect(selectedEquipage) {
    if (!selectedEquipage || selectedEquipage.startNumber == null) {
        displayEquipageData(null);
        currentIndex = -1;
        return;
    }

    currentIndex = sortedEquipages.findIndex(e => String(e.startNumber) === String(selectedEquipage.startNumber));
    displayEquipageData(selectedEquipage);
}

async function saveCheck() {
    const startNumber = equipageSearchDropdown?.getValue?.();
    if (!startNumber) {
        showAlert('Du måste välja ett ekipage.', false);
        return;
    }

    const updatePayload = buildVagnbreddSavePayload({
        precisionWidth: byId('precisionBreddInput')?.value,
        marathonWidth: byId('maratonBreddInput')?.value,
        approved: byId('safetyCheckApproved')?.checked,
        comment: byId('safetyCheckComment')?.value
    });

    try {
        await saveEquipage(competitionId, startNumber, updatePayload);
        showAlert(`Data för #${startNumber} har sparats.`);

        const equipageInList = sortedEquipages.find(e => String(e.startNumber) === String(startNumber));
        if (equipageInList) Object.assign(equipageInList, updatePayload);

        updateStatus();
        navigateToEquipage(1);
    } catch (error) {
        console.error('Kunde inte spara vagnbredd/funktionskontroll:', error);
        showAlert('Ett fel uppstod vid sparande.', false);
    }
}

function navigateToEquipage(delta) {
    if (!sortedEquipages.length) return;

    if (currentIndex === -1 && delta > 0) {
        currentIndex = 0;
    } else {
        const newIndex = currentIndex + delta;
        if (newIndex < 0 || newIndex >= sortedEquipages.length) {
            showAlert(delta > 0 ? 'Du är vid slutet av listan.' : 'Du är vid början av listan.');
            return;
        }
        currentIndex = newIndex;
    }

    const nextEquipage = sortedEquipages[currentIndex];
    if (nextEquipage) equipageSearchDropdown?.setValue?.(nextEquipage.startNumber);
}

function renderPage(page, competition) {
    page.innerHTML = `
        <div class="container mx-auto p-4 md:p-8 max-w-lg">
            ${getCompetitionHeader(competition, 'Funktionskontroll & Vagnbredd')}
            <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md space-y-6">
                <div>
                    <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">1. Välj ekipage</label>
                    <div class="flex items-center gap-2 mt-1">
                        <button id="prevBtn" class="p-3 border rounded-md bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:hover:bg-gray-600" title="Föregående">«</button>
                        <div id="vagnbreddEquipageSearch" class="flex-grow"></div>
                        <button id="nextBtn" class="p-3 border rounded-md bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:hover:bg-gray-600" title="Nästa">»</button>
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label for="precisionBreddInput" class="block text-sm font-medium text-gray-700 dark:text-gray-300">2. Bredd dressyr/precision (cm)</label>
                        <input type="number" id="precisionBreddInput" class="mt-1 block w-full p-3 text-lg border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="cm">
                    </div>
                    <div>
                        <label for="maratonBreddInput" class="block text-sm font-medium text-gray-700 dark:text-gray-300">3. Bredd maraton (cm)</label>
                        <input type="number" id="maratonBreddInput" class="mt-1 block w-full p-3 text-lg border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="cm">
                    </div>
                </div>

                <div class="p-4 border rounded-lg bg-gray-50 dark:bg-gray-700/50 dark:border-gray-600">
                    <h3 class="text-md font-semibold mb-3 dark:text-white">4. Funktionskontroll</h3>
                    <div class="space-y-3">
                        <label class="flex items-center cursor-pointer">
                            <input type="checkbox" id="safetyCheckApproved" class="h-5 w-5 rounded border-gray-300 dark:border-gray-500 dark:bg-gray-600 focus:ring-blue-500">
                            <span class="ml-3 text-md font-medium text-gray-800 dark:text-gray-200">Vagn godkänd</span>
                        </label>
                        <div>
                            <label for="safetyCheckComment" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Anmärkning</label>
                            <textarea id="safetyCheckComment" rows="2" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400" placeholder="T.ex. bromsar, reflexer"></textarea>
                        </div>
                    </div>
                </div>

                <button id="saveVagnbreddBtn" class="w-full bg-brand-darkblue text-white font-semibold py-3 px-4 rounded-lg hover:bg-brand-gold hover:text-brand-darkblue text-lg dark:bg-blue-600 dark:hover:bg-blue-500 dark:hover:text-white transition-colors">Spara & gå till nästa</button>
            </div>
            <div id="progressIndicator" class="text-center text-gray-600 dark:text-gray-400 mt-4"></div>
        </div>
    `;
}

function attachPageHandlers() {
    byId('saveVagnbreddBtn')?.addEventListener('click', saveCheck);
    byId('prevBtn')?.addEventListener('click', () => navigateToEquipage(-1));
    byId('nextBtn')?.addEventListener('click', () => navigateToEquipage(1));

    ['precisionBreddInput', 'maratonBreddInput', 'safetyCheckComment'].forEach(id => {
        byId(id)?.addEventListener('keydown', event => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            saveCheck();
        });
    });
}

export async function load() {
    const competition = getGlobalState('currentCompetition');
    const page = byId('page-vagnbredd');
    if (!page) {
        console.error('Hittade inte #page-vagnbredd');
        return;
    }

    if (!competition) {
        page.innerHTML = '<p class="p-8 text-center text-red-500">Ingen tävling vald.</p>';
        return;
    }

    competitionId = competition.id;
    renderPage(page, competition);

    try {
        allEquipages = await getEquipages(competitionId);
        const { valid, invalid } = normalizeVagnbreddEquipages(allEquipages);

        if (invalid.length > 0) {
            console.warn('Följande ekipage-data är ofullständig och visas inte i vagnbredd/funktionskontroll:', invalid);
            showAlert(`${invalid.length} ekipage hade ofullständig data och visas inte.`, false);
        }

        sortedEquipages = valid;
        const searchContainer = byId('vagnbreddEquipageSearch');
        equipageSearchDropdown = createSearchableDropdown(searchContainer, sortedEquipages, onEquipageSelect);

        updateStatus();
        attachPageHandlers();
    } catch (error) {
        console.error('Kunde inte ladda sidan för vagnbredd:', error);
        page.innerHTML = '<p class="p-8 text-center text-red-500">Kunde inte ladda ekipage.</p>';
    }
}

export function __unload() {
    if (equipageSearchDropdown && typeof equipageSearchDropdown.destroy === 'function') {
        try {
            equipageSearchDropdown.destroy();
        } catch (error) {
            console.warn('Kunde inte förstöra dropdown vid unload:', error);
        }
    }

    competitionId = null;
    allEquipages = [];
    sortedEquipages = [];
    equipageSearchDropdown = null;
    currentIndex = -1;
}
