// A listener error hands the callback `fallbackValue` (older callers), or, when
// `onError` is given, only reports the error: the caller then keeps its last
// good data (an empty list would wipe the screen) and can subscribe again.
export function buildSnapshotErrorHandler(name, callback, fallbackValue, onError = null) {
  return (error) => {
    console.error(`${name} listener error:`, error);
    if (typeof onError === 'function') {
      try { onError(error); } catch (e) { console.error(`${name} onError failed:`, e); }
      return;
    }
    if (typeof callback === 'function') {
      callback(fallbackValue);
    }
  };
}

// Waits before each new subscription after an error (the last one repeats)
export const RESILIENT_BACKOFF_MS = Object.freeze([2000, 5000, 15000, 30000, 60000]);

export function resilientBackoffMs(attempt, steps = RESILIENT_BACKOFF_MS) {
  if (!Array.isArray(steps) || steps.length === 0) return 0;
  const i = Math.max(0, Math.min(steps.length - 1, Math.floor(Number(attempt) || 0)));
  return steps[i];
}

/**
 * A listener that does not stay dead after an error (a Firestore listener
 * stops for good once its error callback has run). On an error the last good
 * data stays where it is, onStatus({ ok: false, retryInMs }) is called, and the
 * listener subscribes again after a growing wait; the first data after that
 * calls onStatus({ ok: true }).
 *
 * subscribe(onNext, onError) starts one listener and returns its unsubscribe.
 * onData(value, { fresh }) gets every value; `fresh` is true for the first one
 * of each subscription (a docChanges() reader should rebuild from all docs).
 * Returns stop().
 */
export function resilientSnapshot({
  name = 'listener',
  subscribe,
  onData,
  onStatus = null,
  backoffMs = RESILIENT_BACKOFF_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) {
  let stopped = false;
  let attempt = 0;
  let failing = false;
  let unsub = null;
  let timer = null;
  let generation = 0;

  const status = (value) => {
    try { onStatus?.(value); } catch (e) { console.error(`${name} onStatus failed:`, e); }
  };

  const dropCurrent = () => {
    const u = unsub;
    unsub = null;
    if (typeof u === 'function') {
      try { u(); } catch { /* already gone */ }
    }
  };

  const start = () => {
    if (stopped) return;
    const myGen = ++generation;
    let first = true;
    const onNext = (value) => {
      if (stopped || myGen !== generation) return;
      const fresh = first;
      first = false;
      if (failing) {
        failing = false;
        attempt = 0;
        status({ ok: true });
      }
      onData?.(value, { fresh });
    };
    const onError = (error) => {
      if (stopped || myGen !== generation) return;
      console.error(`${name} listener error (försöker igen):`, error);
      generation++;
      dropCurrent();
      const retryInMs = resilientBackoffMs(attempt, backoffMs);
      attempt++;
      failing = true;
      status({ ok: false, error, retryInMs, attempt });
      timer = setTimer(() => { timer = null; start(); }, retryInMs);
    };
    try {
      unsub = subscribe(onNext, onError);
    } catch (error) {
      onError(error);
    }
  };

  start();

  return () => {
    stopped = true;
    if (timer != null) { clearTimer(timer); timer = null; }
    dropCurrent();
  };
}

export const CONNECTION_LOST_TEXT = 'Tappade kontakten – försöker igen';

/**
 * A small banner over a page while one or more of its listeners are failing.
 * getHost() returns the element to put it in (looked up each time: pages
 * re-render). update(name, status) takes resilientSnapshot's status.
 */
export function createConnectionBanner(getHost, { text = CONNECTION_LOST_TEXT } = {}) {
  const failing = new Set();
  let el = null;

  const render = () => {
    if (failing.size === 0) {
      el?.remove();
      el = null;
      return;
    }
    const host = typeof getHost === 'function' ? getHost() : null;
    if (!host) return;
    if (!el || !host.contains(el)) {
      el?.remove();
      el = document.createElement('div');
      el.setAttribute('role', 'status');
      el.dataset.connectionBanner = '1';
      el.className = 'mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100';
      el.textContent = `⚠️ ${text}`;
      host.prepend(el);
    }
  };

  return {
    update(name, value) {
      if (value?.ok === false) failing.add(name);
      else failing.delete(name);
      render();
    },
    clear() {
      failing.clear();
      render();
    }
  };
}
