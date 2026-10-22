// The officials' messages banner (pure part, see fieldMessages.js)

import { escapeHtml } from '../utils/sharedUtils.js';
import { isMessageForOfficial, localizedMessage, messageStateKey, sortMessagesNewestFirst } from '../utils/messageAudience.js';
import { formatClockTime, timeValueToMs } from '../utils/timeValueUtils.js';

const MAX_SHOWN = 3;

/** The messages to show (pure): for the viewer, not dismissed, newest first */
export function pickFieldMessages(messages = [], { viewerKeys = [], dismissed = [], competitionId = '', limit = MAX_SHOWN } = {}) {
    const hidden = new Set(dismissed);
    return sortMessagesNewestFirst(messages)
        .filter(m => isMessageForOfficial(m, viewerKeys))
        .filter(m => !hidden.has(messageStateKey(m, competitionId)))
        .slice(0, limit);
}

/** Whether the text is long enough that a 2-line preview hides some of it */
export function needsExpander(body = '') {
    const text = String(body || '');
    return text.length > 90 || text.split('\n').length > 2;
}

/**
 * The banner's HTML ('' when there is nothing to show); all text escaped.
 * Each message shows its title and a 2-line preview with "Visa mer";
 * moreCount adds a "+N fler" hint, heading a title row with a count.
 */
export function renderFieldMessagesHtml(messages = [], { lang = 'sv', competitionId = '', newKeys = new Set(), expanded = new Set(), labels = {}, moreCount = 0, heading = '' } = {}) {
    if (!messages.length) return '';
    const items = messages.map((m) => {
        const key = messageStateKey(m, competitionId);
        const important = m.type === 'alert';
        const { title, body } = localizedMessage(m, lang);
        const time = timeValueToMs(m.editedAt || m.timestamp) !== null ? formatClockTime(m.editedAt || m.timestamp) : '';
        const open = expanded.has(key);
        const expander = body && needsExpander(body)
            ? `<button type="button" class="mt-0.5 min-h-[44px] -my-2 text-xs font-semibold underline" data-toggle-field-message="${escapeHtml(key)}" aria-expanded="${open ? 'true' : 'false'}">${escapeHtml(open ? (labels.less || 'Visa mindre') : (labels.more || 'Visa mer'))}</button>`
            : '';
        const tone = important
            ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-900/40 dark:text-red-100'
            : 'border-blue-200 bg-blue-50 text-blue-950 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-50';
        return `<li class="flex items-start gap-2 rounded-lg border px-3 py-2 ${tone}${newKeys.has(key) ? ' animate-pulse' : ''}" data-field-message="${escapeHtml(key)}">
            <span class="mt-0.5 text-xs font-bold uppercase tracking-wide shrink-0 ${important ? 'text-red-700 dark:text-red-200' : 'text-blue-800 dark:text-blue-200'}">${escapeHtml(important ? (labels.important || 'Viktigt') : (labels.info || 'Info'))}</span>
            <div class="min-w-0 flex-1 text-sm">
                <span class="font-semibold">${escapeHtml(title)}</span>${time ? `<span class="ml-2 text-xs opacity-80 tabular-nums">${escapeHtml(time)}</span>` : ''}
                ${body ? `<div class="whitespace-pre-line break-words${open ? '' : ' line-clamp-2'}">${escapeHtml(body)}</div>` : ''}
                ${expander}
            </div>
            <button type="button" class="shrink-0 -my-1 -mr-1 min-h-[44px] min-w-[44px] text-lg leading-none opacity-70 hover:opacity-100" data-dismiss-field-message="${escapeHtml(key)}" aria-label="${escapeHtml(labels.dismiss || 'Dölj')}">&times;</button>
        </li>`;
    }).join('');
    const head = heading
        ? `<h2 class="mb-1 text-sm font-bold text-gray-900 dark:text-white">${escapeHtml(heading)} <span class="ml-1 rounded-full bg-gray-200 px-2 py-0.5 text-xs dark:bg-gray-700" data-field-message-count>${messages.length + Math.max(0, moreCount)}</span></h2>`
        : '';
    const more = moreCount > 0
        ? `<p class="mt-1 text-xs font-semibold text-gray-700 dark:text-gray-300" data-field-messages-more>${escapeHtml(String(labels.more_count || '+{n}').replace('{n}', String(moreCount)))}</p>`
        : '';
    return `<section class="px-2 sm:px-4 pt-2" aria-label="${escapeHtml(labels.title || '')}" data-field-messages>
        ${head}<ul class="space-y-1">${items}</ul>${more}
    </section>`;
}