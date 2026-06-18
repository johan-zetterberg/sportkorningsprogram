// js/pages/prize-giving.js
import { getGlobalState } from '../../main.js';
import { getCompetitionHeader } from '../../ui/components.js';
import { getEquipages } from '../../services/equipageService.js';
import { listenForMaratonCollection, getMarathonTimingData, listenForMarathonTimingUpdates } from '../../services/marathonService.js';
import { listenForDressageProtocolsCollectionGroup } from '../../services/dressageService.js';
import { listenForPrecisionResults } from '../../services/precisionService.js';
import { updateEquipage } from '../../services/equipageService.js';
import { listenForMarathonConfig } from '../../services/marathonService.js';
import { listenForEquipages } from '../../services/equipageService.js';
import { getConfig } from '../../services/competitionService.js';
import { horseLabel, escapeHtml } from '../../utils/sharedUtils.js';
import { calculatePrecisionResult } from '../../utils/precisionUtils.js';
import { getPrograms, deduplicateAndFilterProtocols } from '../../utils/dressageUtils.js';
import { calculateDressageResult } from '../../services/calculationService.js';
import { calculateMarathonResult, setMarathonConfig, buildMergeMap, ensureMergeDecorations } from '../../utils/marathonUtils.js';
import { getFlagHtml } from '../../services/flagsService.js';
import { ensureClubLogosLoaded } from '../../services/logosService.js';
import {
    formatPrizeGivingScore,
    getPrizeGivingStatus,
    isPrizeGivingScore
} from './prizeGivingUtils.js';

let competitionId = null;
let equipages = [];
let marathonResults = new Map(); // Stores obstacle documents
let marathonTiming = new Map();  // Stores timing documents
let precisionResults = new Map();
let dressageResults = new Map();
let unsubscribes = [];
let activeClass = 'all';
let activeDiscipline = 'total'; // 'total', 'dressage', 'marathon', 'precision'
let classSettings = {};
let loadToken = 0;

// Configs
let marathonConfig = {};
let precisionConfig = {};

export async function load(container) {
    __unload();
    const currentLoadToken = ++loadToken;

    const comp = getGlobalState('currentCompetition');
    competitionId = comp?.id;
    if (!competitionId) {
        container.innerHTML = '<p class="p-8 text-center text-gray-500 dark:text-gray-400">Ingen tävling vald.</p>';
        return;
    }

    container.innerHTML = `
    <div class="container mx-auto p-3 sm:p-4 md:p-8">
        <div class="flex justify-between items-center mb-6">
             ${getCompetitionHeader(comp, 'Prisutdelning 🏆')}
             <div class="text-sm text-gray-500 dark:text-gray-400 italic">Visar preliminära resultat</div>
        </div>
        
        <div id="prize-giving-tabs" class="flex flex-wrap gap-2 mb-4 md:mb-6 border-b dark:border-gray-700 pb-3 md:pb-4 overflow-x-auto">
            <!-- Tabs injected here -->
        </div>

        <div id="prize-giving-content" class="min-h-[400px]">
            <div class="text-center p-8 text-gray-400 dark:text-gray-500">Laddar resultat...</div>
        </div>
    </div>
    `;

    await ensureClubLogosLoaded();
    if (currentLoadToken !== loadToken) return;

    try {
        const [eqData, mConfig, pConfig, cSettings] = await Promise.all([
            getEquipages(competitionId),
            getConfig(competitionId, 'maratonConfig'),
            getConfig(competitionId, 'precision'),
            getConfig(competitionId, 'classSettings').catch(() => ({}))
        ]);
        if (currentLoadToken !== loadToken) return;

        equipages = eqData || [];
        marathonConfig = mConfig || {};
        precisionConfig = pConfig || {};
        classSettings = cSettings || {};

        // Merge logic
        buildMergeMap(marathonConfig);
        equipages = ensureMergeDecorations(equipages);

        // Push config to marathonUtils (for calculations)
        setMarathonConfig(marathonConfig);

        renderTabs(); // Render tabs immediately with available classes

        // Start listeners for live updates
        setupListeners();
    } catch (err) {
        if (currentLoadToken !== loadToken) return;
        console.error("Error loading prize giving:", err);
        container.innerHTML += `<p class="text-red-500 text-center">Ett fel uppstod: ${escapeHtml(err.message)}</p>`;
    }
}

