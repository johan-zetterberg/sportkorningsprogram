import { getGlobalState, setGlobalState } from '../../main.js';
import { createCompetition, listenForCompetitions, saveConfig } from '../../services/competitionService.js';
import { showAlert } from '../../ui/components.js';
import { t } from '../../utils/i18n.js';

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
    setTimeout(initMap, 100); // Initialize/refresh map when becoming visible
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
    <div class="container mx-auto p-3 sm:p-4 md:p-8 max-w-screen-xl">
      <!-- Branded header-kort, samma känsla som admin.js -->
      <div class="rounded-2xl shadow-md overflow-hidden mb-8" style="border-bottom:4px solid ${gold};">
        <div class="px-4 sm:px-6 md:px-8 py-5 md:py-6"
             style="background: linear-gradient(90deg, ${darkBlue} 0%, #0b274a 60%, #0e305c 100%);">
          <div class="flex items-center gap-3 sm:gap-4">
            <img src="${logoUrl}" alt="${name} logotyp"
                 class="h-14 w-14 rounded-lg ring-1 ring-white/20 object-contain bg-white/5 p-1"
                 onerror="this.style.display='none'">
            <div>
              <h1 class="text-white text-2xl md:text-3xl font-semibold leading-tight">${t('hub_title')}</h1>
              <p class="text-white/70 text-sm">${t('hub_subtitle')}</p>
            </div>
          </div>
        </div>
      </div>

      <!--Innehåll -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6 mb-6">
        <!-- Sök -->
        <section class="lg:col-span-2 bg-white dark:bg-gray-800 rounded-xl shadow p-4 md:p-5">
          <label for="hubSearch" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">${t('hub_search_label')}</label>
          <div class="relative">
            <input id="hubSearch" type="search" placeholder="${t('hub_search_curr_ph')}"
              class="w-full rounded-lg border border-gray-300 dark:border-gray-600 pl-10 pr-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-lightblue" />
            <svg class="absolute left-3 top-2.5 h-5 w-5 text-gray-400" viewBox="0 0 24 24" fill="none">
              <path d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z"
                    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-2">${t('hub_search_tip')}</p>
        </section>

        <!-- Senaste -->
        <aside class="bg-white dark:bg-gray-800 rounded-xl shadow p-4 md:p-5 flex flex-col justify-center" id="latestBox">
          <h2 class="text-base font-semibold text-gray-900 dark:text-white mb-2">${t('hub_latest_title')}</h2>
          <div id="latestContent" class="text-sm text-gray-600 dark:text-gray-300">${t('hub_no_comp_selected')}</div>
        </aside>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        <!-- Skapa ny (visas bara för admin) -->
        <section id="create-competition-container" class="bg-white dark:bg-gray-800 p-5 rounded-xl shadow">
          <h2 class="text-xl font-semibold mb-3 border-b dark:border-gray-700 pb-2 text-gray-900 dark:text-white">${t('hub_create_title')}</h2>
          <form id="createCompetitionForm" class="space-y-4">
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
            
            <div>
               <label for="importFromComp" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Basera på tidigare tävling (Valfritt)</label>
                <select id="importFromComp" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white max-w-full text-ellipsis overflow-hidden">
                  <option value="">-- Starta från noll --</option>
                </select>
               <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Kopierar inställningar (Maraton, Precision, Karta, etc.) från vald tävling.</p>
            </div>

            <div>
              <label for="compClub" class="block text-sm font-medium text-gray-700 dark:text-gray-300">${t('hub_comp_club')}</label>
              <input type="text" id="compClub" required class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
            </div>

            <div>
              <label for="compPlace" class="block text-sm font-medium text-gray-700 dark:text-gray-300">${t('hub_comp_place')}</label>
              <input type="text" id="compPlace" required class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="Ex. Flyinge">
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Klicka på kartan för att ange exakt position.</p>
            </div>

            <div id="compMapContainer" class="h-64 w-full rounded-md border mt-2 z-0 relative"></div>
            <input type="hidden" id="compLat">
            <input type="hidden" id="compLng">

            <button type="submit"
              class="w-full font-semibold py-2 px-4 rounded-lg text-white hover:opacity-95"
              style="background:${darkBlue};">${t('hub_btn_create')}</button>
          </form>
        </section>

        <!-- Lista -->
        <section class="bg-white dark:bg-gray-800 p-5 rounded-xl shadow">
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-xl font-semibold border-b dark:border-gray-700 pb-2 text-gray-900 dark:text-white">${t('hub_choose_title')}</h2>
            <button id="clearSearchBtn" class="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 dark:text-white">${t('hub_btn_clear')}</button>
          </div>
          <div id="competitionList" class="space-y-3">
            <p class="text-center text-gray-500 dark:text-gray-400">${t('hub_loading_comps')}</p>
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

function safeInvalidateMapSize(mapRef = mapInstance) {
  try {
    if (!mapRef || mapRef !== mapInstance) return;
    if (!mapRef.getContainer?.()?.isConnected) return;
    mapRef.invalidateSize();
  } catch (_) {
    // Ignore late Leaflet callbacks after the hub map has been torn down.
  }
}

function setupCompetitionListener() {
  if (competitionListenerUnsub) {
    competitionListenerUnsub();
  }
  competitionListenerUnsub = listenForCompetitions((comps) => {
    _allCompetitions = Array.isArray(comps) ? comps : [];
    renderCompetitionList(_allCompetitions);
  }, currentLimit);
}

