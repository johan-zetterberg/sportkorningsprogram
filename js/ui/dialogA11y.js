// js/ui/dialogA11y.js
// Modal dialog semantics and keyboard handling for the result modals, the same
// pattern as the quick guide drawer: role="dialog" + aria-modal, focus moved in
// on open, Tab/Shift+Tab kept inside, Escape closes, focus back on close.

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'select:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

// Open dialogs, newest last: only the top one handles keys
const openDialogs = [];

/**
 * Where Tab should move focus to keep it inside a dialog, or null to let the
 * browser move it. count: focusable elements, index: the focused one's index
 * (-1 when focus is outside the dialog), backwards: Shift+Tab.
 */
export function wrapFocusIndex(count, index, backwards) {
  if (!count) return -1;
  if (index < 0) return backwards ? count - 1 : 0;
  if (backwards && index === 0) return count - 1;
  if (!backwards && index === count - 1) return 0;
  return null;
}

export function focusableElements(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter((el) => {
    if (el.closest('[hidden]') || el.getAttribute('aria-hidden') === 'true') return false;
    // Not rendered (display:none or inside a closed part)
    return typeof el.getClientRects !== 'function' || el.getClientRects().length > 0;
  });
}

function resolveElement(root, target) {
  if (!target) return null;
  if (typeof target === 'string') return root.querySelector(target);
  return target;
}

function topDialog() {
  return openDialogs[openDialogs.length - 1] || null;
}

function onDocumentKeyDown(event) {
  const entry = topDialog();
  if (!entry) return;
  // Removed or hidden by other code (e.g. a page unload) without release()
  const hidden = typeof entry.root.getClientRects === 'function' && entry.root.getClientRects().length === 0;
  if (!entry.root.isConnected || hidden) {
    entry.release({ restoreFocus: false });
    onDocumentKeyDown(event);
    return;
  }

  if (event.key === 'Escape') {
    if (typeof entry.onEscape === 'function') {
      event.preventDefault();
      event.stopPropagation();
      entry.onEscape(event);
    }
    return;
  }

  if (event.key !== 'Tab') return;
  const items = focusableElements(entry.panel);
  const active = document.activeElement;
  const target = wrapFocusIndex(items.length, items.indexOf(active), event.shiftKey);
  if (target === -1) {
    event.preventDefault();
    entry.panel.focus();
  } else if (target !== null) {
    event.preventDefault();
    items[target].focus();
  } else if (!entry.panel.contains(active)) {
    event.preventDefault();
    items[0].focus();
  }
}

/**
 * Makes root a modal dialog until the returned release() is called.
 * options:
 *   labelledBy   id of the dialog's title (aria-labelledby)
 *   label        aria-label when there is no title element
 *   panel        the element focus is kept in (default root)
 *   initialFocus element or selector focused on open (default: the first
 *                focusable element, else the panel)
 *   onEscape     called on Escape (typically the dialog's own close function)
 *   role         'dialog' (default) or 'alertdialog'
 * Activating a dialog that is already open keeps its first opener for focus
 * return and only updates the options.
 */
export function activateDialog(root, options = {}) {
  if (!root || typeof document === 'undefined') return () => { };
  const existing = openDialogs.find((entry) => entry.root === root);
  if (existing) {
    Object.assign(existing, {
      onEscape: options.onEscape || existing.onEscape,
      panel: options.panel || existing.panel
    });
    applyAttributes(root, options);
    // Content loaded after opening: move focus in unless the user already did
    const active = document.activeElement;
    if (active === existing.panel || !existing.panel.contains(active)) focusInitial(existing.panel, options.initialFocus);
    return existing.release;
  }

  const panel = options.panel || root;
  const previous = document.activeElement;
  applyAttributes(root, options);
  if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');

  const entry = { root, panel, onEscape: options.onEscape, release: null };
  entry.release = ({ restoreFocus = true } = {}) => {
    const index = openDialogs.indexOf(entry);
    if (index === -1) return;
    openDialogs.splice(index, 1);
    if (!openDialogs.length) document.removeEventListener('keydown', onDocumentKeyDown, true);
    // With another dialog still open, focus only goes back if the opener is in it
    const top = topDialog();
    const allowed = !top || top.root.contains(previous);
    if (restoreFocus && allowed && previous && previous.isConnected && typeof previous.focus === 'function') {
      try { previous.focus(); } catch (_) { }
    }
  };

  if (!openDialogs.length) document.addEventListener('keydown', onDocumentKeyDown, true);
  openDialogs.push(entry);
  focusInitial(panel, options.initialFocus);
  return entry.release;
}

function applyAttributes(root, options) {
  root.setAttribute('role', options.role || root.getAttribute('role') || 'dialog');
  root.setAttribute('aria-modal', 'true');
  if (options.labelledBy) {
    root.setAttribute('aria-labelledby', options.labelledBy);
    root.removeAttribute('aria-label');
  } else if (options.label) {
    root.setAttribute('aria-label', options.label);
  }
}

function focusInitial(panel, initialFocus) {
  const run = () => {
    if (!panel.isConnected) return;
    const target = resolveElement(panel, initialFocus) || focusableElements(panel)[0] || panel;
    try { target.focus({ preventScroll: true }); } catch (_) { try { target.focus(); } catch (__) { } }
  };
  // After the opening transition has made the dialog visible
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else run();
}

/** Releases the dialog on root, if it is open (e.g. when a page closes it) */
export function releaseDialog(root, options) {
  openDialogs.find((entry) => entry.root === root)?.release(options);
}
