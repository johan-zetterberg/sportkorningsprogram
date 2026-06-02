import { getGlobalState } from '../../main.js';
import { getEquipages } from '../../services/equipageService.js';
import { getConfig } from '../../services/competitionService.js';
import { saveConfig } from '../../services/competitionService.js';
import { getCompetitionHeader, showAlert } from '../../ui/components.js';
import { standardPortAllowance, klassTempoData } from '../../data/competitionData.js';
import { generatePrecisionCourseSetupPdf } from '../../pdf/precisionPdf.js';
import {
    hasPrecisionValidationErrors,
    parsePrecisionObstacleLabels,
    validatePrecisionAdminSettings
} from './precisionAdminValidation.js';

let competitionId = null;
let activeClasses = [];
let precisionConfig = {};

const PRECISION_ERROR_CLASSES = ['border-red-500', 'ring-2', 'ring-red-300', 'bg-red-50', 'dark:bg-red-950/30'];

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function parseOptionalNumber(value) {
    const text = String(value ?? '').trim().replace(',', '.');
    if (text === '') return null;
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
}

function secondsToMMSS(seconds) {
    if (isNaN(seconds) || seconds < 0) return "--:--";
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function findTempoForClass(className, tempoData) {
    if (!className || !tempoData) return 0;

    const normalize = (str) => String(str).replace(/^[\d\s\.,&\;-]+/, '').toLowerCase().replace(/[^a-z0-9åäö]/g, '');
    const normalizedClassName = normalize(className);

    // 1. Försök med en exakt (normaliserad) matchning
    const exactKey = Object.keys(tempoData).find(key => normalize(key) === normalizedClassName);
    // ÄNDRING HÄR: Byt ut .tempo mot .precision
    if (exactKey && tempoData[exactKey]?.precision) {
        return tempoData[exactKey].precision;
    }

    // 2. Om exakt matchning misslyckas, hitta den längsta nyckeln som passar generellt
    const matchingKey = Object.keys(tempoData)
        .filter(key => {
            const normKey = normalize(key);

            // Prevent generic names from matching special classes
            const isSpecialDictKey = /(para|barn|children)/.test(normKey);
            const isSpecialClass = /(para|barn|children)/.test(normalizedClassName);
            if (isSpecialDictKey && !isSpecialClass) return false;

            // Dictionary-nyckeln börjar med (el lika med) klassnamnet
            if (normKey.startsWith(normalizedClassName)) return true;
            // Ett generellt klassnamn ("msv4") är ett prefix för en Dictionary-nyckel ("msv4enbetponny")
            if (normalizedClassName.length > 3 && normKey.includes(normalizedClassName)) return true;
            // Klassnamnet innehåller Dictionary-nyckeln ("msv4" i "enbetponnymsv4")
            if (normalizedClassName.includes(normKey)) return true;

            return false;
        })
        .sort((a, b) => {
            // Favor "Häst" dict keys to avoid low-tempo bias
            const normA = normalize(a);
            const normB = normalize(b);
            const aHasHast = normA.includes('hast') ? 1 : 0;
            const bHasHast = normB.includes('hast') ? 1 : 0;
            if (bHasHast !== aHasHast) return bHasHast - aHasHast;

            return b.length - a.length;
        })[0];

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

    const normalize = (str) => String(str).replace(/^[\d\s\.,&\;-]+/, '').toLowerCase().replace(/[^a-z0-9åäö]/g, '');
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

    const defRate = comp?.ruleSettings?.precisionTimePenaltyRate ?? 0.5;

    root.innerHTML = `
        ${getCompetitionHeader(comp, 'Precision – Inställningar')}
        <div class="max-w-[900px] mx-auto p-4 space-y-6">
            <section class="p-4 border rounded-lg bg-white shadow-sm dark:bg-gray-800 dark:border-gray-700">
                <h3 class="text-xl font-semibold mb-2 dark:text-white">Inställningar per Klass</h3>
                <p class="text-sm text-gray-600 mb-4 dark:text-gray-400">
                    Systemet använder standard-tillägg (allowance) och tempon enligt TR/FEI. Fyll endast i ett manuellt värde om du vill åsidosätta standarden för en specifik klass.
                </p>
                <details class="mb-4 bg-blue-50 dark:bg-gray-700 p-3 rounded-md text-sm border border-blue-100 dark:border-gray-600">
                    <summary class="font-medium cursor-pointer text-blue-800 dark:text-blue-300">Visa standardtempon (TR/FEI)</summary>
                    <div class="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs text-gray-700 dark:text-gray-300">
                        ${Object.entries(klassTempoData)
            .filter(([_, d]) => d.precision > 0)
            .map(([k, d]) => `<div><span class="font-semibold">${k}:</span> ${d.precision} m/min</div>`)
            .join('')}
                    </div>
                </details>
                <div id="classConfigsContainer" class="space-y-4">
                    <p class="dark:text-gray-400">Laddar klasser...</p>
                </div>
            </section>

            <section class="p-4 border rounded-lg bg-white shadow-sm dark:bg-gray-800 dark:border-gray-700">
                <h3 class="text-xl font-semibold mb-2 dark:text-white">Globala Inställningar</h3>
                <p class="text-sm text-gray-600 mb-4 dark:text-gray-400">
                    Dessa inställningar gäller för hela tävlingen om inget annat anges.
                </p>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div class="precision-field-wrap">
                        <label class="block text-sm font-medium dark:text-gray-300">Straff per nedslag (p)</label>
                        <input type="number" step="0.5" id="globalKnockdownPenalty" class="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="3">
                        <p class="text-xs text-gray-500 mt-1 dark:text-gray-500">Standard: 3 p (FEI/Nationellt). TR förr: 4 p? Ändra här vid behov.</p>
                    </div>
                    <div class="precision-field-wrap">
                        <label class="block text-sm font-medium dark:text-gray-300">Tidsstraff per sekund (p/s)</label>
                        <input type="number" step="0.1" id="globalTimePenaltyRate" class="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="${defRate}">
                        <p class="text-xs text-gray-500 mt-1 dark:text-gray-500">Standard: ${defRate} straff per påbörjad sekund över maxtiden.</p>
                    </div>
                </div>
            </section>
            <section class="p-4 border rounded-lg bg-white shadow-sm dark:bg-gray-800 dark:border-gray-700">
                <div class="flex justify-between items-center mb-4 border-b dark:border-gray-700 pb-2">
                    <h3 class="text-xl font-semibold dark:text-white">Karta och Passertider (Split-tider)</h3>
                    <div class="flex gap-4 items-center">
                        <label class="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" id="precMapHideBackground" class="sr-only peer">
                            <div class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-brand-darkblue"></div>
                            <span class="ml-2 text-xs font-medium text-gray-700 dark:text-gray-300" title="Gömmer bakgrundsbilden på publik vy men behåller den här i admin för placering.">Dölj bakgrund för publik</span>
                        </label>
                        <label class="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" id="toggleMapFeature" class="sr-only peer">
                            <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-brand-darkblue"></div>
                            <span class="ml-3 text-sm font-medium text-gray-900 dark:text-gray-300">Aktiverad</span>
                        </label>
                    </div>
                </div>
                
                <div id="mapSettingsContainer" class="space-y-4 hidden">
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="precision-field-wrap">
                      <label for="precMapImageUrl" class="block text-sm font-medium dark:text-gray-300">Bild-URL för karta</label>
                      <div class="flex gap-2">
                        <input type="text" id="precMapImageUrl" class="flex-1 p-2 border rounded-md text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="t.ex. img/precision-map.png">
                      </div>
                      
                      <!-- Upload Tools -->
                      <div class="flex items-center gap-2 mt-2">
                        <input type="file" id="precMapImageUploadInput" accept="image/*" class="hidden">
                        <button type="button" id="btnUploadPrecMapImage" class="bg-blue-50 border-2 border-blue-200 text-blue-700 hover:bg-blue-100 hover:border-blue-300 px-3 py-1.5 rounded-md text-xs font-bold transition-all shadow-sm flex items-center gap-1 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-900/40" title="Ladda upp bildfil">
                            <span>📤 Ladda upp bildfil</span>
                        </button>
                        <button type="button" id="btnPrecGoogleDriveHelper" class="bg-white border-2 border-green-100 hover:border-green-500 text-green-600 px-3 py-1.5 rounded-md text-xs font-bold transition-all shadow-sm flex items-center gap-1 dark:bg-gray-700 dark:border-green-900 dark:text-green-400" title="Konvertera Google Drive-länk">
                            <span class="text-lg">📁</span> G-Drive
                        </button>
                      </div>
                    </div>

                    <div>
                      <label class="block text-sm font-medium dark:text-gray-300">Bander (Bounds)</label>
                      <div class="flex gap-2 items-center">
                          <span class="text-xs text-gray-500 dark:text-gray-400">[0,0] till</span>
                          <input type="number" id="precMapBoundsX" class="mt-1 w-24 p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="X (1920)">
                          <input type="number" id="precMapBoundsY" class="mt-1 w-24 p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="Y (1080)">
                          <button type="button" id="btnPrecFixAspectRatio" class="text-[10px] text-blue-600 hover:underline dark:text-blue-400" title="Sätt bounds efter bildens faktiska storlek">Matcha bildens mått</button>
                      </div>
                    </div>
                  </div>

                  <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    <div>
                      <div class="bg-blue-50/50 p-3 rounded-lg border border-blue-100 dark:bg-blue-900/20 dark:border-blue-800 mb-4">
                        <label for="precMapEntitySelector" class="block text-sm font-bold text-blue-800 mb-1 dark:text-blue-200">Klicka på kartan för att placera gates</label>
                        <div class="flex gap-2">
                            <select id="precMapEntitySelector" class="flex-1 p-2 border border-blue-200 rounded-md text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none dark:bg-gray-700 dark:border-blue-900 dark:text-white">
                                <option value="start">🚩 Start</option>
                                <option value="finish">🏆 Mål (Finish)</option>
                            </select>
                        </div>
                        <div class="mt-2 flex items-center gap-2 flex-wrap">
                          <button type="button" id="btnGeneratePrecGates" class="text-xs bg-blue-100 border border-blue-300 px-3 py-1.5 rounded text-blue-800 hover:bg-blue-200 dark:bg-blue-800 dark:text-blue-200 dark:border-blue-700 font-bold shadow-sm">Hämta gates från klasser</button>
                          <span class="text-[10px] text-gray-500">eller manuellt antal:</span>
                          <input type="number" id="precGateCount" min="1" max="30" class="w-16 p-1 border rounded text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="Antal">
                        </div>
                      </div>
                      
                      <div class="precision-field-wrap">
                        <label for="precMapCoordsJson" class="block text-sm font-medium text-gray-600 dark:text-gray-400">Koordinater (JSON)</label>
                        <textarea id="precMapCoordsJson" rows="6" class="mt-1 w-full p-2 border rounded-md font-mono text-xs dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300" placeholder='{"start": [100, 200], ...}'></textarea>
                      </div>
                    </div>

                    <div class="h-[400px] border-2 border-gray-100 rounded-xl overflow-hidden bg-gray-50 relative shadow-inner z-0 dark:border-gray-700 dark:bg-gray-900">
                        <div id="prec-admin-map-picker" class="w-full h-full"></div>
                        <div class="absolute top-2 right-2 z-[1000] pointer-events-none">
                            <span class="bg-gray-900/80 text-white text-[9px] px-2 py-1 rounded-full backdrop-blur uppercase tracking-widest font-bold">Preview / Picker</span>
                        </div>
                    </div>
                  </div>
                </div>
            </section>

            <div class="flex justify-end gap-3 mt-6">
                <button id="btnPrintCourse" class="px-5 py-3 bg-gray-700 text-white font-semibold rounded-lg hover:bg-gray-600 flex items-center gap-2">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
                    Skriv ut banlayout (PDF)
                </button>
                <button id="btnSaveAll" class="px-6 py-3 bg-brand-darkblue text-white font-bold rounded-lg hover:bg-brand-gold hover:text-brand-darkblue dark:bg-blue-600 dark:hover:bg-blue-500">Spara alla precisionsinställningar</button>
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
        const trackLength = courseData.trackLengthMeters ?? '';
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
                    class="special-port-input w-20 p-1 border rounded-md text-right dark:bg-gray-700 dark:border-gray-600 dark:text-white"
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


        const stdTempo = findTempoForClass(className, klassTempoData);
        const savedTempo = precisionConfig.courses?.[className]?.tempo;
        // Use saved override if available, otherwise the TR standard tempo.
        const activeTempo = savedTempo > 0 ? savedTempo : stdTempo;

        let maxTime = '--:--';
        if (trackLength > 0 && activeTempo > 0) {
            maxTime = secondsToMMSS((trackLength / activeTempo) * 60);
        }

        return `
            <div class="p-4 border-2 rounded-lg bg-gray-50 dark:bg-gray-800 dark:border-gray-700" data-class-name="${className}">
                <h4 class="text-lg font-bold text-gray-800 dark:text-white">${className}</h4>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
                    <div>
                        <label class="block text-sm font-medium dark:text-gray-300">Port-tillägg (cm)</label>
                        <div class="flex items-center mt-1 p-2 bg-white border rounded-md dark:bg-gray-700 dark:border-gray-600">
                            <span class="flex-1 text-gray-700 dark:text-gray-300">Standard: <strong>${stdAllowance}</strong></span>
                            <input type="number" value="${manualAllowance ?? ''}" class="allowance-override-input w-24 p-1 border-gray-300 border rounded-md text-center dark:bg-gray-600 dark:border-gray-500 dark:text-white" placeholder="Manuell">
                        </div>
                    </div>
                    <div>
                        <label for="len_${classId}" class="block text-sm font-medium dark:text-gray-300">Banlängd (m)</label>
                        <input type="number" id="len_${classId}" value="${trackLength}" class="track-length-input mt-1 w-full p-2 border rounded-md dark:bg-gray-600 dark:border-gray-500 dark:text-white">
                    </div>
                    <div>
                        <label class="block text-sm font-medium dark:text-gray-300">Tempo & Maxtid</label>
                        <div class="flex items-center gap-2 mt-1 p-2 bg-gray-100 border rounded-md dark:bg-gray-700 dark:border-gray-600">
                           <div class="flex items-center gap-1">
                               <input type="number" value="${savedTempo ?? ''}" class="tempo-override-input w-20 p-1 text-sm border-gray-300 border rounded-md text-center dark:bg-gray-600 dark:border-gray-500 dark:text-white" placeholder="${stdTempo > 0 ? stdTempo : '???'}">
                               <span class="text-xs text-gray-600 dark:text-gray-400">m/min</span>
                           </div>
                           <span class="flex-1 text-right text-xs text-gray-500">Maxtid:</span>
                           <strong id="maxtime_${classId}" class="text-gray-800 dark:text-white whitespace-nowrap">${maxTime}</strong>
                        </div>
                    </div>
                </div>
                <div class="precision-field-wrap mt-4">
                    <label for="labels_${classId}" class="block text-sm font-medium dark:text-gray-300">Hinderetiketter</label>
                    <textarea id="labels_${classId}" class="obstacle-labels-input mt-1 w-full min-h-[80px] p-2 border rounded-md font text-sm dark:bg-gray-600 dark:border-gray-500 dark:text-white" placeholder="En per rad eller kommaseparerat, ex: 1, 2, 3, 5A, 5B ...">${labels.join(', ')}</textarea>
                </div>
                <div class="mt-4">
                    <label class="block text-sm font-medium dark:text-gray-300">Särskilda portar per hinder</label>
                    <details class="mt-1 special-port-section">
                        <summary class="cursor-pointer text-sm text-blue-600 hover:underline dark:text-blue-400">
                            Visa / ändra särskilda portar
                        </summary>
                        <p class="text-xs text-gray-500 mt-1 dark:text-gray-400">
                            Ange hur många cm smalare eller bredare varje hinder ska vara jämfört med klassens
                            standardport. Lämna tomt för standard.
                        </p>
                        <div class="mt-2 max-h-48 overflow-y-auto pr-1 space-y-1">
                            ${specialRows}
                        </div>
                    </details>
                </div>
            </div>
        `;
    }).join('');

    const updateMaxTime = (e) => {
        const card = e.target.closest('[data-class-name]');
        const className = card.dataset.className;
        const classId = className.replace(/[^a-zA-Z0-9]/g, '_');

        const stdTempo = findTempoForClass(className, klassTempoData);
        const overrideTempo = parseOptionalNumber(card.querySelector('.tempo-override-input').value);
        const activeTempo = overrideTempo > 0 ? overrideTempo : stdTempo;

        const trackLength = parseOptionalNumber(card.querySelector('.track-length-input').value) || 0;
        const maxTimeOutput = document.getElementById(`maxtime_${classId}`);

        if (trackLength > 0 && activeTempo > 0 && maxTimeOutput) {
            maxTimeOutput.textContent = secondsToMMSS((trackLength / activeTempo) * 60);
        } else if (maxTimeOutput) {
            maxTimeOutput.textContent = '--:--';
        }
    };

    container.querySelectorAll('.obstacle-labels-input').forEach(textarea => {
        textarea.addEventListener('input', (e) => {
            const card = e.target.closest('[data-class-name]');
            const className = card.dataset.className;
            const labelsText = e.target.value;
            const labels = labelsText
                .split(/[,\n\r]+/)
                .map(s => s.trim())
                .filter(Boolean);

            const specialPortSection = card.querySelector('.special-port-section div');
            if (!specialPortSection) return;

            // Try to keep existing values from inputs
            const currentValues = {};
            specialPortSection.querySelectorAll('.special-port-input').forEach(input => {
                if (input.value) currentValues[input.dataset.label] = input.value;
            });

            // Fallback to loaded config if not in inputs yet
            const savedSpecial = precisionConfig.courses?.[className]?.specialPortAllowance || {};

            if (labels.length === 0) {
                specialPortSection.innerHTML = '<p class="text-xs text-gray-400">Ange etiketter ovan för att se port-avvikelser.</p>';
                return;
            }

            specialPortSection.innerHTML = labels.map(label => {
                const val = currentValues[label] ?? savedSpecial[label] ?? '';
                return `
                    <div class="flex items-center gap-2">
                        <span class="w-14 text-sm">${label}</span>
                        <span class="flex-1 text-xs text-gray-500">± cm relativt standard</span>
                        <input
                            type="number"
                            step="1"
                            class="special-port-input w-20 p-1 border rounded-md text-right dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                            data-label="${label}"
                            value="${val}"
                            placeholder="0"
                        />
                    </div>
                `;
            }).join('');
        });
    });
}

async function saveData() {
    try {
        clearPrecisionValidationDom();
        const comp = getGlobalState('currentCompetition');
        const defRate = comp?.ruleSettings?.precisionTimePenaltyRate ?? 0.5;
        
        const knockdownPenaltyRaw = document.getElementById('globalKnockdownPenalty')?.value ?? '';
        const timePenaltyRateRaw = document.getElementById('globalTimePenaltyRate')?.value ?? '';
        const knockdownPenalty = parseOptionalNumber(knockdownPenaltyRaw);
        const timePenaltyRate = parseOptionalNumber(timePenaltyRateRaw);

        const newConfig = {
            ...precisionConfig,
            portAllowanceByClass: {},
            courses: {},
            knockdownPenalty: knockdownPenalty ?? 3,
            timePenaltyRate: timePenaltyRate ?? defRate
        };
        const validationClassRows = {};

        document.querySelectorAll('#classConfigsContainer [data-class-name]').forEach(card => {
            const className = card.dataset.className;
            const overrideInput = card.querySelector('.allowance-override-input');
            const allowanceOverrideRaw = overrideInput?.value ?? '';
            const allowanceOverride = parseOptionalNumber(allowanceOverrideRaw);
            if (allowanceOverride != null) {
                newConfig.portAllowanceByClass[className] = allowanceOverride;
            }

            const trackLengthRaw = card.querySelector('.track-length-input')?.value ?? '';
            const tempoRaw = card.querySelector('.tempo-override-input')?.value ?? '';
            const trackLength = parseOptionalNumber(trackLengthRaw);
            const tempo = parseOptionalNumber(tempoRaw);

            // Hinderetiketter
            const labelsText = card.querySelector('.obstacle-labels-input').value;
            const labels = parsePrecisionObstacleLabels(labelsText);

            // Särskilda portar per hinder (± cm)
            const specialInputs = card.querySelectorAll('.special-port-input');
            const specialPortAllowance = {};
            const specialPortAllowanceRaw = {};
            specialInputs.forEach(input => {
                const label = input.dataset.label;
                if (!label) return;
                const val = input.value.trim();
                specialPortAllowanceRaw[label] = val;
                if (val === '') return;
                const num = parseOptionalNumber(val);
                if (num != null && num !== 0) {
                    specialPortAllowance[label] = num;
                }
            });

            // Bygg kurs-objektet
            const courseConfig = {
                trackLengthMeters: trackLength,
                obstacleLabels: labels,
                tempo: tempo
            };

            if (Object.keys(specialPortAllowance).length > 0) {
                courseConfig.specialPortAllowance = specialPortAllowance;
            }

            newConfig.courses[className] = courseConfig;
            validationClassRows[className] = {
                trackLengthMeters: trackLengthRaw,
                tempo: tempoRaw,
                obstacleLabelsText: labelsText,
                allowanceOverride: allowanceOverrideRaw,
                specialPortAllowance: specialPortAllowanceRaw
            };

        });

        const mapJsonRaw = document.getElementById('precMapCoordsJson')?.value || '{}';
        let mapEntitiesParseError = false;
        let mapEntities = {};
        try {
            mapEntities = JSON.parse(mapJsonRaw);
        } catch(e) {
            mapEntitiesParseError = true;
        }

        const mapSettings = {
            enabled: document.getElementById('toggleMapFeature')?.checked || false,
            hideBackground: document.getElementById('precMapHideBackground')?.checked || false,
            imageUrl: document.getElementById('precMapImageUrl')?.value || '',
            bounds: [
                0, 0,
                parseInt(document.getElementById('precMapBoundsY')?.value) || 1080,
                parseInt(document.getElementById('precMapBoundsX')?.value) || 1920
            ],
            entities: mapEntitiesParseError ? {} : mapEntities
        };
        newConfig.mapSettings = mapSettings;

        const validation = validatePrecisionAdminSettings({
            classes: validationClassRows,
            global: {
                knockdownPenalty: knockdownPenaltyRaw,
                timePenaltyRate: timePenaltyRateRaw
            },
            map: {
                enabled: mapSettings.enabled,
                entities: mapSettings.entities,
                entitiesParseError: mapEntitiesParseError
            }
        }, (className) => ({
            hasStandardTempo: findTempoForClass(className, klassTempoData) > 0
        }));

        if (hasPrecisionValidationErrors(validation)) {
            applyPrecisionValidationDom(validation);
            showAlert('Precisionens inställningar saknar obligatoriska värden. Kontrollera rödmarkerade fält.', 'error');
            return;
        }

        await saveConfig(competitionId, 'precisionConfig', newConfig);
        clearPrecisionValidationDom();
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
        if (root) root.innerHTML = '<p class="p-8 text-center text-gray-600">Ingen tävling vald.</p>';
        return;
    }

    renderLayout();
    setupPrecisionValidationListeners(root);

    try {
        const [equipagesData, configData] = await Promise.all([
            getEquipages(competitionId),
            getConfig(competitionId, 'precisionConfig')
        ]);

        precisionConfig = configData || {};

        activeClasses = [...new Set(equipagesData.map(e => {
            if (e.useMergedTestForDisplay && e.mergedTestLabel) {
                return e.mergedTestLabel;
            }
            return e.className;
        }).filter(Boolean))].sort();

        // Populate global inputs
        const kpInput = document.getElementById('globalKnockdownPenalty');
        const tpInput = document.getElementById('globalTimePenaltyRate');
        
        const defRate = comp?.ruleSettings?.precisionTimePenaltyRate ?? 0.5;
        
        if (kpInput) kpInput.value = precisionConfig.knockdownPenalty != null ? precisionConfig.knockdownPenalty : 3;
        if (tpInput) tpInput.value = precisionConfig.timePenaltyRate != null ? precisionConfig.timePenaltyRate : defRate;

        renderClassCards();

        const mapSettings = precisionConfig.mapSettings || {};
        const toggleMap = document.getElementById('toggleMapFeature');
        const mapContainer = document.getElementById('mapSettingsContainer');
        if (toggleMap) {
            toggleMap.checked = mapSettings.enabled || false;
            if (toggleMap.checked) mapContainer?.classList.remove('hidden');
            toggleMap.onchange = () => {
                if (toggleMap.checked) {
                    mapContainer?.classList.remove('hidden');
                    initPrecPickerMap();
                } else {
                    mapContainer?.classList.add('hidden');
                }
            };
        }
        
        setupPrecMapSettings(mapSettings);

        const saveButton = document.getElementById('btnSaveAll');
        if (saveButton) saveButton.onclick = saveData;

        const printButton = document.getElementById('btnPrintCourse');
        if (printButton) printButton.onclick = async () => {
            const btn = document.getElementById('btnPrintCourse');
            const orig = btn.innerHTML;
            btn.disabled = true;
            btn.textContent = 'Genererar PDF...';
            try {
                const comp = getGlobalState('currentCompetition');
                await generatePrecisionCourseSetupPdf(precisionConfig, equipagesData, comp);
            } catch (e) {
                console.error('PDF fel:', e);
                showAlert('Kunde inte skapa PDF.', 'error');
            } finally {
                btn.disabled = false;
                btn.innerHTML = orig;
            }
        };

    } catch (error) {
        console.error("Kunde inte ladda data för precision-admin:", error);
        showAlert("Kunde inte ladda nödvändig data.", 'error');
    }
}

export function __unload() {
    if (precPickerMap) {
        precPickerMap.remove();
        precPickerMap = null;
    }
    precPickerMarkers.clear();
    currentPrecEntities = {};
}

function clearPrecisionFieldError(input) {
    if (!input) return;
    input.classList.remove('precision-validation-error', ...PRECISION_ERROR_CLASSES);
    input.closest('.precision-field-wrap')?.querySelector('.precision-field-error')?.remove();
}

function markPrecisionFieldError(input, message) {
    if (!input) return;
    input.classList.add('precision-validation-error', ...PRECISION_ERROR_CLASSES);
    const wrapper = input.closest('.precision-field-wrap') || input.parentElement;
    if (!wrapper || wrapper.querySelector('.precision-field-error')) return;
    wrapper.insertAdjacentHTML('beforeend', `<p class="precision-field-error mt-1 text-xs font-semibold text-red-600 dark:text-red-300">${escapeHtml(message)}</p>`);
}

function clearPrecisionValidationDom() {
    document.querySelectorAll('.precision-validation-summary, .precision-field-error').forEach(el => el.remove());
    document.querySelectorAll('.precision-validation-error').forEach(el => {
        el.classList.remove('precision-validation-error', ...PRECISION_ERROR_CLASSES);
    });
}

function fieldSelectorForPrecisionError(field) {
    return {
        trackLengthMeters: '.track-length-input',
        tempo: '.tempo-override-input',
        obstacleLabels: '.obstacle-labels-input',
        allowanceOverride: '.allowance-override-input'
    }[field];
}

function applyPrecisionValidationDom(result) {
    clearPrecisionValidationDom();

    const globalTargets = {
        knockdownPenalty: document.getElementById('globalKnockdownPenalty'),
        timePenaltyRate: document.getElementById('globalTimePenaltyRate')
    };

    (result.global || []).forEach(error => markPrecisionFieldError(globalTargets[error.field], error.message));
    (result.map || []).forEach(error => markPrecisionFieldError(document.getElementById('precMapCoordsJson'), error.message));

    const summaryItems = [];
    Object.entries(result.classes || {}).forEach(([className, errors]) => {
        const card = document.querySelector(`#classConfigsContainer [data-class-name="${CSS.escape(className)}"]`);
        if (!card) return;

        const messages = errors.map(error => error.message);
        summaryItems.push(`${className}: ${messages.join(' ')}`);
        card.insertAdjacentHTML('afterbegin', `
            <div class="precision-validation-summary mb-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-700 dark:border-red-700 dark:bg-red-950/30 dark:text-red-200">
                Kontrollera: ${escapeHtml(messages.join(' '))}
            </div>
        `);

        errors.forEach(error => {
            const selector = fieldSelectorForPrecisionError(error.field);
            if (selector) markPrecisionFieldError(card.querySelector(selector), error.message);
        });
    });

    const container = document.getElementById('classConfigsContainer');
    if (container && summaryItems.length) {
        container.insertAdjacentHTML('afterbegin', `
            <div class="precision-validation-summary rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-700 dark:bg-red-950/30 dark:text-red-200">
                <strong>Inställningarna kan inte sparas ännu.</strong> Fyll i markerade fält för varje klass.
            </div>
        `);
    }
}

