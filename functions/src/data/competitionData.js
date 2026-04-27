// data/competitionData.js
// Version 2.1 - Uppdaterad till att använda TDB:s sifferbenämningar (MSV 3, MSV 4 etc.) för konsekvens.

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
        "Lätt A Para Grad 1 Häst",
        "Lätt A Para Grad 1 Ponny",
        "MSV 3 Para Grad 2 Häst", // MSV B
        "MSV 3 Para Grad 2 Ponny",
        "MSV 4 Para Grad 2 Häst", // MSV A
        "MSV 4 Para Grad 2 Ponny",
        "Svår Para Grad 2 Häst",
        "Svår Para Grad 2 Ponny"
    ],
    "Barnklasser": [
        "Lätt C Barn Ponny",
        "Lätt B Barn Ponny",
        "Lätt A Barn Ponny"
    ],
    "Internationell (FEI)": [
        "FEI Children 1*",
        "FEI Junior 2*",
        "FEI U25 3*",
        "FEI 1* Häst", "FEI 1* Ponny",
        "FEI 2* Enbet Häst", "FEI 2* Par Häst", "FEI 2* Enbet Ponny", "FEI 2* Par Ponny",
        "FEI 3* Enbet Häst", "FEI 3* Par Häst", "FEI 3* Fyrspann Häst",
        "FEI 3* Enbet Ponny", "FEI 3* Par Ponny", "FEI 3* Fyrspann Ponny"
    ]
};

export const klassProgramMapping = {
    // Lätta klasser
    "Lätt C Enbet Ponny": 'SvLC',
    "Lätt C Enbet Häst": 'SvLC',
    "Lätt B Enbet Ponny": 'SvLB',
    "Lätt B Enbet Häst": 'SvLB',
    "Lätt A Enbet Ponny": 'SvLA',
    "Lätt A Enbet Häst": 'SvLA',
    "Lätt A Par Ponny": 'SvLA',
    "Lätt A Par Häst": 'SvLA',
    // Medelsvåra klasser
    "MSV 2 Enbet Ponny": 'SvMSVC',
    "MSV 2 Enbet Häst": 'SvMSVC',
    "MSV 3 Enbet Ponny": 'SvMSVB',
    "MSV 3 Enbet Häst": 'SvMSVB',
    "MSV 3 Par Ponny": 'SvMSVB',
    "MSV 3 Par Häst": 'SvMSVB',
    "MSV 4 Enbet Ponny": 'FEI3AHP1',
    "MSV 4 Enbet Häst": 'FEI3AHP1', // Not: Antar samma program som ponny för enkelhetens skull, kan behöva justeras
    "MSV 4 Par Ponny": 'FEI3BHP24',
    "MSV 4 Par Häst": 'FEI3BHP24',
    // Svåra klasser
    "Svår Enbet Ponny": 'FEI3AHP1',
    "Svår Enbet Häst": 'FEI4HP1',
    "Svår Par Ponny": 'FEI3BHP24',
    "Svår Par Häst": 'FEI4HP24',
    // Barnklasser
    "Lätt C Barn Ponny": 'SvLC',
    "Lätt B Barn Ponny": 'SvLB',
    "Lätt A Barn Ponny": 'SvLA',
    // Fyrspann
    "MSV Fyrspann Ponny": 'FEI3BHP24',
    "MSV Fyrspann Häst": 'FEI3BHP24',
    "Svår Fyrspann Ponny": 'FEI4HP24',
    "Svår Fyrspann Häst": 'FEI4HP24',

    // NYTT: Mappning för Paraklasser
    "Lätt A Para Grad 1 Häst": 'FEIParaG1',
    "Lätt A Para Grad 1 Ponny": 'FEIParaG1',
    "MSV 3 Para Grad 2 Häst": 'FEIParaG2',
    "MSV 3 Para Grad 2 Ponny": 'FEIParaG2',
    "MSV 4 Para Grad 2 Häst": 'FEIParaG2',
    "MSV 4 Para Grad 2 Ponny": 'FEIParaG2',
    "Svår Para Grad 2 Häst": 'FEIParaG2',
    "Svår Para Grad 2 Ponny": 'FEIParaG2'
};

