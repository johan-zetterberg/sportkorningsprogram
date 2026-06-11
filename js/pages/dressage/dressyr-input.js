import { getGlobalState } from '../../main.js';
import { getCurrentUserRole } from '../../services/authService.js';
import { getEquipages } from '../../services/equipageService.js';
import { getConfig } from '../../services/competitionService.js';
import { saveConfig } from '../../services/competitionService.js';
import { saveDressageJudgeProtocol, saveDressageGeneralData, setDressageStatus, getDressageStatusCollection } from '../../services/dressageService.js';
import { listenForJudges } from '../../services/adminService.js';
import { getDressageResultsForEquipage, listenForDressageStatusCollection } from '../../services/dressageService.js';

// NYTT: Importera det vi behöver från Firebase för att prata direkt med databasen
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from '../../config/firebase-config.js';

import { getPrograms, getDressagePenaltyCoeff, guessProgramKeyFromClass } from '../../utils/dressageUtils.js';
import { calculateSingleJudgeDressageResult } from '../../services/calculationService.js';
import { klassProgramMapping } from '../../data/competitionData.js';
import { formatDressageProgramOptionLabel, getDressageProgramTrNumber, sortDressageProgramKeys } from './dressageAdminProgramOptions.js';
import { getCompetitionHeader, renderCompetitionModeBanner, createSearchableDropdown, showAlert } from '../../ui/components.js';
import { t } from '../../utils/i18n.js';

import { downloadJson } from '../../utils/sharedUtils.js';
import { requestWakeLock } from '../../utils/wakeLock.js';

let competitionId = null;
let currentDressageTest = null;
let activeDressageJudge = null;
let sortedEquipages = [];
let equipageSearchDropdown = null;
let allJudges = [];
let liveUpdateTimer = null; // Timer för att undvika för många anrop
let manualTestOverride = false;   // användaren har valt program manuellt
let programmaticChange = false;   // vi byter värde i koden (ska inte sätta override)
let lastStartNumber = null;

function isFieldModeEnabled() {
  return getGlobalState('currentCompetition')?.competitionMode === 'field';
}

// ---- Program helpers ----
function programKeyExists(key) {
  const all = getPrograms();
  return !!(key && all && all[key]);
}

// Översätt äldre kortnycklar (SvLB, SvLA, SvMsvB, SvMsv4) → nyckel i dina importerade program
function resolveLegacyProgramKey(legacyKey) {
  if (!legacyKey) return null;
  const all = getPrograms();
  const entries = Object.entries(all);
  const map = {
    'svlb': [/l[äa]tt/i, /\bB\b/i],
    'svla': [/l[äa]tt/i, /\bA\b/i],
    'svmsvb': [/msv/i, /(3|iii)/i],          // “MSV 3 / Msv B (äldre benämning)”
    'svmsv4': [/msv|medelsv/i, /(4|iv)/i]    // ← Viktigt: tillåt både “MSV 4” och “Medelsvårt 4”
  };
  const hints = map[String(legacyKey).toLowerCase()];
  if (!hints) return null;

  let best = null, scoreBest = -1;
  for (const [key, p] of entries) {
    const name = String(p?.name || key);
    let s = 0;
    for (const rx of hints) if (rx.test(name)) s++;
    if (/Svenskt/i.test(p?.category || '')) s += 0.5; // prioritera svenska program
    if (/FEI/i.test(p?.category || '')) s -= 0.25;
    if (s > scoreBest) { scoreBest = s; best = key; }
  }
  return scoreBest > 0 ? best : null;
}

// ---- Heuristik flyttad till dressageUtils.js ----

// Mirror data to localStorage for redundancy
function mirrorToLocal(sn, data) {
  if (!sn || !data || !competitionId) return;
  try {
    const key = `bkp_${competitionId}_dre_${sn}`;
    localStorage.setItem(key, JSON.stringify({
      ts: Date.now(),
      data
    }));
  } catch (e) {
    console.warn('Could not mirror to localStorage', e);
  }
}

// 1) Hjälpfunktioner för debounce & retry
function __debounce(fn, wait = 200) {
  let t = null;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}


async function __withRetry(asyncFn, { tries = 3, baseDelay = 250 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await asyncFn(); } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, baseDelay * (i + 1)));
    }
  }
  throw lastErr;
}

// Visar en mjuk varning högst upp (återanvänder alert/baner om du har)
function softWarnUnknownProgram(className, key) {
  try {
    const banner = document.getElementById('programAuditBanner');
    if (!banner) return;
    const msg = `Mapping för klassen "${className}" pekar på okänt program "${key}". Välj program manuellt.`;
    const box = document.createElement('div');
    box.className = 'my-2 p-3 rounded-md bg-yellow-50 text-yellow-800 border border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-200 dark:border-yellow-700';
    box.textContent = msg;
    // Ta bort tidigare engångsvarningar för tydlighet
    [...banner.querySelectorAll('.unknown-prog-warn')].forEach(n => n.remove());
    box.classList.add('unknown-prog-warn');
    banner.appendChild(box);
  } catch { }
}

function findProgramKeyForClass(classOrEquipage) {
  const equipage = classOrEquipage && typeof classOrEquipage === 'object' ? classOrEquipage : null;
  const className = equipage ? equipage.className : classOrEquipage;
  if (!className && !equipage) return null;

  const allProgs = getPrograms(); // alltid säker källa
  const map = (typeof window !== 'undefined' && window.klassProgramMapping)
    ? window.klassProgramMapping
    : (typeof klassProgramMapping !== 'undefined' ? klassProgramMapping : {});
  const clean = String(className).trim().toLowerCase();

  const programKeyExistsSafe = (k) => !!(k && allProgs && allProgs[k]);
  const isVerified = (k) => !!(allProgs[k] && allProgs[k].verified);
  const isNonParaClass = !/para/i.test(clean);

  const isParaish = (key) => {
    const p = allProgs[key];
    const name = String(p?.name || key);
    const cat = String(p?.category || '');
    return /para/i.test(name) || /para/i.test(cat) || /^fei/i.test(key) || /fei/i.test(name) || /fei/i.test(cat);
  };

  if (equipage) {
    const explicitKey = equipage.testKey || equipage.programKey || equipage.testId || null;
    if (programKeyExistsSafe(explicitKey) && !(isNonParaClass && isParaish(explicitKey))) return explicitKey;
    const explicitLegacy = resolveLegacyProgramKey(explicitKey);
    if (programKeyExistsSafe(explicitLegacy) && !(isNonParaClass && isParaish(explicitLegacy))) return explicitLegacy;
  }

  // 1) Exakt mappning (case-sensitiv & case-insensitiv)
  const directKey =
    map[className] ??
    (() => {
      const hit = Object.keys(map).find(k => k.trim().toLowerCase() === clean);
      return hit ? map[hit] : null;
    })();

  if (directKey) {
    // tillåt inte FEI/Para om klassen inte är para
    if (programKeyExistsSafe(directKey) && !(isNonParaClass && isParaish(directKey))) return directKey;
    const legacy = resolveLegacyProgramKey(directKey);
    if (programKeyExistsSafe(legacy) && !(isNonParaClass && isParaish(legacy))) return legacy;
  }

  // 2) “Innehåller”-match i mapping (case-insensitiv)
  for (const mk in map) {
    const keyLC = mk.trim().toLowerCase();
    if (keyLC && clean.includes(keyLC)) {
      const mapped = map[mk];
      if (programKeyExistsSafe(mapped) && !(isNonParaClass && isParaish(mapped))) return mapped;
      const legacy = resolveLegacyProgramKey(mapped);
      if (programKeyExistsSafe(legacy) && !(isNonParaClass && isParaish(legacy))) return legacy;
    }
  }

  // 3) Fuzzy-gissning från klassnamn
  const guess = guessProgramKeyFromClass(className);
  if (programKeyExistsSafe(guess)) return guess;

  // 4) Sista chansen: prioritera verifierad kandidat bland de vi testat
  const candidates = [directKey, resolveLegacyProgramKey(directKey), guess].filter(Boolean);
  const verifiedFirst = candidates.find(isVerified);
  return programKeyExistsSafe(verifiedFirst) ? verifiedFirst : null;
}


