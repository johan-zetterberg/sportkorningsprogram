// vagnbredd.js - Ny, utökad version med funktionskontroll

import { getGlobalState } from '../../main.js';
import { getEquipages } from '../../services/equipageService.js';
import { saveEquipage } from '../../services/equipageService.js';
import { getCompetitionHeader, createSearchableDropdown, showAlert } from '../../ui/components.js';

// --- Lokal state ---
let competitionId = null;
let allEquipages = [];
let sortedEquipages = [];
let equipageSearchDropdown = null;
let currentIndex = -1;

/**
 * Fyller formuläret med data för ett valt ekipage.
 */
function displayEquipageData(equipage) {
    if (!equipage) {
        // Rensa alla fält
        document.getElementById('precisionBreddInput').value = '';
        document.getElementById('maratonBreddInput').value = '';
        document.getElementById('safetyCheckApproved').checked = false;
        document.getElementById('safetyCheckComment').value = '';
        return;
    }

    // Fyll i fälten med sparad data eller tomma värden
    document.getElementById('precisionBreddInput').value = equipage.trackWidth || '';
    document.getElementById('maratonBreddInput').value = equipage.marathonTrackWidth || '';

    // Hantera funktionskontroll-data
    const safetyCheck = equipage.safetyCheck || {};
    document.getElementById('safetyCheckApproved').checked = safetyCheck.approved || false;
    document.getElementById('safetyCheckComment').value = safetyCheck.comment || '';

    document.getElementById('precisionBreddInput').focus();
}

/**
 * Uppdaterar framstegsindikatorn och dropdown-listan med status.
 */
function updateStatus() {
    if (!sortedEquipages || sortedEquipages.length === 0) return;

    let checkedCount = 0;

    const dropdownData = sortedEquipages.map(e => {
        const isChecked = e.safetyCheck && e.safetyCheck.approved != null;
        if (isChecked) {
            checkedCount++;
        }
        return {
            value: e.startNumber,
            label: `${isChecked ? '✅ ' : ''}#${e.startNumber} ${e.driverName}`
        };
    });

    // Uppdatera framstegstexten
    const progressIndicator = document.getElementById('progressIndicator');
    if (progressIndicator) {
        progressIndicator.textContent = `${checkedCount} av ${sortedEquipages.length} ekipage kontrollerade.`;
    }

    // Uppdatera listan i dropdown-menyn
    if (equipageSearchDropdown && typeof equipageSearchDropdown.updateItems === 'function') {
        equipageSearchDropdown.updateItems(dropdownData);
    }
}

/**
 * Callback som körs när ett ekipage väljs i dropdown.
 */
function onEquipageSelect(selectedEquipage) {
    // Om inget är valt (t.ex. vid rensning), nollställ allt
    if (!selectedEquipage || !selectedEquipage.startNumber) {
        displayEquipageData(null);
        currentIndex = -1;
        return;
    }

    // Hitta index för nästa/föregående-knapparna
    currentIndex = sortedEquipages.findIndex(e => e.startNumber == selectedEquipage.startNumber);

    // Visa datan för det valda ekipaget
    displayEquipageData(selectedEquipage);
}

/**
 * Sparar all data från formuläret.
 */
