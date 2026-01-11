// js/pages/prize-giving.js
import { getGlobalState } from '../main.js';
import { getCompetitionHeader } from '../ui/components.js';
import { getEquipages, listenForMaratonCollection, listenForDressageProtocolsCollectionGroup, listenForPrecisionResults, getMaratonTimingData, updateEquipage, getConfig, listenForMaratonTimingUpdates } from '../services/firestoreService.js';
import { calculateTotalCompetitionPenalties } from '../utils/sharedUtils.js';
import { calculatePrecisionResult } from '../utils/precisionUtils.js';
import { calculateAggregateDressagePenalty, getPrograms } from '../utils/dressageUtils.js';
import { calculateMarathonResult, setMarathonConfig } from '../utils/marathonUtils.js';
import { getFlagHtml } from '../services/flagsService.js';
import { getClubLogoHtml, ensureClubLogosLoaded } from '../services/logosService.js';

let competitionId = null;
let equipages = [];
let marathonResults = new Map(); // Stores obstacle documents
let marathonTiming = new Map();  // Stores timing documents
let precisionResults = new Map();
let dressageResults = new Map();
let unsubscribes = [];
let activeClass = 'all';

// Configs
let marathonConfig = {};
let precisionConfig = {};

export async function load(container) {
    const comp = getGlobalState('currentCompetition');
    competitionId = comp?.id;
    if (!competitionId) {
        container.innerHTML = '<p class="p-8 text-center text-gray-500">Ingen tävling vald.</p>';
        return;
    }

    container.innerHTML = `
    <div class="container mx-auto p-4 md:p-8">
        <div class="flex justify-between items-center mb-6">
             ${getCompetitionHeader(comp, 'Prisutdelning 🏆')}
             <div class="text-sm text-gray-500 italic">Visar preliminära resultat</div>
        </div>
        
        <div id="prize-giving-tabs" class="flex flex-wrap gap-2 mb-6 border-b pb-4 overflow-x-auto">
            <!-- Tabs injected here -->
        </div>

        <div id="prize-giving-content" class="min-h-[400px]">
            <div class="text-center p-8 text-gray-400">Laddar resultat...</div>
        </div>
    </div>
    `;

    await ensureClubLogosLoaded();

    try {
        // Load initial data and configs
        const [eqData, mConfig, pConfig] = await Promise.all([
            getEquipages(competitionId),
            getConfig(competitionId, 'marathon'),
            getConfig(competitionId, 'precision')
        ]);

        equipages = eqData || [];
        marathonConfig = mConfig || {};
        precisionConfig = pConfig || {};

        // Push config to marathonUtils
        setMarathonConfig(marathonConfig);

        renderTabs(); // Render tabs immediately with available classes

        // Start listeners for live updates
        setupListeners();
    } catch (err) {
        console.error("Error loading prize giving:", err);
        container.innerHTML += `<p class="text-red-500 text-center">Ett fel uppstod: ${err.message}</p>`;
    }
}

function renderTabs() {
    const tabContainer = document.getElementById('prize-giving-tabs');
    if (!tabContainer) return;

    // Extract unique classes
    const classes = [...new Set(equipages.map(e => e.className || 'Okänd'))].sort();

    // Create tabs
    // Let's default to the first class if 'all' or invalid
    if (activeClass === 'all' && classes.length > 0) activeClass = classes[0];

    tabContainer.innerHTML = classes.map(cls => `
        <button 
            data-class="${cls}"
            class="px-4 py-2 rounded-full text-sm font-bold transition-all ${activeClass === cls ? 'bg-blue-600 text-white shadow-lg scale-105' : 'bg-white text-gray-600 hover:bg-gray-100 border'}"
        >
            ${cls}
        </button>
    `).join('');

    // Add click handlers
    tabContainer.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            activeClass = btn.dataset.class;
            renderTabs(); // Re-render to update active state
            recalcAndRender(); // Update content
        });
    });
}

function setupListeners() {
    // Marathon Results (Obstacles)
    const u1 = listenForMaratonCollection(competitionId, (docs) => {
        docs.forEach(data => {
            const sn = String(data.id);
            marathonResults.set(sn, data);
        });
        recalcAndRender();
    });
    unsubscribes.push(u1);

    // Marathon Timing
    const uTiming = listenForMaratonTimingUpdates(competitionId, (docs) => {
        // Handle array or snapshot structure if helper varies, but usually docs array
        const list = Array.isArray(docs) ? docs : (docs.docs || []);
        marathonTiming.clear(); // Rebuild from snapshot or incremental? 
        // listenForMaratonTimingUpdates in firestoreService returns snapshot if using onSnapshot, 
        // OR simplified list if customized. 
        // The service helper definition: passing snap.docs to callback. 
        // So 'docs' is an array of QueryDocumentSnapshot.
        list.forEach(doc => {
            const data = typeof doc.data === 'function' ? doc.data() : doc;
            const sn = String(doc.id || data.id || data.startNumber);
            marathonTiming.set(sn, data);
        });
        recalcAndRender();
    });
    unsubscribes.push(uTiming);

    // Dressage Results
    // Note: The service helper expects a list of start numbers to listen to.
    const startNumbers = equipages.map(e => e.startNumber);
    const u2 = listenForDressageProtocolsCollectionGroup(competitionId, startNumbers, (protocols) => {
        // processing a full list of protocols
        dressageResults.clear();
        protocols.forEach(p => {
            const sn = String(p.startNumber);
            if (!dressageResults.has(sn)) dressageResults.set(sn, []);
            dressageResults.get(sn).push(p);
        });
        recalcAndRender();
    });
    unsubscribes.push(u2);


    // Precision Results
    const u3 = listenForPrecisionResults(competitionId, (rows) => {
        // Remove ones not in rows?
        // Ideally yes, but simpler:
        // precisionResults.clear(); // Too aggressive if partial updates? 
        // snapshot listeners usually give full list if query is valid.
        // Let's assume rows is the FULL valid list.
        precisionResults.clear();
        rows.forEach(data => precisionResults.set(String(data.id), data));

        recalcAndRender();
    });
    unsubscribes.push(u3);
}