function getProgramMeta(key) {
  const p = getPrograms()[key] || null;
  const maxScore = p?.movements?.reduce((sum, movement) => sum + 10 * (Number(movement.coeff) || 1), 0) || 0;
  return p ? {
    key,
    name: p.name || key,
    version: p.version || '',
    source: p.source || '',
    category: p.category || '',
    arena: p.arena || '',
    trNumber: getDressageProgramTrNumber(p),
    maxScore,
    verified: !!p.verified
  } : null;
}

function handleSelectionChange() {
  const testSelector = document.getElementById('testSelector');
  const judgeSelector = document.getElementById('judgeSelector');
  const startNumber = equipageSearchDropdown.getValue();
  const judgeId = judgeSelector.value;

  if (startNumber !== lastStartNumber) {
    manualTestOverride = false;
    lastStartNumber = startNumber;
  }

  // Auto-välj program när E-K-I-P-A-G-E väljs
  if (startNumber) {
    const equipage = sortedEquipages.find(e => String(e.startNumber) === String(startNumber));
    const mapped = equipage ? findProgramKeyForClass(equipage) : null;

    if (mapped && !manualTestOverride && (testSelector.value !== mapped || !currentDressageTest)) {
      programmaticChange = true;
      testSelector.value = mapped;
      renderProtocol(mapped);
      programmaticChange = false;
    } else if (!mapped && equipage) {
      // mjuk varning – mapping saknas
      softWarnUnknownProgram(equipage.className, '(saknas)');
    }

    // NYTT: Auto-välj domare om ingen är vald, baserat på mapping
    if (equipage && !judgeId && window.dressageJudgeMapping) {
      const assigned = window.dressageJudgeMapping[equipage.className];
      if (assigned) {
        // assigned = { C: 'id', E: 'id' }
        // Om bara en, välj den. Annars prioritera C.
        const keys = Object.keys(assigned);
        if (keys.length === 1) {
          judgeSelector.value = assigned[keys[0]];
          activeDressageJudge = allJudges.find(j => j.id === assigned[keys[0]]) || null;
        } else if (assigned['C']) {
          judgeSelector.value = assigned['C'];
          activeDressageJudge = allJudges.find(j => j.id === assigned['C']) || null;
        }
      }
    }
  }

  // FIX: Läs om judgeId eftersom den kan ha satts automatiskt ovan
  const finalJudgeId = judgeSelector.value;

  // Ladda ev. sparat protokoll endast för data — ändra inte program här
  if (startNumber && finalJudgeId) {
    loadExistingProtocol(startNumber, finalJudgeId, { allowTestChange: false });
  } else {
    calculateTotals();
  }
}

// --- Global dressyr-straffkoefficient (programnivå) ---
async function loadExistingProtocol(startNumber, judgeId, opts = {}) {
  const allowTestChange = opts.allowTestChange !== false; // default = true
  clearForm();
  if (!startNumber || !judgeId || !competitionId) return;

  try {
    const raw = await getDressageResultsForEquipage(competitionId, startNumber);
    const results = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    const jid = String(judgeId);
    const protocolData =
      results.find(r => r.id === `judge_${jid}`) ||
      results.find(r => r.id === jid);

    const generalData = results.find(r => r.id === "general");
    if (generalData) {
      document.getElementById('errorPointsInput').value = generalData.errorPoints ?? 0;
      document.getElementById('errorCommentInput').value = generalData.errorComment ?? '';
    }

    if (protocolData) {
      const testKey = protocolData.testKey || protocolData.programKey || protocolData.testId;
      if (!testKey) {
        showAlert(t('alert_protocol_missing_key'), false);
        return;
      }
      programmaticChange = true;
      const testSelector = document.getElementById('testSelector');
      // FIX: Lägg till check för !currentDressageTest eller om det laddade programmet inte matchar det som är renderat
      const needsRender = !currentDressageTest || (currentDressageTest.key !== testKey && currentDressageTest.name !== testKey);

      if (allowTestChange && testKey && testSelector && (testSelector.value !== testKey || needsRender) && !manualTestOverride) {
        testSelector.value = testKey;
        renderProtocol(testKey);
        manualTestOverride = true;     // lås valet så det inte skrivs över
      } else if (needsRender && testSelector.value === testKey) {
        // Specialfall: Värdet är rätt men vi har inte renderat än (t.ex. första laddningen)
        renderProtocol(testKey);
      } else {
        if (typeof updateProgramMeta === 'function') {
          updateProgramMeta((testSelector && testSelector.value) || testKey);
        }
      }
      programmaticChange = false;

      // FIX: Om vi INTE fick byta program (allowTestChange=false), men det sparade programmet (testKey)
      // skiljer sig från det som faktiskt visas i dropdownen (testSelector.value), då ska vi INTE
      // försöka fylla i siffrorna. Det blir bara fel (Issue 2).
      const currentSelectorValue = document.getElementById('testSelector')?.value;
      if (!allowTestChange && currentSelectorValue && testKey !== currentSelectorValue) {
        // Avbryt populering för att undvika att "Lätt A"-siffror hamnar i "Svår B"-protokollet
        console.warn(`Saved protocol is for ${testKey} but view is ${currentSelectorValue}. Skipping population.`);
        calculateTotals();
        return;
      }

      document.getElementById('dressageEliminated').checked = !!protocolData.eliminated;
      const movements = Array.isArray(protocolData.movements) ? protocolData.movements : [];
      const cards = document.querySelectorAll('#protocolBody .movement-card');
      cards.forEach((card, index) => {
        const programMovementNo = (getPrograms()[testSelector.value]?.movements?.[index]?.no); // Använd selector value för säkerhets skull
        const md = movements.find(m => m.momentNo === programMovementNo)
          || movements.find(m => m.movementNo === programMovementNo)
          || movements[index];
        if (md) {
          const scoreEl = card.querySelector('.score-input');
          const commentEl = card.querySelector('.comment-input');
          if (scoreEl) scoreEl.value = (typeof md.score === 'number' ? md.score : Number(md.score || 0));
          if (commentEl) commentEl.value = md.comment || '';
        }
      });
    } else {
      const equipage = sortedEquipages.find(e => String(e.startNumber) === String(startNumber));
      // FIX: Använder den nya, smartare sökfunktionen även här
      const classKey = equipage ? findProgramKeyForClass(equipage) : null;
      const testSelector = document.getElementById('testSelector');
      // FIX: Tvinga render om inget är renderat än
      if (classKey && testSelector && !manualTestOverride && (testSelector.value !== classKey || !currentDressageTest)) {
        programmaticChange = true;
        testSelector.value = classKey;
        renderProtocol(classKey);
        programmaticChange = false;
      }
      if (protocolData) {
        mirrorToLocal(startNumber, { protocol: protocolData, general: generalData });
      }
    }
    calculateTotals();
  } catch (error) {
    console.error("Kunde inte ladda befintligt protokoll:", error);
    showAlert(t('alert_protocol_load_error'), false);
  }
}

