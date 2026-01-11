import {
  getEquipages,
  getConfig,
  listenForDressageStatusCollection,
  listenForPrecisionResults,
  getMarathonTimingForEquipage
} from '../services/firestoreService.js';
import { getCompetitionHeader } from '../ui/components.js';
import { getGlobalState, setGlobalState } from '../main.js';
import { db, appId } from '../config/firebase-config.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { ensureClubLogosLoaded, getClubLogoHtml, getClubLogoUrl } from '../services/logosService.js';
import { standardPortAllowance } from '../data/competitionData.js';
import { getFlagHtml, fetchFlagDataUrl, normalizeCountryCode } from '../services/flagsService.js';
import {
  debounce,
  downloadCsv,
  csvCell,
  sanitizeForFilename
} from '../utils/sharedUtils.js';
import { generateStartListPdf } from '../pdf/startListPdf.js';

// --- NYTT: Mobil-detektering (ändrad för att lyssna på orientering) ---
const MOBILE_BP = 600; // Vi kan behålla denna för CSS-fallback om vi vill, men isMobile använder den inte
const isMobile = () => window.matchMedia("(orientation: portrait)").matches;

// --- Lokal state för modulen ---
let sortConfig = { key: 'className', direction: 'asc' };
let allEquipages = [];
let searchTerm = '';
let viewMode = 'class'; // 'class' | 'start'
let deltagare_activeClassFilters = new Set();

// --- refs för att kunna ta bort lyssnare på unload ---
window.__participantsResizeHandler = window.__participantsResizeHandler || null;
window.__participantsKeydownHandler = window.__participantsKeydownHandler || null;

// --- Resultat-state ---
let startTimesMap = {};
let dressageStatusMap = new Map();
let precisionResultsMap = new Map();
let unsubscribers = [];

let deltagare_displayConfig = {};
let deltagare_MERGE_MAP = new Map();

// Bygger den interna kartan över vilka TDB-nummer som tillhör vilken grupp
function deltagare_buildMergeMap(raw) {
  deltagare_MERGE_MAP.clear();
  if (!raw) return;

  const maybeDisplay = raw && typeof raw === 'object' && raw.mergeByClassNumber ? raw : null;
  const source = maybeDisplay ? maybeDisplay.mergeByClassNumber : raw;

  // Nytt format från admin: { "<grpKey>": { label: string, members: number[] } }
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    for (const [grpKey, info] of Object.entries(source)) {
      const members = (info?.members || []).map(Number).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
      if (!members.length) continue;
      const label = String(info?.label || `Sammanslagen: TDB #${members.join('/')}`);
      const key = String(grpKey || `TDBGROUP:${members.join('+')}`);
      members.forEach(num => deltagare_MERGE_MAP.set(num, { key, label }));
    }
  }
  // (Vi behöver inte de gamla formaten här, admin-sidan sparar det nya)
}

// Slår upp ETT ekipage och returnerar dess merge-key och label
function deltagare_resolveMergeGrouping(e) {
  // 1) Per-ekipage flagga (från TDB-test merge i admin)
  if (e?.useMergedTestForDisplay && e?.mergedTestKey && e?.mergedTestLabel) {
    return { key: String(e.mergedTestKey), label: String(e.mergedTestLabel) };
  }
  // 2) Global TDB-nummer merge (från config)
  const num = Number(e?.tdbClassNumber);
  const hit = Number.isFinite(num) ? deltagare_MERGE_MAP.get(num) : null;
  if (hit) return hit;

  // 3) Fallback: originalklass
  const cls = e?.className || '—';
  return { key: `CLASS:${cls}`, label: cls };
}

async function ensureUserRoleLoaded() {
  const user = getGlobalState('currentUser');
  if (!user?.uid) return null; // ej inloggad
  const roleNow = (user.role || '').toLowerCase();
  if (roleNow) return roleNow; // redan känd

  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    const role = (snap.exists() ? (snap.data()?.role || '') : '').toLowerCase();
    // uppdatera global state så alla sidor får tillgång till rollen
    setGlobalState('currentUser', { ...user, role });
    return role;
  } catch (e) {
    console.warn('Kunde inte läsa users/{uid}.role:', e);
    return '';
  }
}
const _norm = s => String(s || '').toLowerCase();

function getPortAllowanceForClass(cls) {
  // man kan lägga till fler alias här om du har klassvarianter
  const direct = standardPortAllowance?.[cls];
  const lower = standardPortAllowance?.[_norm(cls)];
  const star = standardPortAllowance?.['*'];
  const n = Number(direct ?? lower ?? star);
  return Number.isFinite(n) ? n : null;
}



// --- Hämta flaggdata (URL) ---
// --- Hämta fil (URL) ---
async function _fetchImage(url) {
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
  } catch {
    return null;
  }
}

import { injectScrollStyles, initializeScrollSync } from '../ui/scrollHelper.js';

// ===== Modal: struktur & lyssnare =====
function renderModalStructure() {
  if (document.getElementById('details-modal')) return;

  // Lägg in enkel stil (samma känsla som maraton/precision)
  if (!document.getElementById('participantsModalStyle')) {
    const style = document.createElement('style');
    style.id = 'participantsModalStyle';
    style.textContent = `
    .modal-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,.6);
    display: flex; align-items: center; justify-content: center;
    z-index: 2147483647; opacity: 0; transition: opacity .18s ease;
     backdrop-filter: blur(4px);
    pointer-events: none;              /* NYTT: inga klick när dold */
      backdrop-filter: blur(4px);
    }
  .modal-overlay.visible { opacity: 1; pointer-events: auto; }  /* NYTT */
  .modal-overlay.hidden { display: none; }
    .modal-content {
      background:#fff; border-radius:12px; width:100%; max-width:720px; margin:0 auto;
      max-height:70vh; overflow-y:auto; box-shadow:0 10px 25px rgba(0,0,0,.1);
      transform:scale(.97); transition:transform .18s ease;
    }
    .modal-overlay.visible .modal-content { transform: scale(1); }
  `;
    document.head.appendChild(style);
  }

  const el = document.createElement('div');
  el.id = 'details-modal';
  el.className = 'modal-overlay hidden';
  el.innerHTML = `
    <div class="modal-content">
      <div id="modal-content"></div>
    </div>
  `;
  document.body.appendChild(el);
}


