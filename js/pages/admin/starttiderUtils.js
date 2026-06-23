import { escapeHtml } from '../../utils/sharedUtils.js';

export function buildStarttiderMergeMap(raw) {
    const mergeMap = new Map();
    if (!raw) return mergeMap;

    const maybeDisplay = raw && typeof raw === 'object' && raw.mergeByClassNumber ? raw : null;
    const source = maybeDisplay ? maybeDisplay.mergeByClassNumber : raw;

    if (source && typeof source === 'object' && !Array.isArray(source)) {
        for (const [grpKey, info] of Object.entries(source)) {
            const members = (info?.members || [])
                .map(Number)
                .filter(n => Number.isFinite(n))
                .sort((a, b) => a - b);
            if (!members.length) continue;

            const label = String(info?.label || `Sammanslagen: TDB #${members.join('/')}`);
            const key = String(grpKey || `TDBGROUP:${members.join('+')}`);
            members.forEach(num => mergeMap.set(num, { key, label }));
        }
    }

    return mergeMap;
}

export function resolveStarttiderMergeGrouping(e, mergeMap = new Map()) {
    if (e?.useMergedTestForDisplay && e?.mergedTestKey && e?.mergedTestLabel) {
        return { key: String(e.mergedTestKey), label: String(e.mergedTestLabel) };
    }

    const num = Number(e?.tdbClassNumber);
    const hit = Number.isFinite(num) ? mergeMap.get(num) : null;
    if (hit) return { key: String(hit.key), label: String(hit.label) };

    return {
        key: String(e?.classId || e?.className || 'okand'),
        label: String(e?.className || 'Okänd klass')
    };
}

export function getPublishedState(startTimes = {}) {
    return startTimes.published || { dressage: false, marathon: false, precision: false };
}

export function getTimesOnlyPayload(startTimes = {}) {
    const timesOnly = { ...startTimes };
    delete timesOnly.published;
    return timesOnly;
}

export function getStarttiderPublishButtonView(key, publishedState = {}, {
    colorClass,
    borderClass,
    shortLabel,
    publishLabel,
    publishedLabel
} = {}) {
    const isPublished = !!publishedState[key];
    const ringColor = colorClass?.split('-')[1] || 'gray';
    const className = isPublished
        ? `w-full px-2 py-2 text-sm rounded-md font-bold text-white shadow-sm transition-colors ${colorClass} ring-2 ring-offset-1 ring-${ringColor}-500`
        : `w-full px-2 py-2 text-sm rounded-md bg-white text-gray-700 border ${borderClass} hover:bg-gray-50 transition-colors opacity-80`;
    const label = isPublished
        ? (publishedLabel || `Publicerad (${shortLabel})`)
        : (publishLabel || `Publicera ${shortLabel}`);

    return { className, label, isPublished };
}

export function buildStarttiderClassOptions(equipages = [], allClassesLabel = 'Alla klasser') {
    const classes = Array.from(new Set(
        equipages
            .map(equipage => equipage?._mergedLabel || equipage?.className)
            .filter(Boolean)
    )).sort((a, b) => a.localeCompare(b, 'sv'));

    return {
        classes,
        html: [`<option value="">${escapeHtml(allClassesLabel)}</option>`]
            .concat(classes.map(className => `<option value="${escapeHtml(className)}">${escapeHtml(className)}</option>`))
            .join('')
    };
}

export function renderStarttiderPublishResetSection({
    publishButtons = {},
    labels = {}
} = {}) {
    const dressage = publishButtons.dressage || {};
    const marathon = publishButtons.marathon || {};
    const precision = publishButtons.precision || {};

    return `
<!-- 3. PUBLISHING & RESET  -->
<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
    <!-- Publishing -->
    <div class="p-3 bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 shadow-sm border-l-4 border-l-blue-500">
         <h4 class="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">${labels.publishTitle || 'Publicering av Startlistor'}</h4>
         <div class="grid grid-cols-3 gap-2">
            <button id="pubDressage" class="${dressage.className || ''}">
                ${dressage.label || ''}
            </button>
            <button id="pubMarathon" class="${marathon.className || ''}">
                 ${marathon.label || ''}
            </button>
            <button id="pubPrecision" class="${precision.className || ''}">
                 ${precision.label || ''}
            </button>
         </div>
    </div>

    <!-- Reset -->
    <div class="p-3 bg-red-50 dark:bg-red-900/10 rounded-lg border border-red-100 dark:border-red-900/30">
        <h4 class="text-xs font-bold uppercase tracking-wider text-red-800 dark:text-red-400 mb-3">${labels.resetTitle || 'Rensa sektioner'}</h4>
        <div class="grid grid-cols-3 gap-2">
            <button id="clearDressage" class="w-full px-2 py-2 text-xs font-semibold rounded-md bg-red-100 text-red-700 border border-red-200 hover:bg-red-200 transition-colors">${labels.clearDressage || 'Rensa dressyr'}</button>
            <button id="clearMarathon" class="w-full px-2 py-2 text-xs font-semibold rounded-md bg-red-100 text-red-700 border border-red-200 hover:bg-red-200 transition-colors">${labels.clearMarathon || 'Rensa maraton'}</button>
            <button id="clearPrecision" class="w-full px-2 py-2 text-xs font-semibold rounded-md bg-red-100 text-red-700 border border-red-200 hover:bg-red-200 transition-colors">${labels.clearPrecision || 'Rensa precision'}</button>
        </div>
    </div>
</div>`;
}