export function initMap() {
  const mapEl = document.getElementById('compMapContainer');
  if (!mapEl) return;

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

  const q = (document.getElementById('hubSearch')?.value || '').trim().toLowerCase();
  const filtered = _allCompetitions.filter(c => {
    const name = String(c.name || '').toLowerCase();
    const place = String(c.place || '').toLowerCase();
    const dates = String(c.dates || c.date || '').toLowerCase();
    const club = String(c.club || '').toLowerCase();

    // Check publish status
    // published is true if undefined (legacy) or explicitly true
    const isPublished = (c.published !== false);
    const user = getCurrentUser();
    const allowAdmin = canAdminCompetition(user, c);

    // If not published AND not an admin for this comp -> Hide
    if (!isPublished && !allowAdmin) return false;

    if (!q) return true;
    return name.includes(q) || place.includes(q) || dates.includes(q) || club.includes(q);
  });

  listEl.innerHTML = '';
  if (filtered.length === 0) {
    listEl.innerHTML = `<p class="text-center text-gray-500 dark:text-gray-400">${t('hub_no_matches')}</p>`;
    updateLatestBox();
    updateImportDropdown(_allCompetitions); // <-- Populate dropdown even if filtered list is empty? No, filtered list is for display.
    // Actually, we want ALL competitions for the dropdown, not just filtered ones.
    // _allCompetitions has all of them.
    return;
  }

  updateImportDropdown(_allCompetitions); // <-- Update dropdown options

  const sorted = filtered.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  const role = getUserRole();
  const dest = role === 'admin' ? '#admin' : '#deltagare';

  sorted.forEach(comp => {
    const a = document.createElement('a');
    a.href = 'javascript:void(0);';
    a.href = 'javascript:void(0);';
    a.className = 'block p-3 sm:p-4 bg-gray-50 dark:bg-gray-700 hover:bg-brand-lightblue/10 dark:hover:bg-gray-600 rounded-lg border dark:border-gray-600';
    const user = getCurrentUser();
    const allowAdmin = canAdminCompetition(user, comp);

    a.innerHTML = `
    <div class="flex items-center justify-between">
      <div>
        <h3 class="font-semibold text-lg text-gray-900 dark:text-white">
            ${comp.name || 'Namnlös tävling'}
            ${(comp.published === false) ? '<span class="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">UTKAST</span>' : ''}
        </h3>
        <p class="text-sm text-gray-600 dark:text-gray-300">${comp.place || '—'} ${comp.dates ? ' | ' + comp.dates : ''}</p>
        ${comp.club ? `<p class="text-xs text-gray-500 dark:text-gray-400 mt-1">${comp.club}</p>` : ''}
      </div>
      <div class="flex gap-2">
        <button class="text-xs px-2 py-1 rounded bg-white dark:bg-gray-800 border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-200 open-info" title="Visa info & karta">Info</button>
        ${allowAdmin
        ? `<button class="text-xs px-2 py-1 rounded bg-white dark:bg-gray-800 border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-200 open-admin">${t('btn_admin')}</button>`
        : `<button class="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-900 border dark:border-gray-700 cursor-not-allowed opacity-60 text-gray-500 dark:text-gray-600" title="Endast skaparen eller superadmin kan öppna Admin" disabled>${t('btn_admin')}</button>`
      }
        <button class="text-xs px-2 py-1 rounded text-white" style="background:${getBranding().darkBlue};">${t('btn_open')}</button>
      </div>
    </div>
  `;
    a.onclick = (ev) => {
      const user = getCurrentUser();
      const allowAdmin = canAdminCompetition(user, comp);

      // Klick på Info?
      if (ev.target && ev.target.classList.contains('open-info')) {
        if (typeof window.openCompetitionInfo === 'function') {
          window.openCompetitionInfo(comp);
        }
        ev.stopPropagation();
        return;
      }

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
  const title = last.name || 'Namnlös tävling';
  const place = last.place || '—';
  const dates = last.dates || '—';

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
      <button id="latestOpenPublic" class="text-sm px-3 py-1.5 rounded-md text-white" style="background:${getBranding().darkBlue};">${t('btn_open')}</button>
      <button id="latestOpenAdmin"  class="text-sm px-3 py-1.5 rounded-md bg-gray-100 dark:bg-gray-800 border dark:border-gray-600 dark:text-white">${t('btn_admin')}</button>
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
    // initialize map if visible now, or observe?
    // refreshCreateBox handles this via toggle and initMap call.
    // So we don't need redundant timeout here.

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const user = getCurrentUser();

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

        showAlert(`Tävlingen "${compData.name}" har skapats!`);
        e.target.reset();

        // Reset map logic if needed
        if (markerInstance) {
          mapInstance.removeLayer(markerInstance);
          markerInstance = null;
        }
      } catch (err) {
        console.error('Error creating competition:', err);
        showAlert('Kunde inte skapa tävlingen.', false);
      }
    });
  }
}


export function __unload() {
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
  renderLayout();
  setupEventListeners();
  refreshCreateBox(); // säkerställ initialt läge

  // uppdatera när global state ändras (t.ex. efter login)
  globalStateChangeHandler = (e) => {
    if (e?.detail?.key === 'currentUser') {
      refreshCreateBox();
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
