// Phones: a page's search, sorting and filter controls fold behind one
// "Filter" button, so the list starts near the top of the screen. On wider
// screens the button is hidden and the controls show as before. Styles in
// css/app-shell.css (.phone-filter-bar, .phone-collapsible-panel).

import { t } from '../utils/i18n.js';
import { escapeHtml } from '../utils/sharedUtils.js';

/**
 * panel: the element holding the controls. A bar with the button goes in
 * front of it (once; calling again only refreshes the count and the extra
 * HTML). extraHtml: more for the bar, e.g. the Kompakt | Kort toggle.
 * activeCount(): how many filters are set, shown on the button.
 * Returns the bar element.
 */
export function phoneCollapsibleFilters(panel, { id, extraHtml = '', activeCount = null } = {}) {
    if (!panel || !panel.parentNode) return null;
    const panelId = panel.id || (panel.id = `${id || 'page'}-filters`);
    panel.classList.add('phone-collapsible-panel');

    let bar = panel.previousElementSibling;
    if (!bar || !bar.classList.contains('phone-filter-bar') || bar.dataset.for !== panelId) {
        bar = document.createElement('div');
        bar.className = 'phone-filter-bar';
        bar.dataset.for = panelId;
        bar.innerHTML = `<button type="button" class="phone-filter-toggle" aria-expanded="false" aria-controls="${escapeHtml(panelId)}">
            <span>${escapeHtml(t('phone_filters_toggle'))}</span><span class="phone-filter-count" hidden></span>
            <svg class="phone-filter-caret" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd"/></svg>
        </button><div class="phone-filter-extra"></div>`;
        panel.parentNode.insertBefore(bar, panel);
        const toggle = bar.querySelector('.phone-filter-toggle');
        toggle.addEventListener('click', () => {
            const open = !panel.classList.contains('is-open');
            panel.classList.toggle('is-open', open);
            toggle.setAttribute('aria-expanded', String(open));
        });
    }

    const extra = bar.querySelector('.phone-filter-extra');
    if (extra && extra.dataset.html !== extraHtml) {
        extra.innerHTML = extraHtml;
        extra.dataset.html = extraHtml;
    }
    refreshPhoneFilterCount(bar, activeCount);
    return bar;
}

/** Update the number on the button (0 or no function: hidden) */
export function refreshPhoneFilterCount(bar, activeCount) {
    const badge = bar?.querySelector('.phone-filter-count');
    if (!badge) return;
    let n = 0;
    try { n = Number(typeof activeCount === 'function' ? activeCount() : 0) || 0; } catch { n = 0; }
    badge.hidden = n <= 0;
    badge.textContent = n > 0 ? t('phone_filters_active').replace('{n}', String(n)) : '';
}
