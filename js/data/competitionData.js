// data/competitionData.js
// Version 2.1 - Uppdaterad till att använda TDB:s sifferbenämningar (MSV 3, MSV 4 etc.) för konsekvens.

/**
 * Grupperar alla tillgängliga tävlingsklasser med TDB-benämningar.
 */
export const competitionClasses = {
  "Lätta klasser": [
    "Lätt C Enbet Ponny",
    "Lätt C Enbet Häst",
    "Lätt B Enbet Ponny",
    "Lätt B Enbet Häst",
    "Lätt A Enbet Ponny",
    "Lätt A Enbet Häst",
    "Lätt A Par Ponny",
    "Lätt A Par Häst"
  ],
  "Medelsvåra klasser": [
    "MSV 2 Enbet Ponny", // MSV C
    "MSV 2 Enbet Häst",
    "MSV 3 Enbet Ponny", // MSV B
    "MSV 3 Enbet Häst",
    "MSV 3 Par Ponny",
    "MSV 3 Par Häst",
    "MSV 4 Enbet Ponny", // MSV A
    "MSV 4 Enbet Häst",
    "MSV 4 Par Ponny",
    "MSV 4 Par Häst"
  ],
  "Svåra klasser": [
    "Svår Enbet Ponny",
    "Svår Enbet Häst",
    "Svår Par Ponny",
    "Svår Par Häst"
  ],
  "Fyrspann": [
    "MSV Fyrspann Ponny",
    "MSV Fyrspann Häst",
    "Svår Fyrspann Ponny",
    "Svår Fyrspann Häst"
  ],
  "Paraklasser": [
    "Lätt A Para Häst",
    "Lätt A Para Ponny",
    "Msv Para Häst",
    "Msv Para Ponny",
    "Svår Para Häst",
    "Svår Para Ponny"
  ],
  "Barnklasser": [
    "Lätt C Barn Ponny",
    "Lätt B Barn Ponny",
    "Lätt A Barn Ponny"
  ],
  "Internationell (FEI)": [
    "FEI Children 1*",
    "FEI Junior 2*",
    "FEI U25 2*",
    "FEI 1* Häst", "FEI 1* Ponny",
    "FEI 2* Enbet Häst", "FEI 2* Par Häst", "FEI 2* Enbet Ponny", "FEI 2* Par Ponny",
    "FEI 3* Enbet Häst", "FEI 3* Par Häst", "FEI 3* Fyrspann Häst",
    "FEI 3* Enbet Ponny", "FEI 3* Par Ponny", "FEI 3* Fyrspann Ponny"
  ]
};

/**
 * Mappar en tävlingsklass till ett specifikt dressyrprogram-ID.
 */
