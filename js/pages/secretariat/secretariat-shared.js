function toComparableStartNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : String(value ?? '');
}

let stickyCloneStyleInjected = false;

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderToolbar(options = {}) {
  const {
    searchValue = '',
    statusValue = 'all',
    classValue = 'all',
    classOptions = [],
  } = options;
  const mobileExpanded = statusValue !== 'all' || classValue !== 'all';

  const classOptionsHtml = [
    '<option value="all">Alla klasser</option>',
    ...classOptions.map(className => `<option value="${escapeHtml(className)}"${classValue === className ? ' selected' : ''}>${escapeHtml(className)}</option>`)
  ].join('');

  return `
    <section class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 mb-4">
      <div class="grid gap-3 md:grid-cols-3">
        <label class="block">
          <span class="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Sök</span>
          <input
            id="secretariatSearch"
            type="text"
            value="${escapeHtml(searchValue)}"
            placeholder="Startnummer eller namn"
            class="w-full rounded-md border border-gray-300 dark:border-gray-600 p-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          >
        </label>
        <div class="flex items-end md:hidden">
          <button
            id="secretariatFilterToggle"
            type="button"
            aria-expanded="${mobileExpanded ? 'true' : 'false'}"
            class="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700"
          >
            Filter
          </button>
        </div>
        <div id="secretariatFilterPanel" class="${mobileExpanded ? '' : 'hidden '}grid gap-3 md:contents">
        <label class="block">
          <span class="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Status</span>
          <select
            id="secretariatStatusFilter"
            class="w-full rounded-md border border-gray-300 dark:border-gray-600 p-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          >
            <option value="all"${statusValue === 'all' ? ' selected' : ''}>Alla</option>
            <option value="not-started"${statusValue === 'not-started' ? ' selected' : ''}>Ej startad</option>
            <option value="running"${statusValue === 'running' ? ' selected' : ''}>Pågår</option>
            <option value="done"${statusValue === 'done' ? ' selected' : ''}>Klar</option>
            <option value="finalized"${statusValue === 'finalized' ? ' selected' : ''}>Finaliserad</option>
          </select>
        </label>
        <label class="block">
          <span class="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Klass</span>
          <select
            id="secretariatClassFilter"
            class="w-full rounded-md border border-gray-300 dark:border-gray-600 p-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          >
            ${classOptionsHtml}
          </select>
        </label>
        </div>
      </div>
      <div class="mt-2 md:hidden text-xs text-gray-500 dark:text-gray-400">
        Aktiva filter: <span id="secretariatFilterSummary"></span>
      </div>
    </section>
  `;
}

export function initializeToolbarInteractions(rootEl) {
  if (!rootEl) return;

  const toggleBtn = rootEl.querySelector('#secretariatFilterToggle');
  const panel = rootEl.querySelector('#secretariatFilterPanel');
  const statusSelect = rootEl.querySelector('#secretariatStatusFilter');
  const classSelect = rootEl.querySelector('#secretariatClassFilter');
  const summaryEl = rootEl.querySelector('#secretariatFilterSummary');
  if (!panel || !summaryEl) return;

  const updateSummary = () => {
    const parts = [];
    if (statusSelect && statusSelect.value !== 'all') {
      parts.push(statusSelect.options[statusSelect.selectedIndex]?.text || 'Status');
    }
    if (classSelect && classSelect.value !== 'all') {
      parts.push(classSelect.options[classSelect.selectedIndex]?.text || 'Klass');
    }
    summaryEl.textContent = parts.length > 0 ? parts.join(' • ') : 'Alla';
  };

  const updateExpandedState = () => {
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-expanded', panel.classList.contains('hidden') ? 'false' : 'true');
    }
  };

  toggleBtn?.addEventListener('click', () => {
    panel.classList.toggle('hidden');
    updateExpandedState();
  });

  statusSelect?.addEventListener('change', updateSummary);
  classSelect?.addEventListener('change', updateSummary);

  updateSummary();
  updateExpandedState();
}

export function renderStatusBadge(status, finalized) {
  if (finalized) {
    return '<span class="inline-flex items-center px-2 py-1 rounded text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">Finaliserad</span>';
  }

  if (status === 'running') {
    return '<span class="inline-flex items-center px-2 py-1 rounded text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">Pågår</span>';
  }

  if (status === 'done') {
    return '<span class="inline-flex items-center px-2 py-1 rounded text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">Klar</span>';
  }

  return '<span class="inline-flex items-center px-2 py-1 rounded text-xs font-semibold bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200">Ej startad</span>';
}

