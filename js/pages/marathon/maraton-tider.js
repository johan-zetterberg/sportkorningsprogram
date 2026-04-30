// maraton-tider.js

import { getEquipages, getConfig } from '../../services/firestoreService.js';
import { getGlobalState } from '../../main.js';
import { getCompetitionHeader, createSearchableDropdown, showAlert } from '../../ui/components.js';
import { ensureClubLogosLoaded, getClubLogoUrl, getClubLogoHtml } from '../../services/logosService.js';
import { fetchFlagDataUrl, getFlagHtml, normalizeCountryCode } from '../../services/flagsService.js';
import { t } from '../../utils/i18n.js';
import { 
  setMarathonConfig, 
  detectTRCategoryFromEquipage, 
  normalizeClassKey, 
  getClassSettings,
  ensureMergeDecorations,
  DEFAULT_TRV_TEMPOS_KMH
} from '../../utils/marathonUtils.js';

// === ETA helpers ===
let MARATHON_CONFIG = {};
let CURRENT_EQUIPAGE = null;

function horseLabel(eq) {
  if (!eq) return '—';
  // Stöd lite olika fält – räcker gott för utskriften
  const candidates = [];
  const take = v => { if (v && String(v).trim()) candidates.push(String(v).trim()); };
  if (Array.isArray(eq.horses)) {
    eq.horses.forEach(h => take(h?.name || h?.horseName || h?.hästnamn));
  }
  take(eq.horseName); take(eq.hästnamn); take(eq.hastnamn);
  const s = candidates.join(' & ');
  return s || '—';
}

/**
 * Hämtar hästnamn för ett ekipage för ett specifikt moment.
 * Om 'moment' anges (t.ex. 'marathon') och val finns, visas de valda hästarna.
 * Annars visas alla registrerade hästar som fallback.
 * @param {object} equipage - Ekipageobjektet.
 * @param {'dressage' | 'marathon' | 'precision'} moment - Momentet att hämta hästar för.
 * @returns {string} - En sträng med hästnamn, separerade av ' & ', eller '—'.
 */
function getMomentHorseLabel(equipage, moment) {
  if (!equipage || typeof equipage !== 'object') return '—';
  const allHorsesRaw = equipage.horses || equipage.horseNames || equipage.horse || [];
  let allHorses = [];
  if (Array.isArray(allHorsesRaw)) {
    allHorses = allHorsesRaw.map(h => (typeof h === 'string' ? { name: h } : h)).filter(h => h && h.name);
  } else if (typeof allHorsesRaw === 'string' && allHorsesRaw.trim()) {
    allHorses = allHorsesRaw.split(/[\/,&+]|(?:\s*&\s*)/).map(name => ({ name: name.trim() })).filter(h => h.name);
  } else if (typeof allHorsesRaw === 'object' && allHorsesRaw.name) {
    allHorses = [allHorsesRaw];
  }
  if (allHorses.length === 0) return '—';
  const horseMap = new Map(allHorses.map(h => [h.id || h.name, h.name]));
  let horseIdsToShow = [];
  if (moment && equipage.momentHorses && Array.isArray(equipage.momentHorses[moment]) && equipage.momentHorses[moment].length > 0) {
    horseIdsToShow = equipage.momentHorses[moment];
  }
  if (horseIdsToShow.length > 0) {
    return horseIdsToShow.map(id => horseMap.get(id) || id).join(' & ');
  } else {
    return allHorses.map(h => h.name).filter(Boolean).join(' & ');
  }
}

function getClassDistancesFromConfig(className) {
  if (!className) return null;

  // 1. Först: Kolla i det specifika distans-fältet (ofta använt i admin)
  const distCfg = MARATHON_CONFIG?.marathonClassDistances || MARATHON_CONFIG?.maratonClassDistances;
  if (distCfg) {
    // Exakt match
    if (distCfg[className]) return distCfg[className];
    // Prefix-match
    let k = Object.keys(distCfg).find(x => className.toLowerCase().startsWith(x.toLowerCase()));
    // Normaliserad match (t.ex. "LA" -> "Lätt A" matchar "Lätt A")
    if (!k) {
      const normClassName = normalizeClassKey(className);
      if (normClassName) {
        k = Object.keys(distCfg).find(x => normalizeClassKey(x) === normClassName);
      }
    }
    if (k) return distCfg[k];
  }

  // 2. Fallback: Använd centrala getClassSettings (som numera har inbyggd normalisering)
  const settings = getClassSettings(className);
  if (!settings) return null;

  const tempoMpm = Number.isFinite(Number(settings.tempoT)) ? Number(settings.tempoT) : null;
  return {
    A: { distance: Number(settings.distanceA) || 0 },
    T: { distance: Number(settings.distanceT) || 0, tempo_mpm: tempoMpm },
    B: { distance: Number(settings.distanceB) || 0 },
  };
}

