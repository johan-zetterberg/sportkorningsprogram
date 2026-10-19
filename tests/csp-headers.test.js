import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { firebaseHeadersFor, globToRegExp } from '../scripts/static-server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const firebaseJson = JSON.parse(readFileSync(path.join(root, 'firebase.json'), 'utf8'));
const HTML_PAGES = ['index.html', 'volunteer-signup.html'];

function documentRule() {
  return firebaseJson.hosting.headers.find(rule => rule.headers.some(h => h.key === 'Content-Security-Policy'));
}

function policy(key) {
  return documentRule().headers.find(h => h.key === key)?.value || '';
}

function directive(value, name) {
  const part = value.split(';').map(s => s.trim()).find(s => s.split(/\s+/)[0] === name);
  return part ? part.split(/\s+/).slice(1) : null;
}

const sha256 = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

function inlineScripts(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(m => !/\bsrc=/.test(m[1]))
    .map(m => m[2]);
}

function jsFiles(dir) {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? jsFiles(full) : (/\.m?js$/.test(name) ? [full] : []);
  });
}

test('the html pages get an enforced CSP without inline code', () => {
  const rule = documentRule();
  const re = new RegExp(rule.regex);
  for (const p of ['/', '/index.html', '/volunteer-signup.html']) assert.ok(re.test(p), p);
  for (const p of ['/js/main.js', '/service-worker.js', '/css/tailwind.css']) assert.ok(!re.test(p), p);

  const enforced = policy('Content-Security-Policy');
  assert.deepEqual(directive(enforced, 'object-src'), ["'none'"]);
  assert.deepEqual(directive(enforced, 'base-uri'), ["'self'"]);
  assert.deepEqual(directive(enforced, 'form-action'), ["'self'"]);
  assert.deepEqual(directive(enforced, 'frame-ancestors'), ["'self'"]);
  assert.ok(!enforced.includes("'unsafe-eval'"));
  assert.ok(!directive(enforced, 'script-src').includes("'unsafe-inline'"));
  // One policy only: no report-only copy to keep in step
  assert.equal(policy('Content-Security-Policy-Report-Only'), '');
});

test('every inline script in the html pages has its hash in the policy (LF and CRLF)', () => {
  const allowed = directive(policy('Content-Security-Policy'), 'script-src');
  for (const page of HTML_PAGES) {
    for (const body of inlineScripts(readFileSync(path.join(root, page), 'utf8'))) {
      const lf = body.replace(/\r\n/g, '\n');
      assert.ok(allowed.includes(sha256(lf)), `${page}: inline script hash missing (${sha256(lf)})`);
      assert.ok(allowed.includes(sha256(lf.replace(/\n/g, '\r\n'))), `${page}: CRLF hash missing`);
    }
  }
});

test('no inline event handlers or javascript: URLs in js/ or the html pages (the CSP blocks them)', () => {
  const files = [...jsFiles(path.join(root, 'js')), ...HTML_PAGES.map(p => path.join(root, p))];
  // An attribute like onclick="…" / onerror='…' in markup or a string, or a javascript: URL
  // assigned or written into an attribute (comments mentioning the scheme are fine)
  const handler = /[\s"'`]on[a-z]{3,}\s*=\s*\\?["']/i;
  const jsUrl = /(href|src|action)\s*=\s*\\?["'`]?\s*javascript:|\.href\s*=\s*["'`]javascript:/i;
  const found = [];
  for (const file of files) {
    readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      if (handler.test(line) || jsUrl.test(line)) found.push(`${path.relative(root, file)}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(found, [], 'use data-action (js/utils/domActions.js) or addEventListener');
});

test('external scripts and styles come from origins the CSP allows, pinned files with SRI', () => {
  const enforced = policy('Content-Security-Policy');
  const scriptSrc = directive(enforced, 'script-src');
  const styleSrc = directive(enforced, 'style-src');
  for (const page of HTML_PAGES) {
    const html = readFileSync(path.join(root, page), 'utf8');
    for (const [tag] of html.matchAll(/<script\b[^>]*\bsrc="https:[^"]*"[^>]*>/gi)) {
      const url = new URL(tag.match(/src="([^"]+)"/)[1]);
      assert.ok(scriptSrc.includes(url.origin), `${page}: ${url.origin} not in script-src`);
      assert.match(tag, /integrity="sha(256|384|512)-/, `${page}: ${url.href} without SRI`);
      assert.match(tag, /crossorigin=/, `${page}: ${url.href} without crossorigin`);
    }
    for (const [tag] of html.matchAll(/<link\b[^>]*\bhref="https:[^"]*"[^>]*>/gi)) {
      const url = new URL(tag.match(/href="([^"]+)"/)[1]);
      assert.ok(styleSrc.includes(url.origin), `${page}: ${url.origin} not in style-src`);
      // Google Fonts serves a different stylesheet per browser: no SRI possible
      if (url.hostname !== 'fonts.googleapis.com') {
        assert.match(tag, /integrity="sha(256|384|512)-/, `${page}: ${url.href} without SRI`);
      }
    }
  }
  // ES module imports (the Firebase SDK) cannot carry SRI: their origin must be allowed
  for (const file of jsFiles(path.join(root, 'js'))) {
    const src = readFileSync(file, 'utf8');
    for (const [, url] of src.matchAll(/(?:from|import\()\s*["'](https:\/\/[^"']+)["']/g)) {
      assert.ok(scriptSrc.includes(new URL(url).origin), `${file}: ${url} not in script-src`);
    }
  }
});

test('the static server applies the firebase.json headers, with the emulators for local runs', () => {
  assert.ok(globToRegExp('**/*.@(js|mjs|css|html|json)').test('js/pages/main.js'));
  assert.ok(globToRegExp('**/*.@(js|mjs|css|html|json)').test('index.html'));
  assert.ok(!globToRegExp('**/*.@(js|css)').test('img/logo.png'));
  assert.ok(globToRegExp('**').test('img/logo.png'));

  const doc = firebaseHeadersFor('/');
  assert.match(doc['Content-Security-Policy'], /object-src 'none'/);
  assert.match(directive(doc['Content-Security-Policy'], 'connect-src').join(' '), /http:\/\/127\.0\.0\.1:8080/);
  assert.equal(doc['X-Frame-Options'], 'SAMEORIGIN');
  // Never in what production gets
  assert.ok(!policy('Content-Security-Policy').includes('127.0.0.1'));

  // Not deployed (firebase.json hosting.ignore): no hosting headers locally either
  assert.deepEqual(firebaseHeadersFor('/seed_test.html'), {});

  const script = firebaseHeadersFor('/js/main.js');
  assert.equal(script['Content-Security-Policy'], undefined);
  assert.equal(script['Cache-Control'], 'no-cache');
});