async function saveCheck() {
    const startNumber = equipageSearchDropdown.getValue();
    if (!startNumber) {
        showAlert("Du måste välja ett ekipage.", 'warning');
        return;
    }

    const precisionWidth = parseInt(document.getElementById('precisionBreddInput').value, 10);
    const marathonWidth = parseInt(document.getElementById('maratonBreddInput').value, 10);

    // Bygg uppdateringsobjektet
    const updatePayload = {
        safetyCheck: {
            approved: document.getElementById('safetyCheckApproved').checked,
            comment: document.getElementById('safetyCheckComment').value.trim()
        }
    };

    // Lägg bara till bredderna om de har giltiga värden
    if (!isNaN(precisionWidth) && precisionWidth > 0) {
        updatePayload.trackWidth = precisionWidth;
    }
    if (!isNaN(marathonWidth) && marathonWidth > 0) {
        updatePayload.marathonTrackWidth = marathonWidth;
    }

    try {
        await saveEquipage(competitionId, startNumber, updatePayload);
        showAlert(`Data för #${startNumber} har sparats.`);

        // Uppdatera lokala listan
        const equipageInList = sortedEquipages.find(e => e.startNumber == startNumber);
        if (equipageInList) {
            Object.assign(equipageInList, updatePayload);
        }

        updateStatus();

        // Gå automatiskt till nästa ekipage i listan
        navigateToEquipage(1);

    } catch (error) {
        console.error("Kunde inte spara data:", error);
        showAlert("Ett fel uppstod vid sparande.", 'error');
    }
}

/**
 * Navigerar till föregående eller nästa ekipage i listan.
 * @param {number} delta - (-1 för föregående, 1 för nästa)
 */
function navigateToEquipage(delta) {
    if (currentIndex === -1 && delta > 0) {
        currentIndex = 0; // Om inget är valt, starta från början
    } else {
        const newIndex = currentIndex + delta;
        if (newIndex >= 0 && newIndex < sortedEquipages.length) {
            currentIndex = newIndex;
        } else {
            showAlert(delta > 0 ? "Du är vid slutet av listan." : "Du är vid början av listan.");
            return;
        }
    }

    const nextEquipage = sortedEquipages[currentIndex];
    if (nextEquipage) {
        equipageSearchDropdown.setValue(nextEquipage.startNumber);
    }
}

/**
 * Huvudfunktion som anropas av routern.
 */
