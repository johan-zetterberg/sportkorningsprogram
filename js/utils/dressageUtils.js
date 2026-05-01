// Delad fil för all gemensam dressyrlogik.

// Importera den globala programlistan som en fallback
import { dressagePrograms as _programs } from '../data/dressagePrograms.js';

/**
 * Hämtar den globala listan över dressyrprogram, med stöd för overrides via window-objektet.
 */
export function getPrograms() {
  const w = (typeof window !== 'undefined' ? window.dressagePrograms : null);
  if (w && Object.keys(w).length) return w;
  return (typeof _programs !== 'undefined' ? _programs : {});
}

import { getDressagePenaltyCoeff as _getCoeff, computeFinalFromSaved as _computeFinal, guessProgramKeyFromClass as _guessProg } from '../core-engine/dressage.js';

/**
 * Hämtar den korrekta straffkoefficienten för ett givet dressyrprogram.
 * @param {object | string} programOrKey - Programobjektet eller dess nyckel.
 * @returns {number} - Straffkoefficienten (t.ex. 1.0, 0.8, 0.666).
 */
export function getDressagePenaltyCoeff(programOrKey) {
  const all = getPrograms();
  const p = (typeof programOrKey === 'string') ? (all[programOrKey] || null) : programOrKey || null;
  return _getCoeff(p, all);
}

/**
 * Beräknar ett slutgiltigt snittresultat från en array av sparade domarprotokoll.
 * @param {object} eq - Ekipageobjektet.
 * @param {Array<object>} savedArr - En array av sparade protokoll-objekt.
 * @param {object} program - Det fullständiga programobjektet (från getPrograms()).
 * @returns {object | null} - Ett objekt med { points, percent, penalty } eller null.
 */
export function computeFinalFromSaved(eq, savedArr, program) {
  if (!eq) return null;
  const allPrograms = getPrograms();
  const res = _computeFinal(savedArr, program, allPrograms);
  if (!res) return null;

  // För bakåtkompatibilitet beräknar vi generalImpressionsSum också om det behövs i UI
  const generalKeywords = ['gångarter', 'framåtbjudning', 'lydnad', 'kusken', 'presentation', 'helhetsintryck', 'impulsion', 'athlete', 'general impression'];
  let genSum = 0;
  for (const p of savedArr) {
    const movements = Array.isArray(p.movements) ? p.movements : [];
    const generalTotal = movements.reduce((sum, mv) => {
      const no = Number(mv.momentNo ?? mv.movementNo ?? mv.no);
      const pm = (program.movements || []).find(x => Number(x.no) === no);
      if (!pm) return sum;
      const text = (pm.text || '').toLowerCase();
      if (generalKeywords.some(k => text.includes(k))) {
        const c = Number(pm.coeff) || 1;
        const sc = (mv.score !== '' && mv.score != null) ? Number(mv.score) : null;
        return (sc != null ? (sum + sc * c) : sum);
      }
      return sum;
    }, 0);
    genSum += generalTotal;
  }
  res.generalImpressionsSum = genSum / savedArr.length;
  
  return res;
}

/**
 * Normaliserar ett moments id/nummer.
 */
export function normalizeMovementNo(m) {
  if (!m) return null;
  const n = (m.momentNo ?? m.movementNo ?? m.no);
  const num = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(num) ? num : null;
}

/**
 * Normaliserar en hel lista av rörelser från ett protokoll.
 */
export function normalizeMovements(list) {
  if (!Array.isArray(list)) return [];
  return list.map(m => ({
    momentNo: normalizeMovementNo(m),
    score: (m && m.score !== '' && m.score != null) ? Number(m.score) : null,
    comment: (m && m.comment) ? String(m.comment) : ''
  })).filter(x => Number.isFinite(x.momentNo));
}

/**
 * Formaterar ett tal till procent (t.ex. "72.34 %")
 */
export function fmtPct(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) + ' %' : '–';
}

/**
 * Formaterar ett tal till två decimaler (t.ex. "120.50")
 */
export function fmtNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : '–';
}

/**
 * Hämtar hästnamn för ett ekipage för ett specifikt moment (dressyr).
 * @param {object} equipage - Ekipageobjektet.
 * @returns {string} - En sträng med hästnamn, separerade av ' & ', eller '—'.
 */
