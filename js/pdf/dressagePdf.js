// js/pdf/dressagePdf.js
// Ansvar: skapa dressyr-PDF för ett ekipage (identisk layout/beräkning som tidigare)

import { getDressageResultsForEquipage } from '../services/dressageService.js';
import { getConfig } from '../services/competitionService.js';
import { ensureClubLogosLoaded, getClubLogoUrl } from '../services/logosService.js';
import { normalizeCountryCode, fetchFlagDataUrl } from '../services/flagsService.js';
import {
  getPrograms,
  getDressagePenaltyCoeff,
  fmtPct,
  fmtNum,
  getMomentHorseLabel,
  guessProgramKeyFromClass
} from '../utils/dressageUtils.js';
import { calculateDressageResult } from '../services/calculationService.js';
import { isPrivileged } from '../utils/sharedUtils.js';
import { t } from '../utils/i18n.js';
import { loadPdfLibs, loadImg, drawStandardHeader, loadStandardHeaderLogos } from './pdfBase.js';
import { fitImageDimensions } from './pdfImageUtils.js';
import { resolvePdfCompetition } from './pdfCompetitionUtils.js';
import { formatPdfPenalty, isWithdrawnStatus } from './resultPdfFormatUtils.js';
import { getCompetitionLogoUrl } from '../utils/competitionLogo.js';

let __pdfProviders = null;
export function injectProviders(p) {
  __pdfProviders = p || null;
}

// === UTIL (flyttat hit oförändrat) ===
function shouldUseCors(url) {
  if (!url) return false;
  try {
    const u = new URL(url, window.location.href);
    return u.origin !== window.location.origin;
  } catch {
    return false;
  }
}

async function fetchImageDataUrl(url) {
  if (!url) return null;
  try {
    const img = new Image();
    if (shouldUseCors(url)) {
      img.crossOrigin = 'anonymous';
    }
    img.src = url;
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });

    // Skala ner bilder till max 300px för att undvika gigantiska PDF-filer
    const maxDim = 300;
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (w > maxDim || h > maxDim) {
      if (w > h) {
        h = Math.round((h * maxDim) / w);
        w = maxDim;
      } else {
        w = Math.round((w * maxDim) / h);
        h = maxDim;
      }
    }

    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return { dataUrl: c.toDataURL('image/jpeg', 0.85), w, h };
  } catch { return null; }
}

