
import { loadPdfLibs } from './pdfBase.js';
import { buildCheckInPdfRows } from './officialsReportUtils.js';

export async function generateOfficialsPdf(type, competition, officials, assignments = [], locations = [], filter = 'all') {
    await loadPdfLibs();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ compress: true });
    const dateStr = new Date().toLocaleDateString('sv-SE');

    // Title
    doc.setFontSize(18);

    let filename = 'rapport.pdf';

    const sorted = [...officials].sort((a, b) => a.name.localeCompare(b.name));

    if (type === 'phone') {
        doc.text(`Telefonlista - ${competition.name}`, 14, 20);
        doc.setFontSize(10);
        doc.text(`Utskriven: ${dateStr}`, 14, 28);

        filename = `telefonlista_${dateStr}.pdf`;

        const body = sorted.map(p => [
            p.name,
            p.role || p.notes || '',
            p.phone || ''
        ]);

        doc.autoTable({
            startY: 35,
            head: [['Namn', 'Roll', 'Telefon']],
            body: body,
            theme: 'grid',
            headStyles: { fillColor: [255, 230, 0], textColor: [0, 0, 0] }, // Yellowish for phone list
        });

    } else if (type === 'catering') {
        doc.text(`Catering & Kost - ${competition.name}`, 14, 20);
        doc.setFontSize(10);
        doc.text(`Utskriven: ${dateStr}`, 14, 28);

        filename = `catering_${dateStr}.pdf`;

        // Summary
        const dietCounts = {};
        let specialCount = 0;
        sorted.forEach(p => {
            if (p.diet) {
                specialCount++;
                const d = p.diet.toLowerCase();
                dietCounts[d] = (dietCounts[d] || 0) + 1;
            }
        });

        doc.setFontSize(12);
        doc.text('Sammanställning', 14, 40);
        doc.setFontSize(10);
        doc.text(`Totalt antal: ${sorted.length}`, 14, 48);
        doc.text(`Vanlig kost: ${sorted.length - specialCount}`, 14, 54);
        doc.text(`Specialkost: ${specialCount}`, 14, 60);

        let y = 70;
        Object.entries(dietCounts).forEach(([k, v]) => {
            doc.text(`${k}: ${v}`, 14, y);
            y += 6;
        });

        // Detail Table
        doc.setFontSize(12);
        doc.text('Detaljerad Lista (Endast avvikelser)', 14, y + 10);

        const body = sorted.filter(p => p.diet).map(p => [p.name, p.diet]);

        doc.autoTable({
            startY: y + 15,
            head: [['Namn', 'Kost/Allergi']],
            body: body,
            theme: 'striped',
            headStyles: { fillColor: [50, 150, 50] }
        });

    } else if (type === 'checkin') {
        doc.text(`Incheckningslista - ${competition.name}`, 14, 20);
        doc.setFontSize(10);
        doc.text(`Utskriven: ${dateStr}`, 14, 28);

        filename = `incheckning_${dateStr}.pdf`;

        const body = buildCheckInPdfRows(sorted);

        doc.autoTable({
            startY: 35,
            head: [['Check', 'Namn', 'Roll', 'Väst', 'Radio', 'Notering']],
            body: body,
            theme: 'grid',
            headStyles: { fillColor: [50, 80, 200] },
            columnStyles: {
                0: { cellWidth: 15, halign: 'center' },
                3: { cellWidth: 20, halign: 'center' },
                4: { cellWidth: 20, halign: 'center' }
            },
            // Removed didParseCell since we now set text directly in body mapping
        });

    } else if (type === 'overview') {
        doc.text(`Funktionsöversikt${filter !== 'all' ? ` (${filter})` : ''} - ${competition.name}`, 14, 20);
        doc.setFontSize(10);
        doc.text(`Utskriven: ${dateStr}`, 14, 28);

        filename = `funktionarsoversikt_${filter}_${dateStr}.pdf`;

        // Logic matched from admin-officials.js renderOverviewView
        const isVisible = (locType) => {
            if (filter === 'all') return true;
            if (locType === 'general') return true;
            if (filter === 'marathon' && (locType === 'obstacle' || locType.includes('_m'))) return true;
            if (filter === 'dressage' && (locType === 'court' || locType === 'warmup' || locType === 'dressage_func' || locType.includes('_d'))) return true;
            if (filter === 'precision' && (locType === 'course' || locType.includes('_p'))) return true;
            return false;
        };

        const byLocation = {};

        // Init visible locations
        locations.forEach(l => {
            if (isVisible(l.type)) {
                byLocation[l.id] = { label: l.label, type: l.type, folks: [] };
            }
        });

        // General bucket
        if (isVisible('general')) {
            byLocation['GENERAL'] = { label: 'Övergripande / Ingen plats', type: 'general', folks: [] };
        }

        // Fill folks
        assignments.forEach(a => {
            const key = a.locationId || 'GENERAL';
            if (!byLocation[key]) return;

            const person = officials.find(o => o.id === a.officialId);
            byLocation[key].folks.push({
                role: a.roleLabel,
                name: person ? person.name : '???',
                phone: person ? person.phone : '',
                shift: a.startTime ? `${a.startTime}-${a.endTime}` : (a.shift !== 'all' ? a.shift : '')
            });
        });

        // Loop and print tables
        let y = 35;
        const printGroup = (title, items) => {
            if (items.length === 0) return;

            // Head
            doc.setFontSize(14);
            doc.setTextColor(0, 0, 0);

            // Check page break for title
            if (y > 270) { doc.addPage(); y = 20; }
            doc.text(title, 14, y);
            y += 8;

            // Iterate locations
            items.forEach(loc => {
                if (loc.folks.length === 0) return; // Skip empty in PDF or show "Ingen"? UI shows card. Let's skip to save paper or show minimal.
                // UI shows empty cards. Let's show empty tables to be clear nobody is there? 
                // Better: Only show active assignments to keep list compact? 
                // User wants "all information". Let's show only populated locations to be clean.

                // Sub-header (Location Name)
                doc.setFontSize(12);
                doc.setTextColor(50, 50, 50);
                if (y > 270) { doc.addPage(); y = 20; }
                doc.text(loc.label, 14, y);
                y += 2;

                const body = loc.folks.map(f => [f.role, f.shift, f.name, f.phone]);

                doc.autoTable({
                    startY: y,
                    head: [['Roll', 'Tid', 'Namn', 'Telefon']],
                    body: body,
                    theme: 'grid',
                    headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0] },
                    margin: { left: 14 },
                });

                y = doc.lastAutoTable.finalY + 10;
            });
        };

        // Group 1: Obstacles
        const obs = Object.values(byLocation).filter(l => l.type === 'obstacle');
        printGroup('Hinder', obs);

        // Group 2: Sites
        const sites = Object.values(byLocation).filter(l => l.type !== 'obstacle' && l.type !== 'general');
        printGroup('Tävlingsplatser', sites);

        // Group 3: General
        const gen = Object.values(byLocation).filter(l => l.type === 'general');
        printGroup('Övriga Roller', gen);

    }

    doc.save(filename);
}

