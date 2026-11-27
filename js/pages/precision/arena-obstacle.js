// Arena driving: the obstacle controller's page (optional). The controller
// picks where they stand:
//   a marathon-type obstacle / bridge  the route through it gate by gate (a
//        capital letter forwards, a small letter backwards, as in the
//        marathon), each gate with its split time in the round, and the
//        verdict (right / wrong corrected / wrong not corrected) and knocks;
//   "the whole course"                 every cone pair and obstacle passed,
//        with its split time (as the precision observer's passages).
// The equipage on the course is followed automatically (or picked by hand).
// Reports are stored apart from the result (arenaCheckService); the judge
// adds the penalties on the precision input page.

import { getGlobalState } from '../../main.js';
import { getEquipages } from '../../services/equipageService.js';
import { getConfig } from '../../services/competitionService.js';
import { db, appId } from '../../config/firebase-config.js';
import { collection, deleteField, onSnapshot } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { getCompetitionHeader, createSearchableDropdown, showAlert } from '../../ui/components.js';
import { t } from '../../utils/i18n.js';
import { escapeHtml, msToLabel } from '../../utils/sharedUtils.js';
import { getArenaSettings, getPrecisionFormat } from '../../utils/precisionCalculation.js';
import { arenaRoundsOf } from '../../utils/arenaRules.js';
import { readPrecisionRound } from '../../utils/precisionRounds.js';
import {
    arenaCheckId,
    arenaControlObstacles,
    arenaGateLetters,
    arenaRoundElapsedMs,
    arenaRouteText,
    arenaRouteTimeMs,
    nextArenaCheck,
    nextArenaRoute,
    normalizeArenaCheck
} from '../../utils/arenaChecks.js';
import { listenArenaChecks, saveArenaCheck } from '../../services/arenaCheckService.js';
import { serverNow, startServerClockSync, stopServerClockSync } from '../../utils/serverClock.js';
import { runningPrecisionRound } from './precisionRoundsDisplay.js';
import { precisionRoundLabelKey } from './precisionRoundInput.js';

const OBSTACLE_KEY = 'arenaObstacle.obstacle';
const COURSE = '*course';

let competitionId = null;
let config = {};
let equipages = [];
let precisionDocs = new Map();
let checks = new Map();
let obstacle = '';
let follow = true;
let selected = null; // { sn, round }
let dropdown = null;
let unsubs = [];
let loadSeq = 0;

const isArena = (eq) => getPrecisionFormat(eq, config) === 'arena';
const eqOf = (sn) => equipages.find((e) => String(e.startNumber) === String(sn)) || null;
const settingsOf = (eq) => getArenaSettings(eq, config);
const splitLabel = (ms) => (Number.isFinite(ms) ? msToLabel(ms) : '–');

function readStored(key) {
    try { return localStorage.getItem(key) || ''; } catch { return ''; }
}
function writeStored(key, value) {
    try { localStorage.setItem(key, value); } catch { /* per-device convenience only */ }
}

// The obstacles of all arena classes a controller can stand at (by label)
function allControlObstacles() {
    const seen = new Map();
    const classes = new Set(equipages.filter(isArena).map((e) => e.className));
    for (const cls of classes) {
        for (const o of arenaControlObstacles(settingsOf({ className: cls }))) {
            if (!seen.has(o.label)) seen.set(o.label, o);
        }
    }
    return [...seen.values()];
}

function roundLabel(eq, round) {
    return t(precisionRoundLabelKey(round, 'arena', settingsOf(eq)));
}

function verdictText(check) {
    const c = normalizeArenaCheck(check);
    if (!c || (!c.result && !c.knocks && !c.route.length)) return t('ao_nothing');
    const parts = [];
    if (c.route.length) parts.push(arenaRouteText(c.route));
    if (c.result === 'ok') parts.push(t('ao_ok'));
    if (c.result === 'wrongCorrected') parts.push(t('ao_wrong_corrected'));
    if (c.result === 'wrongUncorrected') parts.push(t('ao_wrong_uncorrected'));
    if (c.knocks) parts.push(t('ao_knocks_n').replace('{n}', String(c.knocks)));
    return parts.join(' · ');
}

