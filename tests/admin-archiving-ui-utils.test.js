import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildArchiveErrorMessage,
  buildArchiveSuccessMessage,
  renderArchiveStatusMessage
} from '../js/pages/admin/adminArchivingUiUtils.js';

test('buildArchiveSuccessMessage includes archived row count when present', () => {
  assert.equal(
    buildArchiveSuccessMessage({ rows: 12 }),
    'Tävlingen är nu avslutad och arkiverad. 12 resultatrader ingick i arkivet.\nPDF har laddats ner.'
  );
  assert.equal(
    buildArchiveSuccessMessage({ rows: 1 }),
    'Tävlingen är nu avslutad och arkiverad. 1 resultatrad ingick i arkivet.\nPDF har laddats ner.'
  );
});

test('buildArchiveErrorMessage formats known and unknown archive failures', () => {
  assert.equal(
    buildArchiveErrorMessage(new Error('PDF saknas')),
    'Arkiveringen avbröts: PDF saknas'
  );
  assert.equal(
    buildArchiveErrorMessage(null),
    'Arkiveringen avbröts på grund av ett okänt fel.'
  );
});

test('renderArchiveStatusMessage renders loading and error states', () => {
  const statusEl = { innerHTML: '' };

  renderArchiveStatusMessage(statusEl);
  assert.match(statusEl.innerHTML, /spinner/);
  assert.match(statusEl.innerHTML, /Genererar slutresultat och PDF/);

  renderArchiveStatusMessage(statusEl, { state: 'error', message: 'Stopp' });
  assert.doesNotMatch(statusEl.innerHTML, /spinner/);
  assert.match(statusEl.innerHTML, /text-red-700/);
  assert.match(statusEl.innerHTML, /Stopp/);
});
