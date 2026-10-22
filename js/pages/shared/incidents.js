// #incidents: the protest / incident / ground jury decision log, the
// secretariat's corrections (with links to the entries they name), the staff
// notifications (vet strikes for the ground jury, driver declaration
// changes) and the field devices' status. Private: admins, the TD / ground
// jury and the discipline officials (the vet reads).
import { getGlobalState } from '../../main.js';
import { getCompetitionHeader, renderNoCompetitionState, showAlert } from '../../ui/components.js';
import { escapeHtml } from '../../utils/sharedUtils.js';
import { getCurrentLanguage, t } from '../../utils/i18n.js';
import { mergeUserRoles } from '../../utils/roleAccess.js';
import { createIncident, getCorrectionLog, listenForIncidents, updateIncident } from '../../services/incidentService.js';
import {
    INCIDENT_DISCIPLINES,
    INCIDENT_DISCIPLINE_LABELS,
    INCIDENT_STATUSES,
    INCIDENT_STATUS_LABELS,
    INCIDENT_TYPES,
    INCIDENT_TYPE_LABELS,
    correctionsForIncident,
    filterAuditEntries,
    filterIncidents,
    incidentsToCsv,
    labelFor,
    matchIncidentForReference,
    sortIncidents,
    summarizeAuditChanges,
    toLocalDateTimeValue
} from '../../services/incidentUtils.js';
import { CORRECTION_REFERENCE_TYPES } from '../../services/secretariatPatchUtils.js';
import { listenForFieldDevices } from '../../services/deviceHeartbeatService.js';
import { formatSince, summarizeDevices } from '../../services/deviceHeartbeatUtils.js';
import { canDecideVetStrikes, mountStaffNoticesPanel, runVetStrikeDecision } from '../../ui/staffNoticesPanel.js';

const TABS = ['log', 'corrections', 'notices', 'devices'];

let state = null;

function lang() {
    return getCurrentLanguage();
}

function canWrite(roles) {
    return roles.some((role) => ['admin', 'superadmin', 'td', 'dressage', 'marathon', 'precision'].includes(role));
}

function canReadCorrections(roles) {
    return roles.some((role) => ['admin', 'superadmin', 'td'].includes(role));
}

export function __unload() {
    if (!state) return;
    state.unsubscribers.forEach((fn) => { try { fn(); } catch (_) { } });
    if (state.deviceTimer) clearInterval(state.deviceTimer);
    state.root?.removeEventListener('click', state.onClick);
    state.root?.removeEventListener('submit', state.onSubmit);
    state.root?.removeEventListener('input', state.onInput);
    state.root?.removeEventListener('change', state.onInput);
    state = null;
}

const inputClass = 'mt-1 block w-full min-h-[44px] p-2 border rounded-md text-base dark:bg-gray-700 dark:border-gray-600 dark:text-white';
const labelClass = 'block text-xs font-bold uppercase text-gray-600 dark:text-gray-300';

function options(list, labels, selected) {
    return list.map((value) => `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(labelFor(labels, value, lang()))}</option>`).join('');
}

function statusBadge(status) {
    const style = status === 'open'
        ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100'
        : status === 'decided'
            ? 'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100'
            : 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-100';
    return `<span class="rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${style}">${escapeHtml(labelFor(INCIDENT_STATUS_LABELS, status, lang()))}</span>`;
}

function renderShell(competition) {
    const tabButton = (tab) => `
        <button type="button" role="tab" data-incident-tab="${tab}" aria-selected="${state.tab === tab}"
            class="min-h-[44px] whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold ${state.tab === tab ? 'bg-brand-darkblue text-white dark:bg-blue-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'}">
            ${escapeHtml(t(`incident_tab_${tab}`))}
        </button>`;
    state.root.innerHTML = `
        <div class="container mx-auto p-3 sm:p-4 md:p-8 max-w-6xl">
            ${getCompetitionHeader(competition, t('incident_page_title'))}
            <div class="mb-4 flex gap-2 overflow-x-auto pb-1" role="tablist" data-tab-overflow>${TABS.map(tabButton).join('')}</div>
            <div id="incident-tab-body"></div>
        </div>`;
}

