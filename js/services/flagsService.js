export function normalizeCountryCode(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  if (code.length === 2) return code.toLowerCase();
  const map = {
    // Norden
    'SWE': 'se', 'SVERIGE': 'se', 'SWEDEN': 'se',
    'DEN': 'dk', 'DANMARK': 'dk', 'DENMARK': 'dk',
    'NOR': 'no', 'NORGE': 'no', 'NORWAY': 'no',
    'FIN': 'fi', 'FINLAND': 'fi',
    'ISL': 'is', 'ISLAND': 'is', 'ICELAND': 'is',

    // Västeuropa
    'GER': 'de', 'TYSKLAND': 'de', 'GERMANY': 'de',
    'FRA': 'fr', 'FRANKRIKE': 'fr', 'FRANCE': 'fr',
    'GBR': 'gb', 'STORBRITANNIEN': 'gb', 'STORBRITANNIEN OCH NORDIRLAND': 'gb', 'GREAT BRITAIN': 'gb', 'UK': 'gb', 'UNITED KINGDOM': 'gb',
    'IRL': 'ie', 'IRLAND': 'ie', 'IRELAND': 'ie',
    'NED': 'nl', 'NEDERLÄNDERNA': 'nl', 'HOLLAND': 'nl', 'NETHERLANDS': 'nl',
    'BEL': 'be', 'BELGIEN': 'be', 'BELGIUM': 'be',
    'LUX': 'lu', 'LUXEMBURG': 'lu', 'LUXEMBOURG': 'lu',
    'SUI': 'ch', 'SCHWEIZ': 'ch', 'SWITZERLAND': 'ch',
    'AUT': 'at', 'ÖSTERRIKE': 'at', 'AUSTRIA': 'at',
    'LIE': 'li', 'LIECHTENSTEIN': 'li',
    'MON': 'mc', 'MONACO': 'mc',

    // Sydeuropa
    'ESP': 'es', 'SPANIEN': 'es', 'SPAIN': 'es',
    'POR': 'pt', 'PORTUGAL': 'pt',
    'ITA': 'it', 'ITALIEN': 'it', 'ITALY': 'it',
    'GRE': 'gr', 'GREKLAND': 'gr', 'GREECE': 'gr',
    'MLT': 'mt', 'MALTA': 'mt',
    'CYP': 'cy', 'CYPERN': 'cy', 'CYPRUS': 'cy',
    'AND': 'ad', 'ANDORRA': 'ad',
    'SMR': 'sm', 'SAN MARINO': 'sm',
    'VAT': 'va', 'VATIKANSTATEN': 'va', 'VATICAN': 'va',

    // Öst- och Centraleuropa
    'POL': 'pl', 'POLEN': 'pl', 'POLAND': 'pl',
    'CZE': 'cz', 'TJECKIEN': 'cz', 'CZECH REPUBLIC': 'cz', 'CZECHIA': 'cz',
    'SVK': 'sk', 'SLOVAKIEN': 'sk', 'SLOVAKIA': 'sk',
    'HUN': 'hu', 'UNGERN': 'hu', 'HUNGARY': 'hu',
    'ROU': 'ro', 'RUMÄNIEN': 'ro', 'ROMANIA': 'ro',
    'BUL': 'bg', 'BULGARIEN': 'bg', 'BULGARIA': 'bg',
    'SLO': 'si', 'SLOVENIEN': 'si', 'SLOVENIA': 'si',
    'CRO': 'hr', 'KROATIEN': 'hr', 'CROATIA': 'hr',
    'BIH': 'ba', 'BOSNIEN OCH HERCEGOVINA': 'ba', 'BOSNIA': 'ba',
    'SRB': 'rs', 'SERBIEN': 'rs', 'SERBIA': 'rs',
    'MNE': 'me', 'MONTENEGRO': 'me',
    'MKD': 'mk', 'NORDMAKEDONIEN': 'mk', 'NORTH MACEDONIA': 'mk',
    'ALB': 'al', 'ALBANIEN': 'al', 'ALBANIA': 'al',
    'KOS': 'xk', 'KOSOVO': 'xk', // Notera: xk är en tillfällig kod

    // Baltikum och Östeuropa
    'EST': 'ee', 'ESTLAND': 'ee', 'ESTONIA': 'ee',
    'LAT': 'lv', 'LETTLAND': 'lv', 'LATVIA': 'lv',
    'LTU': 'lt', 'LITAUEN': 'lt', 'LITHUANIA': 'lt',
    'UKR': 'ua', 'UKRAINA': 'ua', 'UKRAINE': 'ua',
    'MDA': 'md', 'MOLDAVIEN': 'md', 'MOLDOVA': 'md',
    'BLR': 'by', 'BELARUS': 'by',
    'RUS': 'ru', 'RYSSLAND': 'ru', 'RUSSIA': 'ru',

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
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, img.naturalWidth, img.naturalHeight);
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch {
    return null;
  }
}