function setupModalListeners() {
  const modal = document.getElementById('details-modal');
  if (!modal) return;

  const closeModal = () => {
    modal.classList.remove('visible');
    setTimeout(() => modal.classList.add('hidden'), 200);
  };

  // Stäng på klick i overlay
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // Ta bort ev. gammal keydown först
  if (window.__participantsKeydownHandler) {
    try { document.removeEventListener('keydown', window.__participantsKeydownHandler); } catch { }
  }
  // Spara ny referens och registrera
  window.__participantsKeydownHandler = (e) => {
    if (e.key === 'Escape') closeModal(); // Added basic functionality
  };
}

function exists(v) { return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0); }
function kv(label, value) {
  if (!exists(value)) return '';
  return `<div class="flex gap-2 py-1 text-sm">
    <dt class="font-medium text-gray-800 shrink-0">${label}</dt>
    <dd class="text-gray-700 break-words font-normal">${value}</dd>
  </div>`;
}
function yesno(v) {
  if (v === true) return 'Ja';
  if (v === false) return 'Nej';
  return v ?? '';
}
function fmtMoney(v) {
  if (!exists(v)) return '';
  const n = Number(v);
  if (!isFinite(n)) return String(v);
  return n.toLocaleString('sv-SE', { style: 'currency', currency: 'SEK', maximumFractionDigits: 0 });
}
function fmtList(arr, mapFn = (x) => x) {
  if (!Array.isArray(arr) || arr.length === 0) return '';
  return arr.map(mapFn).filter(Boolean).join(', ');
}
function valOrDash(v) { return exists(v) ? v : '—'; }

// function sanitizeForFilename moved to sharedUtils

function horseLabel(eq) {
  if (!eq) return '—';
  const names = Array.isArray(eq.horses)
    ? eq.horses.map(h => h?.name).filter(Boolean)
    : [];
  return names.length ? names.join(' & ') : '—';
}

// ===== NYTT: Sorteringsfunktion =====
function getSortedEquipages() {
  let list = [...allEquipages].filter(e => {
    if (!searchTerm) return true;
    // Sök även i _mergedLabel ===
    const hay = [
      String(e.startNumber || ''),
      e.driverName || '',
      horseLabel(e), //
      e.className || '',
      e._mergedLabel || '' // <-- NY
    ].join(' ').toLowerCase();
    return hay.includes(searchTerm);
  });

  if (deltagare_activeClassFilters.size > 0) {
    list = list.filter(e => {
      const label = e._mergedLabel || e.className || '—';
      return deltagare_activeClassFilters.has(label);
    });
  }

  list.sort((a, b) => {
    // === ÄNDRING: Sortera på _mergedLabel istället för className ===
    if (viewMode === 'class') {
      const classA = a._mergedLabel || a.className || '';
      const classB = b._mergedLabel || b.className || '';
      const classCompare = classA.localeCompare(classB, 'sv');
      if (classCompare !== 0) return classCompare;
    }

    const key = sortConfig.key;
    const dir = sortConfig.direction === 'asc' ? 1 : -1;

    // === ÄNDRING: Hantera om sorteringsnyckeln är 'className' ===
    let valA, valB;
    if (key === 'className') {
      valA = a._mergedLabel || a.className || '';
      valB = b._mergedLabel || b.className || '';
    } else {
      valA = key === 'horseName' ? horseLabel(a) : a[key];
      valB = key === 'horseName' ? horseLabel(b) : b[key];
    }
    // === SLUT ÄNDRING ===

    if (valA == null) return 1 * dir; if (valB == null) return -1 * dir;

    let comparison = 0;
    if (typeof valA === 'number' && typeof valB === 'number') {
      comparison = valA - valB;
    } else {
      comparison = String(valA).localeCompare(String(valB), 'sv', { numeric: true });
    }
    return comparison * dir;
  });
  return list;
}

