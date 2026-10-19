// Pure conversion of dressage protocol documents (no Firebase here, so the
// loaders' shape can be tested in Node).
import { timestampToMs } from './dressageStatusUtils.js';

/** A saved movement score: a number, or null when the movement is empty */
export function normalizeSavedScore(score) {
  if (score === null || score === undefined) return null;
  if (typeof score === 'string' && score.trim() === '') return null;
  const n = typeof score === 'number' ? score : Number(String(score).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * The shape every loader hands to the pages and the result engine. The
 * 'general' document (error points from C, TR 518.9 / FEI 958.1.4) is kept
 * with its errorPoints; it has no judge and no movements, and the engine
 * never counts it as a judge protocol.
 */
export function asPlainDressageProtocol(data, docId, fallbackStartNumber) {
  if (!data) return null;
  const startNumber = fallbackStartNumber ?? data.startNumber;
  if (docId === 'general') {
    return {
      id: 'general',
      startNumber,
      judgeId: '',
      judgeName: '',
      judgePosition: '',
      position: '',
      testKey: '',
      programKey: '',
      movements: [],
      eliminated: false,
      errorPoints: Number(data.errorPoints) || 0,
      errorComment: data.errorComment || '',
      updatedAt: data.updatedAt ?? null
    };
  }
  const protocol = data.protocol && typeof data.protocol === 'object' ? data.protocol : data;
  const judgePosition = protocol.judgePosition ?? protocol.position ?? data.judgePosition ?? data.position ?? '';
  const updatedAt = data.updatedAt ?? protocol.updatedAt ?? null;
  const updatedAtMs = timestampToMs(updatedAt);

  return {
    id: docId,
    // Where the protocol is stored decides whose it is: a startNumber field
    // inside it could point a protocol at another (even finalized) equipage
    startNumber: fallbackStartNumber ?? protocol.startNumber ?? data.startNumber,
    judgeId: protocol.judgeId ?? data.judgeId ?? (docId.startsWith('judge_') ? docId.replace('judge_', '') : docId),
    judgeName: protocol.judgeName ?? data.judgeName ?? '',
    judgePosition,
    position: judgePosition,
    testKey: protocol.testKey ?? protocol.programKey ?? data.testKey ?? data.programKey ?? '',
    programKey: protocol.programKey ?? protocol.testKey ?? data.programKey ?? data.testKey ?? '',
    movements: Array.isArray(protocol.movements) ? protocol.movements.map(m => ({ ...m })) : [],
    eliminated: !!(protocol.eliminated ?? data.eliminated),
    generalErrors: protocol.generalErrors ?? data.generalErrors ?? 0,
    lastUpdate: data.lastUpdate ?? null,
    state: data.state ?? null,
    // A server Timestamp becomes an ISO string (pages read it with new Date)
    updatedAt: (updatedAt && typeof updatedAt === 'object' && updatedAtMs != null) ? new Date(updatedAtMs).toISOString() : updatedAt,
    updatedAtMs
  };
}

/** Plain protocols of one equipage from [{ id, data }] documents, 'general' included */
export function plainDressageProtocolsFromDocs(docs, startNumber) {
  return (docs || [])
    .map(d => asPlainDressageProtocol(d?.data, d?.id, startNumber))
    .filter(Boolean);
}
