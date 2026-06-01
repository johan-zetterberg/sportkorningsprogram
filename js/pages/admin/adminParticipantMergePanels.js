import { saveEquipage } from '../../services/equipageService.js';
import { getConfig, saveConfig } from '../../services/competitionService.js';
import { showAlert } from '../../ui/components.js';

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
        container.classList.add('hidden');
        container.innerHTML = '';
        return;
    }

    container.classList.remove('hidden');

    // Läs ev. tidigare sparade grupper (per TDB-klassnummer)
    let savedCfg = {};
    try {
        const displayCfg = await getConfig(currentCompetitionId, 'display');
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
        const groupLabel = (labelInput?.value || '').trim() || `Grupp ${selected.join('+')}`;

        const key = `TDBGROUP:${selected.slice().sort((a, b) => a - b).join('+')}`;

        try {
            const prev = await getConfig(currentCompetitionId, 'display', true) || {};
            const prevGroups = prev.mergeByClassNumber || {};
            const nextGroups = { ...prevGroups, [key]: { label: groupLabel, members: selected.slice().sort((a, b) => a - b) } };
            
            await saveConfig(currentCompetitionId, 'display', { ...prev, mergeByClassNumber: nextGroups });
            // Sätt på ekipage-nivå
            await applyMergeForClassNumbers(selected, groupLabel, key, true);
            showAlert('Sammanslagning skapad.');
            // Refresh this panel
            renderClassNumberMergePanel(currentEquipages); // Recursive call to refresh UI
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
            const prev = await getConfig(currentCompetitionId, 'display', true) || {};
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


            if (changed) {
                await saveConfig(currentCompetitionId, 'display', { ...prev, mergeByClassNumber: toUpdate });

                // Apply unmerge to affected equipages
                if (numsToUnmerge.length > 0) {
                    const uniqueNums = [...new Set(numsToUnmerge)];
                    await applyMergeForClassNumbers(uniqueNums, '', '', false);
                }

                showAlert('Sammanslagning borttagen.');
                renderClassNumberMergePanel(currentEquipages);
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
        let ok = 0, fail = 0;
        const set = new Set(nums);
        for (const eq of (currentEquipages || [])) {
            if (eq?.tdbClassNumber == null) continue;
            if (!set.has(Number(eq.tdbClassNumber))) continue;

            const patch = { ...eq, useMergedTestForDisplay: !!on };
            if (on) {
                patch.mergedTestKey = groupKey || `TDBGROUP:${nums.slice().sort((a, b) => a - b).join('+')}`;
                patch.mergedTestLabel = label || (eq.tdbClassLabel || eq.className || 'Sammanslagen klass');
            } else {
                patch.useMergedTestForDisplay = false;
            }

            try {
                // Optimistisk uppdatering lokalt för omedelbar feedback
                Object.assign(eq, patch);

                // Spara till databas
                await saveEquipage(currentCompetitionId, patch.startNumber, patch);
                ok++;
            } catch (err) {
                console.warn('Kunde inte spara ekipage', eq, err);
                fail++;
            }
        }
        // Tvinga omritning av tabellen
        renderEquipages(currentEquipages);
    }
}
