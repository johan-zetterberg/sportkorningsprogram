import { getCompetitionHeader, renderResponsiveClassFilter } from '../../ui/components.js';

const MOBILE_BP = 500;

export function injectMaratonTableStyles() {
  if (document.getElementById('maraton-table-styles')) return;
  const s = document.createElement('style');
  s.id = 'maraton-table-styles';
  s.textContent = `
    .pr-table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
    }
    .pr-table th,
    .pr-table td {
      white-space: nowrap;
      vertical-align: middle;
      border-bottom: 1px solid #e5e7eb;
    }
    .pr-table thead th {
      position: sticky;
      top: 0;
      z-index: 20;
      background: #f9fafb;
      box-shadow: 0 1px 0 rgba(0,0,0,0.04);
    }
    .sticky-col-start {
      position: sticky;
      left: 0;
      z-index: 15;
      min-width: 48px;
      max-width: 60px;
    }
    .sticky-col-driver {
      position: sticky;
      left: 48px;
      z-index: 14;
      min-width: 180px;
      max-width: 220px;
    }
    thead .sticky-col-start,
    thead .sticky-col-driver {
      z-index: 30;
    }
    .bg-white .sticky-col-start, .bg-white .sticky-col-driver { background-color: #ffffff; }
    .bg-gray-50 .sticky-col-start, .bg-gray-50 .sticky-col-driver { background-color: #f9fafb; }
    .bg-red-50 .sticky-col-start, .bg-red-50 .sticky-col-driver { background-color: #fef2f2; }
    .bg-yellow-50 .sticky-col-start, .bg-yellow-50 .sticky-col-driver { background-color: #fffbeb; }

    #marathon-x-wrap {
      width: 100%;
      overflow-x: auto;
      background: #fff;
    }
    html.dark #marathon-x-wrap {
      background: #111827;
    }
    html.dark .pr-table thead th {
      background: #1f2937;
      border-bottom-color: #374151;
      color: #f3f4f6;
    }
    html.dark .pr-table tbody td {
      border-bottom-color: #374151;
      color: #e5e7eb;
    }
    html.dark .bg-white .sticky-col-start, html.dark .bg-white .sticky-col-driver { background-color: #1f2937; }
    html.dark .bg-gray-50 .sticky-col-start, html.dark .bg-gray-50 .sticky-col-driver { background-color: #374151; }
    html.dark .bg-red-50 .sticky-col-start, html.dark .bg-red-50 .sticky-col-driver { background-color: #7f1d1d; }

    .w-max { width: max-content; }
    .min-w-max { min-width: max-content; }

    #marathon-x-wrap > table.pr-table { display: none; }
    #marathonCards { display: grid; }

    @media (min-width: ${MOBILE_BP}px), (orientation: landscape) and (hover: none) {
      #marathon-x-wrap > table.pr-table { display: table; }
      #marathonCards { display: none; }
    }
  `;
  document.head.appendChild(s);
}

export function renderActiveMerges({
  mergeGroups,
  equipages
}) {
  const host = document.getElementById('activeMerges');
  if (!host) return;

  if (!Array.isArray(mergeGroups) || mergeGroups.length === 0) {
    host.innerHTML = '';
    return;
  }

  const chips = mergeGroups.map(g => {
    const lbl = g.label || `TDB #${(g.members || []).join('/')}`;
    const count = equipages.filter(e =>
      Number.isFinite(Number(e.tdbClassNumber)) && g.members.includes(Number(e.tdbClassNumber))
    ).length;

    return `
      <span class="inline-flex items-center gap-2 px-2 py-1 rounded-full
                  bg-blue-50 border border-blue-200 text-blue-700">
        ${lbl}
        <span class="text-xs text-blue-600">(${count} ekipage)</span>
      </span>`;
  }).join('');

  host.innerHTML = `
    <div class="flex flex-wrap items-center gap-2 text-sm">
      <span class="font-semibold text-gray-700">Aktiva sammanslagningar:</span>
      ${chips}
    </div>`;
}

export function renderMaratonClassChips({
  equipages,
  activeClassFilters,
  onChange
}) {
  const chipHost = document.getElementById('maratonClassChips');
  if (!chipHost) return;

  const labels = [...new Set(equipages.map(e => e._mergedLabel || e.className || '\u2014'))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'sv'));

  renderResponsiveClassFilter(chipHost, labels, activeClassFilters, onChange);
}

