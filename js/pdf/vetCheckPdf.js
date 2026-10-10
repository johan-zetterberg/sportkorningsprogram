// js/pdf/vetCheckPdf.js
import { loadPdfLibs, drawStandardHeader, loadStandardHeaderLogos } from './pdfBase.js';
import { buildVetCheckPdfRows } from './vetCheckPdfUtils.js';

/**
 * Generates a complete Veterinary Inspection Protocol PDF.
 * @param {Array} equipages - The list of competition equipages.
 * @param {Object} competition - Competition metadata.
 */
export async function generateVetCheckPdf(equipages = [], competition = {}) {
    await loadPdfLibs();
    const { jsPDF } = window.jspdf;
    if (!jsPDF) {
        alert('Kunde inte ladda PDF-biblioteket.');
        return;
    }

    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', compress: true });
    const mx = 40;
    const srfLogo = await loadStandardHeaderLogos(competition);

    let y = drawStandardHeader(doc, competition, "VETERINÄRBESIKTNING – PROTOKOLL (TR MOM 526)", srfLogo, 30, mx);
    y += 10;

    const headers = [[
        'Startnr',
        'Kusk / Klubb',
        'Klass',
        'Häst',
        'Ankomst',
        'Selning',
        'Vilobox',
        'Slutbes.',
        'Notering / Signatur'
    ]];

    const body = buildVetCheckPdfRows(equipages);

    doc.autoTable({
        startY: y,
        head: headers,
        body: body,
        theme: 'grid',
        styles: { fontSize: 8.5, cellPadding: 4, valign: 'middle' },
        headStyles: { fillColor: [40, 60, 80], textColor: [255, 255, 255], fontStyle: 'bold' },
        columnStyles: {
            0: { cellWidth: 42, halign: 'center', fontStyle: 'bold' },
            1: { minCellWidth: 110 },
            2: { cellWidth: 80 },
            3: { cellWidth: 110 },
            4: { cellWidth: 65, halign: 'center' },
            5: { cellWidth: 60, halign: 'center' },
            6: { cellWidth: 75, halign: 'center' },
            7: { cellWidth: 60, halign: 'center' },
            8: { minCellWidth: 100 }
        },
        margin: { left: mx, right: mx }
    });

    const finalY = doc.lastAutoTable?.finalY || (y + 50);
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text('* Vilobox: Max 64 bpm rekommenderad vilopuls (TR V Mom 526.4). Anmärkningar eller uteslutning meddelas omedelbart till överdomare.', mx, finalY + 16);

    const ts = new Date().toISOString().split('T')[0];
    doc.save(`veterinarbesiktning_${ts}.pdf`);
}
