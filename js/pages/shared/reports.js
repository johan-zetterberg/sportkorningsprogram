
import { getEquipages } from '../../services/equipageService.js';
import { getConfig } from '../../services/competitionService.js';
import { getDressageStatusCollection, getAllDressageProtocols } from '../../services/dressageService.js';
import { getMarathonTimingData, getMarathonResults, getMarathonStateDocuments } from '../../services/marathonService.js';
import { getPrecisionResults } from '../../services/precisionService.js';
import { getTeams } from '../../services/teamService.js';
import { getCompetitionHeader } from '../../ui/components.js';
import { getGlobalState } from '../../main.js';
import {
    downloadCsv,
    escapeHtml,
    isPrivileged,
    resolveCurrentCompId
} from '../../utils/sharedUtils.js';
import {
    formatMarathonExternalOtherPenalty,
    formatMarathonPenaltyExportValue,
    localizeCsvDecimal
} from '../../utils/marathonExportUtils.js';

import { generateStartListPdf } from '../../pdf/startListPdf.js';
import { generateDressagePdf, generateDressageListPdf, generateDressageOfficialsPdf } from '../../pdf/dressagePdf.js';
import { generateMarathonListPdf, generateMarathonFunctionaryPdf, generateMarathonObstaclePdf } from '../../pdf/marathonPdf.js';
import { generatePrecisionListPdf, generatePrecisionOfficialsPdf, generatePrecisionCourseSetupPdf } from '../../pdf/precisionPdf.js';
import { generateTotalResultsPdf } from '../../pdf/totalResultsPdf.js';
import { generateTeamResultsPdf } from '../../pdf/teamResultsPdf.js'; // [NEW]

import { calculateMarathonResult, setMarathonConfig, buildMergeMap, ensureMergeDecorations, prepareMarathonResults } from '../../utils/marathonUtils.js';
import { getCalculatedRowData, buildPlaceMap } from '../../utils/precisionUtils.js';
import { calculateTeamResults } from '../../services/teamCalculationService.js';
import { calculateDressageResult } from '../../services/calculationService.js'; // [NEW] // [NEW]
import {
    buildDressageCsvExport,
    buildMarathonCsvExport,
    filterReportData,
    formatReportCsvPenalty,
    formatReportCsvPercent,
    getReportClassOptions,
    getReportDisplayClass,
    getReportHorseNames
} from './reportsExportUtils.js';

// Global strings for CSV
const SEPARATOR = ';';

function finiteOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

let equipages = [];
let reportRows = []; // Enriched data for reports
let teams = []; // [NEW]
let processedTeams = []; // [NEW]
let competitionId = null;
let marathonConfig = null;
let precisionConfig = null;
let startTimes = null;
let precisionMap = new Map();
let marathonTimingMap = new Map();
let marathonStateMap = new Map();
let marathonObsMap = new Map();

async function safeReportFetch(label, promiseFactory, fallbackValue) {
    try {
        return await promiseFactory();
    } catch (error) {
        console.warn(`reports.js: kunde inte läsa ${label}`, error);
        return typeof fallbackValue === 'function' ? fallbackValue() : fallbackValue;
    }
}


