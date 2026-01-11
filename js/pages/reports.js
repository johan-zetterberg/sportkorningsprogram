
import {
    getEquipages,
    getConfig,
    getDressageStatusCollection,
    getMarathonTimingData,
    getMarathonResults, // Returns list of ALL obstacle results
    getPrecisionResults
} from '../services/firestoreService.js';
import { getCompetitionHeader } from '../ui/components.js';
import { getGlobalState } from '../main.js';
import {
    downloadCsv,
    isPrivileged,
    resolveCurrentCompId
} from '../utils/sharedUtils.js';

import { generateStartListPdf } from '../pdf/startListPdf.js';
import { generateDressagePdf } from '../pdf/dressagePdf.js';
import { generateMarathonListPdf } from '../pdf/marathonPdf.js';
import { generatePrecisionListPdf } from '../pdf/precisionPdf.js';
import { generateTotalResultsPdf } from '../pdf/totalResultsPdf.js';

import { calculateMarathonResult, setMarathonConfig } from '../utils/marathonUtils.js';
import { getCalculatedRowData, buildPlaceMap } from '../utils/precisionUtils.js';

// Global strings for CSV
const SEPARATOR = ';';

let equipages = [];
let reportRows = []; // Enriched data for reports
let competitionId = null;
let marathonConfig = null;
let precisionConfig = null;
let startTimes = null;
let precisionMap = new Map();

export async function load() {
    competitionId = resolveCurrentCompId();
    if (!competitionId) {
        console.error('reports.js: No competitionId found');
        return;
    }

    render(); // Initial render (loading state?)

    // 1. Fetch Configs & Data in parallel
    const [
        eqs,
        dStatus,
        mRefResults,
        mTimingMap,
        pResults,
        mCfg,
        pCfg,
        sTimes
    ] = await Promise.all([
        getEquipages(competitionId),
        getDressageStatusCollection(competitionId),
        getMarathonResults(competitionId), // Obstacle results flat list
        getMarathonTimingData(competitionId),
        getPrecisionResults(competitionId),
        getConfig(competitionId, 'marathonConfig'), // or 'maratonConfig'?
        getConfig(competitionId, 'precisionConfig'),
        getConfig(competitionId, 'startTimes')
    ]);

    equipages = eqs;
    marathonConfig = mCfg?.value || mCfg || {};
    precisionConfig = pCfg?.value || pCfg || {};
    startTimes = sTimes?.times || {};

    // Set global config for utils
    setMarathonConfig(marathonConfig);

    // 2. Prepare Maps
    const dressageMap = new Map();
    dStatus.forEach(d => dressageMap.set(String(d.startNumber || d.id), d)); // d.id might be startNumber if normalizing

    const marathonObsMap = new Map(); // sn -> [obstacles]
    mRefResults.forEach(r => {
        // r = { equipageId, obstacleNumber, ... }
        const sn = String(r.equipageId);
        if (!marathonObsMap.has(sn)) marathonObsMap.set(sn, []);
        marathonObsMap.get(sn).push(r);
    });

    precisionMap = new Map();
    pResults.forEach(p => precisionMap.set(String(p.startNumber || p.id), p));

    // 3. Merge Data into Equipages (for standard PDF functions)
    // AND build "reportRows" (clean structure for Total/CSV)

    // First, build Precision Place Map (needs all rows)
    // We need a temporary structure for buildPlaceMap
    const tempPrecisionRows = equipages.map(e => ({
        startNumber: e.startNumber,
        className: e.className,
        _mergedKey: e.className // or some grouping
    }));
    const precisionPlaceMap = buildPlaceMap(tempPrecisionRows, precisionMap);

    reportRows = equipages.map(eq => {
        const sn = String(eq.startNumber);

        // --- DRESSAGE ---
        const dSt = dressageMap.get(sn);
        // Normalize: if we have status doc, use it.
        const dressageRes = {
            penalty: dSt?.totalPenalty || null,
            percent: dSt?.totalPercent || null,
            points: dSt?.totalPoints || null,
            finalized: !!dSt?.finalized,
            eliminated: !!dSt?.eliminated
        };

        // --- MARATHON ---
        const t = mTimingMap.get(sn);
        const obs = marathonObsMap.get(sn) || [];
        const mDoc = { obstacles: obs, eliminated: obs.some(o => o.eliminated) }; // Simplified doc structure
        // Calculate!
        const mCalc = calculateMarathonResult(eq, mDoc, t);

        // --- PRECISION ---
        // getCalculatedRowData(sn, placeMap, equipages, precisionMap, config, startTimes)
        const pCalc = getCalculatedRowData(sn, precisionPlaceMap, equipages, precisionMap, precisionConfig, startTimes);

        // --- TOTAL ---
        let totalPenalty = 0;
        let isEliminated = false;

        // Dressage
        if (dressageRes.eliminated || dressageRes.penalty === null) {
            // If eliminated or no result? 
            // Usually if no result, we treat as 0 for calc (start of comp) or Infinity?
            // "totalResultsPdf.js" treats null as '—'.
            if (dressageRes.eliminated) isEliminated = true;
        } else {
            totalPenalty += Number(dressageRes.penalty);
        }

        // Marathon
        if (mCalc.eliminated) isEliminated = true;
        // If mCalc.totalPenalty is null (not started), we skip adding? 
        // Or if partial? Total usually requires all phases.
        if (mCalc.totalPenalty !== null && Number.isFinite(mCalc.totalPenalty)) {
            totalPenalty += mCalc.totalPenalty;
        } else if (mCalc.totalPenalty === Infinity) {
            isEliminated = true;
        }

        // Precision
        if (pCalc.eliminated) isEliminated = true;
        if (pCalc.totalPenalty !== null && Number.isFinite(pCalc.totalPenalty)) {
            totalPenalty += pCalc.totalPenalty;
        } else if (pCalc.totalPenalty === Infinity) {
            isEliminated = true;
        }

        // Attach to Equipage (Mutate for PDF libs)
        eq.results = eq.results || {};
        eq.results.dressage = dressageRes;
        eq.results.marathon = mCalc; // Attach the full calc object
        eq.results.precision = pCalc;

        // Return enriched row
        return {
            ...eq,
            dressage: dressageRes,
            marathon: mCalc,
            precision: pCalc,
            totalPenalty: isEliminated ? Infinity : totalPenalty,
            isEliminated
        };
    });

    // Sort by class then total penalty (default view)
    reportRows.sort((a, b) => {
        const c = (a.className || '').localeCompare(b.className || '');
        if (c !== 0) return c;
        if (a.isEliminated && !b.isEliminated) return 1;
        if (!a.isEliminated && b.isEliminated) return -1;
        return (a.totalPenalty || 0) - (b.totalPenalty || 0);
    });

    render();
}

