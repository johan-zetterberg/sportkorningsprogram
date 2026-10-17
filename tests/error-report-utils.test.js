import test from 'node:test';
import assert from 'node:assert/strict';
import { buildErrorReport, isIgnorableError, reportKey, routeOf, scrubText, stripUrlParams } from '../js/utils/errorReportUtils.js';
import { scrubClientPage, scrubClientText, stripUrlParams as serverStripUrlParams } from '../functions/src/clientErrorReport.js';

test('query strings and fragments are stripped from URLs, line and column kept', () => {
  const cases = [
    ['https://app.example/js/main.js?token=abc', 'https://app.example/js/main.js'],
    ['at f (https://app.example/js/a.js?v=2#x:10:5)', 'at f (https://app.example/js/a.js:10:5)'],
    ['f@https://app.example/js/a.js?v=2:3:7\ng@https://app.example/#admin?tab=pin:1:2', 'f@https://app.example/js/a.js:3:7\ng@https://app.example/:1:2'],
    ['Sidan https://app.example/#portal?email=x och mer', 'Sidan https://app.example/ och mer'],
    ['blob:https://app.example/1234?x=1', 'blob:https://app.example/1234'],
    ['at https://app.example/js/a.js:10:5', 'at https://app.example/js/a.js:10:5'],
    ['ingen url ?a=1 #b', 'ingen url ?a=1 #b']
  ];
  for (const [input, expected] of cases) {
    assert.equal(stripUrlParams(input), expected, input);
    // The server's copy (the one that counts) does the same
    assert.equal(serverStripUrlParams(input), expected, input);
  }
});

test('the server scrubs what any caller sends', () => {
  assert.equal(scrubClientText('https://x.se/a.js?mail=bo@x.se boom bo@x.se', 100), 'https://x.se/a.js boom [e-post]');
  assert.equal(scrubClientText('x'.repeat(90), 60).length, 60);
  assert.equal(scrubClientPage('#admin?tab=secrets'), 'admin');
  assert.equal(scrubClientPage('https://app.example/x?y=1#z'), 'https://app.example/x');
  assert.equal(scrubClientPage('portal'), 'portal');
});

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