function firstFinite(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function normalizeJudgeId(id) {
  return String(id || '').replace(/^judge_/i, '').trim();
}

function normalizeJudgeMapping(rawMapping = {}) {
  const mapping = rawMapping?.value || rawMapping?.mapping || rawMapping || {};
  return mapping && typeof mapping === 'object' ? mapping : {};
}

function normalizeJudgePosition(position) {
  return String(position || '').trim().toUpperCase();
}

function getRowClassAliases(row = {}) {
  return [
    row.className,
    row.originalClassName,
    row._mergedLabel,
    row._displayClass,
    row.displayClass,
    row.results?.displayClass
  ].filter(Boolean).map(String);
}

function getRowDisplayClass(row = {}) {
  return row._mergedLabel || row.displayClass || row._displayClass || row.className || row.originalClassName || '';
}

function collectDressageJudges(equipages = [], judgesList = []) {
  const byKey = new Map();
  const addJudge = (judge = {}) => {
    const id = normalizeJudgeId(judge.id || judge.judgeId);
    const position = normalizeJudgePosition(judge.position || judge.judgePosition);
    if (!id && !position) return;
    const key = `${position || '?'}:${id || judge.name || '?'}`;
    const existing = byKey.get(key) || {};
    byKey.set(key, {
      ...existing,
      ...judge,
      id: id || existing.id || '',
      position: position || existing.position || '',
      name: judge.name || judge.judgeName || existing.name || id || position || ''
    });
  };

  (Array.isArray(judgesList) ? judgesList : []).forEach(addJudge);
  (equipages || []).forEach(eq => {
    Object.values(eq.judges || eq.dressage?.judges || eq.results?.dressage?.judges || {}).forEach(addJudge);
  });

  const order = { C: 0, E: 1, B: 2, H: 3, M: 4, R: 5, S: 6, V: 7, P: 8 };
  return Array.from(byKey.values()).sort((a, b) => {
    const oa = order[normalizeJudgePosition(a.position)] ?? 99;
    const ob = order[normalizeJudgePosition(b.position)] ?? 99;
    if (oa !== ob) return oa - ob;
    return String(a.name || '').localeCompare(String(b.name || ''), 'sv');
  });
}

function buildDressageJudgeSummary({ equipages = [], judges = [], judgeMapping = {} } = {}) {
  const mapping = normalizeJudgeMapping(judgeMapping);
  const classLookup = new Map();
  (equipages || []).forEach(row => {
    const displayClass = getRowDisplayClass(row);
    getRowClassAliases(row).forEach(alias => {
      if (!classLookup.has(alias)) classLookup.set(alias, displayClass || alias);
    });
  });

  const classesForJudge = new Map();
  Object.entries(mapping).forEach(([className, positions]) => {
    if (!positions || typeof positions !== 'object') return;
    const displayClass = classLookup.get(className);
    if (!displayClass) return;
    Object.entries(positions).forEach(([position, judgeId]) => {
      const normalizedPosition = normalizeJudgePosition(position);
      const normalizedJudgeId = normalizeJudgeId(judgeId);
      if (!normalizedPosition || !normalizedJudgeId) return;
      const key = `${normalizedPosition}:${normalizedJudgeId}`;
      if (!classesForJudge.has(key)) classesForJudge.set(key, new Set());
      classesForJudge.get(key).add(displayClass);
    });
  });

  const byPosition = new Map();
  judges.forEach(judge => {
    const position = normalizeJudgePosition(judge.position);
    if (!position) return;
    const key = `${position}:${normalizeJudgeId(judge.id || judge.judgeId)}`;
    const classLabels = Array.from(classesForJudge.get(key) || []).sort((a, b) => a.localeCompare(b, 'sv', { numeric: true }));
    const name = judge.name || judge.judgeName || judge.id || position;
    const label = classLabels.length ? `${name} (${classLabels.join(', ')})` : name;
    if (!byPosition.has(position)) byPosition.set(position, []);
    if (!byPosition.get(position).includes(label)) byPosition.get(position).push(label);
  });

  return Array.from(byPosition.entries()).map(([position, labels]) => `${position}: ${labels.join(', ')}`).join('   ');
}

// === Publik API ===
export async function generateDressagePdf(startNumber, processedResultsRef, opts) {

  const sn = String(startNumber);
  const pdfCompetition = await resolvePdfCompetition(opts?.competition);

  const providers = opts?.providers || __pdfProviders || null;
  const programs = providers?.getPrograms?.() || (typeof getPrograms === 'function' ? getPrograms() : null) || window.dressagePrograms || {};

  // processedResultsRef: arrayen från sidan (för att slå upp raden snabbt)
  const jsPDFCtor = (window?.jspdf && window.jspdf.jsPDF) || window.jsPDF;
  if (typeof jsPDFCtor !== 'function') { alert('PDF-biblioteket (jsPDF) kunde inte laddas.'); return; }
  const pdf = new jsPDFCtor({ unit: 'pt', compress: true });
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
    const validProtocols = [];

    // First pass: Filter and collect
    for (const proto of saved) {
      const jid = proto.judgeId || proto.id || proto.position;
      const jName = proto.judgeName || proto.name || jid || '';

      // Strict General Filter
      if (String(jid).toLowerCase() === 'general') continue;
      if (String(jName).toLowerCase().includes('general')) continue;

      validProtocols.push(proto);
    }

    for (const proto of validProtocols) {
      const jid = proto.judgeId || proto.id || proto.position || 'C';
      let pos = (proto.position || jid || '?').toUpperCase();

      // Single Judge Default
      if ((pos === '?' || !pos) && validProtocols.length === 1) {
        pos = 'C';
      }

      const movements = Array.isArray(proto.movements) ? proto.movements : [];
      data.judges[jid] = {
        id: jid,
        position: pos,
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
  const explicitProgramKey = data?.testKey || data?.programKey || null;
  const program = (explicitProgramKey && programs[explicitProgramKey]) ? programs[explicitProgramKey] : null;
  if (!program) {
    // 1. Try finding via mapping
    const primaryClass = data?.originalClassName || data?.className || '';
    const lbl = primaryClass || data?._mergedLabel || '';
    let mapped = (window.klassProgramMapping && (
      window.klassProgramMapping[data?.originalClassName] ||
      window.klassProgramMapping[data?.className] ||
      window.klassProgramMapping[lbl]
    ));

    // 2. Fallback: Robust heuristic guessing if mapping fails
    if (!mapped) {
      mapped = guessProgramKeyFromClass(primaryClass, programs) || guessProgramKeyFromClass(lbl, programs);
    }

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

  const pdfLogoUrl = getCompetitionLogoUrl(pdfCompetition) || '/assets/logos/SRF.png';
  const [srfLogo, flagImg, clubImg] = await Promise.all([
    fetchImageDataUrl(pdfLogoUrl),
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
      const { w, h } = fitImageDimensions(srfLogo, 110, 70);
      pdf.addImage(srfLogo.dataUrl, 'JPEG', PAGE_W - mx - w, y - 20, w, h);
    }
    pdf.setFontSize(16).setFont(undefined, 'bold');
    let currentX = mx;
    if (flagImg) { pdf.addImage(flagImg, 'JPEG', currentX, y - 12, 24, 15); currentX += 30; }
    if (clubImg?.dataUrl) { const mh = 20, r = (clubImg.w || 1) / (clubImg.h || 1); pdf.addImage(clubImg.dataUrl, 'JPEG', currentX, y - 15, mh * r, mh); currentX += mh * r + 8; }
    pdf.text(`Dressyr – #${data.startNumber} ${data.driverName || ''}`, currentX, y);
    y += 18;
    pdf.setFontSize(10).setFont(undefined, 'normal');

    const horses = getMomentHorseLabel(data);
    if (horses && horses !== '—') { pdf.text(horses, mx, y); y += 12; }
    pdf.text(`${data._mergedLabel || data.className || ''} • ${data.clubName || ''}`, mx, y); y += 25;

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
    // Calculate final results for this judge using the centralized service
    // We construct a temporary protocol object for this single judge
    const singleJudgeProto = {
      judgeId: judge.id,
      movements: jr.movements || [],
      eliminated: jr.eliminated,
      testKey: data.testKey
    };

    // Calculate result for just this judge
    const judgeRes = calculateDressageResult(data, [singleJudgeProto], [], programs);

    let totalPoints = 0, percent = 0, penalty = 0;
    if (!jr.eliminated && !judgeRes.eliminated) {
      totalPoints = firstFinite(jr.totalPoints, jr.points, judgeRes.points) || 0;
      percent = firstFinite(jr.percent, judgeRes.percent) || 0;
      penalty = firstFinite(jr.penalty, judgeRes.penalty) || 0;
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

  // Sammanställningssida (finns >0 domare) - ALWAYS print so error points are visible
  if (judgesWithProtocols.length > 0) {
    pdf.addPage();
    let y = 45;
    if (srfLogo?.dataUrl) {
      const maxH = 70, ratio = srfLogo.w / srfLogo.h || 1;
      pdf.addImage(srfLogo.dataUrl, 'JPEG', PAGE_W - mx - maxH * ratio, y - 20, maxH * ratio, maxH);
    }
    pdf.setFontSize(16).setFont(undefined, 'bold');
    let currentX = mx;
    if (flagImg) { pdf.addImage(flagImg, 'JPEG', currentX, y - 12, 24, 15); currentX += 30; }
    if (clubImg?.dataUrl) { const mh = 20, r = (clubImg.w || 1) / (clubImg.h || 1); pdf.addImage(clubImg.dataUrl, 'JPEG', currentX, y - 15, mh * r, mh); currentX += mh * r + 8; }
    pdf.text(`Dressyr – #${data.startNumber} ${data.driverName || ''}`, currentX, y);
    y += 18; pdf.setFontSize(10);
    const horses = getMomentHorseLabel(data);
    if (horses && horses !== '—') { pdf.text(horses, mx, y); y += 12; }
    pdf.text(`${data._mergedLabel || data.className || ''} • ${data.clubName || ''}`, mx, y); y += 25;

    const maxScore = (effectiveProgram.movements || []).reduce((s, m) => s + 10 * (m.coeff || 1), 0);
    const penaltyCoeff = getDressagePenaltyCoeff(effectiveProgram);
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

    // Use centralized service to calculate the aggregated result
    const allProtocols = judgesWithProtocols.map(j => ({
      judgeId: j.id,
      movements: data.judges[j.id]?.movements || [],
      eliminated: data.judges[j.id]?.eliminated,
      testKey: data.testKey
    }));

    const finalRes = calculateDressageResult(data, allProtocols, [], programs);

    const avgPercent = firstFinite(data.finalPercent, data.avgPercent, finalRes?.percent) || 0;
    const finalPenalty = firstFinite(data.finalPenalty, data.totalPenalty, data.results?.dressage?.penalty, data.results?.dressage?.totalPenalty, finalRes?.penalty) || 0;
    // Note: sum logic earlier in the file (lines 323-333) calculates "average total points" manually to display row-by-row.
    // That is fine to keep for the Table Display, but for the FINAL summary numbers we trust the service.
    // Just ensuring `sum` (used in table generation) matches `finalRes.points` if we wanted to be strict,
    // but replacing the final derivation is the goal here.
    const displaySum = firstFinite(data.finalPoints, data.totalPoints, finalRes?.points, sum) || 0;

    const summary = [
      ['Sammanräknad totalpoäng:', data.eliminated ? 'ELIM' : displaySum.toFixed(1)],
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

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();

  const srfLogo = await loadStandardHeaderLogos(competition);
  const isInt = !!competition?.meta?.isInternational;
  const titleStr = isInt
    ? `DRESSAGE - ${t('results', true).toUpperCase()}: ${currentClass || ''}`
    : `DRESSYR – RESULTATLISTA: ${currentClass || ''}`;

  let y = drawStandardHeader(doc, competition, titleStr, srfLogo, 30, 40);
  const printableEquipages = equipages.filter(eq => !isWithdrawnStatus(eq.status));

  const allJudges = collectDressageJudges(printableEquipages, judgesList);
  const activePositions = [...new Set(allJudges.map(j => normalizeJudgePosition(j.position)).filter(Boolean))];

  y += 30;
  doc.setFontSize(9);
  doc.setFont(undefined, 'normal');

  let localJudgeMapping = window.dressageJudgeMapping;
  if (!localJudgeMapping && competition?.id) {
    try {
      localJudgeMapping = await getConfig(competition.id, 'dressageJudgeMapping') || {};
    } catch(e) {
      localJudgeMapping = {};
    }
  }

  const judgesStr = buildDressageJudgeSummary({
    equipages: printableEquipages,
    judges: allJudges,
    judgeMapping: localJudgeMapping
  });

  if (judgesStr) {
    const textLines = doc.splitTextToSize(`Domare: ${judgesStr}`, pageWidth - 80); // Margin 40 on each side
    doc.text(textLines, 40, y);
    y += (textLines.length * 12) + 3; // Advance Y based on number of lines
  }

  // -- PRE-LOAD IMAGES --
  // Collect unique needs
  const neededFlags = new Set();
  const neededClubs = new Set();
  printableEquipages.forEach(eq => {
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
  const headerRow = [
    t('rank', isInt),
    t('startno', isInt),
    `${t('driver', isInt)} / ${t('horse', isInt)}`,
    t('class', isInt),
    `${t('club', isInt)} / NF`,
    t('start', isInt) || 'Start'
  ];

  activePositions.forEach(pos => headerRow.push(pos)); // Add header for each unique judge position

  headerRow.push(t('mistakes', isInt)); // "Fel" / "Errors" (Need to add 'mistakes' or 'errors' to dict if missing)
  headerRow.push('%');
  headerRow.push(t('penalty', isInt));

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
  activePositions.forEach(() => {
    colStyles[colIdx] = { cellWidth: 30, halign: 'center' };
    colIdx++;
  });
  // Next cols
  colStyles[colIdx] = { cellWidth: 30, halign: 'center' }; // Fel
  colIdx++;
  colStyles[colIdx] = { cellWidth: 40, halign: 'center', fontStyle: 'bold' }; // %
  colIdx++;
  colStyles[colIdx] = { cellWidth: 45, halign: 'center', fontStyle: 'bold' }; // Straff

  const classLabelsInBody = [...new Set(printableEquipages.map(eq => getRowDisplayClass(eq)).filter(Boolean))];
  const includeClassSeparators = classLabelsInBody.length > 1;
  const bodyEquipages = [];
  const body = [];
  let lastBodyClassLabel = null;

  printableEquipages.forEach(eq => {
    const penalty = Number.isFinite(eq.finalPenalty) ? eq.finalPenalty : eq.results?.dressage?.totalPenalty;
    const percent = Number.isFinite(eq.avgPercent) ? eq.avgPercent : eq.results?.dressage?.percent;
    const isElim = eq.eliminated || eq.results?.dressage?.eliminated;
    const errorPoints = (eq.errorPoints != null) ? eq.errorPoints : (eq.results?.dressage?.errorPoints || 0);
    const classLabel = getRowDisplayClass(eq);

    if (includeClassSeparators && classLabel !== lastBodyClassLabel) {
      body.push([{
        content: `Klass: ${classLabel || 'Okänd klass'}`,
        colSpan: headerRow.length,
        styles: {
          fillColor: [238, 238, 238],
          textColor: 20,
          fontStyle: 'bold',
          halign: 'left'
        }
      }]);
      bodyEquipages.push(null);
      lastBodyClassLabel = classLabel;
    }

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
      eq._mergedLabel || eq.className || '',
      eq.clubName || '',
      startStr
    ];

    // Per Judge Scores
    activePositions.forEach(pos => {
      const jRecords = Object.values(eq.judges || eq.dressage?.judges || eq.results?.dressage?.judges || {});
      // Note: judges might not have their position explicitly defined in eq.judges, but typically it is.
      // E.g. j.position, or expandDressagePosition(j). Since expandDressagePosition is not imported here,
      // we can match based on it explicitly if 'position' is missing but usually it is injected by now.
      const jr = jRecords.find(j => (j.position || '').toUpperCase() === pos);

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
    row.push(formatPdfPenalty(penalty, {
      eliminated: isElim,
      withdrawn: isWithdrawnStatus(eq.status),
      empty: ''
    }));

    body.push(row);
    bodyEquipages.push(eq);
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
        const eq = bodyEquipages[data.row.index];
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
          doc.addImage(flagUrl, 'JPEG', xPos, yPos + (clubLogoHeight - flagHeight) / 2, flagWidth, flagHeight); // Vertically center flag with logo
          xPos += flagWidth + 4; // Advance xPos for next image/text, 4pt spacing
        }

        // Draw Club Logo
        if (clubUrl) {
          doc.addImage(clubUrl, 'JPEG', xPos, yPos, clubLogoWidth, clubLogoHeight);
          xPos += clubLogoWidth + 4; // Advance xPos for text, 4pt spacing
        }
      }
    }
  });

  doc.save(`dressyr_resultat_${currentClass || 'lista'}.pdf`);
}

// === NEW: Officials List (Funktionärslista) ===
export async function generateDressageOfficialsPdf(equipages, startTimes, competition) {
  await loadPdfLibs();
  const { jsPDF } = window.jspdf;
  if (!jsPDF) { alert('PDF-bibliotek kunde inte laddas.'); return; }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();

  const srfLogo = await loadStandardHeaderLogos(competition);
  let y = drawStandardHeader(doc, competition, "FUNKTIONÄRSLISTA DRESSYR", srfLogo, 30, 40);

  // Filter withdrawn
  const activeEqs = equipages.filter(e => !isWithdrawnStatus(e.status));
  const programs = window.dressagePrograms || (typeof getPrograms === 'function' ? getPrograms() : {}) || {};

  // Prepare Data
  const rows = activeEqs.map(eq => {
    // Start Time
    const sMap = startTimes || {};
    const tEntry = sMap[String(eq.startNumber)];
    let rawTime = tEntry ? (tEntry.dressage || tEntry) : null;
    let displayTime = '-';
    let sortVal = 99999;

    if (rawTime) {
      // Handle ISO string or plain HH:MM
      if (rawTime.includes('T')) {
        // "2025-09-15T00:01" -> extract HH:MM
        const d = new Date(rawTime);
        if (!isNaN(d)) {
          displayTime = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          sortVal = d.getHours() * 60 + d.getMinutes();
        } else {
          displayTime = rawTime.split('T')[1].substring(0, 5); // Fallback
        }
      } else if (rawTime.includes(':')) {
        displayTime = rawTime;
        const parts = rawTime.split(':');
        sortVal = (parseInt(parts[0]) * 60) + parseInt(parts[1]);
      }
    }

    // Program
    let progName = eq.program || '';
    if (!progName || progName === '-') {
      const key = guessProgramKeyFromClass(eq.className, programs);
      if (key && programs[key]) {
        progName = programs[key].name || key;
      }
    }
    if (!progName) progName = '-';

    // Horse
    let horseNames = '';
    if (eq.horses && Array.isArray(eq.horses)) {
      horseNames = eq.horses.map(h => h.name).join(', ');
    } else if (eq.horseNames) {
      horseNames = String(eq.horseNames); // Legacy/Flat
    }

    return {
      time: displayTime,
      startNo: eq.startNumber,
      driver: eq.driverName,
      club: eq.clubName || '',
      class: eq._mergedLabel || eq.className,
      program: progName,
      horse: horseNames,
      sortVal: sortVal
    };
  });

  // Sort by Time, then Number
  rows.sort((a, b) => {
    if (a.sortVal !== b.sortVal) return a.sortVal - b.sortVal;
    return (a.startNo || 0) - (b.startNo || 0);
  });

  const head = [['Start', '#', 'Kusk / Klubb', 'Klass', 'Program', 'Häst']];
  const body = rows.map(r => [
    r.time,
    r.startNo,
    `${r.driver}\n${r.club}`,
    r.class,
    r.program,
    r.horse
  ]);

  doc.autoTable({
    startY: y,
    head: head,
    body: body,
    theme: 'grid',
    styles: { fontSize: 10, cellPadding: 4 },
    headStyles: { fillColor: [50, 50, 50] },
    columnStyles: {
      0: { fontStyle: 'bold', halign: 'center', cellWidth: 50 },
      1: { halign: 'center', cellWidth: 30 },
      2: { cellWidth: 120 },
      5: { fontStyle: 'italic' }
    }
  });

  doc.save('funktionarslista_dressyr.pdf');
}
