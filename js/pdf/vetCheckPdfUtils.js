import { MAX_RECOMMENDED_PULSE_BPM, VET_PHASES, applyVetResultsToHorses } from '../pages/shared/vetCheckUtils.js';

/**
 * The equipages with the vet's private data for the PDF (admins and the vet):
 * clinical findings onto the horses, the notes of all phases as vetNote.
 * Maps by start number, as from getVetInspections / getVetNotes.
 */
export function mergeVetPrivateData(equipages = [], clinicalByStartNumber = new Map(), notesByStartNumber = new Map()) {
    return (equipages || []).map(eq => {
        const sn = String(eq?.startNumber ?? eq?.id);
        const notes = notesByStartNumber?.get?.(sn) || {};
        const vetNote = Object.keys(VET_PHASES)
            .map(phase => notes[phase] ? `${VET_PHASES[phase].shortLabel}: ${notes[phase]}` : '')
            .filter(Boolean)
            .join('; ');
        return {
            ...eq,
            horses: applyVetResultsToHorses(eq, clinicalByStartNumber?.get?.(sn) || {}),
            ...(vetNote ? { vetNote } : {})
        };
    });
}

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
        // The public per-phase results put on the horses (the vet page passes
        // horses that already carry its private findings too)
        const horses = Array.isArray(eq.horses) && eq.horses.length > 0
            ? applyVetResultsToHorses(eq)
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
