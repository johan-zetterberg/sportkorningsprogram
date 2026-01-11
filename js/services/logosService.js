let _clubLogoMap = null;
let _loadPromise = null;

function _normalize(obj) {
  const m = {};
  Object.entries(obj || {}).forEach(([k, v]) => {
    if (!k) return;
    m[String(k).trim().toLowerCase()] = v;
  });
  return m;
}

/**
 * Ladda (och cacha) loggokartan från JSON.
 * Anropa gärna i dina load()-funktioner.
 */
export async function ensureClubLogosLoaded(url = '/assets/config/club-logos.json') {
  if (_clubLogoMap) return _clubLogoMap;
  if (_loadPromise) return _loadPromise;

  _loadPromise = fetch(url)
    .then(r => r.ok ? r.json() : {})
    .then(json => (_clubLogoMap = _normalize(json)))
    .catch(err => {
      console.warn('[logosService] kunde inte läsa club-logos.json', err);
      _clubLogoMap = {};
      return _clubLogoMap;
    });

  return _loadPromise;
}

export function getClubLogoUrl(clubName) {
  if (!_clubLogoMap) return null;
  const key = String(clubName || '').trim().toLowerCase();
  return _clubLogoMap[key] || null;
}

export function getClubLogoHtml(eq, { className = 'inline-block h-5 w-auto', style = 'max-height:20px;' } = {}) {
  const url = getClubLogoUrl(eq?.clubName || eq?.club);
  return url ? `<img src="${url}" alt="${eq?.clubName || ''}" class="${className}" style="${style}">` : '';
}

// Valfritt: möjliggör runtime-uppdatering om du vill skriva in nya loggor via admin
export function setClubLogoMap(obj) { _clubLogoMap = _normalize(obj); }
export function updateClubLogo(name, url) {
  if (!_clubLogoMap) _clubLogoMap = {};
  _clubLogoMap[String(name || '').trim().toLowerCase()] = url;
}

export async function fetchImageDataUrl(url) {
  if (!url) return null;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return { dataUrl: c.toDataURL('image/png'), w: img.naturalWidth, h: img.naturalHeight };
  } catch { return null; }
}