function populateSelectors() {
  const testSelector = document.getElementById('testSelector');
  const judgeSelector = document.getElementById('judgeSelector');
  if (!testSelector || !judgeSelector) return;

  const src = getPrograms();
  testSelector.innerHTML = '';
  const categories = {};
  sortDressageProgramKeys(src).forEach(key => {
    const p = src[key] || {};
    const cat = p.category || 'Övrigt';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push({ key, name: formatDressageProgramOptionLabel(key, p) });
  });

  const preferred = ['Svenskt', 'FEI', 'Övrigt'];
  Object.keys(categories)
    .sort((a, b) => (preferred.indexOf(a) === -1 ? 99 : preferred.indexOf(a)) - (preferred.indexOf(b) === -1 ? 99 : preferred.indexOf(b)))
    .forEach(cat => {
      const group = document.createElement('optgroup');
      group.label = cat;
      categories[cat]
        .sort((a, b) => a.name.localeCompare(b.name, 'sv'))
        .forEach(p => {
          const opt = document.createElement('option');
          opt.value = p.key;
          opt.textContent = p.name;
          group.appendChild(opt);
        });
      testSelector.appendChild(group);
    });

  judgeSelector.innerHTML = `<option value="">${t('input_select_judge')}</option>`;
  const order = { C: 0, E: 1, B: 2, H: 3, M: 4 };

  const expandDressageRole = (j) => {
    if (Array.isArray(j.roles)) {
      const withPos = j.roles.find(r => r && r.discipline === 'dressage' && r.position);
      if (withPos) return String(withPos.position).toUpperCase();
      const anyDress = j.roles.find(r => r && r.discipline === 'dressage');
      if (anyDress && anyDress.position != null) return String(anyDress.position).toUpperCase();
    }
    if (j.position) return String(j.position).toUpperCase();
    if (j.disciplines && typeof j.disciplines.dressage === 'string') return String(j.disciplines.dressage).toUpperCase();
    return '';
  };

  // NYTT: Beräkna och spara positionen (_pos) på varje domarobjekt direkt.
  allJudges.forEach(j => {
    j._pos = (expandDressageRole(j) || '').toUpperCase();
  });

  const dressageJudges = allJudges
    .filter(j => j._pos !== '') // Filtrera bort de som inte är dressyrdomare
    .sort((a, b) => {
      const oa = order[a._pos] ?? 99;
      const ob = order[b._pos] ?? 99;
      if (oa !== ob) return oa - ob;
      return (a.name || '').localeCompare(b.name || '', 'sv');
    });

  dressageJudges.forEach(j => {
    const opt = document.createElement('option');
    opt.value = j.id;
    const posLabel = j._pos || '–';
    opt.textContent = `${posLabel} – ${j.name}${j.isOverJudge ? ' (ÖD)' : ''}`;
    judgeSelector.appendChild(opt);
  });
}

function clearForm() {
  document.querySelectorAll('.score-input, .comment-input').forEach(i => i.value = '');
  document.getElementById('dressageEliminated').checked = false;
  document.getElementById('errorPointsInput').value = 0;
  document.getElementById('errorCommentInput').value = '';
  calculateTotals();
}

function updateProgramMetaLegacy(key) {
  const host = document.getElementById('programMeta');
  if (!host) return;
  const meta = getProgramMeta(key);
  if (!meta) { host.innerHTML = ''; return; }
  const badge = `<span class="inline-block px-2 py-0.5 rounded ${meta.verified ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100'} mr-2">${meta.verified ? t('input_verified') : t('input_not_verified')}</span>`;
  const ver = meta.version ? ` • v${meta.version}` : '';
  const src = meta.source ? ` • ${meta.source}` : '';
  const coeff = getDressagePenaltyCoeff(key);
  const coeffLabel = /fei/i.test((getPrograms()[key]?.name || '') + ' ' + (getPrograms()[key]?.category || '')) ? 'Coefficient' : 'Koeff';
  host.innerHTML = `${badge}${meta.name}${ver}${src} • <span class="ml-1">${coeffLabel}: <strong>${coeff.toFixed(3)}</strong></span>`;
}

function updateProgramMeta(key) {
  const host = document.getElementById('programMeta');
  if (!host) return;
  const meta = getProgramMeta(key);
  if (!meta) { host.innerHTML = ''; return; }

  const badge = `<span class="inline-block px-2 py-0.5 rounded ${meta.verified ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100'} mr-2">${meta.verified ? t('input_verified') : t('input_not_verified')}</span>`;
  const coeff = getDressagePenaltyCoeff(key);
  const coeffLabel = /fei/i.test((getPrograms()[key]?.name || '') + ' ' + (getPrograms()[key]?.category || '')) ? 'Coefficient' : 'Koeff';
  const parts = [
    meta.trNumber ? `TR nr ${meta.trNumber}` : '',
    meta.version ? `v${meta.version}` : '',
    meta.arena || '',
    meta.maxScore ? `Maxpoäng: ${meta.maxScore}` : '',
    `${coeffLabel}: <strong>${coeff.toFixed(3)}</strong>`,
    `Nyckel: <code>${meta.key}</code>`,
    meta.source || ''
  ].filter(Boolean);

  host.innerHTML = `${badge}${meta.name} <span class="ml-1">${parts.join(' • ')}</span>`;
}

function renderProtocol(testKey) {
  currentDressageTest = getPrograms()[testKey];
  updateProgramMeta(testKey);
  const protocolBody = document.getElementById('protocolBody');
  if (!currentDressageTest || !protocolBody) {
    if (protocolBody) protocolBody.innerHTML = '';
    return;
  };
  protocolBody.innerHTML = '';
  currentDressageTest.movements.forEach((moment, index) => {
    const card = document.createElement('div');
    card.className = 'movement-card border rounded-lg p-2 bg-gray-50 dark:bg-gray-800 dark:border-gray-700';
    card.innerHTML = `
            <div class="flex justify-between items-center gap-2"> <div class="flex-shrink-0 font-medium">
                    <span class="font-bold dark:text-gray-200">${moment.no}.</span>
                    <span class="text-blue-800 text-sm ml-1 mr-2 dark:text-blue-300">${moment.letters || ''}</span>
                    ${moment.coeff > 1 ? `<span class="coeff-display bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full text-xs dark:bg-blue-900/40 dark:text-blue-100">x${moment.coeff}</span>` : ''}
                </div>
                
                <div class="flex-grow" style="max-width: 90px;"> <input type="tel" min="0" max="10" step="0.5" 
                           class="score-input w-full p-3 text-center text-2xl font-bold border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white" 
                           data-coeff="${moment.coeff}" 
                           data-moment-index="${index}"
                           pattern="[0-9.,]*" 
                           inputmode="decimal"
                           placeholder="-"
                           style="min-height: 50px;">
                </div>

                <div class_alias="flex-shrink-0 text-right" style="width: 50px;"> <span class="movement-score text-xl font-bold text-blue-700 dark:text-blue-400">0.0</span>
                </div>

                <div class="flex-shrink-0 flex flex-col sm:flex-row gap-1">
                    <button type="button" class="toggle-btn comment-toggle-btn" data-target="comment">💬</button>
                    <button type="button" class="toggle-btn" data-target="details">ℹ️</button>
                </div>
            </div>

            <div class="comment-wrapper">
                <textarea rows="1" placeholder="${t('input_add_comment')}" class="comment-input w-full p-2 text-sm border border-gray-300 rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white"></textarea>
            </div>
            <div class="movement-details text-sm text-gray-600 mt-2 border-l-2 border-gray-200 pl-2 dark:text-gray-400 dark:border-gray-700">
                <p class="font-medium dark:text-gray-300">${moment.text}</p>
                <p class="text-sm text-gray-500 mt-1 dark:text-gray-500">${moment.judge || ''}</p>
            </div>
        `;
    protocolBody.appendChild(card);
  });
  calculateTotals();
}

