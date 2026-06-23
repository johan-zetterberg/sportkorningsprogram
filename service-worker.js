// service-worker.js — modul-säker och loggande
const CACHE_NAME = 'driving-app-v32'; // Bump version to force cache clear

// Scope-aware absolut-URL-hjälpare
const SCOPE_PATH = new URL(self.registration.scope).pathname.replace(/\/+$/, '');
const abs = (p) => (SCOPE_PATH === '/' ? p : (SCOPE_PATH + (p.startsWith('/') ? p : '/' + p)));
const LOCAL_JS_SCOPE = SCOPE_PATH === '/' ? '/js/' : `${SCOPE_PATH}/js/`;
const MODULE_IMPORT_PATTERN = /(?:import\s+(?:[^'"]+?\s+from\s+)?|import\s*\()\s*['"]([^'"]+\.(?:js|mjs))['"]/g;
const MODULE_GRAPH_ENTRY_POINTS = [
  abs('/js/main.js')
];

function toCacheUrl(url) {
  return `${url.pathname}${url.search}`;
}

function resolveLocalModuleSpecifier(specifier, fromUrl) {
  try {
    const resolved = new URL(specifier, fromUrl);
    if (resolved.origin !== self.location.origin) return null;
    if (!resolved.pathname.startsWith(LOCAL_JS_SCOPE)) return null;
    return resolved;
  } catch {
    return null;
  }
}

async function discoverLocalModuleGraph(entryPoints) {
  const visited = new Set();
  const discovered = new Set();
  const queue = entryPoints
    .map((entry) => new URL(entry, self.location.origin).href);

  while (queue.length > 0) {
    const moduleHref = queue.shift();
    if (!moduleHref || visited.has(moduleHref)) continue;
    visited.add(moduleHref);

    try {
      const response = await fetch(moduleHref, { cache: 'no-cache' });
      if (!response.ok) {
        console.warn('[SW] Module graph fetch misslyckades:', moduleHref, response.status);
        continue;
      }

      const source = await response.text();
      discovered.add(toCacheUrl(new URL(moduleHref)));

      MODULE_IMPORT_PATTERN.lastIndex = 0;
      let match;
      while ((match = MODULE_IMPORT_PATTERN.exec(source)) !== null) {
        const resolved = resolveLocalModuleSpecifier(match[1], moduleHref);
        if (!resolved) continue;
        const resolvedHref = resolved.href;
        discovered.add(toCacheUrl(resolved));
        if (!visited.has(resolvedHref)) {
          queue.push(resolvedHref);
        }
      }
    } catch (error) {
      console.warn('[SW] Kunde inte analysera modul för precache:', moduleHref, error);
    }
  }

  return Array.from(discovered);
}

// === Precache ===
// Minsta nödvändiga + alla filer som monitor-sidan (och resultat) importerar
const urlsToCache = [
  abs('/index.html'),
  abs('/manifest.json'),
  abs('/favicon.ico'),
  abs('/favicon-16x16.png'),
  abs('/favicon-32x32.png'),
  abs('/icons/DriveLive_192.png'),
  abs('/icons/DriveLive_512.png'),
  abs('/js/config/firebase-config.js'),
  abs('/js/data/competitionData.js'),
  abs('/js/data/dressagePrograms.js'),
  abs('/js/main.js'),
  abs('/js/pages/admin/admin.js'),
  abs('/js/pages/admin/admin-clubs.js'),
  abs('/js/pages/admin/admin-communication.js'),
  abs('/js/pages/admin/admin-communication-view.js'),
  abs('/js/pages/admin/admin-officials.js'),
  abs('/js/pages/admin/admin-participants.js'),
  abs('/js/pages/admin/admin-settings.js'),
  abs('/js/pages/admin/admin-teams.js'),
  abs('/js/pages/admin/deltagare.js'),
  abs('/js/pages/admin/ekipage.js'),
  abs('/js/pages/admin/hastar.js'),
  abs('/js/pages/admin/starttider.js'),
  abs('/js/pages/dressage/dressyr-admin.js'),
  abs('/js/pages/dressage/dressyr-input.js'),
  abs('/js/pages/dressage/dressyr-monitor.js'),
  abs('/js/pages/dressage/dressyr-resultat.js'),
  abs('/js/pages/marathon/marathonResultControls.js'),
  abs('/js/pages/marathon/marathonResultData.js'),
  abs('/js/pages/marathon/marathonResultExports.js'),
  abs('/js/pages/marathon/marathonResultFormatters.js'),
  abs('/js/pages/marathon/marathonResultLiveTicker.js'),
  abs('/js/pages/marathon/marathonResultMobile.js'),
  abs('/js/pages/marathon/marathonResultRanking.js'),
  abs('/js/pages/marathon/marathonResultShell.js'),
  abs('/js/pages/marathon/marathonResultTable.js'),
  abs('/js/pages/marathon/marathonResultTiming.js'),
  abs('/js/pages/marathon/maraton-admin.js'),
  abs('/js/pages/marathon/maraton-input.js'),
  abs('/js/pages/marathon/maraton-monitor-map.js'),
  abs('/js/pages/marathon/maraton-monitor.js'),
  abs('/js/pages/marathon/maraton-resultat.js'),
  abs('/js/pages/marathon/maraton-stages-input.js'),
  abs('/js/pages/marathon/maraton-tider.js'),
  abs('/js/pages/marathon/observator-input.js'),
  abs('/js/pages/precision/precision-admin.js'),
  abs('/js/pages/precision/precision-input.js'),
  abs('/js/pages/precision/precision-monitor-map.js'),
  abs('/js/pages/precision/precision-monitor.js'),
  abs('/js/pages/precision/precision-resultat.js'),
  abs('/js/pages/shared/hub.js'),
  abs('/js/pages/shared/manual.js'),
  abs('/js/pages/shared/official.js'),
  abs('/js/pages/shared/portal.js'),
  abs('/js/pages/shared/prize-giving.js'),
  abs('/js/pages/shared/reports.js'),
  abs('/js/pages/shared/speaker.js'),
  abs('/js/pages/shared/total-resultat.js'),
  abs('/js/pages/shared/vagnbredd.js'),
  abs('/js/pages/shared/vet-check.js'),
  abs('/js/pages/shared/volunteer-signup.js'),
  abs('/js/pdf/pdfBase.js'),
  abs('/js/pdf/dressagePdf.js'),
  abs('/js/pdf/marathonPdf.js'),
  abs('/js/pdf/officialsReports.js'),
  abs('/js/pdf/precisionPdf.js'),
  abs('/js/pdf/startListPdf.js'),
  abs('/js/pdf/timecardsPdf.js'),
  abs('/js/pdf/totalResultsPdf.js'),
  abs('/js/pdf/teamResultsPdf.js'),
  abs('/js/services/archivingService.js'),
  abs('/js/services/authService.js'),
  abs('/js/services/calculationService.js'),
  abs('/js/services/firestoreService.js'),
  abs('/js/services/flagsService.js'),
  abs('/js/services/logosService.js'),
  abs('/js/services/navigationService.js'),
  abs('/js/services/officialsService.js'),
  abs('/js/services/resultAggregationService.js'),
  abs('/js/services/storageService.js'),
  abs('/js/services/syncService.js'),
  abs('/js/services/teamCalculationService.js'),
  abs('/js/services/themeService.js'),
  abs('/js/ui/components.js'),
  abs('/js/ui/dressageModal.js'),
  abs('/js/ui/equipage-modal.js'),
  abs('/js/ui/languageToggle.js'),
  abs('/js/ui/marathonModal.js'),
  abs('/js/ui/precisionModal.js'),
  abs('/js/ui/scrollHelper.js'),
  abs('/js/ui/syncQueue.js'),
  abs('/js/utils/dressageUtils.js'),
  abs('/js/utils/i18n.js'),
  abs('/js/utils/marathonUtils.js'),
  abs('/js/utils/precisionUtils.js'),
  abs('/js/utils/sharedUtils.js'),
  abs('/js/utils/simulator.js'),
  abs('/js/utils/wakeLock.js'),
  abs('/css/style.css'),
  abs('/assets/config/club-logos.json'),
  abs('/assets/dressage/501_Sv_l-tt_nr1_inomhus.pdf'),
  abs('/assets/dressage/503-_Svenskt_l-tt_nr_2_-ridhus-.pdf'),
  abs('/assets/dressage/505-_Svenskt_Msv_nr_1_-ridhus-.pdf'),
  abs('/assets/dressage/507-_Svenskt_sv-rt_nr_1_-ridhus-.pdf'),
  abs('/assets/dressage/509. FU FEI Dressage Test nr 4 (Test PE A).pdf'),
  abs('/assets/dressage/510. JYD FEI Dressage Test 4A (Test J_YD).pdf'),
  abs('/assets/dressage/518. FEI Dressage Senior 3 B HP4 40x100 20240209.pdf'),
  abs('/assets/dressage/518. FEI Dressage Senior 3 B HP4 40x80 20240315.pdf'),
  abs('/assets/dressage/522. Svenskt Lätt B (2020)  40x80m.pdf'),
  abs('/assets/dressage/523. Svenskt Lätt A (2020)  40x80m.pdf'),
  abs('/assets/dressage/524. Svenskt Msv  nr 3 (2020)  40x80m.pdf'),
  abs('/assets/dressage/527.FEI_Senior_Test__CAI2_HP2_HP4_80x40_2022.pdf'),
  abs('/assets/dressage/528.FEI_Senior_Test_CAI3_HP2_P4_80x40_2023.vers.16 juli 2023.pdf'),
  abs('/assets/dressage/529. FEI_Test__CAI1_and_Para_2022.pdf'),
  abs('/assets/dressage/530. Medelsvårt nr 4. 20250122.pdf'),
  abs('/assets/dressage/531. Junior Test 2025.doc.pdf'),
  abs('/assets/dressage/532. Test 3 H2-P2. 2025.pdf'),
  abs('/assets/dressage/533. Children Test 2025.pdf'),
  abs('/assets/dressage/534. Test 3 H4-P4.pdf'),
  abs('/assets/dressage/CAI1&CPEAI_21.12.2023.pdf'),
  abs('/assets/dressage/CAI2HP2_05.04.pdf'),
  abs('/assets/dressage/CAI2HP4_05.04.pdf'),
  abs('/assets/dressage/CAI3HP2_FINAL_0.pdf'),
  abs('/assets/dressage/CAI3HP4_05.04.pdf'),
  abs('/assets/dressage/Children Test_FINAL.pdf'),
  abs('/assets/dressage/Dressyrprogram översikt.pdf'),
  abs('/assets/dressage/Junior Test_FINAL.pdf'),
  abs('/assets/logos/Anebyortens_Ridklubb.png'),
  abs('/assets/logos/asbopk.png'),
  abs('/assets/logos/Blekinge_korsallskap.png'),
  abs('/assets/logos/Flyings_logo.svg'),
  abs('/assets/logos/Krika_HS.png'),
  abs('/assets/logos/KS_Nordhallaningarna.jpg'),
  abs('/assets/logos/KS_Nordhallaningarna.png'),
  abs('/assets/logos/Laholms_RF.svg'),
  abs('/assets/logos/Lenhovda_hastsportklubb.png'),
  abs('/assets/logos/markaryd_RF.png'),
  abs('/assets/logos/morrums_rf.png'),
  abs('/assets/logos/Naas_HS.png'),
  abs('/assets/logos/ostra_goinge_RF.png'),
  abs('/assets/logos/sigtuna.webp'),
  abs('/assets/logos/Skogsborgs.jpg'),
  abs('/assets/logos/SKS_logo.svg'),
  abs('/assets/logos/SRF.png'),
  abs('/assets/logos/SRF_logo_white.svg'),
  abs('/assets/logos/Suderbys_ridklubb.png'),
  abs('/assets/logos/Suderbys_ridklubb_2.png'),
  abs('/assets/logos/TIR_K_k.jpg'),
  abs('/assets/logos/Trolleholms_RF.png'),
  abs('/assets/logos/vfk-logotype-sv.svg'),
  abs('/lib/pdfjs/build/pdf.js'),
  abs('/lib/pdfjs/build/pdf.min.js'),
  abs('/lib/pdfjs/build/pdf.min.mjs'),
  abs('/lib/pdfjs/build/pdf.mjs'),
  abs('/lib/pdfjs/build/pdf.sandbox.min.mjs'),
  abs('/lib/pdfjs/build/pdf.sandbox.mjs'),
  abs('/lib/pdfjs/build/pdf.worker.min.js'),
  abs('/lib/pdfjs/build/pdf.worker.min.mjs'),
  abs('/lib/pdfjs/build/pdf.worker.mjs'),
  abs('/lib/jspdf.umd.min.js'),
  abs('/lib/jspdf.plugin.autotable.min.js'),
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js',
  'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js',
  'https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdn.tailwindcss.com'
];

// Separera interna (kritiska) filer från externa (som kan misslyckas utan att döda appen)
const internalUrls = urlsToCache.filter(u => !u.startsWith('http'));
const externalUrls = urlsToCache.filter(u => u.startsWith('http'));

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    console.log(`[SW] Installerar ${CACHE_NAME}. Interna: ${internalUrls.length}, Externa: ${externalUrls.length}`);

    let discoveredModuleUrls = [];
    try {
      discoveredModuleUrls = await discoverLocalModuleGraph(MODULE_GRAPH_ENTRY_POINTS);
      if (discoveredModuleUrls.length > 0) {
        console.log(`[SW] Upptäckte ${discoveredModuleUrls.length} lokala JS-moduler via import-grafen.`);
      }
    } catch (error) {
      console.warn('[SW] Modulgraf-precache misslyckades, fortsätter med statisk lista.', error);
    }

    // 1. Cacha alla interna filer "atomärt"
    try {
      const criticalInternalUrls = [
        abs('/index.html'),
        abs('/manifest.json'),
        abs('/js/main.js'),
        abs('/css/style.css')
      ];
      await cache.addAll(criticalInternalUrls);

      const optionalInternalUrls = Array.from(new Set([
        ...internalUrls.filter(url => !criticalInternalUrls.includes(url)),
        ...discoveredModuleUrls.filter(url => !criticalInternalUrls.includes(url))
      ]));
      const results = await Promise.allSettled(optionalInternalUrls.map(u => cache.add(u)));
      const failed = results
        .map((r, i) => ({ result: r, url: optionalInternalUrls[i] }))
        .filter(item => item.result.status === 'rejected');

      if (failed.length > 0) {
        console.warn(`[SW] ${failed.length} optional internal files could not be precached.`);
        failed.forEach(item => console.warn(`    -> Skipping: ${item.url}`, item.result.reason));
      } else {
        console.log('[SW] Interna filer cachade OK.');
      }
    } catch (e) {
      console.error('[SW] CRITICAL: Misslyckades med cache.addAll för interna filer. Avbryter installation.', e);
      const results = await Promise.allSettled(internalUrls.map(u => cache.add(u)));
      results.forEach((r, i) => {
        if (r.status === 'rejected') console.error(`    -> Fel på fil: ${internalUrls[i]}`, r.reason);
      });
      throw e;
    }

    // 2. Försök cacha externa filer (best effort)
    const results = await Promise.allSettled(externalUrls.map(async url => {
      // Specialhantering: Tailwind CDN måste hämtas med no-cors (opaque)
      const isOpaque = url.includes('tailwindcss');
      const mode = isOpaque ? 'no-cors' : 'cors';

      const req = new Request(url, { mode });
      const res = await fetch(req);

      // För cors-requests, kolla att svaret är OK
      if (mode === 'cors' && !res.ok) throw new Error(`Status ${res.status}`);

      return cache.put(req, res);
    }));

    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length > 0) {
      console.warn(`[SW] ${failed.length} externa filer misslyckades helt.`);
    } else {
      console.log('[SW] Alla externa filer cachade (inklusive Tailwind).');
    }

    await self.skipWaiting();
  })());
});



