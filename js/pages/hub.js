// js/hub.js
import { getGlobalState, setGlobalState } from '../main.js';
import { createCompetition, listenForCompetitions } from '../services/firestoreService.js';
import { showAlert } from '../ui/components.js';

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
  el.style.display = (role === 'admin' || role === 'superadmin') ? '' : 'none';
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
    <div class="container mx-auto p-4 md:p-8 max-w-screen-xl">
      <!-- Branded header-kort, samma känsla som admin.js -->
      <div class="rounded-2xl shadow-md overflow-hidden mb-8" style="border-bottom:4px solid ${gold};">
        <div class="px-6 md:px-8 py-6"
             style="background: linear-gradient(90deg, ${darkBlue} 0%, #0b274a 60%, #0e305c 100%);">
          <div class="flex items-center gap-4">
            <img src="${logoUrl}" alt="${name} logotyp"
                 class="h-14 w-14 rounded-lg ring-1 ring-white/20 object-contain bg-white/5 p-1"
                 onerror="this.style.display='none'">
            <div>
              <h1 class="text-white text-2xl md:text-3xl font-semibold leading-tight">Tävlings-hub</h1>
              <p class="text-white/70 text-sm">Välj tävling, sök eller skapa ny (admin).</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Innehåll -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <!-- Sök -->
        <section class="lg:col-span-2 bg-white rounded-xl shadow p-4 md:p-5">
          <label for="hubSearch" class="block text-sm font-medium text-gray-700 mb-2">Sök tävling</label>
          <div class="relative">
            <input id="hubSearch" type="search" placeholder="Sök på namn, plats, datum eller klubb"
              class="w-full rounded-lg border border-gray-300 pl-10 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-lightblue" />
            <svg class="absolute left-3 top-2.5 h-5 w-5 text-gray-400" viewBox="0 0 24 24" fill="none">
              <path d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z"
                    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <p class="text-xs text-gray-500 mt-2">Tips: Tryck Enter för att öppna första träffen.</p>
        </section>

        <!-- Senaste -->
        <aside class="bg-white rounded-xl shadow p-4 md:p-5 flex flex-col justify-center" id="latestBox">
          <h2 class="text-base font-semibold text-gray-900 mb-2">Senaste tävling</h2>
          <div id="latestContent" class="text-sm text-gray-600">Ingen tävling vald ännu.</div>
        </aside>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Skapa ny (visas bara för admin) -->
        <section id="create-competition-container" class="bg-white p-5 rounded-xl shadow">
          <h2 class="text-xl font-semibold mb-3 border-b pb-2">Skapa ny tävling</h2>
          <form id="createCompetitionForm" class="space-y-3">
            <div>
              <label for="compName" class="block text-sm font-medium">Tävlingens namn</label>
              <input type="text" id="compName" required class="mt-1 block w-full p-2 border rounded-md" placeholder="Ex. Flyinge Indoor 2025">
            </div>
            <div>
              <label for="compPlace" class="block text-sm font-medium">Plats</label>
              <input type="text" id="compPlace" required class="mt-1 block w-full p-2 border rounded-md" placeholder="Ex. Flyinge">
            </div>
            <div>
              <label for="compDates" class="block text-sm font-medium">Datum</label>
              <input type="text" id="compDates" placeholder="ex: 2025-03-08 – 2025-03-09" required class="mt-1 block w-full p-2 border rounded-md">
            </div>
            <div>
              <label for="compClub" class="block text-sm font-medium">Arrangerande klubb</label>
              <input type="text" id="compClub" required class="mt-1 block w-full p-2 border rounded-md">
            </div>
            <button type="submit"
              class="w-full font-semibold py-2 px-4 rounded-lg text-white hover:opacity-95"
              style="background:${darkBlue};">Skapa tävling</button>
          </form>
        </section>

        <!-- Lista -->
        <section class="bg-white p-5 rounded-xl shadow">
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-xl font-semibold border-b pb-2">Välj tävling</h2>
            <button id="clearSearchBtn" class="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200">Rensa sök</button>
          </div>
          <div id="competitionList" class="space-y-3">
            <p class="text-center text-gray-500">Laddar tävlingar...</p>
          </div>
        </section>
      </div>
    </div>
  `;
}

/** Lista + sök */
let _allCompetitions = [];
let currentLimit = 50;
let competitionListenerUnsub = null;

function setupCompetitionListener() {
  if (competitionListenerUnsub) {
    competitionListenerUnsub();
  }
  competitionListenerUnsub = listenForCompetitions((comps) => {
    _allCompetitions = Array.isArray(comps) ? comps : [];
    renderCompetitionList(_allCompetitions);
  }, currentLimit);
}

function renderCompetitionList(competitions) {
  _allCompetitions = Array.isArray(competitions) ? competitions.slice() : [];
  const listEl = document.getElementById('competitionList');
  if (!listEl) return;

  const q = (document.getElementById('hubSearch')?.value || '').trim().toLowerCase();
  const filtered = _allCompetitions.filter(c => {
    const name = String(c.name || '').toLowerCase();
    const place = String(c.place || '').toLowerCase();
    const dates = String(c.dates || c.date || '').toLowerCase();
    const club = String(c.club || '').toLowerCase();
    if (!q) return true;
    return name.includes(q) || place.includes(q) || dates.includes(q) || club.includes(q);
  });

  listEl.innerHTML = '';
  if (filtered.length === 0) {
    listEl.innerHTML = '<p class="text-center text-gray-500">Inga tävlingar matchar din sökning.</p>';
    updateLatestBox();
    return;
  }

  const sorted = filtered.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  const role = getUserRole();
  const dest = role === 'admin' ? '#admin' : '#deltagare';

  sorted.forEach(comp => {
    const a = document.createElement('a');
    a.href = 'javascript:void(0);';
    a.className = 'block p-4 bg-gray-50 hover:bg-brand-lightblue/10 rounded-lg border';
    const user = getCurrentUser();
    const allowAdmin = canAdminCompetition(user, comp);

    a.innerHTML = `
    <div class="flex items-center justify-between">
      <div>
        <h3 class="font-semibold text-lg text-gray-900">${comp.name || 'Namnlös tävling'}</h3>
        <p class="text-sm text-gray-600">${comp.place || '—'} ${comp.dates ? ' | ' + comp.dates : ''}</p>
        ${comp.club ? `<p class="text-xs text-gray-500 mt-1">${comp.club}</p>` : ''}
      </div>
      <div class="flex gap-2">
        ${allowAdmin
        ? `<button class="text-xs px-2 py-1 rounded bg-white border hover:bg-gray-100 open-admin">Admin</button>`
        : `<button class="text-xs px-2 py-1 rounded bg-gray-100 border cursor-not-allowed opacity-60" title="Endast skaparen eller superadmin kan öppna Admin" disabled>Admin</button>`
      }
        <button class="text-xs px-2 py-1 rounded text-white" style="background:${getBranding().darkBlue};">Öppna</button>
      </div>
    </div>
  `;
    a.onclick = (ev) => {
      const user = getCurrentUser();
      const allowAdmin = canAdminCompetition(user, comp);

      // Klick på Admin?
      if (ev.target && ev.target.classList.contains('open-admin')) {
        if (!allowAdmin) {
          showAlert('Du har inte behörighet att öppna Admin för denna tävling.');
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
    listEl.appendChild(a);
  });

  // Visa "Ladda fler" om vi har laddat lika många som limiten (indikerar att det KAN finnas fler)
  if (_allCompetitions.length >= currentLimit) {
    const loadMoreBtn = document.createElement('button');
    loadMoreBtn.id = 'loadMoreCompetitionsBtn';
    loadMoreBtn.className = 'w-full py-2 mt-2 text-sm text-gray-600 font-medium bg-gray-100 hover:bg-gray-200 rounded-lg border border-gray-300 transition-colors';
    loadMoreBtn.textContent = 'Ladda fler tävlingar...';
    loadMoreBtn.onclick = () => {
      loadMoreBtn.textContent = 'Laddar...';
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
  if (!last) { box.textContent = 'Ingen tävling vald ännu.'; return; }

  const role = getUserRole();
  const dest = role === 'admin' ? '#admin' : '#deltagare';
  const title = last.name || 'Namnlös tävling';
  const place = last.place || '—';
  const dates = last.dates || '—';

  const user = getCurrentUser();
  const comp = _allCompetitions.find(c => (c.id || c.docId || c.uid) === (last.id)) || last;
  const allowAdmin = canAdminCompetition(user, comp);

  box.innerHTML = `
  <div id="latestClickable" class="p-3 rounded-lg border cursor-pointer hover:bg-gray-50 transition-colors flex items-start justify-between gap-3">
    <div>
      <div class="font-medium text-gray-900">${title}</div>
      <div class="text-gray-600 text-xs">${place} • ${dates}</div>
    </div>
    <div class="flex gap-2">
      <button id="latestOpenPublic" class="text-sm px-3 py-1.5 rounded-md text-white" style="background:${getBranding().darkBlue};">Öppna</button>
      <button id="latestOpenAdmin"  class="text-sm px-3 py-1.5 rounded-md bg-gray-100 border">Admin</button>
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
    if (!allowAdmin) {
      adminBtn.disabled = true;
      adminBtn.classList.add('cursor-not-allowed', 'opacity-60');
      adminBtn.title = 'Endast skaparen eller superadmin kan öppna Admin';
    }
    adminBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!allowAdmin) {
        showAlert('Du har inte behörighet att öppna Admin för denna tävling.');
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
  const search = document.getElementById('hubSearch');
  document.getElementById('clearSearchBtn')?.addEventListener('click', () => {
    if (search) { search.value = ''; renderCompetitionList(_allCompetitions); search.focus(); }
  });

  if (search) {
    search.addEventListener('input', () => renderCompetitionList(_allCompetitions));
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const q = (search.value || '').trim().toLowerCase();
        const first = _allCompetitions.find(c => {
          const name = String(c.name || '').toLowerCase();
          const place = String(c.place || '').toLowerCase();
          const dates = String(c.dates || c.date || '').toLowerCase();
          const club = String(c.club || '').toLowerCase();
          return !q || name.includes(q) || place.includes(q) || dates.includes(q) || club.includes(q);
        });
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
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const user = getCurrentUser();
      await createCompetition({
        name: document.getElementById('compName').value,
        place: document.getElementById('compPlace').value,
        dates: document.getElementById('compDates').value,
        club: document.getElementById('compClub').value,
        createdBy: user?.uid || null,
        admins: user?.uid ? [user.uid] : []
      });
      try {
        await createCompetition(data);
        showAlert(`Tävlingen "${data.name}" har skapats!`);
        e.target.reset();
      } catch (err) {
        console.error('Error creating competition:', err);
        showAlert('Kunde inte skapa tävlingen.', false);
      }
    });
  }
}

/** Exporterat API */
export function load() {
  renderLayout();
  setupEventListeners();
  refreshCreateBox(); // säkerställ initialt läge

  // uppdatera när global state ändras (t.ex. efter login)
  window.addEventListener('global-state-changed', (e) => {
    if (e?.detail?.key === 'currentUser') {
      refreshCreateBox();
    }
  });

  // Dölj "Skapa tävling" om inte admin (som tidigare)
  const createContainer = document.getElementById('create-competition-container');
  if (getUserRole() !== 'admin') {
    createContainer.style.display = 'none';
  }

  setupCompetitionListener();

  updateLatestBox();
}