function setupPrecisionValidationListeners(root) {
    if (!root) return;
    root.addEventListener('input', event => {
        if (event.target instanceof HTMLElement) {
            clearPrecisionFieldError(event.target);
        }
    });
    root.addEventListener('change', event => {
        if (event.target instanceof HTMLElement) {
            clearPrecisionFieldError(event.target);
        }
    });
}

// --- Map Picker Logic ---
let precPickerMap = null;
let precPickerMarkers = new Map();
let currentPrecEntities = {};

function setupPrecMapSettings(mapSettings) {
    const imgUrlInput = document.getElementById('precMapImageUrl');
    const uploadMapBtn = document.getElementById('btnUploadPrecMapImage');
    const uploadMapInput = document.getElementById('precMapImageUploadInput');
    const boundsXInput = document.getElementById('precMapBoundsX');
    const boundsYInput = document.getElementById('precMapBoundsY');
    const coordsJsonInput = document.getElementById('precMapCoordsJson');
    const entitySelector = document.getElementById('precMapEntitySelector');
    const driveHelperBtn = document.getElementById('btnPrecGoogleDriveHelper');
    const fixAspectBtn = document.getElementById('btnPrecFixAspectRatio');
    const btnGenerateGates = document.getElementById('btnGeneratePrecGates');
    const gateCountInput = document.getElementById('precGateCount');

    if (!imgUrlInput) return;

    imgUrlInput.value = mapSettings.imageUrl || '';
    const b = mapSettings.bounds || [];
    const isNested = Array.isArray(b[0]);
    boundsXInput.value = isNested ? b[1][1] : (b[3] || 1920);
    boundsYInput.value = isNested ? b[1][0] : (b[2] || 1080);
    currentPrecEntities = mapSettings.entities || {};
    coordsJsonInput.value = JSON.stringify(currentPrecEntities, null, 2);

    updateGateSelector(currentPrecEntities);

    // Initial load
    if (document.getElementById('toggleMapFeature')?.checked) {
        initPrecPickerMap();
    }

    imgUrlInput.onchange = () => initPrecPickerMap();
    boundsXInput.onchange = () => initPrecPickerMap();
    boundsYInput.onchange = () => initPrecPickerMap();
    coordsJsonInput.onchange = () => {
        try {
            currentPrecEntities = JSON.parse(coordsJsonInput.value);
            updateGateSelector(currentPrecEntities);
            syncPrecMarkers();
        } catch(e) {}
    };

    entitySelector.onchange = () => syncPrecMarkers();

    if (btnGenerateGates) btnGenerateGates.onclick = () => {
        // Hämta unika gates från alla klasser
        const uniqueGates = new Set();
        document.querySelectorAll('.obstacle-labels-input').forEach(textarea => {
            const labels = textarea.value.split(/[,\n\r]+/).map(s => s.trim()).filter(Boolean);
            labels.forEach(l => uniqueGates.add(l));
        });

        const newEntities = { start: currentPrecEntities.start || [0,0], finish: currentPrecEntities.finish || [0,0] };
        
        const count = parseInt(gateCountInput.value) || 0;
        
        if (uniqueGates.size > 0 && count === 0) {
            // Använd gates från klasser
            const sortedGates = Array.from(uniqueGates).sort((a,b) => {
                const numA = parseInt(a) || 0;
                const numB = parseInt(b) || 0;
                if (numA === numB) return a.localeCompare(b);
                return numA - numB;
            });
            sortedGates.forEach(g => {
                newEntities['gate_'+g] = currentPrecEntities['gate_'+g] || [0,0];
            });
            showAlert(`Skapade ${sortedGates.length} gates från klasskonfigurationer.`);
        } else if (count > 0) {
            // Fallback till manuellt antal om ingen klass har gates, eller om man skrivit i Antal-rutan
            for(let i=1; i<=count; i++) {
                newEntities['gate_'+i] = currentPrecEntities['gate_'+i] || [0,0];
            }
            showAlert(`Skapade ${count} gates manuellt.`);
        } else {
            showAlert('Inga gates hittades i klasserna. Skriv in ett manuellt antal.', 'error');
            return;
        }

        currentPrecEntities = newEntities;
        coordsJsonInput.value = JSON.stringify(currentPrecEntities, null, 2);
        updateGateSelector(currentPrecEntities);
        syncPrecMarkers();
    };

    if (uploadMapBtn) uploadMapBtn.onclick = () => uploadMapInput?.click();
    if (uploadMapInput) uploadMapInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
            showAlert('Filen är för stor (Max 5MB).', 'error');
            return;
        }
        uploadMapBtn.textContent = 'Laddar upp...';
        try {
            const { uploadCompetitionDocument } = await import('../../services/storageService.js');
            const downloadUrl = await uploadCompetitionDocument(competitionId, file);
            imgUrlInput.value = downloadUrl;
            imgUrlInput.dispatchEvent(new Event('change'));
            showAlert('Karta uppladdad!');
        } catch (err) {
            showAlert('Uppladdning misslyckades: ' + err.message, 'error');
        } finally {
            uploadMapBtn.textContent = 'Ladda upp bildfil';
            uploadMapInput.value = '';
        }
    };

    if (driveHelperBtn) driveHelperBtn.onclick = () => {
        const rawUrl = imgUrlInput.value.trim();
        let fileId = null;
        const fileDMatch = rawUrl.match(/\/file\/d\/([a-zA-Z0-9_-]{25,})/);
        const idMatch = rawUrl.match(/[?&]id=([a-zA-Z0-9_-]{25,})/);
        if (fileDMatch) fileId = fileDMatch[1];
        else if (idMatch) fileId = idMatch[1];

        if (fileId) {
            imgUrlInput.value = `https://drive.google.com/thumbnail?id=${fileId}&sz=w1600`;
            imgUrlInput.dispatchEvent(new Event('change'));
            showAlert('Google Drive-länk konverterad!');
        } else {
            showAlert('Detta ser inte ut som en Google Drive-länk.', 'error');
        }
    };
    
    if (fixAspectBtn) fixAspectBtn.onclick = () => {
        const url = imgUrlInput.value.trim();
        if(!url) return;
        const img = new Image();
        img.onload = () => {
            boundsXInput.value = img.width;
            boundsYInput.value = img.height;
            boundsXInput.dispatchEvent(new Event('change'));
            showAlert(`Mått uppdaterade till ${img.width}x${img.height}`);
        };
        img.src = url;
    };
}

