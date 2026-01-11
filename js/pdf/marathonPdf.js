// js/pdf/marathonPdf.js
import { getGlobalState } from '../main.js';
import { getClubLogoUrl } from '../services/logosService.js';
import { normalizeCountryCode, fetchFlagDataUrl } from '../services/flagsService.js';
import {
  maraton_marathonConfig,
  stageStartTS,
  stageStopTS,
  stageDurationMsSaved,
  stagePenaltyFromMs,
  limitsFor,
  getObstacleArray,
  obstacleValues,
  formatMsLive,
  formatSec,
  signedSecLabel,
  toTimeLabel,
  pausedMsSince
} from '../utils/marathonUtils.js';

// === HJÄLPFUNKTIONER (Samma som i dressagePdf.js) ===

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

function sanitizeForFilename(name) {
  if (!name) return 'namnlos';
  return name.toLowerCase().replace(/\s+/g, '_').replace(/å/g, 'a').replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/[^a-z0-9_]/g, '');
}

function getMomentHorseLabel(equipage) {
  const allHorsesRaw = equipage.horses || equipage.horseNames || equipage.horse || [];
  let allHorses = [];
  if (Array.isArray(allHorsesRaw)) {
    allHorses = allHorsesRaw.map(h => (typeof h === 'string' ? { name: h } : h)).filter(h => h && h.name);
  } else if (typeof allHorsesRaw === 'string' && allHorsesRaw.trim()) {
    allHorses = allHorsesRaw.split(/[\/,&+]|(?:\s*&\s*)/).map(name => ({ name: name.trim() })).filter(h => h.name);
  }
  if (allHorses.length === 0) return '—';
  return allHorses.map(h => h.name).filter(Boolean).join(' & ');
}

// === LOKALA HELPERS FÖR PDF-TABELLER (Hämtar rådata från config) ===

function classSettingsFor(cls) {
  return maraton_marathonConfig?.marathonClassData?.[cls] || {};
}

function globalRules() {
  return {
    timePenaltyRate: maraton_marathonConfig?.timePenaltyRate ?? 0.25,
    knockdownPenaltyDefault: maraton_marathonConfig?.knockdownPenaltyDefault ?? 5,
    obstacleMaxTime: maraton_marathonConfig?.obstacleMaxTime ?? 300,
    pauseTime: maraton_marathonConfig?.pauseTime ?? null
  };
}

// === HUVUDFUNKTION ===

