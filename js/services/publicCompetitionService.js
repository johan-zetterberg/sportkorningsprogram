import { getEquipages } from './equipageService.js';
import { getConfig } from './competitionService.js';
import { getCompetitionDocuments, getCompetitionMessages, isMessageVisibleToPublic, isDocumentVisibleToPublic } from './documentService.js';
import { getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getCompCollectionRef } from './firestoreService.js';

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeClassName(eq) {
  return String(eq?._mergedLabel || eq?.className || '').trim();
}

function parseDateTime(value) {
  if (!value || typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTimeWindow(entries) {
  const dates = entries
    .map(parseDateTime)
    .filter(Boolean)
    .sort((a, b) => a - b);

  if (!dates.length) return 'Ej publicerad';

  const fmt = (date) => date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  return dates.length === 1 ? fmt(dates[0]) : `${fmt(dates[0])} - ${fmt(dates[dates.length - 1])}`;
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

function parseDrivenObstacles(value, allObstacles) {
  const allNumbers = toArray(allObstacles)
    .map(o => Number(o.number))
    .filter(Number.isFinite);

  if (!value || typeof value !== 'string') return allNumbers;

  return value
    .split(/[,\s;]+/)
    .map(v => Number(v))
    .filter(Number.isFinite);
}

function buildMarathonDetails(className, maratonConfig, marathonObstacles) {
  const classData = maratonConfig?.marathonClassData?.[className] || {};
  const drivenNumbers = parseDrivenObstacles(classData.drivenObstacles, marathonObstacles);
  const obstacleMap = new Map(toArray(marathonObstacles).map(o => [Number(o.number), o]));
  const drivenObstacles = drivenNumbers.map((number) => {
    const obstacle = obstacleMap.get(Number(number));
    return {
      number: Number(number),
      name: obstacle?.name || '',
      gateCount: obstacle?.gateCount ?? classData.gateCount ?? null
    };
  });

  return {
    gateCount: classData.gateCount ?? null,
    drivenObstacles,
    distanceA: classData.distanceA ?? null,
    distanceB: classData.distanceB ?? null,
    distanceT: classData.distanceT ?? null
  };
}

function buildPrecisionDetails(className, precisionConfig) {
  const course = precisionConfig?.courses?.[className] || {};
  return {
    trackLengthMeters: course.trackLengthMeters ?? null,
    tempo: course.tempo ?? null,
    obstacleLabels: Array.isArray(course.obstacleLabels) ? course.obstacleLabels : [],
    specialPortAllowance: course.specialPortAllowance || {}
  };
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

  const [equipages, startTimesCfg, publicInfo, venueMap, documents, messages, maratonConfig, precisionConfig, marathonObstacles] = await Promise.all([
    getEquipages(competition.id).catch(() => []),
    getConfig(competition.id, 'startTimes').catch(() => ({})),
    getConfig(competition.id, 'publicInfo').catch(() => ({})),
    getConfig(competition.id, 'map').catch(() => ({})),
    getCompetitionDocuments(competition.id).catch(() => []),
    getCompetitionMessages(competition.id).catch(() => []),
    getConfig(competition.id, 'maratonConfig').catch(() => ({})),
    getConfig(competition.id, 'precisionConfig').catch(() => ({})),
    getMarathonObstacles(competition.id)
  ]);

  const startTimes = startTimesCfg?.times || {};
  const classMap = new Map();

  toArray(equipages).forEach((eq) => {
    const className = normalizeClassName(eq);
    if (!className) return;

    if (!classMap.has(className)) {
      classMap.set(className, {
        className,
        starters: 0,
        dressage: [],
        marathon: [],
        precision: []
      });
    }

    const row = classMap.get(className);
    row.starters += 1;

    const sn = String(eq.startNumber || eq.id || '').trim();
    const times = startTimes[sn] || {};
    if (times.dressage) row.dressage.push(times.dressage);
    if (times.marathon) row.marathon.push(times.marathon);
    if (times.precision) row.precision.push(times.precision);
  });

  const classSummary = Array.from(classMap.values())
    .map((row) => ({
      className: row.className,
      starters: row.starters,
      dressageWindow: formatTimeWindow(row.dressage),
      marathonWindow: formatTimeWindow(row.marathon),
      precisionWindow: formatTimeWindow(row.precision),
      marathonDetails: buildMarathonDetails(row.className, maratonConfig, marathonObstacles),
      precisionDetails: buildPrecisionDetails(row.className, precisionConfig)
    }))
    .sort((a, b) => a.className.localeCompare(b.className, 'sv'));

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
