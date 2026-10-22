import { getGlobalState, setGlobalState } from '../../main.js';
import { createCompetition, listenForCompetitions, saveConfig, updateCompetition, isGlobalCompetitionAdmin } from '../../services/competitionService.js';
import { seedDemoCompetition } from '../../services/demoCompetitionService.js';
import { showAlert } from '../../ui/components.js';
import { getCurrentLanguage, t } from '../../utils/i18n.js';
import { escapeHtml } from '../../utils/sharedUtils.js';
import { competitionDateRange, matchesCompetitionSearch, sortCompetitionsForVisitors } from './hubCompetitionUtils.js';

const escapeAttr = (value) => escapeHtml(value ?? '');

function getCurrentUser() {
  return getGlobalState('currentUser') || {};
}
function isSuperAdmin(user) {
  // stöd för både single 'role' och en 'roles'-array
  return user?.role === 'superadmin' || (Array.isArray(user?.roles) && user.roles.includes('superadmin'));
}
function canAdminCompetition(user, comp) {
  const uid = user?.uid;
  if (!uid || !comp) return false;
  if (isSuperAdmin(user)) return true;
  // Stöd för både comp.createdBy och en ev. comp.admins-lista
  const createdByOk = comp.createdBy && comp.createdBy === uid;
  const inAdmins = Array.isArray(comp.admins) && comp.admins.includes(uid);
  return createdByOk || inAdmins;
}

// --- Visar/döljer skapa-rutan baserat på aktuell roll ---
function refreshCreateBox() {
  const el = document.getElementById('create-competition-container');
  if (!el) return;
  const role = getGlobalState('currentUser')?.role || 'publik';

  if (role === 'admin' || role === 'superadmin') {
    el.style.display = '';
    // The form is folded away until asked for: the map needs it open to get its size
    if (!document.getElementById('createCompetitionBody')?.classList.contains('hidden')) setTimeout(initMap, 100);
  } else {
    el.style.display = 'none';
  }
}

/** Branding från din app (fallbacks om branding saknas i GlobalState) */
function getBranding() {
  const b = getGlobalState('branding') || {};
  return {
    // namn/logga enligt din struktur & index.html
    // (index.html definierar färgerna brand-darkblue, brand-gold, brand-lightblue)
    name: b.name || 'DriveLive',
    logoUrl: b.logoUrl || 'icons/DriveLive_512.png',
    darkBlue: b.darkBlue || '#0A1F37',
    gold: b.gold || '#C2A145',
    lightBlue: b.lightBlue || '#69C9D6'
  };
}

/** Hjälpare */
function getUserRole() {
  return getGlobalState('currentUser')?.role || 'publik';
}
function isSignedIn() {
  return Boolean(getGlobalState('currentUser')?.uid);
}
// Organiser tools (create, Admin buttons, guide) only for global admins;
// visitors get the competitions and a search
function isAdminView() {
  return isGlobalCompetitionAdmin(getGlobalState('currentUser'));
}
function hubViewKey() {
  return `${isSignedIn()}|${isAdminView()}`;
}
let renderedViewKey = '';

const STATUS_BADGES = {
  live: 'bg-red-600 text-white',
  today: 'bg-amber-500 text-white',
  upcoming: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200',
  finished: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  unknown: ''
};

function statusBadge(status) {
  if (!STATUS_BADGES[status]) return '';
  const dot = status === 'live' ? '<span class="inline-block w-2 h-2 rounded-full bg-white mr-1 animate-pulse" aria-hidden="true"></span>' : '';
  return `<span class="inline-flex items-center shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${STATUS_BADGES[status]}">${dot}${escapeHtml(t(`hub_status_${status}`))}</span>`;
}

