import {
  saveEquipage,
  listenForEquipages,
  deleteEquipage,
  listenForJudges,
  saveJudge,
  deleteJudge,
  listenForOfficials,
  saveOfficial,
  deleteOfficial,
  getConfig,
  saveConfig
} from '../services/firestoreService.js';
import { finalizeCompetition, reopenCompetition } from '../services/archivingService.js';
import { getGlobalState } from '../main.js';
import { competitionClasses } from '../data/competitionData.js';
import { getCompetitionHeader, showAlert } from '../ui/components.js';


import { renderCommunicationTab } from './admin-communication.js';

// --- Lokal state för modulen ---
let competitionId = null;
let allEquipages = [];
let allJudges = [];
let allOfficials = [];
let sortConfig = { key: 'startNumber', direction: 'asc' };
let currentTab = 'registration'; // 'registration' | 'communication' | 'settings' | 'archiving'

// --- HTML-rendering och sidstruktur (Stabil version) ---
function renderLayout(competition) {
  const page = document.getElementById('page-admin');

  // Header + Tabs
  const headerHtml = `
        ${getCompetitionHeader(competition, 'Administration')}
        
        <!-- TABS -->
        <div class="flex border-b border-gray-200 mb-8">
            <button id="tab-btn-reg" class="px-6 py-3 font-medium text-sm border-b-2 transition-colors ${currentTab === 'registration' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}">
                Anmälan & Data
            </button>
            <button id="tab-btn-comm" class="px-6 py-3 font-medium text-sm border-b-2 transition-colors ${currentTab === 'communication' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}">
                Kommunikation
            </button>
            <button id="tab-btn-settings" class="px-6 py-3 font-medium text-sm border-b-2 transition-colors ${currentTab === 'settings' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}">
                Inställningar
            </button>
            <button id="tab-btn-archiving" class="px-6 py-3 font-medium text-sm border-b-2 transition-colors ${currentTab === 'archiving' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}">
                📦 Arkivering
            </button>
        </div>
    `;

  // Registration Content (Wrapped)
  const registrationContentHtml = `
        <div id="view-registration" class="${currentTab === 'registration' ? '' : 'hidden'}">
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
                
                <div class="lg:col-span-1 space-y-8">
                    <!-- (Tävlingsnivå flyttad till Inställningar) -->   
                    <div class="bg-white p-6 rounded-xl shadow-md">
                        <h2 class="text-2xl font-semibold mb-4 border-b pb-2">Lägg till/uppdatera Ekipage</h2>
                        <form id="adminEquipageForm" class="space-y-4">
                            <div><label for="startNumber" class="block text-sm font-medium">Startnr*</label><input type="number" id="startNumber" required class="mt-1 block w-full p-2 border rounded-md"></div>
                            <div class="flex items-center mb-2">
                                <input type="checkbox" id="isBarnklassCheckbox" class="h-4 w-4 rounded border-gray-300">
                                <label for="isBarnklassCheckbox" class="ml-2 block text-sm font-medium">Detta är en barnklass</label>
                            </div>
                            <div><label for="driverName" class="block text-sm font-medium">Kuskens namn*</label><input type="text" id="driverName" required class="mt-1 block w-full p-2 border rounded-md"></div>
                            <div><label for="driverEmail" class="block text-sm font-medium">E-post (för inloggning)</label><input type="email" id="driverEmail" class="mt-1 block w-full p-2 border rounded-md" placeholder="ex: namn@example.com"></div>
                            <div><label for="groomName" class="block text-sm font-medium">Groom</label><input type="text" id="groomName" class="mt-1 block w-full p-2 border rounded-md"></div>
                            <div><label for="clubName" class="block text-sm font-medium">Klubb*</label><input type="text" id="clubName" required class="mt-1 block w-full p-2 border rounded-md"></div>
                            <div><label for="className" class="block text-sm font-medium">Klass*</label><select id="className" required class="mt-1 block w-full p-2 border rounded-md"></select></div>
                            <div><label for="trackWidth" class="block text-sm font-medium">Vagnbredd precision (cm)</label><input type="number" id="trackWidth" placeholder="ex: 125" class="mt-1 block w-full p-2 border rounded-md"></div>
                            <div>
                                <label for="marathonTrackWidth" class="block text-sm font-medium text-gray-700">Vagnbredd – Maraton (cm)</label>
                                <input type="number" id="marathonTrackWidth" class="mt-1 block w-full p-2 border rounded-md" placeholder="t.ex. 126">
                            </div>
                            <div>
                                <label for="notes" class="block text-sm font-medium text-gray-700">Noteringar (från PM)</label>
                                <textarea id="notes" rows="3" class="mt-1 block w-full p-2 border rounded-md"></textarea>
                            </div>

                            <div class="p-4 bg-gray-50 rounded-lg border">
                                <h3 class="font-semibold mb-2">Betalning</h3>
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label for="paymentStatus" class="block text-sm font-medium">Status</label>
                                        <select id="paymentStatus" class="mt-1 block w-full p-2 border rounded-md">
                                        <option value="">Okänd</option>
                                        <option value="paid">Betald</option>
                                        <option value="partial">Delbetald</option>
                                        <option value="unpaid">Obetald</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label for="paymentAmount" class="block text-sm font-medium">Summa (kr)</label>
                                        <input type="number" id="paymentAmount" class="mt-1 block w-full p-2 border rounded-md" placeholder="t.ex. 600">
                                    </div>
                                </div>
                            </div>
                            
                            <div>
                                <label for="adminComments" class="block text-sm font-medium">Kommentarer (sekretariat)</label>
                                <textarea id="adminComments" rows="2" class="mt-1 block w-full p-2 border rounded-md" placeholder="Intern kommentar..."></textarea>
                            </div>
                            <div id="horses-container" class="space-y-6"></div>
                            <button type="submit" class="w-full bg-brand-darkblue text-white font-semibold py-2 px-4 rounded-lg hover:bg-brand-gold hover:text-brand-darkblue">Spara Ekipage</button>
                        </form>
                    </div>
                    
                    <div class="bg-white p-6 rounded-xl shadow-md">
                        <h2 class="text-2xl font-semibold mb-4 border-b pb-2">Importera / Rensa</h2>
                        <div class="space-y-4">
                            <form id="eqXmlImportForm">
                                <div>
                                <label for="eqXmlFile" class="block text-sm font-medium">Välj .eqentries.xml för import</label>
                                <input type="file" id="eqXmlFile" accept=".xml" class="mt-1 block w-full p-2 border rounded-md" required />
                                </div>
                                <button type="submit" class="w-full bg-emerald-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-emerald-700">
                                Importera
                                </button>
                                <div id="eqXmlImportProgress" class="hidden mt-3 text-sm text-gray-700"></div>
                            </form>
                            
                            <div class="pt-4 border-t">
                                <label class="block text-sm font-medium text-gray-700">Rensa tävlingsdata</label>
                                <p class="text-xs text-gray-500 mb-2">Detta tar permanent bort ALLA anmälda ekipage från denna tävling.</p>
                                <button type="button" id="clearEquipagesBtn" class="w-full bg-red-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-red-700">
                                Töm ekipage-listan
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="lg:col-span-2 space-y-8">
                    <div class="bg-white p-6 rounded-xl shadow-md">
                        <h2 class="text-2xl font-semibold mb-2">Anmälda Ekipage</h2>
                        <div id="mergePanel" class="mb-4 hidden"></div>
                        <div class="max-h-[80vh] overflow-y-auto border rounded-lg">
                        <table class="min-w-full divide-y divide-gray-200 responsive-table">
                            <thead id="adminEquipageTableHead" class="bg-gray-50 sticky top-0"></thead>
                            <tbody id="adminEquipageTableBody"></tbody>
                            </table>
                        </div>
                    </div>

                    <div class="bg-white p-6 rounded-xl shadow-md" id="judge-section-wrapper">
                        <h2 class="text-2xl font-semibold mb-4 border-b pb-2">Domare</h2>
                        <form id="adminJudgeForm" class="space-y-4 bg-gray-50 p-4 rounded-lg">
                            <input type="hidden" id="judgeId">
                            <div>
                                <label for="judgeName" class="block text-sm font-medium">Domarens Namn</label>
                                <input type="text" id="judgeName" required class="mt-1 block w-full p-2 border rounded-md">
                            </div>
                            
                            <div>
                                <label class="block text-sm font-medium">Roller & Moment</label>
                                <div id="judge-roles-container" class="mt-2 space-y-2"></div>
                            </div>

                            <div class="p-3 border rounded-md bg-white space-y-3">
                                <div class="grid grid-cols-2 gap-3">
                                    <select id="new-role-discipline" class="block w-full p-2 border rounded-md text-sm">
                                        <option value="dressage">Dressyr</option>
                                        <option value="precision">Precision</option>
                                        <option value="marathon">Maraton</option>
                                        <option value="overjudge">Överdomare</option>
                                    </select>
                                    <select id="new-role-position" class="block w-full p-2 border rounded-md text-sm">
                                        <option value="">Välj position...</option>
                                        <option value="C">C</option>
                                        <option value="E">E</option>
                                        <option value="B">B</option>
                                        <option value="H">H</option>
                                        <option value="M">M</option>
                                        <option value="F">F</option>
                                        <option value="K">K</option>
                                        <option value="Annan">Annan</option>
                                    </select>
                                </div>
                                <button type="button" id="add-judge-role-btn" class="w-full bg-gray-600 text-white font-semibold py-2 px-3 rounded-lg hover:bg-gray-700 text-sm">
                                    Lägg till Roll
                                </button>
                            </div>
                            <div class="mt-3 text-xs bg-blue-50 border border-blue-200 rounded p-3 leading-relaxed">
                            <p class="font-semibold">Dressyr – domarplaceringar</p>
                            <p>C (presiderande), E och B (långsidor), H och M (hörn vid C), F och K (hörn vid A).</p>
                            <p class="mt-1"><span class="font-medium">Vanliga uppsättningar:</span>
                                1 domare: C ·
                                3 domare: C, E, B ·
                                5 domare: H, C, M, E, B ·
                                7 domare: K, F, H, C, M, E, B
                            </p>
                            </div>

                            <div class="flex items-center gap-4 pt-2">
                                <button type="submit" class="flex-1 bg-brand-darkblue text-white font-semibold py-2 px-4 rounded-lg hover:bg-brand-gold hover:text-brand-darkblue">Spara domare</button>
                                <button type="button" id="newJudgeBtn" class="flex-1 bg-gray-200 text-gray-700 font-semibold py-2 px-4 rounded-lg hover:bg-gray-300">Rensa formulär</button>
                            </div>
                        </form>

                        <h3 class="text-xl font-semibold mt-6 mb-4 border-b pb-2">Tävlingens Domare</h3>
                        <p class="text-sm text-gray-500 mb-2">Klicka på en domare för att redigera.</p>
                        <div id="adminJudgesList" class="space-y-2"></div>
                    </div>
                    
                    <div class="bg-white p-6 rounded-xl shadow-md">
                        <h2 class="text-2xl font-semibold mb-4 border-b pb-2">Lägg till Funktionär</h2>
                        <form id="adminOfficialForm" class="space-y-4">
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div><label for="officialName" class="block text-sm font-medium">Namn</label><input type="text" id="officialName" required class="mt-1 block w-full p-2 border rounded-md"></div>
                                <div><label for="officialRole" class="block text-sm font-medium">Roll</label><select id="officialRole" required class="mt-1 block w-full p-2 border rounded-md">
                                    <option value="">Välj roll...</option>
                                    <option value="Tävlingsledare">Tävlingsledare</option>
                                    <option value="Veterinär">Veterinär</option>
                                    <option value="Hovslagare">Hovslagare</option>
                                    <option value="Funktionärsansvarig">Funktionärsansvarig</option>
                                    <option value="Banbyggare">Banbyggare</option>
                                    <option value="Cateringansvarig">Cateringansvarig</option>
                                    <option value="Biträdande banbyggare">Biträdande banbyggare</option>
                                    <option value="Annat">Annat (ange nedan)</option>
                                </select></div>
                            </div>
                            <div id="otherRoleContainer" class="hidden">
                                <label for="officialRoleOther" class="block text-sm font-medium">Ange annan roll</label>
                                <input type="text" id="officialRoleOther" class="mt-1 block w-full p-2 border rounded-md">
                            </div>
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div><label for="officialPhone" class="block text-sm font-medium">Telefon</label><input type="tel" id="officialPhone" class="mt-1 block w-full p-2 border rounded-md"></div>
                                <div><label for="officialEmail" class="block text-sm font-medium">E-post</label><input type="email" id="officialEmail" class="mt-1 block w-full p-2 border rounded-md"></div>
                            </div>
                            <button type="submit" class="w-full bg-gray-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-gray-700">Lägg till Funktionär</button>
                        </form>
                            <h2 class="text-2xl font-semibold mt-6 mb-4 border-b pb-2">Tävlingens Funktionärer</h2>
                            <div id="adminOfficialsList" class="space-y-2"></div>
                    </div>
                </div>
            </div>
        </div>
        
        <div id="view-communication" class="${currentTab === 'communication' ? '' : 'hidden'}">
             <div class="text-center py-12"><div class="spinner"></div> Laddar modul...</div>
        </div>

        <!-- SETTINGS VIEW -->
        <div id="view-settings" class="${currentTab === 'settings' ? '' : 'hidden'}">
             <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                
                <!-- TÄVLINGSTYP -->
                <div class="bg-white p-6 rounded-xl shadow-md">
                    <h2 class="text-2xl font-semibold mb-4 border-b pb-2">Tävlingsnivå</h2>
                    <div class="flex items-center justify-between">
                        <div>
                            <p class="font-medium">Internationell tävling (FEI)</p>
                            <p class="text-sm text-gray-500">Styr vilka kolumner och rubriker som visas samt vad som hamnar i PDF:en.</p>
                        </div>
                        <label class="inline-flex items-center cursor-pointer">
                            <input id="isInternationalToggle" type="checkbox" class="sr-only peer">
                            <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:bg-brand-darkblue relative">
                                <span class="absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-all peer-checked:translate-x-5"></span>
                            </div>
                        </label>
                    </div>
                    <div class="mt-3 text-sm text-gray-600" id="intlStatusHint"></div>
                </div>

                <!-- SELF-SERVICE & LOCKDOWN -->
                <div class="bg-white p-6 rounded-xl shadow-md">
                    <h2 class="text-2xl font-semibold mb-4 border-b pb-2">Digital Deklarering</h2>
                    <p class="text-sm text-gray-500 mb-4">Styr när kuskar senast får ändra sina uppgifter (häst, vagn, groom) via "Min Portal".</p>
                    
                    <div class="mb-4">
                        <label for="lockdownMinutesInput" class="block text-sm font-medium text-gray-700">Låsändring (minuter innan start)</label>
                        <div class="flex items-center gap-2 mt-1">
                            <input type="number" id="lockdownMinutesInput" class="block w-32 p-2 border rounded-md" placeholder="60">
                            <span class="text-sm text-gray-500">minuter</span>
                        </div>
                        <p class="text-xs text-gray-500 mt-1">Standard: 60 minuter. Sätt till 0 för att alltid tillåta, eller ett högt värde för att låsa tidigare.</p>
                    </div>

                    <div class="flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-md">
                        <input type="checkbox" id="manualLockdownCheckbox" class="h-5 w-5 text-red-600 rounded focus:ring-red-500 border-gray-300">
                        <div>
                            <label for="manualLockdownCheckbox" class="block font-bold text-red-800">Lås alla ändringar NU</label>
                            <p class="text-xs text-red-600">Kryssa i för att omedelbart stänga portalen för alla ändringar, oavsett tid.</p>
                        </div>
                    </div>
                </div>
                
                <div class="md:col-span-2">
                    <button id="saveGlobalSettingsBtn" class="px-6 py-3 bg-brand-darkblue text-white font-bold rounded-lg shadow hover:bg-brand-gold hover:text-brand-darkblue">
                        Spara alla inställningar
                    </button>
                </div>

             </div>
        </div>
        <!-- ARCHIVING VIEW -->
        <div id="view-archiving" class="${currentTab === 'archiving' ? '' : 'hidden'}">
             <div class="bg-white p-6 rounded-xl shadow-md max-w-2xl mx-auto text-center">
                <h2 class="text-3xl font-bold mb-4">Avsluta & Arkivera Tävling</h2>
                <p class="text-gray-600 mb-8">
                    När tävlingen är slut kan du "Avsluta" den.
                    Detta genererar en slutgiltig resultatlista (PDF) och låser tävlingen för ytterligare ändringar.
                </p>

                <div class="bg-yellow-50 border border-yellow-200 rounded p-4 mb-8 text-left">
                    <h3 class="font-bold text-yellow-800 mb-2">Vad händer när jag klickar Avsluta?</h3>
                    <ul class="list-disc list-inside text-sm text-yellow-900 space-y-1">
                        <li>Alla resultat räknas om en sista gång.</li>
                        <li>En komplett resultat-PDF skapas för alla klasser.</li>
                        <li>Tävlingen markeras som <strong>Avslutad</strong> och låses för redigering.</li>
                        <li>Resultaten blir tillgängliga i historiken (om implementerat).</li>
                    </ul>
                </div>

                <div id="archiving-actions">
                    ${competition.status === 'completed'
      ? `
                        <div class="p-4 bg-green-100 text-green-800 rounded mb-4 font-bold border border-green-200 shadow-sm">
                            ✅ Tävlingen är avslutad.
                        </div>
                        <div class="mt-4">
                            <p class="text-xs text-gray-500 mb-2">Råkade du avsluta för tidigt?</p>
                            <button id="btnReopenCompetition" class="px-6 py-3 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition-colors flex items-center justify-center gap-2 mx-auto text-sm">
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
                    <p class="text-gray-500 animate-pulse">Genererar slutresultat och PDF...</p>
                </div>

                <div id="archive-results" class="mt-8 pt-8 border-t hidden">
                    <h3 class="font-bold text-lg mb-4">Tillgängliga Rapporter</h3>
                    <div id="archive-links" class="space-y-2"></div>
                </div>
             </div>
        </div>
    `;

  page.innerHTML = `
        <div class="container mx-auto p-4 md:p-8 max-w-screen-xl">
            ${headerHtml}
            ${registrationContentHtml}
        </div>
    `;

  // --- TAB HANDLERS ---
  document.getElementById('tab-btn-reg').addEventListener('click', () => {
    currentTab = 'registration';
    updateTabs();
  });

  document.getElementById('tab-btn-comm').addEventListener('click', () => {
    currentTab = 'communication';
    updateTabs();
    // Load module content if empty
    const commContainer = document.getElementById('view-communication');
    if (commContainer && commContainer.innerHTML.includes('Laddar modul')) {
      renderCommunicationTab(commContainer, competition);
    }
  });

  document.getElementById('tab-btn-settings').addEventListener('click', () => {
    currentTab = 'settings';
    updateTabs();
  });

  document.getElementById('tab-btn-archiving').addEventListener('click', () => {
    currentTab = 'archiving';
    updateTabs();
  });

  function updateTabs() {
    // Buttons
    const btnReg = document.getElementById('tab-btn-reg');
    const btnComm = document.getElementById('tab-btn-comm');
    const btnSettings = document.getElementById('tab-btn-settings');
    const btnArch = document.getElementById('tab-btn-archiving');

    // Views
    const viewReg = document.getElementById('view-registration');
    const viewComm = document.getElementById('view-communication');
    const viewSettings = document.getElementById('view-settings');
    const viewArch = document.getElementById('view-archiving');

    // Helper
    const setTab = (btn, view, isActive) => {
      if (!btn || !view) return;
      if (isActive) {
        btn.classList.add('border-blue-600', 'text-blue-600');
        btn.classList.remove('border-transparent', 'text-gray-500');
        view.classList.remove('hidden');
      } else {
        btn.classList.remove('border-blue-600', 'text-blue-600');
        btn.classList.add('border-transparent', 'text-gray-500');
        view.classList.add('hidden');
      }
    };

    setTab(btnReg, viewReg, currentTab === 'registration');
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
      const actionsEl = document.getElementById('archiving-actions');

      statusEl.classList.remove('hidden');
      btnFinalize.disabled = true;
      btnFinalize.classList.add('opacity-50', 'cursor-not-allowed');

      try {
        await finalizeCompetition(competition.id);
        alert('Tävlingen är nu avslutad och arkiverad! 🏁\nPDF har laddats ner.');

        // Update UI by reloading to get fresh state
        window.location.reload();
      } catch (err) {
        console.error(err);
        alert(`Ett fel uppstod: ${err.message}`);
        statusEl.classList.add('hidden');
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

  // --- Inställningar Logic (Existing) ---
  // --- Inställningar Logic ---
  (async () => {
    try {
      const meta = await getConfig(competition.id, 'competitionMeta').catch(() => ({}));

      // International Toggle
      const isInt = !!meta?.isInternational;
      const tgl = document.getElementById('isInternationalToggle');
      const hint = document.getElementById('intlStatusHint');
      if (tgl) tgl.checked = isInt;
      if (hint) hint.textContent = isInt ? 'Läge: Internationell (FEI).' : 'Läge: Nationell (SvRF).';

      if (tgl) {
        tgl.addEventListener('change', () => {
          const val = tgl.checked;
          if (hint) hint.textContent = val ? 'Läge: Internationell (FEI).' : 'Läge: Nationell (SvRF).';
        });
      }

      // Lockdown
      const ldInput = document.getElementById('lockdownMinutesInput');
      if (ldInput) {
        ldInput.value = (meta.lockdownMinutes !== undefined) ? meta.lockdownMinutes : 60;
      }
      const ldCheck = document.getElementById('manualLockdownCheckbox');
      if (ldCheck) {
        ldCheck.checked = !!meta.manualLockdown;
      }

      // Save All
      const btn = document.getElementById('saveGlobalSettingsBtn');
      if (btn) {
        btn.addEventListener('click', async () => {
          btn.textContent = 'Sparar...';
          btn.disabled = true;
          try {
            const newValIntl = !!document.getElementById('isInternationalToggle')?.checked;
            const newValLock = Number(document.getElementById('lockdownMinutesInput')?.value ?? 60);
            const newValManual = !!document.getElementById('manualLockdownCheckbox')?.checked;

            await saveConfig(competition.id, 'competitionMeta', {
              isInternational: newValIntl,
              lockdownMinutes: newValLock,
              manualLockdown: newValManual
            });
            showAlert('Inställningar sparade! ✅', true);
          } catch (err) {
            console.error(err);
            showAlert('Kunde inte spara inställningar.', false);
          } finally {
            btn.textContent = 'Spara alla inställningar';
            btn.disabled = false;
          }
        });
      }

    } catch (e) {
      console.warn('Kunde inte läsa/spara competitionMeta', e);
    }
  })();
}

// --- Hjälpfunktioner & Rendering ---
// GLOBAL: används av import, merge-toolbar och panel
function normalizeTestForMerge(label) {
  if (!label) return { key: '', label: '' };
  let s = String(label).trim();

  // Ta bort anspänning & häst/ponny-taggar
  s = s
    .replace(/\b(Enbet|Par|Tvåspann|Fyrspann)\b/gi, '')
    .replace(/\b(Häst|Ponny)\b/gi, '')
    .replace(/\b([ABCD]-ponny)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Ta ev. avslutande pipe/separator
  s = s.replace(/\s*\|\s*$/g, '').trim();

  const key = `TEST:${s.normalize('NFKD').toUpperCase()}`;
  return { key, label: s };
}

function generateHorseFields(index, isRequired, isBarnklass = false, isReserve = false) {
  const requiredAttr = isRequired ? 'required' : '';
  const title = isReserve ? `Häst / Ponny ${index} (Reserv)` : `Häst / Ponny ${index}`;

  const typeOptions = isBarnklass
    ? `<option value="A-ponny">A-ponny</option><option value="B-ponny">B-ponny</option><option value="C-ponny">C-ponny</option>`
    : `<option value="Häst">Häst</option><option value="A-ponny">A-ponny</option><option value="B-ponny">B-ponny</option><option value="C-ponny">C-ponny</option><option value="D-ponny">D-ponny</option>`;

  return ` 
        <div class="p-4 border border-gray-200 rounded-lg space-y-3 mt-4">
            <h3 class="font-semibold text-md text-gray-800">${title}</h3>
            <div class="grid grid-cols-2 gap-4">
               <div><label for="horseId_${index}" class="block text-sm font-medium">Häst-Nr</label><input type="text" id="horseId_${index}" readonly class="mt-1 block w-full p-2 border rounded-md bg-gray-100 cursor-not-allowed"></div>
                <div><label for="horseName_${index}" class="block text-sm font-medium">Namn${isRequired ? '*' : ''}</label><input type="text" id="horseName_${index}" ${requiredAttr} class="mt-1 block w-full p-2 border rounded-md"></div>
            </div>
            <div class="grid grid-cols-2 gap-4">
                <div><label for="horseType_${index}" class="block text-sm font-medium">Typ${isRequired ? '*' : ''}</label><select id="horseType_${index}" ${requiredAttr} class="mt-1 block w-full p-2 border rounded-md"><option value="">Välj typ...</option>${typeOptions}</select></div>
                <div><label for="age_${index}" class="block text-sm font-medium">Ålder</label><input type="number" id="age_${index}" class="mt-1 block w-full p-2 border rounded-md"></div>
            </div>
            <div><label for="lineage_${index}" class="block text-sm font-medium">Härstamning</label><input type="text" id="lineage_${index}" class="mt-1 block w-full p-2 border rounded-md"></div>
            <div><label for="owner_${index}" class="block text-sm font-medium">Ägare</label><input type="text" id="owner_${index}" class="mt-1 block w-full p-2 border rounded-md"></div>
            <div><label for="breeder_${index}" class="block text-sm font-medium">Uppfödare</label><input type="text" id="breeder_${index}" class="mt-1 block w-full p-2 border rounded-md"></div>
        </div>
    `;
}

function updateHorseNumbers(startNumber) {
  const num = parseInt(startNumber);
  if (!num || num < 1) {
    for (let i = 1; i <= 6; i++) {
      const horseIdInput = document.getElementById(`horseId_${i}`);
      if (horseIdInput) horseIdInput.value = '';
    }
    return;
  }

  const horseIdFields = document.querySelectorAll('[id^="horseId_"]');

  if (horseIdFields.length === 1) {
    horseIdFields[0].value = 100 + num;
    return;
  }

  horseIdFields.forEach((field, index) => {
    const letter = String.fromCharCode(65 + index); // 0->'A', 1->'B', etc.
    field.value = `${100 + num} ${letter}`;
  });
}

function populateEquipageForm(equipageData) {
  const startNumber = equipageData.startNumber || '';
  document.getElementById('startNumber').value = startNumber;
  document.getElementById('driverName').value = equipageData.driverName || '';
  document.getElementById('driverEmail').value = equipageData.email || '';
  document.getElementById('clubName').value = equipageData.clubName || '';
  document.getElementById('groomName').value = equipageData.groomName || '';
  document.getElementById('notes').value = equipageData.notes || '';
  document.getElementById('paymentStatus').value = equipageData.payment?.status || '';
  document.getElementById('paymentAmount').value = equipageData.payment?.amount ?? '';
  document.getElementById('adminComments').value = equipageData.adminComments || '';

  const barnklassCheckbox = document.getElementById('isBarnklassCheckbox');
  const isBarn = (equipageData.className || '').toLowerCase().includes('barn');
  if (barnklassCheckbox.checked !== isBarn) {
    barnklassCheckbox.checked = isBarn;
    barnklassCheckbox.dispatchEvent(new Event('change'));
  }

  document.getElementById('className').value = equipageData.className || '';
  if (typeof onClassChange === 'function') {
    const minCount = Array.isArray(equipageData.horses) ? equipageData.horses.length : 1;
    onClassChange({ target: document.getElementById('className') }, minCount);
  }

  document.getElementById('trackWidth').value = equipageData.trackWidth || '';
  document.getElementById('marathonTrackWidth').value = equipageData.marathonTrackWidth || '';

  setTimeout(() => {
    populateHorseFormData(equipageData.horses);
    updateHorseNumbers(startNumber);
  }, 100);
}

function getHorseFormData() {
  const horses = [];
  for (let i = 1; i <= 6; i++) {
    const nameInput = document.getElementById(`horseName_${i}`);
    if (nameInput && nameInput.value) {
      horses.push({
        id: document.getElementById(`horseId_${i}`).value || '',
        name: nameInput.value || '',
        type: document.getElementById(`horseType_${i}`).value || '',
        age: document.getElementById(`age_${i}`).value || '',
        lineage: document.getElementById(`lineage_${i}`).value || '',
        owner: document.getElementById(`owner_${i}`).value || '',
        breeder: document.getElementById(`breeder_${i}`).value || '',
      });
    }
  }
  return horses;
}

function populateHorseFormData(horseDataArray) {
  if (!horseDataArray) return;
  horseDataArray.forEach((horse, i) => {
    const index = i + 1;
    if (document.getElementById(`horseName_${index}`)) {
      document.getElementById(`horseId_${index}`).value = horse.id || '';
      document.getElementById(`horseName_${index}`).value = horse.name || '';
      document.getElementById(`horseType_${index}`).value = horse.type || '';
      document.getElementById(`age_${index}`).value = horse.age || '';
      document.getElementById(`lineage_${index}`).value = horse.lineage || '';
      document.getElementById(`owner_${index}`).value = horse.owner || '';
      document.getElementById(`breeder_${index}`).value = horse.breeder || '';
    }
  });
}

function renderAdminEquipageTable(equipages) {
  const head = document.getElementById('adminEquipageTableHead');
  const body = document.getElementById('adminEquipageTableBody');
  if (!body || !head) return;

  equipages.sort((a, b) => {
    const aValue = a[sortConfig.key];
    const bValue = b[sortConfig.key];
    let comparison = (typeof aValue === 'number') ? aValue - bValue : String(aValue).localeCompare(String(bValue), 'sv');
    return sortConfig.direction === 'asc' ? comparison : -comparison;
  });

  const headers = [
    { key: 'startNumber', label: 'Startnr' },
    { key: 'driverName', label: 'Kusk' },
    { key: 'className', label: 'Klass' },
    { key: 'tdbClassNumber', label: 'TDB #' },
    { key: 'trackWidth', label: 'Vagnbredd' },
    { key: 'payment', label: 'Betalning' }
  ];
  let headerHTML = '<tr>';
  headers.forEach(h => {
    const isSorted = sortConfig.key === h.key;
    const sortArrow = isSorted ? (sortConfig.direction === 'asc' ? ' ▲' : ' ▼') : '';
    headerHTML += `<th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sortable-header" data-sort-key="${h.key}">${h.label}${sortArrow}</th>`;
  });
  headerHTML += `<th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th></tr>`;
  head.innerHTML = headerHTML;

  body.innerHTML = '';
  if (equipages.length === 0) {
    body.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-gray-500">Inga ekipage tillagda ännu...</td></tr>';
    return;
  }

  equipages.forEach(e => {
    const isStruken = e.status === 'struken';
    const row = body.insertRow();
    row.className = `clickable-row ${isStruken ? 'opacity-50 bg-red-50' : ''}`;
    row.addEventListener('click', () => {
      populateEquipageForm(e);
      document.getElementById('adminEquipageForm')?.scrollIntoView({ behavior: 'smooth' });
    });

    const pay = e.payment || {};
    const payTxt = pay.status ? (
      pay.status === 'paid' ? 'Betald' :
        pay.status === 'partial' ? 'Delbetald' :
          pay.status === 'unpaid' ? 'Obetald' : 'Okänd'
    ) : 'Okänd';

    row.innerHTML = `
  <td data-label="Startnr" class="px-3 py-4 whitespace-nowrap font-bold">${e.startNumber}</td>
  <td data-label="Kusk" class="px-3 py-4 whitespace-nowrap">
    <div class="font-medium text-gray-900">${e.driverName}</div>
    <div class="text-sm text-gray-500">${e.clubName || ''}</div>
    ${e.email ? `<div class="text-xs text-blue-600 truncate max-w-[150px]" title="${e.email}">📧 ${e.email}</div>` : '<div class="text-xs text-red-300 italic">Ingen e-post</div>'}
  </td>
  <td data-label="Klass" class="px-3 py-4 whitespace-nowrap text-sm text-gray-600">${e.className}</td>

<!-- NYTT: TDB # + Label -->
<td data-label="TDB #" class="px-3 py-4 whitespace-nowrap text-sm text-gray-600">
  ${(e.tdbClassNumber ?? null) !== null ? `${e.tdbClassNumber}` : '–'}
  ${e.tdbClassLabel ? `<div class="text-xs text-gray-400">${e.tdbClassLabel}</div>` : ''}
</td>

  <td data-label="Vagnbredd" class="px-3 py-4 whitespace-nowrap text-sm">${e.trackWidth || e.marathonTrackWidth || '–'}</td>
  <td data-label="Betalning" class="px-3 py-4 whitespace-nowrap text-sm">${payTxt}${pay.amount ? ` (${pay.amount} kr)` : ''}</td>
  <td data-label="Status" class="px-3 py-4 whitespace-nowrap text-sm font-semibold ${isStruken ? 'text-red-600' : 'text-green-600'}">
    ${isStruken ? 'Struken' : 'Anmäld'}
  </td>
`;
  });

  head.querySelectorAll('.sortable-header').forEach(header => {
    header.onclick = () => {
      const key = header.dataset.sortKey;
      sortConfig.direction = (sortConfig.key === key && sortConfig.direction === 'asc') ? 'desc' : 'asc';
      sortConfig.key = key;
      renderAdminEquipageTable(equipages);
    };
  });
}

