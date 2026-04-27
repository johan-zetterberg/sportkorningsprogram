// js/pdf/pdfBase.js

export async function loadPdfLibs() {
  if (window.jspdf && window.jspdf.jsPDF) return;
  // Fallback om de inte finns laddade globalt
  await import("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
  await import("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js");
}

export async function loadImg(path) {
  if (!path) return null;
  try {
    const img = new Image();
    img.src = path;
    img.crossOrigin = 'Anonymous';
    await new Promise((r, e) => { img.onload = r; img.onerror = r; });
    if (!img.naturalWidth) return null;
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    // Return both formats that were used scattered around the project
    return { data: c.toDataURL('image/png'), dataUrl: c.toDataURL('image/png'), w: img.naturalWidth, h: img.naturalHeight };
  } catch { return null; }
}

export function drawStandardHeader(doc, competition, titleText, srfLogo, startY = 30, margin = 40) {
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = startY;

  // 1. Logo
  if (srfLogo) {
    const h = 50; 
    const w = h * (srfLogo.w / srfLogo.h);
    const logoData = srfLogo.dataUrl || srfLogo.data;
    if (logoData) {
      doc.addImage(logoData, 'PNG', margin, y, w, h);
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