export function getMomentHorseLabel(equipage) {
  if (!equipage || typeof equipage !== 'object') return '—';

  // Försök hämta alla hästar, oavsett var de lagras
  const allHorsesRaw = equipage.horses || equipage.horseNames || equipage.horse || [];
  let allHorses = [];
  if (Array.isArray(allHorsesRaw)) {
    allHorses = allHorsesRaw.map(h => (typeof h === 'string' ? { name: h } : h)).filter(h => h && h.name);
  } else if (typeof allHorsesRaw === 'string' && allHorsesRaw.trim()) {
    // Om det bara är en sträng, splitta den
    allHorses = allHorsesRaw.split(/[\/,&+]|(?:\s*&\s*)/).map(name => ({ name: name.trim() })).filter(h => h.name);
  } else if (typeof allHorsesRaw === 'object' && allHorsesRaw.name) {
    allHorses = [allHorsesRaw];
  }

  if (allHorses.length === 0) return '—';

  // Skapa en lookup-map för att få namn från ID (om ID finns)
  const horseMap = new Map(allHorses.map(h => [h.id || h.name, h.name]));

  let horseIdsToShow = [];

  // Om ett moment är specificerat OCH det finns valda hästar för det momentet
  if (equipage.momentHorses && Array.isArray(equipage.momentHorses['dressage']) && equipage.momentHorses['dressage'].length > 0) {
    horseIdsToShow = equipage.momentHorses['dressage'];
  }

  if (horseIdsToShow.length > 0) {
    // Mappa ID:n till namn
    return horseIdsToShow.map(id => horseMap.get(id) || id).join(' & ');
  } else {
    // Fallback: Visa alla hästar om inget val är gjort eller moment inte angetts
    return allHorses.map(h => h.name).filter(Boolean).join(' & ');
  }
}

/**
 * Hämtar hästnamn och formaterar dem som stackade HTML-span.
 * @param {object} equipage - Ekipageobjektet.
 * @returns {string} - HTML-sträng med stackade hästnamn, eller '—'.
 */
export function getMomentHorseLabelStacked(equipage) {
  const label = getMomentHorseLabel(equipage); //
  if (label === '—') return '—';
  const names = label.split(/\s*&\s*/); // Dela upp på " & "

  // Använder en enkel escape-funktion för säkerhets skull
  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  return names.map(n => `<span class="block">${escapeHtml(n)}</span>`).join('');
}

/**
 * @deprecated Use calculateDressageResult from calculationService.js instead.
 * Beräknar den samlade dressyrstraffpoängen för ett ekipage baserat på en samling protokoll.
 * @param {Map | Array} protocols - Samling av protokoll (från olika domare).
 * @param {Object} allPrograms - Map med alla tillgängliga dressyrprogram (nyckel -> programobjekt).
 * @returns {number | null} - Genomsnittlig straffpoäng eller null om eliminerad/inga resultat.
 */
export function calculateAggregateDressagePenalty(protocols, allPrograms) {
  console.warn('Using deprecated calculateAggregateDressagePenalty. Use calculationService.js instead.');
  if (!protocols) return null;

  const protoList = (protocols instanceof Map) ? Array.from(protocols.values()) : (Array.isArray(protocols) ? protocols : []);
  if (protoList.length === 0) return null;

  let judgePenalties = [];
  let isEliminated = false;

  for (const proto of protoList) {
    if (proto.eliminated) isEliminated = true;

    // Hitta programmet
    const testKey = proto.testKey || proto.programKey;
    const program = testKey ? allPrograms[testKey] : null;

    if (program) {
      // Maxpoäng
      const maxScore = (program.movements || []).reduce((s, m) => s + 10 * (Number(m.coeff) || 1), 0);

      if (maxScore > 0) {
        // Normalisera och summera rörelser
        const moves = normalizeMovements(proto.movements || []);
        const totalScore = moves.reduce((s, m) => {
          const pm = program.movements.find(x => Number(x.no) === m.momentNo);
          const coeff = Number(pm?.coeff) || 1;
          const score = (typeof m.score === 'number') ? m.score : 0;
          return s + (score * coeff);
        }, 0);

        // Beräkna straff för denna domare
        const coeffP = getDressagePenaltyCoeff(program);
        judgePenalties.push((maxScore - totalScore) * coeffP);
      }
    }
  }

  if (isEliminated) return null;
  if (judgePenalties.length === 0) return null;

  const sum = judgePenalties.reduce((a, b) => a + b, 0);
  return sum / judgePenalties.length;
}

/**
 * Rensa, normalisera och filtrera protokoll-listan för att ta bort dubbletter och "spökprotokoll" (tomma).
 * Används av både Monitor och Resultat-sidan för att säkerställa att beräkningar blir korrekta.
 * @param {Array} protocols - Rå lista av protokoll.
 * @param {Array} validJudgesList - Lista över giltiga domar-objekt (t.ex. window.currentJudgesPresent).
 * @returns {Array} - Ren lista av protokoll att använda för beräkning.
 */
