// The phone result list: one row per equipage (place, start number, driver
// with the class under it, a few result columns), many more on a screen than
// the cards. A tap opens the equipage. The viewer picks one of three views and
// the phone remembers it:
//   compact  the main columns only, fits the screen
//   full     every part result too; the table scrolls sideways while place,
//            number and a shortened driver name stay put
//   cards    the page's cards
// Styles in css/app-shell.css (.compact-results).

import { t } from '../utils/i18n.js';
import { escapeHtml } from '../utils/sharedUtils.js';

const DENSITY_KEY = 'resultDensity';

const DENSITIES = ['compact', 'full', 'cards'];
const normalDensity = (value) => (DENSITIES.includes(value) ? value : 'compact');

/** 'compact' (the default), 'full' or 'cards' */
export function getResultDensity() {
    try {
        return normalDensity(localStorage.getItem(DENSITY_KEY));
    } catch {
        return 'compact';
    }
}

export function setResultDensity(value) {
    try {
        localStorage.setItem(DENSITY_KEY, normalDensity(value));
    } catch { /* private mode: the default stays */ }
}

/** Three buttons, Kompakt | Full | Kort; bindDensityToggle wires them */
export function densityToggleHtml() {
    const current = getResultDensity();
    const button = (value, key) => `<button type="button" data-result-density="${value}" aria-pressed="${current === value}">${escapeHtml(t(key))}</button>`;
    return `<div class="result-density-toggle" role="group" aria-label="${escapeHtml(t('result_density_label'))}">${button('compact', 'result_density_compact')}${button('full', 'result_density_full')}${button('cards', 'result_density_cards')}</div>`;
}

/** "Anna Maria Svensson" -> "A. M. Svensson": the full view's narrow driver column */
export function shortDriverName(name) {
    const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
    if (words.length < 2) return words[0] || '';
    // A trailing number or suffix ("Kusk 2", "Ek jr") keeps the word before it
    const keep = words.length > 2 && !/\p{L}{3}/u.test(words[words.length - 1]) ? 2 : 1;
    const tail = words.splice(words.length - keep, keep);
    return `${words.map((w) => `${[...w][0]}.`).join(' ')} ${tail.join(' ')}`;
}

/** Clicks on [data-result-density] inside root: store the choice, then onChange(value) */
export function bindDensityToggle(root, onChange) {
    if (!root || root.dataset.densityBound === '1') return;
    root.dataset.densityBound = '1';
    root.addEventListener('click', (event) => {
        const button = event.target.closest?.('[data-result-density]');
        if (!button || !root.contains(button)) return;
        const value = button.getAttribute('data-result-density');
        if (value === getResultDensity()) return;
        setResultDensity(value);
        root.querySelectorAll('[data-result-density]').forEach((b) => {
            b.setAttribute('aria-pressed', String(b.getAttribute('data-result-density') === value));
        });
        onChange?.(value);
    });
}

/**
 * columns: [{ key, label, title?, extra? }] the result columns after place,
 *   number and driver. Up to four main columns fit a phone held upright. The
 *   columns marked extra (the part results) show only in the full view
 *   (density 'full', the viewer's choice unless given): the table then scrolls
 *   sideways while place, number and the shortened driver name stay put.
 * scrollKey: names the list (e.g. the page) so a live redraw keeps the
 *   sideways position; see restoreCompactScroll
 * items: rows in display order, each either
 *   { type: 'group', label }                              a class heading
 *   { startNumber, place, name, sub, cells: { [key]: html }, state }
 *   cells are HTML the caller has escaped; place, name and sub are text.
 *   state: '' | 'live' | 'leader' | 'elim' (row tint)
 */
