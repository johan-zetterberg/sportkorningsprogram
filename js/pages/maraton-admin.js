// js/pages/maraton-admin.js
import { getGlobalState } from '../main.js';
import {
  getConfig, saveConfig,
  getEquipages, listenForEquipages,
  listenForMarathonObstacles, saveMarathonObstacle, deleteMarathonObstacle
} from '../services/firestoreService.js';
import { getCompetitionHeader, showAlert } from '../ui/components.js';

let competitionId = null;
let allEquipages = [];
let allObstacles = [];
let unsubscribeEquipages = null;
let unsubscribeObstacles = null;
let pageRoot = null;

// ------------------------------
// === TR V 2025 – Maratontempon (km/h) per klass & kategori ===
// Kolumner: ponyA, ponyB, ponyCD, horse
const TRV_2025_MARATON_TEMPOS_KMH = {
  "Lätt B": {
    A: { ponyA: 10.0, ponyB: 10.5, ponyCD: 11.0, horse: 12.0 },
    B: { ponyA: 9.0, ponyB: 9.5, ponyCD: 10.0, horse: 11.0 },
  },
  "Lätt B Para": {
    A: { ponyA: 10.0, ponyB: 10.5, ponyCD: 11.0, horse: 12.0 },
    B: { ponyA: 8.5, ponyB: 9.0, ponyCD: 9.5, horse: 10.5 },
  },
  "Lätt A": {
    A: { ponyA: 11.0, ponyB: 11.5, ponyCD: 12.0, horse: 13.0 },
    B: { ponyA: 10.0, ponyB: 10.5, ponyCD: 11.0, horse: 12.0 },
  },
  "Lätt A Para": {
    A: { ponyA: 11.0, ponyB: 11.5, ponyCD: 12.0, horse: 13.0 },
    B: { ponyA: 9.0, ponyB: 9.5, ponyCD: 10.0, horse: 11.0 },
  },
  "Msv": {
    A: { ponyA: 12.0, ponyB: 12.5, ponyCD: 13.0, horse: 14.0 },
    B: { ponyA: 11.0, ponyB: 11.5, ponyCD: 12.0, horse: 13.0 },
  },
  "Msv Para": {
    A: { ponyA: 12.0, ponyB: 12.5, ponyCD: 13.0, horse: 14.0 },
    B: { ponyA: 10.0, ponyB: 10.5, ponyCD: 11.0, horse: 12.0 },
  },
  "Svår": {
    A: { ponyA: 12.5, ponyB: 13.5, ponyCD: 14.0, horse: 15.0 },
    B: { ponyA: 11.5, ponyB: 12.5, ponyCD: 13.0, horse: 14.0 },
  },
  "Svår Para": {
    A: { ponyA: 10.5 + 2.0, ponyB: 11.5, ponyCD: 12.0, horse: 13.0 }, // 12.5, 13.5, 14, 15 i A
    B: { ponyA: 10.5, ponyB: 11.5, ponyCD: 12.0, horse: 13.0 },
  }
};

// Gissa kategori ur klassnamn (för TR-tabellen)
// Häst => 'horse', annars Ponny A/B/CD om det går, annars 'ponyCD' som rimlig default
function guessTRCategoryFromClassName(className = '') {
  const s = String(className).toLowerCase();
  if (/häst|horse/.test(s)) return 'horse';
  if (/ponny\s*a\b/.test(s)) return 'ponyA';
  if (/ponny\s*b\b/.test(s)) return 'ponyB';
  if (/ponny|pony/.test(s)) return 'ponyCD';
  // Fallback: behandla som häst om helt oklart
  return 'horse';
}

// Hämta TR-tempo i m/min för en given klass & sektion (A|B)
function trTempoMminFor(className, section /* 'A' | 'B' */) {
  const key = normalizeClassKey(className);
  const cat = guessTRCategoryFromClassName(className);
  const kmh = TRV_2025_MARATON_TEMPOS_KMH?.[key]?.[section]?.[cat];
  return Number.isFinite(kmh) ? kmhToMmin(kmh) : null;
}

// Antag att du har en lista på klasser i tävlingen (t.ex. från equipage),
// ex: const classesInUse = [...new Set(equipages.map(e => e.className))];
function buildTRDefaultsFor(classesInUse) {
  const out = {};
  for (const cls of classesInUse) {
    const key = normalizeClassKey(cls);
    if (key && TRV_2025_MARATON_TEMPOS_KMH[key]) {
      out[key] = JSON.parse(JSON.stringify(TRV_2025_MARATON_TEMPOS_KMH[key]));
    }
  }
  return out;
}

