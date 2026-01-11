// Återanvänds av ALLA PDF:er så att header ser identisk ut
import { mmText, line } from './core.js';

export function drawCommonHeader(doc, meta) {
  // meta: { title, competitionName, place, date, organizer, logoDataUrl? }
  const margin = 12;
  let x = margin;
  let y = 14;

  if (meta.logoDataUrl) {
    try { doc.addImage(meta.logoDataUrl, 'PNG', margin, 8, 20, 20); } catch(e) {}
    x = margin + 24;
  }

  mmText(doc, x, 14, meta.title || 'Rapport', { size: 16, style: 'bold' });
  mmText(doc, x, 20, meta.competitionName || '', { size: 11 });
  mmText(doc, x, 26, [meta.place, meta.date].filter(Boolean).join(' • '), { size: 10 });

  const rightX = 210 - margin;
  mmText(doc, rightX, 12, meta.organizer || '', { size: 10, align: 'right' });
  mmText(doc, rightX, 18, `Genererad: ${new Date().toLocaleString()}`, { size: 9, align: 'right' });

  line(doc, margin, 32, 210 - margin, 32);
  return 36; // returnera y-start för body
}
