import {
    saveEquipage,
    deleteEquipage,
    getConfig,
    saveConfig,
    saveJudge,
    deleteJudge,
    saveOfficial,
    listenForEquipages,
    listenForJudges
} from '../services/firestoreService.js';
import { showAlert } from '../ui/components.js';
import { competitionClasses, klassProgramMapping } from '../data/competitionData.js';

let allEquipages = [];
let allJudges = [];
let allOfficials = [];
let sortConfig = { key: 'restartNumber', direction: 'asc' };
let competitionId = null;

export function setCompetitionId(id) {
    competitionId = id;
}



export function getParticipantsHtml() {
    return `
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        <div class="lg:col-span-1 space-y-8"> 
            <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border dark:border-gray-700">
                <h2 class="text-2xl font-semibold mb-4 border-b dark:border-gray-700 pb-2 dark:text-white">Lägg till/uppdatera Ekipage</h2>
                <form id="adminEquipageForm" class="space-y-4">
                    <div><label for="startNumber" class="block text-sm font-medium dark:text-gray-300">Startnr*</label><input type="number" id="startNumber" required class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400"></div>
                    <div class="flex items-center mb-2">
                        <input type="checkbox" id="isBarnklassCheckbox" class="h-4 w-4 rounded border-gray-300 dark:bg-gray-700 dark:border-gray-600 focus:ring-blue-500 dark:focus:ring-blue-400">
                        <label for="isBarnklassCheckbox" class="ml-2 block text-sm font-medium dark:text-gray-300">Detta är en barnklass</label>
                    </div>
                    <div class="flex items-center mb-2">
                        <input type="checkbox" id="isParaCheckbox" class="h-4 w-4 rounded border-gray-300 dark:bg-gray-700 dark:border-gray-600 focus:ring-blue-500 dark:focus:ring-blue-400">
                        <label for="isParaCheckbox" class="ml-2 block text-sm font-medium dark:text-gray-300">Parakusk (Tvinga Para-tempo)</label>
                    </div>
                    <div><label for="driverName" class="block text-sm font-medium dark:text-gray-300">Kuskens namn*</label><input type="text" id="driverName" required class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400"></div>
                    <div><label for="driverEmail" class="block text-sm font-medium dark:text-gray-300">E-post (för inloggning)</label><input type="email" id="driverEmail" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400" placeholder="ex: namn@example.com"></div>
                    <div><label for="groomName" class="block text-sm font-medium dark:text-gray-300">Groom</label><input type="text" id="groomName" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400"></div>
                    
                    <div class="p-3 bg-gray-50 dark:bg-gray-700/50 rounded border dark:border-gray-600 mt-2 space-y-3">
                        <h3 class="font-bold text-sm text-gray-700 dark:text-gray-200">Utökad Kusk-info (TDB/Import)</h3>
                        <div class="grid grid-cols-2 gap-3">
                            <div><label for="driverSSN" class="block text-xs font-medium dark:text-gray-400">Personnummer</label><input type="text" id="driverSSN" class="mt-1 block w-full p-1 border rounded text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"></div>
                            <div><label for="driverBornYear" class="block text-xs font-medium dark:text-gray-400">Födelseår</label><input type="text" id="driverBornYear" class="mt-1 block w-full p-1 border rounded text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"></div>
                        </div>
                        <div class="grid grid-cols-2 gap-3">
                            <div><label for="driverPhone" class="block text-xs font-medium dark:text-gray-400">Telefon</label><input type="text" id="driverPhone" class="mt-1 block w-full p-1 border rounded text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"></div>
                            <div><label for="driverCountry" class="block text-xs font-medium dark:text-gray-400">Land</label><input type="text" id="driverCountry" class="mt-1 block w-full p-1 border rounded text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"></div>
                        </div>
                        <div class="grid grid-cols-2 gap-3">
                            <div><label for="driverLicense" class="block text-xs font-medium dark:text-gray-400">Licensnr</label><input type="text" id="driverLicense" class="mt-1 block w-full p-1 border rounded text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"></div>
                            <div><label for="driverLicenseYear" class="block text-xs font-medium dark:text-gray-400">Licensår</label><input type="text" id="driverLicenseYear" class="mt-1 block w-full p-1 border rounded text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"></div>
                        </div>
                        <div class="grid grid-cols-2 gap-3">
                            <div><label for="driverGender" class="block text-xs font-medium dark:text-gray-400">Kön</label><input type="text" id="driverGender" class="mt-1 block w-full p-1 border rounded text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"></div>
                            <div><label for="driverCompany" class="block text-xs font-medium dark:text-gray-400">Företag</label><input type="text" id="driverCompany" class="mt-1 block w-full p-1 border rounded text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"></div>
                        </div>
                        <div><label class="block text-xs font-medium dark:text-gray-400">Adress</label>
                            <input type="text" id="driverStreet" placeholder="Gata" class="mt-1 block w-full p-1 border rounded text-sm mb-1 dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                            <div class="grid grid-cols-3 gap-2">
                                <input type="text" id="driverZip" placeholder="Postnr" class="col-span-1 block w-full p-1 border rounded text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                                <input type="text" id="driverCity" placeholder="Ort" class="col-span-2 block w-full p-1 border rounded text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                            </div>
                        </div>
                    </div>
                    <div><label for="clubName" class="block text-sm font-medium dark:text-gray-300">Klubb*</label><input type="text" id="clubName" required class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white"></div>
                    <div><label for="className" class="block text-sm font-medium dark:text-gray-300">Klass*</label><select id="className" required class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white"></select></div>
                    <div><label for="trackWidth" class="block text-sm font-medium dark:text-gray-300">Vagnbredd dressyr/precision (cm)</label><input type="number" id="trackWidth" placeholder="ex: 125" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white"></div>
                    <div>
                        <label for="marathonTrackWidth" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Vagnbredd – Maraton (cm)</label>
                        <input type="number" id="marathonTrackWidth" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="t.ex. 126">
                    </div>
                    <div>
                        <label for="notes" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Noteringar (från PM)</label>
                        <textarea id="notes" rows="3" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white"></textarea>
                    </div>

                    <div class="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg border dark:border-gray-600">
                        <h3 class="font-semibold mb-2 dark:text-gray-200">Betalning</h3>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label for="paymentStatus" class="block text-sm font-medium dark:text-gray-300">Status</label>
                                <select id="paymentStatus" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                                <option value="">Okänd</option>
                                <option value="paid">Betald</option>
                                <option value="partial">Delbetald</option>
                                <option value="unpaid">Obetald</option>
                                </select>
                            </div>
                            <div>
                                <label for="paymentAmount" class="block text-sm font-medium dark:text-gray-300">Summa (kr)</label>
                                <input type="number" id="paymentAmount" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="t.ex. 600">
                            </div>
                        </div>
                    </div>
                    
                    <div>
                        <label for="adminComments" class="block text-sm font-medium dark:text-gray-300">Kommentarer (sekretariat)</label>
                        <textarea id="adminComments" rows="2" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="Intern kommentar..."></textarea>
                    </div>
                    <div id="horses-container" class="space-y-6"></div>
                    <button type="submit" class="w-full bg-brand-darkblue dark:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg hover:bg-brand-gold hover:text-brand-darkblue dark:hover:bg-blue-600 transition-colors">Spara Ekipage</button>
                </form>
            </div>
            
            <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border dark:border-gray-700">
                <h2 class="text-2xl font-semibold mb-4 border-b dark:border-gray-700 pb-2 dark:text-white">Importera / Rensa</h2>
                <div class="space-y-4">
                    <form id="eqXmlImportForm">
                        <div>
                        <label for="eqXmlFile" class="block text-sm font-medium dark:text-gray-300">Välj .eqentries.xml för import</label>
                        <input type="file" id="eqXmlFile" accept=".xml" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300 dark:file:bg-gray-600 dark:file:text-white" required />
                        </div>
                        <button type="submit" class="w-full bg-emerald-600 dark:bg-emerald-700 text-white font-semibold py-2 px-4 rounded-lg hover:bg-emerald-700 dark:hover:bg-emerald-600 mt-2">
                        Importera
                        </button>
                        <div id="eqXmlImportProgress" class="hidden mt-3 text-sm text-gray-700 dark:text-gray-300"></div>
                    </form>
                    
                    <div class="pt-4 border-t dark:border-gray-700">
                        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Rensa tävlingsdata</label>
                        <p class="text-xs text-gray-500 dark:text-gray-400 mb-2">Detta tar permanent bort ALLA anmälda ekipage från denna tävling.</p>
                        <button type="button" id="clearEquipagesBtn" class="w-full bg-red-600 dark:bg-red-700 text-white font-semibold py-2 px-4 rounded-lg hover:bg-red-700 dark:hover:bg-red-600">
                        Töm ekipage-listan
                        </button>
                    </div>

                    <div class="pt-4 border-t dark:border-gray-700">
                        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Hantera Klasser</label>
                        <p class="text-xs text-gray-500 dark:text-gray-400 mb-2">Döp om klasser och lägg till klassnummer.</p>
                         <button type="button" id="manageClassesBtn" class="w-full bg-blue-600 dark:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600">
                           Hantera Klasser (Numrering)
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <div class="lg:col-span-2 space-y-8">
            <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border dark:border-gray-700">
                <h2 class="text-2xl font-semibold mb-2 dark:text-white">Anmälda Ekipage</h2>
                <div id="mergePanel" class="mb-4 hidden"></div>
                <!-- Fix height and overflow for sticky header -->
                <div class="max-h-[800px] overflow-y-auto border dark:border-gray-700 rounded-lg relative">
                <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700 responsive-table">
                    <thead id="adminEquipageTableHead" class="bg-gray-50 dark:bg-gray-700 sticky top-0 z-10 shadow-sm"></thead>
                    <tbody id="adminEquipageTableBody" class="dark:text-gray-200 bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700"></tbody>
                    </table>
                </div>
            </div>

            <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border dark:border-gray-700" id="judge-section-wrapper">
                <h2 class="text-2xl font-semibold mb-4 border-b dark:border-gray-700 pb-2 dark:text-white">Domare</h2>
                <form id="adminJudgeForm" class="space-y-4 bg-gray-50 dark:bg-gray-700/50 p-4 rounded-lg">
                    <input type="hidden" id="judgeId">
                    <div>
                        <label for="judgeName" class="block text-sm font-medium dark:text-gray-300">Domarens Namn</label>
                        <input type="text" id="judgeName" required class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium dark:text-gray-300">Roller & Moment</label>
                        <div id="judge-roles-container" class="mt-2 space-y-2"></div>
                    </div>
                    
                    <div id="judge-classes-container"></div>

                    <div class="p-3 border dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 space-y-3">
                        <div class="grid grid-cols-2 gap-3">
                            <select id="new-role-discipline" class="block w-full p-2 border rounded-md text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                                <option value="dressage">Dressyr</option>
                                <option value="precision">Precision</option>
                                <option value="marathon">Maraton</option>
                                <option value="overjudge">Överdomare</option>
                            </select>
                            <select id="new-role-position" class="block w-full p-2 border rounded-md text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white">
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
                        <button type="button" id="add-judge-role-btn" class="w-full bg-gray-600 dark:bg-gray-700 text-white font-semibold py-2 px-3 rounded-lg hover:bg-gray-700 dark:hover:bg-gray-600 text-sm border dark:border-gray-600">
                            Lägg till Roll
                        </button>
                    </div>
                    <div class="mt-3 text-xs bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded p-3 leading-relaxed dark:text-gray-300">
                    <p class="font-semibold text-blue-800 dark:text-blue-300">Dressyr – domarplaceringar</p>
                    <p>C (presiderande), E och B (långsidor), H och M (hörn vid C), F och K (hörn vid A).</p>
                    <p class="mt-1"><span class="font-medium">Vanliga uppsättningar:</span>
                        1 domare: C ·
                        3 domare: C, E, B ·
                        5 domare: H, C, M, E, B ·
                        7 domare: K, F, H, C, M, E, B
                    </p>
                    </div>

                    <div class="flex items-center gap-4 pt-2">
                        <button type="submit" class="flex-1 bg-brand-darkblue dark:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg hover:bg-brand-gold hover:text-brand-darkblue dark:hover:bg-blue-600 transition-colors">Spara domare</button>
                        <button type="button" id="newJudgeBtn" class="flex-1 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-white font-semibold py-2 px-4 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500">Rensa formulär</button>
                    </div>
                </form>

                <h3 class="text-xl font-semibold mt-6 mb-4 border-b dark:border-gray-700 pb-2 dark:text-white">Tävlingens Domare</h3>
                <p class="text-sm text-gray-500 dark:text-gray-400 mb-2">Klicka på en domare för att redigera.</p>
                <div id="adminJudgesList" class="space-y-2"></div>
            </div>
        </div>
    </div>
    `;
}

