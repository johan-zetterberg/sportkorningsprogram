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

// CSP host-source matching: a source ending in "/" is a path prefix, otherwise an exact path
function allows(sources, href) {
  const url = new URL(href);
  return sources.some(src => {
    if (!/^https:\/\//.test(src)) return false;
    const s = new URL(src);
    if (s.origin !== url.origin) return false;
    if (src === s.origin) return true; // bare origin: any path
    if (src.endsWith('/')) return url.pathname.startsWith(s.pathname);
    return url.pathname === s.pathname;
  });
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
      assert.ok(allows(scriptSrc, url.href), `${page}: ${url.href} not in script-src`);
      assert.match(tag, /integrity="sha(256|384|512)-/, `${page}: ${url.href} without SRI`);
      assert.match(tag, /crossorigin=/, `${page}: ${url.href} without crossorigin`);
    }
    for (const [tag] of html.matchAll(/<link\b[^>]*\bhref="https:[^"]*"[^>]*>/gi)) {
      const url = new URL(tag.match(/href="([^"]+)"/)[1]);
      assert.ok(allows(styleSrc, url.href), `${page}: ${url.href} not in style-src`);
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
      assert.ok(allows(scriptSrc, url), `${file}: ${url} not in script-src`);
    }
  }
});

test('CDN sources are path-scoped to the exact pinned libraries, no bare CDN host', () => {
  const enforced = policy('Content-Security-Policy');
  const cdnHosts = ['unpkg.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'www.gstatic.com'];
  for (const name of ['script-src', 'style-src', 'font-src', 'connect-src', 'img-src', 'default-src']) {
    for (const src of directive(enforced, name) || []) {
      if (!/^https:\/\//.test(src)) continue;
      const u = new URL(src);
      if (cdnHosts.includes(u.hostname)) assert.notEqual(u.pathname, '/', `${name}: bare CDN host ${src}`);
    }
  }
  const scriptSrc = directive(enforced, 'script-src');
  assert.ok(scriptSrc.includes('https://www.gstatic.com/firebasejs/'));
  assert.ok(scriptSrc.includes('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'));
  assert.ok(scriptSrc.includes('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'));
  assert.ok(scriptSrc.includes('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'));
  assert.ok(directive(enforced, 'style-src').includes('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'));
  assert.ok(directive(enforced, 'style-src').includes('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css'));
  assert.ok(directive(enforced, 'font-src').includes('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/webfonts/'));
  // Other libraries on the same CDNs stay blocked
  assert.ok(!allows(scriptSrc, 'https://unpkg.com/evil@1.0.0/x.js'));
  assert.ok(!allows(scriptSrc, 'https://cdnjs.cloudflare.com/ajax/libs/angular.js/1.8.3/angular.min.js'));
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

test('push notifications: Firebase Messaging may register the device (connect-src), its SDK loads from gstatic', () => {
  const enforced = policy('Content-Security-Policy');
  const connect = directive(enforced, 'connect-src');
  assert.ok(connect.includes('https://fcmregistrations.googleapis.com'));
  assert.ok(connect.includes('https://firebaseinstallations.googleapis.com'));
  assert.ok(directive(enforced, 'script-src').includes('https://www.gstatic.com/firebasejs/'));
  const service = readFileSync(path.join(root, 'js/services/pushService.js'), 'utf8');
  for (const [, url] of service.matchAll(/["'](https:\/\/[^"']+\.js)["']/g)) {
    assert.ok(allows(directive(enforced, 'script-src'), url), url);
  }
});