// Anropa detta när sidan initieras / när klasserna finns tillgängliga:
function ensureTemposPrefilled(state) {
  // state.marathonSettings.tempos förväntas vara ett objekt per klass
  state.marathonSettings = state.marathonSettings || {};
  state.marathonSettings.tempos = state.marathonSettings.tempos || {};

  const defaults = buildTRDefaultsFor(state.classesInUse || []);
  let changed = false;

  for (const [k, v] of Object.entries(defaults)) {
    if (!state.marathonSettings.tempos[k]) {
      state.marathonSettings.tempos[k] = v; // A/B -> ponyA/ponyB/ponyCD/horse
      changed = true;
    }
  }

  // Transport (T) autofylla inte – TR anger det inte. Låt vara tomt.
  // state.marathonSettings.temposTransfer = state.marathonSettings.temposTransfer || null;

  if (changed) {
    // valfritt: rendera om formuläret så fälten visas förifyllda
    renderAdminForm(state);
  }
}

// Hjälpare: normalisera klassnamn från TDB/era data till nyckeln ovan
export function normalizeClassKey(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const lower = s.toLowerCase();
  const para = /para/.test(lower);
  if (/^l[aä]tt\s*b/i.test(s)) return para ? "Lätt B Para" : "Lätt B";
  if (/^l[aä]tt\s*a/i.test(s)) return para ? "Lätt A Para" : "Lätt A";
  if (/^msv/i.test(s) || /^medelsv[aå]r/i.test(lower)) return para ? "Msv Para" : "Msv";
  if (/^sv[aå]r/i.test(lower)) return para ? "Svår Para" : "Svår";
  return null;
}

export function normalizeEquipage(e) {
  const startNumber =
    Number(e?.startNumber ?? e?.startnr ?? e?.nr ?? e?.start ?? e?.startNo ?? e?.bib ?? 0);
  const driverName =
    e?.driverName ?? e?.driver ?? e?.name ?? e?.kusk ?? '';
  const className =
    e?.className ?? e?.class ?? e?.klass ?? '';
  return { ...e, startNumber, driverName, className };
}

// Konvertering om du vill visa/stöda m/min på andra sidor
const kmhToMmin = (kmh) => (kmh * 1000) / 60;

// --- Robust kategoridetektion från ekipage-data ---

// Normalisera godtycklig text -> TR-nyckel
function normalizeTRCategoryKey(raw) {
  if (!raw && raw !== 0) return null;
  const s = String(raw).trim().toLowerCase();

  // Häst?
  if (/(häst|horse|horses?)/.test(s)) return 'horse';

  // Ponny och ev. kategori
  if (/(ponny|pony)/.test(s)) {
    if (/\b(a|cat[\s\-]*a)\b/.test(s)) return 'ponyA';
    if (/\b(b|cat[\s\-]*b)\b/.test(s)) return 'ponyB';
    if (/\b(c|d|cat[\s\-]*c|cat[\s\-]*d)\b/.test(s)) return 'ponyCD';
    return 'ponyCD'; // okänt -> slå ihop C/D
  }

  // Rent bokstavs-case (utan 'ponny') – tolka ändå
  if (/^\s*a\s*$/.test(s)) return 'ponyA';
  if (/^\s*b\s*$/.test(s)) return 'ponyB';
  if (/^\s*(c|d)\s*$/.test(s)) return 'ponyCD';

  return null;
}

// Försök läsa mankhöjd (cm) från ett ekipage
function readHeightCmFromEquipage(e) {
  const cand = [];

  // vanliga fältnamn direkt på ekipaget
  if (Number.isFinite(e?.heightCm)) cand.push(e.heightCm);
  if (Number.isFinite(e?.horseHeightCm)) cand.push(e.horseHeightCm);
  if (Number.isFinite(e?.withersHeightCm)) cand.push(e.withersHeightCm);

  // ibland kan höjden ligga på hästobjekt i en lista
  if (Array.isArray(e?.horses)) {
    for (const h of e.horses) {
      if (Number.isFinite(h?.heightCm)) cand.push(h.heightCm);
      if (Number.isFinite(h?.withersHeightCm)) cand.push(h.withersHeightCm);
      if (typeof h?.height === 'number') cand.push(h.height); // vissa kallar det bara 'height'
    }
  }

  // välj första rimliga kandidat
  let h = cand.find(Number.isFinite);
  if (!Number.isFinite(h)) return null;

  // om värdet verkar vara i meter (< 3), konvertera till cm
  if (h > 0 && h < 3) h = Math.round(h * 100);

  return Number.isFinite(h) ? h : null;
}

// Tolkning via höjd enligt TR/FEI (cm):
// A: ≤107, B: 108–130, C: 131–140, D: 141–148, >148 = häst
function categoryFromHeightCm(cm) {
  if (!Number.isFinite(cm)) return null;
  if (cm <= 107) return 'ponyA';
  if (cm <= 130) return 'ponyB';
  if (cm <= 148) return 'ponyCD';
  return 'horse';
}

