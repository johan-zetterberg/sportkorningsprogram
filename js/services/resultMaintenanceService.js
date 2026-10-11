import { httpsCallable } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js';
import { functions } from '../config/firebase-config.js';

export async function validateCompetitionResultRecalculation(competitionId) {
  const callable = httpsCallable(functions, 'validateCompetitionResultRecalculation');
  const response = await callable({ competitionId });
  return response.data;
}

export async function recalculateCompetitionResults(competitionId, confirmedWarnings = false, confirmedArchived = false) {
  const callable = httpsCallable(functions, 'recalculateCompetitionResults');
  const response = await callable({ competitionId, confirmedWarnings, confirmedArchived });
  return response.data;
}
