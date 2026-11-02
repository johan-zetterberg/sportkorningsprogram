// js/pages/precision/precisionArenaAdmin.js
// The "Arenakörning" block of a precision class card (format 'arena'): rule
// set, penalty seconds, the competitions / drive-offs and the obstacle list.
// Stored on precisionConfig.courses[className].arena (arenaRules.js).
import { t } from '../../utils/i18n.js';
import { escapeHtml } from '../../utils/sharedUtils.js';
import {
    ARENA_FEI_KNOCK_SEC,
    ARENA_INCIDENTS,
    ARENA_INCIDENT_KEYS,
    ARENA_OBSTACLE_TYPES,
    normalizeArenaSettings
} from '../../utils/arenaRules.js';

const MAX_OBSTACLES = 40;
const INPUT_CLASS = 'mt-1 w-full p-2 border rounded-md text-sm dark:bg-gray-600 dark:border-gray-500 dark:text-white';
const BUTTON_CLASS = 'px-3 py-1.5 rounded-md text-xs font-bold border border-blue-200 text-blue-700 bg-white hover:bg-blue-50 dark:bg-gray-700 dark:border-blue-800 dark:text-blue-300';

const parseSeconds = (value) => {
    const text = String(value ?? '').trim().replace(',', '.');
    if (text === '') return null;
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
};

const fixedSeconds = (key) => (key === 'knock' ? ARENA_FEI_KNOCK_SEC : ARENA_INCIDENTS[key].sec);

function selectHtml(cls, options, current) {
    return `<select class="${cls} ${INPUT_CLASS}">${options.map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === current ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select>`;
}

function obstacleRowHtml(obstacle = {}) {
    const typeOptions = ARENA_OBSTACLE_TYPES.map(type => [type, t(`arena_admin_type_${type.toLowerCase()}`)]);
    return `
        <div class="arena-obstacle-row flex flex-wrap items-end gap-2">
            <label class="block w-28 text-xs text-gray-600 dark:text-gray-300">${escapeHtml(t('arena_admin_obstacle_label'))}
                <input type="text" maxlength="12" value="${escapeHtml(obstacle.label ?? '')}" class="arena-obstacle-label ${INPUT_CLASS}">
            </label>
            <label class="block w-40 text-xs text-gray-600 dark:text-gray-300">${escapeHtml(t('arena_admin_obstacle_type'))}
                ${selectHtml('arena-obstacle-type', typeOptions, obstacle.type || 'cone')}
            </label>
            <button type="button" data-arena-action="remove-obstacle" class="${BUTTON_CLASS}">${escapeHtml(t('arena_admin_remove_obstacle'))}</button>
        </div>`;
}

