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
  assert.ok(manualCode.includes('Synkindikatorn'), 'Should explain sync indicator states');
  assert.ok(manualCode.includes('inte serverbekräftad förrän den har skickats'));
  // The indicator has no green state: the queue button disappears when everything is sent
  assert.ok(!/synkikonen blir grön|grön synkikon|sync icon turns green|green sync icon/i.test(manualCode), 'Should not describe a green sync icon');
});

test('help texts match the rules and the app', () => {
  const drawerCode = fs.readFileSync('js/ui/quickGuideDrawer.js', 'utf8');
  const pdfCode = fs.readFileSync('js/pdf/quickGuidePdf.js', 'utf8');
  for (const [name, code] of [['manual', manualCode], ['drawer', drawerCode], ['pdf', pdfCode]]) {
    assert.ok(!/grön synk|green sync|synkikon/i.test(code), `${name}: no green sync icon`);
    assert.ok(!/påbörjad sekund|started second|commenced second/i.test(code), `${name}: precision time penalty is 0.5 per second, not per started second`);
    assert.ok(!/\+ ?20 cm/.test(code), `${name}: gate allowance is per class, not a flat +20 cm`);
    assert.ok(!/km\/h/.test(code), `${name}: marathon speeds are entered in m/min`);
    assert.ok(!/eqresults/.test(code), `${name}: there is no result file export`);
  }
  assert.ok(drawerCode.includes('0,5 straffpoäng per sekund'), 'Precision time penalty per TR V 525.9');
  assert.ok(drawerCode.includes('2 straffpoäng per rivet element'), 'Marathon knockdown is 2 penalty points');
  assert.ok(!drawerCode.includes('Mellanslag'), 'Precision has no Space shortcut');
  assert.ok(!drawerCode.includes('var 30:e sekund'), 'Dressage has no 30-second autosave');
  assert.ok(pdfCode.includes('(C, E, B, H, M)') && !pdfCode.includes('C, R, B'), 'Judge positions are C, E, B, H, M');
  assert.ok(pdfCode.includes('TR Mom 514') && !pdfCode.includes('Mom 526)'), 'First horse inspection is TR Mom 514');
  assert.ok(!/4-siffriga|4-digit/.test(pdfCode), 'Role codes are 8 digits');
  assert.ok(!/kuriosa|sign-off|signering/i.test(pdfCode), 'No features that do not exist');
});

test('quick guide drawer keeps keys and printing to itself', () => {
  const drawerCode = fs.readFileSync('js/ui/quickGuideDrawer.js', 'utf8');
  assert.ok(drawerCode.includes('body.qg-open *'), 'Print rule only applies while the drawer is open');
  assert.ok(!/@media print \{\s*body \*/.test(drawerCode), 'Print rule is not global');
  assert.ok(drawerCode.includes("document.addEventListener('keydown', onOutsideKeyDown, true)"), 'Keys outside the drawer are stopped in the capture phase');
  assert.ok(drawerCode.includes('e.stopPropagation()'), 'Keys inside the drawer do not reach the page');
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
  assert.ok(pdfCode.includes('FAS 1: FÖRBEREDELSER & ANMÄLNINGAR'), 'Should include Phase 1 in PDF');
  assert.ok(pdfCode.includes('FAS 6: AVSLUT, PRISUTDELNING & ARKIVERING'), 'Should include Phase 6 in PDF');
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

test('manual matches the current input pages and access model', () => {
  assert.ok(!manualCode.includes('SPARA RESULTAT</span> när du är klar'), 'Obstacle save button is SPARA & NÄSTA (from i18n)');
  assert.ok(manualCode.includes("btn('marathon_save_and_next', 'sv')"));
  assert.ok(!manualCode.includes('Antal rivningar'), 'The obstacle field is Rivning/boll (from i18n)');
  assert.ok(!manualCode.includes('väntetiden i sekunder'), 'Hold time is entered in minutes');
  assert.ok(!manualCode.includes('Spara Slutgiltigt Resultat'));
  assert.ok(manualCode.includes('+10 s (ombyggnad)'));
  assert.ok(!manualCode.includes('Välj en specifik kusk i rullistan'), 'Targeted messages use a checklist');
  assert.ok(!manualCode.includes('Kontrollera på <em>Totalresultat</em> att alla domare'), 'Unfinalize is on the discipline result pages');
  assert.ok(manualCode.includes('10 tecken') && manualCode.includes('ingen admin-PIN'));
  assert.ok(!/REGISTRERA HALT|REGISTER HALT/.test(manualCode), 'Halts use START/STOPP');
});