function calculateTotals() {
  if (!currentDressageTest) {
    document.getElementById('percentage').textContent = `0.00 %`;
    document.getElementById('penaltyPoints').textContent = `0.0`;
    document.getElementById('extraPenaltyDisplay').textContent = `0.0`;
    document.getElementById('totalPenaltyDisplay').textContent = `0.0`;
    document.getElementById('totalPointsDisplay').textContent = `0.0`;
    return;
  }

  // 1. Gather current inputs into a protocol-like object
  const movementsData = [];
  document.querySelectorAll('#protocolBody .movement-card').forEach((card, index) => {
    const input = card.querySelector('.score-input');
    const scoreVal = input.value.trim();
    const score = scoreVal !== '' ? parseFloat(scoreVal) : null;
    const coeff = parseFloat(input.dataset.coeff) || 1;

    // Update individual card display
    const cardScore = (score !== null ? score * coeff : 0).toFixed(1);
    card.querySelector('.movement-score').textContent = cardScore;

    movementsData.push({
      momentNo: currentDressageTest.movements[index].no,
      score: score
    });
  });

  const eliminated = document.getElementById('dressageEliminated').checked;
  const errorPointsInput = document.getElementById('errorPointsInput');
  const errorPoints = parseFloat(errorPointsInput ? errorPointsInput.value : 0) || 0;

  // 2. Use Calculation Service
  // Construct a temporary protocol object
  // Must provide a judgeId so deduplicateAndFilterProtocols doesn't filter it out if we were to check that.
  // Also provide testKey just in case.
  const tempProtocol = {
    judgeId: 'manual_input',
    testKey: currentDressageTest.id || currentDressageTest.key || 'unknown',
    movements: movementsData,
    eliminated: eliminated
  };

  // We need a dummy equipage with errorPoints for the full calculation, 
  // but calculateSingleJudgeDressageResult ignores global error points by default.
  // However, for the INPUT view, we want to show the specific judge's contribution + the global error points locally input.

  // DEBUG LOGGING

  const result = calculateSingleJudgeDressageResult(tempProtocol, currentDressageTest, { errorPoints: 0 });

  if (result) {
    const points = result.points || 0;

    // For Input View: We want the "Running Total" (Projected), not the absolute total.
    // calculateDressageResult returns projectedPercent/projectedPenalty which are based on the average of RIDDEN movements.
    const percent = result.projectedPercent != null ? result.projectedPercent : (result.percent || 0);
    const judgePenalty = result.projectedPenalty != null ? result.projectedPenalty : (result.penalty || 0);

    // Calculate total including local error points
    // Note: getDressagePenaltyCoeff is used inside service, but we might need it here for the error penalty if not returned
    const coeff = getDressagePenaltyCoeff(currentDressageTest);
    const errorPenalty = errorPoints * coeff;
    const totalPenalty = judgePenalty + errorPenalty;

    document.getElementById('totalPointsDisplay').textContent = points.toFixed(1);
    document.getElementById('percentage').textContent = `${percent.toFixed(2)} %`;
    document.getElementById('penaltyPoints').textContent = judgePenalty.toFixed(1);
    document.getElementById('extraPenaltyDisplay').textContent = errorPenalty.toFixed(1); // Show penalty, not points
    document.getElementById('totalPenaltyDisplay').textContent = totalPenalty.toFixed(1);
  } else {
    // Fallback if service returns null (should verify why)
    document.getElementById('totalPointsDisplay').textContent = "0.0";
    document.getElementById('percentage').textContent = "0.00 %";
  }
}

// ERSÄTT DENNA FUNKTION i dressyr-input.js
async function updateLiveStatus(lastUpdatedElement = null) {
  const startNumber = equipageSearchDropdown.getValue();
  const testSelector = document.getElementById('testSelector');
  const eliminatedCheckbox = document.getElementById('dressageEliminated');

  if (!startNumber || !activeDressageJudge || !currentDressageTest || !testSelector || !eliminatedCheckbox || !competitionId || !appId) {
    return;
  }

  try {
    const movementsData = Array.from(document.querySelectorAll('#protocolBody .movement-card')).map((card, index) => {
      const scoreInput = card.querySelector('.score-input');
      const scoreValue = scoreInput ? scoreInput.value : '';
      return {
        momentNo: currentDressageTest.movements[index].no,
        score: scoreValue.trim() !== '' ? parseFloat(scoreValue) : null,
        comment: card.querySelector('.comment-input')?.value || ''
      };
    });

    const liveProtocolData = {
      judgeId: activeDressageJudge.id,
      judgeName: activeDressageJudge.name,
      judgePosition: activeDressageJudge._pos || '',
      testKey: testSelector.value,
      eliminated: eliminatedCheckbox.checked,
      movements: movementsData
    };

    let lastUpdatePayload = { heartbeat: true };
    if (lastUpdatedElement && lastUpdatedElement.classList.contains('score-input')) {
      const momentIndex = parseInt(lastUpdatedElement.dataset.momentIndex, 10);
      const moment = currentDressageTest.movements[momentIndex];
      if (moment && activeDressageJudge) {
        lastUpdatePayload = {
          momentNo: moment.no,
          momentText: moment.text,
          score: lastUpdatedElement.value.trim() !== '' ? parseFloat(lastUpdatedElement.value) : null,
          judgeId: activeDressageJudge.id,
          judgeName: activeDressageJudge.name,
          judgePosition: activeDressageJudge._pos || ''
        };
      }
    }

    const liveDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'competitions', competitionId, 'dressageStatus', String(startNumber), 'live', 'data');
    const payload = {
      state: 'ongoing',
      protocol: liveProtocolData,
      lastUpdate: lastUpdatePayload,
      updatedAt: new Date().toISOString()
    };

    // Skriv med enkel retry/backoff för att undvika tappade pulser på nätverksglitch
    for (let i = 0; i < 3; i++) {
      try {
        await setDoc(liveDocRef, payload, { merge: true });
        // Mirror live state locally too!
        mirrorToLocal(startNumber, { live: payload });
        break; // klart
      } catch (err) {
        if (i === 2) throw err; // ge upp efter 3 försök
        await new Promise(r => setTimeout(r, 300 * (i + 1))); // 300ms, 600ms
      }
    }

  } catch (err) {
    console.error('Kunde inte skicka live-uppdatering:', err);
  }
}

