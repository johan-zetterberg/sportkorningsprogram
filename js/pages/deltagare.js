import {
  getEquipages,
  getConfig,
  listenForDressageStatusCollection,
  listenForPrecisionResults,
  getMarathonTimingForEquipage
} from '../services/firestoreService.js';
import { getCompetitionHeader, renderResponsiveClassFilter } from '../ui/components.js';
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
import { t } from '../utils/i18n.js';

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
    .dark .modal-content { background: #1f2937; color: #f3f4f6; }
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
    <dt class="font-medium text-gray-800 dark:text-gray-300 shrink-0">${label}</dt>
    <dd class="text-gray-700 dark:text-gray-200 break-words font-normal">${value}</dd>
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
  const canViewDetails = ['admin', 'superadmin', 'domare', 'funktionar', 'official', 'judge', 'sekretariat'].includes(getGlobalState('currentUser')?.role || '');
  let lastClass = null;

  if (sorted.length === 0) {
    container.innerHTML = `<div class="p-6 text-center text-gray-500">${t('no_participants_found')}</div>`;
    return;
  }

  // Funktion för att rendera ett enskilt kort
  const renderCard = (e) => {
    let classHeader = '';
    // === ÄNDRING: Använd _mergedLabel ===
    const currentClassLabel = e._mergedLabel || e.className || t('okand_klass');

    if (viewMode === 'class' && currentClassLabel !== lastClass) {
      lastClass = currentClassLabel;
      classHeader = `<div class="px-4 py-2 mt-2 bg-blue-100 text-blue-800 font-bold text-lg rounded-md">${currentClassLabel}</div>`;
    }

    return `
            ${classHeader}
            <div class="mx-1 mb-2 rounded-xl border dark:border-gray-700 shadow-sm bg-white dark:bg-gray-800 overflow-hidden ${canViewDetails ? 'cursor-pointer hover:bg-blue-50 dark:hover:bg-gray-700' : ''}" data-equipage-id="${e.startNumber}" ${canViewDetails ? 'role="button" tabindex="0"' : ''}>
                <div class="px-3 py-2 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex items-start justify-between gap-3">
                    <div>
                        <div class="font-semibold text-base dark:text-white">${e.driverName || t('namn_saknas')}</div>
                        <div class="text-xs text-gray-500 dark:text-gray-400">${horseLabel(e)}</div>
                    </div>
                    <div class="text-center flex-shrink-0">
                        <div class="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wide leading-none mb-0.5">${t('startnr')}</div>
                        <div class="text-lg font-bold text-gray-900 dark:text-gray-200 leading-none">${e.startNumber || '?'}</div>
                    </div>
                </div>
                <div class="px-3 py-2 grid grid-cols-1 gap-y-1 text-xs dark:text-gray-300">
                    <div class="flex justify-between items-center"><span class="text-gray-500 dark:text-gray-400">${t('klass')}:</span> <span class="font-medium text-right text-gray-900 dark:text-gray-200">${currentClassLabel}</span></div>
                    <div class="flex justify-between items-center"><span class="text-gray-500 dark:text-gray-400">${t('klubb')}:</span>
                        <span class="font-medium flex items-center gap-1.5 text-right text-gray-900 dark:text-gray-200">
                            ${getFlagHtml(e)}
                            ${getClubLogoHtml(e)}
                            <span class="truncate max-w-[150px]">${e.clubName || '—'}</span>
                        </span>
                    </div>
                </div>
            </div>
        `;
  };

  const cardsHtml = sorted.map(renderCard).join('');
  container.innerHTML = `<div class="bg-gray-50 dark:bg-gray-900 py-1">${cardsHtml}</div>`;

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
  const clubLogo = await _fetchImage(clubLogoUrl);

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
    if (status.percent) return `<span class="text-green-700 dark:text-green-400 font-bold">Klar (${parseFloat(status.percent).toFixed(2)}%)</span>`;
    if (status.score) return `<span class="text-green-700 dark:text-green-400 font-bold">Klar (${parseFloat(status.score).toFixed(2)} p)</span>`;
  }

  // 2. Pågår?
  if (status?.state === 'active') return `<span class="text-blue-600 dark:text-blue-400 animate-pulse font-semibold">På banan</span>`;

  // 3. Starttid?
  if (st) return `<span class="text-gray-900 dark:text-gray-300">Start: ${formatStatusTime(st)}</span>`;

  return '<span class="text-gray-400 dark:text-gray-500 italic">Ej startat</span>';
}

