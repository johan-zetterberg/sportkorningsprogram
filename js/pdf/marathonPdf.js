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
  getObstacleCoefficient,
  pausedMsSince,
  setMarathonConfig,
} from '../utils/marathonUtils.js';
import { calculateMarathonResult } from '../services/calculationService.js';
import { loadPdfLibs, loadImg, drawStandardHeader } from './pdfBase.js';

// === HJÄLPFUNKTIONER (Samma som i dressagePdf.js) ===

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

// Local helper for time parsing "HH:MM" -> minutes
function parseTimeStr(str) {
  if (!str) return null;
  // Handle ISO 8601 or similar with 'T'
  let timePart = str;
  if (str.includes('T')) {
    const parts = str.split('T');
    timePart = parts[1]; // Take the time part
  }
  const [hh, mm] = timePart.split(':').map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

function formatTimeStr(mins) {
  if (!Number.isFinite(mins)) return '-';
  let m = Math.round(mins);
  const h = Math.floor(m / 60) % 24; // Handle day wrap?
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

// === HUVUDFUNKTION ===

import { t } from '../utils/i18n.js';

export async function printMarathonPdf(eq, d, competition) {
  const isInternational = competition?.meta?.isInternational || false;
  await loadPdfLibs();
  const { jsPDF } = window.jspdf;
  if (!jsPDF) { alert('Kunde inte ladda PDF-biblioteket.'); return; }

  const pdf = new jsPDF({ unit: 'pt' });
  const mx = 40;
  let y = 40;

  // Timing-objektet (kan ligga i 'd' eller separat, vi antar 'd' är komplett här via modalen)
  const tVals = d || {};
  const obstacles = getObstacleArray(d);

  // 1. LOGGOR & HEADER
  const cc = normalizeCountryCode(eq?.country || eq?.nation || eq?.nationality) || 'se';
  const flagDataUrl = (await loadImg(await fetchFlagDataUrl(cc)))?.dataUrl;
  const clubLogoUrl = getClubLogoUrl(eq?.clubName);
  const clubLogo = await loadImg(clubLogoUrl);

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
    pdf.text(`Marathon – #${eq.startNumber} ${eq.driverName || ''}`, mx + 30, y);
  } else {
    pdf.text(`Marathon – #${eq.startNumber} ${eq.driverName || ''}`, mx, y);
  }
  y += 18;

  pdf.setFontSize(10);
  const horses = getMomentHorseLabel(eq);
  if (horses && horses !== '—') { pdf.text(`${horses}`, mx, y); y += 12; }
  pdf.text(`${eq._mergedLabel || eq.className || ''}${eq.clubName ? ' • ' + eq.clubName : ''}`, mx, y); y += 14;

  // Starttid & Status
  // Vi återskapar enkel statuslogik här för utskrift
  const hasStart = stageStartTS(tVals, 'A') || stageStartTS(tVals, 'T') || stageStartTS(tVals, 'B');
  const status = hasStart ? t('started', isInternational) : t('not_started', isInternational);
  pdf.text(`${t('status', isInternational)}: ${status}`, mx, y);
  y += 10;

  if (!pdf.autoTable) { alert('AutoTable saknas.'); return; }
  const headStyle = { fillColor: [243, 244, 246], textColor: [55, 65, 81] };

  // 2. TABELL: GLOBALA REGLER (Behåller dessa översättningar enkla eller manuella för nu då de är config-specifika)
  const rules = globalRules();


  // 3. TABELL: KLASSPARAMETRAR
  const cls = eq.className || '';
  const cs = classSettingsFor(cls);

  const idealA = limitsFor(eq, 'A');
  const idealB = limitsFor(eq, 'B');
  const idealT = limitsFor(eq, 'transport');

  const rowParams = [
    [isInternational ? 'A' : 'A',
    Number.isFinite(cs.distanceA) ? `${cs.distanceA} m` : '—',
    (idealA && cs.distanceA && idealA.ideal) ? `${Math.round(cs.distanceA / (idealA.ideal / 60))} m/min` : '—',
    idealA?.ideal ? formatSec(idealA.ideal) : '—',
    idealA?.min ? formatSec(idealA.min) : '—',
    (idealA?.max != null) ? formatSec(idealA.max) : '—',
    idealA?.timeLimit ? formatSec(idealA.timeLimit) : '—',
    Number.isFinite(cs.windowA) ? `${cs.windowA} min` : '—'
    ],
    [isInternational ? 'Transfer' : 'T',
    Number.isFinite(cs.distanceT) ? `${cs.distanceT} m` : '—',
    Number.isFinite(cs.tempoT) ? `${Math.round(cs.tempoT)} m/min` : '—',
    idealT?.ideal ? formatSec(idealT.ideal) : '—',
    idealT?.min ? formatSec(idealT.min) : '—',
    (idealT?.max != null) ? formatSec(idealT.max) : '—',
    idealT?.timeLimit ? formatSec(idealT.timeLimit) : '—',
      '—'
    ],
    [isInternational ? 'B' : 'B',
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
    head: [[t('stage', isInternational), t('distance', isInternational), t('tempo', isInternational), t('ideal', isInternational), t('mintime', isInternational), 'Max', t('maxtime', isInternational), t('window', isInternational)]],
    body: rowParams,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: headStyle
  });
  y = pdf.lastAutoTable.finalY + 12;

  // 4. TABELL: SUMMERING
  // Use centralized TR-compliant calculation
  const res = calculateMarathonResult(eq, d, d);

  const sumObsPen = res.obstacles.sum;
  const obsElim = res.obstacles.eliminated;
  const stagePenA = res.stages.A.timePenalty;
  const stagePenB = res.stages.B.timePenalty;
  const sumStagePen = (res.stages.A.timePenalty || 0) + (res.stages.B.timePenalty || 0);
  const stageElim = res.stages.A.eliminated || res.stages.B.eliminated;
  const otherPen = res.otherPenalty;
  const totalPen = res.totalPenalty;

  pdf.autoTable({
    head: [[t('obstacles', isInternational) + ' ' + t('total', isInternational), 'A', 'B', t('section', isInternational) + ' ' + t('total', isInternational), t('other', isInternational), t('total', isInternational)]],
    body: [[
      (obsElim ? 'ELIM' : sumObsPen.toFixed(2)),
      (stagePenA === Infinity ? 'ELIM' : (Number.isFinite(stagePenA) ? stagePenA.toFixed(2) : '—')),
      (stagePenB === Infinity ? 'ELIM' : (Number.isFinite(stagePenB) ? stagePenB.toFixed(2) : '—')),
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
    const start = stageStartTS(tVals, stage);
    const stop = stageStopTS(tVals, stage);
    const durMs = stageDurationMsSaved(tVals, stage);
    const pen = Number.isFinite(durMs) ? stagePenaltyFromMs(durMs, eq, stage) : { points: null, elim: false };
    const lim = limitsFor(eq, stage); // Använder eq för korrekt klass/kategori

    const stageLabel = (stage === 'transport') ? (isInternational ? 'Transfer' : 'T') : String(stage).toUpperCase();

    if (start || stop || Number.isFinite(durMs)) {
      stageRowsTimes.push([
        stageLabel,
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
          stageLabel,
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
    pdf.autoTable({ head: [[t('stage', isInternational), t('ideal', isInternational), t('mintime', isInternational), 'Max', 'Δ', 'ETA']], body: stageRowsWindow, startY: y, theme: 'grid', styles: { fontSize: 9, cellPadding: 4 }, headStyles: headStyle });
    y = pdf.lastAutoTable.finalY + 10;
  }
  if (stageRowsTimes.length) {
    pdf.autoTable({ head: [[t('stage', isInternational), 'Start', t('finish', isInternational), t('time', isInternational), t('penalty', isInternational)]], body: stageRowsTimes, startY: y, theme: 'grid', styles: { fontSize: 9, cellPadding: 4 }, headStyles: headStyle });
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

    // Dynamisk koefficient
    const obsCoeff = getObstacleCoefficient(eq.className);
    let calculatedTimePenalty = penalty || 0;
    if (Number.isFinite(timeSec)) {
      calculatedTimePenalty = timeSec * obsCoeff;
    }

    // --- SPLITS ---
    let splitStr = '';
    // Prioritera times.gateSplits (live) över o.gateSplits (synkat med modalen)
    const splits = times.gateSplits || o.gateSplits || [];
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
        }).filter(x => x && x.diff >= 0); // Endast valida och positiva (synkat med modalen)

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
      eliminated ? 'ELIM' : (Number.isFinite(calculatedTimePenalty) ? calculatedTimePenalty.toFixed(2) : '—'), // 2: Str (Time Penalty)
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
        ? [[t('obstacles', isInternational), t('time', isInternational), t('errors', isInternational), t('knockdown', isInternational), t('other', isInternational), 'Start / ' + t('finish', isInternational), 'Väg', 'Komm.']]
        : [[t('obstacles', isInternational), t('time', isInternational), t('errors', isInternational), t('knockdown', isInternational), t('other', isInternational), 'Start / ' + t('finish', isInternational), 'Komm.']],

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

export async function generateMarathonListPdf(equipages, competition) {
  const isInternational = competition?.meta?.isInternational || false;
  await loadPdfLibs();
  const { jsPDF } = window.jspdf;
  if (!jsPDF) { alert('PDF-bibliotek kunde inte laddas.'); return; }

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt' });
  const pageWidth = doc.internal.pageSize.getWidth();

  const srfLogo = await loadImg('/assets/logos/SRF.png');
  const title = `MARATHON – ${t('results', isInternational).toUpperCase()}`;
  let y = drawStandardHeader(doc, competition, title, srfLogo, 30, 40);

  // -- DYNAMIC COLUMNS --
  let maxObstacles = 0;
  equipages.forEach(eq => {
    const items = eq.results?.marathon?.obstacles?.items || [];
    items.forEach(o => {
      const num = parseInt(o.number || o.obstacleNumber || o.nr || o.hinderNr, 10);
      if (!isNaN(num) && num > maxObstacles) maxObstacles = num;
    });
  });
  if (maxObstacles === 0) maxObstacles = 6;

  // Build Header
  const headerRow = [
    t('rank', isInternational),
    t('startno', isInternational),
    t('driver', isInternational) + ' / ' + t('horse', isInternational),
    t('class', isInternational),
    (isInternational ? 'Pen A' : 'Straff A'),
    (isInternational ? 'Pen T' : 'Straff T'),
    (isInternational ? 'Pen B' : 'Straff B')
  ];
  for (let i = 1; i <= maxObstacles; i++) {
    headerRow.push(`H${i}`);
  }
  headerRow.push('H-' + t('total', isInternational).substring(0, 1));
  headerRow.push(t('other', isInternational));
  headerRow.push(t('total', isInternational));

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

    // Calculate aggregated "Other" penalty (Global + WG + Obstacle Extra)
    const obsItems = mRes.obstacles?.items || [];
    const obsOtherSum = obsItems.reduce((acc, o) => acc + (Number(o.otherPenalty) || 0), 0);
    const otherPen = (mRes.otherPenalty || 0) + (mRes.wgPenalty || 0) + obsOtherSum;

    const row = [
      eq.place || '–',
      eq.startNumber || '',
      { content: `${eq.driverName}\n${horseText}`, styles: { fontSize: 8 } },
      eq.className || '',
      (mRes.stages?.A?.timePenalty != null) ? mRes.stages.A.timePenalty.toFixed(2) : '—',
      (mRes.stages?.transport?.timePenalty != null) ? mRes.stages.transport.timePenalty.toFixed(2) : '—',
      (mRes.stages?.B?.timePenalty != null) ? mRes.stages.B.timePenalty.toFixed(2) : '—'
    ];

    // Individual Obstacles
    for (let i = 1; i <= maxObstacles; i++) {
      const oData = obsItems.find(o => Number(o.number || o.obstacleNumber || o.nr || o.hinderNr) === i);
      if (oData?.eliminated) {
        row.push('ELIM');
      } else if (oData?.penalty != null) {
        row.push(oData.penalty.toFixed(2));
      } else {
        row.push('—');
      }
    }

    // Summary columns
    row.push((mRes.obstacles?.sum || 0).toFixed(2));
    row.push(otherPen.toFixed(2));
    row.push({ content: (mRes.totalPenalty || 0).toFixed(2), styles: { fontStyle: 'bold' } });

    return row;
  });

  // Find index of Total column
  const totalColIndex = headerRow.length - 1;
  const otherColIndex = headerRow.length - 2;
  const obsTotalColIndex = headerRow.length - 3;

  doc.autoTable({
    startY: y,
    head: [headerRow],
    body: body,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [220, 220, 220], textColor: 20 },
    columnStyles: {
      0: { halign: 'center', cellWidth: 25 }, // Rank
      1: { halign: 'center', cellWidth: 25 }, // StartNo
      2: { cellWidth: 120 },                  // Driver/Horse
      [totalColIndex]: { fontStyle: 'bold', halign: 'right' },
      [otherColIndex]: { halign: 'right' },
      [obsTotalColIndex]: { halign: 'right' }
    }
  });

  doc.save('maraton_resultatlista.pdf');
}

// === NEW: Official Functionary Timeline ===
export async function generateMarathonFunctionaryPdf(equipages, marathonConfig, startTimes, competition) {
  await loadPdfLibs();
  const { jsPDF } = window.jspdf;
  if (!jsPDF) return;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt' });
  const pageWidth = doc.internal.pageSize.getWidth();

  // Ensure marathonUtils has the config
  if (marathonConfig) setMarathonConfig(marathonConfig);

  const srfLogo = await loadImg('/assets/logos/SRF.png');
  let y = drawStandardHeader(doc, competition, "FUNKTIONÄRSLISTA MARATON (TIDER)", srfLogo, 30, 40);
  
  y += 5; // Extra spacing before table

  // Pause time from config
  const pauseTimeMin = marathonConfig.pauseTime || 10;

  // Sort rows by Start A
  // FIX: Hantera startTimes som objekt (inte Map)
  // FIX: Filtrera bort strukna
  const activeEquipages = equipages.filter(e => e.status !== 'struken');

  const rows = activeEquipages.map(eq => {
    // Start A
    // startTimes structure from reports.js/getConfig: { "1": { marathon: "10:00" }, ... } OR flat object depending on loading
    // Based on reports.js: startTimes[sn][type]
    const sMap = startTimes || {};
    const tEntry = sMap[String(eq.startNumber)];
    const startA_Str = tEntry ? (tEntry.marathon || tEntry) : null; // Fallback if simple string mapped
    // Ensure we stripped date for display if it's there
    const displayStartA = startA_Str && startA_Str.includes('T')
      ? startA_Str.split('T')[1].substring(0, 5)
      : (startA_Str ? startA_Str.substring(0, 5) : '-');

    let startA_Min = 0;
    if (startA_Str) startA_Min = parseTimeStr(startA_Str);

    // Ideals (sec)
    const limA = limitsFor(eq, 'A');
    const limT = limitsFor(eq, 'transport'); // or 'T'

    const idealA_Min = (limA?.ideal || 0) / 60;
    const idealT_Min = (limT?.ideal || 0) / 60;

    // Finish A ~ Start A + Ideal A
    // Fix: allow idealA_Min to be 0
    const finishA_Min = (startA_Min !== null && idealA_Min !== null) ? startA_Min + idealA_Min : null;

    // Start T ~ Finish A
    // (Usually immediate or same as finish A)

    // Finish T ~ Start T + Ideal T
    // Fix: allow idealT_Min to be 0 (e.g. no transport)
    const finishT_Min = (finishA_Min !== null && idealT_Min !== null) ? finishA_Min + idealT_Min : null;

    // Start B ~ Finish T + Pause
    const startB_Min = (finishT_Min !== null) ? finishT_Min + pauseTimeMin : null;

    return {
      startNo: eq.startNumber,
      driver: eq.driverName,
      class: eq.className,
      startA: displayStartA,
      finishA: formatTimeStr(finishA_Min),
      startT: formatTimeStr(finishA_Min), // Approx same
      finishT: formatTimeStr(finishT_Min),
      startB: formatTimeStr(startB_Min),
      rawStartA: startA_Min || 99999
    };
  }).sort((a, b) => a.rawStartA - b.rawStartA);

  const head = [['Start', '#', 'Kusk', 'Klass', 'Start A', 'Mål A', 'Start T', 'Mål T', `Start B (Paus ${pauseTimeMin}m)`]];
  const body = rows.map(r => [
    r.startA,
    r.startNo,
    r.driver,
    r.class,
    r.startA,
    r.finishA,
    r.startT,
    r.finishT,
    r.startB
  ]);

  doc.autoTable({
    startY: y,
    head: head,
    body: body,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [50, 50, 50] },
    columnStyles: {
      0: { fontStyle: 'bold' },
      8: { fontStyle: 'bold', fillColor: [240, 240, 240] } // Highlight Start B
    }
  });

  doc.save('funktionarslista_maraton_tider.pdf');
}

// === NEW: Official Obstacle List ===
export async function generateMarathonObstaclePdf(equipages, marathonConfig, startTimes, competition) {
  await loadPdfLibs();
  const { jsPDF } = window.jspdf;
  if (!jsPDF) return;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt' });
  const pageWidth = doc.internal.pageSize.getWidth();

  // Ensure marathonUtils has the config
  if (marathonConfig) setMarathonConfig(marathonConfig);

  const srfLogo = await loadImg('/assets/logos/SRF.png');
  let y = drawStandardHeader(doc, competition, "FUNKTIONÄRSLISTA MARATON (HINDER)", srfLogo, 30, 40);
  
  y += 5; // Extra spacing before table

  const pauseTimeMin = marathonConfig.pauseTime || 10;



  // FIX: Filtrera bort strukna
  const activeEquipages = equipages.filter(e => e.status !== 'struken');

  const rows = activeEquipages.map(eq => {
    // Calc Start B
    const sMap = startTimes || {};
    const tEntry = sMap[String(eq.startNumber)];
    const startA_Str = tEntry ? (tEntry.marathon || tEntry) : null;
    let startB_Str = '-';

    if (startA_Str) {
      const startA_Min = parseTimeStr(startA_Str);
      const limA = limitsFor(eq, 'A');
      const limT = limitsFor(eq, 'transport');
      const idealA_Min = (limA?.ideal || 0) / 60;
      const idealT_Min = (limT?.ideal || 0) / 60;

      if (startA_Min !== null) {
        // Allow 0 for ideals
        const safeA = idealA_Min || 0;
        const safeT = idealT_Min || 0;
        const bMin = startA_Min + safeA + safeT + pauseTimeMin;
        startB_Str = formatTimeStr(bMin);
      }
    }

    // Width
    const width = eq.marathonTrackWidth || eq.marathonWidth || eq.trackWidth || '-';

    // Category (reuse helper logic simplified)
    let cat = '-';
    if (eq.horses && eq.horses.length > 0) {
      const types = [...new Set(eq.horses.map(h => h.type).filter(Boolean))];
      cat = types.join(', ');
    }

    return {
      startNo: eq.startNumber,
      driver: eq.driverName,
      class: eq.className,
      cat: cat,
      width: width,
      startB: startB_Str
    };
  }).sort((a, b) => (parseTimeStr(a.startB) || 99999) - (parseTimeStr(b.startB) || 99999));

  const head = [['Start B (Est)', '#', 'Kusk / Klubb', 'Kat', 'Vagnbredd (cm)']];
  const body = rows.map(r => [
    r.startB,
    r.startNo,
    r.driver,
    r.cat,
    r.width
  ]);

  doc.autoTable({
    startY: y,
    head: head,
    body: body,
    theme: 'grid',
    styles: { fontSize: 10, cellPadding: 4 },
    headStyles: { fillColor: [50, 50, 50] },
    columnStyles: {
      0: { fontStyle: 'bold', halign: 'center' },
      1: { halign: 'center', cellWidth: 30 },
      4: { halign: 'center', fontStyle: 'bold', fontSize: 11, cellWidth: 80 }
    }
  });

  doc.save('funktionarslista_maraton_hinder.pdf');
}