function formatRange({ start, end }) {
  if (!start) return '';
  const fmt = (day, opts) => {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(getCurrentLanguage() === 'en' ? 'en-GB' : 'sv-SE', opts);
  };
  if (!end || end === start) return fmt(start, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${fmt(start, { day: 'numeric', month: 'short' })} – ${fmt(end, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
function saveLastOpened(comp) {
  try {
    localStorage.setItem('hub:lastCompetition', JSON.stringify({
      id: comp.id || comp.docId || comp.uid || null,
      name: comp.name || '',
      place: comp.place || '',
      dates: comp.dates || comp.date || '',
      club: comp.club || ''
    }));
  } catch { }
}
function readLastOpened() {
  try {
    const raw = localStorage.getItem('hub:lastCompetition');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
const HUB_COMPETITION_TEMPLATES = [
  {
    id: 'live_1day',
    title: '1-dagars live',
    subtitle: 'Dressyr eller enkel tävling med liveflöde',
    mode: 'live',
    durationDays: 1
  },
  {
    id: 'live_2day',
    title: '2-dagars live',
    subtitle: 'Dressyr följt av maraton eller precision',
    mode: 'live',
    durationDays: 2
  },
  {
    id: 'live_3day',
    title: '3-dagars live',
    subtitle: 'Full tävling med dressyr, maraton och precision',
    mode: 'live',
    durationDays: 3
  },
  {
    id: 'demo_complete',
    title: 'Demotävling (med testdata)',
    subtitle: 'Dressyr, maraton, precision, besiktning & lag förkonfigurerat',
    mode: 'live',
    durationDays: 3,
    isDemo: true
  },
  {
    id: 'field_light',
    title: 'Field mode light',
    subtitle: 'Manuell drift med enklare fältinmatning',
    mode: 'field',
    durationDays: 1
  }
];

let selectedTemplateId = 'live_3day';
let templateEndDateDirty = false;

function pickLatest(competitions) {
  return [...competitions].sort((a, b) => {
    const aSec = (a.createdAt?.seconds ?? a.updatedAt?.seconds ?? 0);
    const bSec = (b.createdAt?.seconds ?? b.updatedAt?.seconds ?? 0);
    return bSec - aSec;
  })[0] || null;
}

/** Layout – header i SAMMA container som innehållet (som i admin) */
function renderLayout() {
  const { name, logoUrl, darkBlue, gold, lightBlue } = getBranding();
  const page = document.getElementById('page-hub');

  page.innerHTML = `
    <div class="container mx-auto p-3 sm:p-4 md:p-8 max-w-screen-xl">
      <!-- Branded header-kort, samma känsla som admin.js -->
      <div class="rounded-2xl shadow-md overflow-hidden mb-8" style="border-bottom:4px solid ${gold};">
        <div class="px-4 sm:px-6 md:px-8 py-5 md:py-6"
             style="background: linear-gradient(90deg, ${darkBlue} 0%, #0b274a 60%, #0e305c 100%);">
          <div class="flex items-center gap-3 sm:gap-4">
            <img src="${escapeAttr(logoUrl)}" alt="${escapeAttr(name)} logotyp"
                 class="h-14 w-14 rounded-lg ring-1 ring-white/20 object-contain bg-white/5 p-1"
                 data-hide-on-error>
            <div>
              <h1 class="text-white text-2xl md:text-3xl font-semibold leading-tight">${t('hub_title')}</h1>
              <p id="hubSubtitle" class="text-white/80 text-sm">${t(isAdminView() ? 'hub_subtitle' : 'hub_subtitle_public')}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Arrangörs- och funktionärsguide banner (signed in only) -->
      <div id="hubGuideBanner" class="${isSignedIn() ? '' : 'hidden '}mb-6 rounded-xl border border-blue-200 dark:border-blue-900 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/40 dark:to-indigo-950/30 p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
        <div class="flex items-center gap-3.5">
          <div class="p-2.5 bg-blue-600 text-white rounded-xl text-xl shrink-0 shadow-sm">📋</div>
          <div>
            <h3 class="font-bold text-gray-900 dark:text-gray-100 text-sm sm:text-base">${t('hub_guide_banner_title')}</h3>
            <p class="text-xs sm:text-sm text-gray-600 dark:text-gray-300 mt-0.5">
              ${t('hub_guide_banner_desc')}
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2 self-stretch sm:self-auto shrink-0">
          <a href="#manual?tab=admin" class="flex-1 sm:flex-initial text-center px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-semibold transition-colors shadow-sm whitespace-nowrap">
            ${t('hub_guide_banner_btn_admin')}
          </a>
          <a href="#manual" class="flex-1 sm:flex-initial text-center px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs sm:text-sm font-medium transition-colors shadow-sm whitespace-nowrap">
            ${t('hub_guide_banner_btn_manual')}
          </a>
        </div>
      </div>

      <!--Innehåll -->
      <div id="hubTopGrid" class="grid grid-cols-1 ${isSignedIn() ? 'lg:grid-cols-3' : ''} gap-4 md:gap-6 mb-6">
        <!-- Sök -->
        <section class="${isSignedIn() ? 'lg:col-span-2 ' : ''}bg-white dark:bg-gray-800 rounded-xl shadow p-4 md:p-5">
          <label for="hubSearch" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">${t('hub_search_label')}</label>
          <div class="relative">
            <input id="hubSearch" type="search" placeholder="${t('hub_search_curr_ph')}"
              class="w-full rounded-lg border border-gray-300 dark:border-gray-600 pl-10 pr-3 py-2.5 text-base bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-lightblue" />
            <svg class="absolute left-3 top-3 h-5 w-5 text-gray-400" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z"
                    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-2">${t('hub_search_tip')}</p>
        </section>

        <!-- Senaste (signed in: where they were) -->
        <aside class="${isSignedIn() ? '' : 'hidden '}bg-white dark:bg-gray-800 rounded-xl shadow p-4 md:p-5 flex flex-col justify-center" id="latestBox">
          <h2 class="text-base font-semibold text-gray-900 dark:text-white mb-2">${t('hub_latest_title')}</h2>
          <div id="latestContent" class="text-sm text-gray-600 dark:text-gray-300">${t('hub_no_comp_selected')}</div>
        </aside>
      </div>

      <div id="hubMainGrid" class="grid grid-cols-1 ${isAdminView() ? 'md:grid-cols-2' : ''} gap-4 md:gap-6">
        <!-- Tävlingar: live/idag och kommande först -->
        <section class="bg-white dark:bg-gray-800 p-4 sm:p-5 rounded-xl shadow md:order-2" aria-labelledby="hubListTitle">
          <div class="flex items-center justify-between gap-3 mb-3">
            <h2 id="hubListTitle" class="text-xl font-semibold text-gray-900 dark:text-white">${t(isAdminView() ? 'hub_choose_title' : 'hub_public_list_title')}</h2>
            <button id="clearSearchBtn" type="button" class="text-xs px-3 py-2 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 dark:text-white">${t('hub_btn_clear')}</button>
          </div>
          <div id="competitionList" class="space-y-3">
            <p class="text-center text-gray-500 dark:text-gray-400">${t('hub_loading_comps')}</p>
          </div>
        </section>

        <!-- Skapa ny (visas bara för admin) -->
        <section id="create-competition-container" class="bg-white dark:bg-gray-800 p-5 rounded-xl shadow">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <h2 class="text-xl font-semibold text-gray-900 dark:text-white">${t('hub_create_title')}</h2>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">${t('hub_create_hint')}</p>
            </div>
            <button type="button" id="btnToggleCreateCompetition" aria-expanded="false" aria-controls="createCompetitionBody" class="shrink-0 min-h-[44px] px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold">+ ${t('hub_create_open')}</button>
          </div>
          <div id="createCompetitionBody" class="hidden mt-4 border-t dark:border-gray-700 pt-4">
          <div class="mb-4">
            <div class="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">Startmall</div>
            <div id="competitionTemplateGrid" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              ${HUB_COMPETITION_TEMPLATES.map((template) => `
                <button
                  type="button"
                  class="hub-template-card rounded-xl border px-4 py-3 text-left transition-colors ${template.id === selectedTemplateId
                      ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/20'
                      : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900/20 dark:hover:bg-gray-900/40'}"
                  data-template-id="${escapeAttr(template.id)}"
                >
                  <div class="flex items-center justify-between gap-3">
                    <div class="min-w-0">
                      <div class="text-sm font-semibold text-gray-900 dark:text-white">${escapeHtml(template.title)}</div>
                      <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">${escapeHtml(template.subtitle)}</div>
                    </div>
                    <span class="shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${template.mode === 'field'
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                      : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'}">
                      ${template.mode === 'field' ? 'Field' : `${template.durationDays} dag`}
                    </span>
                  </div>
                </button>
              `).join('')}
            </div>
            <input type="hidden" id="competitionTemplatePreset" value="${escapeAttr(selectedTemplateId)}">
            <p id="competitionTemplateHint" class="mt-2 text-xs text-gray-500 dark:text-gray-400"></p>
            <div class="mt-3 flex items-center justify-between gap-3 p-3 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800">
              <div class="text-xs text-indigo-800 dark:text-indigo-200">
                <strong>Snabbstart med demodata:</strong> Skapa en färdig demotävling med 8 ekipage, domare, tider, besiktning och lag direkt med ett klick.
              </div>
              <button type="button" id="btnQuickDemoCompetition" class="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition-colors shadow-sm">
                ✨ Skapa demotävling
              </button>
            </div>
          </div>

          <div class="mb-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="rounded-xl border border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-900/20 px-4 py-3">
              <div class="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">Status</div>
              <div class="mt-1 text-sm font-medium text-emerald-900 dark:text-emerald-100">Skapas som utkast</div>
            </div>
            <div class="rounded-xl border border-sky-200 bg-sky-50 dark:border-sky-900/50 dark:bg-sky-900/20 px-4 py-3">
              <div class="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-700 dark:text-sky-300">Nästa steg</div>
              <div class="mt-1 text-sm font-medium text-sky-900 dark:text-sky-100">Du skickas till Admin → Inställningar</div>
            </div>
          </div>

          <form id="createCompetitionForm" class="space-y-4">
            <div class="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-900/20 p-4 space-y-4">
              <div class="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">Grunddata</div>

              <div>
                <label for="compName" class="block text-sm font-medium text-gray-700 dark:text-gray-300">${t('hub_comp_name')}</label>
                <input type="text" id="compName" required class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="Ex. Flyinge Indoor 2025">
              </div>
              
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                   <div>
                      <label for="compStartDate" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Startdatum</label>
                      <input type="date" id="compStartDate" required class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                   </div>
                   <div>
                      <label for="compEndDate" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Slutdatum</label>
                      <input type="date" id="compEndDate" required class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                   </div>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label for="compClub" class="block text-sm font-medium text-gray-700 dark:text-gray-300">${t('hub_comp_club')}</label>
                  <input type="text" id="compClub" required class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                </div>

                <div>
                  <label for="compPlace" class="block text-sm font-medium text-gray-700 dark:text-gray-300">${t('hub_comp_place')}</label>
                  <input type="text" id="compPlace" required class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="Ex. Flyinge">
                </div>
              </div>
            </div>

            <div class="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-900/20 p-4 space-y-4">
              <div class="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">Återanvändning och läge</div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label for="importFromComp" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Basera på tidigare tävling (Valfritt)</label>
                  <select id="importFromComp" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white max-w-full text-ellipsis overflow-hidden">
                    <option value="">-- Starta från noll --</option>
                  </select>
                  <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Kopierar inställningar för dressyr, maraton, precision, visningsklasser och karta från vald tävling.</p>
                </div>

                <div>
                  <label for="compMode" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Tävlingsläge</label>
                  <select id="compMode" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                    <option value="live">Live-läge</option>
                    <option value="field">Field mode light</option>
                  </select>
                  <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Live-läge använder timers och liveflöden. Field mode light är för mer manuell drift.</p>
                </div>
              </div>
            </div>

            <div class="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-900/20 p-4 space-y-4">
              <div class="flex items-center justify-between gap-3 flex-wrap">
                <div class="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">Plats och karta</div>
                <div class="text-xs text-gray-500 dark:text-gray-400">Klicka på kartan för att ange exakt position</div>
              </div>

              <div id="compMapContainer" class="h-64 w-full rounded-md border mt-2 z-0 relative"></div>
            </div>

            <input type="hidden" id="compLat">
            <input type="hidden" id="compLng">

            <button type="submit"
              class="w-full font-semibold py-2.5 px-4 rounded-lg text-white hover:opacity-95 shadow-sm"
              style="background:${darkBlue};">${t('hub_btn_create')}</button>
          </form>
          </div>
        </section>
      </div>
      </div>
    </div>
  `;
}

/** Lista + sök */
let _allCompetitions = [];
let currentLimit = 50;
let competitionListenerUnsub = null;
let mapInstance = null;
let markerInstance = null;
let globalStateChangeHandler = null;

function getHubTemplate(templateId = selectedTemplateId) {
  return HUB_COMPETITION_TEMPLATES.find((template) => template.id === templateId) || HUB_COMPETITION_TEMPLATES[0];
}

function formatHubTemplateDuration(template) {
  if (!template) return '';
  if (template.isDemo) {
    return 'Komplett 3-dagarstävling med förberedd testdata för dressyr, maraton, precision, besiktning och lag.';
  }
  if (template.mode === 'field') {
    return 'Fältläge med manuell registrering som standard.';
  }
  return `${template.durationDays} tävlingsdag${template.durationDays > 1 ? 'ar' : ''} med liveflöde som standard.`;
}

function getTemplateDisciplines(template) {
  if (!template) return [];
  switch (template.id) {
    case 'live_1day':
      return ['dressage'];
    case 'live_2day':
      return ['dressage', 'marathon'];
    case 'live_3day':
    case 'demo_complete':
      return ['dressage', 'marathon', 'precision'];
    case 'field_light':
      return ['dressage', 'marathon', 'precision'];
    default:
      return [];
  }
}

function buildTemplateMetaDefaults(template, { importFrom = null } = {}) {
  const baseMeta = {
    competitionTemplate: template?.id || '',
    competitionTemplateTitle: template?.title || '',
    competitionDays: template?.durationDays || 1,
    recommendedCompetitionMode: template?.mode || 'live',
    expectedDisciplines: getTemplateDisciplines(template),
    schedulePreset: template?.id || ''
  };

  if (importFrom) {
    // Settings come from the copied competition, but never its lock
    return { ...baseMeta, manualLockdown: false };
  }

  return {
    ...baseMeta,
    isInternational: false,
    lockdownMinutes: template?.mode === 'field' ? 0 : 60,
    manualLockdown: false
  };
}

function addDaysToDateString(dateStr, daysToAdd) {
  if (!dateStr) return '';
  const [year, month, day] = String(dateStr).split('-').map(Number);
  if (!year || !month || !day) return '';
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + daysToAdd);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function syncTemplateEndDate(force = false) {
  const startInput = document.getElementById('compStartDate');
  const endInput = document.getElementById('compEndDate');
  const template = getHubTemplate();
  if (!startInput || !endInput || !template?.durationDays) return;
  if (!startInput.value) return;
  if (templateEndDateDirty && !force) return;

  const nextEndDate = addDaysToDateString(startInput.value, template.durationDays - 1);
  if (nextEndDate) endInput.value = nextEndDate;
}

function updateCompetitionTemplateUi() {
  const template = getHubTemplate();
  const modeSelect = document.getElementById('compMode');
  const presetInput = document.getElementById('competitionTemplatePreset');
  const hint = document.getElementById('competitionTemplateHint');

  document.querySelectorAll('.hub-template-card').forEach((card) => {
    const isActive = card.dataset.templateId === selectedTemplateId;
    card.classList.toggle('border-blue-500', isActive);
    card.classList.toggle('bg-blue-50', isActive);
    card.classList.toggle('dark:border-blue-400', isActive);
    card.classList.toggle('dark:bg-blue-900/20', isActive);
    card.classList.toggle('border-gray-200', !isActive);
    card.classList.toggle('bg-white', !isActive);
    card.classList.toggle('hover:bg-gray-50', !isActive);
    card.classList.toggle('dark:border-gray-700', !isActive);
    card.classList.toggle('dark:bg-gray-900/20', !isActive);
    card.classList.toggle('dark:hover:bg-gray-900/40', !isActive);
  });

  if (modeSelect && template) modeSelect.value = template.mode;
  if (presetInput) presetInput.value = selectedTemplateId;
  if (hint && template) {
    hint.textContent = `${template.title}: ${formatHubTemplateDuration(template)}`;
  }

  syncTemplateEndDate();
}

function safeInvalidateMapSize(mapRef = mapInstance) {
  try {
    if (!mapRef || mapRef !== mapInstance) return;
    if (!mapRef.getContainer?.()?.isConnected) return;
    mapRef.invalidateSize();
  } catch (_) {
    // Ignore late Leaflet callbacks after the hub map has been torn down.
  }
}

let competitionListenerUserKey = null;

function setupCompetitionListener() {
  if (competitionListenerUnsub) {
    competitionListenerUnsub();
  }
  const user = getCurrentUser();
  competitionListenerUserKey = [user.uid || '', user.role || '', (user.roles || []).join(',')].join('|');
  competitionListenerUnsub = listenForCompetitions((comps) => {
    _allCompetitions = Array.isArray(comps) ? comps : [];
    renderCompetitionList(_allCompetitions);
    if (isGlobalCompetitionAdmin(user)) markLegacyCompetitionsPublished(_allCompetitions);
  }, currentLimit, user);
}

// Older competitions have no published field and counted as published. The
// public list now asks for published == true, so a global admin's list writes
// the field once on those (only admins see them in the list query).
const legacyPublishMarked = new Set();
function markLegacyCompetitionsPublished(comps) {
  comps
    .filter(c => c?.id && c.published === undefined && !legacyPublishMarked.has(c.id))
    .forEach(c => {
      legacyPublishMarked.add(c.id);
      updateCompetition(c.id, { published: true })
        .catch(err => console.warn('[hub] could not mark legacy competition published', c.id, err?.code || err));
    });
}

export function initMap() {
  const mapEl = document.getElementById('compMapContainer');
  if (!mapEl) return;
  if (typeof window.L === 'undefined') {
    mapEl.innerHTML = `
      <div class="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/60 px-4 py-6 text-sm text-gray-500 dark:text-gray-300">
        Karta är inte tillgänglig just nu. Ange plats manuellt eller prova igen när anslutningen är tillbaka.
      </div>
    `;
    return;
  }

  if (mapInstance) {
    const mapRef = mapInstance;
    setTimeout(() => safeInvalidateMapSize(mapRef), 200);
    return;
  }

  // Default to Sweden (approx center)
  const defaultLat = 62.0;
  const defaultLng = 15.0;
  const defaultZoom = 5;

  mapInstance = L.map(mapEl).setView([defaultLat, defaultLng], defaultZoom);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(mapInstance);

  // Fix leaflet size issues in tabs/modals
  const mapRef = mapInstance;
  setTimeout(() => safeInvalidateMapSize(mapRef), 200);

  mapInstance.on('click', (e) => {
    const { lat, lng } = e.latlng;
    if (markerInstance) {
      markerInstance.setLatLng(e.latlng);
    } else {
      markerInstance = L.marker(e.latlng).addTo(mapInstance);
    }
    document.getElementById('compLat').value = lat;
    document.getElementById('compLng').value = lng;
  });

  // Try to get user location
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((pos) => {
      if (!mapInstance || !mapInstance.getContainer?.()?.isConnected) return;
      const { latitude, longitude } = pos.coords;
      mapInstance.setView([latitude, longitude], 10);
    });
  }
}

function renderCompetitionList(competitions) {
  _allCompetitions = Array.isArray(competitions) ? competitions.slice() : [];
  const listEl = document.getElementById('competitionList');
  if (!listEl) return;

  const q = (document.getElementById('hubSearch')?.value || '').trim();
  const user = getCurrentUser();
  const filtered = _allCompetitions.filter(c => {
    // published is true if undefined (legacy) or explicitly true; drafts only
    // for those who may administer them
    if (c.published === false && !canAdminCompetition(user, c)) return false;
    return matchesCompetitionSearch(c, q);
  });

  listEl.innerHTML = '';
  updateImportDropdown(_allCompetitions); // all competitions, not only the matches
  if (filtered.length === 0) {
    listEl.innerHTML = `<p class="text-center text-gray-500 dark:text-gray-400 py-4">${escapeHtml(t(q ? 'hub_no_matches' : 'hub_empty_public'))}</p>`;
    updateLatestBox();
    return;
  }

  // On now first, then upcoming, then finished (with a heading per group)
  let lastGroup = '';
  sortCompetitionsForVisitors(filtered).forEach(({ comp, status, range }) => {
    const group = status === 'live' || status === 'today' ? 'now' : status;
    if (group !== lastGroup) {
      lastGroup = group;
      const heading = document.createElement('h3');
      heading.className = 'pt-2 text-xs font-bold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400';
      heading.textContent = t(`hub_group_${group}`);
      listEl.appendChild(heading);
    }

    const a = document.createElement('a');
    // No javascript: URL (CSP); the click handler below navigates
    a.href = '#';
    a.className = `block p-3 sm:p-4 rounded-lg border hover:bg-brand-lightblue/10 dark:hover:bg-gray-600 ${status === 'live' ? 'bg-red-50/60 border-red-200 dark:bg-red-900/10 dark:border-red-900/60' : 'bg-gray-50 dark:bg-gray-700 dark:border-gray-600'}`;
    const allowAdmin = canAdminCompetition(user, comp);
    const safeCompName = escapeHtml(comp.name || t('hub_unnamed_competition'));
    const dateText = formatRange(range) || (typeof comp.dates === 'string' ? comp.dates : '');
    const meta = [comp.place, dateText].filter(Boolean).map(escapeHtml).join(' · ');

    a.innerHTML = `
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          ${statusBadge(status)}
          ${(comp.published === false) ? `<span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">${escapeHtml(t('hub_status_draft'))}</span>` : ''}
        </div>
        <h4 class="mt-1 font-semibold text-lg text-gray-900 dark:text-white break-words">${safeCompName}</h4>
        ${meta ? `<p class="text-sm text-gray-600 dark:text-gray-300">${meta}</p>` : ''}
        ${comp.club ? `<p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">${escapeHtml(comp.club)}</p>` : ''}
      </div>
      <div class="flex gap-2 shrink-0">
        <button type="button" class="min-h-[40px] text-sm px-3 py-1.5 rounded-md bg-white dark:bg-gray-800 border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-200 open-info" aria-label="${escapeHtml(`${t('hub_btn_info')}: ${comp.name || ''}`)}">${escapeHtml(t('hub_btn_info'))}</button>
        ${allowAdmin
        ? `<button type="button" class="min-h-[40px] text-sm px-3 py-1.5 rounded-md bg-white dark:bg-gray-800 border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-200 open-admin">${t('btn_admin')}</button>`
        : ''}
        <span class="min-h-[40px] inline-flex items-center text-sm font-semibold px-4 py-1.5 rounded-md text-white" style="background:${getBranding().darkBlue};">${t('btn_open')}</span>
      </div>
    </div>
  `;
    a.onclick = (ev) => {
      ev.preventDefault();
      const user = getCurrentUser();
      const allowAdmin = canAdminCompetition(user, comp);

      // Klick på Info?
      if (ev.target && ev.target.closest('.open-info')) {
        if (typeof window.openCompetitionInfo === 'function') {
          window.openCompetitionInfo(comp);
        }
        ev.stopPropagation();
        return;
      }

      // Klick på Admin?
      if (ev.target && ev.target.closest('.open-admin')) {
        if (!allowAdmin) {
          showAlert(t('hub_admin_not_allowed'), false);
          ev.stopPropagation();
          return;
        }
        setGlobalState({ key: 'currentCompetition', value: comp });
        saveLastOpened(comp);
        window.location.hash = '#admin';
        ev.stopPropagation();
        return;
      }

      // Klick någon annanstans på kortet => öppna normalt
      const role = getUserRole();
      // Även om användaren har "admin"-roll, släpp bara in i admin om allowAdmin
      const dest = (role === 'admin' && allowAdmin) ? '#admin' : '#deltagare';
      setGlobalState({ key: 'currentCompetition', value: comp });
      saveLastOpened(comp);
      window.location.hash = dest;
    };
    listEl.appendChild(a);
  });

  // Visa "Ladda fler" om vi har laddat lika många som limiten (indikerar att det KAN finnas fler)
  if (_allCompetitions.length >= currentLimit) {
    const loadMoreBtn = document.createElement('button');
    loadMoreBtn.id = 'loadMoreCompetitionsBtn';
    loadMoreBtn.className = 'w-full py-2 mt-2 text-sm text-gray-600 dark:text-gray-300 font-medium bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg border border-gray-300 dark:border-gray-600 transition-colors';
    loadMoreBtn.textContent = t('hub_btn_load_more');
    loadMoreBtn.onclick = () => {
      loadMoreBtn.textContent = t('hub_btn_loading');
      loadMoreBtn.disabled = true;
      currentLimit += 50;
      setupCompetitionListener();
    };
    listEl.appendChild(loadMoreBtn);
  }

  updateLatestBox();
}

function updateLatestBox() {
  const box = document.getElementById('latestContent');
  if (!box) return;

  const last = readLastOpened() || pickLatest(_allCompetitions);
  if (!last) { box.textContent = t('hub_no_comp_selected'); return; }

  const role = getUserRole();
  const dest = role === 'admin' ? '#admin' : '#deltagare';
  const title = escapeHtml(last.name || t('hub_unnamed_competition'));
  const place = escapeHtml(last.place || '—');
  const dates = escapeHtml(last.dates || '—');

  const user = getCurrentUser();
  const comp = _allCompetitions.find(c => (c.id || c.docId || c.uid) === (last.id)) || last;
  const allowAdmin = canAdminCompetition(user, comp);

  box.innerHTML = `
    <div id="latestClickable" class="p-3 rounded-lg border dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-start justify-between gap-3">
    <div>
      <div class="font-medium text-gray-900 dark:text-white">${title}</div>
      <div class="text-gray-600 dark:text-gray-300 text-xs">${place} • ${dates}</div>
    </div>
    <div class="flex gap-2">
      <button id="latestOpenPublic" type="button" class="text-sm px-3 py-1.5 rounded-md text-white" style="background:${getBranding().darkBlue};">${t('btn_open')}</button>
      ${allowAdmin ? `<button id="latestOpenAdmin" type="button" class="text-sm px-3 py-1.5 rounded-md bg-gray-100 dark:bg-gray-800 border dark:border-gray-600 dark:text-white">${t('btn_admin')}</button>` : ''}
    </div>
  </div>
    `;

  const navigatePublic = () => {
    setGlobalState({ key: 'currentCompetition', value: comp });
    saveLastOpened(comp);
    const role = getUserRole();
    const dest = (role === 'admin' && allowAdmin) ? '#admin' : '#deltagare';
    window.location.hash = dest;
  };

  document.getElementById('latestClickable')?.addEventListener('click', (e) => {
    if (e.target.closest('button')) return; // Let buttons handle their own clicks
    navigatePublic();
  });

  document.getElementById('latestOpenPublic')?.addEventListener('click', (e) => {
    e.stopPropagation();
    navigatePublic();
  });

  const adminBtn = document.getElementById('latestOpenAdmin');
  if (adminBtn) {
    adminBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!allowAdmin) {
        showAlert(t('hub_admin_not_allowed'), false);
        return;
      }
      setGlobalState({ key: 'currentCompetition', value: comp });
      saveLastOpened(comp);
      window.location.hash = '#admin';
    });
  }

}

/** Events */
function setupEventListeners() {
  updateCompetitionTemplateUi();

  const search = document.getElementById('hubSearch');
  document.getElementById('clearSearchBtn')?.addEventListener('click', () => {
    if (search) { search.value = ''; renderCompetitionList(_allCompetitions); search.focus(); }
  });

  if (search) {
    search.addEventListener('input', () => renderCompetitionList(_allCompetitions));
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        // The first card shown (live and upcoming come first)
        const user = getCurrentUser();
        const visible = _allCompetitions.filter(c => (c.published !== false || canAdminCompetition(user, c))
          && matchesCompetitionSearch(c, search.value));
        const first = sortCompetitionsForVisitors(visible)[0]?.comp;
        if (first) {
          const role = getUserRole();
          const dest = role === 'admin' ? '#admin' : '#deltagare';
          setGlobalState({ key: 'currentCompetition', value: first });
          saveLastOpened(first);
          window.location.hash = dest;
        }
      }
    });
  }

  const form = document.getElementById('createCompetitionForm');
  if (form) {
    // initialize map if visible now, or observe?
    // refreshCreateBox handles this via toggle and initMap call.
    // So we don't need redundant timeout here.

    document.querySelectorAll('.hub-template-card').forEach((card) => {
      card.addEventListener('click', () => {
        selectedTemplateId = card.dataset.templateId || selectedTemplateId;
        templateEndDateDirty = false;
        updateCompetitionTemplateUi();
      });
    });

    document.getElementById('compStartDate')?.addEventListener('change', () => {
      if (!templateEndDateDirty) syncTemplateEndDate(true);
    });

    document.getElementById('compEndDate')?.addEventListener('input', () => {
      templateEndDateDirty = true;
    });

    document.getElementById('compMode')?.addEventListener('change', () => {
      const nextMode = document.getElementById('compMode')?.value === 'field' ? 'field' : 'live';
      const matchingTemplate = HUB_COMPETITION_TEMPLATES.find((template) => template.mode === nextMode && template.id === selectedTemplateId)
        || HUB_COMPETITION_TEMPLATES.find((template) => template.mode === nextMode)
        || HUB_COMPETITION_TEMPLATES[0];
      selectedTemplateId = matchingTemplate.id;
      updateCompetitionTemplateUi();
    });

    document.getElementById('btnQuickDemoCompetition')?.addEventListener('click', async () => {
      const btn = document.getElementById('btnQuickDemoCompetition');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Skapar demotävling...';
      }
      try {
        const res = await seedDemoCompetition();
        const user = getCurrentUser();
        const createdCompetition = {
          id: res.competitionId,
          ...res.dataset.compMeta,
          createdBy: user?.uid || null
        };
        setGlobalState({ key: 'currentCompetition', value: createdCompetition });
        saveLastOpened(createdCompetition);
        showAlert(`Demotävlingen "${createdCompetition.name}" har skapats med 8 ekipage, domare och kompletta resultat!`);
        window.location.hash = '#admin';
      } catch (err) {
        console.error('Fel vid skapande av demotävling:', err);
        showAlert('Kunde inte skapa demotävling: ' + err.message, false);
        if (btn) {
          btn.disabled = false;
          btn.textContent = '✨ Skapa demotävling';
        }
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const user = getCurrentUser();
      const selectedTemplate = getHubTemplate(document.getElementById('competitionTemplatePreset')?.value || selectedTemplateId);
      const templateMetaDefaults = buildTemplateMetaDefaults(selectedTemplate, {
        importFrom: document.getElementById('importFromComp')?.value || null
      });

      const sDate = document.getElementById('compStartDate').value;
      const eDate = document.getElementById('compEndDate').value;
      const dateStr = (sDate && eDate) ? `${sDate} – ${eDate} ` : (sDate || eDate || '');

      const lat = document.getElementById('compLat').value;
      const lng = document.getElementById('compLng').value;

      const compData = {
        name: document.getElementById('compName').value,
        place: document.getElementById('compPlace').value,
        dates: dateStr,
        club: document.getElementById('compClub').value,
        competitionMode: document.getElementById('compMode')?.value || 'live',
        createdBy: user?.uid || null,
        admins: user?.uid ? [user.uid] : [],
        coordinates: (lat && lng) ? { lat: parseFloat(lat), lng: parseFloat(lng) } : null,
        importFrom: document.getElementById('importFromComp')?.value || null // <-- Add source ID
      };

      try {
        const result = await createCompetition(compData); // This returns the ref or ID
        const newId = result.id; // Get the ID

        // Also save coordinates to config/map to match new reading logic
        if (compData.coordinates) {
          await saveConfig(newId, 'map', {
            coordinates: compData.coordinates,
            updatedAt: new Date()
          });
        }

        await saveConfig(newId, 'competitionMeta', {
          ...templateMetaDefaults
        });

        if (selectedTemplate?.isDemo) {
          await seedDemoCompetition({
            competitionId: newId,
            name: compData.name,
            place: compData.place,
            club: compData.club,
            dates: compData.dates
          });
        }

        showAlert(`Tävlingen "${compData.name}" har skapats!`);
        const createdCompetition = {
          id: newId,
          ...compData,
          published: false
        };

        setGlobalState({ key: 'currentCompetition', value: createdCompetition });
        saveLastOpened(createdCompetition);
        window.location.hash = '#admin?tab=settings';
      } catch (err) {
        console.error('Error creating competition:', err);
        showAlert('Kunde inte skapa tävlingen.', false);
      }
    });
  }
}


export function __unload() {
  selectedTemplateId = 'live_3day';
  templateEndDateDirty = false;
  if (mapInstance && mapInstance.remove) {
    mapInstance.off();
    mapInstance.remove();
    mapInstance = null;
    markerInstance = null;
  }
  if (competitionListenerUnsub) {
    competitionListenerUnsub();
    competitionListenerUnsub = null;
  }
  if (globalStateChangeHandler) {
    window.removeEventListener('global-state-changed', globalStateChangeHandler);
    globalStateChangeHandler = null;
  }
}

/** Exporterat API */
export function load() {
  selectedTemplateId = 'live_3day';
  templateEndDateDirty = false;
  renderLayout();
  renderedViewKey = hubViewKey();
  setupEventListeners();
  // "Skapa ny tävling" is folded away behind a button (admins only)
  document.getElementById('btnToggleCreateCompetition')?.addEventListener('click', (event) => {
    const button = event.currentTarget;
    const body = document.getElementById('createCompetitionBody');
    if (!body) return;
    const open = body.classList.toggle('hidden') === false;
    button.setAttribute('aria-expanded', String(open));
    button.textContent = `${open ? '−' : '+'} ${open ? t('hub_create_close') : t('hub_create_open')}`;
    if (open) setTimeout(initMap, 50);
  });
  refreshCreateBox(); // säkerställ initialt läge

  // uppdatera när global state ändras (t.ex. efter login)
  globalStateChangeHandler = (e) => {
    if (e?.detail?.key === 'currentUser') {
      // Signed in or out, or admin rights changed: the visitor and the
      // organiser views differ, render the hub again
      if (hubViewKey() !== renderedViewKey) {
        __unload();
        load();
        return;
      }
      refreshCreateBox();
      // The list depends on who is signed in (drafts, global admin): listen
      // again when the user or their role changes, e.g. once auth resolves
      const user = getCurrentUser();
      const listenerKey = [user.uid || '', user.role || '', (user.roles || []).join(',')].join('|');
      if (listenerKey !== competitionListenerUserKey) setupCompetitionListener();
    }
  };
  window.addEventListener('global-state-changed', globalStateChangeHandler);

  // Dölj "Skapa tävling" om inte admin eller superadmin
  const createContainer = document.getElementById('create-competition-container');
  const r = getUserRole();
  if (r !== 'admin' && r !== 'superadmin') {
    createContainer.style.display = 'none';
  }

  setupCompetitionListener();

  updateLatestBox();
}

/** Helper to populate import dropdown */
function updateImportDropdown(allComps) {
  const sel = document.getElementById('importFromComp');
  if (!sel) return;

  // Preserve selected value if possible
  const currentVal = sel.value;

  // Clear but keep first option
  sel.innerHTML = '<option value="">-- Starta från noll --</option>';

  if (!Array.isArray(allComps)) return;

  // Sort by date desc
  const sorted = [...allComps].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

  sorted.forEach(c => {
    const opt = document.createElement('option');
    // docId is often not on the object if fetched via basic query, check ID logic.
    // renderCompetitionList uses c.id || c.docId || c.uid.
    const cid = c.id || c.docId || c.uid;
    if (!cid) return;

    opt.value = cid;
    opt.textContent = `${c.name || 'Namnlös'} (${c.dates || 'Datum saknas'})`;
    sel.appendChild(opt);
  });

  if (currentVal) sel.value = currentVal;
}
