// js/pdf/quickGuidePdf.js
// Professionell 1-sidig A4-lathund som PDF för funktionärer och domare.

import { loadPdfLibs, loadStandardHeaderLogos, drawStandardHeader } from './pdfBase.js';
import { resolvePdfCompetition } from './pdfCompetitionUtils.js';
import { GUIDES } from '../ui/quickGuideDrawer.js';

function cleanPdfText(text) {
  let s = String(text || '')
    .replace(/<kbd[^>]*>/gi, '[')
    .replace(/<\/kbd>/gi, ']')
    .replace(/<strong[^>]*>/gi, '')
    .replace(/<\/strong>/gi, '')
    .replace(/<span[^>]*>/gi, '')
    .replace(/<\/span>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');

  // Mappa specifika kända emojis till ren text för att undvika Mojibake i standard PDF-typsnitt
  s = s
    .replace(/💬/g, '')
    .replace(/❓/g, '')
    .replace(/⌨️/g, '')
    .replace(/☁️/g, 'Moln: ')
    .replace(/🟢/g, 'Status: ')
    .replace(/🔴/g, 'Status: ')
    .replace(/🟡/g, 'Status: ')
    .replace(/⚪/g, 'Port: ')
    .replace(/⏱️/g, 'Tid: ')
    .replace(/🔄/g, 'Nollställ: ')
    .replace(/🚨/g, 'NÖD: ')
    .replace(/🐎/g, 'Gångart: ')
    .replace(/🛑/g, 'Halt: ')
    .replace(/🩺/g, '')
    .replace(/📊/g, '')
    .replace(/📝/g, '')
    .replace(/🚩/g, '')
    .replace(/🎯/g, '')
    .replace(/👁️/g, '')
    .replace(/🛡️/g, '')
    .replace(/🖨️/g, '')
    .replace(/🔒/g, '[Låst] ')
    .replace(/🔓/g, '[Öppen] ');

  // Rensa bort eventuella kvarvarande Unicode-emojis och surrogate pairs som förvrängs i jsPDF
  try {
    s = s.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/gu, '');
  } catch {}

  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Genererar en perfekt 1-sidig A4 PDF-lathund för vald roll.
 * @param {string} roleKey - Rollnyckel ('dressage', 'marathon-obstacle', etc.)
 * @param {object} competition - Tävlingsobjekt
 */
export async function generateQuickGuidePdf(roleKey = 'dressage', competition = null) {
  await loadPdfLibs();
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) {
    alert('Kunde inte ladda PDF-biblioteket. Kontrollera internetanslutningen.');
    return;
  }

  const resolvedCompetition = await resolvePdfCompetition(competition || {});
  const isEn = (typeof localStorage !== 'undefined' && localStorage.getItem('user_lang_pref') === 'en');
  const lang = isEn ? 'en' : 'sv';

  const guide = GUIDES[roleKey] || GUIDES['dressage'];
  const titleText = cleanPdfText(guide.title[lang] || guide.title.sv);
  const badgeText = cleanPdfText(guide.badge[lang] || guide.badge.sv);
  const headerBannerText = isEn
    ? `OFFICIAL FIELD CHEAT SHEET: ${titleText.toUpperCase()}`
    : `OFFICIELL FÄLTLATHUND: ${titleText.toUpperCase()}`;

  // A4 Portrait: 595.28 x 841.89 pt
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
    compress: true
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 32;
  const contentWidth = pageWidth - (margin * 2);

  // 1. Standard Sidhuvud med SRF & tävlingslogga
  const srfLogo = await loadStandardHeaderLogos(resolvedCompetition);
  let y = drawStandardHeader(doc, resolvedCompetition, headerBannerText, srfLogo, 22, margin);
  y += 6;

  // Färgtema
  const brandDarkBlue = [10, 31, 55];
  const tableHeaderBg = [28, 52, 84];

  // 2. SEKTION: SNABBSTART (3 STEG FÖRE START)
  const stepsData = (guide.steps[lang] || guide.steps.sv).map((st, i) => [
    `Steg ${i + 1}`,
    cleanPdfText(st)
  ]);

  doc.autoTable({
    startY: y,
    head: [[{
      content: isEn ? '1. QUICK START (3 STEPS BEFORE START)' : '1. SNABBSTART (3 STEG FÖRE START)',
      colSpan: 2,
      styles: { halign: 'left', fontStyle: 'bold', fontSize: 9, fillColor: tableHeaderBg, textColor: [255, 255, 255] }
    }]],
    body: stepsData,
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 3.5, textColor: [30, 41, 59] },
    columnStyles: {
      0: { cellWidth: 50, fontStyle: 'bold', textColor: [15, 23, 42], halign: 'center', fillColor: [241, 245, 249] },
      1: { cellWidth: contentWidth - 50 }
    },
    margin: { left: margin, right: margin }
  });

  y = doc.lastAutoTable.finalY + 8;

  // 3. SEKTION: UNDER RITTEN / MOMENTET
  const duringData = (guide.during[lang] || guide.during.sv).map((item) => [
    '•',
    cleanPdfText(item)
  ]);

  doc.autoTable({
    startY: y,
    head: [[{
      content: isEn ? '2. DURING THE ROUND / PHASE (STEP-BY-STEP)' : '2. UNDER RITTEN / MOMENTET (ARBETSGÅNG)',
      colSpan: 2,
      styles: { halign: 'left', fontStyle: 'bold', fontSize: 9, fillColor: tableHeaderBg, textColor: [255, 255, 255] }
    }]],
    body: duringData,
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 3.2, textColor: [30, 41, 59] },
    columnStyles: {
      0: { cellWidth: 16, fontStyle: 'bold', halign: 'center', textColor: brandDarkBlue },
      1: { cellWidth: contentWidth - 16 }
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: margin, right: margin }
  });

  y = doc.lastAutoTable.finalY + 8;

  // 4. SEKTION: FELSÖKNING & VANLIGA MISSTAG
  const faqData = (guide.troubleshooting[lang] || guide.troubleshooting.sv).map((faq) => [
    cleanPdfText(faq.q),
    cleanPdfText(faq.a)
  ]);

  doc.autoTable({
    startY: y,
    head: [[
      {
        content: isEn ? '3. SITUATION / PROBLEM' : '3. FELSÖKNING & MISSTAG ("VAD GÖR JAG OM...")',
        styles: { halign: 'left', fontStyle: 'bold', fontSize: 8.5, fillColor: tableHeaderBg, textColor: [255, 255, 255] }
      },
      {
        content: isEn ? 'ACTION IN SYSTEM' : 'ÅTGÄRD I SYSTEMET',
        styles: { halign: 'left', fontStyle: 'bold', fontSize: 8.5, fillColor: tableHeaderBg, textColor: [255, 255, 255] }
      }
    ]],
    body: faqData,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 3.2, textColor: [30, 41, 59] },
    columnStyles: {
      0: { cellWidth: 175, fontStyle: 'bold', fillColor: [254, 252, 232], textColor: [113, 63, 18] },
      1: { cellWidth: contentWidth - 175 }
    },
    margin: { left: margin, right: margin }
  });

  y = doc.lastAutoTable.finalY + 8;

  // 5. SEKTION: GENVÄGAR, SYMBOLER & OFFLINE-TRYGGHET
  const symbols = guide.symbols[lang] || guide.symbols.sv;
  const symRows = [];
  for (let i = 0; i < symbols.length; i += 2) {
    const s1 = symbols[i];
    const s2 = symbols[i + 1];
    symRows.push([
      cleanPdfText(s1.sym),
      cleanPdfText(s1.desc),
      s2 ? cleanPdfText(s2.sym) : '',
      s2 ? cleanPdfText(s2.desc) : ''
    ]);
  }

  const symColW = 85;
  const descColW = (contentWidth - (symColW * 2)) / 2;

  doc.autoTable({
    startY: y,
    head: [[
      { content: isEn ? '4. SHORTCUT / SYMBOL' : '4. GENVÄG / SYMBOL', styles: { fontStyle: 'bold' } },
      { content: isEn ? 'EXPLANATION' : 'FÖRKLARING', styles: { fontStyle: 'bold' } },
      { content: isEn ? 'SHORTCUT / SYMBOL' : 'GENVÄG / SYMBOL', styles: { fontStyle: 'bold' } },
      { content: isEn ? 'EXPLANATION' : 'FÖRKLARING', styles: { fontStyle: 'bold' } }
    ]],
    body: symRows,
    theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 2.8, textColor: [30, 41, 59] },
    headStyles: {
      fillColor: tableHeaderBg,
      textColor: [255, 255, 255],
      fontSize: 8
    },
    columnStyles: {
      0: { cellWidth: symColW, fontStyle: 'bold', fillColor: [248, 250, 252] },
      1: { cellWidth: descColW },
      2: { cellWidth: symColW, fontStyle: 'bold', fillColor: [248, 250, 252] },
      3: { cellWidth: descColW }
    },
    margin: { left: margin, right: margin }
  });

  y = doc.lastAutoTable.finalY + 7;

  // 6. OFFLINE-TRYGGHET BANNER (Grön ruta utan textöverlappning)
  const bannerHeight = 24;
  doc.setFillColor(236, 253, 245); // ljusgrön bakgrund
  doc.setDrawColor(52, 211, 153); // smaragdgrön ram
  doc.roundedRect(margin, y, contentWidth, bannerHeight, 3, 3, 'FD');

  const titlePrefix = isEn ? 'OFFLINE-PROTECTED:' : 'OFFLINE-SÄKRAT SYSTEM:';
  const descText = isEn
    ? 'All scores and timestamps queue locally in memory. Always click Save even with zero coverage!'
    : 'Alla inmatningar köas tryggt i enhetens minne. Klicka alltid på SPARA även vid noll mobiltäckning!';

  doc.setFontSize(8);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(6, 95, 70);
  doc.text(titlePrefix, margin + 8, y + 15);

  const prefixW = doc.getTextWidth(titlePrefix);

  doc.setFont(undefined, 'normal');
  doc.setTextColor(4, 120, 87);
  doc.text(descText, margin + 8 + prefixW + 5, y + 15);

  // 7. SIDFOT (Exakt i botten av A4)
  const footerY = pageHeight - 20;
  doc.setDrawColor(226, 232, 240);
  doc.line(margin, footerY - 8, pageWidth - margin, footerY - 8);

  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `DriveLive Tävlingssystem • Lathund ${badgeText} • www.drivelive.se`,
    margin,
    footerY
  );

  const printTs = new Date().toLocaleString('sv-SE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
  doc.text(
    `Utskriven: ${printTs} • Sida 1 av 1`,
    pageWidth - margin,
    footerY,
    { align: 'right' }
  );

  // Spara PDF
  const safeTitle = roleKey.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `lathund_${safeTitle}_${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(filename);
}

// Global tillgång för enkel anropning
if (typeof window !== 'undefined') {
  window.generateQuickGuidePdf = generateQuickGuidePdf;
}