// Försök hitta explicit kategori i olika fält
function directCategoryFromEquipage(e) {
  const candidates = [
    e?.category, e?.categoryName, e?.division, e?.animalCategory,
    e?.equineCategory, e?.ponyCategory, e?.horseCategory,
    e?.type, e?.equineType
  ];
  for (const r of candidates) {
    const k = normalizeTRCategoryKey(r);
    if (k) return k;
  }
  // kolla klassnamn om ekipaget har sitt eget
  if (e?.className) {
    const k2 = normalizeTRCategoryKey(e.className);
    if (k2) return k2;
  }
  return null;
}

// Master: bestäm TR-kategori-nyckel för ett ekipage
function detectTRCategoryFromEquipage(e) {
  // 1) explicit fält
  const direct = directCategoryFromEquipage(e);
  if (direct) return direct;

  // 2) höjd
  const h = readHeightCmFromEquipage(e);
  const byH = categoryFromHeightCm(h);
  if (byH) return byH;

  // 3) som sista fallback: gissa från klassnamn
  if (e?.className) {
    // Använder din (redan befintliga) heuristik om du har en:
    const guess = guessTRCategoryFromClassName ? guessTRCategoryFromClassName(e.className) : null;
    if (guess) return guess;
  }

  // 4) inget hittat -> anta häst
  return 'horse';
}

// Bygg dominerande kategori per klass (majoritet bland ekipagen i klassen)
export function buildDominantTRCategoryByClass(equipages = []) {
  const map = new Map();
  const groups = new Map();

  for (const e of equipages) {
    const cls = e?.className;
    if (!cls) continue;
    const cat = detectTRCategoryFromEquipage(e);
    if (!groups.has(cls)) groups.set(cls, {});
    const bucket = groups.get(cls);
    bucket[cat] = (bucket[cat] || 0) + 1;
  }

  for (const [cls, counts] of groups.entries()) {
    // välj kategori med högst röstetal
    let bestCat = null, bestN = -1;
    for (const [cat, n] of Object.entries(counts)) {
      if (n > bestN) { bestN = n; bestCat = cat; }
    }
    // fallback om tomt av någon anledning
    map.set(cls, bestCat || 'horse');
  }
  return map;
}

// TR-tempo i m/min för (klass, sektion) med explicit kategori
function trTempoMminForWithCat(className, section /* 'A' | 'B' */, catKey /* 'horse'|'ponyA'|'ponyB'|'ponyCD' */) {
  const key = normalizeClassKey(className);
  const kmh = TRV_2025_MARATON_TEMPOS_KMH?.[key]?.[section]?.[catKey];
  return Number.isFinite(kmh) ? kmhToMmin(kmh) : null;
}

// Hjälp: mappa klassnamn till nivåetikett
function inferLevelFromClassName(className = '') {
  const s = String(className).toLowerCase();

  // Snabba träffar
  if (/svår|svår|^s\b| msv\s*elit/.test(s)) return 'Svår';
  if (/msv|medelsv[aå]r/.test(s)) return 'Medelsvår';
  if (/l[aä]tt\s*a\b|la\b/.test(s)) return 'Lätt A';
  if (/l[aä]tt\s*b\b|lb\b/.test(s)) return 'Lätt B';

  // Fallback enkel heuristik
  if (/\b(msv|medel)/.test(s)) return 'Medelsvår';
  if (/\bla\b/.test(s)) return 'Lätt A';
  if (/\blb\b/.test(s)) return 'Lätt B';
  return null;
}

