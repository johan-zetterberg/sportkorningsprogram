/**
 * Shared utility functions for the application.
 */

import { getGlobalState } from '../main.js';

// --- HTML / Text Utils ---

export function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function getInitials(name) {
    if (!name || typeof name !== 'string') return '';
    return name.trim().split(/\s+/).map(part => part[0] || '').join('').toUpperCase();
}

export function stackName(name) {
    if (!name || typeof name !== 'string') return '';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return `<span class="block">${parts[0]}</span>`;
    const first = parts.slice(0, -1).join(' ');
    const last = parts.slice(-1)[0];
    return `<span class="block">${first}</span><span class="block">${last}</span>`;
}

export function sanitizeForFilename(name) {
    if (!name) return 'namnlos'; // Fallback för ekipage som saknar namn
    return name
        .toLowerCase()
        .replace(/\s+/g, '_')     // Byt ut mellanslag mot _
        .replace(/å/g, 'a')       // Ersätt å
        .replace(/ä/g, 'a')       // Ersätt ä
        .replace(/ö/g, 'o')       // Ersätt ö
        .replace(/[^a-z0-9_]/g, ''); // Ta bort alla andra ogiltiga tecken
}

// --- Horse Name Utils ---

export function horseLabel(eq) {
    if (!eq || typeof eq !== 'object') return '—';

    const found = [];

    const take = (val) => {
        if (!val) return;
        if (typeof val === 'string' && val.trim()) found.push(val.trim());
        else if (Array.isArray(val)) {
            for (const item of val) take(item);
        } else if (typeof val === 'object') {
            // plocka typiska fältnamn ur objekt
            for (const k of ['name', 'namn', 'horse', 'horseName', 'häst', 'hästnamn', 'hast', 'hastnamn']) {
                if (typeof val[k] === 'string' && val[k].trim()) found.push(val[k].trim());
            }
        }
    };

    const keys = Object.keys(eq);

    // 1) generellt: alla nycklar som antyder häst/ponny
    // 1) generellt: alla nycklar som antyder häst/ponny
    for (const k of keys) {
        const lk = k.toLowerCase();
        if (lk.includes('horse') || lk.includes('häst') || lk.includes('hast') || lk.includes('ponny')) {
            const val = eq[k];
            // SKIPPRA: 'P', 'H', 'Ponny', 'Häst' om det verkar vara en kategori-flagga snarare än namn
            if (typeof val === 'string') {
                const v = val.trim();
                // Om värdet är extremt kort (1 bokstav) eller matchar specifika kategoriord, hoppa över
                if (v.length <= 1 || /^(ponny|häst|hast|p|h)$/i.test(v)) continue;
                take(val); // only take legitimate names
            } else {
                take(val);
            }
        }
    }

    // 2) vanliga alias/nummerfält
    const aliases = [
        'horse', 'horseName', 'horseNames', 'horses',
        'horse1', 'horse1Name', 'horse2', 'horse2Name', 'horse3', 'horse3Name',
        'ponny', 'ponnyName', 'hast', 'hastName', 'häst', 'hästnamn'
    ];
    for (const a of aliases) take(eq[a]);

    // 3) regex-fångst (t.ex. horseName1, horse_name, etc.)
    for (const k of keys) {
        if (/^horse.*name\d*$/i.test(k) || /^häst.*namn\d*$/i.test(k) || /^hast.*namn\d*$/i.test(k)) take(eq[k]);
    }

    // rensa & join
    const unique = [...new Set(
        found
            .join(' / ')
            .split(/[\/,&+]|(?:\s*&\s*)/)
            .map(s => s.trim())
            .filter(Boolean)
    )];

    return unique.length ? unique.slice(0, 3).join(' & ') : '—';
}

export function horseLabelStacked(eq) {
    const lbl = horseLabel(eq);
    if (lbl === '—') return '—';
    const parts = lbl.split(/\s*&\s*/);
    return parts.map(n => `<span class="block">${n}</span>`).join('');
}

// --- Environment / Device Utils ---

export const MOBILE_BP = 600;

export const isMobile = () => {
    // Matches logic in other files: !isDesktop
    // isDesktop = (wide screen) OR (landscape AND no hover)
    return !window.matchMedia(`(min-width: ${MOBILE_BP}px), (orientation: landscape) and (hover: none)`).matches;
};

// --- Logic / State Utils ---

