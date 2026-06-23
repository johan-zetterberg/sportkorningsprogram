import { getGlobalState } from '../../main.js';
import { getPublicCompetitionViewModel } from '../../services/publicCompetitionService.js';
import { getCompetitionHeader, showAlert } from '../../ui/components.js';

let expandedClasses = new Set();
let venueMapInstance = null;

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '#';
  if (/^(https?:|mailto:|\/)/i.test(raw)) return raw;
  return '#';
}

function getPublicCompetitionLink(competition) {
  const base = `${window.location.origin}${window.location.pathname}`;
  const id = encodeURIComponent(competition?.id || '');
  return `${base}#competition-center${id ? `?id=${id}` : ''}`;
}

function getQrImageUrl(url) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(url)}`;
}

function renderEmpty(container, title, body) {
  container.innerHTML = `
    <div class="container mx-auto p-3 sm:p-4 md:p-8 max-w-screen-lg">
      <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border dark:border-gray-700 p-8 text-center">
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-3">${escapeHtml(title)}</h1>
        <p class="text-gray-600 dark:text-gray-300">${escapeHtml(body)}</p>
      </div>
    </div>
  `;
}

function renderDocs(docs) {
  if (!docs.length) {
    return '<p class="text-sm text-gray-500 dark:text-gray-400">Inga publicerade dokument ännu.</p>';
  }

  return `
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      ${docs.map((doc) => `
        <div class="rounded-xl border dark:border-gray-700 bg-white dark:bg-gray-800 p-3 sm:p-4">
          <div class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">${escapeHtml(doc.category || doc.type || 'Dokument')}</div>
          <div class="mt-1 font-semibold text-gray-900 dark:text-white">${escapeHtml(doc.title || 'Dokument')}</div>
          ${doc.url ? `<div class="mt-3"><a href="${escapeHtml(sanitizeUrl(doc.url))}" target="_blank" rel="noopener noreferrer" class="text-sm font-medium text-blue-700 dark:text-blue-300 hover:underline">Öppna dokument</a></div>` : ''}
          ${!doc.url && doc.content ? `<div class="mt-3 text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">${escapeHtml(doc.content)}</div>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

function renderMessages(messages) {
  if (!messages.length) {
    return '<p class="text-sm text-gray-500 dark:text-gray-400">Inga publika meddelanden just nu.</p>';
  }

  return `
    <div class="space-y-3">
      ${messages.slice(0, 6).map((message) => `
        <div class="rounded-xl border dark:border-gray-700 bg-white dark:bg-gray-800 p-3 sm:p-4">
          <div class="font-semibold text-gray-900 dark:text-white">${escapeHtml(message.title || 'Information')}</div>
          <div class="mt-1 text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">${escapeHtml(message.body || message.message || '')}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderClassDetails(row) {
  const marathon = row.marathonDetails || {};
  const precision = row.precisionDetails || {};
  const obstacleText = (marathon.drivenObstacles || []).length
    ? marathon.drivenObstacles.map((obstacle) => `#${obstacle.number}${obstacle.name ? ` ${escapeHtml(obstacle.name)}` : ''}${obstacle.gateCount ? ` (${obstacle.gateCount} portar)` : ''}`).join(', ')
    : 'Ingen hinderinformation sparad';
  const precisionGates = (precision.obstacleLabels || []).length
    ? precision.obstacleLabels.join(', ')
    : 'Inga gate-etiketter sparade';

  return `
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div class="rounded-xl border dark:border-gray-700 bg-white dark:bg-gray-800 p-3 sm:p-4">
        <h3 class="font-semibold text-gray-900 dark:text-white mb-3">Maraton</h3>
        <div class="space-y-2 text-sm text-gray-600 dark:text-gray-300">
          <div><strong>Körda hinder:</strong> ${obstacleText}</div>
          ${marathon.gateCount ? `<div><strong>Standardportar per hinder:</strong> ${marathon.gateCount}</div>` : ''}
          ${(marathon.distanceA || marathon.distanceB || marathon.distanceT) ? `<div><strong>Distanser:</strong> A ${marathon.distanceA || '-'} m, T ${marathon.distanceT || '-'} m, B ${marathon.distanceB || '-'} m</div>` : ''}
        </div>
      </div>
      <div class="rounded-xl border dark:border-gray-700 bg-white dark:bg-gray-800 p-3 sm:p-4">
        <h3 class="font-semibold text-gray-900 dark:text-white mb-3">Precision</h3>
        <div class="space-y-2 text-sm text-gray-600 dark:text-gray-300">
          <div><strong>Hinder/gates:</strong> ${escapeHtml(precisionGates)}</div>
          ${precision.trackLengthMeters ? `<div><strong>Banlängd:</strong> ${precision.trackLengthMeters} m</div>` : ''}
          ${precision.tempo ? `<div><strong>Tempo:</strong> ${precision.tempo} m/min</div>` : ''}
        </div>
      </div>
    </div>
  `;
}

function renderClassSummary(rows) {
  if (!rows.length) {
    return '<p class="text-sm text-gray-500 dark:text-gray-400">Inga klasser att visa ännu.</p>';
  }

  return `
    <div class="space-y-3 md:hidden">
      ${rows.map((row) => {
        const isOpen = expandedClasses.has(row.className);
        return `
          <div class="rounded-2xl border dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 overflow-hidden">
            <button type="button" class="class-detail-toggle w-full text-left p-3 sm:p-4" data-class-name="${escapeHtml(row.className)}">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <div class="font-semibold text-gray-900 dark:text-white">${escapeHtml(row.className)}</div>
                  <div class="text-sm text-gray-500 dark:text-gray-400 mt-1">${row.starters} starter</div>
                </div>
                <span class="text-xs text-gray-400 shrink-0 pt-1">${isOpen ? '▲' : '▼'}</span>
              </div>
              <div class="grid grid-cols-1 gap-2 mt-4 text-sm">
                <div class="rounded-xl bg-white dark:bg-gray-800 p-3 border dark:border-gray-700">
                  <div class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Dressyr</div>
                  <div class="mt-1 text-gray-700 dark:text-gray-300">${escapeHtml(row.dressageWindow)}</div>
                </div>
                <div class="rounded-xl bg-white dark:bg-gray-800 p-3 border dark:border-gray-700">
                  <div class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Maraton</div>
                  <div class="mt-1 text-gray-700 dark:text-gray-300">${escapeHtml(row.marathonWindow)}</div>
                </div>
                <div class="rounded-xl bg-white dark:bg-gray-800 p-3 border dark:border-gray-700">
                  <div class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Precision</div>
                  <div class="mt-1 text-gray-700 dark:text-gray-300">${escapeHtml(row.precisionWindow)}</div>
                </div>
              </div>
            </button>
            ${isOpen ? `
              <div class="border-t dark:border-gray-700 p-3 sm:p-4">
                ${renderClassDetails(row)}
              </div>
            ` : ''}
          </div>
        `;
      }).join('')}
    </div>
    <div class="hidden md:block overflow-x-auto">
      <table class="min-w-full text-sm">
        <thead>
          <tr class="border-b dark:border-gray-700 text-left text-gray-500 dark:text-gray-400">
            <th class="py-2 pr-4">Klass</th>
            <th class="py-2 pr-4">Starter</th>
            <th class="py-2 pr-4">Dressyr</th>
            <th class="py-2 pr-4">Maraton</th>
            <th class="py-2">Precision</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => {
            const isOpen = expandedClasses.has(row.className);
            return `
              <tr class="border-b dark:border-gray-800">
                <td class="py-3 pr-4 font-medium text-gray-900 dark:text-white">
                  <button type="button" class="class-detail-toggle inline-flex items-center gap-2 hover:text-blue-700 dark:hover:text-blue-300" data-class-name="${escapeHtml(row.className)}">
                    <span>${escapeHtml(row.className)}</span>
                    <span class="text-xs text-gray-400">${isOpen ? '▲' : '▼'}</span>
                  </button>
                </td>
                <td class="py-3 pr-4 text-gray-600 dark:text-gray-300">${row.starters}</td>
                <td class="py-3 pr-4 text-gray-600 dark:text-gray-300">${escapeHtml(row.dressageWindow)}</td>
                <td class="py-3 pr-4 text-gray-600 dark:text-gray-300">${escapeHtml(row.marathonWindow)}</td>
                <td class="py-3 text-gray-600 dark:text-gray-300">${escapeHtml(row.precisionWindow)}</td>
              </tr>
              ${isOpen ? `
                <tr class="border-b dark:border-gray-800 bg-gray-50 dark:bg-gray-900/30">
                  <td colspan="5" class="p-4">
                    ${renderClassDetails(row)}
                  </td>
                </tr>
              ` : ''}
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function destroyVenueMap() {
  try {
    venueMapInstance?.off();
    venueMapInstance?.remove();
  } catch {}
  venueMapInstance = null;
}

function initVenueMap(coordinates) {
  const mapEl = document.getElementById('competition-center-venue-map');
  if (!mapEl || !coordinates?.lat || !coordinates?.lng) return;
  if (typeof window.L === 'undefined') {
    mapEl.innerHTML = `
      <div class="flex h-full items-center justify-center bg-gray-50 dark:bg-gray-800 text-sm text-gray-500 dark:text-gray-300 px-4 text-center">
        Karta kunde inte laddas. Använd vägbeskrivningslänken i stället.
      </div>
    `;
    return;
  }

  destroyVenueMap();

  const lat = Number(coordinates.lat);
  const lng = Number(coordinates.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  venueMapInstance = L.map(mapEl, { zoomControl: true, attributionControl: true }).setView([lat, lng], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(venueMapInstance);
  L.marker([lat, lng]).addTo(venueMapInstance);
  setTimeout(() => venueMapInstance?.invalidateSize(), 150);
}

function bindClassToggles(container, competition, vm, publish) {
  container.querySelectorAll('.class-detail-toggle').forEach((button) => {
    button.addEventListener('click', () => {
      const className = button.dataset.className || '';
      if (!className) return;
      if (expandedClasses.has(className)) expandedClasses.delete(className);
      else expandedClasses.add(className);
      renderPage(container, competition, vm, publish);
    });
  });
}

function bindShareActions(container, competition) {
  const publicLink = getPublicCompetitionLink(competition);
  const qrPanel = container.querySelector('#competition-center-qr-panel');
  const qrImage = container.querySelector('#competition-center-qr-image');

  container.querySelector('#copy-public-link-btn')?.addEventListener('click', async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(publicLink);
        showAlert('Publik länken är kopierad.');
      } else {
        window.prompt('Kopiera publik länken:', publicLink);
      }
    } catch (err) {
      console.error(err);
      window.prompt('Kopiera publik länken:', publicLink);
    }
  });

  container.querySelector('#toggle-public-qr-btn')?.addEventListener('click', () => {
    const isHidden = qrPanel?.classList.contains('hidden');
    if (!qrPanel || !qrImage) return;
    if (isHidden) {
      qrImage.src = getQrImageUrl(publicLink);
      qrPanel.classList.remove('hidden');
    } else {
      qrPanel.classList.add('hidden');
      qrImage.src = '';
    }
  });
}

function renderPage(container, competition, vm, publish) {
  const publicInfo = vm.publicInfo || {};
  const venueAddress = publicInfo.spectatorInfo?.venueAddress || competition.location || competition.place || '';
  const parkingAddress = publicInfo.spectatorInfo?.parkingAddress || '';
  const mapLink = vm.venueMap?.coordinates
    ? `https://www.google.com/maps/search/?api=1&query=${vm.venueMap.coordinates.lat},${vm.venueMap.coordinates.lng}`
    : venueAddress ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venueAddress)}` : null;
  const publicLink = getPublicCompetitionLink(competition);

  container.innerHTML = `
    <div class="container mx-auto p-3 sm:p-4 md:p-8 max-w-screen-xl">
      ${getCompetitionHeader(competition, 'Publik Info')}

      <section class="rounded-2xl border dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm mb-6">
        <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
          <div class="flex-1 text-sm md:text-base text-gray-700 dark:text-gray-300">
            ${publicInfo.introHtml
              ? `<div class="whitespace-pre-wrap">${escapeHtml(publicInfo.introHtml)}</div>`
              : '<div>Här hittar du publik information, klassöversikt, kartor och meddelanden för tävlingen.</div>'}
          </div>
          <div class="lg:w-[320px] rounded-2xl border dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 p-4">
            <div class="text-sm font-semibold text-gray-900 dark:text-white mb-2">Dela publik sida</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 break-all mb-3">${escapeHtml(publicLink)}</div>
            <div class="flex flex-col sm:flex-row sm:flex-wrap gap-2">
              <button type="button" id="copy-public-link-btn" class="inline-flex items-center justify-center rounded-full bg-brand-darkblue text-white px-4 py-2 text-sm font-semibold w-full sm:w-auto">
                Kopiera publik länk
              </button>
              <button type="button" id="toggle-public-qr-btn" class="inline-flex items-center justify-center rounded-full border border-brand-darkblue text-brand-darkblue dark:text-white px-4 py-2 text-sm font-semibold w-full sm:w-auto">
                Visa QR-kod
              </button>
            </div>
            <div id="competition-center-qr-panel" class="hidden mt-4 border-t dark:border-gray-700 pt-4">
              <img id="competition-center-qr-image" alt="QR-kod till publik sidan" class="w-44 h-44 max-w-full rounded-lg border dark:border-gray-700 bg-white p-2 mx-auto sm:mx-0">
              <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">Visa den här QR-koden på plats så att publik och anhöriga snabbt hittar sidan.</p>
            </div>
          </div>
        </div>
        ${mapLink ? `<div class="mt-4"><a href="${escapeHtml(sanitizeUrl(mapLink))}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center justify-center rounded-full bg-brand-darkblue text-white px-4 py-2 text-sm font-semibold w-full sm:w-auto">Öppna plats i Google Maps</a></div>` : ''}
      </section>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        <section class="lg:col-span-2 space-y-6">
          <div class="rounded-2xl border dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm">
            <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
              <div>
                <h2 class="text-xl font-semibold text-gray-900 dark:text-white">Hitta hit</h2>
                <p class="text-sm text-gray-500 dark:text-gray-400">Plats, karta och vägbeskrivning för publik.</p>
              </div>
              ${mapLink ? `<a href="${escapeHtml(sanitizeUrl(mapLink))}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center justify-center rounded-full bg-brand-darkblue text-white px-4 py-2 text-sm font-semibold whitespace-nowrap w-full sm:w-auto">Få vägbeskrivning</a>` : ''}
            </div>
            <div class="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-3 md:gap-4">
              <div>
                ${vm.venueMap?.coordinates
                  ? '<div id="competition-center-venue-map" class="h-72 rounded-xl border dark:border-gray-700 overflow-hidden"></div>'
                  : '<div class="h-72 rounded-xl border dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400 p-6 text-center">Ingen kartposition sparad ännu. Lägg till koordinater på tävlingen för att visa en publik karta här.</div>'}
              </div>
              <div class="space-y-4">
                <div class="rounded-xl bg-gray-50 dark:bg-gray-900/30 p-3 sm:p-4 border dark:border-gray-700">
                  <div class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Tävlingsplats</div>
                  <div class="font-semibold text-gray-900 dark:text-white">${escapeHtml(venueAddress || 'Ingen plats angiven')}</div>
                </div>
                ${parkingAddress ? `
                  <div class="rounded-xl bg-gray-50 dark:bg-gray-900/30 p-3 sm:p-4 border dark:border-gray-700">
                    <div class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Parkering</div>
                    <div class="font-semibold text-gray-900 dark:text-white">${escapeHtml(parkingAddress)}</div>
                  </div>
                ` : ''}
                ${publicInfo.spectatorInfo?.entrance ? `
                  <div class="rounded-xl bg-gray-50 dark:bg-gray-900/30 p-3 sm:p-4 border dark:border-gray-700">
                    <div class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Publikentré</div>
                    <div class="text-sm text-gray-700 dark:text-gray-300">${escapeHtml(publicInfo.spectatorInfo.entrance)}</div>
                  </div>
                ` : ''}
              </div>
            </div>
          </div>

          <div class="rounded-2xl border dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm">
            <h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-2">Tävlingsöversikt</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">Tryck på en klass för att se vilka hinder och gates den kör.</p>
            ${renderClassSummary(publish.classSummary === false ? [] : vm.classSummary)}
          </div>

          <div class="rounded-2xl border dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm">
            <h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-4">Dokument och kartor</h2>
            ${renderDocs((publish.documents === false && publish.maps === false) ? [] : vm.documents)}
          </div>
        </section>

        <aside class="space-y-6">
          <div class="rounded-2xl border dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm">
            <h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-4">Publika meddelanden</h2>
            ${renderMessages(publish.messages === false ? [] : vm.messages)}
          </div>

          <div class="rounded-2xl border dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm">
            <h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-4">Besöksinfo</h2>
            <div class="space-y-3 text-sm text-gray-600 dark:text-gray-300">
              ${publicInfo.spectatorInfo?.parking ? `<div><strong>Parkering:</strong> ${escapeHtml(publicInfo.spectatorInfo.parking)}</div>` : ''}
              ${publicInfo.spectatorInfo?.entrance ? `<div><strong>Entré:</strong> ${escapeHtml(publicInfo.spectatorInfo.entrance)}</div>` : ''}
              ${publicInfo.spectatorInfo?.kiosk ? `<div><strong>Kiosk:</strong> ${escapeHtml(publicInfo.spectatorInfo.kiosk)}</div>` : ''}
              ${publicInfo.spectatorInfo?.toilets ? `<div><strong>Toaletter:</strong> ${escapeHtml(publicInfo.spectatorInfo.toilets)}</div>` : ''}
              ${!publicInfo.spectatorInfo?.parking && !publicInfo.spectatorInfo?.entrance && !publicInfo.spectatorInfo?.kiosk && !publicInfo.spectatorInfo?.toilets ? '<p>Ingen extra besöksinformation publicerad ännu.</p>' : ''}
            </div>
          </div>
        </aside>
      </div>
    </div>
  `;

  bindClassToggles(container, competition, vm, publish);
  bindShareActions(container, competition);
  initVenueMap(vm.venueMap?.coordinates);
}

export async function load(container) {
  if (!container) return;

  const competition = getGlobalState('currentCompetition');
  if (!competition?.id) {
    renderEmpty(container, 'Ingen tävling vald', 'Välj en tävling i hubben först för att visa publik information.');
    return;
  }

  container.innerHTML = `
    <div class="container mx-auto p-4 md:p-8 max-w-screen-xl">
      ${getCompetitionHeader(competition, 'Publik Info')}
      <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border dark:border-gray-700 p-8 text-center">
        <div class="spinner mx-auto mb-3"></div>
        <p class="text-gray-600 dark:text-gray-300">Laddar publik information...</p>
      </div>
    </div>
  `;

  const vm = await getPublicCompetitionViewModel(competition);
  const publicInfo = vm.publicInfo || {};
  const publish = publicInfo.publish || {};

  if (publicInfo.enabled === false) {
    renderEmpty(container, competition.name || 'Publik info', 'Den publika informationssidan är inte aktiverad för denna tävling.');
    return;
  }

  renderPage(container, competition, vm, publish);
}

export function __unload() {
  destroyVenueMap();
}
