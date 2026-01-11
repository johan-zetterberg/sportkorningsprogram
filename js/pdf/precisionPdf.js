// js/pdf/precisionPdf.js
import { normalizeCountryCode, fetchFlagDataUrl } from '../services/flagsService.js';
import { getClubLogoUrl, fetchImageDataUrl } from '../services/logosService.js';
import { sanitizeForFilename, fmt2, horseLabel } from '../utils/sharedUtils.js';
import { getCalculatedRowData, buildPlaceMap } from '../utils/precisionUtils.js';

// === HJÄLPFUNKTIONER (Samma som i marathonPdf.js) ===

async function loadPdfLibs() {
  if (window.jspdf && window.jspdf.jsPDF) return;
  // Fallback om de inte finns laddade globalt
  await import("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
  await import("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js");
}

// === HUVUDFUNKTION ===

export async function generateAndPrintPdf(eq, d, equipages, precisionMap, config, startTimes) {
  await loadPdfLibs();
  const { jsPDF } = window.jspdf;
  if (!jsPDF) {
    alert('Kunde inte ladda PDF-biblioteket (jsPDF).');
    return;
  }

  // 1. FÖRBERED DATA
  const cc = normalizeCountryCode(eq?.country || eq?.nation || eq?.nationality) || 'se';
  const flagDataUrl = await fetchFlagDataUrl(cc);
  const clubLogoUrl = getClubLogoUrl(eq?.clubName);
  const clubLogo = await fetchImageDataUrl(clubLogoUrl); // {dataUrl, w, h}

  // Hämta beräknad data
  const data = getCalculatedRowData(String(eq.startNumber), new Map(), equipages, precisionMap, config, startTimes);
  const allowLabel = data.display.allowLabel || '—';

  // 2. SKAPA PDF (Använd 'pt' för att matcha maraton-mallen)
  const pdf = new jsPDF({ unit: 'pt' });
  const mx = 40;
  let y = 40;

  // 3. LOGGA & HEADER (Samma logik som maraton)
  if (clubLogo?.dataUrl) {
    const maxH = 28, maxW = 110;
    const ratio = (clubLogo.w && clubLogo.h) ? (clubLogo.w / clubLogo.h) : 1;
    let drawH = maxH, drawW = Math.round(drawH * ratio);

    // Justera om den blir för bred
    if (drawW > maxW) {
      drawW = maxW;
      drawH = Math.round(drawW / ratio);
    }

    const x = pdf.internal.pageSize.getWidth() - 40 - drawW;
    // Rita loggan lite högre upp för att linjera snyggt
    pdf.addImage(clubLogo.dataUrl, 'PNG', x, y - Math.round(drawH * 0.6), drawW, drawH);
  }

  // Rubrik med flagga
  pdf.setFontSize(16);
  if (flagDataUrl) {
    pdf.addImage(flagDataUrl, 'PNG', mx, y - 12, 24, 15);
    pdf.text(`Precision – #${eq.startNumber} ${eq.driverName || ''}`, mx + 30, y);
  } else {
    pdf.text(`Precision – #${eq.startNumber} ${eq.driverName || ''}`, mx, y);
  }
  y += 18;

  // Underrubriker (Häst, Klass, Klubb)
  pdf.setFontSize(10);

  const horses = horseLabel(eq);
  if (horses && horses !== '—') {
    pdf.text(`${horses}`, mx, y);
    y += 12;
  }

  pdf.text(`${eq._mergedLabel || eq.className || ''}${eq.clubName ? ' • ' + eq.clubName : ''}`, mx, y);
  y += 14;

  // Statusrad
  pdf.text(`Status: ${data.status}    Starttid: ${data.startT || '–'}`, mx, y);
  y += 12; // Lite extra luft innan tabellerna

  // Kontrollera AutoTable
  if (!pdf.autoTable) {
    alert('PDF AutoTable plugin saknas.');
    pdf.save(`precision_${eq.startNumber}.pdf`);
    return;
  }

  // Gemensam stil för tabellhuvuden (matchar maraton)
  const headStyle = { fillColor: [243, 244, 246], textColor: [55, 65, 81] };
  const commonTableOpts = {
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: headStyle
  };

  // 4. TABELL 1: SUMMERING
  pdf.autoTable({
    startY: y,
    head: [['Summering', 'Värde']],
    body: [
      ['Tid', data.display.timeLabel],
      ['Hinderstraff', fmt2(data.obstaclePenalty)],
      ['Tidsstraff', fmt2(data.timePenalty)],
      ['Övrigt straff', fmt2(data.extraPenalty)],
      [{ content: 'Totalt straff', styles: { fontStyle: 'bold' } }, { content: fmt2(data.totalPenalty), styles: { fontStyle: 'bold' } }],
    ],
    ...commonTableOpts
  });
  y = pdf.lastAutoTable.finalY + 12;

  // 5. TABELL 2: DETALJER & BANA
  pdf.autoTable({
    startY: y,
    head: [['Detaljer', 'Värde']],
    body: [
      ['Porttillägg (klass)', allowLabel],
      ['Maxtid', data.display.maxTimeLabel],
      ['Banlängd', data.display.trackLenLabel],
      ['Tempo (klass)', data.display.tempoLabel],
      ['Rivningar (port nr)', (data.knocks && data.knocks.length)
        ? [...new Set(data.knocks.map(p => String(p)).sort((a, b) => Number(a) - Number(b)))].join(', ')
        : '—'],
      ['Kommentar', (d.comment || '').trim() || 'Inga.'],
    ],
    ...commonTableOpts
  });
  y = pdf.lastAutoTable.finalY + 12;

  // 6. TABELL 3: RIVNINGAR PER PORT (Om det finns)
  if (data.knockStats && data.knockStats.length) {
    pdf.autoTable({
      startY: y,
      head: [['Port', 'Antal']],
      body: data.knockStats.map(k => [String(k.port), String(k.count)]),
      ...commonTableOpts
    });
  }

  // 7. SPARA FIL
  const driverNameSanitized = sanitizeForFilename(eq.driverName || '');
  const filename = `precisionprotokoll_${eq.startNumber}_${driverNameSanitized}.pdf`;
  pdf.save(filename);
}

// Helper to get judge names from config or return default
function getJudgesList(config) {
  // Try to find judge names in config structure if they exist, otherwise placeholder or empty
  // Assuming config might have 'officials' or similar. If not, we return null for now 
  // or checks specific judge fields.
  // For now return hardcoded or empty if not found.
  // In a real scenario, we'd pull from competition config.
  return [];
}

export async function generatePrecisionListPdf(equipages, precisionMap, config, startTimes, competition) {
  await loadPdfLibs();
  const { jsPDF } = window.jspdf;
  if (!jsPDF) { alert('Kunde inte ladda PDF-biblioteket.'); return; }

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt' });
  const pageWidth = doc.internal.pageSize.getWidth();

  // -- ASSETS --
  // Helper to load image
  const loadImg = async (path) => {
    try {
      const img = new Image();
      img.src = path;
      img.crossOrigin = 'Anonymous';
      await new Promise((r, e) => { img.onload = r; img.onerror = r; }); // Resolve even on error
      if (!img.naturalWidth) return null;
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return { data: c.toDataURL('image/png'), w: img.naturalWidth, h: img.naturalHeight };
    } catch { return null; }
  };

  // Load Logo (SRF default)
  const srfLogo = await loadImg('/assets/logos/SRF.png');

  // -- PRE-LOAD ASSETS FOR EQUIPAGES --
  const neededFlags = new Set();
  const neededClubs = new Set();
  equipages.forEach(eq => {
    neededFlags.add(normalizeCountryCode(eq.country || eq.nation || 'se'));
    if (eq.clubName) neededClubs.add(eq.clubName);
  });

  const assetMap = new Map();
  const promises = [];

  // Flags
  for (const cc of neededFlags) {
    promises.push(fetchFlagDataUrl(cc).then(url => {
      if (url) assetMap.set(`flag_${cc}`, url);
    }));
  }
  // Club Logos
  for (const club of neededClubs) {
    const url = getClubLogoUrl(club);
    promises.push(fetchImageDataUrl(url).then(res => {
      if (res?.dataUrl) assetMap.set(`club_${club}`, res.dataUrl);
    }));
  }
  await Promise.all(promises);

  // -- HEADER LAYOUT --
  let y = 30;

  // 1. Logos
  if (srfLogo) {
    const h = 50;
    const w = h * (srfLogo.w / srfLogo.h);
    doc.addImage(srfLogo.data, 'PNG', 40, y, w, h);
  }

  // 2. Centered Title Block
  const compName = competition?.name || 'Tävling';
  const compDate = competition?.date || new Date().toLocaleDateString('sv-SE');

  const locationPart = competition?.place || competition?.city || competition?.location || '';
  const organizerPart = competition?.club || competition?.organizerName || competition?.organizer || '';

  const parts = [locationPart, organizerPart].filter(p => p && p.trim());

  const locationLine = parts.length > 0 ? parts.join(' • ') : '';

  doc.setFontSize(20);
  doc.setFont(undefined, 'bold');
  doc.text(compName, pageWidth / 2, y + 15, { align: 'center' });

  doc.setFontSize(12);
  doc.setFont(undefined, 'normal');
  // Print location line above date, or just date if no location
  if (locationLine) {
    doc.text(locationLine, pageWidth / 2, y + 32, { align: 'center' });
    doc.text(compDate, pageWidth / 2, y + 44, { align: 'center' });
    y += 12; // Adjust Y for the extra line
  } else {
    doc.text(compDate, pageWidth / 2, y + 32, { align: 'center' });
  }

  // Grey Bar "Results Cones"
  y += 55;
  doc.setFillColor(230, 230, 230);
  doc.rect(40, y, pageWidth - 80, 20, 'F');
  doc.setFontSize(11);
  doc.setFont(undefined, 'bold');
  doc.text("PRECISION – RESULTATLISTA", pageWidth / 2, y + 14, { align: 'center' });

  // Officials / Judges (Below grey bar, Left aligned)
  y += 35;
  const judges = getJudgesList(config);
  if (judges.length > 0) {
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.text(`Domare: ${judges.join(', ')}`, 40, y);
    y += 15;
  }

  doc.setFont(undefined, 'normal'); // Reset font for table

  // UPDATED HEADER with START column
  const head = [['Plac', '#', 'Kusk / Häst', 'Klass', 'Land/Klubb', 'Start', 'Tid', 'Hinder', 'Tidfel', 'Totalt']];

  // Calculate placements
  const placeMap = buildPlaceMap(equipages, precisionMap);

  const body = equipages.map(eq => {
    const sn = String(eq.startNumber);
    const row = getCalculatedRowData(sn, placeMap, equipages, precisionMap, config, startTimes);

    return [
      row.place || '–',
      eq.startNumber,
      `${eq.driverName}\n${horseLabel(eq)}`,
      eq._mergedLabel || eq.className,
      eq.clubName || '',
      row.startT || '–', // Start time column
      row.display.timeLabel,
      fmt2(row.obstaclePenalty),
      fmt2(row.timePenalty),
      { content: fmt2(row.totalPenalty), styles: { fontStyle: 'bold' } }
    ];
  });

  doc.autoTable({
    startY: y,
    head: head,
    body: body,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [220, 220, 220], textColor: 20 },
    columnStyles: {
      0: { cellWidth: 30 },
      1: { cellWidth: 30 },
      2: { cellWidth: 150 }, // Kusk
      4: { cellWidth: 160, cellPadding: { top: 3, bottom: 3, left: 35, right: 3 } }, // Land/Klubb (wider + padding)
      5: { halign: 'center' }, // Start
      6: { halign: 'right' },  // Tid
      7: { halign: 'center' }, // Hinder
      8: { halign: 'center' }, // Tidfel
      9: { halign: 'center', fontStyle: 'bold' } // Totalt
    },
    didDrawCell: (data) => {
      if (data.section === 'body' && data.column.index === 4) {
        const eq = equipages[data.row.index];
        if (!eq) return;

        const cc = normalizeCountryCode(eq.country || eq.nation || 'se');
        const flagUrl = assetMap.get(`flag_${cc}`);
        const clubUrl = assetMap.get(`club_${eq.clubName}`);

        let xPos = data.cell.x + 2;
        const yPos = data.cell.y + 2;
        const flagHeight = 8;
        const flagWidth = 12;
        const clubLogoHeight = 12;
        const clubLogoWidth = 12;

        // Draw Flag
        if (flagUrl) {
          doc.addImage(flagUrl, 'PNG', xPos, yPos + (clubLogoHeight - flagHeight) / 2, flagWidth, flagHeight);
          xPos += flagWidth + 4;
        }

        // Draw Club Logo
        if (clubUrl) {
          doc.addImage(clubUrl, 'PNG', xPos, yPos, clubLogoWidth, clubLogoHeight);
        }
      }
    }
  });

  doc.save('precision_resultatlista.pdf');
}