// --- SETUP ---
let onClassChange;

// --- CLEAR BUTTON LOGIC ---
function setupClearButton(competitionId) {
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

export function setupParticipantsLogic(compId) {
    competitionId = compId;
    setupEquipageForm();
    setupImportForm(compId);
    setupClearButton(compId);
    setupJudgeForm();
    setupClassManager(compId);
    // Listeners are handled by admin.js calling updateEquipages/updateJudges
}

export function updateEquipages(equipages) {
    console.log(`[Admin] updateEquipages called with ${equipages ? equipages.length : 0} items.`);
    const updatedEq = (equipages || []).find(e => e.startNumber == 11); // Hardcoded debug check for the user's specific case if checking #11
    if (updatedEq) console.log(`[Admin] updateEquipages: found #11, isPara = ${!!updatedEq.isPara} `);

    allEquipages = equipages;
    renderAdminEquipageTable(allEquipages);

    // Ensure merge panel has correct structure
    const mergeRoot = document.getElementById('mergePanel');
    if (mergeRoot) {
        mergeRoot.classList.remove('hidden');

        // Only reset structure if needed to preserve focus/state? 
        // Actually, re-rendering usually clears anyway.
        // Let's create two distinct containers.
        if (!document.getElementById('mergePanelAuto')) {
            mergeRoot.innerHTML = `
            <div id="mergePanelManual" class="mb-4 pt-4"></div>
    `;
        }
        // renderMergePanel(allEquipages); 
        renderClassNumberMergePanel(allEquipages);
    }
}

export function updateJudges(judges) {
    allJudges = judges;
    renderAdminJudgesList(judges);
}

export function updateOfficials(officials) {
    allOfficials = officials || [];
}

// Bind global judge delete action if not already handled
const judgesList = document.getElementById('adminJudgesList');
if (judgesList) {
    judgesList.onclick = async (e) => {
        if (e.target.classList.contains('delete-judge-btn')) {
            const judgeId = e.target.dataset.id;
            if (confirm(`Är du säker på att du vill ta bort denna domare ? `)) {
                await deleteJudge(competitionId, judgeId);
                showAlert('Domaren har tagits bort.');
            }
        }
    };
}


// ... (Equipage Form Functions: setupEquipageForm, generateHorseFields, etc. - SAME AS BEFORE, omitted for brevity but I will include them in full if I can, I'll trust standard implementation)
// To keep the file valid, I MUST include them.

function setupEquipageForm() {
    // ... (Standard content from previous step)
    // Copied from Step 326
    const form = document.getElementById('adminEquipageForm');
    if (!form) return;
    const classSelect = document.getElementById('className');
    const startNumberInput = document.getElementById('startNumber');
    const driverInput = document.getElementById('driverName');
    const barnklassCheckbox = document.getElementById('isBarnklassCheckbox');
    const paraCheckbox = document.getElementById('isParaCheckbox');

    const populateClassSelect = () => {
        const isBarnklass = barnklassCheckbox.checked;
        const currentSelectedClass = classSelect.value;
        classSelect.innerHTML = '<option value="">Välj klass...</option>';

        // NYTT: Hämta aktiva dynamiska klasser från allEquipages som inte finns i standardlistan
        const activeClasses = [...new Set((allEquipages || []).map(e => e.className).filter(Boolean))];
        const customClasses = activeClasses.filter(c => {
            for (const group in competitionClasses) {
                if (competitionClasses[group].includes(c)) return false;
            }
            return true;
        });

        customClasses.sort((a, b) => a.localeCompare(b));

        if (customClasses.length > 0) {
            const optGrp = document.createElement('optgroup');
            optGrp.label = "Aktiva (Omstöpta/TDB)";
            customClasses.forEach(c => {
                const isBarn = c.toLowerCase().includes('barn');
                if (isBarnklass && !isBarn) return;
                if (!isBarnklass && isBarn) return;

                const option = document.createElement('option');
                option.value = c;
                option.textContent = c;
                optGrp.appendChild(option);
            });
            if (optGrp.children.length > 0) classSelect.appendChild(optGrp);
        }

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
        }
    };

    // Expose globally so it can be called when equipages are loaded
    window.populateAdminClassSelect = populateClassSelect;

    const populateEquipageForm = (eq) => {
        document.getElementById('startNumber').value = eq.startNumber || '';
        document.getElementById('driverName').value = eq.driverName || '';
        document.getElementById('driverEmail').value = eq.email || '';
        document.getElementById('clubName').value = eq.clubName || '';
        barnklassCheckbox.checked = !!((eq.className || '').toLowerCase().includes('barn')); // Auto-detect from class name often better? Or explicit field?
        // Using explicit field if we had one, but we rely on class name for filtering

        const isParaVal = !!eq.isPara;
        console.log(`[Admin] Loading equipage ${eq.startNumber}, isPara = ${isParaVal} `);
        paraCheckbox.checked = isParaVal;

        populateClassSelect(); // Filter classes based on barn/not
        classSelect.value = eq.className || '';

        document.getElementById('trackWidth').value = eq.trackWidth || '';
        document.getElementById('marathonTrackWidth').value = eq.marathonTrackWidth || '';
        document.getElementById('groomName').value = eq.groomName || '';
        document.getElementById('notes').value = eq.notes || '';
        document.getElementById('adminComments').value = eq.adminComments || '';

        // Payment
        document.getElementById('paymentStatus').value = eq.paymentStatus || '';
        document.getElementById('paymentAmount').value = eq.paymentAmount || '';

        // Generic horses
        const count = eq.horses ? eq.horses.length : 1;
        // Trigger generic "change" to rebuild fields? No, specialized fill
        const container = document.getElementById('horses-container');
        container.innerHTML = '';
        const isBarn = barnklassCheckbox.checked;

        // We need to know how many fields to show. Usually horses.length.
        // But if 0/undefined? Default 1.
        for (let i = 1; i <= Math.max(1, count); i++) {
            // Logic to guess if base horse or extra
            // Simplified: just render all linearly
            // But we want visual separation. 
            // We can reuse generateHorseFields logic if we extract numbers.
            container.innerHTML += generateHorseFields(i, i <= 4, isBarn, i > 4);
            // Ideally we see if class is 4-in-hand to set headers.
            // But for edit, just listing them is fine.
        }
        populateHorseFormData(eq.horses || []);

        // Expanded fields
        document.getElementById('driverSSN').value = eq.driverSSN || '';
        document.getElementById('driverBornYear').value = eq.driverBornYear || '';
        document.getElementById('driverPhone').value = eq.phone || ''; // check mapping
        document.getElementById('driverCountry').value = eq.country || '';
        document.getElementById('driverLicense').value = eq.driverLicenseId || '';
        document.getElementById('driverLicenseYear').value = eq.licenseYear || '';
        document.getElementById('driverGender').value = eq.gender || '';
        document.getElementById('driverCompany').value = eq.company || '';
        document.getElementById('driverStreet').value = eq.street || '';
        document.getElementById('driverZip').value = eq.zip || '';
        document.getElementById('driverCity').value = eq.city || '';
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
        }
    };

    const fillByDriverName = (name) => {
        name = String(name || '').trim().toLowerCase();
        if (!name) return;
        const eq = (allEquipages || []).find(x => (x.driverName || '').toLowerCase().includes(name));
        if (eq) {
            // ... existing logic
            populateEquipageForm(eq);
            showAlert(`Ekipage ${eq.startNumber} (${eq.driverName}) inläst.`, true);
        }
    };

    onClassChange = (e, minHorseCount = 1) => {
        const currentHorseData = getHorseFormData();
        const raw = (e?.target?.value || '').toString().toLowerCase();
        const cls = ` ${raw.replace(/[^a-z0-9åäö\s-]/gi, ' ')} `;
        let baseHorseCount = 1, max = 1;
        if (/\bfyrspann\b/.test(cls) || /\bfyrsp\b/.test(cls)) { baseHorseCount = 4; max = 6; }
        else if (/\bpar\b(?!a)/.test(cls) || /\btvåspann\b/.test(cls)) { baseHorseCount = 2; max = 3; }

        const fields = Math.max(max, Number(minHorseCount) || 1);
        const container = document.getElementById('horses-container');
        container.innerHTML = '';
        const isBarn = barnklassCheckbox.checked;
        for (let i = 1; i <= fields; i++) {
            container.innerHTML += generateHorseFields(i, i <= baseHorseCount, isBarn, i > baseHorseCount);
        }
        populateHorseFormData(currentHorseData);
    };

    startNumberInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); updateHorseNumbers(e.target.value); fillByStartNumber(e.target.value); } });
    driverInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fillByDriverName(e.target.value); } });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const startNumber = document.getElementById('startNumber').value;
        const horses = getHorseFormData();
        const existing = allEquipages.find(eq => eq.startNumber === parseInt(startNumber));
        const status = existing ? existing.status : 'anmäld';

        // ... Gather data ...
        const equipageData = {
            startNumber: parseInt(startNumber),
            driverName: document.getElementById('driverName').value,
            email: document.getElementById('driverEmail').value,
            clubName: document.getElementById('clubName').value,
            className: document.getElementById('className').value,
            isPara: ((() => {
                const val = paraCheckbox.checked;
                console.log(`[Admin] Saving equipage ${document.getElementById('startNumber').value}, isPara = ${val} `);
                return val;
            })()), // <--- SAVE PARA FLAG (Logged)
            trackWidth: parseInt(document.getElementById('trackWidth').value) || null,
            marathonTrackWidth: parseInt(document.getElementById('marathonTrackWidth').value) || null,
            status: status,
            horses: horses,
            groomName: document.getElementById('groomName').value,
            notes: document.getElementById('notes').value,
            payment: {
                status: document.getElementById('paymentStatus').value,
                amount: parseFloat(document.getElementById('paymentAmount').value),
            },
            adminComments: document.getElementById('adminComments').value,
            ssn: document.getElementById('driverSSN').value,
            phone: document.getElementById('driverPhone').value,
            licenseNo: document.getElementById('driverLicense').value,
            licenseYear: document.getElementById('driverLicenseYear').value,
            bornYear: document.getElementById('driverBornYear').value,
            gender: document.getElementById('driverGender').value,
            country: document.getElementById('driverCountry').value,
            company: document.getElementById('driverCompany').value,
            address: {
                street: document.getElementById('driverStreet').value,
                zipCode: document.getElementById('driverZip').value,
                city: document.getElementById('driverCity').value
            }
        };

        try {
            await saveEquipage(competitionId, startNumber, equipageData);
            showAlert(`Ekipage #${startNumber} har sparats.`);
            e.target.reset();
            populateClassSelect();
            onClassChange({ target: classSelect });
        } catch (err) { showAlert("Fel vid sparande.", false); }
    });

    classSelect.addEventListener('change', onClassChange);
    barnklassCheckbox.addEventListener('change', populateClassSelect);
    populateClassSelect();
    onClassChange({ target: classSelect });
}