export async function load() {
    competitionId = resolveCurrentCompId();
    if (!competitionId) {
        console.warn('reports.js: No competitionId found');
        return;
    }

    render(); // Initial render (loading state?)

    const eqs = await safeReportFetch('ekipage', () => getEquipages(competitionId), []);

    // 1. Fetch Configs & Data in parallel
    const [
        dStatus,
        mTiming, // Now a Map
        mState,  // [NEW] Manual state/times (Map)
        mObstacles, // Corrected: getMarathonResults returns obstacles array
        pResults,
        mCfg,
        pCfg,
        sTimes,
        compMeta, // Fetch fresh meta
        tms, // [NEW] Teams
        dProtocols // [NEW] Dressage Protocols
    ] = await Promise.all([
        safeReportFetch('dressyrstatus', () => getDressageStatusCollection(competitionId), []),
        safeReportFetch('maratontider', () => getMarathonTimingData(competitionId), () => new Map()),
        safeReportFetch('maratonstatus', () => getMarathonStateDocuments(competitionId), () => new Map()),
        safeReportFetch('maratonhinder', () => getMarathonResults(competitionId), []),
        safeReportFetch('precisionresultat', () => getPrecisionResults(competitionId), []),
        safeReportFetch('maratonkonfiguration', () => getConfig(competitionId, 'maratonConfig'), {}),
        safeReportFetch('precisionkonfiguration', () => getConfig(competitionId, 'precisionConfig'), {}),
        safeReportFetch('starttider', () => getConfig(competitionId, 'startTimes'), {}),
        safeReportFetch('tävlingsmetadata', () => getConfig(competitionId, 'competitionMeta'), {}),
        safeReportFetch('lag', () => getTeams(competitionId), []),
        safeReportFetch('dressyrprotokoll', () => getAllDressageProtocols(competitionId, eqs), () => new Map())
    ]);

    equipages = eqs;
    marathonConfig = mCfg?.value || mCfg || {};
    precisionConfig = pCfg?.value || pCfg || {};
    startTimes = sTimes?.times || {};
    teams = tms || [];
    const protocolMap = dProtocols instanceof Map ? dProtocols : new Map();

    // Update global state with fresh meta to ensure PDFs get it
    const currentComp = getGlobalState('currentCompetition');
    if (currentComp) {
        currentComp.meta = compMeta || {};
        // currentComp.showTeams is already set on the root object from getGlobalState
    }

    // Set global config for utils
    setMarathonConfig(marathonConfig);
    buildMergeMap(marathonConfig); // [NEW] Init merge logic

    // --- PREPARE DATA ---
    // We need to build "reportRows" similar to how total-resultat.js does it.

    // --- PREPARE DATA ---

    // 1. Prepare Maps
    precisionMap = new Map();
    pResults.forEach(p => precisionMap.set(String(p.startNumber || p.id), p));
    const precisionPlaceMap = buildPlaceMap(equipages, precisionMap, precisionConfig); // Build properly once

    marathonObsMap = new Map(); // sn -> [obstacles]
    mObstacles.forEach(r => {
        const sn = String(r.equipageId);
        if (!marathonObsMap.has(sn)) marathonObsMap.set(sn, []);
        marathonObsMap.get(sn).push(r);
    });

    // 2. Build Report Rows
    // mTiming and mState are already Maps
    marathonTimingMap = mTiming instanceof Map ? mTiming : new Map();
    marathonStateMap = mState instanceof Map ? mState : new Map();
    reportRows = equipages.map(eq => {
        const sn = String(eq.startNumber);

        // --- DRESSAGE ---
        // Calculate from fetched protocols
        const protos = protocolMap.get(sn) || [];
        const dCalc = calculateDressageResult(eq, protos);
        const dressageJudges = {};
        protos.forEach((proto) => {
            if (!proto || proto.id === 'general') return;
            const id = String(proto.judgeId || proto.id || '').replace(/^judge_/i, '').trim();
            const position = String(proto.position || proto.judgePosition || '').trim().toUpperCase();
            if (!id && !position) return;
            const key = id || position;
            const singleJudgeResult = calculateDressageResult({ ...eq, errorPoints: 0 }, [proto]);
            dressageJudges[key] = {
                id,
                name: proto.judgeName || proto.name || id || position,
                position,
                movements: Array.isArray(proto.movements) ? proto.movements : [],
                totalPoints: Number.isFinite(singleJudgeResult?.points) ? singleJudgeResult.points : finiteOrNull(proto.totalPoints ?? proto.points),
                percent: Number.isFinite(singleJudgeResult?.percent) ? singleJudgeResult.percent : finiteOrNull(proto.percent),
                penalty: Number.isFinite(singleJudgeResult?.penalty) ? singleJudgeResult.penalty : finiteOrNull(proto.penalty),
                eliminated: !!proto.eliminated
            };
        });

        // We can also look at status for "live" info, but result comes from protos
        const dSt = dStatus.find(d => d.id === sn);

        const dressageRes = {
            ...dCalc,
            judges: dressageJudges,
            // Ensure compatibility with UI/PDF
            totalPenalty: dCalc.penalty,
            totalPercent: dCalc.percent,
            points: dCalc.points,
            finalized: dSt?.state === 'finished' || !!dCalc.penalty, // Approximate
            eliminated: !!dCalc.eliminated
        };

        // --- MARATHON ---
        // --- MARATHON ---
        const t = marathonTimingMap.get(sn) || {};
        const state = marathonStateMap.get(sn) || {};
        const obs = marathonObsMap.get(sn) || [];

        // Merge state (manual times/phases) with obstacles
        const mDoc = {
            ...state,
            obstacles: obs,
            eliminated: state.eliminated || obs.some(o => o.eliminated)
        };
        // Calculate!
        const mCalc = calculateMarathonResult(eq, mDoc, t);

        // --- PRECISION ---
        // getCalculatedRowData(sn, placeMap, equipages, precisionMap, config, startTimes)
        const pCalc = getCalculatedRowData(sn, precisionPlaceMap, equipages, precisionMap, precisionConfig, startTimes);

        // --- TOTAL ---
        let totalPenalty = null;
        let isEliminated = false;

        // All three disciplines must have a result for a valid total
        const hasD = (dressageRes.penalty !== null && !dressageRes.eliminated);
        const hasM = (mCalc.totalPenalty !== null && mCalc.totalPenalty !== Infinity && !mCalc.eliminated);
        const hasP = (pCalc.totalPenalty !== null && pCalc.totalPenalty !== Infinity && !pCalc.eliminated);

        if (hasD && hasM && hasP) {
            totalPenalty = Number(dressageRes.penalty) + mCalc.totalPenalty + pCalc.totalPenalty;
        } else {
            totalPenalty = null;
        }

        if (dressageRes.eliminated || mCalc.eliminated || pCalc.eliminated || mCalc.totalPenalty === Infinity || pCalc.totalPenalty === Infinity) {
            isEliminated = true;
            totalPenalty = Infinity;
        }

        // Attach to Equipage (Mutate for PDF libs)
        eq.results = eq.results || {};
        eq.results.dressage = dressageRes;
        eq.results.marathon = mCalc; // Attach the full calc object
        eq.results.precision = pCalc;

        // Return enriched row
        return {
            ...eq,
            startTime: startTimes?.[sn]?.dressage || startTimes?.[sn]?.dressyr || eq.startTime || null,
            judges: dressageJudges,
            avgPercent: dressageRes.percent,
            finalPenalty: dressageRes.penalty,
            errorPoints: dressageRes.errorPoints,
            dressage: dressageRes,
            marathon: mCalc,
            precision: pCalc,
            totalPenalty: isEliminated ? Infinity : totalPenalty,
            isEliminated
        };
    });

    // Validates and decorates with _mergedKey/_mergedLabel for marathon grouping
    reportRows = ensureMergeDecorations(reportRows);

    // Sort by class then total penalty (default view)
    reportRows.sort((a, b) => {
        const c = (a.className || '').localeCompare(b.className || '');
        if (c !== 0) return c;
        if (a.isEliminated && !b.isEliminated) return 1;
        if (!a.isEliminated && b.isEliminated) return -1;

        if (a.totalPenalty === null && b.totalPenalty === null) return 0;
        if (a.totalPenalty === null) return 1;
        if (b.totalPenalty === null) return -1;

        return (a.totalPenalty - b.totalPenalty);
    });

    // [NEW] Calculate Team Results if enabled
    if (currentComp?.showTeams) {
        processedTeams = calculateTeamResults(teams, reportRows);
    }

    render();
}

