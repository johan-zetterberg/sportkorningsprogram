import { getConfig, saveConfig } from './competitionService.js';

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
 * Ladda loggor (både statiska globala och tävlingsspecifika).
 */
export async function ensureClubLogosLoaded(competitionId = null) {
  // If we have a fully loaded map and no specific competition is requested (or same one), might return. 
  // However, forcing refresh if competitionId changes is good. 
  // For simplicity, we always check if we need to merge.

  if (_loadPromise) await _loadPromise;

  // 1. Load Static (Base) if not loaded
  if (!_clubLogoMap) {
    _loadPromise = fetch('/assets/config/club-logos.json')
      .then(r => r.ok ? r.json() : {})
      .then(json => (_clubLogoMap = _normalize(json)))
      .catch(err => {
        console.warn('[logosService] kunde inte läsa club-logos.json', err);
        _clubLogoMap = {};
        return _clubLogoMap;
      });
    await _loadPromise;
    _loadPromise = null;
  }

  // 2. Load Global Firestore Logos (BASELINE)
  try {
    const { getDocData } = await import('./firestoreService.js');
    const globalLogos = await getDocData('config', 'clubLogos');
    if (globalLogos) {
      _clubLogoMap = { ..._clubLogoMap, ..._normalize(globalLogos) };
    }
  } catch (err) {
    console.warn('[logosService] Failed to load global Firestore logos', err);
  }

  // 3. Load Dynamic (Competition Override)
  if (competitionId) {
    try {
      const dynamicLogos = await getConfig(competitionId, 'clubLogos');
      if (dynamicLogos) {
        _clubLogoMap = { ..._clubLogoMap, ..._normalize(dynamicLogos) };
      }
    } catch (err) {
      console.warn('[logosService] Failed to load dynamic logos', err);
    }
  }

  return _clubLogoMap;
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

/**
 * Saves a new GLOBAL logo URL for a club.
 * Affects all competitions that don't override this specific club.
 */
export async function saveGlobalLogo(clubName, url) {
  if (!clubName) return;

  // 1. Update Local
  updateClubLogo(clubName, url);

  // 2. Save to Global Firestore (config/clubLogos)
  const key = String(clubName).trim().toLowerCase();
  const payload = {};
  payload[key] = url;

  // Save via specific helper or direct setDoc logic if imported
  // We need to import setDocData for this
  // But setDocData was added to firestoreService.js, we need to import it here too.
  // Actually, we can use saveConfig if it supported global. 
  // Let's assume we import setDocData.
  const { setDocData } = await import('./firestoreService.js');
  await setDocData('config', 'clubLogos', payload, true);
}

/**
 * Saves a new logo URL for a club in the specific competition context.
 */
export async function saveCompetitionLogo(competitionId, clubName, url) {
  if (!competitionId || !clubName) return;

  // 1. Update Local
  updateClubLogo(clubName, url);

  // 2. Save to Firestore (merge with existing)
  // We fetch existing first to be safe, or just use saveConfig with merge=true (default implementation of saveConfig usually merges fields in the doc)
  // Let's assume saveConfig merges top-level fields. But here we want to merge into the map fields.
  // Actually, saveConfig likely does set({ ...data }, { merge: true }). 
  // So passing { "club name": "url" } works.

  // Key must be standard string, but firestore keys can be anything. 
  // Best to rely on our normalized key or the display name? 
  // Let's use the raw name as key in Firestore for readability, or normalized?
  // Normalized is safer for matching.
  const key = String(clubName).trim().toLowerCase(); // normalized key
  // BUT: if we save normalized key, we might lose original casing for display if we ever iterate it.
  // The map is for LOOKUP.

  // We will save using the normalized key to ensure matches work.
  const payload = {};
  payload[key] = url;

  await saveConfig(competitionId, 'clubLogos', payload);
}

export function setClubLogoMap(obj) { _clubLogoMap = _normalize(obj); }
export function updateClubLogo(name, url) {
  if (!_clubLogoMap) _clubLogoMap = {};
  _clubLogoMap[String(name || '').trim().toLowerCase()] = url;
}

function shouldUseCors(url) {
  if (!url) return false;
  try {
    const u = new URL(url, window.location.href);
    return u.origin !== window.location.origin;
  } catch {
    return false;
  }
}

export async function fetchImageDataUrl(url) {
  if (!url) return null;
  try {
    const img = new Image();
    if (shouldUseCors(url)) {
      img.crossOrigin = 'anonymous';
    }
    img.src = url;
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });

    // Skala ner bilder till max 300px för att undvika gigantiska PDF-filer
    const maxDim = 300;
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (w > maxDim || h > maxDim) {
      if (w > h) {
        h = Math.round((h * maxDim) / w);
        w = maxDim;
      } else {
        w = Math.round((w * maxDim) / h);
        h = maxDim;
      }
    }

    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return { dataUrl: c.toDataURL('image/jpeg', 0.85), w, h };
  } catch { return null; }
}