// ... (Helpers: generateHorseFields, updateHorseNumbers, populateEquipageForm, getHorseFormData, populateHorseFormData - Assuming implemented identical to existing admin.js)

function generateHorseFields(index, isRequired, isBarn = false, isReserve = false) {
    const req = isRequired ? 'required' : '';
    const title = isReserve ? `Häst ${index} (Reserv)` : `Häst ${index}`;
    const types = isBarn ? `<option value="A-ponny">A-ponny</option><option value="B-ponny">B-ponny</option><option value="C-ponny">C-ponny</option>`
        : `<option value="Häst">Häst</option><option value="A-ponny">A-ponny</option><option value="B-ponny">B-ponny</option><option value="C-ponny">C-ponny</option><option value="D-ponny">D-ponny</option>`;
    return `<div class="p-4 border border-gray-200 dark:border-gray-600 rounded-lg space-y-3 mt-4">
    <h3 class="font-semibold text-md dark:text-gray-200">${title}</h3>
    <div class="grid grid-cols-2 gap-4">
       <div><label class="dark:text-gray-300">ID</label><input type="text" id="horseId_${index}" readonly class="w-full p-2 border bg-gray-100 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300"></div>
       <div><label class="dark:text-gray-300">Namn${isRequired ? '*' : ''}</label><input type="text" id="horseName_${index}" ${req} class="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"></div>
    </div>
    <div class="grid grid-cols-2 gap-4">
       <div><label class="dark:text-gray-300">Typ</label><select id="horseType_${index}" ${req} class="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"><option value="">Välj</option>${types}</select></div>
       <div><label class="dark:text-gray-300">Kön</label><input type="text" id="gender_${index}" class="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"></div>
    </div>
     <div class="grid grid-cols-3 gap-4">
        <div><label class="dark:text-gray-300">Färg</label><input type="text" id="color_${index}" class="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"></div>
        <div><label class="dark:text-gray-300">Ras</label><input type="text" id="breed_${index}" class="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"></div>
        <div><label class="dark:text-gray-300">Födelseår</label><input type="text" id="bornYear_${index}" class="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"></div>
    </div>
     <div class="grid grid-cols-2 gap-4">
        <div><label class="dark:text-gray-300">Chip</label><input type="text" id="chip_${index}" class="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"></div>
        <div><label class="dark:text-gray-300">UELN</label><input type="text" id="ueln_${index}" class="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"></div>
    </div>
     <div class="grid grid-cols-3 gap-4">
        <div><label class="dark:text-gray-300">Licens</label><input type="text" id="license_${index}" class="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"></div>
        <div><label class="dark:text-gray-300">Lic.År</label><input type="text" id="licenseYear_${index}" class="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"></div>
        <div><label class="dark:text-gray-300">FEI</label><input type="text" id="feiPass_${index}" class="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"></div>
    </div>
    <div class="hidden"><input type="text" id="studbook_${index}"></div>
  </div>`;
}

function updateHorseNumbers(startNumber) {
    const num = parseInt(startNumber);
    if (!num) return;
    const fields = document.querySelectorAll('[id^="horseId_"]');
    fields.forEach((f, i) => { f.value = fields.length === 1 ? (100 + num) : `${100 + num} ${String.fromCharCode(65 + i)} ` });
}

