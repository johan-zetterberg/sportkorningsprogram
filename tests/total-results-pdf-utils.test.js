import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveTotalResultsJsPdf } from '../js/pdf/totalResultsPdfUtils.js';

test('resolveTotalResultsJsPdf returns jsPDF constructor when loaded', () => {
  function FakeJsPdf() {}

  assert.equal(
    resolveTotalResultsJsPdf({ jspdfNamespace: { jsPDF: FakeJsPdf } }),
    FakeJsPdf
  );
});

test('resolveTotalResultsJsPdf alerts and returns null for normal PDF exports', () => {
  const alerts = [];

  assert.equal(
    resolveTotalResultsJsPdf({
      jspdfNamespace: {},
      alertFn: message => alerts.push(message)
    }),
    null
  );
  assert.deepEqual(alerts, ['Kunde inte ladda PDF-biblioteket.']);
});

test('resolveTotalResultsJsPdf throws for required archive PDF export', () => {
  assert.throws(
    () => resolveTotalResultsJsPdf({ jspdfNamespace: {}, throwOnMissing: true }),
    /Kunde inte ladda PDF-biblioteket/
  );
});
