import { MAX_RECOMMENDED_PULSE_BPM } from '../pages/shared/vetCheckUtils.js';

export function formatVetInspectionStatus(status, empty = '[   ]') {
    if (!status) return empty;
    const lower = String(status).trim().toLowerCase();
    if (lower === 'besiktigad' || lower === 'godkänd' || lower === 'ok') return 'Godkänd';
    if (lower === 'ombesiktning' || lower === 'ombes') return 'Ombes';
    if (lower === 'struken' || lower === 'ej godkänd') return 'Ej godkänd';
    if (lower === 'incheckad') return 'Incheckad';
    if (lower === 'anmäld' || lower === 'väntar') return 'Väntar';
    return status;
}

export function buildVetCheckPdfRows(equipages = []) {
    const rows = [];
    const sorted = [...equipages].sort((a, b) => Number(a.startNumber || 0) - Number(b.startNumber || 0));

    sorted.forEach(eq => {
        const horses = Array.isArray(eq.horses) && eq.horses.length > 0
            ? eq.horses
            : [{ name: eq.horseName || eq.horse || '—', type: eq.category || '' }];

        horses.forEach((h, hIdx) => {
            const getPhaseData = (key) => h.inspections?.[key] || h.phases?.[key] || {};
            const initialStatus = formatVetInspectionStatus(h.vetStatus || eq.status);
            const harnessStatus = formatVetInspectionStatus(getPhaseData('harness').status);

            const restArea = getPhaseData('restArea');
            let restStatus = '[   ]';
            if (restArea.pulseBpm) {
                const bpm = Number(restArea.pulseBpm);
                const warn = Number.isFinite(bpm) && bpm > MAX_RECOMMENDED_PULSE_BPM ? ' (!)' : '';
                restStatus = `${bpm} bpm${warn}`;
                if (restArea.status && restArea.status !== 'besiktigad') {
                    restStatus += ` (${formatVetInspectionStatus(restArea.status)})`;
                }
            } else if (restArea.status) {
                restStatus = formatVetInspectionStatus(restArea.status);
            }

            const finalStatus = formatVetInspectionStatus(getPhaseData('final').status);
            const notes = [h.vetNote, eq.vetNote, restArea.notes].filter(Boolean).join('; ');

            rows.push([
                hIdx === 0 ? String(eq.startNumber || '—') : '',
                hIdx === 0 ? `${eq.driverName || '—'}\n${eq.clubName || ''}` : '',
                hIdx === 0 ? (eq._mergedLabel || eq.className || '—') : '',
                `${h.name || '—'}${h.type ? ` (${h.type})` : ''}`,
                initialStatus,
                harnessStatus,
                restStatus,
                finalStatus,
                notes || ''
            ]);
        });
    });

    return rows;
}
