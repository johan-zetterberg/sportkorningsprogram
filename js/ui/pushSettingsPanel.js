// The notifications panel (web push) shared by the driver portal, the official
// portal and the account settings. It shows the state of this device, the iPhone
// guide, per-topic switches and the test/off buttons; the work is done by
// js/services/pushService.js. Quiet when push is not available yet.
import {
    disablePush,
    enablePush,
    getIosPushDecision,
    getPushSettings,
    getPushStatus,
    sendTestPush,
    updateTopics
} from '../services/pushService.js';
import { t } from '../utils/i18n.js';
import { escapeHtml } from '../utils/sharedUtils.js';
import {
    IOS_GUIDE_STEP_KEYS,
    TOPIC_LABEL_KEYS,
    derivePushView,
    initialTopics,
    pushErrorKey,
    toggleTopic,
    topicsForRole,
    viewStatusKey
} from '../utils/pushPanelUtils.js';

const BTN = 'min-h-[44px] px-4 py-2 rounded-md text-sm font-semibold disabled:opacity-50';
const GUIDE_ICONS = ['⬆️', '📲', '🏠', '🔔'];

function guideHtml(view) {
    if (view === 'ios-old') {
        return `<p class="mt-2 text-sm text-gray-700 dark:text-gray-200">${escapeHtml(t('push_ios_old'))}</p>`;
    }
    return `
        <div class="mt-3 rounded-md bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 p-3" data-push-guide>
            <p class="text-sm font-semibold text-gray-900 dark:text-gray-100">${escapeHtml(t('push_ios_title'))}</p>
            <ol class="mt-2 space-y-2">
                ${IOS_GUIDE_STEP_KEYS.map((key, i) => `
                <li class="flex items-start gap-3 text-sm text-gray-700 dark:text-gray-200">
                    <span class="w-9 h-9 shrink-0 rounded-full bg-white dark:bg-gray-800 flex items-center justify-center text-lg" aria-hidden="true">${GUIDE_ICONS[i]}</span>
                    <span class="pt-1.5"><strong>${i + 1}.</strong> ${escapeHtml(t(key))}</span>
                </li>`).join('')}
            </ol>
        </div>`;
}

function topicsHtml(role, topics, busy) {
    const offered = topicsForRole(role);
    if (!offered.length) return '';
    return `
        <fieldset class="mt-3" data-push-topics>
            <legend class="text-sm font-semibold text-gray-800 dark:text-gray-100">${escapeHtml(t('push_topics_title'))}</legend>
            ${offered.map((topic) => `
            <label class="flex items-center gap-3 min-h-[44px] text-sm text-gray-800 dark:text-gray-100">
                <input type="checkbox" class="h-5 w-5" data-push-topic="${escapeHtml(topic)}" ${topics.includes(topic) ? 'checked' : ''} ${busy ? 'disabled' : ''}>
                ${escapeHtml(t(TOPIC_LABEL_KEYS[topic]))}
            </label>`).join('')}
        </fieldset>`;
}

function buttonsHtml(view, { compact, busy }) {
    const dis = busy ? 'disabled' : '';
    if (view === 'off') {
        return `<div class="mt-3"><button type="button" data-push-act="enable" ${dis} class="${BTN} bg-blue-600 hover:bg-blue-700 text-white">${escapeHtml(t('push_enable'))}</button></div>`;
    }
    if (view === 'on') {
        return `
        <div class="mt-3 flex flex-col sm:flex-row flex-wrap gap-2">
            ${compact ? '' : `<button type="button" data-push-act="test" ${dis} class="${BTN} border border-blue-600 text-blue-800 dark:text-blue-200 hover:bg-blue-50 dark:hover:bg-blue-900/30">${escapeHtml(t('push_test'))}</button>`}
            <button type="button" data-push-act="disable" ${dis} class="${BTN} border border-gray-400 text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700">${escapeHtml(t('push_disable'))}</button>
        </div>`;
    }
    return '';
}

/**
 * Renders the panel into container and wires it. options: role ('driver',
 * 'official', 'staff' or 'device' for the device-wide switch), competitionId
 * (the competition this device should follow; none = whole device), compact.
 */
export async function mountPushPanel(container, { role = 'device', competitionId = null, compact = false } = {}) {
    if (!container) return;
    const ctx = { role, competitionId, compact, busy: false, result: '' };
    container.__pushCtx = ctx;
    // One listener per container, however often the panel is mounted again
    if (!container.__pushBound) {
        container.__pushBound = true;
        container.addEventListener('click', (event) => onClick(container, event));
        container.addEventListener('change', (event) => onChange(container, event));
    }
    container.innerHTML = `<section id="pushPanel" data-push-panel class="${compact ? '' : 'bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 md:p-6 shadow-sm'}">
        <h3 class="${compact ? 'text-sm font-semibold' : 'text-lg font-bold'} text-gray-900 dark:text-white">🔔 ${escapeHtml(t('push_title'))}</h3>
        <p class="mt-1 text-sm text-gray-600 dark:text-gray-300" aria-live="polite">${escapeHtml(t('loading_data'))}</p>
    </section>`;
    await render(container);
}