export const klassProgramMapping = {
  // Lätta klasser
  "Lätt C Enbet Ponny": 'SvLB',
  "Lätt C Enbet Häst": 'SvLB',
  "Lätt B Enbet Ponny": 'SvLB',
  "Lätt B Enbet Häst": 'SvLB',
  "Lätt A Enbet Ponny": 'SvLA',
  "Lätt A Enbet Häst": 'SvLA',
  "Lätt A Par Ponny": 'SvLA',
  "Lätt A Par Häst": 'SvLA',
  // Medelsvåra klasser
  "MSV 2 Enbet Ponny": 'SvMsvC',
  "MSV 2 Enbet Häst": 'SvMsvC',
  "MSV 3 Enbet Ponny": 'SvMsvB',
  "MSV 3 Enbet Häst": 'SvMsvB',
  "MSV 3 Par Ponny": 'SvMsvB',
  "MSV 3 Par Häst": 'SvMsvB',
  "MSV 4 Enbet Ponny": 'sv_msv_4_enb_2025',
  "MSV 4 Enbet Häst": 'sv_msv_4_enb_2025',
  "MSV 4 Par Ponny": 'sv_msv_4_par_2025',
  "MSV 4 Par Häst": 'sv_msv_4_par_2025',
  // Svåra klasser
  "Svår Enbet Ponny": 'FEI3AHP1',
  "Svår Enbet Häst": 'FEI3AHP1',
  "Svår Par Ponny": 'FEI_3star_HP2_P2_2025',
  "Svår Par Häst": 'FEI_3star_HP2_P2_2025',
  // Barnklasser
  "Lätt C Barn Ponny": 'SvLB',
  "Lätt B Barn Ponny": 'SvLB',
  "Lätt A Barn Ponny": 'SvLA',
  // Fyrspann
  "MSV Fyrspann Ponny": 'sv_msv_4_par_2025',
  "MSV Fyrspann Häst": 'sv_msv_4_par_2025',
  "Svår Fyrspann Ponny": 'FEI_3star_HP4_2025',
  "Svår Fyrspann Häst": 'FEI_3star_B_HP4_2022',

  // Paraklasser
  "Lätt A Para Häst": 'FEIParaG1',
  "Lätt A Para Ponny": 'FEIParaG1',
  "Msv Para Häst": 'FEIParaG2',
  "Msv Para Ponny": 'FEIParaG2',
  "Svår Para Häst": 'FEIParaG2',
  "Svår Para Ponny": 'FEIParaG2',

  // Internationell (FEI)
  "FEI Children 1*": 'FEI_Children_2025_sv',
  "FEI Junior 2*": 'FEI_Junior_2025',
  "FEI U25 2*": 'FEI_2star_HP2_2024',
  "FEI 1* Häst": 'FEI_CAI1_Para',
  "FEI 1* Ponny": 'FEI_CAI1_Para',
  "FEI 2* Enbet Häst": 'FEI_2star_2021',
  "FEI 2* Par Häst": 'FEI_2star_HP2_2024',
  "FEI 2* Enbet Ponny": 'FEI_2star_2021',
  "FEI 2* Par Ponny": 'FEI_2star_HP2_2024',
  "FEI 3* Enbet Häst": 'FEI3AHP1',
  "FEI 3* Par Häst": 'FEI_3star_HP2_P2_2025',
  "FEI 3* Fyrspann Häst": 'FEI_3star_B_HP4_2022',
  "FEI 3* Enbet Ponny": 'FEI3AHP1',
  "FEI 3* Par Ponny": 'FEI_3star_HP2_P2_2025',
  "FEI 3* Fyrspann Ponny": 'FEI_3star_HP4_2025'
};

/**
 * Definierar tempon (m/min) för precision och maraton (Sträcka E).
 */
