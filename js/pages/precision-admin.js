// js/pages/precision-admin.js
// --- KOMPLETT OCH KORRIGERAD VERSION ---

import { getGlobalState } from '../main.js';
import { getEquipages, getConfig, saveConfig } from '../services/firestoreService.js';
import { getCompetitionHeader, showAlert } from '../ui/components.js';
import { standardPortAllowance, klassTempoData } from '../data/competitionData.js';

let competitionId = null;
let activeClasses = [];
let precisionConfig = {};

function secondsToMMSS(seconds) {
    if (isNaN(seconds) || seconds < 0) return "--:--";
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function findTempoForClass(className, tempoData) {
    if (!className || !tempoData) return 0;
    
    const normalize = (str) => String(str).toLowerCase().replace(/[^a-z0-9åäö]/g, '');
    const normalizedClassName = normalize(className);

    // 1. Försök med en exakt (normaliserad) matchning
    const exactKey = Object.keys(tempoData).find(key => normalize(key) === normalizedClassName);
    // ÄNDRING HÄR: Byt ut .tempo mot .precision
    if (exactKey && tempoData[exactKey]?.precision) {
        return tempoData[exactKey].precision;
    }

    // 2. Om exakt matchning misslyckas, hitta den längsta nyckeln som klassnamnet börjar med
    const matchingKey = Object.keys(tempoData)
        .filter(key => normalizedClassName.startsWith(normalize(key)))
        .sort((a, b) => b.length - a.length)[0];

    // ÄNDRING HÄR: Byt ut .tempo mot .precision
    if (matchingKey && tempoData[matchingKey]?.precision) {
        return tempoData[matchingKey].precision;
    }
    
    return 0; // Returnera 0 om inget tempo alls hittas
}

function findPortAllowanceForClass(className) {
    if (!className) {
        return standardPortAllowance['*'] || 35;
    }

    const normalize = (str) => String(str).toLowerCase().replace(/[^a-z0-9åäö]/g, '');
    const normalizedClassName = normalize(className);

    const keys = Object.keys(standardPortAllowance).filter(k => k !== '*');

    // 1. Exakt normaliserad matchning
    const exactKey = keys.find(key => normalize(key) === normalizedClassName);
    if (exactKey) {
        return standardPortAllowance[exactKey];
    }

    // 2. Längsta nyckel som är prefix till klassnamnet
    const prefixKey = keys
        .filter(key => normalizedClassName.startsWith(normalize(key)))
        .sort((a, b) => normalize(b).length - normalize(a).length)[0];
    if (prefixKey) {
        return standardPortAllowance[prefixKey];
    }

    // 3. Längsta nyckel som förekommer någonstans i klassnamnet (för säkerhets skull)
    const containsKey = keys
        .filter(key => normalizedClassName.includes(normalize(key)))
        .sort((a, b) => normalize(b).length - normalize(a).length)[0];
    if (containsKey) {
        return standardPortAllowance[containsKey];
    }

    // 4. Fallback
    return standardPortAllowance['*'] || 35;
}

function renderLayout() {
    const comp = getGlobalState('currentCompetition');
    const root = document.getElementById('page-precision-admin');
    if (!root) return;
    
    root.innerHTML = `
        ${getCompetitionHeader(comp, 'Precision – Inställningar')}
        <div class="max-w-[900px] mx-auto p-4 space-y-6">
            <section class="p-4 border rounded-lg bg-white shadow-sm">
                <h3 class="text-xl font-semibold mb-2">Inställningar per Klass</h3>
                <p class="text-sm text-gray-600 mb-4">
                    Systemet använder standard-tillägg (allowance) enligt TR/FEI. Fyll endast i ett manuellt värde om du vill åsidosätta standarden för en specifik klass.
                </p>
                <div id="classConfigsContainer" class="space-y-4">
                    <p>Laddar klasser...</p>
                </div>
            </section>
            <div class="flex justify-end mt-6">
                <button id="btnSaveAll" class="px-6 py-3 bg-brand-darkblue text-white font-bold rounded-lg hover:bg-brand-gold hover:text-brand-darkblue">Spara alla precisionsinställningar</button>
            </div>
        </div>
    `;
}

function renderClassCards() {
    const container = document.getElementById('classConfigsContainer');
    if (!container) return;

    if (activeClasses.length === 0) {
        container.innerHTML = '<p class="text-gray-500">Inga ekipage anmälda till några klasser ännu.</p>';
        return;
    }

    container.innerHTML = activeClasses.map(className => {
        const classId = className.replace(/[^a-zA-Z0-9]/g, '_');
const courseData = precisionConfig.courses?.[className] || {};
const trackLength = courseData.trackLengthMeters || '';
const labels = courseData.obstacleLabels || [];
const specialPortAllowance = courseData.specialPortAllowance || {};

const stdAllowance = findPortAllowanceForClass(className);
const manualAllowance = precisionConfig.portAllowanceByClass?.[className];
        
const specialRows = labels.length > 0
    ? labels.map(label => {
        const delta = specialPortAllowance[label] ?? '';
        return `
            <div class="flex items-center gap-2">
                <span class="w-14 text-sm">${label}</span>
                <span class="flex-1 text-xs text-gray-500">± cm relativt standard</span>
                <input
                    type="number"
                    step="1"
                    class="special-port-input w-20 p-1 border rounded-md text-right"
                    data-label="${label}"
                    value="${delta === '' ? '' : delta}"
                    placeholder="0"
                />
            </div>
        `;
    }).join('')
    : `
        <p class="text-xs text-gray-400">
            Skriv in hinderetiketter, spara och ladda sidan igen för att kunna ange särskilda portar per hinder.
        </p>
    `;


        // ANVÄNDER DEN NYA, SMARTA FUNKTIONEN HÄR
        const tempo = findTempoForClass(className, klassTempoData);
        const tempoText = tempo > 0 ? tempo : '???';

        let maxTime = '--:--';
        if (trackLength > 0 && tempo > 0) {
            maxTime = secondsToMMSS((trackLength / tempo) * 60);
        }

        return `
            <div class="p-4 border-2 rounded-lg bg-gray-50" data-class-name="${className}">
                <h4 class="text-lg font-bold text-gray-800">${className}</h4>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
                    <div>
                        <label class="block text-sm font-medium">Port-tillägg (cm)</label>
                        <div class="flex items-center mt-1 p-2 bg-white border rounded-md">
                            <span class="flex-1 text-gray-700">Standard: <strong>${stdAllowance}</strong></span>
                            <input type="number" value="${manualAllowance || ''}" class="allowance-override-input w-24 p-1 border-gray-300 border rounded-md text-center" placeholder="Manuell">
                        </div>
                    </div>
                    <div>
                        <label for="len_${classId}" class="block text-sm font-medium">Banlängd (m)</label>
                        <input type="number" id="len_${classId}" value="${trackLength}" class="track-length-input mt-1 w-full p-2 border rounded-md">
                    </div>
                    <div>
                        <label class="block text-sm font-medium">Tempo & Maxtid</label>
                        <div class="flex items-baseline justify-between mt-1 p-2 bg-gray-200 rounded-md">
                           <span class="text-gray-700 text-sm">${tempoText} m/min</span>
                           <strong id="maxtime_${classId}" class="text-gray-800">${maxTime}</strong>
                        </div>
                    </div>
                </div>
                <div class="mt-4">
                    <label for="labels_${classId}" class="block text-sm font-medium">Hinderetiketter</label>
                    <textarea id="labels_${classId}" class="obstacle-labels-input mt-1 w-full min-h-[80px] p-2 border rounded-md font text-sm" placeholder="En per rad eller kommaseparerat, ex: 1, 2, 3, 5A, 5B ...">${labels.join(', ')}</textarea>
                </div>
                <div class="mt-4">
                    <label class="block text-sm font-medium">Särskilda portar per hinder</label>
                    <details class="mt-1 special-port-section">
                        <summary class="cursor-pointer text-sm text-blue-600 hover:underline">
                            Visa / ändra särskilda portar
                        </summary>
                        <p class="text-xs text-gray-500 mt-1">
                            Ange hur många cm smalare eller bredare varje hinder ska vara jämfört med klassens
                            standardport. Lämna tomt för standard.
                        </p>
                        <div class="mt-2 max-h-48 overflow-y-auto pr-1 space-y-1">
                            ${specialRows}
                        </div>
                    </details>
                </div>
                </div>
            </div>
        `;
    }).join('');
    
    container.querySelectorAll('.track-length-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const card = e.target.closest('[data-class-name]');
            const className = card.dataset.className;
            const classId = className.replace(/[^a-zA-Z0-9]/g, '_');
            
            // ANVÄNDER DEN NYA, SMARTA FUNKTIONEN ÄVEN HÄR
            const tempo = findTempoForClass(className, klassTempoData);
            const trackLength = parseFloat(e.target.value) || 0;
            const maxTimeOutput = document.getElementById(`maxtime_${classId}`);

            if (trackLength > 0 && tempo > 0 && maxTimeOutput) {
                maxTimeOutput.textContent = secondsToMMSS((trackLength / tempo) * 60);
            } else if (maxTimeOutput) {
                maxTimeOutput.textContent = '--:--';
            }
        });
    });
}

