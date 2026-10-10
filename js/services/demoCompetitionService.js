/**
 * demoCompetitionService.js
 * 
 * Tillhandahåller seedning av ett komplett, realistiskt demodataset för svensk sportkörning
 * enligt Svenska Ridsportförbundets TR V 2025 och FEI Driving Rules 2026.
 */

import { db, appId } from '../config/firebase-config.js';
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { createCompetition, saveConfig } from './competitionService.js';
import { saveEquipage } from './equipageService.js';
import { setDressageStatus, saveDressageJudgeProtocol } from './dressageService.js';
import { savePrecisionResult } from './precisionService.js';
import { saveTeam } from './teamService.js';
import { saveOfficial, saveJudge } from './adminService.js';
import { saveMarathonObstacle } from './marathonService.js';
import { buildDemoCompetitionDataset } from './demoCompetitionData.js';

export { buildDemoCompetitionDataset };

/**
 * Sparar hela demodatasetet till Firestore för angiven eller ny tävling.
 */
export async function seedDemoCompetition(options = {}) {
  const dataset = buildDemoCompetitionDataset(options);
  let compId = options.competitionId;

  if (!compId) {
    const compDoc = await createCompetition({
      ...dataset.compMeta,
      competitionMode: 'live'
    });
    compId = compDoc.id;
  }

  // 1. Spara konfigurationer
  for (const [key, value] of Object.entries(dataset.configs)) {
    await saveConfig(compId, key, value);
  }

  // 2. Spara funktionärer och domare
  for (const official of dataset.officials) {
    await saveOfficial(compId, official);
  }
  for (const judge of dataset.judges) {
    await saveJudge(compId, judge.id, judge);
  }

  // 3. Spara maratonhinder
  for (const obs of dataset.obstacles) {
    await saveMarathonObstacle(compId, obs.number, obs);
  }

  // 4. Spara ekipage
  for (const eq of dataset.equipages) {
    await saveEquipage(compId, eq.startNumber, eq);
  }

  // 5. Spara dressyrprotokoll / status
  for (const d of dataset.dressageScores) {
    await setDressageStatus(compId, d.startNumber, {
      state: 'finished',
      finalPenalty: d.finalPenalty,
      finalPercent: d.finalPercent,
      finalPoints: d.finalPoints
    });
  }

  // Spara alla domarprotokoll (C, E, B) med bedömningspunkter
  if (Array.isArray(dataset.judgeProtocols)) {
    for (const p of dataset.judgeProtocols) {
      await saveDressageJudgeProtocol(compId, p.startNumber, p.judgeId, p);
    }
  }

  // 6. Spara maratontider och live-status
  for (const m of dataset.marathonRecords) {
    const sn = String(m.startNumber);
    const maratonRef = doc(db, `artifacts/${appId}/public/data/competitions/${compId}/maraton/${sn}`);
    await setDoc(maratonRef, m, { merge: true });
  }

  // 7. Spara precision
  for (const p of dataset.precisionResults) {
    await savePrecisionResult(compId, p.startNumber, p);
  }

  // 8. Spara lag
  for (const t of dataset.teams) {
    await saveTeam(compId, t.id, t);
  }

  return { competitionId: compId, dataset };
}
