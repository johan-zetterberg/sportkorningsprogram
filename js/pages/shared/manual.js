import { isMobile, escapeHtml } from '../../utils/sharedUtils.js';
import { translateTo } from '../../utils/i18n.js';

// Button names as the pages show them (same i18n keys), in the manual's own language
const btn = (key, lang) => escapeHtml(translateTo(key, lang));

let currentSearchQuery = '';

let activeTab = 'overview'; // 'overview', 'admin', 'official', 'judge', 'driver'

function ensureManualThemeStyles() {
  if (document.getElementById('manual-theme-styles')) return;
  const style = document.createElement('style');
  style.id = 'manual-theme-styles';
  style.textContent = `
    html.dark .manual-theme {
      color: #e5e7eb;
    }
    html.dark .manual-theme .manual-shell-title,
    html.dark .manual-theme .manual-section-title,
    html.dark .manual-theme .manual-card-title {
      color: #f3f4f6 !important;
    }
    html.dark .manual-theme h2,
    html.dark .manual-theme h3,
    html.dark .manual-theme h4 {
      color: #f3f4f6 !important;
    }
    html.dark .manual-theme p,
    html.dark .manual-theme li,
    html.dark .manual-theme dt,
    html.dark .manual-theme dd,
    html.dark .manual-theme summary,
    html.dark .manual-theme span:not(.live-dot):not(.legend-label) {
      color: inherit;
    }
    html.dark .manual-theme .manual-surface {
      background: #111827 !important;
      border-color: #374151 !important;
      color: #e5e7eb !important;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.25);
    }
    html.dark .manual-theme .manual-tabbar {
      border-color: #374151 !important;
    }
    html.dark .manual-theme .manual-tab-btn:not(.manual-tab-btn-active) {
      background: #1f2937 !important;
      color: #d1d5db !important;
    }
    html.dark .manual-theme .manual-tab-btn:not(.manual-tab-btn-active):hover {
      background: #374151 !important;
    }
    html.dark .manual-theme .bg-white,
    html.dark .manual-theme .bg-gray-50,
    html.dark .manual-theme .bg-gray-100 {
      background: #1f2937 !important;
      border-color: #374151 !important;
    }
    html.dark .manual-theme .border,
    html.dark .manual-theme .border-gray-200,
    html.dark .manual-theme .border-yellow-100,
    html.dark .manual-theme .border-indigo-100,
    html.dark .manual-theme .border-purple-100,
    html.dark .manual-theme .border-blue-100,
    html.dark .manual-theme .border-red-100 {
      border-color: #374151 !important;
    }
    html.dark .manual-theme .text-gray-800,
    html.dark .manual-theme .text-gray-700 {
      color: #e5e7eb !important;
    }
    html.dark .manual-theme .text-gray-600,
    html.dark .manual-theme .text-gray-500,
    html.dark .manual-theme .text-slate-400 {
      color: #cbd5e1 !important;
    }
    html.dark .manual-theme .text-blue-900,
    html.dark .manual-theme .text-blue-800 {
      color: #bfdbfe !important;
    }
    html.dark .manual-theme .text-blue-700,
    html.dark .manual-theme .text-blue-600 {
      color: #93c5fd !important;
    }
    html.dark .manual-theme .text-red-800 {
      color: #fecaca !important;
    }
    html.dark .manual-theme .text-red-600 {
      color: #fca5a5 !important;
    }
    html.dark .manual-theme .text-yellow-800,
    html.dark .manual-theme .text-amber-900 {
      color: #fde68a !important;
    }
    html.dark .manual-theme .text-yellow-700,
    html.dark .manual-theme .text-amber-700,
    html.dark .manual-theme .text-amber-600,
    html.dark .manual-theme .text-orange-700 {
      color: #fcd34d !important;
    }
    html.dark .manual-theme .text-indigo-800 {
      color: #c7d2fe !important;
    }
    html.dark .manual-theme .text-indigo-700,
    html.dark .manual-theme .text-indigo-600 {
      color: #a5b4fc !important;
    }
    html.dark .manual-theme .text-purple-900 {
      color: #e9d5ff !important;
    }
    html.dark .manual-theme .text-purple-700,
    html.dark .manual-theme .text-purple-600 {
      color: #d8b4fe !important;
    }
    html.dark .manual-theme .text-green-700,
    html.dark .manual-theme .text-green-600,
    html.dark .manual-theme .text-emerald-700,
    html.dark .manual-theme .text-emerald-600 {
      color: #86efac !important;
    }
    html.dark .manual-theme .text-cyan-700,
    html.dark .manual-theme .text-cyan-600 {
      color: #67e8f9 !important;
    }
    html.dark .manual-theme .text-orange-800 {
      color: #fdba74 !important;
    }
    html.dark .manual-theme .bg-blue-50,
    html.dark .manual-theme .bg-blue-100 {
      background: rgba(30, 64, 175, 0.22) !important;
      border-color: rgba(96, 165, 250, 0.35) !important;
    }
    html.dark .manual-theme .bg-indigo-50 {
      background: rgba(67, 56, 202, 0.2) !important;
      border-color: rgba(129, 140, 248, 0.35) !important;
    }
    html.dark .manual-theme .bg-purple-50 {
      background: rgba(107, 33, 168, 0.2) !important;
      border-color: rgba(192, 132, 252, 0.35) !important;
    }
    html.dark .manual-theme .bg-green-50,
    html.dark .manual-theme .bg-emerald-50 {
      background: rgba(6, 95, 70, 0.22) !important;
      border-color: rgba(52, 211, 153, 0.3) !important;
    }
    html.dark .manual-theme .bg-yellow-50,
    html.dark .manual-theme .bg-amber-50 {
      background: rgba(120, 53, 15, 0.22) !important;
      border-color: rgba(251, 191, 36, 0.3) !important;
    }
    html.dark .manual-theme .bg-red-50 {
      background: rgba(127, 29, 29, 0.22) !important;
      border-color: rgba(248, 113, 113, 0.3) !important;
    }
    html.dark .manual-theme .bg-cyan-50 {
      background: rgba(14, 116, 144, 0.2) !important;
      border-color: rgba(34, 211, 238, 0.3) !important;
    }
    html.dark .manual-theme .bg-orange-50 {
      background: rgba(124, 45, 18, 0.24) !important;
      border-color: rgba(251, 146, 60, 0.32) !important;
    }
    html.dark .manual-theme .bg-violet-50 {
      background: rgba(91, 33, 182, 0.2) !important;
      border-color: rgba(167, 139, 250, 0.35) !important;
    }
    html.dark .manual-theme .bg-sky-50 {
      background: rgba(7, 89, 133, 0.22) !important;
      border-color: rgba(56, 189, 248, 0.32) !important;
    }
    html.dark .manual-theme .bg-green-100 {
      background: rgba(6, 95, 70, 0.32) !important;
    }
    html.dark .manual-theme .bg-red-100 {
      background: rgba(127, 29, 29, 0.32) !important;
    }
    html.dark .manual-theme .border-amber-100,
    html.dark .manual-theme .border-amber-200 {
      border-color: rgba(251, 191, 36, 0.3) !important;
    }
    html.dark .manual-theme .border-emerald-100 {
      border-color: rgba(52, 211, 153, 0.3) !important;
    }
    html.dark .manual-theme .border-red-200 {
      border-color: rgba(248, 113, 113, 0.3) !important;
    }
    html.dark .manual-theme .border-sky-200 {
      border-color: rgba(56, 189, 248, 0.32) !important;
    }
    html.dark .manual-theme .border-violet-200 {
      border-color: rgba(167, 139, 250, 0.35) !important;
    }
    html.dark .manual-theme .border-blue-300 {
      border-color: rgba(96, 165, 250, 0.45) !important;
    }
    html.dark .manual-theme .border-gray-300 {
      border-color: #4b5563 !important;
    }
    html.dark .manual-theme .text-gray-900 {
      color: #f3f4f6 !important;
    }
    html.dark .manual-theme .text-amber-800,
    html.dark .manual-theme .text-yellow-900 {
      color: #fde68a !important;
    }
    html.dark .manual-theme .text-amber-500 {
      color: #fbbf24 !important;
    }
    html.dark .manual-theme .text-cyan-900 {
      color: #a5f3fc !important;
    }
    html.dark .manual-theme .text-emerald-800,
    html.dark .manual-theme .text-emerald-900,
    html.dark .manual-theme .text-green-800 {
      color: #a7f3d0 !important;
    }
    html.dark .manual-theme .text-indigo-900 {
      color: #c7d2fe !important;
    }
    html.dark .manual-theme .text-orange-900 {
      color: #fdba74 !important;
    }
    html.dark .manual-theme .text-purple-800 {
      color: #e9d5ff !important;
    }
    html.dark .manual-theme .text-red-500,
    html.dark .manual-theme .text-red-700,
    html.dark .manual-theme .text-red-900 {
      color: #fca5a5 !important;
    }
    html.dark .manual-theme .text-sky-700 {
      color: #7dd3fc !important;
    }
    html.dark .manual-theme .text-violet-700 {
      color: #c4b5fd !important;
    }
    html.dark .manual-theme .from-blue-50,
    html.dark .manual-theme .to-indigo-50 {
      background-image: linear-gradient(135deg, rgba(30, 64, 175, 0.24), rgba(67, 56, 202, 0.18)) !important;
      border-color: rgba(96, 165, 250, 0.3) !important;
    }
    html.dark .manual-theme .border-blue-200,
    html.dark .manual-theme .border-blue-500,
    html.dark .manual-theme .border-blue-600,
    html.dark .manual-theme .border-blue-900 {
      border-color: rgba(96, 165, 250, 0.4) !important;
    }
    html.dark .manual-theme .border-green-200,
    html.dark .manual-theme .border-green-500,
    html.dark .manual-theme .border-green-600,
    html.dark .manual-theme .border-emerald-200,
    html.dark .manual-theme .border-emerald-500 {
      border-color: rgba(52, 211, 153, 0.35) !important;
    }
    html.dark .manual-theme .border-yellow-200,
    html.dark .manual-theme .border-yellow-400,
    html.dark .manual-theme .border-yellow-500,
    html.dark .manual-theme .border-amber-500 {
      border-color: rgba(251, 191, 36, 0.35) !important;
    }
    html.dark .manual-theme .border-indigo-200,
    html.dark .manual-theme .border-indigo-500,
    html.dark .manual-theme .border-indigo-600 {
      border-color: rgba(129, 140, 248, 0.35) !important;
    }
    html.dark .manual-theme .border-purple-200,
    html.dark .manual-theme .border-purple-500,
    html.dark .manual-theme .border-purple-600 {
      border-color: rgba(192, 132, 252, 0.35) !important;
    }
    html.dark .manual-theme .border-cyan-200,
    html.dark .manual-theme .border-cyan-500 {
      border-color: rgba(34, 211, 238, 0.35) !important;
    }
    html.dark .manual-theme .border-orange-200,
    html.dark .manual-theme .border-orange-500 {
      border-color: rgba(251, 146, 60, 0.35) !important;
    }
    html.dark .manual-theme .border-red-500,
    html.dark .manual-theme .border-red-600 {
      border-color: rgba(248, 113, 113, 0.35) !important;
    }
    html.dark .manual-theme code {
      background: #0f172a;
      color: #e5e7eb;
      padding: 0.1rem 0.3rem;
      border-radius: 0.25rem;
    }
  `;
  document.head.appendChild(style);
}

export function setManualActiveTab(tabId) {
  const validTabs = ['overview', 'official', 'judge', 'secretary', 'admin', 'driver', 'speaker', 'tech', 'observer'];
  if (validTabs.includes(tabId)) {
    activeTab = tabId;
    currentSearchQuery = '';
    const container = document.getElementById('page-manual');
    if (container && container.classList.contains('active')) {
      render(container);
    }
  }
}

export async function load(container) {
  if (!container) return;

  const hash = window.location.hash || '';
  const query = hash.includes('?') ? hash.split('?')[1] : (window.location.search || '').replace(/^\?/, '');
  const params = new URLSearchParams(query);
  const tabParam = params.get('tab');
  const validTabs = ['overview', 'official', 'judge', 'secretary', 'admin', 'driver', 'speaker', 'tech', 'observer'];
  if (tabParam && validTabs.includes(tabParam)) {
    activeTab = tabParam;
    currentSearchQuery = '';
  }

  ensureManualThemeStyles();
  render(container);
}

let cachedSearchIndex = null;
let cachedSearchLang = null;

function getManualSearchIndex(isEn) {
  const langKey = isEn ? 'en' : 'sv';
  if (cachedSearchIndex && cachedSearchLang === langKey) {
    return cachedSearchIndex;
  }

  const tabList = [
    { id: 'overview', name: isEn ? 'Overview' : 'Översikt' },
    { id: 'official', name: isEn ? 'Official' : 'Funktionär' },
    { id: 'judge', name: isEn ? 'Judge' : 'Domare' },
    { id: 'secretary', name: isEn ? 'Secretariat' : 'Sekretariat' },
    { id: 'admin', name: isEn ? 'Admin' : 'Administratör' },
    { id: 'driver', name: isEn ? 'Driver' : 'Kusk/Deltagare' },
    { id: 'speaker', name: 'Speaker' },
    { id: 'tech', name: isEn ? 'Tech/Support' : 'Teknik/Support' },
    { id: 'observer', name: isEn ? 'Observer' : 'Observatör' }
  ];

  const index = [];
  const tempDiv = document.createElement('div');

  for (const tab of tabList) {
    const rawHtml = isEn ? getTabContentEN(tab.id) : getTabContentSV(tab.id);
    tempDiv.innerHTML = rawHtml;

    const sections = tempDiv.querySelectorAll('section');
    if (sections.length > 0) {
      sections.forEach((sec, idx) => {
        const titleEl = sec.querySelector('h3, h4, h2');
        const title = titleEl ? titleEl.textContent.trim() : `${tab.name} (${idx + 1})`;
        const text = sec.textContent.trim();
        index.push({
          tabId: tab.id,
          tabName: tab.name,
          title,
          text,
          html: sec.innerHTML
        });
      });
    } else {
      index.push({
        tabId: tab.id,
        tabName: tab.name,
        title: tab.name,
        text: tempDiv.textContent.trim(),
        html: rawHtml
      });
    }
  }

  cachedSearchIndex = index;
  cachedSearchLang = langKey;
  return index;
}

function highlightSearchTerms(text, query) {
  if (!query) return escapeHtml(text);
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'gi');
  // split() with a capture group puts the matches at the odd indexes
  return String(text ?? '').split(regex).map((part, i) => (i % 2
    ? `<mark class="bg-yellow-200 dark:bg-yellow-800 text-gray-900 dark:text-white px-0.5 rounded font-semibold">${escapeHtml(part)}</mark>`
    : escapeHtml(part))).join('');
}

function extractSnippet(text, query, maxLen = 170) {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);
  if (idx === -1) {
    return text.slice(0, maxLen) + (text.length > maxLen ? '...' : '');
  }
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + query.length + 80);
  let snippet = text.slice(start, end).trim();
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';
  return snippet;
}

async function downloadRolePdf(role, btnEl = null) {
  const isEn = localStorage.getItem('user_lang_pref') === 'en';
  let originalHtml = '';
  if (btnEl) {
    originalHtml = btnEl.innerHTML;
    btnEl.innerHTML = `<span>⏳</span> ${isEn ? 'Generating...' : 'Genererar...'}`;
    btnEl.disabled = true;
  }
  try {
    const { generateQuickGuidePdf } = await import('../../pdf/quickGuidePdf.js');
    await generateQuickGuidePdf(role);
  } catch (err) {
    console.error('Kunde inte skapa lathund-PDF:', err);
    alert((isEn ? 'Could not download the PDF: ' : 'Kunde inte ladda ner PDF: ') + err.message);
  } finally {
    if (btnEl) {
      btnEl.innerHTML = originalHtml;
      btnEl.disabled = false;
    }
  }
}

function render(container) {
  const lang = localStorage.getItem('user_lang_pref') || 'sv';
  const isEn = lang === 'en';

  const ui = {
    title: isEn ? 'User Manual' : 'Användarmanual & Kunskapsbank',
    sub: isEn ? 'Search or select your role below to find step-by-step guides and printable cheat sheets.' : 'Sök i kunskapsbanken eller välj roll nedan för steg-för-steg-guider och utskrivbara fältlathundar.',
    searchPlaceholder: isEn ? 'Search manual (e.g. offline, pause, dressage, keyboard, penalties)...' : 'Sök i manualen (t.ex. offline, paus, dressyr, tangentbord, straff, klocka)...',
    tabs: {
      overview: isEn ? 'Overview' : 'Översikt',
      official: isEn ? 'Official' : 'Funktionär',
      judge: isEn ? 'Judge' : 'Domare',
      secretary: isEn ? 'Secretariat' : 'Sekretariat',
      admin: isEn ? 'Admin' : 'Administratör',
      driver: isEn ? 'Driver' : 'Kusk/Deltagare',
      speaker: 'Speaker',
      tech: isEn ? 'Tech/Support' : 'Teknik/Support',
      observer: isEn ? 'Observer' : 'Observatör'
    }
  };

  const isSearching = currentSearchQuery.trim().length >= 2;

  const content = `
    <div class="manual-theme max-w-4xl mx-auto px-4 py-6">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
        <div>
          <h1 class="manual-shell-title text-2xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <span>📖</span> ${ui.title}
          </h1>
          <p class="text-xs sm:text-sm text-gray-600 dark:text-gray-300 mt-1">${ui.sub}</p>
        </div>
      </div>

      <!-- SÖKRUTA -->
      <div class="mb-5 relative">
        <div class="relative flex items-center">
          <span class="absolute left-3.5 text-gray-400 text-base pointer-events-none">🔍</span>
          <input 
            id="manualSearchInput" 
            type="search" 
            value="${escapeHtml(currentSearchQuery)}" 
            placeholder="${ui.searchPlaceholder}" 
            class="w-full pl-10 pr-10 py-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-gray-900 dark:text-gray-100 shadow-sm transition-all placeholder-gray-400 dark:placeholder-gray-500"
          />
          <button 
            id="manualSearchClear" 
            type="button" 
            class="${currentSearchQuery ? '' : 'hidden'} absolute right-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-sm font-bold p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
            title="${isEn ? 'Clear search' : 'Rensa sökning'}">
            ✕
          </button>
        </div>
      </div>

      <!-- TABS -->
      <div class="manual-tabbar flex flex-wrap gap-2 mb-4 md:mb-6 border-b border-gray-200 dark:border-gray-700 pb-2 overflow-x-auto whitespace-nowrap scrollbar-hide ${isSearching ? 'opacity-50' : ''}">
        ${renderTabBtn('overview', ui.tabs.overview)}
        ${renderTabBtn('official', ui.tabs.official)}
        ${renderTabBtn('judge', ui.tabs.judge)}
        ${renderTabBtn('secretary', ui.tabs.secretary)}
        ${renderTabBtn('admin', ui.tabs.admin)}
        ${renderTabBtn('driver', ui.tabs.driver)}
        ${renderTabBtn('speaker', ui.tabs.speaker)}
        ${renderTabBtn('tech', ui.tabs.tech)}
        ${renderTabBtn('observer', ui.tabs.observer)}
      </div>

      <!-- CONTENT AREA -->
      <div id="manual-content-container" class="manual-surface bg-white dark:bg-gray-800 rounded-xl shadow p-4 md:p-6 min-h-[400px] border border-gray-200 dark:border-gray-700">
        ${isSearching ? renderSearchResults(currentSearchQuery, isEn) : getTabContent(activeTab)}
      </div>
    </div>
  `;

  container.innerHTML = content;

  // Add search listeners
  const searchInput = container.querySelector('#manualSearchInput');
  const searchClear = container.querySelector('#manualSearchClear');
  const contentArea = container.querySelector('#manual-content-container');

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      currentSearchQuery = e.target.value;
      if (searchClear) searchClear.classList.toggle('hidden', !currentSearchQuery);
      if (currentSearchQuery.trim().length >= 2) {
        contentArea.innerHTML = renderSearchResults(currentSearchQuery, isEn);
        bindContentAreaListeners(contentArea, container);
      } else {
        contentArea.innerHTML = getTabContent(activeTab);
        bindContentAreaListeners(contentArea, container);
      }
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        currentSearchQuery = '';
        searchInput.value = '';
        if (searchClear) searchClear.classList.add('hidden');
        contentArea.innerHTML = getTabContent(activeTab);
        bindContentAreaListeners(contentArea, container);
      }
    });
  }

  if (searchClear) {
    searchClear.addEventListener('click', () => {
      currentSearchQuery = '';
      if (searchInput) searchInput.value = '';
      searchClear.classList.add('hidden');
      contentArea.innerHTML = getTabContent(activeTab);
      bindContentAreaListeners(contentArea, container);
      if (searchInput) searchInput.focus();
    });
  }

  // Add tab listeners
  container.querySelectorAll('.manual-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      activeTab = e.currentTarget.dataset.tab;
      currentSearchQuery = '';
      render(container);
    });
  });

  bindContentAreaListeners(container, container);
}

function bindContentAreaListeners(area, rootContainer) {
  // Bind PDF download buttons
  area.querySelectorAll('[data-role-pdf]').forEach(btn => {
    btn.addEventListener('click', () => {
      downloadRolePdf(btn.dataset.rolePdf, btn);
    });
  });

  // Bind Jump-to-tab buttons in search results
  area.querySelectorAll('[data-jump-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.jumpTab;
      currentSearchQuery = '';
      render(rootContainer);
    });
  });

  // Bind exit search button
  const exitBtn = area.querySelector('#btnExitSearch');
  if (exitBtn) {
    exitBtn.addEventListener('click', () => {
      currentSearchQuery = '';
      render(rootContainer);
    });
  }
}