/** The arena block of a class card (raw = courses[cls].arena); hidden until the format is 'arena' */
export function renderArenaSection(raw, hidden = true) {
    const s = normalizeArenaSettings(raw);
    const trValue = (key) => {
        const v = key === 'knock' ? raw?.knockSec : raw?.incidentSec?.[key];
        const n = parseSeconds(v);
        return n != null && n >= 0 ? n : fixedSeconds(key);
    };
    const secInput = (key, label) => `
        <label class="block text-xs text-gray-600 dark:text-gray-300">${escapeHtml(label)}
            <input type="number" min="0" step="0.5" data-key="${escapeHtml(key)}" data-mode="${s.rules === 'FEI' ? 'fei' : 'tr'}" data-tr-value="${escapeHtml(trValue(key))}"
                value="${escapeHtml(key === 'knock' ? s.knockSec : s.incidentSec[key])}" class="arena-sec-input ${INPUT_CLASS}">
        </label>`;
    const driveOffOptions = [['none', t('arena_admin_driveoff_none')], ['top3', t('arena_admin_driveoff_top3')], ['all', t('arena_admin_driveoff_all')]];
    const driveOff2Options = driveOffOptions.filter(([value]) => value !== 'all');
    const timingOptions = [['fromZero', t('arena_admin_timing_zero')], ['added', t('arena_admin_timing_added')]];
    const box = 'mt-3 rounded-md border border-blue-100 bg-white p-3 dark:border-gray-600 dark:bg-gray-700/40';
    return `
        <div class="precision-arena-section mt-4 rounded-md border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-900/60 dark:bg-blue-900/10 ${hidden ? 'hidden' : ''}">
            <h5 class="text-sm font-bold text-gray-800 dark:text-white">${escapeHtml(t('arena_admin_title'))}</h5>
            <div class="mt-2 max-w-md">
                <label class="block text-sm font-medium dark:text-gray-300">${escapeHtml(t('arena_admin_rules'))}
                    ${selectHtml('arena-rules', [['FEI', t('arena_admin_rules_fei')], ['TR', t('arena_admin_rules_tr')]], s.rules)}
                </label>
            </div>

            <div class="${box} precision-field-wrap">
                <div class="text-sm font-semibold text-gray-800 dark:text-white">${escapeHtml(t('arena_admin_seconds_title'))}</div>
                <p class="arena-hint-fei mt-1 text-xs text-gray-500 dark:text-gray-400">${escapeHtml(t('arena_admin_seconds_fei_hint'))}</p>
                <p class="arena-hint-tr mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300">${escapeHtml(t('arena_admin_seconds_tr_hint'))}</p>
                <div class="arena-seconds-grid mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    ${secInput('knock', t('arena_admin_knock'))}
                    ${ARENA_INCIDENT_KEYS.map(key => secInput(key, t(`arena_admin_inc_${key.toLowerCase()}`))).join('')}
                </div>
            </div>

            <div class="${box}">
                <div class="text-sm font-semibold text-gray-800 dark:text-white">${escapeHtml(t('arena_admin_format_title'))}</div>
                <div class="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label class="block text-sm font-medium dark:text-gray-300">${escapeHtml(t('arena_admin_competitions'))}
                        ${selectHtml('arena-competitions', [['1', '1'], ['2', '2']], String(s.competitions))}
                    </label>
                    <label class="block text-sm font-medium dark:text-gray-300">${escapeHtml(t('arena_admin_driveoff1'))}
                        ${selectHtml('arena-driveoff1', driveOffOptions, s.driveOff1)}
                    </label>
                    <div class="arena-timing1-wrap">
                        <label class="arena-timing1-select block text-sm font-medium dark:text-gray-300">${escapeHtml(t('arena_admin_timing'))}
                            ${selectHtml('arena-timing1', timingOptions, s.driveOff1Timing)}
                        </label>
                        <p class="arena-timing1-fei text-xs text-gray-500 dark:text-gray-400">${escapeHtml(t('arena_admin_timing_fei_note'))}</p>
                    </div>
                </div>
                <div class="arena-comp2 mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label class="block text-sm font-medium dark:text-gray-300">${escapeHtml(t('arena_admin_driveoff2'))}
                        ${selectHtml('arena-driveoff2', driveOff2Options, s.driveOff2 === 'none' ? (s.rules === 'FEI' ? 'top3' : 'none') : s.driveOff2)}
                    </label>
                    <label class="arena-timing2-wrap block text-sm font-medium dark:text-gray-300">${escapeHtml(t('arena_admin_timing'))}
                        ${selectHtml('arena-timing2', timingOptions, s.driveOff2Timing)}
                    </label>
                </div>
            </div>

            <div class="${box} precision-field-wrap">
                <div class="text-sm font-semibold text-gray-800 dark:text-white">${escapeHtml(t('arena_admin_course_title'))}</div>
                <div class="arena-obstacle-list mt-2 space-y-2">${s.obstacles.map(obstacleRowHtml).join('')}</div>
                <p class="arena-obstacles-empty mt-2 text-xs text-gray-500 dark:text-gray-400">${escapeHtml(t('arena_admin_obstacles_empty'))}</p>
                <div class="mt-3 flex flex-wrap items-end gap-2">
                    <button type="button" data-arena-action="add-obstacle" class="${BUTTON_CLASS}">${escapeHtml(t('arena_admin_add_obstacle'))}</button>
                    <label class="block text-xs text-gray-600 dark:text-gray-300">${escapeHtml(t('arena_admin_add_cones_count'))}
                        <input type="number" min="1" max="${MAX_OBSTACLES}" value="5" class="arena-add-count mt-1 w-20 p-1.5 border rounded-md text-sm dark:bg-gray-600 dark:border-gray-500 dark:text-white">
                    </label>
                    <button type="button" data-arena-action="add-cones" class="${BUTTON_CLASS}">${escapeHtml(t('arena_admin_add_cones'))}</button>
                </div>
            </div>
        </div>`;
}

// Shows what the current choices mean: FEI fixed values, which selects apply
export function updateArenaSection(card) {
    const section = card?.querySelector('.precision-arena-section');
    if (!section) return;
    const get = (selector) => section.querySelector(selector);
    const fei = get('.arena-rules').value === 'FEI';

    // FEI: the fixed seconds, read-only; back to TR: the organiser's values return
    section.querySelectorAll('.arena-sec-input').forEach((input) => {
        if (fei && input.dataset.mode !== 'fei') {
            input.dataset.trValue = input.value;
            input.value = String(fixedSeconds(input.dataset.key));
            input.dataset.mode = 'fei';
        } else if (!fei && input.dataset.mode === 'fei') {
            input.value = input.dataset.trValue ?? input.value;
            input.dataset.mode = 'tr';
        }
        input.disabled = fei;
    });
    get('.arena-hint-fei').classList.toggle('hidden', !fei);
    get('.arena-hint-tr').classList.toggle('hidden', fei);

    // Drive-Off 1: always held in a FEI World Cup Leg (5.2)
    const do1 = get('.arena-driveoff1');
    const noneOption = do1.querySelector('option[value="none"]');
    if (noneOption) noneOption.disabled = fei;
    if (fei && do1.value === 'none') do1.value = 'top3';
    get('.arena-timing1-wrap').classList.toggle('hidden', do1.value === 'none');
    get('.arena-timing1-select').classList.toggle('hidden', fei);
    get('.arena-timing1-fei').classList.toggle('hidden', !fei);

    // Competition 2 and its drive-off (FEI: the best three, 5.3)
    const two = get('.arena-competitions').value === '2';
    get('.arena-comp2').classList.toggle('hidden', !two);
    const do2 = get('.arena-driveoff2');
    if (fei) do2.value = 'top3';
    do2.disabled = fei;
    get('.arena-timing2-wrap').classList.toggle('hidden', do2.value === 'none');

    get('.arena-obstacles-empty').classList.toggle('hidden', section.querySelectorAll('.arena-obstacle-row').length > 0);
}