function populateEquipageForm(data) {
    document.getElementById('startNumber').value = data.startNumber || '';
    document.getElementById('driverName').value = data.driverName || '';
    document.getElementById('driverEmail').value = data.email || '';
    document.getElementById('clubName').value = data.clubName || '';
    document.getElementById('driverSSN').value = data.ssn || '';
    document.getElementById('driverPhone').value = data.phone || '';
    document.getElementById('driverLicense').value = data.licence || data.licenseNo || '';
    document.getElementById('driverLicenseYear').value = data.licenseYear || '';
    document.getElementById('driverBornYear').value = data.bornYear || '';
    document.getElementById('driverGender').value = data.gender || '';
    document.getElementById('driverCountry').value = data.country || '';
    document.getElementById('driverCompany').value = data.company || '';

    // Fix: Handle isPara in global function
    const paraCheckbox = document.getElementById('isParaCheckbox');
    if (paraCheckbox) {
        paraCheckbox.checked = !!data.isPara;
        console.log(`[Admin] Global populateEquipageForm: Loaded isPara = ${paraCheckbox.checked} for #${data.startNumber}`);
    }

    // Address
    const addr = data.address || {};
    document.getElementById('driverStreet').value = addr.street || '';
    document.getElementById('driverZip').value = addr.zipCode || '';
    document.getElementById('driverCity').value = addr.city || '';

    // Other fields
    document.getElementById('groomName').value = data.groomName || '';
    document.getElementById('trackWidth').value = data.trackWidth || '';
    document.getElementById('marathonTrackWidth').value = data.marathonTrackWidth || '';
    document.getElementById('notes').value = data.notes || '';
    document.getElementById('adminComments').value = data.adminComments || '';

    // Payment
    const pay = data.payment || {};
    document.getElementById('paymentStatus').value = pay.status || 'unpaid';
    document.getElementById('paymentAmount').value = pay.amount || '';

    document.getElementById('className').value = data.className || '';
    if (onClassChange) onClassChange({ target: document.getElementById('className') }, (data.horses || []).length);
    setTimeout(() => { populateHorseFormData(data.horses); updateHorseNumbers(data.startNumber); }, 50);
}

function formatPaymentStatus(p) {
    if (!p) return '<span class="text-red-400">Ej betald</span>';
    if (p.status === 'paid') return `<span class="text-green-600 font-bold">✓ ${p.amount ? p.amount + ' kr' : ''}</span>`;
    if (p.status === 'partial') return `<span class="text-amber-600 font-bold">Delvis ${p.amount ? '(' + p.amount + ' kr)' : ''}</span>`;
    return '<span class="text-red-400">Ej betald</span>';
}

function getHorseFormData() {
    const res = [];
    for (let i = 1; i <= 6; i++) {
        if (document.getElementById(`horseName_${i}`)?.value) {
            res.push({
                id: document.getElementById(`horseId_${i}`).value,
                name: document.getElementById(`horseName_${i}`).value,
                type: document.getElementById(`horseType_${i}`).value,
                bornYear: document.getElementById(`bornYear_${i}`).value,
                gender: document.getElementById(`gender_${i}`).value,
                color: document.getElementById(`color_${i}`).value,
                breed: document.getElementById(`breed_${i}`).value,
                chip: document.getElementById(`chip_${i}`).value,
                ueln: document.getElementById(`ueln_${i}`).value,
                license: document.getElementById(`license_${i}`).value,
                licenseYear: document.getElementById(`licenseYear_${i}`).value,
                feiPass: document.getElementById(`feiPass_${i}`).value
            });
        }
    }
    return res;
}

function populateHorseFormData(arr) {
    if (!arr) return;
    arr.forEach((h, i) => {
        const idx = i + 1;
        if (document.getElementById(`horseName_${idx}`)) {
            document.getElementById(`horseName_${idx}`).value = h.name || '';
            document.getElementById(`horseType_${idx}`).value = h.type || '';
            document.getElementById(`bornYear_${idx}`).value = h.bornYear || '';
            document.getElementById(`gender_${idx}`).value = h.gender || '';
            document.getElementById(`color_${idx}`).value = h.color || '';
            document.getElementById(`breed_${idx}`).value = h.breed || '';
            document.getElementById(`chip_${idx}`).value = h.chip || '';
            document.getElementById(`ueln_${idx}`).value = h.ueln || '';
            document.getElementById(`license_${idx}`).value = h.license || '';
            document.getElementById(`licenseYear_${idx}`).value = h.licenseYear || '';
            document.getElementById(`feiPass_${idx}`).value = h.feiPass || '';
        }
    });
}

function renderAdminEquipageTable(equipages) {
    const head = document.getElementById('adminEquipageTableHead');
    const body = document.getElementById('adminEquipageTableBody');
    if (!body || !head) return;

    head.innerHTML = `<tr>
        <th class="p-3 text-left dark:text-gray-300">Startnr</th>
        <th class="p-3 text-left dark:text-gray-300">Kusk</th>
        <th class="p-3 text-left dark:text-gray-300">Klass</th>
        <th class="p-3 text-left dark:text-gray-300">Vagn</th>
        <th class="p-3 text-left dark:text-gray-300">Betald</th>
        <th class="p-3 text-left dark:text-gray-300">Status</th>
    </tr>`;
    body.innerHTML = equipages.sort((a, b) => a.startNumber - b.startNumber).map((e, idx) => `
        <tr class="hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer dark:text-gray-200" id="row-${e.startNumber}">
        <td class="p-3 font-bold">${e.startNumber}</td>
        <td class="p-3">${e.driverName}<div class="text-xs text-gray-500 dark:text-gray-400">${e.clubName}</div></td>
        <td class="p-3">${(e.useMergedTestForDisplay && e.mergedTestLabel) ? e.mergedTestLabel : e.className}</td>
        <td class="p-3 text-sm text-gray-600 dark:text-gray-400">${e.trackWidth || '-'} cm</td>
     <td class="p-3">${formatPaymentStatus(e.payment)}</td>
        <td class="p-3 ${e.status === 'struken' ? 'text-red-500 dark:text-red-400' : 'text-green-600 dark:text-green-400'}">${e.status}</td>
    </tr>
        `).join('');

    // Re-attach click listeners properly
    const sorted = equipages.sort((a, b) => a.startNumber - b.startNumber);
    Array.from(body.rows).forEach((row, idx) => {
        row.onclick = () => { populateEquipageForm(sorted[idx]); document.getElementById('adminEquipageForm').scrollIntoView({ behavior: 'smooth' }); };
    });

    // NYTT: Uppdatera klass-dropdown när vi har laddat in ekipagen (så dynamiska namn dyker upp)
    if (typeof window.populateAdminClassSelect === 'function') {
        window.populateAdminClassSelect();
    }
}


// --- JUDGE LOGIC (Integrated from Admin.js) ---
let currentRoles = []; // State for the judge currently being edited

function renderAdminJudgesList(judges) {
    const list = document.getElementById('adminJudgesList');
    if (!list) return;

    list.innerHTML = judges.map(j => {
        const roles = (j.roles || []).map(r => {
            if (r.discipline === 'dressage') return `Huvuddomare / Gästdomare – ${r.position || 'Domare'}`;
            if (r.discipline === 'precision') return 'Precisionsdomare';
            if (r.discipline === 'marathon') return 'Maratondomare';
            if (r.discipline === 'overjudge') return 'Överdomare';
            return r.discipline;
        }).join(', ');
        return `
        <div class="flex justify-between items-center p-3 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded shadow-sm clickable-judge cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors" data-judge-id="${j.id}">
            <div>
                <div class="font-bold text-gray-800 dark:text-gray-200">${j.name}</div>
                <div class="text-sm text-gray-500 dark:text-gray-400">${roles || 'Inga roller'}</div>
                <div class="text-xs text-gray-400 dark:text-gray-500 mt-1">${(j.classes || []).join(', ')}</div>
            </div>
            <button class="delete-judge-btn text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 p-2 rounded-full hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors" data-id="${j.id}" title="Ta bort domare">
                🗑️
            </button>
        </div>
        `;
    }).join('');

    // Re-attach click listeners handled globally or here?
    // We already have a global listener in setupParticipantsLogic for the DELETE button.
    // We also need one for clicking the row to EDIT (which populates the form).
    // Let's add the EDIT listener here directly to the rows.
    Array.from(list.children).forEach(row => {
        if (!row.classList.contains('clickable-judge')) return;
        row.addEventListener('click', (e) => {
            if (e.target.closest('.delete-judge-btn')) return; // handled by global listener
            const id = row.dataset.judgeId;
            const judge = judges.find(j => j.id === id);
            if (judge) {
                document.getElementById('judgeId').value = judge.id;
                document.getElementById('judgeName').value = judge.name;
                currentRoles = (judge.roles || []).map(r => ({ ...r })); // clone to avoid Mutation of original until save
                renderJudgeRolesUI();
            }
        });
    });

    function renderJudgeRolesUI() {
        const rolesContainer = document.getElementById('judge-roles-container');
        if (!rolesContainer) return;
        rolesContainer.innerHTML = currentRoles.map((r, idx) => `
        <div class="flex justify-between items-center bg-white dark:bg-gray-800 p-2 border dark:border-gray-600 rounded text-sm mb-1 dark:text-gray-200">
                <span>${r.discipline === 'dressage' ? `Dressyr (${r.position})` : r.discipline}</span>
                <button type="button" class="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 remove-role-btn" data-idx="${idx}">🗑️</button>
            </div>
        `).join('');

        rolesContainer.querySelectorAll('.remove-role-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent bubbling just in case, though these are now in the form container, not partial row.
                // Wait, rolesContainer is in the FORM, row is in the LIST. 
                // e.stopPropagation() is not needed for the row list, but good practice.
                const idx = parseInt(btn.dataset.idx);
                currentRoles.splice(idx, 1);
                renderJudgeRolesUI();
            });
        });
    }
    // Register handler usage
    if (typeof setJudgeForEditing === 'function') {
        // This is a placeholder if we rely on registerJudgeEditHandler, 
        // BUT since we are handling the UI rendering here for roles, we might conflict.
        // Actually, registerJudgeEditHandler was intended to let setupJudgeForm handle the population.
        // Let's rely on that if possible?
        // NO, the user says "currentRoles is not defined".
        // The current implementation of renderJudgeRolesUI handles it LOCALLY in this module using module-level currentRoles.
        // We just need to close the renderAdminJudgesList function properly.
    }
}

