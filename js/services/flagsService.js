export function normalizeCountryCode(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  if (code.length === 2) return code.toLowerCase();
  const map = {
    // Norden
    'SWE': 'se', 'SVERIGE': 'se',
    'DEN': 'dk', 'DANMARK': 'dk',
    'NOR': 'no', 'NORGE': 'no',
    'FIN': 'fi', 'FINLAND': 'fi',
    'ISL': 'is', 'ISLAND': 'is',

    // Västeuropa
    'GER': 'de', 'TYSKLAND': 'de',
    'FRA': 'fr', 'FRANKRIKE': 'fr',
    'GBR': 'gb', 'STORBRITANNIEN': 'gb', 'STORBRITANNIEN OCH NORDIRLAND': 'gb',
    'IRL': 'ie', 'IRLAND': 'ie',
    'NED': 'nl', 'NEDERLÄNDERNA': 'nl', 'HOLLAND': 'nl',
    'BEL': 'be', 'BELGIEN': 'be',
    'LUX': 'lu', 'LUXEMBURG': 'lu',
    'SUI': 'ch', 'SCHWEIZ': 'ch',
    'AUT': 'at', 'ÖSTERRIKE': 'at',
    'LIE': 'li', 'LIECHTENSTEIN': 'li',
    'MON': 'mc', 'MONACO': 'mc',

    // Sydeuropa
    'ESP': 'es', 'SPANIEN': 'es',
    'POR': 'pt', 'PORTUGAL': 'pt',
    'ITA': 'it', 'ITALIEN': 'it',
    'GRE': 'gr', 'GREKLAND': 'gr',
    'MLT': 'mt', 'MALTA': 'mt',
    'CYP': 'cy', 'CYPERN': 'cy',
    'AND': 'ad', 'ANDORRA': 'ad',
    'SMR': 'sm', 'SAN MARINO': 'sm',
    'VAT': 'va', 'VATIKANSTATEN': 'va',

    // Öst- och Centraleuropa
    'POL': 'pl', 'POLEN': 'pl',
    'CZE': 'cz', 'TJECKIEN': 'cz',
    'SVK': 'sk', 'SLOVAKIEN': 'sk',
    'HUN': 'hu', 'UNGERN': 'hu',
    'ROU': 'ro', 'RUMÄNIEN': 'ro',
    'BUL': 'bg', 'BULGARIEN': 'bg',
    'SLO': 'si', 'SLOVENIEN': 'si',
    'CRO': 'hr', 'KROATIEN': 'hr',
    'BIH': 'ba', 'BOSNIEN OCH HERCEGOVINA': 'ba',
    'SRB': 'rs', 'SERBIEN': 'rs',
    'MNE': 'me', 'MONTENEGRO': 'me',
    'MKD': 'mk', 'NORDMAKEDONIEN': 'mk',
    'ALB': 'al', 'ALBANIEN': 'al',
    'KOS': 'xk', 'KOSOVO': 'xk', // Notera: xk är en tillfällig kod

    // Baltikum och Östeuropa
    'EST': 'ee', 'ESTLAND': 'ee',
    'LAT': 'lv', 'LETTLAND': 'lv',
    'LTU': 'lt', 'LITAUEN': 'lt',
    'UKR': 'ua', 'UKRAINA': 'ua',
    'MDA': 'md', 'MOLDAVIEN': 'md',
    'BLR': 'by', 'BELARUS': 'by',
    'RUS': 'ru', 'RYSSLAND': 'ru',

    // Transkontinentala
    'TUR': 'tr', 'TURKIET': 'tr',
    'GEO': 'ge', 'GEORGIEN': 'ge',
    'ARM': 'am', 'ARMENIEN': 'am',
    'AZE': 'az', 'AZERBAJDZJAN': 'az',
  };
  return map[code] || null;
}

export function flagPngUrl(cc) {
  const c = (cc || 'se').toLowerCase();
  return `https://flagcdn.com/w20/${c}.png`;
}

// HTML i modaler
export function getFlagHtml(eq) {
  const cc = normalizeCountryCode(eq?.country || eq?.nation || eq?.nationality) || 'se';
  return `<img src="${flagPngUrl(cc)}" crossorigin="anonymous" alt="${cc.toUpperCase()}" class="inline-block" title="${cc.toUpperCase()}">`;
}

// DataURL till PDF (försöker hämta, faller tillbaka till null)
export async function fetchFlagDataUrl(cc) {
  const url = flagPngUrl(cc || 'se');
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}
