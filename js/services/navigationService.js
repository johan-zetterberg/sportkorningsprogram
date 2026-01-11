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
  'page-dressyr-input': ['domare', 'admin'],
  'page-dressyr-results': ['publik', 'funktionar', 'domare', 'admin'],
  'page-maraton-stages': ['funktionar', 'domare', 'admin'],
  'page-maraton-input': ['funktionar', 'domare', 'admin'],
  'page-observator-input': ['funktionar', 'domare', 'admin'],
  'page-maraton-results': ['publik', 'funktionar', 'domare', 'admin'],
  'page-maraton-monitor': ['publik', 'funktionar', 'domare', 'admin'],
  'page-precision-monitor': ['publik', 'funktionar', 'domare', 'admin'],
  'page-dressyr-monitor': ['publik', 'funktionar', 'domare', 'admin'],
  'page-dressyr-admin': ['admin'],
  'page-precision-input': ['funktionar', 'domare', 'admin'],
  'page-precision-results': ['publik', 'funktionar', 'domare', 'admin'],
  'page-precision-admin': ['admin'],
  'page-maraton-admin': ['admin'],
  'page-vagnbredd': ['funktionar', 'domare', 'admin'],
  'page-total-results': ['publik', 'funktionar', 'domare', 'admin'],
  'page-portal': ['publik', 'funktionar', 'domare', 'admin'], // Tillåt publik, men sidan kollar inloggningsstatus
  'page-speaker': ['funktionar', 'domare', 'admin', 'speaker'],
  'page-prize-giving': ['funktionar', 'domare', 'admin', 'speaker'],
  'page-reports': ['funktionar', 'domare', 'admin'],
  'page-vet-check': ['funktionar', 'domare', 'admin'],
  'page-manual': ['publik', 'funktionar', 'domare', 'admin'],

};

const pageLoaders = {
  'hub': () => import('../pages/hub.js'),
  'admin': () => import('../pages/admin.js'),
  'ekipage': () => import('../pages/ekipage.js'),
  'deltagare': () => import('../pages/deltagare.js'),
  'hastar': () => import('../pages/hastar.js'),
  'starttider': () => import('../pages/starttider.js'),

  'maraton-tider': () => import('../pages/maraton-tider.js'),
  'dressyr-input': () => import('../pages/dressyr-input.js'),
  'dressyr-results': () => import('../pages/dressyr-resultat.js'),
  'dressyr-admin': () => import('../pages/dressyr-admin.js'),
  'maraton-input': () => import('../pages/maraton-input.js'),
  'maraton-results': () => import('../pages/maraton-resultat.js'),
  'maraton-monitor': () => import('../pages/maraton-monitor.js'),
  'maraton-admin': () => import('../pages/maraton-admin.js'),
  'maraton-stages': () => import('../pages/maraton-stages-input.js'),
  'observator-input': () => import('../pages/observator-input.js'),
  'precision-monitor': () => import('../pages/precision-monitor.js'),
  'precision-input': () => import('../pages/precision-input.js'),
  'precision-results': () => import('../pages/precision-resultat.js'),
  'precision-admin': () => import('../pages/precision-admin.js'),
  'dressyr-monitor': () => import('../pages/dressyr-monitor.js'),
  'vagnbredd': () => import('../pages/vagnbredd.js'),
  'total-results': () => import('../pages/total-resultat.js'),
  'portal': () => import('../pages/portal.js'),
  'speaker': () => import('../pages/speaker.js'),
  'prize-giving': () => import('../pages/prize-giving.js'),
  'reports': () => import('../pages/reports.js'),
  'vet-check': () => import('../pages/vet-check.js'),
  'manual': () => import('../pages/manual.js'),

};

let pageInitializers = {};

export async function navigateTo(hash) {
  const pageKey = hash.substring(1) || 'hub';
  const pageId = `page-${pageKey}`;
  localStorage.setItem('lastPageKey', pageKey);

  try { localStorage.setItem('lastPageId', hash || '#hub'); } catch (_) { }

  const userRole = getGlobalState('currentUser')?.role || 'publik';
  const requiredRoles = pagePermissions[pageId] || [];
  if (!requiredRoles.includes(userRole)) {
    document.getElementById('loginModal').style.display = 'flex';
    if (window.location.hash !== '' && window.location.hash !== '#hub') {
      window.location.hash = '#hub';
    }
    return;
  }
  document.getElementById('loginModal').style.display = 'none';

  if (pageKey === 'hub') {
    setGlobalState({ key: 'currentCompetition', value: null });
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