function renderMobile() {
  renderDeltagareClassChips();
  const container = document.getElementById('participantListContainer');
  if (!container) return;

  const sorted = getSortedEquipages();
  const canViewDetails = ['admin', 'domare', 'funktionar', 'official', 'judge'].includes(getGlobalState('currentUser')?.role || '');
  let lastClass = null;

  if (sorted.length === 0) {
    container.innerHTML = '<div class="p-6 text-center text-gray-500">Inga deltagare matchar din sökning.</div>';
    return;
  }

  // Funktion för att rendera ett enskilt kort
  const renderCard = (e) => {
    let classHeader = '';
    // === ÄNDRING: Använd _mergedLabel ===
    const currentClassLabel = e._mergedLabel || e.className || 'Okänd Klass';

    if (viewMode === 'class' && currentClassLabel !== lastClass) {
      lastClass = currentClassLabel;
      classHeader = `<div class="px-4 py-2 mt-2 bg-blue-100 text-blue-800 font-bold text-lg rounded-md">${currentClassLabel}</div>`;
    }

    return `
            ${classHeader}
            <div class="m-2 rounded-xl border shadow-sm bg-white overflow-hidden ${canViewDetails ? 'cursor-pointer hover:bg-blue-50' : ''}" data-equipage-id="${e.startNumber}" ${canViewDetails ? 'role="button" tabindex="0"' : ''}>
                <div class="px-4 py-3 border-b bg-gray-50 flex items-start justify-between gap-4">
                    <div>
                        <div class="font-semibold text-lg">${e.driverName || 'Namn saknas'}</div>
                        <div class="text-sm text-gray-500">${horseLabel(e)}</div>
                    </div>
                    <div class="text-center flex-shrink-0">
                        <div class="text-xs text-gray-500">Startnr</div>
                        <div class="text-2xl font-bold">${e.startNumber || '?'}</div>
                    </div>
                </div>
                <div class="p-4 grid grid-cols-1 gap-y-2 text-sm">
                    <div class="flex justify-between"><span class="text-gray-500">Klass:</span> <span class="font-medium text-right">${currentClassLabel}</span></div>
                    <div class="flex justify-between items-center"><span class="text-gray-500">Klubb:</span>
                        <span class="font-medium flex items-center gap-2 text-right">
                            ${getFlagHtml(e)}
                            ${getClubLogoHtml(e)}
                            <span class="truncate">${e.clubName || '—'}</span>
                        </span>
                    </div>
                </div>
            </div>
        `;
  };

  const cardsHtml = sorted.map(renderCard).join('');
  container.innerHTML = `<div class="bg-gray-50 py-1">${cardsHtml}</div>`;

  // Koppla klick-lyssnare (om användaren har behörighet)
  if (canViewDetails) {
    container.querySelectorAll('[data-equipage-id]').forEach(card => {
      card.addEventListener('click', () => {
        const equipageToShow = allEquipages.find(eq => String(eq.startNumber) === card.dataset.equipageId);
        if (equipageToShow) renderAndShowDetailsModal(equipageToShow);
      });
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          const equipageToShow = allEquipages.find(eq => String(eq.startNumber) === card.dataset.equipageId);
          if (equipageToShow) renderAndShowDetailsModal(equipageToShow);
        }
      });
    });
  }
}

async function printParticipantPdf(eq) {
  const jsPDFCtor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
  // Fallback om jsPDF-biblioteket saknas helt
  if (!jsPDFCtor) {
    alert('PDF-biblioteket (jsPDF) kunde inte laddas. Kontrollera sidans <script>-taggar.');
    return;
  }

  const hasAuto = !!(window.jspdf?.autoTable || jsPDFCtor.autoTable || (jsPDFCtor.API && jsPDFCtor.API.autoTable));

  const cc = normalizeCountryCode(eq?.country || eq?.nation || eq?.nationality) || 'se';
  const flagDataUrl = await fetchFlagDataUrl(cc);
  const clubLogoUrl = getClubLogoUrl(eq?.clubName);
  const clubLogo = await fetchImageDataUrl(clubLogoUrl);

  const driver = eq.driverName || '';
  const cls = eq.className || '';
  const club = eq.clubName || '';
  const start = eq.startNumber || '';

  const twPrec = (eq.trackWidth ? `${eq.trackWidth} cm` : '—');
  const twMar = (eq.marathonTrackWidth ? `${eq.marathonTrackWidth} cm` : '—');

  const phone = eq.phone ?? eq.mobile ?? eq.contactPhone ?? '';
  const email = eq.email ?? eq.contactEmail ?? '';
  const personnr = eq.ssn ?? eq.personnummer ?? '';
  const license = eq.licenseNo ?? eq.licence ?? '';
  const address = eq.address || {};
  const fullAddress = [address.street, address.zipCode, address.city].filter(Boolean).join(', ');

  const payStatus = (eq.payment?.status || '').toLowerCase();
  const payTxt = payStatus === 'paid' ? 'Betald' : payStatus === 'partial' ? 'Delbetald' : payStatus === 'unpaid' ? 'Obetald' : '—';
  const payAmount = eq.payment?.amount;

  // === FIX FÖR BUGGEN ===
  // Säkerställ att otherFees alltid är en array innan .join() anropas
  let otherFees = eq.administrativeFees || eq.otherFees || [];
  if (!Array.isArray(otherFees)) {
    otherFees = [String(otherFees)];
  }
  const otherFeesText = otherFees.join(', ');

  const horses = Array.isArray(eq.horses) ? eq.horses : [];
  const horseRows = horses.map((h, i) => [
    `Häst ${i + 1}: ${h.name || h.horseName || ''}`,
    h.regNo || '',
    h.horseId || '',
    h.license || '',
    h.chip || h.chipNo || '',
    h.ueln || '',
    h.owner || h.horseOwner || ''
  ]);

  const pdf = new jsPDFCtor({ unit: 'pt' });
  const mx = 40; let y = 40;

  if (clubLogo?.dataUrl) {
    const maxH = 40, maxW = 110;
    const ratio = clubLogo.w / clubLogo.h || 1;
    let drawH = maxH, drawW = Math.round(drawH * ratio);
    if (drawW > maxW) { drawW = maxW; drawH = Math.round(drawW / ratio); }
    const x = pdf.internal.pageSize.getWidth() - 40 - drawW;
    const yTop = y - Math.round(drawH * 0.5);
    pdf.addImage(clubLogo.dataUrl, 'PNG', x, yTop, drawW, drawH);
  }

  pdf.setFontSize(14);
  if (flagDataUrl) {
    pdf.addImage(flagDataUrl, 'PNG', mx, y - 10, 20, 12);
    pdf.text(`Ekipage – #${start} ${driver}`, mx + 26, y);
  } else {
    pdf.text(`Ekipage – #${start} ${driver} (${cc.toUpperCase()})`, mx, y);
  }
  y += 18;
  pdf.setFontSize(10);
  pdf.text(`${cls}${club ? ' • ' + club : ''}`, mx, y); y += 14;

  if (hasAuto) {
    pdf.autoTable({
      head: [['Fält', 'Värde']],
      body: [
        ['Vagnbredd (Precision)', twPrec],
        ['Vagnbredd (Maraton)', twMar],
        ['Telefon', phone],
        ['E-post', email],
        ['Adress', fullAddress],
        ['Personnummer', personnr],
        ['Licensnr', license],
        ['Betalstatus', payTxt],
        ['Summa', (payAmount != null) ? Number(payAmount).toLocaleString('sv-SE', { style: 'currency', currency: 'SEK', maximumFractionDigits: 0 }) : '—'],
        ['Övriga avgifter', otherFeesText]
      ],
      startY: y,
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [243, 244, 246], textColor: [55, 65, 81] },
      theme: 'grid'
    });
    y = pdf.lastAutoTable.finalY + 12;

    if (horseRows.length) {
      pdf.autoTable({
        head: [['Häst', 'Reg.nr', 'Häst-ID (tävling)', 'Licens', 'Chipnr', 'UELN/Passnr', 'Ägare']],
        body: horseRows,
        startY: y,
        styles: { fontSize: 9, cellPadding: 4 },
        headStyles: { fillColor: [243, 244, 246], textColor: [55, 65, 81] },
        theme: 'grid'
      });
    }
  } else {
    pdf.setFontSize(12);
    pdf.text("autoTable-plugin för PDF saknas, kan ej rendera detaljerad tabell.", mx, y);
  }

  // === NYTT FILNAMN ===
  const driverNameSanitized = sanitizeForFilename(driver);
  const filename = `ekipage_${start}_${driverNameSanitized}.pdf`;
  pdf.save(filename);
}