export function renderLayout() {
    const comp = getGlobalState('currentCompetition');
    const root = document.getElementById('page-arena-obstacle');
    if (!root) return;
    root.innerHTML = `
        <div class="container mx-auto p-4 md:p-8 max-w-xl">
            <div class="mb-4">${getCompetitionHeader(comp, t('ao_title'))}</div>
            <div class="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-md space-y-4 border dark:border-gray-700">
                <p class="text-sm text-blue-800 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-100 dark:border-blue-800">${escapeHtml(t('ao_intro'))}</p>
                <label class="block text-sm font-semibold dark:text-gray-200">${escapeHtml(t('ao_obstacle'))}
                    <select id="ao-obstacle" class="mt-1 w-full min-h-[44px] p-2 border rounded-md text-lg font-bold dark:bg-gray-700 dark:border-gray-600 dark:text-white"></select>
                </label>
                <div class="flex items-center gap-2">
                    <div id="ao-search" class="flex-grow"></div>
                    <button id="ao-follow" type="button" class="min-h-[44px] px-3 border rounded-md bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:border-emerald-800 dark:text-emerald-200">${escapeHtml(t('ao_follow'))}</button>
                </div>
                <div id="ao-current" class="p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg border dark:border-gray-700 text-center"></div>
                <div id="ao-actions" class="space-y-3"></div>
                <div id="ao-recent"></div>
            </div>
        </div>`;
}

function renderObstacleSelect() {
    const select = document.getElementById('ao-obstacle');
    if (!select) return;
    const list = allControlObstacles();
    const options = [[COURSE, t('ao_course_mode')], ...list.map((o) => [o.label, o.label])];
    if (!options.some(([value]) => value === obstacle)) obstacle = list[0]?.label || COURSE;
    select.innerHTML = options.map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === obstacle ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
}

// Follow mode: the equipage whose round runs, the latest started first (a
// clock left running elsewhere does not take over); it stays selected after
// the finish until the next one starts
function adoptRunning() {
    if (!follow) return;
    const running = [...precisionDocs.entries()]
        .map(([sn, d]) => {
            const round = runningPrecisionRound(d);
            return { sn, round, startedAt: Number(readPrecisionRound(d, round)?.liveStartEpoch) || 0 };
        })
        .filter((r) => r.round && isArena(eqOf(r.sn)))
        .sort((a, b) => b.startedAt - a.startedAt || (Number(a.sn) || 0) - (Number(b.sn) || 0));
    const next = running[0];
    if (next && (!selected || selected.sn !== next.sn || selected.round !== next.round)) {
        selected = { sn: next.sn, round: next.round };
    }
}

function checkFor(label) {
    if (!selected || !label) return null;
    return checks.get(arenaCheckId(selected.sn, selected.round, label)) || null;
}

// The split time now in the selected round (null without a running clock)
function elapsedNow() {
    if (!selected) return null;
    const d = precisionDocs.get(String(selected.sn));
    return arenaRoundElapsedMs(readPrecisionRound(d, selected.round), serverNow());
}