function recalcAndRender() {
    const content = document.getElementById('prize-giving-content');
    if (!content) return;

    // Filter equipages by active class
    const classEquipages = equipages.filter(e => e.className === activeClass);

    if (classEquipages.length === 0) {
        content.innerHTML = `<div class="text-center p-12 text-gray-400 text-xl">Inga ekipage i denna klass.</div>`;
        return;
    }

    // Calculate totals
    const rows = classEquipages.map(eq => {
        const sn = String(eq.startNumber);

        // Dressage
        const protocols = dressageResults.get(sn) || [];
        // Need to normalize/deduplicate?
        // Simple calc:
        const dRes = calculateAggregateDressagePenalty(protocols, getPrograms()); // Helper from utils
        const dPen = dRes ? dRes.penalty : null;

        // Marathon
        const mObs = marathonResults.get(sn) || {};
        const mTime = marathonTiming.get(sn) || {};
        const mRes = calculateMarathonResult(eq, mObs, mTime); // Uses central logic
        const mPen = mRes.totalPenalty; // Can be null

        // Precision
        const pData = precisionResults.get(sn);
        let pPen = null;
        let pElim = false;
        if (pData) {
            const calc = calculatePrecisionResult(pData, eq, precisionConfig);
            pPen = calc.totalPenalty;
            pElim = calc.eliminated;
        }

        // Total
        let total = null;
        let isEliminated = false;

        // Check eliminations
        if (dRes && dRes.eliminated) isEliminated = true;
        if (mRes && mRes.eliminated) isEliminated = true;
        if (pElim) isEliminated = true;

        if (!isEliminated) {
            const d = typeof dPen === 'number' ? dPen : 0;
            const m = typeof mPen === 'number' ? mPen : 0;
            const p = typeof pPen === 'number' ? pPen : 0;

            // Strict rule: sum if started (or whatever logic user prefers)
            // Here we assume if valid components exist, we sum them
            if (dPen !== null || mPen !== null || pPen !== null) {
                total = d + m + p;
            }
        }

        return {
            ...eq,
            dPen, mPen, pPen,
            total,
            isEliminated,
            present: eq.prizeGivingPresent === true
        };
    });

    // Sort: Total asc, then eliminations at bottom
    rows.sort((a, b) => {
        if (a.isEliminated && b.isEliminated) return 0;
        if (a.isEliminated) return 1;
        if (b.isEliminated) return -1;

        if (a.total === null && b.total === null) return 0;
        if (a.total === null) return 1;
        if (b.total === null) return -1;

        return a.total - b.total;
    });

    // Render
    renderPodiumList(rows, content);
}

