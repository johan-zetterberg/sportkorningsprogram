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
  "FEI Junior 2*": { maraton: 240, precision: 240 },
  "FEI U25 2*": { maraton: 250, precision: 250 },
  "FEI 1* Häst": { maraton: 240, precision: 250 }, "FEI 1* Ponny": { maraton: 230, precision: 260 },
  "FEI 2* Enbet Häst": { maraton: 250, precision: 250 }, "FEI 2* Par Häst": { maraton: 250, precision: 250 },
  "FEI 2* Enbet Ponny": { maraton: 240, precision: 260 }, "FEI 2* Par Ponny": { maraton: 240, precision: 250 },
  "FEI 3* Enbet Häst": { maraton: 260, precision: 250 }, "FEI 3* Par Häst": { maraton: 260, precision: 250 },
  "FEI 3* Fyrspann Häst": { maraton: 250, precision: 240 }, "FEI 3* Enbet Ponny": { maraton: 250, precision: 260 },
  "FEI 3* Par Ponny": { maraton: 250, precision: 250 }, "FEI 3* Fyrspann Ponny": { maraton: 240, precision: 240 }
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

// Centralt hjälpmedel: matcha ett faktiskt klassnamn mot TR-tabellen
export function resolveStandardPortAllowance(className) {
  if (!className) return standardPortAllowance['*'] || 35;

  const normalize = (str) =>
    String(str).replace(/^[\d\s\.,&\;-]+/, '').toLowerCase().replace(/[^a-z0-9åäö]/g, '');

  const normalized = normalize(className);
  const keys = Object.keys(standardPortAllowance).filter(k => k !== '*');

  // 1) exakt normaliserad match (ovanligt men billigt)
  const exact = keys.find(k => normalize(k) === normalized);
  if (exact) return standardPortAllowance[exact];

  // 2) TR-nyckel är prefix till klassnamnet (vanligaste fallet)
  const prefix = keys
    .filter(k => normalized.startsWith(normalize(k)))
    .sort((a, b) => normalize(b).length - normalize(a).length)[0];
  if (prefix) return standardPortAllowance[prefix];

  // 3) TR-nyckel finns någonstans i namnet (t.ex. "Msv Para", "Svår enbet")
  const contains = keys
    .filter(k => normalized.includes(normalize(k)))
    .sort((a, b) => normalize(b).length - normalize(a).length)[0];
  if (contains) return standardPortAllowance[contains];

  // 4) Fallback om inget vettigt hittas
  return standardPortAllowance['*'] || 35;
}
