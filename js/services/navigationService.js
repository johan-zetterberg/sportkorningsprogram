import { getGlobalState, setGlobalState } from '../main.js';
let __currentPageModule = null; // spåra aktiv modul

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
  'page-dressyr-monitor': ['publik', 'funktionar', 'domare', 'admin'],
  'page-dressyr-admin': ['admin'],
  'page-maraton-admin': ['admin'],
  'page-vagnbredd': ['funktionar', 'domare', 'admin'],
  'page-total-resultat': ['publik', 'funktionar', 'domare', 'admin'],
  'page-portal': ['publik', 'funktionar', 'domare', 'admin'], // Tillåt publik, men sidan kollar inloggningsstatus
  'page-speaker': ['speaker', 'domare', 'admin'],
  'page-prize-giving': ['speaker', 'funktionar', 'domare', 'admin'],
  'page-reports': ['funktionar', 'domare', 'admin'],
  'page-vet-check': ['funktionar', 'domare', 'admin'],
  'page-manual': ['publik', 'funktionar', 'domare', 'admin'],
  'page-official': ['funktionar', 'domare', 'admin'],
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
  'dressyr-monitor': () => import('../pages/dressage/dressyr-monitor.js'),
  'vagnbredd': () => import('../pages/shared/vagnbredd.js'),
  'total-resultat': () => import('../pages/shared/total-resultat.js'),
  'portal': () => import('../pages/shared/portal.js'),
  'speaker': () => import('../pages/shared/speaker.js'),
  'prize-giving': () => import('../pages/shared/prize-giving.js'),
  'reports': () => import('../pages/shared/reports.js'),
  'vet-check': () => import('../pages/shared/vet-check.js'),
  'manual': () => import('../pages/shared/manual.js'),
  'official': () => import('../pages/shared/official.js'),
};

let pageInitializers = {};

export async function navigateTo(hash) {
  const pageKey = hash.substring(1) || 'hub';
  const pageId = `page-${pageKey}`;
  localStorage.setItem('lastPageKey', pageKey);

  try { localStorage.setItem('lastPageId', hash || '#hub'); } catch (_) { }

  const user = getGlobalState('currentUser');
  const userCompRoles = user?.compRoles && user.compRoles.length > 0 ? user.compRoles : [];
  const globalRole = user?.role || 'publik';
  const rolesToCheck = userCompRoles.length > 0 ? userCompRoles : [globalRole];
  const requiredRoles = pagePermissions[pageId] || [];

  // Mappa specifika funktionärsroller till den generella "funktionar"-nivån för page routing
  const roleHierarchy = {
      'superadmin': ['superadmin', 'admin', 'funktionar', 'publik'],
      'admin': ['admin', 'funktionar', 'publik'],
      'dressage': ['dressage', 'funktionar', 'publik'],
      'marathon': ['marathon', 'funktionar', 'publik'],
      'precision': ['precision', 'funktionar', 'publik'],
      'speaker': ['speaker', 'funktionar', 'publik'],
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
    if (window.location.hash !== '' && window.location.hash !== '#hub') {
      window.location.hash = '#hub';
    }
    return;
  }
  document.getElementById('loginModal').style.display = 'none';

  if (pageKey === 'hub') {
    pageInitializers = {};
  }

  // 🔴 Viktigt: städa föregående sida innan vi laddar nästa
  try {
    if (__currentPageModule && typeof __currentPageModule.__unload === 'function') {
      __currentPageModule.__unload();
    }
  } catch (e) {
    console.warn('Kunde inte städa föregående sida:', e);
  }
  // extra säkerhet om någon sida glömt teardown för x-bar
  try { window.__teardownXbarSync?.(); } catch { }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(pageId)?.classList.add('active');
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.querySelector(`.nav-link[href="${hash || '#hub'}"]`)?.classList.add('active');

  const loader = pageLoaders[pageKey];
  if (loader) {
    try {
      const pageModule = await loader();
      if (pageModule && typeof pageModule.load === 'function') {
        const pageElement = document.getElementById(pageId);
        await pageModule.load(pageElement);
        __currentPageModule = pageModule; // spara aktiv modul för nästa teardown
        // gör även globalt (om någon annan vill städa)
        window.__currentPageModule = pageModule;
        pageInitializers[pageId] = true;
      }
    } catch (error) {
      console.error(`Kunde inte ladda modulen för sidan '${pageKey}':`, error);
      const pageElement = document.getElementById(pageId);
      if (pageElement) pageElement.innerHTML = `<p class="text-red-500 p-8 text-center">Ett fel uppstod vid laddning av sidan.</p>`;
    }
  } else {
    console.warn(`Ingen pageLoader definierad för '${pageKey}'.`);
  }
}


export function initRouter() {
  window.addEventListener('hashchange', () => navigateTo(window.location.hash));
}