function render() {
    const page = document.getElementById('page-reports');
    if (!page) return;

    const competition = getGlobalState('currentCompetition');
    const loading = !equipages || !equipages.length;

    // Extract unique classes
    const uniqueClasses = getReportClassOptions(reportRows.length ? reportRows : equipages);

    page.innerHTML = `
    <div class="container mx-auto p-3 sm:p-4 md:p-8">
        ${getCompetitionHeader(competition, 'Rapportcenter')}
        
        ${loading ? '<p class="text-center mt-8 text-gray-500 animate-pulse">Laddar data...</p>' : ''}

        <div class="${loading ? 'opacity-50 pointer-events-none' : ''}">
            <!-- FILTER TOOLBAR -->
            <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-3 sm:p-4 mb-6 flex flex-col items-stretch gap-3 transition-colors sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
                <label class="font-bold text-sm sm:text-base text-gray-700 dark:text-gray-300">Filtrera på klass:</label>
                <select id="report-class-filter" class="border dark:border-gray-600 rounded p-2 w-full sm:w-auto min-w-0 sm:min-w-[200px] bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                    <option value="">Alla klasser</option>
                    ${uniqueClasses.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
                </select>
                <div class="w-full text-xs sm:w-auto sm:ml-auto sm:text-sm text-gray-500 italic">
                    Valt urval påverkar alla rapporter nedan.
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4 md:gap-6">
            
            <!-- START LISTS -->
            <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-4 md:p-6 border-t-4 border-blue-500 dark:border-blue-400">
                <h3 class="text-xl font-bold mb-4 text-gray-800 dark:text-white">Startlistor</h3>
                <p class="text-gray-600 dark:text-gray-400 mb-4 text-sm">Generera startlistor för hela tävlingen eller per klass.</p>
                <div class="space-y-2">
                    <div class="grid grid-cols-1 gap-2">
                        <button class="w-full bg-blue-100 hover:bg-blue-200 text-blue-800 font-semibold py-2 px-3 rounded text-sm text-left flex items-center justify-between gap-3" onclick="window.reports_generateStartListPdf('dressage')">
                            <span>📄 Startlista Dressyr</span>
                            <span>➔</span>
                        </button>
                        <button class="w-full bg-blue-100 hover:bg-blue-200 text-blue-800 font-semibold py-2 px-3 rounded text-sm text-left flex items-center justify-between gap-3" onclick="window.reports_generateStartListPdf('marathon')">
                            <span>📄 Startlista Maraton</span>
                            <span>➔</span>
                        </button>
                        <button class="w-full bg-blue-100 hover:bg-blue-200 text-blue-800 font-semibold py-2 px-3 rounded text-sm text-left flex items-center justify-between gap-3" onclick="window.reports_generateStartListPdf('precision')">
                            <span>📄 Startlista Precision</span>
                            <span>➔</span>
                        </button>
                    </div>
                    <button class="w-full bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold py-2 px-4 rounded transition flex items-center justify-between gap-3 text-left" onclick="window.reports_generateStartListCsv()">
                        <span>📊 CSV Startlista (Grund)</span>
                        <span class="text-lg">➔</span>
                    </button>
                </div>
            </div>

            <!-- RESULT LISTS (DRESSAGE) -->
            <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-4 md:p-6 border-t-4 border-slate-500 dark:border-slate-400">
                <h3 class="text-xl font-bold mb-4 text-gray-800 dark:text-white">Dressyr</h3>
                <p class="text-gray-600 dark:text-gray-400 mb-4 text-sm">Resultatlistor för dressyren.</p>
                <div class="space-y-2">
                    <button class="w-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-100 font-semibold py-2 px-4 rounded transition flex items-center justify-between gap-3 text-left" onclick="window.reports_generateDressagePdf()">
                        <span>📄 PDF Resultat</span>
                        <span class="text-lg">➔</span>
                    </button>
                    <button class="w-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-100 font-semibold py-2 px-4 rounded transition flex items-center justify-between gap-3 text-left" onclick="window.reports_generateDressageOfficialsPdf()">
                        <span>📄 Funktionärslista (Tider)</span>
                        <span class="text-lg">➔</span>
                    </button>
                     <button class="w-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-semibold py-2 px-4 rounded transition flex items-center justify-between gap-3 text-left" onclick="window.reports_generateDressageCsv()">
                        <span>📊 CSV Resultat</span>
                        <span class="text-lg">➔</span>
                    </button>
                </div>
            </div>

            <!-- RESULT LISTS (MARATHON) -->
            <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-4 md:p-6 border-t-4 border-emerald-500 dark:border-emerald-400">
                <h3 class="text-xl font-bold mb-4 text-gray-800 dark:text-white">Maraton</h3>
                <p class="text-gray-600 dark:text-gray-400 mb-4 text-sm">Resultat och tider för maraton.</p>
                <div class="space-y-2">
                    <button class="w-full bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:hover:bg-emerald-800/50 text-emerald-800 dark:text-emerald-100 font-semibold py-2 px-4 rounded transition flex items-center justify-between gap-3 text-left" onclick="window.reports_generateMarathonPdf()">
                        <span>📄 PDF Resultat</span>
                        <span class="text-lg">➔</span>
                    </button>
                    <!-- NYA FUNKTIONÄRSLISTOR -->
                    <button class="w-full bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:hover:bg-emerald-800/50 text-emerald-800 dark:text-emerald-100 font-semibold py-2 px-4 rounded transition flex items-center justify-between gap-3 text-left" onclick="window.reports_generateMarathonFunctionaryPdf()">
                        <span>📄 Funktionärslista (Tider)</span>
                        <span class="text-lg">➔</span>
                    </button>
                    <button class="w-full bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:hover:bg-emerald-800/50 text-emerald-800 dark:text-emerald-100 font-semibold py-2 px-4 rounded transition flex items-center justify-between gap-3 text-left" onclick="window.reports_generateMarathonObstaclePdf()">
                        <span>📄 Funktionärslista (Hinder)</span>
                        <span class="text-lg">➔</span>
                    </button>
                     <button class="w-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-semibold py-2 px-4 rounded transition flex items-center justify-between gap-3 text-left" onclick="window.reports_generateMarathonCsv()">
                        <span>📊 CSV Resultat</span>
                        <span class="text-lg">➔</span>
                    </button>
                </div>
            </div>

            <!-- RESULT LISTS (PRECISION) -->
            <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-4 md:p-6 border-t-4 border-indigo-500 dark:border-indigo-400">
                <h3 class="text-xl font-bold mb-4 text-gray-800 dark:text-white">Precision</h3>
                <p class="text-gray-600 dark:text-gray-400 mb-4 text-sm">Resultatlistor för precision.</p>
                <div class="space-y-2">
                    <button class="w-full bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-900/30 dark:hover:bg-indigo-800/50 text-indigo-800 dark:text-indigo-100 font-semibold py-2 px-4 rounded transition flex items-center justify-between gap-3 text-left" onclick="window.reports_generatePrecisionPdf()">
                        <span>📄 PDF Resultat</span>
                        <span class="text-lg">➔</span>
                    </button>
                    <button class="w-full bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-900/30 dark:hover:bg-indigo-800/50 text-indigo-800 dark:text-indigo-100 font-semibold py-2 px-4 rounded transition flex items-center justify-between gap-3 text-left" onclick="window.reports_generatePrecisionOfficialsPdf()">
                        <span>📄 Funktionärslista (Bana)</span>
                        <span class="text-lg">➔</span>
                    </button>
                    <button class="w-full bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-900/30 dark:hover:bg-indigo-800/50 text-indigo-800 dark:text-indigo-100 font-semibold py-2 px-4 rounded transition flex items-center justify-between gap-3 text-left" onclick="window.reports_generatePrecisionCourseSetupPdf()">
                        <span>📐 Banlayout & portar (PDF)</span>
                        <span class="text-lg">➔</span>
                    </button>
                     <button class="w-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-semibold py-2 px-4 rounded transition flex items-center justify-between gap-3 text-left" onclick="window.reports_generatePrecisionCsv()">
                        <span>📊 CSV Resultat</span>
                        <span class="text-lg">➔</span>
                    </button>
                </div>
            </div>

             <!-- TOTAL RESULTS -->
            <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-4 md:p-6 border-t-4 border-brand-gold dark:border-brand-gold md:col-span-2 lg:col-span-1">
                <h3 class="text-xl font-bold mb-4 text-gray-800 dark:text-white">Totalresultat</h3>
                <p class="text-gray-600 dark:text-gray-400 mb-4 text-sm">Sammanställning av hela tävlingen.</p>
                <div class="space-y-2">
                    <button class="w-full bg-yellow-100 hover:bg-yellow-200 dark:bg-yellow-900/30 dark:hover:bg-yellow-800/50 text-yellow-800 dark:text-yellow-100 font-semibold py-2 px-4 rounded transition flex items-center justify-between gap-3 text-left" onclick="window.reports_generateTotalPdf()">
                        <span>📄 PDF Totalt</span>
                        <span class="text-lg">➔</span>
                    </button>
                     <button class="w-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-semibold py-2 px-4 rounded transition flex items-center justify-between gap-3 text-left" onclick="window.reports_generateTotalCsv()">
                        <span>📊 CSV Totalt</span>
                        <span class="text-lg">➔</span>
                    </button>
                </div>
            </div>

            <!-- TEAM RESULTS -->
            ${competition.showTeams ? `
            <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-4 md:p-6 border-t-4 border-purple-500 dark:border-purple-400 md:col-span-2 lg:col-span-1">
                <h3 class="text-xl font-bold mb-4 text-gray-800 dark:text-white">Lagresultat</h3>
                <p class="text-gray-600 dark:text-gray-400 mb-4 text-sm">Resultat för lagtävlingen.</p>
                <div class="space-y-2">
                    <button class="w-full bg-purple-100 hover:bg-purple-200 dark:bg-purple-900/30 dark:hover:bg-purple-800/50 text-purple-800 dark:text-purple-100 font-semibold py-2 px-4 rounded transition flex items-center justify-between gap-3 text-left" onclick="window.reports_generateTeamPdf()">
                        <span>📄 PDF Lag</span>
                        <span class="text-lg">➔</span>
                    </button>
                     <button class="w-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-semibold py-2 px-4 rounded transition flex items-center justify-between gap-3 text-left" onclick="window.reports_generateTeamCsv()">
                        <span>📊 CSV Lag</span>
                        <span class="text-lg">➔</span>
                    </button>
                </div>
            </div>
            ` : ''}

        </div>
    </div>
    `;
}