/**
 * Click on an obstacle-list button of a class card; true when handled.
 * (The caller then runs updateArenaSection / the readiness check.)
 */
export function handleArenaClick(event) {
    const button = event.target.closest?.('[data-arena-action]');
    const section = button?.closest('.precision-arena-section');
    if (!button || !section) return false;
    const list = section.querySelector('.arena-obstacle-list');
    const rows = () => list.querySelectorAll('.arena-obstacle-row');
    const action = button.dataset.arenaAction;

    if (action === 'remove-obstacle') {
        button.closest('.arena-obstacle-row')?.remove();
    } else if (action === 'add-obstacle') {
        if (rows().length < MAX_OBSTACLES) {
            list.insertAdjacentHTML('beforeend', obstacleRowHtml({ label: '', type: 'cone' }));
            list.lastElementChild?.querySelector('.arena-obstacle-label')?.focus();
        }
    } else if (action === 'add-cones') {
        // Numbered cones, skipping labels already in use
        const used = new Set([...list.querySelectorAll('.arena-obstacle-label')].map(input => input.value.trim().toLowerCase()));
        const wanted = Math.max(1, Math.min(MAX_OBSTACLES, Math.floor(Number(section.querySelector('.arena-add-count')?.value) || 0)));
        let next = 1;
        let html = '';
        let count = rows().length;
        for (let added = 0; added < wanted && count < MAX_OBSTACLES; added += 1, count += 1) {
            while (used.has(String(next))) next += 1;
            used.add(String(next));
            html += obstacleRowHtml({ label: String(next), type: 'cone' });
        }
        list.insertAdjacentHTML('beforeend', html);
    } else {
        return false;
    }
    updateArenaSection(section.closest('[data-class-name]'));
    return true;
}

/**
 * The card's arena settings from the form:
 *   settings    what is stored on courses[cls].arena (FEI: only the choices;
 *               the fixed seconds are applied by normalizeArenaSettings)
 *   validation  the raw values for validatePrecisionArenaSettings
 * null when the card has no arena block.
 */
export function readArenaForm(card) {
    const section = card?.querySelector('.precision-arena-section');
    if (!section) return null;
    const get = (selector) => section.querySelector(selector);
    const rules = get('.arena-rules').value === 'TR' ? 'TR' : 'FEI';
    const competitions = get('.arena-competitions').value === '2' ? 2 : 1;
    const driveOff1 = get('.arena-driveoff1').value;
    const driveOff2 = competitions === 2 ? get('.arena-driveoff2').value : 'none';

    const obstacles = [...section.querySelectorAll('.arena-obstacle-row')]
        .map(row => ({
            label: row.querySelector('.arena-obstacle-label').value.trim(),
            type: row.querySelector('.arena-obstacle-type').value
        }))
        .filter(o => o.label);

    const settings = { rules, competitions, driveOff1 };
    if (driveOff1 !== 'none') settings.driveOff1Timing = get('.arena-timing1').value;
    if (competitions === 2) {
        settings.driveOff2 = driveOff2;
        if (driveOff2 !== 'none') settings.driveOff2Timing = get('.arena-timing2').value;
    }
    if (rules === 'FEI') delete settings.driveOff1Timing; // derived from Drive-Off 1 (FEI WC 5.2.2)
    settings.obstacles = obstacles;

    const rawSeconds = {};
    section.querySelectorAll('.arena-sec-input').forEach((input) => { rawSeconds[input.dataset.key] = input.value; });
    const validation = {
        rules,
        knockSec: rawSeconds.knock,
        incidentSec: Object.fromEntries(ARENA_INCIDENT_KEYS.map(key => [key, rawSeconds[key]])),
        obstacles
    };

    if (rules === 'TR') {
        const knock = parseSeconds(rawSeconds.knock);
        if (knock != null) settings.knockSec = knock;
        const incidentSec = {};
        ARENA_INCIDENT_KEYS.forEach((key) => {
            const n = parseSeconds(rawSeconds[key]);
            if (n != null) incidentSec[key] = n;
        });
        settings.incidentSec = incidentSec;
    }
    return { settings, validation };
}
