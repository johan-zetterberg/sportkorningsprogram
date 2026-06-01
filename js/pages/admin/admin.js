import { listenForCompetition, getCompetitionById } from '../../services/competitionService.js';
import { listenForEquipages } from '../../services/equipageService.js';
import { listenForJudges } from '../../services/adminService.js';
import { listenForOfficials } from '../../services/officialsService.js';
import { finalizeCompetition, reopenCompetition } from '../../services/archivingService.js';
import { getGlobalState } from '../../main.js';
import { getCompetitionHeader, showAlert } from '../../ui/components.js';


import { renderCommunicationTab } from './admin-communication.js';
import { renderOfficialsTab, unloadOfficialsTab } from './admin-officials.js';
import * as participants from './admin-participants.js';
import * as settings from './admin-settings.js';
import { renderClubs } from './admin-clubs.js';
import { renderTeamsTab, unloadTeamsTab } from './admin-teams.js';
import {
  buildArchiveErrorMessage,
  buildArchiveSuccessMessage,
  renderArchiveStatusMessage
} from './adminArchivingUiUtils.js';

// --- Lokal state för modulen ---
let competitionId = null;
let allEquipages = [];
let currentTab = 'registration'; // 'registration' | 'teams' | 'communication' | 'settings' | 'archiving' | 'officials'
let adminUnsubscribers = [];

function addAdminUnsubscriber(unsubscribe) {
  if (typeof unsubscribe === 'function') {
    adminUnsubscribers.push(unsubscribe);
  }
}

