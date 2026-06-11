import { getClubLogoUrl, ensureClubLogosLoaded } from '../services/logosService.js';
import { normalizeCountryCode, fetchFlagDataUrl } from '../services/flagsService.js';
import { t } from '../utils/i18n.js';
import { loadPdfLibs, loadImg, drawStandardHeader, loadStandardHeaderLogos } from './pdfBase.js';
import { buildStartListPdfBody } from './startListPdfRows.js';

/**
 * Generates a start list PDF.
 * @param {Array} rows - The list of equipages (with start times populated in .startTime or mapped externally).
 * @param {string} type - 'dressage' | 'marathon' | 'precision' | 'participants'.
 * @param {Object} competition - Competition metadata.
 * @param {Object} options - { title: string, viewMode: 'startorder'|'byclass'|'class' }
 */
export async function generateStartListPdf(rows, type, competition, options = {}) {
    await loadPdfLibs();
    const { jsPDF } = window.jspdf;
    if (!jsPDF) { alert('Kunde inte ladda PDF-biblioteket.'); return; }

    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', compress: true });
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 30;

    // 1. ASSET LOADING
    const srfLogo = await loadStandardHeaderLogos(competition);

    await ensureClubLogosLoaded();

    const assetMap = new Map();
    const uniqueClubs = [...new Set(rows.map(r => r.clubName).filter(Boolean))];
    const uniqueNations = [...new Set(rows.map(r => r.country || 'se').map(normalizeCountryCode))];

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

    // Grey Bar Title
    let disciplineTitle = t('startlist', isInt).toUpperCase();

    if (type === 'dressage') disciplineTitle = `DRESSAGE - ${t('startlist', isInt).toUpperCase()}`;
    else if (type === 'marathon') disciplineTitle = `MARATHON - ${t('startlist', isInt).toUpperCase()}`;
    else if (type === 'precision') disciplineTitle = `CONES - ${t('startlist', isInt).toUpperCase()}`;
    else if (type === 'participants') disciplineTitle = t('startlist', isInt).toUpperCase();
    else if (type === 'horselist') disciplineTitle = 'HÄSTLISTA';

    // Override for Swedish if not Int
    if (!isInt) {
        if (type === 'dressage') disciplineTitle = 'DRESSYR – STARTLISTA';
        else if (type === 'marathon') disciplineTitle = 'MARATON – STARTLISTA';
        else if (type === 'precision') disciplineTitle = 'PRECISION – STARTLISTA';
        else if (type === 'horselist') disciplineTitle = 'HÄSTLISTA';
    }

    if (options.title) disciplineTitle += `: ${options.title}`;
    else if (type !== 'participants' && type !== 'horselist') disciplineTitle += ': Alla';

    y = drawStandardHeader(doc, competition, disciplineTitle, srfLogo, 30, 40);
    y += 10; // Extra spacing after header

    // 3. TABLE CONFIG
    let headers = [[
        t('start', isInt) || 'Start',
        t('startno', isInt),
        `${t('driver', isInt)} / ${t('horse', isInt)}`,
        t('class', isInt),
        `${t('club', isInt)} / NF`
    ]];
    let colStyles = {
        0: { cellWidth: 40, halign: 'center' }, // Start
        1: { cellWidth: 30, halign: 'center' }, // Nr
        2: { minCellWidth: 120 }, // Kusk/Häst
        3: { cellWidth: 100 }, // Klass
        4: { cellWidth: 160, cellPadding: { top: 3, bottom: 3, left: 35, right: 3 } } // Land/Klubb padding for assets
    };

    if (type === 'participants') {
        headers = [[
            t('startno', isInt),
            `${t('driver', isInt)} / ${t('horse', isInt)}`,
            t('class', isInt),
            `${t('club', isInt)} / NF`
        ]];
        colStyles = {
            0: { cellWidth: 30, halign: 'center' }, // Nr
            1: { minCellWidth: 140 }, // Kusk/Häst
            2: { cellWidth: 120 }, // Klass - slightly wider
            3: { cellWidth: 180, cellPadding: { top: 3, bottom: 3, left: 35, right: 3 } } // Land/Klubb
        };
    } else if (type === 'horselist') {
        headers = [['Häst', 'Ras', 'Kön', 'Ålder', 'Kat', 'Härstamning', 'Ägare', 'Kusk']];
        colStyles = {
            0: { cellWidth: 90, fontStyle: 'bold' }, // Häst
            1: { cellWidth: 60 }, // Ras
            2: { cellWidth: 30 }, // Kön
            3: { cellWidth: 30, halign: 'center' }, // Ålder
            4: { cellWidth: 30, halign: 'center' }, // Kat
            5: { minCellWidth: 100 }, // Härstamning
            6: { cellWidth: 90 }, // Ägare
            7: { cellWidth: 90 }  // Kusk
        };
    }

    const { body, rowSources } = buildStartListPdfBody(rows, type, options);

    doc.autoTable({
        startY: y,
        head: headers,
        body: body,
        theme: 'grid',
        styles: { fontSize: 9, cellPadding: 3, valign: 'middle' },
        headStyles: { fillColor: [220, 220, 220], textColor: 0 },
        columnStyles: colStyles,
        margin: { left: 40, right: 40 },
        didDrawCell: (data) => {
            const clubColIdx = type === 'participants' ? 3 : 4;

            if (data.section === 'body' && data.column.index === clubColIdx) {
                const cellText = data.cell.text[0];
                if (!cellText) return;

                const matchedRow = rowSources[data.row.index];
                if (matchedRow) {
                    const cc = normalizeCountryCode(matchedRow.country || 'se');
                    const flagUrl = assetMap.get(`flag_${cc}`);
                    const clubUrl = assetMap.get(`club_${matchedRow.clubName}`);

                    let xPos = data.cell.x + 2;
                    const yPos = data.cell.y + 2;
                    const flagW = 12, flagH = 8;
                    const clubW = 12, clubH = 12;

                    if (flagUrl) {
                        doc.addImage(flagUrl, 'JPEG', xPos, yPos + (clubH - flagH) / 2, flagW, flagH);
                        xPos += flagW + 4;
                    }
                    if (clubUrl) {
                        doc.addImage(clubUrl, 'JPEG', xPos, yPos, clubW, clubH);
                    }
                }
            }
        }
    });

    const ts = new Date().toISOString().split('T')[0];
    const prefix = type === 'participants' ? 'deltagarlista' : `startlista_${type}`;
    doc.save(`${prefix}_${ts}.pdf`);
}
