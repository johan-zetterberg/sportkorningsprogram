import { getClubLogoUrl } from '../services/logosService.js';
import { normalizeCountryCode, fetchFlagDataUrl } from '../services/flagsService.js';
import { t } from '../utils/i18n.js';
import { loadPdfLibs, loadImg, drawStandardHeader, loadStandardHeaderLogos } from './pdfBase.js';
import { formatPdfPenalty } from './resultPdfFormatUtils.js';

/**
 * Generates a professional PDF report of TEAM results.
 * @param {Array} teams - The processed team objects.
 * @param {Object} competition - Competition metadata.
 */
export async function generateTeamResultsPdf(teams, competition) {
    await loadPdfLibs();
    const { jsPDF } = window.jspdf;
    if (!jsPDF) { alert('Kunde inte ladda PDF-biblioteket.'); return; }

    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const mx = 40;
    // 1. ASSET LOADING (Logos & Flags)
    const srfLogo = await loadStandardHeaderLogos(competition);

    // 2. HEADER
    let y = drawStandardHeader(doc, competition, "LAGTÄVLING - TOTALRESULTAT", srfLogo, 30, mx);
    y += 5;

    // 3. TABLE GENERATION
    const headers = [[
        "Plac",
        "Lag / Ekipage",
        "Dressyr",
        "Maraton",
        "Precision",
        "Totalt"
    ]];

    const body = [];

    teams.forEach(team => {
        const rank = team.isEliminated ? 'ELIM' : (team.rank || '-');

        // Main Team Row
        body.push([
            { content: String(rank), styles: { fontStyle: 'bold', halign: 'center', fontSize: 10 } },
            { content: team.teamName, styles: { fontStyle: 'bold', fontSize: 10 } },
            { content: formatPdfPenalty(team.dressage, { eliminated: team.isEliminated, empty: '-' }), styles: { fontStyle: 'bold', halign: 'center' } },
            { content: formatPdfPenalty(team.marathon, { eliminated: team.isEliminated, empty: '-' }), styles: { fontStyle: 'bold', halign: 'center' } },
            { content: formatPdfPenalty(team.precision, { eliminated: team.isEliminated, empty: '-' }), styles: { fontStyle: 'bold', halign: 'center' } },
            { content: formatPdfPenalty(team.total, { eliminated: team.isEliminated, empty: '-' }), styles: { fontStyle: 'bold', halign: 'center', fillColor: [240, 240, 240] } }
        ]);

        // Members (indented)
        if (team.members && team.members.length > 0) {
            team.members.forEach(m => {
                const status = m.eliminated ? '(ELIM)' : (m.isCounting ? '' : '(Str)');
                const name = `#${m.startNumber} ${m.name} ${status}`;
                const color = m.isCounting ? [30, 30, 30] : [150, 150, 150]; // Gray if scratching

                body.push([
                    '', // No rank for members here
                    { content: `  ${name}`, styles: { textColor: color, fontSize: 8 } },
                    { content: formatPdfPenalty(m.dressage, { eliminated: m.eliminated, empty: '-' }), styles: { textColor: color, fontSize: 8, halign: 'center' } },
                    { content: formatPdfPenalty(m.marathon, { eliminated: m.eliminated, empty: '-' }), styles: { textColor: color, fontSize: 8, halign: 'center' } },
                    { content: formatPdfPenalty(m.precision, { eliminated: m.eliminated, empty: '-' }), styles: { textColor: color, fontSize: 8, halign: 'center' } },
                    { content: formatPdfPenalty(m.penalty, { eliminated: m.eliminated, empty: '-' }), styles: { textColor: color, fontSize: 8, halign: 'center' } }
                ]);
            });
        }
    });

    doc.autoTable({
        startY: y,
        head: headers,
        body: body,
        theme: 'grid',
        styles: { fontSize: 9, cellPadding: 3, valign: 'middle' },
        headStyles: { fillColor: [40, 60, 80], textColor: [255, 255, 255] },
        columnStyles: {
            0: { cellWidth: 40 },
            1: { minCellWidth: 150 },
            2: { cellWidth: 60 },
            3: { cellWidth: 60 },
            4: { cellWidth: 60 },
            5: { cellWidth: 60 }
        },
        margin: { left: mx, right: mx }
    });

    const ts = new Date().toISOString().split('T')[0];
    doc.save(`lagresultat_${ts}.pdf`);
}
