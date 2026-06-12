import { getGlobalState } from '../../main.js';
import { getEquipages } from '../../services/equipageService.js';
import { getConfig } from '../../services/competitionService.js';
import { db, appId } from '../../config/firebase-config.js';
import {
    doc,
    setDoc,
    collection,
    query,
    where,
    getDocs,
    onSnapshot,
    updateDoc,
    deleteField
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getCompetitionHeader, renderCompetitionModeBanner, createSearchableDropdown, showAlert } from '../../ui/components.js';
import { t } from '../../utils/i18n.js';
import { getPrecisionCourseData } from '../../utils/precisionUtils.js';

let competitionId = null;
let equipages = [];
let precisionConfig = {};
let currentEquipage = null;
let searchableDropdown = null;
let gateSplits = {};
let currentEquipageData = null;
let currentUnsubscribe = null;
let autoSyncInterval = null;

function precisionDocRef(startNumber) {
    return doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/precision`, String(startNumber));
}

export function renderLayout() {
    const comp = getGlobalState('currentCompetition');
    const isFieldMode = comp?.competitionMode === 'field';
    const root = document.getElementById('page-precision-split-input');
    if (!root) return;

    root.innerHTML = `
        <div class="container mx-auto p-4 md:p-8 max-w-xl">
            <div class="mb-4">
                ${getCompetitionHeader(comp, isFieldMode
                    ? 'Precision - manuell passagerapportering'
                    : t('precision_split_header'))}
            </div>
            ${renderCompetitionModeBanner(comp, {
                message: 'Tävlingen körs i fältläge. Passager och delhändelser kan rapporteras manuellt här utan full livekarta.'
            })}

            <div class="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-md space-y-6 border dark:border-gray-700">
                <div class="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-100 dark:border-blue-800">
                    <p class="text-sm text-blue-800 dark:text-blue-300">
                        ${isFieldMode
                            ? 'Välj ekipage och registrera start, mål och eventuella passager manuellt.'
                            : t('precision_split_info_text')}
                    </p>
                </div>

                <div class="flex items-center gap-2">
                    <div id="splitEquipageSearchContainer" class="flex-grow"></div>
                    ${isFieldMode ? '' : `<button id="btnAutoFind" class="p-2 border rounded-md bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:border-emerald-800 dark:text-emerald-400" title="${t('precision_split_auto_find_title')}">${t('precision_split_auto_find_btn')}</button>`}
                </div>
                
                <div class="p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg border dark:border-gray-700 text-center">
                    <div id="infoEquipageLine" class="font-bold dark:text-white text-lg md:text-xl">–</div>
                    <div class="text-xs text-gray-500 dark:text-gray-400 mt-1 uppercase tracking-wider font-medium">${isFieldMode ? 'Valt ekipage' : t('precision_split_current_equipage')}</div>
                </div>

                <div id="gatesListContainer" class="space-y-3">
                    <p class="text-center text-gray-500 text-sm">${isFieldMode ? 'Välj ekipage för att registrera start och mål.' : t('precision_split_select_to_log')}</p>
                </div>
            </div> 
        </div> 
    `;
}

function updateHeaderInfo() {
    const el = document.getElementById('infoEquipageLine');
    if (!currentEquipage) {
        if(el) el.textContent = '–';
        return;
    }
    if(el) el.textContent = `#${currentEquipage.startNumber} ${currentEquipage.driverName || ''}`;
}

async function logSplit(gateId) {
    if (!currentEquipage) return;
    
    const now = Date.now();
    gateSplits[gateId] = now;
    renderGates();

    const updates = { gateSplits: gateSplits };

    if (gateId === 'start') {
        updates.running = true;
        updates.liveStartEpoch = now;
        updates.livePausedMs = 0;
        updates.status = 'Pågår';
    } else if (gateId === 'finish') {
        updates.running = false;
        if (gateSplits['start']) {
            const elapsed = Math.max(0, now - gateSplits['start']);
            updates.liveTimeMs = elapsed;
            updates.timeMs = elapsed; // Set final time
            updates.status = 'Klar';
        }
    }

    try {
        await setDoc(precisionDocRef(currentEquipage.startNumber), updates, { merge: true });
    } catch (e) {
        console.warn('Split push failed:', e.message);
        showAlert(t('precision_split_save_error'), 'error');
    }
}