// --- EXPORT HANDLERS ---

function getFilteredData() {
    const filterVal = document.getElementById('report-class-filter')?.value;
    return filterReportData({ rows: reportRows, equipages, filterClass: filterVal });
}

function getHorseNames(eq) {
    return getReportHorseNames(eq);
}

function compareReportDisplayClass(a, b) {
    return String(getReportDisplayClass(a) || '').localeCompare(
        String(getReportDisplayClass(b) || ''),
        'sv',
        { numeric: true, sensitivity: 'base' }
    );
}

function sortRowsForDressageReportPdf(rows = []) {
    return [...rows].sort((a, b) => {
        const classCompare = compareReportDisplayClass(a, b);
        if (classCompare !== 0) return classCompare;

        const aPenalty = Number(a.finalPenalty ?? a.dressage?.penalty ?? a.dressage?.totalPenalty);
        const bPenalty = Number(b.finalPenalty ?? b.dressage?.penalty ?? b.dressage?.totalPenalty);
        const aHasPenalty = Number.isFinite(aPenalty);
        const bHasPenalty = Number.isFinite(bPenalty);
        if (aHasPenalty && bHasPenalty && aPenalty !== bPenalty) return aPenalty - bPenalty;
        if (aHasPenalty !== bHasPenalty) return aHasPenalty ? -1 : 1;

        return (Number(a.startNumber) || 0) - (Number(b.startNumber) || 0);
    });
}