// ----- NYTT: Per-test sammanslagningspanel -----
async function renderMergePanel(equipages) {
  const host = document.getElementById('mergePanel');
  if (!host) return;

  // Bygg alla grupper som KAN slås samman: mergedTestKey -> info
  const groups = new Map();
  for (const e of (equipages || [])) {
    const base = normalizeTestForMerge(e.tdbClassLabel || e.className || '');
    const key = base.key;          // TEST:...
    const label = base.label;      // "Lätt A", "MSV 3", ...
    if (!key) continue;

    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        label,
        classes: new Set(),      // distinkta klassnamn som mappats i appen
        tdbs: new Set(),         // distinkta TDB-klassnummer
        horseCodes: new Set(),   // 'H','P','A'...
      };
      groups.set(key, g);
    }
    if (e.className) g.classes.add(e.className);
    if (e.tdbClassNumber != null) g.tdbs.add(e.tdbClassNumber);
    if (e.tdbHorseCode) g.horseCodes.add(e.tdbHorseCode);
  }

  // Kandidater = grupper där det faktiskt finns något att slå ihop
  // (mer än 1 distinkt klass eller mer än 1 TDB# eller både häst/ponny/anspänning förekommer)
  const candidates = Array.from(groups.values())
    .filter(g => g.classes.size > 1 || g.tdbs.size > 1 || g.horseCodes.size > 1)
    .sort((a, b) => a.label.localeCompare(b.label, 'sv', { numeric: true, sensitivity: 'base' }));

  // Läs sparad konfig för vilka som ska slås ihop
  let savedCfg = {};
  try {
    const displayCfg = await getConfig(competitionId, 'display');
    savedCfg = displayCfg || {};
  } catch (e) {
    console.warn('Kunde inte läsa display-config:', e);
  }
  const enabledMap = new Map(Object.entries(savedCfg.mergeGroups || {})); // { [mergedTestKey]: true }

  // Bygg UI
  if (!candidates.length) {
    host.classList.add('hidden');
    host.innerHTML = '';
    return;
  }

  host.classList.remove('hidden');
  let html = `
    <div class="rounded-lg border border-slate-200 p-3 bg-slate-50">
      <div class="flex items-center justify-between">
        <div>
          <div class="text-sm font-semibold">Välj vilka test som ska slås samman i den här tävlingen</div>
          <div class="text-xs text-slate-600">Kryssa i de testgrupper där du vill visa alla anspänningar och häst/ponny i samma klass.</div>
        </div>
        <div class="flex gap-2">
          <button id="mergeSelectAll"   class="text-xs px-2 py-1 rounded bg-slate-200 hover:bg-slate-300">Markera alla</button>
          <button id="mergeSelectNone"  class="text-xs px-2 py-1 rounded bg-slate-200 hover:bg-slate-300">Avmarkera alla</button>
        </div>
      </div>
      <div class="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2" id="mergeChoices">
  `;

  candidates.forEach((g, idx) => {
    const checked = enabledMap.get(g.key) ? 'checked' : '';
    const clsList = Array.from(g.classes).sort().join(', ');
    const tdbList = Array.from(g.tdbs).sort((a, b) => a - b).join(', ');
    const codeList = Array.from(g.horseCodes).size ? ` • Koder: ${Array.from(g.horseCodes).join('/')}` : '';
    html += `
      <label class="flex items-start gap-2 p-2 bg-white border rounded">
        <input type="checkbox" class="mt-1 h-4 w-4 mergeChoice" data-key="${g.key}" ${checked}>
        <div class="text-sm">
          <div class="font-semibold">${g.label}</div>
          <div class="text-xs text-slate-600">
            App-klasser: ${clsList || '—'}${tdbList ? ` • TDB#: ${tdbList}` : ''}${codeList}
          </div>
        </div>
      </label>`;
  });

  html += `
      </div>
      <div class="mt-3 flex flex-wrap gap-2">
        <button id="mergeSaveConfig" class="text-xs bg-emerald-600 text-white font-semibold py-1.5 px-3 rounded hover:bg-emerald-700">Spara val</button>
        <button id="mergeApplyOn"    class="text-xs bg-blue-600   text-white font-semibold py-1.5 px-3 rounded hover:bg-blue-700">Aktivera för valda</button>
        <button id="mergeApplyOff"   class="text-xs bg-gray-200  text-gray-800 font-semibold py-1.5 px-3 rounded hover:bg-gray-300">Avaktivera för valda</button>
      </div>
    </div>`;
  host.innerHTML = html;

  // Interaktioner
  const boxContainer = host.querySelector('#mergeChoices');
  host.querySelector('#mergeSelectAll')?.addEventListener('click', () => {
    boxContainer.querySelectorAll('input.mergeChoice')?.forEach(cb => cb.checked = true);
  });
  host.querySelector('#mergeSelectNone')?.addEventListener('click', () => {
    boxContainer.querySelectorAll('input.mergeChoice')?.forEach(cb => cb.checked = false);
  });

  // Spara enbart konfig (display.mergeGroups)
  host.querySelector('#mergeSaveConfig')?.addEventListener('click', async () => {
    const selectedKeys = getSelectedKeys(boxContainer);
    try {
      const prev = await getConfig(competitionId, 'display') || {};
      await saveConfig(competitionId, 'display', {
        ...prev,
        mergeGroups: Object.fromEntries(selectedKeys.map(k => [k, true]))
      });
      showAlert('Valen sparades.');
    } catch (e) {
      console.error(e);
      showAlert('Kunde inte spara valen.', false);
    }
  });

  // Aktivera eller avaktivera på ekipage-nivå för de valda grupperna
  host.querySelector('#mergeApplyOn')?.addEventListener('click', () => applyForSelected(true));
  host.querySelector('#mergeApplyOff')?.addEventListener('click', () => applyForSelected(false));

  function getSelectedKeys(container) {
    return Array.from(container.querySelectorAll('input.mergeChoice'))
      .filter(cb => cb.checked)
      .map(cb => cb.getAttribute('data-key'));
  }

  async function applyForSelected(value) {
    const selected = new Set(getSelectedKeys(boxContainer));
    if (!selected.size) {
      showAlert('Inget valt.', false);
      return;
    }
    if (!Array.isArray(allEquipages) || !allEquipages.length) {
      showAlert('Inga ekipage att uppdatera.', false);
      return;
    }
    let ok = 0, fail = 0;
    for (const eq of allEquipages) {
      const base = normalizeTestForMerge(eq.tdbClassLabel || eq.className || '');
      if (!base.key) continue;
      if (!selected.has(base.key)) continue;

      const patch = { ...eq, useMergedTestForDisplay: !!value };
      if (value) {
        // säkerställ att merged-fälten finns
        const base2 = normalizeTestForMerge(eq.tdbClassLabel || eq.className || '');
        patch.mergedTestKey = base2.key;
        patch.mergedTestLabel = base2.label;
      }
      try {
        await saveEquipage(competitionId, patch.startNumber, patch);
        ok++;
      } catch (err) {
        console.warn('Kunde inte spara ekipage', eq, err);
        fail++;
      }
    }
    showAlert(`Uppdaterade ${ok} ekipage.${fail ? ` ${fail} misslyckades.` : ''}`);
  }
}

// ----- NYTT: Per-TDB-klassnummer sammanslagningspanel -----
async function renderClassNumberMergePanel(equipages) {
  const host = document.getElementById('mergePanel');
  if (!host) return;

  // Samla alla TDB-klassnummer som faktiskt förekommer bland ekipagen
  const byTdb = new Map(); // tdbClassNumber -> { num, labelCandidates:Set, count }
  for (const e of (equipages || [])) {
    if (e?.tdbClassNumber == null) continue;
    const num = Number(e.tdbClassNumber);
    let rec = byTdb.get(num);
    if (!rec) {
      rec = { num, labelCandidates: new Set(), count: 0 };
      byTdb.set(num, rec);
    }
    if (e.tdbClassLabel) rec.labelCandidates.add(e.tdbClassLabel);
    else if (e.className) rec.labelCandidates.add(e.className);
    rec.count++;
  }

  const items = Array.from(byTdb.values()).sort((a, b) => a.num - b.num);
  if (!items.length) {
    host.classList.add('hidden');
    host.innerHTML = '';
    return;
  }
  host.classList.remove('hidden');

  // Läs ev. tidigare sparade grupper (per TDB-klassnummer)
  let savedCfg = {};
  try {
    const displayCfg = await getConfig(competitionId, 'display');
    savedCfg = displayCfg || {};
  } catch (e) {
    console.warn('Kunde inte läsa display-config:', e);
  }
  // Struktur: display.mergeByClassNumber = { [groupKey]: {label:string, members:number[]} }
  const savedGroups = savedCfg.mergeByClassNumber || {};

  // Bygg UI
  let html = `
    <div class="rounded-lg border border-slate-200 p-3 bg-slate-50">
      <div class="flex items-center justify-between">
        <div>
          <div class="text-sm font-semibold">Slå samman valda TDB-klassnummer</div>
          <div class="text-xs text-slate-600">Markera de klassnummer som ska visas som EN gemensam klass i resultatet.</div>
        </div>
        <div class="flex gap-2">
          <button id="cnSelectAll"  class="text-xs px-2 py-1 rounded bg-slate-200 hover:bg-slate-300">Markera alla</button>
          <button id="cnSelectNone" class="text-xs px-2 py-1 rounded bg-slate-200 hover:bg-slate-300">Avmarkera alla</button>
        </div>
      </div>

      <div class="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2" id="cnChoices">
  `;

  for (const it of items) {
    const label = Array.from(it.labelCandidates).join(' / ') || '';
    html += `
      <label class="flex items-start gap-2 p-2 bg-white border rounded">
        <input type="checkbox" class="mt-1 h-4 w-4 cnChoice" data-num="${it.num}">
        <div class="text-sm">
          <div class="font-semibold">TDB #${it.num}</div>
          <div class="text-xs text-slate-600">Möjliga etiketter: ${label || '—'} • (${it.count} ekipage)</div>
        </div>
      </label>`;
  }

  html += `
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-2">
        <input id="cnGroupLabel" type="text" placeholder="Gemensam etikett (t.ex. Lätt A)"
               class="text-sm border rounded px-2 py-1 min-w-[220px]">
        <button id="cnMergeCreate" class="text-xs bg-emerald-600 text-white font-semibold py-1.5 px-3 rounded hover:bg-emerald-700">
          Slå samman valda
        </button>
        <button id="cnUnmergeSelected" class="text-xs bg-gray-200 text-gray-800 font-semibold py-1.5 px-3 rounded hover:bg-gray-300">
          Ångra sammanslagning (för valda)
        </button>
      </div>

      <div class="mt-4">
        <div class="text-sm font-semibold mb-1">Aktiva sammanslagningar</div>
        <div id="cnActiveGroups" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2"></div>
      </div>
    </div>`;

  host.innerHTML = html;

  // Rendera redan sparade grupper
  renderActiveGroups(savedGroups);

  // Interaktioner
  const choiceBox = host.querySelector('#cnChoices');
  host.querySelector('#cnSelectAll')?.addEventListener('click', () => {
    choiceBox.querySelectorAll('input.cnChoice')?.forEach(cb => cb.checked = true);
  });
  host.querySelector('#cnSelectNone')?.addEventListener('click', () => {
    choiceBox.querySelectorAll('input.cnChoice')?.forEach(cb => cb.checked = false);
  });

  host.querySelector('#cnMergeCreate')?.addEventListener('click', async () => {
    const selected = getSelectedNums(choiceBox);
    if (selected.length < 2) { showAlert('Välj minst två klassnummer.', false); return; }
    const labelInput = host.querySelector('#cnGroupLabel');
    const groupLabel = (labelInput?.value || '').trim() || `Grupp ${selected.join('+')}`;

    // Skapa gruppnyckel deterministiskt
    const key = `TDBGROUP:${selected.slice().sort((a, b) => a - b).join('+')}`;

    // Spara config
    const nextGroups = { ...savedGroups, [key]: { label: groupLabel, members: selected.slice().sort((a, b) => a - b) } };
    try {
      const prev = await getConfig(competitionId, 'display') || {};
      await saveConfig(competitionId, 'display', { ...prev, mergeByClassNumber: nextGroups });
      // Sätt på ekipage-nivå
      await applyMergeForClassNumbers(selected, groupLabel, key, true);
      showAlert('Sammanslagning skapad.');
    } catch (e) {
      console.error(e);
      showAlert('Kunde inte spara sammanslagning.', false);
    }
    // uppdatera UI
    renderActiveGroups(nextGroups);
  });

  host.querySelector('#cnUnmergeSelected')?.addEventListener('click', async () => {
    const selected = new Set(getSelectedNums(choiceBox));
    if (!selected.size) { showAlert('Välj minst ett klassnummer.', false); return; }

    // Hitta grupper som helt eller delvis träffas
    const toUpdate = { ...savedGroups };
    let changed = false;
    for (const [gk, g] of Object.entries(toUpdate)) {
      const anyHit = g.members.some(n => selected.has(n));
      if (anyHit) {
        delete toUpdate[gk];
        changed = true;
      }
    }
    try {
      if (changed) {
        const prev = await getConfig(competitionId, 'display') || {};
        await saveConfig(competitionId, 'display', { ...prev, mergeByClassNumber: toUpdate });
      }
      await applyMergeForClassNumbers(Array.from(selected), '', '', false);
      showAlert('Sammanslagning borttagen för valda klassnummer.');
    } catch (e) {
      console.error(e);
      showAlert('Kunde inte uppdatera.', false);
    }
    renderActiveGroups(toUpdate);
  });

  function getSelectedNums(container) {
    return Array.from(container.querySelectorAll('input.cnChoice'))
      .filter(cb => cb.checked)
      .map(cb => Number(cb.getAttribute('data-num')));
  }

  function renderActiveGroups(groupsObj) {
    const wrap = host.querySelector('#cnActiveGroups');
    if (!wrap) return;
    const entries = Object.entries(groupsObj);
    if (!entries.length) {
      wrap.innerHTML = `<div class="text-xs text-slate-500">Inga aktiva sammanslagningar.</div>`;
      return;
    }
    wrap.innerHTML = entries.map(([key, g]) => {
      const nums = g.members.join(', ');
      return `
        <div class="p-2 border rounded bg-white">
          <div class="text-sm font-semibold">${g.label}</div>
          <div class="text-xs text-slate-600">TDB#: ${nums}</div>
          <div class="text-[11px] text-slate-400 mt-1">${key}</div>
        </div>`;
    }).join('');
  }

  async function applyMergeForClassNumbers(nums, label, groupKey, on) {
    // Sätt/ta bort på ekipage-nivå
    let ok = 0, fail = 0;
    const set = new Set(nums);
    for (const eq of (allEquipages || [])) {
      if (eq?.tdbClassNumber == null) continue;
      if (!set.has(Number(eq.tdbClassNumber))) continue;
      const patch = { ...eq, useMergedTestForDisplay: !!on };
      if (on) {
        patch.mergedTestKey = groupKey || `TDBGROUP:${nums.slice().sort((a, b) => a - b).join('+')}`;
        patch.mergedTestLabel = label || (eq.tdbClassLabel || eq.className || 'Sammanslagen klass');
      } else {
        // ta bort flagga; lämna fälten om du vill (eller nolla)
        patch.useMergedTestForDisplay = false;
      }
      try {
        await saveEquipage(competitionId, patch.startNumber, patch);
        ok++;
      } catch (err) {
        console.warn('Kunde inte spara ekipage', eq, err);
        fail++;
      }
    }
    // eslint-disable-next-line no-unused-vars
    const _msg = `Uppdaterade ${ok} ekipage.${fail ? ` ${fail} misslyckades.` : ''}`;
    // (valfritt) showAlert(_msg);
  }
}


// Samla ihop roller så att varje disciplin finns max en gång.
// För dressyr: behåll EN post och prioritera den som har position.
function normalizeJudgeRoles(roles) {
  const out = [];
  let dress = null;
  (Array.isArray(roles) ? roles : []).forEach(r => {
    if (!r || !r.discipline) return;
    if (r.discipline === 'dressage') {
      const pos = (r.position || '').toString().toUpperCase();
      if (!dress || (!dress.position && pos)) dress = { discipline: 'dressage', position: pos };
    } else if (r.discipline === 'overjudge') {
      if (!out.some(x => x.discipline === 'overjudge')) out.push({ discipline: 'overjudge' });
    } else {
      if (!out.some(x => x.discipline === r.discipline)) out.push({ discipline: r.discipline });
    }
  });
  if (dress) out.push(dress);
  return out;
}

function renderJudgesList(judges) {
  const list = document.getElementById('adminJudgesList');
  if (!list) return;
  list.innerHTML = '';

  if (judges.length === 0) {
    list.innerHTML = `<p class="text-sm text-gray-500">Inga domare tillagda.</p>`;
    return;
  }

  judges.forEach(j => {
    // Skapa en textsträng från den nya `roles`-arrayen
    const roles = normalizeJudgeRoles(j.roles || []);
    const rolesText = roles.map(role => {
      switch (role.discipline) {
        case 'dressage': return `Dressyr (${role.position || '–'})`;
        case 'precision': return 'Precision';
        case 'marathon': return 'Maraton';
        case 'overjudge': return 'Överdomare';
        default: return '';
      }
    }).filter(Boolean).join(', ');
    const isOverJudge = roles.some(r => r.discipline === 'overjudge');

    list.innerHTML += `
            <div class="p-3 bg-gray-50 rounded-lg flex justify-between items-center cursor-pointer hover:bg-blue-50 clickable-judge" data-judge-id="${j.id}">
                <div>
                    <p class="font-semibold">${j.name} ${isOverJudge ? '<span class="ml-2 text-xs font-bold text-brand-lightblue">ÖVERDOMARE</span>' : ''}</p>
                    <p class="text-xs text-gray-600">${rolesText || 'Inga moment tilldelade'}</p>
                </div>
                <button data-id="${j.id}" class="delete-judge-btn text-red-500 hover:text-red-700 font-bold p-1 leading-none text-xl z-10">&times;</button>
            </div>`;
  });
}

function renderOfficialsList(officials) {
  const list = document.getElementById('adminOfficialsList');
  if (!list) return;
  list.innerHTML = '';
  officials.forEach(o => {
    list.innerHTML += `
            <div class="p-2 bg-gray-100 rounded flex justify-between items-center">
                <div>
                    <p class="font-semibold">${o.name} - <span class="font-normal italic">${o.role}</span></p>
                    <p class="text-xs text-gray-600">${o.phone || ''} ${o.phone && o.email ? '|' : ''} ${o.email || ''}</p>
                </div>
                <button data-id="${o.id}" class="delete-official-btn text-red-500 hover:text-red-700 font-bold p-1 leading-none text-xl">&times;</button>
            </div>
        `;
  });
}

// --- XML-import (eqentries) ---
async function parseEqEntriesXml(file) {
  const text = await file.text();
  const parser = new DOMParser();
  const xml = parser.parseFromString(text, 'application/xml');

  const _all = (el, tag) => Array.from(el.getElementsByTagName(tag));
  const _text = (el, tag) => el.getElementsByTagName(tag)[0]?.textContent?.trim() || '';
  const _maybeNum = (s) => {
    if (s === null || s === undefined || s === '') return null;
    const n = parseFloat(String(s).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };

  const horseTypeMap = {
    'H': 'Häst', 'A': 'A-ponny', 'B': 'B-ponny',
    'C': 'C-ponny', 'D': 'D-ponny', 'P': 'Ponny'
  };

  const root = xml.getElementsByTagName('TInternetEntrys')[0];
  if (!root) throw new Error('Okänt XML-format: filen saknar <TInternetEntrys>-taggen.');

  const orgNode = xml.getElementsByTagName('Organization')[0];
  const meetingNode = xml.getElementsByTagName('MeetingSettings')[0];
  const competitionInfo = {
    name: _text(meetingNode, 'name'),
    organizer: _text(orgNode, 'name'),
    organizerId: _text(orgNode, 'orgNr'),
  };

  const classMap = new Map();
  const classInfoMap = new Map(); // ny: clabbNumber -> { label, horse }

  _all(root, 'Propositions').flatMap(p => _all(p, 'o')).forEach(prop => {
    const classNumber = _text(prop, 'clabbNumber');
    const classLabel = _text(prop, 'AclassName');
    const horseCode = _text(prop, 'horse'); // 'H','P','A','B','C','D'
    if (classNumber && classLabel) {
      classMap.set(classNumber, classLabel);
      classInfoMap.set(classNumber, { label: classLabel, horse: horseCode });
    }
  });

  const equipagesByClass = {};
  _all(root, 'Riders').flatMap(r => _all(r, 'o')).forEach(riderNode => {
    const driverName = `${_text(riderNode, 'firstName')} ${_text(riderNode, 'lastName')}`.trim();
    if (!driverName) return;

    const clubName = _text(riderNode, 'orgName');
    const totalAmountPaidByRider = _maybeNum(_text(riderNode, 'paid'));

    // --- Hämta kuskens kontakt-, licens- och adressinfo ---
    const licenseNo = _text(riderNode, 'licens');
    const contactEmail = _text(riderNode, 'email');
    const contactPhone = _text(riderNode, 'phone') || _text(riderNode, 'cellPhone') || _text(riderNode, 'workPhone');
    // --- NYTT: Lägger till adress för kusken ---
    const address = {
      street: _text(riderNode, 'street'),
      zipCode: _text(riderNode, 'zipCode'),
      city: _text(riderNode, 'city')
    };
    // ---------------------------------------------

    _all(riderNode, 'Horses').flatMap(h => _all(h, 'o')).forEach(horseNode => {
      const notes = _text(horseNode, 'PM').replace(/(\r\n|\n|\r)/gm, " ").trim();
      const groomMatch = notes.match(/(?:groomar? åt|delar groom med)\s+([A-ZÅÄÖ][a-zåäö]+(?:\s+[A-ZÅÄÖ][a-zåäö]+)?)/i);
      const groomName = groomMatch ? groomMatch[1].trim() : '';
      const horseCategory = _text(horseNode, 'category');

      // --- Komplett dataobjekt för hästen ---
      const horse = {
        regNo: _text(horseNode, 'regNo'),
        chip: _text(horseNode, 'chipNo'),
        ueln: _text(horseNode, 'uelnNo'),
        // --- NYTT: Lägger till hästens licens, FEI-pass och färg ---
        license: _text(horseNode, 'licens'),
        feiPass: _text(horseNode, 'feipass'),
        color: _text(horseNode, 'color'),
        // --------------------------------------------------------
        name: _text(horseNode, 'horseName'),
        type: horseTypeMap[horseCategory] || horseCategory,
        age: _text(horseNode, 'bornYear') ? new Date().getFullYear() - parseInt(_text(horseNode, 'bornYear')) : '',
        lineage: `e. ${_text(horseNode, 'father')} u. ${_text(horseNode, 'mother')}`,
        owner: _text(horseNode, 'owner'),
        breeder: _text(horseNode, 'breeder'),
        sex: _text(horseNode, 'sex'),
        breed: _text(horseNode, 'breed'),
        studbook: _text(horseNode, 'studbook'),
        vaccinationDate: _text(horseNode, 'vaccinationCardDate')
      };

      const riderComment = _text(riderNode, 'Comment') || _text(riderNode, 'Remarks');
      const horseComment = _text(horseNode, 'Comment') || _text(horseNode, 'Remarks');

      _all(horseNode, 'Classes').flatMap(c => _all(c, 'o')).forEach(classEntryNode => {
        const classNumber = _text(classEntryNode, 'clabbNumber');

        // NYTT: hämta info från propositionen
        const propInfo = classInfoMap.get(classNumber) || {};
        let className = normalizeEqClassName(propInfo.label || `Okänd post (${classNumber})`);

        const entryStatus = _text(classEntryNode, 'status');
        const uniqueKey = `${driverName}|${classNumber}`;
        const isPaidByStatus = entryStatus === 'PAID';

        // NYTT: fyll ut anspänning & hästtyp om de inte redan står i klassnamnet
        // Anspänning och hästtyp baserat på klassrubriken i propositionen.
        // Exempel: "LA par" -> Par, "LB" (utan markör) -> Enbet.
        const hasAnsp = /(enbet|par(?!a)|fyrspann|tandem)/i.test(className);
        const hasSpecies = /(ponny|häst)/i.test(className);

        if (!hasAnsp) {
          const labelNorm = normalizeEqClassName(propInfo.label || '').toLowerCase();
          let span = 'Enbet';
          if (/\bpar\b(?!a)|\btvåspann\b|\b2\s*-\s*spann\b/.test(labelNorm)) span = 'Par';
          else if (/\bfyrspann\b/.test(labelNorm)) span = 'Fyrspann';
          else if (/\btandem\b/.test(labelNorm)) span = 'Tandem';
          className += ` ${span}`;
        }

        if (!hasSpecies) {
          const speciesCode = (propInfo.horse || _text(riderNode, 'horse') || '').toUpperCase(); // 'P'/'H'
          const species = speciesCode === 'P' ? 'Ponny' : 'Häst';
          className += ` ${species}`;
        }


        const hasPaidAmount = totalAmountPaidByRider !== null && totalAmountPaidByRider > 0;
        let paymentStatus = '';
        if (isPaidByStatus || hasPaidAmount) {
          paymentStatus = 'paid';
        }

        if (parseInt(classNumber) > 900) {
          Object.keys(equipagesByClass).forEach(key => {
            if (key.startsWith(driverName + '|')) {
              if (!equipagesByClass[key].administrativeFees) {
                equipagesByClass[key].administrativeFees = [];
              }
              if (!equipagesByClass[key].administrativeFees.includes(className)) {
                equipagesByClass[key].administrativeFees.push(className);
              }
            }
          });
          return;
        }

        const isActive = entryStatus !== 'REMOVED' && entryStatus !== 'WITHDRAWN';

        if (!equipagesByClass[uniqueKey]) {
          const widthMatch = notes.match(/(?:vagnsbredd|bredd|spårvidd)[\s:cm]*(\d{2,3})/i);
          const marathonWidthMatch = notes.match(/maratonbredd[\s:cm]*(\d{2,3})/i);

          const tdbClassNumberRaw = classNumber || '';
          const tdbClassLabel = (propInfo && propInfo.label) || '';
          const tdbHorseCode = ((propInfo && propInfo.horse) || '').toUpperCase(); // 'H','P','A','B','C','D'
          const tdbHorseText = horseTypeMap[tdbHorseCode] || '';

          // NYTT: beräkna merge-nyckel/label baserat på testnamn (ignorera häst/ponny/anspänning)
          const baseForMerge = normalizeTestForMerge(tdbClassLabel || className || '');
          const mergedTestKey = baseForMerge.key;
          const mergedTestLabel = baseForMerge.label;

          equipagesByClass[uniqueKey] = {
            startNumber: null,
            driverName, clubName, className,
            // --- NYTT: TDB-fält för export/merge ---
            tdbClassNumber: tdbClassNumberRaw ? Number(tdbClassNumberRaw) : null,
            tdbClassLabel: tdbClassLabel || '',
            tdbHorseCode: tdbHorseCode || '',
            tdbHorseText: tdbHorseText || '',
            tdbOriginalXmlClassName: className || '',
            mergedTestKey,
            mergedTestLabel,
            groomName,
            notes,
            trackWidth: widthMatch ? parseInt(widthMatch[1]) : null,
            marathonTrackWidth: marathonWidthMatch ? parseInt(marathonWidthMatch[1]) : null,
            horses: [horse],
            status: isActive ? 'anmäld' : 'struken',
            administrativeFees: [],
            payment: {
              status: paymentStatus,
              amount: totalAmountPaidByRider,
              method: '',
              reference: ''
            },
            adminComments: [riderComment, horseComment].filter(Boolean).join(' | ') || '',
            licence: licenseNo,
            email: contactEmail,
            phone: contactPhone,
            address: address // Sparar det nya adressobjektet
          };
        } else {
          // NYTT: fyll i TDB-fält om de saknas
          const E = equipagesByClass[uniqueKey];
          if (!E.mergedTestKey || !E.mergedTestLabel) {
            const base = normalizeTestForMerge(tdbClassLabel || className || '');
            E.mergedTestKey = base.key;
            E.mergedTestLabel = base.label;
          }
          if (E.tdbClassNumber == null) {
            E.tdbClassNumber = classNumber ? Number(classNumber) : null;
            E.tdbClassLabel = (propInfo && propInfo.label) || '';
            E.tdbHorseCode = ((propInfo && propInfo.horse) || '').toUpperCase();
            E.tdbHorseText = horseTypeMap[E.tdbHorseCode] || '';
            if (!E.tdbOriginalXmlClassName) E.tdbOriginalXmlClassName = className || '';
          }
          if (isActive) equipagesByClass[uniqueKey].status = 'anmäld';
          if (!equipagesByClass[uniqueKey].horses.some(h => h.name === horse.name)) {
            equipagesByClass[uniqueKey].horses.push(horse);
          }
          const pay = (equipagesByClass[uniqueKey].payment ||= {});
          if (paymentStatus) pay.status = paymentStatus;
          if (hasPaidAmount) pay.amount = totalAmountPaidByRider;
        }
      });
    });
  });

  let tempStartNumber = 1;
  const finalEquipages = Object.values(equipagesByClass).map(eq => {
    if (eq.status !== 'struken') eq.startNumber = tempStartNumber++;
    return eq;
  });

  finalEquipages.sort((a, b) => {
    if (a.status === 'struken' && b.status !== 'struken') return 1;
    if (a.status !== 'struken' && b.status === 'struken') return -1;
    return (a.startNumber || 9999) - (b.startNumber || 9999);
  });

  return { equipages: finalEquipages, competitionInfo };
}

async function importOfficialsFromXml(xmlFile, competitionId, existingJudges, existingOfficials) {
  const text = await xmlFile.text();
  const parser = new DOMParser();
  const xml = parser.parseFromString(text, "application/xml");

  const _all = (el, tag) => Array.from(el.getElementsByTagName(tag));
  const _text = (el, tag) => (el.getElementsByTagName(tag)[0]?.textContent || "").trim();

  // --- STEG 1: Skapa en karta för att slå upp licensnummer ---
  const licenseMap = new Map();
  const riderNodes = _all(xml, "Riders").flatMap(node => _all(node, "o"));
  for (const riderNode of riderNodes) {
    const id = _text(riderNode, "foreignId");
    const license = _text(riderNode, "licens");
    if (id && license) {
      licenseMap.set(id, license);
    }
  }
  // -------------------------------------------------------------

  const allOfficialBlocks = _all(xml, "Officials");
  if (allOfficialBlocks.length === 0) return { judges: 0, officials: 0 };
  const officialNodes = allOfficialBlocks.flatMap(node => _all(node, "o"));

  const processedIds = new Set();
  let judgesImported = 0;
  let officialsImported = 0;
  const existingJudgeNames = new Set(existingJudges.map(j => j.name));
  const existingOfficialNames = new Set(existingOfficials.map(o => o.name));

  const roleMap = {
    'event_director': 'Tävlingsledare', 'veterinary': 'Veterinär',
    'press_official': 'Pressansvarig', 'safety_official': 'Säkerhetsansvarig',
    'contact_person': 'Kontaktperson', 'precision_course_designer': 'Banbyggare',
    'maraton_course_designer': 'Banbyggare', 'results_accountable': 'Resultatansvarig'
  };

  for (const node of officialNodes) {
    const id = _text(node, "foreignId");
    if (!id || processedIds.has(id)) continue;

    const fullName = _text(node, "fullName");
    if (!fullName) continue;

    processedIds.add(id);

    const kind = _text(node, "kind");
    const phone = _text(node, "phone");
    const email = _text(node, "email");

    // --- STEG 2: Hämta licensnummer från kartan ---
    const licenseNo = licenseMap.get(id) || '';
    // ----------------------------------------------

    switch (kind) {
      case 'head_judge':
      case 'driving_dressage_judge':
      case 'maraton_judge':
      case 'precision_judge':
        if (existingJudgeNames.has(fullName)) continue;
        try {
          const judgeId = fullName.replace(/\s+/g, '-').toLowerCase();
          const judgeData = {
            id: judgeId,
            name: fullName,
            phone: phone,
            email: email,
            license: licenseNo, // <-- Sparar licensnummer
            isOverJudge: kind === 'head_judge',
            // Nya formatet: spara roller istället för "disciplines"
            roles: [
              { discipline: 'dressage', position: '' },
              ...(kind === 'head_judge' ? [{ discipline: 'overjudge' }] : [])
            ]
          };
          await saveJudge(competitionId, judgeId, judgeData);
          judgesImported++;
        } catch (err) { console.error(`Kunde inte spara domare ${fullName}:`, err); }
        break;

      default:
        if (existingOfficialNames.has(fullName)) continue;
        const role = roleMap[kind] || kind.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        try {
          const officialData = {
            name: fullName,
            role: role,
            phone: phone,
            email: email,
            license: licenseNo // <-- Sparar licensnummer
          };
          await saveOfficial(competitionId, officialData);
          officialsImported++;
        } catch (err) { console.error(`Kunde inte spara funktionär ${fullName}:`, err); }
        break;
    }
  }
  return { judges: judgesImported, officials: officialsImported };
}

function normalizeEqClassName(name) {
  const n = (name || '').toString().trim();

  let out = n
    // kortformer
    .replace(/\bLA\b/gi, 'Lätt A')
    .replace(/\bLB\b/gi, 'Lätt B')
    .replace(/\bLC\b/gi, 'Lätt C')
    .replace(/\bLE\b/gi, 'Lätt E');

  // MSV romerska/nummer -> "Msv X"
  out = out.replace(/\bMSV[\s:.\-]*([0-9IVX]+)\b/gi, (_, g) => {
    const roman = { I: '1', II: '2', III: '3', IV: '4', V: '5' };
    const num = /^[0-9]+$/.test(g) ? g : (roman[g.toUpperCase()] || g);
    return `Msv ${num}`;
  });

  // anspänning
  out = out
    .replace(/\benb(et)?\b/gi, 'Enbet')
    .replace(/\bpar(?!a)\b/gi, 'Par')
    .replace(/\bfyr(spann)?\b/gi, 'Fyrspann')
    .replace(/\btandem\b/gi, 'Tandem');

  // hästtyp
  out = out
    .replace(/\bponn?y\b/gi, 'Ponny')
    .replace(/\bh[aä]st\b/gi, 'Häst');

  return out.replace(/\s{2,}/g, ' ').trim();
}

function findBestClassMatch(xmlClassName, availableAppClasses) {
  if (!xmlClassName || !availableAppClasses || availableAppClasses.length === 0) return null;

  const xmlNorm = normalizeEqClassName(xmlClassName).toLowerCase();

  // TDB-sträng innehåller explicit anspänning?
  const spanMatch = xmlNorm.match(/\b(enbet|par(?!a)|fyrspann|tandem)\b/);
  const xmlSpan = spanMatch ? spanMatch[1] : null;

  let best = null, bestScore = -1;

  for (const appClass of availableAppClasses) {
    const appNorm = normalizeEqClassName(appClass).toLowerCase();
    let score = 0;

    // 1) Hög träff vid exakt match
    if (xmlNorm === appNorm) score += 100;

    // 2) Svårighetsgrad
    if (/lätt/.test(xmlNorm) && /lätt/.test(appNorm)) score += 5;
    if (/msv/.test(xmlNorm) && /msv/.test(appNorm)) score += 5;
    if (/svår/.test(xmlNorm) && /svår/.test(appNorm)) score += 5;

    // 3) MSV-nummer (3 vs 4)
    const nXml = (xmlNorm.match(/\bmsv\s*(\d)\b/) || [])[1];
    const nApp = (appNorm.match(/\bmsv\s*(\d)\b/) || [])[1];
    if (nXml && nApp && nXml === nApp) score += 8;

    // 4) Anspänning
    if (xmlSpan) {
      // Explicit angiven i TDB: kräver match
      if (new RegExp(`\\b${xmlSpan}\\b`).test(appNorm)) score += 10;
      else score -= 4;
    } else {
      // Inte angiven i TDB: defaulta till Enbet
      if (/\benbet\b/.test(appNorm)) score += 6;
      if (/\bpar\b(?!a)/.test(appNorm)) score -= 2;
      if (/\bfyrspann\b/.test(appNorm)) score -= 2;
    }

    // 5) Hästtyp (om den råkar stå med i namnen)
    if (/\bponny\b/.test(xmlNorm) && /\bponny\b/.test(appNorm)) score += 3;
    if (/\bhäst\b/.test(xmlNorm) && /\bhäst\b/.test(appNorm)) score += 3;

    if (score > bestScore) { bestScore = score; best = appClass; }
  }
  return best;
}

// --- Setup av Event Listeners ---
let onClassChange;

function setupEquipageForm() {
  const form = document.getElementById('adminEquipageForm');
  const classSelect = document.getElementById('className');
  const startNumberInput = document.getElementById('startNumber');
  const driverInput = document.getElementById('driverName');
  const emailInput = document.getElementById('driverEmail');
  const barnklassCheckbox = document.getElementById('isBarnklassCheckbox');

  const populateClassSelect = () => {
    const isBarnklass = barnklassCheckbox.checked;
    const currentSelectedClass = classSelect.value;
    classSelect.innerHTML = '<option value="">Välj klass...</option>';

    for (const group in competitionClasses) {
      if (!isBarnklass && group === "Barnklasser") continue;
      if (isBarnklass && group !== "Barnklasser") continue;

      const optgroup = document.createElement('optgroup');
      optgroup.label = group;
      competitionClasses[group].forEach(c => {
        const option = document.createElement('option');
        option.value = c;
        option.textContent = c;
        optgroup.appendChild(option);
      });
      classSelect.appendChild(optgroup);
    }

    if (Array.from(classSelect.options).some(opt => opt.value === currentSelectedClass)) {
      classSelect.value = currentSelectedClass;
    } else if (typeof onClassChange === 'function') {
      onClassChange({ target: classSelect });
    }
  };

  const fillByStartNumber = (sn) => {
    sn = String(sn || '').trim();
    if (!sn) return;
    const eq = (allEquipages || []).find(x => String(x.startNumber) === sn);
    if (eq) {
      const isBarn = ((eq.className || '').toLowerCase().includes('barn'));
      if (barnklassCheckbox.checked !== isBarn) {
        barnklassCheckbox.checked = isBarn;
        populateClassSelect();
      }
      populateEquipageForm(eq);
      showAlert(`Ekipage #${sn} inläst.`, true);
    } else {
      showAlert(`Hittade inget ekipage med startnr ${sn}.`, false);
    }
  };

  const fillByDriverName = (name) => {
    name = String(name || '').trim().toLowerCase();
    if (!name) return;
    const eq = (allEquipages || []).find(x =>
      (x.driverName || '').toLowerCase() === name ||
      (x.driverName || '').toLowerCase().includes(name)
    );
    if (eq) {
      const isBarn = ((eq.className || '').toLowerCase().includes('barn'));
      if (barnklassCheckbox.checked !== isBarn) {
        barnklassCheckbox.checked = isBarn;
        populateClassSelect();
      }
      populateEquipageForm(eq);
      showAlert(`Ekipage ${eq.startNumber} (${eq.driverName}) inläst.`, true);
    } else {
      showAlert(`Hittade inget ekipage för namn: ${name}.`, false);
    }
  };

  onClassChange = (e, minHorseCount = 1) => {
    const currentHorseData = getHorseFormData();
    const raw = (e?.target?.value || '').toString().toLowerCase();
    const cls = ` ${raw.replace(/[^a-z0-9åäö\s-]/gi, ' ')} `;

    let baseHorseCount = 1, maxHorseCount = 1;
    if (/\bfyrspann\b/.test(cls) || /\bfyrsp\b/.test(cls)) {
      baseHorseCount = 4;
      maxHorseCount = 6;
    } else if (/\bpar\b(?!a)/.test(cls) || /\btvåspann\b/.test(cls) || /\b2\s*-\s*spann\b/.test(cls)) {
      baseHorseCount = 2;
      maxHorseCount = 3;
    }

    const fieldsToRender = Math.max(maxHorseCount, Number(minHorseCount) || 1);
    const horsesContainer = document.getElementById('horses-container');
    horsesContainer.innerHTML = '';
    const isBarn = document.getElementById('isBarnklassCheckbox').checked;

    for (let i = 1; i <= fieldsToRender; i++) {
      const isRequired = i <= baseHorseCount;
      const isReserve = i > baseHorseCount;
      horsesContainer.innerHTML += generateHorseFields(i, isRequired, isBarn, isReserve);
    }
    populateHorseFormData(currentHorseData);
  };

  startNumberInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      updateHorseNumbers(e.target.value);
      fillByStartNumber(e.target.value);
    }
  });

  driverInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      fillByDriverName(e.target.value);
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const startNumberInput = document.getElementById('startNumber');
    const startNumber = startNumberInput.value;
    if (!startNumber) {
      showAlert("Startnummer måste fyllas i.", false);
      startNumberInput.focus();
      return;
    }

    const horses = getHorseFormData();

    // --- NY LOGIK FÖR STATUS ---
    // Hitta det befintliga ekipaget i den lokala listan
    const existingEquipage = allEquipages.find(eq => eq.startNumber === parseInt(startNumber));

    // Om ekipaget finns, behåll dess status (t.ex. 'struken')
    // Om det är ett nytt ekipage, sätt status till 'anmäld'
    const equipageStatus = existingEquipage ? existingEquipage.status : 'anmäld';
    // --- SLUT PÅ NY LOGIK ---

    const equipageData = {
      startNumber: parseInt(startNumber),
      driverName: document.getElementById('driverName').value,
      email: (document.getElementById('driverEmail').value || '').trim().toLowerCase(),
      clubName: document.getElementById('clubName').value,
      className: document.getElementById('className').value,
      trackWidth: parseInt(document.getElementById('trackWidth').value) || null,
      marathonTrackWidth: parseInt(document.getElementById('marathonTrackWidth').value) || null,
      status: equipageStatus, // <-- Här används den nya variabeln
      horses: horses,
      groomName: document.getElementById('groomName').value || '',
      notes: document.getElementById('notes').value || '',
      payment: {
        status: document.getElementById('paymentStatus').value || '',
        amount: parseFloat(document.getElementById('paymentAmount').value) || null,
        method: '', // Bibehålls för datastruktur
        reference: '' // Bibehålls för datastruktur
      },
      adminComments: document.getElementById('adminComments').value || ''
    };

    try {
      await saveEquipage(competitionId, startNumber, equipageData);
      showAlert(`Ekipage #${startNumber} har sparats (Status: ${equipageStatus}).`);
      e.target.reset();
      document.getElementById('isBarnklassCheckbox').checked = false;
      populateClassSelect();
      onClassChange({ target: classSelect });
    } catch (error) {
      console.error("Kunde inte spara ekipage:", error);
      showAlert("Ett fel inträffade vid sparande.", false);
    }
  });

  classSelect.addEventListener('change', onClassChange);
  barnklassCheckbox.addEventListener('change', populateClassSelect);

  populateClassSelect();
  onClassChange({ target: classSelect });
};