export function renderStarttiderToolbarSection({
    publicMode = false,
    labels = {}
} = {}) {
    const saveButton = !publicMode
        ? `<button id="btnSaveTimes" class="w-full sm:w-auto px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-500 shadow-sm text-sm font-bold transition-colors">${labels.saveTimes || 'Spara tider'}</button>`
        : '';

    return `
<!-- 4. TOOLBAR (Save, Public view, Exports) -->
<div class="flex flex-col gap-3 mb-4 p-2 sm:p-3 bg-gray-100 dark:bg-gray-800 rounded-lg border dark:border-gray-700">
    <!-- Left: Modes -->
    <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
         <button id="togglePublic" class="w-full sm:w-auto px-4 py-2 rounded-md border border-gray-300 bg-white dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 hover:bg-gray-50 text-sm font-medium transition-colors">
            ${publicMode ? (labels.editorMode || 'Redigeringsläge') : (labels.publicMode || 'Publikt läge')}
        </button>
        ${saveButton}
    </div>

    <!-- View Modes -->
     <div class="grid grid-cols-2 rounded-md shadow-sm overflow-hidden sm:inline-flex sm:overflow-visible" role="group">
        <button id="viewModeStartOrder" data-mode="startorder" class="px-3 py-2 text-sm font-medium border border-gray-300 dark:border-gray-600 sm:rounded-l-lg hover:bg-gray-50 dark:hover:bg-gray-700 focus:z-10 bg-white dark:bg-gray-800 dark:text-gray-200">
            ${labels.startOrder || 'Startordning'}
        </button>
        <button id="viewModeByClass" data-mode="byclass" class="px-3 py-2 text-sm font-medium border border-gray-300 border-l-0 dark:border-gray-600 sm:border-t sm:border-b sm:border-r sm:border-l-0 sm:rounded-r-lg hover:bg-gray-50 dark:hover:bg-gray-700 focus:z-10 bg-white dark:bg-gray-800 dark:text-gray-200">
            ${labels.groupByClass || 'Gruppera klass'}
        </button>
    </div>

    <!-- Right: Exports -->
    <div class="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
        <div class="relative block text-left sm:inline-block" id="pdfDropdownContainer">
             <button id="btnPdfDropdown" class="inline-flex w-full items-center justify-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-slate-700 hover:bg-slate-600 focus:outline-none ring-1 ring-slate-900/10 sm:w-auto">
                <svg class="mr-2 -ml-1 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                PDF
                <svg class="-mr-1 ml-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </button>
             <div id="pdfDropdownMenu" class="hidden absolute right-0 mt-2 w-full sm:w-48 rounded-md shadow-lg bg-white dark:bg-gray-800 ring-1 ring-black ring-opacity-5 focus:outline-none z-50">
                <div class="py-1">
                    <button class="w-full text-left block px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700" data-action="pdf-dressage">${labels.pdfDressage || 'Startlista dressyr'}</button>
                    <button class="w-full text-left block px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700" data-action="pdf-marathon">${labels.pdfMarathon || 'Startlista maraton'}</button>
                    <button class="w-full text-left block px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700" data-action="pdf-precision">${labels.pdfPrecision || 'Startlista precision'}</button>
                </div>
            </div>
        </div>

        <button id="btnExportStarttiderCsv" class="inline-flex w-full items-center justify-center px-4 py-2 border border-gray-300 dark:border-gray-600 shadow-sm text-sm font-medium rounded-md text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 sm:w-auto">
             <i class="fas fa-file-csv mr-2 text-green-600"></i>CSV
        </button>
    </div>
</div>`;
}

export function byStartNumberAsc(a, b) {
    return (a.startNumber || 0) - (b.startNumber || 0);
}

