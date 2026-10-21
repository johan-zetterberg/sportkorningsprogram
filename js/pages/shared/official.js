import { getGlobalState } from '../../main.js';
import { getCompetitionHeader, renderNoCompetitionState } from '../../ui/components.js';
import { t } from '../../utils/i18n.js';
import { getOfficials, getJudges } from '../../services/adminService.js';
import { getCompetitionStatistics, getConfig } from '../../services/competitionService.js';
import { getEquipages } from '../../services/equipageService.js';
import { listenForAssignments, listenForLocations } from '../../services/officialsService.js';
import { listenForMarathonObstacles } from '../../services/marathonService.js';
import { escapeHtml } from '../../utils/sharedUtils.js';
import { mergeUserRoles } from '../../utils/roleAccess.js';
import { roleLabel } from '../../services/authService.js';
import { TASK_ICONS, buildOfficialTasks, fillTemplate, findMyRecords, mergeObstacleLocations } from '../../utils/officialTaskUtils.js';
import { mountEmergencyInfoCard } from '../../ui/emergencyInfoCard.js';
import { mountPushPanel } from '../../ui/pushSettingsPanel.js';
import { pushRoleForRoles } from '../../utils/pushPanelUtils.js';

let unsubscribers = [];
let loadToken = 0;

export function __unload() {
    loadToken++;
    unsubscribers.forEach((unsubscribe) => { try { unsubscribe(); } catch (_) { } });
    unsubscribers = [];
    delete window.official_openTask;
}

// A shortcut tile (reports, monitors ...)
function tile(href, icon, title, desc) {
    return `
        <a href="${escapeHtml(href)}" class="flex items-center gap-3 p-3 min-h-[44px] bg-gray-50 dark:bg-gray-700/50 rounded-lg hover:bg-blue-50 dark:hover:bg-gray-700 transition border border-gray-100 dark:border-gray-600">
            <span class="w-10 h-10 shrink-0 rounded-full bg-white dark:bg-gray-800 flex items-center justify-center text-xl" aria-hidden="true">${icon}</span>
            <span class="min-w-0">
                <span class="block font-bold text-gray-900 dark:text-gray-100">${escapeHtml(title)}</span>
                <span class="block text-xs text-gray-500 dark:text-gray-400">${escapeHtml(desc)}</span>
            </span>
        </a>`;
}

// An input page button (dressage, obstacles ...)
function toolButton(hash, icon, label) {
    return `
        <a href="${escapeHtml(hash)}" class="p-3 min-h-[44px] bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 rounded-lg text-center transition">
            <span class="block text-2xl mb-1" aria-hidden="true">${icon}</span>
            <span class="block font-bold text-sm text-slate-800 dark:text-slate-200">${escapeHtml(label)}</span>
        </a>`;
}