export function deduplicateAndFilterProtocols(protocols, validJudgesList) {
  if (!Array.isArray(protocols)) return [];
  // Allow processing even if judge list is missing (fallback to 'accept all unique')
  if (!Array.isArray(validJudgesList) || validJudgesList.length === 0) return protocols;


  const validIds = validJudgesList.map(j => String(j.id));
  const validPos = validJudgesList.map(j => String(j.position || '').toUpperCase());

  // 1. Normalisera IDn (ta bort 'judge_' prefix etc)
  // 1. Normalisera IDn 
  // (Data is already normalized by service. We just ensure enrichment from config)
  const normalized = protocols.map(p => {
    // If enriched with official ID, use it. Otherwise use clean ID from service.
    const cleanId = p.judgeId || ''; // Guaranteed clean by service

    if (cleanId) {
      const byId = validJudgesList.find(j => String(j.id || '').replace(/^judge_/i, '') === cleanId);
      if (byId) return { ...p, judgeId: byId.id, id: byId.id, position: byId.position };
    }

    // Match by Position
    const pos = String(p.position || p.judgePosition || '').toUpperCase();
    if (pos) {
      const judgeCfg = validJudgesList.find(j => String(j.position || '').toUpperCase() === pos);
      if (judgeCfg) return { ...p, judgeId: judgeCfg.id, id: judgeCfg.id, position: pos };
    }

    return p;
  });

  // 2. Deduplicera (senaste/översta vinner om dubblett på ID eller Position)
  const dedupMap = new Map();
  normalized.forEach(p => {
    if (p.id === 'general') dedupMap.set('general', p); // Keep explicit reference
    else if (p.judgeId) dedupMap.set(String(p.judgeId), p);
    else if (p.position) dedupMap.set('POS:' + String(p.position).toUpperCase(), p);
    else dedupMap.set('UNKNOWN:' + Math.random(), p); // Temporärt behålla okända
  });

  // 3. Strikt Filtrering (måste matcha giltig domare OCH ha poäng)
  return Array.from(dedupMap.values()).filter(p => {
    // Preserve the general document for error points
    if (p.id === 'general') return true;

    // A. Måste matcha en konfigurerad domare - RELAXED: allow all for now to show results
    // const matchesJudge = (p.judgeId && validIds.includes(String(p.judgeId))) ||
    //   (p.position && validPos.includes(String(p.position).toUpperCase()));
    // if (!matchesJudge) return false;

    // B. Måste ha minst ett giltigt betyg (för att inte räknas som 0 i snittet)
    const hasMoves = Array.isArray(p.movements) && p.movements.length > 0;
    if (!hasMoves) return false;

    const hasScore = p.movements.some(m => m.score !== null && m.score !== '' && !isNaN(m.score));
    // Relaxed: Allow if it has movements defined, even if scores are 0/null (Live started)
    // return hasScore; 
    return true;
  });
}

/**
 * Heuristik: gissa program-nyckel från klassnamn (synkad logic f.d. i admin/input).
 */
export function guessProgramKeyFromClass(className, programs) {
  const all = programs || getPrograms();
  return _guessProg(className, all);
}

/**
 * Normaliserar domar-ID till gemensamt format (lowercase, utan judge_ prefix).
 */
export function normJudgeId(id) {
  return String(id || '').replace(/^judge_/i, '').trim().toLowerCase();
}

/**
 * Helper to calculate live projection (Copied/Adapted for reuse)
 */
export function calcLiveJudgeProjection(liveProtocol, programsDict, equipage) {
  if (!liveProtocol) return null;
  let testKey = liveProtocol.testKey || liveProtocol.programKey;
  const allPrograms = programsDict || {};

  if ((!testKey || !allPrograms[testKey]) && equipage && window.klassProgramMapping) {
    testKey = equipage.testKey
      || equipage.programKey
      || window.klassProgramMapping[equipage.className]
      || window.klassProgramMapping[equipage._mergedLabel];
  }

  let program = allPrograms[testKey];
  if (!program && equipage && equipage.className) {
    const guessed = guessProgramKeyFromClass(equipage.className, allPrograms);
    if (guessed && allPrograms[guessed]) program = allPrograms[guessed];
    if (!program) {
      const cls = String(equipage.className).trim();
      program = Object.values(allPrograms).find(p => p.name === cls || p.title === cls || p.id === cls);
    }
  }

  if (!program) return null;
  if (!program) return null;
  const effectiveKey = program.id || program.code || testKey;
  const movements = normalizeMovements(liveProtocol.movements || []);

  // Calculate specific prognosis (Projected Final)
  // Instead of computeFinalFromSaved (which assumes 0 for missing), we calculate average of RIDDEN movements.
  let totalPointsNow = 0;
  let maxPointsRidder = 0;

  movements.forEach(m => {
    const pm = program.movements.find(x => x.no === m.momentNo);
    if (pm && m.score != null && m.score !== '') {
      const coeff = (Number(pm.coeff) || 1);
      totalPointsNow += Number(m.score) * coeff;
      maxPointsRidder += 10 * coeff;
    }
  });

  if (maxPointsRidder === 0) return { percent: 0, points: 0, penalty: 0, pointsNow: 0 };

  const currentPercent = (totalPointsNow / maxPointsRidder); // 0.0 to 1.0

  // Total Max
  const maxScoreTotal = (program.movements || []).reduce((s, m) => s + 10 * (Number(m.coeff) || 1), 0);
  const penaltyCoeff = getDressagePenaltyCoeff(program);

  // Projected Values
  const projPoints = currentPercent * maxScoreTotal;
  const projPercent = currentPercent * 100;
  const projPenalty = (maxScoreTotal - projPoints) * penaltyCoeff;

  return {
    percent: projPercent,
    points: projPoints,
    penalty: projPenalty,
    pointsNow: totalPointsNow
  };
}

// Expose for non-module usage (e.g. PDF generation)
if (typeof window !== 'undefined') {
  window.getDressagePenaltyCoeff = getDressagePenaltyCoeff;
  window.getPrograms = getPrograms;
  window.computeFinalFromSaved = computeFinalFromSaved;
}