export function isPrivileged() {
    const role = (getGlobalState('currentUser')?.role) || 'publik';
    return role === 'domare' || role === 'admin' || role === 'sekretariat';
}

export function resolveCurrentCompId() {
    return (getGlobalState('currentCompetition')?.id)
        || window.currentCompetitionId
        || (window.currentCompetition && window.currentCompetition.id)
        || null;
}

// --- Debounce ---

export function debounce(func, wait) {
    let timeout;
    return function (...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}

// --- Formatting ---

export function isNum(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

export function round2(x) {
    return Math.round((x + Number.EPSILON) * 100) / 100;
}

export function fmt2(x) {
    return isNum(x) ? x.toFixed(2) : '—';
}

export function secondsToMMSS(s) {
    if (s == null || isNaN(s)) return null;
    const m = Math.floor(s / 60);
    const ss = Math.round(s % 60).toString().padStart(2, '0');
    return `${m}:${ss}`;
}

export function msToLabel(ms, withCs = true) {
    ms = Math.max(0, Math.floor(ms || 0));
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const cs = Math.floor((ms % 1000) / 10);
    return withCs
        ? `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(cs).padStart(2, '0')}`
        : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// --- CSV Export Utils ---

/**
 * Escapes a cell value for CSV (handles quotes and delimiters).
 */
/**
 * Escapes a cell value for CSV (handles quotes and delimiters).
 * Optionally replaces decimal dots with commas for Swedish locale.
 */
export function csvCell(val, delim = ';', localizeNumbers = true) {
    if (val == null) return '';
    let s = String(val);

    // If it looks like a number with a dot decimal, replace with comma
    if (localizeNumbers && /^[-]?\d+\.\d+$/.test(s)) {
        s = s.replace('.', ',');
    }

    s = s.replace(/"/g, '""');
    if (s.includes(delim) || s.includes('"') || s.includes('\n')) {
        return `"${s}"`;
    }
    return s;
}

/**
 * Generates and triggers a CSV file download.
 * @param {string} filename - The name of the file to download.
 * @param {string[]} headers - The column headers.
 * @param {any[][]} rows - The data rows (array of arrays).
 * @param {string} delim - The delimiter (default ';').
 * @param {boolean} localizeNumbers - Whether to replace decimal dots with commas (default true).
 */
export function downloadCsv(filename, headers, rows, delim = ';', localizeNumbers = true) {
    const lines = [headers.join(delim)];
    for (const row of rows) {
        lines.push(row.map(v => csvCell(v, delim, localizeNumbers)).join(delim));
    }
    const csv = '\uFEFF' + lines.join('\n'); // BOM for Swedish chars (UTF-8)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 0);
}
export function downloadJson(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
// --- Scoring Utils ---

/**
 * Calculates the total competition penalty.
 * @param {number|null} dressagePen - Dressage penalty.
 * @param {number|null} marathonPen - Marathon penalty.
 * @param {number|null} precisionPen - Precision penalty.
 * @returns {number} The sum, treating nulls/undefined as 0 (or should we return null if all are null? For ranking we usually treat 0 as start).
 */
export function computeTotalPenalty(dressagePen, marathonPen, precisionPen) {
    const d = (typeof dressagePen === 'number' && Number.isFinite(dressagePen)) ? dressagePen : 0;
    const m = (typeof marathonPen === 'number' && Number.isFinite(marathonPen)) ? marathonPen : 0;
    const p = (typeof precisionPen === 'number' && Number.isFinite(precisionPen)) ? precisionPen : 0;
    return d + m + p; // Simple sum
}

/**
 * Calculates the total competition penalty (Dressage + Marathon).
 * @param {number | null} dressagePenalty - The aggregated dressage penalty.
 * @param {Object | null} marathonResult - The marathon result object (containing totalPenalty).
 * @returns {number | null} - Total penalty or null if eliminated / incomplete.
 */
export function calculateTotalCompetitionPenalties(dressagePenalty, marathonResult) {
    let total = 0;
    let hasResults = false;

    // Add Dressage
    if (dressagePenalty !== null && typeof dressagePenalty === 'number') {
        total += dressagePenalty;
        hasResults = true;
    }

    // Add Marathon
    if (marathonResult) {
        if (marathonResult.eliminated) return null; // Eliminated in marathon means eliminated overall?

        if (typeof marathonResult.totalPenalty === 'number') {
            total += marathonResult.totalPenalty;
            hasResults = true;
        }
    }

    return hasResults ? total : null;
}