export async function load() {
    __unload();
    const token = ++loadToken;
    const user = getGlobalState('currentUser');
    const container = document.getElementById('page-official');
    if (!container) return;

    if (!user) {
        container.innerHTML = `
            <div class="max-w-md mx-auto my-8 p-6 text-center bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
                <h2 class="text-xl font-bold mb-2 text-gray-900 dark:text-white">${escapeHtml(t('official_title'))}</h2>
                <p class="text-gray-600 dark:text-gray-300">${escapeHtml(t('official_login_required'))}</p>
                <button type="button" data-action="openLoginModal" class="mt-4 min-h-[44px] px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold">${escapeHtml(t('login'))}</button>
            </div>`;
        return;
    }

    const competition = getGlobalState('currentCompetition');
    if (!competition) {
        container.innerHTML = `<div class="container mx-auto p-3 sm:p-4">${renderNoCompetitionState()}</div>`;
        return;
    }

    const name = user.displayName || user.email || '';
    container.innerHTML = `
        <div class="container mx-auto p-3 sm:p-4 md:p-8">
            ${getCompetitionHeader(competition, t('official_title'))}

            <!-- DIN UPPGIFT: first, big -->
            <section class="mt-4 md:mt-6 bg-white dark:bg-gray-800 rounded-xl shadow p-4 md:p-6 border-t-4 border-blue-600" aria-labelledby="official-task-heading">
                <p class="text-sm text-gray-600 dark:text-gray-300">${escapeHtml(fillTemplate(t('official_welcome'), { name }))}</p>
                <h2 id="official-task-heading" class="text-2xl font-bold text-gray-900 dark:text-white mt-1 mb-4">${escapeHtml(t('official_your_task'))}</h2>
                <div id="official-tasks" class="space-y-3" aria-live="polite">
                    <div class="animate-pulse h-20 bg-gray-100 dark:bg-gray-700 rounded-lg"></div>
                </div>
                <div id="official-push" class="mt-4"></div>
            </section>

            <div id="official-emergency" class="mt-4 md:mt-6"></div>

            <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6 mt-4 md:mt-6">
                <!-- Status widgets -->
                <section class="bg-white dark:bg-gray-800 rounded-xl shadow p-4 md:p-6 lg:col-span-1 space-y-4" aria-label="${escapeHtml(t('official_status_title'))}">
                    <div class="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-lg border border-indigo-100 dark:border-indigo-800">
                        <h3 class="font-bold text-indigo-900 dark:text-indigo-100 text-sm uppercase mb-1">${escapeHtml(t('official_next_start'))}</h3>
                        <div id="widget-next-start" class="text-sm text-indigo-800 dark:text-indigo-200">${escapeHtml(t('official_loading'))}</div>
                    </div>
                    <div id="widget-pending-container" class="bg-orange-50 dark:bg-orange-900/20 p-4 rounded-lg border border-orange-100 dark:border-orange-800 hidden">
                        <h3 class="font-bold text-orange-900 dark:text-orange-100 text-sm uppercase mb-1">${escapeHtml(t('official_pending_title'))}</h3>
                        <div id="widget-pending-text" class="text-sm text-orange-800 dark:text-orange-200">-</div>
                    </div>
                </section>

                <!-- Input pages -->
                <section class="bg-white dark:bg-gray-800 rounded-xl shadow p-4 md:p-6 lg:col-span-2">
                    <h3 class="text-lg font-bold text-gray-800 dark:text-gray-100 mb-3">${escapeHtml(t('official_tools_title'))}</h3>
                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        ${toolButton('#dressyr-input', TASK_ICONS.dressage, t('menu_dressage'))}
                        ${toolButton('#maraton-input', TASK_ICONS.obstacle, t('official_tool_obstacles'))}
                        ${toolButton('#maraton-stages', TASK_ICONS.stages, t('menu_stages'))}
                        ${toolButton('#precision-input', TASK_ICONS.precision, t('menu_precision'))}
                    </div>
                </section>
            </div>

            <section class="mt-4 md:mt-6 bg-white dark:bg-gray-800 rounded-xl shadow p-4 md:p-6">
                <h3 class="text-lg font-bold text-gray-800 dark:text-gray-100 mb-3">${escapeHtml(t('official_shortcuts_title'))}</h3>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    ${tile('#reports', '📄', t('menu_reports'), t('official_tile_reports_desc'))}
                    ${tile('#incidents', '⚖️', t('menu_incidents'), t('official_tile_incidents_desc'))}
                    ${tile('#speaker', TASK_ICONS.speaker, t('menu_speaker'), t('official_tile_speaker_desc'))}
                    ${tile('#vet-check', TASK_ICONS.vet, t('menu_vet'), t('official_tile_vet_desc'))}
                    ${tile('#dressyr-monitor', TASK_ICONS.dressage, `${t('menu_dressage')} – ${t('menu_monitor')}`, t('official_tile_monitor_desc'))}
                    ${tile('#maraton-monitor', TASK_ICONS.obstacle, `${t('menu_marathon')} – ${t('menu_monitor')}`, t('official_tile_monitor_desc'))}
                    ${tile('#precision-monitor', TASK_ICONS.precision, `${t('menu_precision')} – ${t('menu_monitor')}`, t('official_tile_monitor_desc'))}
                </div>
            </section>
        </div>
    `;

    // A task's button: an obstacle opens the input page on that obstacle
    window.official_openTask = (route, obstacleNumber) => {
        if (obstacleNumber) {
            try { localStorage.setItem(`maratonLastObstacle_${competition.id}`, String(obstacleNumber)); } catch (_) { }
        }
        if (route) window.location.hash = route;
    };

    loadTasks(competition, user, token);
    // Notiser (web push): the topics follow the user's roles
    mountPushPanel(document.getElementById('official-push'), { role: pushRoleForRoles(mergeUserRoles(user)), competitionId: competition.id })
        .catch((error) => console.warn('Notiser kunde inte visas:', error));
    loadDashboard(competition.id, user, token);
    // Nödinfo with the persons' phone numbers (officials may read them)
    mountEmergencyInfoCard(document.getElementById('official-emergency'), competition.id)
        .catch((error) => console.warn('Nödinfo kunde inte visas:', error));
}