// TR-tempo (m/min) för A/B – fyll på vid behov
const TR_TEMPO = {
  // exempel (justera efter TR V 2025):
  ponyCD: { A: 14 * 60 / 100, B: 14 * 60 / 100 },  // ersätt med korrekta tal
  horse: { A: 14 * 60 / 100, B: 14 * 60 / 100 },
};
function tempoFor(stage, className, categoryKey, cfg) {
  if (stage === 'T') return cfg?.T?.tempo_mpm ?? null;
  // A/B: försök hämta från TR-tabell via categoryKey (ponyCD, horse, osv)
  const tr = TR_TEMPO[categoryKey]?.[stage];
  return Number.isFinite(tr) ? tr : null;
}
function idealMillis(stage, className, categoryKey) {
  const cfg = getClassDistancesFromConfig(className);
  if (!cfg) return null;
  const dist = (stage === 'A' ? cfg.A?.distance : stage === 'B' ? cfg.B?.distance : cfg.T?.distance) || 0;
  const tempo = tempoFor(stage, className, categoryKey, cfg); // m/min
  if (!Number.isFinite(dist) || !Number.isFinite(tempo) || tempo <= 0) return null;
  const minutes = dist / tempo;
  return Math.round(minutes * 60 * 1000);
}
function fmtClock(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// TRV_2025_MARATON_TEMPOS_KMH is now imported as DEFAULT_TRV_TEMPOS_KMH from marathonUtils.js
const TRV_2025_MARATON_TEMPOS_KMH = DEFAULT_TRV_TEMPOS_KMH;

// FEI - namngivna klasser för droppen (täcker stjärn-nivåer + ålderskategorier)
const FEI_CLASS_NAMES = [
  // Star-levels
  "CAI 1*", "CAI 2*", "CAI 3*", "CAI 4*",
  // Junior / Young / Children varianter (både generiska och CAI-prefix)
  "Children", "Junior", "Young Drivers (U25)", "U25",
  "CAICH 1*", "CAIJ 1*", "CAIJ 2*", "CAIY 2*",
  // Vanliga ekipage-typer på FEI (hjälper presentationen)
  "Horse Singles", "Horse Pairs", "Horse Four-in-Hand",
  "Pony Singles", "Pony Pairs", "Pony Four-in-Hand"
];

// FEI – "vanliga" standardtempon (km/h) för A och B.
// OBS: Schedules kan ange andra värden – dina manuella overrides gäller alltid.
const FEI_MARATON_TEMPOS_KMH = {
  // — Nivåer (star levels) —
  "CAI 1*": {
    A: { ponyA: 12.0, ponyB: 12.5, ponyCD: 13.0, horse: 14.0 },
    B: { ponyA: 11.0, ponyB: 11.5, ponyCD: 12.0, horse: 13.0 }
  },
  "CAI 2*": {
    A: { ponyA: 12.5, ponyB: 13.0, ponyCD: 13.5, horse: 14.5 },
    B: { ponyA: 11.5, ponyB: 12.0, ponyCD: 12.5, horse: 13.5 }
  },
  "CAI 3*": {
    A: { ponyA: 13.0, ponyB: 13.5, ponyCD: 14.0, horse: 15.0 },
    B: { ponyA: 12.0, ponyB: 12.5, ponyCD: 13.0, horse: 14.0 }
  },
  // 4* varierar ofta med Schedule – lämnas tomma som default (kan skrivas in manuellt)
  "CAI 4*": {
    A: { ponyA: null, ponyB: null, ponyCD: null, horse: null },
    B: { ponyA: null, ponyB: null, ponyCD: null, horse: null }
  },

  // — Ålderskategorier/Mästerskap —
  // Children: praktiskt taget alltid ponny – lämna horse=null
  "Children": {
    A: { ponyA: 11.0, ponyB: 11.5, ponyCD: 12.0, horse: null },
    B: { ponyA: 10.0, ponyB: 10.5, ponyCD: 11.0, horse: null }
  },
  "Junior": {
    A: { ponyA: 12.0, ponyB: 12.5, ponyCD: 13.0, horse: null },
    B: { ponyA: 11.0, ponyB: 11.5, ponyCD: 12.0, horse: null }
  },
  // Young Drivers / U25 (häst förekommer ofta)
  "Young Drivers (U25)": {
    A: { ponyA: 12.5, ponyB: 13.0, ponyCD: 13.5, horse: 14.0 },
    B: { ponyA: 11.5, ponyB: 12.0, ponyCD: 12.5, horse: 13.0 }
  },
  "U25": {
    A: { ponyA: 12.5, ponyB: 13.0, ponyCD: 13.5, horse: 14.0 },
    B: { ponyA: 11.5, ponyB: 12.0, ponyCD: 12.5, horse: 13.0 }
  },

  // — Prefixvarianter som ofta förekommer i Schedules —
  "CAICH 1*": { // Children
    A: { ponyA: 11.0, ponyB: 11.5, ponyCD: 12.0, horse: null },
    B: { ponyA: 10.0, ponyB: 10.5, ponyCD: 11.0, horse: null }
  },
  "CAIJ 1*": {  // Junior 1*
    A: { ponyA: 12.0, ponyB: 12.5, ponyCD: 13.0, horse: null },
    B: { ponyA: 11.0, ponyB: 11.5, ponyCD: 12.0, horse: null }
  },
  "CAIJ 2*": {  // Junior 2*
    A: { ponyA: 12.5, ponyB: 13.0, ponyCD: 13.5, horse: null },
    B: { ponyA: 11.5, ponyB: 12.0, ponyCD: 12.5, horse: null }
  },
  "CAIY 2*": {  // Young Drivers 2*
    A: { ponyA: 12.5, ponyB: 13.0, ponyCD: 13.5, horse: 14.0 },
    B: { ponyA: 11.5, ponyB: 12.0, ponyCD: 12.5, horse: 13.0 }
  },

  // — Beskrivande "klassnamn" (mapping till kategori 'horse'/'pony*') —
  // Lämnas tomma som default: täcks av manuella inputs eller specifika Schedules.
  "Horse Singles": { A: { ponyA: null, ponyB: null, ponyCD: null, horse: 14.0 }, B: { ponyA: null, ponyB: null, ponyCD: null, horse: 13.0 } },
  "Horse Pairs": { A: { ponyA: null, ponyB: null, ponyCD: null, horse: 14.0 }, B: { ponyA: null, ponyB: null, ponyCD: null, horse: 13.0 } },
  "Horse Four-in-Hand": { A: { ponyA: null, ponyB: null, ponyCD: null, horse: 14.0 }, B: { ponyA: null, ponyB: null, ponyCD: null, horse: 13.0 } },
  "Pony Singles": { A: { ponyA: 12.5, ponyB: 13.0, ponyCD: 13.5, horse: null }, B: { ponyA: 11.5, ponyB: 12.0, ponyCD: 12.5, horse: null } },
  "Pony Pairs": { A: { ponyA: 12.5, ponyB: 13.0, ponyCD: 13.5, horse: null }, B: { ponyA: 11.5, ponyB: 12.0, ponyCD: 12.5, horse: null } },
  "Pony Four-in-Hand": { A: { ponyA: 12.5, ponyB: 13.0, ponyCD: 13.5, horse: null }, B: { ponyA: 11.5, ponyB: 12.0, ponyCD: 12.5, horse: null } }
};


function getTempoTable({ isManual, ruleValue }) {
  if (isManual && ruleValue === 'FEI') return FEI_MARATON_TEMPOS_KMH;
  return MARATHON_CONFIG?.tempoRules || TRV_2025_MARATON_TEMPOS_KMH;
}

const kmhToMmin = (kmh) => (kmh * 1000) / 60;

function injectPrintStyles() {
  const styleId = 'maraton-print-styles';
  if (document.getElementById(styleId)) return;

  const styles = `
    @page { size: A4; margin: 14mm; }
    @media print {
      body > *:not(#page-maraton-tider) { display: none !important; }
      #non-printable-content, #screen-area { display: none !important; }
      #page-maraton-tider, #maratonTiderResultat, #printable-area {
        display: block !important; visibility: visible !important; margin: 0 !important; padding: 0 !important;
      }
      #printable-area {
        display: block !important; color: #000 !important; font-size: 12pt !important;
      }
      #maratonPrintHeader {
        display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 12pt;
        border-bottom: 1px solid #ccc; padding-bottom: 8pt; margin-bottom: 10pt;
      }
      #maratonPrintHeader .title { font-weight: 800; font-size: 16pt; }
      #maratonPrintHeader .meta  { color:#444; font-size: 10pt; }
      #maratonPrintHeader .badges{ display:flex; gap:8pt; align-items:center; }
      #maratonPrintHeader .pill  { border:1px solid #ddd; border-radius:9999px; padding:2pt 8pt; font-size:9pt; }
      #maratonPrintHeader .flag, #maratonPrintHeader .club { height:16pt; display:inline-block; }

      #printable-area h3 { font-size: 12pt !important; margin: 10pt 0 6pt; page-break-after: avoid; }
      #printable-area table { width: 100%; border-collapse: collapse; page-break-inside: avoid; }
      #printable-area th, #printable-area td { border: 1px solid #000; padding: 6pt; vertical-align: middle; }
      #printable-area th { background: #f5f6f8; }
      #printable-area td.time { text-align: center; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

      /* STORA skrivytor – gör kommentarrutorna höga och luftiga */
      #printable-area .comment-box     { border: 1px dashed #999; height: 36pt; background-color: #fafafa; }
      #printable-area .comment-header  { width: 30%; }
      #printable-area .notes-block     { height: 110pt; border: 1px dashed #bbb; background: #fafafa; margin: 8pt 0 14pt; }
      #printable-area .notes-title     { font-weight: 700; font-size: 10pt; margin-bottom: 4pt; }
    }
  `;

  const styleEl = document.createElement('style');
  styleEl.id = styleId;
  styleEl.textContent = styles;
  document.head.appendChild(styleEl);
}

async function fetchImageDataUrl(url) {
  if (!url) return null;
  try {
    const img = new Image(); img.crossOrigin = 'anonymous'; img.src = url;
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return { dataUrl: c.toDataURL('image/png'), w: img.naturalWidth, h: img.naturalHeight };
  } catch { return null; }
}

async function setupPage(competitionId) {
  CURRENT_EQUIPAGE = null;
  const root = document.getElementById('page-maraton-tider');
  const searchContainer = document.getElementById('maratonTiderEquipageSearch');
  const visaBtn = document.getElementById('visaMaratonTiderBtn');
  const printBtn = document.getElementById('printMaratonTiderBtn');
  let allEquipages = [];
  MARATHON_CONFIG =
    (await getConfig(competitionId, 'maratonConfig'))
    || (await getConfig(competitionId, 'marathonConfig'))
    || {};
  setMarathonConfig(MARATHON_CONFIG);
  let equipageSearchDropdown;
  try {
    const rawEquipages = await getEquipages(competitionId);
    allEquipages = ensureMergeDecorations(rawEquipages);
    const sortedEquipages = allEquipages.sort((a, b) => a.startNumber - b.startNumber);
    equipageSearchDropdown = createSearchableDropdown(searchContainer, sortedEquipages, onEquipageSelectionChange);

    function onEquipageSelectionChange() {
      const startNumber = equipageSearchDropdown.getValue();
      const infoEl = document.getElementById('selectedEquipageInfo');
      if (startNumber) {
        const equipage = allEquipages.find(e => e.startNumber == startNumber);
        CURRENT_EQUIPAGE = equipage; // <-- spara valet
        const categoryKey = detectTRCategoryFromEquipage(equipage);
        const eqClass = equipage._mergedLabel || equipage.mergedTestLabel || equipage.className || '';
        infoEl.textContent = t('class_category_label').replace('{class}', eqClass).replace('{cat}', categoryKey);
      } else {
        infoEl.textContent = '';
      }
      const mode = document.querySelector('input[name="distanceMode"]:checked').value;
      if (mode === 'auto') updateDistancesFromConfig();
    }

    // Fyll klasslistan beroende på regelverk (TR eller FEI)
    const classSel = document.getElementById('manualClassSelect');
    function populateClassOptionsForRule(rule) {
      if (!classSel) return;
      const table = rule === 'FEI' ? FEI_MARATON_TEMPOS_KMH : TRV_2025_MARATON_TEMPOS_KMH;
      const prev = classSel.value;
      classSel.innerHTML = '';
      // FEI: använd vår fördefinierade lista + ev. extra nycklar från tabellen
      const names = rule === 'FEI'
        ? Array.from(new Set([...FEI_CLASS_NAMES, ...Object.keys(table || {})]))
        : Object.keys(table || {});
      names.forEach(k => {
        const opt = document.createElement('option');
        opt.value = k; opt.textContent = k;
        classSel.appendChild(opt);
      });
      // Behåll tidigare val om det fortfarande finns, annars välj första
      if ([...classSel.options].some(o => o.value === prev)) classSel.value = prev;
    }
    // Initial population
    populateClassOptionsForRule(document.getElementById('manualRuleSelect')?.value || 'TR');

    // Autofyll manuella tempon från TR + tempo T från konfig
    function fillManualTemposFromRule() {
      const cls = document.getElementById('manualClassSelect')?.value || '';
      const cat = document.getElementById('manualCategorySelect')?.value || 'horse';
      const rule = document.getElementById('manualRuleSelect')?.value || 'TR';
      if (!cls) return;
      const table = (rule === 'FEI') ? FEI_MARATON_TEMPOS_KMH : TRV_2025_MARATON_TEMPOS_KMH;
      const tempoA = table[cls]?.A?.[cat];
      const tempoB = table[cls]?.B?.[cat];
      const inA = document.getElementById('manualTempoAInput');
      const inB = document.getElementById('manualTempoBInput');
      if (Number.isFinite(tempoA) && !inA.value) inA.value = String(tempoA);
      if (Number.isFinite(tempoB) && !inB.value) inB.value = String(tempoB);
      // transport tempo (m/min) om finns i klasskonfig
      const cfg = getClassDistancesFromConfig(cls);
      const t = cfg?.T?.tempo_mpm;
      const inT = document.getElementById('manualTransportTempoInput');
      if (Number.isFinite(t) && inT && !inT.value) inT.value = String(t);
    }
    ['manualClassSelect', 'manualCategorySelect'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', fillManualTemposFromRule);
    });
    document.getElementById('manualRuleSelect')?.addEventListener('change', () => {
      const rule = document.getElementById('manualRuleSelect')?.value || 'TR';
      populateClassOptionsForRule(rule);
      fillManualTemposFromRule();
    });
    // NY HJÄLPFUNKTION för att hitta bästa matchning för klassens distans
    function findDistanceConfigForClass(className, allClassDistances) {
      if (!className || !allClassDistances) return null;

      // 1. Försök med en exakt matchning först (snabbast)
      if (allClassDistances[className]) {
        return allClassDistances[className];
      }

      // 2. Om ingen exakt matchning, leta efter en nyckel som är en del av klassnamnet
      //    Exempel: Konfig-nyckel "Lätt A" matchar ekipagets klass "Lätt A Para"
      const matchingKey = Object.keys(allClassDistances)
        .find(key => className.startsWith(key));

      return matchingKey ? allClassDistances[matchingKey] : null;
    }

    // UPPDATERAD FUNKTION som använder den nya hjälplogiken
    function updateDistancesFromConfig() {
      const startNumber = equipageSearchDropdown.getValue();
      if (!startNumber) return;

      const equipage = allEquipages.find(e => e.startNumber == startNumber);
      if (!equipage) return;

      // Använder den nya, smartare sökfunktionen
      const distClassName = equipage._mergedLabel || equipage.className || '';
      const classDistances = getClassDistancesFromConfig(distClassName);
      document.getElementById('maratonTiderDistAAuto').textContent = classDistances?.A?.distance ? `${classDistances.A.distance} m` : t('not_specified');
      document.getElementById('maratonTiderDistTAuto').textContent = classDistances?.T?.distance ? `${classDistances.T.distance} m` : t('not_specified');
      document.getElementById('maratonTiderDistBAuto').textContent = classDistances?.B?.distance ? `${classDistances.B.distance} m` : t('not_specified');
    }

    document.querySelectorAll('input[name="distanceMode"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        const isAuto = e.target.value === 'auto';
        document.getElementById('manual-inputs').classList.toggle('hidden', isAuto);
        document.getElementById('manual-meta').classList.toggle('hidden', isAuto);
        document.getElementById('auto-inputs').classList.toggle('hidden', !isAuto);
        if (isAuto) {
          updateDistancesFromConfig();
        } else {
          const rule = document.getElementById('manualRuleSelect')?.value || 'TR';
          populateClassOptionsForRule(rule);
          fillManualTemposFromRule();
        }
      });
    });

    printBtn.addEventListener('click', () => generateMarathonPdfFromCurrent());

    visaBtn.addEventListener('click', () => {
      const startNumber = equipageSearchDropdown.getValue();
      const mode = document.querySelector('input[name="distanceMode"]:checked').value;
      const ruleVal = document.getElementById('manualRuleSelect')?.value || 'TR';
      const tempoTable = getTempoTable({ isManual: mode === 'manual', ruleValue: ruleVal });
      let equipage, className, categoryKey, transportTempoMpm, tempoAOverride, tempoBOverride;
      if (startNumber) {
        equipage = allEquipages.find(e => e.startNumber == startNumber);
        className = equipage?._mergedLabel || equipage?.mergedTestLabel || equipage?.className || '';
        categoryKey = detectTRCategoryFromEquipage(equipage);
      } else if (mode === 'manual') {
        // Manuellt läge utan ekipage
        className = document.getElementById('manualClassSelect')?.value || '';
        categoryKey = document.getElementById('manualCategorySelect')?.value || 'horse';
        // dummy-ekipage för rubrikerna
        equipage = { className, startNumber: '', driverName: '', horses: [], clubName: '', country: 'SE' };
        const mTempo = parseFloat(document.getElementById('manualTransportTempoInput')?.value);
        transportTempoMpm = Number.isFinite(mTempo) ? mTempo : null;
        const tA = parseFloat(document.getElementById('manualTempoAInput')?.value);
        const tB = parseFloat(document.getElementById('manualTempoBInput')?.value);
        tempoAOverride = Number.isFinite(tA) ? tA : null;
        tempoBOverride = Number.isFinite(tB) ? tB : null;
        if (!className) { showAlert(t('manual_mode_select_class'), false); return; }
      } else {
        showAlert(t('select_equipage_or_manual'), false);
        return;
      }
      let distA, distT, distB;
      const isAutoMode = (mode === 'auto' && startNumber);
      if (isAutoMode) {
        // HÄR ÄR KORRIGERINGEN - ANVÄNDER NU DEN SMARTA SÖKFUNKTIONEN FÖR SAMMANSLAGNA KLASSER
        const distClassName = equipage?._mergedLabel || className;
        const classDistances = getClassDistancesFromConfig(distClassName);
        distA = classDistances?.A?.distance || 0;
        distT = classDistances?.T?.distance || 0;
        distB = classDistances?.B?.distance || 0;
      } else {
        distA = parseFloat(document.getElementById('maratonTiderDistAInput').value) || 0;
        distT = parseFloat(document.getElementById('maratonTiderDistTInput').value) || 0;
        distB = parseFloat(document.getElementById('maratonTiderDistBInput').value) || 0;
      }

      // Tempo-regler (TR) ska följa ursprunglig klass (t.ex. Lätt A Enbet)
      const tempoClassName = isAutoMode ? (equipage.className || className) : className;
      const classKey = normalizeClassKey(tempoClassName) || tempoClassName;
      
      // Inställningar (Windows, etc) följer konfigurationen (sammanslagen klass)
      const configClassName = isAutoMode ? (equipage._mergedLabel || className) : className;
      const classDataFromConfig = getClassSettings(configClassName) || {};
      const formatMaratonTid = (ms) => {
        if (!isFinite(ms) || ms < 0) return "-";
        const totalSeconds = Math.round(ms / 1000);
        const m = Math.floor(totalSeconds / 60);
        const s = totalSeconds % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
      };

      const cfg = getClassDistancesFromConfig(configClassName);
      transportTempoMpm = (typeof transportTempoMpm === 'number')
        ? transportTempoMpm
        : (cfg?.T?.tempo_mpm ?? null);
      const commonArgs = {
        classKey, categoryKey, classDataFromConfig, transportTempoMpm, formatMaratonTid, tempoTable,
        overrideTemposKmH: { A: tempoAOverride, B: tempoBOverride } // <-- nya overrides
      };

      // Generera och visa den snygga skärm-vyn
      const screenHtml = generateResultHtml(equipage, { distA, distT, distB }, commonArgs, 'screen');
      document.getElementById('screen-area').innerHTML = screenHtml;

      // Generera och lägg den dolda utskrifts-vyn
      const printHtml = generateResultHtml(equipage, { distA, distT, distB }, commonArgs, 'print');
      document.getElementById('printable-area').innerHTML = printHtml;

      printBtn.classList.remove('hidden');
    });

  } catch (error) {
    console.error("Kunde inte ladda data för maratontidsverktyget:", error);
  }
}