export function toDateTimeLocalString(date) {
    if (!date || isNaN(date.getTime())) return '';
    const pad = (num) => num.toString().padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function parseDateTime(dateTimeStr) {
    if (!dateTimeStr || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dateTimeStr)) {
        return null;
    }
    return new Date(dateTimeStr);
}

export function formatDateTime(date) {
    if (!date || isNaN(date.getTime())) return '—';
    return date.toLocaleString('sv-SE', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
    });
}

export function resolveStarttiderStatus(kind, startNumber, {
    dressageStatusMap = new Map(),
    dressageFinalizationMap = new Map(),
    precisionResultsMap = new Map(),
    marathonStatusMap = new Map(),
    marathonTimingMap = new Map()
} = {}) {
    const sn = String(startNumber);

    if (kind === 'dressage') {
        const status = dressageStatusMap.get(sn);
        const finalization = dressageFinalizationMap.get(sn);
        if (finalization?.finalized || status?.state === 'finished') return 'done';
        if (status?.state === 'ongoing') return 'running';
        return 'not-started';
    }

    if (kind === 'precision') {
        const result = precisionResultsMap.get(sn);
        if (!result) return 'not-started';
        if (result.finalized) return 'done';
        if (result.running) return 'running';
        if (result.time || result.obstaclePenalty != null || result.timePenalty != null || result.eliminated) return 'done';
        return 'not-started';
    }

    if (kind === 'marathon') {
        const status = marathonStatusMap.get(sn);
        if (status?.finalized) return 'done';
        if (status?.running || (status?.start_A && !status?.finish_B)) return 'running';

        const timing = marathonTimingMap.get(sn);
        if (timing?.duration_B || timing?.finishTime || timing?.netTimeSeconds) return 'done';
        return 'not-started';
    }

    return 'not-started';
}

export function buildLiveStatus(startTimes = {}, now = new Date()) {
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    const allStarts = [];

    for (const sn in startTimes) {
        for (const discipline of ['dressage', 'marathon', 'precision']) {
            const dateObj = parseDateTime(startTimes[sn]?.[discipline]);
            if (dateObj) {
                allStarts.push({ sn: Number(sn), discipline, dateObj });
            }
        }
    }

    allStarts.sort((a, b) => a.dateObj - b.dateObj);

    const nextStart = allStarts.find(start => start.dateObj > now);
    const currentStart = allStarts.find(start => start.dateObj >= fiveMinutesAgo && start.dateObj <= now);

    return {
        current: currentStart ? { sn: currentStart.sn, discipline: currentStart.discipline } : null,
        next: nextStart ? { sn: nextStart.sn, discipline: nextStart.discipline } : null
    };
}

export function renderStarttiderStatusBadge(state, {
    doneLabel = 'Klar',
    runningLabel = 'Pågår',
    notStartedLabel = 'Ej startad'
} = {}) {
    const base = 'inline-flex items-center px-2 py-1 rounded text-[11px] font-medium';
    if (state === 'done') return `<span class="${base} bg-green-100 text-green-800">${doneLabel}</span>`;
    if (state === 'running') return `<span class="${base} bg-yellow-100 text-yellow-800">${runningLabel}</span>`;
    return `<span class="${base} bg-gray-100 text-gray-700">${notStartedLabel}</span>`;
}

export function renderStarttiderNowNextChip(discipline, startNumber, liveStatus = {}, {
    nowLabel = 'Nu',
    nextLabel = 'Nästa'
} = {}) {
    const base = 'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium';
    if (liveStatus.current?.sn === startNumber && liveStatus.current?.discipline === discipline) {
        return `<span class="${base} bg-red-100 text-red-700">${nowLabel}</span>`;
    }
    if (liveStatus.next?.sn === startNumber && liveStatus.next?.discipline === discipline) {
        return `<span class="${base} bg-blue-100 text-blue-700">${nextLabel}</span>`;
    }
    return '';
}

export function renderStarttiderTimeCell({
    discipline,
    startNumber,
    value,
    editable = false,
    publicMode = false,
    nowNextHtml = '',
    statusHtml = ''
} = {}) {
    const id = `${discipline}-${startNumber}`;
    const badges = `${nowNextHtml} <span class="ml-1">${statusHtml}</span>`;
    const displayValue = formatDateTime(parseDateTime(value));

    if (!editable || publicMode) {
        return `<div class="flex flex-col gap-1 text-gray-900 dark:text-gray-200">${displayValue}<div class="flex items-center gap-1">${badges}</div></div>`;
    }

    const inputValue = value || '';

    return `
    <div class="flex flex-col gap-1">
      <input id="${escapeHtml(id)}" type="datetime-local" class="w-36 px-1 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500" value="${escapeHtml(inputValue)}">
      <div class="flex items-center gap-1">${badges}</div>
    </div>`;
}