function renderTask(task) {
    const params = task.titleParams || {};
    const generic = task.kind === 'general' || task.kind === 'secretariat';
    let title = generic && task.roleLabel ? task.roleLabel : fillTemplate(t(task.titleKey), params);
    if (task.kind === 'obstacle' && params.name) title += ` – ${params.name}`;
    const details = [
        task.roleLabel && !generic ? [t('official_task_role'), task.roleLabel] : null,
        task.place && task.kind !== 'obstacle' ? [t('official_task_place'), task.place] : null,
        task.date ? [t('official_task_date'), task.date] : null,
        task.time ? [t('official_task_time'), task.time] : null,
        task.meetingPoint ? [t('official_task_meeting'), task.meetingPoint] : null,
        task.briefing ? [t('official_task_briefing'), task.briefing] : null
    ].filter(Boolean);
    const sourceLabel = task.source === 'plan' ? t('official_task_source_plan')
        : task.source === 'judge' ? t('official_task_source_judge') : t('official_task_source_role');
    const button = task.route ? `
        <button type="button" class="w-full sm:w-auto min-h-[48px] px-5 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-base shadow-sm"
            data-action="official_openTask" data-action-args='${escapeHtml(JSON.stringify([task.route, task.obstacleNumber || null]))}'>
            ${escapeHtml(fillTemplate(t('official_task_open'), { title }))}
        </button>` : '';

    return `
        <article class="p-4 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-900/20 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
            <span class="text-3xl shrink-0" aria-hidden="true">${task.icon || TASK_ICONS.general}</span>
            <div class="flex-1 min-w-0">
                <div class="text-[11px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">${escapeHtml(sourceLabel)}</div>
                <h3 class="text-lg font-bold text-gray-900 dark:text-white">${escapeHtml(title)}</h3>
                ${details.length ? `<dl class="mt-1 grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-sm text-gray-700 dark:text-gray-300">
                    ${details.map(([label, value]) => `<dt class="font-semibold">${escapeHtml(label)}</dt><dd class="min-w-0 break-words whitespace-pre-line">${escapeHtml(value)}</dd>`).join('')}
                </dl>` : ''}
            </div>
            ${button}
        </article>`;
}

function loadTasks(competition, user, token) {
    const el = () => document.getElementById('official-tasks');
    const roles = mergeUserRoles(user);
    const state = { officials: null, judges: null, assignments: null, locations: [], obstacles: [] };

    const render = () => {
        if (token !== loadToken || !el()) return;
        if (state.officials === null || state.judges === null || state.assignments === null) return;
        const tasks = buildOfficialTasks({
            roles,
            officials: findMyRecords(state.officials, user),
            judges: findMyRecords(state.judges, user),
            assignments: state.assignments,
            locations: mergeObstacleLocations(state.locations, state.obstacles, state.assignments),
            obstacles: state.obstacles
        });
        el().innerHTML = tasks.length
            ? tasks.map(renderTask).join('')
            : `<p class="text-sm text-gray-600 dark:text-gray-300">${escapeHtml(t('official_no_task'))}</p>
               <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">${escapeHtml(fillTemplate(t('official_your_roles'), { roles: roles.map(roleLabel).join(', ') }))}</p>`;
    };

    Promise.all([getOfficials(competition.id), getJudges(competition.id)])
        .then(([officials, judges]) => {
            state.officials = officials || [];
            state.judges = judges || [];
            render();
        })
        .catch((err) => {
            console.error('Error loading assignments:', err);
            state.officials = state.officials || [];
            state.judges = state.judges || [];
            render();
        });

    // The plan, its places and the obstacles: live, the admin may change them
    unsubscribers.push(listenForAssignments(competition.id, (data) => { state.assignments = data || []; render(); }));
    unsubscribers.push(listenForLocations(competition.id, (data) => { state.locations = data || []; render(); }));
    unsubscribers.push(listenForMarathonObstacles(competition.id, (data) => { state.obstacles = data || []; render(); }));
}