function generateResultHtml(equipage, distances, args, type) {
  const { classKey, categoryKey, classDataFromConfig, transportTempoMpm, formatMaratonTid, overrideTemposKmH } = args;
  const { distA, distT, distB } = distances;
  const { className, startNumber, driverName } = equipage;
  const isBarnLB = /barn/i.test(className) && /l[aä]tt\s*b/i.test(className);
  const warmupMinutes = isBarnLB ? 10 : 20;

  const generateTable = (distM, stage) => {
    if (!(distM > 0) || !classKey) return '';

    // tempo-tabell väljs via args (se punkt 2)
    const src = (args?.tempoTable) || TRV_2025_MARATON_TEMPOS_KMH;
    const tempoKmh =
      (overrideTemposKmH?.[stage] ?? null)
      ?? src?.[classKey]?.[stage]?.[categoryKey];
    if (!tempoKmh) return '';

    const tempoMpm = kmhToMmin(tempoKmh);
    const windowMinutes = (stage === 'A' ? classDataFromConfig.windowA : classDataFromConfig.windowB) ?? (stage === 'A' ? 2 : 3);
    const windowMs = windowMinutes * 60000;
    const addBlankRows = () => {
      return type === 'print'
        ? `<tr class="print-blank"><td colspan="3"><div class="comment-box"></div></td></tr>
        <tr class="print-blank"><td colspan="3"><div class="comment-box"></div></td></tr>`
        : '';
    };

    let tableContent = '';
    if (type === 'print') {
      tableContent += `<tr><td>${t('before_start')}</td><td colspan="2"><div class="comment-box"></div></td></tr>`;
    }

    const kmCount = Math.floor(distM / 1000);
    for (let i = 1; i <= kmCount; i++) {
      const timeAtKm = (i * 1000 / tempoMpm) * 60000;
      const minTimeAtKm = Math.max(0, timeAtKm - windowMs);
      const timeText = `${formatMaratonTid(minTimeAtKm)} – ${formatMaratonTid(timeAtKm)}`;
      tableContent += `<tr><td>${i} km</td><td>${timeText}</td>${type === 'print' ? '<td><div class="comment-box"></div></td>' : ''}</tr>` + addBlankRows();
    }

    if (distM > 300) {
      const dist300m = distM - 300;
      const timeAt300m = (dist300m / tempoMpm) * 60000;
      const minTimeAt300m = Math.max(0, timeAt300m - windowMs);
      const timeText = `${formatMaratonTid(minTimeAt300m)} – ${formatMaratonTid(timeAt300m)}`;
      tableContent += `<tr><td>${t('300m_remaining')}</td><td>${timeText}</td>${type === 'print' ? '<td><div class="comment-box"></div></td>' : ''}</tr>` + addBlankRows();
    }

    const totalAllowedMs = (distM / tempoMpm) * 60000;
    const minTimeMs = Math.max(0, totalAllowedMs - windowMs);
    const timeTextFinal = `${formatMaratonTid(minTimeMs)} – ${formatMaratonTid(totalAllowedMs)}`;
    tableContent += `<tr class="${type === 'screen' ? 'font-bold bg-gray-50 dark:bg-gray-700/50' : ''}"><td>${t('finish')} (${distM} m)</td><td>${timeTextFinal}</td>${type === 'print' ? '<td><div class="comment-box"></div></td>' : ''}</tr>`;
    const headerClass = type === 'screen' ? 'font-semibold dark:text-gray-100' : '';
    const tableClass = type === 'screen' ? 'w-full mt-2 text-sm text-left text-gray-800 dark:text-gray-200' : '';
    const theadClass = type === 'screen' ? 'bg-gray-100 dark:bg-gray-700' : '';
    const thClass = type === 'screen' ? 'p-2 dark:text-gray-200' : '';
    const tdClass = type === 'screen' ? 'p-2 border-b dark:border-gray-600' : '';
    const containerClass = type === 'screen' ? 'bg-white dark:bg-gray-800 p-3 rounded shadow dark:border dark:border-gray-700' : 'p-3';

    // Extra ”block” för fria anteckningar i utskriften (mellan tabellsektionerna)
    const notesBlock = (type === 'print')
      ? `<div class="notes-title">${t('notes_header').replace('{stage}', stage === 'T' ? t('transport') : t('stage') + ' ' + stage)}</div><div class="notes-block"></div>`
      : '';
    return `<div class="${containerClass}">
                     <h3 class="${headerClass}">${t('stage_header_format').replace('{stage}', stage).replace('{dist}', distM).replace('{tempo}', tempoKmh)}</h3>
                    ${notesBlock}
                     <table class="${tableClass}">
                        <thead class="${theadClass}"><tr>
                            <th class="${thClass}">${t('checkpoint')}</th>
                            <th class="${thClass} ${type === 'screen' ? 'text-right' : ''}">${t('time_window')}</th>
                            ${type === 'print' ? `<th class="comment-header">${t('comment')}</th>` : ''}
                        </tr></thead>
                        <tbody>${tableContent.replaceAll('<td>', `<td class="${tdClass}">`).replaceAll('<tr>', `<tr class="${type === 'screen' ? 'border-b' : ''}">`)}</tbody>
                    </table>
                </div>`;
  };

  const generateTransportTable = (distM) => {
    if (!(distM > 0)) return '';
    const tempoMpm = transportTempoMpm;
    if (!tempoMpm) return '';
    const addBlankRows = () => {
      return type === 'print'
        ? `<tr class="print-blank"><td colspan="3"><div class="comment-box"></div></td></tr>
        <tr class="print-blank"><td colspan="3"><div class="comment-box"></div></td></tr>`
        : '';
    };

    let tableContent = '';
    if (type === 'print') tableContent += `<tr><td>${t('before_start')}</td><td colspan="2"><div class="comment-box"></div></td></tr>`;

    const kmCount = Math.floor(distM / 1000);
    for (let i = 1; i <= kmCount; i++) {
      const timeAtKm = (i * 1000 / tempoMpm) * 60000;
      tableContent += `<tr><td>${i} km</td><td>${formatMaratonTid(timeAtKm)}</td>${type === 'print' ? '<td><div class="comment-box"></div></td>' : ''}</tr>` + addBlankRows();
    }
    const totalAllowedMs = (distM / tempoMpm) * 60000;
    tableContent += `<tr class="${type === 'screen' ? 'font-bold bg-gray-50 dark:bg-gray-700/50' : ''}"><td>${t('finish')} (${distM}m)</td><td>${formatMaratonTid(totalAllowedMs)}</td>${type === 'print' ? '<td><div class="comment-box"></div></td>' : ''}</tr>`;

    const headerClass = type === 'screen' ? 'font-semibold dark:text-gray-100' : '';
    const tableClass = type === 'screen' ? 'w-full mt-2 text-sm text-left text-gray-800 dark:text-gray-200' : '';
    const theadClass = type === 'screen' ? 'bg-gray-100 dark:bg-gray-700' : '';
    const thClass = type === 'screen' ? 'p-2 dark:text-gray-200' : '';
    const tdClass = type === 'screen' ? 'p-2 border-b dark:border-gray-600' : '';
    const containerClass = type === 'screen' ? 'bg-white dark:bg-gray-800 p-3 rounded shadow dark:border dark:border-gray-700' : 'p-3';

    const notesBlock = (type === 'print')
      ? `<div class="notes-title">${t('notes_header').replace('{stage}', t('transport'))}</div><div class="notes-block"></div>`
      : '';
    return `<div class="${containerClass}">
                     <h3 class="${headerClass}">${t('transport_header_format').replace('{dist}', distM).replace('{tempo}', tempoMpm)}</h3>
                    ${notesBlock}
                     <table class="${tableClass}">
                        <thead class="${theadClass}"><tr>
                            <th class="${thClass}">${t('checkpoint')}</th>
                            <th class="${thClass} ${type === 'screen' ? 'text-right' : ''}">${t('max_time')}</th>
                            ${type === 'print' ? `<th class="comment-header">${t('comment')}</th>` : ''}
                        </tr></thead>
                        <tbody>${tableContent.replaceAll('<td>', `<td class="${tdClass}">`).replaceAll('<tr>', `<tr class="${type === 'screen' ? 'border-b' : ''}">`)}</tbody>
                    </table>
                </div>`;
  };

  const comp = getGlobalState('currentCompetition') || {};
  const header = (type === 'screen')
    ? `<div class="bg-blue-50 dark:bg-blue-900/20 dark:text-blue-100 p-4 rounded-lg"><h2 class="text-xl font-bold mb-2">${t('holdtimes_for').replace('{class}', className).replace('{cat}', categoryKey)}</h2>`
    : (() => {
      const flagHtml = (typeof getFlagHtml === 'function')
        ? getFlagHtml({ country: normalizeCountryCode(equipage.country || 'SE') }) : '';
      const clubHtml = (typeof getClubLogoHtml === 'function')
        ? getClubLogoHtml({ clubName: equipage.clubName || '' }) : '';
      const horses = getMomentHorseLabel(equipage, 'marathon');
      return `
            <div id="maratonPrintHeader">
              <div>
                <div class="title">${t('marathon_holdtimes_title')}</div>
                <div class="meta">
                  #${startNumber} ${driverName || ''}${horses && horses !== '—' ? ` • ${horses}` : ''}<br/>
                  ${t('class')}: ${className || ''} (${categoryKey})<br/>
                  ${comp.location || ''} • ${(comp.date || '')} • ${comp.organizerName || ''}
                </div>
              </div>
              <div class="badges">
                ${flagHtml}
                ${clubHtml}
                <span class="pill">${t('a4_friendly')}</span>
              </div>
            </div>`;
    })();

  const warmupInfo = type === 'screen'
    ? `<div class="mt-2 p-3 bg-yellow-100 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-lg text-center text-yellow-800 dark:text-yellow-200"><strong>Warm-up:</strong> ${t('warmup_max_minutes').replace('{min}', warmupMinutes)}</div>`
    : `<p><strong>Warm-up:</strong> ${t('warmup_max_minutes').replace('{min}', warmupMinutes)}</p>`;

  const gridClass = type === 'screen' ? 'grid md:grid-cols-2 gap-4 mt-4' : '';

  return `${header} ${warmupInfo}
            <div class="${gridClass}">
                ${generateTable(distA, 'A')}
                ${generateTransportTable(distT)}
                ${generateTable(distB, 'B')}
            </div>
            ${type === 'screen' ? '</div>' : ''}`;
}