function applyDressagePlacementsForReportPdf(rows = []) {
    const grouped = new Map();
    rows.forEach((row) => {
        const key = getReportDisplayClass(row) || row.className || '';
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(row);
    });

    const placementByStart = new Map();
    grouped.forEach((classRows) => {
        const rankedRows = classRows
            .filter(row => {
                const penalty = Number(row.finalPenalty ?? row.dressage?.penalty ?? row.dressage?.totalPenalty);
                const eliminated = !!(row.eliminated || row.dressage?.eliminated || row.results?.dressage?.eliminated);
                return Number.isFinite(penalty) && !eliminated;
            })
            .sort((a, b) => {
                const pa = Number(a.finalPenalty ?? a.dressage?.penalty ?? a.dressage?.totalPenalty);
                const pb = Number(b.finalPenalty ?? b.dressage?.penalty ?? b.dressage?.totalPenalty);
                if (pa !== pb) return pa - pb;
                return (Number(a.startNumber) || 0) - (Number(b.startNumber) || 0);
            });

        let place = 0;
        let previousPenalty = null;
        rankedRows.forEach((row, index) => {
            const penalty = Number(row.finalPenalty ?? row.dressage?.penalty ?? row.dressage?.totalPenalty);
            if (previousPenalty == null || Math.abs(penalty - previousPenalty) > 0.0001) {
                place = index + 1;
            }
            placementByStart.set(String(row.startNumber), place);
            previousPenalty = penalty;
        });
    });

    return rows.map(row => ({
        ...row,
        plac: placementByStart.get(String(row.startNumber)) ?? row.plac ?? ''
    }));
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
        getReportDisplayClass(e),
        e.clubName,
        getHorseNames(e)
    ]);
    downloadCsv(`startlista_${competitionId}.csv`, headers, rows);
}

