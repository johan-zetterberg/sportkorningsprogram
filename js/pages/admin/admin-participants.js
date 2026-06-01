import { saveEquipage } from '../../services/equipageService.js';
import { deleteEquipage } from '../../services/equipageService.js';
import { showAlert } from '../../ui/components.js';
import { competitionClasses } from '../../data/competitionData.js';
import {
    inferParaGradeFromClassName,
    resolveProgramKeyForClass
} from './adminParticipantClassUtils.js';
import { setupParticipantImportForm } from './adminParticipantImportForm.js';
import { setupClassManager } from './adminParticipantClassManager.js';
import { renderClassNumberMergePanel } from './adminParticipantMergePanels.js';
import {
    generateHorseFields,
    getHorseFormData,
    populateHorseFormData,
    updateHorseNumbers
} from './adminParticipantHorseFields.js';
import {
    renderAdminJudgesList,
    setupJudgeForm
} from './adminParticipantJudges.js';
import { renderAdminEquipageTable } from './adminParticipantEquipageTable.js';
import { populateEquipageFormFields } from './adminParticipantEquipageFormFields.js';

let allEquipages = [];
let allJudges = [];
let allOfficials = [];
let competitionId = null;

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
                    <div id="paraGradeWrap" class="hidden">
                        <label for="paraGrade" class="block text-sm font-medium dark:text-gray-300">Para grade (FEI test)</label>
                        <select id="paraGrade" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                            <option value="">Choose grade...</option>
                            <option value="1">Grade I</option>
                            <option value="2">Grade II</option>
                        </select>
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
    setupParticipantImportForm({
        competitionId: compId,
        getJudges: () => allJudges,
        getOfficials: () => allOfficials
    });
    setupClearButton(compId);
    setupJudgeForm({
        competitionId: compId,
        getJudges: () => allJudges
    });
    setupClassManager({
        competitionId: compId,
        getEquipages: () => allEquipages
    });
}

export function updateEquipages(equipages) {
    allEquipages = equipages;
    renderEquipageTable();

    const mergeRoot = document.getElementById('mergePanel');
    if (mergeRoot) {
        mergeRoot.classList.remove('hidden');

        if (!document.getElementById('mergePanelManual')) {
            mergeRoot.innerHTML = `
            <div id="mergePanelManual" class="mb-4 pt-4"></div>
    `;
        }
        renderClassNumberMergePanel(allEquipages, {
            competitionId,
            renderEquipages: renderEquipageTable
        });
    }
}

export function updateJudges(judges) {
    allJudges = judges;
    renderAdminJudgesList(judges);
}

export function updateOfficials(officials) {
    allOfficials = officials || [];
}

function renderEquipageTable(equipages = allEquipages) {
    renderAdminEquipageTable(equipages, {
        onSelectEquipage: (equipage) => {
            populateEquipageForm(equipage);
            document.getElementById('adminEquipageForm')?.scrollIntoView({ behavior: 'smooth' });
        },
        onRendered: () => {
            if (typeof window.populateAdminClassSelect === 'function') {
                window.populateAdminClassSelect();
            }
        }
    });
}

