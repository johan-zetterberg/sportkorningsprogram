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

test('manual.js contains modernized, reassuring offline guidance and removed outdated bad advice', () => {
  // Ensure the old, dangerous advice is completely gone
  assert.ok(!manualCode.includes('INTE på "Spara Protokoll"'), 'Should not warn against saving while offline');
  assert.ok(!manualCode.includes('INTE på Spara Protokoll'), 'Should not warn against saving while offline');

  // Ensure positive auto-sync guidance is present
  assert.ok(manualCode.includes('Appen är fullt offline-säkrad'), 'Should explain that app is fully offline safe');
  assert.ok(manualCode.includes('Klicka på "Spara Protokoll" som vanligt'), 'Should instruct user to save as usual');
  assert.ok(manualCode.includes('Synk-molnet'), 'Should explain sync indicator states');
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
