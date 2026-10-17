// Service worker: registration and new versions. A new version is installed in
// the background and waits: this page keeps running the version it started
// with until the user presses "Ladda om" (a judge may be entering a result).
// Then the new version takes over every tab of the app: an idle tab reloads, a
// tab with unsaved work or a running clock asks the user to reload (it keeps
// its own version's files meanwhile, see cacheForClient in service-worker.js).
// Loaded on its own (not from main.js), so updates are found even if the app
// itself fails to start.
import { APP_VERSION } from './appVersion.js';
import {
  UPDATE_CHECK_INTERVAL_MS,
  shouldCheckForUpdate,
  isOtherVersion,
  decideOnNewVersion,
  isEditingElement
} from './utils/appUpdateLogic.js';
import { unsavedWorkReasons } from './utils/unsavedWork.js';

// The version this tab already reloaded for (no reload loop)
const RELOADED_FOR_KEY = 'appUpdateReloadedFor';
const NOTICE_ID = 'appUpdateNotice';

function readSession(key) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

function writeSession(key, value) {
  try { sessionStorage.setItem(key, value); } catch { /* the guard is per page then */ }
}

/** Tells the service worker this page's version; resolves with its own ('' without an answer) */
function exchangeVersion(worker, timeoutMs = 3000) {
  return new Promise((resolve) => {
    if (!worker) { resolve(''); return; }
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(''), timeoutMs);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(String(event.data?.version || ''));
    };
    try {
      worker.postMessage({ type: 'CLIENT_VERSION', version: APP_VERSION }, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve('');
    }
  });
}

/** Why a reload now would lose or interrupt work (empty = safe to reload) */
export function busyReasons() {
  const reasons = unsavedWorkReasons();
  // Writes not yet confirmed by the server (kept on the device, but a reload
  // without offline storage would lose them)
  if ((window.syncService?.count || 0) > 0 || window.__isSyncing === true) reasons.push('sync');
  if (isEditingElement(document.activeElement)) reasons.push('editing');
  return reasons;
}

function noticeBar(id) {
  let bar = document.getElementById(id);
  if (bar) return bar;
  bar = document.createElement('div');
  bar.id = id;
  bar.setAttribute('role', 'status');
  bar.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(12px + env(safe-area-inset-bottom, 0px));z-index:10000;max-width:calc(100% - 24px);display:flex;gap:10px;align-items:center;padding:10px 14px;border-radius:10px;background:#1e3a5f;color:#fff;font:14px system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3)';
  document.body.appendChild(bar);
  return bar;
}

function fillNotice(bar, text, onClick) {
  bar.innerHTML = '<span></span>'
    + '<button type="button" style="flex-shrink:0;padding:6px 12px;border-radius:8px;background:#f5c542;color:#1e3a5f;font-weight:700;border:0">Ladda om</button>';
  bar.querySelector('span').textContent = text;
  bar.querySelector('button').addEventListener('click', onClick);
}

if ('serviceWorker' in navigator) {
  const sw = navigator.serviceWorker;
  let reloadRequested = false;
  let stale = false;
  // A controller at start means a later controllerchange is a new version (not
  // the first install taking over the page)
  let hadController = !!sw.controller;

  const showUpdateNotice = (registration) => {
    if (!sw.controller || stale || document.getElementById(NOTICE_ID)) return;
    fillNotice(noticeBar(NOTICE_ID), 'En ny version av appen finns. Ladda om när det passar.', () => {
      const waiting = registration.waiting;
      if (!waiting) { location.reload(); return; }
      reloadRequested = true;
      waiting.postMessage({ type: 'SKIP_WAITING' });
    });
  };

  // Another tab installed a newer version (or this page runs older files than
  // the service worker): the page must not mix its modules with the new ones
  const showStalePrompt = () => {
    const bar = noticeBar(NOTICE_ID);
    bar.setAttribute('role', 'alert');
    bar.style.background = '#9a3412';
    bar.style.bottom = '';
    bar.style.top = 'calc(12px + env(safe-area-inset-top, 0px))';
    fillNotice(bar, 'Ny version av appen är installerad. Spara pågående arbete och ladda om.', () => location.reload());
  };

  const handleWorkerVersion = (workerVersion) => {
    const reasons = busyReasons();
    const action = decideOnNewVersion({ busyReasons: reasons, reloadedFor: readSession(RELOADED_FOR_KEY), version: workerVersion });
    stale = true;
    if (action === 'reload') {
      writeSession(RELOADED_FOR_KEY, workerVersion);
      location.reload();
      return;
    }
    console.info('[appUpdate] Ny version', workerVersion, '– väntar på omladdning:', reasons.join(', ') || 'redan omladdad');
    showStalePrompt();
  };

  sw.addEventListener('controllerchange', async () => {
    // This tab pressed "Ladda om"
    if (reloadRequested) { location.reload(); return; }
    const previous = hadController;
    hadController = true;
    const workerVersion = await exchangeVersion(sw.controller);
    if (isOtherVersion(APP_VERSION, workerVersion)) {
      handleWorkerVersion(workerVersion);
    } else if (!workerVersion && previous) {
      // No answer from a replacing worker (an older one without versions): to be safe
      handleWorkerVersion('unknown');
    }
  });

  let lastCheckAt = null;
  const checkForUpdate = (registration) => {
    const now = Date.now();
    if (!shouldCheckForUpdate({ now, lastCheckAt, online: navigator.onLine, hidden: document.visibilityState === 'hidden' })) return;
    lastCheckAt = now;
    registration.update().catch((error) => console.warn('[appUpdate] Kunde inte söka efter ny version:', error));
  };

  const register = () => {
    sw.register('./service-worker.js', { scope: './' })
      .then(async (registration) => {
        console.log('ServiceWorker (DriveLive) registrerad:', registration.scope);
        // Registering checks for a new version already
        lastCheckAt = Date.now();
        if (registration.waiting) showUpdateNotice(registration);
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed') showUpdateNotice(registration);
          });
        });

        // A tab open all day finds new deploys: now and then, and when shown
        // again or back online
        setInterval(() => checkForUpdate(registration), UPDATE_CHECK_INTERVAL_MS);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') checkForUpdate(registration);
        });
        window.addEventListener('online', () => checkForUpdate(registration));

        // The service worker learns which version this tab runs (it keeps that
        // version's files while the tab is open). Older files than the worker's
        // with no new version waiting: the page is out of date
        if (sw.controller) {
          const workerVersion = await exchangeVersion(sw.controller);
          if (isOtherVersion(APP_VERSION, workerVersion) && !registration.waiting && !stale) {
            handleWorkerVersion(workerVersion);
          }
        }
      })
      .catch((error) => {
        console.warn('ServiceWorker-registrering misslyckades:', error);
      });
  };

  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
