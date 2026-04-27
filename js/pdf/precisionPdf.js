// js/pdf/precisionPdf.js
import { normalizeCountryCode, fetchFlagDataUrl } from '../services/flagsService.js';
import { getClubLogoUrl, fetchImageDataUrl } from '../services/logosService.js';
import { sanitizeForFilename, fmt2, horseLabel } from '../utils/sharedUtils.js';
import { getCalculatedRowData, buildPlaceMap, startTimeFor, computeMaxSecondsForClass, computePortWidth, trackWidthFromEq } from '../utils/precisionUtils.js';
import { loadPdfLibs, loadImg, drawStandardHeader } from './pdfBase.js';

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
  const flagDataUrl = (await loadImg(await fetchFlagDataUrl(cc)))?.dataUrl;
  const clubLogoUrl = getClubLogoUrl(eq?.clubName);
  const clubLogo = await loadImg(clubLogoUrl); // {dataUrl, w, h}

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
      ['Rivningar (port nr)', data.display.knocksText || '—'],
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
    promises.push(loadImg(url).then(res => {
      if (res?.dataUrl) assetMap.set(`club_${club}`, res.dataUrl);
    }));
  }
  await Promise.all(promises);

  let y = drawStandardHeader(doc, competition, "PRECISION – RESULTATLISTA", srfLogo, 30, 40);

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
  const placeMap = buildPlaceMap(equipages, precisionMap, config);

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

export async function generatePrecisionOfficialsPdf(equipages, precisionConfig, startTimes, competition) {
  await loadPdfLibs();
  const { jsPDF } = window.jspdf;
  if (!jsPDF) { alert('Kunde inte ladda PDF-biblioteket.'); return; }

  // Filtrera bort strukna
  const activeEquipages = equipages.filter(e => e.status !== 'struken');

  const srfLogo = await loadImg('/assets/logos/SRF.png');

  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt' });
  const pageWidth = doc.internal.pageSize.getWidth();

  let y = drawStandardHeader(doc, competition, "FUNKTIONÄRSLISTA – PRECISION", srfLogo, 30, 40);
  y += 5;

  // -- DATA --
  const rows = [...activeEquipages].sort((a, b) => (a.startNumber || 0) - (b.startNumber || 0));

  const head = [['Start', '#', 'Kusk / Häst', 'Kat', 'Vagn', 'Tillägg', 'Port', 'Maxtid']];

  const body = rows.map(eq => {
    // Starttid
    const stdStart = startTimeFor(eq.startNumber, startTimes);

    // Maxtid
    const maxSec = computeMaxSecondsForClass(eq.className, precisionConfig);
    const maxTimeLabel = maxSec ? `${Math.floor(maxSec / 60)}:${String(maxSec % 60).padStart(2, '0')}` : '-';

    // Bredder
    const trackW = trackWidthFromEq(eq);
    const portW = computePortWidth(eq, precisionConfig);
    const allowW = portW && trackW ? (portW - trackW) : null;

    // Kategori
    let cat = '-';
    if (eq.horses && eq.horses.length > 0) {
      const types = [...new Set(eq.horses.map(h => h.type).filter(Boolean))];
      if (types.length > 0) {
        cat = types.join(', ');
      }
    }

    return [
      stdStart,
      eq.startNumber,
      `${eq.driverName}\n${eq.clubName || ''}`,
      cat,
      trackW ? `${trackW} cm` : '-',
      allowW ? `+${allowW} cm` : '-',
      portW ? `${portW} cm` : '-',
      maxTimeLabel
    ];
  });

  doc.autoTable({
    startY: y,
    head: head,
    body: body,
    theme: 'grid',
    styles: { fontSize: 10, cellPadding: 4 },
    headStyles: { fillColor: [50, 50, 50], textColor: 255 },
    columnStyles: {
      0: { fontStyle: 'bold', halign: 'center', cellWidth: 40 }, // Start
      1: { halign: 'center', cellWidth: 30 }, // #
      2: { cellWidth: 160 }, // Kusk
      3: { halign: 'center', cellWidth: 50 }, // Kat
      4: { halign: 'center' }, // Vagn
      5: { halign: 'center' }, // Tillägg
      6: { halign: 'center', fontStyle: 'bold', fillColor: [240, 240, 240] }, // Port
      7: { halign: 'center' }  // Maxtid
    }
  });

  const filename = `funktionarslista_precision.pdf`;
  doc.save(filename);
}