async function loadDashboard(competitionId, user, token) {
    const nextStartEl = document.getElementById('widget-next-start');
    if (!nextStartEl) return;

    try {
        const [equipages, startTimes] = await Promise.all([
            getEquipages(competitionId),
            getConfig(competitionId, 'startTimes')
        ]);
        if (token !== loadToken) return;

        const times = (startTimes && startTimes.times) ? startTimes.times : {};
        const now = new Date();
        const allUpcoming = [];

        equipages.forEach(eq => {
            const tEntry = times[String(eq.startNumber)];
            if (!tEntry) return;
            // Only times with a date ("2024-05-10T09:00") can be compared with now
            const addIfFuture = (timeStr, type, label) => {
                if (!timeStr || !String(timeStr).includes('T')) return;
                const date = new Date(timeStr);
                if (!isNaN(date.getTime()) && date > now) allUpcoming.push({ eq, date, type, label });
            };
            addIfFuture(tEntry.dressage || tEntry.dressyr, 'dressage', t('menu_dressage'));
            addIfFuture(tEntry.marathon || tEntry.maraton, 'obstacle', t('menu_marathon'));
            addIfFuture(tEntry.precision, 'precision', t('menu_precision'));
        });

        allUpcoming.sort((a, b) => a.date - b.date);
        const next = allUpcoming[0];
        if (next) {
            const timeStr = next.date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
            nextStartEl.innerHTML = `
                <div class="flex items-center gap-2 mb-1">
                    <span class="text-xl" aria-hidden="true">${TASK_ICONS[next.type]}</span>
                    <div class="font-bold text-lg leading-none">${escapeHtml(timeStr)}</div>
                    <div class="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 font-bold">${escapeHtml(next.label || '')}</div>
                </div>
                <div class="font-medium truncate">#${escapeHtml(String(next.eq.startNumber || ''))} ${escapeHtml(next.eq.driverName || '')}</div>
                <div class="text-xs opacity-75 truncate">${escapeHtml(next.eq.className || '')}</div>
            `;
        } else {
            nextStartEl.textContent = t('official_no_more_starts');
        }

        // Pending verifications: officials who finalize results
        const roles = new Set(mergeUserRoles(user));
        const canSeePending = ['admin', 'sekretariat', 'superadmin', 'domare', 'dressage', 'marathon', 'precision']
            .some(role => roles.has(role));
        const pendingWidget = document.getElementById('widget-pending-container');
        const pendingText = document.getElementById('widget-pending-text');
        if (!canSeePending || !pendingWidget || !pendingText) return;
        pendingWidget.classList.remove('hidden');

        const stats = await getCompetitionStatistics(competitionId);
        if (token !== loadToken) return;
        const total = (stats.dressage || 0) + (stats.marathon || 0) + (stats.precision || 0);
        const links = [];
        if (stats.dressage > 0) links.push(`<a href="#dressyr-results" class="underline">${Number(stats.dressage)} ${escapeHtml(t('menu_dressage'))}</a>`);
        if (stats.marathon > 0) links.push(`<a href="#maraton-results" class="underline">${Number(stats.marathon)} ${escapeHtml(t('menu_marathon'))}</a>`);
        if (stats.precision > 0) links.push(`<a href="#precision-results" class="underline">${Number(stats.precision)} ${escapeHtml(t('menu_precision'))}</a>`);

        if (total > 0) {
            pendingText.innerHTML = `
                <div class="font-bold text-orange-700 dark:text-orange-300">${escapeHtml(fillTemplate(t('official_pending_count'), { count: total }))}</div>
                <div class="text-xs mt-1 flex flex-wrap gap-2">${links.join('<span class="opacity-50" aria-hidden="true">•</span>')}</div>
            `;
        } else {
            pendingText.innerHTML = `<span class="text-green-700 dark:text-green-400 text-sm font-medium">${escapeHtml(t('official_all_attested'))}</span>`;
            pendingWidget.classList.replace('bg-orange-50', 'bg-green-50');
            pendingWidget.classList.replace('border-orange-100', 'border-green-100');
            pendingWidget.classList.replace('dark:bg-orange-900/20', 'dark:bg-green-900/20');
            pendingWidget.classList.replace('dark:border-orange-800', 'dark:border-green-800');
        }
    } catch (err) {
        console.error('Dashboard load error:', err);
        if (token === loadToken) nextStartEl.textContent = t('official_load_failed');
    }
}
