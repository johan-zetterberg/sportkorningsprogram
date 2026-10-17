import { getEquipages, saveEquipage } from '../../services/equipageService.js';
import { saveConfig } from '../../services/competitionService.js';
import { getVetInspections } from '../../services/vetInspectionService.js';
import { createImportNumberResolver } from './adminParticipantImportNumbers.js';
import { buildImportMerge, summarizeImportPlan } from './adminParticipantImportMerge.js';
import { showAlert } from '../../ui/components.js';
import { competitionClasses } from '../../data/competitionData.js';
import {
    findBestClassMatch,
    inferParaGradeFromClassName,
    resolveTestLevelMergeForClass,
    resolveProgramKeyForClass
} from './adminParticipantClassUtils.js';
import { parseEqEntriesXml } from './adminParticipantXmlImport.js';
import { importOfficialsFromXml } from './adminOfficialsXmlImport.js';
import { buildClassMappingHtml, buildXmlClassItems, escapeAdminImportHtml } from './adminParticipantImportFormUtils.js';

function renderClassMappingUi(progress, uniqueXmlClasses, appClassList) {
    progress.innerHTML = buildClassMappingHtml(uniqueXmlClasses, appClassList);

    uniqueXmlClasses.forEach((item, index) => {
        const bestMatch = findBestClassMatch(item.className, appClassList);
        if (bestMatch) {
            setTimeout(() => {
                const selectEl = document.getElementById(`mapping_${index}`);
                if (selectEl) selectEl.value = bestMatch;
            }, 0);
        }
    });
}

function readUserClassMapping(uniqueXmlClasses) {
    const userClassMapping = new Map();
    uniqueXmlClasses.forEach((item, index) => {
        const selectElement = document.getElementById(`mapping_${index}`);
        if (selectElement && selectElement.value) {
            userClassMapping.set(item.key, selectElement.value);
        }
    });
    return userClassMapping;
}

function prepareImportedEquipage(eqa, mappedClass, key, tempCounters, options = {}) {
    eqa.className = mappedClass;
    eqa.isPara = /para/i.test(mappedClass);
    eqa.paraGrade = eqa.isPara ? inferParaGradeFromClassName(mappedClass) : '';
    const importTestKey = resolveProgramKeyForClass(mappedClass, eqa.paraGrade);
    eqa.testKey = importTestKey || null;
    eqa.programKey = importTestKey || null;

    if (options.mergePerTest) {
        const base = resolveTestLevelMergeForClass(mappedClass || eqa.tdbClassLabel || eqa.className || '');
        eqa.useMergedTestForDisplay = true;
        eqa.mergedTestKey = base.key;
        eqa.mergedTestLabel = base.label;
    } else {
        eqa.useMergedTestForDisplay = false;
    }

    if (eqa.startNumber == null || Number.isNaN(Number(eqa.startNumber))) {
        let counter = tempCounters.get(key) || 0;
        counter += 1;
        tempCounters.set(key, counter);

        const base = (eqa.tdbClassNumber != null) ? (eqa.tdbClassNumber * 1000) : 900000;
        eqa.startNumber = base + counter;
        eqa._tempStartNumber = true;
    }
}

// What the import would do to each entry, before anything is written
async function planImportedEquipages(compId, equipagesFromFile, userClassMapping, options = {}) {
    const tempCounters = new Map();
    // Without the current list (payment is private) the numbers could land on
    // other drivers and stored data be overwritten: stop
    const existingList = await getEquipages(compId, { includePrivate: true });
    const existingById = new Map(existingList.map(eq => [String(eq.startNumber ?? eq.id), eq]));
    const numberFor = createImportNumberResolver(existingList);
    let clinical = new Map();
    try {
        clinical = await getVetInspections(compId);
    } catch (err) {
        // The public vet results on the equipage still protect the horses
        console.warn('Kunde inte läsa veterinärens fynd', err);
    }

    const plan = [];
    for (const eqa of equipagesFromFile) {
        const key = (eqa.tdbClassNumber != null)
            ? `NUM:${eqa.tdbClassNumber}`
            : `NAME:${eqa.className}`;
        const mappedClass = userClassMapping.get(key);
        if (!mappedClass) continue;

        prepareImportedEquipage(eqa, mappedClass, key, tempCounters, options);
        eqa.startNumber = numberFor(eqa);
        const sn = String(eqa.startNumber);
        const existing = existingById.get(sn) || null;
        const merge = buildImportMerge(existing, eqa, { clinicalByHorse: clinical.get(sn) || {} });
        plan.push({ ...merge, startNumber: eqa.startNumber, driverName: eqa.driverName });
    }
    return plan;
}

async function writeImportPlan(compId, plan, progress) {
    let ok = 0;
    let fail = 0;
    const toWrite = plan.filter(item => Object.keys(item.patch).length);
    for (const item of toWrite) {
        try {
            // Partial update (merge): fields not in the patch are kept
            await saveEquipage(compId, item.startNumber, item.patch);
            ok++;
        } catch (err) {
            console.warn('Kunde inte spara ekipage', item, err);
            fail++;
        }
        progress.textContent = `Sparar ekipage... (${ok} av ${toWrite.length} klara)`;
    }
    return { ok, fail };
}

