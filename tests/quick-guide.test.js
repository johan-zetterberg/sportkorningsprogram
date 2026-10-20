import test from 'node:test';
import assert from 'node:assert/strict';
import { renderQuickGuideButton } from '../js/ui/quickGuideDrawer.js';
import { getCompetitionHeader } from '../js/ui/components.js';

test('renderQuickGuideButton generates accessible button HTML with specified role', () => {
  const btnHtml = renderQuickGuideButton('dressage');
  assert.ok(btnHtml.includes('data-guide-role="dressage"'), 'Includes data-guide-role attribute');
  assert.ok(btnHtml.includes('quick-guide-btn'), 'Includes button css class');
  assert.ok(btnHtml.includes('Lathund'), 'Includes Swedish default label');
});

test('renderQuickGuideButton respects custom label and extra class', () => {
  const btnHtml = renderQuickGuideButton('marathon-obstacle', {
    label: 'Hjälp',
    extraClass: 'my-custom-btn'
  });
  assert.ok(btnHtml.includes('data-guide-role="marathon-obstacle"'));
  assert.ok(btnHtml.includes('Hjälp'));
  assert.ok(btnHtml.includes('my-custom-btn'));
});

test('getCompetitionHeader renders quick guide button when quickGuideRole is passed', () => {
  const comp = { name: 'SM Sportkörning', location: 'Flyinge' };
  const headerHtml = getCompetitionHeader(comp, 'Inmatning Dressyr', {
    quickGuideRole: 'dressage'
  });

  assert.ok(headerHtml.includes('data-guide-role="dressage"'), 'Header contains quick guide button');
  assert.ok(headerHtml.includes('SM Sportkörning'), 'Header contains competition name');
  assert.ok(headerHtml.includes('Inmatning Dressyr'), 'Header contains page title');
});

test('getCompetitionHeader renders cleanly without quick guide when options are omitted or boolean', () => {
  const comp = { name: 'SM Sportkörning' };
  const headerNormal = getCompetitionHeader(comp, 'Startlista');
  assert.ok(!headerNormal.includes('data-guide-role'), 'Header does not contain quick guide when omitted');

  const headerLegacyBoolean = getCompetitionHeader(comp, 'Speaker Dashboard', true);
  assert.ok(!headerLegacyBoolean.includes('data-guide-role'), 'Handles legacy boolean options gracefully');
});

test('GUIDES defines all required competition roles with complete sections', async () => {
  const { GUIDES } = await import('../js/ui/quickGuideDrawer.js');
  const expectedRoles = [
    'dressage',
    'marathon-obstacle',
    'marathon-stages',
    'precision',
    'observer',
    'vet-check',
    'secretariat'
  ];

  for (const role of expectedRoles) {
    const guide = GUIDES[role];
    assert.ok(guide, `GUIDES must contain role: ${role}`);
    assert.ok(guide.title?.sv && guide.title?.en, `${role} must have localized titles`);
    assert.ok(Array.isArray(guide.steps?.sv) && guide.steps.sv.length >= 3, `${role} must have at least 3 quick start steps`);
    assert.ok(Array.isArray(guide.during?.sv) && guide.during.sv.length >= 3, `${role} must have round instructions`);
    assert.ok(Array.isArray(guide.troubleshooting?.sv) && guide.troubleshooting.sv.length >= 2, `${role} must have troubleshooting items`);
    assert.ok(Array.isArray(guide.symbols?.sv) && guide.symbols.sv.length >= 2, `${role} must have symbols`);

    // English assertions
    assert.ok(Array.isArray(guide.steps?.en) && guide.steps.en.length >= 3, `${role} must have at least 3 English quick start steps`);
    assert.ok(Array.isArray(guide.during?.en) && guide.during.en.length >= 3, `${role} must have English round instructions`);
    assert.ok(Array.isArray(guide.troubleshooting?.en) && guide.troubleshooting.en.length >= 2, `${role} must have English troubleshooting items`);
    assert.ok(Array.isArray(guide.symbols?.en) && guide.symbols.en.length >= 2, `${role} must have English symbols`);
  }
});

test('dressage quick guide uses the current error-of-course penalties', async () => {
  const { GUIDES } = await import('../js/ui/quickGuideDrawer.js');
  const swedish = GUIDES.dressage.during.sv.join(' ');
  const english = GUIDES.dressage.during.en.join(' ');

  assert.match(swedish, /5 straffpoäng/);
  assert.match(swedish, /ytterligare 10 straffpoäng/);
  assert.match(swedish, /tredje innebär uteslutning/);
  assert.match(english, /first error gives 5 penalty points/);
  assert.match(english, /second adds 10 more/);
  assert.match(english, /third results in elimination/);
  assert.ok(!swedish.includes('+2, +4'));
  assert.ok(!english.includes('+2, +4'));
});