export const klassTempoData = {
    // --- LÄTTA KLASSER ---
    "Lätt C Enbet Ponny": { maraton: 220, precision: 190 },
    "Lätt C Enbet Häst": { maraton: 230, precision: 200 },
    "Lätt B Enbet Ponny": { maraton: 220, precision: 190 },
    "Lätt B Enbet Häst": { maraton: 230, precision: 200 },
    "Lätt A Enbet Ponny": { maraton: 220, precision: 200 },
    "Lätt A Enbet Häst": { maraton: 230, precision: 220 },
    "Lätt A Par Ponny": { maraton: 220, precision: 200 },
    "Lätt A Par Häst": { maraton: 230, precision: 220 },

    // --- MEDELSVÅRA KLASSER ---
    "MSV 2 Enbet Ponny": { maraton: 230, precision: 220 }, // MSV C
    "MSV 2 Enbet Häst": { maraton: 240, precision: 230 },
    "MSV 3 Enbet Ponny": { maraton: 240, precision: 220 }, // MSV B
    "MSV 3 Enbet Häst": { maraton: 250, precision: 230 },
    "MSV 3 Par Ponny": { maraton: 240, precision: 220 },
    "MSV 3 Par Häst": { maraton: 250, precision: 230 },
    "MSV 4 Enbet Ponny": { maraton: 240, precision: 220 }, // MSV A
    "MSV 4 Enbet Häst": { maraton: 250, precision: 230 },
    "MSV 4 Par Ponny": { maraton: 240, precision: 220 },
    "MSV 4 Par Häst": { maraton: 250, precision: 230 },

    // --- SVÅRA KLASSER ---
    "Svår Enbet Ponny": { maraton: 250, precision: 220 },
    "Svår Enbet Häst": { maraton: 260, precision: 230 },
    "Svår Par Ponny": { maraton: 250, precision: 220 },
    "Svår Par Häst": { maraton: 260, precision: 230 },

    // --- FYRSPANN ---
    "MSV Fyrspann Ponny": { maraton: 230, precision: 220 },
    "MSV Fyrspann Häst": { maraton: 240, precision: 230 },
    "Svår Fyrspann Ponny": { maraton: 240, precision: 220 },
    "Svår Fyrspann Häst": { maraton: 250, precision: 230 },

    // --- PARAKLASSER ---
    "Lätt A Para Grad 1 Häst": { maraton: 220, precision: 150 },
    "Lätt A Para Grad 1 Ponny": { maraton: 200, precision: 150 },
    "MSV 3 Para Grad 2 Häst": { maraton: 240, precision: 180 }, // MSV B
    "MSV 3 Para Grad 2 Ponny": { maraton: 220, precision: 180 },
    "MSV 4 Para Grad 2 Häst": { maraton: 240, precision: 180 }, // MSV A
    "MSV 4 Para Grad 2 Ponny": { maraton: 220, precision: 180 },
    "Svår Para Grad 2 Häst": { maraton: 240, precision: 180 },
    "Svår Para Grad 2 Ponny": { maraton: 220, precision: 180 },

    // --- BARNKLASSER ---
    "Lätt C Barn Ponny": { maraton: 200, precision: 180 },
    "Lätt B Barn Ponny": { maraton: 200, precision: 180 },
    "Lätt A Barn Ponny": { maraton: 220, precision: 200 },

    // --- FEI KLASSER ---
    "FEI Children 1*": { maraton: 230, precision: 230 },
    "FEI Junior 2*": { maraton: 240, precision: 230 },
    "FEI U25 3*": { maraton: 250, precision: 230 },
    "FEI 1* Häst": { maraton: 240, precision: 230 }, "FEI 1* Ponny": { maraton: 230, precision: 230 },
    "FEI 2* Enbet Häst": { maraton: 250, precision: 230 }, "FEI 2* Par Häst": { maraton: 250, precision: 230 },
    "FEI 2* Enbet Ponny": { maraton: 240, precision: 230 }, "FEI 2* Par Ponny": { maraton: 240, precision: 230 },
    "FEI 3* Enbet Häst": { maraton: 260, precision: 230 }, "FEI 3* Par Häst": { maraton: 260, precision: 230 },
    "FEI 3* Fyrspann Häst": { maraton: 250, precision: 230 }, "FEI 3* Enbet Ponny": { maraton: 250, precision: 230 },
    "FEI 3* Par Ponny": { maraton: 250, precision: 230 }, "FEI 3* Fyrspann Ponny": { maraton: 240, precision: 230 }
};

export const standardPortAllowance = {
    // LB
    'LB "Barn"': 45,
    'Lätt B Barn': 45,
    'LB': 35,
    'Lätt B': 35,

    // LA
    'LA "Barn"': 45,
    'Lätt A Barn': 45,
    'LA CH': 45,
    'Lätt A CH': 45,
    'LA "J"': 30,
    'LA "U25"': 30,
    'Lätt A J': 30,
    'Lätt A U25': 30,
    'LA': 30,
    'Lätt A': 30,

    // MSV
    'MSV "PARA"': 25,
    'Msv Para': 25,
    'MSV "CH"': 40,
    'Msv CH': 40,
    'MSV "J"': 25,
    'MSV "U25"': 25,
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

    // fallback
    '*': 35
};

export function resolveStandardPortAllowance(className) {
    if (!className) return standardPortAllowance['*'] || 35;

    const normalize = (str) =>
        String(str).toLowerCase().replace(/[^a-z0-9åäö]/g, '');

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