self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Ta bort gamla cacher
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));

    // Tvinga omedelbar kontroll över alla flikar
    await self.clients.claim();
    console.log('[SW] Aktiv och städad. Cache:', CACHE_NAME);
  })());
});

// Små hjälpare
const isJs = (req, url) => req.destination === 'script' || url.pathname.endsWith('.js') || url.pathname.endsWith('.mjs');
const isCss = (req, url) => req.destination === 'style' || url.pathname.endsWith('.css');

// Huvudstrategi
// Huvudstrategi
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1) Navigering: network-first med fallback till index.html
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        // console.log('[SW][NAV] network', url.pathname);
        return net;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(abs('/index.html'));
        if (cached) {
          console.warn('[SW][NAV] offline → index.html från cache');
          return cached;
        }
        console.error('[SW][NAV] CRITICAL: index.html saknas i cachen!');
        return Response.error();
      }
    })());
    return;
  }

  // 2) JS & moduler: network-first (cache som fallback) + skydd mot HTML-svar
  if (isJs(req, url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const net = await fetch(req, { cache: 'no-cache' });
        const ct = net.headers.get('content-type') || '';
        if (ct.includes('text/html')) {
          console.error('[SW][JS] VARNING: nätet returnerade HTML för', url.pathname, '— cachar EJ.');
          return net;
        }
        // Uppdatera cache i bakgrunden
        cache.put(req, net.clone()).catch(() => { });
        // console.log('[SW][JS] network', url.pathname);
        return net;
      } catch (e) {
        // 1. Strict match
        let cached = await cache.match(req);
        if (cached) {
          console.log('[SW][JS] cache hit for:', url.pathname);
          return cached;
        }

        // 2. Relaxed match (ignoreVary) - Ofta problemet med Live Server / olika headers
        cached = await cache.match(req, { ignoreVary: true });
        if (cached) {
          console.warn('[SW][JS] Relaxed cache hit (Vary Ignored) for:', url.pathname);
          return cached;
        }

        console.warn('[SW][JS] MISSING in cache:', url.pathname);
        console.warn('      Full URL:', url.href);
        // Felsökning: Logga vad som faktiskt finns i cachen om det är en viktig fil
        if (url.pathname.endsWith('reports.js')) {
          const keys = await cache.keys();
          console.log('      Cache keys example:', keys.slice(0, 5).map(k => new URL(k.url).pathname));
          console.log('      Total keys:', keys.length);
        }
        return new Response('/* offline */', { status: 503, headers: { 'content-type': 'application/javascript' } });
      }
    })());
    return;
  }

  // 3) CSS: stale-while-revalidate
  if (isCss(req, url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);

      const fetchPromise = fetch(req)
        .then(r => { cache.put(req, r.clone()).catch(() => { }); return r; })
        .catch(e => {
          console.warn('[SW][CSS] fetch misslyckades', e);
          return new Response('', { status: 503, statusText: 'Offline' });
        });

      if (cached) {
        // stale-while-revalidate i bakgrunden (låt den misslyckas tyst)
        fetchPromise.catch(() => { });
        return cached;
      }
      return fetchPromise;
    })());
    return;
  }
  // 4) Externa bilder: Cache-First
  const isExternalImage = url.hostname.includes('flagcdn.com') ||
    url.hostname.includes('firebasestorage.googleapis.com') ||
    url.hostname.includes('storage.googleapis.com');

  if (isExternalImage && req.method === 'GET') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        // Skapa en NY request för att garantera att inga gamla headers/credentials läcker igenom
        // Vi tvingar 'cors' och 'omit' för att matcha FlagCDN:s krav och tillåta caching
        const cleanReq = new Request(url.href, { mode: 'cors', credentials: 'omit', cache: 'no-cache' });
        const net = await fetch(cleanReq);
        if (net.ok) cache.put(req, net.clone()).catch(() => { });
        return net;
      } catch {
        return new Response('', { status: 404 });
      }
    })());
    return;
  }

  // 5) Annat: cache-first
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      return await fetch(req);
    } catch {
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