function renderPodiumList(rows, container) {
    const validRows = rows.filter(r => !r.isEliminated && r.total !== null);
    const others = rows.filter(r => r.isEliminated || r.total === null);

    let html = `
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <!-- WINNER & PODIUM -->
        <div class="space-y-4">
            <h2 class="text-2xl font-bold mb-4 text-center lg:text-left flex items-center gap-2">
                <span>Resultat: ${activeClass}</span>
                <span class="text-sm font-normal text-gray-500 bg-gray-100 px-2 py-1 rounded">${validRows.length} placerade</span>
            </h2>
    `;

    if (validRows.length > 0) {
        html += `<div class="space-y-4">`;
        validRows.forEach((row, idx) => {
            const place = idx + 1;
            const isPodium = place <= 3;

            // Big card for winner
            if (place === 1) {
                html += `
                <div class="bg-yellow-50 border-2 border-yellow-400 rounded-xl p-6 shadow-lg transform md:scale-105 mb-6 relative">
                    <div class="absolute -top-4 -right-4 bg-yellow-400 text-white w-12 h-12 flex items-center justify-center rounded-full font-bold text-xl shadow">1</div>
                    <div class="flex flex-col md:flex-row gap-4 items-center md:items-start text-center md:text-left">
                        <div class="flex-1">
                            <div class="text-xs text-yellow-700 font-bold tracking-wider uppercase mb-1">Segrare</div>
                            <h3 class="text-3xl font-bold text-gray-900 leading-tight mb-2">${row.driverName}</h3>
                            <div class="text-lg text-gray-700 mb-2">${row.clubName}</div>
                            <div class="flex justify-center md:justify-start gap-4 text-sm text-gray-500 mb-4">
                                ${getFlagHtml(row)} <span>${row.horseName}</span>
                            </div>
                            <div class="text-4xl font-extrabold text-blue-900">${row.total.toFixed(2)}</div>
                            <div class="text-xs text-gray-400 mt-1">Totalt Straff</div>
                        </div>
                        <div class="flex flex-col gap-2 items-center">
                            ${getPresetCheckbox(row)}
                        </div>
                    </div>
                </div>`;
            } else {
                // List items
                html += `
                <div class="bg-white border rounded-lg p-4 shadow-sm flex items-center justify-between ${isPodium ? 'border-l-4 border-gray-400' : ''}">
                    <div class="flex items-center gap-4">
                        <div class="font-bold text-2xl text-gray-400 w-8 text-center">${place}</div>
                        <div>
                            <div class="font-bold text-lg leading-none">${row.driverName}</div>
                            <div class="text-sm text-gray-500">${row.clubName}</div>
                        </div>
                    </div>
                    <div class="flex items-center gap-6">
                        <div class="text-xl font-bold text-gray-800">${row.total.toFixed(2)}</div>
                        ${getPresetCheckbox(row)}
                    </div>
                </div>`;
            }
        });
        html += `</div>`;
    } else {
        html += `<p class="text-gray-500 italic">Inga godkända resultat ännu.</p>`;
    }

    html += `</div> <!-- End Col 1 -->
    
    <!-- DETAILS & OTHERS -->
    <div class="bg-gray-50 p-6 rounded-xl h-fit">
        <h3 class="font-bold text-gray-500 uppercase text-xs tracking-wider mb-4">Övriga / Eliminerade</h3>
        <div class="space-y-2">`;

    if (others.length > 0) {
        others.forEach(row => {
            const status = row.isEliminated ? 'ELIM' : (row.total === null ? 'Ej Start' : '—');
            html += `
             <div class="flex justify-between items-center text-sm p-2 rounded bg-white border border-gray-100 opacity-75">
                <div class="flex gap-2">
                    <span class="font-mono text-gray-400">#${row.startNumber}</span>
                    <span>${row.driverName}</span>
                </div>
                <div class="font-bold text-red-400">${status}</div>
             </div>`;
        });
    } else {
        html += `<p class="text-xs text-gray-400">Listan är tom.</p>`;
    }

    html += `
        </div>
        
        <div class="mt-8 p-4 bg-blue-50 rounded border border-blue-100">
            <h4 class="font-bold text-blue-800 mb-2 text-sm">Säg till speakern:</h4>
            <p class="text-sm text-blue-700 leading-relaxed">
                "Vi ber alla placerade ekipage att göra sig redo för prisutdelning.
                Segraren ${validRows[0]?.driverName || '...'} ombeds köra in för ärevarv!"
            </p>
        </div>
    </div>
    </div>`;

    container.innerHTML = html;

    // Bind checkboxes
    container.querySelectorAll('.presence-check').forEach(chk => {
        chk.addEventListener('change', (e) => togglePresence(e.target.dataset.sn, e.target.checked));
    });
}

function getPresetCheckbox(row) {
    return `
    <label class="flex flex-col items-center cursor-pointer group">
        <input type="checkbox" class="presence-check w-6 h-6 text-green-600 rounded focus:ring-green-500 border-gray-300" 
            data-sn="${row.startNumber}" 
            ${row.present ? 'checked' : ''}>
        <span class="text-[10px] text-gray-400 group-hover:text-gray-600 mt-1 uppercase font-bold">På plats</span>
    </label>`;
}

async function togglePresence(sn, isChecked) {
    if (!sn) return;
    try {
        // Find doc id? Usually we use a helper to get equipage doc id. 
        // Or if we know the ID from the loaded equipages list.
        const eq = equipages.find(e => String(e.startNumber) === String(sn));
        if (eq && eq.id) {
            await updateEquipage(competitionId, eq.id, { prizeGivingPresent: isChecked });

            // Optimistic update
            eq.prizeGivingPresent = isChecked;
            // Re-render handled by listeners usually, but eq updates might not trigger 'getEquipages' reload unless we listen to equipages collection. 
            // We didn't setup equipages listener in this simplified version.
            // Let's manually trigger re-render if needed?
            // Actually, updateEquipage updates firestore, which we are NOT listening to for *all* fields, only results. 
            // We should add a listener for equipages too if we want live sync of checkboxes.
            // For now, simple local update + redraw.
            recalcAndRender();
        }
    } catch (e) {
        console.error("Failed to update presence:", e);
        alert("Kunde inte spara status.");
    }
}

export function __unload() {
    unsubscribes.forEach(u => u && u());
    unsubscribes = [];
}