// --- HTML-rendering och sidstruktur (Stabil version) ---
function renderLayout(competition) {
  const page = document.getElementById('page-admin');
  if (!competition) return; // Safety check

  // Header + Tabs
  const headerHtml = `
        ${getCompetitionHeader(competition, 'Administration')}
        
        <!-- TABS -->
        <div class="flex border-b border-gray-200 dark:border-gray-700 mb-8 overflow-x-auto">
            <button id="tab-btn-reg" class="px-6 py-3 font-medium text-sm border-b-2 transition-colors whitespace-nowrap ${currentTab === 'registration' ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'}">
                Anmälan & Data
            </button>
            <button id="tab-btn-teams" class="px-6 py-3 font-medium text-sm border-b-2 transition-colors whitespace-nowrap ${currentTab === 'teams' ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'}">
                Lag & Teaming
            </button>
             <button id="tab-btn-clubs" class="px-6 py-3 font-medium text-sm border-b-2 transition-colors whitespace-nowrap ${currentTab === 'clubs' ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'}">
                Klubbar
            </button>
            <button id="tab-btn-officials" class="px-6 py-3 font-medium text-sm border-b-2 transition-colors whitespace-nowrap ${currentTab === 'officials' ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'}">
                Funktionärer
            </button>
            <button id="tab-btn-comm" class="px-6 py-3 font-medium text-sm border-b-2 transition-colors whitespace-nowrap ${currentTab === 'communication' ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'}">
                Kommunikation
            </button>
            <button id="tab-btn-settings" class="px-6 py-3 font-medium text-sm border-b-2 transition-colors whitespace-nowrap ${currentTab === 'settings' ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'}">
                Inställningar
            </button>
            <button id="tab-btn-archiving" class="px-6 py-3 font-medium text-sm border-b-2 transition-colors whitespace-nowrap ${currentTab === 'archiving' ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'}">
                📦 Arkivering
            </button>
        </div>
    `;

  // Registration Content (from Module)
  const registrationContentHtml = `
        <div id="view-registration" class="${currentTab === 'registration' ? '' : 'hidden'}">
            ${participants.getParticipantsHtml()}
        </div>
    `;

  page.innerHTML = `
        <div class="container mx-auto p-4 md:p-8 max-w-screen-xl">
            ${headerHtml}
            ${registrationContentHtml}
            
            <!-- TEAMS VIEW -->
            <div id="view-teams" class="${currentTab === 'teams' ? '' : 'hidden'}">
                 <div class="bg-center p-12 text-center text-gray-500 dark:text-gray-400">Laddar lag...</div>
            </div>

            <!-- CLUBS VIEW -->
            <div id="view-clubs" class="${currentTab === 'clubs' ? '' : 'hidden'}">
                 <div class="bg-center p-12 text-center text-gray-500 dark:text-gray-400">Laddar klubbar...</div>
            </div>

            <div id="view-officials" class="${currentTab === 'officials' ? '' : 'hidden'}">
                 <div class="bg-center p-12 text-center text-gray-500 dark:text-gray-400">Laddar funktionärer...</div>
            </div>

            <!-- COMMUNICATION VIEW -->
            <div id="view-communication" class="${currentTab === 'communication' ? '' : 'hidden'}">
                 <div class="text-center py-12 dark:text-gray-400"><div class="spinner"></div> Laddar modul...</div>
            </div>

            <!-- SETTINGS VIEW -->
            <div id="view-settings" class="${currentTab === 'settings' ? '' : 'hidden'}">
                 ${settings.getSettingsHtml()}
            </div>

            <!-- ARCHIVING VIEW -->
            <div id="view-archiving" class="${currentTab === 'archiving' ? '' : 'hidden'}">
                 <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md max-w-2xl mx-auto text-center border dark:border-gray-700">
                    <h2 class="text-3xl font-bold mb-4 dark:text-white">Avsluta & Arkivera Tävling</h2>
                    <p class="text-gray-600 dark:text-gray-300 mb-8">
                        När tävlingen är slut kan du "Avsluta" den.
                        Detta genererar en slutgiltig resultatlista (PDF) och låser tävlingen för ytterligare ändringar.
                    </p>

                    <div class="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded p-4 mb-8 text-left">
                        <h3 class="font-bold text-yellow-800 dark:text-yellow-100 mb-2">Vad händer när jag klickar Avsluta?</h3>
                        <ul class="list-disc list-inside text-sm text-yellow-900 dark:text-yellow-200 space-y-1">
                            <li>Alla resultat räknas om en sista gång.</li>
                            <li>En komplett resultat-PDF skapas för alla klasser.</li>
                            <li>Tävlingen markeras som <strong>Avslutad</strong> och låses för redigering.</li>
                            <li>Resultaten blir tillgängliga i historiken (om implementerat).</li>
                        </ul>
                    </div>

                    <div id="archiving-actions">
                        ${competition.status === 'completed'
      ? `
                            <div class="p-4 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-100 rounded mb-4 font-bold border border-green-200 dark:border-green-800 shadow-sm">
                                ✅ Tävlingen är avslutad.
                            </div>
                            <div class="mt-4">
                                <p class="text-xs text-gray-500 dark:text-gray-400 mb-2">Råkade du avsluta för tidigt?</p>
                                <button id="btnReopenCompetition" class="px-6 py-3 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 font-semibold rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors flex items-center justify-center gap-2 mx-auto text-sm">
                                     🔓 Lås upp & Återuppta
                                </button>
                            </div>
                            `
      : `<button id="btnFinalizeCompetition" class="px-8 py-4 bg-red-600 text-white font-bold text-lg rounded-full shadow-lg hover:bg-red-700 transition-transform transform hover:scale-105 flex items-center justify-center gap-2 mx-auto">
                                 🏁 Avsluta Tävling
                               </button>`
    }
                    </div>

                    <div id="archive-status" class="mt-6 hidden">
                        <div class="spinner mx-auto mb-2"></div>
                        <p class="text-gray-500 dark:text-gray-400 animate-pulse">Genererar slutresultat och PDF...</p>
                    </div>

                    <div id="archive-results" class="mt-8 pt-8 border-t dark:border-gray-700 hidden">
                        <h3 class="font-bold text-lg mb-4 dark:text-white">Tillgängliga Rapporter</h3>
                        <div id="archive-links" class="space-y-2"></div>
                    </div>
                 </div>
            </div>
        </div>
    `;


  // --- TAB HANDLERS ---
  document.getElementById('tab-btn-reg').addEventListener('click', () => {
    currentTab = 'registration';
    updateTabs();
  });

  document.getElementById('tab-btn-teams').addEventListener('click', () => {
    currentTab = 'teams';
    updateTabs();
    const container = document.getElementById('view-teams');
    if (container) {
      // Pass the competition object which has ID and showTeams
      renderTeamsTab(container, competition);
    }
  });

  document.getElementById('tab-btn-clubs').addEventListener('click', () => {
    currentTab = 'clubs';
    updateTabs();
    const container = document.getElementById('view-clubs');
    if (container) {
      renderClubs(container, competition.id, allEquipages);
    }
  });

  document.getElementById('tab-btn-officials').addEventListener('click', () => {
    currentTab = 'officials';
    updateTabs();
    const container = document.getElementById('view-officials');
    if (container) {
      renderOfficialsTab(container, competition);
    }
  });

  document.getElementById('tab-btn-comm').addEventListener('click', () => {
    currentTab = 'communication';
    updateTabs();
    const commContainer = document.getElementById('view-communication');
    if (commContainer && commContainer.innerHTML.includes('Laddar')) {
      renderCommunicationTab(commContainer, competition);
    }
  });

  document.getElementById('tab-btn-settings').addEventListener('click', () => {
    currentTab = 'settings';
    updateTabs();
    settings.refreshMap();
  });

  document.getElementById('tab-btn-archiving').addEventListener('click', () => {
    currentTab = 'archiving';
    updateTabs();
  });

  function updateTabs() {
    // Buttons
    const btnReg = document.getElementById('tab-btn-reg');
    const btnTeams = document.getElementById('tab-btn-teams');
    const btnClubs = document.getElementById('tab-btn-clubs');
    const btnOff = document.getElementById('tab-btn-officials');
    const btnComm = document.getElementById('tab-btn-comm');
    const btnSettings = document.getElementById('tab-btn-settings');
    const btnArch = document.getElementById('tab-btn-archiving');

    // Views
    const viewReg = document.getElementById('view-registration');
    const viewTeams = document.getElementById('view-teams');
    const viewClubs = document.getElementById('view-clubs');
    const viewOff = document.getElementById('view-officials');
    const viewComm = document.getElementById('view-communication');
    const viewSettings = document.getElementById('view-settings');
    const viewArch = document.getElementById('view-archiving');

    // Helper
    const setTab = (btn, view, isActive) => {
      if (!btn || !view) return;
      if (isActive) {
        btn.classList.add('border-blue-600', 'text-blue-600', 'dark:border-blue-400', 'dark:text-blue-400');
        btn.classList.remove('border-transparent', 'text-gray-500', 'dark:text-gray-400');
        view.classList.remove('hidden');
      } else {
        btn.classList.remove('border-blue-600', 'text-blue-600', 'dark:border-blue-400', 'dark:text-blue-400');
        btn.classList.add('border-transparent', 'text-gray-500', 'dark:text-gray-400');
        view.classList.add('hidden');
      }
    };

    setTab(btnReg, viewReg, currentTab === 'registration');
    setTab(btnTeams, viewTeams, currentTab === 'teams');
    setTab(btnClubs, viewClubs, currentTab === 'clubs');
    setTab(btnOff, viewOff, currentTab === 'officials');
    setTab(btnComm, viewComm, currentTab === 'communication');
    setTab(btnSettings, viewSettings, currentTab === 'settings');
    setTab(btnArch, viewArch, currentTab === 'archiving');
  }

  // Check initial tab
  if (currentTab === 'communication') {
    renderCommunicationTab(document.getElementById('view-communication'), competition);
  }



  // Check initial tab
  updateTabs();

  // --- ARCHIVING HANDLER ---
  const btnFinalize = document.getElementById('btnFinalizeCompetition');
  if (btnFinalize) {
    btnFinalize.addEventListener('click', async () => {
      if (!confirm('Är du säker på att du vill AVSLUTA tävlingen?\nDetta låser alla ändringar och genererar slutresultatet.')) return;

      const statusEl = document.getElementById('archive-status');

      statusEl.classList.remove('hidden');
      renderArchiveStatusMessage(statusEl);
      btnFinalize.disabled = true;
      btnFinalize.classList.add('opacity-50', 'cursor-not-allowed');

      try {
        const result = await finalizeCompetition(competition.id);
        const successMessage = buildArchiveSuccessMessage(result);
        renderArchiveStatusMessage(statusEl, { state: 'success', message: successMessage.replace('\n', ' ') });
        alert(successMessage);

        // Update UI by reloading to get fresh state
        window.location.reload();
      } catch (err) {
        console.error(err);
        const errorMessage = buildArchiveErrorMessage(err);
        alert(errorMessage);
        renderArchiveStatusMessage(statusEl, { state: 'error', message: errorMessage });
        btnFinalize.disabled = false;
        btnFinalize.classList.remove('opacity-50', 'cursor-not-allowed');
      }
    });
  }

  // --- REOPEN HANDLER ---
  const btnReopen = document.getElementById('btnReopenCompetition');
  if (btnReopen) {
    btnReopen.addEventListener('click', async () => {
      if (!confirm('Vill du låsa upp tävlingen igen?')) return;
      btnReopen.disabled = true;
      btnReopen.textContent = 'Låser upp...';
      try {
        await reopenCompetition(competition.id);
        alert('Tävlingen är nu öppen igen.');
        // Force reload to update UI state
        window.location.reload();
      } catch (err) {
        console.error(err);
        alert('Kunde inte låsa upp tävlingen.');
        btnReopen.disabled = false;
        btnReopen.textContent = '🔓 Lås upp & Återuppta';
      }
    });
  }

  // --- Inställningar Logic ---
  // (Moved to admin-settings.js)
}

