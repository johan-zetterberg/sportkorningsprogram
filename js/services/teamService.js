import { db, appId } from '../config/firebase-config.js';
import { collection, doc, getDocs, setDoc, deleteDoc, onSnapshot, query, orderBy, addDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { trackWrite } from './firestoreService.js';;

export async function getTeams(competitionId) {
  if (!competitionId) return [];
  try {
    const colRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/teams`);
    const q = query(colRef, orderBy('name', 'asc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn('Could not fetch teams:', err);
    return [];
  }
}

export function listenForTeams(competitionId, callback) {
  if (!competitionId) return () => {};
  const colRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/teams`);
  const q = query(colRef, orderBy('name', 'asc'));
  return onSnapshot(q, (snap) => {
    const teams = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(teams);
  });
}

export async function saveTeam(competitionId, teamIdOrData, maybeTeamData) {
  if (!competitionId) throw new Error("Missing competitionId");

  const teamData = maybeTeamData ?? teamIdOrData;
  const teamId = maybeTeamData ? teamIdOrData : teamData?.id;

  if (!teamData || typeof teamData !== 'object') {
    throw new Error("Missing teamData");
  }

  return trackWrite(`Sparar lag ${teamData.name || teamId || 'nytt lag'}`, (async () => {
    if (!teamId) {
      const colRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/teams`);
      await addDoc(colRef, teamData);
      return;
    }

    const ref = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/teams`, String(teamId));
    await setDoc(ref, teamData, { merge: true });
  })());
}

export async function deleteTeam(competitionId, teamId) {
  if (!competitionId || !teamId) throw new Error("Missing params");
  return trackWrite(`Tar bort lag ${teamId}`, (async () => {
    const ref = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/teams`, teamId);
    await deleteDoc(ref);
  })());
}
