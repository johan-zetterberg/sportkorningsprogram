/**
 * Shared helper for the fixed window-level x-scrollbar.
 * Used by dressyr-resultat, maraton-resultat, precision-resultat, total-resultat, etc.
 */

export function injectScrollStyles() {
    if (document.getElementById('shared-scroll-styles')) return;
    const style = document.createElement('style');
    style.id = 'shared-scroll-styles';
    style.textContent = `
      body.has-fixed-xbar { padding-bottom: 22px; }
      
      /* Hide native scrollbars on the wrapper but allow scrolling */
      .x-scroll-wrap {
        overflow-x: auto !important;
        -ms-overflow-style: none;  /* IE/Edge */
        scrollbar-width: none;     /* Firefox */
      }
      .x-scroll-wrap::-webkit-scrollbar { height: 0; } /* WebKit */
  
      .fixed-xbar {
        position: fixed; bottom: 0; left: 0; width: 100%;
        background: rgba(255,255,255,0.9);
        backdrop-filter: blur(2px);
        border-top: 1px solid #e5e7eb;
        overflow-x: auto;
        z-index: 50;
        display: none; /* Hidden by default, shown via JS or media queries */
      }
      .fixed-xbar-inner { height: 16px; }
      
      /* Show bar on desktop/non-touch usually */
      @media (min-width: 768px), (orientation: landscape) and (hover: none) {
        .fixed-xbar { display: block; }
      }
    `;
    document.head.appendChild(style);
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