function render() {
    const current = document.getElementById('ao-current');
    const actions = document.getElementById('ao-actions');
    if (!current || !actions) return;
    document.getElementById('ao-follow')?.classList.toggle('ring-2', follow);
    const eq = selected ? eqOf(selected.sn) : null;
    if (!eq) {
        current.innerHTML = `<div class="text-gray-500 dark:text-gray-400">${escapeHtml(t('ao_none_on_course'))}</div>`;
        actions.innerHTML = '';
        renderRecent();
        return;
    }
    const rounds = arenaRoundsOf(settingsOf(eq));
    const live = runningPrecisionRound(precisionDocs.get(String(eq.startNumber))) === selected.round;
    current.innerHTML = `
        <div class="text-xs uppercase tracking-wider font-semibold ${live ? 'text-emerald-700 dark:text-emerald-300' : 'text-gray-500 dark:text-gray-400'}">${escapeHtml(live ? t('ao_on_course') : t('ao_selected'))}</div>
        <div class="font-bold text-xl dark:text-white">#${escapeHtml(String(eq.startNumber))} ${escapeHtml(eq.driverName || '')}</div>
        <div class="text-sm text-gray-600 dark:text-gray-300">${escapeHtml(eq.className || '')}</div>
        ${rounds.length > 1 ? `<div class="mt-2 flex flex-wrap justify-center gap-2">${rounds.map((r) => `<button type="button" data-ao-round="${r}" class="min-h-[40px] px-3 rounded-lg border text-sm font-bold ${r === selected.round ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white text-gray-800 dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600'}">${escapeHtml(roundLabel(eq, r))}</button>`).join('')}</div>` : ''}
        ${live ? '' : `<div class="mt-1 text-xs text-amber-700 dark:text-amber-300">${escapeHtml(t('ao_clock_not_running'))}</div>`}`;

    if (obstacle === COURSE) {
        actions.innerHTML = coursePassagesHtml(eq);
        renderRecent();
        return;
    }
    const course = settingsOf(eq).obstacles || [];
    const courseObstacle = course.find((o) => o.label === obstacle);
    if (!obstacle) {
        actions.innerHTML = '';
    } else if (!courseObstacle) {
        actions.innerHTML = `<p class="text-sm text-amber-800 dark:text-amber-200">${escapeHtml(t('ao_not_in_course').replace('{obstacle}', obstacle))}</p>`;
    } else {
        actions.innerHTML = (courseObstacle.type === 'marathon' ? routeHtml(courseObstacle) : '') + verdictHtml();
    }
    renderRecent();
}

// The route buttons of a marathon-type obstacle: capitals forwards, small
// letters backwards; the route so far with each gate's split time
function routeHtml(courseObstacle) {
    const c = normalizeArenaCheck(checkFor(obstacle));
    const route = c?.route || [];
    const letters = arenaGateLetters(courseObstacle);
    const timeMs = arenaRouteTimeMs(route);
    const up = 'min-h-[52px] rounded-lg border-2 border-emerald-600 bg-emerald-100 text-emerald-900 text-xl font-bold active:scale-95 dark:bg-emerald-900/40 dark:text-emerald-100 dark:border-emerald-700';
    const down = 'min-h-[44px] rounded-lg border border-red-300 bg-red-100 text-red-800 text-lg font-medium active:scale-95 dark:bg-red-900/40 dark:text-red-100 dark:border-red-800';
    return `
        <div class="rounded-lg border dark:border-gray-700 p-3 space-y-2">
            <div class="flex items-baseline justify-between gap-2">
                <div class="text-xs font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">${escapeHtml(t('ao_route'))}</div>
                ${timeMs != null ? `<div class="text-sm font-semibold dark:text-gray-200">${escapeHtml(t('ao_obstacle_time'))}: <span id="ao-routeTime" class="tabular-nums">${escapeHtml(msToLabel(timeMs))}</span></div>` : ''}
            </div>
            <div id="ao-route" class="min-h-[2.5rem] rounded-md bg-gray-50 dark:bg-gray-900/50 px-2 py-1 font-mono text-2xl font-bold tracking-wider break-words dark:text-white">${route.length ? route.map((e) => `<span title="${escapeHtml(splitLabel(e.ms))}" class="${e.g === e.g.toUpperCase() ? '' : 'text-red-600 dark:text-red-400'}">${escapeHtml(e.g)}</span>`).join(' ') : '<span class="text-base font-normal text-gray-400">–</span>'}</div>
            <div class="text-xs text-gray-600 dark:text-gray-400">${escapeHtml(t('ao_forward'))}</div>
            <div class="grid grid-cols-4 sm:grid-cols-6 gap-2">${letters.map((L) => `<button type="button" data-ao-gate="${L}" class="${up}">${L}</button>`).join('')}</div>
            <div class="text-xs text-gray-600 dark:text-gray-400">${escapeHtml(t('ao_backward'))}</div>
            <div class="grid grid-cols-4 sm:grid-cols-6 gap-2">${letters.map((L) => `<button type="button" data-ao-gate="${L.toLowerCase()}" class="${down}">${L.toLowerCase()}</button>`).join('')}</div>
            <div class="grid grid-cols-2 gap-2">
                <button type="button" data-ao-gate="undo" ${route.length ? '' : 'disabled'} class="min-h-[44px] rounded-lg border bg-gray-50 font-semibold dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 disabled:opacity-30">${escapeHtml(t('ao_undo'))}</button>
                <button type="button" data-ao-gate="clear" ${route.length ? '' : 'disabled'} class="min-h-[44px] rounded-lg border bg-gray-50 font-semibold dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 disabled:opacity-30">${escapeHtml(t('ao_clear'))}</button>
            </div>
        </div>`;
}