window.reports_generateDressagePdf = function () {
    const { eqs, rows: enrichedRows } = getFilteredData();
    if (!enrichedRows || !enrichedRows.length) { alert('Inga ekipage matchar urvalet.'); return; }
    const sortedRows = applyDressagePlacementsForReportPdf(sortRowsForDressageReportPdf(enrichedRows));

    // 1. Extract current filter class name for title
    const filterVal = document.getElementById('report-class-filter')?.value || 'Alla klasser';

    // 2. Derive Judges List dynamically from the data
    const judgeMap = new Map();
    // Scan all rows to find all judges that have scored
    sortedRows.forEach(r => {
        if (r.dressage && r.dressage.judges) {
            Object.values(r.dressage.judges).forEach(j => {
                if (j.id && j.position) {
                    judgeMap.set(`${j.position}:${j.id}`, { position: j.position, name: j.name || j.id, id: j.id });
                }
            });
        }
    });
    // Convert to array and Sort C, R, S, V, P or C, E, B, M, H
    const sortOrder = { 'C': 1, 'R': 2, 'S': 3, 'V': 4, 'P': 5, 'E': 2, 'B': 3, 'M': 4, 'H': 5 };
    const judgesList = Array.from(judgeMap.values()).sort((a, b) => (sortOrder[a.position] || 99) - (sortOrder[b.position] || 99));

    // 3. Call Generator
    generateDressageListPdf(sortedRows, filterVal, getGlobalState('currentCompetition'), judgesList);
}

window.reports_generateDressageCsv = function () {
    const { rows: filteredDressageRows } = getFilteredData();
    if (filteredDressageRows && filteredDressageRows.length) {
        const csvExport = buildDressageCsvExport(filteredDressageRows, {
            filename: `dressyr_resultat_${competitionId}.csv`
        });
        downloadCsv(csvExport.filename, csvExport.headers, csvExport.rows);
        return;
    }
    const { rows: filteredRows } = getFilteredData();
    if (!filteredRows || !filteredRows.length) { alert('Inga resultat matchar urvalet.'); return; }
    const headers = ['StartNr', 'Kusk', 'Klass', 'Häst', 'Domare C', 'Domare R', 'Domare S', 'Straff', 'Procent'];
    const rows = filteredRows.map(r => {
        const d = r.dressage || {};
        return [
            r.startNumber,
            r.driverName,
            getReportDisplayClass(r),
            getHorseNames(r),
            '—', '—', '—',
            formatReportCsvPenalty(d.penalty, { eliminated: d.eliminated }),
            formatReportCsvPercent(d.percent, { eliminated: d.eliminated })
        ];
    });
    downloadCsv(`dressyr_resultat_${competitionId}.csv`, headers, rows);
}