function renderPrecisionStatus(startNo) {
  const sn = String(startNo);
  const st = startTimesMap[sn]?.precision;
  const res = precisionResultsMap.get(sn);

  // 1. Resultat?
  if (res && res.finalized) {
    const pen = res.totalPenalty ?? ((res.knocks || 0) * 3 + (res.timePenalty || 0));
    return `<span class="text-green-700 dark:text-green-400 font-bold">Klar (${pen} straff)</span>`;
  }

  // 2. Pågår?
  if (res?.running) return `<span class="text-blue-600 dark:text-blue-400 animate-pulse font-semibold">På banan</span>`;

  // 3. Starttid?
  if (st) return `<span class="text-gray-900 dark:text-gray-300">Start: ${formatStatusTime(st)}</span>`;

  return '<span class="text-gray-400 dark:text-gray-500 italic">Ej startat</span>';
}

async function updateMarathonStatus(compId, startNo) {
  const el = document.getElementById('marathon-status-placeholder');
  if (!el || !compId || !startNo) return;

  try {
    // Vi hämtar BARA start/mål-tider, inte hela resultatet (för prestanda)
    const timing = await getMarathonTimingForEquipage(compId, startNo);
    const st = startTimesMap[String(startNo)]?.marathon;

    let html = '<span class="text-gray-400 dark:text-gray-500 italic">Ej startat</span>';

    if (timing?.finish_B) {
      // Målgång i hinderfasen -> antagligen klar
      html = `<span class="text-green-700 dark:text-green-400 font-bold">Målgång (tid togs)</span> <br><a href="#maraton-resultat" class="text-xs text-blue-500 dark:text-blue-400 underline">Se resultat</a>`;
    } else if (timing?.start_A) {
      // Startat A-fasen
      html = `<span class="text-blue-600 dark:text-blue-400 animate-pulse font-semibold">På banan</span>`;
    } else if (st) {
      html = `<span class="text-gray-900 dark:text-gray-300">Start: ${formatStatusTime(st)}</span>`;
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


  // Visa overlay först
  modal.classList.remove('hidden');
  modal.offsetHeight; // force reflow
  modal.classList.add('visible');


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
      <h3 class="text-xl font-bold dark:text-white">#${startNo} ${driverName}</h3>
      <div class="text-sm text-gray-500 dark:text-gray-400 italic">${horseLabel(equipage)}</div>
      <div class="text-gray-600 dark:text-gray-300 flex items-center gap-2 mt-1">
        ${getFlagHtml(equipage)}
        ${getClubLogoHtml(equipage)}
        <span>${className} • ${clubName}</span>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <button id="printPdfBtn" class="needs-online px-3 py-1 rounded bg-gray-900 dark:bg-gray-700 text-white text-sm">Skriv ut PDF</button>
      <button id="modal-close-btn" class="px-2 py-1 text-2xl leading-none dark:text-gray-300" aria-label="Stäng">&times;</button>
    </div>
  </div>
`;

  // ... (resten av horsesHtml och momentHorsesHtml är ok) ...
  const horsesHtml = (horses.length
    ? horses.map((h, idx) => `
          <div class="p-3 rounded border bg-white dark:bg-gray-800 dark:border-gray-700">
            <div class="font-bold text-gray-900 dark:text-white mb-1 text-sm">${t('hast_ponny')} ${idx + 1}: ${h.name || h.horseName || '—'}</div>
          <div class="space-y-1 text-sm">
             <div class="grid grid-cols-2 gap-x-4 mb-2">
                ${kv(t('ras'), h.breed || '')}
                ${kv(t('farg'), h.color || '')}
                ${kv(t('kon'), h.gender || h.sex || '')}
                ${kv(t('alder'), h.age ? `${h.age} ${t('ar')}` : (h.bornYear ? `${new Date().getFullYear() - h.bornYear} ${t('ar')}` : ''))}
             </div>
            ${kv(t('harstamning'), h.lineage || '')}
            ${kv('Reg.nummer', h.regNo || '')}
            ${kv('Häst-ID (tävling)', h.horseId || '')}
            ${kv('Licensnr', h.license || '')}
            ${kv('Chipnr', h.chip || h.chipNo || '')}
            ${kv('UELN/Passnr', h.ueln || '')}
            ${kv(t('stambok'), h.studbook || '')}
            ${kv(t('agare'), h.owner || h.horseOwner || '')}
            ${kv(t('uppfodare'), h.breeder || '')}
            ${h.vaccinationDate ? kv(t('vaccination'), h.vaccinationDate) : ''}
          </div>
        </dd>`).join('')
    : `<dd class="text-gray-500 text-sm">${t('inga_hastar')}</dd>`
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
      if (ids.length === 0) return `<span class="italic text-gray-500">${t('ej_valt')}</span>`;
      return ids.map(id => horseMap.get(id) || id).join(', ');
    };

    momentHorsesHtml = `
            <div class="mt-3 pl-4 border-l-2 ml-1 border-blue-300 bg-blue-50 p-2 rounded-r-md">
                <div class="font-bold text-blue-800 mb-2 text-sm">${t('valda_for_moment')}</div>
                <div class="space-y-1 text-sm">
                    ${kv(t('dressyr'), getHorseNames('dressage'))}
                    ${kv(t('maraton'), getHorseNames('marathon'))}
                    ${kv(t('precision'), getHorseNames('precision'))}
                </div>
            </div>
        `;
  }
  const groomsHtml = (Array.isArray(grooms) && grooms.length)
    ? `<dd class="mt-3 pl-6 border-l-2 ml-1"><ul class="list-disc pl-5 text-gray-700 text-sm">${grooms.map((g) => `<li>${(g?.name) || g}</li>`).join('')}</ul></dd>` : '';

  contentWrap.innerHTML = `
    <div class="p-6 md:p-10">
      ${headerHtml}
      <div class="mt-4 border-t pt-4 space-y-6 text-sm">
      
        <!-- TÄVLINGSSTATUS -->
        <section class="bg-slate-50 dark:bg-gray-800 p-3 rounded-lg border border-slate-200 dark:border-gray-700">
          <h4 class="font-bold text-base mb-2 flex items-center gap-2">
            🏆 Tävlingsstatus
            <span class="text-xs font-normal text-gray-500">(Live)</span>
          </h4>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            
            <!-- DRESSYR -->
            <div class="space-y-1">
              <div class="font-semibold text-gray-700 dark:text-gray-300">Dressyr</div>
              ${renderDressageStatus(startNo)}
            </div>

            <!-- MARATON -->
            <div class="space-y-1">
              <div class="font-semibold text-gray-700 dark:text-gray-300">Maraton</div>
              <div id="marathon-status-placeholder" class="text-gray-600 dark:text-gray-400">Laddar...</div>
            </div>

            <!-- PRECISION -->
            <div class="space-y-1">
              <div class="font-semibold text-gray-700 dark:text-gray-300">Precision</div>
              ${renderPrecisionStatus(startNo)}
            </div>

          </div>
        </section>

        <section>
          <h4 class="font-bold text-base mb-2 dark:text-white">Ekipage</h4>
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
        <section class="border-t dark:border-gray-700 pt-4">
          <h4 class="font-bold text-base mb-2 dark:text-white">Kontakt & behörigheter</h4>
          <div class="space-y-1">
            ${kv('Telefon', phone)}
            ${kv('E-post', email)}
            ${kv('Adress', fullAddress)}
            ${kv('Land', equipage.country || '')}
            ${kv('Personnummer', personnr)}
            ${kv('Födelseår', equipage.bornYear || '')}
            ${kv('Kön', equipage.gender || '')}
            ${kv('Licensnr', license + (equipage.licenseYear ? ` (${equipage.licenseYear})` : ''))}
            ${kv('Klubb-ID', clubId)}
            ${kv('Företag', equipage.company || '')}
          </div>
        </section>
        <section class="border-t dark:border-gray-700 pt-4">
          <h4 class="font-bold text-base mb-2 dark:text-white">Betalning & avgifter</h4>
          <div class="space-y-1">
            ${kv('Status', payTxt)}
            ${kv('Summa', fmtMoney(payAmount))}
            ${kv('Övriga avgifter', fmtList(otherFees))}
          </div>
        </section>
        <section class="border-t dark:border-gray-700 pt-4">
          <h4 class="font-bold text-base mb-2 dark:text-white">Hästar</h4>
          <dl>
            ${horsesHtml}
            ${momentHorsesHtml}
          </dl>
        </section>
        ${groomsHtml ? `
        <section class="border-t dark:border-gray-700 pt-4">
          <h4 class="font-bold text-base mb-2 dark:text-white">Groom(s)</h4>
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
    { key: 'className', label: t('klass') }, { key: 'startNumber', label: '#' },
    { key: 'driverName', label: t('kusk') }, { key: 'clubName', label: t('klubb') },
    { key: 'horseName', label: t('hast_ponny') }
  ];
  // === ÄNDRING: Lade till canViewDetails-kontroll ===
  const canViewDetails = ['admin', 'superadmin', 'domare', 'funktionar', 'official', 'judge', 'sekretariat'].includes(getGlobalState('currentUser')?.role || '');

  let tableHtml = `
      <div id="participant-x-host" class="x-scroll-wrap">
        <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700 participants-table"> <thead class="bg-gray-50 dark:bg-gray-700 sticky top-0">
                <tr>${headers.map(h => {
    const isSorted = sortConfig.key === h.key;
    const sortArrow = isSorted ? (sortConfig.direction === 'asc' ? ' ▲' : ' ▼') : '';
    return `<th class="px-2 py-2 lg:px-4 lg:py-3 text-left text-[11px] lg:text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider sortable-header whitespace-nowrap" data-sort-key="${h.key}">${h.label}${sortArrow}</th>`;
  }).join('')}</tr>
            </thead>
            <tbody class="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
    `;

  if (sortedEquipages.length === 0) {
    tableHtml += `<tr><td colspan="${headers.length}" class="p-4 text-center text-gray-500">Inga deltagare att visa.</td></tr>`;
  } else {
    sortedEquipages.forEach(e => {
      // === ÄNDRING: Lade till cursor-pointer om canViewDetails ===
      tableHtml += `
                <tr class="${canViewDetails ? 'cursor-pointer hover:bg-blue-50 dark:hover:bg-gray-700' : ''} border-b dark:border-gray-700 last:border-0" data-equipage-id="${e.startNumber}">
                    <td class="px-2 py-2 lg:px-4 lg:py-3 text-[11px] lg:text-sm text-gray-700 dark:text-gray-300 align-middle"><div class="xl:max-w-none max-w-[80px] md:max-w-[140px] truncate" title="${e._mergedLabel || e.className || ''}">${e._mergedLabel || e.className || ''}</div></td>
                    <td class="px-2 py-2 lg:px-4 lg:py-3 whitespace-nowrap font-bold text-[11px] lg:text-sm text-gray-900 dark:text-white align-middle text-center">${e.startNumber || ''}</td>
                    <td class="px-2 py-2 lg:px-4 lg:py-3 font-medium text-[11px] lg:text-sm text-gray-900 dark:text-white align-middle whitespace-nowrap">${e.driverName || ''}</td>
                    <td class="px-2 py-2 lg:px-4 lg:py-3 text-[11px] lg:text-sm text-gray-700 dark:text-gray-300 align-middle whitespace-nowrap">
                        <span class="inline-flex items-center gap-1.5 whitespace-nowrap"> 
                            ${getFlagHtml(e)}
                            ${getClubLogoHtml(e)}
                            <span class="inline-block truncate max-w-[100px] md:max-w-[160px] xl:max-w-none" title="${e.clubName || ''}">${e.clubName || ''}</span>
                        </span>
                    </td>
                    <td class="px-2 py-2 lg:px-4 lg:py-3 text-[11px] lg:text-sm text-gray-700 dark:text-gray-300 align-middle"><div class="whitespace-nowrap" title="${horseLabel(e)}">${horseLabel(e)}</div></td>
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

  const labels = [...new Set(allEquipages.map(e => e._mergedLabel || e.className || '—'))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'sv'));

  renderResponsiveClassFilter(chipHost, labels, deltagare_activeClassFilters, (lbl) => {
    if (deltagare_activeClassFilters.has(lbl)) {
      deltagare_activeClassFilters.delete(lbl);
    } else {
      deltagare_activeClassFilters.add(lbl);
    }
    render();
  });
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
        ${getCompetitionHeader(competition, t('deltagarlista'))}
        <div class="bg-white dark:bg-gray-800 p-2 lg:p-4 rounded-xl shadow-md border dark:border-gray-700">
            <div class="flex flex-wrap items-center gap-2 mb-3 bg-white dark:bg-gray-800">
                <div class="search-input-wrap flex-1 min-w-[200px] relative">
                    <i class="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 z-10 text-xs"></i>
                    <input id="participantSearch" type="search" placeholder="${t('search_participant_placeholder')}" class="w-full pl-8 pr-3 py-1.5 border rounded leading-5 dark:bg-gray-900 dark:border-gray-600 dark:text-gray-100 focus:ring-1 focus:ring-blue-500 shadow-sm text-xs" autocomplete="off">
                </div>
                    
                <select id="viewModeSelect" class="border rounded px-2 py-1.5 text-xs dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200 shadow-sm focus:ring-1 focus:ring-blue-500">
                    <option value="class">${t('view_by_class')}</option>
                    <option value="start">${t('view_by_startno')}</option>
                </select>

                <div class="flex items-center gap-1.5 ml-auto">
                    <button id="btnExportDeltagareCsv" type="button" title="Exportera CSV" class="inline-flex items-center px-2 py-1.5 border border-gray-300 dark:border-gray-600 shadow-sm text-xs font-medium rounded text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors">
                      <i class="fas fa-file-csv mr-1 text-gray-500 dark:text-gray-400"></i> CSV
                    </button>
                    <button id="btnExportDeltagarePdf" type="button" class="inline-flex items-center px-2 py-1.5 border border-transparent shadow-sm text-xs font-medium rounded text-white bg-gray-600 hover:bg-gray-700 transition-colors">
                      <svg class="mr-1 h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 1 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg> PDF
                    </button>
                </div>
            </div>
            
            <div id="deltagareClassChips" class="mb-2 flex flex-wrap gap-1"></div>

            <div id="participantListContainer"><p class="text-center text-gray-500 dark:text-gray-400">${t('loading_participants')}</p></div>
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
        const canViewDetails = ['admin', 'superadmin', 'domare', 'funktionar', 'official', 'judge', 'sekretariat'].includes(getGlobalState('currentUser')?.role || '');
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

    const modeSel = document.getElementById('viewModeSelect');
    if (modeSel) {
      modeSel.value = viewMode;
      modeSel.addEventListener('change', (e) => {
        viewMode = e.target.value;
        if (viewMode === 'class') sortConfig = { key: 'className', direction: 'asc' };
        else sortConfig = { key: 'startNumber', direction: 'asc' };
        render();
      });
    }

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

  // 1) Ta bort resize-lyssnare
  if (window.__participantsResizeHandler) {
    try { window.removeEventListener('resize', window.__participantsResizeHandler); } catch { }
    window.__participantsResizeHandler = null;

  }

  // 2) Ta bort ESC-keydown för modalen
  if (window.__participantsKeydownHandler) {
    try { document.removeEventListener('keydown', window.__participantsKeydownHandler); } catch { }
    window.__participantsKeydownHandler = null;

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


}
