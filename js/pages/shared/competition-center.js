import { getGlobalState } from '../../main.js';
import { getPublicCompetitionViewModel } from '../../services/publicCompetitionService.js';
import { getCompetitionHeader, showAlert } from '../../ui/components.js';
import { escapeHtml, safeLinkUrl } from '../../utils/sharedUtils.js';
import { t } from '../../utils/i18n.js';

let expandedClasses = new Set();
let venueMapInstance = null;
let venueMapObserver = null;


const sanitizeUrl = safeLinkUrl;

function displayOrDash(value) {
  const text = String(value ?? '').trim();
  return text || '-';
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

function renderDocCards(docs, emptyMessage = t('cc_no_documents')) {
  if (!docs.length) {
    return `<p class="text-sm text-gray-600 dark:text-gray-300">${escapeHtml(emptyMessage)}</p>`;
  }

  return `
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      ${docs.map((doc) => `
        <div class="rounded-xl border dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
          <div class="text-xs uppercase tracking-wide text-gray-600 dark:text-gray-300">${escapeHtml(doc.category || doc.type || t('cc_document'))}</div>
          <div class="mt-1 font-semibold text-gray-900 dark:text-white">${escapeHtml(doc.title || t('cc_document'))}</div>
          ${doc.url ? `<div class="mt-2"><a href="${escapeHtml(sanitizeUrl(doc.url))}" target="_blank" rel="noopener noreferrer" class="text-sm font-medium text-blue-700 dark:text-blue-300 hover:underline">${t('cc_open_document')}</a></div>` : ''}
          ${!doc.url && doc.content ? `<div class="mt-2 text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">${escapeHtml(doc.content)}</div>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

function renderDocs(documents, mapDocuments, publish = {}) {
  const showMaps = publish.maps !== false;
  const showDocuments = publish.documents !== false;
  const mapIds = new Set(mapDocuments.map((doc) => doc.id));
  const regularDocuments = documents.filter((doc) => !mapIds.has(doc.id));

  return `
    <div class="space-y-4">
      ${showMaps ? `<div>
        <div class="flex items-center justify-between gap-3 mb-2">
          <div>
            <h3 class="font-semibold text-gray-900 dark:text-white">${t('cc_maps_title')}</h3>
            <p class="text-xs text-gray-600 dark:text-gray-300">${t('cc_maps_hint')}</p>
          </div>
          <div class="rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200 px-2.5 py-1 text-xs font-semibold">
            ${mapDocuments.length}
          </div>
        </div>
        ${renderDocCards(mapDocuments, t('cc_no_maps'))}
      </div>` : ''}
      ${showDocuments ? `<div class="${showMaps ? 'border-t dark:border-gray-700 pt-4' : ''}">
        <div class="flex items-center justify-between gap-3 mb-2">
          <div>
            <h3 class="font-semibold text-gray-900 dark:text-white">${t('cc_other_documents')}</h3>
            <p class="text-xs text-gray-600 dark:text-gray-300">${t('cc_other_documents_hint')}</p>
          </div>
          <div class="rounded-full bg-gray-100 text-gray-700 dark:bg-gray-900/40 dark:text-gray-200 px-2.5 py-1 text-xs font-semibold">
            ${regularDocuments.length}
          </div>
        </div>
        ${renderDocCards(regularDocuments, t('cc_no_other_documents'))}
      </div>` : ''}
    </div>
  `;
}

function renderMessages(messages) {
  if (!messages.length) {
    return `<p class="text-sm text-gray-600 dark:text-gray-300">${t('cc_no_messages')}</p>`;
  }

  return `
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
      ${messages.slice(0, 6).map((message) => `
        <article class="rounded-xl border dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
          <div class="font-semibold text-gray-900 dark:text-white">${escapeHtml(message.title || t('cc_information'))}</div>
          <div class="mt-1 text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">${escapeHtml(message.body || message.message || '')}</div>
        </article>
      `).join('')}
    </div>
  `;
}

function renderHeroMessages(messages) {
  if (!messages.length) {
    return `<p class="rounded-lg border border-dashed dark:border-gray-700 bg-white/70 dark:bg-gray-900/20 p-3 text-sm text-gray-600 dark:text-gray-300">${t('cc_no_new_messages')}</p>`;
  }

  return `
    <div class="space-y-2">
      ${messages.slice(0, 2).map((message, index) => `
        <article class="rounded-xl border ${index === 0 ? 'border-amber-300 dark:border-amber-700/60 bg-amber-50/90 dark:bg-amber-900/15' : 'dark:border-gray-700 bg-white dark:bg-gray-800'} p-3">
          <div class="text-xs uppercase tracking-[0.18em] font-semibold ${index === 0 ? 'text-amber-700 dark:text-amber-200' : 'text-gray-600 dark:text-gray-300'}">
            ${index === 0 ? t('cc_latest_news') : t('cc_info_short')}
          </div>
          <div class="mt-1 text-sm font-semibold text-gray-900 dark:text-white">${escapeHtml(message.title || t('cc_information'))}</div>
          <div class="mt-1 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-5">${escapeHtml(message.body || message.message || '')}</div>
        </article>
      `).join('')}
    </div>
  `;
}

function renderAudienceActions(competition, mapLink, showDocumentsSection) {
  const safeMapLink = mapLink ? sanitizeUrl(mapLink) : null;
  const actions = [
    {
      label: t('cc_action_start_times'),
      description: t('cc_action_start_times_desc'),
      href: getCompetitionPageLink('starttider', competition),
      emphasis: true
    },
    {
      label: t('cc_action_results'),
      description: t('cc_action_results_desc'),
      href: getCompetitionPageLink('total-resultat', competition)
    },
    safeMapLink ? {
      label: t('cc_directions'),
      description: t('cc_open_map'),
      href: safeMapLink,
      external: true
    } : null,
    showDocumentsSection ? {
      label: t('cc_action_maps'),
      description: t('cc_action_maps_desc'),
      targetId: 'competition-center-documents'
    } : null
  ].filter(Boolean);

  return `
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
      ${actions.map((action) => {
        const linkClass = action.emphasis
          ? 'border-brand-darkblue bg-brand-darkblue text-white hover:bg-blue-950'
          : 'border-brand-darkblue/20 dark:border-gray-700 bg-white/90 dark:bg-gray-800 text-gray-900 dark:text-white hover:bg-blue-50 dark:hover:bg-gray-900/50';
        const descriptionClass = action.emphasis
          ? 'text-blue-100'
          : 'text-gray-600 dark:text-gray-300';
        const externalAttrs = action.external ? ' target="_blank" rel="noopener noreferrer"' : '';
        const content = `
          <div class="text-sm font-semibold">${escapeHtml(action.label)}</div>
          <div class="mt-0.5 text-xs ${descriptionClass}">${escapeHtml(action.description)}</div>
        `;
        if (action.targetId) {
          return `
            <button
              type="button"
              data-scroll-target="${escapeHtml(action.targetId)}"
              class="group rounded-xl border ${linkClass} px-3 py-3 text-left transition shadow-sm"
            >
              ${content}
            </button>
          `;
        }
        return `
          <a
            href="${escapeHtml(action.href)}"
            class="group rounded-xl border ${linkClass} px-3 py-3 text-left transition shadow-sm"
            ${externalAttrs}
          >
            ${content}
          </a>
        `;
      }).join('')}
    </div>
  `;
}

function renderSecondaryLinks(competition) {
  const links = [
    { label: t('cc_link_participants'), href: getCompetitionPageLink('deltagare', competition) },
    { label: t('dressage'), href: getCompetitionPageLink('dressyr-results', competition) },
    { label: t('marathon'), href: getCompetitionPageLink('maraton-results', competition) },
    { label: t('precision'), href: getCompetitionPageLink('precision-results', competition) }
  ];

  return `
    <div class="rounded-xl border dark:border-gray-700 bg-white/70 dark:bg-gray-900/25 p-3">
      <div class="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-600 dark:text-gray-300">${t('cc_more_views')}</div>
      <div class="flex flex-wrap gap-1.5">
        ${links.map((link) => `
          <a
            href="${escapeHtml(link.href)}"
            class="inline-flex items-center justify-center rounded-full border border-brand-darkblue/20 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs font-semibold text-gray-900 dark:text-white hover:bg-blue-50 dark:hover:bg-gray-900/50 transition"
          >
            ${escapeHtml(link.label)}
          </a>
        `).join('')}
      </div>
    </div>
  `;
}

function renderSharePanel(publicLink) {
  return `
    <div class="rounded-2xl border dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm">
      <h2 class="text-lg font-semibold text-gray-900 dark:text-white">${t('cc_share_title')}</h2>
      <p class="mt-1 text-xs text-gray-600 dark:text-gray-300">${t('cc_share_hint')}</p>
      <div class="mt-3 rounded-lg bg-gray-50 dark:bg-gray-900/30 p-3 border dark:border-gray-700">
        <div class="text-xs uppercase tracking-wide text-gray-600 dark:text-gray-300 mb-1">${t('cc_public_link')}</div>
        <div class="text-xs font-medium text-gray-900 dark:text-white break-all" title="${escapeHtml(publicLink)}">${escapeHtml(publicLink)}</div>
      </div>
      <div class="mt-3 grid grid-cols-2 gap-2">
        <button type="button" id="copy-public-link-btn" class="inline-flex items-center justify-center rounded-lg bg-brand-darkblue text-white px-3 py-2 text-xs font-semibold">
          ${t('cc_copy_link')}
        </button>
        <button type="button" id="toggle-public-qr-btn" class="inline-flex items-center justify-center rounded-lg border border-brand-darkblue text-brand-darkblue dark:text-white px-3 py-2 text-xs font-semibold">
          ${t('cc_show_qr')}
        </button>
      </div>
      <div id="competition-center-qr-panel" class="hidden mt-3 rounded-xl border dark:border-gray-700 bg-white dark:bg-gray-900/30 p-3">
        <img id="competition-center-qr-image" alt="${t('cc_qr_alt')}" loading="lazy" decoding="async" referrerpolicy="no-referrer" class="w-32 h-32 max-w-full rounded-lg border dark:border-gray-700 bg-white p-1.5 mx-auto">
        <p class="mt-2 text-xs text-gray-600 dark:text-gray-300 text-center">${t('cc_qr_hint')}</p>
      </div>
    </div>
  `;
}

function renderVisitInfo(publicInfo) {
  const items = [
    publicInfo.spectatorInfo?.parking ? { label: t('cc_parking'), marker: 'P', value: publicInfo.spectatorInfo.parking } : null,
    publicInfo.spectatorInfo?.entrance ? { label: t('cc_entrance'), marker: 'IN', value: publicInfo.spectatorInfo.entrance } : null,
    publicInfo.spectatorInfo?.kiosk ? { label: t('cc_kiosk'), marker: t('cc_kiosk_marker'), value: publicInfo.spectatorInfo.kiosk } : null,
    publicInfo.spectatorInfo?.toilets ? { label: t('cc_toilets'), marker: 'WC', value: publicInfo.spectatorInfo.toilets } : null
  ].filter(Boolean);

  if (!items.length) {
    return `<p class="text-sm text-gray-600 dark:text-gray-300">${t('cc_no_visit_info')}</p>`;
  }

  return `
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
      ${items.map((item) => `
        <div class="flex items-start gap-3 rounded-xl border dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 px-3 py-3">
          <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-darkblue/10 text-xs font-bold text-brand-darkblue dark:text-blue-100">${escapeHtml(item.marker)}</div>
          <div class="min-w-0">
            <div class="text-xs uppercase tracking-wide text-gray-600 dark:text-gray-300">${escapeHtml(item.label)}</div>
            <div class="mt-1 text-sm font-medium leading-5 text-gray-900 dark:text-white">${escapeHtml(item.value)}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderClassDetails(row) {
  const marathon = row.marathonDetails || {};
  const precision = row.precisionDetails || {};
  const obstacleText = (marathon.drivenObstacles || []).length
    ? marathon.drivenObstacles.map((obstacle) => escapeHtml(
      `#${displayOrDash(obstacle.number)}${obstacle.name ? ` ${obstacle.name}` : ''}${obstacle.gateCount ? ` (${obstacle.gateCount} ${t('cc_gates_lower')})` : ''}`
    )).join(', ')
    : t('cc_no_obstacle_info');
  const precisionGates = (precision.obstacleLabels || []).length
    ? precision.obstacleLabels.join(', ')
    : t('cc_no_gate_labels');

  return `
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <div class="rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-800 p-2.5">
        <h3 class="font-semibold text-gray-900 dark:text-white mb-2 text-sm">${t('marathon')}</h3>
        <div class="space-y-1.5 text-xs text-gray-600 dark:text-gray-300">
          <div><strong>${t('cc_driven_obstacles')}:</strong> ${obstacleText}</div>
          ${marathon.gateCount ? `<div><strong>${t('cc_gates_per_obstacle')}:</strong> ${escapeHtml(marathon.gateCount)}</div>` : ''}
          ${(marathon.distanceA || marathon.distanceB || marathon.distanceT) ? `<div><strong>${t('cc_distances')}:</strong> A ${escapeHtml(displayOrDash(marathon.distanceA))} m, T ${escapeHtml(displayOrDash(marathon.distanceT))} m, B ${escapeHtml(displayOrDash(marathon.distanceB))} m</div>` : ''}
        </div>
      </div>
      <div class="rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-800 p-2.5">
        <h3 class="font-semibold text-gray-900 dark:text-white mb-2 text-sm">${t('precision')}</h3>
        <div class="space-y-1.5 text-xs text-gray-600 dark:text-gray-300">
          <div><strong>${t('cc_precision_obstacles')}:</strong> ${escapeHtml(precisionGates)}</div>
          ${precision.trackLengthMeters ? `<div><strong>${t('cc_track_length')}:</strong> ${escapeHtml(precision.trackLengthMeters)} m</div>` : ''}
          ${precision.tempo ? `<div><strong>${t('cc_tempo')}:</strong> ${escapeHtml(precision.tempo)} m/min</div>` : ''}
        </div>
      </div>
    </div>
  `;
}

// formatPublicTimeWindow says 'Ej publicerad' when a discipline has no published times
function windowLabel(value) {
  return value === 'Ej publicerad' ? t('cc_not_published') : value;
}

function renderClassSummary(rows) {
  if (!rows.length) {
    return `<p class="text-sm text-gray-600 dark:text-gray-300">${t('cc_no_classes')}</p>`;
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
                  <div class="mt-1 inline-flex rounded-full bg-white dark:bg-gray-800 border dark:border-gray-700 px-2 py-0.5 text-xs text-gray-600 dark:text-gray-300">
                    ${row.starters} ${t('cc_starters')}
                  </div>
                </div>
                <span class="inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold ${isOpen ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200' : 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}">
                  ${isOpen ? t('cc_hide') : t('cc_show')}
                </span>
              </div>
              <div class="grid grid-cols-3 gap-1.5 mt-2">
                <div class="rounded-lg bg-white dark:bg-gray-800 p-2 border dark:border-gray-700 min-w-0">
                  <div class="text-xs uppercase tracking-wide text-gray-600 dark:text-gray-300">${t('dressage')}</div>
                  <div class="mt-0.5 text-xs font-medium text-gray-700 dark:text-gray-300 truncate">${escapeHtml(windowLabel(row.dressageWindow))}</div>
                </div>
                <div class="rounded-lg bg-white dark:bg-gray-800 p-2 border dark:border-gray-700 min-w-0">
                  <div class="text-xs uppercase tracking-wide text-gray-600 dark:text-gray-300">${t('marathon')}</div>
                  <div class="mt-0.5 text-xs font-medium text-gray-700 dark:text-gray-300 truncate">${escapeHtml(windowLabel(row.marathonWindow))}</div>
                </div>
                <div class="rounded-lg bg-white dark:bg-gray-800 p-2 border dark:border-gray-700 min-w-0">
                  <div class="text-xs uppercase tracking-wide text-gray-600 dark:text-gray-300">${t('precision')}</div>
                  <div class="mt-0.5 text-xs font-medium text-gray-700 dark:text-gray-300 truncate">${escapeHtml(windowLabel(row.precisionWindow))}</div>
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
    venueMapObserver?.disconnect();
  } catch {}
  venueMapObserver = null;

  try {
    venueMapInstance?.off();
    venueMapInstance?.remove();
  } catch {}
  venueMapInstance = null;
}

function initVenueMap(coordinates) {
  const mapEl = document.getElementById('competition-center-venue-map');
  if (!mapEl || coordinates?.lat == null || coordinates?.lng == null) return;
  if (typeof window.L === 'undefined') {
    mapEl.innerHTML = `
      <div class="flex h-full items-center justify-center bg-gray-50 dark:bg-gray-800 text-sm text-gray-500 dark:text-gray-300 px-4 text-center">
        ${t('cc_map_failed')}
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

function scheduleVenueMap(coordinates) {
  const mapEl = document.getElementById('competition-center-venue-map');
  if (!mapEl || coordinates?.lat == null || coordinates?.lng == null) return;

  if (typeof IntersectionObserver === 'undefined') {
    initVenueMap(coordinates);
    return;
  }

  venueMapObserver?.disconnect();
  venueMapObserver = new IntersectionObserver((entries) => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    venueMapObserver?.disconnect();
    venueMapObserver = null;
    initVenueMap(coordinates);
  }, { rootMargin: '240px 0px' });
  venueMapObserver.observe(mapEl);
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

function bindLocalScrollActions(container) {
  container.querySelectorAll('[data-scroll-target]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = document.getElementById(button.dataset.scrollTarget || '');
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        showAlert(t('cc_link_copied'));
      } else {
        window.prompt(t('cc_copy_prompt'), publicLink);
      }
    } catch (err) {
      console.error(err);
      window.prompt(t('cc_copy_prompt'), publicLink);
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
  destroyVenueMap();

  const publicInfo = vm.publicInfo || {};
  const venueAddress = publicInfo.spectatorInfo?.venueAddress || competition.location || competition.place || '';
  const mapLink = vm.venueMap?.coordinates
    ? `https://www.google.com/maps/search/?api=1&query=${vm.venueMap.coordinates.lat},${vm.venueMap.coordinates.lng}`
    : venueAddress ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venueAddress)}` : null;
  const publicLink = getPublicCompetitionLink(competition);
  const publicMessages = publish.messages === false ? [] : vm.messages;
  const leadPublicMessages = publicMessages.slice(0, 2);
  const remainingPublicMessages = publicMessages.slice(2);
  const showClassSummary = publish.classSummary !== false;
  const showDocumentsSection = publish.documents !== false || publish.maps !== false;
  const visibleMapDocuments = publish.maps === false ? [] : vm.mapDocuments;
  const visibleMapIds = new Set(vm.mapDocuments.map((doc) => doc.id));
  const visibleRegularDocuments = publish.documents === false
    ? []
    : vm.documents.filter((doc) => !visibleMapIds.has(doc.id));
  const visibleDocuments = [...visibleMapDocuments, ...visibleRegularDocuments];
  const classSummarySection = showClassSummary ? `
    <div id="competition-center-overview" class="rounded-2xl border dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm">
      <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-1.5">${t('cc_overview_title')}</h2>
      <p class="text-xs text-gray-600 dark:text-gray-300 mb-3">${t('cc_overview_hint')}</p>
      ${renderClassSummary(vm.classSummary)}
    </div>
  ` : '';
  const documentsSection = showDocumentsSection ? `
    <div id="competition-center-documents" class="rounded-2xl border dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm">
      <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-3">${t('cc_documents_title')}</h2>
      ${renderDocs(visibleDocuments, visibleMapDocuments, publish)}
    </div>
  ` : '';

  container.innerHTML = `
    <div class="container mx-auto p-3 sm:p-4 md:p-8 max-w-screen-xl">
      ${getCompetitionHeader(competition, t('cc_page_title'))}

      <section class="rounded-2xl border dark:border-gray-700 bg-gradient-to-br from-white to-blue-50/70 dark:from-gray-800 dark:to-gray-900/80 p-4 md:p-5 shadow-sm mb-4 overflow-hidden">
        <div class="grid grid-cols-1 lg:grid-cols-[1.18fr_0.82fr] gap-4 items-start">
          <div class="space-y-4">
            <div class="min-w-0">
              <div class="inline-flex rounded-full bg-brand-darkblue text-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]">${t('cc_guide_badge')}</div>
              <h2 class="mt-3 text-2xl md:text-3xl font-bold tracking-tight text-gray-950 dark:text-white">${t('cc_hero_title')}</h2>
              <div class="mt-2 max-w-2xl text-sm md:text-base text-gray-700 dark:text-gray-300 leading-6">
                ${publicInfo.introHtml
                  ? `<div class="whitespace-pre-wrap">${escapeHtml(publicInfo.introHtml)}</div>`
                  : `<div>${t('cc_hero_intro')}</div>`}
              </div>
            </div>
            ${renderAudienceActions(competition, mapLink, showDocumentsSection)}
            ${renderSecondaryLinks(competition)}
          </div>
          <div>
            <div class="rounded-2xl border border-amber-200 dark:border-amber-800/60 bg-white/90 dark:bg-gray-900/35 p-3 md:p-4 shadow-sm">
              <div class="flex items-start justify-between gap-3 mb-3">
                <div>
                  <h2 class="text-lg font-semibold text-gray-900 dark:text-white">${t('cc_latest_info')}</h2>
                  <p class="text-xs text-gray-600 dark:text-gray-300">${t('cc_latest_info_hint')}</p>
                </div>
                ${leadPublicMessages.length ? `
                  <div class="rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/35 dark:text-amber-100 px-2.5 py-1 text-xs font-semibold whitespace-nowrap">
                    ${leadPublicMessages.length} ${t('cc_new_count')}
                  </div>
                ` : ''}
              </div>
              ${renderHeroMessages(leadPublicMessages)}
            </div>
          </div>
        </div>
      </section>

      <section id="competition-center-visit" class="rounded-2xl border dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm mb-4">
        <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 mb-3">
          <div>
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">${t('cc_visit_title')}</h2>
            <p class="text-xs text-gray-600 dark:text-gray-300">${t('cc_visit_hint')}</p>
          </div>
          ${mapLink ? `<a href="${escapeHtml(sanitizeUrl(mapLink))}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center justify-center rounded-full bg-brand-darkblue text-white px-3 py-1.5 text-xs font-semibold whitespace-nowrap w-full sm:w-auto">${t('cc_directions')}</a>` : ''}
        </div>
        ${renderVisitInfo(publicInfo)}
      </section>

      ${remainingPublicMessages.length ? `
        <section class="rounded-2xl border dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm mb-6">
          <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-3">
            <div>
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">${t('cc_more_messages')}</h2>
              <p class="text-xs text-gray-600 dark:text-gray-300">${t('cc_more_messages_hint')}</p>
            </div>
            <div class="rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200 px-2.5 py-1 text-xs font-semibold">
              ${remainingPublicMessages.length} ${t('cc_more_count')}
            </div>
          </div>
          ${renderMessages(remainingPublicMessages)}
        </section>
      ` : ''}

      <div class="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-4 md:gap-6">
        <section class="space-y-6">
          ${classSummarySection}
          ${documentsSection}
        </section>

        <aside class="space-y-6">
          <div id="competition-center-map" class="rounded-2xl border dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm">
            <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
              <div>
                <h2 class="text-lg font-semibold text-gray-900 dark:text-white">${t('cc_find_us')}</h2>
                <p class="text-xs text-gray-600 dark:text-gray-300">${t('cc_find_us_hint')}</p>
              </div>
              ${mapLink ? `<a href="${escapeHtml(sanitizeUrl(mapLink))}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center justify-center rounded-full border border-brand-darkblue text-brand-darkblue dark:text-white px-3 py-1.5 text-xs font-semibold whitespace-nowrap">${t('cc_open_map')}</a>` : ''}
            </div>
            <div class="space-y-3">
              ${vm.venueMap?.coordinates
                ? '<div id="competition-center-venue-map" class="h-72 rounded-xl border dark:border-gray-700 overflow-hidden"></div>'
                : '<div class="h-56 rounded-xl border dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 flex items-center justify-center text-sm text-gray-600 dark:text-gray-300 p-6 text-center">' + t('cc_no_map_position') + '</div>'}
              <div class="grid grid-cols-1 gap-2">
                <div class="rounded-lg bg-gray-50 dark:bg-gray-900/30 p-3 border dark:border-gray-700">
                  <div class="text-xs uppercase tracking-wide text-gray-600 dark:text-gray-300 mb-1">${t('cc_venue')}</div>
                  <div class="font-semibold text-gray-900 dark:text-white">${escapeHtml(venueAddress || t('cc_no_venue'))}</div>
                </div>
              </div>
            </div>
          </div>
          ${renderSharePanel(publicLink)}
        </aside>
      </div>
    </div>
  `;

  bindClassToggles(container, competition, vm, publish);
  bindLocalScrollActions(container);
  bindShareActions(container, competition);
  scheduleVenueMap(vm.venueMap?.coordinates);
}

export async function load(container) {
  if (!container) return;

  const competition = getGlobalState('currentCompetition');
  if (!competition?.id) {
    renderEmpty(container, t('no_competition_selected'), t('cc_choose_competition'));
    return;
  }

  container.innerHTML = `
    <div class="container mx-auto p-4 md:p-8 max-w-screen-xl">
      ${getCompetitionHeader(competition, t('cc_page_title'))}
      <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border dark:border-gray-700 p-8 text-center">
        <div class="spinner mx-auto mb-3"></div>
        <p class="text-gray-600 dark:text-gray-300">${t('cc_loading')}</p>
      </div>
    </div>
  `;

  const vm = await getPublicCompetitionViewModel(competition);
  const publicInfo = vm.publicInfo || {};
  const publish = publicInfo.publish || {};

  if (publicInfo.enabled === false) {
    renderEmpty(container, competition.name || t('cc_page_title'), t('cc_not_enabled'));
    return;
  }

  renderPage(container, competition, vm, publish);
}

export function __unload() {
  destroyVenueMap();
}
