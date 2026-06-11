// js/pdf/totalResultsPdf.js
import { getClubLogoUrl, ensureClubLogosLoaded } from '../services/logosService.js';
import { normalizeCountryCode, fetchFlagDataUrl } from '../services/flagsService.js';
import { escapeHtml } from '../utils/sharedUtils.js';
import { t } from '../utils/i18n.js';
import { loadPdfLibs, loadImg, drawStandardHeader, loadStandardHeaderLogos } from './pdfBase.js';
import { formatTotalDisciplinePdfPenalty, formatTotalPdfPenalty } from './resultPdfFormatUtils.js';
import { resolveTotalResultsJsPdf } from './totalResultsPdfUtils.js';

function formatPrecisionTimePdfLabel(timeMs, eliminated = false) {
    if (eliminated) return 'ELIM';
    const value = Number(timeMs);
    if (!Number.isFinite(value) || value < 0) return '';
    return `${(value / 1000).toFixed(2).replace('.', ',')} s`;
}

/**
 * Generates a professional PDF report of total results.
 * @param {Array} rows - The data rows to display (already filtered and sorted).
 * @param {Object} competition - Competition metadata.
 * @param {Object} options - { viewMode: 'startorder'|'byclass', officials: String }
 */
export async function generateTotalResultsPdf(rows, competition, options = {}) {
    await loadPdfLibs();
    const jsPDF = resolveTotalResultsJsPdf({ throwOnMissing: options.throwOnMissingPdfLib === true });
    if (!jsPDF) return;

    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', compress: true });
    const pageWidth = doc.internal.pageSize.getWidth();
    const mx = 40;
    let y = 40;

    // 1. ASSET LOADING (Logos & Flags)
    const srfLogo = await loadStandardHeaderLogos(competition);

    // Pre-fetch unique club logos and flags
    const assetMap = new Map();
    const uniqueClubs = [...new Set(rows.map(r => r.clubName).filter(Boolean))];
    const uniqueNations = [...new Set(rows.map(r => r.country || 'se').map(normalizeCountryCode))];

    await ensureClubLogosLoaded();

    const assetPromises = [
        ...uniqueClubs.map(club => loadImg(getClubLogoUrl(club)).then(res => {
            if (res?.dataUrl) assetMap.set(`club_${club}`, res.dataUrl);
        })),
        ...uniqueNations.map(cc => fetchFlagDataUrl(cc).then(url => {
            if (url) assetMap.set(`flag_${cc}`, url);
        }))
    ];
    await Promise.all(assetPromises);

    // 2. HEADER
    const isInt = !!competition?.meta?.isInternational;
    y = drawStandardHeader(doc, competition, t('results', isInt).toUpperCase(), srfLogo, 30, mx);

    // 3. OFFICIALS (Optional)
    if (options.officials) {
        doc.setFontSize(8).setFont(undefined, 'italic');
        const lines = doc.splitTextToSize(`Funktionärer: ${options.officials.replace(/<[^>]*>/g, ' ')}`, pageWidth - 2 * mx);
        doc.text(lines, mx, y);
        y += (lines.length * 10) + 10;
    } else {
        y += 5;
    }

    // 4. TABLE GENERATION
    const headers = [[
        t('rank', isInt),
        t('startno', isInt),
        `${t('driver', isInt)} / ${t('horse', isInt)}`,
        t('class', isInt),
        t('club', isInt),
        'Dressage',
        'Marathon',
        'Cones',
        t('total', isInt)
    ]];

    if (!isInt) {
        headers[0][5] = 'Dressyr';
        headers[0][6] = 'Maraton';
        headers[0][7] = 'Precision';
        headers[0][8] = 'Totalt';
    }

    const body = [];
    let lastClass = null;

    rows.forEach(r => {
        const displayClass = r._mergedLabel || r.className || 'Okänd klass';
        if (options.viewMode === 'byclass' && displayClass !== lastClass) {
            body.push([
                { content: displayClass, colSpan: 9, styles: { fillColor: [243, 244, 246], fontStyle: 'bold', fontSize: 10 } }
            ]);
            lastClass = displayClass;
        }

        const horseLabel = r.horseName || '';
        const driverCell = `${r.driverName || ''}\n${horseLabel}`;

        body.push([
            r.plac || '—',
            r.startNumber || '',
            driverCell,
            displayClass,
            r.clubName || '',
            formatTotalDisciplinePdfPenalty(r, 'dressage'),
            formatTotalDisciplinePdfPenalty(r, 'marathon'),
            `${formatTotalDisciplinePdfPenalty(r, 'precision')}${formatPrecisionTimePdfLabel(r?.precision?.timeMs, r?.precision?.eliminated) ? `\n${formatPrecisionTimePdfLabel(r?.precision?.timeMs, r?.precision?.eliminated)}` : ''}`,
            { content: formatTotalPdfPenalty(r, isInt), styles: { fontStyle: 'bold' } }
        ]);
    });

    doc.autoTable({
        startY: y,
        head: headers,
        body: body,
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 4, valign: 'middle' },
        headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255] },
        columnStyles: {
            0: { cellWidth: 30, halign: 'center' },
            1: { cellWidth: 30, halign: 'center' },
            2: { minCellWidth: 100 },
            3: { cellWidth: 80 },
            4: { cellPadding: { left: 30, top: 4, bottom: 4, right: 4 } },
            5: { cellWidth: 50, halign: 'center' },
            6: { cellWidth: 50, halign: 'center' },
            7: { cellWidth: 60, halign: 'center' },
            8: { cellWidth: 50, halign: 'center' }
        },
        margin: { left: mx, right: mx },
        didDrawCell: (data) => {
            if (data.section === 'body' && data.column.index === 4 && data.cell.raw && typeof data.cell.raw !== 'object') {
                const rowData = rows.find(r => r.clubName === data.cell.text[0] && r.driverName === body[data.row.index][2].split('\n')[0]);
                if (!rowData) return;

                const cc = normalizeCountryCode(rowData.country || 'se');
                const flagUrl = assetMap.get(`flag_${cc}`);
                const clubUrl = assetMap.get(`club_${rowData.clubName}`);

                let xPos = data.cell.x + 4;
                const yCenter = data.cell.y + data.cell.height / 2;

                if (flagUrl) {
                    doc.addImage(flagUrl, 'JPEG', xPos, yCenter - 4, 12, 8);
                    xPos += 14;
                }
                if (clubUrl) {
                    doc.addImage(clubUrl, 'JPEG', xPos, yCenter - 6, 12, 12);
                }
            }
        }
    });

    const ts = new Date().toISOString().split('T')[0];
    doc.save(`totalresultat_${ts}.pdf`);
}
