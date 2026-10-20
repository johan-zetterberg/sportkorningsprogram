import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { wrapFocusIndex } from '../js/ui/dialogA11y.js';

test('wrapFocusIndex keeps Tab inside the dialog', () => {
  // Nothing focusable: focus the panel itself
  assert.equal(wrapFocusIndex(0, -1, false), -1);
  // Focus outside the dialog: first (Tab) or last (Shift+Tab)
  assert.equal(wrapFocusIndex(3, -1, false), 0);
  assert.equal(wrapFocusIndex(3, -1, true), 2);
  // Wrap at the ends
  assert.equal(wrapFocusIndex(3, 2, false), 0);
  assert.equal(wrapFocusIndex(3, 0, true), 2);
  // In the middle the browser moves focus
  assert.equal(wrapFocusIndex(3, 1, false), null);
  assert.equal(wrapFocusIndex(3, 1, true), null);
  assert.equal(wrapFocusIndex(3, 0, false), null);
});

test('result modals use the dialog helper with a title', () => {
  const files = {
    'js/ui/dressageModal.js': 'dressageModalTitle',
    'js/ui/marathonModal.js': 'marathonModalTitle',
    'js/ui/precisionModal.js': 'precisionModalTitle',
    'js/ui/equipage-modal.js': 'trModalTitle'
  };
  for (const [file, titleId] of Object.entries(files)) {
    const code = fs.readFileSync(file, 'utf8');
    assert.match(code, /activateDialog\(/, `${file} activates the dialog`);
    assert.match(code, /releaseDialog\(/, `${file} releases it on close`);
    assert.ok(code.includes(`id="${titleId}"`), `${file} has the title element`);
    assert.ok(code.includes(`labelledBy: '${titleId}'`), `${file} labels the dialog by its title`);
  }
});
