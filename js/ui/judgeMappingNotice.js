// Notice for classes without a dressage judge mapping. The result engine needs
// the class's judges (config/dressageJudgeMapping) before dressage counts as
// finished, so without a mapping the class never gets a total. Shown on the
// pages where an organiser would otherwise wonder why totals stay empty.

import { getClassJudgeAssignments } from '../core-engine/dressage.js';
import { escapeHtml } from '../utils/sharedUtils.js';

export const JUDGE_MAPPING_NOTICE_ID = 'judgeMappingNotice';

// Class names (as on the equipages) that have no judge in the mapping
export function classesWithoutJudgeMapping(equipages = [], judgeMapping = {}) {
    const classes = new Set();
    (equipages || []).forEach((eq) => {
        const className = String(eq?.className || eq?.class || '').trim();
        if (!className || String(eq?.status || '').toLowerCase().includes('struken')) return;
        if (Object.keys(getClassJudgeAssignments(className, judgeMapping)).length === 0) classes.add(className);
    });
    return [...classes].sort((a, b) => a.localeCompare(b, 'sv', { numeric: true }));
}

export function judgeMappingNoticeHtml(classes = []) {
    if (!classes.length) return '';
    const list = classes.map(c => `<strong>${escapeHtml(c)}</strong>`).join(', ');
    return `
    <div role="status" class="mb-4 rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-900 dark:border-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-100">
      <p class="font-semibold">Obs: domarfördelning saknas</p>
      <p class="mt-1">Dressyren kan inte markeras som klar eftersom domarfördelning saknas för ${classes.length === 1 ? 'klass' : 'klasserna'} ${list}.
      Ange domare i Dressyradministrationen för att totalresultat ska kunna räknas.</p>
    </div>`;
}

// Fills the placeholder (if the page has one) for the given equipages
export function renderJudgeMappingNotice(equipages = [], judgeMapping = {}, hostId = JUDGE_MAPPING_NOTICE_ID) {
    const host = typeof document !== 'undefined' ? document.getElementById(hostId) : null;
    if (!host) return;
    host.innerHTML = judgeMappingNoticeHtml(classesWithoutJudgeMapping(equipages, judgeMapping));
}
