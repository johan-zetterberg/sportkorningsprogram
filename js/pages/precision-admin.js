// js/pages/precision-admin.js
// --- KOMPLETT OCH KORRIGERAD VERSION ---

import { getGlobalState } from '../main.js';
import { getEquipages, getConfig, saveConfig } from '../services/firestoreService.js';
import { getCompetitionHeader, showAlert } from '../ui/components.js';
import { standardPortAllowance, klassTempoData } from '../data/competitionData.js';
import { generatePrecisionCourseSetupPdf } from '../pdf/precisionPdf.js';

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
                    <div>
                        <label class="block text-sm font-medium dark:text-gray-300">Straff per nedslag (p)</label>
                        <input type="number" step="0.5" id="globalKnockdownPenalty" class="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="3">
                        <p class="text-xs text-gray-500 mt-1 dark:text-gray-500">Standard: 3 p (FEI/Nationellt). TR förr: 4 p? Ändra här vid behov.</p>
                    </div>
                    <div>
                        <label class="block text-sm font-medium dark:text-gray-300">Tidsstraff per sekund (p/s)</label>
                        <input type="number" step="0.1" id="globalTimePenaltyRate" class="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="${defRate}">
                        <p class="text-xs text-gray-500 mt-1 dark:text-gray-500">Standard: ${defRate} straff per påbörjad sekund över maxtiden.</p>
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
                            <input type="number" value="${manualAllowance || ''}" class="allowance-override-input w-24 p-1 border-gray-300 border rounded-md text-center dark:bg-gray-600 dark:border-gray-500 dark:text-white" placeholder="Manuell">
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
                               <input type="number" value="${savedTempo || ''}" class="tempo-override-input w-20 p-1 text-sm border-gray-300 border rounded-md text-center dark:bg-gray-600 dark:border-gray-500 dark:text-white" placeholder="${stdTempo > 0 ? stdTempo : '???'}">
                               <span class="text-xs text-gray-600 dark:text-gray-400">m/min</span>
                           </div>
                           <span class="flex-1 text-right text-xs text-gray-500">Maxtid:</span>
                           <strong id="maxtime_${classId}" class="text-gray-800 dark:text-white whitespace-nowrap">${maxTime}</strong>
                        </div>
                    </div>
                </div>
                <div class="mt-4">
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
            </div>
        `;
    }).join('');

    const updateMaxTime = (e) => {
        const card = e.target.closest('[data-class-name]');
        const className = card.dataset.className;
        const classId = className.replace(/[^a-zA-Z0-9]/g, '_');

        const stdTempo = findTempoForClass(className, klassTempoData);
        const overrideTempo = parseFloat(card.querySelector('.tempo-override-input').value);
        const activeTempo = overrideTempo > 0 ? overrideTempo : stdTempo;

        const trackLength = parseFloat(card.querySelector('.track-length-input').value) || 0;
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
        const comp = getGlobalState('currentCompetition');
        const defRate = comp?.ruleSettings?.precisionTimePenaltyRate ?? 0.5;
        
        const newConfig = {
            portAllowanceByClass: {},
            courses: {},
            knockdownPenalty: parseFloat(document.getElementById('globalKnockdownPenalty').value) || 3,
            timePenaltyRate: parseFloat(document.getElementById('globalTimePenaltyRate').value) || defRate
        };

        document.querySelectorAll('#classConfigsContainer [data-class-name]').forEach(card => {
            const className = card.dataset.className;
            const overrideInput = card.querySelector('.allowance-override-input');
            if (overrideInput && overrideInput.value) {
                newConfig.portAllowanceByClass[className] = parseFloat(overrideInput.value);
            }

            const trackLength = parseFloat(card.querySelector('.track-length-input').value) || null;
            const tempo = parseFloat(card.querySelector('.tempo-override-input').value) || null;

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
                obstacleLabels: labels,
                tempo: tempo
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
        if (root) root.innerHTML = '<p class="p-8 text-center text-gray-600">Ingen tävling vald.</p>';
        return;
    }

    renderLayout();

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

        document.getElementById('btnSaveAll').addEventListener('click', saveData);

        document.getElementById('btnPrintCourse')?.addEventListener('click', async () => {
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
        });

    } catch (error) {
        console.error("Kunde inte ladda data för precision-admin:", error);
        showAlert("Kunde inte ladda nödvändig data.", 'error');
    }
}

export function __unload() {
    // Inga aktiva lyssnare att städa här
}