// admin.js, ersätt hela funktionen

function setupJudgeForm() {
  const form = document.getElementById('adminJudgeForm');
  const judgeIdInput = document.getElementById('judgeId');
  const judgeNameInput = document.getElementById('judgeName');
  const rolesContainer = document.getElementById('judge-roles-container');
  const disciplineSelect = document.getElementById('new-role-discipline');
  const positionSelect = document.getElementById('new-role-position');
  const addRoleBtn = document.getElementById('add-judge-role-btn');
  const newJudgeBtn = document.getElementById('newJudgeBtn');
  const judgesList = document.getElementById('adminJudgesList');

  let currentRoles = [];

  // Visa/dölj positionsväljaren baserat på valt moment
  disciplineSelect.addEventListener('change', () => {
    positionSelect.classList.toggle('hidden', disciplineSelect.value !== 'dressage');
  });
  disciplineSelect.dispatchEvent(new Event('change')); // Kör vid start

  // Renderar de roller som finns i `currentRoles`-arrayen
  const renderRoles = () => {
    rolesContainer.innerHTML = '';
    if (currentRoles.length === 0) {
      rolesContainer.innerHTML = `<p class="text-xs text-gray-500 italic p-1">Inga roller tillagda.</p>`;
    }
    currentRoles.forEach((role, index) => {
      let roleText = '';
      switch (role.discipline) {
        case 'dressage': roleText = `Dressyr (Position: ${role.position || 'Okänd'})`; break;
        case 'precision': roleText = 'Precision'; break;
        case 'marathon': roleText = 'Maraton'; break;
        case 'overjudge': roleText = 'Överdomare'; break;
      }

      const roleEl = document.createElement('div');
      roleEl.className = 'flex items-center justify-between bg-white p-2 rounded-md border';
      roleEl.innerHTML = `
                <span class="text-sm">${roleText}</span>
                <button type="button" data-index="${index}" class="remove-role-btn text-red-500 font-bold text-xl">&times;</button>
            `;
      rolesContainer.appendChild(roleEl);
    });
  };

  // Lägg till en ny roll i `currentRoles`
  addRoleBtn.addEventListener('click', () => {
    const discipline = disciplineSelect.value;
    if (discipline === 'dressage') {
      const position = (positionSelect.value || '').toUpperCase();
      if (!position) {
        showAlert('Välj en position för dressyrdomaren.', false);
        return;
      }
      // uppdatera/ersätt ev. befintlig dressyrpost
      currentRoles = normalizeJudgeRoles([
        ...currentRoles.filter(r => r.discipline !== 'dressage'),
        { discipline: 'dressage', position }
      ]);
    } else {
      // precision/maraton/overjudge: lägg inte dubbletter
      if (!currentRoles.some(r => r.discipline === discipline)) {
        currentRoles.push({ discipline });
      }
    }
    renderRoles();
  });

  // Ta bort en roll från `currentRoles`
  rolesContainer.addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-role-btn')) {
      const index = parseInt(e.target.dataset.index, 10);
      currentRoles.splice(index, 1);
      renderRoles();
    }
  });

  const resetForm = () => {
    form.reset();
    judgeIdInput.value = '';
    currentRoles = [];
    renderRoles();
    disciplineSelect.dispatchEvent(new Event('change'));
  }

  newJudgeBtn.addEventListener('click', resetForm);

  // Ladda en domares data när man klickar i listan
  judgesList.addEventListener('click', (e) => {
    if (e.target.classList.contains('delete-judge-btn')) return;
    const judgeRow = e.target.closest('.clickable-judge');
    if (!judgeRow) return;

    const judgeId = judgeRow.dataset.judgeId;
    const judgeData = allJudges.find(j => j.id === judgeId);

    if (judgeData) {
      judgeIdInput.value = judgeData.id;
      judgeNameInput.value = judgeData.name;
      // VIKTIGT: Vi laddar nu in en array av roller
      currentRoles = normalizeJudgeRoles(judgeData.roles || []);
      renderRoles();
      form.scrollIntoView({ behavior: 'smooth' });
    }
  });

  // Spara domaren
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const judgeName = judgeNameInput.value.trim();
    if (!judgeName) return;

    let judgeId = judgeIdInput.value || judgeName.replace(/\s+/g, '-').toLowerCase();
    const judgeData = {
      id: judgeId,
      name: judgeName,
      roles: normalizeJudgeRoles(currentRoles)
    };

    try {
      await saveJudge(competitionId, judgeId, judgeData);
      showAlert(`Domare ${judgeName} har sparats.`);
      resetForm();
    } catch (error) {
      showAlert(`Kunde inte spara domare: ${error.message}`, false);
    }
  });

  // Initial rendering
  renderRoles();
}

