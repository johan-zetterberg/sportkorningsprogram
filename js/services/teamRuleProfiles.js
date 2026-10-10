export const TEAM_SCORING_PROFILE_IDS = {
  LEGACY_BEST_THREE: 'legacy_best_three',
  LAG_SM_2026: 'lag_sm_2026',
  FEI_CHAMPIONSHIP_CAIO: 'fei_championship_caio',
  FEI_PONY_CHAMPIONSHIP: 'fei_pony_championship',
  FEI_YOUTH_CHAMPIONSHIP: 'fei_youth_championship',
  FEI_PARA_CHAMPIONSHIP: 'fei_para_championship'
};

const TEAM_SCORING_PROFILES = {
  [TEAM_SCORING_PROFILE_IDS.LEGACY_BEST_THREE]: {
    id: TEAM_SCORING_PROFILE_IDS.LEGACY_BEST_THREE,
    label: 'Tidigare standard (tre bästa)',
    description: 'Tidigare lagberäkning: de tre lägsta resultaten i varje moment räknas.',
    minimumMembers: 3,
    maximumMembers: 4,
    countingPerDiscipline: 3,
    countPhaseEliminationAsPenalty: false
  },
  [TEAM_SCORING_PROFILE_IDS.LAG_SM_2026]: {
    id: TEAM_SCORING_PROFILE_IDS.LAG_SM_2026,
    label: 'Lag-SM 2026',
    description: 'Två av två eller tre ekipage räknas per moment. Utesluten eller ej slutförd prestation ger 500 straffpoäng i det momentet.',
    minimumMembers: 2,
    maximumMembers: 3,
    countingPerDiscipline: 2,
    countPhaseEliminationAsPenalty: true
  },
  [TEAM_SCORING_PROFILE_IDS.FEI_CHAMPIONSHIP_CAIO]: {
    id: TEAM_SCORING_PROFILE_IDS.FEI_CHAMPIONSHIP_CAIO,
    label: 'FEI Championship / CAIO',
    description: 'Nationellt lag med 2-3 ekipage. De två lägsta resultaten räknas i varje moment, men endast ekipage som har fullföljt alla tre moment utan uteslutning får räknas.',
    minimumMembers: 2,
    maximumMembers: 3,
    countingPerDiscipline: 2,
    ruleFamily: 'fei',
    requiresSameNation: true,
    requiresCompletedCompetition: true
  },
  [TEAM_SCORING_PROFILE_IDS.FEI_PONY_CHAMPIONSHIP]: {
    id: TEAM_SCORING_PROFILE_IDS.FEI_PONY_CHAMPIONSHIP,
    label: 'FEI Pony Championship',
    description: 'Nationellt lag med 1-2 enbet, 1-2 par och 1-2 fyrspann. Bästa godkända ekipage från varje kategori räknas i varje moment.',
    minimumMembers: 3,
    maximumMembers: 6,
    countingPerDiscipline: 3,
    ruleFamily: 'fei',
    requiresSameNation: true,
    requiresCompletedCompetition: true,
    requiredRoles: [
      { id: 'single', label: 'enbet', minimum: 1, maximum: 2 },
      { id: 'pair', label: 'par', minimum: 1, maximum: 2 },
      { id: 'fourInHand', label: 'fyrspann', minimum: 1, maximum: 2 }
    ]
  },
  [TEAM_SCORING_PROFILE_IDS.FEI_YOUTH_CHAMPIONSHIP]: {
    id: TEAM_SCORING_PROFILE_IDS.FEI_YOUTH_CHAMPIONSHIP,
    label: 'FEI Youth Championship',
    description: 'Nationellt lag med 1-2 Children, 1-2 Junior och 1-2 U25. Bästa godkända ekipage från varje ålderskategori räknas i varje moment.',
    minimumMembers: 3,
    maximumMembers: 6,
    countingPerDiscipline: 3,
    ruleFamily: 'fei',
    requiresSameNation: true,
    requiresCompletedCompetition: true,
    requiredRoles: [
      { id: 'child', label: 'Children', minimum: 1, maximum: 2 },
      { id: 'junior', label: 'Junior', minimum: 1, maximum: 2 },
      { id: 'u25', label: 'U25', minimum: 1, maximum: 2 }
    ]
  },
  [TEAM_SCORING_PROFILE_IDS.FEI_PARA_CHAMPIONSHIP]: {
    id: TEAM_SCORING_PROFILE_IDS.FEI_PARA_CHAMPIONSHIP,
    label: 'FEI Para Driving Championship',
    description: 'Nationellt lag med 2-3 ekipage. Minst en deltagare måste vara Grade I och högst två får tillhöra samma grade. De två lägsta godkända resultaten räknas i varje moment.',
    minimumMembers: 2,
    maximumMembers: 3,
    countingPerDiscipline: 2,
    ruleFamily: 'fei',
    requiresSameNation: true,
    requiresCompletedCompetition: true,
    requiresParaGradeOne: true,
    maximumMembersPerParaGrade: 2
  }
};

export function getTeamScoringProfile(profileOrId) {
  const profileId = profileOrId && typeof profileOrId === 'object' ? profileOrId.id : profileOrId;
  return TEAM_SCORING_PROFILES[profileId]
    || TEAM_SCORING_PROFILES[TEAM_SCORING_PROFILE_IDS.LEGACY_BEST_THREE];
}

export function getTeamScoringProfileOptions() {
  return Object.values(TEAM_SCORING_PROFILES);
}