export function renderStarttiderActionButtons({
    discipline,
    startNumber,
    index = 0,
    totalRows = 0,
    variant = 'desktop',
    labels = {}
} = {}) {
    const disciplineStyles = {
        dressage: { shortLabel: 'D', mobileLabel: 'Dressage:', color: 'bg-slate-100', text: 'text-slate-700' },
        marathon: { shortLabel: 'M', mobileLabel: 'Marathon:', color: 'bg-emerald-100', text: 'text-emerald-700' },
        precision: { shortLabel: 'P', mobileLabel: 'Precision:', color: 'bg-indigo-100', text: 'text-indigo-700' }
    };
    const style = disciplineStyles[discipline] || disciplineStyles.dressage;
    const pauseTitle = labels.pause || 'Paus';
    const moveUpTitle = labels.moveUp || 'Flytta upp';
    const moveDownTitle = labels.moveDown || 'Flytta ner';
    const upDisabled = index === 0 ? 'opacity-25' : '';
    const downDisabled = index === totalRows - 1 ? 'opacity-25' : '';

    if (variant === 'mobile') {
        return `
            <div class="flex items-center justify-between w-full gap-2 p-0.5 rounded ${style.color}">
                <span class="font-bold text-[10px] text-gray-600 w-16 text-left">${style.mobileLabel}</span>
                <div class="flex items-center gap-1">
                    <button class="action-btn text-gray-600 hover:text-blue-600 px-1" data-action="pause" data-discipline="${discipline}" data-sn="${startNumber}" title="${pauseTitle}">☕</button>
                    <button class="action-btn text-gray-600 hover:text-green-600 px-1 ${upDisabled}" data-action="move" data-discipline="${discipline}" data-dir="up" data-sn="${startNumber}" title="${moveUpTitle}">▲</button>
                    <button class="action-btn text-gray-600 hover:text-green-600 px-1 ${downDisabled}" data-action="move" data-discipline="${discipline}" data-dir="down" data-sn="${startNumber}" title="${moveDownTitle}">▼</button>
                </div>
            </div>`;
    }

    return `
            <div class="flex items-center justify-between w-full gap-1 py-1 pl-2 pr-1 rounded-full ${style.color}">
                <span class="font-bold text-xs ${style.text} w-4 text-left">${style.shortLabel}</span>
                <div class="flex items-center gap-1">
                    <button class="action-btn text-gray-600 hover:text-blue-600" data-action="pause" data-discipline="${discipline}" data-sn="${startNumber}" title="${pauseTitle}">☕</button>
                    <button class="action-btn text-gray-600 hover:text-green-600 ${upDisabled}" data-action="move" data-discipline="${discipline}" data-dir="up" data-sn="${startNumber}" title="${moveUpTitle}">▲</button>
                    <button class="action-btn text-gray-600 hover:text-green-600 ${downDisabled}" data-action="move" data-discipline="${discipline}" data-dir="down" data-sn="${startNumber}" title="${moveDownTitle}">▼</button>
                </div>
            </div>`;
}