function fmtIdealTime(distanceM, tempoMpm) {
  if (!Number.isFinite(distanceM) || distanceM <= 0 || !Number.isFinite(tempoMpm) || tempoMpm <= 0) return '—';
  const mins = distanceM / tempoMpm;
  const mm = Math.floor(mins);
  const ss = Math.round((mins - mm) * 60);
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
// Används för Transport (T) där TR inte anger tempo.
// Hämtar ev. sparat tempo per klass/sektion ur config.
function tempoForClass(savedTemposByClass, className, section) {
  const t = savedTemposByClass?.[className]?.[section];
  return Number.isFinite(t) ? t : null;
}
// ------------------------------
// UI rendering
function renderLayout(competition) {
  pageRoot = document.getElementById('page-maraton-admin');
  if (!pageRoot) return;

  pageRoot.innerHTML = `
    <div class="container mx-auto p-4 md:p-8">
      ${getCompetitionHeader(competition, 'Admin – Maraton')}

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">

<div class="bg-white p-6 rounded-xl shadow-md lg:col-span-3">
 <h2 class="text-2xl font-semibold mb-4 border-b pb-2">Globala Regelinställningar</h2>
  <form id="global-settings-form" class="space-y-4">
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div>
        <label for="timePenaltyRate" class="block text-sm font-medium">Straffpoäng/sek (Sträcka)</label>
        <input type="number" step="0.01" id="timePenaltyRate" class="mt-1 w-full p-2 border rounded-md" placeholder="t.ex. 0.25 (Default: 0.25)">
      </div>
      <div>
        <label for="obstaclePenaltyRate" class="block text-sm font-medium">Straffpoäng/sek (Hinder)</label>
        <input type="number" step="0.01" id="obstaclePenaltyRate" class="mt-1 w-full p-2 border rounded-md" placeholder="t.ex. 1.0 (Default: 1.0)">
      </div>
      <div>
        <label for="knockdownPenaltyDefault" class="block text-sm font-medium">Standardstraff per knockdown (sek)</label>
        <input type="number" id="knockdownPenaltyDefault" class="mt-1 w-full p-2 border rounded-md" placeholder="t.ex. 5">
      </div>
      <div>
        <label for="obstacleMaxTime" class="block text-sm font-medium">Maximal hindertid (sekunder)</label>
        <input type="number" id="obstacleMaxTime" class="mt-1 w-full p-2 border rounded-md" placeholder="t.ex. 300">
      </div>
    </div>
    <button type="submit" class="w-full mt-2 bg-gray-800 text-white font-semibold py-2 px-4 rounded-lg hover:bg-gray-700">
      Spara Globala Inställningar
    </button>
  </form>
</div>
        <!-- Maratoninställningar -->
        <div class="bg-white p-6 rounded-xl shadow-md lg:col-span-2">
          <h2 class="text-2xl font-semibold mb-4 border-b pb-2">Maratoninställningar</h2>
          <form id="marathon-settings-form" class="space-y-4">
            <div class="space-y-2" id="marathon-distances-container">
              <p class="text-sm text-gray-500">Laddar klasser …</p>
            </div>
            <div class="border-t pt-4">
              <label for="pauseTime" class="block text-sm font-medium">Paus mellan A/WU och B (minuter)</label>
              <input type="number" id="pauseTime" value="10" class="mt-1 w-full md:w-1/3 p-2 border rounded-md">
            </div>
            <button type="submit" class="w-full mt-2 bg-gray-800 text-white font-semibold py-2 px-4 rounded-lg hover:bg-gray-700">
              Spara Maratoninställningar
            </button>
          </form>
        </div>

        <!-- Maratonhinder -->
        <div class="bg-white p-6 rounded-xl shadow-md lg:col-span-1 lg:self-start">
          <h2 class="text-2xl font-semibold mb-4 border-b pb-2">Maratonhinder</h2>
          <form id="addObstacleForm" class="space-y-4">
            <input type="hidden" id="editingObstacleNumber">

            <div>
              <label for="newObstacleNumber" class="block text-sm font-medium text-gray-700">Hindernummer</label>
              <input type="number" id="newObstacleNumber" required class="mt-1 block w-full p-2 border rounded-md" placeholder="t.ex. 1">
            </div>
            <div>
              <label for="newObstacleName" class="block text-sm font-medium text-gray-700">Namn (valfritt)</label>
              <input type="text" id="newObstacleName" class="mt-1 block w-full p-2 border rounded-md" placeholder="t.ex. Vattenhindret">
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div class="flex items-center gap-3">
                <input type="checkbox" id="newObstacleHasKD" class="h-4 w-4">
                <label for="newObstacleHasKD" class="text-sm">Detta hinder har knockdown/bollar</label>
              </div>
              <div>
                <label for="newObstacleKDpen" class="block text-sm">Straff/knockdown (sek) – tomt = använd globalt värde</label>
                <input type="number" id="newObstacleKDpen" class="mt-1 block w-full p-2 border rounded-md" placeholder="t.ex. 5">
              </div>
            </div>

            <!-- NYTT: Specifikt antal portar -->
            <div class="border-t pt-2 mt-2">
               <label for="newObstacleGateCount" class="block text-sm font-medium text-gray-700">Antal portar – Grundinställning</label>
               <input type="number" id="newObstacleGateCount" class="mt-1 block w-full p-2 border rounded-md" placeholder="Tomt = använd klassens inställning">
               <p class="text-xs text-gray-500 mt-1">Detta värde gäller alla klasser om inget undantag anges nedan.</p>
               
               <div id="classGateOverridesContainer" class="mt-3 space-y-2 pl-2 border-l-2 border-gray-200">
                  <!-- Dynamiska fält för klasser hamnar här -->
               </div>
            </div>

            <div class="flex items-center gap-2 mt-4">
                <button type="submit" class="flex-1 bg-brand-darkblue text-white font-semibold py-2 px-4 rounded-lg hover:bg-brand-gold hover:text-brand-darkblue">
                  Spara Hinder
                </button>
                <button type="button" id="clearObstacleFormBtn" class="px-4 py-2 text-sm rounded border bg-gray-100 hover:bg-gray-200">Avbryt redigering</button>
            </div>
          </form>

          <h3 class="text-xl font-semibold mt-6 mb-2 border-t pt-4">Befintliga Hinder</h3>
          <div id="obstacleList" class="mt-4 space-y-2 max-h-96 overflow-y-auto"></div>
        </div>

      </div>
    </div>
  `;
}

// HJÄLPFUNKTION: Rendera inputs för klass-specifika undantag
function renderClassGateOverrides(container, overrides = {}) {
  // Hämta unika klasser från allEquipages
  const classes = Array.from(new Set(allEquipages.map(e => e.className).filter(Boolean))).sort();

  if (classes.length === 0) {
    container.innerHTML = '<p class="text-xs text-gray-400 italic">Inga klasser hittades.</p>';
    return;
  }

  container.innerHTML = `
    <p class="text-xs font-semibold text-gray-600 mb-1">Undantag per klass:</p>
    ${classes.map(cls => {
    const val = overrides[cls] || '';
    return `
        <div class="flex items-center justify-between gap-2">
           <label class="text-xs text-gray-700 truncate w-2/3" title="${cls}">${cls}</label>
           <input type="number" data-override-class="${cls}" value="${val}" class="gate-override-input w-16 p-1 text-sm border rounded" placeholder="-">
        </div>
      `;
  }).join('')}
  `;
}

// ------------------------------
// Maratoninställningar (klasser, distanser, tempo, idealtid)
async function setupGlobalSettingsForm() {
  const form = pageRoot.querySelector('#global-settings-form');
  if (!form) return;

  const rateInput = form.querySelector('#timePenaltyRate');
  const obsRateInput = form.querySelector('#obstaclePenaltyRate'); // <-- Nytt
  const kdInput = form.querySelector('#knockdownPenaltyDefault');
  const maxTimeInput = form.querySelector('#obstacleMaxTime');

  const config = await getConfig(competitionId, 'maratonConfig') || {};
  rateInput.value = config.timePenaltyRate ?? '0.25';
  obsRateInput.value = config.obstaclePenaltyRate ?? '1.0'; // <-- Default 1.0 om saknas
  kdInput.value = config.knockdownPenaltyDefault ?? '5';
  maxTimeInput.value = config.obstacleMaxTime ?? '300';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newConfig = {
      timePenaltyRate: parseFloat(rateInput.value) || 0.25,
      obstaclePenaltyRate: parseFloat(obsRateInput.value) || 1.0, // <-- Spara
      knockdownPenaltyDefault: parseInt(kdInput.value) || 5,
      obstacleMaxTime: parseInt(maxTimeInput.value) || 300
    };
    try {
      await saveConfig(competitionId, 'maratonConfig', newConfig);
      showAlert('Globala regelinställningar har sparats.');
    } catch (err) {
      showAlert('Kunde inte spara globala inställningar.', false);
    }
  });
}

