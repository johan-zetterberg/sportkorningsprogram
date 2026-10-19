import { getCompetitionMode, getGlobalState, refreshUserCompRole, setGlobalState } from '../main.js';
import { getCompetitionById } from './competitionService.js';
import { getPageUnloadFunction, isStaleNavigation } from './navigationLifecycleUtils.js';

let __currentPageModule = null; // spåra aktiv modul
// The module the newest navigation loaded (see the stale-load check in navigateTo)
let __latestLoadedModule = null;
let __navigationId = 0;

const pagePermissions = {
  'page-hub': ['publik', 'funktionar', 'domare', 'admin'],
  'page-admin': ['admin'],
  'page-ekipage': ['admin'],
  'page-deltagare': ['publik', 'funktionar', 'domare', 'admin'],
  'page-hastar': ['publik', 'funktionar', 'domare', 'admin'],
  'page-starttider': ['publik', 'funktionar', 'domare', 'admin'],

  'page-maraton-tider': ['publik', 'funktionar', 'domare', 'admin'],
  'page-dressyr-input': ['dressage', 'domare', 'admin'],
  'page-dressyr-results': ['publik', 'funktionar', 'domare', 'admin'],
  'page-maraton-stages': ['marathon', 'domare', 'admin'],
  'page-maraton-input': ['marathon', 'domare', 'admin'],
  'page-observator-input': ['marathon', 'domare', 'admin'],
  'page-maraton-monitor': ['publik', 'funktionar', 'domare', 'admin'],
  'page-maraton-results': ['publik', 'funktionar', 'domare', 'admin'],
  'page-precision-monitor': ['publik', 'funktionar', 'domare', 'admin'],
  'page-precision-input': ['precision', 'domare', 'admin'],
  'page-precision-split-input': ['precision', 'domare', 'admin'],
  'page-precision-results': ['publik', 'funktionar', 'domare', 'admin'],
  'page-precision-admin': ['admin'],
  'page-sekretariat-precision': ['admin', 'precision'],
  'page-sekretariat-maraton': ['admin', 'marathon'],
  'page-sekretariat-dressyr': ['admin', 'dressage'],
  'page-dressyr-monitor': ['publik', 'funktionar', 'domare', 'admin'],
  'page-dressyr-admin': ['admin'],
  'page-maraton-admin': ['admin'],
  // Carriage width decides the cone width in precision: measured by the
  // precision officials (and the technical delegate / ground jury), not by
  // every official. The rules let the precision role write only these fields
  'page-vagnbredd': ['precision', 'domare', 'admin'],
  'page-total-resultat': ['publik', 'funktionar', 'domare', 'admin'],
  'page-portal': ['publik', 'funktionar', 'domare', 'admin'], // Tillåt publik, men sidan kollar inloggningsstatus
  'page-competition-center': ['publik', 'funktionar', 'domare', 'admin'],
  'page-speaker': ['speaker', 'domare', 'admin'],
  'page-prize-giving': ['speaker', 'funktionar', 'domare', 'admin'],
  'page-reports': ['funktionar', 'domare', 'admin'],
  // Clinical data (vetInspections, vetNotes): the vet and admins only
  'page-vet-check': ['vet', 'admin'],
  'page-manual': ['publik', 'funktionar', 'domare', 'admin'],
  'page-official': ['funktionar', 'domare', 'admin'],
  // The privacy notice: readable by everyone, signed in or not
  'page-privacy': ['publik', 'funktionar', 'domare', 'admin'],
};

