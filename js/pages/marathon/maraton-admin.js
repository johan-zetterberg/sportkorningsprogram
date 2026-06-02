// js/pages/maraton-admin.js
import { getGlobalState } from '../../main.js';
import { getConfig } from '../../services/competitionService.js';
import { saveConfig } from '../../services/competitionService.js';
import { listenForEquipages } from '../../services/equipageService.js';
import { listenForMarathonObstacles, saveMarathonObstacle, deleteMarathonObstacle } from '../../services/marathonService.js';
import { getEquipages } from '../../services/equipageService.js';
import { getCompetitionHeader, showAlert } from '../../ui/components.js';
import { generateTimecardsPdf } from '../../pdf/timecardsPdf.js';
import { hasMarathonValidationErrors, validateMarathonAdminSettings } from './marathonAdminValidation.js';

let competitionId = null;
let allEquipages = [];
let allObstacles = [];
let unsubscribeEquipages = null;
let unsubscribeObstacles = null;
let pageRoot = null;
let currentCompetition = null;
let pickerMap = null; // Global reference for cleanup
let marathonValidationErrors = {};


// ------------------------------
// === TR V 2025 – Maratontempon (km/h) per klass & kategori ===
// Kolumner: ponyA, ponyB, ponyCD, horse
import {
  DEFAULT_TRV_TEMPOS_KMH,
  normalizeClassKey
} from '../../utils/marathonUtils.js';

