function readChangeData(change) {
    return typeof change?.doc?.data === 'function' ? change.doc.data() : (change?.doc?.data || {});
}

export function applySpeakerMarathonDocChanges(changes, marathonStatusMap, activeEquipages, evaluateActiveState) {
    const changedStartNumbers = [];

    changes.forEach(change => {
        const sn = String(change?.doc?.id ?? '');
        if (!sn) return;

        changedStartNumbers.push(sn);

        if (change.type === 'removed') {
            marathonStatusMap.delete(sn);
            activeEquipages.delete(sn);
            return;
        }

        const data = readChangeData(change);
        marathonStatusMap.set(sn, data);
        if (typeof evaluateActiveState === 'function') evaluateActiveState(sn, data);
    });

    return changedStartNumbers;
}

export function applySpeakerPrecisionDocChanges(changes, precisionStatusMap, receivedAt = Date.now()) {
    const changedStartNumbers = [];

    changes.forEach(change => {
        const sn = String(change?.doc?.id ?? '');
        if (!sn) return;

        changedStartNumbers.push(sn);

        if (change.type === 'removed') {
            precisionStatusMap.delete(sn);
            return;
        }

        const data = {
            ...readChangeData(change),
            _receivedLocalAt: receivedAt
        };
        precisionStatusMap.set(sn, data);
    });

    return changedStartNumbers;
}

function normalizeStateValue(value) {
    return String(value || '').trim().toLowerCase();
}

export function normalizeSpeakerDressageStatus(status = {}) {
    const normalized = { ...status };

    if (normalized.finalPenalty == null && normalized.penalty != null) normalized.finalPenalty = normalized.penalty;
    if (normalized.finalPenalty == null && normalized.totalPenalty != null) normalized.finalPenalty = normalized.totalPenalty;
    if (normalized.finalPercent == null && normalized.percent != null) normalized.finalPercent = normalized.percent;

    const state = normalizeStateValue(normalized.state);
    if (!normalized.state && normalized.finalPenalty != null) normalized.state = 'finished';
    else if (['done', 'complete', 'completed', 'klar', 'slut'].includes(state)) normalized.state = 'finished';
    else if (['active', 'in-progress', 'inprogress', 'started', 'pagar', 'paga', 'ongoing'].includes(state)) normalized.state = 'active';

    return normalized;
}

export function isSpeakerDressageFinishedStatus(status = {}) {
    return normalizeSpeakerDressageStatus(status).state === 'finished';
}

export function applySpeakerDressageStatusDocs(docs, dressageStatusMap, liveProtocolMap) {
    const changedStartNumbers = [];

    docs.forEach(status => {
        const sn = String(status?.id || status?.startNumber || '');
        if (!sn) return;

        const cur = dressageStatusMap.get(sn) || {};
        const normalized = normalizeSpeakerDressageStatus(status);
        dressageStatusMap.set(sn, { ...cur, ...normalized });
        if (normalized.state === 'finished') liveProtocolMap.delete(sn);
        changedStartNumbers.push(sn);
    });

    return changedStartNumbers;
}

export function applySpeakerDressageCalculatedResult(dressageStatusMap, liveProtocolMap, sn, result = {}, extraFields = {}) {
    const startNumber = String(sn || '');
    if (!startNumber || result.penalty == null) return false;

    const cur = dressageStatusMap.get(startNumber) || {};
    dressageStatusMap.set(startNumber, {
        ...cur,
        finalPercent: result.percent,
        finalPoints: result.points,
        finalPenalty: result.penalty,
        finalJudgeScore: { percent: result.percent, points: result.points, penalty: result.penalty },
        errorPoints: result.errorPoints,
        errorPenalty: result.penalty,
        ...extraFields
    });
    liveProtocolMap.delete(startNumber);
    return true;
}

export function applySpeakerDressageLiveDoc(
    liveDoc,
    dressageStatusMap,
    liveProtocolMap,
    allJudges = [],
    normalizeJudgeId = value => String(value || '').trim()
) {
    const sn = String(liveDoc?.startNumber || '');
    if (!sn) return false;

    const known = dressageStatusMap.get(sn);
    if (known?.state === 'finished') return false;

    let proto = liveDoc;
    if (liveDoc.protocol && typeof liveDoc.protocol === 'object') {
        proto = { ...liveDoc, ...liveDoc.protocol };
    }

    const rawJid = proto?.judgeId || proto?.judgeUid || proto?.judge || null;
    const jid = normalizeJudgeId(rawJid);

    if (proto && jid) {
        const normalizedProto = { ...proto, judgeId: jid };
        if (!liveProtocolMap.has(sn)) liveProtocolMap.set(sn, new Map());

        const existing = liveProtocolMap.get(sn).get(jid) || {};
        const merged = { ...existing, ...normalizedProto };

        if (!merged.position && !merged.judgePosition) {
            const judge = (allJudges || []).find(j => {
                const judgeId = normalizeJudgeId(j?.id || j?.uid || j?.judgeId || j?.judgeUid);
                return judgeId && judgeId === jid;
            }) || (allJudges || []).find(j =>
                String(j?.position || '').toUpperCase() === String(proto?.position || proto?.judgePosition || '').toUpperCase()
            );
            if (judge?.position) merged.position = String(judge.position).toUpperCase();
        }
        if (!merged.position && merged.judgePosition) merged.position = String(merged.judgePosition).toUpperCase();
        if (!merged.judgePosition && merged.position) merged.judgePosition = merged.position;

        liveProtocolMap.get(sn).set(jid, merged);
    }

    const cur = dressageStatusMap.get(sn) || {};
    dressageStatusMap.set(sn, {
        ...cur,
        ...liveDoc,
        state: liveDoc?.state || cur.state || 'ongoing',
        updatedAt: liveDoc?.updatedAt || cur.updatedAt
    });

    return true;
}

export function groupSpeakerDressageProtocolsByStartNumber(protocols = []) {
    const grouped = new Map();

    protocols.forEach(protocol => {
        const sn = String(protocol?.startNumber || '');
        if (!sn) return;
        if (!grouped.has(sn)) grouped.set(sn, []);
        grouped.get(sn).push(protocol);
    });

    return grouped;
}