function describeConflict(conflict) {
    const who = `#${conflict.startNumber} ${conflict.driverName || ''}`.trim();
    if (conflict.type === 'class') {
        return `${who}: klass behålls "${conflict.existing}" (filen: "${conflict.imported}")`;
    }
    if (conflict.type === 'status') {
        return `${who}: status behålls "${conflict.existing}" (filen: "${conflict.imported}")`;
    }
    const horses = [...new Set([...(conflict.horses || []), ...(conflict.keptKeys || [])])].join(', ');
    const keyNote = conflict.keptKeys?.length ? ' (id/chip/namn behålls så att resultaten följer med)' : '';
    return `${who}: häst med veterinärresultat behålls: ${horses}${keyNote}`;
}

function buildImportSummaryHtml(summary, { done = false } = {}) {
    const counts = `${summary.new} nya, ${summary.updated} uppdaterade, ${summary.unchanged} oförändrade`;
    const conflictItems = summary.conflicts
        .map(conflict => `<li>${escapeAdminImportHtml(describeConflict(conflict))}</li>`)
        .join('');
    const conflictsHtml = conflictItems
        ? `<p class="mt-2 font-semibold dark:text-gray-200">Behållet från appen (${summary.conflicts.length}):</p>
        <ul class="list-disc ml-5 text-xs max-h-64 overflow-y-auto">${conflictItems}</ul>`
        : '';
    const title = done ? 'Importen är sparad' : 'Steg 3: Kontrollera innan import';
    const note = done
        ? ''
        : '<p class="text-xs text-gray-600 dark:text-gray-400 mt-1">Befintliga ekipage uppdateras bara med anmälningsuppgifter (namn, klubb, kontakt, hästar). Status, betalning, veterinärresultat och ändringar gjorda i appen behålls.</p>';
    return `<h3 class="font-semibold mb-1 dark:text-gray-200">${title}</h3>
        <p class="text-sm dark:text-gray-200">${escapeAdminImportHtml(counts)}</p>${note}${conflictsHtml}`;
}

export function setupParticipantImportForm({ competitionId, getJudges, getOfficials }) {
    const form = document.getElementById('eqXmlImportForm');
    if (!form) return;
    const input = document.getElementById('eqXmlFile');
    const progress = document.getElementById('eqXmlImportProgress');
    const appClassList = Object.values(competitionClasses).flat();

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
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
                await saveConfig(competitionId, 'eqentriesImport', { importedCompetitionInfo: importData.competitionInfo });
            }

            const uniqueXmlClasses = buildXmlClassItems(equipagesFromFile);
            renderClassMappingUi(progress, uniqueXmlClasses, appClassList);

            document.getElementById('eqXmlDoFinalImport').onclick = async () => {
                const userClassMapping = readUserClassMapping(uniqueXmlClasses);
                const mergePerTest = !!document.getElementById('eqXmlMergePerTestChk')?.checked;

                try {
                    progress.innerHTML = 'Jämför med befintliga ekipage...';
                    const plan = await planImportedEquipages(competitionId, equipagesFromFile, userClassMapping, { mergePerTest });
                    const summary = summarizeImportPlan(plan);

                    // Shown before anything is written: the admin confirms
                    progress.innerHTML = `${buildImportSummaryHtml(summary)}
        <div class="mt-3 flex gap-2">
          <button id="eqXmlConfirmImport" class="flex-1 bg-emerald-600 text-white py-2 px-4 rounded-lg hover:bg-emerald-700">Spara import</button>
          <button id="eqXmlCancelImport" class="flex-1 bg-gray-200 dark:bg-gray-700 dark:text-gray-200 py-2 px-4 rounded-lg">Avbryt</button>
        </div>`;
                    document.getElementById('eqXmlCancelImport').onclick = () => {
                        progress.textContent = 'Importen avbröts. Inget sparades.';
                        form.reset();
                    };
                    document.getElementById('eqXmlConfirmImport').onclick = async () => {
                        try {
                            progress.innerHTML = 'Sparar importerad data...';
                            const { fail } = await writeImportPlan(competitionId, plan, progress);

                            progress.textContent += ' | Importerar funktionärer...';
                            const stats = await importOfficialsFromXml(file, competitionId, getJudges(), getOfficials());
                            const mergeMessage = mergePerTest ? ' Testnivå-visning sparad för nya ekipage.' : '';
                            const message = `Import klar: ${summary.new} nya och ${summary.updated} uppdaterade ekipage (${summary.unchanged} oförändrade), ${stats.judges} nya domare och ${stats.officials} nya funktionärer importerade.${mergeMessage}${fail ? ` ${fail} ekipage misslyckades.` : ''}`;
                            showAlert(message);
                            progress.innerHTML = `${buildImportSummaryHtml(summary, { done: true })}
        <p class="mt-2 text-sm dark:text-gray-200">${escapeAdminImportHtml(message)}</p>`;
                            form.reset();
                        } catch (err) {
                            console.error(err);
                            showAlert(`Fel vid import: ${err.message || err}`, false);
                            progress.textContent = `Fel vid import: ${err.message || err}`;
                        }
                    };
                } catch (err) {
                    console.error(err);
                    showAlert(`Fel vid import: ${err.message || err}`, false);
                    progress.textContent = `Fel vid import: ${err.message || err}`;
                }
            };
        } catch (err) {
            console.error(err);
            showAlert(`Fel vid import: ${err.message || err}`, false);
            progress.textContent = `Fel vid import: ${err.message || err}`;
        }
    });
}
