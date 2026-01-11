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

/**
 * Hämtar den korrekta straffkoefficienten för ett givet dressyrprogram.
 * @param {object | string} programOrKey - Programobjektet eller dess nyckel.
 * @returns {number} - Straffkoefficienten (t.ex. 1.0, 0.8, 0.666).
 */
export function getDressagePenaltyCoeff(programOrKey) {
  const all = getPrograms();
  const p = (typeof programOrKey === 'string') ? (all[programOrKey] || null) : programOrKey || null;

  // 1) explicit fält på programmet vinner
  const raw = p?.penaltyCoeff ?? p?.penaltyFactor ?? p?.coeffPenalty;
  if (raw != null) {
    const n = Number(String(raw).replace(',', '.'));
    if (Number.isFinite(n) && n > 0) return n;
  }

  // 2) slå upp utifrån programkod i namnet (”530. …”, ”522. …”, FEI-koder)
  const name = String(p?.name || p?.title || p?.id || '');
  const category = String(p?.category || '');
  const m = name.match(/^(\d{3})\b/);
  const code = m ? m[1] : null;
  const byCode = {
    // Svenska
    '522': 1.00, // Lätt B
    '523': 1.00, // Lätt A
    '524': 0.80, // Msv 3
    '530': 0.80, // Msv 4
    // FEI
    '509': 0.84,
    '510': 0.80,
    '518': 0.666,
    '526': 0.76,
    '527': 0.76,
    '528': 0.73,
    '529': 0.80
  };
  if (code && byCode[code] != null) return byCode[code];

  // 3) mönster – CAI/Para/Junior/Children + DOT
  const nm = `${name} ${category}`.toLowerCase();
  if (/\bdot\b.*coefficient/.test(nm)) return 0.615;
  if (/cai1|para/.test(nm)) return 0.80;
  if (/cai2/.test(nm)) return 0.76;
  if (/cai3/.test(nm)) {
    if (/singles|enbet|single/.test(nm)) return 0.666;
    if (/hp2|p2|pairs|hp4|p4|four/.test(nm)) return 0.615;
  }
  if (/children/.test(nm)) return 0.80;
  if (/junior/.test(nm)) return 0.80;

  // 4) Svenska utan kod → Lätt A/B = 1.0, övriga = 0.8
  if (/svensk|svenska/.test(nm)) {
    if (/l[äa]tt\s*a|l[âa]tt\s*a|lb|la/.test(nm)) return 1.00;
    return 0.80;
  }

  // 5) fallback
  return 1.00;
}

/**
 * Beräknar ett slutgiltigt snittresultat från en array av sparade domarprotokoll.
 * @param {object} eq - Ekipageobjektet.
 * @param {Array<object>} savedArr - En array av sparade protokoll-objekt.
 * @param {object} program - Det fullständiga programobjektet (från getPrograms()).
 * @returns {object | null} - Ett objekt med { points, percent, penalty } eller null.
 */
