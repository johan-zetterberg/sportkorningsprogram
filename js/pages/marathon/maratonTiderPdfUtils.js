import { fitImageDimensions } from '../../pdf/pdfImageUtils.js';

export function buildMarathonPdfSections(host) {
  return Array.from(host?.children || [])
    .filter(node => node && typeof node.querySelector === 'function')
    .map(node => ({
      title: node.querySelector('h3')?.textContent?.trim() || '',
      table: node.querySelector('table')
    }))
    .filter(section => section.table);
}

export function findMarathonPdfSection(sections, stage) {
  const wanted = normalizeMarathonPdfStage(stage);
  return (sections || []).find(section => normalizeMarathonPdfStage(section.title) === wanted) || null;
}

export function getMarathonPdfBaseStyles() {
  return {
    font: 'helvetica',
    headFontSize: 12,
    bodyFontSize: 11,
    timeFontSize: 12,
    rowMinH: 28,
    cellPad: 4
  };
}

export function buildMarathonPdfFileName(startNumber, driverName) {
  const safeStartNumber = String(startNumber || '').trim();
  const safeName = String(driverName || 'ekipage').trim().replace(/\s+/g, '_') || 'ekipage';
  return `maraton_hallttider_${safeStartNumber}_${safeName}.pdf`;
}

export function drawMarathonPdfHeader(pdf, context) {
  const {
    base,
    marginX,
    pageWidth,
    stageLabel,
    distMeters,
    tempoLabel,
    driverName,
    startNumber,
    displayClassName,
    className,
    clubName,
    flagImg,
    clubImg,
    logoImg,
    title,
    driverFallback = 'Kusk'
  } = context;

  pdf.setFont(base.font, 'bold').setFontSize(18);
  pdf.text(`${driverName ? `#${startNumber} ${driverName}` : driverFallback}`, marginX, 60);

  let x = marginX;
  const y = 80;
  if (flagImg?.dataUrl) {
    const flagHeight = 16;
    const flagWidth = flagHeight * (flagImg.w / flagImg.h);
    pdf.addImage(flagImg.dataUrl, 'JPEG', x, y - flagHeight + 2, flagWidth, flagHeight);
    x += flagWidth + 8;
  }
  if (clubImg?.dataUrl) {
    const clubHeight = 16;
    const clubWidth = clubHeight * ((clubImg.w || clubHeight) / (clubImg.h || clubHeight));
    pdf.addImage(clubImg.dataUrl, 'JPEG', x, y - clubHeight + 2, clubWidth, clubHeight);
  }

  pdf.setFont(base.font, 'normal').setFontSize(11);
  pdf.text(`${displayClassName || className || ''}${clubName ? ` • ${clubName}` : ''}`, marginX, y + 16);

  if (logoImg?.dataUrl) {
    const { w, h } = fitImageDimensions(logoImg, 110, 70);
    pdf.addImage(logoImg.dataUrl, 'JPEG', pageWidth - marginX - w, 32, w, h);
  }

  pdf.setFont(base.font, 'bold').setFontSize(12);
  pdf.text(`${title} (${stageLabel})`, marginX, y + 36);

  const info = [];
  if (Number.isFinite(distMeters) && distMeters > 0) info.push(`${distMeters.toLocaleString('sv-SE')} m`);
  if (tempoLabel) info.push(tempoLabel);
  if (info.length) {
    pdf.setFont(base.font, 'normal').setFontSize(11);
    pdf.text(info.join(' • '), marginX, y + 52);
  }
}

export function buildMarathonPdfTableOptions({ startY, base, marginX }) {
  return {
    startY,
    html: null,
    theme: 'grid',
    styles: {
      font: base.font,
      fontSize: base.bodyFontSize,
      cellPadding: base.cellPad,
      minCellHeight: base.rowMinH,
      valign: 'middle'
    },
    headStyles: { fillColor: [245, 246, 248], textColor: 0, fontStyle: 'bold', fontSize: base.headFontSize },
    bodyStyles: {},
    didParseCell: (data) => {
      const colHeader = (txt) => (data.table.head?.[0]?.cells?.[data.column.index]?.raw?.textContent || '').toLowerCase().includes(txt);
      if (colHeader('tid') || colHeader('tidsfonster') || colHeader('tidsfönster') || colHeader('min') || colHeader('max')) {
        data.cell.styles.fontSize = base.timeFontSize;
        data.cell.styles.fontStyle = 'bold';
      }
    },
    margin: { left: marginX, right: marginX }
  };
}

export function renderMarathonPdfPages({
  pdf,
  sections,
  base,
  marginX,
  drawHeader,
  distances,
  tempoLabels
}) {
  const addTableFromDom = (tableEl, startY) => {
    const opt = buildMarathonPdfTableOptions({ startY, base, marginX });
    opt.html = tableEl;
    pdf.autoTable(opt);
    return pdf.lastAutoTable ? pdf.lastAutoTable.finalY : (startY + 100);
  };

  const secA = findMarathonPdfSection(sections, 'A');
  const secT = findMarathonPdfSection(sections, 'T');
  const secB = findMarathonPdfSection(sections, 'B');

  drawHeader('Sträcka A', distances?.A, tempoLabels?.A || null);
  if (secA?.table) {
    addTableFromDom(secA.table, 150);
  }

  pdf.addPage();
  drawHeader('Sträcka B', distances?.B, tempoLabels?.B || null);
  if (secB?.table) {
    addTableFromDom(secB.table, 150);
  }

  if (secT?.table) {
    pdf.addPage();
    drawHeader('Transport', distances?.T, tempoLabels?.T || null);
    addTableFromDom(secT.table, 150);
  }

  if (!secA?.table && typeof pdf.deletePage === 'function') {
    pdf.deletePage(1);
  }

  return { secA, secT, secB };
}

function normalizeMarathonPdfStage(value) {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[\u00c3\u00e3][\u00a4\u00a5]/g, 'a')
    .normalize('NFD')
    .replace(/a[\u0308\u030a]/g, 'a')
    .replace(/[\u0308\u030a]/g, '');

  if (/transport|\bt\b/.test(normalized)) return 'T';
  if (/\ba\b/.test(normalized)) return 'A';
  if (/\bb\b/.test(normalized)) return 'B';
  return normalized.toUpperCase();
}
