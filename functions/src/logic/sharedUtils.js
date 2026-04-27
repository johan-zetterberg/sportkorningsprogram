// Shared Utility Functions (ESM)
// functions/src/logic/sharedUtils.js

export function round2(num) {
    if (typeof num !== 'number' || !Number.isFinite(num)) return null;
    return Math.round((num + Number.EPSILON) * 100) / 100;
}

export function isNum(val) {
    return typeof val === 'number' && Number.isFinite(val);
}

export function msToLabel(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '—';
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = Math.floor(totalSec % 60);
    const cs = Math.floor((ms % 1000) / 10);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(cs).padStart(2, '0')}`;
}
