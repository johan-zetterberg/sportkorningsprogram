// service-worker.js — modul-säker och loggande
const CACHE_NAME = 'tavlingsappen-cache-v26'; // bumpa vid ändring

// Scope-aware absolut-URL-hjälpare
const SCOPE_PATH = new URL(self.registration.scope).pathname.replace(/\/+$/, '');
const abs = (p) => (SCOPE_PATH === '/' ? p : (SCOPE_PATH + (p.startsWith('/') ? p : '/' + p)));

// === Precache ===
// Minsta nödvändiga + alla filer som monitor-sidan (och resultat) importerar
const urlsToCache = [
  // Bas
  abs('/'),
  abs('/index.html'),
  abs('/manifest.json'),
  abs('/css/style.css'),
  abs('/js/main.js'),

  // Config & Data
  abs('/js/config/firebase-config.js'),
  abs('/js/data/competitionData.js'),
  abs('/js/data/dressagePrograms.js'),

  // Pages
  abs('/js/pages/admin-communication.js'),
  abs('/js/pages/admin.js'),
  abs('/js/pages/deltagare.js'),
  abs('/js/pages/dressyr-admin.js'),
  abs('/js/pages/dressyr-input.js'),
  abs('/js/pages/dressyr-monitor.js'),
  abs('/js/pages/dressyr-resultat.js'),
  abs('/js/pages/ekipage.js'),
  abs('/js/pages/hastar.js'),
  abs('/js/pages/hub.js'),
  abs('/js/pages/maraton-admin.js'),
  abs('/js/pages/maraton-input.js'),
  abs('/js/pages/maraton-monitor.js'),
  abs('/js/pages/maraton-resultat.js'),
  abs('/js/pages/maraton-stages-input.js'),
  abs('/js/pages/maraton-tider.js'),

  abs('/js/pages/observator-input.js'),
  abs('/js/pages/portal.js'),
  abs('/js/pages/precision-admin.js'),
  abs('/js/pages/precision-input.js'),
  abs('/js/pages/precision-monitor.js'),
  abs('/js/pages/precision-resultat.js'),
  abs('/js/pages/reports.js'),
  abs('/js/pages/speaker.js'),
  abs('/js/pages/starttider.js'),
  abs('/js/pages/total-resultat.js'),
  abs('/js/pages/vagnbredd.js'),

  // PDF Modules
  abs('/js/pdf/common-header.js'),
  abs('/js/pdf/core.js'),
  abs('/js/pdf/dressagePdf.js'),
  abs('/js/pdf/marathonPdf.js'),
  abs('/js/pdf/precisionPdf.js'),
  abs('/js/pdf/startListPdf.js'),
  abs('/js/pdf/totalResultsPdf.js'),

  // PDF.js (self-hostad)
  abs('/lib/pdfjs/build/pdf.mjs'),
  abs('/lib/pdfjs/build/pdf.worker.min.mjs'),

  // Services
  abs('/js/services/aggregateService.js'),
  abs('/js/services/resultAggregationService.js'),
  abs('/js/services/authService.js'),
  // abs('/js/services/calculationService.js'), // Removed
  abs('/js/services/finalizeService.js'),
  abs('/js/services/firestoreService.js'),
  abs('/js/services/flagsService.js'),
  abs('/js/services/logosService.js'),
  abs('/js/services/navigationService.js'),
  abs('/js/services/storageService.js'),

  // UI & Utils
  abs('/js/ui/components.js'),
  abs('/js/ui/dressageModal.js'),
  abs('/js/ui/equipage-modal.js'),
  abs('/js/ui/marathonModal.js'),
  abs('/js/ui/precisionModal.js'),
  abs('/js/ui/scrollHelper.js'),
  abs('/js/utils/dressageUtils.js'),
  abs('/js/utils/marathonUtils.js'),
  abs('/js/utils/precisionUtils.js'),
  abs('/js/utils/sharedUtils.js'),

  // Assets
  abs('/icons/DriveLive_192.png'),
  abs('/icons/DriveLive_512.png'),
  abs('/favicon.ico'),
  abs('/assets/logos/SRF.png'),

  // Externa bibliotek (Firebase & PDF & Excel & Tailwind)
  'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js',
  'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js',
  'https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdn.tailwindcss.com',
];




// Separera interna (kritiska) filer från externa (som kan misslyckas utan att döda appen)
const internalUrls = urlsToCache.filter(u => !u.startsWith('http'));
const externalUrls = urlsToCache.filter(u => u.startsWith('http'));



// ... (behåll SCOPE_PATH och abs) ...

// ... (behåll urlsToCache listan) ...

// ... (behåll internalUrls/externalUrls setup) ...

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    console.log(`[SW] Installerar ${CACHE_NAME}. Interna: ${internalUrls.length}, Externa: ${externalUrls.length}`);

    // 1. Cacha alla interna filer "atomärt"
    try {
      await cache.addAll(internalUrls);
      console.log('[SW] Interna filer cachade OK.');
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
      const fetchAndPut = fetch(req).then(r => { cache.put(req, r.clone()).catch(() => { }); return r; });
      if (cached) return cached;
      return fetchAndPut;
    })());
    return;
  }
  // 4) Externa bilder: Cache-First
  const isExternalImage = url.hostname.includes('flagcdn.com') ||
    url.hostname.includes('firebasestorage.googleapis.com') ||
    url.hostname.includes('storage.googleapis.com');

  if (isExternalImage) {
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
