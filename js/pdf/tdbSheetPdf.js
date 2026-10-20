// js/pdf/tdbSheetPdf.js
// TDB entry sheet: per result list the rows to type into TDB by hand.
import { t } from '../utils/i18n.js';
import { loadPdfLibs, drawStandardHeader, drawResultStatusFooter, loadStandardHeaderLogos } from './pdfBase.js';
import { resolveResultListStatus } from './pdfResultStatus.js';
import { requiredForTotalRows } from './resultStatusUtils.js';
import { resolveTotalResultsJsPdf } from './totalResultsPdfUtils.js';
import { resolvePdfLanguage } from './pdfCompetitionUtils.js';
import { deadlineFor } from '../services/tdbSheetUtils.js';

const dashIfEmpty = (v) => (String(v ?? '').trim() ? String(v) : '-');

/**
 * lists: buildTdbSheet() result
 * options: { rows: the result rows (decides the status), resultStatus: 'official'|'provisional' }
 */
export async function generateTdbSheetPdf(lists, competition, options = {}) {
    await loadPdfLibs();
    const jsPDF = resolveTotalResultsJsPdf({ throwOnMissing: options.throwOnMissingPdfLib === true });
    if (!jsPDF) return;

    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', compress: true });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const mx = 40;

    const srfLogo = await loadStandardHeaderLogos(competition);
    const { isInt } = await resolvePdfLanguage(competition);
    const resultStatus = await resolveResultListStatus(competition, {
        required: requiredForTotalRows(options.rows || []),
        override: options.resultStatus || null
    });
    let y = drawStandardHeader(doc, competition, t('tdb_pdf_title', isInt), srfLogo, 30, mx, { resultStatus, isInt });

    // The deadline and the code legend
    doc.setFontSize(8).setFont(undefined, 'normal');
    const deadline = deadlineFor(competition);
    if (deadline) {
        doc.text(t('tdb_deadline', isInt).replace('{date}', deadline), mx, y);
        y += 11;
    }
    const legend = doc.splitTextToSize(t('tdb_code_legend', isInt), pageWidth - 2 * mx);
    doc.text(legend, mx, y);
    y += legend.length * 10 + 6;

    const head = [[
        t('tdb_col_place', isInt),
        t('driver', isInt),
        t('tdb_col_driver_licence', isInt),
        t('horse', isInt),
        t('tdb_col_horse_licence', isInt),
        'D', 'M', 'P',
        t('total', isInt)
    ]];

    (lists || []).forEach((list) => {
        // Heading of the list: name and the TDB classes it covers
        const classes = (list.tdbClasses || [])
            .map((c) => (c.number !== null && c.number !== undefined ? `${c.number} ${c.label}`.trim() : c.label))
            .filter(Boolean).join(', ');
        if (y > pageHeight - 110) {
            doc.addPage();
            y = 50;
        }
        doc.setFontSize(11).setFont(undefined, 'bold');
        doc.text(String(list.groupLabel || t('pdf_unknown_class', isInt)), mx, y);
        doc.setFontSize(8).setFont(undefined, 'normal');
        if (classes) doc.text(`${t('tdb_covers', isInt)}: ${classes}`, mx, y + 11);
        y += classes ? 22 : 12;

        if (list.status === 'noResults') {
            doc.setFontSize(9).setFont(undefined, 'italic');
            doc.text(t('tdb_pdf_class_lapsed', isInt), mx, y + 4);
            y += 22;
            return;
        }
        const notes = [list.zeroStar ? t('tdb_zero_star_note', isInt) : '', list.clearRound ? t('tdb_clear_round_note', isInt) : '']
            .filter(Boolean).join('  ');
        if (notes) {
            doc.setFontSize(8).setFont(undefined, 'italic');
            doc.text(notes, mx, y);
            y += 10;
        }

        const body = list.entries.map((e) => {
            const byMoment = Object.fromEntries((e.moments || []).map((m) => [m.moment, m]));
            const cell = (k) => (byMoment[k] ? byMoment[k].penaltyText : '');
            return [
                { content: e.placingLabel || '?', styles: { fontStyle: 'bold', halign: 'center' } },
                dashIfEmpty(e.driverName),
                dashIfEmpty(e.driverLicence),
                (e.horses || []).map((h) => h.name).filter(Boolean).join('\n') || '-',
                (e.horses || []).map((h) => h.licence || h.regNo || '-').join('\n') || '-',
                { content: cell('D'), styles: { halign: 'right' } },
                { content: cell('M'), styles: { halign: 'right' } },
                { content: cell('P'), styles: { halign: 'right' } },
                { content: e.totalText || '', styles: { halign: 'right', fontStyle: 'bold' } }
            ];
        });

        doc.autoTable({
            startY: y,
            head,
            body,
            theme: 'grid',
            styles: { fontSize: 8, cellPadding: 3, valign: 'middle' },
            headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255] },
            columnStyles: {
                0: { cellWidth: 55 },
                5: { cellWidth: 45 },
                6: { cellWidth: 45 },
                7: { cellWidth: 45 },
                8: { cellWidth: 50 }
            },
            margin: { left: mx, right: mx, bottom: 40 }
        });
        y = (doc.lastAutoTable?.finalY || y) + 22;
    });

    drawResultStatusFooter(doc, resultStatus, { margin: mx, isInt });
    const ts = new Date().toISOString().split('T')[0];
    doc.save(`tdb-underlag_${ts}.pdf`);
}
