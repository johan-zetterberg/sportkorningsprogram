import { getClubLogoUrl, ensureClubLogosLoaded } from '../services/logosService.js';
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

    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', compress: true });
    const pageWidth = doc.internal.pageSize.getWidth();
    const mx = 40;
    // 1. ASSET LOADING (Logos & Flags)
    const srfLogo = await loadStandardHeaderLogos(competition);

    // 2. HEADER
    let y = drawStandardHeader(doc, competition, "LAGTÄVLING - TOTALRESULTAT", srfLogo, 30, mx);
    y += 5;

    await ensureClubLogosLoaded();
    const assetMap = new Map();
    const uniqueTeams = [...new Set(teams.map(t => t.teamName).filter(Boolean))];
    const uniqueNations = [...new Set(teams.map(t => {
        const memberWithCountry = t.members?.find(m => m.details?.country || m.details?.nation);
        return memberWithCountry ? (memberWithCountry.details.country || memberWithCountry.details.nation) : 'se';
    }).map(normalizeCountryCode))];

    const assetPromises = [
        ...uniqueTeams.map(teamName => loadImg(getClubLogoUrl(teamName)).then(res => {
            if (res?.dataUrl) assetMap.set(`club_${teamName}`, res.dataUrl);
        })),
        ...uniqueNations.map(cc => fetchFlagDataUrl(cc).then(url => {
            if (url) assetMap.set(`flag_${cc}`, url);
        }))
    ];
    await Promise.all(assetPromises);

    // 3. TABLE GENERATION
    const headers = [[
        "Plac",
        "Lag / Ekipage",
        "Klubb",
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
            '', // Klubb (drawn manually)
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
                    '', // No logo for members
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
            2: { cellWidth: 40, halign: 'center' },
            3: { cellWidth: 55 },
            4: { cellWidth: 55 },
            5: { cellWidth: 55 },
            6: { cellWidth: 55 }
        },
        margin: { left: mx, right: mx },
        didDrawCell: (data) => {
            if (data.section === 'body' && data.column.index === 2) {
                // Determine if it's a team row
                const rowObj = body[data.row.index];
                if (rowObj && rowObj[0] !== '') { // Team rows have rank in col 0
                    const teamNameObj = rowObj[1];
                    const teamName = teamNameObj.content;
                    const team = teams.find(t => t.teamName === teamName);
                    if (!team) return;

                    const memberWithCountry = team.members?.find(m => m.details?.country || m.details?.nation);
                    const cc = normalizeCountryCode(memberWithCountry ? (memberWithCountry.details.country || memberWithCountry.details.nation) : 'se');

                    const flagUrl = assetMap.get(`flag_${cc}`);
                    const clubUrl = assetMap.get(`club_${teamName}`);

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
        }
    });

    const ts = new Date().toISOString().split('T')[0];
    doc.save(`lagresultat_${ts}.pdf`);
}
