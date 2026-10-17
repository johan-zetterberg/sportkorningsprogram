// Decisions for finding and applying a new version of the app (js/appUpdate.js).
// Pure functions: no DOM, no service worker, so they can be unit tested.

// How often an open tab asks the server for a new version (officials keep the
// app open all day), and the shortest gap between two checks (showing the tab
// again or getting signal back also checks)
export const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
export const MIN_UPDATE_CHECK_GAP_MS = 10 * 60 * 1000;

/** Whether to call registration.update() now: never offline or in a hidden tab, at most once per gap */
export function shouldCheckForUpdate({ now, lastCheckAt = null, online = true, hidden = false, minGapMs = MIN_UPDATE_CHECK_GAP_MS } = {}) {
  if (!online || hidden) return false;
  if (!Number.isFinite(lastCheckAt)) return true;
  return now - lastCheckAt >= minGapMs;
}

/** Whether the service worker runs another version than the page ('' = unknown, not another) */
export function isOtherVersion(pageVersion, workerVersion) {
  return !!workerVersion && workerVersion !== pageVersion;
}

/**
 * What a tab does when a newer version has taken over: 'reload' when nothing
 * would be lost, 'prompt' (ask the user to reload) when the page has unsaved
 * work or a running clock, or when this tab already reloaded once for this
 * version (no reload loop).
 */
export function decideOnNewVersion({ busyReasons = [], reloadedFor = null, version = '' } = {}) {
  if (busyReasons.length > 0) return 'prompt';
  if (reloadedFor && reloadedFor === version) return 'prompt';
  return 'reload';
}

const NON_TEXT_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image', 'hidden']);

/** Whether the focused element is a field the user may be typing in */
export function isEditingElement(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = String(el.tagName || '').toUpperCase();
  if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return false;
  if (el.disabled || el.readOnly) return false;
  if (tag === 'INPUT' && NON_TEXT_INPUT_TYPES.has(String(el.type || 'text').toLowerCase())) return false;
  return true;
}
