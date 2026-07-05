import { getEquipages } from './equipageService.js';
import { getConfig } from './competitionService.js';
import { getPublicCompetitionDocuments, getPublicCompetitionMessages, isMessageVisibleToPublic, isDocumentVisibleToPublic } from './documentService.js';
import { getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getCompCollectionRef } from './firestoreService.js';
import { buildPublicClassSummary, buildPublicMergeMap } from './publicCompetitionUtils.js';

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function deriveDocumentBuckets(documents) {
  const docs = toArray(documents).map((doc) => ({
    ...doc,
    _search: `${doc.title || ''} ${doc.category || ''} ${doc.type || ''}`.toLowerCase()
  }));

  return {
    documents: docs,
    mapDocuments: docs.filter(doc => /karta|banskiss|course|map/.test(doc._search))
  };
}

async function getMarathonObstacles(competitionId) {
  if (!competitionId) return [];
  try {
    const snap = await getDocs(getCompCollectionRef(competitionId, 'maratonObstacles'));
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.number || 0) - (b.number || 0));
  } catch {
    return [];
  }
}

export async function getPublicCompetitionViewModel(competition) {
  if (!competition?.id) {
    return {
      classSummary: [],
      documents: [],
      mapDocuments: [],
      messages: [],
      publicInfo: {},
      venueMap: {}
    };
  }

  const [publicInfo, venueMap] = await Promise.all([
    getConfig(competition.id, 'publicInfo').catch(() => ({})),
    getConfig(competition.id, 'map').catch(() => ({}))
  ]);

  if (publicInfo?.enabled === false) {
    return {
      classSummary: [],
      documents: [],
      mapDocuments: [],
      messages: [],
      publicInfo: publicInfo || {},
      venueMap: venueMap || {}
    };
  }

  const publish = publicInfo?.publish || {};
  const shouldLoadClassSummary = publish.classSummary !== false;
  const shouldLoadDocuments = publish.documents !== false || publish.maps !== false;
  const shouldLoadMessages = publish.messages !== false;

  const [
    equipages,
    startTimesCfg,
    documents,
    messages,
    maratonConfig,
    precisionConfig,
    marathonObstacles,
    displayConfig,
    tdbMergeGroups,
    classMergeMap,
    tdbMergeMap
  ] = await Promise.all([
    shouldLoadClassSummary ? getEquipages(competition.id).catch(() => []) : [],
    shouldLoadClassSummary ? getConfig(competition.id, 'startTimes').catch(() => ({})) : {},
    shouldLoadDocuments ? getPublicCompetitionDocuments(competition.id).catch(() => []) : [],
    shouldLoadMessages ? getPublicCompetitionMessages(competition.id).catch(() => []) : [],
    shouldLoadClassSummary ? getConfig(competition.id, 'maratonConfig').catch(() => ({})) : {},
    shouldLoadClassSummary ? getConfig(competition.id, 'precisionConfig').catch(() => ({})) : {},
    shouldLoadClassSummary ? getMarathonObstacles(competition.id) : [],
    shouldLoadClassSummary ? getConfig(competition.id, 'display').catch(() => ({})) : {},
    shouldLoadClassSummary ? getConfig(competition.id, 'tdbMergeGroups').catch(() => null) : null,
    shouldLoadClassSummary ? getConfig(competition.id, 'classMergeMap').catch(() => null) : null,
    shouldLoadClassSummary ? getConfig(competition.id, 'tdbMergeMap').catch(() => null) : null
  ]);

  const startTimes = startTimesCfg?.times || {};
  const mergeMap = buildPublicMergeMap(displayConfig, tdbMergeGroups, classMergeMap, tdbMergeMap);
  const classSummary = shouldLoadClassSummary ? buildPublicClassSummary({
    equipages,
    startTimes,
    mergeMap,
    maratonConfig,
    precisionConfig,
    marathonObstacles
  }) : [];

  const publicDocuments = toArray(documents).filter(isDocumentVisibleToPublic);
  const { documents: normalizedDocuments, mapDocuments } = deriveDocumentBuckets(publicDocuments);
  const publicMessages = toArray(messages).filter(isMessageVisibleToPublic);

  return {
    classSummary,
    documents: normalizedDocuments,
    mapDocuments,
    messages: publicMessages,
    publicInfo: publicInfo || {},
    venueMap: venueMap || {}
  };
}
