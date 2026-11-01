// Phones: the header and the bottom bar slide away while the page scrolls down
// and come back on the way up (and at the top and the bottom of the page), so
// a result list gets the whole screen. body.chrome-hidden, css/app-shell.css.

const PHONE_QUERY = '(max-width: 767px)';
const SHOW_NEAR_TOP = 80;     // px: always shown at the top of the page
const HIDE_AFTER = 120;       // px scrolled before it may hide
const MIN_STEP = 8;           // px per scroll event that counts as a direction
const NEAR_BOTTOM = 40;       // px: shown again at the end of the page

let lastY = 0;
let ticking = false;

function setHidden(hidden, { instant = false } = {}) {
    const body = document.body;
    if (!body) return;
    if (instant) {
        body.classList.add('chrome-instant');
        body.classList.toggle('chrome-hidden', hidden);
        void body.offsetHeight; // apply without the slide before the next read
        body.classList.remove('chrome-instant');
        return;
    }
    body.classList.toggle('chrome-hidden', hidden);
}

function menuOpen() {
    const links = document.getElementById('nav-links');
    return !!links && !links.classList.contains('hidden');
}

function update() {
    ticking = false;
    const y = Math.max(0, window.scrollY || document.documentElement.scrollTop || 0);
    const dy = y - lastY;
    if (!window.matchMedia(PHONE_QUERY).matches || menuOpen()) {
        setHidden(false);
        lastY = y;
        return;
    }
    const doc = document.documentElement;
    const atBottom = window.innerHeight + y >= doc.scrollHeight - NEAR_BOTTOM;
    if (y < SHOW_NEAR_TOP || atBottom) {
        setHidden(false);
    } else if (dy > MIN_STEP && y > HIDE_AFTER) {
        setHidden(true);
    } else if (dy < -MIN_STEP) {
        setHidden(false);
    } else {
        return; // too small a step: keep lastY so slow scrolling adds up
    }
    lastY = y;
}

export function showChrome() {
    setHidden(false, { instant: true });
    lastY = Math.max(0, window.scrollY || 0);
}

export function initScrollChrome() {
    lastY = Math.max(0, window.scrollY || 0);
    window.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(update);
    }, { passive: true });
    // The menu sheet hangs under the header: in place before the menu measures it
    document.addEventListener('click', (event) => {
        if (event.target?.closest?.('#menu-toggle, [data-bottom-nav-menu]')) showChrome();
    }, true);
    // A new page and a change of orientation start with the header and the bar in view
    document.addEventListener('app-route-change', showChrome);
    window.addEventListener('orientationchange', showChrome);
    window.matchMedia(PHONE_QUERY).addEventListener?.('change', showChrome);
}