export function filterRows(rows, filters = {}) {
  const search = String(filters.search || '').trim().toLowerCase();
  const status = filters.status || 'all';
  const className = filters.className || 'all';

  return rows.filter(row => {
    const matchesSearch = !search
      || String(row.startNumber).toLowerCase().includes(search)
      || String(row.driverName || '').toLowerCase().includes(search);

    const matchesClass = className === 'all' || String(row.className || '') === className;

    let matchesStatus = true;
    if (status === 'finalized') matchesStatus = row.finalized === true;
    else if (status === 'done') matchesStatus = row.status === 'done' && row.finalized !== true;
    else if (status === 'running') matchesStatus = row.status === 'running';
    else if (status === 'not-started') matchesStatus = row.status === 'not-started';

    return matchesSearch && matchesClass && matchesStatus;
  });
}

export function sortRows(rows, sortKey = 'startNumber') {
  const copy = [...rows];
  copy.sort((a, b) => {
    if (sortKey === 'className') {
      const classCmp = String(a.className || '').localeCompare(String(b.className || ''), 'sv');
      if (classCmp !== 0) return classCmp;
    }
    if (sortKey === 'driverName') {
      const nameCmp = String(a.driverName || '').localeCompare(String(b.driverName || ''), 'sv');
      if (nameCmp !== 0) return nameCmp;
    }

    const av = toComparableStartNumber(a.startNumber);
    const bv = toComparableStartNumber(b.startNumber);
    if (typeof av === 'number' && typeof bv === 'number') return av - bv;
    return String(av).localeCompare(String(bv), 'sv');
  });
  return copy;
}

export function formatEditableTime(ms) {
  if (!Number.isFinite(Number(ms)) || Number(ms) <= 0) return '';
  const totalMs = Math.max(0, Math.round(Number(ms)));
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const centiseconds = Math.floor((totalMs % 1000) / 10);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(centiseconds).padStart(2, '0')}`;
}

export function parseEditableTime(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;

  if (/^\d+([.,]\d+)?$/.test(text)) {
    const seconds = Number(text.replace(',', '.'));
    return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
  }

  const match = text.match(/^(\d+):(\d{1,2})(?:[,:.](\d{1,2}))?$/);
  if (!match) return null;

  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const centiseconds = match[3] ? Number(match[3].padEnd(2, '0').slice(0, 2)) : 0;
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds >= 60) return null;
  return (minutes * 60000) + (seconds * 1000) + (centiseconds * 10);
}

export function markRowDirty(rowEl, dirty = true) {
  if (!rowEl) return;
  rowEl.dataset.dirty = dirty ? '1' : '0';
  rowEl.classList.toggle('ring-2', !!dirty);
  rowEl.classList.toggle('ring-amber-300', !!dirty);
  rowEl.classList.toggle('dark:ring-amber-700', !!dirty);
}

export function clearRowDirty(rowEl) {
  markRowDirty(rowEl, false);
}

export function derivePrecisionStatus(row = {}) {
  if (row.finalized) return 'finalized';
  if (row.running) return 'running';
  const hasPerformance = row.eliminated
    || Number(row.timeMs || 0) > 0
    || Number(row.obstaclePenalty || 0) > 0
    || Number(row.timePenalty || 0) > 0
    || Number(row.extraPenalty || 0) !== 0;
  return hasPerformance ? 'done' : 'not-started';
}

export function deriveMarathonStatus(row = {}) {
  if (row.finalized) return 'finalized';
  if (row.running || (row.start_A && !row.finish_B)) return 'running';

  const hasPerformance = Number(row.duration_A || 0) > 0
    || Number(row.duration_B || 0) > 0
    || Number(row.obstacleCount || 0) > 0
    || row.hasTimingData === true;

  return hasPerformance ? 'done' : 'not-started';
}

export function deriveDressageStatus(row = {}) {
  if (row.finalized) return 'finalized';
  if (row.state === 'ongoing') return 'running';
  if (row.state === 'finished' || Number(row.protocolCount || 0) > 0 || Number(row.errorPoints || 0) > 0) return 'done';
  return 'not-started';
}

function ensureStickyCloneStyles() {
  if (stickyCloneStyleInjected) return;
  stickyCloneStyleInjected = true;

  const style = document.createElement('style');
  style.id = 'secretariat-sticky-clone-styles';
  style.textContent = `
    .secretariat-sticky-clone {
      position: fixed;
      top: 0;
      left: 0;
      z-index: 45;
      display: none;
      pointer-events: none;
      overflow: hidden;
      background: transparent;
    }
    .secretariat-sticky-clone table {
      margin: 0;
    }
    .secretariat-sticky-clone th {
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);
}

