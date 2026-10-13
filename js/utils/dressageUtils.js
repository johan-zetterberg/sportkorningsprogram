// Delad fil för all gemensam dressyrlogik.
// Beräkningarna finns i core-engine/dressage.js; här binds de till webbläsarens programlista.

// Importera den globala programlistan som en fallback
import { dressagePrograms as _programs } from '../data/dressagePrograms.js';
import { getCompetitionSetting } from '../services/competitionSettingsStore.js';
import {
  getDressagePenaltyCoeff as _getCoeff,
  computeFinalFromSaved as _computeFinal,
  guessProgramKeyFromClass as _guessProg,
  deduplicateAndFilterProtocols as _dedupe
} from '../core-engine/dressage.js';
import { escapeHtml } from './sharedUtils.js';

export { normJudgeId, getProtocolProgramKey, resolveDressageProgramKey, findProgramKey } from '../core-engine/dressage.js';

/**
 * Dressyrprogrammen: den aktiva tävlingens (inbyggda + egna, se
 * competitionSettingsStore) eller de inbyggda.
 */
export function getPrograms() {
  const w = getCompetitionSetting('dressagePrograms');
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
  return _getCoeff(p, all);
}

/**
 * Beräknar ett slutgiltigt snittresultat från en array av sparade domarprotokoll.
 * @param {object} eq - Ekipageobjektet.
 * @param {Array<object>} savedArr - En array av sparade protokoll-objekt.
 * @param {object} program - Det fullständiga programobjektet (från getPrograms()).
 * @returns {object | null} - { points, percent, penalty, generalImpressionsSum } eller null.
 */
export function computeFinalFromSaved(eq, savedArr, program) {
  if (!eq) return null;
  return _computeFinal(savedArr, program, getPrograms());
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

  return names.map(n => `<span class="block">${escapeHtml(n)}</span>`).join('');
}

/**
 * Rensa protokoll-listan: en per domare, inga tomma protokoll.
 * 'general'-dokumentet (felpoäng) behålls så att anroparen kan skicka listan vidare
 * till calculateDressageResult.
 * @param {Array} protocols - Rå lista av protokoll.
 * @param {Array} validJudgesList - Lista över konfigurerade domare (valfri).
 * @returns {Array} - Ren lista av protokoll att använda för beräkning.
 */
export function deduplicateAndFilterProtocols(protocols, validJudgesList) {
  if (!Array.isArray(protocols)) return [];
  const general = protocols.filter(p => p && p.id === 'general');
  return [..._dedupe(protocols, validJudgesList), ...general];
}

/**
 * Heuristik: gissa program-nyckel från klassnamn.
 */
export function guessProgramKeyFromClass(className, programs) {
  const all = programs || getPrograms();
  return _guessProg(className, all);
}

// Expose for non-module usage (e.g. PDF generation)
if (typeof window !== 'undefined') {
  window.getDressagePenaltyCoeff = getDressagePenaltyCoeff;
  window.getPrograms = getPrograms;
  window.computeFinalFromSaved = computeFinalFromSaved;
}
