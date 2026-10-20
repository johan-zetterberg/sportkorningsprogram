// "Mina starttider" on the driver portal's Info tab: the equipage's published
// start times per discipline with its class, and "ändrad HH:MM" when the
// organiser changed a time after publishing it (config/startTimes.changes,
// written by admin → Starttider). Pure.

import { escapeHtml } from '../../utils/sharedUtils.js';
import { publishedTimesFor, startTimeDiscipline } from '../../utils/publishedStartTimes.js';
import { clockOf, startTimeChangedAt } from '../admin/startTimeChangeUtils.js';

const ORDER = ['dressage', 'marathon', 'precision'];

/**
 * [{ discipline, value, date ('YYYY-MM-DD'), clock ('HH:MM'), className,
 * changedAt ('HH:MM' | null) }] in start order. Draft disciplines are left out.
 */
export function buildMyStartTimes(startTimesConfig = {}, startNumber, equipage = {}) {
    const row = publishedTimesFor(startTimesConfig || {}, startNumber);
    const byDiscipline = new Map();
    Object.entries(row).forEach(([key, value]) => {
        const discipline = startTimeDiscipline(key);
        // "marathon" wins over the older "maraton" alias
        if (!discipline || (byDiscipline.has(discipline) && key !== discipline)) return;
        byDiscipline.set(discipline, String(value));
    });
    const changes = startTimesConfig?.changes || startTimesConfig?.value?.changes || {};
    const className = String(equipage?.className || '');
    return ORDER
        .filter(d => byDiscipline.has(d))
        .map((discipline) => {
            const value = byDiscipline.get(discipline);
            return {
                discipline,
                value,
                date: /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : '',
                clock: clockOf(value) || value,
                className,
                changedAt: startTimeChangedAt(changes, startNumber, discipline, value)
            };
        })
        .sort((a, b) => String(a.value).localeCompare(String(b.value)));
}

/** The card's HTML; labels: { title, empty, changed, class, discipline_<d> } */
export function renderMyStartTimesCard(rows = [], labels = {}, { formatDate = (d) => d } = {}) {
    const items = rows.length
        ? rows.map(r => `
            <li class="flex items-center justify-between gap-3 py-2 border-t first:border-t-0 border-gray-100 dark:border-gray-700">
                <div class="min-w-0">
                    <div class="font-semibold text-gray-900 dark:text-white">${escapeHtml(labels[`discipline_${r.discipline}`] || r.discipline)}</div>
                    <div class="text-xs text-gray-500 dark:text-gray-400">${r.className ? `${escapeHtml(labels.class || '')} ${escapeHtml(r.className)}` : ''}${r.date ? `${r.className ? ' · ' : ''}${escapeHtml(formatDate(r.date))}` : ''}</div>
                </div>
                <div class="text-right shrink-0">
                    <div class="text-xl font-bold tabular-nums text-gray-900 dark:text-white">${escapeHtml(r.clock)}</div>
                    ${r.changedAt ? `<div class="text-[11px] font-semibold text-amber-700 dark:text-amber-300" data-start-time-changed>${escapeHtml(String(labels.changed || '').replace('{time}', r.changedAt))}</div>` : ''}
                </div>
            </li>`).join('')
        : `<li class="py-2 text-sm text-gray-500 dark:text-gray-400">${escapeHtml(labels.empty || '')}</li>`;
    return `
        <div class="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 md:p-6 shadow-sm md:col-span-2" id="portalMyStartTimes">
            <h3 class="text-lg font-bold text-gray-900 dark:text-white mb-2 border-b dark:border-gray-700 pb-2">🏁 ${escapeHtml(labels.title || '')}</h3>
            <ul>${items}</ul>
        </div>`;
}
