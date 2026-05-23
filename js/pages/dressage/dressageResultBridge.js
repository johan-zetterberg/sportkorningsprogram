import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from '../../config/firebase-config.js';

function pickFinal(data) {
  if (!data) return null;
  const percent = Number(data?.finalJudgeScore?.percent ?? data?.finalPercent ?? data?.totalPercent);
  const points = Number(data?.finalJudgeScore?.points ?? data?.finalPoints ?? data?.totalPoints);
  const penalty = Number(data?.finalJudgeScore?.penalty ?? data?.finalPenalty ?? data?.totalPenalty);
  const any = Number.isFinite(percent) || Number.isFinite(points) || Number.isFinite(penalty);
  if (!any) return null;

  return {
    percent: Number.isFinite(percent) ? percent : null,
    points: Number.isFinite(points) ? points : null,
    penalty: Number.isFinite(penalty) ? penalty : null,
    updatedAt: data?.updatedAt ? new Date(data.updatedAt).getTime() : Date.now()
  };
}

export function clearGlobalScrollLocks() {
  const html = document.documentElement;
  const body = document.body;
  if (!html || !body) return;

  body.classList.remove('no-scroll', 'modal-open');
  html.classList.remove('no-scroll', 'modal-open');
  ['overflow', 'overflowY', 'position', 'height', 'top', 'width'].forEach(k => {
    html.style[k] = '';
    body.style[k] = '';
  });
}

export function exposeDressageResultApi({ computeFinalFromSaved }) {
  window.dressageResult = window.dressageResult || {};
  window.dressageResult.computeFinalFromSaved = computeFinalFromSaved;
  window.dressageResult.injectProviders = function injectProviders(providers) {
    window.dressageResult.providers = providers || null;
  };
}

export function setupDressageResultGetters({ getStatusMap }) {
  window.dressageResult = window.dressageResult || {};

  window.dressageResult.getFinalFor = async function getFinalFor(competitionId, sn) {
    try {
      const startNumber = String(sn);
      const statusMap = getStatusMap?.() || window.dressageResultState?.statusMap;
      const fromCache = pickFinal(statusMap?.get?.(startNumber));
      if (fromCache) return fromCache;

      const ref = doc(
        db,
        'artifacts',
        appId,
        'public',
        'data',
        'competitions',
        competitionId,
        'dressageStatus',
        startNumber
      );
      const snap = await getDoc(ref);
      return snap.exists() ? pickFinal(snap.data()) : null;
    } catch (e) {
      console.warn('[dressageResult.getFinalFor] failed', e);
      return null;
    }
  };
}

export function setupDressageProtocolModalBridge({
  getAllCompetitionJudges,
  expandDressagePosition,
  getRawByStart,
  getMasterEquipageList,
  getDressageStatusMap,
  openDetailsModal,
  deduplicateAndFilterProtocols
}) {
  const openProtocolModal = (competitionId, sn, opts = {}) => {
    try {
      if (competitionId) window.currentCompetitionId = competitionId;
    } catch { }

    const currentJudges = window.__dressageCurrentJudgesPresentRef || [];
    const safeJudges = (getAllCompetitionJudges?.() || []).map(j => ({
      ...j,
      position: (expandDressagePosition(j) || j.position || '').toUpperCase()
    }));
    const rawList = getRawByStart?.()?.get(String(sn)) || [];
    const cleanList = deduplicateAndFilterProtocols(rawList, safeJudges);
    const tempMap = new Map([[String(sn), cleanList]]);

    return openDetailsModal(String(sn), {
      savedProtocolsMap: tempMap,
      equipages: getMasterEquipageList?.() || [],
      statusMap: getDressageStatusMap?.() || new Map(),
      currentJudges: currentJudges.length ? currentJudges : null,
      ...opts
    });
  };

  window.dressageResult = window.dressageResult || {};
  window.dressageResult.openProtocolModal = openProtocolModal;
  window.openDressageProtocolModal = openProtocolModal;
  window.showDressageResultModal = openProtocolModal;
}
