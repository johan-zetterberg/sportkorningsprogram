export function buildProcessedTotalTeams({
  rawTeams = [],
  processedResults = [],
  calculateTeamResults
} = {}) {
  if (typeof calculateTeamResults !== 'function') {
    throw new Error('buildProcessedTotalTeams: calculateTeamResults saknas');
  }
  return calculateTeamResults(rawTeams, processedResults);
}

export function buildTeamDisciplineBests(teams = []) {
  const bests = {
    dressage: Infinity,
    marathon: Infinity,
    precision: Infinity
  };

  (teams || []).forEach((team) => {
    if (team?.isEliminated) return;
    if (Number.isFinite(team.dressage)) bests.dressage = Math.min(bests.dressage, team.dressage);
    if (Number.isFinite(team.marathon)) bests.marathon = Math.min(bests.marathon, team.marathon);
    if (Number.isFinite(team.precision)) bests.precision = Math.min(bests.precision, team.precision);
  });

  return bests;
}

export function isBestTeamDiscipline(team, discipline, bests = {}) {
  const value = team?.[discipline];
  const best = bests?.[discipline];
  return (!team?.isEliminated || value > 0)
    && Number.isFinite(value)
    && Number.isFinite(best)
    && Math.abs(value - best) < 0.01;
}

export function renderTeamRankBadge(team, index = 0) {
  if (team?.isEliminated) {
    return '<span class="px-3 py-1 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-xs font-bold uppercase tracking-wider">ELIM</span>';
  }
  if (team?.isIncomplete) {
    return '<span class="px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-bold uppercase tracking-wider">Pågår</span>';
  }

  if (index === 0) {
    return '<div class="w-10 h-10 flex items-center justify-center text-2xl" title="1:a plats">🥇</div>';
  }
  if (index === 1) {
    return '<div class="w-10 h-10 flex items-center justify-center text-2xl" title="2:a plats">🥈</div>';
  }
  if (index === 2) {
    return '<div class="w-10 h-10 flex items-center justify-center text-2xl" title="3:e plats">🥉</div>';
  }

  return `<div class="w-8 h-8 rounded-full bg-blue-100 dark:bg-gray-700 text-blue-800 dark:text-gray-200 font-bold flex items-center justify-center text-sm">${team?.rank || '-'}</div>`;
}

export function formatTeamScore(value, { eliminated = false, eliminatedLabel = '-', emptyLabel = '-' } = {}) {
  if (eliminated) return eliminatedLabel;
  return Number.isFinite(value) ? value.toFixed(2) : emptyLabel;
}

export function getTeamCardBorderClass(team, index = 0) {
  return index === 0 && !team?.isEliminated && !team?.isIncomplete
    ? 'border-amber-400 dark:border-amber-600 ring-1 ring-amber-400/50'
    : 'dark:border-gray-700';
}

export function renderTeamMemberStatusIcon(member = {}) {
  if (member.eliminated) {
    return '<i class="fas fa-times text-red-500"></i>';
  }
  if (member.isCounting) {
    return '<i class="fas fa-check-circle text-green-600 dark:text-green-500"></i>';
  }
  return '<span class="text-gray-300 dark:text-gray-600">•</span>';
}

export function getTeamMemberTextClass(member = {}) {
  return member.isCounting
    ? 'font-semibold text-gray-900 dark:text-gray-100'
    : 'text-gray-400 dark:text-gray-500 italic';
}

export function getTeamMemberTotalTextClass(member = {}) {
  return member.isCounting ? 'text-gray-800 dark:text-gray-200' : 'text-gray-400';
}

export function renderTeamMemberRow(member = {}, {
  flagHtml = '',
  clubLogoHtml = '',
  clubName = ''
} = {}) {
  const statusIcon = renderTeamMemberStatusIcon(member);
  const scoreTotal = formatTeamScore(member.penalty, { eliminated: member.eliminated, eliminatedLabel: 'ELIM' });
  const scoreDress = formatTeamScore(member.dressage, { eliminated: member.eliminated });
  const scoreMarathon = formatTeamScore(member.marathon, { eliminated: member.eliminated });
  const scorePrecision = formatTeamScore(member.precision, { eliminated: member.eliminated });
  const memberTextClass = getTeamMemberTextClass(member);
  const totalScoreClass = getTeamMemberTotalTextClass(member);
  const cellClass = 'text-right p-1';

  return `
        <div class="grid grid-cols-12 gap-2 text-sm py-2 border-b dark:border-gray-700/50 last:border-0 border-gray-100 items-center hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors cursor-pointer" data-start="${member.startNumber}" role="button">
           <div class="col-span-4 flex items-center gap-2 overflow-hidden pl-2">
             <span class="w-5 text-center flex-shrink-0">${statusIcon}</span>
             <div class="flex flex-col truncate">
                <span class="${memberTextClass} truncate">
                  ${flagHtml} ${member.name}
                </span>
                <span class="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
                  #${member.startNumber} ${clubName || ''} ${clubLogoHtml}
                </span>
             </div>
           </div>
           
           <div class="col-span-2 ${cellClass} ${memberTextClass}">${scoreDress}</div>
           <div class="col-span-2 ${cellClass} ${memberTextClass}">${scoreMarathon}</div>
           <div class="col-span-2 ${cellClass} ${memberTextClass}">${scorePrecision}</div>
           <div class="col-span-2 ${cellClass} font-bold ${totalScoreClass}">${scoreTotal}</div>
        </div>
      `;
}