async function saveProtocol() {
  const startNumber = equipageSearchDropdown.getValue();
  if (!startNumber) { showAlert(t('alert_select_equipage'), false); return; }
  if (!activeDressageJudge) { showAlert(t('alert_select_judge'), false); return; }
  if (!currentDressageTest) { showAlert(t('alert_select_program'), false); return; }

  try {
    const testKey = document.getElementById('testSelector').value;
    const eliminated = document.getElementById('dressageEliminated').checked;
    const movementsData = Array.from(document.querySelectorAll('#protocolBody .movement-card')).map((card, index) => ({
      momentNo: currentDressageTest.movements[index].no,
      score: parseFloat(card.querySelector('.score-input').value) || 0,
      comment: card.querySelector('.comment-input').value || ''
    }));

    // KORRIGERING: Lägger till 'testKey' i dokumentet som sparas.
    const protocolData = {
      judgeId: activeDressageJudge.id,
      judgeName: activeDressageJudge.name,
      judgePosition: activeDressageJudge._pos || '',
      testKey, // <--- DENNA VAR DEN KRITISKA DELEN SOM SAKNADES
      eliminated,
      movements: movementsData
    };
    await saveDressageJudgeProtocol(competitionId, startNumber, activeDressageJudge.id, protocolData);

    const generalData = {
      errorPoints: parseFloat(document.getElementById('errorPointsInput').value) || 0,
      errorComment: document.getElementById('errorCommentInput').value || ''
    };
    await saveDressageGeneralData(competitionId, startNumber, generalData);

    const program = getPrograms()[testKey];
    const maxScore = program.movements.reduce((s, m) => s + 10 * m.coeff, 0);
    const totalScore = movementsData.reduce((s, m) => {
      const pm = program.movements.find(x => x.no === m.momentNo);
      return s + (m.score * (pm?.coeff || 1));
    }, 0);
    const penaltyCoeff = getDressagePenaltyCoeff(program);
    const finalPenalty = eliminated ? null : ((maxScore - totalScore) * penaltyCoeff);
    const finalPercent = eliminated ? 0 : (maxScore > 0 ? (totalScore / maxScore) * 100 : 0);

    const finalJudgeScorePayload = {
      judgeId: activeDressageJudge.id,
      judgeName: activeDressageJudge.name,
      judgePosition: activeDressageJudge._pos || '',
      points: totalScore,
      totalPoints: totalScore,
      penalty: finalPenalty,
      percent: finalPercent,
      eliminated: eliminated,
    };

    // Calculate if ALL expected judges have finished
    const savedPositions = new Set();
    const allProtocols = await getDressageResultsForEquipage(competitionId, startNumber);
    allProtocols.forEach(p => {
      if (p.id !== 'general' && p.judgePosition) {
        savedPositions.add(p.judgePosition.toUpperCase());
      }
    });
    if (activeDressageJudge._pos) {
      savedPositions.add(activeDressageJudge._pos.toUpperCase());
    }

    const equipage = sortedEquipages.find(e => String(e.startNumber) === String(startNumber));
    let expectedPositions = [];
    if (equipage && window.dressageJudgeMapping && window.dressageJudgeMapping[equipage.className]) {
      const mapped = window.dressageJudgeMapping[equipage.className];
      expectedPositions = Object.keys(mapped).filter(k => mapped[k] && String(mapped[k]).trim() !== '').map(k => k.toUpperCase());
    } else {
      expectedPositions = window.allJudges.map(j => (j._pos || '').toUpperCase()).filter(p => p !== '');
    }

    const expectedCount = new Set(expectedPositions).size;
    const isFullyFinished = savedPositions.size >= expectedCount || expectedCount === 0;
    const finalState = isFullyFinished ? 'finished' : 'ongoing';

    await setDressageStatus(competitionId, startNumber, {
      state: finalState,
      judgeId: activeDressageJudge.id,
      judgeName: activeDressageJudge.name,
      judgePosition: activeDressageJudge._pos || '',
      protocol: null,
      lastUpdate: null,
      finalJudgeScore: finalJudgeScorePayload
    });

    if (!navigator.onLine) {
      showAlert(t('alert_protocol_queued').replace('{startNumber}', startNumber), 'offline');
    } else {
      showAlert(t('alert_protocol_saved').replace('{startNumber}', startNumber));
    }
    clearForm();

    // Auto-advance to the next equipage according to the start list
    const currentIndex = sortedEquipages.findIndex(e => String(e.startNumber) === String(startNumber));
    if (currentIndex >= 0 && currentIndex < sortedEquipages.length - 1) {
      const nextSn = sortedEquipages[currentIndex + 1].startNumber;
      equipageSearchDropdown.setValue(nextSn);
    } else {
      equipageSearchDropdown.setValue(null);
    }
  } catch (error) {
    console.error("Kunde inte spara protokoll: ", error);
    // Kunde inte spara protokoll: 
    showAlert(t('alert_protocol_save_error'), false);
  }
}