// ERSÄTT DENNA FUNKTION i maraton-admin.js

async function setupMarathonSettings() {
  if (!pageRoot) return;
  const container = pageRoot.querySelector('#marathon-distances-container');
  const form = pageRoot.querySelector('#marathon-settings-form');
  if (!container || !form) return;

  const classNames = Array.from(new Set((allEquipages || []).map(e => e?.className?.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'sv'));
  const classCatMap = buildDominantTRCategoryByClass(allEquipages);
  // Läs svensknyckeln
  let existingConfig = await getConfig(competitionId, 'maratonConfig') || {};

  // MIGRERING: om det finns data under engelska 'marathonConfig', kopiera in det
  const oldEnConfig = await getConfig(competitionId, 'marathonConfig');
  if (oldEnConfig && (!existingConfig || Object.keys(existingConfig).length === 0)) {
    await saveConfig(competitionId, 'maratonConfig', { ...oldEnConfig });
    existingConfig = { ...oldEnConfig };
  }

  const classData = existingConfig.marathonClassData || {};


  const pauseEl = pageRoot.querySelector('#pauseTime');
  if (pauseEl) pauseEl.value = existingConfig.pauseTime ?? '10';

  let html = '';

  classNames.forEach(cn => {
    const data = classData[cn] || {};
    const catKey = classCatMap.get(cn) || 'horse';

    // Helper to determine active tempo for calculation (Manual > TR > Default)
    const getEffectiveTempo = (section, manualTempo) => {
      if (Number.isFinite(manualTempo) && manualTempo > 0) return manualTempo;
      return trTempoMminForWithCat(cn, section, catKey);
    };

    const tempoA = Number.isFinite(data.tempoA) ? data.tempoA : null;
    const tempoB = Number.isFinite(data.tempoB) ? data.tempoB : null;

    // Use specific cast to Number for distance to fix "missing ideal time" bug
    const distA = Number(data.distanceA) || 0;
    const distB = Number(data.distanceB) || 0;

    const finalTempoA = getEffectiveTempo('A', tempoA);
    const finalTempoB = getEffectiveTempo('B', tempoB);

    const aIdeal = fmtIdealTime(distA, finalTempoA);
    const bIdeal = fmtIdealTime(distB, finalTempoB);

    // Ny, grupperad layout per klass
    html += `
      <div class="border rounded-lg p-4 space-y-4 mb-4 bg-gray-50">
        <h4 class="font-semibold text-lg text-gray-800">${cn}</h4>
        
        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 border-b pb-4">
          <div>
            <p class="font-medium text-gray-700 mb-2">Etapp A</p>
            <div class="grid grid-cols-4 gap-2 items-center">
              <input type="number" data-class-name="${cn}" data-field="distanceA" class="marathon-class-input p-2 border rounded-md text-sm" value="${data.distanceA ?? ''}" placeholder="Distans (m)">
              <input type="number" data-class-name="${cn}" data-field="tempoA" class="marathon-class-input p-2 border rounded-md text-sm" value="${data.tempoA ?? ''}" placeholder="Tempo (valfritt)">
              <input type="number" data-class-name="${cn}" data-field="windowA" class="marathon-class-input p-2 border rounded-md text-sm" value="${data.windowA ?? '2'}" placeholder="Fönster (min)">
              <div class="text-center min-w-[60px]"><span class="block font-semibold text-gray-800" data-ideal-for="${cn}|A">${aIdeal}</span> <span class="text-[10px] text-gray-400 uppercase tracking-wider">Idealtid</span></div>
            </div>
            <div class="text-xs text-gray-400 mt-1 pl-1">TR-tempo: ${trTempoMminForWithCat(cn, 'A', catKey) ? Math.round(trTempoMminForWithCat(cn, 'A', catKey)) : '—'} m/min</div>
          </div>
          <div>
            <p class="font-medium text-gray-700 mb-2">Etapp B</p>
            <div class="grid grid-cols-4 gap-2 items-center">
              <input type="number" data-class-name="${cn}" data-field="distanceB" class="marathon-class-input p-2 border rounded-md text-sm" value="${data.distanceB ?? ''}" placeholder="Distans (m)">
              <input type="number" data-class-name="${cn}" data-field="tempoB" class="marathon-class-input p-2 border rounded-md text-sm" value="${data.tempoB ?? ''}" placeholder="Tempo (valfritt)">
              <input type="number" data-class-name="${cn}" data-field="windowB" class="marathon-class-input p-2 border rounded-md text-sm" value="${data.windowB ?? '3'}" placeholder="Fönster (min)">
              <div class="text-center min-w-[60px]"><span class="block font-semibold text-gray-800" data-ideal-for="${cn}|B">${bIdeal}</span> <span class="text-[10px] text-gray-400 uppercase tracking-wider">Idealtid</span></div>
            </div>
             <div class="text-xs text-gray-400 mt-1 pl-1">TR-tempo: ${trTempoMminForWithCat(cn, 'B', catKey) ? Math.round(trTempoMminForWithCat(cn, 'B', catKey)) : '—'} m/min</div>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <p class="font-medium text-gray-700 mb-2">Transport</p>
            <div class="grid grid-cols-2 gap-2">
              <input type="number" data-class-name="${cn}" data-field="distanceT" class="marathon-class-input p-2 border rounded-md" value="${data.distanceT ?? ''}" placeholder="Distans (m)">
              <input type="number" data-class-name="${cn}" data-field="tempoT" class="marathon-class-input p-2 border rounded-md" value="${data.tempoT ?? ''}" placeholder="Tempo (m/min)">
            </div>
          </div>
          <div>
             <div class="grid grid-cols-2 gap-2">
               <div>
                  <p class="font-medium text-gray-700 mb-2">Portar</p>
                  <input type="number" data-class-name="${cn}" data-field="gateCount" class="marathon-class-input w-full p-2 border rounded-md" value="${data.gateCount ?? '6'}" placeholder="Antal portar">
               </div>
               <div>
                  <p class="font-medium text-gray-700 mb-2 text-sm" title="Om tomt används globalt värde">Hinderstraff/sek</p>
                  <input type="number" step="0.01" data-class-name="${cn}" data-field="obstaclePenaltyRate" class="marathon-class-input w-full p-2 border rounded-md text-sm" value="${data.obstaclePenaltyRate ?? ''}" placeholder="Globalt">
               </div>
             </div>
          </div>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;

  // Spara-logiken och realtids-uppdateringen är oförändrade och korrekta
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newClassData = {};
    container.querySelectorAll('.marathon-class-input').forEach(input => {
      const cls = input.dataset.className, field = input.dataset.field;
      if (!cls || !field) return;
      if (!newClassData[cls]) newClassData[cls] = {};
      const val = parseFloat(input.value);
      newClassData[cls][field] = Number.isFinite(val) ? val : null;
    });
    const pauseVal = parseInt(pageRoot.querySelector('#pauseTime')?.value) || 10;
    const oldCfg = await getConfig(competitionId, 'maratonConfig') || {};

    // --- Bygg normaliserat marathonClassDistances parallellt från admin-formatet ---
    const marathonClassDistances = {};
    for (const [className, row] of Object.entries(newClassData)) {
      const A = Math.max(0, Number(row.distanceA) || 0);
      const T = Math.max(0, Number(row.distanceT) || 0);
      const B = Math.max(0, Number(row.distanceB) || 0);
      const tempoT = Number.isFinite(row.tempoT) ? Number(row.tempoT) : null;
      const tempoA = Number.isFinite(row.tempoA) ? Number(row.tempoA) : null;
      const tempoB = Number.isFinite(row.tempoB) ? Number(row.tempoB) : null;

      marathonClassDistances[className] = {
        A: { distance: A, tempo_mpm: tempoA },
        T: { distance: T, tempo_mpm: tempoT },
        B: { distance: B, tempo_mpm: tempoB }
      };
    }

    // Spara allt i samma dokument (backwards-compat bibehålls)
    const newConfig = {
      ...oldCfg,
      marathonClassData: newClassData,     // ditt originalformat (windowA/B, gateCount, etc.)
      marathonClassDistances,              // normaliserat A/T/B-format som andra sidor kan läsa direkt
      pauseTime: pauseVal
    };
    try {
      await saveConfig(competitionId, 'maratonConfig', newConfig);
      showAlert('Maratoninställningar har sparats!');

    } catch (err) {
      showAlert('Kunde inte spara maratoninställningarna.', false);
    }
  });

  container.addEventListener('input', (e) => {
    if (!(e.target instanceof HTMLInputElement)) return;
    const cls = e.target.dataset.className;
    if (!cls) return;
    const q = (field) => {
      const el = container.querySelector(`input[data-class-name="${cls}"][data-field="${field}"]`);
      return el ? parseFloat(el.value) : NaN;
    };
    const catKey = classCatMap.get(cls) || 'horse';

    // Logic duped from above for live update
    const manualTempoA = q('tempoA');
    const manualTempoB = q('tempoB');

    const effTempoA = (Number.isFinite(manualTempoA) && manualTempoA > 0)
      ? manualTempoA
      : trTempoMminForWithCat(cls, 'A', catKey);

    const effTempoB = (Number.isFinite(manualTempoB) && manualTempoB > 0)
      ? manualTempoB
      : trTempoMminForWithCat(cls, 'B', catKey);

    // Cast distance to Number explicitly for safety
    const distA = Number(q('distanceA')) || 0;
    const distB = Number(q('distanceB')) || 0;

    const idealA = fmtIdealTime(distA, effTempoA);
    const idealB = fmtIdealTime(distB, effTempoB);

    container.querySelector(`[data-ideal-for="${cls}|A"]`).textContent = idealA;
    container.querySelector(`[data-ideal-for="${cls}|B"]`).textContent = idealB;
  });
}

function setupObstacleForm() {
  const form = pageRoot.querySelector('#addObstacleForm');
  const obstacleListContainer = pageRoot.querySelector('#obstacleList');
  if (!form || !obstacleListContainer) return;

  // Hämta alla formulär-element en gång
  const numInput = form.querySelector('#newObstacleNumber');
  const nameInput = form.querySelector('#newObstacleName');
  const hasKdInput = form.querySelector('#newObstacleHasKD');
  const kdPenInput = form.querySelector('#newObstacleKDpen');
  const gateCountInput = form.querySelector('#newObstacleGateCount');
  const overridesContainer = form.querySelector('#classGateOverridesContainer');

  const editingInput = form.querySelector('#editingObstacleNumber');
  const clearButton = form.querySelector('#clearObstacleFormBtn');

  // Rendera override inputs initialt (tomma)
  renderClassGateOverrides(overridesContainer);

  const resetForm = () => {
    form.reset();
    editingInput.value = '';
    numInput.readOnly = false;
    renderClassGateOverrides(overridesContainer); // Rensa om
  };

  if (clearButton) clearButton.addEventListener('click', resetForm);

  // Händelselyssnare för hela listan
  obstacleListContainer.addEventListener('click', async (e) => {
    const button = e.target.closest('button');
    if (!button) return;

    const action = button.dataset.action;
    const number = parseInt(button.dataset.number);
    if (!action || !number) return;

    // Redigera-logik
    if (action === 'edit-obstacle') {
      const obsToEdit = allObstacles.find(o => o.number === number);
      if (obsToEdit) {
        editingInput.value = obsToEdit.number;
        numInput.value = obsToEdit.number;
        numInput.readOnly = true;
        nameInput.value = obsToEdit.name || '';
        hasKdInput.checked = !!obsToEdit.knockdown?.enabled;
        kdPenInput.value = obsToEdit.knockdown?.penaltySec ?? '';
        gateCountInput.value = obsToEdit.gateCount ?? '';

        // Fyll i overrides
        renderClassGateOverrides(overridesContainer, obsToEdit.classOverrides || {});

        form.scrollIntoView({ behavior: 'smooth' });
      }
    }

    // Ta bort-logik
    if (action === 'delete-obstacle') {
      if (confirm(`Är du säker på att du vill ta bort hinder #${number}?`)) {
        try {
          // Denna funktion behöver finnas i din firestoreService.js
          await deleteMarathonObstacle(competitionId, number);
          showAlert(`Hinder #${number} har tagits bort.`);
          resetForm();
        } catch (err) {
          showAlert('Kunde inte ta bort hindret.', false);
        }
      }
    }
  });

  // Uppdaterad Spara-logik
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const isEditing = !!editingInput.value;
    const num = parseInt(numInput.value);

    if (!Number.isFinite(num) || num <= 0) {
      showAlert('Ange ett giltigt, positivt hindernummer.');
      return;
    }

    // Samla in overrides
    const overrides = {};
    overridesContainer.querySelectorAll('input.gate-override-input').forEach(inp => {
      const val = parseInt(inp.value);
      if (Number.isInteger(val) && val > 0) {
        overrides[inp.dataset.overrideClass] = val;
      }
    });

    const obstacleData = {
      number: num,
      name: (nameInput.value || '').trim(),
      // NYTT: Spara gateCount om det finns (annars null)
      gateCount: gateCountInput.value ? parseInt(gateCountInput.value) : null,
      classOverrides: Object.keys(overrides).length > 0 ? overrides : null,
      knockdown: {
        enabled: !!hasKdInput.checked,
        penaltySec: parseFloat(kdPenInput.value) || null
      }
    };

    try {
      await saveMarathonObstacle(competitionId, num, obstacleData);
      showAlert(`Hinder ${num} har ${isEditing ? 'uppdaterats' : 'sparats'}.`);
      resetForm();
    } catch (err) {
      console.error(err);
      showAlert('Kunde inte spara hindret.');
    }
  });
}

