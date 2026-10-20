// js/pdf/precisionPdf.js
import { normalizeCountryCode, fetchFlagDataUrl } from '../services/flagsService.js';
import { getClubLogoUrl, fetchImageDataUrl, ensureClubLogosLoaded } from '../services/logosService.js';
import { sanitizeForFilename, fmt2, horseLabel } from '../utils/sharedUtils.js';
import { getCalculatedRowData, buildPrecisionPlaceInfo, startTimeFor, computeMaxSecondsForClass, computePortWidth, trackWidthFromEq, getPortAllowanceCm, getStandardPortWidth, getPrecisionDisplayClassName, precisionFormatWarning } from '../utils/precisionUtils.js';
import { loadPdfLibs, loadImg, drawStandardHeader, drawResultStatusFooter, loadStandardHeaderLogos } from './pdfBase.js';
import { resolveResultListStatus } from './pdfResultStatus.js';
import { requiredForDiscipline } from './resultStatusUtils.js';
import { fitImageDimensions } from './pdfImageUtils.js';
import { resolvePdfCompetition, resolvePdfLanguage } from './pdfCompetitionUtils.js';
import { t } from '../utils/i18n.js';
import { formatPdfPenalty, isWithdrawnStatus } from './resultPdfFormatUtils.js';
import { getCompetitionLogoUrl } from '../utils/competitionLogo.js';
import {
  computePrecisionRoundMaxSec,
  getPrecisionFormat,
  getPrecisionRoundCourse,
  getPrecisionRoundObstacleLabels,
  getPrecisionRoundTempoMpm,
  isPrecisionDriveOffScheduled
} from '../utils/precisionCalculation.js';
import {
  bannerStartNumbersLabel,
  buildPrecisionBannerItems,
  formatPrecisionPlace,
  formatPrecisionRoundCell,
  isMultiRoundPrecisionFormat,
  precisionRoundCellPlain,
  precisionRoundColumns,
  precisionRoundLabel
} from '../pages/precision/precisionRoundsDisplay.js';

function formatPrecisionPdfTimeSeconds(timeMs, empty = '—') {
  const value = Number(timeMs);
  if (!Number.isFinite(value) || value < 0) return empty;
  return `${(value / 1000).toFixed(2).replace('.', ',')} s`;
}

// === HUVUDFUNKTION ===

