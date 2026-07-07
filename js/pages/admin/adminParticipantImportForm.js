import { saveEquipage } from '../../services/equipageService.js';
import { saveConfig } from '../../services/competitionService.js';
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
import { buildClassMappingHtml, buildXmlClassItems } from './adminParticipantImportFormUtils.js';

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

async function saveImportedEquipages(compId, equipagesFromFile, userClassMapping, progress, options = {}) {
    let ok = 0;
    let fail = 0;
    const tempCounters = new Map();

    for (const eqa of equipagesFromFile) {
        const key = (eqa.tdbClassNumber != null)
            ? `NUM:${eqa.tdbClassNumber}`
            : `NAME:${eqa.className}`;
        const mappedClass = userClassMapping.get(key);
        if (!mappedClass) continue;

        prepareImportedEquipage(eqa, mappedClass, key, tempCounters, options);

        try {
            await saveEquipage(compId, eqa.startNumber, eqa);
            ok++;
        } catch (err) {
            console.warn('Kunde inte spara ekipage', eqa, err);
            fail++;
        }
        progress.textContent = `Sparar ekipage... (${ok} av ${equipagesFromFile.length} klara)`;
    }

    return { ok, fail };
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

                progress.innerHTML = 'Sparar importerad data...';
                const { ok, fail } = await saveImportedEquipages(competitionId, equipagesFromFile, userClassMapping, progress, { mergePerTest });

                progress.textContent += ' | Importerar funktionärer...';
                const stats = await importOfficialsFromXml(file, competitionId, getJudges(), getOfficials());
                const mergeMessage = mergePerTest ? ' Testnivå-visning sparad för importerade ekipage.' : '';
                const message = `Import klar: ${ok} ekipage, ${stats.judges} nya domare och ${stats.officials} nya funktionärer importerade.${mergeMessage}${fail ? ` ${fail} ekipage misslyckades.` : ''}`;
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