const pageLoaders = {
  'hub': () => import('../pages/shared/hub.js'),
  'admin': () => import('../pages/admin/admin.js'),
  'ekipage': () => import('../pages/admin/ekipage.js'),
  'deltagare': () => import('../pages/admin/deltagare.js'),
  'hastar': () => import('../pages/admin/hastar.js'),
  'starttider': () => import('../pages/admin/starttider.js'),

  'maraton-tider': () => import('../pages/marathon/maraton-tider.js'),
  'dressyr-input': () => import('../pages/dressage/dressyr-input.js'),
  'dressyr-results': () => import('../pages/dressage/dressyr-resultat.js'),
  'dressyr-admin': () => import('../pages/dressage/dressyr-admin.js'),
  'maraton-input': () => import('../pages/marathon/maraton-input.js'),
  'maraton-results': () => import('../pages/marathon/maraton-resultat.js'),
  'maraton-monitor': () => import('../pages/marathon/maraton-monitor.js'),
  'maraton-admin': () => import('../pages/marathon/maraton-admin.js'),
  'maraton-stages': () => import('../pages/marathon/maraton-stages-input.js'),
  'observator-input': () => import('../pages/marathon/observator-input.js'),
  'precision-monitor': () => import('../pages/precision/precision-monitor.js'),
  'precision-input': () => import('../pages/precision/precision-input.js'),
  'precision-split-input': () => import('../pages/precision/precision-split-input.js'),
  'precision-results': () => import('../pages/precision/precision-resultat.js'),
  'precision-admin': () => import('../pages/precision/precision-admin.js'),
  'sekretariat-precision': () => import('../pages/secretariat/secretariat-precision.js'),
  'sekretariat-maraton': () => import('../pages/secretariat/secretariat-marathon.js'),
  'sekretariat-dressyr': () => import('../pages/secretariat/secretariat-dressage.js'),
  'dressyr-monitor': () => import('../pages/dressage/dressyr-monitor.js'),
  'vagnbredd': () => import('../pages/shared/vagnbredd.js'),
  'total-resultat': () => import('../pages/shared/total-resultat.js'),
  'portal': () => import('../pages/shared/portal.js'),
  'competition-center': () => import('../pages/shared/competition-center.js'),
  'speaker': () => import('../pages/shared/speaker.js'),
  'prize-giving': () => import('../pages/shared/prize-giving.js'),
  'reports': () => import('../pages/shared/reports.js'),
  'vet-check': () => import('../pages/shared/vet-check.js'),
  'manual': () => import('../pages/shared/manual.js'),
  'official': () => import('../pages/shared/official.js'),
  'privacy': () => import('../pages/shared/privacy.js'),
};

const pageModeRequirements = {
  'dressyr-monitor': 'live',
  'maraton-monitor': 'live',
  'precision-monitor': 'live',
  'observator-input': 'live'
};

const pageModeRedirects = {
  'dressyr-monitor': '#dressyr-results',
  'maraton-monitor': '#maraton-results',
  'precision-monitor': '#precision-results',
  'observator-input': '#maraton-results'
};

let pageInitializers = {};

function getRequestedCompetitionIdFromHash(hash) {
  try {
    const hashQuery = String(hash || '').split('?')[1] || '';
    const hashParams = new URLSearchParams(hashQuery);
    const hashId = hashParams.get('id');
    if (hashId) return hashId;

    const searchParams = new URLSearchParams(window.location.search || '');
    return searchParams.get('id');
  } catch {
    return null;
  }
}