function verdictHtml() {
    const c = normalizeArenaCheck(checkFor(obstacle));
    const result = c?.result || null;
    const knocks = c?.knocks || 0;
    const big = 'min-h-[56px] w-full rounded-xl border-2 text-lg font-bold';
    const on = (active, tone) => (active ? tone : 'bg-white text-gray-800 border-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600');
    return `
        <button type="button" data-ao-action="ok" class="${big} ${on(result === 'ok', 'bg-emerald-600 border-emerald-600 text-white')}">✓ ${escapeHtml(t('ao_ok'))}</button>
        <div class="flex items-center gap-2">
            <button type="button" data-ao-action="knockRemove" ${knocks > 0 ? '' : 'disabled'} aria-label="${escapeHtml(t('ao_knock'))} −" class="min-h-[56px] min-w-[56px] rounded-xl border-2 text-2xl font-bold bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:text-white disabled:opacity-30">−</button>
            <div class="flex-1 text-center"><div class="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">${escapeHtml(t('ao_knock'))}</div><div id="ao-knocks" class="text-3xl font-black tabular-nums dark:text-white">${knocks}</div></div>
            <button type="button" data-ao-action="knockAdd" aria-label="${escapeHtml(t('ao_knock'))} +" class="min-h-[56px] min-w-[56px] rounded-xl border-2 text-2xl font-bold border-red-400 bg-red-50 text-red-800 dark:bg-red-900/30 dark:border-red-700 dark:text-red-100">+</button>
        </div>
        <div class="grid grid-cols-2 gap-2">
            <button type="button" data-ao-action="wrongCorrected" class="${big} ${on(result === 'wrongCorrected', 'bg-amber-500 border-amber-500 text-white')}">${escapeHtml(t('ao_wrong_corrected'))}</button>
            <button type="button" data-ao-action="wrongUncorrected" class="${big} ${on(result === 'wrongUncorrected', 'bg-red-600 border-red-600 text-white')}">${escapeHtml(t('ao_wrong_uncorrected'))}</button>
        </div>
        <p id="ao-status" class="text-center text-sm text-gray-600 dark:text-gray-300">${escapeHtml(t('ao_reported'))}: ${escapeHtml(verdictText(checkFor(obstacle)))}</p>`;
}

