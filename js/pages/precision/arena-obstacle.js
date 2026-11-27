// Arena driving: the obstacle controller's page (optional). The controller
// picks the obstacle they stand at; the equipage on the course is followed
// automatically (or picked by hand) and the controller reports the gates
// (right / wrong corrected / wrong not corrected) and the knocked elements.
// The report is stored apart from the result (arenaCheckService); the judge
// adds the penalties on the precision input page.

import { getGlobalState } from '../../main.js';
import { getEquipages } from '../../services/equipageService.js';
import { getConfig } from '../../services/competitionService.js';
import { db, appId } from '../../config/firebase-config.js';
import { collection, onSnapshot } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { getCompetitionHeader, createSearchableDropdown, showAlert } from '../../ui/components.js';
import { t } from '../../utils/i18n.js';
import { escapeHtml } from '../../utils/sharedUtils.js';
import { getArenaSettings, getPrecisionFormat } from '../../utils/precisionCalculation.js';
import { arenaRoundsOf } from '../../utils/arenaRules.js';
import { arenaCheckId, arenaControlObstacles, nextArenaCheck, normalizeArenaCheck } from '../../utils/arenaChecks.js';
import { listenArenaChecks, saveArenaCheck } from '../../services/arenaCheckService.js';
import { runningPrecisionRound } from './precisionRoundsDisplay.js';
import { precisionRoundLabelKey } from './precisionRoundInput.js';

const OBSTACLE_KEY = 'arenaObstacle.obstacle';

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

function resultText(check) {
    const c = normalizeArenaCheck(check);
    if (!c || (!c.result && !c.knocks)) return t('ao_nothing');
    const parts = [];
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
                <p id="ao-noObstacles" class="hidden text-sm text-amber-800 dark:text-amber-200">${escapeHtml(t('ao_no_obstacles'))}</p>
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
    document.getElementById('ao-noObstacles')?.classList.toggle('hidden', list.length > 0);
    select.closest('label')?.classList.toggle('hidden', list.length === 0);
    if (!list.some((o) => o.label === obstacle)) obstacle = list[0]?.label || '';
    select.innerHTML = list.map((o) => `<option value="${escapeHtml(o.label)}" ${o.label === obstacle ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
}

// Follow mode: the equipage whose round runs (the first by start number); it
// stays selected after the finish until the next one starts
function adoptRunning() {
    if (!follow) return;
    const running = [...precisionDocs.entries()]
        .map(([sn, d]) => ({ sn, round: runningPrecisionRound(d) }))
        .filter((r) => r.round && isArena(eqOf(r.sn)))
        .sort((a, b) => (Number(a.sn) || 0) - (Number(b.sn) || 0));
    if (running.length && (!selected || selected.sn !== running[0].sn || selected.round !== running[0].round)) {
        selected = running[0];
    }
}

function currentCheck() {
    if (!selected || !obstacle) return null;
    return checks.get(arenaCheckId(selected.sn, selected.round, obstacle)) || null;
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
        ${rounds.length > 1 ? `<div class="mt-2 flex flex-wrap justify-center gap-2">${rounds.map((r) => `<button type="button" data-ao-round="${r}" class="min-h-[40px] px-3 rounded-lg border text-sm font-bold ${r === selected.round ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white text-gray-800 dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600'}">${escapeHtml(roundLabel(eq, r))}</button>`).join('')}</div>` : ''}`;

    const inCourse = arenaControlObstacles(settingsOf(eq)).some((o) => o.label === obstacle)
        || (settingsOf(eq).obstacles || []).some((o) => o.label === obstacle);
    if (!obstacle) {
        actions.innerHTML = '';
    } else if (!inCourse) {
        actions.innerHTML = `<p class="text-sm text-amber-800 dark:text-amber-200">${escapeHtml(t('ao_not_in_course').replace('{obstacle}', obstacle))}</p>`;
    } else {
        const c = normalizeArenaCheck(currentCheck());
        const result = c?.result || null;
        const knocks = c?.knocks || 0;
        const big = 'min-h-[56px] w-full rounded-xl border-2 text-lg font-bold';
        const on = (active, tone) => (active ? tone : 'bg-white text-gray-800 border-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600');
        actions.innerHTML = `
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
            <p id="ao-status" class="text-center text-sm text-gray-600 dark:text-gray-300">${escapeHtml(t('ao_reported'))}: ${escapeHtml(resultText(currentCheck()))}</p>`;
    }
    renderRecent();
}

function renderRecent() {
    const host = document.getElementById('ao-recent');
    if (!host) return;
    const list = [...checks.values()]
        .map((c) => ({ raw: c, c: normalizeArenaCheck(c) }))
        .filter(({ c }) => c && c.obstacle === obstacle)
        .sort((a, b) => (b.c.at || 0) - (a.c.at || 0))
        .slice(0, 8);
    if (!list.length) { host.innerHTML = ''; return; }
    host.innerHTML = `<h3 class="mb-2 text-xs font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">${escapeHtml(t('ao_recent'))}</h3>
        <ul class="divide-y dark:divide-gray-700 text-sm">${list.map(({ raw, c }) => {
            const eq = eqOf(c.startNumber);
            return `<li class="py-2 flex justify-between gap-2 dark:text-gray-200"><span>#${escapeHtml(c.startNumber)} ${escapeHtml(eq?.driverName || '')} <span class="text-gray-500 dark:text-gray-400">· ${escapeHtml(eq ? roundLabel(eq, c.round) : c.round)}</span></span><span class="font-semibold text-right">${escapeHtml(resultText(raw))}</span></li>`;
        }).join('')}</ul>`;
}

async function report(action) {
    if (!selected || !obstacle || !competitionId) return;
    const eq = eqOf(selected.sn);
    if (!eq) return;
    const next = nextArenaCheck(currentCheck(), action);
    if (!next) return;
    const target = { ...selected };
    const id = arenaCheckId(target.sn, target.round, obstacle);
    // Shown at once; the snapshot confirms it
    checks.set(id, { ...(checks.get(id) || {}), startNumber: Number(target.sn), round: target.round, obstacle, ...next, at: Date.now() });
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
            obstacle,
            result: next.result,
            knocks: next.knocks,
            by: getGlobalState('currentUser')?.uid || ''
        }, { onLateError: onError });
    } catch (error) {
        onError(error);
    }
}

export async function load() {
    const mySeq = ++loadSeq;
    const comp = getGlobalState('currentCompetition');
    competitionId = comp?.id || null;
    if (!competitionId) return;
    renderLayout();
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