export function ensureMarathonResultShell({
  currentCompetition,
  translate,
  wireControls,
  searchQuery
}) {
  const root = document.getElementById('page-maraton-results');
  if (!root) return false;
  const shellId = 'maraton-results-shell';
  if (document.getElementById(shellId)) return true;

  const t = translate;
  root.innerHTML = `
        <div id="${shellId}" class="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8 py-8 min-h-screen dark:bg-gray-900 transition-colors duration-500">
          <div class="mb-8">
             ${getCompetitionHeader(currentCompetition, t('marathon_results_title'))}
             <h3 id="maratonDateHeader" class="text-lg text-gray-500 dark:text-gray-400 mt-1 font-medium text-center"></h3>
          </div>

          <div class="bg-white dark:bg-gray-800 p-2 md:p-3 rounded-lg md:rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 mb-2 md:mb-4 flex flex-wrap gap-2 md:gap-3 items-center justify-start transition-colors" id="modeToggle">
            <div class="relative flex-grow max-w-full sm:max-w-[200px] flex-shrink-0">
                 <div class="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                    <svg class="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                 </div>
                 <input type="text" id="marSearchBox"
                    class="block w-full pl-8 pr-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded leading-5 bg-gray-50 dark:bg-gray-700 placeholder-gray-500 dark:placeholder-gray-400 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-xs md:text-sm transition-shadow"
                    placeholder="${t('search_placeholder_short')}"
                  >
            </div>

            <div class="hidden md:inline-flex shadow-sm rounded-md bg-gray-100 dark:bg-gray-700 p-1 flex-shrink-0">
                <button id="marBtnStartOrder" data-mode="startorder" class="px-3 py-1 text-xs md:text-sm font-medium rounded transition-colors">${t('start_order')}</button>
                <button id="marBtnByClass" data-mode="byclass" class="px-3 py-1 text-xs md:text-sm font-medium rounded transition-colors">${t('view_by_class_short')}</button>
            </div>

            <div class="md:hidden relative w-[110px] flex-shrink-0">
                 <select id="mobileSortSelect" class="block w-full py-1.5 pl-2 pr-7 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs appearance-none">
                     <option value="byclass">${t('view_by_class_short')}</option>
                     <option value="startorder">${t('start_order')}</option>
                 </select>
                 <div class="pointer-events-none absolute right-0 top-0 bottom-0 flex items-center px-1.5 text-gray-500">
                     <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
                 </div>
            </div>

            <div class="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1 hidden md:block"></div>

            <button id="marToggleOnB" class="px-2 py-1.5 md:px-3 text-xs md:text-sm font-medium rounded border transition-colors flex-shrink-0"></button>
            <button id="marToggleFinalized" class="hidden md:inline-flex px-3 py-1.5 text-xs md:text-sm font-medium rounded border transition-colors"></button>

            <label class="md:hidden flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-200 cursor-pointer flex-shrink-0">
                 <input type="checkbox" id="mobileFinalizedCheck" class="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 w-3.5 h-3.5" />
                 <span id="mobileFinalizedLabel">${t('filter_finished')}</span>
            </label>

            <div id="maratonClassChips" class="flex-shrink-0 z-10 w-[130px] sm:w-auto"></div>
            <div class="flex-grow hidden sm:block"></div>

            <div class="flex-shrink-0 flex items-center gap-2 justify-end border-t border-gray-100 sm:border-0 pt-2 sm:pt-0 dark:border-gray-700 w-full sm:w-auto">
                <button id="marBtnExportCsv"
                  class="inline-flex items-center px-2 md:px-3 py-1 md:py-1.5 border border-gray-300 dark:border-gray-600 shadow-sm text-[11px] md:text-sm font-medium rounded text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors">
                   <i class="fas fa-file-csv mr-1.5 text-gray-500 dark:text-gray-400"></i>
                   CSV
                </button>
                <button id="marBtnExportMarathonPdf"
                  class="inline-flex items-center px-2 md:px-3 py-1 md:py-1.5 border border-transparent shadow-sm text-[11px] md:text-sm font-medium rounded text-white bg-gray-600 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 transition-colors">
                  <svg class="mr-1.5 h-3 w-3 md:h-4 md:w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 1 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                   Skriv ut PDF
                </button>
            </div>
          </div>

          <div id="activeMerges" class="mb-4"></div>

          <div id="marathonTableWrapper" class="bg-white dark:bg-gray-800 shadow-lg rounded-lg border border-gray-200 dark:border-gray-700">
             <div id="marathon-x-wrap" class="x-scroll-wrap bg-white dark:bg-gray-900 w-full overflow-x-auto">
                <table class="pr-table min-w-full divide-y divide-gray-200 dark:divide-gray-700" id="marathonTable">
                    <thead class="bg-gray-50 dark:bg-gray-700" id="marathonTableHead"></thead>
                    <tbody class="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700" id="marathonBody"></tbody>
                </table>
             </div>
          </div>

          <div id="marathonCards" class="mt-6 grid gap-4 grid-cols-1"></div>
        </div>
      `;
  wireControls();
  const sb = document.getElementById('marSearchBox');
  if (sb) sb.value = searchQuery || '';
  return true;
}