// --- Global Load Function ---
export async function load() {
  __unload();

  const currentComp = getGlobalState('currentCompetition');
  if (!currentComp || !currentComp.id) {
    showAlert("Ingen tävling vald. Gå via HUB.", false);
    return;
  }

  competitionId = currentComp.id;
  // Fetch fresh data so admin always sees the latest competition status.
  const comp = await getCompetitionById(competitionId);

  if (!comp) {
    showAlert("Kunde inte ladda tävlingen. Kontrollera att ID är korrekt.", false);
    return;
  }

  // Render Layout (Tabs etc.) using the fetched competition data
  renderLayout(comp);

  // Update Header (and listen for future updates)
  addAdminUnsubscriber(listenForCompetition(competitionId, (updatedComp) => {
    // Optionally update only specific parts if needed, e.g. title
    const headerTitle = document.getElementById('adminHeaderTitle');
    if (headerTitle && updatedComp) headerTitle.textContent = `Admin - ${updatedComp.name}`;
  }));

  // Setup Participants Module (Registration Tab)
  participants.setupParticipantsLogic(competitionId);

  // Setup Settings Module
  settings.setupSettingsLogic(competitionId);

  // --- Listeners for Data ---

  // Equipages: Pass to Participants Module
  addAdminUnsubscriber(listenForEquipages(competitionId, (equipages) => {
    allEquipages = equipages;
    participants.updateEquipages(equipages);

    if (currentTab === 'clubs') {
      const container = document.getElementById('view-clubs');
      if (container) renderClubs(container, competitionId, allEquipages);
    }
  }));

  // Officials: Pass to Participants Module (for imports) and Officials Tab
  addAdminUnsubscriber(listenForOfficials(competitionId, (officials) => {
    participants.updateOfficials(officials);
  }));

  // Judges: Pass to Participants Module
  addAdminUnsubscriber(listenForJudges(competitionId, (judges) => {
    participants.updateJudges(judges);
  }));

  const defaultTab = document.getElementById('tab-btn-reg');
  if (defaultTab) defaultTab.click();
}

export function __unload() {
  unloadOfficialsTab();
  unloadTeamsTab();
  settings.unloadSettingsTab();

  adminUnsubscribers.forEach((unsubscribe) => {
    try {
      unsubscribe();
    } catch (error) {
      console.warn('Kunde inte stoppa admin-lyssnare:', error);
    }
  });
  adminUnsubscribers = [];

  competitionId = null;
  allEquipages = [];
  currentTab = 'registration';
}
