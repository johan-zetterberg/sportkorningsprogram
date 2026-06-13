/**
 * Shared helper for the fixed window-level x-scrollbar.
 * Used by dressyr-resultat, maraton-resultat, precision-resultat, total-resultat, etc.
 */

export function injectScrollStyles() {
    if (document.getElementById('shared-scroll-styles')) return;
    const style = document.createElement('style');
    style.id = 'shared-scroll-styles';
    style.textContent = `
      body.has-fixed-xbar {
        padding-bottom: 22px;
        overflow-x: hidden;
      }
      
      /* Hide native scrollbars on the wrapper but allow scrolling */
      .x-scroll-wrap {
        overflow-x: auto !important;
        overflow-y: visible !important;
        max-height: none;
        -ms-overflow-style: none;  /* IE/Edge */
        scrollbar-width: none;     /* Firefox */
      }
      .x-scroll-wrap::-webkit-scrollbar { height: 0; width: 0; } /* WebKit */
  
      .fixed-xbar {
        position: fixed; bottom: 0; left: 0; right: 0;
        width: auto;
        max-width: 100vw;
        box-sizing: border-box;
        background: rgba(255,255,255,0.9);
        backdrop-filter: blur(2px);
        border-top: 1px solid #e5e7eb;
        overflow-x: auto;
        overflow-y: hidden;
        z-index: 50;
        display: none; /* Hidden by default, shown via JS or media queries */
      }
      .fixed-xbar-inner {
        height: 16px;
        min-width: 100%;
      }
      
      /* Show bar on desktop/non-touch usually */
      @media (min-width: 768px), (orientation: landscape) and (hover: none) {
        .fixed-xbar { display: block; }
      }
    `;
    document.head.appendChild(style);
}