export function renderStarttiderDesktopRow({
    equipage,
    startTimes = {},
    index = 0,
    totalRows = 0,
    isEditable = false,
    publicMode = false,
    enableDnD = false,
    isEliminated = false,
    getHorseLabel = () => '—',
    getFlagHtml = () => '',
    getClubLogoHtml = () => '',
    renderTimeCell = () => '',
    renderActions = () => '',
    unpublishedHtml = '<span class="text-xs text-gray-400 italic">Ej publicerad</span>'
} = {}) {
    const e = equipage || {};
    const st = startTimes[String(e.startNumber)] || {};
    const isPub = startTimes.published || {};

    const getVisibleTime = (discipline, timeVal) => {
        if (isEditable) return renderTimeCell(discipline, e.startNumber, timeVal, true);
        if (!isPub[discipline]) return unpublishedHtml;
        return renderTimeCell(discipline, e.startNumber, timeVal, false);
    };

    const elimClass = isEliminated ? 'bg-red-50 dark:bg-red-900/20' : '';
    const hoverEffects = publicMode ? 'hover:bg-gray-50 dark:hover:bg-gray-700' : '';
    const dragAttrs = enableDnD
        ? `draggable="true" class="draggable-row align-top ${elimClass || hoverEffects} border-b dark:border-gray-700 last:border-0" data-sn="${escapeHtml(e.startNumber)}"`
        : `class="align-top ${elimClass || hoverEffects} border-b dark:border-gray-700 last:border-0"`;
    const grabHandle = enableDnD
        ? '<div class="cursor-grab text-gray-400 hover:text-gray-600 mr-2" title="Dra för att flytta">⋮⋮</div>'
        : '';
    const horseLabel = getHorseLabel(e);

    return `
            <tr ${dragAttrs}>
                <td class="px-2 py-2 lg:px-3 lg:py-2 text-[11px] lg:text-sm text-gray-700 dark:text-gray-300 text-center select-none align-middle whitespace-nowrap">
                    <div class="flex items-center justify-center font-bold text-gray-900 dark:text-white">
                        ${grabHandle}
                        ${escapeHtml(e.startNumber ?? '')}
                    </div>
                </td>
                <td class="px-2 py-2 lg:px-3 lg:py-2 text-[11px] lg:text-sm min-w-0 align-middle">
                  <div class="font-medium text-gray-900 dark:text-white whitespace-nowrap truncate max-w-[140px] md:max-w-none" title="${escapeHtml(e.driverName || '')}">${escapeHtml(e.driverName || '')}</div>
                  <div class="text-[10px] lg:text-xs text-gray-600 dark:text-gray-400 italic truncate max-w-[140px] lg:max-w-[200px] xl:max-w-none" title="${escapeHtml(horseLabel)}">${escapeHtml(horseLabel)}</div>
                </td>
                <td class="px-2 py-2 lg:px-3 lg:py-2 text-[11px] lg:text-sm text-gray-700 dark:text-gray-300 align-middle">
                    <div class="truncate max-w-[80px] md:max-w-[120px] xl:max-w-none" title="${escapeHtml(e._mergedLabel || e.className || '')}">${escapeHtml(e._mergedLabel || e.className || '')}</div>
                </td>
                <td class="px-2 py-2 lg:px-3 lg:py-2 text-[11px] lg:text-sm text-gray-700 dark:text-gray-300 align-middle">
                    <div class="flex items-center gap-1.5 whitespace-nowrap" title="${escapeHtml(e.clubName || '')}">
                        ${getFlagHtml(e)}
                        ${getClubLogoHtml(e)}
                        <span class="hidden md:inline-block truncate max-w-[100px] lg:max-w-[150px] xl:max-w-none">${escapeHtml(e.clubName || '')}</span>
                    </div>
                </td>
                <td class="px-2 py-2 lg:px-3 lg:py-2 align-middle text-[11px] lg:text-sm whitespace-nowrap">${getVisibleTime('dressage', st.dressage)}</td>
                <td class="px-2 py-2 lg:px-3 lg:py-2 align-middle text-[11px] lg:text-sm whitespace-nowrap">${getVisibleTime('marathon', st.marathon)}</td>
                <td class="px-2 py-2 lg:px-3 lg:py-2 align-middle text-[11px] lg:text-sm whitespace-nowrap">${getVisibleTime('precision', st.precision)}</td>
                ${isEditable ? `
                <td class="px-2 py-2 lg:px-3 lg:py-2 text-[11px] lg:text-sm align-middle whitespace-nowrap">
                    <div class="flex flex-col items-center gap-1">
                        ${renderActions('dressage', e, index, totalRows)}
                        ${renderActions('marathon', e, index, totalRows)}
                        ${renderActions('precision', e, index, totalRows)}
                    </div>
                </td>` : ''}
            </tr>`;
}