// Helper for formatting seconds to MM:SS
function secondsToMMSS(seconds) {
  if (isNaN(seconds) || seconds < 0) return "--:--";
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Generates a PDF listing all classes with their obstacles and the effective
 * gate width (standard allowance ± per-obstacle delta) for each obstacle.
 * Used on the precision-admin page.
 */
export async function generatePrecisionCourseSetupPdf(precisionConfig, equipages, competition) {
  await loadPdfLibs();
  const { jsPDF } = window.jspdf;
  if (!jsPDF) { alert('Kunde inte ladda PDF-biblioteket.'); return; }

  const srfLogo = await loadImg('/assets/logos/SRF.png');

  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt' });
  const pageW = doc.internal.pageSize.getWidth();
  const mx = 40;
  
  let y = drawStandardHeader(doc, competition, "PRECISION – BANA & PORTAR PER KLASS", srfLogo, 30, 40);
  y += 5;

  // Derive allClasses from equipages
  const allClasses = [...new Set(equipages.map(e => {
    if (e.useMergedTestForDisplay && e.mergedTestLabel) {
      return e.mergedTestLabel;
    }
    return e.className;
  }).filter(Boolean))].sort();

  // --- ONE SECTION PER CLASS ---
  for (const className of allClasses) {
    const courseData = precisionConfig?.courses?.[className] || {};
    const labels = courseData.obstacleLabels || [];
    const specialPortAllowance = courseData.specialPortAllowance || {};
    const trackLength = courseData.trackLengthMeters || null;

    // Standard gate allowance for this class (manual override or TR default)
    const { getPortAllowanceCm } = await import('../utils/precisionUtils.js');
    const baseAllowanceCm = Number(precisionConfig?.portAllowanceByClass?.[className] ?? getPortAllowanceCm(className, precisionConfig) ?? 35);

    // Maxtid
    const { computeMaxSecondsForClass } = await import('../utils/precisionUtils.js');
    const maxSec = computeMaxSecondsForClass(className, precisionConfig);
    const maxTimeLabel = maxSec ? secondsToMMSS(maxSec) : '–';

    // Section heading
    if (y > doc.internal.pageSize.getHeight() - 80) { doc.addPage(); y = 40; }

    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text(className, mx, y);
    y += 4;

    // Small info line below heading
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(90, 90, 90);
    const infoLine = [
      trackLength ? `Banlängd: ${trackLength} m` : null,
      `Standardtillägg: +${baseAllowanceCm} cm`,
      maxTimeLabel !== '–' ? `Maxtid: ${maxTimeLabel}` : null
    ].filter(Boolean).join('   |   ');
    doc.text(infoLine, mx, y + 10);
    doc.setTextColor(0, 0, 0);
    y += 18;

    if (labels.length === 0) {
      doc.setFontSize(9);
      doc.setFont(undefined, 'italic');
      doc.setTextColor(130, 130, 130);
      doc.text('Inga hinder angivna för denna klass.', mx, y + 10);
      doc.setTextColor(0, 0, 0);
      y += 22;
    } else {
      // Build table rows
      const rows = labels.map((label, idx) => {
        const delta = specialPortAllowance[label];
        const hasDelta = Number.isFinite(Number(delta)) && Number(delta) !== 0;
        const effectiveAllowance = hasDelta ? baseAllowanceCm + Number(delta) : baseAllowanceCm;
        const deltaStr = hasDelta ? (Number(delta) > 0 ? `+${Number(delta)} cm` : `${Number(delta)} cm`) : '–';
        return [
          String(idx + 1),
          String(label),
          `+${baseAllowanceCm} cm`,
          deltaStr,
          { content: `+${effectiveAllowance} cm`, styles: { fontStyle: 'bold' } }
        ];
      });

      doc.autoTable({
        startY: y,
        head: [['Nr', 'Hinder', 'Standard', '± Avvikelse', 'Effektivt tillägg']],
        body: rows,
        theme: 'grid',
        styles: { fontSize: 9, cellPadding: 3 },
        headStyles: { fillColor: [220, 220, 220], textColor: [30, 30, 30], fontStyle: 'bold' },
        columnStyles: {
          0: { halign: 'center', cellWidth: 35 },
          1: { cellWidth: 'auto' }, // Allow obstacle label to scale
          2: { halign: 'center', cellWidth: 80 },
          3: { halign: 'center', cellWidth: 90 },
          4: { halign: 'center', cellWidth: 100 }
        },
        margin: { left: mx, right: mx },
        didParseCell: (data) => {
          // Highlight rows where the effective allowance differs from standard
          if (data.section === 'body' && data.column.index === 3 && data.cell.raw !== '–') {
            data.cell.styles.fillColor = [255, 252, 220]; // light yellow
          }
          if (data.section === 'body' && data.column.index === 4) {
            const label = labels[data.row.index];
            const delta = specialPortAllowance[label];
            if (Number.isFinite(Number(delta)) && Number(delta) !== 0) {
              data.cell.styles.fillColor = [220, 240, 255]; // light blue for changed ones
            }
          }
        }
      });
      y = doc.lastAutoTable.finalY + 16;
    }
  }

  const generated = `Genererad: ${new Date().toLocaleString('sv-SE')}`;
  doc.setFontSize(8);
  doc.setTextColor(140, 140, 140);
  doc.text(generated, pageW - mx, doc.internal.pageSize.getHeight() - 15, { align: 'right' });

  doc.save('precision_bana_portar.pdf');
}