export async function generateAndPrintPdf(eq, d, equipages, precisionMap, config, startTimes, competition) {
  const pdfCompetition = await resolvePdfCompetition(competition);
  await loadPdfLibs();
  const { jsPDF } = window.jspdf;
  if (!jsPDF) {
    alert('Kunde inte ladda PDF-biblioteket (jsPDF).');
    return;
  }

  // 1. FÖRBERED DATA
  const cc = normalizeCountryCode(eq?.country || eq?.nation || eq?.nationality) || 'se';
  const flagDataUrl = (await loadImg(await fetchFlagDataUrl(cc)))?.dataUrl;
  await ensureClubLogosLoaded();
  const clubLogoUrl = getClubLogoUrl(eq?.clubName);
  const clubLogo = await loadImg(clubLogoUrl); // {dataUrl, w, h}
  const competitionLogo = await loadImg(getCompetitionLogoUrl(pdfCompetition));

  // Hämta beräknad data
  const data = getCalculatedRowData(String(eq.startNumber), new Map(), equipages, precisionMap, config, startTimes);
  const allowLabel = data.display.allowLabel || '—';

  // 2. SKAPA PDF (Använd 'pt' för att matcha maraton-mallen)
  const pdf = new jsPDF({ unit: 'pt', compress: true });
  const mx = 40;
  let y = 40;

  // 3. LOGGA & HEADER (Samma logik som maraton)
  const headerLogo = competitionLogo || clubLogo;
  if (headerLogo?.dataUrl) {
    const { w: drawW, h: drawH } = fitImageDimensions(headerLogo, 110, 28);

    // Justera om den blir för bred
    const x = pdf.internal.pageSize.getWidth() - 40 - drawW;
    // Rita loggan lite högre upp för att linjera snyggt
    pdf.addImage(headerLogo.dataUrl, 'JPEG', x, y - (drawH * 0.6), drawW, drawH);
  }

  // Rubrik med flagga
  pdf.setFontSize(16);
  if (flagDataUrl) {
    pdf.addImage(flagDataUrl, 'JPEG', mx, y - 12, 24, 15);
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
      ['Tid', `${data.display.timeLabel} (${formatPrecisionPdfTimeSeconds(data.timeMs ?? data.d?.timeMs)})`],
      ['Hinderstraff', formatPdfPenalty(data.obstaclePenalty, { eliminated: data.eliminated })],
      ['Tidsstraff', formatPdfPenalty(data.timePenalty, { eliminated: data.eliminated })],
      ['Övrigt straff', formatPdfPenalty(data.extraPenalty, { eliminated: data.eliminated })],
      [{ content: 'Totalt straff', styles: { fontStyle: 'bold' } }, { content: formatPdfPenalty(data.totalPenalty, { eliminated: data.eliminated }), styles: { fontStyle: 'bold' } }],
    ],
    ...commonTableOpts
  });
  y = pdf.lastAutoTable.finalY + 12;

  // 4b. Phase 2 / drive-off of the class (the summary above is phase 1 / the initial round)
  const eqFormat = getPrecisionFormat(eq, config);
  const roundRows = ['phase2', 'driveOff']
    .filter(round => data.rounds?.[round])
    .map(round => {
      const cell = formatPrecisionRoundCell(data.rounds[round]);
      const timeMs = data.rounds[round].timeMs;
      return [
        precisionRoundLabel(round, eqFormat),
        precisionRoundCellPlain(cell),
        Number.isFinite(timeMs) && timeMs > 0 ? formatPrecisionPdfTimeSeconds(timeMs) : '—'
      ];
    });
  if (roundRows.length > 0) {
    pdf.autoTable({
      startY: y,
      head: [[t('precision_round_driven'), t('rank'), t('time')]],
      body: roundRows,
      ...commonTableOpts
    });
    y = pdf.lastAutoTable.finalY + 12;
  }

  // 5. TABELL 2: DETALJER & BANA
  const trackW = trackWidthFromEq(eq);
  const stdW = getStandardPortWidth(eq, config);
  const portW = data.display.portWidth || computePortWidth(eq, config);
  const effectiveAllowLabel = Number.isFinite(stdW) && stdW > 0 ? 'Standardbredd (fast)' : allowLabel;

  pdf.autoTable({
    startY: y,
    head: [['Detaljer', 'Värde']],
    body: [
      ['Spårvidd (vagn)', trackW ? `${trackW} cm` : '—'],
      ['Portbredd (konor)', portW ? `${portW} cm` : '—'],
      ['Porttillägg (klass)', effectiveAllowLabel],
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
    y = pdf.lastAutoTable.finalY + 12;
  }

  // 7. TABELL 4: PASSERTIDER
  const splits = d.gateSplits || {};
  const splitKeys = Object.keys(splits).filter(k => k === 'start' || k === 'finish' || k.startsWith('gate_'))
    .sort((a, b) => {
      if (a === 'start') return -1;
      if (b === 'start') return 1;
      if (a === 'finish') return 1;
      if (b === 'finish') return -1;
      return (parseInt(a.replace('gate_', '')) || 0) - (parseInt(b.replace('gate_', '')) || 0);
    });

  if (splitKeys.length > 0) {
    const startAbs = splits['start'] || d.liveStartEpoch;
    const splitRows = splitKeys.map(k => {
      let label = k;
      if (label === 'start') label = 'Start';
      else if (label === 'finish') label = 'Mål';
      else label = 'Gate ' + label.replace('gate_', '');

      let timeStr = '';
      if (k === 'start' || !startAbs) {
        timeStr = 'kl. ' + new Date(splits[k]).toLocaleTimeString('sv-SE', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      } else {
        const elapsed = Math.max(0, splits[k] - startAbs);
        const m = Math.floor(elapsed / 60000);
        const s = Math.floor((elapsed % 60000) / 1000);
        const ds = Math.floor((elapsed % 1000) / 100);
        timeStr = `+${m > 0 ? m + ':' : ''}${String(s).padStart(m > 0 ? 2 : 1, '0')},${ds}s`;
      }
      return [label, timeStr];
    });

    pdf.autoTable({
      startY: y,
      head: [['Passering', 'Tid']],
      body: splitRows,
      ...commonTableOpts
    });
    y = pdf.lastAutoTable.finalY + 12;
  }

  // 8. SPARA FIL
  const driverNameSanitized = sanitizeForFilename(eq.driverName || '');
  const filename = `precisionprotokoll_${eq.startNumber}_${driverNameSanitized}.pdf`;
  pdf.save(filename);
}

// Helper to get judge names from config or return default
function getJudgesList(config) {
  return [];
}

// options.placeMap: places set over the whole field when equipages is a
// filtered list (a search must not change the places); options.provisional
// (Set of start numbers) and options.context (precisionGroupContext) come with it
export async function generatePrecisionListPdf(equipages, precisionMap, config, startTimes, competition, options = {}) {
  await loadPdfLibs();
  const { jsPDF } = window.jspdf;
  if (!jsPDF) { alert('Kunde inte ladda PDF-biblioteket.'); return; }

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();

  const srfLogo = await loadStandardHeaderLogos(competition);

  // -- PRE-LOAD ASSETS FOR EQUIPAGES --
  const neededFlags = new Set();
  const neededClubs = new Set();
  equipages.forEach(eq => {
    neededFlags.add(normalizeCountryCode(eq.country || eq.nation || 'se'));
    if (eq.clubName) neededClubs.add(eq.clubName);
  });

  await ensureClubLogosLoaded();
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

  // English for international competitions (flag in config/competitionMeta)
  const { isInt } = await resolvePdfLanguage(competition);
  // Official when every result on the list is finalized (or archived)
  const resultStatus = await resolveResultListStatus(competition, {
    required: requiredForDiscipline('precision', equipages.filter(eq => !isWithdrawnStatus(eq.status)).map(eq => eq.startNumber))
  });
  let y = drawStandardHeader(doc, competition, t('pdf_precision_results_title', isInt), srfLogo, 30, 40, { resultStatus, isInt });

  // Officials / Judges (Below grey bar, Left aligned)
  y += 35;
  const judges = getJudgesList(config);
  if (judges.length > 0) {
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.text(`${t('pdf_judges', isInt)}: ${judges.join(', ')}`, 40, y);
    y += 15;
  }

  doc.setFont(undefined, 'normal'); // Reset font for table

  // Classes whose precision format the program does not calculate: no places
  const formatWarnings = [...new Set(equipages
    .filter(eq => !isWithdrawnStatus(eq.status))
    .map(eq => {
      const warning = precisionFormatWarning(eq, config, { en: isInt });
      return warning ? `${eq._mergedLabel || eq.className || ''}: ${warning}` : '';
    })
    .filter(Boolean))];
  if (formatWarnings.length > 0) {
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(150, 80, 0);
    formatWarnings.forEach(text => {
      const lines = doc.splitTextToSize(text, pageWidth - 80);
      doc.text(lines, 40, y);
      y += 12 * lines.length;
    });
    doc.setTextColor(0, 0, 0);
    doc.setFont(undefined, 'normal');
    y += 4;
  }

  const printableEquipages = equipages.filter(eq => !isWithdrawnStatus(eq.status));
  // Calculate placements on the same printable set, so withdrawn rows do not affect places.
  const placeInfo = options.placeMap
    ? { placeMap: options.placeMap, provisional: options.provisional || new Set(), context: options.context || null }
    : buildPrecisionPlaceInfo(printableEquipages, precisionMap, config);
  const placeMap = placeInfo.placeMap;
  const tr = (key) => t(key, isInt);

  // Two phases / drive-off: extra round columns after the total (phase 1 /
  // the initial round stays in the columns before)
  const formats = printableEquipages.map(eq => getPrecisionFormat(eq, config));
  const anyMultiRound = formats.some(isMultiRoundPrecisionFormat);
  const roundHeads = [];
  if (formats.includes('twoPhase')) roundHeads.push({ round: 'phase2', label: tr('precision_round_phase2') });
  if (printableEquipages.some(eq => isPrecisionDriveOffScheduled(eq, config))) roundHeads.push({ round: 'driveOff', label: tr('precision_round_driveoff') });

  // Drive-off pending (provisional places) and engine warnings, above the table
  const bannerItems = buildPrecisionBannerItems(printableEquipages.map(eq => ({
    label: eq._mergedLabel || eq.className || '',
    startNumber: eq.startNumber,
    ctx: placeInfo.context ? placeInfo.context.contextOf(eq) : null,
    formatWarnings: getCalculatedRowData(String(eq.startNumber), placeMap, equipages, precisionMap, config, startTimes).formatWarnings || []
  })), { tr });
  if (bannerItems.length > 0) {
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(150, 80, 0);
    const pending = bannerItems.filter(item => item.kind === 'pending');
    const lines = [];
    if (pending.length) lines.push(`${tr('precision_provisional_banner')}: ${pending.map(item => item.label).join(', ')}. ${tr('precision_provisional_note')}`);
    bannerItems.filter(item => item.kind === 'warning').forEach(item => {
      lines.push(`${item.label}: ${item.text}${bannerStartNumbersLabel(item)}`);
    });
    lines.forEach(text => {
      const wrapped = doc.splitTextToSize(text, pageWidth - 80);
      doc.text(wrapped, 40, y);
      y += 12 * wrapped.length;
    });
    doc.setTextColor(0, 0, 0);
    doc.setFont(undefined, 'normal');
    y += 4;
  }

  // UPDATED HEADER with START column
  const head = [[
    t('rank', isInt), '#', `${t('driver', isInt)} / ${t('horse', isInt)}`, t('class', isInt),
    t('pdf_country_club', isInt), t('start', isInt), t('pdf_time_seconds', isInt),
    t('obstacles', isInt), t('pdf_time_faults', isInt),
    anyMultiRound ? tr('precision_total_phase1') : t('total', isInt),
    ...roundHeads.map(h => h.label)
  ]];

  const body = printableEquipages.map(eq => {
    const sn = String(eq.startNumber);
    const row = getCalculatedRowData(sn, placeMap, equipages, precisionMap, config, startTimes);
    const isElim = row.eliminated || row.d?.eliminated;
    const provisionalPlace = placeInfo.provisional?.has(sn) === true;

    return [
      row.place ? formatPrecisionPlace(row.place, provisionalPlace) : '–',
      eq.startNumber,
      `${eq.driverName || ''}\n${horseLabel(eq)}`,
      eq._mergedLabel || eq.className || '',
      eq.clubName || '',
      row.startT || '–', // Start time column
      // The engine's time: hundredths, with +10 s per obstacle rebuild
      `${row.display?.timeLabel ?? '—'}\n${formatPrecisionPdfTimeSeconds(row.timeMs ?? row.d?.timeMs)}`,
      formatPdfPenalty(row.obstaclePenalty, { eliminated: isElim }),
      formatPdfPenalty(row.timePenalty, { eliminated: isElim }),
      { content: formatPdfPenalty(row.totalPenalty, { eliminated: isElim }), styles: { fontStyle: 'bold' } },
      ...roundHeads.map(h => ({
        content: precisionRoundCellPlain(formatPrecisionRoundCell(row.rounds?.[h.round] ?? null, { tr }), { sep: '\n' }),
        styles: { halign: 'center' }
      }))
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
        const eq = printableEquipages[data.row.index];
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
          doc.addImage(flagUrl, 'JPEG', xPos, yPos + (clubLogoHeight - flagHeight) / 2, flagWidth, flagHeight);
          xPos += flagWidth + 4;
        }

        // Draw Club Logo
        if (clubUrl) {
          doc.addImage(clubUrl, 'JPEG', xPos, yPos, clubLogoWidth, clubLogoHeight);
        }
      }
    }
  });

  // Which round counts for the combined total (two phases / drive-off)
  if (anyMultiRound) {
    let noteY = doc.lastAutoTable.finalY + 14;
    if (noteY > doc.internal.pageSize.getHeight() - 60) { doc.addPage(); noteY = 40; }
    doc.setFontSize(8);
    doc.setFont(undefined, 'italic');
    doc.setTextColor(90, 90, 90);
    doc.text(tr('precision_total_footnote'), 40, noteY);
    doc.setTextColor(0, 0, 0);
    doc.setFont(undefined, 'normal');
  }

  drawResultStatusFooter(doc, resultStatus, { isInt });
  doc.save('precision_resultatlista.pdf');
}