export function renderStarttiderMobileCard({
    equipage,
    startTimes = {},
    index = 0,
    totalRows = 0,
    isEditable = false,
    isEliminated = false,
    classHeaderHtml = '',
    getHorseLabel = () => '—',
    renderStatus = () => '',
    renderActions = () => '',
    labels = {},
    unpublishedHtml = '<span class="text-gray-400 italic text-[11px]">Ej publicerad</span>'
} = {}) {
    const e = equipage || {};
    const st = startTimes[String(e.startNumber)] || {};
    const isPub = startTimes.published || {};
    const cardClass = isEliminated ? 'bg-red-50 dark:bg-red-900/20' : 'bg-white dark:bg-gray-800';
    const classLabel = e._mergedLabel || e.className || '—';
    const disciplineLabels = {
        dressage: labels.dressage || 'Dressyr:',
        marathon: labels.marathon || 'Maraton:',
        precision: labels.precision || 'Precision:'
    };

    const timeRow = (discipline, value) => {
        if (!isEditable && !isPub[discipline]) return unpublishedHtml;
        if (isEditable) {
            return `<input id="${escapeHtml(`${discipline}-${e.startNumber}`)}" type="datetime-local" class="flex-1 w-full px-1 py-0.5 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white text-[11px]" value="${escapeHtml(value || '')}">`;
        }
        return `<span class="font-bold dark:text-white text-[12px]">${formatDateTime(parseDateTime(value))}</span>`;
    };

    const disciplineRow = (discipline) => `
                    <div class="flex justify-between items-center gap-1 pt-1 border-t dark:border-gray-700/50">
                        <span class="text-gray-500 dark:text-gray-400 w-14">${disciplineLabels[discipline]}</span>
                        <div class="flex-1 text-right">${timeRow(discipline, st[discipline])}</div>
                        <div class="flex items-center justify-end min-w-[55px]">${renderStatus(discipline, e.startNumber)}</div>
                    </div>`;

    return `
            ${classHeaderHtml}
            <div class="mb-1.5 rounded border border-gray-200 dark:border-gray-700 shadow-sm ${cardClass} overflow-hidden">
                <div class="px-2 py-1.5 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                    <div class="font-bold text-[13px] dark:text-white leading-tight">#${escapeHtml(e.startNumber)} ${escapeHtml(e.driverName || '')}</div>
                    <div class="text-[11px] text-gray-500 dark:text-gray-400 italic leading-tight">${escapeHtml(getHorseLabel(e))}</div>
                </div>
                <div class="px-2 py-1 space-y-0.5 text-[12px]">
                    <div class="flex justify-between items-center"><span class="text-gray-500 dark:text-gray-400">${escapeHtml(labels.class || 'Klass:')}</span><span class="font-medium dark:text-gray-200 text-right">${escapeHtml(classLabel)}</span></div>
                    ${disciplineRow('dressage')}
                    ${disciplineRow('marathon')}
                    ${disciplineRow('precision')}
                </div>
                ${isEditable ? `
                <div class="px-2 py-1.5 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80 space-y-1">
                    <div class="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">${labels.actions || 'Åtgärder'}</div>
                    ${renderActions('dressage', e, index, totalRows)}
                    ${renderActions('marathon', e, index, totalRows)}
                    ${renderActions('precision', e, index, totalRows)}
                </div>
                ` : ''}
            </div>
        `;
}

export function renderStarttiderDesktopHeader(headers = [], sortConfig = {}) {
    return `<thead class="bg-gray-50 dark:bg-gray-700 text-xs"><tr>${headers.map(header => {
        const isSortable = !!header.key;
        const cursor = isSortable ? 'cursor-pointer' : '';
        const isSorted = sortConfig.key === header.key;
        const arrow = isSorted ? (sortConfig.direction === 'asc' ? '▲' : '▼') : '';
        return `<th data-key="${escapeHtml(header.key)}" class="${isSortable ? 'sortable-header' : ''} px-2 py-2 lg:px-3 lg:py-2 text-left text-[11px] lg:text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider select-none whitespace-nowrap ${cursor}">${escapeHtml(header.label)} ${arrow}</th>`;
    }).join('')}</tr></thead>`;
}

export function renderStarttiderDesktopBody(rows = [], {
    viewMode = 'startorder',
    colspan = 1,
    renderRow = () => '',
    getClassLabel = row => row?._mergedLabel || row?.className || 'Okänd'
} = {}) {
    if (viewMode !== 'byclass') {
        return rows.map((row, index) => renderRow(row, index, rows.length)).join('');
    }

    const grouped = rows.reduce((acc, row) => {
        const label = getClassLabel(row);
        (acc[label] = acc[label] || []).push(row);
        return acc;
    }, {});

    return Object.keys(grouped)
        .sort((a, b) => a.localeCompare(b, 'sv'))
        .map(className => {
            const header = `<tr><td colspan="${colspan}" class="px-3 py-2 bg-gray-100 dark:bg-gray-700 font-bold text-gray-800 dark:text-gray-200 sticky top-0 z-10">${escapeHtml(className)}</td></tr>`;
            return header + grouped[className].map((row, index) => renderRow(row, index, rows.length)).join('');
        })
        .join('');
}