export async function navigateTo(hash) {
  const navigationId = ++__navigationId;
  const normalizedHash = hash || '#hub';
  const routeHash = normalizedHash.split('?')[0];
  const pageKey = routeHash.substring(1) || 'hub';
  const pageId = `page-${pageKey}`;
  // Storage can be blocked (strict private mode): navigation must still work
  try { localStorage.setItem('lastPageKey', pageKey); } catch (_) { }
  try { localStorage.setItem('lastPageId', routeHash || '#hub'); } catch (_) { }

  if (pageKey !== 'hub') {
    try {
      const requestedCompetitionId = getRequestedCompetitionIdFromHash(normalizedHash);
      const currentCompetition = getGlobalState('currentCompetition');
      const requestedDiffers = requestedCompetitionId
        && String(currentCompetition?.id || '') !== String(requestedCompetitionId);
      const fallbackCompetitionId = !requestedCompetitionId && !currentCompetition
        ? localStorage.getItem('lastCompetitionId')
        : null;
      const competitionId = requestedDiffers ? requestedCompetitionId : fallbackCompetitionId;

      if (competitionId) {
        const comp = await getCompetitionById(competitionId);
        if (isStaleNavigation(navigationId, __navigationId)) return;
        if (comp) {
          setGlobalState({ key: 'currentCompetition', value: comp });
          await refreshUserCompRole();
        } else if (requestedCompetitionId) {
          setGlobalState({ key: 'currentCompetition', value: null });
          await refreshUserCompRole();
        }
        if (isStaleNavigation(navigationId, __navigationId)) return;
      }
    } catch (error) {
      console.warn('Kunde inte återställa tävlingskontext vid navigering:', error);
    }
  }

  const user = getGlobalState('currentUser');
  const userCompRoles = user?.compRoles && user.compRoles.length > 0 ? user.compRoles : [];
  const globalRole = user?.role || 'publik';
  const rolesToCheck = [...new Set([...userCompRoles, globalRole].filter(Boolean))];
  const requiredRoles = pagePermissions[pageId] || [];

  // Mappa specifika funktionärsroller till den generella "funktionar"-nivån för page routing
  const roleHierarchy = {
      'superadmin': ['superadmin', 'admin', 'funktionar', 'publik'],
      'admin': ['admin', 'funktionar', 'publik'],
      'dressage': ['dressage', 'funktionar', 'publik'],
      'marathon': ['marathon', 'funktionar', 'publik'],
      'precision': ['precision', 'funktionar', 'publik'],
      'speaker': ['speaker', 'funktionar', 'publik'],
      // Limited: the vet page and public pages, not the general official pages
      'vet': ['vet', 'publik'],
      'publik': ['publik']
  };

  let hasAccess = false;
  for (const r of rolesToCheck) {
      const expandedRoles = roleHierarchy[r] || [r, 'publik'];
      if (requiredRoles.some(req => expandedRoles.includes(req))) {
          hasAccess = true;
          break;
      }
  }

  // Om superadmin -> Släpp igenom allt
  if (!rolesToCheck.includes('superadmin') && !hasAccess) {
    document.getElementById('loginModal').style.display = 'flex';
    if (routeHash !== '' && routeHash !== '#hub') {
      window.location.hash = '#hub';
    }
    return;
  }
  document.getElementById('loginModal').style.display = 'none';

  const requiredMode = pageModeRequirements[pageKey];
  const competitionMode = getCompetitionMode();
  if (requiredMode && requiredMode !== competitionMode) {
    const redirectHash = pageModeRedirects[pageKey] || '#hub';
    if (window.location.hash !== redirectHash) {
      window.location.hash = redirectHash;
      return;
    }
    return navigateTo(redirectHash);
  }

  if (pageKey === 'hub') {
    pageInitializers = {};
  }

  // Viktigt: städa föregående sida innan vi laddar nästa.
  try {
    const unload = getPageUnloadFunction(__currentPageModule);
    if (unload) await unload();
  } catch (e) {
    console.warn('Kunde inte städa föregående sida:', e);
  }
  __currentPageModule = null;
  window.__currentPageModule = null;

  // Extra säkerhet om någon sida glömt teardown för x-bar.
  try { window.__teardownXbarSync?.(); } catch { }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(pageId)?.classList.add('active');
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.querySelector(`.nav-link[href="${routeHash || '#hub'}"]`)?.classList.add('active');

  const loader = pageLoaders[pageKey];
  if (loader) {
    let pageModule = null;
    try {
      pageModule = await loader();
      if (isStaleNavigation(navigationId, __navigationId)) return;
      __latestLoadedModule = pageModule;

      if (pageModule && typeof pageModule.load === 'function') {
        const pageElement = document.getElementById(pageId);
        await pageModule.load(pageElement);

        if (isStaleNavigation(navigationId, __navigationId)) {
          // A newer navigation loaded the same page module (e.g. the same
          // page with another id): unloading the shared module now would
          // remove that page's listeners. The page itself ignores a
          // superseded load (see maraton-input.js loadSeq).
          if (pageModule !== __latestLoadedModule) {
            const unload = getPageUnloadFunction(pageModule);
            if (unload) await unload();
          }
          return;
        }

        __currentPageModule = pageModule; // spara aktiv modul för nästa teardown
        // gör även globalt (om någon annan vill städa)
        window.__currentPageModule = pageModule;
        pageInitializers[pageId] = true;
        window.updateCompactPageContext?.();
      }
    } catch (error) {
      console.error(`Kunde inte ladda modulen för sidan '${pageKey}':`, error);
      // A load that failed halfway may already have started listeners and
      // timers; nothing else would stop them (the module never became current)
      try { await getPageUnloadFunction(pageModule)?.(); } catch (unloadError) {
        console.warn(`Kunde inte städa sidan '${pageKey}' efter laddningsfel:`, unloadError);
      }
      const pageElement = document.getElementById(pageId);
      if (pageElement) pageElement.innerHTML = `<p class="text-red-500 p-8 text-center">Sidan kunde inte laddas. Kontrollera nätet och ladda om sidan.</p>`;
      window.updateCompactPageContext?.();
    }
  } else {
    console.warn(`Ingen pageLoader definierad för '${pageKey}'.`);
    window.updateCompactPageContext?.();
  }
}


export function initRouter() {
  window.addEventListener('hashchange', () => navigateTo(window.location.hash));
}