// The whole course: every obstacle in driving order; a tap logs the passage
// with its split time (as the precision observer's passages)
function coursePassagesHtml(eq) {
    const course = settingsOf(eq).obstacles || [];
    if (!course.length) return `<p class="text-sm text-amber-800 dark:text-amber-200">${escapeHtml(t('ao_course_empty'))}</p>`;
    const passed = course
        .map((o) => ({ o, c: normalizeArenaCheck(checkFor(o.label)) }))
        .filter(({ c }) => c?.passAt != null);
    return `
        <div class="text-xs font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">${escapeHtml(t('ao_passages'))}</div>
        <div class="grid grid-cols-3 sm:grid-cols-4 gap-2">${course.map((o) => {
            const c = normalizeArenaCheck(checkFor(o.label));
            const done = c?.passAt != null;
            return `<button type="button" data-ao-pass="${escapeHtml(o.label)}" class="min-h-[64px] rounded-lg border-2 px-1 ${done ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-gray-300 bg-white text-gray-900 dark:bg-gray-700 dark:border-gray-600 dark:text-white'}">
                <div class="text-xl font-black">${escapeHtml(o.label)}</div>
                <div class="text-xs tabular-nums">${done ? escapeHtml(splitLabel(c.passMs)) : '&nbsp;'}</div>
            </button>`;
        }).join('')}</div>
        <button type="button" data-ao-pass-undo="1" ${passed.length ? '' : 'disabled'} class="min-h-[44px] w-full rounded-lg border bg-gray-50 font-semibold dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 disabled:opacity-30">${escapeHtml(t('ao_pass_undo'))}</button>`;
}