export function assignBulkStartTimes(startTimes = {}, rows = [], {
    discipline,
    firstDateTime,
    intervalMin = 7,
    onlyEmpty = false
} = {}) {
    if (!discipline || !firstDateTime || isNaN(firstDateTime.getTime())) {
        return { startTimes, assignedCount: 0 };
    }

    let currentTimestamp = firstDateTime.getTime();
    let assignedCount = 0;

    rows.forEach(row => {
        const sn = String(row.startNumber);
        const entry = startTimes[sn] ||= {};
        if (onlyEmpty && entry[discipline]) return;

        entry[discipline] = toDateTimeLocalString(new Date(currentTimestamp));
        currentTimestamp += Math.max(1, Number(intervalMin) || 7) * 60 * 1000;
        assignedCount++;
    });

    return { startTimes, assignedCount };
}

export function addPauseAfterStartNumber(startTimes = {}, sortedRows = [], {
    discipline,
    afterStartNumber,
    pauseMinutes
} = {}) {
    const startIndex = sortedRows.findIndex(row => String(row.startNumber) === String(afterStartNumber));
    const minutes = Number(pauseMinutes);
    if (!discipline || startIndex === -1 || startIndex === sortedRows.length - 1 || !Number.isFinite(minutes) || minutes <= 0) {
        return { startTimes, changedCount: 0 };
    }

    let changedCount = 0;
    for (let i = startIndex + 1; i < sortedRows.length; i++) {
        const sn = String(sortedRows[i].startNumber);
        const currentStartTime = parseDateTime(startTimes[sn]?.[discipline]);
        if (!currentStartTime) continue;

        const newTimestamp = currentStartTime.getTime() + (minutes * 60 * 1000);
        startTimes[sn][discipline] = toDateTimeLocalString(new Date(newTimestamp));
        changedCount++;
    }

    return { startTimes, changedCount };
}

export function recalculateStartTimesFrom(startTimes = {}, sortedRows = [], {
    discipline,
    startIndex = 0,
    intervalMin = 7
} = {}) {
    if (!discipline || !Array.isArray(sortedRows) || !sortedRows.length) {
        return { startTimes, changedCount: 0, error: 'missing-input' };
    }

    const intervalMs = Math.max(1, Number(intervalMin) || 7) * 60 * 1000;
    let baseTime;

    if (startIndex > 0) {
        const anchorSn = String(sortedRows[startIndex - 1].startNumber);
        const anchorTime = parseDateTime(startTimes[anchorSn]?.[discipline]);
        if (!anchorTime) return { startTimes, changedCount: 0, error: 'previous-missing' };
        baseTime = anchorTime.getTime() + intervalMs;
    } else {
        const firstSn = String(sortedRows[0].startNumber);
        baseTime = parseDateTime(startTimes[firstSn]?.[discipline])?.getTime();
        if (!baseTime) return { startTimes, changedCount: 0, error: 'first-missing' };
    }

    let changedCount = 0;
    for (let i = startIndex; i < sortedRows.length; i++) {
        const sn = String(sortedRows[i].startNumber);
        const newDate = new Date(baseTime + ((i - startIndex) * intervalMs));

        startTimes[sn] ||= {};
        startTimes[sn][discipline] = toDateTimeLocalString(newDate);
        changedCount++;
    }

    return { startTimes, changedCount, error: null };
}

export function moveStartTimeRow(startTimes = {}, sortedRows = [], {
    discipline,
    startNumber,
    direction,
    intervalMin = 7
} = {}) {
    const currentIndex = sortedRows.findIndex(row => String(row.startNumber) === String(startNumber));
    if (currentIndex === -1) return { startTimes, sortedRows, changedCount: 0, error: 'not-found' };

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= sortedRows.length) {
        return { startTimes, sortedRows, changedCount: 0, error: 'out-of-range' };
    }

    const nextRows = [...sortedRows];
    const topIndex = Math.min(currentIndex, newIndex);
    const snAtTopIndex = String(nextRows[topIndex].startNumber);
    const preservedTime = startTimes[snAtTopIndex]?.[discipline];

    [nextRows[currentIndex], nextRows[newIndex]] = [nextRows[newIndex], nextRows[currentIndex]];

    if (preservedTime) {
        const newSnAtTopIndex = String(nextRows[topIndex].startNumber);
        startTimes[newSnAtTopIndex] ||= {};
        startTimes[newSnAtTopIndex][discipline] = preservedTime;
    }

    const result = recalculateStartTimesFrom(startTimes, nextRows, { discipline, startIndex: topIndex, intervalMin });
    return { ...result, sortedRows: nextRows };
}

