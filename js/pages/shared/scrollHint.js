// A visible hint on wide result tables: while columns are cut off at the right
// the wrapper gets data-scroll-more="right" (a shadow at the right edge, CSS
// .scroll-hint-wrap in css/style.css) and the hint text below is shown.

/** Whether a scroll host has more content to the right */
export function hasMoreToTheRight({ scrollLeft = 0, clientWidth = 0, scrollWidth = 0 } = {}) {
    return scrollWidth - clientWidth - scrollLeft > 4;
}

// One resize listener for every hint; entries whose table left the page are dropped
const entries = new Map(); // scrollEl -> update
let resizeBound = false;

function onResize() {
    entries.forEach((update, scrollEl) => {
        if (!scrollEl.isConnected) entries.delete(scrollEl);
        else update();
    });
}

/**
 * Keeps the hint in sync with the scroll host. Call again after re-rendering
 * the table. Returns a cleanup.
 */
export function attachScrollHint(wrapEl, scrollEl, hintEl = null) {
    if (!wrapEl || !scrollEl) return () => { };
    wrapEl.classList.add('scroll-hint-wrap');
    const update = () => {
        if (hasMoreToTheRight(scrollEl)) wrapEl.dataset.scrollMore = 'right';
        else delete wrapEl.dataset.scrollMore;
        if (hintEl) hintEl.dataset.visible = scrollEl.scrollWidth - scrollEl.clientWidth > 4 ? '1' : '0';
    };
    const cleanup = () => {
        scrollEl.removeEventListener('scroll', update);
        entries.delete(scrollEl);
    };
    if (!entries.has(scrollEl)) scrollEl.addEventListener('scroll', update, { passive: true });
    entries.set(scrollEl, update);
    if (!resizeBound && typeof window !== 'undefined') {
        window.addEventListener('resize', onResize, { passive: true });
        resizeBound = true;
    }
    // After layout (the table's width is known a frame later)
    requestAnimationFrame(update);
    return cleanup;
}

/** The hint text under a table (hidden until the table is wider than its box) */
export function scrollHintTextHtml(text, id = '') {
    return `<div ${id ? `id="${id}" ` : ''}class="scroll-hint-text items-center justify-end gap-1.5 px-3 py-1 text-xs text-gray-600 dark:text-gray-300" data-visible="0" aria-hidden="true"><span>${text}</span><i class="fas fa-arrows-left-right"></i></div>`;
}
