import { getGlobalState } from '../main.js';
import { getConfig } from '../services/competitionService.js';
import { isInternationalCompetition, getCurrentLanguage } from '../utils/i18n.js';

/**
 * The language of a PDF: { isInt, lang, isEn }. The international flag lives in
 * config/competitionMeta (not on the competition document), so it is read
 * from there; the user's own language choice still wins (as t()).
 */
export async function resolvePdfLanguage(competition) {
  let isInt = isInternationalCompetition(competition);
  if (!isInt) {
    try {
      isInt = isInternationalCompetition(await resolvePdfCompetition(competition));
    } catch (_) { /* Swedish */ }
  }
  const lang = getCurrentLanguage(isInt);
  return { isInt, lang, isEn: lang === 'en' };
}

export async function resolvePdfCompetition(competition) {
  const globalCompetition = getGlobalState('currentCompetition') || {};
  const base = competition || globalCompetition || {};
  const competitionId = base.id || globalCompetition.id || null;

  if (!competitionId) return base;

  try {
    const meta = await getConfig(competitionId, 'competitionMeta');
    if (!meta || typeof meta !== 'object') return base;
    return {
      ...base,
      meta: {
        ...(base.meta || {}),
        ...meta
      }
    };
  } catch (_) {
    return base;
  }
}
