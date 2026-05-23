import {
  deduplicateAndFilterProtocols,
  normJudgeId
} from '../../utils/dressageUtils.js';

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function getLiveEntries(liveProtocols) {
  if (!liveProtocols) return [];
  if (liveProtocols instanceof Map) return Array.from(liveProtocols.entries());
  if (Array.isArray(liveProtocols)) {
    return liveProtocols.map(p => [p?.judgeId || p?.id || p?.judgePosition || p?.position || '', p]);
  }
  return Object.entries(liveProtocols);
}

function normalizeProtocol(protocol, fallbackId = '') {
  if (!protocol) return null;
  const judgeId = normJudgeId(protocol.judgeId || protocol.id || fallbackId);
  const position = String(protocol.position || protocol.judgePosition || '').trim().toUpperCase();

  return {
    ...protocol,
    judgeId,
    id: protocol.id || judgeId || fallbackId,
    judgePosition: protocol.judgePosition || position,
    position,
    movements: Array.isArray(protocol.movements) ? protocol.movements : [],
    programKey: protocol.programKey || protocol.testKey || protocol.protocol?.testKey || '',
    testKey: protocol.testKey || protocol.programKey || protocol.protocol?.testKey || '',
    totalPoints: Number(protocol.totalPoints || protocol.runningTotalPoints || 0),
    percent: Number(protocol.percent || protocol.runningPercent || 0),
    penalty: Number(protocol.penalty || protocol.runningPenalty || 0),
    eliminated: !!protocol.eliminated
  };
}

function sameJudge(a, b) {
  const aId = normJudgeId(a?.judgeId || a?.id);
  const bId = normJudgeId(b?.judgeId || b?.id);
  if (aId && bId && aId === bId) return true;

  const aPos = String(a?.position || a?.judgePosition || '').trim().toUpperCase();
  const bPos = String(b?.position || b?.judgePosition || '').trim().toUpperCase();
  return !!aPos && !!bPos && aPos === bPos;
}

export function mergeDressageProtocols({ savedProtocols = [], liveProtocols = null, judges = [] } = {}) {
  const merged = deduplicateAndFilterProtocols(asArray(savedProtocols), judges);

  getLiveEntries(liveProtocols).forEach(([rawId, liveProtocol]) => {
    const normalizedLive = normalizeProtocol(liveProtocol, rawId);
    if (!normalizedLive) return;

    const existingIndex = merged.findIndex(protocol => sameJudge(protocol, normalizedLive));
    if (existingIndex >= 0) {
      merged[existingIndex] = normalizedLive;
    } else {
      merged.push(normalizedLive);
    }
  });

  return deduplicateAndFilterProtocols(merged, judges);
}
