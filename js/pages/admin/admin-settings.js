import { getConfig } from '../../services/competitionService.js';
import { saveConfig } from '../../services/competitionService.js';
import { getCompetitionById, deleteCompetition, updateCompetition } from '../../services/competitionService.js';
import { getSecretConfig, saveSecretConfig, listenForCompetitionAdmins, deleteCompetitionAdmin, migrateLegacyCompetitionRoleEmails, getOfficials, getJudges } from '../../services/adminService.js';
import { getEquipages } from '../../services/equipageService.js';
import { uploadCompetitionLogo } from '../../services/storageService.js';
import { getGlobalState, setGlobalState } from '../../main.js';
import { showAlert } from '../../ui/components.js';
import { escapeHtml } from '../../utils/sharedUtils.js';
import { getCompetitionLogoUrl, getCompetitionLogoName } from '../../utils/competitionLogo.js';
import { t } from '../../utils/i18n.js';
import { getPublishedState, parseDateTime } from './starttiderUtils.js';

let mapInstance = null;
let markerInstance = null;
let activeAdminsUnsub = null;
let latestSettingsChecklistContext = null;

export function unloadSettingsTab() {
    latestSettingsChecklistContext = null;
    if (activeAdminsUnsub) {
        try {
            activeAdminsUnsub();
        } catch (error) {
            console.warn('Kunde inte stoppa installnings-lyssnare:', error);
        }
        activeAdminsUnsub = null;
    }

    if (mapInstance) {
        try {
            mapInstance.remove();
        } catch (error) {
            console.warn('Kunde inte ta bort installningskarta:', error);
        }
        mapInstance = null;
        markerInstance = null;
    }
}

function getUniqueChecklistClasses(equipages = []) {
    return [...new Set(
        equipages
            .map((equipage) => String(equipage?.className || '').trim())
            .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, 'sv'));
}

function buildChecklistAction(item) {
    switch (item?.label) {
        case 'Grunddata':
            return { type: 'route', hash: '#hub', label: 'Öppna hubben' };
        case 'Starttider':
            return { type: 'route', hash: '#starttider', label: 'Öppna starttider' };
        case 'Tävlingsläge':
            return { type: 'scroll', targetId: 'settingsCompetitionModeCard', label: 'Visa läge' };
        case 'Karta':
            return { type: 'scroll', targetId: 'settingsMapCard', label: 'Öppna karta' };
        case 'Ekipage och klasser':
            return { type: 'route', hash: '#admin?tab=registration&focus=view-registration', label: 'Öppna anmälan' };
        case 'Klassinställningar':
            return { type: 'scroll', targetId: 'settingsClassSettingsCard', label: 'Visa klasser' };
        case 'Domare':
            return { type: 'route', hash: '#admin?tab=registration&focus=judge-section-wrapper', label: 'Öppna domare' };
        case 'Funktionärer':
            return { type: 'route', hash: '#admin?tab=officials&focus=view-officials', label: 'Öppna funktionärer' };
        case 'Publiksida':
            return { type: 'route', hash: '#admin?tab=communication&focus=publicInfoForm', label: 'Öppna publikinfo' };
        case 'Publicering':
            return { type: 'scroll', targetId: 'settingsPublishCard', label: 'Visa publicering' };
        default:
            return null;
    }
}

function renderChecklistActionButton(item, className = '') {
    const action = buildChecklistAction(item);
    if (!action) return '';

    const safeType = escapeHtml(action.type);
    const safeTarget = escapeHtml(action.targetId || '');
    const safeHash = escapeHtml(action.hash || '');
    const safeLabel = escapeHtml(action.label || 'Öppna');

    return `
        <button
            type="button"
            class="checklist-action-btn inline-flex items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-800 transition hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-200 dark:hover:bg-blue-900/40 ${className}"
            data-action-type="${safeType}"
            data-action-target="${safeTarget}"
            data-action-hash="${safeHash}">
            ${safeLabel}
        </button>
    `;
}

function runChecklistAction(action) {
    if (!action?.type) return;

    if (action.type === 'route' && action.hash) {
        window.location.hash = action.hash;
        return;
    }

    if (action.type === 'scroll' && action.targetId) {
        const target = document.getElementById(action.targetId);
        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }
}

function setChecklistCardTone(card, tone = 'neutral') {
    if (!card) return;
    card.classList.remove(
        'ring-1',
        'ring-red-200',
        'ring-amber-200',
        'ring-emerald-200',
        'dark:ring-red-800',
        'dark:ring-amber-800',
        'dark:ring-emerald-800'
    );

    if (tone === 'danger') {
        card.classList.add('ring-1', 'ring-red-200', 'dark:ring-red-800');
    } else if (tone === 'warning') {
        card.classList.add('ring-1', 'ring-amber-200', 'dark:ring-amber-800');
    } else if (tone === 'success') {
        card.classList.add('ring-1', 'ring-emerald-200', 'dark:ring-emerald-800');
    }
}

function renderSectionStatusBlock({
    statusId,
    cardId,
    tone = 'neutral',
    badge = '',
    detail = '',
    item = null
} = {}) {
    const statusEl = document.getElementById(statusId);
    const cardEl = document.getElementById(cardId);
    if (!statusEl || !cardEl) return;

    setChecklistCardTone(cardEl, tone);

    const toneClasses = {
        danger: 'border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-900/20 dark:text-red-100',
        warning: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100',
        success: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-100',
        neutral: 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-900/20 dark:text-gray-300'
    };

    statusEl.innerHTML = `
        <div class="mt-4 rounded-lg border px-4 py-3 text-sm ${toneClasses[tone] || toneClasses.neutral}">
            <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                    <div class="font-semibold">${escapeHtml(badge)}</div>
                    <div class="mt-1 text-xs opacity-90">${escapeHtml(detail)}</div>
                </div>
                ${item && !item.done ? renderChecklistActionButton(item, 'self-start md:self-auto') : ''}
            </div>
        </div>
    `;

    statusEl.onclick = (event) => {
        const button = event.target.closest('.checklist-action-btn');
        if (!button) return;

        runChecklistAction({
            type: button.dataset.actionType,
            targetId: button.dataset.actionTarget,
            hash: button.dataset.actionHash
        });
    };
}

const START_TIME_CHECKLIST_DISCIPLINES = [
    { key: 'dressage', label: 'Dressyr' },
    { key: 'marathon', label: 'Maraton' },
    { key: 'precision', label: 'Precision' }
];

function getActiveChecklistEquipages(equipages = []) {
    return equipages.filter((equipage) => {
        const startNumber = String(equipage?.startNumber || '').trim();
        const status = String(equipage?.status || '').trim().toLowerCase();
        return startNumber && status !== 'struken';
    });
}

function normalizeStartTimesConfig(startTimesConfig = {}) {
    const times = startTimesConfig?.times && typeof startTimesConfig.times === 'object'
        ? startTimesConfig.times
        : startTimesConfig || {};
    return {
        times,
        published: getPublishedState(startTimesConfig?.published ? startTimesConfig : times)
    };
}

function buildStartTimesChecklistItem(equipages = [], startTimesConfig = {}) {
    const activeEquipages = getActiveChecklistEquipages(equipages);
    const total = activeEquipages.length;
    const { times, published } = normalizeStartTimesConfig(startTimesConfig);

    if (total === 0) {
        return {
            label: 'Starttider',
            done: false,
            detail: 'Lägg in ekipage innan starttider kan kontrolleras'
        };
    }

    const summaries = START_TIME_CHECKLIST_DISCIPLINES.map(({ key, label }) => {
        const scheduledCount = activeEquipages.reduce((count, equipage) => {
            const startNumber = String(equipage.startNumber);
            return parseDateTime(times?.[startNumber]?.[key]) ? count + 1 : count;
        }, 0);
        return {
            key,
            label,
            scheduledCount,
            complete: scheduledCount === total,
            published: !!published?.[key]
        };
    });

    const completeCount = summaries.filter((summary) => summary.complete).length;
    const publishedCompleteCount = summaries.filter((summary) => summary.complete && summary.published).length;
    const done = completeCount === summaries.length && publishedCompleteCount === summaries.length;

    if (done) {
        return {
            label: 'Starttider',
            done: true,
            detail: `Alla ${summaries.length} startlistor är kompletta och publicerade`
        };
    }

    const missing = summaries
        .filter((summary) => !summary.complete || !summary.published)
        .map((summary) => {
            if (!summary.complete) return `${summary.label} ${summary.scheduledCount}/${total}`;
            return `${summary.label} ej publicerad`;
        });

    return {
        label: 'Starttider',
        done: false,
        detail: `${completeCount}/${summaries.length} listor kompletta, ${publishedCompleteCount}/${summaries.length} publicerade. ${missing.join(', ')}`
    };
}