test('dressage quick guide distinguishes saving from finalizing', async () => {
  const { GUIDES } = await import('../js/ui/quickGuideDrawer.js');
  const swedish = [...GUIDES.dressage.during.sv, ...GUIDES.dressage.troubleshooting.sv.map(item => item.a)].join(' ');
  const english = [...GUIDES.dressage.during.en, ...GUIDES.dressage.troubleshooting.en.map(item => item.a)].join(' ');

  assert.match(swedish, /inte låst eller officiellt förrän resultatet finaliseras/);
  assert.match(english, /not locked or official until the result is finalized/);
  assert.ok(!swedish.includes('Sparade protokoll låses'));
  assert.ok(!english.includes('Saved protocols are locked'));
});

test('quick guides use HTML emphasis instead of visible Markdown markers', async () => {
  const { GUIDES } = await import('../js/ui/quickGuideDrawer.js');
  const serializedGuides = JSON.stringify(GUIDES);

  assert.ok(!serializedGuides.includes('**'));
});

test('veterinary quick guide matches phase-specific controls and saving', async () => {
  const { GUIDES } = await import('../js/ui/quickGuideDrawer.js');
  const swedish = [...GUIDES['vet-check'].steps.sv, ...GUIDES['vet-check'].during.sv].join(' ');
  const english = [...GUIDES['vet-check'].steps.en, ...GUIDES['vet-check'].during.en].join(' ');

  assert.match(swedish, /Förbesiktning, Selning, Vilobox/);
  assert.match(swedish, /status sparas direkt/);
  assert.match(english, /status is saved immediately/);
  assert.ok(!swedish.includes('SPARA BEDÖMNING'));
  assert.ok(!english.includes('SAVE EVALUATION'));
});

test('quick guides describe offline writes as a conditional local queue', async () => {
  const { GUIDES } = await import('../js/ui/quickGuideDrawer.js');
  const serializedGuides = JSON.stringify(GUIDES);

  assert.match(serializedGuides, /redan laddad/);
  assert.match(serializedGuides, /already loaded/);
  assert.ok(!serializedGuides.includes('Systemet är offline-säkrat'));
  assert.ok(!serializedGuides.includes('The app works offline'));
});

test('quick guides match the current input pages', async () => {
  const { GUIDES } = await import('../js/ui/quickGuideDrawer.js');
  const { translateTo } = await import('../js/utils/i18n.js');
  const all = (role, lang) => [...GUIDES[role].steps[lang], ...GUIDES[role].during[lang], ...GUIDES[role].troubleshooting[lang].map(i => i.a)].join(' ');

  // Marathon obstacle: equipage first, the real save button, hold time in minutes, no gate knockdowns
  const obstacle = all('marathon-obstacle', 'sv');
  assert.match(GUIDES['marathon-obstacle'].steps.sv[0], /Ekipage/);
  assert.ok(obstacle.includes(translateTo('marathon_save_and_next', 'sv')));
  assert.ok(!obstacle.includes('SPARA RESULTAT'));
  assert.ok(!obstacle.includes('Rivningar (Bollar)'));
  assert.match(obstacle, /minuter/);
  assert.ok(all('marathon-obstacle', 'en').includes(translateTo('marathon_save_and_next', 'en')));

  // One name for the pause button, and no promise that anyone is alerted
  const serialized = JSON.stringify(GUIDES);
  assert.ok(!/NÖD-PAUS|EMERGENCY PAUSE|STOPPA ALLT/.test(serialized));
  assert.ok(serialized.includes(translateTo('observer_stop_all', 'sv')));
  assert.ok(!serialized.includes('larmar funktionärer'));

  // Precision rebuild button, secretariat badge colours
  assert.match(all('precision', 'sv'), /\+10 s \(ombyggnad\)/);
  assert.match(GUIDES.secretariat.during.sv.join(' '), /blå "Klar" = klar men inte finaliserad/);

  // Dressage summary bar
  assert.match(all('dressage', 'sv'), /ifyllda/);
});

test('carriage width and gate observer pages have a cheat sheet', async () => {
  const { GUIDES } = await import('../js/ui/quickGuideDrawer.js');
  for (const role of ['vagnbredd', 'precision-split']) {
    const guide = GUIDES[role];
    assert.ok(guide?.title?.sv && guide?.title?.en, `${role} has titles`);
    for (const lang of ['sv', 'en']) {
      assert.ok(guide.steps[lang].length >= 3 && guide.during[lang].length >= 3, `${role} ${lang} content`);
      assert.ok(guide.troubleshooting[lang].length >= 2 && guide.symbols[lang].length >= 2, `${role} ${lang} help`);
    }
  }
  const fsMod = await import('node:fs');
  assert.ok(fsMod.readFileSync('js/pages/shared/vagnbredd.js', 'utf8').includes("quickGuideRole: 'vagnbredd'"));
  assert.ok(fsMod.readFileSync('js/pages/precision/precision-split-input.js', 'utf8').includes("quickGuideRole: 'precision-split'"));
});

test('quick guide dialog implements keyboard focus management', async () => {
  const source = await import('node:fs').then(fs => fs.readFileSync('js/ui/quickGuideDrawer.js', 'utf8'));

  assert.match(source, /previouslyFocusedElement/);
  assert.match(source, /e\.key === 'Tab'/);
  assert.match(source, /drawer\.querySelector\('#qg-close-btn'\)\?\.focus\(\)/);
  assert.match(source, /previouslyFocusedElement\.focus\(\)/);
});