export async function printMarathonPdf(eq, d) {
  await loadPdfLibs();
  const { jsPDF } = window.jspdf;
  if (!jsPDF) { alert('Kunde inte ladda PDF-biblioteket.'); return; }

  const pdf = new jsPDF({ unit: 'pt' });
  const mx = 40;
  let y = 40;

  // Timing-objektet (kan ligga i 'd' eller separat, vi antar 'd' är komplett här via modalen)
  const t = d || {};
  const obstacles = getObstacleArray(d);

  // 1. LOGGOR & HEADER
  const cc = normalizeCountryCode(eq?.country || eq?.nation || eq?.nationality) || 'se';
  const flagDataUrl = await fetchFlagDataUrl(cc);
  const clubLogoUrl = getClubLogoUrl(eq?.clubName);
  const clubLogo = await fetchImageDataUrl(clubLogoUrl);

  if (clubLogo?.dataUrl) {
    const maxH = 28, maxW = 110;
    const ratio = clubLogo.w / clubLogo.h || 1;
    let drawH = maxH, drawW = Math.round(drawH * ratio);
    if (drawW > maxW) { drawW = maxW; drawH = Math.round(drawW / ratio); }
    const x = pdf.internal.pageSize.getWidth() - 40 - drawW;
    pdf.addImage(clubLogo.dataUrl, 'PNG', x, y - Math.round(drawH * 0.6), drawW, drawH);
  }

  pdf.setFontSize(16);
  if (flagDataUrl) {
    pdf.addImage(flagDataUrl, 'PNG', mx, y - 12, 24, 15);
    pdf.text(`Maraton – #${eq.startNumber} ${eq.driverName || ''}`, mx + 30, y);
  } else {
    pdf.text(`Maraton – #${eq.startNumber} ${eq.driverName || ''}`, mx, y);
  }
  y += 18;

  pdf.setFontSize(10);
  const horses = getMomentHorseLabel(eq);
  if (horses && horses !== '—') { pdf.text(`${horses}`, mx, y); y += 12; }
  pdf.text(`${eq._mergedLabel || eq.className || ''}${eq.clubName ? ' • ' + eq.clubName : ''}`, mx, y); y += 14;

  // Starttid & Status
  // Vi återskapar enkel statuslogik här för utskrift
  const hasStart = stageStartTS(t, 'A') || stageStartTS(t, 'T') || stageStartTS(t, 'B');
  const status = hasStart ? 'Startad' : 'Ej startat'; // Förenklad status för PDF
  pdf.text(`Status: ${status}`, mx, y);
  y += 10;

  if (!pdf.autoTable) { alert('AutoTable saknas.'); return; }
  const headStyle = { fillColor: [243, 244, 246], textColor: [55, 65, 81] };

  // 2. TABELL: GLOBALA REGLER
  const rules = globalRules();
  pdf.autoTable({
    startY: y,
    head: [['Regel', 'Värde']],
    body: [
      ['Straff/sekund', `${rules.timePenaltyRate} p/s`],
      ['KD-standard', `${rules.knockdownPenaltyDefault} s`],
      ['Max hindertid', `${rules.obstacleMaxTime} s`],
      ...(rules.pauseTime ? [['Paus mellan A/WU och B', `${rules.pauseTime} min`]] : [])
    ],
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: headStyle
  });
  y = pdf.lastAutoTable.finalY + 12;

  // 3. TABELL: KLASSPARAMETRAR
  const cls = eq.className || '';
  const cs = classSettingsFor(cls);

  const idealA = limitsFor(eq, 'A');
  const idealB = limitsFor(eq, 'B');
  const idealT = limitsFor(eq, 'transport');

  const rowParams = [
    ['A',
      Number.isFinite(cs.distanceA) ? `${cs.distanceA} m` : '—',
      (idealA && cs.distanceA && idealA.ideal) ? `${Math.round(cs.distanceA / (idealA.ideal / 60))} m/min` : '—',
      idealA?.ideal ? formatSec(idealA.ideal) : '—',
      idealA?.min ? formatSec(idealA.min) : '—',
      (idealA?.max != null) ? formatSec(idealA.max) : '—',
      idealA?.timeLimit ? formatSec(idealA.timeLimit) : '—',
      Number.isFinite(cs.windowA) ? `${cs.windowA} min` : '—'
    ],
    ['T',
      Number.isFinite(cs.distanceT) ? `${cs.distanceT} m` : '—',
      Number.isFinite(cs.tempoT) ? `${Math.round(cs.tempoT)} m/min` : '—',
      idealT?.ideal ? formatSec(idealT.ideal) : '—',
      idealT?.min ? formatSec(idealT.min) : '—',
      (idealT?.max != null) ? formatSec(idealT.max) : '—',
      idealT?.timeLimit ? formatSec(idealT.timeLimit) : '—',
      '—'
    ],
    ['B',
      Number.isFinite(cs.distanceB) ? `${cs.distanceB} m` : '—',
      (idealB && cs.distanceB && idealB.ideal) ? `${Math.round(cs.distanceB / (idealB.ideal / 60))} m/min` : '—',
      idealB?.ideal ? formatSec(idealB.ideal) : '—',
      idealB?.min ? formatSec(idealB.min) : '—',
      (idealB?.max != null) ? formatSec(idealB.max) : '—',
      idealB?.timeLimit ? formatSec(idealB.timeLimit) : '—',
      Number.isFinite(cs.windowB) ? `${cs.windowB} min` : '—'
    ]
  ];

  pdf.autoTable({
    startY: y,
    head: [['Etapp', 'Distans', 'Tempo', 'Ideal', 'Min', 'Max', 'Tidsgräns', 'Fönster']],
    body: rowParams,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: headStyle
  });
  y = pdf.lastAutoTable.finalY + 12;

  // 4. TABELL: SUMMERING
  const stagePen = { A: null, B: null };
  for (const s of ['A', 'B']) {
    let dur = stageDurationMsSaved(t, s);
    if (!Number.isFinite(dur)) {
      // Fallback: räkna ut om start/stop finns
      const st = stageStartTS(t, s), en = stageStopTS(t, s);
      if (st && en) dur = (en - st) - pausedMsSince(st); // Ungefärlig
    }
    if (Number.isFinite(dur)) {
      const r = stagePenaltyFromMs(dur, eq, s);
      stagePen[s] = r.elim ? Infinity : (Number.isFinite(r.points) ? r.points : null);
    }
  }

  // Summera hinder
  let sumObsPen = 0;
  let obsElim = false;
  obstacles.forEach(o => {
    const { penalty, eliminated } = obstacleValues(o);
    if (eliminated) obsElim = true;
    if (Number.isFinite(penalty)) sumObsPen += penalty;
  });

  const sumStagePen = [stagePen.A, stagePen.B].reduce((acc, v) => (v === Infinity ? Infinity : (Number.isFinite(v) ? acc + v : acc)), 0);
  const otherPen = Number(d.otherPenalty || 0);

  let totalPen = 0;
  if (stagePen.A === Infinity || stagePen.B === Infinity || obsElim) {
    totalPen = Infinity;
  } else {
    totalPen = (Number.isFinite(sumStagePen) ? sumStagePen : 0) + sumObsPen + otherPen;
  }

  pdf.autoTable({
    head: [['Summa hinder', 'A', 'B', 'Summa etapper', 'Övrigt', 'Totalt']],
    body: [[
      (obsElim ? 'ELIM' : sumObsPen.toFixed(2)),
      (stagePen.A === Infinity ? 'ELIM' : (Number.isFinite(stagePen.A) ? stagePen.A.toFixed(2) : '—')),
      (stagePen.B === Infinity ? 'ELIM' : (Number.isFinite(stagePen.B) ? stagePen.B.toFixed(2) : '—')),
      (sumStagePen === Infinity ? 'ELIM' : (Number.isFinite(sumStagePen) ? sumStagePen.toFixed(2) : '—')),
      otherPen.toFixed(2),
      (totalPen === Infinity ? 'ELIM' : totalPen.toFixed(2)),
    ]],
    startY: y, theme: 'grid', styles: { fontSize: 9, cellPadding: 4 },
    headStyles: headStyle
  });
  y = pdf.lastAutoTable.finalY + 12;

  // 5. TABELL: ETAPPER (Tider & Fönster)
  const stageRowsWindow = [], stageRowsTimes = [];
  const STAGE_KEYS = ['A', 'transport', 'B'];

  for (const stage of STAGE_KEYS) {
    const start = stageStartTS(t, stage);
    const stop = stageStopTS(t, stage);
    const durMs = stageDurationMsSaved(t, stage);
    const pen = Number.isFinite(durMs) ? stagePenaltyFromMs(durMs, eq, stage) : { points: null, elim: false };
    const lim = limitsFor(eq, stage); // Använder eq för korrekt klass/kategori

    if (start || stop || Number.isFinite(durMs)) {
      stageRowsTimes.push([
        (stage === 'transport' ? 'T' : String(stage).toUpperCase()),
        start ? new Date(start).toLocaleTimeString('sv-SE') : '—',
        stop ? new Date(stop).toLocaleTimeString('sv-SE') : '—',
        Number.isFinite(durMs) ? formatMsLive(durMs) : '—',
        pen.elim ? 'ELIM' : (Number.isFinite(pen.points) ? pen.points.toFixed(2) : '—')
      ]);

      if (lim) {
        const durSec = Number.isFinite(durMs) ? Math.round(durMs / 1000) : null;
        const delta = (Number.isFinite(durSec) && Number.isFinite(lim.ideal)) ? (durSec - lim.ideal) : null;
        // ETA-beräkning om pågående
        let eta = '—';
        if (start && !stop && Number.isFinite(lim.ideal)) {
          const p = pausedMsSince(start);
          eta = new Date(start + p + lim.ideal * 1000).toLocaleTimeString('sv-SE');
        }

        stageRowsWindow.push([
          (stage === 'transport' ? 'T' : String(stage).toUpperCase()),
          lim.ideal ? formatSec(lim.ideal) : '—',
          lim.min ? formatSec(lim.min) : '—',
          (lim.max != null) ? formatSec(lim.max) : '—',
          Number.isFinite(delta) ? `${delta > 0 ? '+' : ''}${delta} s` : '—',
          eta
        ]);
      }
    }
  }

  if (stageRowsWindow.length) {
    pdf.autoTable({ head: [['Etapp', 'Ideal', 'Min', 'Max', 'Δ', 'ETA']], body: stageRowsWindow, startY: y, theme: 'grid', styles: { fontSize: 9, cellPadding: 4 }, headStyles: headStyle });
    y = pdf.lastAutoTable.finalY + 10;
  }
  if (stageRowsTimes.length) {
    pdf.autoTable({ head: [['Etapp', 'Start', 'Mål', 'Tid', 'Straff']], body: stageRowsTimes, startY: y, theme: 'grid', styles: { fontSize: 9, cellPadding: 4 }, headStyles: headStyle });
    y = pdf.lastAutoTable.finalY + 12;
  }

  // 6. TABELL: OBSERVATÖR
  const obsLog = d.observerLog || {};
  const wrongGaitSec = Math.max(0, Math.round(Number(obsLog.wrongGaitSeconds || 0)));
  const halts = Array.isArray(obsLog.halts) ? obsLog.halts : [];
  const totalHaltSec = halts.reduce((acc, h) => acc + Math.max(0, Math.round(Number(h?.durSec || 0))), 0);
  const obsNotes = (obsLog.notes || '').trim();
  const haltRows = halts.map((h, i) => [String(i + 1), toTimeLabel(Number(h.atSec || 0) * 1000), formatSec(Math.max(0, Math.round(Number(h.durSec || 0))))]);

  if (wrongGaitSec > 0 || totalHaltSec > 0 || obsNotes) {
    pdf.autoTable({
      head: [['Fel gångart (s)', 'Halter (antal)', 'Stopptid (Σ)', 'Anteckning']],
      body: [[String(wrongGaitSec), String(halts.length), formatSec(totalHaltSec), obsNotes || '']],
      startY: y, theme: 'grid', styles: { fontSize: 9, cellPadding: 4, cellWidth: 'auto' },
      headStyles: headStyle
    });
    y = pdf.lastAutoTable.finalY + (haltRows.length ? 10 : 12);

    if (haltRows.length) {
      pdf.autoTable({ head: [['#', 'Klockslag', 'Varaktighet']], body: haltRows, startY: y, theme: 'grid', styles: { fontSize: 9, cellPadding: 4 }, headStyles: headStyle });
      y = pdf.lastAutoTable.finalY + 12;
    }
  }

  // 7. TABELL: HINDER
  // Vi mappar fram alla värden inklusive väg (index 8) // OBS: Vi måste slå upp tidsstämplar från obstacleTimes-mappen!
  const obstacleTimes = d.obstacleTimes || {};

  const rowsObs = obstacles.map(o => {
    const { timeSec, penalty, eliminated } = obstacleValues(o);
    const numKey = String(o.number || o.obstacleNumber || o.id);
    const times = obstacleTimes[numKey] || {};

    const enteredAt = times.enteredAtClient || times.enteredAt || o.enteredAtClient || o.enteredAt;
    const exitAt = times.exitAtClient || times.exitAt || o.exitAtClient || o.exitAt;

    // --- SPLITS ---
    let splitStr = '';
    const splits = o.gateSplits || times.gateSplits || [];
    if (splits.length > 0 && enteredAt) {
      let startTs = enteredAt;
      if (startTs && startTs.toMillis) startTs = startTs.toMillis();
      else if (typeof startTs === 'string') startTs = new Date(startTs).getTime();

      if (startTs) {
        const valid = splits.filter(s => s.char && s.char === s.char.toUpperCase()).map(s => {
          let ts = s.ts;
          if (ts && ts.toMillis) ts = ts.toMillis();
          else if (typeof ts === 'string') ts = new Date(ts).getTime();
          if (!ts) return null;
          return { char: s.char, diff: ts - startTs };
        }).filter(Boolean);

        if (valid.length > 0) {
          splitStr = '\n' + valid.map(s => `${s.char}: ${(s.diff / 1000).toFixed(1)}`).join('  ');
        }
      }
    }

    // COMBINED COLUMNS
    const kdStr = (o.knockdowns || 0);
    const kdPen = Number(o.knockdownPenalty || 0).toFixed(2);
    const combinedKD = (Number(kdStr) > 0 || Number(kdPen) > 0) ? `${kdStr} (${kdPen})` : '0';

    const inStr = enteredAt ? toTimeLabel(enteredAt) : '—';
    const outStr = exitAt ? toTimeLabel(exitAt) : '—';
    const combinedTime = `${inStr}\n${outStr}`;

    return [
      String(o.number || o.obstacleNumber || ''),             // 0: H
      formatMsLive(Number(o.timeMs) || (timeSec * 1000) || 0) + splitStr, // 1: Tid + Splits
      eliminated ? 'ELIM' : (Number.isFinite(penalty) ? penalty.toFixed(2) : '—'), // 2: Str
      combinedKD,                                             // 3: Rivn (Antal + Straff)
      Number(o.otherPenalty || 0).toFixed(2),                 // 4: Övr
      combinedTime,                                           // 5: Tidpunkt (In/Ut)
      (o.routeString || ''),                                  // 6: Väg
      (o.comment || '')                                       // 7: Komm.
    ];
  });

  // Kolla om det finns någon väg-data i hela listan
  const hasRoute = rowsObs.some(r => r[6] && r[6].trim() !== '');

  if (rowsObs.length) {
    pdf.autoTable({
      startY: y,
      // Visa 'Väg' kolumnen bara om data finns
      head: hasRoute
        ? [['H', 'Tid', 'Str', 'Rivn', 'Övr', 'Start / Mål', 'Väg', 'Komm.']]
        : [['H', 'Tid', 'Str', 'Rivn', 'Övr', 'Start / Mål', 'Komm.']],

      // Om ingen väg finns, filtrera bort index 6 från varje rad
      body: hasRoute
        ? rowsObs
        : rowsObs.map(row => row.filter((_, i) => i !== 6)),

      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: headStyle,
      columnStyles: {
        0: { cellWidth: 20 }, // H
        // Tid auto
        // Str auto
        // Rivn auto
        // Övr auto
        5: { cellWidth: 45, fontSize: 8 }, // Start/Mål (smalare)
        // Väg auto
        // Komm auto (får resten)
      }
    });
  }

  const driverNameSanitized = sanitizeForFilename(eq.driverName || '');
  const filename = `maratonprotokoll_${eq.startNumber}_${driverNameSanitized}.pdf`;
  pdf.save(filename);
}

