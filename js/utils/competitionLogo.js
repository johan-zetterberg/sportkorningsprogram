import { escapeHtml } from './sharedUtils.js';

export function getCompetitionLogoUrl(competition = {}) {
  return (
    competition.logoUrl ||
    competition.competitionLogoUrl ||
    competition.logo?.url ||
    competition.meta?.logoUrl ||
    competition.meta?.competitionLogoUrl ||
    competition.meta?.logo?.url ||
    ''
  );
}

export function getCompetitionLogoName(competition = {}) {
  return (
    competition.logoName ||
    competition.logo?.name ||
    competition.meta?.logoName ||
    competition.meta?.logo?.name ||
    'Tävlingslogga'
  );
}

export function getCompetitionLogoHtml(competition = {}, {
  className = 'h-12 w-12 md:h-16 md:w-16 rounded-md flex-shrink-0 object-contain bg-white/95 p-1',
  fallbackHtml = ''
} = {}) {
  const url = getCompetitionLogoUrl(competition);
  if (!url) return fallbackHtml;
  const name = getCompetitionLogoName(competition);
  return `<img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" class="${className}">`;
}