export function exportOfficialsCsv(officials, competition) {
    const bom = "\uFEFF"; // UTF-8 BOM for Excel
    const headers = ['Namn', 'Email', 'Telefon', 'Klubb', 'Roll', 'Notering', 'ICE Namn', 'ICE Tel', 'Kost', 'Tröja'];

    let csvContent = headers.join(';') + '\n';

    officials.forEach(p => {
        const row = [
            `"${p.name || ''}"`,
            `"${p.email || ''}"`,
            `"${p.phone || ''}"`,
            `"${p.club || ''}"`,
            `"${p.role || ''}"`,
            `"${(p.notes || '').replace(/"/g, '""')}"`,
            `"${p.iceName || ''}"`,
            `"${p.icePhone || ''}"`,
            `"${p.diet || ''}"`,
            `"${p.shirtSize || ''}"`
        ];
        csvContent += row.join(';') + '\n';
    });

    const blob = new Blob([bom + csvContent], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `funktionarer_${competition.name}_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

export function exportAssignmentsCsv(assignments, officials, locations, competition, filter = 'all') {
    const bom = "\uFEFF"; // UTF-8 BOM
    const headers = ['Plats', 'Platstyp', 'Roll', 'Namn', 'Telefon', 'Datum', 'Starttid', 'Sluttid'];

    let csvContent = headers.join(';') + '\n';

    // Helper to check filter
    const isVisible = (locType) => {
        if (filter === 'all') return true;
        if (locType === 'general') return true;
        if (filter === 'marathon' && (locType === 'obstacle' || locType.includes('_m'))) return true;
        if (filter === 'dressage' && (locType === 'court' || locType === 'warmup' || locType === 'dressage_func' || locType.includes('_d'))) return true;
        if (filter === 'precision' && (locType === 'course' || locType.includes('_p'))) return true;
        return false;
    };

    assignments.forEach(a => {
        const loc = locations.find(l => l.id === a.locationId);
        const locType = loc ? loc.type : 'general';

        if (!isVisible(locType)) return;

        const person = officials.find(o => o.id === a.officialId);
        const locLabel = loc ? loc.label : 'Övergripande';

        // CSV formatting
        const row = [
            `"${locLabel}"`,
            `"${locType}"`,
            `"${a.roleLabel || ''}"`,
            `"${person ? person.name : '???'}"`,
            `"${person ? (person.phone || '') : ''}"`,
            `"${a.dateString || ''}"`,
            `"${a.startTime || ''}"`,
            `"${a.endTime || ''}"`
        ];
        csvContent += row.join(';') + '\n';
    });

    const blob = new Blob([bom + csvContent], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `funktionarsuppdrag_${filter}_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
