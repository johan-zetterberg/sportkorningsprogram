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

function getCompetitionPageLink(page, competition) {
  const id = encodeURIComponent(competition?.id || '');
  return `#${page}${id ? `?id=${id}` : ''}`;
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

function renderDocCards(docs, emptyMessage = 'Inga publicerade dokument ännu.') {
  if (!docs.length) {
    return `<p class="text-sm text-gray-500 dark:text-gray-400">${escapeHtml(emptyMessage)}</p>`;
  }

  return `
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      ${docs.map((doc) => `
        <div class="rounded-xl border dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
          <div class="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">${escapeHtml(doc.category || doc.type || 'Dokument')}</div>
          <div class="mt-1 font-semibold text-gray-900 dark:text-white">${escapeHtml(doc.title || 'Dokument')}</div>
          ${doc.url ? `<div class="mt-2"><a href="${escapeHtml(sanitizeUrl(doc.url))}" target="_blank" rel="noopener noreferrer" class="text-sm font-medium text-blue-700 dark:text-blue-300 hover:underline">Öppna dokument</a></div>` : ''}
          ${!doc.url && doc.content ? `<div class="mt-2 text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">${escapeHtml(doc.content)}</div>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

function renderDocs(documents, mapDocuments) {
  const mapIds = new Set(mapDocuments.map((doc) => doc.id));
  const regularDocuments = documents.filter((doc) => !mapIds.has(doc.id));

  return `
    <div class="space-y-4">
      <div>
        <div class="flex items-center justify-between gap-3 mb-2">
          <div>
            <h3 class="font-semibold text-gray-900 dark:text-white">Kartor och banskisser</h3>
            <p class="text-xs text-gray-500 dark:text-gray-400">Det här letar publik oftast efter först.</p>
          </div>
          <div class="rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200 px-2.5 py-1 text-[11px] font-semibold">
            ${mapDocuments.length}
          </div>
        </div>
        ${renderDocCards(mapDocuments, 'Inga kartor eller banskisser publicerade ännu.')}
      </div>
      <div class="border-t dark:border-gray-700 pt-4">
        <div class="flex items-center justify-between gap-3 mb-2">
          <div>
            <h3 class="font-semibold text-gray-900 dark:text-white">Övriga dokument</h3>
            <p class="text-xs text-gray-500 dark:text-gray-400">PM, texter och övrig publikinfo.</p>
          </div>
          <div class="rounded-full bg-gray-100 text-gray-700 dark:bg-gray-900/40 dark:text-gray-200 px-2.5 py-1 text-[11px] font-semibold">
            ${regularDocuments.length}
          </div>
        </div>
        ${renderDocCards(regularDocuments, 'Inga övriga dokument publicerade ännu.')}
      </div>
    </div>
  `;
}

function renderMessages(messages) {
  if (!messages.length) {
    return '<p class="text-sm text-gray-500 dark:text-gray-400">Inga publika meddelanden just nu.</p>';
  }

  return `
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
      ${messages.slice(0, 6).map((message) => `
        <article class="rounded-xl border dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
          <div class="font-semibold text-gray-900 dark:text-white">${escapeHtml(message.title || 'Information')}</div>
          <div class="mt-1 text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">${escapeHtml(message.body || message.message || '')}</div>
        </article>
      `).join('')}
    </div>
  `;
}

function renderHeroMessages(messages) {
  if (!messages.length) {
    return '<p class="text-[11px] text-gray-500 dark:text-gray-400">Inga nya publikmeddelanden just nu.</p>';
  }

  return `
    <div class="space-y-1.5">
      ${messages.slice(0, 2).map((message, index) => `
        <article class="rounded-lg border ${index === 0 ? 'border-amber-300 dark:border-amber-700/60 bg-amber-50/80 dark:bg-amber-900/15' : 'dark:border-gray-700 bg-white dark:bg-gray-800'} p-2">
          <div class="text-[10px] uppercase tracking-[0.18em] ${index === 0 ? 'text-amber-700 dark:text-amber-200' : 'text-gray-500 dark:text-gray-400'}">
            ${index === 0 ? 'Senaste nytt' : 'Info'}
          </div>
          <div class="mt-1 text-xs font-semibold text-gray-900 dark:text-white">${escapeHtml(message.title || 'Information')}</div>
          <div class="mt-0.5 text-[11px] text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-4">${escapeHtml(message.body || message.message || '')}</div>
        </article>
      `).join('')}
    </div>
  `;
}

function renderQuickFacts(vm, venueAddress, parkingAddress) {
  const classCount = vm.classSummary.length;
  const starterCount = vm.classSummary.reduce((sum, row) => sum + Number(row.starters || 0), 0);
  const mapCount = vm.mapDocuments.length;
  const docCount = vm.documents.length;

  const facts = [
    { label: 'Plats', value: venueAddress || 'Se karta nedan' },
    { label: 'Klasser', value: String(classCount) },
    { label: 'Starter', value: String(starterCount) },
    { label: parkingAddress ? 'Parkering' : 'Dokument', value: parkingAddress || `${docCount} st / ${mapCount} kartor` }
  ];

  return `
    <div class="flex flex-wrap gap-1.5">
      ${facts.map((fact) => `
        <div class="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md border dark:border-gray-700 bg-white/65 dark:bg-gray-900/20 px-2 py-1">
          <div class="text-[10px] uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400 shrink-0">${escapeHtml(fact.label)}</div>
          <div class="text-[11px] font-semibold text-gray-900 dark:text-white truncate">${escapeHtml(fact.value)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderQuickLinks(competition) {
  const links = [
    { label: 'Start', href: getCompetitionPageLink('starttider', competition) },
    { label: 'Deltagare', href: getCompetitionPageLink('deltagare', competition) },
    { label: 'Dressyr', href: getCompetitionPageLink('dressyr-results', competition) },
    { label: 'Maraton', href: getCompetitionPageLink('maraton-results', competition) },
    { label: 'Precision', href: getCompetitionPageLink('precision-results', competition) },
    { label: 'Totalt', href: getCompetitionPageLink('total-resultat', competition) }
  ];

  return `
    <div class="grid grid-cols-3 xl:grid-cols-6 gap-1.5">
      ${links.map((link) => `
        <a
          href="${escapeHtml(link.href)}"
          class="inline-flex items-center justify-center rounded-md border border-brand-darkblue/20 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5 text-[11px] font-semibold text-gray-900 dark:text-white hover:bg-blue-50 dark:hover:bg-gray-900/50 transition text-center"
        >
          ${escapeHtml(link.label)}
        </a>
      `).join('')}
    </div>
  `;
}

function renderVisitInfo(publicInfo) {
  const items = [
    publicInfo.spectatorInfo?.parking ? { label: 'Parkering', value: publicInfo.spectatorInfo.parking } : null,
    publicInfo.spectatorInfo?.entrance ? { label: 'Entré', value: publicInfo.spectatorInfo.entrance } : null,
    publicInfo.spectatorInfo?.kiosk ? { label: 'Kiosk', value: publicInfo.spectatorInfo.kiosk } : null,
    publicInfo.spectatorInfo?.toilets ? { label: 'Toaletter', value: publicInfo.spectatorInfo.toilets } : null
  ].filter(Boolean);

  if (!items.length) {
    return '<p class="text-sm text-gray-500 dark:text-gray-400">Ingen extra besöksinformation publicerad ännu.</p>';
  }

  return `
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
      ${items.map((item) => `
        <div class="rounded-lg border dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 px-3 py-2.5">
          <div class="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">${escapeHtml(item.label)}</div>
          <div class="mt-1 text-sm font-medium text-gray-900 dark:text-white">${escapeHtml(item.value)}</div>
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
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <div class="rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-800 p-2.5">
        <h3 class="font-semibold text-gray-900 dark:text-white mb-2 text-sm">Maraton</h3>
        <div class="space-y-1.5 text-xs text-gray-600 dark:text-gray-300">
          <div><strong>Körda hinder:</strong> ${obstacleText}</div>
          ${marathon.gateCount ? `<div><strong>Portar/hinder:</strong> ${marathon.gateCount}</div>` : ''}
          ${(marathon.distanceA || marathon.distanceB || marathon.distanceT) ? `<div><strong>Distanser:</strong> A ${marathon.distanceA || '-'} m, T ${marathon.distanceT || '-'} m, B ${marathon.distanceB || '-'} m</div>` : ''}
        </div>
      </div>
      <div class="rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-800 p-2.5">
        <h3 class="font-semibold text-gray-900 dark:text-white mb-2 text-sm">Precision</h3>
        <div class="space-y-1.5 text-xs text-gray-600 dark:text-gray-300">
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
    <div class="grid grid-cols-1 xl:grid-cols-2 gap-2.5">
      ${rows.map((row) => {
        const isOpen = expandedClasses.has(row.className);
        return `
          <article class="rounded-xl border dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 overflow-hidden">
            <button type="button" class="class-detail-toggle w-full text-left p-3" data-class-name="${escapeHtml(row.className)}">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0 flex-1">
                  <div class="font-semibold text-gray-900 dark:text-white text-base leading-5">${escapeHtml(row.className)}</div>
                  <div class="mt-1 inline-flex rounded-full bg-white dark:bg-gray-800 border dark:border-gray-700 px-2 py-0.5 text-[11px] text-gray-600 dark:text-gray-300">
                    ${row.starters} starter
                  </div>
                </div>
                <span class="inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${isOpen ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200' : 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}">
                  ${isOpen ? 'Dölj' : 'Visa'}
                </span>
              </div>
              <div class="grid grid-cols-3 gap-1.5 mt-2">
                <div class="rounded-lg bg-white dark:bg-gray-800 p-2 border dark:border-gray-700 min-w-0">
                  <div class="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Dressyr</div>
                  <div class="mt-0.5 text-[11px] font-medium text-gray-700 dark:text-gray-300 truncate">${escapeHtml(row.dressageWindow)}</div>
                </div>
                <div class="rounded-lg bg-white dark:bg-gray-800 p-2 border dark:border-gray-700 min-w-0">
                  <div class="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Maraton</div>
                  <div class="mt-0.5 text-[11px] font-medium text-gray-700 dark:text-gray-300 truncate">${escapeHtml(row.marathonWindow)}</div>
                </div>
                <div class="rounded-lg bg-white dark:bg-gray-800 p-2 border dark:border-gray-700 min-w-0">
                  <div class="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Precision</div>
                  <div class="mt-0.5 text-[11px] font-medium text-gray-700 dark:text-gray-300 truncate">${escapeHtml(row.precisionWindow)}</div>
                </div>
              </div>
            </button>
            ${isOpen ? `
              <div class="border-t dark:border-gray-700 p-3 bg-white dark:bg-gray-800">
                ${renderClassDetails(row)}
              </div>
            ` : ''}
          </article>
        `;
      }).join('')}
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
        showAlert('Publiklänken är kopierad.');
      } else {
        window.prompt('Kopiera publiklänken:', publicLink);
      }
    } catch (err) {
      console.error(err);
      window.prompt('Kopiera publiklänken:', publicLink);
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
  const publicMessages = publish.messages === false ? [] : vm.messages;
  const leadPublicMessages = publicMessages.slice(0, 2);
  const remainingPublicMessages = publicMessages.slice(2);
  const visibleDocuments = (publish.documents === false && publish.maps === false) ? [] : vm.documents;
  const visibleMapDocuments = publish.maps === false ? [] : vm.mapDocuments;

  container.innerHTML = `
    <div class="container mx-auto p-3 sm:p-4 md:p-8 max-w-screen-xl">
      ${getCompetitionHeader(competition, 'Publik Info')}

      <section class="rounded-2xl border dark:border-gray-700 bg-gradient-to-br from-white to-blue-50/70 dark:from-gray-800 dark:to-gray-900/80 p-3 shadow-sm mb-4 overflow-hidden">
        <div class="grid grid-cols-1 xl:grid-cols-[1.78fr_0.32fr] gap-2 items-start">
          <div class="space-y-2">
            <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-2">
              <div class="min-w-0 flex-1">
                <div class="inline-flex rounded-full bg-brand-darkblue text-white px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.18em]">Publikguide</div>
                <div class="mt-1 text-[13px] md:text-sm text-gray-700 dark:text-gray-300 leading-5">
                  ${publicInfo.introHtml
                    ? `<div class="whitespace-pre-wrap">${escapeHtml(publicInfo.introHtml)}</div>`
                    : '<div>Här hittar du tider, klassöversikt, karta och praktisk information.</div>'}
                </div>
              </div>
            </div>
            ${renderQuickFacts(vm, venueAddress, parkingAddress)}
            <div class="rounded-lg border dark:border-gray-700 bg-white/80 dark:bg-gray-900/30 p-2">
              <div class="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400 mb-1.5">Snabblänkar</div>
              ${renderQuickLinks(competition)}
            </div>
          </div>
          <div class="space-y-1.5">
            <div class="rounded-lg border dark:border-gray-700 bg-white/90 dark:bg-gray-900/35 p-2.5">
              <div class="flex items-center justify-between gap-3 mb-1.5">
                <div>
                  <h2 class="text-sm font-semibold text-gray-900 dark:text-white">Senaste info</h2>
                  <p class="text-[10px] text-gray-500 dark:text-gray-400">${leadPublicMessages.length} senaste</p>
                </div>
              </div>
              ${renderHeroMessages(leadPublicMessages)}
            </div>
            <div class="rounded-lg border dark:border-gray-700 bg-gray-50/85 dark:bg-gray-900/30 p-2.5">
              <div class="text-xs font-semibold text-gray-900 dark:text-white mb-1">Dela sida</div>
              <div class="text-[10px] text-gray-500 dark:text-gray-400 truncate mb-1.5" title="${escapeHtml(publicLink)}">${escapeHtml(publicLink)}</div>
              <div class="grid grid-cols-2 gap-1.5">
                <button type="button" id="copy-public-link-btn" class="inline-flex items-center justify-center rounded-md bg-brand-darkblue text-white px-2 py-1 text-[11px] font-semibold">
                  Kopiera
                </button>
                <button type="button" id="toggle-public-qr-btn" class="inline-flex items-center justify-center rounded-md border border-brand-darkblue text-brand-darkblue dark:text-white px-2 py-1 text-[11px] font-semibold">
                  QR
                </button>
              </div>
            </div>
            <div id="competition-center-qr-panel" class="hidden rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-800 p-2.5">
              <img id="competition-center-qr-image" alt="QR-kod till publiksidan" class="w-24 h-24 max-w-full rounded-lg border dark:border-gray-700 bg-white p-1.5 mx-auto">
              <p class="mt-1 text-[10px] text-gray-500 dark:text-gray-400 text-center">Visa på plats.</p>
            </div>
          </div>
        </div>
      </section>

      <section class="rounded-2xl border dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm mb-4">
        <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 mb-3">
          <div>
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Besöksinfo</h2>
            <p class="text-xs text-gray-500 dark:text-gray-400">Det här behöver publik och anhöriga veta på plats.</p>
          </div>
          ${mapLink ? `<a href="${escapeHtml(sanitizeUrl(mapLink))}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center justify-center rounded-full bg-brand-darkblue text-white px-3 py-1.5 text-xs font-semibold whitespace-nowrap w-full sm:w-auto">Vägbeskrivning</a>` : ''}
        </div>
        ${renderVisitInfo(publicInfo)}
      </section>

      ${remainingPublicMessages.length ? `
        <section class="rounded-2xl border dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm mb-6">
          <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-3">
            <div>
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Fler meddelanden</h2>
              <p class="text-xs text-gray-500 dark:text-gray-400">Tidigare utskick och extra information.</p>
            </div>
            <div class="rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200 px-2.5 py-1 text-[11px] font-semibold">
              ${remainingPublicMessages.length} till
            </div>
          </div>
          ${renderMessages(remainingPublicMessages)}
        </section>
      ` : ''}

      <div class="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-4 md:gap-6">
        <section class="space-y-6">
          <div class="rounded-2xl border dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-1.5">Tävlingsöversikt</h2>
            <p class="text-xs text-gray-500 dark:text-gray-400 mb-3">Tider per gren. Öppna detaljer vid behov.</p>
            ${renderClassSummary(publish.classSummary === false ? [] : vm.classSummary)}
          </div>

          <div class="rounded-2xl border dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-3">Dokument och kartor</h2>
            ${renderDocs(visibleDocuments, visibleMapDocuments)}
          </div>
        </section>

        <aside class="space-y-6">
          <div class="rounded-2xl border dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm">
            <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
              <div>
                <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Hitta hit</h2>
                <p class="text-xs text-gray-500 dark:text-gray-400">Plats, karta och vägbeskrivning.</p>
              </div>
            </div>
            <div class="space-y-3">
              ${vm.venueMap?.coordinates
                ? '<div id="competition-center-venue-map" class="h-72 rounded-xl border dark:border-gray-700 overflow-hidden"></div>'
                : '<div class="h-56 rounded-xl border dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400 p-6 text-center">Ingen kartposition sparad ännu. Lägg till koordinater på tävlingen för att visa en publik karta här.</div>'}
              <div class="grid grid-cols-1 gap-2">
                <div class="rounded-lg bg-gray-50 dark:bg-gray-900/30 p-3 border dark:border-gray-700">
                  <div class="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Tävlingsplats</div>
                  <div class="font-semibold text-gray-900 dark:text-white">${escapeHtml(venueAddress || 'Ingen plats angiven')}</div>
                </div>
                ${parkingAddress ? `
                  <div class="rounded-lg bg-gray-50 dark:bg-gray-900/30 p-3 border dark:border-gray-700">
                    <div class="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Parkeringsadress</div>
                    <div class="font-semibold text-gray-900 dark:text-white">${escapeHtml(parkingAddress)}</div>
                  </div>
                ` : ''}
              </div>
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