export const klassTempoData = {
  // --- LÄTTA KLASSER (TR V 2025 Bilaga 5) ---
  "Lätt C Enbet Ponny": { maraton: 220, precision: 160 },
  "Lätt C Enbet Häst": { maraton: 230, precision: 180 },
  "Lätt B Enbet Ponny": { maraton: 220, precision: 160 },
  "Lätt B Enbet Häst": { maraton: 230, precision: 180 },
  "Lätt A Enbet Ponny": { maraton: 220, precision: 200 },
  "Lätt A Enbet Häst": { maraton: 230, precision: 210 },
  "Lätt A Par Ponny": { maraton: 220, precision: 200 },
  "Lätt A Par Häst": { maraton: 230, precision: 210 },

  // --- MEDELSVÅRA KLASSER (TR V 2025 Bilaga 5) ---
  "MSV 2 Enbet Ponny": { maraton: 230, precision: 230 }, // MSV C
  "MSV 2 Enbet Häst": { maraton: 240, precision: 230 },
  "MSV 3 Enbet Ponny": { maraton: 240, precision: 230 }, // MSV B
  "MSV 3 Enbet Häst": { maraton: 250, precision: 230 },
  "MSV 3 Par Ponny": { maraton: 240, precision: 230 },
  "MSV 3 Par Häst": { maraton: 250, precision: 230 },
  "MSV 4 Enbet Ponny": { maraton: 240, precision: 230 }, // MSV A
  "MSV 4 Enbet Häst": { maraton: 250, precision: 230 },
  "MSV 4 Par Ponny": { maraton: 240, precision: 230 },
  "MSV 4 Par Häst": { maraton: 250, precision: 230 },

  // --- SVÅRA KLASSER (TR V 2025 Bilaga 5 / FEI Art 975) ---
  "Svår Enbet Ponny": { maraton: 250, precision: 260 },
  "Svår Enbet Häst": { maraton: 260, precision: 250 },
  "Svår Par Ponny": { maraton: 250, precision: 250 },
  "Svår Par Häst": { maraton: 260, precision: 250 },

  // --- FYRSPANN (TR V 2025 Bilaga 5 / FEI Art 975) ---
  "MSV Fyrspann Ponny": { maraton: 230, precision: 230 },
  "MSV Fyrspann Häst": { maraton: 240, precision: 230 },
  "Svår Fyrspann Ponny": { maraton: 240, precision: 240 },
  "Svår Fyrspann Häst": { maraton: 250, precision: 240 },

  // --- PARAKLASSER (TR V 2025 Bilaga 5) ---
  "Lätt A Para Häst": { maraton: 220, precision: 210 },
  "Lätt A Para Ponny": { maraton: 200, precision: 200 },
  "Msv Para Häst": { maraton: 240, precision: 220 },
  "Msv Para Ponny": { maraton: 220, precision: 210 },
  "Svår Para Häst": { maraton: 240, precision: 230 },
  "Svår Para Ponny": { maraton: 220, precision: 230 },

  // --- BARNKLASSER (TR V 2025 Bilaga 5) ---
  "Lätt C Barn Ponny": { maraton: 200, precision: 100 },
  "Lätt B Barn Ponny": { maraton: 200, precision: 100 },
  "Lätt A Barn Ponny": { maraton: 220, precision: 180 },

  // --- FEI KLASSER (FEI 2026 Art 975.10.5 & 978.3) ---
  "FEI Children 1*": { maraton: 230, precision: 220 }, // FEI 974.1: Children cones 220 m/min
  // Hitch and horse/pony unknown: 250, the FEI 975.10.5 speed of pairs and
  // horse singles (240 is four-in-hand only, 260 single ponies)
  "FEI Junior 2*": { maraton: 240, precision: 250 },
  "FEI U25 2*": { maraton: 250, precision: 250 },
  "FEI 1* Häst": { maraton: 240, precision: 250 }, "FEI 1* Ponny": { maraton: 230, precision: 260 },
  "FEI 2* Enbet Häst": { maraton: 250, precision: 250 }, "FEI 2* Par Häst": { maraton: 250, precision: 250 },
  "FEI 2* Enbet Ponny": { maraton: 240, precision: 260 }, "FEI 2* Par Ponny": { maraton: 240, precision: 250 },
  "FEI 3* Enbet Häst": { maraton: 260, precision: 250 }, "FEI 3* Par Häst": { maraton: 260, precision: 250 },
  "FEI 3* Fyrspann Häst": { maraton: 250, precision: 240 }, "FEI 3* Enbet Ponny": { maraton: 250, precision: 260 },
  "FEI 3* Par Ponny": { maraton: 250, precision: 250 }, "FEI 3* Fyrspann Ponny": { maraton: 240, precision: 240 },

  // --- PER NIVÅ OCH HÄST/PONNY (TR V 2025 Bilaga 5, Fas 1) ---
  // Classes without a row of their own ("Msv Enbet Ponny", "Lätt B Par Ponny",
  // "Svår J Enbet Ponny"): the precision tempo depends on level and horse/pony
  // only (and for Svår also the hitch, which has its own rows above); the
  // hitch word is skipped when matching (getClassTempoMpm)
  "Lätt C Ponny": { precision: 160 }, "Lätt C Häst": { precision: 180 },
  "Lätt B Ponny": { precision: 160 }, "Lätt B Häst": { precision: 180 },
  "Lätt A Ponny": { precision: 200 }, "Lätt A Häst": { precision: 210 },
  "Lätt A J Ponny": { precision: 200 }, "Lätt A J Häst": { precision: 210 },
  "Lätt A U25 Ponny": { precision: 200 }, "Lätt A U25 Häst": { precision: 210 },
  "Msv Ponny": { precision: 230 }, "Msv Häst": { precision: 230 },
  "Msv J Ponny": { precision: 230 }, "Msv J Häst": { precision: 230 },
  "Msv U25 Ponny": { precision: 230 }, "Msv U25 Häst": { precision: 230 },
  "Svår J Ponny": { precision: 260 }, "Svår J Häst": { precision: 250 },
  "Svår U25 Ponny": { precision: 260 }, "Svår U25 Häst": { precision: 250 },
  // FEI 974.1 table: Children cones 220 m/min, horse or pony, any hitch
  "CAI Children": { precision: 220 }, "FEI Children": { precision: 220 }
};

/**
 * Definierar tillåten extra bredd på portar i precisionen.
 */