function setupEquipageForm() {
    const form = document.getElementById('adminEquipageForm');
    if (!form) return;
    const classSelect = document.getElementById('className');
    const startNumberInput = document.getElementById('startNumber');
    const driverInput = document.getElementById('driverName');
    const barnklassCheckbox = document.getElementById('isBarnklassCheckbox');
    const paraCheckbox = document.getElementById('isParaCheckbox');
    const paraGradeWrap = document.getElementById('paraGradeWrap');
    const paraGradeSelect = document.getElementById('paraGrade');

    const isBarnClass = (className) => /\b(barn|children|ch)\b/i.test(className || '');
    const isParaClass = (className) => /\bpara\b/i.test(className || '');
    const syncParaGradeUi = () => {
        const on = !!paraCheckbox.checked;
        if (paraGradeWrap) paraGradeWrap.classList.toggle('hidden', !on);
        if (!paraGradeSelect) return;
        paraGradeSelect.disabled = !on;
        if (!on) paraGradeSelect.value = '';
        else if (!paraGradeSelect.value) paraGradeSelect.value = '2';
    };

    const populateClassSelect = () => {
        const isBarnklass = barnklassCheckbox.checked;
        const isParaSelected = paraCheckbox.checked;
        const currentSelectedClass = classSelect.value;
        classSelect.innerHTML = '<option value="">Välj klass...</option>';

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
                const isBarn = isBarnClass(c);
                const isPara = isParaClass(c);
                if (isBarnklass && !isBarn) return;
                if (!isBarnklass && isBarn) return;
                if (isParaSelected && !isPara) return;
                if (!isParaSelected && isPara) return;

                const option = document.createElement('option');
                option.value = c;
                option.textContent = c;
                optGrp.appendChild(option);
            });
            if (optGrp.children.length > 0) classSelect.appendChild(optGrp);
        }

        for (const group in competitionClasses) {
            const groupIsBarn = group === "Barnklasser";
            const groupIsPara = group === "Paraklasser";
            if (isBarnklass && !groupIsBarn) continue;
            if (!isBarnklass && groupIsBarn) continue;
            if (isParaSelected && !groupIsPara) continue;
            if (!isParaSelected && groupIsPara) continue;
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

    window.populateAdminClassSelect = populateClassSelect;

    const populateFormFromEquipage = (eq) => {
        populateEquipageForm(eq, {
            generateHorseFields,
            inferParaGradeFromClassName,
            isBarnClass,
            isParaClass,
            paraGradeSelect,
            populateClassSelect,
            syncParaGradeUi
        });
    };

    const fillByStartNumber = (sn) => {
        sn = String(sn || '').trim();
        if (!sn) return;
        const eq = (allEquipages || []).find(x => String(x.startNumber) === sn);
        if (eq) {
            const isBarn = isBarnClass(eq.className);
            if (barnklassCheckbox.checked !== isBarn) {
                barnklassCheckbox.checked = isBarn;
            }
            paraCheckbox.checked = isParaClass(eq.className) || !!eq.isPara;
            if (paraGradeSelect) {
                paraGradeSelect.value = String(eq.paraGrade || inferParaGradeFromClassName(eq.className) || '');
            }
            syncParaGradeUi();
            populateClassSelect();
            populateFormFromEquipage(eq);
            showAlert(`Ekipage #${sn} inläst.`, true);
        }
    };

    const fillByDriverName = (name) => {
        name = String(name || '').trim().toLowerCase();
        if (!name) return;
        const eq = (allEquipages || []).find(x => (x.driverName || '').toLowerCase().includes(name));
        if (eq) {
            populateFormFromEquipage(eq);
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

        const selectedClass = document.getElementById('className').value;
        const derivedIsPara = isParaClass(selectedClass) || paraCheckbox.checked;
        const paraGrade = derivedIsPara ? String(paraGradeSelect?.value || inferParaGradeFromClassName(selectedClass) || '2') : '';
        const resolvedTestKey = resolveProgramKeyForClass(selectedClass, paraGrade);

        const equipageData = {
            startNumber: parseInt(startNumber),
            driverName: document.getElementById('driverName').value,
            email: document.getElementById('driverEmail').value,
            clubName: document.getElementById('clubName').value,
            className: selectedClass,
            isPara: derivedIsPara,
            paraGrade: paraGrade,
            testKey: resolvedTestKey || null,
            programKey: resolvedTestKey || null,
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
            syncParaGradeUi();
            populateClassSelect();
            onClassChange({ target: classSelect });
        } catch (err) { showAlert("Fel vid sparande.", false); }
    });

    classSelect.addEventListener('change', onClassChange);
    barnklassCheckbox.addEventListener('change', populateClassSelect);
    paraCheckbox.addEventListener('change', () => {
        syncParaGradeUi();
        populateClassSelect();
    });
    syncParaGradeUi();
    populateClassSelect();
    onClassChange({ target: classSelect });
}

function populateEquipageForm(data) {
    populateEquipageFormFields(data, {
        inferParaGradeFromClassName,
        onClassChange,
        populateHorseFormData,
        updateHorseNumbers
    });
}






