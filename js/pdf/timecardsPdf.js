import { getClubLogoUrl } from '../services/logosService.js';
import { t } from '../utils/i18n.js';
import { loadPdfLibs, loadImg } from './pdfBase.js';

export async function generateTimecardsPdf(equipages, competition) {
    // Check international status
    const isInternational = competition?.meta?.isInternational || false;

    await loadPdfLibs();
    const { jsPDF } = window.jspdf;
    if (!jsPDF) { alert('Kunde inte ladda PDF-biblioteket.'); return; }

    // A4 Portrait: 595.28 x 841.89 pt
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // Config
    const margin = 30; // Left/Right margin
    const cardHeight = (pageHeight - (margin * 2)) / 2 - 10; // Half page minus gap
    const cardWidth = pageWidth - (margin * 2);

    // Load generic SRF logo
    const srfLogo = await loadImg('/assets/logos/SRF.png');

    // Sort equipages
    const sorted = [...equipages].sort((a, b) => (a.startNumber || 0) - (b.startNumber || 0));

    // Helper: Draw one card at yOffset
    const drawCard = (eq, startY) => {
        const borderStart = startY;
        const width = cardWidth;

        // Header
        doc.setFontSize(10).setFont(undefined, 'bold').setTextColor(0, 0, 0);
        // "Competition ID/Doc" - keeping generic or translated
        doc.text(t('marathon_timecard_header', isInternational) || "Tävlingsdokument, sportkörning, maraton", margin, startY + 12);

        doc.setFontSize(18).setFont(undefined, 'bold');
        // "Timecard - carry on carriage"
        const titleTitle = isInternational ? "Time Card / Timetable" : "Tidkort – medföres på ekipaget";
        doc.text(titleTitle, margin, startY + 35);

        // Logo (Top Right)
        if (srfLogo?.data) {
            const logoH = 40;
            const logoW = logoH * (srfLogo.w / srfLogo.h);
            const logoX = margin + width - logoW;
            const logoY = startY;
            doc.addImage(srfLogo.data, 'PNG', logoX, logoY, logoW, logoH);

            doc.setFontSize(6).setFont(undefined, 'normal').setTextColor(0, 50, 150);
            doc.text("SVENSKA RIDSPORTFÖRBUNDET", logoX + (logoW / 2), logoY + logoH + 6, { align: 'center' });
        }

        // Info Grid Box
        const boxY = startY + 60;
        const boxH = 65;

        // Main Box Outline
        doc.setLineWidth(1).setDrawColor(0).setFillColor(255, 255, 255);
        doc.rect(margin, boxY, width, boxH);

        // Grid Lines
        // Horizontal middle
        doc.line(margin, boxY + 45, margin + width, boxY + 45); // Split main info vs Date/Loc

        // Row 1 Verticals
        // Cols: Nr(60) | Driver+Club(Flex) | Class(80) | Category(80)
        const col1W = 60;
        const col3W = 80;
        const col4W = 80;
        const col2W = width - col1W - col3W - col4W;

        const x1 = margin + col1W;
        const x2 = x1 + col2W;
        const x3 = x2 + col3W;

        doc.line(x1, boxY, x1, boxY + 45);
        doc.line(x2, boxY, x2, boxY + 45);
        doc.line(x3, boxY, x3, boxY + 45);

        // Row 2 Verticals
        // Cols: Date(120) | Location(Flex)
        const r2_col1W = 120;
        doc.line(margin + r2_col1W, boxY + 45, margin + r2_col1W, boxY + boxH);

        // -- Text Filling --
        doc.setTextColor(0);

        // 1. Nr
        doc.setFontSize(7).setFont(undefined, 'normal');
        doc.text(t('startno', isInternational), margin + 3, boxY + 10);
        doc.setFontSize(22).setFont(undefined, 'bold');
        doc.text(String(eq.startNumber || '-'), margin + (col1W / 2), boxY + 35, { align: 'center' });

        // 2. Driver
        doc.setFontSize(7).setFont(undefined, 'normal');
        doc.text(t('driver', isInternational), x1 + 3, boxY + 10);
        doc.setFontSize(12).setFont(undefined, 'bold');
        doc.text(String(eq.driverName || ''), x1 + 3, boxY + 25);
        doc.setFontSize(9).setFont(undefined, 'normal');
        doc.text(String(eq.clubName || eq.club || ''), x1 + 3, boxY + 38);

        // 3. Class
        doc.setFontSize(7).setFont(undefined, 'normal');
        doc.text(t('class', isInternational), x2 + 3, boxY + 10);
        doc.setFontSize(11).setFont(undefined, 'normal');
        // Handle long class names by wrapping or reducing size
        const clsName = String(eq.className || '');
        if (clsName.length > 15) doc.setFontSize(9);
        doc.text(clsName, x2 + 3, boxY + 28);

        // 4. Category
        doc.setFontSize(7).setFont(undefined, 'normal');
        doc.text(t('category', isInternational) || 'Kategori', x3 + 3, boxY + 10);
        doc.setFontSize(11).setFont(undefined, 'normal');
        doc.text(String(eq.category || extractCategory(eq) || ''), x3 + 3, boxY + 28);

        // 5. Date
        doc.setFontSize(7).setFont(undefined, 'normal');
        doc.text(t('date', isInternational) || 'Datum', margin + 3, boxY + 54);
        const dateStr = competition?.date || competition?.startDate || new Date().toISOString().split('T')[0];
        doc.setFontSize(10).setFont(undefined, 'normal');
        doc.text(dateStr, margin + 3, boxY + 62); // Adjusted Y

        // 6. Location
        doc.setFontSize(7).setFont(undefined, 'normal');
        doc.text(t('location', isInternational) || 'Tävlingsplats', margin + r2_col1W + 3, boxY + 54);
        const locStr = competition?.location || competition?.place || competition?.city || competition?.name || '';
        doc.setFontSize(10).setFont(undefined, 'normal');
        doc.text(locStr, margin + r2_col1W + 3, boxY + 62);

        // --- TABLE ---
        const tableY = boxY + 75;
        const cellH = 25;
        const headerH = 30; // Header height
        const firstColW = 90; // "Start", "Mål"

        // Widths for A, T, B
        const sectionW = (width - firstColW) / 3;

        // Header Row
        doc.setFillColor(200, 200, 200); // Grey bg
        doc.rect(margin, tableY, width, headerH, 'F');
        doc.setLineWidth(1).setDrawColor(0).rect(margin, tableY, width, headerH); // Border

        // Header Text
        doc.setFontSize(12).setFont(undefined, 'bold').setTextColor(0);

        const centerText = (txt, x, y) => doc.text(txt, x, y, { align: 'center', baseline: 'middle' });

        // Vertical lines for columns
        const tx1 = margin + firstColW;
        const tx2 = tx1 + sectionW;
        const tx3 = tx2 + sectionW;

        doc.line(tx1, tableY, tx1, tableY + headerH + (cellH * 3) + 40); // Extend down through signature
        doc.line(tx2, tableY, tx2, tableY + headerH + (cellH * 3) + 40);
        doc.line(tx3, tableY, tx3, tableY + headerH + (cellH * 3) + 40);

        const lblA = isInternational ? 'A' : 'A';
        const lblT = isInternational ? 'Transfer' : 'Transport';
        const lblB = isInternational ? 'B' : 'B';

        centerText(t('section', isInternational) + 's', margin + (firstColW / 2), tableY + (headerH / 2));
        centerText(lblA, tx1 + (sectionW / 2), tableY + (headerH / 2));
        centerText(lblT, tx2 + (sectionW / 2), tableY + (headerH / 2));
        centerText(lblB, tx3 + (sectionW / 2), tableY + (headerH / 2));

        // Rows: Start, Mål, Använd tid
        const labels = [
            'Start',
            t('finish', isInternational),
            t('time', isInternational) // Använd tid
        ];
        let curY = tableY + headerH;

        labels.forEach(lbl => {
            // First Col Grey
            doc.setFillColor(200, 200, 200);
            doc.rect(margin, curY, firstColW, cellH, 'F');
            doc.setDrawColor(0).rect(margin, curY, width, cellH); // Outer rect for row

            // Text
            doc.setFontSize(11).setFont(undefined, 'bold').setTextColor(0);
            centerText(lbl, margin + (firstColW / 2), curY + (cellH / 2));

            curY += cellH;
        });

        // Signature Row
        const sigH = 40;
        doc.setFillColor(200, 200, 200);
        doc.rect(margin, curY, firstColW, sigH, 'F');
        doc.rect(margin, curY, width, sigH); // Border

        doc.setFontSize(10).setFont(undefined, 'bold');
        centerText(isInternational ? "Timekeeper's" : "Tidtagarens", margin + (firstColW / 2), curY + 12);
        centerText(isInternational ? "Signature" : "signatur", margin + (firstColW / 2), curY + 24);

        // Sub-split for signatures (Start / Mål) inside A, T, B cols
        [tx1, tx2, tx3].forEach(xBase => {
            // Split vertical line
            const mid = xBase + (sectionW / 2);
            doc.line(mid, curY, mid, curY + sigH);

            // Small Headers
            doc.setFontSize(7).setFont(undefined, 'normal');
            doc.text("Start", xBase + 2, curY + 8);
            doc.text(t('finish', isInternational), mid + 2, curY + 8);
        });

    };

    // Draw Loop
    for (let i = 0; i < sorted.length; i += 2) {
        if (i > 0) doc.addPage();

        // Top Card
        drawCard(sorted[i], margin + 20);

        // Cut Line
        const midPage = pageHeight / 2;
        doc.setLineWidth(1).setDrawColor(150).setLineDash([5, 5], 0);
        doc.line(0, midPage, pageWidth, midPage);
        doc.setFontSize(8).setTextColor(100);
        doc.text(isInternational ? "- - - Cut here - - -" : "- - - Klipp här - - -", margin, midPage - 5);
        doc.setLineDash([]); // Reset

        // Bottom Card (if exists)
        if (i + 1 < sorted.length) {
            drawCard(sorted[i + 1], midPage + 20 + margin); // Add top margin offset for bottom card
        }
    }

    const ts = new Date().toISOString().split('T')[0];
    doc.save(`tidkort_maraton_${ts}.pdf`);
}

function extractCategory(eq) {
    if (eq.category) return eq.category;
    // Basic fallback if not explicit
    if (eq.className && eq.className.toLowerCase().includes('ponny')) return 'Ponny';
    if (eq.className && eq.className.toLowerCase().includes('häst')) return 'Häst';
    return '';
}