async function undoSplit(gateId) {
    if (!currentEquipage) return;
    
    delete gateSplits[gateId];
    renderGates();

    const updates = {
        [`gateSplits.${gateId}`]: deleteField()
    };

    if (gateId === 'start') {
        updates.running = false;
        updates.liveStartEpoch = deleteField();
        updates.status = 'Ej startat';
    } else if (gateId === 'finish') {
        updates.running = true;
        updates.liveTimeMs = deleteField();
        updates.timeMs = deleteField();
        updates.status = 'Pågår';
    }

    try {
        await updateDoc(precisionDocRef(currentEquipage.startNumber), updates);
    } catch (e) {
        console.warn('Split undo failed:', e.message);
    }
}

function renderGates() {
    const container = document.getElementById('gatesListContainer');
    if (!container) return;
    const isFieldMode = getGlobalState('currentCompetition')?.competitionMode === 'field';

    if (!currentEquipage) {
        container.innerHTML = `<p class="text-center text-gray-500 text-sm">${t('precision_split_select_to_log')}</p>`;
        return;
    }

    const mapSettings = precisionConfig?.mapSettings || {};
    if (!mapSettings.enabled && !isFieldMode) {
        container.innerHTML = `<div class="p-4 bg-red-50 text-red-700 rounded text-center text-sm dark:bg-red-900/30 dark:text-red-300">${t('precision_split_live_map_disabled')}</div>`;
        return;
    }

    const entities = mapSettings.entities || {};
    let keys = mapSettings.enabled
        ? Object.keys(entities).filter(k => k.startsWith('gate_'))
        : ['start', 'finish'];
    
    const courseData = getPrecisionCourseData(currentEquipage, precisionConfig).course;
    if (mapSettings.enabled && courseData && Array.isArray(courseData.obstacleLabels) && courseData.obstacleLabels.length > 0) {
        const allowedLabels = new Set(courseData.obstacleLabels.map(l => String(l).trim()));
        keys = keys.filter(k => {
            const gateNum = k.replace('gate_', '');
            return allowedLabels.has(gateNum);
        });
    }

    if (keys.length === 0) {
        container.innerHTML = `<p class="text-center text-gray-500 text-sm">${t('precision_split_no_gates_deployed')}</p>`;
        return;
    }

    keys.sort((a, b) => {
        const numA = parseInt(a.replace('gate_', '')) || 0;
        const numB = parseInt(b.replace('gate_', '')) || 0;
        return numA - numB;
    });

    let html = '<div class="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2 sm:gap-3">';

    keys.forEach(k => {
        let label = k === 'start'
            ? 'Start'
            : k === 'finish'
                ? 'Mål'
                : k.replace('gate_', '');

        const hasSplit = !!gateSplits[k];
        let timeStr = '';
        if (hasSplit) {
            const startAbs = gateSplits['start'] || currentEquipageData?.liveStartEpoch;
            if (!startAbs) {
                timeStr = new Date(gateSplits[k]).toLocaleTimeString('sv-SE', {hour12: false, hour:'2-digit', minute:'2-digit', second:'2-digit'});
            } else {
                const elapsed = Math.max(0, gateSplits[k] - startAbs);
                const m = Math.floor(elapsed / 60000);
                const s = Math.floor((elapsed % 60000) / 1000);
                const ds = Math.floor((elapsed % 1000) / 100);
                timeStr = `+${m > 0 ? m + ':' : ''}${String(s).padStart(m > 0 ? 2 : 1, '0')},${ds}s`;
            }
        }

        html += `
            <button class="btn-gate aspect-square p-1 sm:p-2 border-2 rounded-lg flex flex-col items-center justify-center transition-all ${hasSplit ? 'bg-green-100 border-green-500 text-green-900 dark:bg-green-900/30 dark:border-green-500 dark:text-green-100' : 'bg-gray-50 border-gray-300 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700 active:scale-95 shadow-sm'}" data-gate="${k}">
                <span class="font-bold text-lg sm:text-xl">${label}</span>
                ${hasSplit ? `<span class="text-[10px] sm:text-xs font-mono font-bold mt-1 opacity-80">${timeStr}</span>` : ''}
            </button>
        `;
    });

    html += '</div>';
    container.innerHTML = html;

    container.querySelectorAll('.btn-gate').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const gateId = e.currentTarget.dataset.gate;
            const hasSplit = !!gateSplits[gateId];
            
            if (hasSplit) {
                if (confirm(t('precision_split_undo_confirm').replace('{gateId}', gateId.replace('gate_', '')))) {
                    await undoSplit(gateId);
                }
            } else {
                await logSplit(gateId);
            }
        });
    });
}