// ------------------------------
// === TR V 2025 – Maratontempon (km/h) per klass & kategori ===
// Nu importerad från marathonUtils som DEFAULT_TRV_TEMPOS_KMH
const TRV_2025_MARATON_TEMPOS_KMH = DEFAULT_TRV_TEMPOS_KMH;

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
  currentCompetition = competition;
  pageRoot = document.getElementById('page-maraton-admin');
  if (!pageRoot) return;

  pageRoot.innerHTML = `
    <div class="container mx-auto p-4 md:p-8">
      ${getCompetitionHeader(competition, 'Admin – Maraton')}

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">

<div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md lg:col-span-3">
 <h2 class="text-2xl font-semibold mb-4 border-b dark:border-gray-700 pb-2 dark:text-white">Globala Regelinställningar</h2>
  <form id="global-settings-form" class="space-y-4">
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div>
        <label for="timePenaltyRate" class="block text-sm font-medium dark:text-gray-300">Straffpoäng/sek (Sträcka)</label>
        <input type="number" step="0.01" id="timePenaltyRate" class="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="t.ex. 0.25 (Default: 0.25)">
      </div>
      <div>
        <label for="obstaclePenaltyRate" class="block text-sm font-medium dark:text-gray-300">Straffpoäng/sek (Hinder)</label>
        <input type="number" step="0.01" id="obstaclePenaltyRate" class="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="t.ex. 0.25 (Default: 0.25)">
      </div>
      <div>
        <label for="knockdownPenaltyDefault" class="block text-sm font-medium dark:text-gray-300">Standardstraff per knockdown (straffpoäng)</label>
        <input type="number" id="knockdownPenaltyDefault" class="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="t.ex. 5">
      </div>
      <div>
        <label for="obstacleMaxTime" class="block text-sm font-medium dark:text-gray-300">Maximal hindertid (sekunder)</label>
        <input type="number" id="obstacleMaxTime" class="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="t.ex. 300">
      </div>
    </div>
      <div class="col-span-1 md:col-span-3 border-t dark:border-gray-700 pt-4 mt-2">
        <label for="tempoRulesJson" class="block text-sm font-medium text-blue-800 dark:text-blue-200">
          Tempotabeller & Regler (JSON) 
          <span class="text-xs text-blue-600 dark:text-blue-400 font-normal ml-2 cursor-pointer hover:underline" id="btnLoadDefRules">(Återställ till Default)</span>
        </label>
        <p class="text-[10px] text-gray-500 dark:text-gray-400 mb-1">Redigera tempon för olika klasser om TR ändras eller specialregler gäller.</p>
        <textarea id="tempoRulesJson" rows="8" class="w-full p-2 border border-blue-200 dark:border-blue-900 rounded-md font-mono text-xs bg-blue-50/20 dark:bg-blue-900/20 dark:text-gray-300"></textarea>
      </div>
      <button type="submit" class="w-full mt-2 bg-gray-800 text-white font-semibold py-2 px-4 rounded-lg hover:bg-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600">
        Spara Globala Inställningar
      </button>
    </form>
</div>

<div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md lg:col-span-3">
  <h2 class="text-2xl font-semibold mb-4 border-b dark:border-gray-700 pb-2 dark:text-white">Kartinställningar (Live-karta)</h2>
  
  <div class="grid grid-cols-1 xl:grid-cols-2 gap-8">
    <form id="map-settings-form" class="space-y-4">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label for="mapImageUrl" class="block text-sm font-medium dark:text-gray-300">Bild-URL för karta</label>
          <div class="flex gap-2">
            <input type="text" id="mapImageUrl" class="flex-1 p-2 border rounded-md text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="t.ex. img/marathon-course-new.png">
          </div>
          
          <!-- Upload Tools -->
          <div class="flex items-center gap-2 mt-2">
            <input type="file" id="mapImageUploadInput" accept="image/*" class="hidden">
            <button type="button" id="btnUploadMapImage" class="bg-blue-50 border-2 border-blue-200 text-blue-700 hover:bg-blue-100 hover:border-blue-300 px-3 py-1.5 rounded-md text-xs font-bold transition-all shadow-sm flex items-center gap-1 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-900/40" title="Ladda upp bildfil">
                <span>📤 Ladda upp bildfil</span>
            </button>
            <button type="button" id="btnGoogleDriveHelper" class="bg-white border-2 border-green-100 hover:border-green-500 text-green-600 px-3 py-1.5 rounded-md text-xs font-bold transition-all shadow-sm flex items-center gap-1 dark:bg-gray-700 dark:border-green-900 dark:text-green-400" title="Konvertera Google Drive-länk">
                <span class="text-lg">📁</span> G-Drive
            </button>
            <span class="text-[10px] text-gray-400 italic ml-2">Eller klistra in länk ovan.</span>
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium dark:text-gray-300">Bander (Bounds)</label>
          <div class="flex gap-2 items-center">
              <span class="text-xs text-gray-500 dark:text-gray-400">[0,0] till</span>
              <input type="number" id="mapBoundsX" class="mt-1 w-24 p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="X (1920)">
              <input type="number" id="mapBoundsY" class="mt-1 w-24 p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="Y (1080)">
              <button type="button" id="btnFixAspectRatio" class="text-[10px] text-blue-600 hover:underline dark:text-blue-400" title="Sätt bounds efter bildens faktiska storlek">Matcha bildens mått</button>
          </div>
        </div>
      </div>

      <div class="bg-blue-50/50 p-3 rounded-lg border border-blue-100 dark:bg-blue-900/20 dark:border-blue-800">
        <label for="mapEntitySelector" class="block text-sm font-bold text-blue-800 mb-1 dark:text-blue-200">Interaktiv positionerare</label>
        <div class="flex gap-2">
            <select id="mapEntitySelector" class="flex-1 p-2 border border-blue-200 rounded-md text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none dark:bg-gray-700 dark:border-blue-900 dark:text-white">
                <option value="stage_A">🚩 Etapp A (Start)</option>
                <option value="transport">🚛 Transport</option>
                <option value="stage_B">🏁 Etapp B (Start B)</option>
                <option value="finish">🏆 Mål (Finish)</option>
                <optgroup label="Hinder">
                    <option value="hinder_1">Hinder 1</option>
                    <option value="hinder_2">Hinder 2</option>
                    <option value="hinder_3">Hinder 3</option>
                    <option value="hinder_4">Hinder 4</option>
                    <option value="hinder_5">Hinder 5</option>
                    <option value="hinder_6">Hinder 6</option>
                    <option value="hinder_7">Hinder 7</option>
                    <option value="hinder_8">Hinder 8</option>
                </optgroup>
                <optgroup label="Vägar (Pathing)">
                    <option value="hinder_1_to_2">Mellan 1 och 2</option>
                    <option value="hinder_2_to_3">Mellan 2 och 3</option>
                    <option value="hinder_3_to_4">Mellan 3 och 4</option>
                    <option value="hinder_4_to_5">Mellan 4 och 5</option>
                    <option value="hinder_5_to_6">Mellan 5 och 6</option>
                    <option value="hinder_6_to_7">Mellan 6 och 7</option>
                    <option value="hinder_7_to_8">Mellan 7 och 8</option>
                </optgroup>
            </select>
            <div class="text-[10px] text-blue-600 bg-white px-2 py-1 rounded border border-blue-100 flex items-center max-w-[120px] leading-tight italic dark:bg-gray-800 dark:text-blue-300 dark:border-blue-900">
                Välj enhet & klicka på kartan till höger
            </div>
        </div>
      </div>
      
      <div>
        <label for="mapCoordsJson" class="block text-sm font-medium text-gray-600 dark:text-gray-400">Koordinater (JSON)</label>
        <textarea id="mapCoordsJson" rows="6" class="mt-1 w-full p-2 border rounded-md font-mono text-xs dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300" placeholder='{"stage_A": [855, 290], ...}'></textarea>
        <div class="flex justify-between items-center mt-1">
          <p class="text-[10px] text-gray-400 italic">Positioner för A, B, Transport och Hinder.</p>
          <button type="button" id="btnLoadDefaultCoords" class="text-[10px] text-blue-600 hover:underline dark:text-blue-400">Ladda standard-koordinater</button>
        </div>
      </div>

      <button type="submit" class="w-full mt-2 bg-brand-darkblue text-white font-semibold py-2 px-4 rounded-lg hover:bg-gray-700 shadow-md dark:bg-blue-600 dark:hover:bg-blue-500">
        Spara Kartinställningar
      </button>
    </form>

    <div class="h-[400px] xl:h-full min-h-[400px] border-2 border-gray-100 rounded-xl overflow-hidden bg-gray-50 relative shadow-inner z-0 dark:border-gray-700 dark:bg-gray-900">
        <div id="maraton-admin-map-picker" class="w-full h-full"></div>
        <div class="absolute top-2 right-2 z-[1000] pointer-events-none">
            <span class="bg-gray-900/80 text-white text-[9px] px-2 py-1 rounded-full backdrop-blur uppercase tracking-widest font-bold">Preview / Picker</span>
        </div>
    </div>
  </div>
</div>

<!-- Utskrifter (Ny sektion) -->
<div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md lg:col-span-3">
  <h2 class="text-2xl font-semibold mb-4 border-b dark:border-gray-700 pb-2 dark:text-white">Utskrifter & Rapporter</h2>
  <div class="flex flex-wrap gap-4">
    <button type="button" id="btnPrintTimecards" class="flex items-center gap-2 bg-blue-600 text-white font-semibold py-2 px-6 rounded-lg hover:bg-blue-700 transition-colors dark:bg-blue-700 dark:hover:bg-blue-600">
      🖨️ Skriv ut Tidkort (PDF)
    </button>
  </div>
</div>
        <!-- Maratoninställningar -->
        <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md lg:col-span-2">
          <h2 class="text-2xl font-semibold mb-4 border-b dark:border-gray-700 pb-2 dark:text-white">Maratoninställningar</h2>
          <form id="marathon-settings-form" class="space-y-4">
            <div class="space-y-2" id="marathon-distances-container">
              <p class="text-sm text-gray-500 dark:text-gray-400">Laddar klasser …</p>
            </div>
            <div class="border-t dark:border-gray-700 pt-4">
              <label for="pauseTime" class="block text-sm font-medium dark:text-gray-300">Paus mellan A/WU och B (minuter)</label>
              <input type="number" id="pauseTime" value="10" class="mt-1 w-full md:w-1/3 p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
            </div>
            <button type="submit" class="w-full mt-2 bg-gray-800 text-white font-semibold py-2 px-4 rounded-lg hover:bg-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600">
              Spara Maratoninställningar
            </button>
          </form>
        </div>

        <!-- Maratonhinder -->
        <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md lg:col-span-1 lg:self-start">
          <h2 class="text-2xl font-semibold mb-4 border-b dark:border-gray-700 pb-2 dark:text-white">Maratonhinder</h2>
          <form id="addObstacleForm" class="space-y-4">
            <input type="hidden" id="editingObstacleNumber">

            <div>
              <label for="newObstacleNumber" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Hindernummer</label>
              <input type="number" id="newObstacleNumber" required class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="t.ex. 1">
            </div>
            <div>
              <label for="newObstacleName" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Namn (valfritt)</label>
              <input type="text" id="newObstacleName" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="t.ex. Vattenhindret">
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div class="flex items-center gap-3">
                <input type="checkbox" id="newObstacleHasKD" class="h-4 w-4 dark:bg-gray-700 dark:border-gray-600">
                <label for="newObstacleHasKD" class="text-sm dark:text-gray-300">Detta hinder har knockdown/bollar</label>
              </div>
              <div>
                <label for="newObstacleKDpen" class="block text-sm dark:text-gray-300">Straff/knockdown (straffpoäng) - tomt = använd globalt värde</label>
                <input type="number" id="newObstacleKDpen" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="t.ex. 5 straffpoäng">
              </div>
            </div>

            <!-- NYTT: Specifikt antal portar -->
            <div class="border-t dark:border-gray-700 pt-2 mt-2">
               <label for="newObstacleGateCount" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Antal portar – Grundinställning</label>
               <input type="number" id="newObstacleGateCount" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="Tomt = använd klassens inställning">
               <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Detta värde gäller alla klasser om inget undantag anges nedan.</p>
               
               <div id="classGateOverridesContainer" class="mt-3 space-y-2 pl-2 border-l-2 border-gray-200 dark:border-gray-700">
                  <!-- Dynamiska fält för klasser hamnar här -->
               </div>
            </div>

            <div class="flex items-center gap-2 mt-4">
                <button type="submit" class="flex-1 bg-brand-darkblue text-white font-semibold py-2 px-4 rounded-lg hover:bg-brand-gold hover:text-brand-darkblue dark:bg-blue-600 dark:hover:bg-blue-500 dark:hover:text-white">
                  Spara Hinder
                </button>
                <button type="button" id="clearObstacleFormBtn" class="px-4 py-2 text-sm rounded border bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-600">Avbryt redigering</button>
            </div>
          </form>

          <h3 class="text-xl font-semibold mt-6 mb-2 border-t dark:border-gray-700 pt-4 dark:text-white">Befintliga Hinder</h3>
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
    <p class="text-xs font-semibold text-gray-600 mb-1 dark:text-gray-300">Undantag per klass:</p>
    ${classes.map(cls => {
    const val = overrides[cls] || '';
    return `
        <div class="flex items-center justify-between gap-2">
           <label class="text-xs text-gray-700 truncate w-2/3 dark:text-gray-400" title="${cls}">${cls}</label>
           <input type="number" data-override-class="${cls}" value="${val}" class="gate-override-input w-16 p-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="-">
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
  const rulesInput = form.querySelector('#tempoRulesJson'); // <-- Nytt
  const btnLoadDef = form.querySelector('#btnLoadDefRules'); // <-- Nytt

  const config = await getConfig(competitionId, 'maratonConfig') || {};
  const comp = getGlobalState ? getGlobalState('currentCompetition') : null;
  const defObs = comp?.ruleSettings?.marathonObstaclePenaltyRate ?? 0.25;

  rateInput.value = config.timePenaltyRate ?? '0.25';
  obsRateInput.value = config.obstaclePenaltyRate ?? String(defObs);
  kdInput.value = config.knockdownPenaltyDefault ?? '5';
  maxTimeInput.value = config.obstacleMaxTime ?? '300';

  // Ladda regler eller default
  const rulesVal = config.tempoRules || DEFAULT_TRV_TEMPOS_KMH;
  rulesInput.value = JSON.stringify(rulesVal, null, 2);

  // Återställningsknapp
  btnLoadDef?.addEventListener('click', () => {
    if (confirm('Vill du skriva över nuvarande regler i rutan med systemets standardvärden?')) {
      rulesInput.value = JSON.stringify(DEFAULT_TRV_TEMPOS_KMH, null, 2);
    }
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    let parsedRules = null;
    try {
      parsedRules = JSON.parse(rulesInput.value);
    } catch (err) {
      showAlert('Felaktigt JSON-format i tempotabellen.', false);
      return;
    }

    const newConfig = {
      timePenaltyRate: parseFloat(rateInput.value) || 0.25,
      obstaclePenaltyRate: parseFloat(obsRateInput.value) || defObs,
      knockdownPenaltyDefault: parseInt(kdInput.value) || 5,
      obstacleMaxTime: parseInt(maxTimeInput.value) || 300,
      tempoRules: parsedRules // <-- Spara
    };
    try {
      await saveConfig(competitionId, 'maratonConfig', newConfig);
      showAlert('Globala regelinställningar har sparats.');
    } catch (err) {
      showAlert('Kunde inte spara globala inställningar.', false);
    }
  };

  // Bind print button
  const printBtn = pageRoot.querySelector('#btnPrintTimecards');
  if (printBtn) {
    printBtn.addEventListener('click', () => {
      printTimecards();
    });
  }

  setupMapSettings();
}