// === NYA HJÄLPFUNKTIONER FÖR STATUS ===

function formatStatusTime(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
}

function renderDressageStatus(startNo) {
  const sn = String(startNo);
  const st = startTimesMap[sn]?.dressage;
  const status = dressageStatusMap.get(sn);

  // 1. Har resultat?
  if (status && (status.score || status.percent)) {
    // "Klar (65.50%)" eller "Klar (45.5 straff)"
    if (status.percent) return `<span class="text-green-700 font-bold">Klar (${parseFloat(status.percent).toFixed(2)}%)</span>`;
    if (status.score) return `<span class="text-green-700 font-bold">Klar (${parseFloat(status.score).toFixed(2)} p)</span>`;
  }

  // 2. Pågår?
  if (status?.state === 'active') return `<span class="text-blue-600 animate-pulse font-semibold">På banan</span>`;

  // 3. Starttid?
  if (st) return `<span class="text-gray-900">Start: ${formatStatusTime(st)}</span>`;

  return '<span class="text-gray-400 italic">Ej startat</span>';
}

function renderPrecisionStatus(startNo) {
  const sn = String(startNo);
  const st = startTimesMap[sn]?.precision;
  const res = precisionResultsMap.get(sn);

  // 1. Resultat?
  if (res && res.finalized) {
    const pen = res.totalPenalty ?? ((res.knocks || 0) * 3 + (res.timePenalty || 0));
    return `<span class="text-green-700 font-bold">Klar (${pen} straff)</span>`;
  }

  // 2. Pågår?
  if (res?.running) return `<span class="text-blue-600 animate-pulse font-semibold">På banan</span>`;

  // 3. Starttid?
  if (st) return `<span class="text-gray-900">Start: ${formatStatusTime(st)}</span>`;

  return '<span class="text-gray-400 italic">Ej startat</span>';
}

async function updateMarathonStatus(compId, startNo) {
  const el = document.getElementById('marathon-status-placeholder');
  if (!el || !compId || !startNo) return;

  try {
    // Vi hämtar BARA start/mål-tider, inte hela resultatet (för prestanda)
    const timing = await getMarathonTimingForEquipage(compId, startNo);
    const st = startTimesMap[String(startNo)]?.marathon;

    let html = '<span class="text-gray-400 italic">Ej startat</span>';

    if (timing?.finish_B) {
      // Målgång i hinderfasen -> antagligen klar
      html = `<span class="text-green-700 font-bold">Målgång (tid togs)</span> <br><a href="#maraton-resultat" class="text-xs text-blue-500 underline">Se resultat</a>`;
    } else if (timing?.start_A) {
      // Startat A-fasen
      html = `<span class="text-blue-600 animate-pulse font-semibold">På banan</span>`;
    } else if (st) {
      html = `<span class="text-gray-900">Start: ${formatStatusTime(st)}</span>`;
    }

    el.innerHTML = html;
  } catch (err) {
    console.warn('Fel vid hämtning av maratonstatus:', err);
    el.innerHTML = '<span class="text-red-400 text-xs">Kunde ej ladda</span>';
  }
}

