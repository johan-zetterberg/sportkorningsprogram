import { saveEquipage } from '../../services/equipageService.js';
import { showAlert } from '../../ui/components.js';

function buildClassRows(equipages) {
    const classMap = new Map();
    (equipages || []).forEach(eq => {
        const className = eq.className || 'Okänd klass';
        if (!classMap.has(className)) {
            classMap.set(className, { count: 0, tdbNums: new Set() });
        }

        const info = classMap.get(className);
        info.count++;
        if (eq.tdbClassNumber) info.tdbNums.add(eq.tdbClassNumber);
    });

    return Array.from(classMap.entries()).map(([name, info]) => {
        const nums = Array.from(info.tdbNums).sort((a, b) => a - b);
        const tdbNum = nums.length ? nums[0] : null;
        return { name, count: info.count, tdbNum };
    }).sort((a, b) => {
        if (a.tdbNum && b.tdbNum) return a.tdbNum - b.tdbNum;
        if (a.tdbNum) return -1;
        if (b.tdbNum) return 1;
        return a.name.localeCompare(b.name);
    });
}

function renderClassRows(container, rows) {
    container.innerHTML = rows.map((row, index) => `
        <div class="flex items-center gap-3 p-2 hover:bg-gray-50 dark:hover:bg-gray-700 rounded">
            <div class="w-8 text-center text-xs font-mono bg-gray-100 dark:bg-gray-700 dark:text-gray-300 rounded p-1" title="TDB Klassnummer">${row.tdbNum || '-'}</div>
            <div class="flex-1">
                <input type="text" data-idx="${index}" class="class-rename-input w-full p-2 border rounded dark:bg-gray-800 dark:border-gray-600 dark:text-white" value="${row.name}">
                <div class="text-xs text-gray-400 dark:text-gray-500 mt-1">Nuvarande: ${row.name} (${row.count} ekipage)</div>
            </div>
        </div>
    `).join('');
}

function getRenameChanges(container, rows) {
    const changes = [];
    container.querySelectorAll('.class-rename-input').forEach(input => {
        const index = parseInt(input.dataset.idx);
        const oldName = rows[index].name;
        const newName = input.value.trim();

        if (newName && newName !== oldName) {
            changes.push({ oldName, newName });
        }
    });
    return changes;
}

async function saveClassRenames(competitionId, equipages, changes) {
    let totalUpdated = 0;
    const updates = [];
    const renameMap = new Map(changes.map(change => [change.oldName, change.newName]));

    for (const eq of (equipages || [])) {
        if (!renameMap.has(eq.className)) continue;

        const updatedData = { ...eq, className: renameMap.get(eq.className) };
        updates.push(saveEquipage(competitionId, eq.startNumber, updatedData));
        totalUpdated++;
    }

    await Promise.all(updates);
    return totalUpdated;
}

export function setupClassManager({ competitionId, getEquipages }) {
    const btn = document.getElementById('manageClassesBtn');
    if (!btn) return;

    btn.addEventListener('click', () => {
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
                        Auto-numrera från TDB (lägg till prefix)
                    </button>
                </div>

                <div class="max-h-[60vh] overflow-y-auto border-t border-b py-2 space-y-2 dark:border-gray-700" id="classListContainer"></div>

                <div class="mt-4 flex justify-end gap-3">
                    <button id="cancelClassManager" class="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-600">Avbryt</button>
                    <button id="saveClassManager" class="px-4 py-2 bg-green-600 text-white font-bold rounded hover:bg-green-700">Spara & Uppdatera Ekipage</button>
                </div>
            </div>
        </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const container = document.getElementById('classListContainer');
        const rows = buildClassRows(getEquipages());
        renderClassRows(container, rows);

        const closeModal = () => document.getElementById('classManagerModal')?.remove();
        document.getElementById('closeClassManager').onclick = closeModal;
        document.getElementById('cancelClassManager').onclick = closeModal;

        document.getElementById('autoNumberClassesBtn').onclick = () => {
            if (!confirm("Vill du automatiskt lägga till TDB-nummer (t.ex. '1. ') framför alla klassnamn som har ett nummer?")) return;

            container.querySelectorAll('.class-rename-input').forEach(input => {
                const index = parseInt(input.dataset.idx);
                const row = rows[index];
                if (!row.tdbNum) return;

                const prefix = `${row.tdbNum}.`;
                if (input.value.startsWith(prefix)) return;

                input.value = prefix + input.value;
                input.classList.add('bg-blue-50');
                setTimeout(() => input.classList.remove('bg-blue-50'), 500);
            });
            showAlert('Förslag på numrering applicerat. Granska och Spara.');
        };

        document.getElementById('saveClassManager').onclick = async () => {
            const changes = getRenameChanges(container, rows);
            if (changes.length === 0) {
                closeModal();
                return;
            }

            if (!confirm(`Du håller på att döpa om ${changes.length} klasser. Detta kommer uppdatera alla berörda ekipage. Fortsätt?`)) return;

            try {
                showAlert('Sparar ändringar, vänta...', true);
                const totalUpdated = await saveClassRenames(competitionId, getEquipages(), changes);
                showAlert(`Uppdaterade ${totalUpdated} ekipage! Ladda om sidan...`, true);
                closeModal();
            } catch (err) {
                console.error(err);
                showAlert('Ett fel inträffade vid sparandet.', false);
            }
        };
    });
}