// Helper to bridge the gap to setupJudgeForm's local state
let setJudgeForEditing = () => console.warn("setJudgeForEditing not initialized yet");

export function registerJudgeEditHandler(handler) {
    setJudgeForEditing = handler;
}

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
    list.innerHTML = judges.map(j => {
        const roles = normalizeJudgeRoles(j.roles).map(r => r.discipline === 'dressage' ? `Dressyr(${r.position})` : r.discipline).join(', ');
        return `<div class="p-3 bg-gray-50 rounded flex justify-between clickable-judge" data-judge-id="${j.id}">
        <div><div class="font-bold">${j.name}</div><div class="text-xs">${roles}</div></div>
        <button class="delete-judge-btn text-red-500 font-bold" data-id="${j.id}">&times;</button>
      </div>`
    }).join('');
}

function setupJudgeForm() {
    const form = document.getElementById('adminJudgeForm');
    if (!form) return;
    const roleContainer = document.getElementById('judge-roles-container');
    const addRoleBtn = document.getElementById('add-judge-role-btn');
    let currentRoles = [];

    // ... Simplified logic for adding roles ...
    const render = () => {
        roleContainer.innerHTML = currentRoles.map((r, i) => `
        <div class="flex justify-between bg-white dark:bg-gray-800 p-2 border dark:border-gray-600 rounded mb-1 dark:text-gray-200">
                <span>${r.discipline} ${r.position || ''}</span>
                <button type="button" class="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300" onclick="removeRole(${i})">&times;</button>
            </div>`).join('');
    };
    window.removeRole = (i) => { currentRoles.splice(i, 1); render(); };

    addRoleBtn.addEventListener('click', () => {
        const d = document.getElementById('new-role-discipline').value;
        const p = document.getElementById('new-role-position').value;
        currentRoles.push({ discipline: d, position: d === 'dressage' ? p : '' });
        render();
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('judgeName').value;
        const id = document.getElementById('judgeId').value || name.replace(/\s+/g, '-').toLowerCase();
        await saveJudge(competitionId, id, { id, name, roles: normalizeJudgeRoles(currentRoles) });
        showAlert('Domare sparad.');
        form.reset();
        document.getElementById('judgeId').value = '';
        currentRoles = [];
        render();
    });

    const newJudgeBtn = document.getElementById('newJudgeBtn');
    if (newJudgeBtn) {
        newJudgeBtn.addEventListener('click', () => {
            form.reset();
            document.getElementById('judgeId').value = '';
            currentRoles = [];
            render();
        });
    }

    // Handle Judge List Click
    const list = document.getElementById('adminJudgesList');
    if (list) list.onclick = (e) => {
        const row = e.target.closest('.clickable-judge');
        if (row && !e.target.classList.contains('delete-judge-btn')) {
            const j = allJudges.find(x => x.id === row.dataset.judgeId);
            if (j) {
                document.getElementById('judgeId').value = j.id;
                document.getElementById('judgeName').value = j.name;
                currentRoles = j.roles || [];
                render();
            }
        }
    }
}


// --- MERGE PANELS (Simplified Implementation) ---

function normalizeTestForMerge(label) {
    if (!label) return { key: '', label: '' };
    // Rensa bort "Enbet", "Par", "Ponny" etc för att hitta grundtestet (t.ex. "Lätt A")
    let s = label.replace(/\b((?:Enbet|Par|Tvåspann|Fyrspann|Häst|Ponny)(?:\s+)?)+\b/gi, '')
        .replace(/\b([ABCD]-ponny)\b/gi, '')
        .trim();
    // Ta bort dubbla mellanslag
    s = s.replace(/\s+/g, ' ');

    // Om vi har en exakt mappning till program-ID, använd det som nyckel för striktare gruppering
    // Sök case-insensitive
    if (klassProgramMapping) {
        const foundKey = Object.keys(klassProgramMapping).find(k => k.toLowerCase() === label.toLowerCase());
        if (foundKey) {
            return { key: `PROG:${klassProgramMapping[foundKey]} `, label: s };
        }
    }

    return { key: `TEST:${s.toUpperCase()} `, label: s };
}