function updateGateSelector(entities) {
    const selector = document.getElementById('precMapEntitySelector');
    if (!selector) return;
    const currentVal = selector.value;
    
    let optionsHtml = `
        <option value="start">🚩 Start</option>
        <option value="finish">🏆 Mål (Finish)</option>
    `;
    const gates = Object.keys(entities).filter(k => k.startsWith('gate_')).sort((a,b) => {
        const valA = a.replace('gate_', '');
        const valB = b.replace('gate_', '');
        const numA = parseInt(valA) || 0;
        const numB = parseInt(valB) || 0;
        if (numA === numB) return valA.localeCompare(valB);
        return numA - numB;
    });
    if (gates.length > 0) {
        optionsHtml += `<optgroup label="Gates">`;
        gates.forEach(g => {
            optionsHtml += `<option value="${g}">Port ${g.replace('gate_','')}</option>`;
        });
        optionsHtml += `</optgroup>`;
    }
    selector.innerHTML = optionsHtml;
    if (entities[currentVal]) selector.value = currentVal;
}

function initPrecPickerMap() {
    if (!document.getElementById('prec-admin-map-picker')) return;
    if (precPickerMap) precPickerMap.remove();

    precPickerMap = L.map('prec-admin-map-picker', {
        crs: L.CRS.Simple,
        minZoom: -4,
        maxZoom: 2,
        zoomSnap: 0,
        zoomDelta: 0.1,
        wheelPxPerZoomLevel: 150,
        zoomControl: true,
        attributionControl: false
    });

    const x = parseInt(document.getElementById('precMapBoundsX')?.value) || 1920;
    const y = parseInt(document.getElementById('precMapBoundsY')?.value) || 1080;
    const bounds = [[0, 0], [y, x]];
    const imgUrl = document.getElementById('precMapImageUrl')?.value.trim();

    if (imgUrl) {
        L.imageOverlay(imgUrl, bounds).addTo(precPickerMap);
    }
    precPickerMap.fitBounds(bounds);
    syncPrecMarkers();

    precPickerMap.on('click', (e) => {
        const lat = Math.round(e.latlng.lat);
        const lng = Math.round(e.latlng.lng);
        const selector = document.getElementById('precMapEntitySelector');
        const key = selector?.value;

        if (!key) return;
        currentPrecEntities[key] = [lat, lng];
        const input = document.getElementById('precMapCoordsJson');
        if(input) input.value = JSON.stringify(currentPrecEntities, null, 2);
        syncPrecMarkers();

        selector.classList.add('ring-2', 'ring-green-500');
        setTimeout(() => selector.classList.remove('ring-2', 'ring-green-500'), 1000);
    });
}

function syncPrecMarkers() {
    if (!precPickerMap) return;
    precPickerMarkers.forEach(m => m.remove());
    precPickerMarkers.clear();

    const selectorVal = document.getElementById('precMapEntitySelector')?.value;

    Object.entries(currentPrecEntities).forEach(([key, coords]) => {
        if (!Array.isArray(coords) || coords.length !== 2) return;

        const isSelected = key === selectorVal;
        const color = isSelected ? '#ef4444' : '#3b82f6';
        let label = '';
        if(key === 'start') label = 'S';
        else if (key === 'finish') label = 'M';
        else if (key.startsWith('gate_')) label = key.replace('gate_','');

        const icon = L.divIcon({
            className: 'custom-prec-admin-marker',
            html: `<div style="background-color:${color}; color:white; border-radius:50%; width:24px; height:24px; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:bold; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">${label}</div>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        });

        const marker = L.marker(coords, { icon }).addTo(precPickerMap);
        precPickerMarkers.set(key, marker);
    });
}