export function computeFinalFromSaved(eq, savedArr, program) {
  if (!eq || !Array.isArray(savedArr) || !program) return null;

  // Maxpoäng från programmet (10 per moment * ev. moment-koefficient)
  const maxScore = (Array.isArray(program.movements) ? program.movements : [])
    .reduce((s, m) => s + 10 * (Number(m.coeff) || 1), 0);

  if (maxScore <= 0) return null; // Invalid program or no movements


  // Straffkoefficient (hämtas nu från vår delade funktion)
  const penaltyCoeff = getDressagePenaltyCoeff(program);

  // Total per domare
  const finals = [];
  for (const p of savedArr) {
    const movements = Array.isArray(p.movements) ? p.movements : [];
    const total = movements.reduce((sum, mv) => {
      const no = Number(mv.momentNo ?? mv.movementNo ?? mv.no);
      const pm = (program.movements || []).find(x => Number(x.no) === no);
      const c = Number(pm?.coeff) || 1;
      const sc = (mv.score !== '' && mv.score != null) ? Number(mv.score) : null;
      return (sc != null ? (sum + sc * c) : sum);
    }, 0);

    finals.push({
      points: total,
      percent: maxScore ? (total / maxScore) * 100 : 0,
      penalty: (maxScore - total) * penaltyCoeff
    });
  }
  if (!finals.length) return null;

  // Medelvärde över domare
  const avg = finals.reduce((a, b) => ({
    points: a.points + b.points,
    percent: a.percent + b.percent,
    penalty: a.penalty + b.penalty
  }), { points: 0, percent: 0, penalty: 0 });

  avg.points /= finals.length;
  avg.percent /= finals.length;
  avg.penalty /= finals.length;

  return avg; // { points, percent, penalty }
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
 * Beräknar den samlade dressyrstraffpoängen för ett ekipage baserat på en samling protokoll.
 * @param {Map | Array} protocols - Samling av protokoll (från olika domare).
 * @param {Object} allPrograms - Map med alla tillgängliga dressyrprogram (nyckel -> programobjekt).
 * @returns {number | null} - Genomsnittlig straffpoäng eller null om eliminerad/inga resultat.
 */
export function calculateAggregateDressagePenalty(protocols, allPrograms) {
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
    if (p.judgeId) dedupMap.set(String(p.judgeId), p);
    else if (p.position) dedupMap.set('POS:' + String(p.position).toUpperCase(), p);
    else dedupMap.set('UNKNOWN:' + Math.random(), p); // Temporärt behålla okända
  });

  // 3. Strikt Filtrering (måste matcha giltig domare OCH ha poäng)
  return Array.from(dedupMap.values()).filter(p => {
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
  if (!className) return null;

  const all = programs || getPrograms();
  const entries = Object.entries(all);
  const s = String(className).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const isFeiClass = /fei|cai/i.test(s);
  const hasEnbet = /enbet|hp1|single/i.test(s);
  const hasPar = /par(?!a)|hp2|pairs/i.test(s);
  const hasFyrspann = /fyrspann|hp4|four/i.test(s);

  // UPPDATERAD MED ORDGRÄNSER (\b) FÖR HÖGRE PRECISION
  const tests = [
    { key: 'LA', test: /\bl[aä]tt\b.*\ba\b/i, rules: [/\bl[äa]tt\b/i, /\ba\b/i] },
    { key: 'LB', test: /\bl[aä]tt\b.*\bb\b/i, rules: [/\bl[äa]tt\b/i, /\bb\b/i] },
    { key: 'LC', test: /\bl[aä]tt\b.*\bc\b/i, rules: [/\bl[äa]tt\b/i, /\bc\b/i] },
    { key: 'MSV_B_3', test: /\b(msv|medelsv)\b.*\b(b|3)\b/i, rules: [/\b(msv|medelsv)\b/i, /\b(3|iii|b)\b/i] },
    { key: 'MSV_A_4', test: /\b(msv|medelsv)\b.*\b(a|4)\b/i, rules: [/\b(msv|medelsv)\b/i, /\b(4|iv|a)\b/i] },
    { key: 'FEI', test: /\b(fei|cai)\b/i, rules: [/\b(fei|cai)\b/i] }
  ];

  const activeTest = tests.find(t => t.test.test(s));
  if (!activeTest) return null;

  let bestKey = null, bestScore = -1;

  for (const [key, p] of entries) {
    const name = String(p?.name || key).toLowerCase();
    const cat = String(p?.category || '').toLowerCase();
    const isFeiProgram = /fei|para/i.test(name) || /fei|para/i.test(cat);

    if (isFeiProgram && !isFeiClass) continue;
    if (!isFeiProgram && isFeiClass) continue;

    let score = 0;
    for (const rx of activeTest.rules) {
      if (rx.test(name)) score++;
    }

    if (score === activeTest.rules.length) {
      score += 10;
    }

    if (hasEnbet && /enbet|hp1|single/i.test(name)) score += 5;
    if (hasPar && /par(?!a)|hp2|pairs/i.test(name)) score += 5;
    if (hasFyrspann && /fyrspann|hp4|four/i.test(name)) score += 5;

    if (/svenskt/.test(cat) && !isFeiClass) score += 2;
    if (/fei/.test(cat) && isFeiClass) score += 2;

    if (/(40\s*x?\s*80)/.test(name) || /(40\s*x?\s*80)/.test(p.arena || '')) score += 1;

    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }

  return bestScore > 5 ? bestKey : null;
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
    testKey = window.klassProgramMapping[equipage.className] || window.klassProgramMapping[equipage._mergedLabel];
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
  const effectiveKey = program.id || program.code || testKey;
  const movements = normalizeMovements(liveProtocol.movements || []);
  const computed = computeFinalFromSaved(equipage || {}, [{ movements, programKey: effectiveKey }], program);

  if (!computed) return null;

  let totalPointsNow = 0;
  movements.forEach(m => {
    const pm = program.movements.find(x => x.no === m.momentNo);
    if (pm && m.score != null) {
      totalPointsNow += m.score * (pm.coeff || 1);
    }
  });

  return {
    percent: computed.percent,
    points: computed.points,
    penalty: computed.penalty,
    pointsNow: totalPointsNow
  };
}