function render() {
    const page = document.getElementById('page-reports');
    if (!page) return;

    const competition = getGlobalState('currentCompetition');
    const loading = !equipages || !equipages.length;

    // Extract unique classes
    const uniqueClasses = [...new Set(equipages.map(e => e.className).filter(Boolean))].sort();

    page.innerHTML = `
    <div class="container mx-auto p-4 md:p-8">
        ${getCompetitionHeader(competition, 'Rapportcenter')}
        
        ${loading ? '<p class="text-center mt-8 text-gray-500 animate-pulse">Laddar data...</p>' : ''}

        <div class="${loading ? 'opacity-50 pointer-events-none' : ''}">
            <!-- FILTER TOOLBAR -->
            <div class="bg-white rounded-lg shadow p-4 mb-6 flex flex-wrap items-center gap-4">
                <label class="font-bold text-gray-700">Filtrera på klass:</label>
                <select id="report-class-filter" class="border rounded p-2 min-w-[200px]">
                    <option value="">Alla klasser</option>
                    ${uniqueClasses.map(c => `<option value="${c}">${c}</option>`).join('')}
                </select>
                <div class="text-sm text-gray-500 italic ml-auto">
                    Valt urval påverkar alla rapporter nedan.
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            
            <!-- START LISTS -->
            <div class="bg-white rounded-lg shadow p-6 border-t-4 border-blue-500">
                <h3 class="text-xl font-bold mb-4 text-gray-800">Startlistor</h3>
                <p class="text-gray-600 mb-4 text-sm">Generera startlistor för hela tävlingen eller per klass.</p>
                <div class="space-y-2">
                    <div class="grid grid-cols-1 gap-2">
                        <button class="bg-blue-100 hover:bg-blue-200 text-blue-800 font-semibold py-2 px-3 rounded text-sm text-left flex justify-between" onclick="window.reports_generateStartListPdf('dressage')">
                            <span>📄 Startlista Dressyr</span>
                            <span>➔</span>
                        </button>
                        <button class="bg-blue-100 hover:bg-blue-200 text-blue-800 font-semibold py-2 px-3 rounded text-sm text-left flex justify-between" onclick="window.reports_generateStartListPdf('marathon')">
                            <span>📄 Startlista Maraton</span>
                            <span>➔</span>
                        </button>
                        <button class="bg-blue-100 hover:bg-blue-200 text-blue-800 font-semibold py-2 px-3 rounded text-sm text-left flex justify-between" onclick="window.reports_generateStartListPdf('precision')">
                            <span>📄 Startlista Precision</span>
                            <span>➔</span>
                        </button>
                    </div>
                    <button class="w-full bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold py-2 px-4 rounded transition flex items-center justify-between" onclick="window.reports_generateStartListCsv()">
                        <span>📊 CSV Startlista (Grund)</span>
                        <span class="text-lg">➔</span>
                    </button>
                </div>
            </div>

            <!-- RESULT LISTS (DRESSAGE) -->
            <div class="bg-white rounded-lg shadow p-6 border-t-4 border-slate-500">
                <h3 class="text-xl font-bold mb-4 text-gray-800">Dressyr</h3>
                <p class="text-gray-600 mb-4 text-sm">Resultatlistor för dressyren.</p>
                <div class="space-y-2">
                    <button class="w-full bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold py-2 px-4 rounded transition flex items-center justify-between" onclick="window.reports_generateDressagePdf()">
                        <span>📄 PDF Resultat</span>
                        <span class="text-lg">➔</span>
                    </button>
                     <button class="w-full bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold py-2 px-4 rounded transition flex items-center justify-between" onclick="window.reports_generateDressageCsv()">
                        <span>📊 CSV Resultat</span>
                        <span class="text-lg">➔</span>
                    </button>
                </div>
            </div>

            <!-- RESULT LISTS (MARATHON) -->
            <div class="bg-white rounded-lg shadow p-6 border-t-4 border-emerald-500">
                <h3 class="text-xl font-bold mb-4 text-gray-800">Maraton</h3>
                <p class="text-gray-600 mb-4 text-sm">Resultat och tider för maraton.</p>
                <div class="space-y-2">
                    <button class="w-full bg-emerald-100 hover:bg-emerald-200 text-emerald-800 font-semibold py-2 px-4 rounded transition flex items-center justify-between" onclick="window.reports_generateMarathonPdf()">
                        <span>📄 PDF Resultat</span>
                        <span class="text-lg">➔</span>
                    </button>
                     <button class="w-full bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold py-2 px-4 rounded transition flex items-center justify-between" onclick="window.reports_generateMarathonCsv()">
                        <span>📊 CSV Resultat</span>
                        <span class="text-lg">➔</span>
                    </button>
                </div>
            </div>

            <!-- RESULT LISTS (PRECISION) -->
            <div class="bg-white rounded-lg shadow p-6 border-t-4 border-indigo-500">
                <h3 class="text-xl font-bold mb-4 text-gray-800">Precision</h3>
                <p class="text-gray-600 mb-4 text-sm">Resultatlistor för precision.</p>
                <div class="space-y-2">
                    <button class="w-full bg-indigo-100 hover:bg-indigo-200 text-indigo-800 font-semibold py-2 px-4 rounded transition flex items-center justify-between" onclick="window.reports_generatePrecisionPdf()">
                        <span>📄 PDF Resultat</span>
                        <span class="text-lg">➔</span>
                    </button>
                     <button class="w-full bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold py-2 px-4 rounded transition flex items-center justify-between" onclick="window.reports_generatePrecisionCsv()">
                        <span>📊 CSV Resultat</span>
                        <span class="text-lg">➔</span>
                    </button>
                </div>
            </div>

             <!-- TOTAL RESULTS -->
            <div class="bg-white rounded-lg shadow p-6 border-t-4 border-brand-gold md:col-span-2 lg:col-span-1">
                <h3 class="text-xl font-bold mb-4 text-gray-800">Totalresultat</h3>
                <p class="text-gray-600 mb-4 text-sm">Sammanställning av hela tävlingen.</p>
                <div class="space-y-2">
                    <button class="w-full bg-yellow-100 hover:bg-yellow-200 text-yellow-800 font-semibold py-2 px-4 rounded transition flex items-center justify-between" onclick="window.reports_generateTotalPdf()">
                        <span>📄 PDF Totalt</span>
                        <span class="text-lg">➔</span>
                    </button>
                     <button class="w-full bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold py-2 px-4 rounded transition flex items-center justify-between" onclick="window.reports_generateTotalCsv()">
                        <span>📊 CSV Totalt</span>
                        <span class="text-lg">➔</span>
                    </button>
                </div>
            </div>

        </div>
    </div>
    `;
}