function openHoldtimesPrintView({ equipage, className, categoryKey, distA, distT, distB, tablesHtml }) {
  const w = window.open('', '_blank');
  const title = `Hålltider – ${equipage?.driverName || ''} (#${equipage?.startNumber || ''})`;
  const org = (getGlobalState('currentCompetition')?.organizerName) || '';
  const compHeader = `${getGlobalState('currentCompetition')?.location || ''} | ${getGlobalState('currentCompetition')?.date || ''} | ${org}`;

  w.document.write(`
<!doctype html><html><head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
  body{font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Helvetica,Arial; color:#111; margin:24px;}
  .hdr{display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px}
  h1{font-size:20px; margin:0}
  .meta{color:#555; font-size:12px}
  .pill{background:#f3f4f6; padding:4px 8px; border-radius:9999px; font-size:12px; color:#374151}
  .card{border:1px solid #e5e7eb; border-radius:12px; padding:16px; margin-top:16px}
  table{width:100%; border-collapse:collapse; margin-top:8px}
  th,td{border-bottom:1px solid #e5e7eb; padding:8px; text-align:left; font-size:13px}
  th{background:#f9fafb; font-weight:600}
  .muted{color:#6b7280; font-size:12px}
</style>
</head><body>
  <div class="hdr">
    <div>
      <h1>${title}</h1>
      <div class="meta">${compHeader}</div>
      <div class="muted">${className} (${categoryKey}) • Distanser: A ${distA || 0} m • T ${distT || 0} m • B ${distB || 0} m</div>
    </div>
    <div class="pill">Maraton • Hålltider</div>
  </div>
  <div class="card">
    ${tablesHtml}
  </div>
  <script>window.onload = () => setTimeout(()=>window.print(), 50);</script>
</body></html>`);
  w.document.close();
}