function renderSearchResults(query, isEn) {
  const q = query.trim().toLowerCase();
  const index = getManualSearchIndex(isEn);
  const matches = index.filter(item => item.text.toLowerCase().includes(q) || item.title.toLowerCase().includes(q));

  if (matches.length === 0) {
    return `
      <div class="text-center py-12">
        <div class="text-4xl mb-3">🔍</div>
        <h3 class="text-lg font-bold text-gray-800 dark:text-gray-100">${isEn ? 'No results found' : 'Inga resultat hittades'}</h3>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-md mx-auto">
          ${isEn ? `No sections matched "${escapeHtml(query)}". Try another search word or select a role from the tabs above.` : `Inga avsnitt matchade "${escapeHtml(query)}". Prova ett annat sökord eller välj en roll i flikarna ovan.`}
        </p>
      </div>
    `;
  }

  return `
    <div class="space-y-4">
      <div class="flex items-center justify-between pb-3 border-b dark:border-gray-700">
        <div>
          <h3 class="text-sm font-bold text-gray-800 dark:text-gray-200">
            ${isEn ? `Found ${matches.length} matches for "${escapeHtml(query)}"` : `Hittade ${matches.length} träffar i manualen för "${escapeHtml(query)}"`}
          </h3>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">${isEn ? 'Click on any section to open its full tab' : 'Klicka på ett avsnitt för att gå till dess fullständiga flik'}</p>
        </div>
        <button type="button" id="btnExitSearch" class="text-xs text-blue-600 dark:text-blue-400 hover:underline font-semibold flex items-center gap-1">
          ${isEn ? '✕ Clear search' : '✕ Avsluta sökning'}
        </button>
      </div>
      <div class="grid grid-cols-1 gap-3">
        ${matches.map(hit => `
          <div class="p-4 bg-gray-50 dark:bg-gray-900/40 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700 transition-all shadow-xs">
            <div class="flex items-center justify-between gap-2 mb-2">
              <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-800">
                ${escapeHtml(hit.tabName)}
              </span>
              <button type="button" data-jump-tab="${hit.tabId}" class="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">
                ${isEn ? `Open ${hit.tabName} ➔` : `Öppna fliken ${hit.tabName} ➔`}
              </button>
            </div>
            <h4 class="font-bold text-base text-gray-900 dark:text-gray-100 mb-1.5">
              ${highlightSearchTerms(hit.title, query)}
            </h4>
            <p class="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
              ${highlightSearchTerms(extractSnippet(hit.text, query), query)}
            </p>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderTabBtn(id, label) {
  const active = activeTab === id;
  const classes = active
    ? 'manual-tab-btn-active bg-blue-600 text-white shadow-sm ring-1 ring-blue-700'
    : 'bg-gray-100 text-gray-700 hover:bg-gray-200';

  return `<button class="manual-tab-btn px-4 py-2 rounded-full text-sm font-medium transition-colors ${classes}" data-tab="${id}">
    ${label}
  </button>`;
}

function getTabContent(tab) {
  const lang = localStorage.getItem('user_lang_pref') || 'sv';
  return lang === 'en' ? getTabContentEN(tab) : getTabContentSV(tab);
}

function getTabContentSV(tab) {
  switch (tab) {
    case 'tech':
      return `
        <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">Teknik & Support</h2>
        <div class="space-y-8">
            
            <section>
                <h3 class="font-bold text-lg mb-2 text-cyan-700 border-l-4 border-cyan-500 pl-2">Installera som App</h3>
                <p class="text-gray-700 mb-2">För bästa prestanda och stabilitet bör du lägga till systemet på hemskärmen.</p>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="bg-gray-50 p-4 rounded border">
                        <strong class="block mb-2">🍏 iPad / iPhone (Safari)</strong>
                        <ol class="list-decimal list-inside text-sm text-gray-700 space-y-1">
                            <li>Tryck på <strong>Dela-knappen</strong> (fyrkant med pil uppåt).</li>
                            <li>Scrolla ner och välj <strong>"Lägg till på hemskärmen"</strong>.</li>
                            <li>Bekräfta med "Lägg till".</li>
                        </ol>
                    </div>
                    <div class="bg-gray-50 p-4 rounded border">
                        <strong class="block mb-2">🤖 Android (Chrome)</strong>
                        <ol class="list-decimal list-inside text-sm text-gray-700 space-y-1">
                            <li>Tryck på menyn (tre prickar).</li>
                            <li>Välj <strong>"Installera app"</strong> eller "Lägg till på hemskärmen".</li>
                            <li>Följ instruktionerna.</li>
                        </ol>
                    </div>
                </div>
            </section>

             <section>
                <h3 class="font-bold text-lg mb-2 text-orange-700 border-l-4 border-orange-500 pl-2">Offline-läge (Utan Internet)</h3>
                <div class="bg-orange-50 p-4 rounded-lg border border-orange-200">
                    <p class="text-gray-700 mb-2">
                        Systemet är byggt för att klara svajigt internet ute på fältet.
                    </p>
                    <ul class="list-disc list-inside text-sm text-gray-700 space-y-2">
                        <li><strong>På en inmatningsvy som redan har laddats kan du fortsätta registrera tider och resultat när täckningen försvinner.</strong></li>
                        <li>Skrivningar kan köas lokalt ("I kön") och skickas när internet kommer tillbaka. En köad skrivning är inte serverbekräftad förrän den har skickats, alltså tills den orange köknappen nere till höger (☁️ Synkar...) är borta.</li>
                        <li class="font-bold text-red-600">VIKTIGT: Stäng eller uppdatera inte fliken, logga inte ut och rensa inte webbplatsdata medan något väntar i kön. Byt inte enhet innan synkningen är klar.</li>
                    </ul>
                </div>
            </section>

             <section>
                <h3 class="font-bold text-lg mb-2 text-green-700 border-l-4 border-green-500 pl-2">Batteri & Skärmlås</h3>
                <div class="bg-green-50 p-4 rounded-lg border border-green-200">
                    <p class="text-gray-700 mb-2">
                        Systemet håller automatiskt din skärm vaken ("Wake Lock") när du är inne på sidor för tidtagning eller dömning.
                    </p>
                    <ul class="list-disc list-inside text-sm text-gray-700 space-y-1">
                        <li>Du behöver inte ändra telefonens inställningar för skärmtid.</li>
                        <li><strong>Tips:</strong> Ha gärna en Powerbank till hands om du ska stå ute hela dagen, då skärmen drar batteri.</li>
                    </ul>
                </div>
            </section>

             <section>
                <h3 class="font-bold text-lg mb-2 text-gray-700 border-l-4 border-gray-500 pl-2">Felsökning</h3>
                <ul class="list-disc list-inside text-sm text-gray-700 space-y-1">
                   <li><strong>"Sidan ser konstig ut":</strong> Prova att ladda om sidan (dra neråt eller tryck F5).</li>
                   <li><strong>"Inget händer när jag klickar":</strong> Kontrollera din internetuppkoppling. Syns en "Offline"-symbol?</li>
                   <li><strong>Synk-kön:</strong>
                       <ul class="list-circle list-inside ml-4 mt-1 text-xs">
                           <li><span class="text-amber-500">Orange knapp nere till höger (☁️ antal, Synkar...):</span> Så många skrivningar väntar på att skickas. Tryck på den för att se vilka.</li>
                           <li><span class="text-gray-500">"Offline" i menyraden:</span> Ingen anslutning. Skrivningar från en redan laddad vy köas lokalt och skickas senare.</li>
                           <li><span class="text-green-600">Ingen knapp och ingen badge:</span> Allt är skickat.</li>
                       </ul>
                   </li>
                </ul>
            </section>

        </div>
            `;

    case 'secretary':
      return `
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3 mb-6">
          <h2 class="text-xl font-semibold text-gray-800 dark:text-gray-100">För Sekretariatet</h2>
          <button type="button" data-role-pdf="secretariat" class="px-3.5 py-1.5 bg-amber-700 hover:bg-amber-800 text-white rounded-lg text-xs font-semibold shadow-xs transition-all flex items-center gap-1.5 self-start sm:self-auto active:scale-95">
            <span>📋</span> Skriv ut Lathund (A4 PDF)
          </button>
        </div>
        <div class="space-y-8">
            
            <section>
                <h3 class="font-bold text-lg mb-2 text-blue-700 border-l-4 border-blue-500 pl-2">Rapportcenter (Listor)</h3>
                <p class="text-gray-700 mb-2">Här genererar du alla PDF-filer för utskrift och webbpublicering.</p>
                <div class="bg-blue-50 p-4 rounded-lg space-y-2">
                    <ul class="list-disc list-inside text-sm text-gray-700">
                        <li><strong>Startlistor:</strong> Skapas per gren (Dressyr, Maraton, Precision). Systemet sorterar automatiskt på starttid.</li>
                        <li><strong>Funktionärslistor (Nytt!):</strong>
                            <ul class="list-circle list-inside ml-4 text-xs mt-1 space-y-1">
                                <li><strong>Maraton Tider:</strong> Tidslinje med beräknade tider för Start A, Mål A, Start B etc. (Kräver att starttider och sträckor är inställda).</li>
                                <li><strong>Maratontider per ekipage:</strong> Använd sidan <strong>Maraton &gt; Beräkna tider</strong> för att skriva ut en A/Transport/B-PDF för ett enskilt ekipage. PDF:en tar med tävlingslogga om den är uppladdad.</li>
                                <li><strong>Maraton Hinder:</strong> Lista för hinderdomare. Inkluderar beräknad starttid för B-sträckan.</li>
                                <li><strong>Dressyr:</strong> Startordning med program och häst för scribes/ringmaster.</li>
                            </ul>
                            <p class="text-[10px] text-blue-800 mt-1"><em>* Strukna ekipage filtreras automatiskt bort från dessa listor.</em></p>
                        </li>
                        <li><strong>Resultatlistor:</strong> Resultat räknas ut live. På "Total-resultat" kan du nu även klicka på "Skriv ut / PDF" för att få en snyggt formaterad slutlista per klass.</li>
                        <li><strong>Loggor i PDF:</strong> Tävlingsloggan, klubbloggor och flaggor används automatiskt där de finns tillgängliga. Kontrollera detta innan du skriver ut officiella listor.</li>
                        <li><strong>CSV-export:</strong> Använd knapparna "CSV" för att få ut rådata till Excel om du behöver göra egna analyser.</li>
                        <li><strong>Sekretariat (Dressyr/Maraton/Precision):</strong> Använd sekretariatssidorna för att rätta tider, straff och protokoll utan att gå tillbaka till ordinarie inmatningssidor. Finaliserade resultat måste först låsas upp.</li>
                    </ul>
                     <p class="text-xs text-blue-900 mt-2 font-bold">
                        Tips: De flesta resultat- och listvyer har nu en kompakt rad högst upp med Sök, Sortering, Klass, CSV och PDF. Använd klassfiltret för att skriva ut en klass i taget.
                     </p>
                </div>
            </section>

            <section>
                <h3 class="font-bold text-lg mb-2 text-emerald-700 border-l-4 border-emerald-500 pl-2">Fältläge & Sekretariat</h3>
                <div class="bg-emerald-50 p-4 rounded-lg border border-emerald-200 space-y-2 text-sm text-gray-700">
                    <p><strong>Fältläge</strong> är till för tävlingar med dålig täckning eller få funktionärer. Monitorer och andra tydliga live-sidor döljs då, men resultat kan fortfarande rapporteras manuellt.</p>
                    <ul class="list-disc list-inside space-y-1">
                        <li><strong>Live-läge:</strong> Används när ni kör med monitorer, live-timers och publikflöde i realtid.</li>
                        <li><strong>Fältläge:</strong> Funktionärer matar in tider och poäng manuellt, och sekretariatet rättar samt finaliserar vid behov.</li>
                        <li><strong>Val i Admin &gt; Inställningar:</strong> Tävlingsläget styr vilka sidor som syns i menyn.</li>
                    </ul>
                </div>
            </section>

            <section>
                <h3 class="font-bold text-lg mb-2 text-violet-700 border-l-4 border-violet-500 pl-2">⚖️ Händelselogg, protester & domarkollegium</h3>
                <div class="bg-violet-50 p-4 rounded-lg border border-violet-200 space-y-2 text-sm text-gray-700">
                    <p>Menyn <strong>Admin &gt; Sekretariat &gt; Händelselogg &amp; protester</strong> (sidan <code>#incidents</code>) är tävlingens logg för TD-rapporten. Den är privat: admin, TD/domarkollegium och grenfunktionärer läser och skriver, veterinären läser och lägger till sina egna beslut. Den syns aldrig för publiken.</p>
                    <ul class="list-disc list-inside space-y-1">
                        <li><strong>Händelser:</strong> Typ (Protest, Incident, Domarkollegiets beslut, Veterinärbeslut, Övrigt), mottagen tid, startnummer, gren och hinder, beskrivning, beslut, beslutat av och status (Öppen/Beslutad/Avslutad). Varje post får ett nummer. Exportera som PDF eller CSV till TD-rapporten.</li>
                        <li><strong>Korrigeringar:</strong> Sekretariatets rättelser med orsak och referens. Ange protestens eller beslutets nummer som referens vid rättelsen, så länkas rättelsen och händelsen till varandra.</li>
                        <li><strong>Att uppmärksamma:</strong> Veterinärens strykningar som väntar på domarkollegiet (Fastställ / Upphäv) och deklarationer som kuskar har ändrat ("Ändrad av kusk"; en ny häst efter besiktningen markeras för veterinären). Kvittera när du har sett dem. Samma ruta visas överst på startsidan Funktionär för admin, sekretariat, TD och veterinär.</li>
                        <li><strong>Veterinärstrykning:</strong> Veterinärens strykning är först ett förslag. Ekipaget markeras <em>"Veterinärstrykning avvaktar domarkollegiet"</em> hos sekretariatet, speakern, funktionärerna, på startlistan och på monitorerna, och kusken ser <em>"Veterinärbeslut avvaktar domarkollegiets beslut"</em> i Min Portal. Ekipaget stryks först när sekretariatet eller TD trycker <strong>Fastställ</strong>; <strong>Upphäv</strong> tar bort markeringen. Godkänner veterinären hästen igen innan beslutet är strykningen återkallad.</li>
                        <li><strong>Fältenheter:</strong> Varje enhet med en inmatningssida öppen rapporterar en gång i minuten: senast sedd (grön under 2 min, gul under 10, röd äldre), osända skrivningar, sida och hinder.</li>
                    </ul>
                    <p><strong>TD / Domarkollegium (rollen td):</strong> Lägg till i funktionärslistan (Systemrättigheter) eller ge rollkoden för TD. Rollen läser sekretariatssidorna, skriver i händelseloggen, kan finalisera och låsa upp resultat och fattar beslut om veterinärens strykningar.</p>
                    <p><strong>Resultat-PDF:</strong> Resultatlistor märks <em>PRELIMINÄRT RESULTAT</em> tills alla resultat på listan är finaliserade (eller tävlingen arkiverad); då står <em>OFFICIELLT RESULTAT</em> och en rad för domarkollegiets ordförandes underskrift.</p>
                    <p><strong>Nödinfo:</strong> Fyll i under <strong>Admin &gt; Kommunikation &gt; Publik info</strong>: larmnummer (112), sjukvård, jourveterinär, hovslagare, tävlingsledare och säkerhetsansvarig. Personernas telefonnummer visas bara för inloggade funktionärer och tävlingens kuskar; knappen <strong>Nöd</strong> i menyn visar kortet.</p>
                </div>
            </section>

            <section>
                <h3 class="font-bold text-lg mb-2 text-sky-700 border-l-4 border-sky-500 pl-2">💬 Meddelanden, notiser & kontaktlistor</h3>
                <div class="bg-sky-50 p-4 rounded-lg border border-sky-200 space-y-2 text-sm text-gray-700">
                    <p>Ett <strong>meddelande</strong> visas i appen. En <strong>notis</strong> är pushnotisen som dyker upp i telefonen; den når bara dem som har slagit på notiser.</p>
                    <ul class="list-disc list-inside space-y-1">
                        <li><strong>Skicka meddelande:</strong> <strong>Admin &gt; Kommunikation</strong>. Välj mottagare: Publik, Kuskar, Valda kuskar, Funktionärer (alla) eller en roll: Dressyr, Maraton, Precision, Veterinär, Speaker, Sekretariat eller TD / domarkollegium. Markera Viktigt för ett rött meddelande. Engelsk text är valfri och visas för dem som valt engelska.</li>
                        <li><strong>Ändra ett skickat meddelande:</strong> Tryck <strong>Ändra</strong>, rätta och välj <strong>Spara ändringar</strong>. Meddelandet märks "ändrad" med tid och visas igen för dem som hade dolt det. Uppdateringen kan skickas som notis och e-post. <strong>Ta bort</strong> tar bort meddelandet för alla mottagare.</li>
                        <li><strong>Banner för funktionärer:</strong> Meddelanden till funktionärer visas överst på inmatningssidorna, sekretariatssidorna och startsidan Funktionär (där med antal). Du ser rubriken och två rader; <strong>Visa mer</strong> öppnar hela texten, <strong>+N fler</strong> visar att det finns fler, och &times; döljer meddelandet på den här enheten. Viktiga meddelanden är röda. Speakern ser dem i sin egen meddelanderuta, och de som inte är för publiken märks <em>Internt – ej utrop</em>.</li>
                        <li><strong>Kontaktlistor:</strong> Längst ned under Kommunikation. Välj grupp (alla kuskar, kuskar i en klass, alla funktionärer eller en roll) och tryck <strong>Kopiera e-postadresser (BCC)</strong>, <strong>Kopiera telefonnummer</strong> eller <strong>Öppna e-post med BCC</strong>. Uppgifterna är privata och ska inte delas vidare.</li>
                        <li><strong>Ändrade starttider:</strong> När du sparar ändrade tider i en publicerad startlista frågar systemet <em>Meddela berörda kuskar?</em> Välj hur: <strong>Meddelande i appen</strong>, <strong>Notis</strong> och/eller <strong>E-post</strong>. Du ser hur många kuskar och enheter med notiser påslagna det gäller, och varje kusk får bara sina egna tider. <strong>Skicka inte</strong> hoppar över utskicket.</li>
                        <li><strong>Omkörning:</strong> På Precision-resultat finns knappen <strong>Meddela omkörning</strong>. Den skickar ett meddelande till de kvalificerade ekipagen (du kan ändra texten först) och en kort text till speakern.</li>
                        <li><strong>Paus:</strong> När tävlingen pausas får funktionärer och kuskar med notiser påslagna en notis, och alla sidor visar en röd banner med orsak, vem som pausade och var. Start- och stoppknappar visar <em>Pausad</em>.</li>
                        <li><strong>Var slår man på notiser?</strong> Funktionärer: överst på startsidan Funktionär. Kuskar: kortet <em>Notiser</em> i Min Portal. Alla: <strong>Mitt konto &gt; Notiser på den här enheten</strong> (följer de tävlingar man slår på notiser för i portalen). Appens ägare sparar först nyckeln under <strong>Admin &gt; Inställningar &gt; Push-notiser</strong>; innan dess står det att notiser inte är tillgängliga ännu.</li>
                        <li><strong>Vilka notiser får man?</strong> Under Notiser väljer man ämnen. Funktionärer och veterinärer: ändrade starttider, meddelanden, paus, veterinärbeslut och ändrade deklarationer. Kuskar får bara det som rör dem; vid paus får kuskarna en kort notis med orsaken.</li>
                        <li><strong>Viktigt och e-post:</strong> Meddelanden markerade Viktigt går ut som nödvändiga notiser, även till dem som stängt av meddelandenotiser. Ett nödvändigt e-postutskick kräver att du anger en orsak. Kryssrutorna vid utskick (meddelande, notis, e-post) visar antal mottagare och ingen får samma sak två gånger.</li>
                        <li><strong>Omkörning:</strong> Knappen <strong>Meddela omkörning</strong> (admin och TD) skickar meddelande och notis till de kvalificerade och ett meddelande till speakern.</li>
                        <li><strong>Veterinär drar tillbaka:</strong> Veterinären kan dra tillbaka en strykning som väntar på domarkollegiet; kusken får veta det.</li>
                        <li><strong>iPhone och iPad:</strong> Kräver iOS 16.4 eller senare. Tryck Dela i Safari, välj <em>Lägg till på hemskärmen</em>, öppna appen från ikonen och slå sedan på notiser.</li>
                    </ul>
                </div>
            </section>

            <section>
                <h3 class="font-bold text-lg mb-2 text-yellow-700 border-l-4 border-yellow-500 pl-2">Prisutdelning</h3>
                <p class="text-gray-700 mb-2">En vy speciellt anpassad för prisutdelaren eller speakern vid ceremonin.</p>
                
                <div class="bg-white border rounded p-4 shadow-sm">
                    <h4 class="font-bold text-gray-800 mb-2">Funktioner:</h4>
                    <ol class="list-decimal list-inside text-sm text-gray-700 space-y-2">
                        <li><strong>Podium-vy:</strong> De 3 främsta presenteras med stora kort.</li>
                        <li><strong>"På plats"-kryssrutan:</strong> 
                            <span class="block ml-5 text-gray-600">Klicka i rutan "PÅ PLATS" när kusken anländer till prisutdelningen. Detta hjälper er se vilka som saknas innan ceremonin startar.</span>
                        </li>
                    </ol>
                </div>
            </section>

             <section>
                <h3 class="font-bold text-lg mb-2 text-indigo-700 border-l-4 border-indigo-500 pl-2">📺 Publikskärmar (Monitors)</h3>
                <p class="text-gray-700 mb-2">
                    Systemet har tre speciella "Monitor"-sidor som är designade för att visas på stora TV-skärmar i cafeterian eller publikområdet.
                    Dessa sidor roterar automatiskt innehåll och visar alltid det senaste.
                </p>
                <div class="bg-indigo-50 p-4 rounded-lg border border-indigo-200">
                    <ul class="list-disc list-inside text-sm text-gray-700 space-y-2">
                        <li><strong>Monitor Dressyr:</strong> Visar pågående ekipage, aktuella poäng och en rullande resultatlista.</li>
                        <li><strong>Monitor Maraton:</strong> Visar en karta med liverapportering från hindren. Publikfavorit!</li>
                        <li><strong>Monitor Precision:</strong> Visar tid, fel och <strong>Maximaltid</strong> (gräns för uteslutning) direkt vid målgång.</li>
                    </ul>
                    <p class="text-xs text-indigo-800 mt-2 font-bold">
                        Tips: Monitorerna används i första hand i <strong>Live-läge</strong>. I <strong>Fältläge</strong> döljs de normalt från menyn för att förenkla driften.
                    </p>
                </div>
            </section>
        </div>
            `;

    case 'overview':
      return `
        <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">Översikt</h2>
        <div class="space-y-8">
            <section>
                <div class="bg-gradient-to-r from-blue-50 to-indigo-50 p-6 rounded-xl border border-blue-100 text-center relative overflow-hidden">
                    <div class="absolute top-2 right-2 opacity-10">
                        <span class="text-6xl">🌍</span>
                    </div>
                    <h3 class="text-2xl font-bold text-blue-900 mb-2">Välkommen till Tävlingssystemet!</h3>
                    <p class="text-gray-700 max-w-2xl mx-auto mb-4">
                        Detta är ett heltäckande system för att hantera sportkörningstävlingar – från anmälan till slutresultat.
                        Systemet är <strong>molnbaserat</strong> vilket innebär att alla ändringar sker i realtid ("Live").
                    </p>
                    <div class="inline-flex items-center gap-2 bg-white dark:bg-gray-800 px-3 py-1 rounded-full border border-blue-200 dark:border-blue-800 text-sm text-blue-800 dark:text-blue-300 shadow-sm">
                        <span>💡 Tips: Byt språk (🇸🇪/🇬🇧) på flaggan. Använd månen 🌙 i menyn för Mörkt Läge.</span>
                    </div>
                </div>
            </section>

            <!-- LATHUNDAR SNABBLÄNKAR -->
            <section class="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/40 dark:to-indigo-950/40 p-5 rounded-xl border border-blue-200 dark:border-blue-800/60 shadow-xs">
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                    <div>
                        <h4 class="font-bold text-base text-gray-900 dark:text-gray-100 flex items-center gap-2">
                            <span>🖨️</span> Fältlathundar & Snabbguider (A4 PDF)
                        </h4>
                        <p class="text-xs text-gray-600 dark:text-gray-300">
                            1-sidiga utskrivbara lathundar för funktionärer och domare vid banan:
                        </p>
                    </div>
                </div>
                <div class="flex flex-wrap gap-2">
                    <button type="button" data-role-pdf="dressage" class="px-3 py-1.5 bg-white dark:bg-gray-800 hover:bg-purple-50 dark:hover:bg-purple-950/50 text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-800 rounded-lg text-xs font-semibold shadow-xs transition-all flex items-center gap-1 active:scale-95">
                        📄 Dressyrskrivare
                    </button>
                    <button type="button" data-role-pdf="marathon-obstacle" class="px-3 py-1.5 bg-white dark:bg-gray-800 hover:bg-blue-50 dark:hover:bg-blue-950/50 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-lg text-xs font-semibold shadow-xs transition-all flex items-center gap-1 active:scale-95">
                        ⏱️ Hinderdomare Maraton
                    </button>
                    <button type="button" data-role-pdf="marathon-stages" class="px-3 py-1.5 bg-white dark:bg-gray-800 hover:bg-green-50 dark:hover:bg-green-950/50 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-800 rounded-lg text-xs font-semibold shadow-xs transition-all flex items-center gap-1 active:scale-95">
                        🏁 Tidtagare Sträckor
                    </button>
                    <button type="button" data-role-pdf="precision" class="px-3 py-1.5 bg-white dark:bg-gray-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 text-indigo-800 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 rounded-lg text-xs font-semibold shadow-xs transition-all flex items-center gap-1 active:scale-95">
                        🎾 Precision
                    </button>
                    <button type="button" data-role-pdf="admin_checklist" class="px-3 py-1.5 bg-white dark:bg-gray-800 hover:bg-purple-50 dark:hover:bg-purple-950/50 text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-800 rounded-lg text-xs font-semibold shadow-xs transition-all flex items-center gap-1 active:scale-95">
                        📥 Arrangörschecklista
                    </button>
                    <button type="button" data-role-pdf="secretariat" class="px-3 py-1.5 bg-white dark:bg-gray-800 hover:bg-amber-50 dark:hover:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 rounded-lg text-xs font-semibold shadow-xs transition-all flex items-center gap-1 active:scale-95">
                        📋 Sekretariat
                    </button>
                    <button type="button" data-role-pdf="observer" class="px-3 py-1.5 bg-white dark:bg-gray-800 hover:bg-red-50 dark:hover:bg-red-950/50 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800 rounded-lg text-xs font-semibold shadow-xs transition-all flex items-center gap-1 active:scale-95">
                        🛑 Observatör
                    </button>
                </div>
            </section>

            <section>
                <h3 class="font-bold text-lg mb-2 text-indigo-700 border-l-4 border-indigo-500 pl-2">🏠 Huvudmenyn & Navigering</h3>
                <p class="text-gray-700 mb-2">
                    När du startar systemet hamnar du i <strong>Hubben</strong>. Här ser du en lista över alla tillgängliga tävlingar.
                </p>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="bg-white p-4 rounded border shadow-sm">
                        <h4 class="font-bold text-gray-800 mb-1">Hitta din tävling</h4>
                        <ul class="list-disc list-inside text-sm text-gray-600 space-y-1">
                            <li>Använd <strong>Sök-rutan</strong> för att filtrera på namn eller plats.</li>
                            <li>Klicka på kortet för att öppna tävlingen.</li>
                            <li>Knappen <strong>"Öppna"</strong> går till publik/deltagarvyn.</li>
                            <li>Knappen <strong>"Admin"</strong> (om du är behörig) går till administrationsvyn.</li>
                        </ul>
                    </div>
                    <div class="bg-white p-4 rounded border shadow-sm">
                        <h4 class="font-bold text-gray-800 mb-1">Tips & Tricks</h4>
                        <ul class="list-disc list-inside text-sm text-gray-600 space-y-1">
                            <li><strong>Gå tillbaka:</strong> Klicka alltid på loggan (längst upp till vänster) för att återgå till Hubben och byta tävling.</li>
                            <li><strong>Skapa Nytt:</strong> (Endast Admin) Använd formuläret i Hubben för att starta en ny tävling.</li>
                            <li><strong>Offline-stöd:</strong> I menyraden visas "Offline" eller "Synkar...", och nere till höger en orange köknapp när något väntar. Redan laddade inmatningsvyer kan köa resultat lokalt; vänta tills den orange köknappen nere till höger (☁️ Synkar...) är borta innan du stänger sidan.</li>
                            <li><strong>Mobil & Surfplatta:</strong> Systemet anpassar sig automatiskt. På mobiler visas listor som klickbara "Kort", medan surfplattor och datorer visar klassiska tabeller för bättre överblick.</li>
                        </ul>
                    </div>
                </div>
            </section>

            <section class="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
                <!-- PRE -->
                <div class="space-y-4">
                    <div class="flex items-center gap-2 mb-2">
                        <div class="bg-blue-600 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold">1</div>
                        <h4 class="font-bold text-gray-800">Före Tävling</h4>
                    </div>
                    <div class="bg-white p-4 rounded shadow-sm border-l-4 border-blue-600">
                        <p class="text-sm font-bold text-gray-900">Administratören</p>
                        <p class="text-sm text-gray-600">Skapar tävling, importerar ekipage och schemalägger starttider.</p>
                    </div>
                    <div class="flex justify-center text-gray-400">↓</div>
                     <div class="bg-white p-4 rounded shadow-sm border-l-4 border-amber-500">
                        <p class="text-sm font-bold text-gray-900">Kusken (Min Portal)</p>
                        <p class="text-sm text-gray-600">Loggar in, kontrollerar sina uppgifter och gör ev. ändringar (hästbyte, groom) inför start.</p>
                    </div>
                </div>

                <!-- DURING -->
                <div class="space-y-4">
                    <div class="flex items-center gap-2 mb-2">
                         <div class="bg-green-600 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold">2</div>
                        <h4 class="font-bold text-gray-800">Under Tävling</h4>
                    </div>
                     <div class="bg-white p-4 rounded shadow-sm border-l-4 border-purple-600">
                        <p class="text-sm font-bold text-gray-900">Domare (Dressyr)</p>
                        <p class="text-sm text-gray-600">Dömer digitalt i iPad. Resultat skickas direkt till molnet.</p>
                    </div>
                     <div class="bg-white p-4 rounded shadow-sm border-l-4 border-green-600">
                        <p class="text-sm font-bold text-gray-900">Funktionär (Maraton/Precision)</p>
                        <p class="text-sm text-gray-600">Startar klockor och registrerar rivningar. Allt synkas live.</p>
                    </div>
                     <div class="bg-white p-4 rounded shadow-sm border-l-4 border-indigo-600">
                        <p class="text-sm font-bold text-gray-900">Speaker</p>
                        <p class="text-sm text-gray-600">Följer dramatiken live via Dashboard och ser mellantider.</p>
                    </div>
                </div>

                <!-- POST -->
                <div class="space-y-4">
                    <div class="flex items-center gap-2 mb-2">
                         <div class="bg-gray-800 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold">3</div>
                        <h4 class="font-bold text-gray-800">Efter Tävling</h4>
                    </div>
                     <div class="bg-white p-4 rounded shadow-sm border-l-4 border-gray-800">
                        <p class="text-sm font-bold text-gray-900">Publik & Kusk</p>
                        <p class="text-sm text-gray-600">Ser slutresultat online. Kusken laddar ner sitt protokoll.</p>
                    </div>
                     <div class="bg-white p-4 rounded shadow-sm border-l-4 border-blue-900">
                        <p class="text-sm font-bold text-gray-900">Admin (Arkivering)</p>
                        <p class="text-sm text-gray-600">Låser tävlingen och exporterar officiella resultatlistor (PDF).</p>
                    </div>
                </div>
            </section>
        </div>
        `;

    case 'admin':
      return `
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3 mb-6">
          <div>
            <h2 class="text-xl font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
              <span>⚙️</span> För Administratörer & Arrangörer
            </h2>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Komplett vägledning för att sätta upp, konfigurera och leda en tävling från grunden.</p>
          </div>
          <div class="flex flex-wrap gap-2 self-start sm:self-auto">
            <button type="button" data-role-pdf="admin_checklist" class="px-3.5 py-1.5 bg-purple-700 hover:bg-purple-800 text-white rounded-lg text-xs font-semibold shadow-xs transition-all flex items-center gap-1.5 active:scale-95">
              <span>📥</span> Arrangörschecklista (A4 PDF)
            </button>
            <button type="button" data-role-pdf="secretariat" class="px-3.5 py-1.5 bg-amber-700 hover:bg-amber-800 text-white rounded-lg text-xs font-semibold shadow-xs transition-all flex items-center gap-1.5 active:scale-95">
            <span>📋</span> Lathund Sekretariat (A4 PDF)
          </button>
          </div>
        </div>

        <div class="space-y-8">

          <!-- KRONOLOGISK CHECKLISTA FÖR ATT SÄTTA UPP EN TÄVLING -->
          <section class="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/40 dark:to-indigo-950/40 p-5 rounded-xl border border-blue-200 dark:border-blue-800/60 shadow-xs">
            <h3 class="font-bold text-lg text-blue-900 dark:text-blue-200 mb-1 flex items-center gap-2">
              <span>🧭</span> Steg-för-steg: Sätta upp en tävling från scratch
            </h3>
            <p class="text-xs text-gray-600 dark:text-gray-300 mb-4">
              Följ denna kronologiska checklista för att konfigurera tävlingen rätt från början:
            </p>

            <div class="space-y-3">

              <!-- FAS 1 -->
              <details class="manual-accordion" open>
                <summary>
                  <span class="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100">
                    <span class="bg-blue-600 text-white w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold">1</span>
                    <strong>Fas 1: Skapa tävling & Importera anmälningar från TDB</strong>
                    <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">(1–2 veckor före)</span>
                  </span>
                  <span class="text-gray-400 text-xs">▼</span>
                </summary>
                <div class="manual-accordion-content text-xs text-gray-700 dark:text-gray-300 space-y-2">
                  <p><strong>1. Skapa tävlingen:</strong> Gå till <em>Start / Hubben</em>. Ange tävlingens namn, datum och plats. Om du arrangerade förra året kan du välja <em>"Basera på tidigare tävling"</em> för att kopiera klasser och hinderparametrar direkt.</p>
                  <p><strong>2. Hämta anmälningsfilen från TDB:</strong> Logga in på Svenska Ridsportförbundets Tävlingsdatabas (TDB). Gå in på tävlingen -> <em>Hantera anmälningar</em> -> Klicka på <em>"Exportera anmälningar som XML för Equipe"</em> (filen slutar på <code>.eqentries.xml</code>).</p>
                  <p><strong>3. Importera deltagare:</strong> Gå till <em>Admin > Deltagare</em> och klicka på <em>"Importera XML"</em>. Alla ekipage, hästar, klubbar och klasser läggs in automatiskt.</p>
                  <p><strong>4. Manuella kontroller:</strong> Klicka på ett ekipage vid efteranmälningar eller strykningar. Kryssa i <em>"Parakusk"</em> för ekipage som har beviljad para-anpassning, och kontrollera ponnykategorier.</p>
                </div>
              </details>

              <!-- FAS 2 -->
              <details class="manual-accordion">
                <summary>
                  <span class="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100">
                    <span class="bg-purple-600 text-white w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold">2</span>
                    <strong>Fas 2: Domare & Funktionärer</strong>
                    <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">(1 vecka före)</span>
                  </span>
                  <span class="text-gray-400 text-xs">▼</span>
                </summary>
                <div class="manual-accordion-content text-xs text-gray-700 dark:text-gray-300 space-y-2">
                  <p><strong>1. Lägg in funktionärer:</strong> Under <em>Admin > Funktionärer</em> lägger du in alla som ska arbeta. Tilldela deras huvudsakliga roll (t.ex. "Dressyr - C", "Hinderdomare", "Start A", "Sekretariat").</p>
                  <p><strong>2. ICE, Kost & Kläder:</strong> Registrera telefonnummer, ICE-kontakt och eventuella kostavvikelser/allergier för catering.</p>
                  <p><strong>3. Tilldela dressyrdomare per klass:</strong> Gå till <em>Admin > Dressyr</em>. Välj vilka domare som dömer respektive klass (C, E, B). Det är detta som styr vilka protokoll domarna ser på sina iPads.</p>
                  <p><strong>4. Dressyrprogram:</strong> Kontrollera att rätt dressyrprogram är valt för klassen. Systemet har officiella program inbyggda. Vid specialprogram kan du ladda upp SvRF:s officiella PDF under programhanteringen.</p>
                </div>
              </details>

              <!-- FAS 3 -->
              <details class="manual-accordion">
                <summary>
                  <span class="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100">
                    <span class="bg-green-600 text-white w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold">3</span>
                    <strong>Fas 3: Banfakta för Maraton & Precision (Banbyggnad)</strong>
                    <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">(1–2 dagar före)</span>
                  </span>
                  <span class="text-gray-400 text-xs">▼</span>
                </summary>
                <div class="manual-accordion-content text-xs text-gray-700 dark:text-gray-300 space-y-2">
                  <p><strong>1. Maratonsträckor & Tempon:</strong> Gå till <em>Admin > Maraton</em>. Fyll i sträckornas längd i meter och tempo för Sträcka A, ev. Transport, och Sträcka B. Idealtider, minimitider och maxtider beräknas automatiskt för häst, ponny och para. Transportsträckan har bara en tidsgräns (dubbla maxtiden) och inga tidsstraff.</p>
                  <p><strong>2. Maratonhinder, Portar & Bollar:</strong> Gå till hinderhanteringen i maraton. Lägg upp Hinder 1–N. Ange antal portar (A–F). <strong>Viktigt:</strong> Om hindret har rivningsbara element eller bollar, kryssa i rutan <em>☑️ "Rivningsbart element / boll"</em> på hindret. Det är denna inställning som gör att fältet för rivning/boll visas för hinderdomaren!</p>
                  <p><strong>3. Maratonkarta (Valfritt men uppskattat):</strong> Länka in tävlingens banskiss och klicka ut positioner för Hinder 1–N, Start och Mål. Då visar publikskärmen liverapportering direkt på kartan.</p>
                  <p><strong>4. Precision:</strong> Gå till <em>Admin > Precision</em>. Ange banans längd och tempo -> systemet beräknar tillåten tid och maxtid automatiskt. Portbredden är vagnens spårvidd plus klassens tillägg enligt TR (t.ex. Lätt B 35 cm, Lätt A 30 cm, Barn 45 cm). Tillägget kan ändras per klass.</p>
                </div>
              </details>

              <!-- FAS 4 -->
              <details class="manual-accordion">
                <summary>
                  <span class="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100">
                    <span class="bg-amber-600 text-white w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold">4</span>
                    <strong>Fas 4: Starttider & Schemaläggning</strong>
                    <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">(Dagen innan start)</span>
                  </span>
                  <span class="text-gray-400 text-xs">▼</span>
                </summary>
                <div class="manual-accordion-content text-xs text-gray-700 dark:text-gray-300 space-y-2">
                  <p><strong>1. Generera starttider:</strong> Gå till <em>Admin > Starttider</em>. Välj disciplin och klasser, ange startintervall (t.ex. 8 eller 10 min) och klicka <em>"Generera"</em>.</p>
                  <p><strong>2. Drag-and-Drop:</strong> Dra och släpp rader i listan för att lösa kuskönskemål eller dubbelstarter (samma kusk med två ekipage).</p>
                  <p><strong>3. Pauser:</strong> Klicka på kaffekoppen ☕ på en rad för att lägga in domarpaus eller banvård. Efterföljande tider flyttas automatiskt framåt.</p>
                  <p><strong>4. Publicera:</strong> Klicka på <em>"Spara"</em> och slå på reglaget <em>"Publicera startlista"</em> så att kuskarna ser tiderna i Min Portal och på publika skärmar.</p>
                </div>
              </details>

              <!-- FAS 5 -->
              <details class="manual-accordion">
                <summary>
                  <span class="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100">
                    <span class="bg-indigo-600 text-white w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold">5</span>
                    <strong>Fas 5: Tävlingsdagen (Mätning, Besiktning & Deklarering)</strong>
                    <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">(Tävlingsmorgonen)</span>
                  </span>
                  <span class="text-gray-400 text-xs">▼</span>
                </summary>
                <div class="manual-accordion-content text-xs text-gray-700 dark:text-gray-300 space-y-2">
                  <p><strong>1. Vagnbreddsmätning:</strong> Öppna fliken <em>Vagnbredd</em>. Mät och registrera spårvidd. Systemet validerar automatiskt bredden mot TR Bilaga 2 och varnar om vagnen är för smal.</p>
                  <p><strong>2. Veterinärbesiktning:</strong> Veterinären/funktionären använder sidan <em>Veterinärbesiktning</em> för initial besiktning, viloboxpuls (varnar automatiskt vid över 64 bpm) och slutbesiktning.</p>
                  <p><strong>3. Låsning av Kuskportalen (Deklarering):</strong> Under <em>Admin > Inställningar</em> sätter du timer för automatisk låsning av häst-/groombyte (standard: 60 min före start). Vid behov kan du klicka <em>"Lås alla ändringar NU"</em>.</p>
                  <p><strong>4. Tävlingsläge:</strong> Se till att tävlingen står i läget <strong>Live</strong> i inställningarna så att alla live-funktioner och monitorer är igång.</p>
                </div>
              </details>

              <!-- FAS 6 -->
              <details class="manual-accordion">
                <summary>
                  <span class="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100">
                    <span class="bg-emerald-600 text-white w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold">6</span>
                    <strong>Fas 6: Slutkontroll, Prisutdelning & Arkivering</strong>
                    <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">(Efter avslutad tävling)</span>
                  </span>
                  <span class="text-gray-400 text-xs">▼</span>
                </summary>
                <div class="manual-accordion-content text-xs text-gray-700 dark:text-gray-300 space-y-2">
                  <p><strong>1. Resultatgranskning:</strong> Kontrollera på grenarnas resultatsidor (Resultat Dressyr, Maraton och Precision) att alla resultat är finaliserade. Vid eventuella protester eller domarkorrigeringar häver en behörig användare finaliseringen med knappen <em>${btn('undo', 'sv')}</em> på respektive grens resultatsida, rättar (t.ex. i Sekretariat) och finaliserar igen. <em>Totalresultat</em> visar sammanställningen.</p>
                  <p><strong>2. Skriv ut resultatlistor:</strong> Skriv ut officiella resultatlistor (A4 PDF) inför prisutdelningen.</p>
                  <p><strong>3. Avsluta & Arkivera:</strong> När prisutdelningen är genomförd går du till fliken <em>📦 Arkivering</em> i Admin och klickar på <em>"🏁 Avsluta Tävling"</em>. Detta fryser resultaten och sparar en permanent kopia av resultatlistan. Ska något ändras efteråt måste tävlingen öppnas igen.</p>
                  <p><strong>4. Rapportera till TDB:</strong> TDB har ingen filimport för sportkörning, så DriveLive skapar ingen resultatfil. Öppna <em>Rapportcenter</em> -> <em>TDB-underlag</em>: där finns varje lista i TDB:s ordning med placeringskoder (99 = utesluten/utgått/struken efter start, 98/1 = clear round, 0 = ensam i klassen), licensnummer att kopiera och en PDF. Skriv in resultaten i TDB för hand och skicka dem för granskning senast 5 dagar efter tävlingen.</p>
                </div>
              </details>

            </div>
          </section>

          <!-- FÖRDJUPNING 1: ANMÄLAN & DATA -->
          <section>
            <h3 class="font-bold text-lg mb-2 text-blue-700 border-l-4 border-blue-500 pl-2">2. Administrationspanelen & Deltagarhantering</h3>
            <p class="text-gray-700 mb-2">Gå till <strong>Admin</strong> i menyn. Här finns huvudverktygen för den löpande administrationen:</p>
            
            <div class="space-y-6">
              <div class="bg-white border rounded-lg p-4 shadow-sm">
                <h4 class="font-bold text-gray-800 text-base mb-2">📋 Deltagare & Equipe/TDB XML-import</h4>
                <ul class="list-disc list-inside text-sm text-gray-600 ml-2 space-y-1">
                  <li><strong>TDB-export:</strong> Hämta filen <code>.eqentries.xml</code> från TDB genom att exportera anmälningarna. Ladda upp den här för att skapa alla ekipage direkt.</li>
                  <li><strong>Redigera ekipage:</strong> Klicka på ett ekipage i listan för att ändra kusk, häst, hästlicensnummer, klubb eller klass.</li>
                  <li><strong>Strykningar & Efteranmälningar:</strong> Ändra status till "Struken" direkt i listan, eller klicka "Nytt ekipage" för manuell registrering av sena starter.</li>
                  <li><strong>Betalningsstatus:</strong> Notera "Betald", "Delbetald" eller "Obetald" samt eventuell summa för sekretariatets egen ekonomiska kontroll.</li>
                </ul>

                <h5 class="text-sm font-bold text-gray-700 mt-4 mb-1">Domare & Funktionärer</h5>
                <ul class="list-disc list-inside text-sm text-gray-600 ml-2 space-y-1">
                  <li><strong>Behörighet:</strong> Funktionärer ansluter med sin rolls kod (10 tecken) under <em>Admin > Inställningar</em>. Skicka helst länken eller QR-koden, då är tävlingen redan ifylld. Koderna kan bytas och åtkomsten återkallas. Administratörer ansluts inte med kod (det finns ingen admin-PIN): bjud in dem med e-post under <em>Funktionärer > Bjud in administratör</em>.</li>
                  <li><strong>Registrering:</strong> Lägg in domare och funktionärer här så att de kan kopplas till rätt position och uppdrag.</li>
                  <li><strong>Säkerhet & Logistik:</strong> Lägg in ICE-telefonnummer, kostavvikelser/allergier och tröjstorlek.</li>
                  <li><strong>Utskriftsrapporter:</strong> Under <em>Rapporter</em> kan du exportera telefonlistor, funktionärslistor per hinder/plats, incheckningslistor och sammanställning för catering (PDF och CSV).</li>
                </ul>
              </div>

              <!-- KOMMUNIKATION -->
              <div class="bg-white border rounded-lg p-4 shadow-sm">
                <h4 class="font-bold text-gray-800 text-base mb-2">📢 Kommunikation & Banskisser</h4>
                <p class="text-sm text-gray-600 mb-2">Skicka realtidsmeddelanden till kuskarnas personliga portaler:</p>
                <ul class="list-disc list-inside text-sm text-gray-600 ml-2 space-y-1 mb-3">
                  <li><strong>Broadcast (Alla):</strong> Skicka en notis till samtliga deltagare (t.ex. vid tidsförskjutning eller banändring).</li>
                  <li><strong>Riktat meddelande:</strong> Välj målgruppen <em>"Valda kuskar"</em> och bocka i en eller flera kuskar i checklistan för riktad information (t.ex. påminnelse om pass/vaccinationskontroll).</li>
                  <li><strong>Dokument & Banskisser:</strong> Länka in publika PDF-filer eller Google Drive-länkar som kuskarna kan öppna direkt i sin mobilapp under <em>Dokument</em>.</li>
                </ul>
              </div>

              <!-- E-POST -->
              <div class="bg-white border rounded-lg p-4 shadow-sm">
                <h4 class="font-bold text-gray-800 text-base mb-2">✉️ E-post</h4>
                <ul class="list-disc list-inside text-sm text-gray-600 ml-2 space-y-1">
                  <li><strong>Så fungerar det:</strong> Kryssa i <em>"Skicka även som e-post"</em> när du skriver ett meddelande. Du ser direkt hur många som får det, hur många som avregistrerat sig och hur många som saknar e-postadress. Vid ändrade starttider på en publicerad lista kan du också mejla berörda kuskar; varje kusk får bara sina egna tider.</li>
                  <li><strong>Avsändare och svar:</strong> All e-post går från appens adress med <em>"Klubbnamn via DriveLive"</em> som avsändare. Under <em>Kommunikation &gt; E-post</em> anger du avsändarnamn och en svarsadress (Reply-To) som svaren går till.</li>
                  <li><strong>Bekräfta svarsadressen:</strong> Tryck <em>"Bekräfta adressen"</em>. Ett mejl med en länk skickas till adressen; svarsadressen används först när länken är öppnad. Tills dess är den markerad som <em>inte bekräftad</em>.</li>
                  <li><strong>Viktigt meddelande:</strong> Går även till dem som avregistrerat sig från vanliga utskick. Använd bara för sådant som måste nå fram.</li>
                  <li><strong>Inte inkopplat ännu:</strong> Om appens e-posttjänst inte är inkopplad köas mejlen med status <em>"Väntar: inte konfigurerat"</em> och skickas när tjänsten kopplas in. Meddelandet i appen publiceras ändå direkt.</li>
                  <li><strong>Testmejl och logg:</strong> <em>"Skicka testmejl till mig"</em> provar utskicket. Listan <em>Senaste utskick</em> visar status, antal skickade och eventuella fel.</li>
                </ul>
              </div>
              <!-- NOTISER -->
              <div class="bg-white border rounded-lg p-4 shadow-sm">
                <h4 class="font-bold text-gray-800 text-base mb-2">🔔 Notiser</h4>
                <ul class="list-disc list-inside text-sm text-gray-600 ml-2 space-y-1">
                  <li><strong>Så fungerar det:</strong> Kuskar och funktionärer slår på notiser själva under <em>Notiser</em> i kuskportalen eller på funktionärssidan och väljer vad de vill ha: ändrade starttider, meddelanden, paus, veterinärbeslut och (för sekretariat och TD) ändrade deklarationer. Du kan skicka en testnotis och stänga av notiser på enheten.</li>
                  <li><strong>Ändrade starttider:</strong> När du ändrar tider på en publicerad lista går en notis till berörda kuskar, och varje kusk får bara sina egna tider. Meddelandet du kan skicka efter ändringen ger ingen dubbel notis.</li>
                  <li><strong>iPhone:</strong> Notiser kräver iOS 16.4 eller senare och att appen ligger på hemskärmen: tryck på Dela-knappen, välj <em>Lägg till på hemskärmen</em>, öppna appen från ikonen och slå på notiser där.</li>
                  <li><strong>Inte aktiverat ännu:</strong> Tills superadmin sparat en VAPID-nyckel och slagit på notiser visas <em>"Notiser är inte aktiverade ännu"</em>. Allt annat i appen fungerar som vanligt.</li>
                </ul>
              </div>
              <!-- INSTÄLLNINGAR -->
              <div class="bg-white border rounded-lg p-4 shadow-sm">
                <h4 class="font-bold text-gray-800 text-base mb-2">⚙️ Inställningar & Tävlingsprofil</h4>
                <div class="space-y-2 text-sm text-gray-600">
                  <p><strong>Tävlingsprofil (FEI/Nationell):</strong> Styr språk, rubriker, PDF-mallar och publiktexter.</p>
                  <p><strong>Tävlingslogga:</strong> Ladda upp arrangörens eller tävlingens logotyp. Den visas automatiskt i sidhuvudet på alla officiella PDF-protokoll och resultatlistor.</p>
                  <p><strong>Tävlingsläge:</strong> Välj <strong>Live</strong> för full realtidssynk med monitorer och klockor. Välj <strong>Fältläge</strong> vid enklare tävlingar där sekretariatet matar in resultaten manuellt.</p>
                  <p><strong>Digital Deklarering & Låsning:</strong> Ställ in hur många minuter före start kuskportalen automatiskt ska låsas för ändringar (standard 60 min). Knappen <em>"Lås alla ändringar NU"</em> låser omedelbart.</p>
                </div>
              </div>
            </div>
          </section>

          <!-- FÖRDJUPNING 2: BANFAKTA & HINDER -->
          <section>
            <h3 class="font-bold text-lg mb-2 text-orange-700 border-l-4 border-orange-500 pl-2">3. Banfakta & Hinderkonfiguration</h3>
            <p class="text-gray-700 mb-2">Ställ in banans mått och regler innan tävlingen startar så att resultatmotorn räknar korrekt:</p>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-700">
              <div class="bg-orange-50 p-4 rounded border border-orange-200">
                <strong class="block text-orange-900 mb-2">🌲 Maraton: Sträckor, Hinder & Bollar</strong>
                <ul class="list-disc list-inside space-y-1.5 text-xs text-gray-700">
                  <li><strong>Sträckor:</strong> Ange längd (meter) och tempo (m/min) för Sträcka A, ev. Transport och Sträcka B. TR-tempot för klassen visas som hjälp. Idealtid, maxtid och tidsfönster beräknas automatiskt.</li>
                  <li><strong>Hinder & Portar:</strong> Skapa hindren 1–8 och sätt antal portar per hinder (t.ex. 5 för A–E eller 6 för A–F).</li>
                  <li><strong>Rivningsbara bollar:</strong> Bocka i <em>"Rivningsbart element / boll"</em> på de hinder som har bollar. Då visas fältet för rivningar i hinderdomarens vy, med 2 straffpoäng per rivet element.</li>
                  <li><strong>Tidskontroll:</strong> Använd <em>Maraton > Beräkna tider</em> för att skriva ut en komplett kontrollista med idealtider och fönster för alla klasser.</li>
                </ul>
              </div>
              <div class="bg-purple-50 p-4 rounded border border-purple-200">
                <strong class="block text-purple-900 mb-2">🏁 Precision: Banlängd, Maxtid & Bredd</strong>
                <ul class="list-disc list-inside space-y-1.5 text-xs text-gray-700">
                  <li><strong>Banans längd & Tempo:</strong> Ange längd (m) och hastighet (m/min). Tillåten tid och maxtid räknas ut automatiskt.</li>
                  <li><strong>Portbredd:</strong> Spårvidd plus klassens tillägg enligt TR (t.ex. Lätt B 35 cm, Lätt A 30 cm, Barn 45 cm). Kan ändras per klass och per port.</li>
                  <li><strong>Tidsfel:</strong> 0,5 straffpoäng per sekund över tillåten tid, med två decimaler (TR V 525.9). Över dubbla tillåtna tiden blir ekipaget uteslutet; i Lätt B Barn räcker det att tillåten tid överskrids.</li>
                  <li><strong>Konrivning:</strong> Standardstraff är 3 straffpoäng per nedslag.</li>
                </ul>
              </div>
            </div>
          </section>

          <!-- SPECIALKLASSER MARATON -->
          <section>
            <h3 class="font-bold text-lg mb-2 text-indigo-700 border-l-4 border-indigo-500 pl-2">4. Maraton: Specialklasser & Undantag</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div class="bg-white border rounded p-4 shadow-sm">
                <strong class="text-indigo-900 block font-bold mb-1">1. Sammanslagna Klasser (Mixed)</strong>
                <p class="text-xs text-gray-600 mb-2">Om en klass innehåller både ponny och häst väljer du rätt nivå under <em>"Tempo-mall"</em> (t.ex. Lätt B). Systemet tilldelar då automatiskt rätt idealtid till respektive kategori.</p>
              </div>
              <div class="bg-white border rounded p-4 shadow-sm">
                <strong class="text-indigo-900 block font-bold mb-1">2. Parakuskar</strong>
                <p class="text-xs text-gray-600 mb-2">Kryssa i rutan <em>"Parakusk"</em> på ekipaget. Föraren får då automatiskt sin klass nivå med reglementsenlig Para-tempoanpassning.</p>
              </div>
              <div class="bg-white border rounded p-4 shadow-sm">
                <strong class="text-indigo-900 block font-bold mb-1">3. Barnklasser</strong>
                <p class="text-xs text-gray-600 mb-2">Välj <em>"Barnklass"</em> i tempomallen. Detta ger automatiskt 10 minuter obligatorisk Warm-up (fast tid) och reglementsenliga tempon.</p>
              </div>
              <div class="bg-white border rounded p-4 shadow-sm">
                <strong class="text-indigo-900 block font-bold mb-1">4. Warm-up (istället för Sträcka A)</strong>
                <p class="text-xs text-gray-600 mb-2">Fyll i minuter i rutan <em>"Fast tid (WU)"</em> under maratoninställningar (t.ex. 30 min). Sträckan döps automatiskt om till Warm-up utan tidsfönster.</p>
              </div>
            </div>
          </section>

          <!-- DRESSYR & PROGRAM -->
          <section>
            <h3 class="font-bold text-lg mb-2 text-purple-700 border-l-4 border-purple-500 pl-2">5. Dressyr: Program, Domare & PDF-import</h3>
            <div class="bg-purple-50 p-4 rounded-lg space-y-3 text-sm text-gray-700">
              <p><strong>PDF-import av protokoll:</strong> Ladda upp Ridsportförbundets officiella PDF för ett dressyrprogram. Systemet läser av momenten och skapar inmatningsprotokollet automatiskt.</p>
              <p><strong>Domarplacering:</strong> Styr vilka domare som dömer från C, E eller B per klass.</p>
              <p><strong>Clear Round / Träningsklasser:</strong> Aktivera <em>"Clear Round"</em> för att dölja decimalstraff och istället visa "Godkänd" när procenten överstiger godkänd gräns (t.ex. 60 %).</p>
            </div>
          </section>

          <!-- STARTTIDER -->
          <section>
            <h3 class="font-bold text-lg mb-2 text-blue-700 border-l-4 border-blue-500 pl-2">6. Hantera Starttider & Schemaläggning</h3>
            <div class="bg-gray-50 p-4 rounded-lg text-sm text-gray-700 space-y-2">
              <p><strong>Schemalägg starterna smidigt:</strong></p>
              <ul class="list-disc list-inside text-xs space-y-1">
                <li>Välj klasser, ange startintervall (t.ex. 10 minuter) och klicka <em>"Generera"</em>.</li>
                <li><strong>Drag-and-Drop:</strong> Ta tag i valfri rad och flytta den upp/ner för att anpassa startordningen.</li>
                <li><strong>Kaffepaus ☕:</strong> Klicka på kaffekoppen på en rad för att skjuta in en paus (t.ex. 15 minuter). Alla efterföljande starter justeras automatiskt.</li>
                <li><strong>Omvänd startordning (Precision):</strong> Låt de med sämst sammanlagda resultat starta först så att ledaren startar sist för maximal spänning.</li>
                <li><strong>Spara & Publicera:</strong> Klicka på spara och aktivera publiceringstogglen när startlistan är redo för allmänheten.</li>
                <li><strong>Ändrade tider efter publicering:</strong> Systemet frågar <em>Meddela berörda kuskar?</em> och du väljer kanal (meddelande i appen, notis, e-post). Varje kusk får bara sina egna tider.</li>
              </ul>
            </div>
          </section>

          <!-- VAGNBREDDSMÄTNING & LAG -->
          <section>
            <h3 class="font-bold text-lg mb-2 text-cyan-700 border-l-4 border-cyan-500 pl-2">7. Vagnbreddsmätning & Lagtävling</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div class="bg-white border rounded p-4 shadow-sm">
                <strong class="text-cyan-900 block font-bold mb-1">🏎️ Vagnbreddskontroll (TR Bilaga 2)</strong>
                <p class="text-xs text-gray-600 mb-2">Öppna fliken <em>Vagnbredd</em> under administrationen. Välj ekipage och ange uppmätt spårvidd i centimeter. Systemet kontrollerar måttet mot TR:s minimikrav för klassen/vagnstypen och markerar avvikelser i rött.</p>
              </div>
              <div class="bg-white border rounded p-4 shadow-sm">
                <strong class="text-cyan-900 block font-bold mb-1">🏆 Lagtävling (Teams)</strong>
                <p class="text-xs text-gray-600 mb-2">Aktivera lagtävling, skapa lag och dra kuskar från listan till lagkorten med Drag-and-Drop. Systemet matchar automatiskt klubblogga och nationsflagga baserat på lagnamn.</p>
              </div>
            </div>
          </section>

        </div>
      `;

    case 'official':
      return `
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3 mb-6">
          <h2 class="text-xl font-semibold text-gray-800 dark:text-gray-100">För Funktionärer</h2>
          <div class="flex flex-wrap gap-2">
            <button type="button" data-role-pdf="marathon-obstacle" class="px-3 py-1.5 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-xs font-semibold shadow-xs transition-all flex items-center gap-1 active:scale-95">
              <span>⏱️</span> Lathund Hinder (PDF)
            </button>
            <button type="button" data-role-pdf="marathon-stages" class="px-3 py-1.5 bg-green-700 hover:bg-green-800 text-white rounded-lg text-xs font-semibold shadow-xs transition-all flex items-center gap-1 active:scale-95">
              <span>🏁</span> Lathund Sträckor (PDF)
            </button>
            <button type="button" data-role-pdf="precision" class="px-3 py-1.5 bg-indigo-700 hover:bg-indigo-800 text-white rounded-lg text-xs font-semibold shadow-xs transition-all flex items-center gap-1 active:scale-95">
              <span>🎾</span> Lathund Precision (PDF)
            </button>
          </div>
        </div>
        <div class="space-y-8">

          <!-- ÖVERSIKT & DASHBOARD -->
          <section>
            <h3 class="font-bold text-lg mb-2 text-indigo-700 border-l-4 border-indigo-500 pl-2">Översikt & Dashboard</h3>
            <p class="text-gray-700 mb-2">När du loggar in som funktionär möts du av en <strong>Dashboard</strong> som ger dig snabb överblick.</p>
            <div class="bg-indigo-50 p-4 rounded-lg space-y-3">
              <ul class="list-disc list-inside text-sm text-gray-700 space-y-2">
                <li><strong>Nästa Start:</strong> Visar vilket ekipage som står på tur för dig (baserat på din roll och position). Klicka på knappen "Gå till..." för att komma direkt till inmatningen för det ekipaget.</li>
                <li><strong>Att Göra / Synk:</strong> Visar om du har några protokoll eller tider som inte skickats iväg än (Synk-kö).</li>
                <li><strong>Genvägar:</strong> Länkar direkt till de verktyg du behöver (t.ex. Tidtagning, Hinder, Besiktning).</li>
                <li><strong>Meddelanden:</strong> Meddelanden till funktionärer (till alla, din roll eller TD) visas överst med antal. <strong>Att uppmärksamma</strong> visas för admin, sekretariat, TD och veterinär.</li>
                <li><strong>Notiser:</strong> Ett tydligt kort överst frågar om du vill <strong>slå på notiser</strong> på den här enheten (på iPhone först efter <em>Lägg till på hemskärmen</em>).</li>
              </ul>
            </div>
          </section>
          
          <!-- MARATON: TIDER -->
          <section>
            <h3 class="font-bold text-lg mb-2 text-green-700 border-l-4 border-green-500 pl-2">Maraton: Tidtagning (Sträckor)</h3>
            <p class="text-gray-700 mb-2">Används av starter och tidtagare vid Start A, Mål A, Start B, etc.</p>
            
            <div class="bg-green-50 p-4 rounded-lg space-y-3">
              <h4 class="font-semibold text-green-800">Arbetsflöde:</h4>
              <ol class="list-decimal list-inside space-y-2 text-gray-700">
                <li>Välj <strong>Maraton Tidtagning</strong> i menyn.</li>
                <li>Välj ekipaget (du kan söka på startnummer).</li>
                <li>
                  <strong>När ekipaget passerar linjen:</strong>
                  <ul class="list-disc list-inside ml-4 mt-1 space-y-1">
                    <li>Tryck på den gröna <strong>START</strong>-knappen för sträckan när ekipaget startar, och på den röda <strong>MÅL</strong>-knappen när det går i mål.</li>
                    <li>Tiden sparas direkt. Med ↺ nollställer du sträckan.</li>
                  </ul>
                </li>
                <li>
                  <strong class="text-green-800">Aktiva Timers (Nytt):</strong>
                  <br><span class="ml-4">Längst upp finns en rullgardin som visar ALLA klockor du just nu har igång. Det gör att du kan starta ekipage #1, gå in på ekipage #2, men ändå se tiden för #1 ticka.</span>
                </li>
                <li>
                  <strong class="text-red-800">Global Paus:</strong>
                  <br><span class="ml-4">Om skärmen blir grå (svartvitt) betyder det att tävlingen är <strong>Pausad</strong> av tävlingsledningen. Ingen tidtagning ska ske då.</span>
                </li>
                <li>
                  <strong>Om du klockade fel:</strong>
                  <ul class="list-disc list-inside ml-4 mt-1 space-y-1">
                    <li>Tryck på sträckans tid (den stora klockan) för att ange tiden manuellt.</li>
                    <li>Skriv in den körda tiden som <code>mmsscc</code> (t.ex. 251530 = 25:15,30) och tryck Använd.</li>
                  </ul>
                </li>
                <li>
                  <strong>Sen start:</strong>
                  <br><span class="ml-4">Är ekipaget inte klart att starta vid sin officiella starttid: starta klockan när ekipaget verkligen startar och ange straffet för sen start (TR V 522.4: 0,25 straffpoäng per sekund, varje påbörjad räknas; FEI 963.4.1: 0,25 per sekund) i fältet <strong>${btn('marathon_stages_other_penalty_total', 'sv')}</strong> på sträckans flik. Systemet räknar inte ut det själv.</span>
                </li>
              </ol>

              <div class="mt-2 text-sm text-green-800 bg-green-100 p-2 rounded">
                <strong>Tips:</strong> Systemet räknar automatiskt ut idealtider och tidsfönster för att hjälpa dig se om ekipaget ligger bra till.
              </div>
            </div>
          </section>

          <!-- MARATON: HINDER -->
          <section>
            <h3 class="font-bold text-lg mb-2 text-blue-700 border-l-4 border-blue-500 pl-2">Maraton: Hinderdomare</h3>
            <p class="text-gray-700 mb-2">Används ute vid hindren för att logga tider och fel.</p>

            <div class="bg-blue-50 p-4 rounded-lg space-y-3">
              <h4 class="font-semibold text-blue-800">Steg-för-steg:</h4>
              <ol class="list-decimal list-inside space-y-2 text-gray-700">
                <li>Gå till <strong>Inmatning Hinder</strong>.</li>
                <li>Välj <strong>Ekipage</strong> (sökfältet överst eller pilarna « ») när ekipaget närmar sig.</li>
                <li>Kontrollera att ditt <strong>Hinder</strong> är valt i listan bredvid (appen minns hindret du valde senast).</li>
                <li>
                  <strong>När ekipaget kör in i hindret:</strong>
                  <br><span class="ml-4">Tryck på <span class="font-bold text-white bg-emerald-600 px-2 py-0.5 rounded text-xs">START</span>. Klockan börjar ticka.</span>
                </li>
                <li>
                  <strong>Vid målgång (ut ur hindret):</strong>
                  <br><span class="ml-4">Tryck på <span class="font-bold text-white bg-red-600 px-2 py-0.5 rounded text-xs">STOPP</span>. Tiden stannar.</span>
                </li>
                <li>
                  <strong>Väg, rivningar och hålltid:</strong>
                  <ul class="list-disc list-inside ml-4 mt-1 space-y-1">
                    <li><strong>${btn('marathon_route_through_obstacle', 'sv')}:</strong> Tryck på portarna i den ordning ekipaget kör dem. Appen varnar om en port kommer i fel ordning. ${btn('marathon_undo', 'sv')} tar bort senaste porten.</li>
                    <li><strong>${btn('marathon_knockdowns', 'sv')}:</strong> Fältet finns bara på hinder med rivningsbara element. Ange antal nedslagna element eller bollar (2 straffpoäng per element).</li>
                    <li><strong>${btn('marathon_hold_time', 'sv')}:</strong> Om ekipaget måste vänta innan det får köra in i hindret, ange väntetiden i <strong>minuter</strong> (snabbknappar +½, +1, +2 eller t.ex. 2,5) och välj eller skriv orsaken.</li>
                    <li><strong>Eliminering:</strong> Kryssa i rutan "${btn('marathon_elim', 'sv')}" om ekipaget utesluts.</li>
                  </ul>
                </li>
                <li>
                  <strong>Slutför:</strong>
                  <br><span class="ml-4">Tryck <span class="font-bold text-white bg-emerald-600 px-2 py-0.5 rounded text-xs">${btn('marathon_save_and_next', 'sv')}</span>. Resultatet skickas till sekretariatet och nästa ekipage i startordningen väljs.</span>
                </li>
              </ol>
              <div class="mt-2 text-sm text-blue-900 bg-blue-100 p-2 rounded">
                <strong>Viktigt:</strong> Uppehållstid dras från B-sträckans tid och visas i resultatmodal/PDF så att sekretariat och kusk kan se var, när och varför avdraget gjordes.
              </div>
            </div>
          </section>

          <!-- PRECISION -->
          <section>
            <h3 class="font-bold text-lg mb-2 text-purple-700 border-l-4 border-purple-500 pl-2">Precision: Inmatning</h3>
            <p class="text-gray-700 mb-2">För tidtagare och banpersonal på precisionsbanan.</p>

            <div class="bg-purple-50 p-4 rounded-lg space-y-3">
              <h4 class="font-semibold text-purple-800">Instruktioner:</h4>
              <ol class="list-decimal list-inside space-y-2 text-gray-700">
                <li>Gå till <strong>Inmatning Precision</strong>.</li>
                <li>Välj aktuellt ekipage (nr).</li>
                <li>
                  <strong>Tidtagning:</strong>
                  <ul class="list-disc list-inside ml-4 mt-1 space-y-1">
                    <li>Tryck <strong>Start</strong> när startlinjen passeras.</li>
                    <li>Tryck <strong>Stopp</strong> vid målgång. Tiden stannar.</li>
                    <li>Om maxtiden överskrids visas tiden i rött (straff läggs på automatiskt).</li>
                  </ul>
                </li>
                <li>
                  <strong>Hinderfel:</strong>
                  <ul class="list-disc list-inside ml-4 mt-1 space-y-1">
                    <li>Klicka på knapparna för de hinder som rivs (t.ex. <span class="border px-1 bg-white text-xs rounded">1</span>, <span class="border px-1 bg-white text-xs rounded">5A</span>).</li>
                    <li>Varje klick lägger till/tar bort 3 straffpoäng.</li>
                    <li>Måste ett hinder byggas om under ritten: tryck <strong>+10 s (ombyggnad)</strong> under klockan (10 sekunder per ombyggnad, −1 ångrar).</li>
                  </ul>
                </li>
                <li>Tryck på <strong>${btn('precision_save_results', 'sv')}</strong> för att spara.</li>
              </ol>
            </div>
          </section>

          <!-- SPECIAL: BESIKTNING -->
          <section>
            <h3 class="font-bold text-lg mb-2 text-gray-700 border-l-4 border-gray-500 pl-2">Specialfunktioner (Besiktning)</h3>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                <!-- Veterinär -->
                <div class="bg-gray-50 p-4 rounded-lg border border-gray-200">
                    <h4 class="font-bold text-gray-800 flex items-center gap-2">🩺 Veterinär</h4>
                    <p class="text-sm text-gray-600 mb-2">Används vid incheckning/förbesiktning.</p>
                    <ul class="list-disc list-inside text-sm text-gray-700 space-y-1">
                        <li><strong>Sök ekipage:</strong> Skriv namn eller nummer för att hitta rätt häst. Eller välj direkt i rullistan!</li>
                        <li><strong>Status:</strong>
                            <ul class="list-disc list-inside ml-4 text-xs mt-1">
                                <li><strong>Godkänd (Grön):</strong> Hästen är ok för start.</li>
                                <li><strong>Håll (Gul):</strong> Osäker status, skickas till ombesiktning (Holding Box).</li>
                                <li><strong>Struken (Röd):</strong> Hästen får ej starta. Din strykning går först till domarkollegiet: ekipaget visas som <em>"Veterinärstrykning avvaktar domarkollegiet"</em> tills sekretariatet eller TD fastställer eller upphäver den. Godkänner du hästen igen innan dess är strykningen återkallad.</li>
                            </ul>
                        </li>
                        <li><strong>Noteringar:</strong> Du kan skriva in sårskador eller andra observationer som sparas på ekipaget.</li>
                    </ul>
                </div>

                <!-- Vagn & Funktion -->
                <div class="bg-gray-50 p-4 rounded-lg border border-gray-200">
                    <h4 class="font-bold text-gray-800 flex items-center gap-2">⚖️ Vagn & Funktion</h4>
                    <p class="text-sm text-gray-600 mb-2">Mätning av vagnbredd och säkerhetskoll.</p>
                    <ul class="list-disc list-inside text-sm text-gray-700 space-y-1">
                        <li><strong>Mätning:</strong> Fyll i bredden för dressyr/precision och maraton. Systemet varnar om vagnen är smalare än klassens minimimått (TR Bilaga 2).</li>
                        <li><strong>Säkerhetskoll:</strong> Kryssa i rutan "Vagn godkänd" om utrustningen är korrekt.</li>
                        <li><strong>Spara:</strong> Tryck <strong>Spara &amp; gå till nästa</strong> för att spara och hoppa till nästa ekipage i listan.</li>
                    </ul>
                </div>
            </div>
          </section>

          <!-- FÄLTGUIDE & HÅRDVARA -->
          <section class="bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/30 p-5 rounded-xl border border-emerald-200 dark:border-emerald-800 shadow-xs">
            <h3 class="font-bold text-lg text-emerald-900 dark:text-emerald-200 mb-2 flex items-center gap-2">
              <span>🔋</span> Praktisk Fältguide & Hårdvara (Ute på banan)
            </h3>
            <p class="text-xs text-gray-600 dark:text-gray-300 mb-4">
              Funktionärer vid hinder och tidtagning sitter ofta ute i fält under långa tävlingsdagar. Här är de viktigaste praktiska tipsen:
            </p>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="bg-white dark:bg-gray-800 p-4 rounded-lg border border-emerald-100 dark:border-emerald-900/50 shadow-xs">
                <strong class="text-emerald-800 dark:text-emerald-300 block mb-1 text-sm">📱 Håll skärmen vaken (Screen Wake Lock)</strong>
                <p class="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                  Appen aktiverar automatiskt <em>Screen Wake Lock</em> så att telefonen eller surfplattan inte slocknar mitt under en ritt. För att detta ska fungera måste fliken vara öppen i förgrunden. Kontrollera att enheten inte har aggressivt strömsparläge påslaget.
                </p>
              </div>
              <div class="bg-white dark:bg-gray-800 p-4 rounded-lg border border-emerald-100 dark:border-emerald-900/50 shadow-xs">
                <strong class="text-emerald-800 dark:text-emerald-300 block mb-1 text-sm">🔋 Batteri & Powerbank</strong>
                <p class="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                  Heldag i fält drar batteri när skärmen är tänd hela tiden. Ta alltid med en laddad powerbank och laddsladd till hinderposteringen eller tidtagningsbordet.
                </p>
              </div>
              <div class="bg-white dark:bg-gray-800 p-4 rounded-lg border border-emerald-100 dark:border-emerald-900/50 shadow-xs">
                <strong class="text-emerald-800 dark:text-emerald-300 block mb-1 text-sm">📡 Synkindikatorn</strong>
                <ul class="text-xs text-gray-600 dark:text-gray-300 space-y-1.5 mt-1">
                  <li>🟠 <strong>Orange köknapp nere till höger (☁️ antal):</strong> Skrivningar väntar i enhetens minne och skickas automatiskt när internet är tillbaka. <em>Stäng inte fliken!</em></li>
                  <li>⚫ <strong>"Offline" i menyraden:</strong> Nätverksavbrott. Fortsätt bara i den redan laddade vyn och kontrollera att det du sparar hamnar i kön.</li>
                  <li>✅ <strong>Ingen köknapp:</strong> Allt är skickat och synligt för sekretariatet.</li>
                </ul>
              </div>
              <div class="bg-white dark:bg-gray-800 p-4 rounded-lg border border-emerald-100 dark:border-emerald-900/50 shadow-xs">
                <strong class="text-emerald-800 dark:text-emerald-300 block mb-1 text-sm">☀️ Solljus, Regn & Kontrast</strong>
                <p class="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                  I starkt solsken ger oftast <em>Ljust läge</em> bäst läsbarhet mot skärmreflexer (växla via månikonen i menyn). Vid regn: ha gärna en genomskinlig plastficka eller vattentätt fodral över surfplattan; pekskärmar fungerar utmärkt genom tunn plast.
                </p>
              </div>
            </div>
          </section>

        </div>
      `;

    case 'observer':
      return `
        <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">För Observatörer (Maraton)</h2>
        <div class="space-y-8">
            
            <section>
                <h3 class="font-bold text-lg mb-2 text-red-700 border-l-4 border-red-500 pl-2">PAUSA TÄVLINGEN (Nödläge)</h3>
                <div class="bg-red-100 p-4 rounded-lg border-2 border-red-500">
                    <p class="font-bold text-red-900 text-lg mb-2">⚠️ VARNING</p>
                    <p class="text-red-900 mb-2">
                        Om en olycka sker eller om tävlingen måste pausas akut av annan anledning:
                    </p>
                    <ol class="list-decimal list-inside font-bold text-red-900 ml-2 text-lg">
                        <li>Öppna panelen "${btn('observer_emergency_pause', 'sv')}" på observatörssidan.</li>
                        <li>Tryck på den röda knappen "${btn('observer_stop_all', 'sv')}".</li>
                        <li>Bekräfta i rutan som dyker upp.</li>
                    </ol>
                    <p class="text-red-800 mt-4 text-sm">
                        <strong>Vad händer då?</strong><br>
                        Alla tävlingsklockor (etapper, hinder, precision) pausas och tiden under pausen räknas inte. Du anger orsak (och gärna en kort beskrivning). Alla sidor visar en röd banner med orsak, vem som pausade och var, och knapparna visar Pausad. Funktionärer och kuskar som har slagit på notiser får en notis. Vid en olycka ringer du dessutom tävlingsledningen via radio eller telefon.
                    </p>
                    <p class="text-green-800 mt-4 font-bold">
                        För att återuppta: Tryck på den gröna knappen "${btn('observer_resume_all', 'sv')}" när banan är fri.
                    </p>
                </div>
            </section>

            <section>
                <h3 class="font-bold text-lg mb-2 text-orange-700 border-l-4 border-orange-500 pl-2">Logga Händelser (Fel gångart / Halt)</h3>
                <p class="text-gray-700 mb-4">Används för att notera otillåtna gångarter eller halter på sträckan.</p>

                <div class="bg-white border p-4 rounded shadow-sm space-y-4">
                    
                    <div>
                        <h4 class="font-bold text-gray-800 border-b pb-1 mb-2">1. Välj Ekipage</h4>
                        <p class="text-sm text-gray-600">Välj det ekipage du observerar i rullistan högst upp (t.ex. "Start nr 15").</p>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                        <!-- Fel Gångart -->
                        <div class="bg-orange-50 p-3 rounded">
                            <strong class="block text-orange-900 mb-2">🐎 Fel Gångart (Tid)</strong>
                            <ul class="list-disc list-inside text-sm text-gray-700 space-y-2">
                                <li>Tryck <span class="bg-orange-500 text-white px-2 py-0.5 rounded font-bold">START</span> när hästen slår över i galopp (eller annan fel gångart).</li>
                                <li>Tryck <span class="bg-red-600 text-white px-2 py-0.5 rounded font-bold">STOPP</span> när hästen återgår till trav.</li>
                                <li>Varje start–stopp sparas som ett eget tillfälle i listan under knapparna. Rättat inom 5 sekunder ger inget straff, annars 1 straffpoäng per påbörjad 5-sekundersperiod (TR V 523.1). Ett felaktigt tillfälle tar du bort med papperskorgen.</li>
                            </ul>
                        </div>

                        <!-- Halt -->
                        <div class="bg-blue-50 p-3 rounded">
                            <strong class="block text-blue-900 mb-2">🛑 Halt (Straff)</strong>
                            <ul class="list-disc list-inside text-sm text-gray-700 space-y-2">
                                <li>Tryck <span class="bg-emerald-600 text-white px-2 py-0.5 rounded font-bold">START</span> under Halt när ekipaget stannar <strong>utanför</strong> hinderområde (ej tillåtet), och <span class="bg-rose-600 text-white px-2 py-0.5 rounded font-bold">STOPP</span> när det kör igen.</li>
                                <li>Varje halt hamnar i halt-loggen. Med "${btn('observer_manual_add', 'sv')}" lägger du in en halt i efterhand (mm:ss eller sekunder).</li>
                                <li>Noteringarna sparas automatiskt; skriv gärna en kort anteckning.</li>
                            </ul>
                        </div>
                    </div>

                    <div class="mt-4">
                        <h4 class="font-bold text-gray-800 border-b pb-1 mb-2">Rätta fel</h4>
                        <p class="text-sm text-gray-600">Om du råkade trycka fel:</p>
                        <ul class="list-disc list-inside text-sm text-gray-600 ml-2 mt-1">
                            <li><strong>Redigera tid:</strong> Klicka på penn-ikonen bredvid noteringen i historiken längst ner.</li>
                            <li><strong>Ta bort:</strong> Klicka på soptunnan för att radera en felaktig registrering.</li>
                        </ul>
                    </div>

                </div>
            </section>

        </div>
      `;

    case 'judge':
      return `
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3 mb-6">
          <h2 class="text-xl font-semibold text-gray-800 dark:text-gray-100">För Domare</h2>
          <button type="button" data-role-pdf="dressage" class="px-3.5 py-1.5 bg-purple-700 hover:bg-purple-800 text-white rounded-lg text-xs font-semibold shadow-xs transition-all flex items-center gap-1.5 self-start sm:self-auto active:scale-95">
            <span>📄</span> Skriv ut Lathund (A4 PDF)
          </button>
        </div>
        <div class="space-y-8">
          
          <section>
            <h3 class="font-bold text-lg mb-2 text-purple-700 border-l-4 border-purple-500 pl-2">Digitala Dressyrprotokoll</h3>
            <p class="text-gray-700 mb-2">Du (eller din skrivare) använder sidan <strong>Inmatning Dressyr</strong> för att protokollföra ritten direkt i systemet.</p>

            <div class="bg-purple-50 p-4 rounded-lg space-y-3">
              <h4 class="font-semibold text-purple-800">Arbetsgång:</h4>
              <ol class="list-decimal list-inside space-y-3 text-gray-700">
                <li>
                  <strong>Förberedelser:</strong>
                  <ul class="list-disc list-inside ml-4 mt-1 text-sm">
                    <li>Välj aktuellt <strong>Ekipage</strong> (sökfältet eller pilarna « »).</li>
                    <li>Program och domare fylls i från klassens domarschema. Kontrollera att rätt <strong>Program</strong> och din <strong>Domare</strong> (t.ex. "C – Anna Andersson") visas, annars byt i listan.</li>
                  </ul>
                </li>
                <li>
                  <strong>Under körningen:</strong>
                  <ul class="list-disc list-inside ml-4 mt-1 text-sm">
                    <li>Fyll i poäng (0-10) för varje moment. Använd HEL- eller HALV-poäng (t.ex. 6, 6.5, 7).</li>
                    <li>Raden högst upp följer med när du skrollar och visar ekipaget, procent, poäng, straff och hur många moment som är ifyllda (t.ex. "${btn('input_filled_count', 'sv').replace('{n}', '12').replace('{total}', '20')}").</li>
                    <li>Poängen du skriver visas live för publiken medan du dömer, men protokollet sparas först när du trycker på <strong>Spara Protokoll</strong>.</li>
                    <li>Lägg till <strong>Kommentarer</strong> vid behov genom att klicka på "💬".</li>
                  </ul>
                  <div class="mt-2 ml-4 p-2 bg-white border border-purple-200 rounded text-xs text-purple-900">
                      <strong>💡 Tips för snabbare inmatning (Tangentbord):</strong>
                      <ul class="list-disc list-inside mt-1">
                          <li><strong>Enter:</strong> Hoppa direkt till nästa poängruta.</li>
                          <li><strong>Tab:</strong> Öppna och hoppa till kommentarsfältet för <em>aktuell</em> rörelse.</li>
                      </ul>
                  </div>
                </li>
                <li>
                  <strong>Vid felkörning:</strong>
                  <br><span class="ml-4 text-sm">Använd knapparna "1:a fel (+5)", "2:a fel (+10)" och "3:e fel" (frågar innan ekipaget markeras som eliminerat), eller fyll i "Övriga avdrag" manuellt längst ner.</span>
                </li>
                <li>
                  <strong>Spara protokollet:</strong>
                  <br><span class="ml-4 text-sm">När protokollet är klart, klicka på <strong>Spara Protokoll</strong>. Domarens bedömning sparas och du går vidare till nästa ekipage. När alla tilldelade domare har sparat visas ekipaget som klart, men resultatet blir inte officiellt eller låst förrän en behörig användare finaliserar det på resultatsidan.</span>
                </li>
              </ol>
            </div>
          </section>

            <section>
            <h3 class="font-bold text-lg mb-2 text-purple-700 border-l-4 border-purple-500 pl-2">Överdomare / Godkännande</h3>
            <p class="text-gray-700 mb-2">För att verifiera resultat innan prisutdelning:</p>
            <ul class="list-disc list-inside ml-2 text-gray-700">
              <li>Gå till <strong>Resultat Dressyr</strong> eller <strong>Totalresultat</strong>.</li>
              <li>Kontrollera att alla domare har status "Klar" (grön bock).</li>
              <li>Vid strykningar eller uteslutning, se till att detta är markerat i systemet.</li>
            </ul>
          </section>

          <!-- OFFLINE GUIDANCE -->
          <section class="bg-emerald-50 dark:bg-emerald-950/30 p-4 rounded-xl border-l-4 border-emerald-500 shadow-xs mb-4">
            <h4 class="font-bold text-emerald-800 dark:text-emerald-300 text-sm uppercase mb-1">📡 Offline & Tappad anslutning</h4>
            <div class="text-sm text-emerald-900 dark:text-emerald-200 space-y-2">
              <p><strong>Offline-stöd för en redan laddad domarvy:</strong> Om internet försvinner kan du fortsätta fylla i protokollet och klicka på <strong>"Spara Protokoll"</strong> som vanligt.</p>
              <p>Skrivningen köas då lokalt på den aktuella enheten och skickas när anslutningen återupptas. Den är inte bekräftad på servern förrän den har skickats, alltså tills den orange köknappen nere till höger (☁️ Synkar...) är borta.</p>
              <div class="p-2.5 bg-white dark:bg-gray-800 rounded-lg border border-emerald-200 dark:border-emerald-800/60 text-xs space-y-1">
                <div class="font-semibold text-gray-800 dark:text-gray-200">Synkindikatorn:</div>
                <div>• 🟠 <strong>Orange köknapp nere till höger (☁️ antal):</strong> Sparat lokalt på surfplattan, väntar på att skickas.</div>
                <div>• ⚫ <strong>"Offline" i menyraden:</strong> Ingen anslutning. Fortsätt endast i den redan laddade vyn och kontrollera att skrivningen visas i kön.</div>
                <div>• ✅ <strong>Ingen köknapp:</strong> Allt är skickat.</div>
              </div>
              <p class="font-semibold text-amber-800 dark:text-amber-300 text-xs">⚠️ VIKTIGT: Stäng eller uppdatera inte fliken medan det finns osparade ändringar i synkkön. Vänta tills köknappen är borta.</p>
            </div>
          </section>

          <section class="bg-gray-50 dark:bg-gray-900/40 p-4 rounded-xl border border-gray-200 dark:border-gray-700">
            <h4 class="font-bold text-gray-800 dark:text-gray-200 text-sm uppercase mb-1">✍️ Rättelse i efterhand</h4>
            <p class="text-xs text-gray-600 dark:text-gray-300">
              Innan resultatet är finaliserat kan domaren välja samma ekipage och spara protokollet på nytt. Om resultatet redan är finaliserat måste en behörig användare först återöppna det på resultatsidan; därefter kan domaren eller <strong>Sekretariatet</strong> göra rättelsen.
            </p>
          </section>
        </div>
      `;

    case 'driver':
      return `
        <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">För Kuskar & Deltagare</h2>
        
        <div class="space-y-8">
            
            <!-- MIN PORTAL -->
            <section>
                <h3 class="font-bold text-lg mb-2 text-amber-700 border-l-4 border-amber-500 pl-2">1. Min Portal</h3>
                <p class="text-gray-700 mb-2">Kom ihåg att logga in med samma e-postadress som du angav vid anmälan för att se dina uppgifter.</p>
                
                <div class="bg-amber-50 p-4 rounded-lg space-y-4">
                    <h4 class="font-semibold text-amber-800">Funktioner i portalen:</h4>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div class="bg-white p-3 rounded border border-amber-100">
                            <strong class="text-amber-900 block mb-1">🏁 Starttider & Resultat</strong>
                            <p class="text-xs text-gray-600">Se din personliga starttid och status (t.ex. "Startad", "Veterinärbesiktigad").</p>
                        </div>
                        <div class="bg-white p-3 rounded border border-amber-100">
                             <strong class="text-amber-900 block mb-1">✏️ Digital Deklarering</strong>
                             <p class="text-xs text-gray-600">Ändra hästar, vagn och groom direkt i mobilen.</p>
                             <p class="text-xs text-red-500 mt-1 font-medium">Obs! Låses enligt tävlingens inställning, ofta 60 minuter före start.</p>
                        </div>
                        <div class="bg-white p-3 rounded border border-amber-100">
                             <strong class="text-amber-900 block mb-1">🩺 Veterinärstatus</strong>
                             <p class="text-xs text-gray-600">Se om din häst är godkänd ("Grön") eller har anmärkningar. Om veterinären har föreslagit strykning står det <em>"Veterinärbeslut avvaktar domarkollegiets beslut"</em> vid ditt ekipage tills domarkollegiet har beslutat.</p>
                        </div>
                        <div class="bg-white p-3 rounded border border-amber-100">
                             <strong class="text-amber-900 block mb-1">📢 Speaker-noteringar</strong>
                             <p class="text-xs text-gray-600">Skriv in text som speakern kan läsa upp under din ritt (t.ex. kuriosa).</p>
                        </div>
                        <div class="bg-white p-3 rounded border border-amber-100">
                             <strong class="text-amber-900 block mb-1">🔔 Notiser</strong>
                             <p class="text-xs text-gray-600">Slå på notiser i kortet <em>Notiser</em> för att få ändrade starttider, meddelanden, paus och veterinärbeslut direkt i telefonen. På iPhone: välj först <em>Lägg till på hemskärmen</em> (iOS 16.4 eller senare). Inställningen för enheten finns också under Mitt konto.</p>
                        </div>
                        <div class="bg-white p-3 rounded border border-amber-100">
                             <strong class="text-amber-900 block mb-1">📄 Dokument & PM</strong>
                             <p class="text-xs text-gray-600">Se publicerade dokument, banskisser och meddelanden från arrangören direkt i portalen.</p>
                        </div>
                        <div class="bg-white p-3 rounded border border-amber-100">
                             <strong class="text-amber-900 block mb-1">📝 Protokoll & PDF</strong>
                             <p class="text-xs text-gray-600">När protokoll och resultat är färdiga kan du öppna eller ladda ner dem från resultatdelen.</p>
                        </div>
                    </div>
                </div>
            </section>

             <!-- RESULTAT & NOTISER -->
             <section>
                <h3 class="font-bold text-lg mb-2 text-blue-700 border-l-4 border-blue-500 pl-2">2. Resultat & Meddelanden</h3>
                <div class="space-y-4 text-gray-700">
                    <ul class="list-disc list-inside ml-2">
                        <li><strong>Meddelanden:</strong> Här tar du emot både <strong>personliga meddelanden</strong> (riktade bara till dig) och allmänna utrop (till alla). Antalet olästa syns vid rubriken; <em>Markera alla som lästa</em> rensar. Arrangören kan rätta ett skickat meddelande, och det visas då som ny igen.</li>
                        <li><strong>Notiser:</strong> Vill du ha ett meddelande som en notis i telefonen slår du på notiser i portalen (se ovan).</li>
                        <li><strong>Protokoll:</strong> När dressyren är klar och signerad kan du ofta ladda ner ditt protokoll som PDF direkt från resultatlistan.</li>
                    </ul>
                    
                    <div class="bg-gray-50 p-4 rounded-lg">
                        <h4 class="font-bold text-gray-800 mb-2">Vanliga frågor</h4>
                        <details class="group cursor-pointer mb-2">
                            <summary class="font-medium text-gray-700 list-none flex items-center justify-between border-b pb-1">
                                <span>Varför kan jag inte ändra mina hästar?</span>
                                <span class="transition group-open:rotate-180">▼</span>
                            </summary>
                            <p class="text-gray-600 mt-2 text-sm">
                                Portalen låses automatiskt en viss tid (ofta 60 min) före din starttid för att sekretariatet ska hinna skriva ut startlistor. Kontakta sekretariatet om du behöver ändra akut.
                            </p>
                        </details>
                        <details class="group cursor-pointer">
                            <summary class="font-medium text-gray-700 list-none flex items-center justify-between border-b pb-1">
                                <span>Jag hittar inte min tävling i listan?</span>
                                <span class="transition group-open:rotate-180">▼</span>
                            </summary>
                            <p class="text-gray-600 mt-2 text-sm">
                                Klicka på knappen <strong>"Försök hitta mina anmälningar igen"</strong> i portalen. Om det inte fungerar, kontrollera att du är inloggad med exakt samma e-post som finns registrerad i anmälningssystemet.
                            </p>
                        </details>
                    </div>
                </div>
            </section>
        </div>
      `;

    case 'speaker':
      return `
        <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">För Speaker</h2>
        <div class="space-y-8">
          
          <section>
            <h3 class="font-bold text-lg mb-2 text-indigo-700 border-l-4 border-indigo-500 pl-2">Översikt & Dashboard</h3>
            <p class="text-gray-700 mb-2">Speaker-vyn är framtagen för att ge dig realtidsinformation utan att du behöver klicka runt. Byt gren via knapparna högst upp (Dressyr, Maraton, Precision).</p>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mb-4">
                <div class="bg-indigo-50 p-3 rounded border border-indigo-100">
                    <strong class="text-indigo-900 block mb-1">📢 Speaker-noteringar</strong>
                    <p class="text-gray-700">Visar texten som kusken själv lagt in i sin portal.</p>
                </div>
                <div class="bg-indigo-50 p-3 rounded border border-indigo-100">
                    <strong class="text-indigo-900 block mb-1">💬 Meddelanden & markeringar</strong>
                    <p class="text-gray-700">Arrangörens meddelanden visas i en egen ruta; de som inte är för publiken märks <em>Internt – ej utrop</em>. Ett ekipage med <em>Veterinärstrykning avvaktar domarkollegiet</em> är inte struket än: vänta med att utropa det. Vid paus visas en röd banner med orsak.</p>
                </div>
                
                <div class="bg-indigo-50 p-3 rounded border border-indigo-100">
                    <strong class="text-indigo-900 block mb-1">🗺️ Interaktiv Maratonkarta</strong>
                    <p class="text-gray-700">
                        Kartan är klickbar! Tryck på en prick för att se straff och status.
                        Använd listan till höger för att "flyga" direkt till en kusk.
                    </p>
                </div>
                <div class="bg-indigo-50 p-3 rounded border border-indigo-100">
                   <strong class="text-indigo-900 block mb-1">🔍 Live-data</strong>
                   <p class="text-gray-700 leading-relaxed">
                     <strong>Dressyr:</strong> Visar löpande poängprocent om "live-protokoll" används.<br>
                     <strong>Maraton:</strong> Visar exakt var kusken är på banan och tider i hinder.<br>
                     <strong>Precision:</strong> Visar tid och fel direkt vid målgång.
                   </p>
                </div>
            </div>
          </section>

          <section>
             <h3 class="font-bold text-lg mb-2 text-blue-700 border-l-4 border-blue-500 pl-2">Maraton: Command Center</h3>
             <p class="text-sm text-gray-600 mb-4">Maraton-vyn är extra detaljerad. Här är de viktigaste verktygen:</p>

             <div class="space-y-6">
                 
                 <!-- Hinderfokus -->
                 <div class="bg-white border p-4 rounded shadow-sm">
                     <h4 class="font-bold text-gray-800 flex items-center gap-2">
                        🎯 Hinder-fokus
                        <span class="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full uppercase">Nyhet</span>
                     </h4>
                     <p class="text-gray-600 text-sm mt-1 mb-2">Istället för att se alla hinder, kan du "låsa" vyn på ett specifikt hinder (t.ex. Vattenhindret).</p>
                     <ul class="list-disc list-inside text-gray-600 text-sm ml-2">
                         <li>Använd dropdown-menyn <strong>"Välj Hinder"</strong> uppe till vänster.</li>
                         <li>Vyn visar nu endast tider och händelser för detta hinder, perfekt om du sitter vid just det hindret.</li>
                     </ul>
                 </div>

                 <!-- Redigera Noteringar -->
                 <div class="bg-white border p-4 rounded shadow-sm">
                     <h4 class="font-bold text-gray-800">📝 Redigera Noteringar Live</h4>
                     <p class="text-gray-600 text-sm mt-1 mb-2">Ibland saknas info eller så vill du lägga till något du precis fick höra.</p>
                     <ol class="list-decimal list-inside text-gray-600 text-sm ml-2 space-y-1">
                         <li>Klicka på knappen <strong>"✎ Ändra"</strong> vid noteringarna.</li>
                         <li>Skriv in ny text i rutan.</li>
                         <li>Klicka <strong>Spara</strong>. Detta uppdateras direkt i systemet (och syns även för kusken).</li>
                     </ol>
                 </div>

                 <!-- Sektoranalys -->
                 <div class="bg-white border p-4 rounded shadow-sm">
                    <h4 class="font-bold text-gray-800">⏱️ Sektoranalys (A / Transport)</h4>
                    <p class="text-gray-600 text-sm mt-1">Visar kuskar som är ute på sträckorna (ej i hinder).</p>
                    <div class="mt-2 bg-gray-50 p-2 rounded text-xs font-mono text-gray-700 border border-gray-200">
                        <span class="text-red-500 font-bold">+0:45</span> = Kusken är 45 sekunder efter idealtid.<br>
                        <span class="text-green-600 font-bold">-0:10</span> = Kusken är 10 sekunder snabbare än idealtid.
                    </div>
                 </div>

             </div>
          </section>

          <section>
            <h3 class="font-bold text-lg mb-2 text-green-700 border-l-4 border-green-500 pl-2">Topplistor & Filtrering</h3>
             <ul class="list-disc list-inside text-gray-700 ml-2 space-y-2">
                <li><strong>Topplistan (Högerkanten):</strong> Uppdateras live. Den visar ställningen i klassen.</li>
                <li><strong>Byt Klass:</strong> Klicka på dropdown-menyn högst upp i topplistan (t.ex. "MSV Klass") för att se ställningen i andra klasser utan att lämna sidan.</li>
                <li><strong>Pågående:</strong> Ekipaget som kör just nu markeras tydligt med <span class="bg-blue-100 text-blue-800 px-1 rounded font-bold text-xs">BLÅTT</span> i listan.</li>
             </ul>
          </section>

          <section class="bg-yellow-50 p-4 rounded border-l-4 border-yellow-400">
            <h4 class="font-bold text-yellow-800 text-sm uppercase mb-1">Felsökning</h4>
            <p class="text-sm text-yellow-900">
                Om "Pågående ekipage" fastnar eller inte verkar stämma: 
                <span class="font-semibold block mt-1">Prova att växla gren (t.ex. till Dressyr och tillbaka till Maraton) för att tvinga en omstart av live-kopplingen.</span>
            </p>
          </section>

        </div>
      `;

    default:
      return '<p>Välj en roll ovan.</p>';
  }
}

export function unload() {
  // Cleanup if needed
}

function getTabContentEN(tab) {
  switch (tab) {
    case 'tech':
      return `
        <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">Tech & Support</h2>
        <div class="space-y-8">
            
            <section>
                <h3 class="font-bold text-lg mb-2 text-cyan-700 border-l-4 border-cyan-500 pl-2">Install as App</h3>
                <p class="text-gray-700 mb-2">For best performance and stability, you should add the system to your home screen.</p>
                <div class="grid md:grid-cols-2 gap-4">
                    <div class="bg-gray-50 p-4 rounded border">
                        <strong class="block mb-2">🍏 iPad / iPhone (Safari)</strong>
                        <ol class="list-decimal list-inside text-sm text-gray-700 space-y-1">
                            <li>Tap the <strong>Share button</strong> (square with arrow up).</li>
                            <li>Scroll down and select <strong>"Add to Home Screen"</strong>.</li>
                            <li>Confirm with "Add".</li>
                        </ol>
                    </div>
                    <div class="bg-gray-50 p-4 rounded border">
                        <strong class="block mb-2">🤖 Android (Chrome)</strong>
                        <ol class="list-decimal list-inside text-sm text-gray-700 space-y-1">
                            <li>Tap the menu (three dots).</li>
                            <li>Select <strong>"Install App"</strong> or "Add to Home Screen".</li>
                            <li>Follow the instructions.</li>
                        </ol>
                    </div>
                </div>
            </section>

             <section>
                <h3 class="font-bold text-lg mb-2 text-orange-700 border-l-4 border-orange-500 pl-2">Offline Mode (No Internet)</h3>
                <div class="bg-orange-50 p-4 rounded-lg border border-orange-200">
                    <p class="text-gray-700 mb-2">
                        The system is built to handle unstable internet connections in the field.
                    </p>
                    <ul class="list-disc list-inside text-sm text-gray-700 space-y-2">
                        <li><strong>If the input view and competition data were already loaded, you can continue entering times and results after coverage is lost.</strong></li>
                        <li>Writes can be queued locally ("In Queue") and sent when internet returns. A queued write is not server-confirmed until it has been sent, that is until the amber queue button at the bottom right (☁️ Synkar...) is gone.</li>
                        <li class="font-bold text-red-600">IMPORTANT: Do not close or reload the tab, sign out, clear site data, or switch devices while writes remain queued.</li>
                    </ul>
                </div>
            </section>

             <section>
                <h3 class="font-bold text-lg mb-2 text-green-700 border-l-4 border-green-500 pl-2">Battery & Screen Lock</h3>
                <div class="bg-green-50 p-4 rounded-lg border border-green-200">
                    <p class="text-gray-700 mb-2">
                        The system automatically keeps your screen awake ("Wake Lock") while you are on valid timing or judging pages.
                    </p>
                    <ul class="list-disc list-inside text-sm text-gray-700 space-y-1">
                        <li>You do not need to change your phone's screen timeout settings.</li>
                        <li><strong>Tip:</strong> Keep a Powerbank handy if you are stationed outside all day, as the screen consumes battery.</li>
                    </ul>
                </div>
            </section>

             <section>
                <h3 class="font-bold text-lg mb-2 text-gray-700 border-l-4 border-gray-500 pl-2">Troubleshooting</h3>
                <ul class="list-disc list-inside text-sm text-gray-700 space-y-1">
                   <li><strong>"Page looks weird":</strong> Try reloading the page (pull down or press F5).</li>
                   <li><strong>"Nothing happens when I click":</strong> Check your internet connection. Is there an "Offline" symbol visible?</li>
                   <li><strong>Sync Queue (Cloud Icon):</strong>
                       <ul class="list-circle list-inside ml-4 mt-1 text-xs">
                           <li><span class="text-amber-500">Amber button at the bottom right (☁️ count, Synkar...):</span> That many writes are waiting to be sent. Tap it to see which.</li>
                           <li><span class="text-green-600">No button and no badge:</span> Everything has been sent.</li>
                           <li><span class="text-red-500">Red/Strikethrough:</span> Offline. Data saved locally and sent later.</li>
                       </ul>
                   </li>
                </ul>
            </section>

        </div>
            `;

    case 'secretary':
      return `
        <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">For The Secretariat</h2>
        <div class="space-y-8">
            
            <section>
                <h3 class="font-bold text-lg mb-2 text-blue-700 border-l-4 border-blue-500 pl-2">Report Center (Lists)</h3>
                <p class="text-gray-700 mb-2">Here you generate all PDF files for printing and web publishing.</p>
                <div class="bg-blue-50 p-4 rounded-lg space-y-2">
                    <ul class="list-disc list-inside text-sm text-gray-700">
                        <li><strong>Start Lists:</strong> Created per discipline (Dressage, Marathon, Precision). The system automatically sorts by start time.</li>
                        <li><strong>Officials Lists (New!):</strong>
                            <ul class="list-circle list-inside ml-4 text-xs mt-1 space-y-1">
                                <li><strong>Marathon Times:</strong> Timeline with calculated times for Start A, Finish A, Start B etc. (Requires start times and distances to be set).</li>
                                <li><strong>Marathon time sheets per entry:</strong> Use <strong>Marathon &gt; Calculate times</strong> to print an A/Transfer/B PDF for a single entry. The PDF includes the competition logo when one is uploaded.</li>
                                <li><strong>Marathon Obstacles:</strong> List for obstacle judges. Includes calculated start time for Section B.</li>
                                <li><strong>Dressage:</strong> Start order with program and horse for scribes/ringmaster.</li>
                            </ul>
                            <p class="text-[10px] text-blue-800 mt-1"><em>* Scratched entries are automatically filtered out from these lists.</em></p>
                        </li>
                        <li><strong>Result Lists:</strong> Results are calculated live. You don't need to "calculate" anything manually.</li>
                        <li><strong>Logos in PDFs:</strong> Competition logo, club logos and flags are used automatically where available. Check this before printing official lists.</li>
                        <li><strong>CSV Export:</strong> Use the "CSV" buttons to get raw data for Excel if you need to perform custom analysis.</li>
                        <li><strong>Secretariat (Dressage/Marathon/Precision):</strong> Use the secretariat pages to correct times, penalties and protocols without going back to the ordinary input pages. Finalized results must be unlocked first.</li>
                    </ul>
                     <p class="text-xs text-blue-900 mt-2 font-bold">
                        Tip: Most result and list pages now use a compact top bar with Search, Sort, Class, CSV and PDF. Use the class filter to print one class at a time.
                     </p>
                </div>
            </section>

            <section>
                <h3 class="font-bold text-lg mb-2 text-emerald-700 border-l-4 border-emerald-500 pl-2">Field Mode & Secretariat</h3>
                <div class="bg-emerald-50 p-4 rounded-lg border border-emerald-200 space-y-2 text-sm text-gray-700">
                    <p><strong>Field mode</strong> is intended for competitions with poor connectivity or too few staff to run full live production. Monitor pages and other clearly live-oriented pages are hidden, but results can still be reported manually.</p>
                    <ul class="list-disc list-inside space-y-1">
                        <li><strong>Live mode:</strong> Use when you rely on monitors, live timers and real-time public display.</li>
                        <li><strong>Field mode:</strong> Officials enter times and scores manually, and the secretariat corrects and finalizes if needed.</li>
                        <li><strong>Choose it in Admin &gt; Settings:</strong> The competition mode controls which pages are shown in the menu.</li>
                    </ul>
                </div>
            </section>

            <section>
                <h3 class="font-bold text-lg mb-2 text-violet-700 border-l-4 border-violet-500 pl-2">⚖️ Incident log, protests & ground jury</h3>
                <div class="bg-violet-50 p-4 rounded-lg border border-violet-200 space-y-2 text-sm text-gray-700">
                    <p>The menu <strong>Admin &gt; Secretariat &gt; Incidents &amp; protests</strong> (page <code>#incidents</code>) is the competition's log for the TD report. It is private: admins, the TD / ground jury and discipline officials read and write it, the vet reads it and adds their own decisions. The public never sees it.</p>
                    <ul class="list-disc list-inside space-y-1">
                        <li><strong>Entries:</strong> Type (Protest, Incident, Ground jury decision, Veterinary decision, Other), time received, start number, discipline and obstacle, description, decision, decided by and status (Open/Decided/Closed). Each entry gets a number. Export as PDF or CSV for the TD report.</li>
                        <li><strong>Corrections:</strong> The secretariat's corrections with reason and reference. Give the protest's or decision's number as the reference and the correction and the entry are linked.</li>
                        <li><strong>Needs attention:</strong> Vet withdrawals waiting for the ground jury (Confirm / Overturn) and declarations changed by drivers ("Changed by driver"; a new horse after the inspection is flagged for the vet). Acknowledge them once seen. The same panel is shown at the top of the officials' start page for admin, secretariat, TD and vet.</li>
                        <li><strong>Vet withdrawal:</strong> A vet's withdrawal is first a proposal. The equipage is marked <em>"Vet strike awaiting the ground jury"</em> for the secretariat, the speaker, the officials, on the start list and the monitors, and the driver sees <em>"Vet decision awaiting the ground jury's decision"</em> in My Portal. The equipage is withdrawn only when the secretariat or the TD presses <strong>Confirm</strong>; <strong>Overturn</strong> removes the mark. If the vet approves the horse again before the decision, the withdrawal is taken back.</li>
                        <li><strong>Field devices:</strong> Every device with an input page open reports once a minute: last seen (green under 2 min, amber under 10, red older), unsent writes, page and obstacle.</li>
                    </ul>
                    <p><strong>TD / Ground jury (role td):</strong> Add it in the officials list (system rights) or hand out the TD role code. The role reads the secretariat pages, writes the incident log, can finalize and unlock results and decides the vet's withdrawals.</p>
                    <p><strong>Result PDFs:</strong> Result lists are marked <em>PROVISIONAL RESULTS</em> until every result on the list is finalized (or the competition archived); then they read <em>OFFICIAL RESULTS</em> with a signature line for the President of the Ground Jury.</p>
                    <p><strong>Emergency info:</strong> Fill it in under <strong>Admin &gt; Communication &gt; Public info</strong>: emergency number (112), first aid, vet on duty, farrier, chief steward and safety officer. The persons' phone numbers are shown only to signed-in officials and the competition's drivers; the <strong>Emergency</strong> button in the menu opens the card.</p>
                </div>
            </section>

            <section>
                <h3 class="font-bold text-lg mb-2 text-sky-700 border-l-4 border-sky-500 pl-2">💬 Messages, notifications & contact lists</h3>
                <div class="bg-sky-50 p-4 rounded-lg border border-sky-200 space-y-2 text-sm text-gray-700">
                    <p>A <strong>message</strong> is shown in the app. A <strong>notification</strong> is the push notification that pops up on the phone; it reaches only those who have turned notifications on.</p>
                    <ul class="list-disc list-inside space-y-1">
                        <li><strong>Send a message:</strong> <strong>Admin &gt; Communication</strong>. Choose the recipients: Public, Drivers, Selected drivers, Officials (all) or one role: Dressage, Marathon, Cones, Vet, Speaker, Secretariat or TD / ground jury. Mark it Important for a red message. The English text is optional and shown to those who chose English.</li>
                        <li><strong>Edit a sent message:</strong> Press <strong>Edit</strong>, correct it and choose <strong>Save changes</strong>. The message is marked "edited" with the time and shows again for those who had hidden it. The update can be sent as a notification and by e-mail. <strong>Delete</strong> removes the message for every recipient.</li>
                        <li><strong>Banner for officials:</strong> Messages for officials appear at the top of the input pages, the secretariat pages and the officials' start page (there with a count). You see the title and two lines; <strong>Show more</strong> opens the whole text, <strong>+N more</strong> tells you there are more, and &times; hides the message on this device. Important messages are red. The speaker sees them in the own message box, and those not meant for the public are marked <em>Internal – not to announce</em>.</li>
                        <li><strong>Contact lists:</strong> At the bottom of Communication. Choose a group (all drivers, drivers in a class, all officials or one role) and press <strong>Copy e-mail addresses (BCC)</strong>, <strong>Copy phone numbers</strong> or <strong>Open e-mail with BCC</strong>. The details are private and must not be passed on.</li>
                        <li><strong>Changed start times:</strong> When you save changed times in a published start list the app asks <em>Tell the drivers concerned?</em> Choose how: <strong>Message in the app</strong>, <strong>Notification</strong> and/or <strong>E-mail</strong>. You see how many drivers and devices with notifications on it concerns, and each driver gets only their own times. <strong>Do not send</strong> skips the send-out.</li>
                        <li><strong>Drive-off:</strong> On Cones results the <strong>Announce drive-off</strong> button sends a message to the qualified equipages (you can edit the text first) and a short message to the speaker.</li>
                        <li><strong>Pause:</strong> When the competition is paused, officials and drivers with notifications on get a notification, and every page shows a red banner with the reason, who paused and where. Start and stop buttons read <em>Paused</em>.</li>
                        <li><strong>Where to turn notifications on:</strong> Officials: at the top of the officials' start page. Drivers: the <em>Notifications</em> card in My Portal. Everyone: <strong>My account &gt; Notifications on this device</strong> (follows the competitions you turn notifications on for in the portal). The app owner first saves the key under <strong>Admin &gt; Settings &gt; Push notifications</strong>; until then the app says notifications are not available yet.</li>
                        <li><strong>Which notifications?</strong> Under Notifications you choose topics. Officials and vets: changed start times, messages, pause, vet decisions and changed declarations. Drivers get only what concerns them; on a pause drivers get a short notification with the reason only.</li>
                        <li><strong>Important and e-mail:</strong> Messages marked Important go out as essential notifications, also to those who switched message notifications off. An essential e-mail send-out requires a reason. The send-out checkboxes (message, notification, e-mail) show the number of recipients and nobody gets the same thing twice.</li>
                        <li><strong>Drive-off:</strong> The <strong>Announce drive-off</strong> button (admin and TD) sends a message and a notification to the qualifiers and a message to the speaker.</li>
                        <li><strong>Vet withdraws:</strong> The vet can withdraw a strike that waits for the ground jury; the driver is told.</li>
                        <li><strong>iPhone and iPad:</strong> Needs iOS 16.4 or later. Tap Share in Safari, choose <em>Add to Home Screen</em>, open the app from its icon and then turn notifications on.</li>
                    </ul>
                </div>
            </section>

            <section>
                <h3 class="font-bold text-lg mb-2 text-yellow-700 border-l-4 border-yellow-500 pl-2">Prize Giving</h3>
                <p class="text-gray-700 mb-2">A view specially adapted for the prize presenter or speaker at the ceremony.</p>
                
                <div class="bg-white border rounded p-4 shadow-sm">
                    <h4 class="font-bold text-gray-800 mb-2">Features:</h4>
                    <ol class="list-decimal list-inside text-sm text-gray-700 space-y-2">
                        <li><strong>Podium View:</strong> The top 3 are presented with large cards.</li>
                        <li><strong>"On Site" Checkbox:</strong> 
                            <span class="block ml-5 text-gray-600">Check the "ON SITE" box when the driver arrives at the ceremony. This helps you see who is missing before the ceremony starts.</span>
                        </li>
                    </ol>
                </div>
            </section>

             <section>
                <h3 class="font-bold text-lg mb-2 text-indigo-700 border-l-4 border-indigo-500 pl-2">📺 Public Screens (Monitors)</h3>
                <p class="text-gray-700 mb-2">
                    The system has three special "Monitor" pages designed to be displayed on large TV screens in the cafeteria or public area.
                    These pages automatically rotate content and always show the latest info.
                </p>
                <div class="bg-indigo-50 p-4 rounded-lg border border-indigo-200">
                    <ul class="list-disc list-inside text-sm text-gray-700 space-y-2">
                        <li><strong>Monitor Dressage:</strong> Shows current entry, current scores, and a rolling result list.</li>
                        <li><strong>Monitor Marathon:</strong> Shows a map with live reporting from obstacles. Crowd favorite!</li>
                        <li><strong>Monitor Precision:</strong> Shows time, faults, and <strong>Max Time</strong> (elimination limit) immediately at the finish.</li>
                    </ul>
                    <p class="text-xs text-indigo-800 mt-2 font-bold">
                        Tip: The monitor pages are mainly intended for <strong>Live mode</strong>. In <strong>Field mode</strong> they are normally hidden from the menu to simplify the workflow.
                    </p>
                </div>
            </section>
        </div>`;

    case 'overview':
      return `
        <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">Overview</h2>
        <div class="space-y-8">
            <section>
                <div class="bg-gradient-to-r from-blue-50 to-indigo-50 p-6 rounded-xl border border-blue-100 text-center relative overflow-hidden">
                    <div class="absolute top-2 right-2 opacity-10">
                        <span class="text-6xl">🌍</span>
                    </div>
                    <h3 class="text-2xl font-bold text-blue-900 mb-2">Welcome to the Competition System!</h3>
                    <p class="text-gray-700 max-w-2xl mx-auto mb-4">
                        This is a comprehensive system for managing carriage driving competitions – from entry to final results.
                        The system is <strong>cloud-based</strong>, meaning all changes happen in real-time ("Live").
                    </p>
                    <div class="inline-flex items-center gap-2 bg-white px-3 py-1 rounded-full border border-blue-200 text-sm text-blue-800 shadow-sm">
                        <span>💡 Tip: Switch language (🇸🇪/🇬🇧) via the flag. Use the moon 🌙 in the menu for Dark Mode.</span>
                    </div>
                </div>
            </section>

            <!-- CHEAT SHEETS QUICK LINKS -->
            <section class="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/40 dark:to-indigo-950/40 p-5 rounded-xl border border-blue-200 dark:border-blue-800/60 shadow-xs">
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                    <div>
                        <h4 class="font-bold text-base text-gray-900 dark:text-gray-100 flex items-center gap-2">
                            <span>🖨️</span> Field Cheat Sheets & Quick Guides (A4 PDF)
                        </h4>
                        <p class="text-xs text-gray-600 dark:text-gray-300">
                            1-page printable cheat sheets for officials and judges at the ring:
                        </p>
                    </div>
                </div>
                <div class="flex flex-wrap gap-2">
                    <button type="button" data-role-pdf="dressage" class="px-3 py-1.5 bg-white dark:bg-gray-800 hover:bg-purple-50 dark:hover:bg-purple-950/50 text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-800 rounded-lg text-xs font-semibold shadow-xs transition-all flex items-center gap-1 active:scale-95">
                        📄 Dressage Writer
                    </button>
                    <button type="button" data-role-pdf="marathon-obstacle" class="px-3 py-1.5 bg-white dark:bg-gray-800 hover:bg-blue-50 dark:hover:bg-blue-950/50 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-lg text-xs font-semibold shadow-xs transition-all flex items-center gap-1 active:scale-95">
                        ⏱️ Marathon Obstacles
                    </button>
                    <button type="button" data-role-pdf="marathon-stages" class="px-3 py-1.5 bg-white dark:bg-gray-800 hover:bg-green-50 dark:hover:bg-green-950/50 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-800 rounded-lg text-xs font-semibold shadow-xs transition-all flex items-center gap-1 active:scale-95">
                        🏁 Section Timers
                    </button>
                    <button type="button" data-role-pdf="precision" class="px-3 py-1.5 bg-white dark:bg-gray-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 text-indigo-800 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 rounded-lg text-xs font-semibold shadow-xs transition-all flex items-center gap-1 active:scale-95">
                        🎾 Cones
                    </button>
                    <button type="button" data-role-pdf="admin_checklist" class="px-3 py-1.5 bg-white dark:bg-gray-800 hover:bg-purple-50 dark:hover:bg-purple-950/50 text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-800 rounded-lg text-xs font-semibold shadow-xs transition-all flex items-center gap-1 active:scale-95">
                        📥 Organizer Checklist
                    </button>
                    <button type="button" data-role-pdf="secretariat" class="px-3 py-1.5 bg-white dark:bg-gray-800 hover:bg-amber-50 dark:hover:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 rounded-lg text-xs font-semibold shadow-xs transition-all flex items-center gap-1 active:scale-95">
                        📋 Secretariat
                    </button>
                    <button type="button" data-role-pdf="observer" class="px-3 py-1.5 bg-white dark:bg-gray-800 hover:bg-red-50 dark:hover:bg-red-950/50 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800 rounded-lg text-xs font-semibold shadow-xs transition-all flex items-center gap-1 active:scale-95">
                        🛑 Observer
                    </button>
                </div>
            </section>

            <section>
                <h3 class="font-bold text-lg mb-2 text-indigo-700 border-l-4 border-indigo-500 pl-2">🏠 Main Menu & Navigation</h3>
                <p class="text-gray-700 mb-2">
                    When you start the system, you land in the <strong>Hub</strong>. Here you see a list of all available competitions.
                </p>
                <div class="grid md:grid-cols-2 gap-4">
                    <div class="bg-white p-4 rounded border shadow-sm">
                        <h4 class="font-bold text-gray-800 mb-1">Find Your Competition</h4>
                        <ul class="list-disc list-inside text-sm text-gray-600 space-y-1">
                            <li>Use the <strong>Search box</strong> to filter by name or location.</li>
                            <li>Click on a card to open the competition.</li>
                            <li>The <strong>"Open"</strong> button goes to the public/participant view.</li>
                            <li>The <strong>"Admin"</strong> button (if authorized) goes to the administration view.</li>
                        </ul>
                    </div>
                    <div class="bg-white p-4 rounded border shadow-sm">
                        <h4 class="font-bold text-gray-800 mb-1">Tips & Tricks</h4>
                        <ul class="list-disc list-inside text-sm text-gray-600 space-y-1">
                            <li><strong>Go Back:</strong> Always click the logo (top left) to return to the Hub and switch competitions.</li>
                            <li><strong>Create New:</strong> (Admin only) Use the form in the Hub to start a new competition.</li>
                            <li><strong>Offline support:</strong> The menu bar shows "Offline" or "Synkar...", and an amber queue button appears at the bottom right while something is waiting. An already loaded input view can queue results locally; wait until the amber queue button at the bottom right (☁️ Synkar...) is gone before closing it.</li>
                            <li><strong>Mobile & Tablet:</strong> The system adapts automatically. Phones show click-friendly "Cards", while tablets and PCs show classic tables.</li>
                        </ul>
                    </div>
                </div>
            </section>

            <section class="grid md:grid-cols-3 gap-6">
                <!-- PRE -->
                <div class="space-y-4">
                    <div class="flex items-center gap-2 mb-2">
                        <div class="bg-blue-600 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold">1</div>
                        <h4 class="font-bold text-gray-800">Before Competition</h4>
                    </div>
                    <div class="bg-white p-4 rounded shadow-sm border-l-4 border-blue-600">
                        <p class="text-sm font-bold text-gray-900">Administrator</p>
                        <p class="text-sm text-gray-600">Creates competition, imports entries, and schedules start times.</p>
                    </div>
                    <div class="flex justify-center text-gray-400">↓</div>
                     <div class="bg-white p-4 rounded shadow-sm border-l-4 border-amber-500">
                        <p class="text-sm font-bold text-gray-900">Driver (My Portal)</p>
                        <p class="text-sm text-gray-600">Logs in, checks their details, and makes any changes (horse sway, groom) before start.</p>
                    </div>
                </div>

                <!-- DURING -->
                <div class="space-y-4">
                    <div class="flex items-center gap-2 mb-2">
                         <div class="bg-green-600 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold">2</div>
                        <h4 class="font-bold text-gray-800">During Competition</h4>
                    </div>
                     <div class="bg-white p-4 rounded shadow-sm border-l-4 border-purple-600">
                        <p class="text-sm font-bold text-gray-900">Judge (Dressage)</p>
                        <p class="text-sm text-gray-600">Judges digitally on iPad. Results are sent directly to the cloud.</p>
                    </div>
                     <div class="bg-white p-4 rounded shadow-sm border-l-4 border-green-600">
                        <p class="text-sm font-bold text-gray-900">Official (Marathon/Precision)</p>
                        <p class="text-sm text-gray-600">Starts clocks and logs knockdowns. Everything syncs live.</p>
                    </div>
                     <div class="bg-white p-4 rounded shadow-sm border-l-4 border-indigo-600">
                        <p class="text-sm font-bold text-gray-900">Speaker</p>
                        <p class="text-sm text-gray-600">Follows the drama live via Dashboard and sees split times.</p>
                    </div>
                </div>

                <!-- POST -->
                <div class="space-y-4">
                    <div class="flex items-center gap-2 mb-2">
                         <div class="bg-gray-800 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold">3</div>
                        <h4 class="font-bold text-gray-800">After Competition</h4>
                    </div>
                     <div class="bg-white p-4 rounded shadow-sm border-l-4 border-gray-800">
                        <p class="text-sm font-bold text-gray-900">Public & Driver</p>
                        <p class="text-sm text-gray-600">See final results online. Driver downloads their protocol.</p>
                    </div>
                     <div class="bg-white p-4 rounded shadow-sm border-l-4 border-blue-900">
                        <p class="text-sm font-bold text-gray-900">Admin (Archiving)</p>
                        <p class="text-sm text-gray-600">Locks the competition and exports official result lists (PDF).</p>
                    </div>
                </div>
            </section>
        </div>
        `;

    case 'admin':
      return `
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3 mb-6">
          <div>
            <h2 class="text-xl font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
              <span>⚙️</span> For Administrators & Organizers
            </h2>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Complete chronological guide to configure, schedule, and run a competition from scratch.</p>
          </div>
          <div class="flex flex-wrap gap-2 self-start sm:self-auto">
            <button type="button" data-role-pdf="admin_checklist" class="px-3.5 py-1.5 bg-purple-700 hover:bg-purple-800 text-white rounded-lg text-xs font-semibold shadow-xs transition-all flex items-center gap-1.5 active:scale-95">
              <span>📥</span> Organizer Checklist (A4 PDF)
            </button>
            <button type="button" data-role-pdf="secretariat" class="px-3.5 py-1.5 bg-amber-700 hover:bg-amber-800 text-white rounded-lg text-xs font-semibold shadow-xs transition-all flex items-center gap-1.5 active:scale-95">
            <span>📋</span> Secretariat Cheat Sheet (PDF)
          </button>
          </div>
        </div>

        <div class="space-y-8">

          <!-- CHRONOLOGICAL SETUP CHECKLIST -->
          <section class="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/40 dark:to-indigo-950/40 p-5 rounded-xl border border-blue-200 dark:border-blue-800/60 shadow-xs">
            <h3 class="font-bold text-lg text-blue-900 dark:text-blue-200 mb-1 flex items-center gap-2">
              <span>🧭</span> Step-by-Step: Setting Up a Competition from Scratch
            </h3>
            <p class="text-xs text-gray-600 dark:text-gray-300 mb-4">
              Follow this chronological checklist to configure your competition correctly from day one:
            </p>

            <div class="space-y-3">

              <!-- PHASE 1 -->
              <details class="manual-accordion" open>
                <summary>
                  <span class="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100">
                    <span class="bg-blue-600 text-white w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold">1</span>
                    <strong>Phase 1: Create Competition & Import Entries (.XML)</strong>
                    <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">(1–2 weeks before)</span>
                  </span>
                  <span class="text-gray-400 text-xs">▼</span>
                </summary>
                <div class="manual-accordion-content text-xs text-gray-700 dark:text-gray-300 space-y-2">
                  <p><strong>1. Create competition:</strong> Go to <em>Start / Hub</em>. Enter name, dates, and venue. If you organized the event last year, use <em>"Base on previous competition"</em> to copy classes and parameters.</p>
                  <p><strong>2. Download entry XML from national database (e.g. TDB):</strong> Export entries formatted as Equipe XML (ending in <code>.eqentries.xml</code>).</p>
                  <p><strong>3. Import participants:</strong> Go to <em>Admin > Participants</em> and click <em>"Import XML"</em>. All drivers, horses, clubs, and classes are populated automatically.</p>
                  <p><strong>4. Manual adjustments:</strong> Edit entries for late registrations, scratches, or division overrides. Flag <em>"Para Driver"</em> where applicable.</p>
                </div>
              </details>

              <!-- PHASE 2 -->
              <details class="manual-accordion">
                <summary>
                  <span class="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100">
                    <span class="bg-purple-600 text-white w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold">2</span>
                    <strong>Phase 2: Officials, Judges & Dressage Tests</strong>
                    <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">(1 week before)</span>
                  </span>
                  <span class="text-gray-400 text-xs">▼</span>
                </summary>
                <div class="manual-accordion-content text-xs text-gray-700 dark:text-gray-300 space-y-2">
                  <p><strong>1. Register officials:</strong> Under <em>Admin > Officials</em>, add judges and crew. Assign their primary role (e.g., "Dressage - C", "Obstacle Judge", "Start A", "Secretariat").</p>
                  <p><strong>2. Safety & Logistics:</strong> Store phone number, ICE contact, dietary requirements, and shirt size for each volunteer.</p>
                  <p><strong>3. Assign dressage judges:</strong> Go to <em>Admin > Dressage</em>. Assign judges to positions (C, E, B) per class. This controls which protocols appear on their tablets.</p>
                  <p><strong>4. Dressage tests:</strong> Verify the correct test is attached to each class. Standard national and FEI tests are built-in; custom tests can be uploaded via PDF.</p>
                </div>
              </details>

              <!-- PHASE 3 -->
              <details class="manual-accordion">
                <summary>
                  <span class="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100">
                    <span class="bg-green-600 text-white w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold">3</span>
                    <strong>Phase 3: Course Data for Marathon & Cones</strong>
                    <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">(1–2 days before)</span>
                  </span>
                  <span class="text-gray-400 text-xs">▼</span>
                </summary>
                <div class="manual-accordion-content text-xs text-gray-700 dark:text-gray-300 space-y-2">
                  <p><strong>1. Marathon sections & speeds:</strong> In <em>Admin > Marathon</em>, enter distance (meters) and speed (m/min) for Section A, Transfer, and Section B. Time windows (ideal, min, max) are calculated automatically. The transfer has only a time limit (double the max time) and no time penalties.</p>
                  <p><strong>2. Obstacles, Gates & Knockdown Balls:</strong> Add Obstacles 1–N. Set gate count (A–F). <strong>Important:</strong> If an obstacle has dislodgeable elements or balls, tick <em>☑️ "Dislodgeable element / ball"</em>. This activates the knockdown counter for the obstacle judge, with 2 penalty points per element knocked down.</p>
                  <p><strong>3. Course Map (Optional):</strong> Link a map image from Google Drive and plot obstacle coordinates so the public screen ("Monitor Marathon") shows live positions.</p>
                  <p><strong>4. Precision (Cones):</strong> In <em>Admin > Precision</em>, set course length and speed (m/min). Allowed and maximum times are computed automatically. The gate width is the track width plus the class allowance under TR (e.g. Lätt B 35 cm, Lätt A 30 cm, children 45 cm), which can be changed per class.</p>
                </div>
              </details>

              <!-- PHASE 4 -->
              <details class="manual-accordion">
                <summary>
                  <span class="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100">
                    <span class="bg-amber-600 text-white w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold">4</span>
                    <strong>Phase 4: Start Times & Scheduling</strong>
                    <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">(Day before start)</span>
                  </span>
                  <span class="text-gray-400 text-xs">▼</span>
                </summary>
                <div class="manual-accordion-content text-xs text-gray-700 dark:text-gray-300 space-y-2">
                  <p><strong>1. Generate start times:</strong> In <em>Admin > Start Times</em>, select discipline and classes, set interval (e.g. 8–10 min), and click <em>"Generate"</em>.</p>
                  <p><strong>2. Drag-and-drop:</strong> Reorder rows to accommodate driver requests or double entries.</p>
                  <p><strong>3. Breaks:</strong> Click the coffee cup ☕ to insert judge breaks or arena maintenance. Later times update automatically.</p>
                  <p><strong>4. Publish:</strong> Save and toggle <em>"Publish Startlist"</em> so times appear in My Portal and on spectator boards.</p>
                </div>
              </details>

              <!-- PHASE 5 -->
              <details class="manual-accordion">
                <summary>
                  <span class="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100">
                    <span class="bg-indigo-600 text-white w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold">5</span>
                    <strong>Phase 5: Event Morning (Carriage Check, Vet & Locking)</strong>
                    <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">(Competition Day)</span>
                  </span>
                  <span class="text-gray-400 text-xs">▼</span>
                </summary>
                <div class="manual-accordion-content text-xs text-gray-700 dark:text-gray-300 space-y-2">
                  <p><strong>1. Carriage track width:</strong> Open <em>Carriage Width</em>. Record measured axle width; the system verifies against national TR rules and flags narrow carriages.</p>
                  <p><strong>2. Veterinary inspection:</strong> Use <em>Vet Inspection</em> for initial check, resting area pulse (auto-warns above 64 bpm), and final check.</p>
                  <p><strong>3. Lock driver portal:</strong> In <em>Admin > Settings</em>, ensure the declaration auto-lock timer is active (default 60 min before start) or click <em>"Lock all changes NOW"</em>.</p>
                  <p><strong>4. Event mode:</strong> Confirm mode is set to <strong>Live</strong> in settings.</p>
                </div>
              </details>

              <!-- PHASE 6 -->
              <details class="manual-accordion">
                <summary>
                  <span class="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100">
                    <span class="bg-emerald-600 text-white w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold">6</span>
                    <strong>Phase 6: Results Verification, Prizegiving & Archiving</strong>
                    <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">(Post-Competition)</span>
                  </span>
                  <span class="text-gray-400 text-xs">▼</span>
                </summary>
                <div class="manual-accordion-content text-xs text-gray-700 dark:text-gray-300 space-y-2">
                  <p><strong>1. Final verification:</strong> Check on each discipline's result page (Dressage, Marathon and Cones results) that every result is finalized. If corrections are needed, an authorized user lifts the finalization with <em>${btn('undo', 'en')}</em> on that discipline's result page, corrects (e.g. in the Secretariat) and finalizes again. <em>Total Results</em> shows the overall standings.</p>
                  <p><strong>2. Official printouts:</strong> Print the official A4 result sheets for prizegiving.</p>
                  <p><strong>3. End & Archive:</strong> Open the <em>📦 Arkivering</em> (Archiving) tab in Admin and click <em>"🏁 Avsluta Tävling"</em> (End competition). This freezes the results and stores a permanent copy of the result list. To change anything afterwards the competition must be reopened.</p>
                  <p><strong>4. Report to the federation:</strong> TDB has no file import for combined driving, so DriveLive does not create a result file. Open <em>Report Center</em> -> <em>TDB entry sheet</em>: it lists every result list in TDB's order with placing codes (99 = eliminated/retired/withdrawn after the start, 98/1 = clear round, 0 = only ekipage in the class), licence numbers to copy and a PDF. Type the results into TDB by hand and submit them for review within 5 days after the competition.</p>
                </div>
              </details>

            </div>
          </section>

          <!-- DEEP DIVE 1: PARTICIPANTS & DATA -->
          <section>
            <h3 class="font-bold text-lg mb-2 text-blue-700 border-l-4 border-blue-500 pl-2">2. Participants & Volunteer Management</h3>
            <div class="space-y-6">
              <div class="bg-white border rounded-lg p-4 shadow-sm">
                <h4 class="font-bold text-gray-800 text-base mb-2">📋 Entries & Data</h4>
                <ul class="list-disc list-inside text-sm text-gray-600 ml-2 space-y-1">
                  <li><strong>XML import:</strong> Upload <code>.eqentries.xml</code> to populate all entries, horses, and categories instantly.</li>
                  <li><strong>Edit entry:</strong> Click an entry to update driver, horse names, license IDs, club, or class.</li>
                  <li><strong>Scratches & Late entries:</strong> Set status to "Struken" (Scratched) in the list, or add late starters via "New Entry".</li>
                </ul>

                <h5 class="text-sm font-bold text-gray-700 mt-4 mb-1">Judges & Crew</h5>
                <ul class="list-disc list-inside text-sm text-gray-600 ml-2 space-y-1">
                  <li><strong>Access:</strong> Officials join with their role's code (10 characters) from <em>Admin > Settings</em>. Preferably send the join link or QR code, which fills in the competition. Codes can be changed and access revoked. Admins do not join with a code (there is no admin PIN): invite them by email under <em>Officials > Invite administrator</em>.</li>
                  <li><strong>Registration:</strong> Add judges and officials here so they can be linked to their position and assignments.</li>
                  <li><strong>Safety & Catering:</strong> Track ICE contact, allergies, and shirt sizes for logistical reports.</li>
                  <li><strong>Reports:</strong> Under <em>Reports</em>, export phone lists, station assignment sheets, check-in lists, and catering summaries (PDF and CSV).</li>
                </ul>
              </div>

              <!-- COMMUNICATION -->
              <div class="bg-white border rounded-lg p-4 shadow-sm">
                <h4 class="font-bold text-gray-800 text-base mb-2">📢 Communication & Course Maps</h4>
                <ul class="list-disc list-inside text-sm text-gray-600 ml-2 space-y-1">
                  <li><strong>Broadcast:</strong> Send urgent notifications to all participant portals (e.g. weather delays).</li>
                  <li><strong>Targeted message:</strong> Choose the audience <em>"Valda kuskar"</em> (selected drivers) and tick one or more drivers in the checklist, e.g. about passports or inspections.</li>
                  <li><strong>Documents:</strong> Link external PDF course maps that drivers open in their app under <em>Documents</em>.</li>
                </ul>
              </div>

              <!-- E-MAIL -->
              <div class="bg-white border rounded-lg p-4 shadow-sm">
                <h4 class="font-bold text-gray-800 text-base mb-2">✉️ E-mail</h4>
                <ul class="list-disc list-inside text-sm text-gray-600 ml-2 space-y-1">
                  <li><strong>How it works:</strong> Tick <em>"Also send as e-mail"</em> when you write a message. You see at once how many will get it, how many opted out and how many have no e-mail address. When times change on a published start list you can also e-mail the drivers concerned; each driver gets only their own times.</li>
                  <li><strong>Sender and replies:</strong> All e-mail is sent from the app address with <em>"Club name via DriveLive"</em> as the sender. Under <em>Communication &gt; E-mail</em> you set the sender name and a reply address (Reply-To) that replies go to.</li>
                  <li><strong>Verify the reply address:</strong> Press <em>"Verify the address"</em>. An e-mail with a link is sent to the address; the reply address is used only after the link has been opened. Until then it is marked <em>not verified</em>.</li>
                  <li><strong>Important message:</strong> Also goes to those who opted out of ordinary mail. Use it only for what must get through.</li>
                  <li><strong>Not connected yet:</strong> If the app's e-mail service is not connected, mail is queued with the status <em>"Waiting: not configured"</em> and is sent once the service is connected. The message in the app is still published at once.</li>
                  <li><strong>Test mail and log:</strong> <em>"Send a test e-mail to me"</em> tries sending. The <em>Recent mail</em> list shows status, number sent and any errors.</li>
                </ul>
              </div>
              <!-- NOTIFICATIONS -->
              <div class="bg-white border rounded-lg p-4 shadow-sm">
                <h4 class="font-bold text-gray-800 text-base mb-2">🔔 Notifications</h4>
                <ul class="list-disc list-inside text-sm text-gray-600 ml-2 space-y-1">
                  <li><strong>How it works:</strong> Drivers and officials turn notifications on themselves under <em>Notifications</em> in the driver portal or on the official page and choose what they want: changed start times, messages, pause, vet decisions and (for the secretariat and TD) changed declarations. You can send a test notification and turn notifications off on the device.</li>
                  <li><strong>Changed start times:</strong> When you change times on a published list a notification goes to the drivers concerned, and each driver gets only their own times. The message you can send after the change does not give a double notification.</li>
                  <li><strong>iPhone:</strong> Notifications need iOS 16.4 or later and the app on the home screen: tap the Share button, choose <em>Add to Home Screen</em>, open the app from its icon and turn notifications on there.</li>
                  <li><strong>Not enabled yet:</strong> Until the superadmin has saved a VAPID key and switched notifications on, <em>"Notifications are not enabled yet"</em> is shown. Everything else in the app works as usual.</li>
                </ul>
              </div>
              <!-- SETTINGS -->
              <div class="bg-white border rounded-lg p-4 shadow-sm">
                <h4 class="font-bold text-gray-800 text-base mb-2">⚙️ Global Settings & Profile</h4>
                <div class="space-y-2 text-sm text-gray-600">
                  <p><strong>Profile (FEI / National):</strong> Controls terminology, headings, and certificate templates.</p>
                  <p><strong>Logo:</strong> Upload competition logo; it prints on all official PDF protocols and result sheets.</p>
                  <p><strong>Declaration locking:</strong> Set automatic cutoff time (default 60 min before class start) or use emergency freeze.</p>
                </div>
              </div>
            </div>
          </section>

          <!-- DEEP DIVE 2: COURSE DATA -->
          <section>
            <h3 class="font-bold text-lg mb-2 text-orange-700 border-l-4 border-orange-500 pl-2">3. Marathon & Precision Course Specifications</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-700">
              <div class="bg-orange-50 p-4 rounded border border-orange-200">
                <strong class="block text-orange-900 mb-2">🌲 Marathon: Distances, Obstacles & Balls</strong>
                <ul class="list-disc list-inside space-y-1 text-xs text-gray-700">
                  <li><strong>Sections:</strong> Distance (m) and speed (m/min) for Sections A, Transfer, and B.</li>
                  <li><strong>Obstacles:</strong> Create obstacles 1–8 and assign gate counts (A–E or A–F).</li>
                  <li><strong>Knockdowns:</strong> Tick <em>"Dislodgeable element / ball"</em> for obstacles with balls (2 penalty points per element).</li>
                  <li><strong>Print timecards:</strong> Use <em>Calculate Times</em> to print verification cards for all classes.</li>
                </ul>
              </div>
              <div class="bg-purple-50 p-4 rounded border border-purple-200">
                <strong class="block text-purple-900 mb-2">🏁 Precision: Times & Clearance</strong>
                <ul class="list-disc list-inside space-y-1 text-xs text-gray-700">
                  <li><strong>Length & Speed:</strong> Auto-calculates allowed and maximum times.</li>
                  <li><strong>Clearance:</strong> Track width plus the class allowance under TR (e.g. Lätt B 35 cm, Lätt A 30 cm, children 45 cm).</li>
                  <li><strong>Penalties:</strong> 3 points per knockdown; 0.5 points per second over the Time Allowed, to two decimals.</li>
                </ul>
              </div>
            </div>
          </section>

          <!-- SPECIAL MARATHON CLASSES -->
          <section>
            <h3 class="font-bold text-lg mb-2 text-indigo-700 border-l-4 border-indigo-500 pl-2">4. Marathon: Division Templates & Exceptions</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div class="bg-white border rounded p-4 shadow-sm">
                <strong class="text-indigo-900 block font-bold mb-1">1. Mixed Divisions</strong>
                <p class="text-xs text-gray-600">Select template level (e.g. Lätt B) to automatically assign appropriate speeds across horse and pony categories in a merged class.</p>
              </div>
              <div class="bg-white border rounded p-4 shadow-sm">
                <strong class="text-indigo-900 block font-bold mb-1">2. Para Drivers</strong>
                <p class="text-xs text-gray-600">Check <em>"Para Driver"</em> on the entry card to apply regulatory speed adjustments automatically.</p>
              </div>
              <div class="bg-white border rounded p-4 shadow-sm">
                <strong class="text-indigo-900 block font-bold mb-1">3. Children's Classes</strong>
                <p class="text-xs text-gray-600">Selecting <em>"Barnklass"</em> includes mandatory 10 min warm-up and compliant speed rates.</p>
              </div>
              <div class="bg-white border rounded p-4 shadow-sm">
                <strong class="text-indigo-900 block font-bold mb-1">4. Warm-up Section</strong>
                <p class="text-xs text-gray-600">Set fixed minutes in <em>"Fixed Time (WU)"</em> to convert Section A into a warm-up period without time penalties.</p>
              </div>
            </div>
          </section>

          <!-- TEAMS & CARRIAGE -->
          <section>
            <h3 class="font-bold text-lg mb-2 text-cyan-700 border-l-4 border-cyan-500 pl-2">5. Carriage Verification & Team Competition</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div class="bg-white border rounded p-4 shadow-sm">
                <strong class="text-cyan-900 block font-bold mb-1">🏎️ Carriage Width Verification</strong>
                <p class="text-xs text-gray-600">Enter measured wheel track width under <em>Carriage Width</em>. The system cross-references against minimum allowable dimensions and flags non-compliance.</p>
              </div>
              <div class="bg-white border rounded p-4 shadow-sm">
                <strong class="text-cyan-900 block font-bold mb-1">🏆 Team Championship (Teams)</strong>
                <p class="text-xs text-gray-600">Create teams and drag drivers into team cards. System automatically looks up club logos and national flags.</p>
              </div>
            </div>
          </section>

        </div>
      `;

        case 'official':
      return `
        <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">For Officials</h2>
        <div class="space-y-8">

          <!-- DASHBOARD -->
          <section>
            <h3 class="font-bold text-lg mb-2 text-indigo-700 border-l-4 border-indigo-500 pl-2">Overview & Dashboard</h3>
            <p class="text-gray-700 mb-2">When you log in as an official, you are greeted by a <strong>Dashboard</strong> giving you a quick overview.</p>
            <div class="bg-indigo-50 p-4 rounded-lg space-y-3">
              <ul class="list-disc list-inside text-sm text-gray-700 space-y-2">
                <li><strong>Next Start:</strong> Shows which equipage is up next for you (based on your role). Click "Go to..." to jump directly to the input screen for that driver.</li>
                <li><strong>To Do / Sync:</strong> Shows if you have any protocols or times pending upload (Sync Queue).</li>
                <li><strong>Shortcuts:</strong> Direct access to the tools you need (e.g., Timing, Obstacles, Vet Check).</li>
                <li><strong>Messages:</strong> Messages for officials (to everyone, your role or the TD) are shown at the top with a count. <strong>Needs attention</strong> is shown for admin, secretariat, TD and vet.</li>
                <li><strong>Notifications:</strong> A clear card at the top asks if you want to <strong>turn on notifications</strong> on this device (on iPhone only after <em>Add to Home Screen</em>).</li>
              </ul>
            </div>
          </section>
          
          <section>
            <h3 class="font-bold text-lg mb-2 text-green-700 border-l-4 border-green-500 pl-2">Marathon: Timing (Positions)</h3>
            <p class="text-gray-700 mb-2">For Start/Finish A, B, etc.</p>
            <div class="bg-green-50 p-4 rounded-lg space-y-3">
                <h4 class="font-semibold text-green-800">Workflow:</h4>
                <ol class="list-decimal list-inside space-y-2 text-gray-700">
                    <li><strong>Log in:</strong> Ensure you are logged in (top right).</li>
                    <li><strong>Select View:</strong> Choose <strong>Marathon Timing</strong> in the menu.</li>
                    <li><strong>Select the equipage:</strong> Pick it in the list (you can search by start number).</li>
                    <li><strong>Timing:</strong>
                        <ul class="list-disc list-inside ml-5 mt-1">
                            <li>Wait for the equipage.</li>
                            <li>Tap the green <strong>START</strong> button for the section when the turnout starts, and the red <strong>FINISH</strong> button when it finishes.</li>
                            <li><em>Correction:</em> Tap the section time (the big clock) and enter the driven time as <code>mmsscc</code> (e.g. 251530 = 25:15.30).</li>
                        </ul>
                    </li>
                    <li><strong>Late start:</strong> If the turnout is not ready at its official start time, start the clock when it actually starts and enter the late-start penalty (TR V 522.4: 0.25 penalties per second, each second begun counts; FEI 963.4.1: 0.25 per second) in <strong>${btn('marathon_stages_other_penalty_total', 'en')}</strong> on the section's tab. The system does not calculate it.</li>
                    <li><strong>Active Timers:</strong> The dropdown at the top shows currently running clocks. It allows you to start #1, switch to #2, while still seeing #1 ticking.</li>
                    <li>
                      <strong class="text-red-800">Global Pause:</strong>
                      <br><span class="ml-4">If the screen turns grey, the competition is <strong>PAUSED</strong>. Do not time anything.</span>
                    </li>
                </ol>
            </div>
          </section>

          <section>
            <h3 class="font-bold text-lg mb-2 text-blue-700 border-l-4 border-blue-500 pl-2">Maraton: Obstacles (Tablet)</h3>
            <p class="text-gray-700 mb-2">For obstacle judges.</p>
            <ol class="list-decimal list-inside space-y-2 text-gray-700 bg-white p-4 border rounded shadow-sm">
                <li><strong>Select View:</strong> Choose <strong>Obstacle Input</strong> in the menu.</li>
                <li><strong>Select the equipage:</strong> Use the search box at the top or the « » arrows as the turnout approaches.</li>
                <li><strong>Check the obstacle:</strong> Your obstacle number is selected in the list next to it (the app remembers the one you chose last).</li>
                <li><strong>Timing:</strong>
                     <ul class="list-disc list-inside ml-5 mt-1">
                        <li>Tap <strong>START</strong> when the horse's nose crosses the entry flags.</li>
                        <li>Tap <strong>STOP</strong> when the turnout crosses the exit flags.</li>
                    </ul>
                </li>
                <li><strong>Route, knockdowns and hold time:</strong>
                     <ul class="list-disc list-inside ml-5 mt-1">
                        <li><strong>${btn('marathon_route_through_obstacle', 'en')}:</strong> Tap the gates in the order they are driven. The app warns when a gate comes out of order; ${btn('marathon_undo', 'en')} removes the last one.</li>
                        <li><strong>${btn('marathon_knockdowns', 'en')}:</strong> Shown only on obstacles with breakable elements. Enter the number knocked down (2 penalties each).</li>
                        <li><strong>${btn('marathon_hold_time', 'en')}:</strong> If the entry must wait before entering the obstacle, enter the waiting time in <strong>minutes</strong> (quick buttons +½, +1, +2 or e.g. 2.5) and pick or type the reason.</li>
                    </ul>
                </li>
                <li><strong>Save:</strong> Click "${btn('marathon_save_and_next', 'en')}". The result is sent and the next turnout in the start order is selected.</li>
            </ol>
            <div class="mt-2 text-sm text-blue-900 bg-blue-50 p-3 rounded border border-blue-100">
              <strong>Important:</strong> Hold time is deducted from Section B and is shown in result modals/PDFs so the secretariat and driver can see where, when and why the deduction was made.
            </div>
          </section>

          <section>
             <h3 class="font-bold text-lg mb-2 text-purple-700 border-l-4 border-purple-500 pl-2">Precision (Cones) Input</h3>
             <ul class="list-disc list-inside text-gray-700 text-sm bg-white p-4 border rounded shadow-sm">
                <li>Select <strong>Precision Input</strong>.</li>
                <li><strong>Timer:</strong> Works like a stopwatch. Start when nose crosses start, Stop when nose crosses finish.</li>
                <li><strong>Balls Down:</strong> Tap the ball numbers (1, 2, 3...) that correspond to the cone numbers knocked down. Each tap adds +3 points.</li>
                <li><strong>Rebuild:</strong> If an obstacle has to be rebuilt during the round, tap <strong>+10 s (ombyggnad)</strong> under the clock (10 seconds per rebuild, −1 undoes one).</li>
                <li><strong>Save:</strong> Click "${btn('precision_save_results', 'en')}" to save the result.</li>
             </ul>
          </section>

          <section>
            <h3 class="font-bold text-lg mb-2 text-gray-700 border-l-4 border-gray-500 pl-2">Special Features (Inspection)</h3>
            
            <div class="grid md:grid-cols-2 gap-6">
                <!-- Vet -->
                <div class="bg-gray-50 p-4 rounded-lg border border-gray-200">
                    <h4 class="font-bold text-gray-800 flex items-center gap-2">🩺 Veterinarian</h4>
                    <p class="text-sm text-gray-600 mb-2">Used during check-in/pre-inspection.</p>
                    <ul class="list-disc list-inside text-sm text-gray-700 space-y-1">
                        <li><strong>Search Entry:</strong> Type name or number to find the horse, or select directly from the dropdown list!</li>
                        <li><strong>Status:</strong>
                            <ul class="list-disc list-inside ml-4 text-xs mt-1">
                                <li><strong>Approved (Green):</strong> Horse is OK to start.</li>
                                <li><strong>Hold (Yellow):</strong> Uncertain status, sent to Holding Box.</li>
                                <li><strong>Scratched (Red):</strong> Horse may not start. Your withdrawal goes to the ground jury first: the equipage shows <em>"Vet strike awaiting the ground jury"</em> until the secretariat or the TD confirms or overturns it. If you approve the horse again before that, the withdrawal is taken back.</li>
                            </ul>
                        </li>
                        <li><strong>Notes:</strong> You can enter observations (e.g., wounds) that are saved on the entry.</li>
                    </ul>
                </div>

                <!-- Carriage & Function -->
                <div class="bg-gray-50 p-4 rounded-lg border border-gray-200">
                    <h4 class="font-bold text-gray-800 flex items-center gap-2">⚖️ Carriage & Function</h4>
                    <p class="text-sm text-gray-600 mb-2">Measuring carriage width and safety check.</p>
                    <ul class="list-disc list-inside text-sm text-gray-700 space-y-1">
                        <li><strong>Measurement:</strong> Enter the width for dressage/cones and marathon. The system warns when the carriage is narrower than the class minimum (TR Annex 2).</li>
                        <li><strong>Safety Check:</strong> Tick "Vagn godkänd" (carriage approved) if the equipment is correct.</li>
                        <li><strong>Save:</strong> Click "Spara &amp; gå till nästa" (save &amp; next) to save and jump to the next entry.</li>
                    </ul>
                </div>
            </div>
          </section>

          <!-- FIELD GUIDE & HARDWARE -->
          <section class="bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/30 p-5 rounded-xl border border-emerald-200 dark:border-emerald-800 shadow-xs">
            <h3 class="font-bold text-lg text-emerald-900 dark:text-emerald-200 mb-2 flex items-center gap-2">
              <span>🔋</span> Practical Field & Hardware Guide
            </h3>
            <p class="text-xs text-gray-600 dark:text-gray-300 mb-4">
              Officials on obstacles and timing lines often spend 6-8 hours outdoors. Key tips for hassle-free operations:
            </p>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="bg-white dark:bg-gray-800 p-4 rounded-lg border border-emerald-100 dark:border-emerald-900/50 shadow-xs">
                <strong class="text-emerald-800 dark:text-emerald-300 block mb-1 text-sm">📱 Keep Screen Awake (Screen Wake Lock)</strong>
                <p class="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                  The app automatically engages the browser's <em>Screen Wake Lock</em> to prevent your device from going to sleep during a round. Keep the tab open in the foreground and verify that aggressive power-saving mode is disabled on your device.
                </p>
              </div>
              <div class="bg-white dark:bg-gray-800 p-4 rounded-lg border border-emerald-100 dark:border-emerald-900/50 shadow-xs">
                <strong class="text-emerald-800 dark:text-emerald-300 block mb-1 text-sm">🔋 Battery & Power Bank</strong>
                <p class="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                  Keeping screens on outdoors drains battery. Always bring a fully charged power bank and suitable charging cable to your obstacle or timing post.
                </p>
              </div>
              <div class="bg-white dark:bg-gray-800 p-4 rounded-lg border border-emerald-100 dark:border-emerald-900/50 shadow-xs">
                <strong class="text-emerald-800 dark:text-emerald-300 block mb-1 text-sm">📡 Sync Indicator</strong>
                <ul class="text-xs text-gray-600 dark:text-gray-300 space-y-1.5 mt-1">
                  <li>🟠 <strong>Amber queue button at the bottom right (☁️ count):</strong> Writes are waiting locally on this device and are sent automatically when the connection returns. <em>Do not close the tab!</em></li>
                  <li>✅ <strong>No queue button:</strong> Everything has been sent and is visible to the secretariat.</li>
                  <li>⚫ <strong>"Offline" in the menu bar:</strong> No connection. Continue only in views and competition data that were loaded before coverage was lost, and verify that each save enters the queue.</li>
                </ul>
              </div>
              <div class="bg-white dark:bg-gray-800 p-4 rounded-lg border border-emerald-100 dark:border-emerald-900/50 shadow-xs">
                <strong class="text-emerald-800 dark:text-emerald-300 block mb-1 text-sm">☀️ Sunlight & Rain Protection</strong>
                <p class="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                  In direct sunlight, <em>Light Mode</em> typically offers superior contrast against screen reflections. In case of drizzle or rain, a clear plastic pouch or waterproof sleeve protects tablets while touch input continues to work through the plastic.
                </p>
              </div>
            </div>
          </section>
        </div>`;

    case 'judge':
      return `
        <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">For Judges (Dressage)</h2>
        <div class="space-y-8">
           <section>
            <h3 class="font-bold text-lg mb-2 text-purple-700 border-l-4 border-purple-500 pl-2">Digital Protocols (iPad)</h3>
            <p class="text-gray-700 mb-2">Forget paper! You judge directly on the screen.</p>
            
            <div class="bg-purple-50 p-4 rounded-lg space-y-3 border border-purple-100">
                <h4 class="font-bold text-purple-900 text-sm">Typical Workflow:</h4>
                <ol class="list-decimal list-inside space-y-2 text-gray-700 text-sm">
                    <li><strong>Log in:</strong> You will receive a login from the organizer (or select your name in the list if open).</li>
                    <li><strong>Select View:</strong> Choose <strong>"Judge Dressage"</strong>.</li>
                    <li><strong>Select Current Drive:</strong> Pick the equipage on track (search box or « » arrows). Test and judge are filled in from the class judging plan; check that your judge position is shown.</li>
                    <li><strong>Scoring:</strong>
                        <ul class="list-disc list-inside ml-5 mt-1">
                            <li><strong>Points:</strong> Enter 0-10. Decimals (e.g., 6.5) work fine.</li>
                            <li><strong>Summary bar:</strong> The bar at the top stays visible while you scroll and shows the equipage, percent, points, penalties and how many movements are filled (e.g. "${btn('input_filled_count', 'en').replace('{n}', '12').replace('{total}', '20')}").</li>
                            <li><strong>Comments:</strong> Type comments in the text box.</li>
                            <li><strong>Navigation:</strong> Use the <code>TAB</code> key to jump to comment, and <code>ENTER</code> to jump to the next movement.</li>
                        </ul>
                    </li>
                    <li><strong>Save the protocol:</strong> When finished, scroll down and click <strong>"Save Protocol"</strong>. The judge's assessment is saved and you move to the next equipage. Once every assigned judge has saved, the equipage is shown as complete, but the result is not official or locked until an authorized user finalizes it on the results page.</li>
                </ol>
            </div>
           </section>

           <section class="bg-white p-4 rounded border-l-4 border-red-500 shadow-sm">
             <h4 class="font-bold text-red-800 text-sm flex items-center gap-2">
                <span>📡</span> Offline Mode / No Internet
             </h4>
             <p class="text-sm text-red-900 mt-1">
                If the internet goes down, <strong>DO NOT CLOSE THE PAGE</strong>.
                If this judge view and the competition data were loaded before coverage was lost, continue judging and click "Save Protocol" as usual. Verify the queued notice and keep the tab open until the amber queue button at the bottom right (☁️ Synkar...) is gone after the connection returns.
             </p>
           </section>

           <section>
                <h3 class="font-bold text-lg mb-2 text-gray-700 border-l-4 border-gray-500 pl-2">Common Errors & Course Errors</h3>
                <div class="bg-gray-50 p-4 rounded text-sm text-gray-700 border">
                    <p class="mb-2"><strong>First error (+5):</strong> Click "1st error (+5)".</p>
                    <p class="mb-2"><strong>Second error (+10):</strong> Click "2nd error (+10)".</p>
                    <p class="mb-2"><strong>Third error:</strong> Click "3rd error". It asks before marking the turnout eliminated.</p>
                    <p><strong>Elimination for other reasons:</strong> Tick "Eliminated" at the bottom, explain why in the general comment and save the protocol.</p>
                </div>
           </section>
        </div>`;

    case 'driver':
      return `
        <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">For Drivers</h2>
        <div class="space-y-8">
            <section>
                <h3 class="font-bold text-lg mb-2 text-amber-700 border-l-4 border-amber-500 pl-2">My Portal (The App)</h3>
                <p class="text-gray-700 mb-2">
                    As a driver, you have your own protected page. Access it by logging in with exactly the same <strong>email address</strong> you used when registering in the entry system.
                </p>
                 <div class="bg-amber-50 p-6 rounded-lg space-y-4 border border-amber-200">
                     <h4 class="font-bold text-amber-900">What you can do here:</h4>
                     <ul class="list-disc list-inside text-sm text-gray-800 space-y-2">
                        <li><strong>Start Times:</strong> See exactly when you start in all disciplines.</li>
                        <li><strong>Live Results:</strong> Your result appears here immediately after you finish.</li>
                        <li><strong>Digital Self-Declaration:</strong>
                            <p class="text-xs text-gray-600 ml-5 mt-1">
                                Instead of paper forms! Change Horse, Carriage, Groom, or Wheel Width.
                                <br><span class="font-bold text-red-600">Note:</span> Logic locks 60 minutes before your start time. After that, you must visit the Secretariat.
                            </p>
                        </li>
                        <li><strong>Vet Control:</strong> See if your horse is "Accepted" or "Holding Box".</li>
                        <li><strong>Speaker Notes:</strong> Write a fun text about your horse/groom for the speaker to read during your drive.</li>
                        <li><strong>Documents:</strong> Read published course maps, bulletins and organizer messages in the portal.</li>
                        <li><strong>Protocols:</strong> After the class is finished, download your Dressage Protocol (PDF) directly to your phone.</li>
                     </ul>
                 </div>
            </section>

             <section>
                <h3 class="font-bold text-lg mb-2 text-blue-700 border-l-4 border-blue-500 pl-2">Results & Messages</h3>
                <div class="space-y-4 text-gray-700">
                    <ul class="list-disc list-inside ml-2">
                        <li><strong>Messages:</strong> Receive personal messages (just to you) and broadcasts (to everyone). The number of unread messages is shown by the heading; <em>Mark all as read</em> clears it. The organiser can correct a sent message, and it then shows as new again.</li>
                        <li><strong>Notifications:</strong> To get a message as a notification on your phone, turn on notifications in the portal. On iPhone, choose <em>Add to Home Screen</em> first (iOS 16.4 or later). The device setting is also under My account.</li>
                        <li><strong>Vet decision:</strong> If the vet has proposed a withdrawal, your entry shows <em>"Vet decision awaiting the ground jury's decision"</em> until the ground jury has decided.</li>
                    </ul>
                    
                    <div class="bg-gray-50 p-4 rounded-lg">
                        <h4 class="font-bold text-gray-800 mb-2">FAQ</h4>
                        <details class="group cursor-pointer mb-2">
                            <summary class="font-medium text-gray-700 list-none flex items-center justify-between border-b pb-1">
                                <span>Why can't I change my horse?</span>
                                <span class="transition group-open:rotate-180">▼</span>
                            </summary>
                            <p class="text-gray-600 mt-2 text-sm">
                                The portal locks automatically a set time (often 60 min) before your start. Contact the secretariat for urgent changes.
                            </p>
                        </details>
                        <details class="group cursor-pointer">
                            <summary class="font-medium text-gray-700 list-none flex items-center justify-between border-b pb-1">
                                <span>I can't see my competition?</span>
                                <span class="transition group-open:rotate-180">▼</span>
                            </summary>
                            <p class="text-gray-600 mt-2 text-sm">
                                Try clicking <strong>"Find my entries again"</strong> in the portal. Ensure you are logged in with the email used for entry.
                            </p>
                        </details>
                    </div>
                </div>
            </section>
        </div>`;

    case 'speaker':
      return `
        <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">For Speaker</h2>
        <div class="space-y-8">
            <section>
                <h3 class="font-bold text-lg mb-2 text-indigo-700 border-l-4 border-indigo-500 pl-2">The Dashboard</h3>
                <p class="text-gray-700 mb-4">
                    The Speaker Dashboard is your command center. You don't need to jump between pages – everything automagically appears here.
                </p>
                
                <div class="bg-white border p-4 rounded-lg shadow-sm">
                    <ul class="list-none space-y-4 text-gray-700 text-sm">
                        <li class="flex items-start gap-3">
                            <span class="text-2xl">🎤</span>
                            <div>
                                <strong>Speaker Notes:</strong> 
                                <p class="text-gray-600">When a driver enters the arena/course, their "Bio" (fun facts) pops up automatically.</p>
                            </div>
                        </li>
                        <li class="flex items-start gap-3">
                            <span class="text-2xl">💬</span>
                            <div>
                                <strong>Messages & marks:</strong> 
                                <p class="text-gray-600">The organiser's messages have their own box; those not meant for the public are marked <em>Internal – not to announce</em>. An equipage marked <em>Vet strike awaiting the ground jury</em> is not withdrawn yet: wait before announcing it. During a pause a red banner shows the reason.</p>
                            </div>
                        </li>
                        <li class="flex items-start gap-3">
                            <span class="text-2xl">🗺️</span>
                            <div>
                                <strong>Interactive Map (Marathon):</strong> 
                                <p class="text-gray-600">You see tracking dots moving on the map. Click a dot to see details.</p>
                            </div>
                        </li>
                        <li class="flex items-start gap-3">
                            <span class="text-2xl">⏱️</span>
                            <div>
                                <strong>Live Data:</strong> 
                                <p class="text-gray-600">Intermediate times and faults appear instantly.</p>
                            </div>
                        </li>
                    </ul>
                </div>
            </section>

          <section>
             <h3 class="font-bold text-lg mb-2 text-blue-700 border-l-4 border-blue-500 pl-2">Marathon: Command Center</h3>
             <p class="text-sm text-gray-600 mb-4">The Marathon view is extra detailed. Tools:</p>

             <div class="space-y-6">
                 
                 <!-- Obstacle Focus -->
                 <div class="bg-white border p-4 rounded shadow-sm">
                     <h4 class="font-bold text-gray-800 flex items-center gap-2">
                        🎯 Obstacle Focus
                        <span class="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full uppercase">New</span>
                     </h4>
                     <p class="text-gray-600 text-sm mt-1 mb-2">You can "lock" the view to a specific obstacle (e.g., Water Obstacle).</p>
                     <ul class="list-disc list-inside text-gray-600 text-sm ml-2">
                         <li>Use the dropdown <strong>"Select Obstacle"</strong> top left.</li>
                         <li>The view now shows only times and events for this obstacle.</li>
                     </ul>
                 </div>

                 <!-- Edit Notes -->
                 <div class="bg-white border p-4 rounded shadow-sm">
                     <h4 class="font-bold text-gray-800">📝 Edit Notes Live</h4>
                     <p class="text-gray-600 text-sm mt-1 mb-2">Change or add speaker notes live.</p>
                     <ol class="list-decimal list-inside text-gray-600 text-sm ml-2 space-y-1">
                         <li>Click the button <strong>"✎ Edit"</strong> by the notes.</li>
                         <li>Type new text in the box and click <strong>Save</strong>.</li>
                     </ol>
                 </div>
             </div>
          </section>

          <section>
            <h3 class="font-bold text-lg mb-2 text-green-700 border-l-4 border-green-500 pl-2">Leaderboards & Filtering</h3>
             <ul class="list-disc list-inside text-gray-700 ml-2 space-y-2">
                <li><strong>Leaderboard (Right side):</strong> Updates live with current standings.</li>
                <li><strong>Change Class:</strong> Click the dropdown at the top of the leaderboard to flip between classes.</li>
                <li><strong>In Progress:</strong> The entry currently driving is marked in <span class="bg-blue-100 text-blue-800 px-1 rounded font-bold text-xs">BLUE</span>.</li>
             </ul>
          </section>
        </div>`;

    case 'observer':
      return `
        <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">For Observers</h2>
        <div class="space-y-8">
             <section>
                <h3 class="font-bold text-lg mb-2 text-red-700 border-l-4 border-red-500 pl-2">Emergency & Safety</h3>
                <p class="text-gray-700 mb-2">As a Technical Delegate or Safety Officer.</p>
                
                <div class="bg-red-50 p-6 rounded-lg border-2 border-red-500 mt-4">
                    <div class="flex items-center gap-3 mb-4">
                        <span class="text-4xl">🛑</span>
                        <h4 class="font-bold text-red-900 text-xl">PAUSE COMPETITION</h4>
                    </div>
                    
                    <p class="text-red-900 font-bold mb-2">If a serious accident occurs:</p>
                    <ol class="list-decimal list-inside text-red-900 font-semibold space-y-1">
                        <li>Open the "${btn('observer_emergency_pause', 'en')}" panel on the observer page.</li>
                        <li>Press the red "${btn('observer_stop_all', 'en')}" button.</li>
                        <li>Confirm the action.</li>
                    </ol>
                    <p class="text-red-800 mt-2 text-sm italic">All competition clocks pause and the paused time does not count. You enter the reason (and a short description if you like). Every page shows a red banner with the reason, who paused and where, and the buttons read Paused. Officials and drivers who have turned on notifications get a notification. After an accident, also tell the competition management by radio or phone. Resume with "${btn('observer_resume_all', 'en')}".</p>
                </div>
            </section>

            <section>
                <h3 class="font-bold text-lg mb-2 text-orange-700 border-l-4 border-orange-500 pl-2">Log Events (Wrong Gait / Halt)</h3>
                <p class="text-gray-700 mb-4">Used to note unauthorized gaits or halts on the section.</p>

                <div class="bg-white border p-4 rounded shadow-sm space-y-4">
                    
                    <div>
                        <h4 class="font-bold text-gray-800 border-b pb-1 mb-2">1. Select Entry</h4>
                        <p class="text-sm text-gray-600">Choose the entry you are observing in the dropdown (e.g., "Start no 15").</p>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                        <!-- Wrong Gait -->
                        <div class="bg-orange-50 p-3 rounded">
                            <strong class="block text-orange-900 mb-2">🐎 Wrong Gait (Time)</strong>
                            <ul class="list-disc list-inside text-sm text-gray-700 space-y-2">
                                <li>Press <span class="bg-orange-500 text-white px-2 py-0.5 rounded font-bold">START</span> when horse breaks into canter.</li>
                                <li>Press <span class="bg-red-600 text-white px-2 py-0.5 rounded font-bold">STOP</span> when horse returns to trot.</li>
                                <li>Each start–stop is saved as one incident in the list under the buttons. Corrected within 5 seconds gives no penalty, otherwise 1 penalty per commenced 5-second period (FEI classes: 1 for the incident plus 1 per further completed 5 seconds). Remove a mistaken incident with the trash button.</li>
                            </ul>
                        </div>

                        <!-- Halt -->
                        <div class="bg-blue-50 p-3 rounded">
                            <strong class="block text-blue-900 mb-2">🛑 Halt (Penalty)</strong>
                            <ul class="list-disc list-inside text-sm text-gray-700 space-y-2">
                                <li>Press <span class="bg-emerald-600 text-white px-2 py-0.5 rounded font-bold">START</span> under Halt when the entry stops outside an obstacle, and <span class="bg-rose-600 text-white px-2 py-0.5 rounded font-bold">STOP</span> when it moves on.</li>
                                <li>Each halt is listed in the halt log. "${btn('observer_manual_add', 'en')}" adds one afterwards (mm:ss or seconds).</li>
                                <li>Notes are saved automatically; add a short remark if useful.</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </section>
        </div>`;

    default:
      return '<p>Select a role above.</p>';
  }
}