// --- EXPORT HANDLERS ---

function getFilteredData() {
    const filterVal = document.getElementById('report-class-filter')?.value;
    if (!filterVal) return { eqs: equipages, rows: reportRows };
    return {
        eqs: equipages.filter(e => e.className === filterVal),
        rows: reportRows.filter(r => r.className === filterVal)
    };
}

function getHorseNames(eq) {
    if (!eq) return '';
    return (eq.horses || []).map(h => h.name).join(', ');
}

window.reports_generateStartListPdf = function (type) {
    const { eqs } = getFilteredData();
    if (!eqs || !eqs.length) { alert('Inga ekipage matchar urvalet.'); return; }

    // Map start times based on discipline type
    const rows = eqs.map(e => {
        const sn = String(e.startNumber);
        let time = null;
        if (startTimes && startTimes[sn]) {
            time = startTimes[sn][type]; // 'dressage', 'marathon', 'precision'
        }
        return {
            ...e,
            startTime: time // startListPdf uses this property
        };
    }).sort((a, b) => {
        // Sort by start time if available, else start number
        if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
        return (a.startNumber || 0) - (b.startNumber || 0);
    });

    generateStartListPdf(rows, type, getGlobalState('currentCompetition'), { viewMode: 'byclass' });
}

window.reports_generateStartListCsv = function () {
    const { eqs } = getFilteredData();
    if (!eqs || !eqs.length) { alert('Inga ekipage matchar urvalet.'); return; }
    const headers = ['StartNr', 'Kusk', 'Klass', 'Klubb', 'Hästar'];
    const rows = eqs.map(e => [
        e.startNumber,
        e.driverName,
        e.className,
        e.clubName,
        getHorseNames(e)
    ]);
    downloadCsv(`startlista_${competitionId}.csv`, headers, rows);
}