function buildPublicInfoChecklistItem(publicInfo = {}) {
    const spectatorInfo = publicInfo.spectatorInfo || {};
    const enabled = publicInfo.enabled !== false;
    const hasIntro = Boolean(String(publicInfo.introHtml || '').trim());
    const hasVisitorInfo = [
        spectatorInfo.venueAddress,
        spectatorInfo.parking,
        spectatorInfo.entrance,
        spectatorInfo.kiosk,
        spectatorInfo.toilets
    ].some((value) => String(value || '').trim());

    if (!enabled) {
        return {
            label: 'Publiksida',
            done: false,
            detail: 'Publik infosida är avstängd'
        };
    }

    if (hasIntro || hasVisitorInfo) {
        const parts = [
            hasIntro ? 'intro' : null,
            hasVisitorInfo ? 'besöksinfo' : null
        ].filter(Boolean);
        return {
            label: 'Publiksida',
            done: true,
            detail: `Aktiv med ${parts.join(' och ')}`
        };
    }

    return {
        label: 'Publiksida',
        done: false,
        detail: 'Aktiv, men saknar intro eller besöksinfo'
    };
}

function buildCompetitionChecklistItems(context = {}) {
    const compDoc = context.compDoc || {};
    const meta = context.meta || {};
    const mapConfig = context.mapConfig || {};
    const equipages = Array.isArray(context.equipages) ? context.equipages : [];
    const classConfig = context.classConfig || {};
    const judges = Array.isArray(context.judges) ? context.judges : [];
    const officials = Array.isArray(context.officials) ? context.officials : [];
    const startTimesConfig = context.startTimesConfig || {};
    const publicInfo = context.publicInfo || {};

    const coords = mapConfig.coordinates || compDoc.coordinates || null;
    const classes = getUniqueChecklistClasses(equipages);
    const mode = compDoc?.competitionMode === 'field' ? 'Field mode light' : 'Live-läge';
    const hasClassSettings = classes.length > 0 && classes.every((className) => {
        const placedCount = Number(classConfig?.[className]?.placedCount);
        return Number.isFinite(placedCount) && placedCount >= 1;
    });

    return [
        {
            label: 'Grunddata',
            done: Boolean(compDoc?.name && compDoc?.dates && compDoc?.place),
            detail: compDoc?.name && compDoc?.dates && compDoc?.place
                ? `${compDoc.name} • ${compDoc.dates} • ${compDoc.place}`
                : 'Namn, datum eller plats saknas'
        },
        {
            label: 'Tävlingsläge',
            done: Boolean(compDoc?.competitionMode === 'live' || compDoc?.competitionMode === 'field'),
            detail: mode
        },
        {
            label: 'Karta',
            done: Boolean(coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)),
            detail: coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)
                ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`
                : 'Ingen exakt kartposition satt'
        },
        {
            label: 'Ekipage och klasser',
            done: equipages.length > 0 && classes.length > 0,
            detail: equipages.length > 0
                ? `${equipages.length} ekipage i ${classes.length} klass${classes.length === 1 ? '' : 'er'}`
                : 'Inga ekipage importerade ännu'
        },
        {
            label: 'Klassinställningar',
            done: hasClassSettings,
            detail: classes.length === 0
                ? 'Lägg först in ekipage för att skapa klassinställningar'
                : hasClassSettings
                    ? `Placeringstal satt för ${classes.length} klass${classes.length === 1 ? '' : 'er'}`
                    : 'En eller flera klasser saknar placeringstal'
        },
        buildStartTimesChecklistItem(equipages, startTimesConfig),
        {
            label: 'Domare',
            done: judges.length > 0,
            detail: judges.length > 0
                ? `${judges.length} domare registrerade`
                : 'Inga domare registrerade ännu'
        },
        {
            label: 'Funktionärer',
            done: officials.length > 0,
            detail: officials.length > 0
                ? `${officials.length} funktionärer registrerade`
                : 'Inga funktionärer registrerade ännu'
        },
        buildPublicInfoChecklistItem(publicInfo),
        {
            label: 'Publicering',
            done: compDoc?.published !== false,
            detail: compDoc?.published !== false
                ? 'Tävlingen är synlig för publik'
                : 'Tävlingen ligger fortfarande som utkast'
        }
    ];
}

function renderCompetitionSetupChecklist(context = latestSettingsChecklistContext) {
    latestSettingsChecklistContext = context;
    const container = document.getElementById('competitionSetupChecklist');
    if (!container) return;

    const items = buildCompetitionChecklistItems(context);
    const completed = items.filter((item) => item.done).length;
    const total = items.length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    const nextSteps = items.filter((item) => !item.done).slice(0, 3);
    const nextPrimary = nextSteps[0] || null;

    container.innerHTML = `
        <div class="flex flex-col gap-4">
            <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                    <div class="text-sm font-semibold text-gray-900 dark:text-white">${completed} av ${total} punkter klara</div>
                    <div class="text-xs text-gray-500 dark:text-gray-400">Använd checklistan för att se vad som återstår innan tävlingen är helt startklar.</div>
                </div>
                <div class="inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${percent === 100 ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'}">
                    ${percent}% klar
                </div>
            </div>

            <div class="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                <div class="h-full rounded-full bg-brand-darkblue transition-all" style="width:${percent}%"></div>
            </div>

            ${nextSteps.length > 0 ? `
                <div class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100">
                    <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                            <div class="font-semibold">Nästa steg</div>
                            <div class="mt-1">${escapeHtml(nextSteps.map((item) => item.label).join(', '))}</div>
                        </div>
                        ${nextPrimary ? renderChecklistActionButton(nextPrimary, 'self-start md:self-auto') : ''}
                    </div>
                </div>
            ` : `
                <div class="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-100">
                    <div class="font-semibold">Checklistan är komplett</div>
                    <div class="mt-1">Grunddata, starttider, publikinfo, bemanning och publicering ser klara ut.</div>
                </div>
            `}

            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                ${items.map((item) => `
                    <div class="rounded-xl border px-4 py-3 ${item.done
                        ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20'
                        : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/20'}">
                        <div class="flex items-start gap-3">
                            <div class="mt-0.5 shrink-0 ${item.done ? 'text-emerald-600 dark:text-emerald-300' : 'text-gray-400 dark:text-gray-500'}">
                                ${item.done ? '●' : '○'}
                            </div>
                            <div class="min-w-0 flex-1">
                                <div class="text-sm font-semibold text-gray-900 dark:text-white">${escapeHtml(item.label)}</div>
                                <div class="mt-1 text-xs text-gray-600 dark:text-gray-400">${escapeHtml(item.detail)}</div>
                                ${!item.done ? `<div class="mt-3">${renderChecklistActionButton(item)}</div>` : ''}
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    container.onclick = (event) => {
        const button = event.target.closest('.checklist-action-btn');
        if (!button) return;

        runChecklistAction({
            type: button.dataset.actionType,
            targetId: button.dataset.actionTarget,
            hash: button.dataset.actionHash
        });
    };
}

function buildPublishingValidation(context = latestSettingsChecklistContext) {
    const items = buildCompetitionChecklistItems(context);
    const relevantItems = items.filter((item) => item.label !== 'Publicering');

    const blockingLabels = new Set([
        'Grunddata',
        'Karta',
        'Ekipage och klasser',
        'Klassinställningar'
    ]);

    return relevantItems.reduce((acc, item) => {
        if (item.done) return acc;
        if (blockingLabels.has(item.label)) {
            acc.blocking.push(item);
        } else {
            acc.advisory.push(item);
        }
        return acc;
    }, { blocking: [], advisory: [] });
}

function buildPublishingValidationMessage(context = latestSettingsChecklistContext) {
    const { blocking, advisory } = buildPublishingValidation(context);
    if (blocking.length === 0 && advisory.length === 0) return '';

    const lines = [
        'Tävlingen är inte komplett ännu.',
        '',
        ...(blocking.length ? [
            'Viktiga delar som saknas:',
            ...blocking.map((item) => `- ${item.label}: ${item.detail}`),
            ''
        ] : []),
        ...(advisory.length ? [
            'Bra att kontrollera innan publicering:',
            ...advisory.map((item) => `- ${item.label}: ${item.detail}`),
            ''
        ] : []),
        'Vill du publicera ändå?'
    ];

    return lines.join('\n');
}

function buildPublishingBlockedMessage(context = latestSettingsChecklistContext) {
    const { blocking } = buildPublishingValidation(context);
    if (blocking.length === 0) return '';

    return [
        'Tävlingen kan inte publiceras ännu.',
        '',
        'Följande måste vara klart först:',
        ...blocking.map((item) => `- ${item.label}: ${item.detail}`)
    ].join('\n');
}

function buildPublishingAdvisoryMessage(context = latestSettingsChecklistContext) {
    const { advisory } = buildPublishingValidation(context);
    if (advisory.length === 0) return '';

    return [
        'Tävlingen går att publicera, men kontrollera gärna detta först:',
        '',
        ...advisory.map((item) => `- ${item.label}: ${item.detail}`),
        '',
        'Vill du publicera ändå?'
    ].join('\n');
}

function renderPublishingGateStatus(context = latestSettingsChecklistContext) {
    const container = document.getElementById('publishGateStatus');
    if (!container) return;

    const { blocking, advisory } = buildPublishingValidation(context);
    const firstBlocking = blocking[0] || null;
    const firstAdvisory = advisory[0] || null;
    const isPublished = context?.compDoc?.published !== false;

    if (blocking.length > 0) {
        container.className = 'mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-900/20 dark:text-red-100';
        container.innerHTML = `
            <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                    <div class="font-semibold">${isPublished ? 'Publicerad men inte komplett' : 'Publicering spärrad'}</div>
                    <div class="mt-1">${escapeHtml(blocking.map((item) => item.label).join(', '))} måste vara klara innan tävlingen bör publiceras.</div>
                </div>
                ${firstBlocking ? renderChecklistActionButton(firstBlocking, 'self-start md:self-auto') : ''}
            </div>
        `;
    } else if (advisory.length > 0) {
        container.className = 'mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100';
        container.innerHTML = `
            <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                    <div class="font-semibold">Redo att publicera med varning</div>
                    <div class="mt-1">Bra att kontrollera: ${escapeHtml(advisory.map((item) => item.label).join(', '))}.</div>
                </div>
                ${firstAdvisory ? renderChecklistActionButton(firstAdvisory, 'self-start md:self-auto') : ''}
            </div>
        `;
    } else {
        container.className = 'mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-100';
        container.innerHTML = `
            <div class="font-semibold">Publicering klar</div>
            <div class="mt-1">Grunddata, karta, ekipage och klassinställningar finns på plats.</div>
        `;
    }

    container.onclick = (event) => {
        const button = event.target.closest('.checklist-action-btn');
        if (!button) return;

        runChecklistAction({
            type: button.dataset.actionType,
            targetId: button.dataset.actionTarget,
            hash: button.dataset.actionHash
        });
    };
}

function renderChecklistSectionIndicators(context = latestSettingsChecklistContext) {
    const items = buildCompetitionChecklistItems(context);
    const itemsByLabel = new Map(items.map((item) => [item.label, item]));

    const modeItem = itemsByLabel.get('Tävlingsläge');
    if (modeItem) {
        renderSectionStatusBlock({
            statusId: 'settingsCompetitionModeStatus',
            cardId: 'settingsCompetitionModeCard',
            tone: modeItem.done ? 'success' : 'danger',
            badge: modeItem.done ? 'Tävlingsläge valt' : 'Tävlingsläge saknas',
            detail: modeItem.detail,
            item: modeItem
        });
    }

    const mapItem = itemsByLabel.get('Karta');
    if (mapItem) {
        renderSectionStatusBlock({
            statusId: 'settingsMapStatus',
            cardId: 'settingsMapCard',
            tone: mapItem.done ? 'success' : 'danger',
            badge: mapItem.done ? 'Kartposition klar' : 'Kartposition saknas',
            detail: mapItem.detail,
            item: mapItem
        });
    }

    const classItem = itemsByLabel.get('Klassinställningar');
    if (classItem) {
        renderSectionStatusBlock({
            statusId: 'settingsClassSettingsStatus',
            cardId: 'settingsClassSettingsCard',
            tone: classItem.done ? 'success' : 'danger',
            badge: classItem.done ? 'Klassinställningar klara' : 'Klassinställningar behöver åtgärdas',
            detail: classItem.detail,
            item: classItem
        });
    }

    const { blocking, advisory } = buildPublishingValidation(context);
    const publishItem = itemsByLabel.get('Publicering');
    if (blocking.length > 0) {
        renderSectionStatusBlock({
            statusId: 'publishGateStatus',
            cardId: 'settingsPublishCard',
            tone: 'danger',
            badge: 'Publicering spärrad',
            detail: `${blocking.map((item) => item.label).join(', ')} måste vara klart först.`,
            item: blocking[0]
        });
    } else if (advisory.length > 0) {
        renderSectionStatusBlock({
            statusId: 'publishGateStatus',
            cardId: 'settingsPublishCard',
            tone: 'warning',
            badge: 'Redo med varning',
            detail: `Kontrollera gärna ${advisory.map((item) => item.label).join(', ')} innan publicering.`,
            item: advisory[0]
        });
    } else {
        renderSectionStatusBlock({
            statusId: 'publishGateStatus',
            cardId: 'settingsPublishCard',
            tone: publishItem?.done ? 'success' : 'neutral',
            badge: publishItem?.done ? 'Publicerad' : 'Redo att publicera',
            detail: publishItem?.done
                ? 'Tävlingen är publik och alla kritiska krav är uppfyllda.'
                : 'Alla kritiska krav är uppfyllda. Du kan publicera när du vill.',
            item: null
        });
    }
}

export function getSettingsHtml() {
    return `
    <div class="grid grid-cols-1 md:grid-cols-2 gap-8">

        <div class="md:col-span-2 bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border dark:border-gray-700">
            <h2 class="text-2xl font-semibold mb-2 border-b dark:border-gray-700 pb-2 dark:text-white">Skapa-checklista</h2>
            <p class="text-sm text-gray-500 mb-4 dark:text-gray-400">Visar vad som redan är på plats och vad som återstår för att få en komplett tävlingssetup.</p>
            <div id="competitionSetupChecklist" class="text-sm text-gray-500 dark:text-gray-400">Laddar checklista...</div>
        </div>
        
        <!-- TÄVLINGSTYP -->
        <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border dark:border-gray-700">
            <h2 class="text-2xl font-semibold mb-4 border-b dark:border-gray-700 pb-2 dark:text-white">Tävlingsprofil</h2>
            <div class="flex items-center justify-between">
                <div>
                    <p class="font-medium dark:text-gray-200">Internationell språk- och dokumentprofil (FEI)</p>
                    <p class="text-sm text-gray-500 dark:text-gray-400">Styr språk, rubriker, vissa kolumner och PDF-utseende. Byter inte automatiskt tävlingens beräkningslogik eller regelverk.</p>
                </div>
                <label class="inline-flex items-center cursor-pointer">
                    <input id="isInternationalToggle" type="checkbox" class="sr-only peer">
                    <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:bg-brand-darkblue dark:bg-gray-700 relative">
                        <span class="absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-all peer-checked:translate-x-5"></span>
                    </div>
                </label>
            </div>
            <div class="mt-3 text-sm text-gray-600 dark:text-gray-400" id="intlStatusHint"></div>
        </div>

        <div id="settingsCompetitionModeCard" class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border dark:border-gray-700">
            <h2 class="text-2xl font-semibold mb-4 border-b dark:border-gray-700 pb-2 dark:text-white">${t('competition_mode')}</h2>
            <label for="competitionModeSelect" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">${t('competition_mode_label')}</label>
            <select id="competitionModeSelect" class="block w-full p-3 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                <option value="live">${t('competition_mode_live')}</option>
                <option value="field">${t('competition_mode_field')}</option>
            </select>
            <p id="competitionModeHint" class="mt-3 text-sm text-gray-600 dark:text-gray-400">
                ${t('competition_mode_intro_hint')}
            </p>
            <div id="settingsCompetitionModeStatus"></div>
        </div>

        <!-- PUBLICERING START -->
        <div id="settingsPublishCard" class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border dark:border-gray-700">
            <h2 class="text-2xl font-semibold mb-4 border-b dark:border-gray-700 pb-2 dark:text-white">Publicering</h2>
            <p class="text-sm text-gray-500 mb-4 dark:text-gray-400">Bestäm när tävlingen ska synas för allmänheten på startsidan.</p>
            
            <div class="flex items-center justify-between bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-100 dark:border-blue-800">
                <div>
                    <h3 class="font-bold text-gray-900 dark:text-white" id="publishStatusTitle">Utkast (Dold)</h3>
                    <p class="text-xs text-gray-600 dark:text-gray-300 mt-1" id="publishStatusDesc">Endast synlig för admins.</p>
                </div>
                <label class="inline-flex items-center cursor-pointer">
                    <input id="isPublishedToggle" type="checkbox" class="sr-only peer">
                    <div class="w-14 h-7 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:bg-green-600 dark:bg-gray-700 relative transition-colors">
                        <span class="absolute left-1 top-1 w-5 h-5 bg-white rounded-full transition-all peer-checked:translate-x-7 shadow-sm"></span>
                    </div>
                </label>
            </div>
            <p class="text-xs text-gray-400 mt-3">
              <i class="fas fa-info-circle"></i> 
              När reglaget är grönt syns tävlingen för alla besökare.
            </p>
            <div id="publishGateStatus" class="text-sm text-gray-500 dark:text-gray-400"></div>
        </div>
        <!-- PUBLICERING SLUT -->

        <!-- TÄVLINGENS LOGGA -->
        <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border dark:border-gray-700">
            <h2 class="text-2xl font-semibold mb-4 border-b dark:border-gray-700 pb-2 dark:text-white">Tävlingslogga</h2>
            <p class="text-sm text-gray-500 mb-4 dark:text-gray-400">Ladda upp en logga för tävlingen, arrangören eller föreningen. Den visas i sidhuvuden och i PDF-exporter.</p>

            <div class="flex items-center gap-4">
                <div id="competitionLogoPreview" class="w-20 h-20 rounded-lg border dark:border-gray-600 bg-gray-50 dark:bg-gray-900 flex items-center justify-center overflow-hidden">
                    <span class="text-xs text-gray-400 text-center px-2">Ingen logga</span>
                </div>
                <div class="flex-1 min-w-0">
                    <div id="competitionLogoName" class="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">Ingen logga vald</div>
                    <div id="competitionLogoStatus" class="text-xs text-gray-500 dark:text-gray-400 mt-1">PNG, JPG eller WebP, max 2 MB.</div>
                    <div class="mt-3 flex flex-wrap gap-2">
                        <input id="competitionLogoFileInput" type="file" class="hidden" accept="image/png,image/jpeg,image/webp">
                        <button id="uploadCompetitionLogoBtn" type="button" class="px-3 py-2 bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-200 rounded text-sm font-semibold">
                            Ladda upp logga
                        </button>
                        <button id="removeCompetitionLogoBtn" type="button" class="px-3 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 rounded text-sm font-semibold hidden">
                            Ta bort logga
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- DIGITAL DEKLARERING -->
        <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border dark:border-gray-700">
            <h2 class="text-2xl font-semibold mb-4 border-b dark:border-gray-700 pb-2 dark:text-white">Digital Deklarering</h2>
            <p class="text-sm text-gray-500 mb-4 dark:text-gray-400">Styr när kuskar senast får ändra sina uppgifter (häst, vagn, groom) via "Min Portal".</p>
            
            <div class="mb-4">
                <label for="lockdownMinutesInput" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Låsändring (minuter innan start)</label>
                <div class="flex items-center gap-2 mt-1">
                    <input type="number" id="lockdownMinutesInput" class="block w-32 p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="60">
                    <span class="text-sm text-gray-500 dark:text-gray-400">minuter</span>
                </div>
                <p class="text-xs text-gray-500 mt-1 dark:text-gray-400">Standard: 60 minuter. Sätt till 0 för att alltid tillåta, eller ett högt värde för att låsa tidigare.</p>
            </div>

            <div class="flex items-center gap-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
                <input type="checkbox" id="manualLockdownCheckbox" class="h-5 w-5 text-red-600 rounded focus:ring-red-500 border-gray-300 dark:bg-gray-800 dark:border-gray-600">
                <div>
                    <label for="manualLockdownCheckbox" class="block font-bold text-red-800 dark:text-red-300">Lås alla ändringar NU</label>
                    <p class="text-xs text-red-600 dark:text-red-400">Kryssa i för att omedelbart stänga portalen för alla ändringar, oavsett tid.</p>
                </div>
            </div>
        </div>
        
        <!-- PLATS & KARTA -->
        <div id="settingsMapCard" class="md:col-span-2 bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border dark:border-gray-700">
            <h2 class="text-2xl font-semibold mb-4 border-b dark:border-gray-700 pb-2 dark:text-white">Plats & Karta</h2>
            <p class="text-sm text-gray-500 mb-4 dark:text-gray-400">Ange tävlingsplatsens exakta position. Detta visas för deltagare och publik i Info-modalen.</p>
            
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div class="md:col-span-1 space-y-4">
                     <div>
                        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Platsnamn</label>
                         <input type="text" id="settingsPlaceInput" class="mt-1 block w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:text-white" readonly title="Ändras via Hubben" placeholder="Laddar...">
                     </div>
                     <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase dark:text-gray-400">Latitud</label>
                        <input type="text" id="settingsLatInput" class="mt-1 block w-full p-2 border rounded-md font-mono text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" readonly>
                     </div>
                      <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase dark:text-gray-400">Longitud</label>
                        <input type="text" id="settingsLngInput" class="mt-1 block w-full p-2 border rounded-md font-mono text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" readonly>
                     </div>
                     <p class="text-xs text-gray-400 italic">Klicka på kartan för att flytta markören.</p>
                </div>
                <div class="md:col-span-2 h-80 bg-gray-100 dark:bg-gray-900 rounded-lg border dark:border-gray-700 relative z-0" id="settingsMapContainer"></div>
            </div>
            <div id="settingsMapStatus"></div>
        </div>

        <!-- KLASSINSTÄLLNINGAR -->
        <div id="settingsClassSettingsCard" class="md:col-span-2 bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border dark:border-gray-700">
            <h2 class="text-2xl font-semibold mb-4 border-b dark:border-gray-700 pb-2 dark:text-white">Klass-inställningar</h2>
            <p class="text-sm text-gray-500 mb-6 dark:text-gray-400">Bestäm hur många som ska placeras i varje klass. Systemet föreslår 1/4 (avrundat uppåt) som standard.</p>
            
            <div class="overflow-x-auto">
                <table class="min-w-full divide-y dark:divide-gray-700">
                    <thead>
                        <tr class="text-left text-xs font-bold text-gray-400 uppercase tracking-wider">
                            <th class="px-4 py-2">Klass</th>
                            <th class="px-4 py-2">Antal Startande</th>
                            <th class="px-4 py-2">Antal Placerade</th>
                        </tr>
                    </thead>
                    <tbody id="classSettingsTableBody" class="divide-y dark:divide-gray-700">
                        <!-- Injected via JS -->
                        <tr><td colspan="3" class="p-8 text-center text-gray-400 italic">Laddar klasser...</td></tr>
                    </tbody>
                </table>
            </div>
            <div id="settingsClassSettingsStatus"></div>
        </div>

        <div class="md:col-span-2">
            <button id="saveGlobalSettingsBtn" class="px-6 py-3 bg-brand-darkblue text-white font-bold rounded-lg shadow hover:bg-brand-gold hover:text-brand-darkblue dark:bg-blue-600 dark:hover:bg-blue-500">
                Spara alla inställningar
            </button>
        </div>

        <!-- BEHÖRIGHETER & ÅTKOMST -->
        <div class="md:col-span-2 bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border dark:border-gray-700 mt-6">
            <h2 class="text-2xl font-semibold mb-4 border-b dark:border-gray-700 pb-2 dark:text-white">Behörigheter & Åtkomst</h2>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                <!-- PIN Kod för inhoppare -->
                <div class="bg-blue-50 dark:bg-blue-900/20 p-5 rounded-lg border border-blue-100 dark:border-blue-800">
                    <h3 class="font-bold text-lg text-blue-900 dark:text-blue-300 mb-2">Funktionärskoder (Engångskoder)</h3>
                    <p class="text-sm text-blue-800 dark:text-blue-200 mb-4">
                        Dela ut rätt pinkod till rätt person (t.ex. maratonkoden till hinderdomaren). 
                        När de knappar in koden via "Min Portal" får de enbart behörighet för den rollen.
                    </p>
                    <div class="space-y-4">
                        <div class="flex items-center justify-between">
                            <span class="font-medium dark:text-gray-200">Admin/Sekretariat:</span>
                            <div class="flex items-center gap-2">
                                <span id="pinCode_admin" class="font-mono font-bold tracking-widest text-brand-darkblue dark:text-brand-lightblue bg-white dark:bg-gray-800 px-2 py-1 rounded shadow-sm border dark:border-gray-700">------</span>
                                <button class="btnGeneratePin text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded" data-role="admin">Ny</button>
                            </div>
                        </div>
                        <div class="flex items-center justify-between">
                            <span class="font-medium dark:text-gray-200">Dressyr:</span>
                            <div class="flex items-center gap-2">
                                <span id="pinCode_dressage" class="font-mono font-bold tracking-widest text-brand-darkblue dark:text-brand-lightblue bg-white dark:bg-gray-800 px-2 py-1 rounded shadow-sm border dark:border-gray-700">------</span>
                                <button class="btnGeneratePin text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded" data-role="dressage">Ny</button>
                            </div>
                        </div>
                        <div class="flex items-center justify-between">
                            <span class="font-medium dark:text-gray-200">Maraton:</span>
                            <div class="flex items-center gap-2">
                                <span id="pinCode_marathon" class="font-mono font-bold tracking-widest text-brand-darkblue dark:text-brand-lightblue bg-white dark:bg-gray-800 px-2 py-1 rounded shadow-sm border dark:border-gray-700">------</span>
                                <button class="btnGeneratePin text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded" data-role="marathon">Ny</button>
                            </div>
                        </div>
                        <div class="flex items-center justify-between">
                            <span class="font-medium dark:text-gray-200">Precision:</span>
                            <div class="flex items-center gap-2">
                                <span id="pinCode_precision" class="font-mono font-bold tracking-widest text-brand-darkblue dark:text-brand-lightblue bg-white dark:bg-gray-800 px-2 py-1 rounded shadow-sm border dark:border-gray-700">------</span>
                                <button class="btnGeneratePin text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded" data-role="precision">Ny</button>
                            </div>
                        </div>
                        <div class="flex items-center justify-between">
                            <span class="font-medium dark:text-gray-200">Speaker:</span>
                            <div class="flex items-center gap-2">
                                <span id="pinCode_speaker" class="font-mono font-bold tracking-widest text-brand-darkblue dark:text-brand-lightblue bg-white dark:bg-gray-800 px-2 py-1 rounded shadow-sm border dark:border-gray-700">------</span>
                                <button class="btnGeneratePin text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded" data-role="speaker">Ny</button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Lista över anslutna -->
                <div>
                    <h3 class="font-bold text-lg text-gray-900 dark:text-gray-100 mb-2">Anslutna via kod</h3>
                    <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
                        Här listas de som knappat in koden ovan. Klicka på soptunnan för att dra in deras rättigheter.
                        <br>
                        <em>Tips: Föranmälda funktionärer syns i <a href="#deltagare" class="text-blue-600 underline" onclick="document.querySelector('[data-i18n=menu_official]').click()">Personregistret</a>.</em>
                    </p>
                    <div class="bg-gray-50 dark:bg-gray-900 border dark:border-gray-700 rounded-md max-h-60 overflow-y-auto">
                        <ul id="pinAdminsList" class="divide-y divide-gray-200 dark:divide-gray-700">
                            <li class="p-4 text-center text-gray-500 italic">Laddar...</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>

        <!-- DANGER ZONE -->
        <div id="dangerZone" class="md:col-span-2 mt-12 bg-red-50 dark:bg-red-900/10 p-6 rounded-xl shadow-md border border-red-200 dark:border-red-900" style="display:none;">
            <h2 class="text-2xl font-bold text-red-800 dark:text-red-400 mb-4 border-b border-red-200 dark:border-red-800 pb-2">Danger Zone</h2>
            <p class="text-sm text-red-700 dark:text-red-300 mb-6 font-medium">
                Här kan du radera hela tävlingen permanent.
                Detta tar bort <strong>allt</strong>: inställningar, resultat, anmälda ekipage, funktionärer och loggar.
                <br><br>
                Detta går <u>inte</u> att ångra.
            </p>
            <button id="btnDeleteComp" class="px-5 py-3 bg-red-600 text-white font-bold rounded hover:bg-red-700 shadow-sm transition-colors flex items-center gap-2">
                Radera Tävling
            </button>
        </div>

    </div>
  `;
}

export async function setupSettingsLogic(competitionId) {
    try {
        const meta = await getConfig(competitionId, 'competitionMeta').catch(() => ({}));

        // --- 1. Basic Settings (Meta) ---
        // International Toggle
        const isInt = !!meta?.isInternational;
        const tgl = document.getElementById('isInternationalToggle');
        const hint = document.getElementById('intlStatusHint');

        if (tgl) tgl.checked = isInt;
        if (hint) hint.textContent = isInt
            ? 'Profil: Internationell (FEI) - engelska rubriker i dokument och publikvyer.'
            : 'Profil: Nationell (SvRF) - svenska rubriker i dokument och publikvyer.';

        if (tgl) {
            tgl.addEventListener('change', () => {
                const val = tgl.checked;
                if (hint) hint.textContent = val
                    ? 'Profil: Internationell (FEI) - engelska rubriker i dokument och publikvyer.'
                    : 'Profil: Nationell (SvRF) - svenska rubriker i dokument och publikvyer.';
            });
        }

        // Lockdown
        const ldInput = document.getElementById('lockdownMinutesInput');
        if (ldInput) {
            ldInput.value = (meta.lockdownMinutes !== undefined) ? meta.lockdownMinutes : 60;
        }
        const ldCheck = document.getElementById('manualLockdownCheckbox');
        if (ldCheck) {
            ldCheck.checked = !!meta.manualLockdown;
        }

        // --- 2. Map & Coordinates (From Config) ---
        // We fetch 'map' config. Fallback to competition doc 'coordinates' for migration/legacy.
        const mapConfig = await getConfig(competitionId, 'map').catch(() => ({}));
        const compDoc = await getCompetitionById(competitionId);
        const [equipages, classConfig, judges, officials, startTimesConfig, publicInfo] = await Promise.all([
            getEquipages(competitionId),
            getConfig(competitionId, 'classSettings').catch(() => ({})),
            getJudges(competitionId).catch(() => []),
            getOfficials(competitionId).catch(() => []),
            getConfig(competitionId, 'startTimes').catch(() => ({})),
            getConfig(competitionId, 'publicInfo').catch(() => ({}))
        ]);

        const checklistContext = {
            compDoc: compDoc ? { ...compDoc } : {},
            meta: { ...(meta || {}) },
            mapConfig: { ...(mapConfig || {}) },
            equipages,
            classConfig: { ...(classConfig || {}) },
            judges,
            officials,
            startTimesConfig: { ...(startTimesConfig || {}) },
            publicInfo: { ...(publicInfo || {}) }
        };

        let initialCoords = mapConfig.coordinates;
        if (!initialCoords && compDoc && compDoc.coordinates) {
            initialCoords = compDoc.coordinates;
        }

        if (compDoc) {
            document.getElementById('settingsPlaceInput').value = compDoc.place || '';
        }

        const competitionMode = compDoc?.competitionMode === 'field' ? 'field' : 'live';
        const competitionModeSelect = document.getElementById('competitionModeSelect');
        const competitionModeHint = document.getElementById('competitionModeHint');
        const updateCompetitionModeHint = (mode) => {
            if (!competitionModeHint) return;
            competitionModeHint.textContent = mode === 'field'
                ? t('competition_mode_field_hint')
                : t('competition_mode_live_hint');
        };

        if (competitionModeSelect) {
            competitionModeSelect.value = competitionMode;
            updateCompetitionModeHint(competitionMode);
            competitionModeSelect.addEventListener('change', () => {
                updateCompetitionModeHint(competitionModeSelect.value);
            });
        }

        setupCompetitionLogoControls(competitionId, compDoc, meta);
        renderCompetitionSetupChecklist(checklistContext);
        renderChecklistSectionIndicators(checklistContext);

        // --- 1.5 Publishing Status (Root Doc) ---
        // Defaults to TRUE if undefined (backward compatibility)
        const isPub = (compDoc.published !== false);
        const pubToggle = document.getElementById('isPublishedToggle');
        const pubTitle = document.getElementById('publishStatusTitle');
        const pubDesc = document.getElementById('publishStatusDesc');

        const updatePubUI = (published) => {
            if (pubTitle) pubTitle.textContent = published ? 'Publicerad (Synlig)' : 'Utkast (Dold)';
            if (pubTitle) pubTitle.className = published ? 'font-bold text-green-700 dark:text-green-400' : 'font-bold text-gray-600 dark:text-gray-300';
            if (pubDesc) pubDesc.textContent = published ? 'Tävlingen syns nu för alla.' : 'Endast synlig för admins.';
        };

        if (pubToggle) {
            pubToggle.checked = isPub;
            updatePubUI(isPub);

            pubToggle.addEventListener('change', async () => {
                const newState = pubToggle.checked;

                if (newState) {
                    const blockedMessage = buildPublishingBlockedMessage(checklistContext);
                    if (blockedMessage) {
                        pubToggle.checked = false;
                        updatePubUI(false);
                        renderChecklistSectionIndicators(checklistContext);
                        window.alert(blockedMessage);
                        return;
                    }

                    const advisoryMessage = buildPublishingAdvisoryMessage(checklistContext);
                    if (advisoryMessage && !window.confirm(advisoryMessage)) {
                        pubToggle.checked = false;
                        updatePubUI(false);
                        renderChecklistSectionIndicators(checklistContext);
                        return;
                    }
                }

                updatePubUI(newState);

                // Save immediately (separate from global save button to be responsive)
                try {
                    await updateCompetition(competitionId, { published: newState });
                    checklistContext.compDoc = {
                        ...checklistContext.compDoc,
                        published: newState
                    };
                    renderCompetitionSetupChecklist(checklistContext);
                    renderChecklistSectionIndicators(checklistContext);

                    // Show small toast or just rely on toggle state
                    // showAlert(newState ? 'Tävlingen är nu publicerad.' : 'Tävlingen är nu dold.', true);
                } catch (err) {
                    console.error('Failed to toggle publish status:', err);
                    pubToggle.checked = !newState; // Revert
                    updatePubUI(!newState);
                    renderChecklistSectionIndicators(checklistContext);
                    showAlert('Kunde inte ändra status.', false);
                }
            });
        }

        // Init Map
        initSettingsMap(initialCoords);

        // --- 3. Save Handler ---
        const btn = document.getElementById('saveGlobalSettingsBtn');
        if (btn) {
            btn.onclick = async () => {
                btn.textContent = 'Sparar...';
                btn.disabled = true;
                try {
                    // Meta
                    const newValIntl = !!document.getElementById('isInternationalToggle')?.checked;
                    const newValLock = Number(document.getElementById('lockdownMinutesInput')?.value ?? 60);
                    const newValManual = !!document.getElementById('manualLockdownCheckbox')?.checked;
                    const newCompetitionMode = document.getElementById('competitionModeSelect')?.value === 'field' ? 'field' : 'live';

                    // Coordinates
                    const lat = document.getElementById('settingsLatInput').value;
                    const lng = document.getElementById('settingsLngInput').value;
                    let newCoords = null;
                    if (lat && lng) {
                        newCoords = { lat: parseFloat(lat), lng: parseFloat(lng) };
                    }

                    // Class Settings
                    const classSettings = {};
                    document.querySelectorAll('#classSettingsTableBody tr').forEach(row => {
                        const className = row.dataset.className;
                        const input = row.querySelector('.placed-count-input');
                        if (className && input) {
                            const val = parseInt(input.value);
                            if (!isNaN(val)) {
                                classSettings[className] = { placedCount: val };
                            }
                        }
                    });

                    await updateCompetition(competitionId, {
                        competitionMode: newCompetitionMode
                    });

                    const currentComp = getGlobalState('currentCompetition');
                    if (currentComp?.id === competitionId) {
                        setGlobalState({
                            key: 'currentCompetition',
                            value: {
                                ...currentComp,
                                competitionMode: newCompetitionMode
                            }
                        });
                    }

                    // Save Meta
                    await saveConfig(competitionId, 'competitionMeta', {
                        isInternational: newValIntl,
                        lockdownMinutes: newValLock,
                        manualLockdown: newValManual
                    });

                    // Save Class Settings
                    await saveConfig(competitionId, 'classSettings', classSettings);

                    // Save Coordinates to Config (Safe Path)
                    // We save to `config/map` as updating root document often fails due to permissions.
                    await saveConfig(competitionId, 'map', {
                        coordinates: newCoords,
                        updatedAt: new Date()
                    });

                    checklistContext.compDoc = {
                        ...checklistContext.compDoc,
                        competitionMode: newCompetitionMode
                    };
                    checklistContext.meta = {
                        ...checklistContext.meta,
                        isInternational: newValIntl,
                        lockdownMinutes: newValLock,
                        manualLockdown: newValManual
                    };
                    checklistContext.classConfig = { ...classSettings };
                    checklistContext.mapConfig = {
                        ...checklistContext.mapConfig,
                        coordinates: newCoords
                    };
                    renderCompetitionSetupChecklist(checklistContext);
                    renderChecklistSectionIndicators(checklistContext);

                    showAlert('Inställningar sparade! ✅', true);
                } catch (err) {
                    console.error(err);
                    showAlert('Kunde inte spara inställningar.', false);
                } finally {
                    btn.textContent = 'Spara alla inställningar';
                    btn.disabled = false;
                }
            };
        }

        // --- 4. Class Settings Logic ---
        const tableBody = document.getElementById('classSettingsTableBody');
        if (tableBody && equipages) {
            const classes = [...new Set(equipages.map(e => e.className || 'Okänd'))].sort();
            
            tableBody.innerHTML = classes.map(cls => {
                const starters = equipages.filter(e => e.className === cls).length;
                const defaultPlaced = Math.ceil(starters / 4) || 1;
                const savedPlaced = classConfig[cls]?.placedCount;
                
                return `
                    <tr data-class-name="${cls}">
                        <td class="px-4 py-3 font-medium dark:text-white">${cls}</td>
                        <td class="px-4 py-3 text-gray-500 dark:text-gray-400">${starters}</td>
                        <td class="px-4 py-3">
                            <input type="number" min="1" step="1" 
                                class="placed-count-input w-20 p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" 
                                value="${savedPlaced ?? defaultPlaced}"
                                placeholder="${defaultPlaced}">
                        </td>
                    </tr>
                `;
            }).join('');
        }

    } catch (e) {
        console.warn('Kunde inte läsa/spara inställningar', e);
    }

    // --- 5. BEHÖRIGHETER & PIN-KOD LOGIK ---
    try {
        const currentUser = getGlobalState('currentUser');
        const comp = await getCompetitionById(competitionId);
        
        let isOwner = false;
        if (currentUser) {
            if (currentUser.role === 'superadmin') isOwner = true;
            if (comp && comp.createdBy === currentUser.uid) isOwner = true;
            if (comp && comp.ownerId === currentUser.uid) isOwner = true;
            if (comp && comp.admins && comp.admins.includes(currentUser.uid)) isOwner = true;
            if (Array.isArray(currentUser.compRoles) && currentUser.compRoles.includes('admin')) isOwner = true;
            // Admin role is global admin
            if (currentUser.role === 'admin') isOwner = true;
        }

        if (isOwner) {
            // Hämta / Generera PIN-kod
            let secretData = await getSecretConfig(competitionId);
            
            const generateAndSavePin = async (role) => {
                const newPin = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits
                const key = role === 'admin' ? 'accessCode' : `accessCode_${role}`;
                const updateData = { updatedAt: Date.now() };
                updateData[key] = newPin;
                
                await saveSecretConfig(competitionId, updateData);
                const displayEl = document.getElementById(`pinCode_${role}`);
                if (displayEl) displayEl.textContent = newPin;
                return newPin;
            };

            const roles = ['admin', 'dressage', 'marathon', 'precision', 'speaker'];
            
            if (!secretData) {
                secretData = {};
            }

            // Rendera befintliga eller generera om de saknas
            for (const role of roles) {
                const key = role === 'admin' ? 'accessCode' : `accessCode_${role}`;
                const displayEl = document.getElementById(`pinCode_${role}`);
                if (!secretData[key]) {
                    await generateAndSavePin(role);
                } else {
                    if (displayEl) displayEl.textContent = secretData[key];
                }
            }

            document.querySelectorAll('.btnGeneratePin').forEach(btn => {
                btn.onclick = async (e) => {
                    const role = e.currentTarget.dataset.role;
                    if (confirm(`Är du säker på att du vill byta koden för ${role}? De som redan använt gamla koden kommer behålla sina rättigheter, men nya funktionärer måste få den nya koden.`)) {
                        const originalText = e.currentTarget.textContent;
                        e.currentTarget.textContent = "...";
                        await generateAndSavePin(role);
                        e.currentTarget.textContent = originalText;
                    }
                };
            });

            // Lyssna på anslutna admins
            if (activeAdminsUnsub) {
                try { activeAdminsUnsub(); } catch { }
                activeAdminsUnsub = null;
            }
            const adminListWrapper = document.getElementById('pinAdminsList')?.parentElement?.parentElement;
            if (adminListWrapper && !document.getElementById('roleEmailMigrationPanel')) {
                adminListWrapper.insertAdjacentHTML('beforeend', `
                    <div id="roleEmailMigrationPanel" class="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-900/20">
                        <div class="font-semibold text-amber-900 dark:text-amber-200">Migrera gamla rollmejl</div>
                        <p class="mt-1 text-amber-800 dark:text-amber-300">
                            Flytta legacy-listor med funktionarsmejl till privat lagring och rensa bort dem fran publika tavlingsdokument.
                        </p>
                        <button id="migrateRoleEmailsBtn" type="button" class="mt-3 rounded bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700 dark:bg-amber-700 dark:hover:bg-amber-600">
                            Migrera rollmejl
                        </button>
                    </div>
                `);
            }

            document.getElementById('migrateRoleEmailsBtn')?.addEventListener('click', async (event) => {
                if (!window.confirm('Detta flyttar legacy-rollmejl till privat lagring och rensar bort dem fran publika tavlingsdata. Fortsatta?')) {
                    return;
                }

                const button = event.currentTarget;
                const originalText = button.textContent;
                button.disabled = true;
                button.textContent = 'Migrerar...';
                try {
                    const result = await migrateLegacyCompetitionRoleEmails(competitionId);
                    showAlert(`Rollmejl migrerade. ${result.migratedEmails} e-postposter uppdaterades.`, true);
                } catch (error) {
                    console.error('Kunde inte migrera rollmejl:', error);
                    showAlert('Kunde inte migrera rollmejl.', false);
                } finally {
                    button.disabled = false;
                    button.textContent = originalText;
                }
            });

            const listEl = document.getElementById('pinAdminsList');
            
            const renderAdmins = (admins) => {
                if (!listEl) return;
                if (admins.length === 0) {
                    listEl.innerHTML = '<li class="p-4 text-center text-gray-500 italic text-sm">Ingen har anslutit med koden ännu.</li>';
                    return;
                }

                listEl.innerHTML = admins.map(a => {
                    const dateStr = a.joinedAt ? new Date(a.joinedAt).toLocaleString('sv-SE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Okänt';
                    return `
                    <li class="p-3 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                        <div>
                            <p class="text-sm font-semibold text-gray-900 dark:text-gray-100">${a.email || 'Okänd användare'} ${
                                (a.roles || [a.role || 'admin']).map(r => `<span class="text-xs ml-2 px-2 py-0.5 bg-gray-200 dark:bg-gray-700 rounded-full text-gray-700 dark:text-gray-300">${r}</span>`).join('')
                            }</p>
                            <p class="text-xs text-gray-500 dark:text-gray-400">Anslöt: ${dateStr}</p>
                        </div>
                        <button class="delete-admin-btn text-red-500 hover:text-red-700 bg-red-50 dark:bg-red-900/20 p-2 rounded-md transition-colors" data-uid="${a.uid}" title="Ta bort åtkomst">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                              <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                            </svg>
                        </button>
                    </li>
                    `;
                }).join('');

                // Koppla klick-event för borttagning
                document.querySelectorAll('.delete-admin-btn').forEach(btn => {
                    btn.onclick = async (e) => {
                        const uid = e.currentTarget.dataset.uid;
                        if (confirm("Vill du dra in åtkomsten för denna användare omedelbart?")) {
                            e.currentTarget.disabled = true;
                            e.currentTarget.classList.add('opacity-50');
                            await deleteCompetitionAdmin(competitionId, uid);
                        }
                    };
                });
            };

            activeAdminsUnsub = listenForCompetitionAdmins(competitionId, renderAdmins);
        }
    } catch (e) {
        console.warn("Kunde inte ladda behörigheter:", e);
    }

    // --- DANGER ZONE LOGIC ---
    try {
        const currentUser = getGlobalState('currentUser');
        // Vi hämtar tävlingen igen för att vara säkra på att vi har senaste ägar-infon
        const comp = await getCompetitionById(competitionId);

        let isAllowed = false;
        if (currentUser) {
            if (currentUser.role === 'superadmin') isAllowed = true;
            if (comp && comp.createdBy && comp.createdBy === currentUser.uid) isAllowed = true;
        }

        if (isAllowed) {
            const dz = document.getElementById('dangerZone');
            if (dz) dz.style.display = 'block';

            document.getElementById('btnDeleteComp')?.addEventListener('click', async () => {
                if (confirm('⚠️ VARNING! ⚠️\n\nÄr du SÄKER på att du vill radera HELA tävlingen?\n\nDetta raderar ALLA resultat, ekipage och inställningar permanent.\nDet går INTE att ångra!')) {
                    const name = prompt(`För att bekräfta, skriv tävlingens exakta namn:\n"${comp.name}"`);
                    if (name === comp.name) {
                        try {
                            const btn = document.getElementById('btnDeleteComp');
                            btn.disabled = true;
                            btn.textContent = 'Raderar...';

                            await deleteCompetition(competitionId);

                            alert('Tävlingen har raderats.');
                            window.location.hash = '#hub';
                            window.location.reload();
                        } catch (err) {
                            console.error(err);
                            alert('Fel vid radering: ' + err.message);
                            const btn = document.getElementById('btnDeleteComp');
                            if (btn) {
                                btn.disabled = false;
                                btn.innerHTML = 'Radera Tävling';
                            }
                        }
                    } else {
                        if (name !== null) alert('Felaktigt namn. Radering avbruten.');
                    }
                }
            });
        }
    } catch (err) {
        console.warn('Error checking danger zone permissions:', err);
    }
}

function setupCompetitionLogoControls(competitionId, compDoc = {}, meta = {}) {
    const preview = document.getElementById('competitionLogoPreview');
    const nameEl = document.getElementById('competitionLogoName');
    const statusEl = document.getElementById('competitionLogoStatus');
    const fileInput = document.getElementById('competitionLogoFileInput');
    const uploadBtn = document.getElementById('uploadCompetitionLogoBtn');
    const removeBtn = document.getElementById('removeCompetitionLogoBtn');

    if (!preview || !fileInput || !uploadBtn) return;

    const merged = { ...(compDoc || {}), meta: { ...(meta || {}), ...(compDoc?.meta || {}) } };

    const renderLogo = (competitionLike = {}) => {
        const url = getCompetitionLogoUrl(competitionLike);
        const name = getCompetitionLogoName(competitionLike);
        if (url) {
            preview.innerHTML = `<img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" class="max-w-full max-h-full object-contain">`;
            if (nameEl) nameEl.textContent = name;
            if (statusEl) statusEl.textContent = 'Loggan är sparad för tävlingen.';
            if (removeBtn) removeBtn.classList.remove('hidden');
        } else {
            preview.innerHTML = '<span class="text-xs text-gray-400 text-center px-2">Ingen logga</span>';
            if (nameEl) nameEl.textContent = 'Ingen logga vald';
            if (statusEl) statusEl.textContent = 'PNG, JPG eller WebP, max 2 MB.';
            if (removeBtn) removeBtn.classList.add('hidden');
        }
    };

    renderLogo(merged);

    uploadBtn.onclick = () => fileInput.click();
    fileInput.onchange = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const originalText = uploadBtn.textContent;
        uploadBtn.textContent = 'Laddar upp...';
        uploadBtn.disabled = true;

        try {
            let logoUrl = '';
            try {
                logoUrl = await uploadCompetitionLogo(competitionId, file);
            } catch (uploadError) {
                if (uploadError?.code !== 'storage/unauthorized') throw uploadError;
                console.warn('Storage blockerade tävlingsloggan, sparar nedskalad bild i config istället:', uploadError);
                logoUrl = await fileToLogoDataUrl(file);
            }
            const logoName = file.name;
            const logoUpdatedAt = new Date().toISOString();
            const isInlineLogo = String(logoUrl).startsWith('data:');
            const logoStorageMode = isInlineLogo ? 'configDataUrl' : 'storageUrl';
            const payload = { logoUrl, logoName, logoUpdatedAt, logoStorageMode };
            const rootPayload = isInlineLogo
                ? { logoUrl: '', logoName, logoUpdatedAt, logoStorageMode }
                : payload;

            await Promise.all([
                updateCompetition(competitionId, rootPayload).catch(error => {
                    console.warn('Kunde inte spara logga på tävlingsdokumentet:', error);
                    return null;
                }),
                saveConfig(competitionId, 'competitionMeta', payload)
            ]);

            const currentComp = getGlobalState('currentCompetition');
            if (currentComp?.id === competitionId) {
                Object.assign(currentComp, rootPayload);
                currentComp.meta = { ...(currentComp.meta || {}), ...payload };
            }

            renderLogo({ ...payload, meta: payload });
            showAlert('Loggan är uppladdad och sparad.', true);
        } catch (error) {
            console.error('Kunde inte ladda upp tavlingslogga:', error);
            showAlert(error.message || 'Kunde inte ladda upp loggan.', false);
        } finally {
            uploadBtn.textContent = originalText;
            uploadBtn.disabled = false;
            fileInput.value = '';
        }
    };

    if (removeBtn) {
        removeBtn.onclick = async () => {
            if (!confirm('Vill du ta bort tävlingsloggan från denna tävling?')) return;
            const payload = { logoUrl: '', logoName: '', logoUpdatedAt: new Date().toISOString(), logoStorageMode: '' };
            removeBtn.disabled = true;
            try {
                await Promise.all([
                    updateCompetition(competitionId, payload).catch(error => {
                        console.warn('Kunde inte rensa logga på tävlingsdokumentet:', error);
                        return null;
                    }),
                    saveConfig(competitionId, 'competitionMeta', payload)
                ]);

                const currentComp = getGlobalState('currentCompetition');
                if (currentComp?.id === competitionId) {
                    Object.assign(currentComp, payload);
                    currentComp.meta = { ...(currentComp.meta || {}), ...payload };
                }

                renderLogo({});
                showAlert('Loggan är borttagen.', true);
            } catch (error) {
                console.error('Kunde inte ta bort tavlingslogga:', error);
                showAlert('Kunde inte ta bort loggan.', false);
            } finally {
                removeBtn.disabled = false;
            }
        };
    }
}