function loadDriverData(equipage) {
    if (currentUnsubscribe) {
        currentUnsubscribe();
        currentUnsubscribe = null;
    }

    if (!equipage) return;

    const docRef = precisionDocRef(equipage.startNumber);
    currentUnsubscribe = onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            currentEquipageData = data;
            gateSplits = data.gateSplits || {};
            renderGates();
        } else {
            currentEquipageData = null;
            gateSplits = {};
            renderGates();
        }
    });
}

async function autoSelectRunningDriver() {
    if (!competitionId) return;
    try {
        const colRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/precision`);
        const q = query(colRef, where('running', '==', true));
        const snap = await getDocs(q);

        if (!snap.empty) {
            const firstRunning = snap.docs[0];
            const startNumber = firstRunning.id;
            if (searchableDropdown) {
                searchableDropdown.setValue(Number(startNumber));
            }
            showAlert(t('precision_split_autofocus').replace('{startNumber}', startNumber));
        } else {
            showAlert(t('precision_split_no_started'), 'info');
        }
    } catch (err) {
        console.warn('Auto-find failed:', err);
    }
}

export async function load() {
    const comp = getGlobalState('currentCompetition');
    const isFieldMode = comp?.competitionMode === 'field';
    competitionId = comp?.id;
    if (!competitionId) return;

    renderLayout();

    try {
        const [equipagesData, configData] = await Promise.all([
            getEquipages(competitionId),
            getConfig(competitionId, 'precisionConfig')
        ]);

        precisionConfig = configData || {};
        equipages = equipagesData
            .filter(e => e.startNumber)
            .map(e => ({
                id: e.id,
                startNumber: Number(e.startNumber),
                driverName: e.driverName || e.driver || e.name || e.kusk || '',
                className: e.className || e.class || e.klass || ''
            }))
            .sort((a, b) => a.startNumber - b.startNumber);

        searchableDropdown = createSearchableDropdown(
            document.getElementById('splitEquipageSearchContainer'),
            equipages,
            (eq) => {
                currentEquipage = eq;
                updateHeaderInfo();
                loadDriverData(eq);
            }
        );

        if (!isFieldMode) {
            document.getElementById('btnAutoFind')?.addEventListener('click', autoSelectRunningDriver);

            // Auto-poll for running driver every 15 seconds if no driver is selected
            autoSyncInterval = setInterval(() => {
                if (!currentEquipage) autoSelectRunningDriver();
            }, 15000);

            // Try once immediately
            autoSelectRunningDriver();
        }

    } catch (e) {
        console.error('Error in precision-split-input load:', e);
        showAlert(t('precision_split_load_error'), 'error');
    }
}

export function __unload() {
    if (currentUnsubscribe) {
        currentUnsubscribe();
        currentUnsubscribe = null;
    }
    if (autoSyncInterval) {
        clearInterval(autoSyncInterval);
        autoSyncInterval = null;
    }
}