function setupEventListeners() {

  const testSelector = document.getElementById('testSelector');
  const judgeSelector = document.getElementById('judgeSelector');
  const protocolBody = document.getElementById('protocolBody');
  const errorPointsInput = document.getElementById('errorPointsInput');
  const eliminatedCheckbox = document.getElementById('dressageEliminated');
  const saveButton = document.getElementById('saveProtocol');
  const prevButton = document.getElementById('prevEquipage');
  const nextButton = document.getElementById('nextEquipage');

  if (!testSelector || !judgeSelector || !protocolBody || !saveButton) {
    // Kritiska element för event-lyssnare saknas i DOM. Avbryter setup.
    return;
  }

  judgeSelector.addEventListener('change', (e) => {
    activeDressageJudge = allJudges.find(j => j.id === e.target.value) || null;
    const startNumber = equipageSearchDropdown.getValue();
    if (startNumber && activeDressageJudge) {
      loadExistingProtocol(startNumber, activeDressageJudge.id, { allowTestChange: false });
    }
  });

  testSelector.addEventListener('change', (e) => {
    if (!programmaticChange) manualTestOverride = true;
    renderProtocol(e.target.value);
    setTimeout(handleSelectionChange, 50);
  });

  // --- NYTT: Hanterare för poängformatering (55 -> 5.5) ---
  const formatScoreInput = (input) => {
    if (!input) return;
    // Tillåt , och . som decimaltecken vid manuell inmatning
    let valStr = input.value.trim().replace(',', '.');

    // Om användaren skrev en giltig decimal (t.ex. 5.5), behåll den
    if (/^[0-9](\.[05])?$|^10(\.0)?$/.test(valStr)) {
      if (valStr.endsWith('.5') || valStr.endsWith('.0')) {
        input.value = valStr; // Redan perfekt
      } else if (valStr === '10') {
        input.value = '10.0';
      } else if (/^[0-9]$/.test(valStr)) {
        input.value = valStr + '.0'; // t.ex. 5 -> 5.0
      }
      return;
    }

    // Om vi är här, anta snabbinmatning (endast siffror)
    let val = valStr.replace(/[^0-9]/g, ''); // Ta bort allt utom siffror

    if (val === '') {
      input.value = ''; // Låt fältet vara tomt
      return;
    }

    // Hantera specialfall "10" och "100" -> 10.0
    if (val === '10' || val === '100') {
      input.value = '10.0';
      return;
    }

    // Hantera ensam siffra (t.ex. "5" -> "5.0")
    if (val.length === 1) {
      input.value = val + '.0';
      return;
    }

    // Hantera två siffror (t.ex. "55" -> "5.5", "60" -> "6.0")
    if (val.length === 2) {
      // "05" -> "0.5"
      if (val.startsWith('0')) {
        input.value = '0.' + val[1];
      } else {
        input.value = val[0] + '.' + val[1];
      }
      return;
    }
    // Om numret är för långt, använd bara de två första (t.ex. 555 -> 5.5)
    input.value = val[0] + '.' + val[1];
  };


  // --- UPPDATERAD: Lyssnare för live-uppdateringar ---
  const handleScoreFieldExit = (event) => {
    // Skicka bara om fältet är ett poängfält
    if (event.target.classList.contains('score-input')) {
      // Poängfält lämnat, formaterar och skickar live-uppdatering...

      // 1. Formatera poängen (55 -> 5.5)
      formatScoreInput(event.target);

      // 2. Kör befintlig logik
      calculateTotals();
      if (!isFieldModeEnabled()) {
        updateLiveStatus(event.target);
      }
    }
  };

  const handleGenericInput = () => {
    calculateTotals();
    if (isFieldModeEnabled()) return;
    clearTimeout(liveUpdateTimer);
    liveUpdateTimer = setTimeout(() => {

      updateLiveStatus(null);
    }, 750);
  }

  // Använd 'focusout' för poängformatering & sändning
  protocolBody.addEventListener('focusout', handleScoreFieldExit);

  // Använd 'input' för live-uppdatering av totals och kommentar-knapp
  protocolBody.addEventListener('input', (e) => {
    const target = e.target;
    if (target.classList.contains('score-input')) {
      // Uppdatera totals live
      calculateTotals();
      if (isFieldModeEnabled()) return;
      // Debounce:a live-skrivning
      clearTimeout(liveUpdateTimer);
      liveUpdateTimer = setTimeout(() => {
        updateLiveStatus(target);
      }, 250);

    } else if (target.classList.contains('comment-input')) {
      // Uppdatera knappens utseende om kommentar finns
      const btn = target.closest('.movement-card').querySelector('.comment-toggle-btn');
      if (btn) {
        btn.classList.toggle('has-comment', target.value.trim() !== '');
      }
      // Spara (heartbeat)
      handleGenericInput();
    }
  });

  if (errorPointsInput) errorPointsInput.addEventListener('input', handleGenericInput);
  if (eliminatedCheckbox) eliminatedCheckbox.addEventListener('change', handleGenericInput);

  // NYTT: Snabbknappar för felridning
  document.getElementById('btnErr1')?.addEventListener('click', () => {
    const rule = window.dressageRules?.error1 || 2; // Default 2 straff
    const current = parseFloat(errorPointsInput.value) || 0;
    // Om redan satt, toggla av? Nej, lägg till. Eller uteslutande? 
    // Vanligtvis: 0 -> 2 -> 6 (2+4).
    // Enklast: Sätt till Regel 1 värde om 0.
    errorPointsInput.value = rule;
    handleGenericInput();
  });
  document.getElementById('btnErr2')?.addEventListener('click', () => {
    const rule1 = window.dressageRules?.error1 || 2;
    const rule2 = window.dressageRules?.error2 || 4;
    // Totalt straff vid 2:a felridning är ofta (rule1 + rule2) eller rule2 totalt?
    // TR säger: 1:a vägfel = 2 straff. 2:a vägfel = 4 straff (dvs +4 till, totalt 6? Eller totalt 4?).
    // TR V (2023):
    // 1:a gången: 2 poäng
    // 2:a gången: 4 poäng (dvs totalt avdrag? Nej, "Andra gången = 4 straffpoäng" brukar betyda ackumulerat i vissa system, men här sätter vi totalen)
    // Om vi antar att input är TOTALT straff:
    // 1 fel = 2. 
    // 2 fel = 2 + 4 = 6? Eller bara 4?
    // Låt oss anta att knappen sätter VÄRDET till X.
    // Om användaren klickar "Fel 2" sätter vi rule2.
    errorPointsInput.value = rule2;
    handleGenericInput();
  });


  // --- NYTT/MODIFIERAT: Hantera Enter/Tab-tangent för navigering ---
  protocolBody.addEventListener('keydown', (e) => {
    const target = e.target;
    // Refresh DOM query natively in case items were re-rendered
    const allInputs = Array.from(protocolBody.querySelectorAll('.score-input'));
    const card = target.closest('.movement-card');

    const scrollIntoCenter = (element) => {
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };

    // --- Logik för POÄNGFÄLT ---
    if (target.classList.contains('score-input')) {
      const currentIndex = allInputs.indexOf(target);

      if (e.key === 'Enter') {
        e.preventDefault(); // Förhindra standard-submit
        const nextIndex = currentIndex + 1;

        if (nextIndex < allInputs.length) {
          allInputs[nextIndex].focus();
          allInputs[nextIndex].select(); // Markera texten
          scrollIntoCenter(allInputs[nextIndex]);
        } else {
          // Hoppa till "Extra straff"
          const errInput = document.getElementById('errorPointsInput');
          errInput.focus();
          scrollIntoCenter(errInput);
        }
      } else if (e.key === 'Tab' && !e.shiftKey) { // Bara Tab, inte Shift+Tab
        e.preventDefault(); // Stoppa standard Tab-beteende

        if (card) {
          const commentInput = card.querySelector('.comment-input');
          if (commentInput) {
            // Visa kommentarsfältet och fokusera
            card.classList.add('comment-visible');
            commentInput.focus();
            scrollIntoCenter(commentInput);
          }
        }
      }
    }
    // --- Logik för KOMMENTARSFÄLT ---
    else if (target.classList.contains('comment-input')) {
      // Om man trycker Enter ELLER Tab i en kommentar...
      if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
        e.preventDefault(); // Stoppa standardbeteende

        // Hitta nuvarande poängfält för att veta var vi är
        const scoreInput = card.querySelector('.score-input');
        const currentIndex = allInputs.indexOf(scoreInput);
        const nextIndex = currentIndex + 1;

        if (nextIndex < allInputs.length) {
          allInputs[nextIndex].focus();
          allInputs[nextIndex].select();
          scrollIntoCenter(allInputs[nextIndex]);
        } else {
          // Hoppa till "Extra straff"
          const errInput = document.getElementById('errorPointsInput');
          errInput.focus();
          scrollIntoCenter(errInput);
        }
      }
    }
  });

  // --- NYTT: Hantera klick på Info/Kommentar-knappar ---
  protocolBody.addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;

    const card = btn.closest('.movement-card');
    const targetType = btn.dataset.target; // 'details' eller 'comment'

    if (targetType === 'details') {
      card.classList.toggle('details-visible');
    } else if (targetType === 'comment') {
      card.classList.toggle('comment-visible');
      if (card.classList.contains('comment-visible')) {
        // Fokusera på textrutan när den öppnas
        card.querySelector('.comment-input').focus();
      }
    }
  });


  // --- Lyssnare för knappar (Inga ändringar här) ---
  saveButton.addEventListener('click', saveProtocol);

  document.getElementById('btnBackupDreJson')?.addEventListener('click', () => {
    const backup = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith(`bkp_${competitionId}_dre_`)) {
        backup[key] = JSON.parse(localStorage.getItem(key));
      }
    }
    const filename = `backup_dressyr_${competitionId}_${new Date().toISOString().split('T')[0]}.json`;
    downloadJson(filename, backup);
  });

  if (prevButton) {
    prevButton.addEventListener('click', () => {
      const currentValue = equipageSearchDropdown.getValue();
      const currentIndex = sortedEquipages.findIndex(e => e.startNumber == currentValue);
      if (currentIndex > 0) {
        equipageSearchDropdown.setValue(sortedEquipages[currentIndex - 1].startNumber);
      }
    });
  }

  if (nextButton) {
    nextButton.addEventListener('click', () => {
      const currentValue = equipageSearchDropdown.getValue();
      const currentIndex = sortedEquipages.findIndex(e => e.startNumber == currentValue);
      if (currentIndex < sortedEquipages.length - 1) {
        equipageSearchDropdown.setValue(sortedEquipages[currentIndex + 1].startNumber);
      }
    });
  }


}

