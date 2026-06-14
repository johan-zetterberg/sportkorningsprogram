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

const RULE_FREE = { kind: 'free', label: 'Fri' };
const ruleMin = (value) => ({ kind: 'min', value, label: `Minst ${value} cm` });
const RULE_FORBIDDEN = { kind: 'forbidden', label: 'Ej tillåten enligt bilaga 2' };

const VAGN_RULE_ROWS = {
    horse_enbet_tandem: {
        label: 'Häst enbet/tandem',
        dressagePrecision: { lb: RULE_FREE, laMsv: ruleMin(125), svar: ruleMin(138) },
        marathon: { lb: RULE_FREE, laMsvSvar: ruleMin(125) }
    },
    horse_par: {
        label: 'Häst par',
        dressagePrecision: { lb: RULE_FREE, laMsv: ruleMin(125), svar: ruleMin(148) },
        marathon: { lb: RULE_FREE, laMsvSvar: ruleMin(125) }
    },
    horse_fyrspann: {
        label: 'Häst fyrspann',
        dressagePrecision: { lb: RULE_FREE, laMsv: ruleMin(125), svar: ruleMin(158) },
        marathon: { lb: RULE_FREE, laMsvSvar: ruleMin(125) }
    },
    pony_a_enbet_tandem: {
        label: 'A-ponny enbet/tandem',
        dressagePrecision: { lb: RULE_FREE, laMsv: ruleMin(125), svar: RULE_FORBIDDEN },
        marathon: { lb: RULE_FREE, laMsvSvar: ruleMin(125) }
    },
    pony_bc_enbet_tandem: {
        label: 'B/C/D-ponny enbet/tandem',
        dressagePrecision: { lb: RULE_FREE, laMsv: ruleMin(125), svar: ruleMin(138) },
        marathon: { lb: RULE_FREE, laMsvSvar: ruleMin(125) }
    },
    pony_a_par: {
        label: 'A-ponny par',
        dressagePrecision: { lb: RULE_FREE, laMsv: ruleMin(125), svar: ruleMin(138) },
        marathon: { lb: RULE_FREE, laMsvSvar: ruleMin(125) }
    },
    pony_a_fyrspann: {
        label: 'A-ponny fyrspann',
        dressagePrecision: { lb: RULE_FREE, laMsv: ruleMin(125), svar: ruleMin(138) },
        marathon: { lb: RULE_FREE, laMsvSvar: ruleMin(125) }
    },
    pony_b_par: {
        label: 'B-ponny par',
        dressagePrecision: { lb: RULE_FREE, laMsv: ruleMin(125), svar: ruleMin(138) },
        marathon: { lb: RULE_FREE, laMsvSvar: ruleMin(125) }
    },
    pony_b_fyrspann: {
        label: 'B-ponny fyrspann',
        dressagePrecision: { lb: RULE_FREE, laMsv: ruleMin(125), svar: ruleMin(138) },
        marathon: { lb: RULE_FREE, laMsvSvar: ruleMin(125) }
    },
    pony_cd_par: {
        label: 'C/D-ponny par',
        dressagePrecision: { lb: RULE_FREE, laMsv: ruleMin(125), svar: ruleMin(138) },
        marathon: { lb: RULE_FREE, laMsvSvar: ruleMin(125) }
    },
    pony_cd_fyrspann: {
        label: 'C/D-ponny fyrspann',
        dressagePrecision: { lb: RULE_FREE, laMsv: ruleMin(125), svar: ruleMin(138) },
        marathon: { lb: RULE_FREE, laMsvSvar: ruleMin(125) }
    }
};

function byId(id) {
    return document.getElementById(id);
}

