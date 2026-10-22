// js/pdf/quickGuidePdf.js
// Professionell 1-sidig A4-lathund som PDF för funktionärer och domare.

import { loadPdfLibs, loadStandardHeaderLogos, drawStandardHeader } from './pdfBase.js';
import { resolvePdfCompetition } from './pdfCompetitionUtils.js';
import { GUIDES } from '../ui/quickGuideDrawer.js';

function cleanPdfText(text, lang = 'sv') {
  const en = lang === 'en';
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
    .replace(/☁️/g, en ? 'Cloud: ' : 'Moln: ')
    .replace(/🟢/g, 'Status: ')
    .replace(/🔴/g, 'Status: ')
    .replace(/🟡/g, 'Status: ')
    .replace(/⚪/g, en ? 'Gate: ' : 'Port: ')
    .replace(/⏱️/g, en ? 'Time: ' : 'Tid: ')
    .replace(/🔄/g, en ? 'Reset: ' : 'Nollställ: ')
    .replace(/🚨/g, en ? 'PAUSE: ' : 'PAUS: ')
    .replace(/🐎/g, en ? 'Gait: ' : 'Gångart: ')
    .replace(/🛑/g, en ? 'Stop: ' : 'Halt: ')
    .replace(/🩺/g, '')
    .replace(/📊/g, '')
    .replace(/📝/g, '')
    .replace(/🚩/g, '')
    .replace(/🎯/g, '')
    .replace(/👁️/g, '')
    .replace(/🛡️/g, '')
    .replace(/🖨️/g, '')
    .replace(/🔒/g, en ? '[Locked] ' : '[Låst] ')
    .replace(/🔓/g, en ? '[Open] ' : '[Öppen] ');

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
  if (roleKey === 'admin_checklist') {
    return await generateAdminChecklistPdf(competition);
  }
  await loadPdfLibs();
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) {
    alert('Kunde inte ladda PDF-biblioteket. Kontrollera internetanslutningen.');
    return;
  }

  const resolvedCompetition = await resolvePdfCompetition(competition || null);
  const isEn = (typeof localStorage !== 'undefined' && localStorage.getItem('user_lang_pref') === 'en');
  const lang = isEn ? 'en' : 'sv';

  const guide = GUIDES[roleKey] || GUIDES['dressage'];
  const titleText = cleanPdfText(guide.title[lang] || guide.title.sv, lang);
  const badgeText = cleanPdfText(guide.badge[lang] || guide.badge.sv, lang);
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

  // 2. SEKTION: SNABBSTART (STEGEN FÖRE START)
  const stepsData = (guide.steps[lang] || guide.steps.sv).map((st, i) => [
    `${isEn ? 'Step' : 'Steg'} ${i + 1}`,
    cleanPdfText(st, lang)
  ]);

  doc.autoTable({
    startY: y,
    head: [[{
      content: isEn ? `1. QUICK START (${stepsData.length} STEPS BEFORE START)` : `1. SNABBSTART (${stepsData.length} STEG FÖRE START)`,
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
    cleanPdfText(item, lang)
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
    cleanPdfText(faq.q, lang),
    cleanPdfText(faq.a, lang)
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
      cleanPdfText(s1.sym, lang),
      cleanPdfText(s1.desc, lang),
      s2 ? cleanPdfText(s2.sym, lang) : '',
      s2 ? cleanPdfText(s2.desc, lang) : ''
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

  const titlePrefix = isEn ? 'OFFLINE QUEUE:' : 'OFFLINEKÖ:';
  const descText = isEn
    ? 'On a loaded view: save, check the queue, keep the tab open until the queue indicator is gone.'
    : 'På laddad vy: spara, kontrollera kön och håll fliken öppen tills köindikatorn är borta.';

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
    isEn
      ? `DriveLive competition system • Cheat sheet ${badgeText} • www.drivelive.se`
      : `DriveLive Tävlingssystem • Lathund ${badgeText} • www.drivelive.se`,
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
    isEn ? `Printed: ${printTs} • Page 1 of 1` : `Utskriven: ${printTs} • Sida 1 av 1`,
    pageWidth - margin,
    footerY,
    { align: 'right' }
  );

  // Spara PDF
  const safeTitle = roleKey.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `lathund_${safeTitle}_${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(filename);
}

/**
 * Genererar en utskrivbar 1-sidig A4 checklista för tävlingsledare och sekretariat.
 * @param {object} competition - Tävlingsobjekt
 */
export async function generateAdminChecklistPdf(competition = null) {
  await loadPdfLibs();
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) {
    alert('Kunde inte ladda PDF-biblioteket. Kontrollera internetanslutningen.');
    return;
  }

  const resolvedCompetition = await resolvePdfCompetition(competition || null);
  const isEn = (typeof localStorage !== 'undefined' && localStorage.getItem('user_lang_pref') === 'en');

  const headerBannerText = isEn
    ? 'OFFICIAL EVENT MANAGEMENT CHECKLIST (FEI & TR V KÖRNING)'
    : 'OFFICIELL ARRANGERINGSCHECKLISTA (TR V KÖRNING & DRIVELIVE)';

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

  // Sidhuvud med loggor
  const srfLogo = await loadStandardHeaderLogos(resolvedCompetition);
  let y = drawStandardHeader(doc, resolvedCompetition, headerBannerText, srfLogo, 22, margin);
  y += 6;

  const brandDarkBlue = [10, 31, 55];
  const colGap = 14;
  const colW = (contentWidth - colGap) / 2;

  const phases = isEn ? [
    {
      phase: '1. PREPARATION & ENTRIES',
      items: [
        '[ ] Export the entries file (.eqentries.xml) from TDB and import it under Participants',
        '[ ] Verify driver & horse competition licenses and active club memberships',
        '[ ] Reconcile entry payments, fees, and special dispensations / stabling'
      ]
    },
    {
      phase: '2. CREATE COMPETITION & SETTINGS',
      items: [
        '[ ] Create event in DriveLive using 1-, 2-, or 3-day competition template',
        '[ ] Enter dates, venue, club name, and upload club/sponsor logos for protocols',
        '[ ] Verify classes and select TR rule template (Light, Medium, Advanced)'
      ]
    },
    {
      phase: '3. CONFIGURE DISCIPLINES',
      items: [
        '[ ] Dressage: Set the test per class & assign judges (C, E, B, H, M)',
        '[ ] Marathon: Define obstacles, knockdowns (2 p per element) & section A/B times',
        '[ ] Cones: Set course length, speed, time allowed and the clearance per class'
      ]
    },
    {
      phase: '4. SCHEDULES, CREW & MEASURING',
      items: [
        '[ ] Generate dressage start order and auto-calculate start time intervals',
        '[ ] Measure carriage track widths and save them on the Track width page',
        '[ ] Hand out the 10-character role codes (or join link / QR) to judges, timekeepers and obstacle officials; invite admins by email',
        '[ ] Print 1-page A4 field cheat sheets for the morning official briefing',
        '[ ] Notifications: ask officials and drivers to turn them on on their own device (iPhone: Add to Home Screen first); the app owner saves the key under Admin > Settings > Push notifications'
      ]
    },
    {
      phase: '5. COMPETITION DAY (LIVE DRIFT)',
      items: [
        '[ ] First horse inspection (TR Mom 514) – record status (Passed, Re-inspection)',
        '[ ] Handle withdrawals and driver declarations (locks before the first start, 60 min by default)',
        '[ ] Monitor secretariat live dashboard for dressage, marathon & precision',
        '[ ] Speaker view: open it for the speaker (live times, standings and driver notes)',
        '[ ] Vet withdrawals wait for the ground jury: confirm or overturn them under Needs attention; changed start times: choose how to tell the drivers (message, notification, e-mail)'
      ]
    },
    {
      phase: '6. RESULTS, PRIZE GIVING & EXPORT',
      items: [
        '[ ] Finalize the results and wait out the protest time according to TR',
        '[ ] President of the Ground Jury approves the official results',
        '[ ] Print prize-giving protocol and rosettes / ribbon award lists',
        '[ ] Report the results to TDB by hand, using the TDB entry sheet (Report Center)',
        '[ ] Close the competition on the Archiving tab (End competition)'
      ]
    }
  ] : [
    {
      phase: 'FAS 1: FÖRBEREDELSER & ANMÄLNINGAR',
      items: [
        '[ ] Exportera anmälningsfilen (.eqentries.xml) från TDB och importera den under Deltagare',
        '[ ] Granska kusklicenser, hästlicenser och kuskens klubbtillhörighet',
        '[ ] Kontrollera betalningsstatus, startavgifter och beviljade dispenser'
      ]
    },
    {
      phase: 'FAS 2: SKAPA TÄVLING & GRUNDINSTÄLLNINGAR',
      items: [
        '[ ] Skapa tävling i DriveLive (välj 1-, 2- eller 3-dagars tävlingsmall)',
        '[ ] Ange datum, plats, arrangerande klubb och ladda upp klubb-/sponsorlogga',
        '[ ] Verifiera klassindelning och koppla TR-mall (Lätt, Msv, Svår)'
      ]
    },
    {
      phase: 'FAS 3: KONFIGURERA DELGRENARNA',
      items: [
        '[ ] Dressyr: Ange dressyrprogram per klass och tilldela domare (C, E, B, H, M)',
        '[ ] Maraton: Lägg in hinder, rivningar (2 p per element) samt sträcktider A/B',
        '[ ] Precision: Registrera banlängd, tempo, tillåten tid och portbredd per klass (spårvidd + 20–45 cm)'
      ]
    },
    {
      phase: 'FAS 4: TIDSCHEMAN, FUNKTIONÄRER & KONTROLLMÄTNING',
      items: [
        '[ ] Generera dressyrens startordning och beräkna automatiska startintervaller',
        '[ ] Kontrollmät vagnarnas spårvidd och spara den på sidan Vagnbredd',
        '[ ] Dela ut rollkoderna (10 tecken, eller länk/QR-kod) till domare, tidtagare och hinderpersonal; bjud in admins via e-post',
        '[ ] Skriv ut 1-sidiga A4-lathundar för funktionärsmötet på morgonen',
        '[ ] Notiser: be funktionärer och kuskar slå på dem på sin egen enhet (iPhone: Lägg till på hemskärmen först); appens ägare sparar nyckeln under Admin > Inställningar > Push-notiser'
      ]
    },
    {
      phase: 'FAS 5: UNDER TÄVLINGEN (DRIFT & LIVESYNK)',
      items: [
        '[ ] Hästbesiktning före start (TR Mom 514) – registrera status (Godkänd, Ombesiktning)',
        '[ ] Hantera strykningar och kuskarnas deklaration (låses före första start, 60 min som standard)',
        '[ ] Övervaka sekretariatets live-dashboard för dressyr, maraton och precision',
        '[ ] Speakervy: Öppna den för speakern (livetider, placeringar och kuskarnas anteckningar)',
        '[ ] Veterinärstrykningar väntar på domarkollegiet: fastställ eller upphäv under Att uppmärksamma; ändrade starttider: välj hur kuskarna ska få veta (meddelande, notis, e-post)'
      ]
    },
    {
      phase: 'FAS 6: AVSLUT, PRISUTDELNING & ARKIVERING',
      items: [
        '[ ] Fastställ resultaten och invänta protesttiden enligt TR',
        '[ ] Överdomaren godkänner den officiella resultatlistan',
        '[ ] Skriv ut prisutdelningsprotokoll och hedersprislistor för prisceremoni',
        '[ ] Rapportera resultaten till TDB för hand med TDB-underlaget (Rapportcenter)',
        '[ ] Avsluta tävlingen under fliken Arkivering (Avsluta Tävling)'
      ]
    }
  ];

  // Render left column (phases 0, 1, 2) and right column (phases 3, 4, 5)
  const leftPhases = phases.slice(0, 3);
  const rightPhases = phases.slice(3, 6);

  let leftY = y;
  let rightY = y;

  const renderPhaseBlock = (phaseObj, startX, currentY, width) => {
    doc.autoTable({
      startY: currentY,
      head: [[{ content: phaseObj.phase, styles: { fontStyle: 'bold', fontSize: 8.5 } }]],
      body: phaseObj.items.map(item => [item]),
      theme: 'grid',
      styles: {
        fontSize: 7.5,
        cellPadding: 3.5,
        textColor: [30, 41, 59],
        lineColor: [226, 232, 240]
      },
      headStyles: {
        fillColor: brandDarkBlue,
        textColor: [255, 255, 255]
      },
      columnStyles: {
        0: { cellWidth: width }
      },
      margin: { left: startX, right: pageWidth - (startX + width) }
    });
    return doc.lastAutoTable.finalY + 8;
  };

  leftPhases.forEach(p => {
    leftY = renderPhaseBlock(p, margin, leftY, colW);
  });

  rightPhases.forEach(p => {
    rightY = renderPhaseBlock(p, margin + colW + colGap, rightY, colW);
  });

  y = Math.max(leftY, rightY) + 2;

  // OFFLINE & MOLNSYNK BANNER
  const bannerHeight = 26;
  doc.setFillColor(238, 242, 255); // indigo-50
  doc.setDrawColor(129, 140, 248); // indigo-400
  doc.roundedRect(margin, y, contentWidth, bannerHeight, 3, 3, 'FD');

  const bannerTitle = isEn ? 'OFFLINE QUEUE & LIVE SYNC:' : 'OFFLINEKÖ & LIVESYNK:';
  const bannerDesc = isEn
    ? 'Loaded field views can queue writes locally. Keep each tab open until the queue indicator is gone after reconnecting.'
    : 'Laddade fältvyer kan köa skrivningar lokalt. Håll fliken öppen tills köindikatorn är borta efter återanslutning.';

  doc.setFontSize(8);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(49, 46, 129);
  doc.text(bannerTitle, margin + 8, y + 16);

  const titleW = doc.getTextWidth(bannerTitle);

  doc.setFont(undefined, 'normal');
  doc.setTextColor(67, 56, 202);
  doc.text(bannerDesc, margin + 8 + titleW + 5, y + 16);

  // SIDFOT
  const footerY = pageHeight - 20;
  doc.setDrawColor(226, 232, 240);
  doc.line(margin, footerY - 8, pageWidth - margin, footerY - 8);

  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(
    isEn
      ? 'DriveLive competition system • Organiser checklist • www.drivelive.se'
      : 'DriveLive Tävlingssystem • Arrangörschecklista • www.drivelive.se',
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
    isEn ? `Printed: ${printTs} • Page 1 of 1` : `Utskriven: ${printTs} • Sida 1 av 1`,
    pageWidth - margin,
    footerY,
    { align: 'right' }
  );

  const filename = `arrangorschecklista_${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(filename);
}

// Global tillgång för enkel anropning
if (typeof window !== 'undefined') {
  window.generateQuickGuidePdf = generateQuickGuidePdf;
  window.generateAdminChecklistPdf = generateAdminChecklistPdf;
}
