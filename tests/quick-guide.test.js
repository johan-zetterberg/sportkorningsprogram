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