// ===== Hela renderAndShowDetailsModal-funktionen =====
function renderAndShowDetailsModal(equipage) {
  if (!equipage) return;

  const modal = document.getElementById('details-modal');
  const contentWrap = document.getElementById('modal-content');
  if (!modal || !contentWrap) return;

  // === ÄNDRING: Använd _mergedLabel ===
  const driverName = valOrDash(equipage.driverName);
  const clubName = valOrDash(equipage.clubName);
  const className = valOrDash(equipage._mergedLabel || equipage.className); // <-- ANVÄND _mergedLabel HÄR
  const startNo = valOrDash(equipage.startNumber);
  // === SLUT ÄNDRING ===

  const twPrec = exists(equipage.trackWidth) ? `${equipage.trackWidth} cm` : 'Ej angivet';
  const twMar = exists(equipage.marathonTrackWidth) ? `${equipage.marathonTrackWidth} cm` : 'Ej angivet';
  const portAllowance = getPortAllowanceForClass(equipage.className); // <-- ANVÄND ORIGINALKLASS för beräkning
  const trackWNum = Number(equipage.trackWidth);
  const portW = (Number.isFinite(trackWNum) && Number.isFinite(portAllowance))
    ? trackWNum + portAllowance
    : null;
  const payStatus = equipage.payment?.status ?? null;
  const payAmount = equipage.payment?.amount ?? null;
  const otherFees = equipage.administrativeFees || equipage.otherFees || [];
  const phone = equipage.phone ?? equipage.mobile ?? equipage.contactPhone ?? '';
  const email = equipage.email ?? equipage.contactEmail ?? '';
  const personnr = equipage.ssn ?? equipage.personnummer ?? '';
  const license = equipage.licenseNo ?? equipage.licence ?? '';
  const clubId = equipage.clubId ?? '';
  const grooms = equipage.grooms || equipage.groom || (equipage.groomName ? [equipage.groomName] : []);
  const address = equipage.address || {};
  const fullAddress = [address.street, address.zipCode, address.city].filter(Boolean).join(', ');

  const payTxt = payStatus === 'paid' ? 'Betald' : payStatus === 'partial' ? 'Delbetald' : payStatus === 'unpaid' ? 'Obetald' : 'Okänd';
  const horses = Array.isArray(equipage.horses) ? equipage.horses : [];

  const headerHtml = `
  <div class="flex justify-between items-start gap-3">
    <div>
      <h3 class="text-xl font-bold">#${startNo} ${driverName}</h3>
      <div class="text-sm text-gray-500 italic">${horseLabel(equipage)}</div>
      <div class="text-gray-600 flex items-center gap-2 mt-1">
        ${getFlagHtml(equipage)}
        ${getClubLogoHtml(equipage)}
        <span>${className} • ${clubName}</span>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <button id="printPdfBtn" class="needs-online px-3 py-1 rounded bg-gray-900 text-white text-sm">Skriv ut PDF</button>
      <button id="modal-close-btn" class="px-2 py-1 text-2xl leading-none" aria-label="Stäng">&times;</button>
    </div>
  </div>
`;

  // ... (resten av horsesHtml och momentHorsesHtml är ok) ...
  const horsesHtml = (horses.length
    ? horses.map((h, idx) => `
        <dd class="mt-3 pl-4 border-l-2 ml-1">
          <div class="font-bold text-gray-900 mb-1 text-sm">Häst ${idx + 1}: ${h.name || h.horseName || '—'}</div>
          <div class="space-y-1 text-sm">
            ${kv('Reg.nummer', h.regNo || '')}
            ${kv('Häst-ID (tävling)', h.horseId || '')}
            ${kv('Licensnr', h.license || '')}
            ${kv('Chipnr', h.chip || h.chipNo || '')}
            ${kv('UELN/Passnr', h.ueln || '')}
            ${kv('Ägare', h.owner || h.horseOwner || '')}
          </div>
        </dd>`).join('')
    : '<dd class="text-gray-500 text-sm">Inga hästar registrerade.</dd>'
  );
  const cls = (equipage.className || '').toLowerCase();
  let horseLimit = 1;
  if (cls.includes('fyrspann')) horseLimit = 4;
  else if (cls.includes('par') || cls.includes('tandem')) horseLimit = 2;

  const isMultiHorse = horseLimit > 1;
  const selections = equipage.momentHorses || {};
  let momentHorsesHtml = '';

  if (isMultiHorse) {
    const horseMap = new Map(horses.map(h => [h.id || h.name, h.name]));

    const getHorseNames = (key) => {
      const ids = selections[key] || [];
      if (ids.length === 0) return '<span class="italic text-gray-500">Ej valt</span>';
      return ids.map(id => horseMap.get(id) || id).join(', ');
    };

    momentHorsesHtml = `
            <div class="mt-3 pl-4 border-l-2 ml-1 border-blue-300 bg-blue-50 p-2 rounded-r-md">
                <div class="font-bold text-blue-800 mb-2 text-sm">Valda för moment:</div>
                <div class="space-y-1 text-sm">
                    ${kv('Dressyr', getHorseNames('dressage'))}
                    ${kv('Maraton', getHorseNames('marathon'))}
                    ${kv('Precision', getHorseNames('precision'))}
                </div>
            </div>
        `;
  }
  const groomsHtml = (Array.isArray(grooms) && grooms.length)
    ? `<dd class="mt-3 pl-4 border-l-2 ml-1"><ul class="list-disc pl-5 text-gray-700 text-sm">${grooms.map((g) => `<li>${(g?.name) || g}</li>`).join('')}</ul></dd>` : '';

  contentWrap.innerHTML = `
    <div class="p-4 md:p-6">
      ${headerHtml}
      <div class="mt-4 border-t pt-4 space-y-6 text-sm">
      
        <!-- TÄVLINGSSTATUS -->
        <section class="bg-slate-50 p-3 rounded-lg border border-slate-200">
          <h4 class="font-bold text-base mb-2 flex items-center gap-2">
            🏆 Tävlingsstatus
            <span class="text-xs font-normal text-gray-500">(Live)</span>
          </h4>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            
            <!-- DRESSYR -->
            <div class="space-y-1">
              <div class="font-semibold text-gray-700">Dressyr</div>
              ${renderDressageStatus(startNo)}
            </div>

            <!-- MARATON -->
            <div class="space-y-1">
              <div class="font-semibold text-gray-700">Maraton</div>
              <div id="marathon-status-placeholder" class="text-gray-600">Laddar...</div>
            </div>

            <!-- PRECISION -->
            <div class="space-y-1">
              <div class="font-semibold text-gray-700">Precision</div>
              ${renderPrecisionStatus(startNo)}
            </div>

          </div>
        </section>

        <section>
          <h4 class="font-bold text-base mb-2">Ekipage</h4>
          <div class="space-y-1">
            ${kv('Kusk', driverName)}
            ${kv('Klubb', clubName)}
            ${kv('Startnummer', startNo)}
            ${kv('Klass', className)}
            ${kv('Vagnsbredd (Precision)', twPrec)}
            ${kv('Vagnsbredd (Maraton)', twMar)}
            ${kv('Hinderbredd (Precision)',
    Number.isFinite(portW) ? `${equipage.trackWidth} + ${portAllowance} = ${portW} cm` : '—')}
            </div>
        </section>
        <section class="border-t pt-4">
          <h4 class="font-bold text-base mb-2">Kontakt & behörigheter</h4>
          <div class="space-y-1">
            ${kv('Telefon', phone)}
            ${kv('E-post', email)}
            ${kv('Adress', fullAddress)}
            ${kv('Personnummer', personnr)}
            ${kv('Licensnr', license)}
            ${kv('Klubb-ID', clubId)}
          </div>
        </section>
        <section class="border-t pt-4">
          <h4 class="font-bold text-base mb-2">Betalning & avgifter</h4>
          <div class="space-y-1">
            ${kv('Status', payTxt)}
            ${kv('Summa', fmtMoney(payAmount))}
            ${kv('Övriga avgifter', fmtList(otherFees))}
          </div>
        </section>
        <section class="border-t pt-4">
          <h4 class="font-bold text-base mb-2">Hästar</h4>
          <dl>
            ${horsesHtml}
            ${momentHorsesHtml}
          </dl>
        </section>
        ${groomsHtml ? `
        <section class="border-t pt-4">
          <h4 class="font-bold text-base mb-2">Groom(s)</h4>
          <dl>
            ${groomsHtml}
          </dl>
        </section>` : ''}
      </div>
    </div>
  `;
  // === Starta hämtning av maraton-status (async) ===
  const compId = getGlobalState('currentCompetition')?.id;
  updateMarathonStatus(compId, startNo);

  // visa + knappar
  modal.classList.remove('hidden');
  modal.offsetHeight;
  modal.classList.add('visible');

  document.getElementById('modal-close-btn')?.addEventListener('click', () => {
    modal.classList.remove('visible');
    setTimeout(() => modal.classList.add('hidden'), 200);
  });
  document.getElementById('printPdfBtn')?.addEventListener('click', () => printParticipantPdf(equipage));
}

