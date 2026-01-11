// js/pdf/dressagePdf.js
// Ansvar: skapa dressyr-PDF för ett ekipage (identisk layout/beräkning som tidigare)

import { getGlobalState } from '../main.js';
import { getDressageResultsForEquipage } from '../services/firestoreService.js';
import { ensureClubLogosLoaded, getClubLogoUrl } from '../services/logosService.js';
import { normalizeCountryCode, fetchFlagDataUrl } from '../services/flagsService.js';
import {
  getPrograms,
  getDressagePenaltyCoeff,
  fmtPct,
  fmtNum,
  getMomentHorseLabel
} from '../utils/dressageUtils.js';
import { isPrivileged } from '../utils/sharedUtils.js';

// --- Providers bridge (valfritt men praktiskt) ---
async function loadPdfLibs() {
  if (window.jspdf && window.jspdf.jsPDF) return;
  // Fallback om de inte finns laddade globalt
  await import("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
  await import("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js");
}

let __pdfProviders = null;
export function injectProviders(p) {
  __pdfProviders = p || null;
}

// === UTIL (flyttat hit oförändrat) ===
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

// === Publik API ===
export async function generateDressagePdf(startNumber, processedResultsRef, opts) {

  const sn = String(startNumber);

  const providers = opts?.providers || __pdfProviders || null;
  const programs = providers?.getPrograms?.() || (typeof getPrograms === 'function' ? getPrograms() : null) || window.dressagePrograms || {};

  // processedResultsRef: arrayen från sidan (för att slå upp raden snabbt)
  const jsPDFCtor = (window?.jspdf && window.jspdf.jsPDF) || window.jsPDF;
  if (typeof jsPDFCtor !== 'function') { alert('PDF-biblioteket (jsPDF) kunde inte laddas.'); return; }
  const pdf = new jsPDFCtor({ unit: 'pt' });
  if (typeof pdf.autoTable !== 'function') { alert('AutoTable-plugin saknas (pdf.autoTable).'); return; }

  let data = (processedResultsRef || []).find(r => String(r.startNumber) === sn);

  // Fallback: bygg data från providers om resultats-listan saknas i monitorläget
  if (!data && providers) {
    // Minimal packning för PDF: driver/klubb/klass/hästar + domarrörelser
    const eq = providers?.getEquipage?.(sn) || {};
    const st = providers?.getStatus?.(sn) || {};
    const prog = providers?.getProgramForEq?.(sn) || null;

    data = {
      startNumber: sn,
      driverName: eq.driverName || eq.kusk || eq.driver || '',
      clubName: eq.clubName || eq.klubb || '',
      className: eq._mergedLabel || eq.className || '',
      country: eq.country || 'SE',
      testKey: st?.testKey || st?.programKey || prog?.id || prog?.key || null,
      judges: {}
    };

    const saved = providers?.getSavedProtocols?.(sn) || [];
    for (const proto of saved) {
      const jid = proto.judgeId || proto.id || proto.position || 'C';
      const movements = Array.isArray(proto.movements) ? proto.movements : [];
      data.judges[jid] = {
        id: jid,
        position: (proto.position || jid || 'C').toUpperCase(),
        name: proto.judgeName || proto.name || jid,
        movements: movements.map(m => ({
          momentNo: Number(m.momentNo ?? m.movementNo ?? m.no),
          score: (m.score !== '' && m.score != null) ? Number(m.score) : null,
          comment: (m.comment || '').trim()
        })).filter(x => Number.isFinite(x.momentNo))
      };
    }
  }

  if (!data) {
    throw new Error('Kunde inte hitta data för ekipaget.');
  }

  await ensureClubLogosLoaded();
  const program = (data?.testKey && programs[data.testKey]) ? programs[data.testKey] : null;
  if (!program) {
    // sista chans: mappa via label om testKey saknas
    // sista chans: mappa via label om testKey saknas
    const lbl = (data?._mergedLabel || data?.className || '');
    const mapped = (window.klassProgramMapping && (
      window.klassProgramMapping[data?.originalClassName] ||
      window.klassProgramMapping[data?.className] ||
      window.klassProgramMapping[lbl]
    ));
    if (mapped && programs[mapped]) {
      data.testKey = mapped;
      // eslint-disable-next-line no-var
      var programFallback = programs[mapped];
    }
  }
  const effectiveProgram = program || programFallback || null;
  if (!effectiveProgram || !Array.isArray(effectiveProgram.movements)) {
    throw new Error('Dressyrprogram saknas – kan inte skapa PDF.');
  }

  const [srfLogo, flagImg, clubImg] = await Promise.all([
    fetchImageDataUrl('/assets/logos/SRF.png'),
    fetchFlagDataUrl(normalizeCountryCode(data.country) || 'se'),
    fetchImageDataUrl(getClubLogoUrl(data.clubName))
  ]);

  const PAGE_W = pdf.internal.pageSize.getWidth();
  const PAGE_H = pdf.internal.pageSize.getHeight();
  const mx = 40; // marginal

  // Sortera domare enligt C,E,B,H,M, filtrera så att de har rörelser
  const order = { C: 0, E: 1, B: 2, H: 3, M: 4 };
  const judgesWithProtocols = (data.__judgesPresent || [])
    .filter(j => data.judges?.[j.id]?.movements?.length > 0)
    .sort((a, b) => (order[a.position] ?? 99) - (order[b.position] ?? 99));

  // Sidor per domare
  for (let i = 0; i < judgesWithProtocols.length; i++) {
    const judge = judgesWithProtocols[i];
    const jr = data.judges[judge.id];
    if (!jr) continue;
    if (i > 0) pdf.addPage();

    let y = 45;
    if (srfLogo?.dataUrl) {
      const maxH = 70, ratio = srfLogo.w / srfLogo.h || 1;
      pdf.addImage(srfLogo.dataUrl, 'PNG', PAGE_W - mx - maxH * ratio, y - 20, maxH * ratio, maxH);
    }
    pdf.setFontSize(16).setFont(undefined, 'bold');
    let currentX = mx;
    if (flagImg) { pdf.addImage(flagImg, 'PNG', currentX, y - 12, 24, 15); currentX += 30; }
    if (clubImg?.dataUrl) { const mh = 20, r = (clubImg.w || 1) / (clubImg.h || 1); pdf.addImage(clubImg.dataUrl, 'PNG', currentX, y - 15, mh * r, mh); currentX += mh * r + 8; }
    pdf.text(`Dressyr – #${data.startNumber} ${data.driverName || ''}`, currentX, y);
    y += 18;
    pdf.setFontSize(10).setFont(undefined, 'normal');

    const horses = getMomentHorseLabel(data);
    if (horses && horses !== '—') { pdf.text(horses, mx, y); y += 12; }
    pdf.text(`${data._mergedLabel || data.className || ''} || ${data.clubName || ''}`, mx, y); y += 25;

    const maxScore = (effectiveProgram.movements || []).reduce((s, m) => s + 10 * (m.coeff || 1), 0);
    const penaltyCoeff = getDressagePenaltyCoeff(effectiveProgram);
    const today = new Date().toLocaleDateString('sv-SE');
    const headerInfo = [
      [{ content: 'Domare:', styles: { fontStyle: 'bold' } }, `${judge.position} – ${judge.name}`],
      [{ content: 'Datum:', styles: { fontStyle: 'bold' } }, today],
      [{ content: 'Program:', styles: { fontStyle: 'bold' } }, `${effectiveProgram.name || ''} (Maxpoäng: ${maxScore})`],
      [{ content: 'Straffpoängskoefficient:', styles: { fontStyle: 'bold' } }, penaltyCoeff.toFixed(2)],
    ];
    pdf.autoTable({ startY: y, body: headerInfo, theme: 'plain', styles: { fontSize: 9, cellPadding: 2 }, columnStyles: { 0: { cellWidth: 140 } } });
    y = pdf.lastAutoTable.finalY + 15;

    const showComments = isPrivileged();

    let calculatedSum = 0;
    let calculatedMax = 0;

    const tableBody = (effectiveProgram.movements || []).map(moment => {
      const hit = (jr.movements || []).find(m => (m.momentNo ?? m.movementNo) === moment.no);
      const score = hit?.score;
      const c = Number(moment.coeff) || 1;
      calculatedMax += 10 * c;
      const scoreDisplay = (score != null) ? Number(score).toFixed(1) : '–';
      const rawRes = (score != null) ? (Number(score) * c) : null;
      const resultDisplay = (rawRes != null) ? rawRes.toFixed(1) : '–';

      if (rawRes != null) calculatedSum += rawRes;
      const comment = (hit?.comment || '').trim();

      const row = [
        { content: `${moment.no}. ${moment.text || ''}\n${moment.letters || ''}`, styles: { fontSize: 8 } },
        { content: moment.judge || '', styles: { fontSize: 8 } }
      ];

      if (showComments) {
        row.push({ content: comment, styles: { fontStyle: 'italic', textColor: '#555' } });
      }

      row.push({ content: scoreDisplay, styles: { halign: 'center', fontStyle: 'bold', fontSize: 10 } }); // Poäng kommer nu efter kommentar

      row.push({ content: resultDisplay, styles: { halign: 'center', fontStyle: 'bold', fontSize: 10 } });
      return row;
    });

    const headers = [['Moment', 'Att bedöma']];
    if (showComments) headers[0].push('Kommentar');
    headers[0].push('Poäng');
    headers[0].push('Resultat');

    const colStyles = {
      0: { cellWidth: 100 }, // Wider moment
      1: { cellWidth: 'auto' }
    };
    if (showComments) {
      colStyles[2] = { cellWidth: 150 }; // Wide comment
      colStyles[3] = { cellWidth: 40, halign: 'center' }; // Score
      colStyles[4] = { cellWidth: 40, halign: 'center' }; // Result
    } else {
      colStyles[2] = { cellWidth: 50, halign: 'center' }; // Score
      colStyles[3] = { cellWidth: 50, halign: 'center' }; // Result
    }

    pdf.autoTable({
      startY: y, head: headers, body: tableBody,
      theme: 'grid', styles: { fontSize: 9, cellPadding: 4, valign: 'middle' },
      headStyles: { fillColor: [243, 244, 246], textColor: '#000' },
      columnStyles: colStyles
    });
    y = pdf.lastAutoTable.finalY + 20;


    // Calculate final results for this judge based on the summed scores
    let totalPoints = 0, percent = 0, penalty = 0;
    if (!jr.eliminated) {
      totalPoints = calculatedSum;
      percent = calculatedMax > 0 ? (calculatedSum / calculatedMax) * 100 : 0;
      penalty = (calculatedMax - calculatedSum) * penaltyCoeff;
    }

    const summaryData = [
      ['Summa poäng:', jr.eliminated ? 'ELIM' : fmtNum(totalPoints)],
      ['Procent:', jr.eliminated ? 'ELIM' : fmtPct(percent)],
      [{ content: 'Straffpoäng:', styles: { fontStyle: 'bold' } }, { content: jr.eliminated ? 'ELIM' : fmtNum(penalty), styles: { fontStyle: 'bold' } }]
    ];
    // Check for space for the summary table
    if (y + 120 > PAGE_H) {
      pdf.addPage();
      y = 40;
    }

    pdf.autoTable({ startY: y, theme: 'plain', tableWidth: 200, body: summaryData });

    // Check for space for the signature
    let sigBaseY = pdf.lastAutoTable.finalY;
    if (sigBaseY + 80 > PAGE_H) {
      pdf.addPage();
      sigBaseY = 40;
    }

    const sigX = PAGE_W - mx - 200, sigY = sigBaseY + 40;
    pdf.line(sigX, sigY, PAGE_W - mx, sigY);
    pdf.setFontSize(9).text('Domarens underskrift', sigX, sigY + 12);
  }

  // Sammanställningssida (finns >1 domare)
  if (judgesWithProtocols.length > 1) {
    pdf.addPage();
    let y = 45;
    if (srfLogo?.dataUrl) {
      const maxH = 70, ratio = srfLogo.w / srfLogo.h || 1;
      pdf.addImage(srfLogo.dataUrl, 'PNG', PAGE_W - mx - maxH * ratio, y - 20, maxH * ratio, maxH);
    }
    pdf.setFontSize(16).setFont(undefined, 'bold');
    let currentX = mx;
    if (flagImg) { pdf.addImage(flagImg, 'PNG', currentX, y - 12, 24, 15); currentX += 30; }
    if (clubImg?.dataUrl) { const mh = 20, r = (clubImg.w || 1) / (clubImg.h || 1); pdf.addImage(clubImg.dataUrl, 'PNG', currentX, y - 15, mh * r, mh); currentX += mh * r + 8; }
    pdf.text(`Dressyr – #${data.startNumber} ${data.driverName || ''}`, currentX, y);
    y += 18; pdf.setFontSize(10);
    const horses = getMomentHorseLabel(data);
    if (horses && horses !== '—') { pdf.text(horses, mx, y); y += 12; }
    pdf.text(`${data.className || ''} • ${data.clubName || ''}`, mx, y); y += 25;

    const maxScore = (effectiveProgram.movements || []).reduce((s, m) => s + 10 * (m.coeff || 1), 0);
    const penaltyCoeff = getDressagePenaltyCoeff(program);
    const today = new Date().toLocaleDateString('sv-SE');
    const totalHeaderInfo = [
      [{ content: 'Sammanställning:', styles: { fontStyle: 'bold' } }, `Totalt för ${judgesWithProtocols.length} domare`],
      [{ content: 'Datum:', styles: { fontStyle: 'bold' } }, today],
      [{ content: 'Program:', styles: { fontStyle: 'bold' } }, `${effectiveProgram.name || ''} (Maxpoäng: ${maxScore})`],
      [{ content: 'Straffpoängskoefficient:', styles: { fontStyle: 'bold' } }, penaltyCoeff.toFixed(2)]
    ];
    pdf.autoTable({ startY: y, body: totalHeaderInfo, theme: 'plain', styles: { fontSize: 9, cellPadding: 2 }, columnStyles: { 0: { cellWidth: 140 } } });
    y = pdf.lastAutoTable.finalY + 15;

    let sum = 0;
    const totalBody = (effectiveProgram.movements || []).map(moment => {
      const scores = judgesWithProtocols.map(j => {
        const jr = data.judges[j.id];
        if (!jr || jr.eliminated) return null;
        const mv = (jr.movements || []).find(m => (m.momentNo ?? m.movementNo) === moment.no);
        return mv?.score;
      }).filter(s => s != null);
      const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length) : null;
      const res = (avg != null) ? avg * (moment.coeff || 1) : null;
      if (res != null) sum += res;
      return [
        { content: `${moment.no}. ${moment.text || ''}\n${moment.letters || ''}`, styles: { fontSize: 8 } },
        { content: moment.judge || '', styles: { fontSize: 8 } },
        { content: avg != null ? avg.toFixed(2) : '–', styles: { halign: 'center', fontStyle: 'bold', fontSize: 10 } },
        { content: res != null ? res.toFixed(2) : '–', styles: { halign: 'center', fontStyle: 'bold', fontSize: 10 } },
      ];
    });
    pdf.autoTable({
      startY: y, head: [['Moment', 'Att bedöma', 'Snittpoäng', 'Resultat']], body: totalBody,
      theme: 'grid', styles: { fontSize: 9, cellPadding: 4, valign: 'middle' },
      headStyles: { fillColor: [243, 244, 246], textColor: '#000' },
      columnStyles: { 0: { cellWidth: 125 }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 60, halign: 'center' }, 3: { cellWidth: 60, halign: 'center' } }
    });
    y = pdf.lastAutoTable.finalY + 20;

    const avgPercent = (maxScore && sum) ? (sum / (maxScore * judgesWithProtocols.length)) * 100 : 0;
    const finalPenalty = (maxScore * judgesWithProtocols.length - sum) * penaltyCoeff / judgesWithProtocols.length;

    const summary = [
      ['Sammanräknad totalpoäng:', data.eliminated ? 'ELIM' : sum.toFixed(1)],
      ['Snittprocent (alla domare):', data.eliminated ? 'ELIM' : fmtPct(avgPercent)],
      ['Felkörningspoäng:', (Number(data.errorPoints) || 0).toFixed(1)],
      [{ content: `Slutgiltigt straff (Plac. ${data.plac || '–'}):`, styles: { fontStyle: 'bold' } }, { content: data.eliminated ? 'ELIM' : fmtNum(finalPenalty), styles: { fontStyle: 'bold' } }]
    ];
    pdf.autoTable({ startY: y, theme: 'plain', body: summary });
  }
  pdf.save(`dressyrprotokoll_${sn}_${String(data.driverName || '').replace(/\s/g, '_')}.pdf`);
}