async function printTimecards() {
  if (!allEquipages || allEquipages.length === 0) {
    alert('Inga ekipage att skriva ut.');
    return;
  }

  try {
    await generateTimecardsPdf(allEquipages, currentCompetition);
  } catch (err) {
    console.error("PDF Fail:", err);
    alert("Kunde inte generera PDF. Se konsolen.");
  }
}

async function setupMapSettings() {
  const form = pageRoot.querySelector('#map-settings-form');
  if (!form) return;

  const imgUrlInput = form.querySelector('#mapImageUrl');
  const uploadMapBtn = document.getElementById('btnUploadMapImage'); // New button
  const uploadMapInput = document.getElementById('mapImageUploadInput'); // Hidden input
  const boundsXInput = form.querySelector('#mapBoundsX');
  const boundsYInput = form.querySelector('#mapBoundsY');
  const coordsJsonInput = form.querySelector('#mapCoordsJson');
  const loadDefaultBtn = form.querySelector('#btnLoadDefaultCoords');
  const entitySelector = form.querySelector('#mapEntitySelector');
  const driveHelperBtn = form.querySelector('#btnGoogleDriveHelper');
  const fixAspectBtn = form.querySelector('#btnFixAspectRatio');

  const config = await getConfig(competitionId, 'maratonConfig') || {};
  const mapSettings = config.mapSettings || {};

  imgUrlInput.value = mapSettings.imageUrl || '';
  // Try newer flat format first [0, 0, y, x], then fallback to old nested format [[0,0],[y,x]]
  const b = mapSettings.bounds || [];
  const isNested = Array.isArray(b[0]);
  boundsXInput.value = isNested ? b[1][1] : (b[3] || 1920);
  boundsYInput.value = isNested ? b[1][0] : (b[2] || 1080);

  let currentEntities = mapSettings.entities || {};
  coordsJsonInput.value = JSON.stringify(currentEntities, null, 2);

  const DEFAULT_COORDS = {
    'stage_A': [855, 290],
    'transport': [700, 400],
    'stage_B': [180, 770],
    'finish': [180, 770],
    'hinder_1': [570, 260],
    'hinder_2': [865, 500],
    'hinder_3': [785, 685],
    'hinder_4': [615, 875],
    'hinder_5': [435, 590],
    'hinder_6': [420, 395],
    'hinder_7': [300, 160],
    'hinder_8': [165, 275]
  };

  // --- File Upload Logic ---
  uploadMapBtn?.addEventListener('click', () => {
    uploadMapInput.click();
  });

  uploadMapInput?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Optional: Validate type/size
    if (file.size > 5 * 1024 * 1024) {
      showAlert('Filen är för stor (Max 5MB).', false);
      return;
    }

    const btnText = uploadMapBtn.querySelector('span');
    const originalText = btnText.textContent;
    btnText.textContent = 'Laddar upp...';
    uploadMapBtn.disabled = true;

    try {
      const { uploadCompetitionDocument } = await import('../../services/storageService.js');
      // Use efficient path grouping: competitions/<id>/maps/<filename>
      // But storageService currently uses 'documents'. We might want to make it generic or just use it.
      // Let's use the existing function but maybe we should tweak it or add a generic one?
      // actually let's stick to the pattern in storageService or just import the generic 'uploadFile' if I created it?
      // I created 'uploadCompetitionDocument' which puts it in 'documents/'. 
      // For maps, 'maps/' might be nicer, but 'documents/' is fine.

      const downloadUrl = await uploadCompetitionDocument(competitionId, file);

      imgUrlInput.value = downloadUrl;
      imgUrlInput.classList.add('bg-green-50');

      // Trigger change to update preview
      imgUrlInput.dispatchEvent(new Event('change'));

      showAlert('Karta uppladdad! Glöm inte att spara inställningarna.');
    } catch (err) {
      console.error(err);
      showAlert('Uppladdning misslyckades: ' + err.message, false);
    } finally {
      btnText.textContent = originalText;
      uploadMapBtn.disabled = false;
      uploadMapInput.value = ''; // Reset
    }
  });

  // --- Google Drive Link Help Logic ---
  driveHelperBtn?.addEventListener('click', () => {
    const rawUrl = imgUrlInput.value.trim();
    if (!rawUrl) {
      showAlert('Klistra in en Google Drive-länk i fältet först!', false);
      return;
    }

    // Attempt to extract File ID
    // Match patterns like:
    // .../file/d/FILE_ID/view...
    // ...id=FILE_ID...
    let fileId = null;
    const fileDMatch = rawUrl.match(/\/file\/d\/([a-zA-Z0-9_-]{25,})/);
    const idMatch = rawUrl.match(/[?&]id=([a-zA-Z0-9_-]{25,})/);

    if (fileDMatch) fileId = fileDMatch[1];
    else if (idMatch) fileId = idMatch[1];

    if (fileId) {
      // Switch to the 'thumbnail' format which is much more reliable for embedding
      // than 'uc?export=view' which often hits 403 / security blocks.
      const directUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=w1600`;
      imgUrlInput.value = directUrl;

      // Visual feedback
      imgUrlInput.classList.add('bg-green-50');
      setTimeout(() => imgUrlInput.classList.remove('bg-green-50'), 1500);

      showAlert('Google Drive-länk konverterad! Kolla förhandsgranskningen.');
      initPickerMap(); // Reload map preview
    } else if (rawUrl.includes('drive.google.com')) {
      showAlert('Kunde inte hitta ett fil-ID i länken. Se till att du kopierat hela länken ("Dela" -> "Kopiera länk").', false);
    } else {
      showAlert('Detta ser inte ut som en Google Drive-länk.', false);
    }
  });

  // --- Picker Map Logic ---
  let pickerOverlay = null;
  let pickerMarkers = new Map(); // key -> marker

  const initPickerMap = () => {
    if (pickerMap) pickerMap.remove();

    pickerMap = L.map('maraton-admin-map-picker', {
      crs: L.CRS.Simple,
      minZoom: -4,
      maxZoom: 2,
      zoomSnap: 0,
      zoomDelta: 0.1,
      wheelPxPerZoomLevel: 150,
      zoomControl: true,
      attributionControl: false
    });

    const x = parseInt(boundsXInput.value) || 1920;
    const y = parseInt(boundsYInput.value) || 1080;
    const bounds = [[0, 0], [y, x]]; // Leaflet still needs nested array for its API
    const imgUrl = imgUrlInput.value.trim() || 'img/marathon-course-new.png';

    pickerOverlay = L.imageOverlay(imgUrl, bounds).addTo(pickerMap);
    pickerMap.fitBounds(bounds);
    syncMarkers(); // Initial markers

    // Map Click -> Update Coordinate
    pickerMap.on('click', (e) => {
      const lat = Math.round(e.latlng.lat);
      const lng = Math.round(e.latlng.lng);
      const key = entitySelector.value;

      if (!key) return;

      // Update local state
      currentEntities[key] = [lat, lng];

      // Update UI
      coordsJsonInput.value = JSON.stringify(currentEntities, null, 2);
      syncMarkers();

      // Visual feedback on the selector
      entitySelector.classList.add('ring-2', 'ring-green-500');
      setTimeout(() => entitySelector.classList.remove('ring-2', 'ring-green-500'), 1000);
    });
  };

  const syncMarkers = () => {
    if (!pickerMap) return;

    // Remove old
    pickerMarkers.forEach(m => m.remove());
    pickerMarkers.clear();

    // Add new
    Object.entries(currentEntities).forEach(([key, coords]) => {
      if (!Array.isArray(coords) || coords.length !== 2) return;

      const isSelected = key === entitySelector.value;
      const color = isSelected ? '#ef4444' : '#3b82f6';

      const marker = L.circleMarker(coords, {
        radius: isSelected ? 8 : 5,
        color: color,
        fillColor: color,
        fillOpacity: 0.8,
        weight: 2
      }).addTo(pickerMap);

      let label = key.replace('hinder_', 'H');
      if (key === 'stage_A') label = 'A';
      if (key === 'stage_B') label = 'B';
      if (key === 'transport') label = 'T';
      if (key === 'finish') label = 'F';

      marker.bindTooltip(label, {
        permanent: true,
        direction: 'top',
        className: 'picker-tooltip'
      });

      pickerMarkers.set(key, marker);
    });
  };

  // Initial init
  setTimeout(initPickerMap, 100);

  // Sync markers when selector changes
  entitySelector.addEventListener('change', syncMarkers);

  // Sync when typing JSON manually
  coordsJsonInput.addEventListener('input', () => {
    try {
      currentEntities = JSON.parse(coordsJsonInput.value);
      syncMarkers();
    } catch (e) { }
  });

  // Re-init map if bounds/image changes
  [imgUrlInput, boundsXInput, boundsYInput].forEach(inp => {
    inp.addEventListener('change', initPickerMap);
  });

  loadDefaultBtn?.addEventListener('click', () => {
    currentEntities = { ...DEFAULT_COORDS };
    coordsJsonInput.value = JSON.stringify(currentEntities, null, 2);
    syncMarkers();
  });

  form.onsubmit = async (e) => {
    e.preventDefault();

    let entities = {};
    try {
      entities = JSON.parse(coordsJsonInput.value);
    } catch (err) {
      showAlert('Ogiltig JSON i koordinat-fältet.', false);
      return;
    }

    const x = parseInt(boundsXInput.value) || 1000;
    const y = parseInt(boundsYInput.value) || 1000;

    const newMapSettings = {
      imageUrl: imgUrlInput.value.trim() || null,
      bounds: [0, 0, y, x], // Flat array for Firestore
      entities: entities
    };

    const currentCfg = await getConfig(competitionId, 'maratonConfig') || {};
    try {
      await saveConfig(competitionId, 'maratonConfig', {
        ...currentCfg,
        mapSettings: newMapSettings
      });
      showAlert('Kartinställningar har sparats.');
    } catch (err) {
      console.error('[MaratonAdmin] save mapSettings error:', err);
      showAlert('Kunde inte spara kartinställningar. Fel: ' + err.message, false);
    }
  };

  fixAspectBtn?.addEventListener('click', () => {
    const url = imgUrlInput.value.trim() || 'img/marathon-course-new.png';
    const img = new Image();
    img.onload = () => {
      boundsXInput.value = img.width;
      boundsYInput.value = img.height;
      initPickerMap();
      showAlert(`Mått uppdaterade till ${img.width}x${img.height}. Klicka på Spara för att bekräfta.`);
    };
    img.onerror = () => {
      showAlert('Kunde inte ladda bilden för att läsa av mått. Kontrollera URL:en.', false);
    };
    img.src = url;
  });
}

function extractCategory(eq) {
  // Helper to get a nice string for category
  // Assuming detectTRCategoryFromEquipage logic or similar, but simplified for display
  if (eq.category) return eq.category;
  // ...
  return '';
}

function getFieldError(className, field) {
  return marathonValidationErrors?.[className]?.find(error => error.field === field) || null;
}

function getMarathonInputClass(className, field, extraClass = '') {
  const hasError = !!getFieldError(className, field);
  const base = `marathon-class-input p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white ${extraClass}`;
  return hasError
    ? `${base} border-red-500 bg-red-50 dark:border-red-500 dark:bg-red-900/20 ring-1 ring-red-500`
    : base;
}

function renderFieldError(className, field) {
  const error = getFieldError(className, field);
  return error ? `<div class="mt-1 text-[11px] font-medium text-red-600 dark:text-red-300">${error.message}</div>` : '';
}

function renderClassValidationSummary(className) {
  const errors = marathonValidationErrors?.[className] || [];
  if (!errors.length) return '';

  return `
    <div class="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-700 dark:bg-red-900/25 dark:text-red-200">
      <div class="font-semibold">Kontrollera denna klass innan du sparar:</div>
      <ul class="mt-1 list-disc pl-5 space-y-0.5">
        ${errors.map(error => `<li>${error.message}</li>`).join('')}
      </ul>
    </div>
  `;
}

function escapeAttr(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function clearMarathonFieldError(input) {
  const cls = input?.dataset?.className;
  const field = input?.dataset?.field;
  if (!cls || !field || !marathonValidationErrors?.[cls]) return;

  marathonValidationErrors[cls] = marathonValidationErrors[cls].filter(error => error.field !== field);
  if (!marathonValidationErrors[cls].length) delete marathonValidationErrors[cls];
  input.classList.remove('border-red-500', 'bg-red-50', 'dark:border-red-500', 'dark:bg-red-900/20', 'ring-1', 'ring-red-500');
  input.parentElement?.querySelectorAll('.marathon-field-error').forEach(el => el.remove());
}

function wrapMarathonField(input, labelText) {
  if (!input || input.dataset.labelWrapped === 'true') return;

  const wrapper = document.createElement('div');
  wrapper.className = 'min-w-0';

  const label = document.createElement('label');
  label.className = 'block text-[11px] text-gray-500 dark:text-gray-400 mb-1';
  label.textContent = labelText;

  input.parentNode.insertBefore(wrapper, input);
  wrapper.appendChild(label);
  wrapper.appendChild(input);
  input.classList.add('w-full');
  input.dataset.labelWrapped = 'true';
}

function enhanceMarathonSettingsFields(container) {
  const labels = {
    distanceA: 'Distans (m)',
    tempoA: 'Tempo (m/min)',
    windowA: 'Tidsfönster (min)',
    distanceB: 'Distans (m)',
    tempoB: 'Tempo (m/min)',
    windowB: 'Tidsfönster (min)'
  };

  Object.entries(labels).forEach(([field, label]) => {
    container.querySelectorAll(`[data-field="${field}"]`).forEach(input => {
      wrapMarathonField(input, label);
      if (field === 'windowA') {
        input.title = 'Tillåten marginal runt idealtiden i minuter. Standard: 2 för A.';
        input.placeholder = 'min';
      }
      if (field === 'windowB') {
        input.title = 'Tillåten marginal runt idealtiden i minuter. Standard: 3 för B.';
        input.placeholder = 'min';
      }
    });
  });

  container.querySelectorAll('[data-field="distanceT"]').forEach(distanceInput => {
    const className = distanceInput.dataset.className;
    if (!className || distanceInput.dataset.transportToggleAdded === 'true') return;

    const tempoInput = container.querySelector(`[data-field="tempoT"][data-class-name="${CSS.escape(className)}"]`);
    const transportSection = distanceInput.closest('.grid')?.parentElement;
    if (!transportSection) return;

    const hasSavedTransport = distanceInput.dataset.includeTransport === 'true'
      || Number(distanceInput.value) > 0
      || Number(tempoInput?.value) > 0;
    const checkbox = document.createElement('label');
    checkbox.className = 'mb-2 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300';
    checkbox.innerHTML = `
      <input type="checkbox" class="marathon-class-input include-transport-check rounded border-gray-300 text-brand-darkblue dark:bg-gray-700 dark:border-gray-600"
             data-class-name="${escapeAttr(className)}" data-field="includeTransport" ${hasSavedTransport ? 'checked' : ''}>
      <span>Denna klass har transportsträcka</span>
    `;

    const title = transportSection.querySelector('p');
    title?.insertAdjacentElement('afterend', checkbox);
    distanceInput.dataset.transportToggleAdded = 'true';

    const toggleFields = () => {
      const enabled = checkbox.querySelector('input')?.checked === true;
      [distanceInput, tempoInput].forEach(input => {
        if (!input) return;
        input.disabled = !enabled;
        input.classList.toggle('opacity-50', !enabled);
        input.classList.toggle('cursor-not-allowed', !enabled);
      });
      if (!enabled) {
        clearMarathonFieldError(distanceInput);
        if (tempoInput) clearMarathonFieldError(tempoInput);
      }
    };

    checkbox.querySelector('input')?.addEventListener('change', toggleFields);
    toggleFields();
  });
}

function clearMarathonValidationDom(container) {
  container.querySelectorAll('.marathon-validation-summary').forEach(el => el.remove());
  container.querySelectorAll('.marathon-field-error').forEach(el => el.remove());
  container.querySelectorAll('.marathon-class-input').forEach(input => {
    input.classList.remove('border-red-500', 'bg-red-50', 'dark:border-red-500', 'dark:bg-red-900/20', 'ring-1', 'ring-red-500');
  });
}

function applyMarathonValidationDom(container, validationErrors) {
  clearMarathonValidationDom(container);

  for (const [className, errors] of Object.entries(validationErrors || {})) {
    const firstInput = container.querySelector(`.marathon-class-input[data-class-name="${CSS.escape(className)}"]`);
    const card = firstInput?.closest('.border.rounded-lg');
    if (card && errors.length) {
      const title = card.querySelector('h4');
      const summary = document.createElement('div');
      summary.className = 'marathon-validation-summary rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-700 dark:bg-red-900/25 dark:text-red-200';
      summary.innerHTML = `
        <div class="font-semibold">Kontrollera denna klass innan du sparar:</div>
        <ul class="mt-1 list-disc pl-5 space-y-0.5">${errors.map(error => `<li>${error.message}</li>`).join('')}</ul>
      `;
      title?.insertAdjacentElement('afterend', summary);
    }

    errors.forEach((error) => {
      const input = container.querySelector(`.marathon-class-input[data-class-name="${CSS.escape(className)}"][data-field="${CSS.escape(error.field)}"]`);
      if (!input) return;
      input.classList.add('border-red-500', 'bg-red-50', 'dark:border-red-500', 'dark:bg-red-900/20', 'ring-1', 'ring-red-500');

      const wrapper = input.parentElement;
      const errorEl = document.createElement('div');
      errorEl.className = 'marathon-field-error mt-1 text-[11px] font-medium text-red-600 dark:text-red-300';
      errorEl.textContent = error.message;
      wrapper?.appendChild(errorEl);
    });
  }
}


async function setupMarathonSettings() {
  if (!pageRoot) return;
  const container = pageRoot.querySelector('#marathon-distances-container');
  const form = pageRoot.querySelector('#marathon-settings-form');
  if (!container || !form) return;

  // Läs svensknyckeln
  let existingConfig = await getConfig(competitionId, 'maratonConfig') || {};

  // Per-class marathon settings must stay on the original class, even if
  // classes are merged for competition display/results.
  const classNames = Array.from(new Set((allEquipages || [])
    .map(e => e?.className?.trim())
    .filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, 'sv'));

  const classCatMap = buildDominantTRCategoryByClass(allEquipages);

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
      return trTempoMminForWithCat(data.trTemplate || cn, section, catKey);
    };

    const tempoA = Number.isFinite(data.tempoA) ? data.tempoA : null;
    const tempoB = Number.isFinite(data.tempoB) ? data.tempoB : null;

    // Use specific cast to Number for distance to fix "missing ideal time" bug
    const distA = Number(data.distanceA) || 0;
    const distB = Number(data.distanceB) || 0;

    // == Fix: Auto-detect Children/Barnklass and default Fixed Time A to 10 if unset ==
    // Check key from template OR class name
    const effectiveKey = data.trTemplate || normalizeClassKey(cn);
    let defaultFixedA = data.fixedTimeA;
    // Check for "Barnklass" (specific) OR "CAI Children"
    if ((effectiveKey === 'Barnklass' || effectiveKey === 'CAI Children') && (defaultFixedA === undefined || defaultFixedA === null || defaultFixedA === '')) {
      defaultFixedA = 10;
      // Optimization: We could also set it in data object immediately so it saves, 
      // but putting it in the input value is enough for the user to see and save.
    }

    const finalTempoA = getEffectiveTempo('A', tempoA);
    const finalTempoB = getEffectiveTempo('B', tempoB);

    const aIdeal = fmtIdealTime(distA, finalTempoA);
    const bIdeal = fmtIdealTime(distB, finalTempoB);

    // Ny, grupperad layout per klass
    html += `
      <div class="border rounded-lg p-4 space-y-4 mb-4 bg-gray-50 dark:bg-gray-700/50 dark:border-gray-700">
        <h4 class="font-semibold text-lg text-gray-800 dark:text-white">${cn}</h4>
        ${renderClassValidationSummary(cn)}
        
        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 border-b dark:border-gray-600 pb-4">
          <div>
            <p class="font-medium text-gray-700 dark:text-gray-300 mb-2">Etapp A / Warm Up</p>
            <div class="grid grid-cols-4 gap-2 items-center">
              <input type="number" data-class-name="${cn}" data-field="distanceA" class="marathon-class-input p-2 border rounded-md text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" value="${data.distanceA ?? ''}" placeholder="Distans (m)">
              <input type="number" data-class-name="${cn}" data-field="tempoA" class="marathon-class-input p-2 border rounded-md text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" value="${data.tempoA ?? ''}" placeholder="${finalTempoA ? `TR: ${Math.round(finalTempoA)}` : 'Tempo'}">
              <input type="number" data-class-name="${cn}" data-field="windowA" class="marathon-class-input p-2 border rounded-md text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" value="${data.windowA ?? '2'}" placeholder="Fönster (min)">
              <div class="text-center min-w-[60px]"><span class="block font-semibold text-gray-800 dark:text-gray-200" data-ideal-for="${cn}|A">${aIdeal}</span> <span class="text-[10px] text-gray-400 uppercase tracking-wider">Idealtid</span></div>
            </div>
             <!-- NYTT: Fixed Time Input -->
            <div class="mt-2 flex items-center gap-2">
                 <label class="text-xs text-blue-800 font-semibold dark:text-blue-300">Fast tid (WU):</label>
                 <input type="number" data-class-name="${cn}" data-field="fixedTimeA" class="marathon-class-input w-20 p-1 border border-blue-200 rounded text-sm bg-blue-50 dark:bg-blue-900/40 dark:border-blue-700 dark:text-white" value="${defaultFixedA ?? ''}" placeholder="min">
                 <span class="text-[10px] text-gray-400"> (åsidosätter distans/tempo)</span>
            </div>
            <div class="text-xs text-gray-400 mt-1 pl-1">TR-tempo: ${trTempoMminForWithCat(data.trTemplate || cn, 'A', catKey) ? Math.round(trTempoMminForWithCat(data.trTemplate || cn, 'A', catKey)) : '—'} m/min</div>
          </div>
          <div>
            <p class="font-medium text-gray-700 dark:text-gray-300 mb-2">Etapp B</p>
            <div class="grid grid-cols-4 gap-2 items-center">
              <input type="number" data-class-name="${cn}" data-field="distanceB" class="marathon-class-input p-2 border rounded-md text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" value="${data.distanceB ?? ''}" placeholder="Distans (m)">
              <input type="number" data-class-name="${cn}" data-field="tempoB" class="marathon-class-input p-2 border rounded-md text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" value="${data.tempoB ?? ''}" placeholder="${finalTempoB ? `TR: ${Math.round(finalTempoB)}` : 'Tempo'}">
              <input type="number" data-class-name="${cn}" data-field="windowB" class="marathon-class-input p-2 border rounded-md text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" value="${data.windowB ?? '3'}" placeholder="Fönster (min)">
              <div class="text-center min-w-[60px]"><span class="block font-semibold text-gray-800 dark:text-gray-200" data-ideal-for="${cn}|B">${bIdeal}</span> <span class="text-[10px] text-gray-400 uppercase tracking-wider">Idealtid</span></div>
            </div>
            <div class="text-xs text-gray-400 mt-1 pl-1">TR-tempo: ${trTempoMminForWithCat(data.trTemplate || cn, 'B', catKey) ? Math.round(trTempoMminForWithCat(data.trTemplate || cn, 'B', catKey)) : '—'} m/min</div>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <p class="font-medium text-gray-700 dark:text-gray-300 mb-2">Transport</p>
            <div class="grid grid-cols-2 gap-2">
              <input type="number" data-class-name="${cn}" data-field="distanceT" data-include-transport="${data.includeTransport === true ? 'true' : 'false'}" class="marathon-class-input p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" value="${data.distanceT ?? ''}" placeholder="Distans (m)">
              <input type="number" data-class-name="${cn}" data-field="tempoT" class="marathon-class-input p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" value="${data.tempoT ?? ''}" placeholder="Tempo (m/min)">
            </div>
          </div>
           <div>
             <div class="grid grid-cols-2 gap-2">
               <div>
                  <p class="font-medium text-gray-700 dark:text-gray-300 mb-2">Portar</p>
                  <input type="number" data-class-name="${cn}" data-field="gateCount" class="marathon-class-input w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" value="${data.gateCount ?? '6'}" placeholder="Antal portar">
               </div>
               <div>
                  <p class="font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm" title="Om tomt används globalt värde">Hinderstraff/sek</p>
                  <input type="number" step="0.01" data-class-name="${cn}" data-field="obstaclePenaltyRate" class="marathon-class-input w-full p-2 border rounded-md text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" value="${data.obstaclePenaltyRate ?? ''}" placeholder="Globalt">
               </div>
             </div>
             <div class="mt-4">
                <p class="font-medium text-gray-700 dark:text-gray-300 mb-1">Körda Hinder <span class="text-xs font-normal text-gray-500">(1,2,3..)</span></p>
                <input type="text" data-class-name="${cn}" data-field="drivenObstacles" class="marathon-class-input w-full p-2 border rounded-md text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" value="${data.drivenObstacles ?? ''}" placeholder="t.ex. 1, 2, 4, 5 (lämna tomt för alla)">
             </div>
          </div>
        </div>

        <!-- TR Template Selector -->
        <div class="mt-4 pt-4 border-t dark:border-gray-600">
            <div class="flex items-center gap-4">
                <div>
                     <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tempo-mall (TR-nivå)</label>
                     <select data-class-name="${cn}" data-field="trTemplate" class="marathon-class-input p-2 border rounded-md text-sm w-64 dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                        <option value="">(Använd klassnamn: "${cn}")</option>
                        <option value="Lätt B" ${data.trTemplate === 'Lätt B' ? 'selected' : ''}>Lätt B (Grundtempo)</option>
                        <option value="Lätt B Para" ${data.trTemplate === 'Lätt B Para' ? 'selected' : ''}>Lätt B Para</option>
                        <option value="Lätt A" ${data.trTemplate === 'Lätt A' ? 'selected' : ''}>Lätt A</option>
                        <option value="Lätt A Para" ${data.trTemplate === 'Lätt A Para' ? 'selected' : ''}>Lätt A Para</option>
                        <option value="Msv" ${data.trTemplate === 'Msv' ? 'selected' : ''}>Medelsvår</option>
                        <option value="Msv Para" ${data.trTemplate === 'Msv Para' ? 'selected' : ''}>Medelsvår Para</option>
                        <option value="Svår" ${data.trTemplate === 'Svår' ? 'selected' : ''}>Svår</option>
                        <option value="Svår Para" ${data.trTemplate === 'Svår Para' ? 'selected' : ''}>Svår Para</option>
                        <option value="CAI1*" ${data.trTemplate === 'CAI1*' ? 'selected' : ''}>CAI 1*</option>
                        <option value="CAI2*" ${data.trTemplate === 'CAI2*' ? 'selected' : ''}>CAI 2*</option>
                        <option value="CAI3*" ${data.trTemplate === 'CAI3*' ? 'selected' : ''}>CAI 3*</option>
                        <option value="Barnklass" ${data.trTemplate === 'Barnklass' ? 'selected' : ''}>Barnklass</option>
                        <option value="CAI Children" ${data.trTemplate === 'CAI Children' ? 'selected' : ''}>CAI Children</option>
                        <option value="CAI Junior" ${data.trTemplate === 'CAI Junior' ? 'selected' : ''}>CAI Junior</option>
                        <option value="CAI U25" ${data.trTemplate === 'CAI U25' ? 'selected' : ''}>CAI U25</option>
                     </select>
                     <p class="text-xs text-gray-500 mt-1 dark:text-gray-400">Välj för att tvinga fram specifika TR-regler för denna klass (bra för "Sammanslagen").</p>
                </div>
            </div>
        </div>

      </div>
    `;
  });
  container.innerHTML = html;
  enhanceMarathonSettingsFields(container);

  // Spara-logiken och realtids-uppdateringen är oförändrade och korrekta
  form.onsubmit = async (e) => {
    e.preventDefault();
    const newClassData = {};
    container.querySelectorAll('.marathon-class-input').forEach(input => {
      const cls = input.dataset.className, field = input.dataset.field;
      if (!cls || !field) return;
      if (!newClassData[cls]) newClassData[cls] = {};

      // Specialhantering för sträng-fält (som trTemplate och drivenObstacles)
      if (field === 'includeTransport') {
        newClassData[cls][field] = input.checked === true;
      } else if (field === 'trTemplate') {
        newClassData[cls][field] = input.value || null;
      } else if (field === 'drivenObstacles') {
        const str = (input.value || '').trim();
        newClassData[cls][field] = str ? str : null;
      } else {
        const val = parseFloat(input.value);
        newClassData[cls][field] = Number.isFinite(val) ? val : null;
      }
    });

    Object.values(newClassData).forEach(row => {
      if (row.includeTransport !== true) {
        row.distanceT = null;
        row.tempoT = null;
      }
    });

    marathonValidationErrors = validateMarathonAdminSettings(newClassData, (className, row) => {
      const catKey = classCatMap.get(className) || 'horse';
      const manualTempoA = Number(row.tempoA);
      const manualTempoB = Number(row.tempoB);

      return {
        hasTempoA: (Number.isFinite(manualTempoA) && manualTempoA > 0)
          || !!trTempoMminForWithCat(row.trTemplate || className, 'A', catKey),
        hasTempoB: (Number.isFinite(manualTempoB) && manualTempoB > 0)
          || !!trTempoMminForWithCat(row.trTemplate || className, 'B', catKey)
      };
    });

    if (hasMarathonValidationErrors(marathonValidationErrors)) {
      applyMarathonValidationDom(container, marathonValidationErrors);
      const firstError = container.querySelector('.ring-red-500') || container.querySelector('.marathon-validation-summary');
      firstError?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      showAlert('Maratoninställningarna saknar obligatoriska fält. Kontrollera röda markeringar.', false);
      return;
    }

    const pauseVal = parseInt(pageRoot.querySelector('#pauseTime')?.value) || 10;
    const oldCfg = await getConfig(competitionId, 'maratonConfig') || {};

    // --- Bygg normaliserat marathonClassDistances parallellt från admin-formatet ---
    const marathonClassDistances = {};
    for (const [className, row] of Object.entries(newClassData)) {
      const A = Math.max(0, Number(row.distanceA) || 0);
      const T = row.includeTransport === true ? Math.max(0, Number(row.distanceT) || 0) : 0;
      const B = Math.max(0, Number(row.distanceB) || 0);
      const tempoT = row.includeTransport === true && Number.isFinite(row.tempoT) ? Number(row.tempoT) : null;
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
  };

  container.oninput = (e) => {
    if (!(e.target instanceof HTMLInputElement)) return;
    clearMarathonFieldError(e.target);
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
    const fixedTimeA = q('fixedTimeA'); // Nytt

    const effTempoA = (Number.isFinite(manualTempoA) && manualTempoA > 0)
      ? manualTempoA
      : trTempoMminForWithCat(cls, 'A', catKey);

    const effTempoB = (Number.isFinite(manualTempoB) && manualTempoB > 0)
      ? manualTempoB
      : trTempoMminForWithCat(cls, 'B', catKey);

    // Cast distance to Number explicitly for safety
    const distA = Number(q('distanceA')) || 0;
    const distB = Number(q('distanceB')) || 0;

    // === Update Ideal Time Display ===
    let idealA = fmtIdealTime(distA, effTempoA);
    // Override display if Fixed Time is set
    if (fixedTimeA > 0) {
      const sec = Math.round(fixedTimeA * 60);
      const mm = Math.floor(sec / 60);
      const ss = sec % 60;
      idealA = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    }

    const idealB = fmtIdealTime(distB, effTempoB);

    container.querySelector(`[data-ideal-for="${cls}|A"]`).textContent = idealA;
    container.querySelector(`[data-ideal-for="${cls}|B"]`).textContent = idealB;
  };

  // NYTT: Specifik lyssnare för TR Template-ändringar för att auto-fylla defaults (t.ex. Fixed Time för Children)
  container.onchange = (e) => {
    if (!(e.target instanceof HTMLSelectElement)) return;
    const t = e.target;
    if (t.dataset.field !== 'trTemplate') return;

    const cls = t.dataset.className;
    const val = t.value;
    if (!cls || !val) return;

    // Om man väljer "CAI Children" eller "Barnklass", och Fixed Time är tomt, sätt till 10 min.
    if (val === 'CAI Children' || val === 'Barnklass') {
      const fixedInput = container.querySelector(`input[data-class-name="${cls}"][data-field="fixedTimeA"]`);
      if (fixedInput && !fixedInput.value) {
        fixedInput.value = 10;
        // Trigger input event to update ideals?
        fixedInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  };
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
      <div class="flex items-center justify-between p-2 rounded border bg-gray-50 dark:bg-gray-700/50 dark:border-gray-700">
        <div class="text-sm dark:text-gray-300">
          <span class="font-semibold text-gray-900 dark:text-white">#${o.number}</span>
          <span class="ml-2">${o.name || ''}</span>
          <span class="ml-2 text-gray-500 dark:text-gray-400">${kd} ${gates}</span>
        </div>
        <div class="flex items-center gap-2">
          <button type="button" data-action="edit-obstacle" data-number="${o.number}" class="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700">Redigera</button>
          <button type="button" data-action="delete-obstacle" data-number="${o.number}" class="px-2 py-1 text-xs rounded border bg-white text-red-600 hover:bg-red-50 dark:bg-gray-800 dark:border-gray-600 dark:text-red-400 dark:hover:bg-red-900/20">Ta bort</button>
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
    pageRoot.innerHTML = '<div class="p-8 text-center text-gray-500 dark:text-gray-400">Välj en tävling i hubben först.</div>';
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

  injectPickerStyles();
}

export function __unload() {
  if (unsubscribeEquipages) unsubscribeEquipages();
  if (unsubscribeObstacles) unsubscribeObstacles();
  if (pickerMap) {
    pickerMap.remove();
    pickerMap = null;
  }
}

function injectPickerStyles() {
  if (document.getElementById('picker-styles')) return;
  const style = document.createElement('style');
  style.id = 'picker-styles';
  style.innerHTML = `
    .picker-tooltip {
      background: rgba(0,0,0,0.7);
      color: white;
      border: none;
      font-size: 9px;
      font-weight: bold;
      padding: 0px 4px;
      border-radius: 4px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    }
    .picker-tooltip::before {
      border-top-color: rgba(0,0,0,0.7) !important;
    }
  `;
  document.head.appendChild(style);
}
