// The phone result list: one row per equipage (place, start number, driver
// with the class under it, a few result columns), many more on a screen than
// the cards. A tap opens the equipage. The viewer picks compact or cards, the
// phone remembers it. Styles in css/app-shell.css (.compact-results).

import { t } from '../utils/i18n.js';
import { escapeHtml } from '../utils/sharedUtils.js';

const DENSITY_KEY = 'resultDensity';

/** 'compact' (the default) or 'cards' */
export function getResultDensity() {
    try {
        return localStorage.getItem(DENSITY_KEY) === 'cards' ? 'cards' : 'compact';
    } catch {
        return 'compact';
    }
}

export function setResultDensity(value) {
    try {
        localStorage.setItem(DENSITY_KEY, value === 'cards' ? 'cards' : 'compact');
    } catch { /* private mode: the default stays */ }
}

/** Two buttons, Kompakt | Kort; bindDensityToggle wires them */
export function densityToggleHtml() {
    const current = getResultDensity();
    const button = (value, key) => `<button type="button" data-result-density="${value}" aria-pressed="${current === value}">${escapeHtml(t(key))}</button>`;
    return `<div class="result-density-toggle" role="group" aria-label="${escapeHtml(t('result_density_label'))}">${button('compact', 'result_density_compact')}${button('cards', 'result_density_cards')}</div>`;
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
 * columns: [{ key, label, title? }] the result columns after place, number and
 *   driver (up to four fit a phone held upright)
 * items: rows in display order, each either
 *   { type: 'group', label }                              a class heading
 *   { startNumber, place, name, sub, cells: { [key]: html }, state }
 *   cells are HTML the caller has escaped; place, name and sub are text.
 *   state: '' | 'live' | 'leader' | 'elim' (row tint)
 */
export function compactResultListHtml({ columns = [], items = [], emptyText = '' } = {}) {
    const head = `<thead><tr>
        <th scope="col" class="cr-place">${escapeHtml(t('compact_place'))}</th>
        <th scope="col" class="cr-sn">#</th>
        <th scope="col" class="cr-name">${escapeHtml(t('compact_driver'))}</th>
        ${columns.map((c) => `<th scope="col" class="cr-num"${c.title ? ` title="${escapeHtml(c.title)}"` : ''}>${escapeHtml(c.label)}</th>`).join('')}
    </tr></thead>`;
    const span = 3 + columns.length;
    const rows = items.map((item) => {
        if (item?.type === 'group') {
            return `<tr class="cr-group"><th scope="colgroup" colspan="${span}">${escapeHtml(item.label ?? '')}</th></tr>`;
        }
        const sn = String(item.startNumber ?? '');
        const state = ['live', 'leader', 'elim'].includes(item.state) ? ` cr-${item.state}` : '';
        const place = item.place === null || item.place === undefined || item.place === '' ? '—' : String(item.place);
        return `<tr class="cr-row${state}" data-start="${escapeHtml(sn)}" tabindex="0" aria-label="${escapeHtml(t('compact_row_open').replace('{sn}', sn))}">
            <td class="cr-place">${escapeHtml(place)}</td>
            <td class="cr-sn">${escapeHtml(sn)}</td>
            <td class="cr-name"><span class="cr-driver">${escapeHtml(item.name ?? '')}</span>${item.sub ? `<span class="cr-sub">${escapeHtml(item.sub)}</span>` : ''}</td>
            ${columns.map((c) => `<td class="cr-num">${item.cells?.[c.key] ?? '—'}</td>`).join('')}
        </tr>`;
    }).join('');
    const body = rows || `<tr><td class="cr-empty" colspan="${span}">${escapeHtml(emptyText)}</td></tr>`;
    return `<table class="compact-results">${head}<tbody>${body}</tbody></table>`;
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