function injectStickyHeaderCloneStyles() {
    if (document.getElementById('shared-sticky-header-clone-styles')) return;
    const style = document.createElement('style');
    style.id = 'shared-sticky-header-clone-styles';
    style.textContent = `
      .viewport-sticky-header-clone {
        position: fixed;
        top: 0;
        left: 0;
        z-index: 45;
        display: none;
        pointer-events: none;
        overflow: hidden;
        background: transparent;
      }
      .viewport-sticky-header-clone table {
        margin: 0;
      }
      .viewport-sticky-header-clone th {
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);
}

function getStickyTopOffset() {
    const nav = document.querySelector('nav.sticky');
    const offlineBanner = document.getElementById('offline-banner');
    const navStyle = nav ? getComputedStyle(nav) : null;
    const bannerStyle = offlineBanner ? getComputedStyle(offlineBanner) : null;
    const navHeight = nav && navStyle && (navStyle.position === 'sticky' || navStyle.position === 'fixed')
        ? nav.getBoundingClientRect().height
        : 0;
    const bannerHeight = offlineBanner && bannerStyle && bannerStyle.display !== 'none'
        && (bannerStyle.position === 'sticky' || bannerStyle.position === 'fixed')
        ? offlineBanner.getBoundingClientRect().height
        : 0;
    return Math.round(navHeight + bannerHeight);
}

export function teardownViewportStickyTableHeader() {
    try { window.__teardownViewportStickyTableHeader?.(); } catch {}
    window.__teardownViewportStickyTableHeader = undefined;
}

export function setupViewportStickyTableHeader({ tableEl, scrollHostEl = null }) {
    teardownViewportStickyTableHeader();
    if (!tableEl?.tHead) return () => {};

    injectStickyHeaderCloneStyles();

    const cloneEl = document.createElement('div');
    cloneEl.className = 'viewport-sticky-header-clone';

    const cloneTable = document.createElement('table');
    cloneTable.className = tableEl.className;
    cloneEl.appendChild(cloneTable);
    document.body.appendChild(cloneEl);

    const syncClone = () => {
        if (!tableEl.isConnected || !tableEl.tHead) {
            cloneEl.style.display = 'none';
            return;
        }

        const thead = tableEl.tHead;
        const tableRect = tableEl.getBoundingClientRect();
        const headRect = thead.getBoundingClientRect();
        const topOffset = getStickyTopOffset();
        const shouldShow = tableRect.top < topOffset && tableRect.bottom - headRect.height > topOffset;

        if (!shouldShow || tableRect.width <= 0) {
            cloneEl.style.display = 'none';
            return;
        }

        cloneEl.style.display = 'block';
        cloneEl.style.top = `${topOffset}px`;
        cloneEl.style.left = `${Math.round(tableRect.left)}px`;
        cloneEl.style.width = `${Math.round(tableRect.width)}px`;

        const sourceHeaderHtml = thead.outerHTML;
        if (cloneTable.dataset.headerHtml !== sourceHeaderHtml) {
            cloneTable.innerHTML = sourceHeaderHtml;
            cloneTable.dataset.headerHtml = sourceHeaderHtml;
        }

        cloneTable.style.width = `${Math.round(tableRect.width)}px`;

        const sourceThs = Array.from(thead.querySelectorAll('th'));
        const cloneThs = Array.from(cloneTable.querySelectorAll('th'));
        sourceThs.forEach((th, index) => {
            const width = th.getBoundingClientRect().width;
            if (!cloneThs[index]) return;
            cloneThs[index].style.width = `${Math.round(width)}px`;
            cloneThs[index].style.minWidth = `${Math.round(width)}px`;
            cloneThs[index].style.maxWidth = `${Math.round(width)}px`;
        });
    };

    const updateAll = () => syncClone();
    const scrollTarget = scrollHostEl || window;

    window.addEventListener('scroll', updateAll, { passive: true });
    window.addEventListener('resize', updateAll);
    window.addEventListener('orientationchange', updateAll);
    if (scrollHostEl) {
        scrollHostEl.addEventListener('scroll', updateAll, { passive: true });
    }

    const ro = new ResizeObserver(updateAll);
    ro.observe(tableEl);
    if (scrollHostEl) ro.observe(scrollHostEl);

    updateAll();

    const teardown = () => {
        try { window.removeEventListener('scroll', updateAll); } catch {}
        try { window.removeEventListener('resize', updateAll); } catch {}
        try { window.removeEventListener('orientationchange', updateAll); } catch {}
        if (scrollHostEl) {
            try { scrollHostEl.removeEventListener('scroll', updateAll); } catch {}
        }
        try { ro.disconnect(); } catch {}
        try { cloneEl.remove(); } catch {}
        if (window.__teardownViewportStickyTableHeader === teardown) {
            window.__teardownViewportStickyTableHeader = undefined;
        }
    };

    window.__teardownViewportStickyTableHeader = teardown;
    return teardown;
}

export function initializeScrollSync(ownerPath) {
    // Teardown any existing sync
    window.__teardownXbarSync?.();
    window.__teardownXbarSync = undefined;

    // Remove bars from other pages
    document.querySelectorAll('.fixed-xbar').forEach(el => {
        const owner = el.getAttribute('data-owner');
        if (owner && owner !== ownerPath) {
            try { el.remove(); } catch {}
        }
    });

    // Define the setup function globally if needed, or return it
    window.__setupXbarSync = function({ barClass = 'fixed-xbar', innerId = 'xbar-inner', hostEl }) {
        // Ensure teardown of previous instance
        window.__teardownXbarSync?.();

        let bar = document.querySelector(`.${barClass}`);
        if (!bar) {
            bar = document.createElement('div');
            bar.className = barClass;
            bar.setAttribute('data-owner', ownerPath);
            
            const inner = document.createElement('div');
            inner.id = innerId;
            inner.className = 'fixed-xbar-inner';
            bar.appendChild(inner);
            document.body.appendChild(bar);
        }

        const inner = bar.firstElementChild;
        document.body.classList.add('has-fixed-xbar');

        // Determine scroller
        const isDoc = (el) => (el === document.scrollingElement) || (el === document.documentElement) || (el === document.body) || (el == null);
        const scroller = hostEl || document.documentElement;

        const updateWidth = () => {
            // Calculate content width
            let contentWidth = 0;
            if (hostEl) {
                // If host is a wrapper, check its children (tables)
                const tables = hostEl.querySelectorAll('table');
                const maxTableWidth = [...tables].reduce((m, t) => Math.max(m, t.scrollWidth || 0), 0);
                contentWidth = Math.max(hostEl.scrollWidth || 0, maxTableWidth);
            } else {
                // Document level
                contentWidth = Math.max(
                    document.body.scrollWidth,
                    document.documentElement.scrollWidth,
                    window.innerWidth
                );
            }
            
            // Ensure we cover the viewport
            contentWidth = Math.max(contentWidth, window.innerWidth || 0);

            const hostClientWidth = hostEl ? hostEl.clientWidth : window.innerWidth;
            const hostMax = Math.max(0, contentWidth - hostClientWidth);
            
            // The inner width must be large enough to create the same scroll range
            inner.style.width = (bar.clientWidth + hostMax) + 'px';
        };

        updateWidth();

        let locking = false;
        const lock = (fn) => (...args) => { if (locking) return; locking = true; try { fn(...args); } finally { locking = false; } };

        const getHostScroll = () => isDoc(scroller) ? (window.scrollX || document.documentElement.scrollLeft) : scroller.scrollLeft;
        const setHostScroll = (x) => {
            if (isDoc(scroller)) {
                window.scrollTo({ left: x, behavior: 'auto' });
            } else {
                scroller.scrollLeft = x;
            }
        };

        const onBarScroll = lock(() => setHostScroll(bar.scrollLeft));
        const onHostScroll = lock(() => { bar.scrollLeft = getHostScroll(); });

        bar.addEventListener('scroll', onBarScroll, { passive: true });
        (isDoc(scroller) ? window : scroller).addEventListener('scroll', onHostScroll, { passive: true });
        window.addEventListener('resize', updateWidth);
        
        const ro = new ResizeObserver(updateWidth);
        if (hostEl) ro.observe(hostEl);
        document.querySelectorAll('table').forEach(t => ro.observe(t));

        // Teardown function
        window.__teardownXbarSync = () => {
            try { bar.removeEventListener('scroll', onBarScroll); } catch {}
            try { (isDoc(scroller) ? window : scroller).removeEventListener('scroll', onHostScroll); } catch {}
            try { window.removeEventListener('resize', updateWidth); } catch {}
            try { ro.disconnect(); } catch {}
            try { bar.remove(); } catch {}
            document.body.classList.remove('has-fixed-xbar');
            window.__teardownXbarSync = undefined;
        };

        window.addEventListener('beforeunload', () => window.__teardownXbarSync?.(), { once: true });
    };
}
