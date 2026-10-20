// The organisers' messages on the speaker page (pure part, see speakerMessages.js)

import { escapeHtml } from '../../utils/sharedUtils.js';
import { timeValueToMs, formatClockTime } from '../../utils/timeValueUtils.js';
import { localizedMessage } from '../../utils/messageAudience.js';

/** Newest first, at most `limit` messages with a title or text */
export function pickSpeakerMessages(messages = [], { limit = 3 } = {}) {
    return (Array.isArray(messages) ? messages : [])
        .filter(m => m && (String(m.title || '').trim() || String(m.body || '').trim()))
        .sort((a, b) => (timeValueToMs(b.timestamp) ?? 0) - (timeValueToMs(a.timestamp) ?? 0))
        .slice(0, limit);
}

/**
 * The banner's HTML ('' when there is nothing to show); all text escaped.
 * A message not for the public (officials only) gets internalLabel: not to
 * be announced. lang picks the optional English text.
 */
export function renderSpeakerMessagesHtml(messages = [], { title = 'Meddelanden från arrangören', limit = 3, lang = 'sv', internalLabel = 'Internt' } = {}) {
    const list = pickSpeakerMessages(messages, { limit });
    if (!list.length) return '';
    const items = list.map(m => {
        const isAlert = m.type === 'alert';
        const isInternal = m.audience?.public !== true && m.audience?.officials === true;
        const time = timeValueToMs(m.timestamp) !== null ? formatClockTime(m.timestamp) : '';
        const text = localizedMessage(m, lang);
        return `<li class="flex items-start gap-2 py-1.5 border-t first:border-t-0 border-blue-100 dark:border-blue-800/60">
            <i class="fas ${isAlert ? 'fa-triangle-exclamation text-red-600 dark:text-red-400' : 'fa-circle-info text-blue-700 dark:text-blue-300'} mt-1" aria-hidden="true"></i>
            <div class="min-w-0 flex-1">
                <div class="font-semibold ${isAlert ? 'text-red-800 dark:text-red-200' : 'text-gray-900 dark:text-white'}">${escapeHtml(text.title || '')}${isInternal ? `<span class="ml-2 text-[10px] font-bold uppercase bg-violet-600 text-white px-1.5 py-0.5 rounded-full" data-speaker-internal>${escapeHtml(internalLabel)}</span>` : ''}${time ? `<span class="ml-2 text-xs font-normal text-gray-600 dark:text-gray-300 tabular-nums">${escapeHtml(time)}</span>` : ''}</div>
                ${text.body ? `<div class="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-line line-clamp-3">${escapeHtml(text.body)}</div>` : ''}
            </div>
        </li>`;
    }).join('');
    return `<section class="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30 px-4 py-2" data-speaker-messages>
        <h3 class="text-xs font-bold uppercase tracking-wide text-blue-900 dark:text-blue-200">${escapeHtml(title)}</h3>
        <ul class="mt-1">${items}</ul>
    </section>`;
}
