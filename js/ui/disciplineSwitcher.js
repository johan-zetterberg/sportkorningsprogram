// The discipline row above the results, live monitor and secretariat pages:
// Dressyr · Maraton · Precision (· Totalt for results), the page shown marked
// and the competition's current discipline flagged "i dag". One tap moves to
// the same kind of page for another discipline.

import { t } from '../utils/i18n.js';
import { escapeHtml } from '../utils/sharedUtils.js';
import { canOpenPage } from '../utils/roleAccess.js';
import { ensureRouteBannerHost } from './fieldMessages.js';
import { getCurrentPhase } from './bottomNav.js';
import { PHASE_PAGES, phaseFamily } from './bottomNavUtils.js';

const PHASE_LABELS = { dressage: 'menu_dressage', marathon: 'menu_marathon', precision: 'menu_precision', total: 'bottom_nav_total' };

let roles = ['publik'];
let pageKey = '';

function render() {
    const host = ensureRouteBannerHost('disciplineSwitcherHost');
    if (!host) return;
    const family = phaseFamily(pageKey);
    const links = family
        ? Object.entries(PHASE_PAGES)
            .map(([phase, pages]) => ({ phase, page: pages[family] }))
            // Secretariat "total" is the precision page again: not twice
            .filter(({ phase, page }) => page && !(family === 'secretariat' && phase === 'total'))
            .filter(({ page }) => canOpenPage(page, roles))
        : [];
    if (links.length < 2) {
        host.innerHTML = '';
        return;
    }
    const today = getCurrentPhase();
    host.innerHTML = `
        <nav class="discipline-switcher" data-tab-overflow aria-label="${escapeHtml(t('discipline_switcher_label'))}">
            ${links.map(({ phase, page }) => `
                <a href="#${page}" class="discipline-chip"${page === pageKey ? ' aria-current="page"' : ''}>
                    ${escapeHtml(t(PHASE_LABELS[phase]))}${phase === today ? `<span class="discipline-chip-today">${escapeHtml(t('discipline_today'))}</span>` : ''}
                </a>`).join('')}
        </nav>`;
}

export function initDisciplineSwitcher() {
    document.addEventListener('app-route-change', (event) => {
        pageKey = String(event.detail?.pageKey || '').replace(/^#/, '').split('?')[0];
        render();
    });
    document.addEventListener('app-roles-change', (event) => {
        roles = event.detail?.signedIn ? (event.detail?.roles || ['publik']) : ['publik'];
        render();
    });
    // The current discipline comes with the competition's start times
    document.addEventListener('app-phase-change', render);
}
