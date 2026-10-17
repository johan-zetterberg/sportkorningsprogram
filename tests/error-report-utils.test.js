import test from 'node:test';
import assert from 'node:assert/strict';
import { buildErrorReport, isIgnorableError, reportKey, routeOf, scrubText } from '../js/utils/errorReportUtils.js';

test('error reports carry no e-mail addresses, query strings or route parameters', () => {
  const error = new TypeError('Cannot read anna.svensson@example.se of undefined');
  error.stack = 'TypeError: x\n    at https://app.example/js/main.js?token=abc:10:5';
  const report = buildErrorReport({ error, kind: 'error', hash: '#portal?email=bo@x.se', competitionId: 'abc123', appVersion: 'v78', engineVersion: '2026-10-16.2' });
  assert.equal(report.message, 'Cannot read [e-post] of undefined');
  assert.equal(report.stack.includes('token'), false);
  assert.equal(report.page, 'portal');
  assert.equal(report.name, 'TypeError');
  assert.equal(report.competitionId, 'abc123');
  assert.equal(report.appVersion, 'v78');
});

test('texts are shortened and a missing error still gives a report', () => {
  assert.equal(scrubText('x'.repeat(900), 500).length, 500);
  const report = buildErrorReport({ message: 'boom', filename: 'https://app.example/js/a.js', kind: 'rejection' });
  assert.equal(report.kind, 'rejection');
  assert.equal(report.message, 'boom');
  assert.equal(report.stack, 'at https://app.example/js/a.js');
  assert.equal(routeOf(''), 'hub');
});

test('noise is ignored and the same error has the same key', () => {
  assert.equal(isIgnorableError({ message: 'ResizeObserver loop completed with undelivered notifications.' }), true);
  assert.equal(isIgnorableError({ message: 'Script error.' }), true);
  assert.equal(isIgnorableError({ message: 'x', filename: 'chrome-extension://abc/x.js' }), true);
  assert.equal(isIgnorableError({ message: 'x', filename: 'https://other.site/x.js' }, 'https://app.example'), true);
  assert.equal(isIgnorableError({ message: 'x', filename: 'https://app.example/js/x.js' }, 'https://app.example'), false);
  const a = buildErrorReport({ message: 'boom', kind: 'error' });
  const b = buildErrorReport({ message: 'boom', kind: 'error' });
  assert.equal(reportKey(a), reportKey(b));
});