function setupOfficialsForm() {
  const form = document.getElementById('adminOfficialForm');
  const roleSelect = document.getElementById('officialRole');
  const otherRoleContainer = document.getElementById('otherRoleContainer');
  const otherRoleInput = document.getElementById('officialRoleOther');

  roleSelect.addEventListener('change', () => {
    const isOther = roleSelect.value === 'Annat';
    otherRoleContainer.classList.toggle('hidden', !isOther);
    otherRoleInput.required = isOther;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const role = roleSelect.value === 'Annat' ? otherRoleInput.value.trim() : roleSelect.value;
    if (!role) {
      showAlert("Du måste ange en roll.", false);
      return;
    }
    const officialData = {
      name: document.getElementById('officialName').value,
      role: role,
      phone: document.getElementById('officialPhone').value || '',
      email: document.getElementById('officialEmail').value || ''
    };
    try {
      await saveOfficial(competitionId, officialData);
      showAlert(`Funktionär ${officialData.name} har lagts till.`);
      e.target.reset();
      otherRoleContainer.classList.add('hidden');
      otherRoleInput.required = false;
    } catch (error) {
      showAlert("Kunde inte spara funktionär.", false);
      console.error(error);
    }
  });
}

function setupImportForm(compId) {
  const form = document.getElementById('eqXmlImportForm');
  if (!form) return;
  const input = document.getElementById('eqXmlFile');
  const progress = document.getElementById('eqXmlImportProgress');
  const appClassList = Object.values(competitionClasses).flat();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!input.files || !input.files[0]) {
      showAlert('Välj en XML-fil först.', false);
      return;
    }
    const file = input.files[0];

    try {
      progress.innerHTML = 'Analyserar fil och matchar klasser...';
      progress.classList.remove('hidden');

      const importData = await parseEqEntriesXml(file);
      const equipagesFromFile = importData.equipages;

      if (!equipagesFromFile.length) {
        progress.textContent = 'Inga ekipage hittades i filen.';
        return;
      }

      if (importData.competitionInfo) {
        // spara som separat config-dokument, t.ex. "eqentriesImport"
        await saveConfig(compId, 'eqentriesImport', { importedCompetitionInfo: importData.competitionInfo });
        console.log('Sparade tävlingsinformation:', importData.competitionInfo);
      }


      // Bygg stabila unika “klass-nycklar” från TDB-klassnummer + label
      const uniqueXmlClasses = Array
        .from(new Map(
          equipagesFromFile.map(eq => {
            const key = (eq.tdbClassNumber != null)
              ? `NUM:${eq.tdbClassNumber}`   // stabil identitet via nummer
              : `NAME:${eq.className}`;      // fallback om nummer saknas
            // Visa för användaren: “<label> (TDB #123)” om nummer finns, annars bara label
            const display = (eq.tdbClassNumber != null)
              ? `${eq.tdbClassLabel || eq.className} (TDB #${eq.tdbClassNumber})`
              : `${eq.className}`;
            return [key, { key, display, className: eq.className, tdbClassNumber: eq.tdbClassNumber ?? null }];
          })
        ).values());

      // Bygg UI
      let mappingUI = `<h3 class="font-semibold mb-2">Steg 2: Mappa tävlingsklasser</h3>
<p class="text-sm text-gray-600 mb-4">Kontrollera och justera de automatiskt matchade klasserna.</p>`;
      const appClassOptions = appClassList.map(c => `<option value="${c}">${c}</option>`).join('');

      uniqueXmlClasses.forEach((item, index) => {
        const bestMatch = findBestClassMatch(item.className, appClassList);
        mappingUI += `
    <div class="grid grid-cols-2 gap-4 items-center mb-2 p-2 bg-gray-50 rounded">
      <div class="text-sm">
        <span class="font-semibold">Från fil:</span>
        <p class="text-gray-700 italic">"${item.display}"</p>
      </div>
      <div>
        <label for="mapping_${index}" class="text-sm font-semibold">Mappa till:</label>
        <select id="mapping_${index}" data-key="${item.key}" class="mt-1 block w-full p-2 border rounded-md">
          <option value="">-- Välj klass --</option>${appClassOptions}
        </select>
      </div>
    </div>`;
        if (bestMatch) {
          setTimeout(() => {
            const selectEl = document.getElementById(`mapping_${index}`);
            if (selectEl) selectEl.value = bestMatch;
          }, 0);
        }
      });

      mappingUI += `
  <div class="mt-4 p-3 rounded bg-amber-50 border border-amber-200">
    <label class="inline-flex items-center gap-2 text-sm">
      <input id="eqXmlMergePerTestChk" type="checkbox" class="h-4 w-4" checked>
      <span>Sammanslå per test (ignorera Häst/Ponny & Enbet/Par)</span>
    </label>
    <p class="text-xs text-amber-700 mt-1">När detta är valt sparas även fälten <code>mergedTestKey</code>/<code>mergedTestLabel</code> samt flaggan <code>useMergedTestForDisplay</code> på ekipagen.</p>
  </div>
  <button id="eqXmlDoFinalImport" class="mt-4 w-full bg-emerald-600 text-white py-2 px-4 rounded-lg hover:bg-emerald-700">Slutför Import</button>`;
      progress.innerHTML = mappingUI;

      document.getElementById('eqXmlDoFinalImport').onclick = async () => {
        const userClassMapping = new Map();
        uniqueXmlClasses.forEach((item, index) => {
          const selectElement = document.getElementById(`mapping_${index}`);
          if (selectElement && selectElement.value) {
            userClassMapping.set(item.key, selectElement.value);
          }
        });

        progress.innerHTML = 'Sparar importerad data...';
        let ok = 0, fail = 0;

        // Hjälpkarta för löpnummer per TDB-klassnyckel
        const tempCounters = new Map();

        for (const eqa of equipagesFromFile) {
          const key = (eqa.tdbClassNumber != null)
            ? `NUM:${eqa.tdbClassNumber}`
            : `NAME:${eqa.className}`;

          const mappedClass = userClassMapping.get(key);
          if (!mappedClass) continue;

          const mergeChecked = !!document.getElementById('eqXmlMergePerTestChk')?.checked;
          if (mergeChecked) {
            // flagga som säger åt vyerna att de får gruppera per merged test
            eqa.useMergedTestForDisplay = true;

            // säkerställ att mergedTest-fält finns (om XML/prop saknade etikett)
            if (!eqa.mergedTestKey || !eqa.mergedTestLabel) {
              const base = normalizeTestForMerge(eqa.tdbClassLabel || eqa.className || '');
              eqa.mergedTestKey = base.key;
              eqa.mergedTestLabel = base.label;
            }
          }

          eqa.className = mappedClass; // mappa till appens klass

          // NYTT: Sätt temporärt startnummer om det saknas
          if (eqa.startNumber == null || Number.isNaN(Number(eqa.startNumber))) {
            let c = tempCounters.get(key) || 0;
            c += 1;
            tempCounters.set(key, c);

            // Bas per TDB-klass → stabilt över importkörningar
            // Ex: TDB#9 ger 9000+räknare, annars (utan TDB#) 900000+räknare
            const base = (eqa.tdbClassNumber != null) ? (eqa.tdbClassNumber * 1000) : 900000;
            eqa.startNumber = base + c;          // alltid ett heltal
            eqa._tempStartNumber = true;         // markera som temporärt (om du vill visa i UI)
          }

          try {
            await saveEquipage(compId, eqa.startNumber, eqa);
            ok++;
          } catch (err) {
            console.warn('Kunde inte spara ekipage', eqa, err);
            fail++;
          }
          progress.textContent = `Sparar ekipage... (${ok} av ${equipagesFromFile.length} klara)`;
        }


        progress.textContent += ` | Importerar funktionärer...`;
        const stats = await importOfficialsFromXml(file, compId, allJudges, allOfficials);
        const message = `Import klar: ${ok} ekipage, ${stats.judges} nya domare och ${stats.officials} nya funktionärer importerade.${fail ? ` ${fail} ekipage misslyckades.` : ''}`;
        showAlert(message);
        progress.textContent = message;
        form.reset();
      };
    } catch (err) {
      console.error(err);
      showAlert(`Fel vid import: ${err.message || err}`, false);
      progress.textContent = `Fel vid import: ${err.message || err}`;
    }
  });
}