function auditProgramsAndMapping(equipages) {
  const issues = [];
  const prog = getPrograms();
  const raw = (window.klassProgramMapping || klassProgramMapping || {});
  const mapping = (raw && typeof raw.mapping === 'object') ? raw.mapping : raw;

  const progKeys = Object.keys(prog);

  // 1) Program-validering (låt stå – hjälper oss hitta trasiga program)
  progKeys.forEach(k => {
    const p = prog[k];
    if (!p || typeof p !== 'object') { issues.push(`Program "${k}" saknar data.`); return; }
    if (!p.name) issues.push(`Program "${k}" saknar namn.`);
    if (!p.category) issues.push(`Program "${k}" saknar kategori.`);
    if (!Array.isArray(p.movements) || !p.movements.length) {
      issues.push(`Program "${k}" saknar moment-lista.`);
    } else {
      p.movements.forEach((m, idx) => {
        if (typeof m?.no !== 'number') issues.push(`Program "${k}": moment #${idx + 1} saknar giltigt "no".`);
        if (!m?.text || !String(m.text).trim()) issues.push(`Program "${k}": moment ${m?.no ?? idx + 1} saknar text.`);
        if (m?.coeff == null || !(m.coeff > 0)) m.coeff = 1; // auto-fix coeff
      });
    }
  });

  // 2) Klasser utan fungerande mapping
  // OBS: Vi använder nu samma logik som när man väljer ekipage (findProgramKeyForClass).
  // Det eliminerar "falska larm" där bannern klagar men programmet faktiskt dyker upp ändå.

  const classesInUse = [...new Set((equipages || []).map(e => (e.className || e.klass || '').trim()).filter(Boolean))];

  const checkedKeys = new Set();

  classesInUse.forEach(cls => {
    // Använd systemets riktiga resolution-logik
    const resolvedKey = findProgramKeyForClass(cls);

    if (!resolvedKey) {
      issues.push(`Klass "${cls}" saknar mapping till dressyrprogram.`);
    } else {
      // Validera att det resolva programmet faktiskt finns och är helt
      if (!prog[resolvedKey]) {
        issues.push(`Klass "${cls}" pekar på program "${resolvedKey}" som saknas.`);
      } else if (!checkedKeys.has(resolvedKey)) {
        // Kanske kolla om programmet är markerat som verifierat?
        // (Valfritt: p.verified)
        checkedKeys.add(resolvedKey);
      }
    }
  });

  return issues;
}


function showProgramAuditBanner(equipages) {
  const host = document.getElementById('programAuditBanner');
  if (!host) return;
  const issues = auditProgramsAndMapping(equipages);

  if (!issues.length) {
    host.innerHTML = `
      <div class="p-3 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm dark:bg-emerald-900/20 dark:text-emerald-200 dark:border-emerald-700">
        ✔️ Alla dressyrprogram och mapping ser kompletta ut.
      </div>`;
    return;
  }
  host.innerHTML = `
    <div class="p-3 rounded-md bg-red-50 border border-red-200 text-red-800 text-sm dark:bg-red-900/20 dark:text-red-200 dark:border-red-700">
      <div class="font-semibold mb-1">Kontroll av dressyrprogram: ${issues.length} sak(er) att åtgärda</div>
      <ul class="list-disc pl-5 space-y-1">
        ${issues.map(i => `<li>${i}</li>`).join('')}
      </ul>
      <div class="mt-2 text-gray-700 dark:text-gray-300">Uppdatera <code>data/dressagePrograms.js</code> och/eller <code>data/competitionData.js</code> (klassProgramMapping).</div>
    </div>`;
}

// RAD FÖRE (ca 1202): }