// NY: Generera resultatlista för maraton (Landscape)
export async function generateMarathonListPdf(equipages, competition) {
  await loadPdfLibs();
  const { jsPDF } = window.jspdf;
  if (!jsPDF) { alert('PDF-bibliotek kunde inte laddas.'); return; }

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt' });
  const pageWidth = doc.internal.pageSize.getWidth();

  // -- LOGO & HEADER --
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

  let y = 30;
  if (srfLogo) {
    const h = 50; const w = h * (srfLogo.w / srfLogo.h);
    doc.addImage(srfLogo.data, 'PNG', 40, y, w, h);
  }

  const compName = competition?.name || 'Tävling';
  const compDate = competition?.dates || competition?.date || new Date().toLocaleDateString('sv-SE');
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

  y += 55;
  doc.setFillColor(230, 230, 230);
  doc.rect(40, y, pageWidth - 80, 20, 'F');
  doc.setFontSize(11);
  doc.setFont(undefined, 'bold');
  doc.text("MARATON – RESULTATLISTA", pageWidth / 2, y + 14, { align: 'center' });
  y += 30;

  // -- DYNAMIC COLUMNS --
  let maxObstacles = 0;
  equipages.forEach(eq => {
    const obs = eq.results?.marathon?.obstacles || {};
    Object.keys(obs).forEach(k => {
      const num = parseInt(k, 10);
      if (!isNaN(num) && num > maxObstacles) maxObstacles = num;
    });
  });
  if (maxObstacles === 0) maxObstacles = 6;

  // Build Header
  const headerRow = ['Plac', '#', 'Kusk / Häst', 'Klass', 'Straff A', 'Straff T', 'Straff B'];
  for (let i = 1; i <= maxObstacles; i++) {
    headerRow.push(`H${i}`);
  }
  headerRow.push('H-Tot');
  headerRow.push('Övr');
  headerRow.push('Totalt');

  const body = equipages.map(eq => {
    const mRes = eq.results?.marathon || {};
    let horseText = '';
    try {
      if (typeof getMomentHorseLabel === 'function') {
        horseText = getMomentHorseLabel(eq);
      } else {
        horseText = (eq.horses || []).map(h => h.name).join(', ');
      }
    } catch {
      horseText = (eq.horses || []).map(h => h.name).join(', ');
    }

    const tPen = mRes.timePenaltyT !== undefined ? formatMsLive(mRes.timePenaltyT) : '';
    const otherPen = (mRes.transportPenalty || 0);

    return [
      eq.place || '–',
      eq.startNumber || '',
      `${eq.driverName}\n${horseText}`,
      eq.className || '',
      formatMsLive(mRes.timePenaltyA),
      formatMsLive(mRes.timePenaltyB),
      (mRes.obstaclePenalty || 0).toFixed(2),
      otherPen.toFixed(2),
      { content: (mRes.totalPenalty || 0).toFixed(2), styles: { fontStyle: 'bold' } }
    ];
  });

  doc.autoTable({
    startY: y,
    startY: y,
    head: [headerRow],
    body: body,
    body: body,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [220, 220, 220], textColor: 20 },
    columnStyles: {
      8: { fontStyle: 'bold', halign: 'center' }
    }
  });

  doc.save('maraton_resultatlista.pdf');
}
