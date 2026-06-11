// js/pdf/pdfBase.js

import { getCompetitionLogoUrl } from '../utils/competitionLogo.js';
import { fitImageDimensions } from './pdfImageUtils.js';
import { resolvePdfCompetition } from './pdfCompetitionUtils.js';

export async function loadPdfLibs() {
  if (window.jspdf && window.jspdf.jsPDF) return;
  // Försök ladda lokalt för offline-stöd, annars fall tillbaka till CDN
  try {
    await import("/lib/jspdf.umd.min.js");
    await import("/lib/jspdf.plugin.autotable.min.js");
  } catch (err) {
    console.warn("Kunde inte ladda lokala PDF-bibliotek, använder CDN-fallback:", err);
    await import("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
    await import("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js");
  }
}

function shouldUseCors(url) {
  if (!url) return false;
  try {
    const u = new URL(url, window.location.href);
    return u.origin !== window.location.origin;
  } catch {
    return false;
  }
}

export async function loadImg(path) {
  if (!path) return null;
  try {
    const img = new Image();
    if (shouldUseCors(path)) {
      img.crossOrigin = 'Anonymous';
    }
    img.src = path;
    await new Promise((r, e) => { img.onload = r; img.onerror = r; });
    if (!img.naturalWidth) return null;

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
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = c.toDataURL('image/jpeg', 0.85);
    return { data: dataUrl, dataUrl: dataUrl, w, h };
  } catch { return null; }
}

export async function loadStandardHeaderLogos(competition) {
  const resolvedCompetition = await resolvePdfCompetition(competition);
  const [srfLogo, competitionLogo] = await Promise.all([
    loadImg('/assets/logos/SRF.png'),
    loadImg(getCompetitionLogoUrl(resolvedCompetition))
  ]);
  const headerLogo = srfLogo || { w: 1, h: 1 };
  if (competitionLogo) {
    headerLogo.competitionLogo = competitionLogo;
  }
  return headerLogo;
}

export function drawStandardHeader(doc, competition, titleText, srfLogo, startY = 30, margin = 40) {
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = startY;

  if (srfLogo) {
    const { w, h } = fitImageDimensions(srfLogo, 90, 50);
    const logoData = srfLogo.dataUrl || srfLogo.data;
    if (logoData) {
      doc.addImage(logoData, 'JPEG', margin, y, w, h);
    }
  }

  const competitionLogo = srfLogo?.competitionLogo;
  if (competitionLogo) {
    const { w, h } = fitImageDimensions(competitionLogo, 90, 50);
    const logoData = competitionLogo.dataUrl || competitionLogo.data;
    if (logoData) {
      doc.addImage(logoData, 'JPEG', pageWidth - margin - w, y, w, h);
    }
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
  doc.rect(margin, y, pageWidth - (margin * 2), 20, 'F');
  doc.setFontSize(11);
  doc.setFont(undefined, 'bold');
  doc.text(titleText, pageWidth / 2, y + 14, { align: 'center' });
  
  // Advance Y
  y += 30;
  return y;
}
