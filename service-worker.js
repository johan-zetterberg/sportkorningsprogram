// service-worker.js — modul-säker och loggande
const CACHE_NAME = 'driving-app-v76'; // Bump version to force cache clear

// Scope-aware absolut-URL-hjälpare
const SCOPE_PATH = new URL(self.registration.scope).pathname.replace(/\/+$/, '');
const abs = (p) => (SCOPE_PATH === '/' ? p : (SCOPE_PATH + (p.startsWith('/') ? p : '/' + p)));
const LOCAL_JS_SCOPE = SCOPE_PATH === '/' ? '/js/' : `${SCOPE_PATH}/js/`;
// Static imports and plain import('...') calls: the pages are loaded with
// import() from navigationService, and must be cached for an offline start
const MODULE_IMPORT_PATTERN = /\bimport\s*(?:\(\s*|(?:[\w*\s{},]+)\s+from\s+)?['"]([^'"]+\.(?:js|mjs))['"]/g;

// How long a request waits for the network before a cached copy is used. On a
// weak but "connected" link a fetch can hang for a long time, and a reload in
// the field would look frozen
const NETWORK_TIMEOUT_MS = 3000;
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
  abs('/android-chrome-192x192.png'),
  abs('/android-chrome-512x512.png'),
  abs('/apple-touch-icon.png'),
  abs('/assets/config/club-logos.json'),
  abs('/assets/dressage/05 TR V 2025 Sportkörning.md'),
  abs('/assets/dressage/05 TR V 2025 Sportkörning.pdf'),
  abs('/assets/dressage/501_Sv_l-tt_nr1_inomhus.md'),
  abs('/assets/dressage/501_Sv_l-tt_nr1_inomhus.pdf'),
  abs('/assets/dressage/503-_Svenskt_l-tt_nr_2_-ridhus-.md'),
  abs('/assets/dressage/503-_Svenskt_l-tt_nr_2_-ridhus-.pdf'),
  abs('/assets/dressage/505-_Svenskt_Msv_nr_1_-ridhus-.md'),
  abs('/assets/dressage/505-_Svenskt_Msv_nr_1_-ridhus-.pdf'),
  abs('/assets/dressage/507-_Svenskt_sv-rt_nr_1_-ridhus-.md'),
  abs('/assets/dressage/507-_Svenskt_sv-rt_nr_1_-ridhus-.pdf'),
  abs('/assets/dressage/509. FU FEI Dressage Test nr 4 (Test PE A).md'),
  abs('/assets/dressage/509. FU FEI Dressage Test nr 4 (Test PE A).pdf'),
  abs('/assets/dressage/510. JYD FEI Dressage Test 4A (Test J_YD).md'),
  abs('/assets/dressage/510. JYD FEI Dressage Test 4A (Test J_YD).pdf'),
  abs('/assets/dressage/518. FEI Dressage Senior 3 B HP4 40x100 20240209.md'),
  abs('/assets/dressage/518. FEI Dressage Senior 3 B HP4 40x100 20240209.pdf'),
  abs('/assets/dressage/518. FEI Dressage Senior 3 B HP4 40x80 20240315.md'),
  abs('/assets/dressage/518. FEI Dressage Senior 3 B HP4 40x80 20240315.pdf'),
  abs('/assets/dressage/522. Svenskt Lätt B (2020)  40x80m.md'),
  abs('/assets/dressage/522. Svenskt Lätt B (2020)  40x80m.pdf'),
  abs('/assets/dressage/523. Svenskt Lätt A (2020)  40x80m.md'),
  abs('/assets/dressage/523. Svenskt Lätt A (2020)  40x80m.pdf'),
  abs('/assets/dressage/524. Svenskt Msv  nr 3 (2020)  40x80m.md'),
  abs('/assets/dressage/524. Svenskt Msv  nr 3 (2020)  40x80m.pdf'),
  abs('/assets/dressage/527.FEI_Senior_Test__CAI2_HP2_HP4_80x40_2022.md'),
  abs('/assets/dressage/527.FEI_Senior_Test__CAI2_HP2_HP4_80x40_2022.pdf'),
  abs('/assets/dressage/528.FEI_Senior_Test_CAI3_HP2_P4_80x40_2023.vers.16 juli 2023.md'),
  abs('/assets/dressage/528.FEI_Senior_Test_CAI3_HP2_P4_80x40_2023.vers.16 juli 2023.pdf'),
  abs('/assets/dressage/529. FEI_Test__CAI1_and_Para_2022.md'),
  abs('/assets/dressage/529. FEI_Test__CAI1_and_Para_2022.pdf'),
  abs('/assets/dressage/530. Medelsvårt nr 4. 20250122.md'),
  abs('/assets/dressage/530. Medelsvårt nr 4. 20250122.pdf'),
  abs('/assets/dressage/531. Junior Test 2025.doc.md'),
  abs('/assets/dressage/531. Junior Test 2025.doc.pdf'),
  abs('/assets/dressage/532. Test 3 H2-P2. 2025.md'),
  abs('/assets/dressage/532. Test 3 H2-P2. 2025.pdf'),
  abs('/assets/dressage/533. Children Test 2025.md'),
  abs('/assets/dressage/533. Children Test 2025.pdf'),
  abs('/assets/dressage/534. Test 3 H4-P4.md'),
  abs('/assets/dressage/534. Test 3 H4-P4.pdf'),
  abs('/assets/dressage/CAI1&CPEAI_21.12.2023.md'),
  abs('/assets/dressage/CAI1&CPEAI_21.12.2023.pdf'),
  abs('/assets/dressage/CAI2HP2_05.04.md'),
  abs('/assets/dressage/CAI2HP2_05.04.pdf'),
  abs('/assets/dressage/CAI2HP4_05.04.md'),
  abs('/assets/dressage/CAI2HP4_05.04.pdf'),
  abs('/assets/dressage/CAI3HP2_FINAL_0.md'),
  abs('/assets/dressage/CAI3HP2_FINAL_0.pdf'),
  abs('/assets/dressage/CAI3HP4_05.04.md'),
  abs('/assets/dressage/CAI3HP4_05.04.pdf'),
  abs('/assets/dressage/Children Test_FINAL.md'),
  abs('/assets/dressage/Children Test_FINAL.pdf'),
  abs('/assets/dressage/Dressyrprogram översikt.md'),
  abs('/assets/dressage/Dressyrprogram översikt.pdf'),
  abs('/assets/dressage/Junior Test_FINAL.md'),
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
  abs('/assets/logos/SRF_logo_white.svg'),
  abs('/assets/logos/SRF.png'),
  abs('/assets/logos/Suderbys_ridklubb_2.png'),
  abs('/assets/logos/Suderbys_ridklubb.png'),
  abs('/assets/logos/TIR_K_k.jpg'),
  abs('/assets/logos/Trolleholms_RF.png'),
  abs('/assets/logos/vfk-logotype-sv.svg'),
  abs('/css/style.css'),
  abs('/css/tailwind.css'),
  abs('/css/tailwind.input.css'),
  abs('/favicon-16x16.png'),
  abs('/favicon-32x32.png'),
  abs('/favicon.ico'),
  abs('/icons/DriveLive_192.png'),
  abs('/icons/DriveLive_512.png'),
  abs('/img/marathon-course-new.png'),
  abs('/index.html'),
  abs('/js/config/firebase-config.js'),
  abs('/js/core-engine/calculation.js'),
  abs('/js/core-engine/dressage.js'),
  abs('/js/core-engine/marathon.js'),
  abs('/js/core-engine/precision.js'),
  abs('/js/core-engine/ranking.js'),
  abs('/js/core-engine/rules-ledger.js'),
  abs('/js/core-engine/stateSelector.js'),
  abs('/js/core-engine/version.js'),
  abs('/js/data/competitionData.js'),
  abs('/js/data/dressagePrograms.js'),
  abs('/js/main.js'),
  abs('/js/pages/admin/admin-clubs.js'),
  abs('/js/pages/admin/admin-communication-view.js'),
  abs('/js/pages/admin/admin-communication.js'),
  abs('/js/pages/admin/admin-officials.js'),
  abs('/js/pages/admin/admin-participants.js'),
  abs('/js/pages/admin/admin-settings.js'),
  abs('/js/pages/admin/admin-teams.js'),
  abs('/js/pages/admin/admin.js'),
  abs('/js/pages/admin/adminArchivingUiUtils.js'),
  abs('/js/pages/admin/adminJudgeRoleUtils.js'),
  abs('/js/pages/admin/adminOfficialDateUtils.js'),
  abs('/js/pages/admin/adminOfficialsXmlImport.js'),
  abs('/js/pages/admin/adminParticipantClassManager.js'),
  abs('/js/pages/admin/adminParticipantClassUtils.js'),
  abs('/js/pages/admin/adminParticipantEquipageFormFields.js'),
  abs('/js/pages/admin/adminParticipantEquipageTable.js'),
  abs('/js/pages/admin/adminParticipantHorseFields.js'),
  abs('/js/pages/admin/adminParticipantImportForm.js'),
  abs('/js/pages/admin/adminParticipantImportFormUtils.js'),
  abs('/js/pages/admin/adminParticipantJudges.js'),
  abs('/js/pages/admin/adminParticipantMergePanels.js'),
  abs('/js/pages/admin/adminParticipantMergeUtils.js'),
  abs('/js/pages/admin/adminParticipantXmlImport.js'),
  abs('/js/pages/admin/adminParticipantXmlValueUtils.js'),
  abs('/js/pages/admin/adminXmlUtils.js'),
  abs('/js/pages/admin/deltagare.js'),
  abs('/js/pages/admin/ekipage.js'),
  abs('/js/pages/admin/hastar.js'),
  abs('/js/pages/admin/starttider.js'),
  abs('/js/pages/admin/starttiderUtils.js'),
  abs('/js/pages/dressage/dressageAdminProgramOptions.js'),
  abs('/js/pages/dressage/dressageMonitorFormatUtils.js'),
  abs('/js/pages/dressage/dressageResultBridge.js'),
  abs('/js/pages/dressage/dressageResultBuilder.js'),
  abs('/js/pages/dressage/dressageResultExports.js'),
  abs('/js/pages/dressage/dressageResultExportUtils.js'),
  abs('/js/pages/dressage/dressageResultRanking.js'),
  abs('/js/pages/dressage/dressyr-admin.js'),
  abs('/js/pages/dressage/dressyr-input.js'),
  abs('/js/pages/dressage/dressyr-monitor.js'),
  abs('/js/pages/dressage/dressyr-resultat.js'),
  abs('/js/pages/marathon/marathonAdminValidation.js'),
  abs('/js/pages/marathon/marathonObstacleOwnership.js'),
  abs('/js/pages/marathon/marathonObstaclePlacings.js'),
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
  abs('/js/pages/marathon/maratonTiderPdfUtils.js'),
  abs('/js/pages/marathon/maratonTiderUtils.js'),
  abs('/js/pages/marathon/observator-input.js'),
  abs('/js/pages/precision/precision-admin.js'),
  abs('/js/pages/precision/precision-input.js'),
  abs('/js/pages/precision/precision-monitor-map.js'),
  abs('/js/pages/precision/precision-monitor.js'),
  abs('/js/pages/precision/precision-resultat.js'),
  abs('/js/pages/precision/precision-split-input.js'),
  abs('/js/pages/precision/precisionAdminValidation.js'),
  abs('/js/pages/precision/precisionMonitorFormatUtils.js'),
  abs('/js/pages/precision/precisionResultDesktopRow.js'),
  abs('/js/pages/precision/precisionResultExportUtils.js'),
  abs('/js/pages/precision/precisionResultFilters.js'),
  abs('/js/pages/precision/precisionResultFinalize.js'),
  abs('/js/pages/precision/precisionResultListeners.js'),
  abs('/js/pages/precision/precisionResultLive.js'),
  abs('/js/pages/precision/precisionResultLivePanel.js'),
  abs('/js/pages/precision/precisionResultMerge.js'),
  abs('/js/pages/precision/precisionResultMobileCard.js'),
  abs('/js/pages/precision/precisionResultSort.js'),
  abs('/js/pages/precision/precisionResultTable.js'),
  abs('/js/pages/secretariat/secretariat-dressage.js'),
  abs('/js/pages/secretariat/secretariat-marathon.js'),
  abs('/js/pages/secretariat/secretariat-precision.js'),
  abs('/js/pages/secretariat/secretariat-shared.js'),
  abs('/js/pages/shared/archivedResults.js'),
  abs('/js/pages/shared/competition-center.js'),
  abs('/js/pages/shared/horseTemperatureUtils.js'),
  abs('/js/pages/shared/hub.js'),
  abs('/js/pages/shared/manual.js'),
  abs('/js/pages/shared/official.js'),
  abs('/js/pages/shared/portal.js'),
  abs('/js/pages/shared/portalDataUtils.js'),
  abs('/js/pages/shared/portalResultFormatUtils.js'),
  abs('/js/pages/shared/prize-giving.js'),
  abs('/js/pages/shared/prizeGivingUtils.js'),
  abs('/js/pages/shared/reports.js'),
  abs('/js/pages/shared/reportsExportUtils.js'),
  abs('/js/pages/shared/speaker.js'),
  abs('/js/pages/shared/speakerCalculations.js'),
  abs('/js/pages/shared/speakerCalculationUtils.js'),
  abs('/js/pages/shared/speakerFormatUtils.js'),
  abs('/js/pages/shared/speakerHelpers.js'),
  abs('/js/pages/shared/speakerLists.js'),
  abs('/js/pages/shared/speakerMarathon.js'),
  abs('/js/pages/shared/speakerMarathonActiveState.js'),
  abs('/js/pages/shared/speakerRecentUtils.js'),
  abs('/js/pages/shared/speakerResults.js'),
  abs('/js/pages/shared/speakerState.js'),
  abs('/js/pages/shared/speakerStateUtils.js'),
  abs('/js/pages/shared/speakerTimer.js'),
  abs('/js/pages/shared/total-resultat.js'),
  abs('/js/pages/shared/totalResultCsv.js'),
  abs('/js/pages/shared/totalResultDisplayUtils.js'),
  abs('/js/pages/shared/totalResultGrouping.js'),
  abs('/js/pages/shared/totalResultListeners.js'),
  abs('/js/pages/shared/totalResultRanking.js'),
  abs('/js/pages/shared/totalResultRows.js'),
  abs('/js/pages/shared/totalResultTeams.js'),
  abs('/js/pages/shared/vagnbredd.js'),
  abs('/js/pages/shared/vagnbreddUtils.js'),
  abs('/js/pages/shared/vet-check.js'),
  abs('/js/pages/shared/vetCheckUtils.js'),
  abs('/js/pages/shared/volunteer-signup.js'),
  abs('/js/pdf/dressagePdf.js'),
  abs('/js/pdf/marathonPdf.js'),
  abs('/js/pdf/marathonPdfRows.js'),
  abs('/js/pdf/officialsReports.js'),
  abs('/js/pdf/officialsReportUtils.js'),
  abs('/js/pdf/pdfBase.js'),
  abs('/js/pdf/pdfCompetitionUtils.js'),
  abs('/js/pdf/pdfImageUtils.js'),
  abs('/js/pdf/precisionPdf.js'),
  abs('/js/pdf/quickGuidePdf.js'),
  abs('/js/pdf/resultPdfFormatUtils.js'),
  abs('/js/pdf/startListPdf.js'),
  abs('/js/pdf/startListPdfRows.js'),
  abs('/js/pdf/teamResultsPdf.js'),
  abs('/js/pdf/teamResultsPdfUtils.js'),
  abs('/js/pdf/timecardsPdf.js'),
  abs('/js/pdf/totalResultsPdf.js'),
  abs('/js/pdf/totalResultsPdfUtils.js'),
  abs('/js/pdf/vetCheckPdf.js'),
  abs('/js/pdf/vetCheckPdfUtils.js'),
  abs('/js/services/adminService.js'),
  abs('/js/services/archiveRowBuilder.js'),
  abs('/js/services/archivingService.js'),
  abs('/js/services/archivingUtils.js'),
  abs('/js/services/authService.js'),
  abs('/js/services/calculationService.js'),
  abs('/js/services/competitionService.js'),
  abs('/js/services/competitionSettingsStore.js'),
  abs('/js/services/competitionStatusService.js'),
  abs('/js/services/demoCompetitionData.js'),
  abs('/js/services/demoCompetitionService.js'),
  abs('/js/services/documentService.js'),
  abs('/js/services/dressageService.js'),
  abs('/js/services/equipageService.js'),
  abs('/js/services/feiStartOrderService.js'),
  abs('/js/services/finalizationService.js'),
  abs('/js/services/firestoreService.js'),
  abs('/js/services/flagsService.js'),
  abs('/js/services/listenerErrorUtils.js'),
  abs('/js/services/logosService.js'),
  abs('/js/services/marathonService.js'),
  abs('/js/services/navigationLifecycleUtils.js'),
  abs('/js/services/navigationService.js'),
  abs('/js/services/officialPrivacyUtils.js'),
  abs('/js/services/officialsService.js'),
  abs('/js/services/precisionService.js'),
  abs('/js/services/publicCompetitionService.js'),
  abs('/js/services/publicCompetitionUtils.js'),
  abs('/js/services/resultAggregationService.js'),
  abs('/js/services/resultMaintenanceService.js'),
  abs('/js/services/secretariatPatchUtils.js'),
  abs('/js/services/secretariatService.js'),
  abs('/js/services/storageService.js'),
  abs('/js/services/syncService.js'),
  abs('/js/services/teamCalculationService.js'),
  abs('/js/services/teamRuleProfiles.js'),
  abs('/js/services/teamService.js'),
  abs('/js/services/themeService.js'),
  abs('/js/ui/components.js'),
  abs('/js/ui/dressageModal.js'),
  abs('/js/ui/equipage-modal.js'),
  abs('/js/ui/judgeMappingNotice.js'),
  abs('/js/ui/languageToggle.js'),
  abs('/js/ui/marathonModal.js'),
  abs('/js/ui/precisionModal.js'),
  abs('/js/ui/quickGuideDrawer.js'),
  abs('/js/ui/resultSettingsNotice.js'),
  abs('/js/ui/scrollHelper.js'),
  abs('/js/ui/syncQueue.js'),
  abs('/js/utils/competitionLogo.js'),
  abs('/js/utils/dressageUtils.js'),
  abs('/js/utils/fieldBackup.js'),
  abs('/js/utils/i18n.js'),
  abs('/js/utils/marathonExportUtils.js'),
  abs('/js/utils/marathonUtils.js'),
  abs('/js/utils/offlineWrite.js'),
  abs('/js/utils/precisionCalculation.js'),
  abs('/js/utils/precisionUtils.js'),
  abs('/js/utils/serverClock.js'),
  abs('/js/utils/sharedUtils.js'),
  abs('/js/utils/simulator.js'),
  abs('/js/utils/wakeLock.js'),
  abs('/lib/jspdf.plugin.autotable.min.js'),
  abs('/lib/jspdf.umd.min.js'),
  abs('/lib/pdfjs/build/pdf.min.mjs'),
  abs('/lib/pdfjs/build/pdf.worker.min.mjs'),
  abs('/manifest.json'),
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
// Libraries the app cannot start without (the Firebase SDK) or that the maps
// need: precached, so the app also starts without signal after an update
const externalUrls = [
  'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js',
  'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js',
  'https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js',
  'https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  // Icons: the stylesheet and the two fonts the pages use (solid, regular)
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/webfonts/fa-solid-900.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/webfonts/fa-regular-400.woff2'
];

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
        abs('/css/tailwind.css'),
        abs('/css/style.css')
      ];
      // Revalidate with the server: the browser's HTTP cache may hold files
      // from the previous deploy, and old and new modules must never be mixed
      const fresh = (u) => new Request(u, { cache: 'no-cache' });
      await cache.addAll(criticalInternalUrls.map(fresh));

      // Not the heavy files (the dressage tests as PDF, the PDF reader's
      // worker: about 10 MB): every deploy installs a new version, and they
      // would be fetched again each time. They are cached when first used.
      const isHeavyStatic = (url) => /\.pdf$/i.test(url) || /\/lib\/pdfjs\/build\/pdf\.worker/i.test(url);
      const optionalInternalUrls = Array.from(new Set(
        [...internalUrls, ...discoveredModuleUrls].filter(url => !criticalInternalUrls.includes(url) && !isHeavyStatic(url))
      ));
      const results = await Promise.allSettled(optionalInternalUrls.map(u => cache.add(fresh(u))));
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
    // Before deleting the old caches, keep what this version did not fetch
    // itself from other sites (libraries, fonts, flags, logos): a device that
    // installed the update with poor signal would otherwise lose them. The
    // app's own files are not carried over, old and new modules must not mix
    const keys = await caches.keys();
    const current = await caches.open(CACHE_NAME);
    for (const key of keys.filter(k => k !== CACHE_NAME)) {
      try {
        const old = await caches.open(key);
        for (const request of await old.keys()) {
          const reqUrl = new URL(request.url);
          // Own static assets (images, PDFs under /assets/) are not code: kept
          // across versions, so a deploy does not download them all again
          const ownAsset = reqUrl.origin === self.location.origin && reqUrl.pathname.startsWith('/assets/')
            && /\.(png|jpe?g|webp|gif|svg|ico|pdf)$/i.test(reqUrl.pathname);
          if (reqUrl.origin === self.location.origin && !ownAsset) continue;
          if (await current.match(request)) continue;
          const response = await old.match(request);
          // Files from Storage only when they are images (older versions also
          // kept documents, which must go)
          const fromStorage = /(^|\.)(firebasestorage|storage)\.googleapis\.com$/.test(new URL(request.url).hostname);
          if (fromStorage && !/^image\//i.test(response?.headers.get('content-type') || '')) continue;
          if (response) await current.put(request, response);
        }
      } catch (error) {
        console.warn('[SW] Kunde inte flytta över från gammal cache:', key, error);
      }
    }
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));

    // Tvinga omedelbar kontroll över alla flikar
    await self.clients.claim();
    console.log('[SW] Aktiv och städad. Cache:', CACHE_NAME);
  })());
});