function renderForm(editing) {
    const e = editing || { type: 'protest', status: 'open', receivedAt: toLocalDateTimeValue(new Date()), discipline: '' };
    return `
        <form id="incident-form" class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800" data-editing="${escapeHtml(editing?.id || '')}">
            <h2 class="mb-3 text-lg font-bold text-gray-900 dark:text-white">${escapeHtml(editing ? `${t('incident_edit_title')} ${editing.number}` : t('incident_new_title'))}</h2>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div><label class="${labelClass}" for="inc-type">${escapeHtml(t('incident_field_type'))}</label>
                    <select id="inc-type" name="type" class="${inputClass}">${options(INCIDENT_TYPES, INCIDENT_TYPE_LABELS, e.type)}</select></div>
                <div><label class="${labelClass}" for="inc-received">${escapeHtml(t('incident_field_received'))}</label>
                    <input id="inc-received" name="receivedAt" type="datetime-local" class="${inputClass}" value="${escapeHtml(e.receivedAt || '')}"></div>
                <div><label class="${labelClass}" for="inc-sn">${escapeHtml(t('incident_field_start_number'))}</label>
                    <input id="inc-sn" name="startNumber" inputmode="numeric" class="${inputClass}" value="${escapeHtml(e.startNumber || '')}" maxlength="20"></div>
                <div><label class="${labelClass}" for="inc-discipline">${escapeHtml(t('incident_field_discipline'))}</label>
                    <select id="inc-discipline" name="discipline" class="${inputClass}">${options(INCIDENT_DISCIPLINES, INCIDENT_DISCIPLINE_LABELS, e.discipline || '')}</select></div>
                <div class="sm:col-span-2"><label class="${labelClass}" for="inc-obstacle">${escapeHtml(t('incident_field_obstacle'))}</label>
                    <input id="inc-obstacle" name="obstacle" class="${inputClass}" value="${escapeHtml(e.obstacle || '')}" maxlength="100"></div>
                <div><label class="${labelClass}" for="inc-status">${escapeHtml(t('incident_field_status'))}</label>
                    <select id="inc-status" name="status" class="${inputClass}">${options(INCIDENT_STATUSES, INCIDENT_STATUS_LABELS, e.status)}</select></div>
                <div><label class="${labelClass}" for="inc-decided-by">${escapeHtml(t('incident_field_decided_by'))}</label>
                    <input id="inc-decided-by" name="decidedBy" class="${inputClass}" value="${escapeHtml(e.decidedBy || '')}" maxlength="200"></div>
                <div class="sm:col-span-2 lg:col-span-4"><label class="${labelClass}" for="inc-description">${escapeHtml(t('incident_field_description'))}</label>
                    <textarea id="inc-description" name="description" rows="3" class="${inputClass}" maxlength="4000" required>${escapeHtml(e.description || '')}</textarea></div>
                <div class="sm:col-span-2 lg:col-span-4"><label class="${labelClass}" for="inc-decision">${escapeHtml(t('incident_field_decision'))}</label>
                    <textarea id="inc-decision" name="decision" rows="2" class="${inputClass}" maxlength="4000">${escapeHtml(e.decision || '')}</textarea></div>
            </div>
            <div class="mt-3 flex flex-wrap justify-end gap-2">
                <button type="button" data-incident-cancel class="min-h-[44px] rounded-md border border-gray-300 px-4 py-2 text-sm dark:border-gray-600 dark:text-gray-100">${escapeHtml(t('btn_cancel'))}</button>
                <button type="submit" class="min-h-[44px] rounded-md bg-brand-darkblue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-900 dark:bg-blue-600">${escapeHtml(t('incident_save'))}</button>
            </div>
        </form>`;
}

/** A pending vet strike entry can be decided here by the secretariat or the TD */
function canDecideVet(item) {
    return item.type === 'vet' && item.status === 'open' && item.vetStrike?.outcome === 'pending' && canDecideVetStrikes(mergeUserRoles(getGlobalState('currentUser')));
}