window.reports_generateDressageOfficialsPdf = function () {
    const { eqs } = getFilteredData();
    if (!eqs || !eqs.length) { alert('Inga ekipage matchar urvalet.'); return; }
    generateDressageOfficialsPdf(eqs, startTimes, getGlobalState('currentCompetition'));
}

window.reports_generateMarathonPdf = function () {
    const { eqs } = getFilteredData();
    if (!eqs || !eqs.length) { alert('Inga ekipage matchar urvalet.'); return; }

    // Use centralized logic
    const printableList = prepareMarathonResults(eqs, marathonConfig, {
        timingMap: marathonTimingMap,
        stateMap: marathonStateMap,
        obstaclesMap: marathonObsMap
    });

    // Sort
    printableList.sort((a, b) => {
        const pa = a.place ?? 9999;
        const pb = b.place ?? 9999;
        if (pa !== pb) return pa - pb;
        return (a.startNumber || 0) - (b.startNumber || 0);
    });

    generateMarathonListPdf(printableList, getGlobalState('currentCompetition'));
}



window.reports_generateMarathonFunctionaryPdf = function () {
    const { eqs } = getFilteredData();
    if (!eqs || !eqs.length) { alert('Inga ekipage matchar urvalet.'); return; }
    generateMarathonFunctionaryPdf(eqs, marathonConfig, startTimes, getGlobalState('currentCompetition'));
}

window.reports_generateMarathonObstaclePdf = function () {
    const { eqs } = getFilteredData();
    if (!eqs || !eqs.length) { alert('Inga ekipage matchar urvalet.'); return; }
    generateMarathonObstaclePdf(eqs, marathonConfig, startTimes, getGlobalState('currentCompetition'));
}

window.reports_generateMarathonCsv = function () {
    const { eqs } = getFilteredData();
    if (eqs && eqs.length) {
        const printableList = prepareMarathonResults(eqs, marathonConfig, {
            timingMap: marathonTimingMap,
            stateMap: marathonStateMap,
            obstaclesMap: marathonObsMap
        });
        const exportRows = printableList.map((row) => {
            const sn = String(row.startNumber);
            const stateDoc = marathonStateMap.get(sn) || {};
            const rawObstacleItems = marathonObsMap.get(sn) || (Array.isArray(stateDoc.obstacles) ? stateDoc.obstacles : []);
            return {
                ...row,
                _csvObstacleItems: rawObstacleItems
            };
        });
        const maxObstacleCount = exportRows.reduce((max, row) => {
            const items = Array.isArray(row._csvObstacleItems) ? row._csvObstacleItems : [];
            const rowMax = items.reduce((innerMax, obstacle) => {
                const number = Number(obstacle?.number ?? obstacle?.obstacleNumber ?? obstacle?.nr ?? obstacle?.hinderNr);
                return Number.isFinite(number) && number > innerMax ? number : innerMax;
            }, 0);
            return rowMax > max ? rowMax : max;
        }, 0);
        const csvExport = buildMarathonCsvExport(exportRows, {
            filename: `maraton_resultat_${competitionId}.csv`,
            maxObstacleCount
        });
        downloadCsv(csvExport.filename, csvExport.headers, csvExport.rows);
        return;
    }
    const { rows: filteredRows } = getFilteredData();
    if (!filteredRows || !filteredRows.length) { alert('Inga resultat matchar urvalet.'); return; }
    const headers = ['StartNr', 'Kusk', 'Klass', 'Häst', 'Straff A', 'Straff T', 'Straff B', 'Hinderstraff', 'Övrigt', 'Totalt'];
    const rows = filteredRows.map(r => {
        const m = r.marathon || {};
        return [
            r.startNumber,
            r.driverName,
            getReportDisplayClass(r),
            getHorseNames(r),
            localizeCsvDecimal(formatMarathonPenaltyExportValue(m.stages?.A?.timePenalty, { equipage: r, marathonResult: m.stages?.A, empty: '' })),
            localizeCsvDecimal(formatMarathonPenaltyExportValue(m.stages?.transport?.timePenalty, { equipage: r, marathonResult: m.stages?.transport, empty: '' })),
            localizeCsvDecimal(formatMarathonPenaltyExportValue(m.stages?.B?.timePenalty, { equipage: r, marathonResult: m.stages?.B, empty: '' })),
            localizeCsvDecimal(formatMarathonPenaltyExportValue(m.obstacles?.sum, { equipage: r, marathonResult: m, empty: '' })),
            localizeCsvDecimal(formatMarathonExternalOtherPenalty(m, { equipage: r, empty: '' })),
            localizeCsvDecimal(formatMarathonPenaltyExportValue(m.totalPenalty, { equipage: r, marathonResult: m, empty: '' }))
        ];
    });
    downloadCsv(`maraton_resultat_${competitionId}.csv`, headers, rows);
}