function printCurrentHoldtimesPreview() {
  const host = document.getElementById('printable-area');
  const html = host ? host.innerHTML : '';
  if (!html || !html.trim()) {
    showAlert(t('calculate_times_first'), false);
    return;
  }

  // Egen, enkel rapportstil för A4
  const styles = `
    <style>
      @page { size: A4; margin: 14mm; }
      html,body{background:#fff;color:#111;font:12pt/1.4 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;}
      #printable-area { display:block !important; }
      #maratonPrintHeader{
        display:grid;grid-template-columns:1fr auto;gap:12pt;align-items:center;
        border-bottom:1px solid #ccc;padding-bottom:8pt;margin-bottom:10pt
      }
      #maratonPrintHeader .title{font-weight:800;font-size:16pt}
      #maratonPrintHeader .meta{color:#444;font-size:10pt}
      #maratonPrintHeader .badges{display:flex;gap:8pt;align-items:center}
      #maratonPrintHeader .pill{border:1px solid #ddd;border-radius:9999px;padding:2pt 8pt;font-size:9pt}
      h3{font-size:12pt;margin:10pt 0 6pt}
      table{width:100%;border-collapse:collapse}
      th,td{border:1px solid #000;padding:6pt;vertical-align:middle}
      th{background:#f5f6f8}
      td.time{font-family:ui-monospace, SFMono-Regular, Menlo, monospace;text-align:center}
      .comment-box{border:1px dashed #999;height:36pt;background:#fafafa}
      .notes-title{font-weight:700;font-size:10pt;margin:6pt 0 4pt}
      .notes-block{height:110pt;border:1px dashed #bbb;background:#fafafa;margin:0 0 12pt}
    </style>
  `;

  const w = window.open('', '_blank');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8">${styles}</head><body>${html}
  <script>window.onload = () => setTimeout(() => window.print(), 50);<\/script></body></html>`);
  w.document.close();
}

async function generateMarathonPdfFromCurrent() {
  // 1) Säkerställ att vi har något att skriva ut
  const host = document.getElementById('printable-area');
  if (!host || !host.innerHTML.trim()) {
    showAlert(t('calculate_times_first'), false);
    return;
  }

  // 2) Plocka ut basinfo för header
  const eqSel = document.getElementById('equipageSelect');
  let equipage = (CURRENT_EQUIPAGE) || (eqSel?.__selectedOption?.data) || null;
  const mode = document.querySelector('input[name="distanceMode"]:checked')?.value;
  // Manuellt fallback
  let fallbackClass = document.getElementById('manualClassSelect')?.value || '';
  let fallbackCategory = document.getElementById('manualCategorySelect')?.value || 'horse';
  let fallbackTtempo = parseFloat(document.getElementById('manualTransportTempoInput')?.value);
  if (!equipage && mode === 'manual' && fallbackClass) {
    equipage = { className: fallbackClass, startNumber: '', driverName: '', horses: [], clubName: '', country: 'SE' };
  }
  if (!equipage) { showAlert(t('select_equipage_or_manual'), false); return; }
  const driverName = equipage?.driverName || equipage?.driver || '';
  const startNumber = equipage?.startNumber || equipage?.no || '';
  if (!equipage) {
    showAlert(t('select_equipage_calculate_first'), false);
    return;
  }
  const horses = (typeof horseLabel === 'function') ? horseLabel(equipage) : '';
  const className = equipage?._mergedLabel || equipage?.mergedTestLabel || equipage?.className || equipage?.klass || '';
  const clubName = equipage?.clubName || equipage?.club || '';
  const country = normalizeCountryCode(equipage?.country || 'SE');

  // TR/klassdata för tempo och distanser
  const classKey = normalizeClassKey(className) || className;
  const categoryKey = (mode === 'manual' && !startNumber) ? fallbackCategory : detectTRCategoryFromEquipage(equipage);
  const cfg = getClassDistancesFromConfig(className) || {};
  // Distanser: ta från DOM om manuellt läge, annars från config
  const distA = (mode === 'manual' && !startNumber) ? (parseFloat(document.getElementById('maratonTiderDistAInput').value) || 0) : (cfg.A?.distance || 0);
  const distT = (mode === 'manual' && !startNumber) ? (parseFloat(document.getElementById('maratonTiderDistTInput').value) || 0) : (cfg.T?.distance || 0);
  const distB = (mode === 'manual' && !startNumber) ? (parseFloat(document.getElementById('maratonTiderDistBInput').value) || 0) : (cfg.B?.distance || 0);
  const ruleVal = document.getElementById('manualRuleSelect')?.value || 'TR';
  const table = getTempoTable({ isManual: mode === 'manual', ruleValue: ruleVal });
  let tempoAk = table?.[classKey]?.A?.[categoryKey] || null;
  let tempoBk = table?.[classKey]?.B?.[categoryKey] || null;
  if (mode === 'manual' && !startNumber) {
    const tA = parseFloat(document.getElementById('manualTempoAInput')?.value);
    const tB = parseFloat(document.getElementById('manualTempoBInput')?.value);
    if (Number.isFinite(tA)) tempoAk = tA;
    if (Number.isFinite(tB)) tempoBk = tB;
  }

  const tempoTm = Number.isFinite(fallbackTtempo) ? fallbackTtempo : (cfg.T?.tempo_mpm ?? null);
  // 3) Hämta loggor/flagga (SRF + klubb + flagga)
  const srfLogo = await fetchImageDataUrl('/assets/logos/SRF.png');
  let clubImg = null, flagImg = null;
  try {
    if (startNumber) {
      await ensureClubLogosLoaded();
      const clubUrl = getClubLogoUrl(clubName);
      clubImg = clubUrl ? await fetchImageDataUrl(clubUrl) : null;
      const flagUrl = await fetchFlagDataUrl(country);
      flagImg = flagUrl ? { dataUrl: flagUrl, w: 48, h: 32 } : null;
    }
  } catch { }

  // 4) Hämta tabellerna vi redan renderat (A/Transport/B)
  //    Vi letar efter H3-rubrikerna och tar första <table> efter varje rubrik.
  const sections = Array.from(host.querySelectorAll('h3'))
    .map(h => {
      const title = h.textContent.trim();
      const tbl = h.nextElementSibling && h.nextElementSibling.tagName === 'TABLE'
        ? h.nextElementSibling
        : h.parentElement.querySelector('table');
      return { title, table: tbl };
    })
    .filter(s => s.table);

  // robust stage-taggar
  const findSection = (key) => sections.find(s => new RegExp(`\\b${key}\\b`, 'i').test(s.title));
  const secA = findSection('Sträcka A');
  const secT = findSection('Transport');
  const secB = findSection('Sträcka B');

  // 5) Initiera jsPDF
  const jsPDFCtor = (window?.jspdf && window.jspdf.jsPDF) || window.jsPDF;
  if (typeof jsPDFCtor !== 'function') {
    showAlert(t('pdf_lib_missing'), false);
    return;
  }
  const pdf = new jsPDFCtor({ unit: 'pt', format: 'a4' });
  const PAGE_W = pdf.internal.pageSize.getWidth();
  const PAGE_H = pdf.internal.pageSize.getHeight();
  const mx = 40; // vänster/höger marginal

  // Standardstilar
  const base = {
    font: 'helvetica',
    headFontSize: 12,
    bodyFontSize: 11,     // större text
    timeFontSize: 12,     // extra stor för tider
    rowMinH: 28,          // minst dubbelt radavstånd jämfört med tidigare
    cellPad: 4
  };

  // Header-ritare enligt din önskade layout:
  // SRF-logga uppe till höger, till vänster: Namn (störst),
  // under det: flagga + klubb-logga, och därefter klassrad.
  function drawHeader(stageLabel, distMeters, tempoLabel) {
    pdf.setFont(base.font, 'bold').setFontSize(18);
    pdf.text(`${driverName ? `#${startNumber} ${driverName}` : t('driver')}`, mx, 60);

    // Flagga + klubb under namnet
    let x = mx, y = 80;
    if (flagImg?.dataUrl) {
      const fh = 16, fw = fh * (flagImg.w / flagImg.h);
      pdf.addImage(flagImg.dataUrl, 'PNG', x, y - fh + 2, fw, fh);
      x += fw + 8;
    }
    if (clubImg?.dataUrl) {
      const ch = 16, cw = ch * ((clubImg.w || ch) / (clubImg.h || ch));
      pdf.addImage(clubImg.dataUrl, 'PNG', x, y - ch + 2, cw, ch);
      x += cw + 8;
    }

    pdf.setFont(base.font, 'normal').setFontSize(11);
    pdf.text(`${className || ''}${clubName ? ` • ${clubName}` : ''}`, mx, y + 16);

    // SRF-logga uppe till höger
    if (srfLogo?.dataUrl) {
      const maxH = 70, ratio = srfLogo.w / srfLogo.h || 1;
      const h = maxH, w = h * ratio;
      pdf.addImage(srfLogo.dataUrl, 'PNG', PAGE_W - mx - w, 32, w, h);
    }

    // Titelbadge (vilken sida)
    pdf.setFont(base.font, 'bold').setFontSize(12);
    pdf.text(`${t('marathon_holdtimes_title')} (${stageLabel})`, mx, y + 36);
    // Liten rad med tempo + distans för sidan
    const info = []
    if (Number.isFinite(distMeters) && distMeters > 0) info.push(`${(distMeters).toLocaleString('sv-SE')} m`);
    if (tempoLabel) info.push(tempoLabel);
    if (info.length) {
      pdf.setFont(base.font, 'normal').setFontSize(11);
      pdf.text(info.join(' • '), mx, y + 52);
    }
  }

  // AutoTable-options med extra luft och större typografi
  function tableOpts(startY) {
    return {
      startY,
      html: null,           // (vi sätter den per tabell)
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
        // Gör kolumnen med tider ännu större – sök på rubriken
        const colHeader = (txt) => (data.table.head?.[0]?.cells?.[data.column.index]?.raw?.textContent || '').toLowerCase().includes(txt);
        if (colHeader('tid') || colHeader('tidsfönster') || colHeader('min') || colHeader('max')) {
          data.cell.styles.fontSize = base.timeFontSize;
          data.cell.styles.fontStyle = 'bold';
        }
      },
      margin: { left: mx, right: mx }
    };
  }

  // Hjälpare för att köra en tabell som redan finns i DOM
  function addTableFromDom(tableEl, startY) {
    const opt = tableOpts(startY);
    opt.html = tableEl;
    pdf.autoTable(opt);
    return pdf.lastAutoTable ? pdf.lastAutoTable.finalY : (startY + 100);
  }

  // ============== SIDA 1 – STRÄCKA A (ev. Transport) =================
  drawHeader('Sträcka A', distA, tempoAk ? `${tempoAk} km/h` : null);
  let y = 120;

  if (secA?.table) {
    y = addTableFromDom(secA.table, y);
  }
  // ============== SIDA 2 – STRÄCKA B =================
  pdf.addPage();
  drawHeader('Sträcka B', distB, tempoBk ? `${tempoBk} km/h` : null);
  y = 120;
  if (secB?.table) {
    addTableFromDom(secB.table, y);
  }

  // ============== SIDA 3 – TRANSPORT (om finns) =================
  if (secT?.table) {
    pdf.addPage();
    // Visa tempo i “badge”-raden (m/min) om vi har det
    const tLbl = tempoTm ? `${tempoTm} m/min` : null;
    drawHeader('Transport', distT, tLbl);
    addTableFromDom(secT.table, 120);
  }

  // 6) Spara
  const safeName = (driverName || 'ekipage').replace(/\s+/g, '_');
  pdf.save(`maraton_hallttider_${startNumber}_${safeName}.pdf`);
}


export async function load() {
  const competition = getGlobalState('currentCompetition');
  const page = document.getElementById('page-maraton-tider');
  if (!competition) {
    page.innerHTML = `<p class="p-8 text-center text-red-500">${t('no_competition_selected')}</p>`;
    return;
  }

  try { await ensureClubLogosLoaded(); } catch { }

  page.innerHTML = `
        <div class="container mx-auto p-4 md:p-8">
            ${getCompetitionHeader(competition, t('tools_calculate_marathon_times'))}
            <div id="non-printable-content" class="max-w-4xl mx-auto bg-white dark:bg-gray-800 p-6 rounded-xl shadow border dark:border-gray-700">
                <h1 class="text-2xl font-bold mb-4 dark:text-gray-100">${t('calculate_marathon_holdtimes')}</h1>
                <p class="mb-4 text-sm text-gray-600 dark:text-gray-400">${t('calculate_holdtimes_desc')}</p>
                
                <div class="p-4 border rounded-lg bg-gray-50 dark:bg-gray-700 dark:border-gray-600">
                    <div class="mb-4">
                        <label class="block font-medium mb-2 dark:text-gray-200">${t('step_1_select_equipage')}</label>
                        <div id="maratonTiderEquipageSearch" class="dark:text-gray-800"></div>
                        <p id="selectedEquipageInfo" class="text-sm text-gray-600 dark:text-gray-300 mt-1 h-5"></p>
                    </div>
                    <label class="block font-medium mb-2 dark:text-gray-200">${t('step_2_select_source')}</label>
                    <p id="configDebugLine" class="text-xs text-gray-500 dark:text-gray-400 mb-2 h-4"></p>
                    <div class="flex gap-4 mb-4">
                        <label class="flex items-center p-3 border rounded-lg bg-white dark:bg-gray-800 dark:border-gray-600 has-[:checked]:bg-blue-50 dark:has-[:checked]:bg-blue-900/30 has-[:checked]:border-blue-500 dark:has-[:checked]:border-blue-500 cursor-pointer transition-colors">
                            <input type="radio" name="distanceMode" value="auto" checked class="h-4 w-4">
                            <span class="ml-2 font-semibold dark:text-gray-200">${t('fetch_from_competition')}</span>
                        </label>
                        <label class="flex items-center p-3 border rounded-lg bg-white dark:bg-gray-800 dark:border-gray-600 has-[:checked]:bg-blue-50 dark:has-[:checked]:bg-blue-900/30 has-[:checked]:border-blue-500 dark:has-[:checked]:border-blue-500 cursor-pointer transition-colors">
                            <input type="radio" name="distanceMode" value="manual" class="h-4 w-4">
                            <span class="ml-2 font-semibold dark:text-gray-200">${t('enter_manually')}</span>
                        </label>
                    </div>
                    <div id="auto-inputs" class="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-2">
                        <div><label class="block text-sm font-medium dark:text-gray-300">${t('distance_a')}</label><p id="maratonTiderDistAAuto" class="font-bold text-lg dark:text-gray-100">${t('select_equipage')}</p></div>
                        <div><label class="block text-sm font-medium dark:text-gray-300">${t('distance_t')}</label><p id="maratonTiderDistTAuto" class="font-bold text-lg dark:text-gray-100">${t('select_equipage')}</p></div>
                        <div><label class="block text-sm font-medium dark:text-gray-300">${t('distance_b')}</label><p id="maratonTiderDistBAuto" class="font-bold text-lg dark:text-gray-100">${t('select_equipage')}</p></div>
                    </div>
                    <!-- Manuellt läge: klass/kategori och ev. transport-tempo -->
                    <div id="manual-meta" class="hidden grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
                        <div>
                          <label for="manualClassSelect" class="block font-medium dark:text-gray-200">${t('class')}</label>
                          <select id="manualClassSelect" class="w-full p-2 border rounded mt-1 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100"></select>
                        </div>
                        <div>
                          <label for="manualCategorySelect" class="block font-medium dark:text-gray-200">${t('category')}</label>
                          <select id="manualCategorySelect" class="w-full p-2 border rounded mt-1 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100">
                            <option value="ponyA">Ponny A</option>
                            <option value="ponyB">Ponny B</option>
                            <option value="ponyCD">Ponny C/D</option>
                            <option value="horse" selected>Häst</option>
                          </select>
                        </div>
                          <div>
    <label for="manualRuleSelect" class="block font-medium dark:text-gray-200">${t('ruleset')}</label>
    <select id="manualRuleSelect" class="w-full p-2 border rounded mt-1 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100">
      <option value="TR" selected>${t('ruleset_tr')}</option>
      <option value="FEI">FEI</option>
    </select>
  </div>
                        <div>
                          <label for="manualTransportTempoInput" class="block font-medium dark:text-gray-200">${t('transport_tempo_m_min')}</label>
                          <input type="number" id="manualTransportTempoInput" class="w-full p-2 border rounded mt-1 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100" placeholder="t.ex. 220">
                        </div>
                           <div>
      <label for="manualTempoAInput" class="block font-medium dark:text-gray-200">${t('tempo_stage_a_kmh')}</label>
      <input type="number" step="0.1" id="manualTempoAInput" class="w-full p-2 border rounded mt-1 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100" placeholder="auto från TR">
    </div>
    <div>
      <label for="manualTempoBInput" class="block font-medium dark:text-gray-200">${t('tempo_stage_b_kmh')}</label>
      <input type="number" step="0.1" id="manualTempoBInput" class="w-full p-2 border rounded mt-1 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100" placeholder="auto från TR">
    </div>
                    </div>
                    <div id="manual-inputs" class="hidden grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
                        <div><label for="maratonTiderDistAInput" class="block font-medium dark:text-gray-200">${t('length_a_m')}</label><input type="number" id="maratonTiderDistAInput" class="w-full p-2 border rounded mt-1 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100"></div>
                        <div><label for="maratonTiderDistTInput" class="block font-medium dark:text-gray-200">${t('length_t_m')}</label><input type="number" id="maratonTiderDistTInput" class="w-full p-2 border rounded mt-1 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100"></div>
                        <div><label for="maratonTiderDistBInput" class="block font-medium dark:text-gray-200">${t('length_b_m')}</label><input type="number" id="maratonTiderDistBInput" class="w-full p-2 border rounded mt-1 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100"></div>
                    </div>
                </div>
                <div class="mt-6 flex flex-col md:flex-row gap-4">
                    <button id="visaMaratonTiderBtn" class="bg-brand-darkblue text-white font-semibold px-6 py-3 rounded-lg hover:bg-brand-gold hover:text-brand-darkblue w-full text-lg">${t('calculate_times')}</button>
                    <button id="printMaratonTiderBtn" class="bg-gray-700 text-white font-semibold px-6 py-3 rounded-lg hover:bg-gray-800 w-full md:w-auto hidden">${t('print_as_pdf')}</button>
                </div>
            </div>
            <div id="maratonTiderResultat" class="mt-6">
                <div id="screen-area"></div>
                <div id="printable-area" class="hidden"></div>
            </div>
        </div>
    `;
  injectPrintStyles();
  await setupPage(competition.id);
}