async function saveData() {
    try {
        const newConfig = {
            portAllowanceByClass: {},
            courses: {}
        };

        document.querySelectorAll('#classConfigsContainer [data-class-name]').forEach(card => {
            const className = card.dataset.className;
            const overrideInput = card.querySelector('.allowance-override-input');
            if (overrideInput && overrideInput.value) {
                newConfig.portAllowanceByClass[className] = parseFloat(overrideInput.value);
            }

const trackLength = parseFloat(card.querySelector('.track-length-input').value) || null;

// Hinderetiketter
const labelsText = card.querySelector('.obstacle-labels-input').value;
const labels = labelsText
    .split(/[,\n\r]+/)
    .map(s => s.trim())
    .filter(Boolean);

// Särskilda portar per hinder (± cm)
const specialInputs = card.querySelectorAll('.special-port-input');
const specialPortAllowance = {};
specialInputs.forEach(input => {
    const label = input.dataset.label;
    if (!label) return;
    const val = input.value.trim();
    if (val === '') return;
    const num = parseFloat(val.replace(',', '.'));
    if (!isNaN(num) && num !== 0) {
        specialPortAllowance[label] = num;
    }
});

// Bygg kurs-objektet
const courseConfig = {
    trackLengthMeters: trackLength,
    obstacleLabels: labels
};

if (Object.keys(specialPortAllowance).length > 0) {
    courseConfig.specialPortAllowance = specialPortAllowance;
}

newConfig.courses[className] = courseConfig;

        });

        await saveConfig(competitionId, 'precisionConfig', newConfig);
        showAlert('Inställningar för precision har sparats!', 'success');
        precisionConfig = newConfig;

    } catch (e) {
        console.error("Fel vid sparande av precision-config:", e);
        showAlert("Kunde inte spara.", 'error');
    }
}

export async function load() {
    const comp = getGlobalState('currentCompetition');
    competitionId = comp?.id;
    const root = document.getElementById('page-precision-admin');
    if (!competitionId) {
        if(root) root.innerHTML = '<p class="p-8 text-center text-gray-600">Ingen tävling vald.</p>';
        return;
    }

    renderLayout();

    try {
        const [equipagesData, configData] = await Promise.all([
            getEquipages(competitionId),
            getConfig(competitionId, 'precisionConfig')
        ]);
        
        precisionConfig = configData || {};
        activeClasses = [...new Set(equipagesData.map(e => e.className).filter(Boolean))].sort();
        
        renderClassCards();

        document.getElementById('btnSaveAll').addEventListener('click', saveData);

    } catch (error) {
        console.error("Kunde inte ladda data för precision-admin:", error);
        showAlert("Kunde inte ladda nödvändig data.", 'error');
    }
}

export function __unload() {
    // Inga aktiva lyssnare att städa här
}