export async function generatePrecisionOfficialsPdf(equipages, precisionConfig, startTimes, competition) {
  await loadPdfLibs();
  const { jsPDF } = window.jspdf;
  if (!jsPDF) { alert('Kunde inte ladda PDF-biblioteket.'); return; }

  // Filtrera bort strukna
  const activeEquipages = equipages.filter(e => !isWithdrawnStatus(e.status));

  const srfLogo = await loadStandardHeaderLogos(competition);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', compress: true });
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
    const maxSec = computeMaxSecondsForClass(eq, precisionConfig);
    const maxTimeLabel = maxSec ? `${Math.floor(maxSec / 60)}:${String(maxSec % 60).padStart(2, '0')}` : '-';

    // Bredder
    const trackW = trackWidthFromEq(eq);
    const portW = computePortWidth(eq, precisionConfig);
    const stdW = getStandardPortWidth(eq, precisionConfig);
    let allowLabel = '-';
    if (Number.isFinite(stdW) && stdW > 0) {
      allowLabel = 'Standard';
    } else {
      const allowCm = getPortAllowanceCm(eq, precisionConfig);
      if (Number.isFinite(allowCm)) {
        allowLabel = `+${allowCm} cm`;
      } else if (portW && trackW) {
        allowLabel = `+${portW - trackW} cm`;
      }
    }

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
      `${eq.driverName || ''}\n${eq.clubName || ''}`,
      cat,
      trackW ? `${trackW} cm` : '-',
      allowLabel,
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

// Obstacle table (nr, label, standard, deviation, effective allowance) of one course
function drawObstacleTable(doc, y, mx, labels, specialPortAllowance, baseAllowanceCm, emptyText = 'Inga hinder angivna för denna klass.') {
  if (!labels || labels.length === 0) {
    doc.setFontSize(9);
    doc.setFont(undefined, 'italic');
    doc.setTextColor(130, 130, 130);
    doc.text(emptyText, mx, y + 10);
    doc.setTextColor(0, 0, 0);
    return y + 22;
  }
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
      1: { cellWidth: 'auto' },
      2: { halign: 'center', cellWidth: 80 },
      3: { halign: 'center', cellWidth: 90 },
      4: { halign: 'center', cellWidth: 100 }
    },
    margin: { left: mx, right: mx },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 3 && data.cell.raw !== '–') {
        data.cell.styles.fillColor = [255, 252, 220]; // light yellow
      }
      if (data.section === 'body' && data.column.index === 4) {
        const label = labels[data.row.index];
        const delta = specialPortAllowance[label];
        if (Number.isFinite(Number(delta)) && Number(delta) !== 0) {
          data.cell.styles.fillColor = [220, 240, 255]; // light blue
        }
      }
    }
  });
  return doc.lastAutoTable.finalY + 16;
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

  const srfLogo = await loadStandardHeaderLogos(competition);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const mx = 40;

  let y = drawStandardHeader(doc, competition, "PRECISION – BANA & PORTAR PER KLASS", srfLogo, 30, 40);
  y += 5;

  const classGroups = new Map();
  equipages.forEach(eq => {
    const label = getPrecisionDisplayClassName(eq);
    if (!label) return;
    if (!classGroups.has(label)) classGroups.set(label, { label, sourceClasses: new Set(), equipages: [] });
    const group = classGroups.get(label);
    group.equipages.push(eq);
    if (eq.className) group.sourceClasses.add(eq.className);
  });
  const allClasses = Array.from(classGroups.values())
    .map(group => ({ ...group, sourceClasses: Array.from(group.sourceClasses).sort() }))
    .sort((a, b) => a.label.localeCompare(b.label, 'sv'));

  // --- ONE SECTION PER CLASS ---
  for (const group of allClasses) {
    const className = group.label;
    const sourceClasses = group.sourceClasses.length ? group.sourceClasses : [className];
    const courseData = precisionConfig?.courses?.[className]
      || sourceClasses.map(sourceClassName => precisionConfig?.courses?.[sourceClassName]).find(Boolean)
      || {};
    const labels = courseData.obstacleLabels || [];
    const specialPortAllowance = courseData.specialPortAllowance || {};
    const trackLength = courseData.trackLengthMeters || null;

    // Standard gate allowance for this class (manual override or TR default)
    const baseAllowanceCm = Number(precisionConfig?.portAllowanceByClass?.[className] ?? getPortAllowanceCm(className, precisionConfig) ?? 35);

    // Maxtid
    const maxTimeLabels = sourceClasses.map(sourceClassName => {
      const eqForClass = group.equipages.find(eq => eq.className === sourceClassName) || { className: sourceClassName };
      const maxSec = computeMaxSecondsForClass(eqForClass, precisionConfig);
      return maxSec ? `${sourceClassName}: ${secondsToMMSS(maxSec)}` : null;
    }).filter(Boolean);
    const maxTimeLabel = maxTimeLabels.length === 1
      ? maxTimeLabels[0].replace(/^[^:]+:\s*/, '')
      : maxTimeLabels.join('   |   ');

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
      maxTimeLabel ? `Maxtid: ${maxTimeLabel}` : null
    ].filter(Boolean).join('   |   ');
    
    const lines = doc.splitTextToSize(infoLine, pageW - mx * 2);
    doc.text(lines, mx, y + 10);
    doc.setTextColor(0, 0, 0);
    y += 10 + (lines.length * 12);

    y = drawObstacleTable(doc, y, mx, labels, specialPortAllowance, baseAllowanceCm);

    // Phase 2 and the drive-off have their own course, tempo and max time
    const repEq = group.equipages.find(eq => eq.className === sourceClasses[0]) || group.equipages[0] || { className: sourceClasses[0] };
    const format = getPrecisionFormat(repEq, precisionConfig);
    if (isMultiRoundPrecisionFormat(format)) {
      const rounds = precisionRoundColumns(format, { driveOffScheduled: isPrecisionDriveOffScheduled(repEq, precisionConfig) })
        .filter(col => col.round !== 'phase1');
      for (const { round } of rounds) {
        const roundCourse = getPrecisionRoundCourse(repEq, precisionConfig, round) || {};
        const roundLabels = getPrecisionRoundObstacleLabels(repEq, precisionConfig, round);
        // A drive-off without its own length is driven over the phase-1 course
        const roundLength = Number(roundCourse.trackLengthMeters ?? roundCourse.length ?? roundCourse.trackLength) > 0
          ? Number(roundCourse.trackLengthMeters ?? roundCourse.length ?? roundCourse.trackLength)
          : (round === 'driveOff' ? trackLength : null);
        const tempo = getPrecisionRoundTempoMpm(repEq, precisionConfig, round);
        const maxSec = computePrecisionRoundMaxSec(repEq, precisionConfig, round);

        if (y > doc.internal.pageSize.getHeight() - 90) { doc.addPage(); y = 40; }
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.text(`${className} – ${precisionRoundLabel(round, format)}`, mx, y + 4);
        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(90, 90, 90);
        const roundInfo = [
          roundLength ? `${t('track_len')}: ${roundLength} m` : null,
          tempo ? `${t('tempo')}: ${tempo} m/min` : null,
          maxSec ? `${t('max_time')}: ${secondsToMMSS(maxSec)}` : null
        ].filter(Boolean).join('   |   ');
        const roundLines = doc.splitTextToSize(roundInfo || '–', pageW - mx * 2);
        doc.text(roundLines, mx, y + 16);
        doc.setTextColor(0, 0, 0);
        y += 16 + roundLines.length * 12;
        y = drawObstacleTable(doc, y, mx, roundLabels, roundCourse.specialPortAllowance || {}, baseAllowanceCm, t('precision_pdf_round_no_obstacles'));
      }
    }
  }

  const generated = `Genererad: ${new Date().toLocaleString('sv-SE')}`;
  doc.setFontSize(8);
  doc.setTextColor(140, 140, 140);
  doc.text(generated, pageW - mx, doc.internal.pageSize.getHeight() - 15, { align: 'right' });

  doc.save('precision_bana_portar.pdf');
}
