// js/pdf/totalResultsPdf.js
import { getClubLogoUrl } from '../services/logosService.js';
import { normalizeCountryCode, fetchFlagDataUrl } from '../services/flagsService.js';
import { escapeHtml } from '../utils/sharedUtils.js';

/**
 * Loads jsPDF and AutoTable from CDN if not already present.
 */
async function loadPdfLibs() {
    if (window.jspdf && window.jspdf.jsPDF) return;
    await import("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
    await import("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js");
}

/**
 * Fetches an image and converts it to a Data URL for use in PDF.
 */
async function fetchImageDataUrl(url) {
    if (!url) return null;
    try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = url;
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        return { dataUrl: c.toDataURL('image/png'), w: img.naturalWidth, h: img.naturalHeight };
    } catch { return null; }
}

/**
 * Generates a professional PDF report of total results.
 * @param {Array} rows - The data rows to display (already filtered and sorted).
 * @param {Object} competition - Competition metadata.
 * @param {Object} options - { viewMode: 'startorder'|'byclass', officials: String }
 */
export async function generateTotalResultsPdf(rows, competition, options = {}) {
    await loadPdfLibs();
    const { jsPDF } = window.jspdf;
    if (!jsPDF) { alert('Kunde inte ladda PDF-biblioteket.'); return; }

    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const mx = 40;
    let y = 40;

    // 1. ASSET LOADING (Logos & Flags)
    const srfLogo = await fetchImageDataUrl('/assets/logos/SRF.png');

    // Pre-fetch unique club logos and flags
    const assetMap = new Map();
    const uniqueClubs = [...new Set(rows.map(r => r.clubName).filter(Boolean))];
    const uniqueNations = [...new Set(rows.map(r => r.country || 'se').map(normalizeCountryCode))];

    const assetPromises = [
        ...uniqueClubs.map(club => fetchImageDataUrl(getClubLogoUrl(club)).then(res => {
            if (res?.dataUrl) assetMap.set(`club_${club}`, res.dataUrl);
        })),
        ...uniqueNations.map(cc => fetchFlagDataUrl(cc).then(url => {
            if (url) assetMap.set(`flag_${cc}`, url);
        }))
    ];
    await Promise.all(assetPromises);

    // 2. HEADER
    if (srfLogo?.dataUrl) {
        const h = 50;
        const ratio = srfLogo.w / srfLogo.h || 1;
        doc.addImage(srfLogo.dataUrl, 'PNG', pageWidth - mx - h * ratio, y - 10, h * ratio, h);
    }

    const compName = competition?.name || 'Tävling';
    const compDate = competition?.dates || competition?.date || new Date().toLocaleDateString('sv-SE');
    const locationLine = [competition?.place || competition?.city, competition?.organizerName || competition?.organizer]
        .filter(Boolean).join(' • ');

    doc.setFontSize(18).setFont(undefined, 'bold');
    doc.text(compName, mx, y);
    y += 18;

    doc.setFontSize(10).setFont(undefined, 'normal');
    if (locationLine) {
        doc.text(locationLine, mx, y);
        y += 12;
    }
    doc.text(compDate, mx, y);
    y += 15;

    doc.setFontSize(12).setFont(undefined, 'bold');
    doc.text("TOTALRESULTAT", mx, y);
    y += 15;

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
    const headers = [['Plac', '#', 'Kusk / Häst', 'Klass', 'Klubb', 'Dressyr', 'Maraton', 'Precision', 'Totalt']];

    const body = [];
    let lastClass = null;

    rows.forEach(r => {
        // Add grouping header if needed
        if (options.viewMode === 'byclass' && r.className !== lastClass) {
            body.push([
                { content: r.className || 'Okänd klass', colSpan: 9, styles: { fillColor: [243, 244, 246], fontStyle: 'bold', fontSize: 10 } }
            ]);
            lastClass = r.className;
        }

        const horseLabel = r.horseName || ''; // Simplified for total results
        const driverCell = `${r.driverName || ''}\n${horseLabel}`;

        body.push([
            r.plac || '—',
            r.startNumber || '',
            driverCell,
            r.className || '',
            r.clubName || '',
            r.dressage?.penalty?.toFixed(2) || '—',
            r.marathon?.totalPenalty?.toFixed(2) || '—',
            r.precision?.pen?.toFixed(2) || '—',
            { content: r.totalPenalty?.toFixed(2) || (r.isEliminated ? 'ELIM' : '—'), styles: { fontStyle: 'bold' } }
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
            4: { cellPadding: { left: 30, top: 4, bottom: 4, right: 4 } }, // Space for flag/logo
            5: { cellWidth: 50, halign: 'center' },
            6: { cellWidth: 50, halign: 'center' },
            7: { cellWidth: 50, halign: 'center' },
            8: { cellWidth: 50, halign: 'center' }
        },
        margin: { left: mx, right: mx },
        didDrawCell: (data) => {
            // Draw Flag & Club logo in column 4 (Klubb)
            if (data.section === 'body' && data.column.index === 4 && data.cell.raw && typeof data.cell.raw !== 'object') {
                const rowIndexInRows = rows.findIndex(r => r.startNumber === rows[data.row.index - rows.filter((_, idx) => idx < data.row.index && typeof body[idx][0] === 'object').length]?.startNumber);
                // This is tricky with grouping rows. Let's find the correct row data.
                // Simplified approach: use the data from the body if possible, or re-calculate.
                const rowData = rows.find(r => r.clubName === data.cell.text[0] && r.driverName === body[data.row.index][2].split('\n')[0]);
                if (!rowData) return;

                const cc = normalizeCountryCode(rowData.country || 'se');
                const flagUrl = assetMap.get(`flag_${cc}`);
                const clubUrl = assetMap.get(`club_${rowData.clubName}`);

                let xPos = data.cell.x + 4;
                const yCenter = data.cell.y + data.cell.height / 2;

                if (flagUrl) {
                    doc.addImage(flagUrl, 'PNG', xPos, yCenter - 4, 12, 8);
                    xPos += 14;
                }
                if (clubUrl) {
                    doc.addImage(clubUrl, 'PNG', xPos, yCenter - 6, 12, 12);
                }
            }
        }
    });

    const ts = new Date().toISOString().split('T')[0];
    doc.save(`totalresultat_${ts}.pdf`);
}