export async function load() {
    const competition = getGlobalState('currentCompetition');
    const page = document.getElementById('page-vagnbredd');
    if (!page) { console.error("Hittade inte #page-vagnbredd"); return; }

    if (!competition) {
        page.innerHTML = `<p class="p-8 text-center text-red-500">Ingen tävling vald.</p>`;
        return;
    }
    competitionId = competition.id;

    page.innerHTML = `
        <div class="container mx-auto p-4 md:p-8 max-w-lg">
            ${getCompetitionHeader(competition, 'Funktionskontroll & Vagnbredd')}
            <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md space-y-6">
                <div>
                    <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">1. Välj Ekipage</label>
                    <div class="flex items-center gap-2 mt-1">
                        <button id="prevBtn" class="p-3 border rounded-md bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:hover:bg-gray-600" title="Föregående">«</button>
                        <div id="vagnbreddEquipageSearch" class="flex-grow"></div>
                        <button id="nextBtn" class="p-3 border rounded-md bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:hover:bg-gray-600" title="Nästa">»</button>
                    </div>
                </div>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label for="precisionBreddInput" class="block text-sm font-medium text-gray-700 dark:text-gray-300">2. Bredd Dressyr/Precision (cm)</label>
                        <input type="number" id="precisionBreddInput" class="mt-1 block w-full p-3 text-lg border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="cm...">
                    </div>
                    <div>
                        <label for="maratonBreddInput" class="block text-sm font-medium text-gray-700 dark:text-gray-300">3. Bredd Maraton (cm)</label>
                        <input type="number" id="maratonBreddInput" class="mt-1 block w-full p-3 text-lg border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="cm...">
                    </div>
                </div>
                
                <div class="p-4 border rounded-lg bg-gray-50 dark:bg-gray-700/50 dark:border-gray-600">
                    <h3 class="text-md font-semibold mb-3 dark:text-white">4. Funktionskontroll</h3>
                    <div class="space-y-3">
                         <label class="flex items-center cursor-pointer">
                            <input type="checkbox" id="safetyCheckApproved" class="h-5 w-5 rounded border-gray-300 dark:border-gray-500 dark:bg-gray-600 focus:ring-blue-500">
                            <span class="ml-3 text-md font-medium text-gray-800 dark:text-gray-200">Vagn Godkänd</span>
                        </label>
                        <div>
                            <label for="safetyCheckComment" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Anmärkning</label>
                            <textarea id="safetyCheckComment" rows="2" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400" placeholder="T.ex. bromsar, reflexer..."></textarea>
                        </div>
                    </div>
                </div>

                <div>
                    <button id="saveVagnbreddBtn" class="w-full bg-brand-darkblue text-white font-semibold py-3 px-4 rounded-lg hover:bg-brand-gold hover:text-brand-darkblue text-lg dark:bg-blue-600 dark:hover:bg-blue-500 dark:hover:text-white transition-colors">Spara & Gå till Nästa</button>
                </div>
             </div> <div id="progressIndicator" class="text-center text-gray-600 dark:text-gray-400 mt-4"></div>
            </div>
                </div>
        </div>
    `;

    try {
        allEquipages = await getEquipages(competitionId);

        const goodEquipages = [];
        const badEquipages = [];

        // Steg 1: Sortera och noggrant inspektera varje enskilt ekipage
        const sortedAll = (allEquipages || []).sort((a, b) => (a?.startNumber || 0) - (b?.startNumber || 0));

        sortedAll.forEach(e => {
            // En extremt strikt kontroll för att se om ekipaget är "friskt"
            if (e && e.startNumber != null && typeof e.driverName === 'string' && e.driverName.trim() !== '') {
                goodEquipages.push(e);
            } else {
                badEquipages.push(e);
            }
        });

        // Steg 2: Om vi hittade "sjuka" ekipage, rapportera dem i konsolen (F12)
        if (badEquipages.length > 0) {
            console.warn('VARNING: Följande ekipage-data från databasen är ofullständig och har filtrerats bort. Kontrollera att alla ekipage har både ett startnummer och ett namn:', badEquipages);
            showAlert(`${badEquipages.length} ekipage hade ofullständig data och visas inte. Se konsolen (F12) för detaljer.`);
        }

        // Steg 3: Använd BARA den "friska" datan
        sortedEquipages = goodEquipages;

        const searchContainer = document.getElementById('vagnbreddEquipageSearch');

        // Skicka den råa, filtrerade listan med ekipage direkt till komponenten
        equipageSearchDropdown = createSearchableDropdown(searchContainer, sortedEquipages, onEquipageSelect);
        updateStatus();

        // Koppla händelselyssnare
        document.getElementById('saveVagnbreddBtn').addEventListener('click', saveCheck);
        document.getElementById('prevBtn').addEventListener('click', () => navigateToEquipage(-1));
        document.getElementById('nextBtn').addEventListener('click', () => navigateToEquipage(1));

        // Spara med Enter-tangenten för snabbare arbetsflöde
        const inputs = ['precisionBreddInput', 'maratonBreddInput', 'safetyCheckComment'];
        inputs.forEach(id => {
            const inputElement = document.getElementById(id);
            if (inputElement) {
                inputElement.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault(); // Förhindra standardbeteende
                        saveCheck();
                    }
                });
            }
        });

    } catch (error) {
        console.error("Kunde inte ladda sidan för vagnbredd:", error);
        page.innerHTML = `<p class="p-8 text-center text-red-500">Kunde inte ladda ekipage.</p>`;
    }
}

export function __unload() {
    // Förstör dropdown-komponenten för att undvika minnesläckor
    if (equipageSearchDropdown && typeof equipageSearchDropdown.destroy === 'function') {
        try {
            equipageSearchDropdown.destroy();
        } catch (e) {
            console.warn("Kunde inte förstöra dropdown vid unload:", e);
        }
    }

    // Nollställ alla state-variabler
    competitionId = null;
    allEquipages = [];
    sortedEquipages = [];
    equipageSearchDropdown = null;
    currentIndex = -1;
}