function normalizeText(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function getCurrentEquipage() {
    const startNumber = equipageSearchDropdown?.getValue?.();
    if (!startNumber) return null;
    return sortedEquipages.find(eq => String(eq.startNumber) === String(startNumber)) || null;
}

function getCurrentEnteredWidths() {
    return {
        dressagePrecision: parseInt(byId('precisionBreddInput')?.value, 10),
        marathon: parseInt(byId('maratonBreddInput')?.value, 10)
    };
}

function inferPonyCategory(equipage) {
    const horseTypes = (Array.isArray(equipage?.horses) ? equipage.horses : [])
        .map(horse => normalizeText(horse?.type))
        .filter(Boolean);

    if (horseTypes.some(type => type.includes('a-ponny'))) return 'a';
    if (horseTypes.some(type => type.includes('b-ponny'))) return 'b';
    if (horseTypes.some(type => type.includes('c-ponny') || type.includes('d-ponny'))) return 'cd';
    return null;
}

function resolveVagnRuleRow(equipage) {
    const cls = normalizeText(equipage?.className);
    if (!cls) return null;

    const hitch = cls.includes('fyrspann')
        ? 'fyrspann'
        : (cls.includes('par') ? 'par' : 'enbet_tandem');
    const species = cls.includes('ponny') ? 'pony' : (cls.includes('hast') ? 'horse' : null);
    if (!species) return null;

    if (species === 'horse') {
        return VAGN_RULE_ROWS[`horse_${hitch}`] || null;
    }

    const ponyCategory = inferPonyCategory(equipage);
    if (ponyCategory === 'a') {
        if (hitch === 'par') return VAGN_RULE_ROWS.pony_a_par;
        if (hitch === 'fyrspann') return VAGN_RULE_ROWS.pony_a_fyrspann;
        return VAGN_RULE_ROWS.pony_a_enbet_tandem;
    }
    if (ponyCategory === 'b') {
        if (hitch === 'par') return VAGN_RULE_ROWS.pony_b_par;
        if (hitch === 'fyrspann') return VAGN_RULE_ROWS.pony_b_fyrspann;
        return VAGN_RULE_ROWS.pony_bc_enbet_tandem;
    }
    if (ponyCategory === 'cd') {
        if (hitch === 'par') return VAGN_RULE_ROWS.pony_cd_par;
        if (hitch === 'fyrspann') return VAGN_RULE_ROWS.pony_cd_fyrspann;
        return VAGN_RULE_ROWS.pony_bc_enbet_tandem;
    }

    return null;
}

function getLevelBucket(className) {
    const cls = normalizeText(className);
    if (!cls) return null;
    if (cls.includes('latt b')) return 'lb';
    if (cls.includes('latt a') || cls.includes('msv') || cls.includes('medelsvar')) return 'laMsv';
    if (cls.includes('svar')) return 'svar';
    return null;
}

function getDressageRule(row, className) {
    if (!row) return null;
    const bucket = getLevelBucket(className);
    if (bucket === 'lb') return row.dressagePrecision.lb;
    if (bucket === 'laMsv') return row.dressagePrecision.laMsv;
    if (bucket === 'svar') return row.dressagePrecision.svar;
    return null;
}

function getMarathonRule(row, className) {
    if (!row) return null;
    const bucket = getLevelBucket(className);
    if (bucket === 'lb') return row.marathon.lb;
    if (bucket === 'laMsv' || bucket === 'svar') return row.marathon.laMsvSvar;
    return null;
}

function matchesRule(value, rule) {
    if (!Number.isFinite(value)) return null;
    if (!rule || rule.kind === 'free') return true;
    if (rule.kind === 'forbidden') return false;
    if (rule.kind === 'min') return value >= rule.value;
    return false;
}

function formatAllowedRuleValues(rule) {
    if (!rule || rule.kind !== 'min' || !Number.isFinite(rule.value)) {
        return '';
    }
    return `minst ${rule.value} cm`;
}

function getRuleWarning(value, rule, label) {
    if (!Number.isFinite(value) || !rule || rule.kind === 'free') return '';
    if (rule.kind === 'forbidden') {
        return `${label} är inte tillåten för den här klassen enligt TR-bilaga 2.`;
    }

    const allowedText = formatAllowedRuleValues(rule);
    if (!allowedText || matchesRule(value, rule)) return '';

    return `${label} är för smal. Kravet här är ${allowedText} enligt TR.`;
}

function buildStatusPill(value, rule) {
    if (!Number.isFinite(value)) {
        return '<span class="inline-flex items-center rounded-full bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-700 dark:bg-gray-700 dark:text-gray-200">Ej ifyllt</span>';
    }
    if (!rule || rule.kind === 'free') {
        return `<span class="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">${value} cm</span>`;
    }
    if (matchesRule(value, rule)) {
        return `<span class="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">${value} cm uppfyller</span>`;
    }
    return `<span class="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800 dark:bg-rose-900/40 dark:text-rose-200">${value} cm avviker</span>`;
}

function renderRuleSummary(equipage) {
    const container = byId('vagnRuleCurrent');
    if (!container) return;

    if (!equipage) {
        container.innerHTML = '<p class="text-sm text-blue-900 dark:text-blue-100">Välj ekipage för att se vilken TR-rad som gäller för just den vagnen.</p>';
        return;
    }

    const row = resolveVagnRuleRow(equipage);
    const dressageRule = getDressageRule(row, equipage.className);
    const marathonRule = getMarathonRule(row, equipage.className);
    const enteredWidths = getCurrentEnteredWidths();
    const isPara = normalizeText(equipage.className).includes('para');

    const fallbackText = normalizeText(equipage.className).includes('ponny')
        ? `
            <div class="space-y-2 text-sm text-blue-900 dark:text-blue-100">
                <p class="font-semibold">Ponnyregel kräver ponnykategori för exakt rad.</p>
                <p>Bilaga 2 anger minimimått. LB: fri bredd. LA/MSV: minst 125 cm i dressyr/precision och minst 125 cm i maraton.</p>
                <p>Svår: A-ponny enbet/tandem är inte tillåten i tabellen, övriga ponnyer ska minst upp till 138 cm i dressyr/precision och minst 125 cm i maraton.</p>
                <p class="text-xs text-blue-700 dark:text-blue-300">Fyll gärna in hästtyp som A-, B-, C- eller D-ponny för att få exakt rad här.</p>
            </div>
        `
        : '<p class="text-sm text-blue-900 dark:text-blue-100">Kunde inte avgöra exakt TR-rad för ekipaget. Kontrollera klass och hästtyp.</p>';

    if (!row || !dressageRule || !marathonRule) {
        container.innerHTML = fallbackText;
        return;
    }

    const specialNote = isPara
        ? '<p class="text-xs text-blue-700 dark:text-blue-300">Para: samma måttabell gäller, men valfria däck/hjul är tillåtna i alla klasser och anspänningar.</p>'
        : '';

    container.innerHTML = `
        <div class="space-y-3">
            <div class="flex flex-wrap items-center gap-2">
                <span class="inline-flex items-center rounded-full bg-white/80 px-2.5 py-1 text-xs font-semibold text-blue-900 dark:bg-gray-800 dark:text-blue-100">${row.label}</span>
                <span class="text-xs text-blue-700 dark:text-blue-300">${equipage.className || 'Klass saknas'}</span>
            </div>
            <div class="grid grid-cols-1 gap-2">
                <div class="rounded-lg bg-white/80 p-3 dark:bg-gray-800/60">
                    <div class="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                        <div>
                            <p class="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">Dressyr / precision</p>
                            <p class="text-sm font-semibold text-blue-950 dark:text-blue-50">${dressageRule.label}</p>
                        </div>
                        ${buildStatusPill(enteredWidths.dressagePrecision, dressageRule)}
                    </div>
                </div>
                <div class="rounded-lg bg-white/80 p-3 dark:bg-gray-800/60">
                    <div class="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                        <div>
                            <p class="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">Maraton</p>
                            <p class="text-sm font-semibold text-blue-950 dark:text-blue-50">${marathonRule.label}</p>
                        </div>
                        ${buildStatusPill(enteredWidths.marathon, marathonRule)}
                    </div>
                </div>
            </div>
            ${specialNote}
        </div>
    `;
}

function renderWidthWarnings(equipage) {
    const precisionWarning = byId('precisionWidthWarning');
    const marathonWarning = byId('marathonWidthWarning');
    if (!precisionWarning || !marathonWarning) return;

    if (!equipage) {
        precisionWarning.innerHTML = '';
        marathonWarning.innerHTML = '';
        return;
    }

    const row = resolveVagnRuleRow(equipage);
    const dressageRule = getDressageRule(row, equipage.className);
    const marathonRule = getMarathonRule(row, equipage.className);
    const enteredWidths = getCurrentEnteredWidths();

    const precisionText = getRuleWarning(enteredWidths.dressagePrecision, dressageRule, 'Dressyr/precision-vagnen');
    const marathonText = getRuleWarning(enteredWidths.marathon, marathonRule, 'Maratonvagnen');

    precisionWarning.innerHTML = precisionText
        ? `<p class="mt-1 text-sm font-medium text-rose-600 dark:text-rose-400">${precisionText}</p>`
        : '';
    marathonWarning.innerHTML = marathonText
        ? `<p class="mt-1 text-sm font-medium text-rose-600 dark:text-rose-400">${marathonText}</p>`
        : '';
}

function renderRuleUi(equipage) {
    renderRuleSummary(equipage);
    renderWidthWarnings(equipage);
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
        renderRuleUi(null);
        return;
    }

    precisionInput.value = equipage.trackWidth ?? '';
    marathonInput.value = equipage.marathonTrackWidth ?? '';

    const safetyCheck = equipage.safetyCheck || {};
    approvedInput.checked = safetyCheck.approved === true;
    commentInput.value = safetyCheck.comment || '';
    renderRuleUi(equipage);
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
        <div class="container mx-auto p-3 sm:p-4 md:p-8 max-w-lg">
            ${getCompetitionHeader(competition, 'Funktionskontroll & Vagnbredd')}
            <div class="bg-white dark:bg-gray-800 p-4 sm:p-5 md:p-6 rounded-xl shadow-md space-y-5 sm:space-y-6">
                <div>
                    <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">1. Välj ekipage</label>
                    <div class="flex flex-wrap items-center gap-2 mt-1">
                        <button id="prevBtn" class="p-3 border rounded-md bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:hover:bg-gray-600" title="Föregående">«</button>
                        <div id="vagnbreddEquipageSearch" class="flex-grow"></div>
                        <button id="nextBtn" class="p-3 border rounded-md bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:hover:bg-gray-600" title="Nästa">»</button>
                    </div>
                </div>

                <div class="grid grid-cols-1 gap-4">
                    <div>
                        <label for="precisionBreddInput" class="block text-sm font-medium text-gray-700 dark:text-gray-300">2. Bredd dressyr/precision (cm)</label>
                        <input type="number" id="precisionBreddInput" class="mt-1 block w-full p-3 text-base sm:text-lg border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="cm">
                        <div id="precisionWidthWarning"></div>
                    </div>
                    <div>
                        <label for="maratonBreddInput" class="block text-sm font-medium text-gray-700 dark:text-gray-300">3. Bredd maraton (cm)</label>
                        <input type="number" id="maratonBreddInput" class="mt-1 block w-full p-3 text-base sm:text-lg border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="cm">
                        <div id="marathonWidthWarning"></div>
                    </div>
                </div>

                <details class="border rounded-lg bg-blue-50/70 border-blue-200 dark:bg-blue-900/10 dark:border-blue-800">
                    <summary class="cursor-pointer list-none flex items-center justify-between gap-3 p-3 sm:p-4 font-semibold text-blue-900 dark:text-blue-100">
                        <span>Vagnregler för godkännande</span>
                        <span class="text-xs font-medium text-blue-700 dark:text-blue-300">Visa/Dölj</span>
                    </summary>
                    <div class="px-4 pb-4 text-sm text-blue-950 dark:text-blue-50 space-y-3">
                        <div id="vagnRuleCurrent" class="rounded-lg border border-blue-200 bg-blue-100/70 p-3 dark:border-blue-800 dark:bg-blue-950/20"></div>
                        <div class="grid grid-cols-1 gap-3">
                            <div class="rounded-lg bg-white/80 p-3 dark:bg-gray-800/60">
                                <p class="font-semibold">Det viktigaste att kolla</p>
                                <ul class="list-disc list-inside mt-1 space-y-1 text-blue-900 dark:text-blue-100">
                                    <li>Samma vagn ska användas i dressyr och precision i fullständig tävling.</li>
                                    <li>En annan vagn får användas i maraton.</li>
                                    <li>Enbet och tandem får vara en- eller tvåaxlade. Par och fyrspann ska ha tvåaxlad vagn.</li>
                                    <li>Bilaga 2 anger minimimått: LB fri bredd, LA/MSV minst 125 cm, maraton minst 125 cm från Lätt A och uppåt.</li>
                                    <li>Svår dressyr/precision: minst 138 cm för enbet/tandem, minst 148 cm för hästpar och minst 158 cm för hästfyrspann.</li>
                                    <li>Ponny par och fyrspann i svår dressyr/precision: minst 138 cm. A-ponny enbet/tandem är inte tillåten i den raden.</li>
                                </ul>
                            </div>
                            <div class="rounded-lg bg-white/80 p-3 dark:bg-gray-800/60">
                                <p class="font-semibold">Dressyrvagn och maratonvagn</p>
                                <ul class="list-disc list-inside mt-1 space-y-1 text-blue-900 dark:text-blue-100">
                                    <li>Dressyr/precision: säte bakom eller bredvid kusken. Har vagnen två säten ska groom sitta bak.</li>
                                    <li>I Lätt B och Lätt A får groom stå om centralt bakre säte saknas.</li>
                                    <li>Maraton: minst två vita reflexer fram, gula/orangea på sidorna och två röda bak.</li>
                                    <li>Om vagnen saknar broms ska baksele användas. Enbet och tandem ska alltid ha baksele.</li>
                                </ul>
                            </div>
                        </div>
                        <div>
                            <p class="font-semibold">Extra att komma ihåg</p>
                            <ul class="list-disc list-inside mt-1 space-y-1 text-blue-900 dark:text-blue-100">
                                <li>I svår klass ska vagnen ha hårdgummihjul eller järnhjul.</li>
                                <li>I maraton får hjulen vara högst 85 cm i diameter på enaxlade vagnar.</li>
                                <li>Bilaga 2 heter “Minimum vagnsbredd/spårvidd”, så bredare vagn är okej så länge övriga vagnkrav är uppfyllda.</li>
                                <li>Precisionen i systemet räknar fortfarande hinderbredd som vagnbredd + tillägg enligt klass.</li>
                            </ul>
                        </div>
                        <div class="pt-1">
                            <a href="assets/dressage/05 TR V 2025 Sportkörning.pdf" target="_blank" rel="noopener" class="inline-flex items-center text-sm font-semibold text-blue-700 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-100 underline">
                                Öppna TR V 2025
                            </a>
                        </div>
                    </div>
                </details>

                <div class="p-3 sm:p-4 border rounded-lg bg-gray-50 dark:bg-gray-700/50 dark:border-gray-600">
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

    ['precisionBreddInput', 'maratonBreddInput'].forEach(id => {
        byId(id)?.addEventListener('input', () => renderRuleUi(getCurrentEquipage()));
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