// Små hjälpare
const isJs = (req, url) => req.destination === 'script' || url.pathname.endsWith('.js') || url.pathname.endsWith('.mjs');
const isCss = (req, url) => req.destination === 'style' || url.pathname.endsWith('.css');

/**
 * The network's answer, but if it has not come within NETWORK_TIMEOUT_MS and
 * `getCached` has a copy, that copy (the network answer still updates the
 * cache through onNetwork). Without a cached copy it keeps waiting. A network
 * failure or invalid/error response resolves to null, so the caller falls back
 * to the cache.
 */
async function networkFirstWithTimeout(fetchPromise, getCached, onNetwork = () => { }, isValidResponse = (res) => !!res && (res.ok || res.type === 'opaque')) {
  const network = fetchPromise.then(
    (res) => {
      if (!isValidResponse(res)) return null;
      try { onNetwork(res); } catch { /* cache update only */ }
      return res;
    },
    () => null
  );
  let timer;
  const timedOut = new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), NETWORK_TIMEOUT_MS); });
  const first = await Promise.race([network, timedOut]);
  clearTimeout(timer);
  if (first !== 'timeout' && first !== null) return first;
  const cached = await getCached();
  return cached || network;
}

// Responses worth keeping: OK ones, and opaque ones from other sites (a plain
// <script src> from a CDN), never 404/500 pages served as a module
const isCacheable = (res) => !!res && (res.ok || res.type === 'opaque');

