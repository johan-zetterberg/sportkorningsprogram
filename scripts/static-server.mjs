import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const port = Number(process.argv[2] || 5500);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

// The hosting headers from firebase.json (CSP etc.), so local runs and the
// smoke tests see what production sends. STATIC_FIREBASE_HEADERS=0 turns it off.
const APPLY_FIREBASE_HEADERS = process.env.STATIC_FIREBASE_HEADERS !== '0';
const firebaseJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'firebase.json'), 'utf8'));

// Firebase Hosting glob ("**", "*", "@(a|b)") as a RegExp on the path without its leading slash
export function globToRegExp(glob) {
  let re = '';
  const src = String(glob).replace(/^\//, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '*' && src[i + 1] === '*') {
      if (src[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '@' && src[i + 1] === '(') {
      const end = src.indexOf(')', i);
      re += `(?:${src.slice(i + 2, end).split('|').map(s => s.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('|')})`;
      i = end;
    } else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

// The emulators the app connects to locally (js/config/firebase-config.js)
const emulatorOrigins = Object.values(firebaseJson.emulators || {})
  .map(e => e?.port).filter(Boolean)
  .flatMap(port => [`http://127.0.0.1:${port}`, `http://localhost:${port}`]);

// Local only: the emulators added where the policy lists the Firebase endpoints
function withEmulators(policy) {
  return policy.split(';').map(part => {
    const name = part.trim().split(/\s+/)[0];
    return ['connect-src', 'frame-src'].includes(name) ? `${part} ${emulatorOrigins.join(' ')}` : part;
  }).join(';');
}

// Files hosting does not deploy (dev pages such as seed_test.html) get no hosting headers
const ignoredPatterns = (firebaseJson.hosting?.ignore || []).map(globToRegExp);

export function firebaseHeadersFor(urlPathname) {
  const headers = {};
  const relative = urlPathname.replace(/^\//, '');
  if (relative && ignoredPatterns.some(re => re.test(relative))) return headers;
  for (const rule of firebaseJson.hosting?.headers || []) {
    const matches = rule.regex
      ? new RegExp(rule.regex).test(urlPathname)
      : globToRegExp(rule.source).test(urlPathname.replace(/^\//, ''));
    if (!matches) continue;
    for (const { key, value } of rule.headers || []) {
      headers[key] = /^Content-Security-Policy/i.test(key) ? withEmulators(value) : value;
    }
  }
  return headers;
}

function send(res, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, { 'Content-Type': contentType });
  res.end(body);
}

function resolveRequestPath(urlPathname) {
  const decodedPath = decodeURIComponent(urlPathname);
  const cleanPath = decodedPath === '/' ? '/index.html' : decodedPath;
  const normalized = path.normalize(cleanPath).replace(/^(\.\.[/\\])+/, '');
  return path.join(rootDir, normalized);
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    let filePath = resolveRequestPath(url.pathname);

    if (!filePath.startsWith(rootDir)) {
      send(res, 403, 'Forbidden');
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    if (!fs.existsSync(filePath)) {
      send(res, 404, `Not found: ${url.pathname}`);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const hostingHeaders = APPLY_FIREBASE_HEADERS ? firebaseHeadersFor(url.pathname) : {};
    res.writeHead(200, { ...hostingHeaders, 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    send(res, 500, `Server error: ${error.message}`);
  }
});

// Listens only when run as a script (tests import the header helpers)
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  server.listen(port, '127.0.0.1', () => {
    console.log(`Static server running at http://127.0.0.1:${port}`);
  });
}