function setupClearButton() {
  const clearBtn = document.getElementById('clearEquipagesBtn');
  if (!clearBtn) return;

  clearBtn.addEventListener('click', async () => {
    if (confirm("Är du SÄKER på att du vill ta bort ALLA ekipage? Detta kan inte ångras.")) {
      if (allEquipages.length === 0) {
        showAlert("Listan är redan tom.", true);
        return;
      }
      showAlert(`Rensar ${allEquipages.length} ekipage...`, true);
      const deletePromises = allEquipages.map(equipage => deleteEquipage(competitionId, equipage.id));
      try {
        await Promise.all(deletePromises);
        showAlert("Alla ekipage har tagits bort.", true);
      } catch (error) {
        console.error("Fel vid rensning:", error);
        showAlert("Ett fel inträffade vid rensningen.", false);
      }
    }
  });
}

// --- Huvudfunktion ---
export async function load() {
  const competition = getGlobalState('currentCompetition');
  const page = document.getElementById('page-admin');

  if (!competition) {
    page.innerHTML = `<p class="p-8 text-center text-red-500">Ingen tävling vald.</p>`;
    return;
  }
  competitionId = competition.id;

  console.log("Tävlings-ID vid sidladdning:", competitionId);

  renderLayout(competition);

  setTimeout(() => {
    setupEquipageForm();
    setupJudgeForm();
    setupOfficialsForm();
    setupImportForm(competitionId);
    setupClearButton();

    listenForEquipages(competitionId, (equipages) => {
      allEquipages = equipages;
      renderAdminEquipageTable(equipages);
      renderClassNumberMergePanel(equipages);
    });

    listenForJudges(competitionId, (judges) => {
      allJudges = judges;
      renderJudgesList(judges);
    });

    listenForOfficials(competitionId, (officials) => {
      allOfficials = officials;
      renderOfficialsList(officials);
    });

    page.addEventListener('click', async (e) => {
      if (e.target.classList.contains('delete-judge-btn')) {
        const judgeId = e.target.dataset.id;
        if (confirm(`Är du säker på att du vill ta bort denna domare?`)) {
          await deleteJudge(competitionId, judgeId);
          showAlert('Domaren har tagits bort.');
        }
      }
      if (e.target.classList.contains('delete-official-btn')) {
        const officialId = e.target.dataset.id;
        if (confirm(`Är du säker på att du vill ta bort denna funktionär?`)) {
          await deleteOfficial(competitionId, officialId);
          showAlert('Funktionären har tagits bort.');
        }
      }
    });
  }, 0);
}