window.reports_generateDressagePdf = function () {
    const { eqs } = getFilteredData();
    if (!eqs || !eqs.length) { alert('Inga ekipage matchar urvalet.'); return; }
    generateDressagePdf(eqs, getGlobalState('currentCompetition'));
}

window.reports_generateDressageCsv = function () {
    const { rows: filteredRows } = getFilteredData();
    if (!filteredRows || !filteredRows.length) { alert('Inga resultat matchar urvalet.'); return; }
    const headers = ['StartNr', 'Kusk', 'Klass', 'Häst', 'Domare C', 'Domare R', 'Domare S', 'Straff', 'Procent'];
    const rows = filteredRows.map(r => {
        const d = r.dressage || {};
        return [
            r.startNumber,
            r.driverName,
            r.className,
            getHorseNames(r),
            '—', '—', '—',
            d.penalty !== null ? String(d.penalty).replace('.', ',') : (d.eliminated ? 'ELIM' : ''),
            d.percent !== null ? String(d.percent).replace('.', ',') + '%' : ''
        ];
    });
    downloadCsv(`dressyr_resultat_${competitionId}.csv`, headers, rows);
}

window.reports_generateMarathonPdf = function () {
    const { eqs } = getFilteredData();
    if (!eqs || !eqs.length) { alert('Inga ekipage matchar urvalet.'); return; }
    generateMarathonListPdf(eqs, getGlobalState('currentCompetition'));
}