function renderRecent() {
    const host = document.getElementById('ao-recent');
    if (!host) return;
    if (obstacle === COURSE) { host.innerHTML = ''; return; }
    const list = [...checks.values()]
        .map((c) => ({ raw: c, c: normalizeArenaCheck(c) }))
        .filter(({ c }) => c && c.obstacle === obstacle && (c.result || c.knocks || c.route.length))
        .sort((a, b) => (b.c.at || 0) - (a.c.at || 0))
        .slice(0, 8);
    if (!list.length) { host.innerHTML = ''; return; }
    host.innerHTML = `<h3 class="mb-2 text-xs font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">${escapeHtml(t('ao_recent'))}</h3>
        <ul class="divide-y dark:divide-gray-700 text-sm">${list.map(({ raw, c }) => {
            const eq = eqOf(c.startNumber);
            return `<li class="py-2 flex justify-between gap-2 dark:text-gray-200"><span>#${escapeHtml(c.startNumber)} ${escapeHtml(eq?.driverName || '')} <span class="text-gray-500 dark:text-gray-400">· ${escapeHtml(eq ? roundLabel(eq, c.round) : c.round)}</span></span><span class="font-semibold text-right">${escapeHtml(verdictText(raw))}</span></li>`;
        }).join('')}</ul>`;
}

// Writes only the given fields of the report on label (optimistic: shown at once)
async function write(label, fields, localFields = fields) {
    if (!selected || !label || !competitionId) return;
    const eq = eqOf(selected.sn);
    if (!eq) return;
    const target = { ...selected };
    const id = arenaCheckId(target.sn, target.round, label);
    checks.set(id, { ...(checks.get(id) || {}), startNumber: Number(target.sn), round: target.round, obstacle: label, ...localFields, at: Date.now() });
    render();
    const onError = (error) => {
        console.warn('[arena-obstacle] report refused:', error?.message || error);
        showAlert(t('ao_save_error'), 'error');
    };
    try {
        await saveArenaCheck(competitionId, {
            startNumber: target.sn,
            className: eq.className,
            round: target.round,
            obstacle: label,
            by: getGlobalState('currentUser')?.uid || ''
        }, fields, { onLateError: onError });
    } catch (error) {
        onError(error);
    }
}

function report(action) {
    const next = nextArenaCheck(checkFor(obstacle), action);
    if (next) write(obstacle, { result: next.result, knocks: next.knocks });
}

function gate(action) {
    const route = normalizeArenaCheck(checkFor(obstacle))?.route || [];
    if (action === 'clear' && route.length && !confirm(t('ao_clear_confirm'))) return;
    const next = nextArenaRoute(route, action, { ms: elapsedNow(), at: serverNow() });
    if (next) write(obstacle, { route: next });
}

function pass(label) {
    if (normalizeArenaCheck(checkFor(label))?.passAt != null) return;
    write(label, { passMs: elapsedNow(), passAt: serverNow() });
}

// Undo the latest passage of the selected equipage and round
function undoPass() {
    const eq = selected ? eqOf(selected.sn) : null;
    if (!eq) return;
    const latest = (settingsOf(eq).obstacles || [])
        .map((o) => ({ label: o.label, c: normalizeArenaCheck(checkFor(o.label)) }))
        .filter(({ c }) => c?.passAt != null)
        .sort((a, b) => b.c.passAt - a.c.passAt)[0];
    if (latest) write(latest.label, { passMs: deleteField(), passAt: deleteField() }, { passMs: null, passAt: null });
}

export async function load() {
    const mySeq = ++loadSeq;
    const comp = getGlobalState('currentCompetition');
    competitionId = comp?.id || null;
    if (!competitionId) return;
    renderLayout();
    startServerClockSync();
    try {
        const [eqData, configData] = await Promise.all([getEquipages(competitionId), getConfig(competitionId, 'precisionConfig')]);
        if (mySeq !== loadSeq) return;
        config = configData || {};
        equipages = (eqData || [])
            .filter((e) => e.startNumber && e.status !== 'struken')
            .map((e) => ({ startNumber: Number(e.startNumber), driverName: e.driverName || '', className: e.className || '' }))
            .sort((a, b) => a.startNumber - b.startNumber);
    } catch (error) {
        console.error('[arena-obstacle] load:', error);
        showAlert(t('ao_load_error'), 'error');
        return;
    }

    obstacle = readStored(`${OBSTACLE_KEY}.${competitionId}`);
    renderObstacleSelect();
    document.getElementById('ao-obstacle')?.addEventListener('change', (e) => {
        obstacle = e.target.value;
        writeStored(`${OBSTACLE_KEY}.${competitionId}`, obstacle);
        render();
    });

    dropdown = createSearchableDropdown(document.getElementById('ao-search'), equipages.filter(isArena), (eq) => {
        if (!eq) return;
        follow = false;
        const d = precisionDocs.get(String(eq.startNumber));
        const rounds = arenaRoundsOf(settingsOf(eq));
        const round = runningPrecisionRound(d) || (rounds.includes(d?.activeRound) ? d.activeRound : 'phase1');
        selected = { sn: String(eq.startNumber), round };
        render();
    });
    document.getElementById('ao-follow')?.addEventListener('click', () => {
        follow = true;
        adoptRunning();
        render();
    });
    const page = document.getElementById('page-arena-obstacle');
    // The page element stays between visits: one handler, replaced on each load
    if (page) page.onclick = (e) => {
        const action = e.target.closest('[data-ao-action]');
        if (action) { report(action.dataset.aoAction); return; }
        const gateBtn = e.target.closest('[data-ao-gate]');
        if (gateBtn) { gate(gateBtn.dataset.aoGate); return; }
        const passBtn = e.target.closest('[data-ao-pass]');
        if (passBtn) { pass(passBtn.dataset.aoPass); return; }
        if (e.target.closest('[data-ao-pass-undo]')) { undoPass(); return; }
        const round = e.target.closest('[data-ao-round]');
        if (round && selected) {
            follow = false;
            selected = { ...selected, round: round.dataset.aoRound };
            render();
        }
    };

    unsubs.push(onSnapshot(collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/precision`), (snap) => {
        if (mySeq !== loadSeq) return;
        precisionDocs = new Map(snap.docs.map((d) => [d.id, d.data()]));
        adoptRunning();
        render();
    }, (error) => console.warn('[arena-obstacle] precision listener:', error?.message || error)));
    unsubs.push(listenArenaChecks(competitionId, (list) => {
        if (mySeq !== loadSeq) return;
        checks = new Map(list.map((c) => [c.id, c]));
        render();
    }));
    render();
}

export function __unload() {
    loadSeq++;
    stopServerClockSync();
    unsubs.forEach((u) => { try { u(); } catch { /* already gone */ } });
    unsubs = [];
    if (dropdown?.destroy) { try { dropdown.destroy(); } catch { /* gone */ } }
    dropdown = null;
    competitionId = null;
    config = {};
    equipages = [];
    precisionDocs = new Map();
    checks = new Map();
    selected = null;
    follow = true;
}