async function renderMergePanel(equipages) {
    const host = document.getElementById('mergePanelAuto'); // Target specific container
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

    // Kandidater = grupper där det faktiskt finns något att slå ihop - ELLER visa alla för tydlighetens skull
    const candidates = Array.from(groups.values())
        //.filter(g => g.classes.size > 1 || g.tdbs.size > 1 || g.horseCodes.size > 1)
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
        <div class="rounded-lg border border-slate-200 dark:border-gray-600 p-3 bg-slate-50 dark:bg-gray-800/50">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-sm font-semibold dark:text-gray-200">Välj vilka test som ska slås samman i den här tävlingen</div>
            <div class="text-xs text-slate-600 dark:text-gray-400">Kryssa i de testgrupper där du vill visa alla anspänningar och häst/ponny i samma klass.</div>
          </div>
          <div class="flex gap-2">
            <button id="mergeSelectAll"   class="text-xs px-2 py-1 rounded bg-slate-200 hover:bg-slate-300 dark:bg-gray-600 dark:hover:bg-gray-500 dark:text-gray-200">Markera alla</button>
            <button id="mergeSelectNone"  class="text-xs px-2 py-1 rounded bg-slate-200 hover:bg-slate-300 dark:bg-gray-600 dark:hover:bg-gray-500 dark:text-gray-200">Avmarkera alla</button>
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
        <label class="flex items-start gap-2 p-2 bg-white dark:bg-gray-700 border dark:border-gray-600 rounded select-none cursor-pointer">
          <input type="checkbox" class="mt-1 h-4 w-4 mergeChoice rounded border-gray-300 dark:border-gray-500 dark:bg-gray-600 text-blue-600" data-key="${g.key}" ${checked}>
          <div class="text-sm">
            <div class="font-semibold dark:text-gray-200">${g.label}</div>
            <div class="text-xs text-slate-600 dark:text-gray-400">
              App-klasser: ${clsList || '—'}${tdbList ? ` • TDB#: ${tdbList}` : ''}${codeList}
            </div>
          </div>
        </label>`;
    });

    html += `
        </div>
        </div >
        <div class="mt-3">
            <button id="mergeApplyAndSave" class="w-full text-sm bg-brand-darkblue text-white font-semibold py-2 px-4 rounded hover:bg-brand-gold hover:text-brand-darkblue transition-colors">
                Spara & Verkställ ändringar
            </button>
        </div>
      </div > `;
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

    // "Spara & Verkställ" - Apply state based on checkboxes
    host.querySelector('#mergeApplyAndSave')?.addEventListener('click', async () => {
        const selected = new Set(getSelectedKeys(boxContainer));
        // Also save config
        try {
            const prev = await getConfig(competitionId, 'display') || {};
            await saveConfig(competitionId, 'display', {
                ...prev,
                mergeGroups: Object.fromEntries(Array.from(selected).map(k => [k, true]))
            });
        } catch (e) { console.warn('Kunde inte spara config', e); }

        await applyMergeConfiguration(selected);
    });

    function getSelectedKeys(container) {
        return Array.from(container.querySelectorAll('input.mergeChoice'))
            .filter(cb => cb.checked)
            .map(cb => cb.getAttribute('data-key'));
    }

    async function applyMergeConfiguration(enabledSet) {
        if (!Array.isArray(allEquipages) || !allEquipages.length) {
            showAlert('Inga ekipage att uppdatera.', false);
            return;
        }

        const updates = [];
        let ok = 0, fail = 0;

        for (const eq of allEquipages) {
            const base = normalizeTestForMerge(eq.tdbClassLabel || eq.className || '');
            if (!base.key) continue;

            // Determine desired state
            const shouldMerge = enabledSet.has(base.key);

            // Optimization: Skip if already in desired state (and details match if merging)
            if (!!eq.useMergedTestForDisplay === shouldMerge) {
                // If we are merging, we must also ensure the key/label matches current logic 
                // in case logic changed or data was manual. 
                // Let's force update if merging to ensure consistency, but skip if unmerging and already false.
                if (!shouldMerge) continue;
                if (eq.mergedTestKey === base.key) continue;
            }

            const patch = { ...eq, useMergedTestForDisplay: shouldMerge };
            if (shouldMerge) {
                const base2 = normalizeTestForMerge(eq.tdbClassLabel || eq.className || '');
                patch.mergedTestKey = base2.key;
                patch.mergedTestLabel = base2.label;
            }

            // Optimistisk uppdatering direkt
            Object.assign(eq, patch);

            updates.push(
                saveEquipage(competitionId, patch.startNumber, patch)
                    .then(() => ok++)
                    .catch((err) => {
                        console.warn('Kunde inte spara ekipage', eq, err);
                        fail++;
                    })
            );
        }

        renderAdminEquipageTable(allEquipages); // Rendera direkt

        Promise.all(updates).then(() => {
            if (ok > 0 || fail > 0) {
                showAlert(`Uppdaterade visningsläge för ${ok} ekipage.`);
            } else {
                showAlert('Inga ändringar behövdes.', true);
            }
        });

    } // End of applyMergeConfiguration
} // End of renderMergePanel



async function renderClassNumberMergePanel(equipages) {
    const container = document.getElementById('mergePanelManual');
    if (!container) return;

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
        // Om inga TDB-nummer finns kan vi inte göra så mycket här, 
        // men vi gömmer bara om den ANDRA panelen också är tom? 
        // Nej, detta är en appendering i samma div (#mergePanel).
        // OBS: renderMergePanel körs före och sätter innerHTML=...
        // Så vi måste appenda, inte skriva över om vi vill ha båda.
        // Men vänta, 'renderMergePanel' gör `host.innerHTML = html`.
        // Så om jag kör `renderClassNumberMergePanel` efter, kommer den skriva över?
        // I `updateEquipages` körs de efter varandra.
        // ELLER så bör renderClassNumberMergePanel APPENDERA.
        // Låt oss kolla.
        return;
    }

    // Container management is handled by parent, we just target mergePanelManual
    container.classList.remove('hidden');

    // Läs ev. tidigare sparade grupper (per TDB-klassnummer)
    let savedCfg = {};
    try {
        const displayCfg = await getConfig(competitionId, 'display');
        savedCfg = displayCfg || {};
    } catch (e) {
        console.warn('Kunde inte läsa display-config:', e);
    }
    const savedGroups = savedCfg.mergeByClassNumber || {};

    // Bygg UI i container
    let html = `
        <div class="rounded-lg border border-slate-200 dark:border-gray-600 p-3 bg-slate-50 dark:bg-gray-800/50">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-sm font-semibold dark:text-gray-200">Slå samman valda TDB-klassnummer</div>
            <div class="text-xs text-slate-600 dark:text-gray-400">Markera de klassnummer som ska visas som EN gemensam klass i resultatet.</div>
          </div>
          <div class="flex gap-2">
            <button id="cnSelectAll"  class="text-xs px-2 py-1 rounded bg-slate-200 hover:bg-slate-300 dark:bg-gray-600 dark:hover:bg-gray-500 dark:text-gray-200">Markera alla</button>
            <button id="cnSelectNone" class="text-xs px-2 py-1 rounded bg-slate-200 hover:bg-slate-300 dark:bg-gray-600 dark:hover:bg-gray-500 dark:text-gray-200">Avmarkera alla</button>
          </div>
        </div>
  
        <div class="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2" id="cnChoices">
    `;

    for (const it of items) {
        const label = Array.from(it.labelCandidates).join(' / ') || '';
        html += `
        <label class="flex items-start gap-2 p-2 bg-white dark:bg-gray-700 border dark:border-gray-600 rounded select-none cursor-pointer">
          <input type="checkbox" class="mt-1 h-4 w-4 cnChoice rounded border-gray-300 dark:border-gray-500 dark:bg-gray-600 text-blue-600" data-num="${it.num}">
          <div class="text-sm">
            <div class="font-semibold dark:text-gray-200">TDB #${it.num}</div>
            <div class="text-xs text-slate-600 dark:text-gray-400">Möjliga etiketter: ${label || '—'} • (${it.count} ekipage)</div>
          </div>
        </label>`;
    }

    html += `
        </div>
  
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <input id="cnGroupLabel" type="text" placeholder="Gemensam etikett (t.ex. Lätt A)"
                 class="text-sm border rounded px-2 py-1 min-w-[220px] dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400">
          <button id="cnMergeCreate" class="text-xs bg-emerald-600 text-white font-semibold py-1.5 px-3 rounded hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600">
            Slå samman valda
          </button>
          <button id="cnUnmergeSelected" class="text-xs bg-gray-200 text-gray-800 font-semibold py-1.5 px-3 rounded hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500">
            Ångra sammanslagning (för valda)
          </button>
        </div>
  
        <div class="mt-4">
          <div class="text-sm font-semibold mb-1">Aktiva sammanslagningar</div>
          <div id="cnActiveGroups" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2"></div>
        </div>
      </div > `;

    container.innerHTML = html;

    // Rendera redan sparade grupper
    const wrap = container.querySelector('#cnActiveGroups');
    if (wrap) {
        const entries = Object.entries(savedGroups);
        if (!entries.length) {
            wrap.innerHTML = `<div class="text-xs text-slate-500">Inga aktiva sammanslagningar.</div>`;
        } else {
            wrap.innerHTML = entries.map(([key, g]) => {
                const nums = g.members.join(', ');
                return `
        <label class="flex items-start gap-2 p-2 border rounded bg-white hover:bg-slate-50 dark:bg-gray-700 dark:border-gray-600 dark:hover:bg-gray-600 cursor-pointer">
            <input type="checkbox" class="mt-1 h-4 w-4 cnActiveGroupChoice rounded border-gray-300 dark:border-gray-500 dark:bg-gray-600 text-blue-600" data-key="${key}">
                <div>
                    <div class="text-sm font-semibold dark:text-gray-200">${g.label}</div>
                    <div class="text-xs text-slate-600 dark:text-gray-400">TDB#: ${nums}</div>
                </div>
            </label>`;
            }).join('');
        }
    }

    // Interaktioner
    const choiceBox = container.querySelector('#cnChoices');
    container.querySelector('#cnSelectAll')?.addEventListener('click', () => {
        choiceBox.querySelectorAll('input.cnChoice')?.forEach(cb => cb.checked = true);
    });
    container.querySelector('#cnSelectNone')?.addEventListener('click', () => {
        choiceBox.querySelectorAll('input.cnChoice')?.forEach(cb => cb.checked = false);
    });

    container.querySelector('#cnMergeCreate')?.addEventListener('click', async () => {
        const selected = getSelectedNums(choiceBox);
        if (selected.length < 2) { showAlert('Välj minst två klassnummer.', false); return; }
        const labelInput = container.querySelector('#cnGroupLabel');
        const groupLabel = (labelInput?.value || '').trim() || `Grupp ${selected.join('+')} `;

        // Skapa gruppnyckel deterministiskt
        const key = `TDBGROUP:${selected.slice().sort((a, b) => a - b).join('+')} `;

        try {
            const prev = await getConfig(competitionId, 'display', true) || {};
            const prevGroups = prev.mergeByClassNumber || {};
            const nextGroups = { ...prevGroups, [key]: { label: groupLabel, members: selected.slice().sort((a, b) => a - b) } };
            
            await saveConfig(competitionId, 'display', { ...prev, mergeByClassNumber: nextGroups });
            // Sätt på ekipage-nivå
            await applyMergeForClassNumbers(selected, groupLabel, key, true);
            showAlert('Sammanslagning skapad.');
            // Refresh this panel
            renderClassNumberMergePanel(allEquipages); // Recursive call to refresh UI
        } catch (e) {
            console.error(e);
            showAlert('Kunde inte spara sammanslagning.', false);
        }
    });

    container.querySelector('#cnUnmergeSelected')?.addEventListener('click', async () => {
        const groupCheckboxes = container.querySelectorAll('.cnActiveGroupChoice:checked');
        const selectedNums = new Set(getSelectedNums(choiceBox));

        if (!groupCheckboxes.length && !selectedNums.size) {
            showAlert('Markera en grupp (nedan) eller klasser (ovan) att ångra.', false);
            return;
        }

        try {
            const prev = await getConfig(competitionId, 'display', true) || {};
            const toUpdate = { ...(prev.mergeByClassNumber || {}) };
            let changed = false;
            const keysToRemove = new Set(Array.from(groupCheckboxes).map(cb => cb.dataset.key));
            const numsToUnmerge = [];

            // 1. Remove explicitly selected groups
            for (const k of keysToRemove) {
                if (toUpdate[k]) {
                    numsToUnmerge.push(...toUpdate[k].members);
                    delete toUpdate[k];
                    changed = true;
                }
            }

            // 2. Remove groups affected by selected numbers (legacy/hybrid mode)
            if (selectedNums.size > 0) {
                for (const [gk, g] of Object.entries(toUpdate)) {
                    if (keysToRemove.has(gk)) continue; // Already handled
                    const anyHit = g.members.some(n => selectedNums.has(n));
                    if (anyHit) {
                        numsToUnmerge.push(...g.members);
                        delete toUpdate[gk];
                        changed = true;
                    }
                }
            }

            console.log("cnUnmergeSelected", { changed, numsToUnmerge, keysToRemove: Array.from(keysToRemove) });

            if (changed) {
                await saveConfig(competitionId, 'display', { ...prev, mergeByClassNumber: toUpdate });

                // Apply unmerge to affected equipages
                if (numsToUnmerge.length > 0) {
                    const uniqueNums = [...new Set(numsToUnmerge)];
                    await applyMergeForClassNumbers(uniqueNums, '', '', false);
                }

                showAlert('Sammanslagning borttagen.');
                renderClassNumberMergePanel(allEquipages);
            } else {
                showAlert('Ingen grupp vald/ändrad.', false);
            }
        } catch (e) {
            console.error(e);
            showAlert('Kunde inte uppdatera.', false);
        }
    });

    function getSelectedNums(box) {
        return Array.from(box.querySelectorAll('input.cnChoice'))
            .filter(cb => cb.checked)
            .map(cb => Number(cb.getAttribute('data-num')));
    }

    async function applyMergeForClassNumbers(nums, label, groupKey, on) {
        console.log('applyMergeForClassNumbers', { nums, label, on });
        let ok = 0, fail = 0;
        const set = new Set(nums);
        for (const eq of (allEquipages || [])) {
            if (eq?.tdbClassNumber == null) continue;
            if (!set.has(Number(eq.tdbClassNumber))) continue;

            const patch = { ...eq, useMergedTestForDisplay: !!on };
            if (on) {
                patch.mergedTestKey = groupKey || `TDBGROUP:${nums.slice().sort((a, b) => a - b).join('+')} `;
                patch.mergedTestLabel = label || (eq.tdbClassLabel || eq.className || 'Sammanslagen klass');
            } else {
                patch.useMergedTestForDisplay = false;
            }

            try {
                // Optimistisk uppdatering lokalt för omedelbar feedback
                Object.assign(eq, patch);

                // Spara till databas
                await saveEquipage(competitionId, patch.startNumber, patch);
                ok++;
            } catch (err) {
                console.warn('Kunde inte spara ekipage', eq, err);
                fail++;
            }
        }
        // Tvinga omritning av tabellen
        renderAdminEquipageTable(allEquipages);
    }
}


export { renderClassNumberMergePanel };


// --- IMPORT LOGIC ---

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
        return `Msv ${num} `;
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
            if (new RegExp(`\\b${xmlSpan} \\b`).test(appNorm)) score += 10;
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
        location: _text(meetingNode, 'location'),
        organizer: _text(orgNode, 'name'),
        organizerId: _text(orgNode, 'orgNr'),
        address: _text(orgNode, 'Address'),
        zipCode: _text(orgNode, 'zipCode'),
        city: _text(orgNode, 'city'),
        phone: _text(orgNode, 'phone'),
        fax: _text(orgNode, 'fax')
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
        const driverName = `${_text(riderNode, 'firstName')} ${_text(riderNode, 'lastName')} `.trim();
        if (!driverName) return;

        const clubName = _text(riderNode, 'orgName');
        const totalAmountPaidByRider = _maybeNum(_text(riderNode, 'paid'));

        // --- Hämta kuskens kontakt-, licens- och adressinfo ---
        const licenseNo = _text(riderNode, 'licens');
        const licenseYear = _text(riderNode, 'licens_year');
        const gender = _text(riderNode, 'gender');
        const bornYear = _text(riderNode, 'bornYear');
        const country = _text(riderNode, 'country');
        const company = _text(riderNode, 'company');
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
                bornYear: _text(horseNode, 'bornYear'), // <-- Added explicit bornYear
                lineage: `e.${_text(horseNode, 'father')} u.${_text(horseNode, 'mother')} ue.${_text(horseNode, 'grandFather')} `,
                licenseYear: _text(horseNode, 'licenseYear'),
                owner: _text(horseNode, 'owner'),
                breeder: _text(horseNode, 'breeder'),
                gender: ({ 'V': 'Valack', 'S': 'Sto', 'H': 'Hingst' })[_text(horseNode, 'sex')] || _text(horseNode, 'sex'),
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
                let className = normalizeEqClassName(propInfo.label || `Okänd post(${classNumber})`);

                const entryStatus = _text(classEntryNode, 'status');
                const uniqueKey = `${driverName}| ${classNumber} `;
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
                    className += ` ${span} `;
                }

                if (!hasSpecies) {
                    const speciesCode = (propInfo.horse || _text(riderNode, 'horse') || '').toUpperCase(); // 'P'/'H'
                    const species = speciesCode === 'P' ? 'Ponny' : 'Häst';
                    className += ` ${species} `;
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
                        address: address, // Sparar det nya adressobjektet
                        gender, bornYear, country, company, licenseYear
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

// Samla ihop roller så att varje disciplin finns max en gång.
// För dressyr: behåll EN post och prioritera den som har position.


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

    const allOfficialBlocks = _all(xml, "Officials");
    if (allOfficialBlocks.length === 0) return { judges: 0, officials: 0 };
    const officialNodes = allOfficialBlocks.flatMap(node => _all(node, "o"));

    let judgesImported = 0;
    let officialsImported = 0;

    const existingOfficialNames = new Set(existingOfficials.map(o => o.name));

    const roleMap = {
        'event_director': 'Tävlingsledare', 'veterinary': 'Veterinär',
        'press_official': 'Pressansvarig', 'safety_official': 'Säkerhetsansvarig',
        'contact_person': 'Kontaktperson', 'precision_course_designer': 'Banbyggare',
        'maraton_course_designer': 'Banbyggare', 'results_accountable': 'Resultatansvarig'
    };

    // Intermediate Storage
    const judgesMap = new Map(); // Key: judgeId -> { ...data, roles: [] }
    const officialsMap = new Map(); // Key: fullName -> { ...data, roles: Set }

    for (const node of officialNodes) {
        const foreignId = _text(node, "foreignId");
        const fullName = _text(node, "fullName");
        if (!fullName) continue;

        const kind = _text(node, "kind");
        const phone = _text(node, "phone");
        const email = _text(node, "email");
        const licenseNo = (foreignId ? licenseMap.get(foreignId) : '') || '';

        // Check if it's a Judge Type
        if (['head_judge', 'driving_dressage_judge', 'maraton_judge', 'precision_judge'].includes(kind)) {
            const judgeId = fullName.replace(/\s+/g, '-').toLowerCase();

            // Determine Roles based on Kind
            const newRoles = [];
            if (kind === 'driving_dressage_judge') newRoles.push({ discipline: 'dressage', position: '' });
            else if (kind === 'maraton_judge') newRoles.push({ discipline: 'marathon' });
            else if (kind === 'precision_judge') newRoles.push({ discipline: 'precision' });
            else if (kind === 'head_judge') newRoles.push({ discipline: 'overjudge' });

            if (!judgesMap.has(judgeId)) {
                judgesMap.set(judgeId, {
                    id: judgeId,
                    name: fullName,
                    phone: phone,
                    email: email,
                    license: licenseNo,
                    roles: []
                });
            }

            // Merge Roles
            const entry = judgesMap.get(judgeId);
            newRoles.forEach(r => {
                entry.roles.push(r);
            });

            // Update metadata if missing
            if (!entry.phone && phone) entry.phone = phone;
            if (!entry.email && email) entry.email = email;
            if (!entry.license && licenseNo) entry.license = licenseNo;

        } else {
            // Official Type
            // We want to aggregate roles if name matches
            const role = roleMap[kind] || kind.replace(/_/g, ' ').replace(/\b\w/g, l => { return l.toUpperCase(); });

            if (!officialsMap.has(fullName)) {
                // Init new
                officialsMap.set(fullName, {
                    name: fullName,
                    roles: new Set(),
                    phone: phone,
                    email: email,
                    license: licenseNo
                });
            }

            // Update entry
            const off = officialsMap.get(fullName);
            off.roles.add(role);

            // Merge best contact info
            if (!off.phone && phone) off.phone = phone;
            if (!off.email && email) off.email = email;
            if (!off.license && licenseNo) off.license = licenseNo;
        }
    }

    // --- SAVE JUDGES ---
    for (const judge of judgesMap.values()) {
        judge.roles = normalizeJudgeRoles(judge.roles);
        judge.isOverJudge = judge.roles.some(r => r.discipline === 'overjudge');

        try {
            await saveJudge(competitionId, judge.id, judge);
            judgesImported++;
        } catch (err) {
            console.error(`Kunde inte spara domare ${judge.name}: `, err);
        }
    }

    // --- SAVE OFFICIALS ---
    for (const off of officialsMap.values()) {
        if (existingOfficialNames.has(off.name)) {
            continue;
        }

        // Convert Set to String
        const roleStr = Array.from(off.roles).join(', ');

        const finalObj = {
            name: off.name,
            role: roleStr,
            phone: off.phone,
            email: off.email,
            license: off.license,
            // No ID, saveOfficial genrerates one (addDoc)
        };

        try {
            await saveOfficial(competitionId, finalObj);
            officialsImported++;
        } catch (err) {
            console.error(`Kunde inte spara funktionär ${off.name}: `, err);
        }
    }

    return { judges: judgesImported, officials: officialsImported };
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
            }


            // Bygg stabila unika “klass-nycklar” från TDB-klassnummer + label
            const uniqueXmlClasses = Array
                .from(new Map(
                    equipagesFromFile.map(eq => {
                        const key = (eq.tdbClassNumber != null)
                            ? `NUM:${eq.tdbClassNumber} `   // stabil identitet via nummer
                            : `NAME:${eq.className} `;      // fallback om nummer saknas
                        // Visa för användaren: “<label> (TDB #123)” om nummer finns, annars bara label
                        const display = (eq.tdbClassNumber != null)
                            ? `${eq.tdbClassLabel || eq.className} (TDB #${eq.tdbClassNumber})`
                            : `${eq.className} `;
                        return [key, { key, display, className: eq.className, tdbClassNumber: eq.tdbClassNumber ?? null }];
                    })
                ).values());

            // Bygg UI
            let mappingUI = `<h3 class="font-semibold mb-2 dark:text-gray-200"> Steg 2: Mappa tävlingsklasser</h3>
        <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">Kontrollera och justera de automatiskt matchade klasserna.</p>`;
            const appClassOptions = appClassList.map(c => `<option value="${c}">${c}</option>`).join('');

            uniqueXmlClasses.forEach((item, index) => {
                const bestMatch = findBestClassMatch(item.className, appClassList);
                mappingUI += `
        <div class="grid grid-cols-2 gap-4 items-center mb-2 p-2 bg-gray-50 dark:bg-gray-800 rounded">
      <div class="text-sm">
        <span class="font-semibold dark:text-gray-200">Från fil:</span>
        <p class="text-gray-700 dark:text-gray-400 italic">"${item.display}"</p>
      </div>
      <div>
        <label for="mapping_${index}" class="text-sm font-semibold dark:text-gray-200">Mappa till:</label>
        <select id="mapping_${index}" data-key="${item.key}" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200">
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
        <div class="mt-4 p-3 rounded bg-amber-50 dark:bg-amber-900 border border-amber-200 dark:border-amber-700">
    <label class="inline-flex items-center gap-2 text-sm dark:text-amber-100">
      <input id="eqXmlMergePerTestChk" type="checkbox" class="h-4 w-4" checked>
      <span>Sammanslå per test (ignorera Häst/Ponny & Enbet/Par)</span>
    </label>
    <p class="text-xs text-amber-700 dark:text-amber-300 mt-1">När detta är valt sparas även fälten <code>mergedTestKey</code>/<code>mergedTestLabel</code> samt flaggan <code>useMergedTestForDisplay</code> på ekipagen.</p>
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
                        ? `NUM:${eqa.tdbClassNumber} `
                        : `NAME:${eqa.className} `;

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
                const message = `Import klar: ${ok} ekipage, ${stats.judges} nya domare och ${stats.officials} nya funktionärer importerade.${fail ? ` ${fail} ekipage misslyckades.` : ''} `;
                showAlert(message);
                progress.textContent = message;
                form.reset();
            };
        } catch (err) {
            console.error(err);
            showAlert(`Fel vid import: ${err.message || err} `, false);
            progress.textContent = `Fel vid import: ${err.message || err} `;
        }
    });
}

// --- CLASS MANAGER LOGIC ---
function setupClassManager(competitionId) {
    const btn = document.getElementById('manageClassesBtn');
    if (!btn) return;

    btn.addEventListener('click', () => {
        // Build the modal HTML dynamically
        const modalHtml = `
        <div id="classManagerModal" class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center">
            <div class="relative p-5 border w-[600px] shadow-lg rounded-md bg-white dark:bg-gray-800 dark:border-gray-700">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-xl font-bold text-gray-900 dark:text-white">Hantera Klasser</h3>
                    <button id="closeClassManager" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl">&times;</button>
                </div>
                <div class="mb-4">
                    <p class="text-sm text-gray-600 dark:text-gray-400 mb-2">Här kan du döpa om klasser. Alla ekipage i klassen flyttas med.</p>
                    <button id="autoNumberClassesBtn" class="bg-indigo-600 text-white text-xs font-semibold py-1 px-3 rounded hover:bg-indigo-700">
                        🪄 Auto-numrera från TDB (lägg till prefix)
                    </button>
                </div>

                <div class="max-h-[60vh] overflow-y-auto border-t border-b py-2 space-y-2 dark:border-gray-700" id="classListContainer">
                    <!-- Dynamic Rows Here -->
                </div>

                <div class="mt-4 flex justify-end gap-3">
                    <button id="cancelClassManager" class="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-600">Avbryt</button>
                    <button id="saveClassManager" class="px-4 py-2 bg-green-600 text-white font-bold rounded hover:bg-green-700">Spara & Uppdatera Ekipage</button>
                </div>
            </div>
        </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Logic
        const container = document.getElementById('classListContainer');

        // 1. Identify unique classes
        // Map: OriginalName -> { count, tdbNum (min) }
        const classMap = new Map();
        (allEquipages || []).forEach(eq => {
            const cn = eq.className || 'Okänd klass';
            if (!classMap.has(cn)) {
                classMap.set(cn, { count: 0, tdbNums: new Set() });
            }
            const info = classMap.get(cn);
            info.count++;
            if (eq.tdbClassNumber) info.tdbNums.add(eq.tdbClassNumber);
        });

        // Convert to array and sort
        // We try to sort by TDB number if available, else name
        const rows = Array.from(classMap.entries()).map(([name, info]) => {
            // Pick a representative TDB number (min) if multiple (rare)
            const nums = Array.from(info.tdbNums).sort((a, b) => a - b);
            const tdbNum = nums.length ? nums[0] : null;
            return { name, count: info.count, tdbNum };
        }).sort((a, b) => {
            if (a.tdbNum && b.tdbNum) return a.tdbNum - b.tdbNum;
            if (a.tdbNum) return -1;
            if (b.tdbNum) return 1;
            return a.name.localeCompare(b.name);
        });

        const renderRows = () => {
            container.innerHTML = rows.map((r, idx) => `
        <div class="flex items-center gap-3 p-2 hover:bg-gray-50 dark:hover:bg-gray-700 rounded">
                    <div class="w-8 text-center text-xs font-mono bg-gray-100 dark:bg-gray-700 dark:text-gray-300 rounded p-1" title="TDB Klassnummer">${r.tdbNum || '-'}</div>
                    <div class="flex-1">
                        <input type="text" data-idx="${idx}" class="class-rename-input w-full p-2 border rounded dark:bg-gray-800 dark:border-gray-600 dark:text-white" value="${r.name}">
                        <div class="text-xs text-gray-400 dark:text-gray-500 mt-1">Nuvarande: ${r.name} (${r.count} ekipage)</div>
                    </div>
                </div>
        `).join('');
        };
        renderRows();

        // Handlers
        const closeModal = () => document.getElementById('classManagerModal')?.remove();
        document.getElementById('closeClassManager').onclick = closeModal;
        document.getElementById('cancelClassManager').onclick = closeModal;

        document.getElementById('autoNumberClassesBtn').onclick = () => {
            if (!confirm("Vill du automatiskt lägga till TDB-nummer (t.ex. '1. ') framför alla klassnamn som har ett nummer?")) return;

            const inputs = container.querySelectorAll('.class-rename-input');
            inputs.forEach(input => {
                const idx = parseInt(input.dataset.idx);
                const row = rows[idx];
                if (row.tdbNum) {
                    // Check if already starts with "X. "
                    const prefix = `${row.tdbNum}.`;
                    if (!input.value.startsWith(prefix)) {
                        input.value = prefix + input.value;
                        // Flash effect
                        input.classList.add('bg-blue-50');
                        setTimeout(() => input.classList.remove('bg-blue-50'), 500);
                    }
                }
            });
            showAlert("Förslag på numrering applicerat. Granska och Spara.");
        };

        document.getElementById('saveClassManager').onclick = async () => {
            const inputs = container.querySelectorAll('.class-rename-input');
            const changes = [];

            inputs.forEach(input => {
                const idx = parseInt(input.dataset.idx);
                const oldName = rows[idx].name;
                const newName = input.value.trim();

                if (newName && newName !== oldName) {
                    changes.push({ oldName, newName });
                }
            });

            if (changes.length === 0) {
                closeModal();
                return;
            }

            if (!confirm(`Du håller på att döpa om ${changes.length} klasser.Detta kommer uppdatera alla berörda ekipage.Fortsätt ? `)) return;

            // Perform Batch Update via Promises (sequential or parallel)
            // Ideally we should use a batch write, but here we reuse saveEquipage logic or simple updates? 
            // saveEquipage is heavy. Let's do it manually on the object and save.

            let totalUpdated = 0;
            const updates = [];

            // Create a lookup for fast renaming
            const renameMap = new Map();
            changes.forEach(c => renameMap.set(c.oldName, c.newName));

            showAlert("Sparar ändringar, vänta...", true);

            for (const eq of allEquipages) {
                if (renameMap.has(eq.className)) {
                    const newName = renameMap.get(eq.className);
                    // Clone to avoid direct mutation issues before save
                    const updatedData = { ...eq, className: newName };

                    // FireStore Update
                    updates.push(saveEquipage(competitionId, eq.startNumber, updatedData));
                    totalUpdated++;
                }
            }

            try {
                await Promise.all(updates);
                showAlert(`Uppdaterade ${totalUpdated} ekipage! Ladda om sidan...`, true);

                // Close and clean up
                closeModal();
                // Ideally refresh the local list immediately, but logic depends on how 'admin.js' listens. 
                // We assume Firestore listener will trigger 'updateEquipages' automatically!

            } catch (err) {
                console.error(err);
                showAlert("Ett fel inträffade vid sparandet.", false);
            }
        };


    });
}