export function compactResultListHtml({ columns: allColumns = [], items = [], emptyText = '', scrollKey = '', density = getResultDensity() } = {}) {
    const wide = density === 'full' && allColumns.some((c) => c.extra);
    const columns = wide ? allColumns : allColumns.filter((c) => !c.extra);
    const numClass = (c) => (c.extra ? 'cr-num cr-extra' : 'cr-num');
    const head = `<thead><tr>
        <th scope="col" class="cr-place">${escapeHtml(t('compact_place'))}</th>
        <th scope="col" class="cr-sn">#</th>
        <th scope="col" class="cr-name">${escapeHtml(t('compact_driver'))}</th>
        ${columns.map((c) => `<th scope="col" class="${numClass(c)}"${c.title ? ` title="${escapeHtml(c.title)}"` : ''}>${escapeHtml(c.label)}</th>`).join('')}
    </tr></thead>`;
    const span = 3 + columns.length;
    const rows = items.map((item) => {
        if (item?.type === 'group') {
            return `<tr class="cr-group"><th scope="colgroup" colspan="${span}"><span>${escapeHtml(item.label ?? '')}</span></th></tr>`;
        }
        const sn = String(item.startNumber ?? '');
        const state = ['live', 'leader', 'elim'].includes(item.state) ? ` cr-${item.state}` : '';
        const place = item.place === null || item.place === undefined || item.place === '' ? '—' : String(item.place);
        return `<tr class="cr-row${state}" data-start="${escapeHtml(sn)}" tabindex="0" aria-label="${escapeHtml(t('compact_row_open').replace('{sn}', sn))}">
            <td class="cr-place">${escapeHtml(place)}</td>
            <td class="cr-sn">${escapeHtml(sn)}</td>
            <td class="cr-name"><span class="cr-driver"${wide ? ` title="${escapeHtml(item.name ?? '')}"` : ''}>${escapeHtml(wide ? shortDriverName(item.name) : (item.name ?? ''))}</span>${item.sub ? `<span class="cr-sub">${escapeHtml(item.sub)}</span>` : ''}</td>
            ${columns.map((c) => `<td class="${numClass(c)}">${item.cells?.[c.key] ?? '—'}</td>`).join('')}
        </tr>`;
    }).join('');
    const body = rows || `<tr><td class="cr-empty" colspan="${span}">${escapeHtml(emptyText)}</td></tr>`;
    if (!wide) return `<table class="compact-results">${head}<tbody>${body}</tbody></table>`;
    trackCompactScroll();
    return `<p class="cr-scroll-hint">${escapeHtml(t('compact_scroll_hint'))}</p>`
        + `<div class="cr-scroll"${scrollKey ? ` data-cr-key="${escapeHtml(scrollKey)}"` : ''}>`
        + `<table class="compact-results cr-wide">${head}<tbody>${body}</tbody></table></div>`;
}

// The sideways position of each wide list (by scrollKey), so a redraw from a
// live update does not throw the viewer back to the first columns
const scrollPositions = new Map();
let tracking = false;

function trackCompactScroll() {
    if (tracking || typeof document === 'undefined') return;
    tracking = true;
    // Scroll events do not bubble: listen in the capture phase
    document.addEventListener('scroll', (event) => {
        const el = event.target;
        const key = el?.dataset?.crKey;
        if (key && el.classList?.contains('cr-scroll')) scrollPositions.set(key, el.scrollLeft);
    }, { capture: true, passive: true });
}

/** After a wide list is drawn into root: put it back where the viewer had scrolled it */
export function restoreCompactScroll(root) {
    if (!root?.querySelectorAll) return;
    root.querySelectorAll('.cr-scroll[data-cr-key]').forEach((el) => {
        const left = scrollPositions.get(el.dataset.crKey);
        if (left) el.scrollLeft = left;
    });
}

/** Tap, Enter or Space on a row of a compact list inside container: onOpen(startNumber) */
export function bindCompactRows(container, onOpen) {
    if (!container || container.dataset.compactRowsBound === '1') return;
    container.dataset.compactRowsBound = '1';
    const open = (event) => {
        const row = event.target.closest?.('.compact-results tr[data-start]');
        if (!row || !container.contains(row)) return null;
        if (event.target.closest('a,button,input,select,textarea,[data-no-rowclick]')) return null;
        return row.getAttribute('data-start');
    };
    container.addEventListener('click', (event) => {
        const sn = open(event);
        if (sn) onOpen?.(sn);
    });
    container.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        if (!event.target.matches?.('.compact-results tr[data-start]')) return;
        event.preventDefault();
        onOpen?.(event.target.getAttribute('data-start'));
    });
}