window.reports_generateMarathonCsv = function () {
    const { rows: filteredRows } = getFilteredData();
    if (!filteredRows || !filteredRows.length) { alert('Inga resultat matchar urvalet.'); return; }
    const headers = ['StartNr', 'Kusk', 'Klass', 'Häst', 'Straff A', 'Straff B', 'Hinderstraff', 'Totalt'];
    const rows = filteredRows.map(r => {
        const m = r.marathon || {};
        return [
            r.startNumber,
            r.driverName,
            r.className,
            getHorseNames(r),
            m.stages?.A?.timePenalty !== undefined ? String(m.stages.A.timePenalty).replace('.', ',') : '',
            m.stages?.B?.timePenalty !== undefined ? String(m.stages.B.timePenalty).replace('.', ',') : '',
            m.obstacles?.sum !== undefined ? String(m.obstacles.sum).replace('.', ',') : '',
            m.totalPenalty !== null ? String(m.totalPenalty).replace('.', ',') : (m.eliminated ? 'ELIM' : '')
        ];
    });
    downloadCsv(`maraton_resultat_${competitionId}.csv`, headers, rows);
}

window.reports_generatePrecisionPdf = function () {
    const { eqs } = getFilteredData();
    if (!eqs || !eqs.length) { alert('Inga ekipage matchar urvalet.'); return; }
    generatePrecisionListPdf(eqs, precisionMap, precisionConfig, startTimes, getGlobalState('currentCompetition'));
}

window.reports_generatePrecisionCsv = function () {
    const { rows: filteredRows } = getFilteredData();
    if (!filteredRows || !filteredRows.length) { alert('Inga resultat matchar urvalet.'); return; }
    const headers = ['StartNr', 'Kusk', 'Klass', 'Häst', 'Tid', 'Tidsfel', 'Rivningar', 'Totalt'];
    const rows = filteredRows.map(r => {
        const p = r.precision || {};
        return [
            r.startNumber,
            r.driverName,
            r.className,
            getHorseNames(r),
            p.timeMs ? (p.timeMs / 1000).toFixed(2).replace('.', ',') : '',
            p.timePenalty !== undefined ? String(p.timePenalty).replace('.', ',') : '',
            p.knocksCount !== undefined ? p.knocksCount : '',
            p.totalPenalty !== null ? String(p.totalPenalty).replace('.', ',') : (p.eliminated ? 'ELIM' : '')
        ];
    });
    downloadCsv(`precision_resultat_${competitionId}.csv`, headers, rows);
}

window.reports_generateTotalPdf = function () {
    const { rows: filteredRows } = getFilteredData();
    if (!filteredRows || !filteredRows.length) { alert('Inga ekipage matchar urvalet.'); return; }
    generateTotalResultsPdf(filteredRows, getGlobalState('currentCompetition'), { viewMode: 'byclass' });
}

window.reports_generateTotalCsv = function () {
    const { rows: filteredRows } = getFilteredData();
    if (!filteredRows || !filteredRows.length) { alert('Inga resultat matchar urvalet.'); return; }
    const headers = ['Placering', 'StartNr', 'Kusk', 'Klass', 'Häst', 'Dressyr', 'Maraton', 'Precision', 'Totalt'];
    const rows = filteredRows.map((r, idx) => {
        return [
            idx + 1,
            r.startNumber,
            r.driverName,
            r.className,
            getHorseNames(r),
            r.dressage?.penalty !== undefined && r.dressage.penalty !== null ? String(r.dressage.penalty).replace('.', ',') : (r.dressage.eliminated ? 'ELIM' : ''),
            r.marathon?.totalPenalty !== undefined && r.marathon.totalPenalty !== null ? String(r.marathon.totalPenalty).replace('.', ',') : (r.marathon.eliminated ? 'ELIM' : ''),
            r.precision?.totalPenalty !== undefined && r.precision.totalPenalty !== null ? String(r.precision.totalPenalty).replace('.', ',') : (r.precision.eliminated ? 'ELIM' : ''),
            r.totalPenalty !== Infinity ? String(r.totalPenalty).replace('.', ',') : 'ELIM'
        ];
    });
    downloadCsv(`totalresultat_${competitionId}.csv`, headers, rows);
}
