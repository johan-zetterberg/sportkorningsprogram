import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manualCode = fs.readFileSync('js/pages/shared/manual.js', 'utf8');

test('manual.js contains real-time search shell and input', () => {
  assert.ok(manualCode.includes('id="manualSearchInput"'), 'Should render manualSearchInput');
  assert.ok(manualCode.includes('id="manualSearchClear"'), 'Should render manualSearchClear');
  assert.ok(manualCode.includes('getManualSearchIndex'), 'Should have search indexing logic');
});

test('manual.js contains 1-click A4 Cheat Sheet PDF buttons across key roles', () => {
  assert.ok(manualCode.includes('data-role-pdf="dressage"'), 'Should have Dressage cheat sheet button');
  assert.ok(manualCode.includes('data-role-pdf="marathon-obstacle"'), 'Should have Marathon Obstacle cheat sheet button');
  assert.ok(manualCode.includes('data-role-pdf="marathon-stages"'), 'Should have Marathon Stages cheat sheet button');
  assert.ok(manualCode.includes('data-role-pdf="precision"'), 'Should have Precision cheat sheet button');
  assert.ok(manualCode.includes('data-role-pdf="secretariat"'), 'Should have Secretariat cheat sheet button');
  assert.ok(manualCode.includes('data-role-pdf="observer"'), 'Should have Observer cheat sheet button');
});

test('manual.js contains accurate conditional offline guidance', () => {
  // Ensure the old, dangerous advice is completely gone
  assert.ok(!manualCode.includes('INTE på "Spara Protokoll"'), 'Should not warn against saving while offline');
  assert.ok(!manualCode.includes('INTE på Spara Protokoll'), 'Should not warn against saving while offline');

  // Offline writes are conditional on an already loaded view and are not
  // server-confirmed until the queue has synchronized.
  assert.ok(!manualCode.includes('Appen är fullt offline-säkrad'), 'Should not promise unconditional offline safety');
  assert.ok(manualCode.includes('Offline-stöd för en redan laddad domarvy'));
  assert.ok(manualCode.includes('klicka på <strong>"Spara Protokoll"</strong> som vanligt'), 'Should instruct user to save as usual');
  assert.ok(manualCode.includes('Synk-molnet'), 'Should explain sync indicator states');
  assert.ok(manualCode.includes('inte serverbekräftad förrän synkikonen blir grön'));
});

test('dressage manual distinguishes saving from finalizing a protocol', () => {
  assert.ok(!manualCode.includes('Sign Protocol'), 'Should not mention a signature control that does not exist');
  assert.ok(!manualCode.includes('Detta låser resultatet och gör det officiellt'), 'Saving must not be described as finalization');
  assert.ok(manualCode.includes('resultatet blir inte officiellt eller låst förrän en behörig användare finaliserar det på resultatsidan'));
  assert.ok(manualCode.includes('the result is not official or locked until an authorized user finalizes it on the results page'));
});

test('manual.js contains complete chronological admin competition setup checklist', () => {
  assert.ok(manualCode.includes('Fas 1: Skapa tävling & Importera anmälningar från TDB'), 'Has Phase 1 in Swedish');
  assert.ok(manualCode.includes('Fas 2: Domare & Funktionärer'), 'Has Phase 2 in Swedish');
  assert.ok(manualCode.includes('Fas 3: Banfakta för Maraton & Precision'), 'Has Phase 3 in Swedish');
  assert.ok(manualCode.includes('Fas 4: Starttider & Schemaläggning'), 'Has Phase 4 in Swedish');
  assert.ok(manualCode.includes('Fas 5: Tävlingsdagen (Mätning, Besiktning & Deklarering)'), 'Has Phase 5 in Swedish');
  assert.ok(manualCode.includes('Fas 6: Slutkontroll, Prisutdelning & Arkivering'), 'Has Phase 6 in Swedish');

  // English phases
  assert.ok(manualCode.includes('Phase 1: Create Competition & Import Entries'), 'Has Phase 1 in English');
  assert.ok(manualCode.includes('Phase 3: Course Data for Marathon & Cones'), 'Has Phase 3 in English');
  assert.ok(manualCode.includes('Phase 6: Results Verification, Prizegiving & Archiving'), 'Has Phase 6 in English');
});

test('manual.js contains 1-click A4 organizer checklist PDF button and practical field guide', () => {
  assert.ok(manualCode.includes('data-role-pdf="admin_checklist"'), 'Should have admin_checklist button');
  assert.ok(manualCode.includes('Praktisk Fältguide & Hårdvara'), 'Should have Swedish field guide section');
  assert.ok(manualCode.includes('Practical Field & Hardware Guide'), 'Should have English field guide section');
  assert.ok(manualCode.includes('Screen Wake Lock'), 'Should mention Screen Wake Lock');
  assert.ok(manualCode.includes('Powerbank'), 'Should mention Powerbank');
  assert.ok(manualCode.includes('setManualActiveTab'), 'Should export setManualActiveTab');
  assert.ok(manualCode.includes("params.get('tab')"), 'Should parse tab query parameter');
});

test('quickGuidePdf.js includes generateAdminChecklistPdf with all 6 phases', () => {
  const pdfCode = fs.readFileSync('js/pdf/quickGuidePdf.js', 'utf8');
  assert.ok(pdfCode.includes('generateAdminChecklistPdf'), 'Should export generateAdminChecklistPdf');
  assert.ok(pdfCode.includes("roleKey === 'admin_checklist'"), 'Should handle admin_checklist in generateQuickGuidePdf');
  assert.ok(pdfCode.includes('FAS 1: FÖRBEREDELSER & TDB-EXPORT'), 'Should include Phase 1 in PDF');
  assert.ok(pdfCode.includes('FAS 6: AVSLUT, PRISUTDELNING & TDB-EXPORT'), 'Should include Phase 6 in PDF');
  assert.ok(pdfCode.includes('TR V KÖRNING'), 'Should identify the driving regulations as TR V');
  assert.ok(!pdfCode.includes('TR X KÖRNING'), 'Should not use the incorrect TR X designation');
});

test('portal.js includes showDriverPortalHelpModal and portal help buttons', () => {
  const portalCode = fs.readFileSync('js/pages/shared/portal.js', 'utf8');
  assert.ok(portalCode.includes('showDriverPortalHelpModal'), 'Should define showDriverPortalHelpModal');
  assert.ok(portalCode.includes('id="portalHelpBtn"'), 'Should render portalHelpBtn on portal landing');
  assert.ok(portalCode.includes('id="portalDashboardHelpBtn"'), 'Should render portalDashboardHelpBtn on dashboard');
  assert.ok(portalCode.includes('Digital Deklarering & 60-minuterslås'), 'Should explain 60m lock in modal');
});

test('hub.js includes organizer guide banner linking to admin manual', () => {
  const hubCode = fs.readFileSync('js/pages/shared/hub.js', 'utf8');
  assert.ok(hubCode.includes('href="#manual?tab=admin"'), 'Should link directly to admin manual');
  assert.ok(hubCode.includes('hub_guide_banner_title'), 'Should use i18n title for organizer guide banner');
});