/**
 * Renderar deltagarlistan i tabellform.
 */
function renderDesktop() {
  const container = document.getElementById('participantListContainer');
  if (!container) return;

  const sortedEquipages = getSortedEquipages();
  const headers = [
    { key: 'className', label: 'Klass' }, { key: 'startNumber', label: 'Startnr' },
    { key: 'driverName', label: 'Kusk' }, { key: 'clubName', label: 'Klubb' },
    { key: 'horseName', label: 'Häst/Ponny' }
  ];
  // === ÄNDRING: Lade till canViewDetails-kontroll ===
  const canViewDetails = ['admin', 'domare', 'funktionar', 'official', 'judge'].includes(getGlobalState('currentUser')?.role || '');

  let tableHtml = `
      <div id="participant-x-host" class="x-scroll-wrap">
        <table class="min-w-full divide-y divide-gray-200 participants-table"> <thead class="bg-gray-50 sticky top-0">
                <tr>${headers.map(h => {
    const isSorted = sortConfig.key === h.key;
    const sortArrow = isSorted ? (sortConfig.direction === 'asc' ? ' ▲' : ' ▼') : '';
    return `<th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sortable-header" data-sort-key="${h.key}">${h.label}${sortArrow}</th>`;
  }).join('')}</tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
    `;

  if (sortedEquipages.length === 0) {
    tableHtml += `<tr><td colspan="${headers.length}" class="p-4 text-center text-gray-500">Inga deltagare att visa.</td></tr>`;
  } else {
    sortedEquipages.forEach(e => {
      // === ÄNDRING: Lade till cursor-pointer om canViewDetails ===
      tableHtml += `
                <tr class="${canViewDetails ? 'cursor-pointer hover:bg-blue-50' : ''}" data-equipage-id="${e.startNumber}">
                    <td class="px-4 py-4 text-sm text-gray-700 align-top">${e._mergedLabel || e.className || ''}</td>
                    <td class="px-4 py-4 whitespace-nowrap font-bold align-top">${e.startNumber || ''}</td>
                    <td class="px-4 py-4 font-medium text-gray-900 align-top">${e.driverName || ''}</td>
                    <td class="px-4 py-4 text-sm text-gray-700 align-top">
                        <span class="inline-flex items-center gap-1 flex-wrap"> 
                            ${getFlagHtml(e)}
                            ${getClubLogoHtml(e)}
                            <span class="inline-block">${e.clubName || ''}</span>
                        </span>
                    </td>
                    <td class="px-4 py-4 text-sm text-gray-700 align-top">${horseLabel(e)}</td>
                </tr>
            `;
    });
  }

  tableHtml += `</tbody></table></div>`;
  container.innerHTML = tableHtml;

  // ... (resten av funktionen är ok) ...
  const hostEl = document.getElementById('participant-x-host');
  if (hostEl && window.__setupXbarSync) {
    window.__setupXbarSync({
      barClass: 'fixed-xbar',
      innerId: 'participantsXbarInner',
      hostEl: hostEl
    });
  }
}

// === NY FUNKTION: Renderar klass-knapparna ===
function renderDeltagareClassChips() {
  const chipHost = document.getElementById('deltagareClassChips');
  if (!chipHost) return;

  // Använd allEquipages som redan har _mergedLabel
  const labels = [...new Set(allEquipages.map(e => e._mergedLabel || e.className || '—'))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'sv'));

  const base = "px-2 py-1 rounded border text-sm cursor-pointer";
  const on = "bg-gray-800 text-white border-gray-800";
  const off = "bg-white text-gray-700 border-gray-300 hover:bg-gray-50";

  // Vi behöver 'escapeHtml' från precision-resultat.js
  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  chipHost.innerHTML = labels.map(lbl => {
    // Använd den nya state-variabeln
    const active = deltagare_activeClassFilters.has(lbl); //
    return `<button type="button" data-class="${escapeHtml(lbl)}" class="${base} ${active ? on : off}">${escapeHtml(lbl)}</button>`;
  }).join('');

  // Lyssnaren är redan kopplad i load()
}

// ===== NYTT: render() router =====
function render() {
  // === NYTT: Anropa chip-renderaren FÖRST ===
  renderDeltagareClassChips();
  if (isMobile()) {
    window.__teardownXbarSync?.(); // Städa upp scrollbaren i mobilvy
    renderMobile();
  } else {
    renderDesktop();
  }
}

/**
 * Huvudfunktion som anropas av routern för att ladda och initiera deltagarsidan.
 */
export async function load() {
  injectScrollStyles();
  initializeScrollSync('deltagare');
  const competition = getGlobalState('currentCompetition');
  const page = document.getElementById('page-deltagare');
  await ensureClubLogosLoaded(); //

  if (!competition) {
    page.innerHTML = `<p class="p-8 text-center text-red-500">Ingen tävling vald.</p>`;
    return;
  }

  // === KORRIGERING: HTML-strukturen är nu korrekt ===
  page.innerHTML = `
    <div class="container mx-auto p-4 md:p-8">
        ${getCompetitionHeader(competition, 'Deltagarlista')}
        <div class="bg-white p-4 md:p-6 rounded-xl shadow-md">
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
                <div class="flex flex-col sm:flex-row gap-3 items-center">
                    <input id="participantSearch" type="text" placeholder="Sök: startnr, kusk, häst..." class="w-64 max-w-full rounded-md border px-3 py-1.5 text-sm" autocomplete="off">
                    
                    <div class="inline-flex rounded-md shadow-sm" role="group">
                        <button id="viewByClassBtn" type="button" class="px-4 py-2 text-sm font-medium border border-gray-300 rounded-l-lg hover:bg-gray-100 focus:z-10 focus:ring-2 focus:ring-blue-500 focus:text-blue-700 bg-gray-900 text-white">Per klass</button>
                        <button id="viewByStartBtn" type="button" class="px-4 py-2 text-sm font-medium border-t border-b border-r border-gray-300 rounded-r-lg hover:bg-gray-100 focus:z-10 focus:ring-2 focus:ring-blue-500 focus:text-blue-700 bg-white text-gray-900">Per startnr</button>
                    </div>
                </div>

                <div class="flex items-center gap-2">
                    <button id="btnExportDeltagareCsv" type="button" class="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
                      <i class="fas fa-file-csv mr-2 -ml-1 text-gray-500"></i> CSV
                    </button>
                    <button id="btnExportDeltagarePdf" type="button" class="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-gray-600 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500">
                      <i class="fas fa-file-pdf mr-2 -ml-1"></i> Deltagarlista PDF
                    </button>
                </div>
            </div>
            
            <div id="deltagareClassChips" class="my-2 flex flex-wrap gap-2">
            </div>

            <div id="participantListContainer"><p class="text-center text-gray-500">Laddar deltagare...</p></div>
        </div>
    </div>
  `;
  // === SLUT KORRIGERING ===

  try {
    await ensureUserRoleLoaded(); //
    renderModalStructure(); //
    setupModalListeners(); //

    // === NYTT: Hämta data för "Status"-sektionen ===
    try {
      const [stConfig] = await Promise.all([
        getConfig(competition.id, 'startTimes'),
      ]);
      startTimesMap = stConfig?.times || {};

      const un1 = listenForDressageStatusCollection(competition.id, (list) => {
        if (Array.isArray(list)) list.forEach(item => dressageStatusMap.set(String(item.startNumber), item));
      });
      unsubscribers.push(un1);

      const un2 = listenForPrecisionResults(competition.id, (list) => {
        if (Array.isArray(list)) list.forEach(item => precisionResultsMap.set(String(item.startNumber ?? item.id), item));
      });
      unsubscribers.push(un2);

    } catch (err) {
      console.warn('Kunde inte ladda statusdata:', err);
    }

    const [allData, displayCfg] = await Promise.all([
      getEquipages(competition.id),
      getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'competitions', competition.id, 'config', 'display')).catch(() => null)
    ]);

    const cfgData = (displayCfg && displayCfg.exists()) ? (displayCfg.data()?.value ?? displayCfg.data()) : {};
    deltagare_displayConfig = cfgData || {};
    deltagare_buildMergeMap(deltagare_displayConfig); //

    allEquipages = allData
      .filter(e => e.status !== 'struken')
      .map(e => {
        const g = deltagare_resolveMergeGrouping(e); //
        return {
          ...e,
          _mergedKey: g.key,
          _mergedLabel: g.label
        };
      });

    // --- Event listeners ---
    const pageContent = document.getElementById('page-deltagare');
    if (pageContent) {
      pageContent.addEventListener('click', (e) => {
        const canViewDetails = ['admin', 'domare', 'funktionar', 'official', 'judge'].includes(getGlobalState('currentUser')?.role || '');
        const row = e.target.closest('[data-equipage-id]');
        const header = e.target.closest('.sortable-header');

        if (header) {
          const key = header.dataset.sortKey;
          if (sortConfig.key === key) sortConfig.direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
          else { sortConfig.key = key; sortConfig.direction = 'asc'; }
          render();
        } else if (row && canViewDetails) {
          const equipageToShow = allEquipages.find(eq => String(eq.startNumber) === row.dataset.equipageId);
          if (equipageToShow) renderAndShowDetailsModal(equipageToShow); //
        }
      });
    }

    document.getElementById('participantSearch')?.addEventListener('input', (e) => {
      searchTerm = (e.target.value || '').trim().toLowerCase();
      render();
    });

    const btnClass = document.getElementById('viewByClassBtn');
    const btnStart = document.getElementById('viewByStartBtn');
    const updateViewButtons = () => {
      btnClass?.classList.toggle('bg-gray-900', viewMode === 'class'); btnClass?.classList.toggle('text-white', viewMode === 'class'); btnClass?.classList.toggle('bg-white', viewMode !== 'class');
      btnStart?.classList.toggle('bg-gray-900', viewMode === 'start'); btnStart?.classList.toggle('text-white', viewMode === 'start'); btnStart?.classList.toggle('bg-white', viewMode !== 'start');
    };
    btnClass?.addEventListener('click', () => { viewMode = 'class'; sortConfig = { key: 'className', direction: 'asc' }; updateViewButtons(); render(); });
    btnStart?.addEventListener('click', () => { viewMode = 'start'; sortConfig = { key: 'startNumber', direction: 'asc' }; updateViewButtons(); render(); });
    updateViewButtons();

    const chipHost = document.getElementById('deltagareClassChips');
    if (chipHost) {
      chipHost.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-class]');
        if (!btn) return;

        const lbl = btn.dataset.class;
        if (deltagare_activeClassFilters.has(lbl)) {
          deltagare_activeClassFilters.delete(lbl);
        } else {
          deltagare_activeClassFilters.add(lbl);
        }
        render(); // Rita om
      });
    }

    const btnCsv = document.getElementById('btnExportDeltagareCsv');
    if (btnCsv) {
      btnCsv.addEventListener('click', () => {
        const list = getSortedEquipages();

        const headers = [
          'StartNr', 'Kusk', 'Klass', 'SammanslagenKlass',
          'Förening', 'Häst/Ponny',
          'Häst_Detaljer', 'Grooms', 'Kontakt_Tel', 'Kontakt_Email'
        ];

        const rows = list.map(e => {
          const hLabel = horseLabel(e);

          // Collect horse details
          const horses = Array.isArray(e.horses) ? e.horses : [];
          const horseDetails = horses.map(h => {
            return `[${h.name || ''} (Reg:${h.regNo || ''} ID:${h.horseId || ''})]`;
          }).join('; ');

          const grooms = Array.isArray(e.grooms) ? e.grooms.join(', ')
            : (e.groomName || '');

          return [
            String(e.startNumber ?? ''),
            e.driverName || '',
            e.className || '',
            e._mergedLabel || '',
            e.clubName || '',
            hLabel,
            horseDetails,
            grooms,
            e.phone || e.mobile || e.contactPhone || '',
            e.email || e.contactEmail || ''
          ];
        });

        const comp = getGlobalState('currentCompetition');
        const compName = sanitizeForFilename(comp?.name || 'tavling');
        const date = new Date().toISOString().split('T')[0];
        const filename = `deltagare_${compName}_${date}.csv`;
        downloadCsv(filename, headers, rows);
      });
    }

    const btnPdf = document.getElementById('btnExportDeltagarePdf');
    if (btnPdf) {
      btnPdf.addEventListener('click', async () => {
        const list = getSortedEquipages();
        const comp = getGlobalState('currentCompetition');
        try {
          // Pass 'participants' to get correct columns and title
          await generateStartListPdf(list, 'participants', comp, { viewMode: viewMode });
        } catch (err) {
          console.error(err);
          alert('Fel vid PDF-generering: ' + err.message);
        }
      });
    }

    // Resize listener
    document.body.dataset.wasMobile = isMobile() ? '1' : '0';
    window.__participantsResizeHandler = () => {
      const nowMobile = isMobile() ? '1' : '0';
      if (document.body.dataset.wasMobile !== nowMobile) {
        document.body.dataset.wasMobile = nowMobile;
        render();
      }
    };
    window.addEventListener('resize', window.__participantsResizeHandler, { passive: true });

    // Första renderingen
    render();

  } catch (error) {
    console.error("Kunde inte ladda deltagarlista: ", error);
    document.getElementById('participantListContainer').innerHTML = `<p class="text-red-500 text-center">Kunde inte ladda deltagarlistan.</p>`;
  }
}

export function __unload() {
  console.log("[Deltagare Unload] Startar städning...");

  // 1) Ta bort resize-lyssnare
  if (window.__participantsResizeHandler) {
    try { window.removeEventListener('resize', window.__participantsResizeHandler); } catch { }
    window.__participantsResizeHandler = null;
    console.log("[Deltagare Unload] Resize listener borttagen.");
  }

  // 2) Ta bort ESC-keydown för modalen
  if (window.__participantsKeydownHandler) {
    try { document.removeEventListener('keydown', window.__participantsKeydownHandler); } catch { }
    window.__participantsKeydownHandler = null;
    console.log("[Deltagare Unload] Keydown listener borttagen.");
  }

  // 3) Teardown fast x-scrollbar + body-klass
  try { window.__teardownXbarSync?.(); } catch { }
  document.body.classList.remove('has-fixed-xbar');

  // 4) Ta bort deltagarsidans modalelement + dess stil
  try { document.getElementById('details-modal')?.remove(); } catch { }
  try { document.getElementById('participantsModalStyle')?.remove(); } catch { }

  // 4b) Ta bort listeners
  unsubscribers.forEach(u => { try { u(); } catch { } });
  unsubscribers = [];

  // 5) Ta bort sidans egna bas-stilar
  try { document.getElementById('participantsBaseStyles')?.remove(); } catch { }

  // 6) Nollställ modulens state
  sortConfig = { key: 'className', direction: 'asc' };
  allEquipages = [];
  searchTerm = '';
  viewMode = 'class';

  deltagare_displayConfig = {};
  deltagare_MERGE_MAP.clear();
  deltagare_activeClassFilters.clear();

  // 7) Töm deltagar-containern helt (så inget “spökinnehåll” ligger kvar)
  try { document.getElementById('participantListContainer')?.replaceChildren(); } catch { }

  try { window.__teardownXbarSync?.(); } catch { }
  window.__teardownXbarSync = undefined;
  window.__setupXbarSync = undefined;

  console.log("[Deltagare Unload] Klar.");
}