window.reports_generatePrecisionPdf = function () {
    const { eqs } = getFilteredData();
    if (!eqs || !eqs.length) { alert('Inga ekipage matchar urvalet.'); return; }
    generatePrecisionListPdf(eqs, precisionMap, precisionConfig, startTimes, getGlobalState('currentCompetition'));
}

window.reports_generatePrecisionOfficialsPdf = function () {
    const { eqs } = getFilteredData();
    if (!eqs || !eqs.length) { alert('Inga ekipage matchar urvalet.'); return; }
    generatePrecisionOfficialsPdf(eqs, precisionConfig, startTimes, getGlobalState('currentCompetition'));
}

window.reports_generatePrecisionCourseSetupPdf = function () {
    const { eqs } = getFilteredData();
    generatePrecisionCourseSetupPdf(precisionConfig, eqs, getGlobalState('currentCompetition'));
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
            getReportDisplayClass(r),
            getHorseNames(r),
            p.timeMs ? (p.timeMs / 1000).toFixed(2).replace('.', ',') : '',
            formatReportCsvPenalty(p.timePenalty, { eliminated: p.eliminated }),
            p.knocksCount !== undefined ? p.knocksCount : '',
            formatReportCsvPenalty(p.totalPenalty, { eliminated: p.eliminated })
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
            r.isEliminated || r.totalPenalty == null ? '' : idx + 1,
            r.startNumber,
            r.driverName,
            getReportDisplayClass(r),
            getHorseNames(r),
            formatReportCsvPenalty(r.dressage?.penalty, { eliminated: r.dressage?.eliminated }),
            formatReportCsvPenalty(r.marathon?.totalPenalty, { eliminated: r.marathon?.eliminated }),
            formatReportCsvPenalty(r.precision?.totalPenalty, { eliminated: r.precision?.eliminated }),
            formatReportCsvPenalty(r.totalPenalty, { eliminated: r.isEliminated })
        ];
    });
    downloadCsv(`totalresultat_${competitionId}.csv`, headers, rows);
}

window.reports_generateTeamPdf = function () {
    if (!processedTeams || !processedTeams.length) { alert('Inga lagresultat tillgängliga.'); return; }
    generateTeamResultsPdf(processedTeams, getGlobalState('currentCompetition'));
}

window.reports_generateTeamCsv = function () {
    if (!processedTeams || !processedTeams.length) { alert('Inga lagresultat tillgängliga.'); return; }

    // Long format: One row per member, grouped by team
    const headers = [
        'Placering',
        'Lagnamn',
        'Lagtotal',
        'Kusk',
        'StartNr',
        'Dressyr',
        'Marathon',
        'Precision',
        'Totalt',
        'Räknas i laget'
    ];

    const rows = [];

    processedTeams.forEach(t => {
        const rank = t.rank || (t.isEliminated ? 'ELIM' : '-');
        const teamTotal = formatReportCsvPenalty(t.total, { eliminated: t.isEliminated, empty: '-' });

        // 1. Team Header Row (Optional, maybe just fill all member rows with team data)
        // Let's fill all member rows with team data for easy filtering/sorting

        t.members.forEach(m => {
            rows.push([
                rank,
                t.teamName,
                teamTotal,
                m.name,
                m.startNumber,
                formatReportCsvPenalty(m.dressage, { eliminated: m.eliminated, empty: '-' }),
                formatReportCsvPenalty(m.marathon, { eliminated: m.eliminated, empty: '-' }),
                formatReportCsvPenalty(m.precision, { eliminated: m.eliminated, empty: '-' }),
                formatReportCsvPenalty(m.penalty, { eliminated: m.eliminated, empty: '-' }),
                m.isCounting ? 'Ja' : 'Nej' // "Struken" score
            ]);
        });

        // Add an empty row between teams for readability? 
        // No, standard CSV usually prefers clean data.
    });

    downloadCsv(`lagresultat_${competitionId}.csv`, headers, rows);
}