function renderIncident(item) {
    const corrections = correctionsForIncident(state.corrections, item, state.incidents);
    const meta = [
        item.receivedAt ? String(item.receivedAt).replace('T', ' ') : '',
        item.startNumber ? `#${item.startNumber}` : '',
        item.discipline ? labelFor(INCIDENT_DISCIPLINE_LABELS, item.discipline, lang()) : '',
        item.obstacle || ''
    ].filter(Boolean).join(' • ');
    return `
        <li id="incident-${escapeHtml(item.id)}" class="rounded-xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800" data-incident-number="${escapeHtml(item.number)}">
            <div class="flex flex-wrap items-center gap-2">
                <span class="text-lg font-black text-gray-900 dark:text-white">${escapeHtml(t('incident_number_short'))} ${escapeHtml(item.number)}</span>
                <span class="rounded bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-800 dark:bg-gray-700 dark:text-gray-100">${escapeHtml(labelFor(INCIDENT_TYPE_LABELS, item.type, lang()))}</span>
                ${statusBadge(item.status)}
                <span class="text-xs text-gray-500 dark:text-gray-400">${escapeHtml(meta)}</span>
                ${state.canWrite ? `<button type="button" data-incident-edit="${escapeHtml(item.id)}" class="ml-auto min-h-[40px] rounded-md border border-gray-300 px-3 text-xs font-semibold text-gray-700 dark:border-gray-600 dark:text-gray-200">${escapeHtml(t('incident_edit'))}</button>` : ''}
            </div>
            <p class="mt-2 whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-200">${escapeHtml(item.description || '')}</p>
            ${item.decision ? `<p class="mt-2 whitespace-pre-wrap rounded-lg bg-sky-50 p-2 text-sm text-sky-950 dark:bg-sky-950/30 dark:text-sky-100"><span class="font-bold">${escapeHtml(t('incident_field_decision'))}:</span> ${escapeHtml(item.decision)}${item.decidedBy ? ` <span class="opacity-75">(${escapeHtml(item.decidedBy)})</span>` : ''}</p>` : ''}
            ${canDecideVet(item) ? `<div class="mt-2 flex flex-wrap gap-2">
                <button type="button" data-incident-vet-decide="confirm" data-incident-id="${escapeHtml(item.id)}" class="min-h-[40px] rounded-md bg-rose-700 px-3 py-1 text-xs font-bold text-white hover:bg-rose-800">${escapeHtml(t('notice_confirm_strike'))}</button>
                <button type="button" data-incident-vet-decide="overturn" data-incident-id="${escapeHtml(item.id)}" class="min-h-[40px] rounded-md border border-gray-400 px-3 py-1 text-xs font-bold text-gray-800 dark:text-gray-100">${escapeHtml(t('notice_overturn_strike'))}</button></div>` : ''}
            ${corrections.length ? `<div class="mt-2 flex flex-wrap gap-2 text-xs">${corrections.map((c) => `
                <button type="button" data-goto-correction="${escapeHtml(c.startNumber || '')}" class="min-h-[36px] rounded-full bg-violet-100 px-3 text-violet-900 underline dark:bg-violet-900/40 dark:text-violet-100">${escapeHtml(t('incident_correction_link'))} #${escapeHtml(c.startNumber || '')} (${escapeHtml(c.discipline || '')})</button>`).join('')}</div>` : ''}
        </li>`;
}

