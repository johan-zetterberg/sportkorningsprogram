// js/pdf/startListPdf.js
import { getClubLogoUrl } from '../services/logosService.js';
import { normalizeCountryCode, fetchFlagDataUrl } from '../services/flagsService.js';
import { horseLabelStacked, horseLabel } from '../utils/sharedUtils.js';

async function loadPdfLibs() {
    if (window.jspdf && window.jspdf.jsPDF) return;
    await import("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
    await import("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js");
}

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

    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt' });
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 30;

    // 1. ASSET LOADING
    const srfLogo = await fetchImageDataUrl('/assets/logos/SRF.png');

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
    // Logo
    if (srfLogo?.dataUrl) {
        const h = 50; const w = h * (srfLogo.w / srfLogo.h);
        doc.addImage(srfLogo.dataUrl, 'PNG', 40, y, w, h);
    }

    const compName = competition?.name || 'Tävling';
    const compDate = competition?.dates || competition?.date || new Date().toLocaleDateString('sv-SE');
    const locationLine = [competition?.place || competition?.city, competition?.organizerName || competition?.organizer]
        .filter(Boolean).join(' • ');

    doc.setFontSize(20).setFont(undefined, 'bold');
    doc.text(compName, pageWidth / 2, y + 15, { align: 'center' });

    doc.setFontSize(12).setFont(undefined, 'normal');
    if (locationLine) {
        doc.text(locationLine, pageWidth / 2, y + 32, { align: 'center' });
        doc.text(compDate, pageWidth / 2, y + 44, { align: 'center' });
        y += 12;
    } else {
        doc.text(compDate, pageWidth / 2, y + 32, { align: 'center' });
    }

    // Grey Bar Title
    let disciplineTitle = 'Startlista';
    if (type === 'dressage') disciplineTitle = 'DRESSYR – STARTLISTA';
    else if (type === 'marathon') disciplineTitle = 'MARATON – STARTLISTA';
    else if (type === 'precision') disciplineTitle = 'PRECISION – STARTLISTA';
    else if (type === 'participants') disciplineTitle = 'DELTAGARLISTA';
    else if (type === 'horselist') disciplineTitle = 'HÄSTLISTA';

    if (options.title) disciplineTitle += `: ${options.title}`;
    else if (type !== 'participants' && type !== 'horselist') disciplineTitle += ': Alla';

    y += 55;
    doc.setFillColor(230, 230, 230);
    doc.rect(40, y, pageWidth - 80, 20, 'F');
    doc.setFontSize(11).setFont(undefined, 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(disciplineTitle, pageWidth / 2, y + 14, { align: 'center' });

    y += 40; // Spacing after title bar

    // 3. TABLE CONFIG
    let headers = [['Start', 'Nr', 'Kusk / Häst', 'Klass', 'Land/Klubb']];
    let colStyles = {
        0: { cellWidth: 40, halign: 'center' }, // Start
        1: { cellWidth: 30, halign: 'center' }, // Nr
        2: { minCellWidth: 120 }, // Kusk/Häst
        3: { cellWidth: 100 }, // Klass
        4: { cellWidth: 160, cellPadding: { top: 3, bottom: 3, left: 35, right: 3 } } // Land/Klubb padding for assets
    };

    if (type === 'participants') {
        headers = [['Nr', 'Kusk / Häst', 'Klass', 'Land/Klubb']];
        colStyles = {
            0: { cellWidth: 30, halign: 'center' }, // Nr
            1: { minCellWidth: 140 }, // Kusk/Häst
            2: { cellWidth: 120 }, // Klass - slightly wider
            3: { cellWidth: 180, cellPadding: { top: 3, bottom: 3, left: 35, right: 3 } } // Land/Klubb
        };
    } else if (type === 'horselist') {
        // Kolumner: Häst, Ras, Kön, Ålder, Kategori, Härstamning, Ägare, Kusk
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

    let body = [];
    let lastClass = null;

    rows.forEach(r => {
        // Class Grouping Row (skip for horselist if unwanted, or handle if needed. Default assumes no class grouping for flat horse list)

        // --- HORSE LIST HANDLING ---
        if (type === 'horselist') {
            const row = [];
            row.push(r.name || '');
            row.push(r.breed || '');
            row.push(r.gender || '');
            row.push(r.age || '');
            row.push(r.category || (r.height ? '?' : '')); // If cat calculated elsewhere

            // Härstamning
            const lineage = [r.sire, r.dam].filter(v => v && v !== '-').join(' x ');
            row.push(r.lineage || lineage || '');

            row.push(r.owner || '');
            row.push(r.driverName || '');

            body.push(row);
            return; // Skip normal startlist logic
        }


        // --- REGULAR STARTLIST / PARTICIPANT LIST HANDLING ---
        if (options.viewMode === 'byclass' || options.viewMode === 'class') {
            const currentClass = r._mergedLabel || r.className || 'Okänd klass';
            if (currentClass !== lastClass) {
                const colSpan = type === 'participants' ? 4 : 5;
                body.push([
                    { content: currentClass, colSpan: colSpan, styles: { fillColor: [240, 240, 240], fontStyle: 'bold' } }
                ]);
                lastClass = currentClass;
            }
        }

        const timeStr = r.startTime ? r.startTime.split('T')[1]?.slice(0, 5) || r.startTime : '—';
        const hLabel = horseLabel(r);

        const row = [];
        if (type !== 'participants') {
            row.push({ content: timeStr, styles: { fontStyle: 'bold', halign: 'center' } });
        }

        row.push(r.startNumber || '');
        row.push(`${r.driverName || ''}\n${hLabel}`);
        row.push(r._mergedLabel || r.className || '');
        row.push(r.clubName || '');

        body.push(row);
    });

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
            // Draw Logos in 'Land/Klubb' column
            // index 4 in startlist, index 3 in participants
            // Logic: if type is participants, club col is index 3.
            const clubColIdx = type === 'participants' ? 3 : 4;

            if (data.section === 'body' && data.column.index === clubColIdx) {
                const cellText = data.cell.text[0]; // Club name usually
                if (!cellText) return;

                const rowRaw = data.row.raw;
                if (!Array.isArray(rowRaw)) return; // Grouping row

                // Match by driver name. Driver is always in the raw row data, but index varies.
                // Startlist: Start(0), Nr(1), Driver(2)
                // Participants: Nr(0), Driver(1)
                const driverColIdx = type === 'participants' ? 1 : 2;

                const driverFull = rowRaw[driverColIdx];
                if (typeof driverFull !== 'string') return;
                const driverName = driverFull.split('\n')[0];

                const matchedRow = rows.find(r => r.clubName === cellText && r.driverName === driverName);
                if (matchedRow) {
                    const cc = normalizeCountryCode(matchedRow.country || 'se');
                    const flagUrl = assetMap.get(`flag_${cc}`);
                    const clubUrl = assetMap.get(`club_${matchedRow.clubName}`);

                    let xPos = data.cell.x + 2;
                    const yPos = data.cell.y + 2;
                    const flagW = 12, flagH = 8;
                    const clubW = 12, clubH = 12;

                    if (flagUrl) {
                        doc.addImage(flagUrl, 'PNG', xPos, yPos + (clubH - flagH) / 2, flagW, flagH);
                        xPos += flagW + 4;
                    }
                    if (clubUrl) {
                        doc.addImage(clubUrl, 'PNG', xPos, yPos, clubW, clubH);
                    }
                }
            }
        }
    });

    const ts = new Date().toISOString().split('T')[0];
    const prefix = type === 'participants' ? 'deltagarlista' : `startlista_${type}`;
    doc.save(`${prefix}_${ts}.pdf`);
}
