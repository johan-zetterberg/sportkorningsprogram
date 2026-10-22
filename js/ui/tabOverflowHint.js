// A tab bar that scrolls sideways shows it: a fade at the edge that has more
// tabs behind it (CSS .tab-overflow-right / .tab-overflow-left in
// css/app-shell.css). Mark the scrolling element with data-tab-overflow; the
// hint follows scrolling, resizing and pages that rebuild their markup.

/** Which edges have more content behind them (pure) */
export function tabOverflowEdges({ scrollLeft = 0, clientWidth = 0, scrollWidth = 0 } = {}) {
    const max = Math.max(0, scrollWidth - clientWidth);
    return { left: max > 4 && scrollLeft > 4, right: max > 4 && max - scrollLeft > 4 };
}

function update(el) {
    const edges = tabOverflowEdges(el);
    el.classList.toggle('tab-overflow-right', edges.right);
    el.classList.toggle('tab-overflow-left', edges.left);
}

let bound = false;
let timer = null;

function scan(root = document) {
    root.querySelectorAll('[data-tab-overflow]').forEach((el) => {
        if (!el.__tabOverflowBound) {
            el.__tabOverflowBound = true;
            el.addEventListener('scroll', () => update(el), { passive: true });
        }
        update(el);
    });
}

function scheduleScan() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; scan(); }, 120);
}

export function initTabOverflowHints() {
    if (bound || typeof document === 'undefined') return;
    bound = true;
    window.addEventListener('resize', scheduleScan, { passive: true });
    document.addEventListener('app-route-change', scheduleScan);
    // Pages draw their tab bars after the route change (and again on re-render)
    const main = document.querySelector('main');
    if (main && typeof MutationObserver === 'function') {
        new MutationObserver(scheduleScan).observe(main, { childList: true, subtree: true });
    }
    scan();
}