function renderLogTab(body, { keepForm = false } = {}) {
    // A form being filled in survives a re-render (filters, new snapshots)
    const keptForm = keepForm ? body.querySelector('#incident-form') : null;
    const filters = state.filters;
    const list = sortIncidents(filterIncidents(state.incidents, filters));
    // The log comes first; the form opens with "+ Ny händelse" (or when editing)
    const showForm = state.canWrite && (state.formOpen || !!state.editing);
    body.innerHTML = `
        <div class="space-y-4">
            ${state.canWrite && !showForm ? `<div class="flex justify-end"><button type="button" data-incident-new class="min-h-[44px] w-full rounded-md bg-brand-darkblue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-900 dark:bg-blue-600 sm:w-auto">+ ${escapeHtml(t('incident_new_btn'))}</button></div>` : ''}
            ${showForm ? `<div id="incident-form-slot">${renderForm(state.editing)}</div>` : ''}
            <div class="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800 sm:flex-row sm:items-end">
                <div class="flex-1"><label class="${labelClass}" for="inc-filter-type">${escapeHtml(t('incident_field_type'))}</label>
                    <select id="inc-filter-type" data-incident-filter="type" class="${inputClass}"><option value="">${escapeHtml(t('incident_filter_all'))}</option>${options(INCIDENT_TYPES, INCIDENT_TYPE_LABELS, filters.type)}</select></div>
                <div class="flex-1"><label class="${labelClass}" for="inc-filter-status">${escapeHtml(t('incident_field_status'))}</label>
                    <select id="inc-filter-status" data-incident-filter="status" class="${inputClass}"><option value="">${escapeHtml(t('incident_filter_all'))}</option>${options(INCIDENT_STATUSES, INCIDENT_STATUS_LABELS, filters.status)}</select></div>
                <div class="flex-1"><label class="${labelClass}" for="inc-filter-sn">${escapeHtml(t('incident_field_start_number'))}</label>
                    <input id="inc-filter-sn" data-incident-filter="startNumber" class="${inputClass}" value="${escapeHtml(filters.startNumber)}"></div>
                <div class="flex gap-2">
                    <button type="button" data-incident-export="pdf" class="min-h-[44px] rounded-md bg-gray-800 px-4 text-sm font-semibold text-white dark:bg-gray-600">PDF</button>
                    <button type="button" data-incident-export="csv" class="min-h-[44px] rounded-md border border-gray-400 px-4 text-sm font-semibold text-gray-800 dark:text-gray-100">CSV</button>
                </div>
            </div>
            <ul id="incident-list" class="space-y-3">${list.length ? list.map(renderIncident).join('') : `<li class="rounded-xl bg-white p-6 text-center text-sm text-gray-500 dark:bg-gray-800 dark:text-gray-400">${escapeHtml(state.loaded ? t('incident_empty') : t('official_loading'))}</li>`}</ul>
        </div>`;
    if (keptForm) body.querySelector('#incident-form')?.replaceWith(keptForm);
}

function referenceLabel(reference) {
    if (!reference || !CORRECTION_REFERENCE_TYPES[reference.type]) return '';
    return `${CORRECTION_REFERENCE_TYPES[reference.type]}${reference.value ? ` ${reference.value}` : ''}`;
}

function renderCorrectionsTab(body) {
    if (!state.canReadCorrections) {
        body.innerHTML = `<p class="rounded-xl bg-white p-6 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-300">${escapeHtml(t('incident_corrections_no_access'))}</p>`;
        return;
    }
    const f = state.correctionFilters;
    const rows = filterAuditEntries(state.corrections, f);
    const when = (entry) => {
        const ms = entry?.editedAt?.toMillis?.() ?? 0;
        return ms ? new Date(ms).toLocaleString('sv-SE') : '';
    };
    body.innerHTML = `
        <div class="space-y-3">
            <div class="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800 sm:flex-row sm:items-end">
                <div class="flex-1"><label class="${labelClass}" for="corr-discipline">${escapeHtml(t('incident_field_discipline'))}</label>
                    <select id="corr-discipline" data-correction-filter="discipline" class="${inputClass}"><option value="">${escapeHtml(t('incident_filter_all'))}</option>${options(['dressage', 'marathon', 'precision'], INCIDENT_DISCIPLINE_LABELS, f.discipline)}</select></div>
                <div class="flex-1"><label class="${labelClass}" for="corr-sn">${escapeHtml(t('incident_field_start_number'))}</label>
                    <input id="corr-sn" data-correction-filter="startNumber" class="${inputClass}" value="${escapeHtml(f.startNumber)}"></div>
            </div>
            <div class="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
                <table class="min-w-full text-left text-sm">
                    <thead class="bg-gray-50 text-xs uppercase text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
                        <tr><th class="px-3 py-2">${escapeHtml(t('incident_corr_time'))}</th><th class="px-3 py-2">${escapeHtml(t('incident_field_discipline'))}</th><th class="px-3 py-2">#</th><th class="px-3 py-2">${escapeHtml(t('incident_corr_reason'))}</th><th class="px-3 py-2">${escapeHtml(t('incident_corr_reference'))}</th><th class="px-3 py-2">${escapeHtml(t('incident_corr_changes'))}</th></tr>
                    </thead>
                    <tbody class="divide-y divide-gray-100 dark:divide-gray-700">
                        ${rows.length ? rows.map((entry) => {
                            const linked = matchIncidentForReference(state.incidents, entry.reference);
                            const ref = referenceLabel(entry.reference);
                            return `<tr class="align-top text-gray-800 dark:text-gray-200">
                                <td class="px-3 py-2 whitespace-nowrap">${escapeHtml(when(entry))}</td>
                                <td class="px-3 py-2">${escapeHtml(labelFor(INCIDENT_DISCIPLINE_LABELS, entry.discipline || '', lang()))}</td>
                                <td class="px-3 py-2">${escapeHtml(entry.startNumber || '')}</td>
                                <td class="px-3 py-2">${escapeHtml(entry.reason || '')}</td>
                                <td class="px-3 py-2">${linked
                                    ? `<button type="button" data-goto-incident="${escapeHtml(linked.id)}" class="min-h-[36px] text-blue-700 underline dark:text-blue-300">${escapeHtml(ref)} → ${escapeHtml(t('incident_number_short'))} ${escapeHtml(linked.number)}</button>`
                                    : escapeHtml(ref)}</td>
                                <td class="px-3 py-2 text-xs">${escapeHtml(summarizeAuditChanges(entry.changes))}</td>
                            </tr>`;
                        }).join('') : `<tr><td colspan="6" class="px-3 py-6 text-center text-gray-500 dark:text-gray-400">${escapeHtml(state.correctionsLoaded ? t('incident_corrections_empty') : t('official_loading'))}</td></tr>`}
                    </tbody>
                </table>
            </div>
        </div>`;
}