export function reorderStartTimeRow(startTimes = {}, sortedRows = [], {
    discipline,
    droppedStartNumber,
    targetStartNumber,
    intervalMin = 7
} = {}) {
    const fromIndex = sortedRows.findIndex(row => String(row.startNumber) === String(droppedStartNumber));
    const toIndex = sortedRows.findIndex(row => String(row.startNumber) === String(targetStartNumber));
    if (fromIndex === -1 || toIndex === -1) return { startTimes, sortedRows, changedCount: 0, error: 'not-found' };

    const nextRows = [...sortedRows];
    const recalcIndex = Math.min(fromIndex, toIndex);
    const snAtRecalcIndex = String(nextRows[recalcIndex].startNumber);
    const preservedTime = startTimes[snAtRecalcIndex]?.[discipline];

    const item = nextRows.splice(fromIndex, 1)[0];
    nextRows.splice(toIndex, 0, item);

    if (preservedTime) {
        const newSnAtRecalcIndex = String(nextRows[recalcIndex].startNumber);
        startTimes[newSnAtRecalcIndex] ||= {};
        startTimes[newSnAtRecalcIndex][discipline] = preservedTime;
    }

    const result = recalculateStartTimesFrom(startTimes, nextRows, { discipline, startIndex: recalcIndex, intervalMin });
    return { ...result, sortedRows: nextRows };
}

function classMatches(row, className) {
    return !className || (row._mergedLabel || row.className) === className;
}

export function buildPrecisionDressageOrderRows(equipages = [], startTimes = {}, {
    className = '',
    includeEliminated = false
} = {}) {
    return equipages
        .filter(row => {
            if (!classMatches(row, className)) return false;

            const time = parseDateTime(startTimes[String(row.startNumber)]?.dressage)?.getTime();
            if (time) return true;
            return !!includeEliminated;
        })
        .sort((a, b) => {
            const timeA = parseDateTime(startTimes[String(a.startNumber)]?.dressage)?.getTime() || -Infinity;
            const timeB = parseDateTime(startTimes[String(b.startNumber)]?.dressage)?.getTime() || -Infinity;
            if (timeA === timeB) return Number(a.startNumber) - Number(b.startNumber);
            return timeA - timeB;
        });
}

export function buildMarathonDressageResultRows(equipages = [], {
    className = '',
    includeEliminated = false,
    getDressageResult = () => null,
    getProtocolCount = () => 0
} = {}) {
    const mappedRows = equipages
        .filter(row => classMatches(row, className))
        .map(row => {
            const result = getDressageResult(row);
            return {
                ...row,
                debugProtoCount: getProtocolCount(row),
                debugResultNull: result == null,
                debugPenaltyVal: result?.penalty,
                dressagePenalty: (result && result.penalty != null && !result.eliminated)
                    ? result.penalty
                    : (includeEliminated ? Infinity : null)
            };
        });

    const rankedRows = mappedRows
        .filter(row => row.dressagePenalty !== null)
        .sort((a, b) => comparePenaltyDescending(a.dressagePenalty, b.dressagePenalty, a.startNumber, b.startNumber));

    return {
        rankedRows,
        diagnostics: {
            totalChecked: mappedRows.length,
            totalProtos: mappedRows.reduce((sum, row) => sum + row.debugProtoCount, 0),
            missingPenalties: mappedRows.filter(row => row.debugPenaltyVal == null).length
        }
    };
}

export function buildPrecisionResultOrderRows(equipages = [], {
    className = '',
    includeEliminated = false,
    getDressageResult = () => null,
    getMarathonResult = () => null,
    getMarathonData = () => ({})
} = {}) {
    return equipages
        .filter(row => classMatches(row, className))
        .map(row => {
            const dRes = getDressageResult(row);
            const dPenalty = (dRes && dRes.penalty != null) ? dRes.penalty : null;
            const mData = getMarathonData(row) || {};
            const mRes = getMarathonResult(row, mData);

            let totalPenalty = null;
            const eliminated = !!dRes?.eliminated || !!mRes?.eliminated || !!mData.eliminated || mData.status === 'Eliminerad';
            const hasValidDressage = dPenalty !== null;
            const hasValidMarathon = mRes && mRes.totalPenalty !== null;

            if (!eliminated && hasValidDressage && hasValidMarathon) {
                totalPenalty = dPenalty + mRes.totalPenalty;
            } else if (includeEliminated) {
                totalPenalty = Infinity;
            }

            return { ...row, totalPenalty };
        })
        .filter(row => row.totalPenalty !== null)
        .sort((a, b) => comparePenaltyDescending(a.totalPenalty, b.totalPenalty, a.startNumber, b.startNumber));
}

function comparePenaltyDescending(pA, pB, startA, startB) {
    if (pA === pB) return Number(startA) - Number(startB);
    if (pA === Infinity) return -1;
    if (pB === Infinity) return 1;
    return pB - pA;
}