export function load() {
  const competition = getGlobalState('currentCompetition');
  const page = document.getElementById('page-dressyr-input');
  if (!competition) {
    page.innerHTML = `<p class="p-8 text-center text-red-500">Ingen tävling vald.</p>`;
    return;
  }
  competitionId = competition.id;
  page.innerHTML = `
  <div class="container mx-auto p-4 md:p-8 max-w-4xl">
    ${getCompetitionHeader(competition, competition?.competitionMode === 'field'
      ? 'Inmatning Dressyr - Manuellt domarprotokoll'
      : 'Inmatning Dressyr - Digitalt Domarprotokoll')}
    ${renderCompetitionModeBanner(competition, {
      message: 'Tävlingen körs i fältläge. Domarprotokoll registreras manuellt här, och sekretariatet används för efterkontroll och finalisering.'
    })}
<style>
        /* Dölj detaljer och kommentarsfält som standard */
        .movement-details,
        .comment-wrapper {
            display: none;
            margin-top: 8px;
        }
        /* Visa dem när 'details-visible' är satt på kortet */
        .movement-card.details-visible .movement-details {
            display: block;
        }
        /* Visa kommentaren när 'comment-visible' är satt */
        .movement-card.comment-visible .comment-wrapper {
            display: block;
        }

        /* Stil för våra nya små-knappar */
        .toggle-btn {
            background: none;
            border: 1px solid #cbd5e1; /* gray-300 */
            border-radius: 99px; /* rounded-full */
            padding: 4px 8px;
            font-size: 11px;
            line-height: 1.2;
            color: #475569; /* gray-600 */
            cursor: pointer;
            white-space: nowrap;
        }
        .toggle-btn:hover {
            background: #f1f5f9; /* gray-100 */
        }
        /* Gör knappen blå om en kommentar finns */
        .toggle-btn.has-comment {
            border-color: #2563eb; /* blue-600 */
            color: #2563eb;
            font-weight: 600;
        }
        
        /***** DARK MODE STYLES *****/
        .dark .toggle-btn {
            border-color: #4b5563; /* gray-600 */
            color: #9ca3af; /* gray-400 */
        }
        .dark .toggle-btn:hover {
            background: #374151; /* gray-700 */
        }
        .dark .toggle-btn.has-comment {
            border-color: #60a5fa; /* blue-400 */
            color: #60a5fa;
        }

        /* NYTT: Tvinga protokollkroppen att scrolla, inte hela sidan - ENDAST Desktop */
        @media (min-width: 768px) {
            #protocolBodyWrapper {
                max-height: 65vh; /* Justera denna höjd efter behov */
                overflow-y: auto;
                padding-right: 8px; /* Lite utrymme för scroll-listen */
            }
        }
    </style>
    
    <div id="programAuditBanner" class="my-3"></div>

    <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border dark:border-gray-700">
      
      <div class="grid grid-cols-1 md:grid-cols-5 gap-4 mb-4 pb-4 border-b dark:border-gray-700">
        <div class="md:col-span-2">
          <label for="testSelector" class="block text-sm font-medium text-gray-700 dark:text-gray-300">${t('input_program')}</label>
          <select id="testSelector" class="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white"></select>
          <div id="programMeta" class="text-xs text-gray-600 mt-1 leading-snug whitespace-normal break-words dark:text-gray-400"></div>
        </div>
        <div class="md:col-span-1">
          <label for="judgeSelector" class="block text-sm font-medium text-gray-700 dark:text-gray-300">${t('input_judge')}</label>
          <select id="judgeSelector" required class="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white"></select>
        </div>
        <div class="md:col-span-2">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">${t('input_equipage')}</label>
          <div class="flex items-center space-x-2">
            <button id="prevEquipage" type="button" class="p-3 border rounded-md hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700 dark:text-white">«</button>
            <div id="equipageSearchContainer" class="mt-1 flex-grow relative z-30"></div>
            <button id="nextEquipage" type="button" class="p-3 border rounded-md hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700 dark:text-white">»</button>
          </div>
        </div>
      </div>
      
      <div id="dressage-summary-bar" class="relative md:sticky md:top-[63px] z-10 bg-white shadow-md p-2 my-6 rounded-lg dark:bg-gray-800 dark:border dark:border-gray-700">
          <div class="grid grid-cols-5 gap-2 text-center"> <div>
                  <p class="text-xs font-medium text-gray-700 dark:text-gray-400">${t('input_total_points')}</p>
                  <p id="totalPointsDisplay" class="text-xl font-bold text-gray-900 dark:text-white">0.0</p>
              </div>
              <div>
                  <p class="text-xs font-medium text-green-700 dark:text-green-400">${t('input_percent')}</p>
                  <p id="percentage" class="text-xl font-bold text-green-900 dark:text-green-300">0.00 %</p>
              </div>
              <div>
                  <p class="text-xs font-medium text-red-700 dark:text-red-400">${t('input_judge_penalty')}</p>
                  <p id="penaltyPoints" class="text-xl font-bold text-red-900 dark:text-red-300">0.0</p>
              </div>
              <div class="bg-orange-100 rounded-md p-1 dark:bg-orange-900/30">
                  <p class="text-xs font-medium text-orange-700 dark:text-orange-300">${t('input_extra_penalty')}</p>
                  <p id="extraPenaltyDisplay" class="text-xl font-bold text-orange-900 dark:text-orange-200">0.0</p>
              </div>
              <div>
                  <p class="text-xs font-medium text-blue-700 dark:text-blue-400">${t('input_total_penalty')}</p>
                  <p id="totalPenaltyDisplay" class="text-xl font-bold text-blue-900 dark:text-blue-300">0.0</p>
              </div>
          </div>
      </div>

      <div id="protocolBodyWrapper">
        <div id="protocolBody" class="grid grid-cols-1 md:grid-cols-2 gap-2">
        </div>
      </div>

      <div class="relative md:sticky md:bottom-0 z-10 bg-white p-4 border-t mt-6 dark:bg-gray-800 dark:border-gray-700">
        <div class="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          
          <div class="md:col-span-3">
            <label for="errorPointsInput" class="block text-xs font-medium text-gray-700 dark:text-gray-300">${t('input_error_points')}</label>
            <div class="flex gap-1 mt-1">
               <input type="number" id="errorPointsInput" value="0" min="0" class="block w-20 p-2 border rounded-md text-base text-center font-bold dark:bg-gray-700 dark:border-gray-600 dark:text-white">
               <button type="button" id="btnErr1" class="text-xs bg-gray-200 hover:bg-red-100 text-gray-800 py-1 px-2 rounded dark:bg-gray-700 dark:hover:bg-red-900/20 dark:text-gray-200">${t('input_error_1')}</button>
               <button type="button" id="btnErr2" class="text-xs bg-gray-200 hover:bg-red-100 text-gray-800 py-1 px-2 rounded dark:bg-gray-700 dark:hover:bg-red-900/20 dark:text-gray-200">${t('input_error_2')}</button>
            </div>
          </div>
          
          <div class="md:col-span-4">
            <label for="errorCommentInput" class="block text-xs font-medium text-gray-700 dark:text-gray-300">${t('input_error_comment')}</label>
            <textarea id="errorCommentInput" rows="1" class="mt-1 block w-full p-2 border rounded-md text-base dark:bg-gray-700 dark:border-gray-600 dark:text-white"></textarea>
          </div>

          <div class="md:col-span-2 flex items-center h-full pt-5">
            <input type="checkbox" id="dressageEliminated" class="h-5 w-5 rounded border-gray-300 dark:bg-gray-700 dark:border-gray-600 focus:ring-red-500">
            <label for="dressageEliminated" class="ml-2 block text-sm font-medium dark:text-gray-300">${t('input_eliminated')}</label>
          </div>
          
          <div class="md:col-span-3">
            <label class="block text-xs font-medium text-transparent select-none">${t('input_save')}</label>
            <button id="saveProtocol" class="w-full mt-1 bg-brand-darkblue text-white font-semibold py-2 px-4 rounded-lg hover:bg-brand-gold hover:text-brand-darkblue text-base shadow-md transition-colors dark:bg-blue-700 dark:hover:bg-blue-600">
              ${t('input_save_protocol')}
            </button>
          </div>
          </div>

        </div>
        <div class="mt-4 pt-3 border-t flex justify-end dark:border-gray-700">
          <button id="btnBackupDreJson" type="button" class="text-xs text-blue-600 hover:underline flex items-center gap-1 dark:text-blue-400">
            <i class="fas fa-file-download"></i> ${t('input_download_backup')}
          </button>
        </div>
      </div>
    </div></div>`;

  // SPARA UNSUBSCRIBE
  const unsubscribeJudges = listenForJudges(competitionId, async (judges) => {
    allJudges = judges;
    try {
      if (!document.getElementById('page-dressyr-input')) return; // Skydd om vi lämnat

      const [equipages, startTimes, mappingCfg, overrides, judgeMapCfg, rulesCfg, statusDocs] = await Promise.race([
        Promise.all([
          getEquipages(competitionId),
          getConfig(competitionId, 'startTimes'),
          getConfig(competitionId, 'dressyrProgramMapping'),
          getConfig(competitionId, 'dressagePrograms'),
          getConfig(competitionId, 'dressageJudgeMapping'),
          getConfig(competitionId, 'dressageRules'),
          getDressageStatusCollection(competitionId)
        ]),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout loading dressage data')), 5000))
      ]);

      // Gör mapping + ev. overrides tillgängliga globalt
      const rawMap = (mappingCfg && typeof mappingCfg === 'object') ? mappingCfg : {};
      window.klassProgramMapping = (rawMap && typeof rawMap.mapping === 'object') ? rawMap.mapping : rawMap;
      window.dressageJudgeMapping = judgeMapCfg || {};
      window.dressageRules = rulesCfg || {};

      if (overrides && typeof overrides === 'object' && Object.keys(overrides).length) {
        const base = getPrograms();
        window.dressagePrograms = { ...base, ...(window.dressagePrograms || {}), ...overrides };
      }

      // Bygg selecterna när allt finns
      populateSelectors();

      // Städa gammal status-lyssnare
      if (unsubStatus) unsubStatus();

      const rebuild = (statusDocs) => {
        const equipageSearchContainer = document.getElementById('equipageSearchContainer');
        if (!equipageSearchContainer) return;

        const statusMap = new Map();
        (statusDocs || []).forEach(s => statusMap.set(String(s.id), s));

        sortedEquipages = [...(equipages || [])].sort((a, b) => {
          const statusA = statusMap.get(String(a.startNumber));
          const statusB = statusMap.get(String(b.startNumber));
          
          const doneA = statusA?.state === 'finished';
          const doneB = statusB?.state === 'finished';

          if (doneA !== doneB) return doneA ? 1 : -1;

          const timeA = startTimes?.times?.[String(a.startNumber)]?.dressage;
          const timeB = startTimes?.times?.[String(b.startNumber)]?.dressage;

          if (timeA && timeB) {
            const tsA = new Date(timeA).getTime();
            const tsB = new Date(timeB).getTime();
            if (tsA !== tsB && !isNaN(tsA) && !isNaN(tsB)) return tsA - tsB;
          } else if (timeA) {
            return -1;
          } else if (timeB) {
            return 1;
          }
          return Number(a.startNumber) - Number(b.startNumber);
        });

        if (equipageSearchDropdown) {
          equipageSearchDropdown.updateData(sortedEquipages);
        } else {
          equipageSearchDropdown = createSearchableDropdown(equipageSearchContainer, sortedEquipages, handleSelectionChange);
        }
      };

      // Starta realtids-lyssnare för statusar
      unsubStatus = listenForDressageStatusCollection(competitionId, (statusDocs) => {
        rebuild(statusDocs);
      });

      // Request Wake Lock bara i full live-drift
      if (!isFieldModeEnabled()) {
        await requestWakeLock();
      }

      setupEventListeners();
      showProgramAuditBanner(sortedEquipages);
    } catch (e) {
      // Kunde inte ladda grunddata för dressyr-input:
    }
  });

  // Haka på unsubscribe till modulen (för att kunna städa i __unload)
  window.__dressageInputUnsub = () => {
    unsubscribeJudges();
    if (unsubStatus) unsubStatus();
  };
}

let unsubStatus = null;

export function __unload() {
  // Städar dressyr-input...
  if (window.__dressageInputUnsub) {
    window.__dressageInputUnsub();
    window.__dressageInputUnsub = null;
  }
  clearTimeout(liveUpdateTimer);

  if (equipageSearchDropdown && typeof equipageSearchDropdown.destroy === 'function') {
    equipageSearchDropdown.destroy();
  }
  equipageSearchDropdown = null;
}