function renderDevicesTab(body) {
    const devices = summarizeDevices(state.devices, Date.now());
    const dot = { green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-rose-600' };
    body.innerHTML = `
        <div class="space-y-2">
            <p class="text-sm text-gray-600 dark:text-gray-300">${escapeHtml(t('devices_intro'))}</p>
            <div class="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
                <table class="min-w-full text-left text-sm" id="field-devices-table">
                    <thead class="bg-gray-50 text-xs uppercase text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
                        <tr><th class="px-3 py-2">${escapeHtml(t('devices_last_seen'))}</th><th class="px-3 py-2">${escapeHtml(t('devices_user'))}</th><th class="px-3 py-2">${escapeHtml(t('devices_page'))}</th><th class="px-3 py-2">${escapeHtml(t('devices_where'))}</th><th class="px-3 py-2">${escapeHtml(t('devices_queue'))}</th><th class="px-3 py-2">${escapeHtml(t('devices_clock'))}</th></tr>
                    </thead>
                    <tbody class="divide-y divide-gray-100 dark:divide-gray-700">
                        ${devices.length ? devices.map((d) => `<tr class="text-gray-800 dark:text-gray-200">
                            <td class="px-3 py-2 whitespace-nowrap"><span class="mr-2 inline-block h-3 w-3 rounded-full ${dot[d.freshness]}" aria-hidden="true"></span><span class="sr-only">${escapeHtml(t(`devices_${d.freshness}`))}</span>${escapeHtml(formatSince(d.lastSeenMs))}</td>
                            <td class="px-3 py-2">${escapeHtml(d.userName || '')}<div class="text-xs text-gray-500">${escapeHtml(d.role || '')}</div></td>
                            <td class="px-3 py-2">${escapeHtml(d.page || '')}</td>
                            <td class="px-3 py-2">${escapeHtml([d.obstacle ? `${t('devices_obstacle')} ${d.obstacle}` : '', d.startNumber ? `#${d.startNumber}` : ''].filter(Boolean).join(' • ') || '–')}</td>
                            <td class="px-3 py-2 ${d.queueSize > 0 ? 'font-bold text-amber-700 dark:text-amber-300' : ''}">${escapeHtml(d.queueSize ?? 0)}</td>
                            <td class="px-3 py-2 whitespace-nowrap">${escapeHtml(d.clockSyncedAt ? formatSince(d.clockSyncedAt) : '–')}</td>
                        </tr>`).join('') : `<tr><td colspan="6" class="px-3 py-6 text-center text-gray-500 dark:text-gray-400">${escapeHtml(t('devices_empty'))}</td></tr>`}
                    </tbody>
                </table>
            </div>
        </div>`;
}

function renderBody(opts = {}) {
    if (!state) return;
    const body = state.root.querySelector('#incident-tab-body');
    if (!body) return;
    if (state.tab !== 'notices') {
        state.unmountNotices?.();
        state.unmountNotices = null;
    }
    if (state.tab === 'log') renderLogTab(body, opts);
    else if (state.tab === 'corrections') renderCorrectionsTab(body);
    else if (state.tab === 'devices') renderDevicesTab(body);
    else if (state.tab === 'notices' && !state.unmountNotices) {
        body.innerHTML = `<p class="mb-2 text-sm text-gray-600 dark:text-gray-300">${escapeHtml(t('incident_notices_intro'))}</p><div id="incident-notices"></div>`;
        state.unmountNotices = mountStaffNoticesPanel(body.querySelector('#incident-notices'), { competitionId: state.competition.id });
    }
}

function switchTab(tab) {
    if (!TABS.includes(tab) || !state) return;
    state.tab = tab;
    state.root.querySelectorAll('[data-incident-tab]').forEach((btn) => {
        const active = btn.dataset.incidentTab === tab;
        btn.setAttribute('aria-selected', String(active));
        btn.className = `min-h-[44px] whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold ${active ? 'bg-brand-darkblue text-white dark:bg-blue-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'}`;
    });
    if (tab === 'corrections') loadCorrections();
    if (tab === 'devices') startDevices();
    renderBody();
}

async function loadCorrections() {
    if (!state?.canReadCorrections || state.correctionsLoading) return;
    state.correctionsLoading = true;
    try {
        state.corrections = await getCorrectionLog(state.competition.id);
    } catch (error) {
        console.warn('Ändringsloggen kunde inte läsas:', error);
        state.corrections = [];
    } finally {
        if (state) {
            state.correctionsLoading = false;
            state.correctionsLoaded = true;
            if (state.tab === 'corrections' || state.tab === 'log') renderBody();
        }
    }
}

function startDevices() {
    if (!state || state.devicesStarted) return;
    state.devicesStarted = true;
    state.unsubscribers.push(listenForFieldDevices(state.competition.id, (devices) => {
        if (!state) return;
        state.devices = devices;
        if (state.tab === 'devices') renderBody();
    }));
    // The ages move on without new documents
    state.deviceTimer = setInterval(() => { if (state?.tab === 'devices') renderBody(); }, 30000);
}

function formValues(form) {
    const data = new FormData(form);
    return Object.fromEntries(['type', 'receivedAt', 'startNumber', 'discipline', 'obstacle', 'status', 'decidedBy', 'description', 'decision']
        .map((key) => [key, String(data.get(key) ?? '')]));
}

function download(name, text, type) {
    const blob = new Blob([`﻿${text}`], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportLog(kind) {
    const list = filterIncidents(state.incidents, state.filters);
    if (kind === 'csv') {
        download(`handelselogg_${new Date().toISOString().split('T')[0]}.csv`, incidentsToCsv(list, { lang: lang() }), 'text/csv;charset=utf-8');
        return;
    }
    try {
        const { generateIncidentLogPdf } = await import('../../pdf/incidentLogPdf.js');
        await generateIncidentLogPdf(list, state.competition);
    } catch (error) {
        console.error(error);
        showAlert(`${t('incident_export_failed')} ${error?.message || ''}`, false);
    }
}

export async function load(pageElement) {
    __unload();
    const root = pageElement || document.getElementById('page-incidents');
    if (!root) return;
    const competition = getGlobalState('currentCompetition');
    if (!competition) {
        root.innerHTML = `<div class="container mx-auto p-3 sm:p-4">${renderNoCompetitionState()}</div>`;
        return;
    }
    const roles = mergeUserRoles(getGlobalState('currentUser'));
    state = {
        root,
        competition,
        tab: 'log',
        incidents: [],
        loaded: false,
        corrections: [],
        correctionsLoaded: false,
        correctionsLoading: false,
        devices: [],
        devicesStarted: false,
        deviceTimer: null,
        editing: null,
        formOpen: false,
        filters: { type: '', status: '', startNumber: '' },
        correctionFilters: { discipline: '', startNumber: '' },
        canWrite: canWrite(roles),
        canReadCorrections: canReadCorrections(roles),
        unsubscribers: [],
        unmountNotices: null
    };
    renderShell(competition);
    renderBody();

    state.onClick = (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target || !state) return;
        const tab = target.closest('[data-incident-tab]');
        if (tab) { switchTab(tab.dataset.incidentTab); return; }
        if (target.closest('[data-incident-new]')) {
            state.formOpen = true;
            state.editing = null;
            renderBody();
            const form = state.root.querySelector('#incident-form');
            form?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            form?.querySelector('#inc-description')?.focus({ preventScroll: true });
            return;
        }
        const edit = target.closest('[data-incident-edit]');
        if (edit) {
            state.editing = state.incidents.find((i) => i.id === edit.dataset.incidentEdit) || null;
            renderBody();
            state.root.querySelector('#incident-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
        }
        if (target.closest('[data-incident-cancel]')) { state.editing = null; state.formOpen = false; renderBody(); return; }
        const vetDecide = target.closest('[data-incident-vet-decide]');
        if (vetDecide) {
            const item = state.incidents.find((i) => i.id === vetDecide.dataset.incidentId);
            if (!item || !canDecideVet(item)) return;
            vetDecide.disabled = true;
            runVetStrikeDecision(state.competition.id, { startNumber: item.startNumber, action: vetDecide.dataset.incidentVetDecide, incidentId: item.id })
                .then((result) => { if (result !== 'decided') vetDecide.disabled = false; })
                .catch((error) => {
                    console.error('Beslutet kunde inte sparas:', error);
                    showAlert(`${t('notice_decision_failed')} ${error?.message || ''}`, false);
                    vetDecide.disabled = false;
                });
            return;
        }
        const exp = target.closest('[data-incident-export]');
        if (exp) { exportLog(exp.dataset.incidentExport); return; }
        const gotoCorrection = target.closest('[data-goto-correction]');
        if (gotoCorrection) {
            state.correctionFilters = { discipline: '', startNumber: gotoCorrection.dataset.gotoCorrection || '' };
            switchTab('corrections');
            return;
        }
        const gotoIncident = target.closest('[data-goto-incident]');
        if (gotoIncident) {
            state.filters = { type: '', status: '', startNumber: '' };
            switchTab('log');
            state.root.querySelector(`#incident-${CSS.escape(gotoIncident.dataset.gotoIncident)}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    };
    state.onSubmit = async (event) => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement) || form.id !== 'incident-form' || !state) return;
        event.preventDefault();
        const button = event.submitter;
        if (button) button.disabled = true;
        const values = formValues(form);
        try {
            const editing = state.incidents.find((i) => i.id === form.dataset.editing);
            if (editing) {
                // Saved on the device at once; the server answers later offline
                updateIncident(state.competition.id, editing, values).catch((error) => showAlert(`${t('incident_save_failed')} ${t(error.message)}`, false));
                showAlert(t('incident_saved'));
                state.editing = null;
            } else {
                const created = await createIncident(state.competition.id, values, state.incidents);
                created.write.catch((error) => showAlert(`${t('incident_save_failed')} ${error?.message || ''}`, false));
                showAlert(`${t('incident_saved')} (${t('incident_number_short')} ${created.number})`);
            }
            state.formOpen = false;
            renderBody();
        } catch (error) {
            showAlert(`${t('incident_save_failed')} ${t(error.message)}`, false);
        } finally {
            if (button) button.disabled = false;
        }
    };
    state.onInput = (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target || !state) return;
        const filter = target.getAttribute('data-incident-filter');
        const corrFilter = target.getAttribute('data-correction-filter');
        if (!filter && !corrFilter) return;
        if ((event.type === 'input') === (target.tagName === 'SELECT')) return;
        // Selects on change, text fields while typing
        if (filter) state.filters[filter] = target.value;
        else state.correctionFilters[corrFilter] = target.value;
        const id = target.id;
        const caret = target.selectionStart;
        renderBody({ keepForm: true });
        const again = state.root.querySelector(`#${CSS.escape(id)}`);
        if (again && target.tagName === 'INPUT') {
            again.focus();
            try { again.setSelectionRange(caret, caret); } catch (_) { }
        }
    };
    root.addEventListener('click', state.onClick);
    root.addEventListener('submit', state.onSubmit);
    root.addEventListener('input', state.onInput);
    root.addEventListener('change', state.onInput);

    state.unsubscribers.push(listenForIncidents(competition.id, (list) => {
        if (!state) return;
        state.incidents = list;
        state.loaded = true;
        // Not while the form is being filled in (it would lose the text)
        const active = document.activeElement;
        const typing = active && state.root.querySelector('#incident-form')?.contains(active);
        if (state.tab === 'log') renderBody({ keepForm: typing });
    }, () => {
        if (!state) return;
        state.loaded = true;
        if (state.tab === 'log') renderBody();
    }));
    // The corrections' links to entries
    loadCorrections();
}
