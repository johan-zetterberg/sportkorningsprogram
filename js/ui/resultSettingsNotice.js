// Why a result stays incomplete, for organisers. The result engine withholds a
// marathon or precision result it cannot calculate correctly (no class
// settings, no ideal time for a stage, unknown course, no precision max time);
// without an explanation the result just stays "Pågår" or "—". This checks the
// settings the way the engine reads them (same class-name matching) and builds
// the notices and per-row reasons.

import { getClassCourse, getClassSettings, limitsFor } from '../core-engine/marathon.js';
import { computeMaxSecondsForClass } from '../utils/precisionCalculation.js';
import { escapeHtml } from '../utils/sharedUtils.js';
import { precisionRoundSettingsIssues } from '../pages/precision/precisionRoundsDisplay.js';

export const RESULT_SETTINGS_NOTICE_ID = 'resultSettingsNotice';

/**
 * Settings notices are for the organisers, not the audience on the public
 * result pages: only for a signed-in user with a role (admin or official).
 */
export function canSeeSettingsNotices() {
    const user = (typeof window !== 'undefined' && typeof window.getGlobalState === 'function')
        ? window.getGlobalState('currentUser')
        : null;
    if (!user) return false;
    const compRoles = Array.isArray(user.compRoles) ? user.compRoles : [];
    return (user.role && user.role !== 'publik') || compRoles.length > 0;
}

const STAGE_LABELS = { A: 'A', transport: 'transport', B: 'B' };

const isActive = (eq) => !String(eq?.status || '').toLowerCase().includes('struken');
const classOf = (eq) => String(eq?.className || eq?.class || '').trim();

function addIssue(map, className, issue) {
    if (!map.has(className)) map.set(className, new Set());
    map.get(className).add(issue);
}

// Stages the class drives: B always; A when it has a distance or a fixed
// warm-up time; transport when it is switched on
function drivenStages(settings) {
    const stages = [];
    if (Number(settings?.distanceA) > 0 || Number(settings?.fixedTimeA) > 0 || settings?.A?.distance > 0) stages.push('A');
    if (settings?.includeTransport === true) stages.push('transport');
    stages.push('B');
    return stages;
}

/** Marathon: Map className -> Set of issues, for classes with equipages */
export function marathonSettingsIssues(equipages = [], marathonConfig = null) {
    const issues = new Map();
    if (!marathonConfig) return issues;
    (equipages || []).filter(isActive).forEach((eq) => {
        const className = classOf(eq);
        if (!className) return;
        const settings = getClassSettings(className, marathonConfig);
        if (!settings) {
            addIssue(issues, className, 'maratoninställningar saknas för klassen');
            return;
        }
        // Ideal times can depend on the equipage (pony/horse tempo), so per equipage
        drivenStages(settings).forEach((stage) => {
            if (!limitsFor(eq, stage, marathonConfig)) addIssue(issues, className, `idealtid saknas för sträcka ${STAGE_LABELS[stage]}`);
        });
        if (!getClassCourse(className, marathonConfig)) {
            addIssue(issues, className, 'banan är okänd (inga körda hinder för klassen och ingen hinderlista)');
        }
    });
    return issues;
}

/** Precision: Map className -> Set of issues */
export function precisionSettingsIssues(equipages = [], precisionConfig = null, { profileOf = null } = {}) {
    const issues = new Map();
    if (!precisionConfig) return issues;
    (equipages || []).filter(isActive).forEach((eq) => {
        const className = classOf(eq);
        if (!className) return;
        const maxSec = computeMaxSecondsForClass(eq, precisionConfig);
        if (!(Number(maxSec) > 0)) addIssue(issues, className, 'maxtid saknas (banlängd och tempo)');
    });
    // Phase 2 without length / tempo / max time, a scheduled drive-off without a course
    precisionRoundSettingsIssues(equipages, precisionConfig, { profileOf }).forEach((set, className) => {
        set.forEach((text) => addIssue(issues, className, text));
    });
    return issues;
}

function issueList(issues) {
    return [...issues.entries()]
        .sort(([a], [b]) => a.localeCompare(b, 'sv', { numeric: true }))
        .map(([className, set]) => `<li><strong>${escapeHtml(className)}</strong>: ${[...set].map(escapeHtml).join('; ')}</li>`)
        .join('');
}

/**
 * The notice for one or both disciplines; '' when nothing is missing.
 * `marathon` / `precision` are the Maps from the functions above.
 */
export function resultSettingsNoticeHtml({ marathon = new Map(), precision = new Map() } = {}) {
    const parts = [];
    if (marathon.size) {
        parts.push(`<p class="mt-1 font-medium">Maraton (ställs in i Maratonadministrationen):</p><ul class="list-disc pl-5">${issueList(marathon)}</ul>`);
    }
    if (precision.size) {
        parts.push(`<p class="mt-1 font-medium">Precision (ställs in i Precisionsadministrationen):</p><ul class="list-disc pl-5">${issueList(precision)}</ul>`);
    }
    if (!parts.length) return '';
    // Long lists fold away (the summary says how many classes): a few stay open
    const classCount = marathon.size + precision.size;
    return `
    <details ${classCount <= 2 ? 'open' : ''} role="status" class="mb-4 rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-2 text-sm text-yellow-900 dark:border-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-100" data-settings-notice>
      <summary class="summary-cue cursor-pointer min-h-[44px] flex items-center font-semibold">Obs: inställningar saknas (${classCount})</summary>
      <p class="mt-1">Resultaten i dessa klasser kan inte räknas klart förrän inställningarna finns:</p>
      ${parts.join('')}
    </details>`;
}

export function renderResultSettingsNotice(issues, hostId = RESULT_SETTINGS_NOTICE_ID) {
    const host = typeof document !== 'undefined' ? document.getElementById(hostId) : null;
    if (!host) return;
    host.innerHTML = canSeeSettingsNotices() ? resultSettingsNoticeHtml(issues) : '';
}

/**
 * Short reason for one engine result (marathon or precision) that is held
 * back by missing settings, or null. { label, title } for a row.
 */
export function incompleteResultReason(result) {
    if (!result) return null;
    if (result.configMissing && Array.isArray(result.missingConfig)) {
        return result.missingConfig.includes('class')
            ? { label: 'Inställningar saknas', title: 'Klassen saknar maratoninställningar; resultatet räknas när de finns.' }
            : { label: 'Idealtid saknas', title: `Idealtid saknas för sträcka ${result.missingConfig.map(s => STAGE_LABELS[s] || s).join(', ')}; resultatet räknas när den finns.` };
    }
    if (result.configMissing) {
        return { label: 'Maxtid saknas', title: 'Klassen saknar maxtid (banlängd och tempo); tids- och totalstraff räknas när banan är inlagd.' };
    }
    if (result.obstacleListMissing && result.obstacles?.items?.length > 0) {
        return { label: 'Banan okänd', title: 'Varken körda hinder för klassen eller hinderlistan finns; resultatet kan inte bli klart.' };
    }
    return null;
}

export function incompleteResultReasonHtml(result) {
    const reason = canSeeSettingsNotices() ? incompleteResultReason(result) : null;
    if (!reason) return '';
    return `<div class="mt-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300" title="${escapeHtml(reason.title)}">⚠ ${escapeHtml(reason.label)}</div>`;
}