async function loadState(ctx) {
    const [settings, status] = await Promise.all([
        getPushSettings().catch(() => ({ available: false })),
        getPushStatus({ competitionId: ctx.competitionId, verify: true })
    ]);
    const merged = { ...status, available: settings.available === true };
    const iosDecision = getIosPushDecision();
    return { status: merged, iosDecision, view: derivePushView(merged, iosDecision, { competitionId: ctx.competitionId }) };
}

async function render(container) {
    const ctx = container.__pushCtx;
    if (!ctx) return;
    let state;
    try {
        state = await loadState(ctx);
    } catch (error) {
        console.warn('Notiser: status kunde inte läsas', error);
        state = { status: {}, iosDecision: 'not-ios', view: 'not-available' };
    }
    if (container.__pushCtx !== ctx || !container.isConnected) return;
    ctx.state = state;
    paint(container);
}

function paint(container) {
    const ctx = container.__pushCtx;
    const { status, view } = ctx.state;
    const statusText = view === 'on' && ctx.competitionId ? t('push_status_on_competition') : t(viewStatusKey(view));
    const topics = status.topics || [];
    const root = container.querySelector('#pushPanel');
    if (!root) return;
    root.innerHTML = `
        <h3 class="${ctx.compact ? 'text-sm font-semibold' : 'text-lg font-bold'} text-gray-900 dark:text-white">🔔 ${escapeHtml(t('push_title'))}</h3>
        <p class="mt-1 text-sm text-gray-600 dark:text-gray-300" data-push-status aria-live="polite">${escapeHtml(statusText)}</p>
        ${view === 'ios-guide' || view === 'ios-old' ? guideHtml(view) : ''}
        ${view === 'denied' ? `<p class="mt-2 text-sm text-amber-800 dark:text-amber-200 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3">${escapeHtml(t('push_denied_help'))}</p>` : ''}
        ${view === 'on' ? topicsHtml(ctx.role, topics, ctx.busy) : ''}
        ${buttonsHtml(view, { compact: ctx.compact, busy: ctx.busy })}
        <p class="mt-2 text-sm text-gray-700 dark:text-gray-200 break-words" data-push-result aria-live="polite">${escapeHtml(ctx.result)}</p>`;
}

function setResult(container, text) {
    const ctx = container.__pushCtx;
    ctx.result = text || '';
    const el = container.querySelector('[data-push-result]');
    if (el) el.textContent = ctx.result;
}

async function run(container, work) {
    const ctx = container.__pushCtx;
    if (ctx.busy) return;
    ctx.busy = true;
    setResult(container, '');
    container.querySelectorAll('button, input').forEach((el) => { el.disabled = true; });
    try {
        await work(ctx);
    } catch (error) {
        console.warn('Notiser:', error?.code || error);
        ctx.result = t(pushErrorKey(error?.code));
    } finally {
        ctx.busy = false;
        const keep = ctx.result;
        await render(container);
        if (container.__pushCtx === ctx) setResult(container, keep);
    }
}

async function onClick(container, event) {
    const button = event.target.closest('[data-push-act]');
    if (!button || !container.contains(button)) return;
    const act = button.getAttribute('data-push-act');
    if (act === 'enable') {
        // Called from the click itself: the browser asks for permission here
        await run(container, async (ctx) => {
            const existing = ctx.state?.status?.topics || [];
            const topics = initialTopics(ctx.role, existing);
            await enablePush({ competitionId: ctx.competitionId, topics });
            ctx.result = t('push_enabled_done');
        });
    } else if (act === 'disable') {
        await run(container, async (ctx) => {
            await disablePush();
            ctx.result = t('push_disabled_done');
        });
    } else if (act === 'test') {
        await run(container, async (ctx) => {
            const res = await sendTestPush();
            ctx.result = Number(res?.sent) > 0 ? t('push_test_sent') : t('push_test_none');
        });
    }
}

async function onChange(container, event) {
    const box = event.target.closest('[data-push-topic]');
    if (!box || !container.contains(box)) return;
    const topic = box.getAttribute('data-push-topic');
    const on = box.checked;
    await run(container, async (ctx) => {
        const next = toggleTopic(ctx.state?.status?.topics || [], topic, on);
        await updateTopics(next, { competitionId: ctx.competitionId });
        ctx.result = t('push_topics_saved');
    });
}