// Huvudstrategi
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1) Navigering: network-first med fallback till index.html
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const getCached = () => cache.match(abs('/index.html'));
      // A redirect (navigations use redirect: 'manual') is a valid answer, not
      // a reason to show the cached app
      const net = await networkFirstWithTimeout(fetch(req), getCached, () => { }, (res) => !!res && (res.ok || res.type === 'opaqueredirect'));
      if (net) return net;
      const cached = await getCached();
      if (cached) {
        console.warn('[SW][NAV] offline → index.html från cache');
        return cached;
      }
      console.error('[SW][NAV] CRITICAL: index.html saknas i cachen!');
      return Response.error();
    })());
    return;
  }

  // 2) JS & moduler: network-first (cache only when offline) + skydd mot HTML-svar.
  // Never serve a cached module while online: after a deploy an old module from
  // the cache next to a new one from the network breaks the import (e.g. a new
  // page importing a function an old service file does not export yet).
  // Unchanged files cost a 304 revalidation.
  if (isJs(req, url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const getCached = async () => (await cache.match(req)) || cache.match(req, { ignoreVary: true });
      const isValidJs = (res) => {
        if (!isCacheable(res)) return false;
        const ct = res.headers?.get('content-type') || '';
        if (ct.includes('text/html')) {
          console.error('[SW][JS] VARNING: nätet returnerade HTML för', url.pathname, '— cachar EJ och faller tillbaka på cache.');
          return false;
        }
        return true;
      };
      const net = await networkFirstWithTimeout(fetch(req, { cache: 'no-cache' }), getCached, (res) => {
        // Uppdatera cache i bakgrunden (aldrig 404/500-svar eller HTML)
        if (isValidJs(res)) cache.put(req, res.clone()).catch(() => { });
      }, isValidJs);
      if (net) return net;
      // Offline (or the network failed): the cached copy (ignoreVary as a
      // fallback, for servers that send other headers)
      const cached = await getCached();
      if (cached) return cached;
      console.warn('[SW][JS] MISSING in cache:', url.href);
      return new Response('/* offline */', { status: 503, headers: { 'content-type': 'application/javascript' } });
    })());
    return;
  }

  // 3) CSS: network-first like JS (styles match the code they were built for),
  // the cached copy when offline
  if (isCss(req, url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const getCached = () => cache.match(req);
      const isValidCss = (res) => {
        if (!isCacheable(res)) return false;
        const ct = res.headers?.get('content-type') || '';
        return !ct.includes('text/html');
      };
      const net = await networkFirstWithTimeout(fetch(req, { cache: 'no-cache' }), getCached, (res) => {
        if (isValidCss(res)) cache.put(req, res.clone()).catch(() => { });
      }, isValidCss);
      if (net) return net;
      const cached = await getCached();
      if (cached) return cached;
      console.warn('[SW][CSS] fetch misslyckades', url.href);
      return new Response('', { status: 503, statusText: 'Offline' });
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
        // Images only (flags, logos): documents from Storage (e.g. PDFs for
        // drivers) must not stay on a shared device after logout
        const isImage = /^image\//i.test(net.headers.get('content-type') || '');
        if (net.ok && isImage) cache.put(req, net.clone()).catch(() => { });
        return net;
      } catch {
        return new Response('', { status: 404 });
      }
    })());
    return;
  }

  // 5) Annat: cache-first. Own static assets (/assets/: images, the dressage
  // test PDFs) are stored when first fetched, as they are not precached
  // Images and PDFs only: a JSON or other data file under /assets/ may change
  // under the same name and must not be kept across versions
  const isOwnAsset = req.method === 'GET' && url.origin === self.location.origin && url.pathname.startsWith('/assets/')
    && /\.(png|jpe?g|webp|gif|svg|ico|pdf)$/i.test(url.pathname);
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const net = await fetch(req);
      if (isOwnAsset && net.ok && !(net.headers.get('content-type') || '').includes('text/html')) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, net.clone()).catch(() => { });
      }
      return net;
    } catch {
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