// NY: Generera resultatlista för dressyr (Landscape)
export async function generateDressageListPdf(equipages, currentClass, competition, judgesList) {
  await loadPdfLibs();
  const { jsPDF } = window.jspdf;
  if (!jsPDF) { alert('PDF-bibliotek kunde inte laddas.'); return; }

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt' });
  const pageWidth = doc.internal.pageSize.getWidth();

  // -- ASSET LOADING --
  const loadImg = async (path) => {
    try {
      const img = new Image();
      img.src = path;
      img.crossOrigin = 'Anonymous';
      await new Promise((r, e) => { img.onload = r; img.onerror = r; });
      if (!img.naturalWidth) return null;
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return { data: c.toDataURL('image/png'), w: img.naturalWidth, h: img.naturalHeight };
    } catch { return null; }
  };
  const srfLogo = await loadImg('/assets/logos/SRF.png');

  // -- HEADER --
  let y = 30;
  // 1. Logo
  if (srfLogo) {
    const h = 50; const w = h * (srfLogo.w / srfLogo.h);
    doc.addImage(srfLogo.data, 'PNG', 40, y, w, h);
  }

  // 2. Title Block
  const compName = competition?.name || 'Tävling';
  const compDate = competition?.dates || competition?.date || new Date().toLocaleDateString('sv-SE');

  // Location parts
  const locationPart = competition?.place || competition?.city || competition?.location || '';
  const organizerPart = competition?.club || competition?.organizerName || competition?.organizer || '';
  const parts = [locationPart, organizerPart].filter(p => p && p.trim());
  const locationLine = parts.length > 0 ? parts.join(' • ') : '';

  doc.setFontSize(20);
  doc.setFont(undefined, 'bold');
  doc.text(compName, pageWidth / 2, y + 15, { align: 'center' });

  doc.setFontSize(12);
  doc.setFont(undefined, 'normal');
  if (locationLine) {
    doc.text(locationLine, pageWidth / 2, y + 32, { align: 'center' });
    doc.text(compDate, pageWidth / 2, y + 44, { align: 'center' });
    y += 12;
  } else {
    doc.text(compDate, pageWidth / 2, y + 32, { align: 'center' });
  }

  // 3. Grey Bar
  y += 55;
  doc.setFillColor(230, 230, 230);
  doc.rect(40, y, pageWidth - 80, 20, 'F');
  doc.setFontSize(11);
  doc.setFont(undefined, 'bold');
  doc.text(`DRESSYR – RESULTATLISTA: ${currentClass || ''}`, pageWidth / 2, y + 14, { align: 'center' });

  // 4. Judges List
  // Clean judges list
  const activeJudges = Array.isArray(judgesList) ? judgesList : [];
  // Sort C, E, B, H, M (standard order if possible, or just as passed)
  const order = { C: 0, E: 1, B: 2, H: 3, M: 4 };
  activeJudges.sort((a, b) => (order[a.position] ?? 99) - (order[b.position] ?? 99));

  y += 30;
  doc.setFontSize(9);
  doc.setFont(undefined, 'normal');
  const judgesStr = activeJudges.map(j => `${j.position}: ${j.name}`).join('   ');
  if (judgesStr) {
    doc.text(`Domare: ${judgesStr}`, 40, y);
    y += 15;
  }

  // -- PRE-LOAD IMAGES --
  // Collect unique needs
  const neededFlags = new Set();
  const neededClubs = new Set();
  equipages.forEach(eq => {
    neededFlags.add(normalizeCountryCode(eq.country || 'se'));
    if (eq.clubName) neededClubs.add(eq.clubName);
  });

  // Fetch assets
  const assetMap = new Map(); // key -> dataUrl
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

  // Wait (with timeout to not block too long?)
  await Promise.all(promises);

  // -- TABLE --
  // Determine Columns
  // Standard: Plac, #, Kusk/Häst, Klass, Land/Klubb, Start, [Judge 1..N], Fel, %, Straff
  const headerRow = ['Plac', '#', 'Kusk / Häst', 'Klass', 'Land/Klubb', 'Start'];

  activeJudges.forEach(j => headerRow.push(j.position)); // Add header for each judge

  headerRow.push('Fel');
  headerRow.push('%');
  headerRow.push('Straff');

  const head = [headerRow];
  const colStyles = {
    0: { cellWidth: 25 },
    1: { cellWidth: 25 },
    2: { minCellWidth: 100 }, // Driver / Horse - auto width
    3: { minCellWidth: 80 },  // Klass - auto width
    4: { cellWidth: 160, cellPadding: { top: 3, bottom: 3, left: 35, right: 3 } }, // Land/Klubb
    5: { cellWidth: 35, halign: 'center' } // Starttime
  };

  // Dynamic judge columns start at index 6
  let colIdx = 6;
  activeJudges.forEach(() => {
    colStyles[colIdx] = { cellWidth: 30, halign: 'center' };
    colIdx++;
  });
  // Next cols
  colStyles[colIdx] = { cellWidth: 30, halign: 'center' }; // Fel
  colIdx++;
  colStyles[colIdx] = { cellWidth: 40, halign: 'center', fontStyle: 'bold' }; // %
  colIdx++;
  colStyles[colIdx] = { cellWidth: 45, halign: 'center', fontStyle: 'bold' }; // Straff

  const body = equipages.map(eq => {
    const penalty = Number.isFinite(eq.finalPenalty) ? eq.finalPenalty : eq.results?.dressage?.totalPenalty;
    const percent = Number.isFinite(eq.avgPercent) ? eq.avgPercent : eq.results?.dressage?.percent;
    const isElim = eq.eliminated;
    const errorPoints = (eq.errorPoints != null) ? eq.errorPoints : (eq.results?.dressage?.errorPoints || 0);

    // Format Start Time (HH:MM)
    let startStr = '';
    if (eq.startTime) {
      const d = new Date(String(eq.startTime).replace(' ', 'T'));
      if (!isNaN(d)) {
        startStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else {
        startStr = String(eq.startTime).substring(11, 16) || String(eq.startTime);
      }
    }

    const row = [
      eq.plac || '–',
      eq.startNumber || '',
      `${eq.driverName}\n${getMomentHorseLabel(eq)}`,
      eq.className || '',
      eq.clubName || '',
      startStr
    ];

    // Per Judge Scores
    activeJudges.forEach(j => {
      const jr = eq.judges ? eq.judges[j.id] : null;
      // Show points or percent? Usually points in summary list per judge?
      // Or percent per judge?
      // In the app list, chips show total points.
      // Let's show total points.
      if (jr && !jr.eliminated && jr.totalPoints != null) {
        row.push(Number(jr.totalPoints).toFixed(1));
      } else if (jr && jr.eliminated) {
        row.push('ELIM');
      } else {
        row.push('–');
      }
    });

    row.push(Number(errorPoints) > 0 ? Number(errorPoints).toFixed(1) : '');
    row.push(isElim ? 'ELIM' : (Number.isFinite(percent) ? percent.toFixed(2) + '%' : ''));
    row.push(isElim ? 'ELIM' : (Number.isFinite(penalty) ? penalty.toFixed(2) : ''));

    return row;
  });

  doc.autoTable({
    startY: y, // Removed + 35 since we updated y for judges
    head: head,
    body: body,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 3, valign: 'middle' },
    headStyles: { fillColor: [220, 220, 220], textColor: 20 },
    columnStyles: colStyles,
    margin: { left: 40, right: 40 },
    didDrawCell: (data) => {
      if (data.section === 'body' && data.column.index === 4) {
        const eq = equipages[data.row.index];
        if (!eq) return;

        const flagUrl = assetMap.get(`flag_${normalizeCountryCode(eq.country || 'se')}`);
        const clubUrl = assetMap.get(`club_${eq.clubName}`);

        let xPos = data.cell.x + 2; // Start 2pt from left edge of cell
        const yPos = data.cell.y + 2; // Fixed padding
        const flagHeight = 8;
        const flagWidth = 12;
        const clubLogoHeight = 12;
        const clubLogoWidth = 12;

        // Draw Flag
        if (flagUrl) {
          doc.addImage(flagUrl, 'PNG', xPos, yPos + (clubLogoHeight - flagHeight) / 2, flagWidth, flagHeight); // Vertically center flag with logo
          xPos += flagWidth + 4; // Advance xPos for next image/text, 4pt spacing
        }

        // Draw Club Logo
        if (clubUrl) {
          doc.addImage(clubUrl, 'PNG', xPos, yPos, clubLogoWidth, clubLogoHeight);
          xPos += clubLogoWidth + 4; // Advance xPos for text, 4pt spacing
        }
      }
    }
  });

  doc.save(`dressyr_resultat_${currentClass || 'lista'}.pdf`);
}