function renderTabs() {
    const tabContainer = document.getElementById('prize-giving-tabs');
    if (!tabContainer) return;

    // Render Classes (with support for merged labels)
    const classes = [...new Set(equipages.map(e => e._mergedLabel || e.className || 'Okänd'))].sort();
    if (activeClass === 'all' && classes.length > 0) activeClass = classes[0];

    tabContainer.innerHTML = `
        <div class="flex flex-col gap-3 w-full">
            <!-- Disciplines -->
            <div class="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide no-scrollbar">
                ${['total', 'dressage', 'marathon', 'precision'].map(d => {
                    const label = { total: 'Totalt 🏆', dressage: 'Dressyr', marathon: 'Maraton', precision: 'Precision' }[d];
                    const active = activeDiscipline === d;
                    return `
                    <button 
                        data-discipline="${d}"
                        class="px-3 py-1.5 rounded-lg text-xs font-black whitespace-nowrap transition-all border-2 ${active ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-white text-gray-500 border-gray-100 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700'}"
                    >
                        ${escapeHtml(label)}
                    </button>`;
                }).join('')}
            </div>
            
            <!-- Classes -->
            <div class="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide no-scrollbar">
                ${classes.map(cls => {
                    const active = activeClass === cls;
                    return `
                    <button 
                        data-class="${escapeHtml(cls)}"
                        class="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-tight transition-all border ${active ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm' : 'bg-gray-50 text-gray-400 border-gray-200 dark:bg-gray-900 dark:text-gray-500 dark:border-gray-800'}"
                    >
                        ${escapeHtml(cls)}
                    </button>`;
                }).join('')}
            </div>
        </div>
    `;

    // Add click handlers
    tabContainer.querySelectorAll('[data-class]').forEach(btn => {
        btn.addEventListener('click', () => {
            activeClass = btn.dataset.class;
            renderTabs();
            recalcAndRender();
        });
    });
    tabContainer.querySelectorAll('[data-discipline]').forEach(btn => {
        btn.addEventListener('click', () => {
            activeDiscipline = btn.dataset.discipline;
            renderTabs();
            recalcAndRender();
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
    const uTiming = listenForMarathonTimingUpdates(competitionId, (docs) => {
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
        precisionResults.clear();
        rows.forEach(data => precisionResults.set(String(data.id), data));
        recalcAndRender();
    });
    unsubscribes.push(u3);

    // Marathon Config (Merge settings)
    const uConfig = listenForMarathonConfig(competitionId, (cfg) => {
        marathonConfig = cfg || {};
        buildMergeMap(marathonConfig);
        setMarathonConfig(marathonConfig);
        // Re-decorate existing equipages with new map
        equipages = ensureMergeDecorations(equipages);
        renderTabs();
        recalcAndRender();
    });
    unsubscribes.push(uConfig);

    // Equipages (Live sync for presence checkboxes)
    const u4 = listenForEquipages(competitionId, (data) => {
        equipages = ensureMergeDecorations(data || []);
        recalcAndRender();
        renderTabs();
    });
    unsubscribes.push(u4);
}function recalcAndRender() {
    const content = document.getElementById('prize-giving-content');
    if (!content) return;

    // Filter equipages by active class (using merged labels)
    const classEquipages = equipages.filter(e => (e._mergedLabel || e.className) === activeClass);

    if (classEquipages.length === 0) {
        content.innerHTML = `<div class="text-center p-12 text-gray-400 dark:text-gray-500 text-xl">Inga ekipage i denna klass.</div>`;
        return;
    }

    // Calculate totals
    const rows = classEquipages.map(eq => {
        const sn = String(eq.startNumber);

        // Dressage
        const protocols = dressageResults.get(sn) || [];
        const programs = getPrograms();
        const validProtos = deduplicateAndFilterProtocols(protocols, window.currentJudgesPresent || []);
        const dRes = calculateDressageResult(eq, validProtos, window.currentJudgesPresent || [], programs);
        const dPen = (dRes && dRes.penalty != null) ? dRes.penalty : null;

        // Marathon
        const mObs = marathonResults.get(sn) || {};
        const mTimeRaw = marathonTiming.get(sn) || {};
        // [FIX] Merge to ensure manual times in mObs are used if mTimeRaw is empty
        const mTime = { ...mObs, ...mTimeRaw };

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

        let displayScore = null;
        let isEliminated = false;

        // Check eliminations
        if (activeDiscipline === 'total' || activeDiscipline === 'dressage') if (dRes && dRes.eliminated) isEliminated = true;
        if (activeDiscipline === 'total' || activeDiscipline === 'marathon') if (mRes && mRes.eliminated) isEliminated = true;
        if (activeDiscipline === 'total' || activeDiscipline === 'precision') if (pElim) isEliminated = true;

        if (!isEliminated) {
            if (activeDiscipline === 'total') {
                const allCompleted = dPen !== null && mPen !== null && pPen !== null;
                if (allCompleted) displayScore = dPen + mPen + pPen;
            } else if (activeDiscipline === 'dressage') {
                displayScore = dPen;
            } else if (activeDiscipline === 'marathon') {
                displayScore = mPen;
            } else if (activeDiscipline === 'precision') {
                displayScore = pPen;
            }
        }

        if (displayScore === Infinity) {
            isEliminated = true;
            displayScore = null;
        } else if (!isPrizeGivingScore(displayScore)) {
            displayScore = null;
        }

        return {
            ...eq,
            dPen, mPen, pPen,
            score: displayScore,
            isEliminated,
            present: eq.prizeGivingPresent === true
        };
    });

    // Sort: Score asc, then eliminations at bottom
    rows.sort((a, b) => {
        if (a.isEliminated && b.isEliminated) return Number(a.startNumber) - Number(b.startNumber);
        if (a.isEliminated) return 1;
        if (b.isEliminated) return -1;

        if (!isPrizeGivingScore(a.score) && !isPrizeGivingScore(b.score)) return Number(a.startNumber) - Number(b.startNumber);
        if (!isPrizeGivingScore(a.score)) return 1;
        if (!isPrizeGivingScore(b.score)) return -1;

        const diff = a.score - b.score;
        if (Math.abs(diff) > 0.001) return diff;

        // Tie-breaker for Total: Best Marathon Score
        if (activeDiscipline === 'total') {
            const mA = typeof a.mPen === 'number' ? a.mPen : 999999;
            const mB = typeof b.mPen === 'number' ? b.mPen : 999999;
            if (mA !== mB) return mA - mB;
        }

        // Final Tie-breaker: Start Number
        return Number(a.startNumber) - Number(b.startNumber);
    });

    // Render
    renderPodiumList(rows, content);
}

function renderPodiumList(rows, container) {
    const validRows = rows.filter(r => !r.isEliminated && isPrizeGivingScore(r.score));
    const others = rows.filter(r => r.isEliminated || !isPrizeGivingScore(r.score));
    
    // Placed count
    const starters = rows.length;
    const defaultPlaced = Math.ceil(starters / 4) || 1;
    const configuredPlaced = classSettings[activeClass]?.placedCount;
    const numPlaced = configuredPlaced ?? defaultPlaced;

    const disciplineLabel = { total: 'Totalt', dressage: 'Dressyr', marathon: 'Maraton', precision: 'Precision' }[activeDiscipline];

    let html = `
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
        <!-- WINNER & PODIUM -->
        <div class="space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2 mb-2 p-3 bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm">
                <div class="flex flex-col">
                    <span class="text-[10px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-widest">${disciplineLabel}</span>
                    <h2 class="text-base font-black dark:text-white leading-tight">${escapeHtml(activeClass)}</h2>
                </div>
                <div class="px-2 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-[10px] font-black rounded border border-blue-100 dark:border-blue-800">
                    ${numPlaced} PLACERADE
                </div>
            </div>
    `;

    if (validRows.length > 0) {
        html += `<div class="space-y-4">`;
        validRows.forEach((row, idx) => {
            const place = idx + 1;
            const isPodium = place <= 3;

            // Big card for winner
            if (place === 1) {
                html += `
                <div class="bg-gradient-to-br from-yellow-50 to-orange-50 dark:from-yellow-900/20 dark:to-orange-900/10 border-2 border-yellow-400 dark:border-yellow-600 rounded-2xl p-5 shadow-xl relative overflow-hidden mb-4">
                    <div class="absolute top-0 right-0 p-4 opacity-10">
                         <i class="fas fa-trophy text-6xl text-yellow-600"></i>
                    </div>
                    <div class="absolute top-2 right-2 bg-yellow-400 dark:bg-yellow-500 text-white w-10 h-10 flex items-center justify-center rounded-full font-black text-xl shadow-lg border-2 border-white dark:border-gray-800 z-10">1</div>
                    <div class="flex flex-col gap-4 relative z-0">
                        <div class="w-full">
                            <div class="text-[10px] text-yellow-700 dark:text-yellow-400 font-black tracking-widest uppercase mb-1">Segrare</div>
                            <h3 class="text-2xl font-black text-gray-900 dark:text-white leading-none mb-1 truncate">${escapeHtml(row.driverName)}</h3>
                             <div class="flex items-center gap-2 mb-3">
                                <div class="text-[11px] font-bold text-gray-500 dark:text-gray-400 opacity-80">${escapeHtml(row.clubName)}</div>
                                ${row.className && row.className !== activeClass ? `<div class="text-[9px] bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded-md font-black uppercase tracking-tighter border border-blue-200/50 dark:border-blue-700/50 shadow-sm">${escapeHtml(row.className)}</div>` : ''}
                             </div>
                            
                            <div class="inline-flex items-center gap-2 bg-white/60 dark:bg-black/20 px-3 py-1.5 rounded-lg text-xs text-gray-700 dark:text-gray-300 mb-4">
                                ${getFlagHtml(row)} <span class="font-medium truncate">${escapeHtml(horseLabel(row))}</span>
                            </div>

                            <div class="flex items-end gap-2">
                                <span class="text-4xl font-black text-blue-900 dark:text-blue-300 tabular-nums leading-none tracking-tighter">${formatPrizeGivingScore(row.score)}</span>
                                <span class="text-[10px] text-gray-500 dark:text-gray-500 uppercase font-black tracking-tighter mb-1">Straff</span>
                            </div>
                        </div>
                        <div class="flex justify-between items-center gap-3 bg-white/40 dark:bg-black/20 p-2 px-3 rounded-xl border border-white/20">
                            <span class="text-[10px] font-black text-gray-500 dark:text-gray-400 uppercase">Kontrollera status:</span>
                            ${getPresetCheckbox(row)}
                        </div>
                    </div>
                </div>`;
            } else {
                const isPlaced = place <= numPlaced;
                // List items
                html += `
                <div class="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-3 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 transition-all hover:shadow-md ${isPlaced ? 'border-l-4 border-emerald-500 dark:border-emerald-600 bg-emerald-50/10' : ''}">
                    <div class="flex items-center gap-3 min-w-0">
                        <div class="font-black text-lg ${isPlaced ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-300 dark:text-gray-600'} w-7 text-center">${place}</div>
                        <div class="truncate">
                             <div class="font-bold text-sm leading-none dark:text-white mb-0.5 ${isPlaced ? 'text-emerald-900 dark:text-emerald-100' : ''}">
                                 ${escapeHtml(row.driverName)}
                                 ${row.className && row.className !== activeClass ? `<span class="ml-1.5 text-[8px] font-black bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded uppercase tracking-widest border border-blue-100/30 dark:border-blue-800/30">${escapeHtml(row.className)}</span>` : ''}
                             </div>
                             <div class="text-[10px] text-gray-500 dark:text-gray-400 truncate">${escapeHtml(row.clubName)}</div>
                        </div>
                    </div>
                    <div class="flex items-center gap-3 shrink-0">
                        <div class="text-base font-black text-gray-800 dark:text-gray-200 tabular-nums">${formatPrizeGivingScore(row.score)}</div>
                        <div class="shrink-0">
                            ${getPresetCheckbox(row)}
                        </div>
                    </div>
                </div>`;
            }
        });
        html += `</div>`;
    } else {
        html += `<p class="text-gray-500 dark:text-gray-400 italic">Inga godkända resultat ännu.</p>`;
    }

    html += `
    </div> <!-- End Col 1 -->
    
    <!-- DETAILS & OTHERS -->
    <div class="bg-gray-50 dark:bg-gray-700/30 p-3 sm:p-4 rounded-xl h-fit border dark:border-gray-700/50">
        <h3 class="font-black text-gray-400 dark:text-gray-500 uppercase text-[10px] tracking-widest mb-3">Övriga / Eliminerade</h3>
        <div class="space-y-1.5">`;

    if (others.length > 0) {
        others.forEach(row => {
            const status = getPrizeGivingStatus(row);
            html += `
             <div class="flex justify-between items-center text-[11px] p-2 px-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 opacity-80">
                <div class="flex gap-2 items-center min-w-0">
                     <span class="text-[9px] font-black text-gray-400 dark:text-gray-600 bg-gray-50 dark:bg-gray-900/50 px-1 py-0.5 rounded border border-gray-100 dark:border-gray-800">#${escapeHtml(row.startNumber)}</span>
                      <span class="dark:text-gray-300 truncate font-semibold">${escapeHtml(row.driverName)}</span>
                      ${row.className && row.className !== activeClass ? `<span class="text-[8px] text-gray-400 dark:text-gray-500 uppercase font-black tracking-tighter bg-gray-100/50 dark:bg-gray-700/50 px-1 rounded ml-1 border border-gray-100 dark:border-gray-700">${escapeHtml(row.className)}</span>` : ''}
                  </div>
                <div class="font-black text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-1.5 py-0.5 rounded text-[9px] uppercase">${escapeHtml(status)}</div>
             </div>`;
        });
    } else {
        html += `<p class="text-[10px] text-gray-400 dark:text-gray-500 italic text-center py-2">Inga övriga.</p>`;
    }

    html += `
        </div>
        
        <div class="mt-6 p-3 bg-blue-50/50 dark:bg-blue-900/10 rounded-lg border border-blue-100/50 dark:border-blue-800/30">
            <h4 class="font-black text-blue-800/60 dark:text-blue-400/60 mb-1 text-[10px] uppercase tracking-tighter">Säg till speakern:</h4>
            <p class="text-xs text-blue-700 dark:text-blue-300 leading-tight italic">
                "Vi ber alla placerade ekipage att göra sig redo för prisutdelning.
                Segraren ${escapeHtml(validRows[0]?.driverName || '...')} ombeds köra in för ärevarv!"
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
    <label class="flex items-center gap-2 cursor-pointer group">
        <span class="text-[9px] text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-300 uppercase font-black tracking-tighter">PÅ PLATS</span>
        <input type="checkbox" class="presence-check w-5 h-5 text-emerald-600 rounded focus:ring-emerald-500 border-gray-300 dark:border-gray-600 dark:bg-gray-700"
            data-sn="${escapeHtml(row.startNumber)}"
            ${row.present ? 'checked' : ''}>
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
    loadToken++;
    unsubscribes.forEach(u => {
        try { u && u(); } catch { }
    });
    unsubscribes = [];
    competitionId = null;
    equipages = [];
    marathonResults.clear();
    marathonTiming.clear();
    precisionResults.clear();
    dressageResults.clear();
    activeClass = 'all';
    activeDiscipline = 'total';
    classSettings = {};
    marathonConfig = {};
    precisionConfig = {};
}
