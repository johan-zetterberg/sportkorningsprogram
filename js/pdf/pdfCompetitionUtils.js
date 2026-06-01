import { getGlobalState } from '../main.js';
import { getConfig } from '../services/competitionService.js';

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
