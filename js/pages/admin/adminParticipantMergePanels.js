import { saveEquipage } from '../../services/equipageService.js';
import { getConfig, replaceConfig } from '../../services/competitionService.js';
import { showAlert } from '../../ui/components.js';
import { removeMergeGroupsBySelection } from './adminParticipantMergeUtils.js';

let currentCompetitionId = null;
let currentEquipages = [];
let renderEquipages = () => {};

function updateMergePanelContext(equipages, options = {}) {
    currentEquipages = equipages || [];
    if (options.competitionId) currentCompetitionId = options.competitionId;
    if (typeof options.renderEquipages === 'function') renderEquipages = options.renderEquipages;
}

export async function renderClassNumberMergePanel(equipages, options = {}) {
    updateMergePanelContext(equipages, options);
    const container = document.getElementById('mergePanelManual');
    if (!container) return;

    const byTdb = new Map();
    for (const equipage of (equipages || [])) {
        if (equipage?.tdbClassNumber == null) continue;
        const num = Number(equipage.tdbClassNumber);
        let record = byTdb.get(num);
        if (!record) {
            record = { num, labelCandidates: new Set(), count: 0 };
            byTdb.set(num, record);
        }
        if (equipage.tdbClassLabel) record.labelCandidates.add(equipage.tdbClassLabel);
        else if (equipage.className) record.labelCandidates.add(equipage.className);
        record.count++;
    }

    const items = Array.from(byTdb.values()).sort((a, b) => a.num - b.num);
    if (!items.length) {
        container.classList.add('hidden');
        container.innerHTML = '';
        return;
    }

    container.classList.remove('hidden');

    let savedCfg = {};
    try {
        const displayCfg = await getConfig(currentCompetitionId, 'display');
        savedCfg = displayCfg || {};
    } catch (error) {
        console.warn('Kunde inte läsa display-config:', error);
    }
    const savedGroups = savedCfg.mergeByClassNumber || {};

    let html = `
        <div class="rounded-lg border border-slate-200 dark:border-gray-600 p-3 bg-slate-50 dark:bg-gray-800/50">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-sm font-semibold dark:text-gray-200">Slå samman valda TDB-klassnummer</div>
            <div class="text-xs text-slate-600 dark:text-gray-400">Markera de klassnummer som ska visas som EN gemensam klass i resultatet.</div>
          </div>
          <div class="flex gap-2">
            <button id="cnSelectAll" class="text-xs px-2 py-1 rounded bg-slate-200 hover:bg-slate-300 dark:bg-gray-600 dark:hover:bg-gray-500 dark:text-gray-200">Markera alla</button>
            <button id="cnSelectNone" class="text-xs px-2 py-1 rounded bg-slate-200 hover:bg-slate-300 dark:bg-gray-600 dark:hover:bg-gray-500 dark:text-gray-200">Avmarkera alla</button>
          </div>
        </div>

        <div class="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2" id="cnChoices">
    `;

    for (const item of items) {
        const label = Array.from(item.labelCandidates).join(' / ') || '';
        html += `
        <label class="flex items-start gap-2 p-2 bg-white dark:bg-gray-700 border dark:border-gray-600 rounded select-none cursor-pointer">
          <input type="checkbox" class="mt-1 h-4 w-4 cnChoice rounded border-gray-300 dark:border-gray-500 dark:bg-gray-600 text-blue-600" data-num="${item.num}">
          <div class="text-sm">
            <div class="font-semibold dark:text-gray-200">TDB #${item.num}</div>
            <div class="text-xs text-slate-600 dark:text-gray-400">Möjliga etiketter: ${label || '-'} - (${item.count} ekipage)</div>
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
      </div>`;

    container.innerHTML = html;

    const wrap = container.querySelector('#cnActiveGroups');
    if (wrap) {
        const entries = Object.entries(savedGroups);
        if (!entries.length) {
            wrap.innerHTML = `<div class="text-xs text-slate-500">Inga aktiva sammanslagningar.</div>`;
        } else {
            wrap.innerHTML = entries.map(([key, group]) => {
                const nums = (group.members || []).join(', ');
                return `
        <label class="flex items-start gap-2 p-2 border rounded bg-white hover:bg-slate-50 dark:bg-gray-700 dark:border-gray-600 dark:hover:bg-gray-600 cursor-pointer">
            <input type="checkbox" class="mt-1 h-4 w-4 cnActiveGroupChoice rounded border-gray-300 dark:border-gray-500 dark:bg-gray-600 text-blue-600" data-key="${key}">
                <div>
                    <div class="text-sm font-semibold dark:text-gray-200">${group.label}</div>
                    <div class="text-xs text-slate-600 dark:text-gray-400">TDB#: ${nums}</div>
                </div>
            </label>`;
            }).join('');
        }
    }

    const choiceBox = container.querySelector('#cnChoices');
    container.querySelector('#cnSelectAll')?.addEventListener('click', () => {
        choiceBox.querySelectorAll('input.cnChoice')?.forEach(cb => cb.checked = true);
    });
    container.querySelector('#cnSelectNone')?.addEventListener('click', () => {
        choiceBox.querySelectorAll('input.cnChoice')?.forEach(cb => cb.checked = false);
    });

    container.querySelector('#cnMergeCreate')?.addEventListener('click', async () => {
        const selected = getSelectedNums(choiceBox);
        if (selected.length < 2) {
            showAlert('Välj minst två klassnummer.', false);
            return;
        }

        const labelInput = container.querySelector('#cnGroupLabel');
        const groupLabel = (labelInput?.value || '').trim() || `Grupp ${selected.join('+')}`;
        const sortedSelected = selected.slice().sort((a, b) => a - b);
        const key = `TDBGROUP:${sortedSelected.join('+')}`;

        try {
            const prev = await getConfig(currentCompetitionId, 'display', true) || {};
            const prevGroups = prev.mergeByClassNumber || {};
            const nextGroups = { ...prevGroups, [key]: { label: groupLabel, members: sortedSelected } };

            await replaceConfig(currentCompetitionId, 'display', { ...prev, mergeByClassNumber: nextGroups });
            await applyMergeForClassNumbers(sortedSelected, groupLabel, key, true);
            showAlert('Sammanslagning skapad.');
            renderClassNumberMergePanel(currentEquipages, { competitionId: currentCompetitionId, renderEquipages });
        } catch (error) {
            console.error(error);
            showAlert('Kunde inte spara sammanslagning.', false);
        }
    });

    container.querySelector('#cnUnmergeSelected')?.addEventListener('click', async () => {
        const groupCheckboxes = container.querySelectorAll('.cnActiveGroupChoice:checked');
        const groupKeys = Array.from(groupCheckboxes).map(cb => cb.dataset.key).filter(Boolean);
        const selectedNums = getSelectedNums(choiceBox);

        if (!groupKeys.length && !selectedNums.length) {
            showAlert('Markera en grupp (nedan) eller klasser (ovan) att ångra.', false);
            return;
        }

        try {
            const prev = await getConfig(currentCompetitionId, 'display', true) || {};
            const result = removeMergeGroupsBySelection(prev.mergeByClassNumber || {}, groupKeys, selectedNums);
            const numsToUnmerge = result.numsToUnmerge.length > 0
                ? result.numsToUnmerge
                : selectedNums;

            if (!result.changed && !numsToUnmerge.length) {
                showAlert('Ingen grupp vald/ändrad.', false);
                return;
            }

            if (result.changed) {
                await replaceConfig(currentCompetitionId, 'display', {
                    ...prev,
                    mergeByClassNumber: result.nextGroups
                });
            }

            if (numsToUnmerge.length > 0) {
                await applyMergeForClassNumbers(numsToUnmerge, '', '', false);
            }

            showAlert('Sammanslagning borttagen.');
            renderClassNumberMergePanel(currentEquipages, { competitionId: currentCompetitionId, renderEquipages });
        } catch (error) {
            console.error(error);
            showAlert('Kunde inte uppdatera.', false);
        }
    });
}

function getSelectedNums(box) {
    return Array.from(box.querySelectorAll('input.cnChoice'))
        .filter(cb => cb.checked)
        .map(cb => Number(cb.getAttribute('data-num')))
        .filter(Number.isFinite);
}

async function applyMergeForClassNumbers(nums, label, groupKey, on) {
    const set = new Set(nums.map(Number).filter(Number.isFinite));
    for (const equipage of (currentEquipages || [])) {
        if (equipage?.tdbClassNumber == null) continue;
        if (!set.has(Number(equipage.tdbClassNumber))) continue;

        const patch = { ...equipage, useMergedTestForDisplay: Boolean(on) };
        if (on) {
            const sortedNums = nums.slice().sort((a, b) => a - b);
            patch.mergedTestKey = groupKey || `TDBGROUP:${sortedNums.join('+')}`;
            patch.mergedTestLabel = label || (equipage.tdbClassLabel || equipage.className || 'Sammanslagen klass');
        }

        try {
            Object.assign(equipage, patch);
            await saveEquipage(currentCompetitionId, patch.startNumber, patch);
        } catch (error) {
            console.warn('Kunde inte spara ekipage', equipage, error);
        }
    }
    renderEquipages(currentEquipages);
}