async function fileToLogoDataUrl(file) {
    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
        throw new Error('Loggan måste vara PNG, JPG eller WebP.');
    }

    const objectUrl = URL.createObjectURL(file);
    try {
        const img = new Image();
        img.src = objectUrl;
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
        });

        const maxSize = 420;
        const scale = Math.min(1, maxSize / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
        const width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
        const height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        if (dataUrl.length > 260000) {
            throw new Error('Loggan är för stor även efter nedskalning. Välj en mindre bild.');
        }
        return dataUrl;
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

export function refreshMap() {
    if (mapInstance && document.getElementById('settingsMapContainer')) {
        mapInstance.invalidateSize();
        if (markerInstance) {
            const ll = markerInstance.getLatLng();
            mapInstance.setView(ll, mapInstance.getZoom());
        }
    }
}

function initSettingsMap(startCoords) {
    const mapEl = document.getElementById('settingsMapContainer');
    if (!mapEl) return;

    // cleanup old if any (though usually full re-render)
    if (mapInstance) {
        mapInstance.remove();
        mapInstance = null;
        markerInstance = null;
    }

    const defaultLat = 62.0;
    const defaultLng = 15.0;
    const defaultZoom = 5;

    let initialPos = [defaultLat, defaultLng];
    let initialZoom = defaultZoom;

    if (startCoords && startCoords.lat && startCoords.lng) {
        initialPos = [startCoords.lat, startCoords.lng];
        initialZoom = 13;

        document.getElementById('settingsLatInput').value = startCoords.lat;
        document.getElementById('settingsLngInput').value = startCoords.lng;
    }

    if (typeof window.L === 'undefined') {
        mapEl.innerHTML = `
            <div class="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/60 px-4 py-6 text-sm text-gray-500 dark:text-gray-300">
                Kartväljaren kunde inte laddas. Ange koordinater manuellt.
            </div>
        `;
        return;
    }

    mapInstance = L.map(mapEl).setView(initialPos, initialZoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapInstance);

    // Initial marker
    if (startCoords && startCoords.lat) {
        markerInstance = L.marker(initialPos).addTo(mapInstance);
    }

    // Click to move
    mapInstance.on('click', (e) => {
        const { lat, lng } = e.latlng;
        if (markerInstance) {
            markerInstance.setLatLng(e.latlng);
        } else {
            markerInstance = L.marker(e.latlng).addTo(mapInstance);
        }
        document.getElementById('settingsLatInput').value = lat;
        document.getElementById('settingsLngInput').value = lng;
    });

    // Fix render
    setTimeout(() => { mapInstance.invalidateSize(); }, 200);
}