function getStickyTopOffset() {
  const nav = document.querySelector('nav.sticky');
  const offlineBanner = document.getElementById('offline-banner');
  const navStyle = nav ? getComputedStyle(nav) : null;
  const bannerStyle = offlineBanner ? getComputedStyle(offlineBanner) : null;
  const navHeight = nav && navStyle && (navStyle.position === 'sticky' || navStyle.position === 'fixed')
    ? nav.getBoundingClientRect().height
    : 0;
  const bannerHeight = offlineBanner && bannerStyle && bannerStyle.display !== 'none'
    && (bannerStyle.position === 'sticky' || bannerStyle.position === 'fixed')
    ? offlineBanner.getBoundingClientRect().height
    : 0;
  return Math.round(navHeight + bannerHeight);
}

export function setupStickyTableHeaders(rootEl) {
  if (!rootEl) return () => {};
  ensureStickyCloneStyles();

  const tables = Array.from(rootEl.querySelectorAll('table.secretariat-page-table'));
  if (tables.length === 0) return () => {};

  const clones = [];

  const syncClone = ({ table, cloneEl }) => {
    const thead = table.tHead;
    if (!thead) return;

    const tableRect = table.getBoundingClientRect();
    const headRect = thead.getBoundingClientRect();
    const topOffset = getStickyTopOffset();
    const shouldShow = tableRect.top < topOffset && tableRect.bottom - headRect.height > topOffset;

    if (!shouldShow || tableRect.width <= 0) {
      cloneEl.style.display = 'none';
      return;
    }

    cloneEl.style.display = 'block';
    cloneEl.style.top = `${topOffset}px`;
    cloneEl.style.left = `${Math.round(tableRect.left)}px`;
    cloneEl.style.width = `${Math.round(tableRect.width)}px`;

    const cloneTable = cloneEl.querySelector('table');
    const sourceHeaderHtml = thead.outerHTML;
    if (cloneTable.dataset.headerHtml !== sourceHeaderHtml) {
      cloneTable.innerHTML = sourceHeaderHtml;
      cloneTable.dataset.headerHtml = sourceHeaderHtml;
    }

    cloneTable.style.width = `${Math.round(tableRect.width)}px`;

    const sourceThs = Array.from(thead.querySelectorAll('th'));
    const cloneThs = Array.from(cloneTable.querySelectorAll('th'));
    sourceThs.forEach((th, index) => {
      const width = th.getBoundingClientRect().width;
      if (cloneThs[index]) {
        cloneThs[index].style.width = `${Math.round(width)}px`;
        cloneThs[index].style.minWidth = `${Math.round(width)}px`;
        cloneThs[index].style.maxWidth = `${Math.round(width)}px`;
      }
    });
  };

  tables.forEach(table => {
    const cloneEl = document.createElement('div');
    cloneEl.className = 'secretariat-sticky-clone';

    const cloneTable = document.createElement('table');
    cloneTable.className = table.className;
    cloneEl.appendChild(cloneTable);
    document.body.appendChild(cloneEl);

    clones.push({ table, cloneEl });
  });

  const updateAll = () => {
    clones.forEach(syncClone);
  };

  window.addEventListener('scroll', updateAll, { passive: true });
  window.addEventListener('resize', updateAll);
  window.addEventListener('orientationchange', updateAll);
  updateAll();

  return () => {
    window.removeEventListener('scroll', updateAll);
    window.removeEventListener('resize', updateAll);
    window.removeEventListener('orientationchange', updateAll);
    clones.forEach(({ cloneEl }) => {
      try { cloneEl.remove(); } catch (_) {}
    });
  };
}