function renderObstacleList(obstacles = []) {
  allObstacles = obstacles; // Uppdatera den lokala kopian
  const list = pageRoot.querySelector('#obstacleList');
  if (!list) return;

  const sorted = [...obstacles].sort((a, b) => (a.number || 0) - (b.number || 0));
  if (sorted.length === 0) {
    list.innerHTML = `<div class="text-sm text-gray-500">Inga hinder inlagda ännu.</div>`;
    return;
  }

  list.innerHTML = sorted.map(o => {
    const kd = o?.knockdown?.enabled ? `• KD ${Number.isFinite(o.knockdown.penaltySec) ? `(${o.knockdown.penaltySec}s)` : '(Global)'}` : '';
    // NYTT: Visa portar om specifikt värde finns
    const gates = Number.isInteger(o.gateCount) ? `• ${o.gateCount} portar` : '';
    return `
      <div class="flex items-center justify-between p-2 rounded border bg-gray-50">
        <div class="text-sm">
          <span class="font-semibold">#${o.number}</span>
          <span class="ml-2">${o.name || ''}</span>
          <span class="ml-2 text-gray-500">${kd} ${gates}</span>
        </div>
        <div class="flex items-center gap-2">
          <button type="button" data-action="edit-obstacle" data-number="${o.number}" class="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100">Redigera</button>
          <button type="button" data-action="delete-obstacle" data-number="${o.number}" class="px-2 py-1 text-xs rounded border bg-white text-red-600 hover:bg-red-50">Ta bort</button>
        </div>
      </div>
    `;
  }).join('');
}
// Public API
export async function load() {
  const competition = getGlobalState('currentCompetition');

  // Sätt pageRoot direkt när load anropas
  pageRoot = document.getElementById('page-maraton-admin');
  if (!pageRoot) return;

  if (!competition || !competition.id) {
    pageRoot.innerHTML = '<div class="p-8 text-center text-gray-500">Välj en tävling i hubben först.</div>';
    return;
  }

  competitionId = competition.id;
  renderLayout(competition); // ritar hela sidan

  // Omedelbar laddning av ekipage så UI fylls utan att vänta på snapshot
  try {
    const list = await getEquipages(competitionId);
    allEquipages = Array.isArray(list) ? list : [];
    await setupMarathonSettings();
  } catch (e) {
    console.error('[MaratonAdmin] getEquipages error:', e);
  }

  // Realtidslyssnare för ekipage
  if (unsubscribeEquipages) unsubscribeEquipages();
  unsubscribeEquipages = listenForEquipages(competitionId, async (equipages) => {
    allEquipages = Array.isArray(equipages) ? equipages : [];
    await setupMarathonSettings();
  });

  // Hinder: form + lyssnare
  setupObstacleForm();
  setupGlobalSettingsForm();
  if (unsubscribeObstacles) unsubscribeObstacles();
  unsubscribeObstacles = listenForMarathonObstacles(competitionId, (obs) => {
    renderObstacleList(obs);
  });
}
