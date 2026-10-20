// The incident / protest / ground jury decision log as a PDF for the TD report
import { loadPdfLibs, drawStandardHeader, loadStandardHeaderLogos } from './pdfBase.js';
import { resolvePdfLanguage } from './pdfCompetitionUtils.js';
import { formatPrintedAt } from './resultStatusUtils.js';
import { INCIDENT_CSV_COLUMNS, incidentDisplayRow } from '../services/incidentUtils.js';
import { t } from '../utils/i18n.js';

export async function generateIncidentLogPdf(incidents = [], competition = {}) {
    await loadPdfLibs();
    const jsPDF = typeof window !== 'undefined' ? window.jspdf?.jsPDF : null;
    if (!jsPDF) throw new Error('PDF-biblioteket kunde inte laddas.');
    const { isInt, isEn } = await resolvePdfLanguage(competition);
    const lang = isEn ? 'en' : 'sv';

    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', compress: true });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const srfLogo = await loadStandardHeaderLogos(competition);
    let y = drawStandardHeader(doc, competition, t('incident_pdf_title', isInt), srfLogo, 30, 40);

    const rows = [...incidents].sort((a, b) => (Number(a?.number) || 0) - (Number(b?.number) || 0));
    doc.autoTable({
        startY: y,
        head: [INCIDENT_CSV_COLUMNS.map(([, label]) => label[lang])],
        body: rows.map((item) => {
            const row = incidentDisplayRow(item, lang);
            return INCIDENT_CSV_COLUMNS.map(([key]) => String(row[key] ?? ''));
        }),
        theme: 'grid',
        styles: { fontSize: 7.5, cellPadding: 3, valign: 'top' },
        headStyles: { fillColor: [220, 220, 220], textColor: 20 },
        columnStyles: {
            0: { cellWidth: 26, halign: 'center' },
            1: { cellWidth: 70 },
            2: { cellWidth: 62 },
            3: { cellWidth: 38 },
            4: { cellWidth: 50 },
            5: { cellWidth: 55 },
            6: { cellWidth: 'auto' },
            7: { cellWidth: 170 },
            8: { cellWidth: 70 },
            9: { cellWidth: 48 }
        },
        margin: { left: 40, right: 40, bottom: 36 }
    });

    const pages = doc.internal.getNumberOfPages();
    const printed = `${t('pdf_status_printed_at', isInt)}: ${formatPrintedAt(new Date())}`;
    for (let page = 1; page <= pages; page++) {
        doc.setPage(page);
        doc.setFontSize(7);
        doc.setTextColor(110, 110, 110);
        doc.text(`${printed} • ${t('pdf_page', isInt)} ${page}/${pages}`, pageWidth - 40, pageHeight - 18, { align: 'right' });
    }
    doc.setTextColor(0, 0, 0);
    doc.save(`handelselogg_${new Date().toISOString().split('T')[0]}.pdf`);
}