export function renderTeamDisciplineSummaryCell({
  value,
  isEliminated = false,
  isBest = false,
  title = ''
} = {}) {
  const highlightClass = 'text-amber-600 dark:text-amber-400 font-extrabold';
  return `
            <div class="col-span-2 text-right font-bold ${isBest ? highlightClass : ''}" title="${isBest ? title : ''}">
                ${formatTeamScore(value, { eliminated: isEliminated })}
                ${isBest ? '<i class="fas fa-star text-[10px] ml-0.5 text-amber-500 align-top"></i>' : ''}
            </div>
            `;
}

export function renderTeamSummaryFooter(team = {}, {
  isBestDressage = false,
  isBestMarathon = false,
  isBestPrecision = false
} = {}) {
  return `
          <div class="grid grid-cols-12 gap-2 px-2 py-3 text-sm border-t dark:border-gray-600/50 mt-0 bg-blue-50/50 dark:bg-blue-900/10 text-gray-900 dark:text-gray-100">
            <div class="col-span-4 text-right pr-2 font-bold self-center text-blue-900 dark:text-blue-200">Bästa 3 (Summa):</div>
            
            ${renderTeamDisciplineSummaryCell({
              value: team.dressage,
              isEliminated: team.isEliminated,
              isBest: isBestDressage,
              title: 'Bästa lagdressyr (för godkända lag)'
            })}
            
            ${renderTeamDisciplineSummaryCell({
              value: team.marathon,
              isEliminated: team.isEliminated,
              isBest: isBestMarathon,
              title: 'Bästa lagmaraton (för godkända lag)'
            })}
            
            ${renderTeamDisciplineSummaryCell({
              value: team.precision,
              isEliminated: team.isEliminated,
              isBest: isBestPrecision,
              title: 'Bästa lagprecision (för godkända lag)'
            })}
            
            <div class="col-span-2 text-right font-black text-blue-900 dark:text-blue-300">
                ${formatTeamScore(team.total, { eliminated: team.isEliminated })}
            </div>
          </div>
          `;
}

export function renderTeamCard(team = {}, {
  index = 0,
  teamBests = {},
  teamAssetHtml = '',
  membersHtml = ''
} = {}) {
  const rankBadge = renderTeamRankBadge(team, index);
  const cardBorder = getTeamCardBorderClass(team, index);
  const isBestDressage = isBestTeamDiscipline(team, 'dressage', teamBests);
  const isBestMarathon = isBestTeamDiscipline(team, 'marathon', teamBests);
  const isBestPrecision = isBestTeamDiscipline(team, 'precision', teamBests);

  return `
      <div class="mb-6 rounded-xl border ${cardBorder} shadow-sm bg-white dark:bg-gray-800 overflow-hidden transition-all hover:shadow-md">
        <div class="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/40 border-b dark:border-gray-700">
          <div class="flex items-center gap-4">
            ${rankBadge}
            <div class="flex items-center">
                ${teamAssetHtml}
                <div>
                    <h3 class="font-bold text-lg text-gray-900 dark:text-white leading-tight">${team.teamName}</h3>
                    ${team.isEliminated ? '' : `<div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5 uppercase tracking-wide font-medium">Lagtotal</div>`}
                </div>
            </div>
          </div>
          <div class="text-right">
            <div class="font-black text-2xl text-blue-900 dark:text-blue-300 tracking-tight">
                ${formatTeamScore(team.total, { eliminated: team.isEliminated, eliminatedLabel: 'ELIM' })}
            </div>
          </div>
        </div>
        
        <div class="p-0">
          <div class="grid grid-cols-12 gap-2 px-2 py-2 text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider bg-gray-50/50 dark:bg-gray-800/50 border-b dark:border-gray-700/50">
            <div class="col-span-4 pl-9">Ekipage</div>
            <div class="col-span-2 text-right">Dressyr</div>
            <div class="col-span-2 text-right">Maraton</div>
            <div class="col-span-2 text-right">Precision</div>
            <div class="col-span-2 text-right">Totalt</div>
          </div>

          <div class="px-2">
            ${membersHtml}
          </div>

          ${renderTeamSummaryFooter(team, {
            isBestDressage,
            isBestMarathon,
            isBestPrecision
          })}

        </div>
      </div>
    `;
}