export const standardPortAllowance = {
  // LC & LB (fyrspann har +10 cm per TR Bilaga 5 fotnot *)
  'LC "Barn"': 45,
  'Lätt C Barn': 45,
  'LC Fyrspann': 45,
  'Lätt C Fyrspann': 45,
  'LC': 35,
  'Lätt C': 35,
  'LB "Barn"': 45,
  'Lätt B Barn': 45,
  'LB Fyrspann': 45,
  'Lätt B Fyrspann': 45,
  'LB': 35,
  'Lätt B': 35,

  // LA (fyrspann har +10 cm per TR Bilaga 5 fotnot *)
  'LA "Barn"': 45,
  'Lätt A Barn': 45,
  'LA CH': 45,
  'Lätt A CH': 45,
  'LA "PARA"': 30,
  'Lätt A Para': 30,
  'LA "J"': 30,
  'LA "U25"': 30,
  'Lätt A J': 30,
  'Lätt A U25': 30,
  'LA Fyrspann': 40,
  'Lätt A Fyrspann': 40,
  'LA': 30,
  'Lätt A': 30,

  // MSV (fyrspann har +10 cm per TR Bilaga 5 fotnot *)
  'MSV "PARA"': 25,
  'Msv Para': 25,
  'MSV "CH"': 40,
  'Msv CH': 40,
  'MSV "J"': 25,
  'MSV "U25"': 25,
  'MSV Fyrspann': 35,
  'Msv Fyrspann': 35,
  'Medelsvår Fyrspann': 35,
  'Msv': 25,
  'Medelsvår': 25,

  // SVÅR
  'Svår "PARA"': 20,
  'Svår Para': 20,
  'Svår "J"': 20,
  'Svår "U25"': 20,
  'Svår enbet': 20,
  'Svår par': 20,
  'Svår fyrspann': 25,

  // FEI: the other FEI classes have fixed cone widths (FEI 974.1, see
  // FEI_STANDARD_CONES_WIDTH in precisionUtils.js), not track width + allowance
  'FEI Children': 20,

  // fallback
  '*': 35
};

// A class name as words: "LB "Barn"" -> ['lb', 'barn']. The children's class
// ("Barnklass", "Barnklass Ponny", "Lätt B Barnklass") is driven in Lätt B
// (TR V 509.2): "barnklass" counts as "barn", and without a level Lätt B
// Abbreviations as the words they stand for, so "LB Barn" and "Lätt B Barn" match alike
const WORD_ALIASES = {
  barnklass: ['barn'], lb: ['lätt', 'b'], la: ['lätt', 'a'], lc: ['lätt', 'c'], latt: ['lätt'],
  medelsvår: ['msv'], medelsvar: ['msv'], svar: ['svår']
};
const LEVEL_WORDS = new Set(['lätt', 'msv', 'svår', 'fei', 'cai']);
export function classNameWords(name) {
  const words = String(name ?? '')
    .replace(/^[\d\s\.,&\;-]+/, '')
    .toLowerCase()
    .split(/[^a-z0-9åäö]+/)
    .filter(Boolean)
    .flatMap(w => WORD_ALIASES[w] || [w]);
  if (words.includes('barn') && !words.some(w => LEVEL_WORDS.has(w))) return ['lätt', 'b', ...words];
  return words;
}

const startsWithWords = (words, prefix) => prefix.length > 0 && prefix.length <= words.length
  && prefix.every((w, i) => words[i] === w);
const containsWords = (words, part) => {
  for (let i = 0; i + part.length <= words.length; i++) {
    if (startsWithWords(words.slice(i), part)) return true;
  }
  return false;
};

/**
 * The table key (TR Bilaga 5 tables) a class name belongs to: the same words,
 * else the longest key the name starts with, else the longest key found in
 * the name. Keys match whole words only, so a short key ("LA") never matches
 * inside a word ("Barnklass").
 */
export function matchClassTableKey(className, keys = []) {
  const words = classNameWords(className);
  if (!words.length) return null;
  const table = keys.map(k => ({ k, w: classNameWords(k) })).filter(x => x.w.length > 0);
  const same = table.find(x => x.w.length === words.length && startsWithWords(words, x.w));
  if (same) return same.k;
  const longest = (list) => list.sort((a, b) => b.w.length - a.w.length)[0]?.k || null;
  return longest(table.filter(x => startsWithWords(words, x.w)))
    || longest(table.filter(x => containsWords(words, x.w)));
}

// Centralt hjälpmedel: matcha ett faktiskt klassnamn mot TR-tabellen
export function resolveStandardPortAllowance(className) {
  if (!className) return standardPortAllowance['*'] || 35;
  const keys = Object.keys(standardPortAllowance).filter(k => k !== '*');
  const key = matchClassTableKey(className, keys);
  if (key) return standardPortAllowance[key];
  // Fallback om inget vettigt hittas
  return standardPortAllowance['*'] || 35;
}
