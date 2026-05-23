import { onSnapshot, doc, collection } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { db, appId } from '../../config/firebase-config.js';

import { listenForDressageLiveGroup, listenForDressageStatusCollection, listenForDressageProtocolsCollectionGroup } from '../../services/dressageService.js';
import { listenForConfig } from '../../services/competitionService.js';
import { listenForJudges } from '../../services/adminService.js';

import { getPrograms, deduplicateAndFilterProtocols, normJudgeId } from '../../utils/dressageUtils.js';
import { calculateDressageResult } from '../../services/calculationService.js';
import { setMarathonConfig, buildMergeMap, ensureMergeDecorations, setPauseWindows } from '../../utils/marathonUtils.js';

import { normState, expandDressagePosition } from './speakerHelpers.js';

export function setupAllListeners(context) {
    const {
        competitionId,
        unsubscribes,
        triggerRender,
        ensureSpeakerTicker,
        dressageStatusMap,
        liveProtocolMap,
        savedProtocolsMap,
        maratonStatusMap,
        activeEquipages,
        precisionStatusMap,
        recentResults,
        getAllEquipages,
        setAllEquipages,
        getAllJudges,
        setAllJudges,
        setStartTimes,
        setPrecisionConfig,
        setGloballyPaused,
        setPauseStartTime,
        getCurrentDiscipline,
        maybePushRecent,
        maybePushRecentMarathon,
        maybePushRecentPrecision,
        evaluateActiveState,
        verifyDressageResult
    } = context;

    unsubscribes.forEach(u => u());
    unsubscribes.length = 0; // Clear the array but keep reference

    // Clear caches
    recentResults.length = 0;
    dressageStatusMap.clear();
    liveProtocolMap.clear();
    maratonStatusMap.clear();
    activeEquipages.clear();
    precisionStatusMap.clear();

    // 1. Global Pause Status
    const pauseSub = onSnapshot(doc(db, 'artifacts', appId, 'public', 'data', 'competitions', competitionId, 'config', 'globalStatus'), (docSnap) => {
        if (docSnap.exists()) {
            const d = docSnap.data();
            const isPaused = d.isPaused === true;
            setGloballyPaused(isPaused);

            if (isPaused && Array.isArray(d.pauseLog)) {
                setPauseWindows(d.pauseLog);
                const current = d.pauseLog.find(p => p.end === null);
                if (current && current.start) {
                    setPauseStartTime(new Date(current.start).getTime());
                } else {
                    setPauseStartTime(Date.now());
                }
            } else {
                setPauseWindows(d.pauseLog || []);
                setPauseStartTime(0);
            }
        }
    });
    unsubscribes.push(pauseSub);

    // 2. Display Config
    unsubscribes.push(listenForConfig(competitionId, 'display', (cfg) => {
        if (cfg) {
            buildMergeMap(cfg);
            setAllEquipages(ensureMergeDecorations(getAllEquipages()));
            triggerRender(true);
        }
    }));

    // 3. Judges
    unsubscribes.push(listenForJudges(competitionId, (judges) => {
        const mapped = (judges || []).map(j => ({
            ...j,
            id: j.id,
            name: j.name || j.fullName || j.id,
            position: (expandDressagePosition(j) || j.position || '').toUpperCase()
        }));
        setAllJudges(mapped);
        triggerRender();
        if (getCurrentDiscipline() === 'dressyr') {
            dressageStatusMap.forEach((val, key) => maybePushRecent(key));
            triggerRender();
        }
    }));

    // 4. Start Times
    unsubscribes.push(listenForConfig(competitionId, 'startTimes', (data) => {
        setStartTimes((data?.times) || (data?.value?.times) || {});
        triggerRender();
    }));

    // 5. Dressage Listeners
    setupDressageListeners();

    // 6. Marathon Listeners
    setupMarathonListeners();

    // 7. Precision Listeners
    setupPrecisionListeners();

    function setupDressageListeners() {
        // Status
        unsubscribes.push(listenForDressageStatusCollection(competitionId, (docs) => {
            docs.forEach(st => {
                const sn = String(st.id || st.startNumber);
                const cur = dressageStatusMap.get(sn) || {};

                const normalized = { ...st };
                if (normalized.finalPenalty == null && normalized.penalty != null) normalized.finalPenalty = normalized.penalty;
                if (normalized.finalPenalty == null && normalized.totalPenalty != null) normalized.finalPenalty = normalized.totalPenalty;
                if (normalized.finalPercent == null && normalized.percent != null) normalized.finalPercent = normalized.percent;

                const sNorm = normState(normalized.state);
                if (!normalized.state && normalized.finalPenalty != null) normalized.state = 'finished';
                else if (['done', 'complete', 'completed', 'klar', 'slut'].includes(sNorm)) normalized.state = 'finished';
                else if (['active', 'in-progress', 'inprogress', 'started', 'pågår', 'paga'].includes(sNorm)) normalized.state = 'active';

                if (normalized.state === 'finished' && normalized.finalPenalty != null && cur.state !== 'finished') {
                    const eq = getAllEquipages().find(e => String(e.startNumber) === sn);
                    if (eq && typeof verifyDressageResult === 'function') verifyDressageResult(sn, normalized, eq);
                }

                dressageStatusMap.set(sn, { ...cur, ...normalized });
                maybePushRecent(sn);
            });
            triggerRender();
        }));

        // Live
        unsubscribes.push(listenForDressageLiveGroup(competitionId, getAllEquipages(), (docs) => {
            docs.forEach(st => {
                const sn = String(st.startNumber);
                const known = dressageStatusMap.get(sn);
                if (known?.state === 'finished') return;

                let proto = st;
                if (st.protocol && typeof st.protocol === 'object') {
                    proto = { ...st, ...st.protocol };
                }

                const rawJid = proto?.judgeId || proto?.judgeUid || proto?.judge || null;
                const jid = normJudgeId(rawJid);

                if (proto && jid) {
                    proto = { ...proto, judgeId: jid };

                    if (!liveProtocolMap.has(sn)) liveProtocolMap.set(sn, new Map());

                    const existing = liveProtocolMap.get(sn).get(jid) || {};
                    let merged = { ...existing, ...proto };

                    const allJudges = getAllJudges();
                    if (!merged.position && !merged.judgePosition) {
                        const jObj = (allJudges || []).find(j => {
                            const jId = normJudgeId(j?.id || j?.uid || j?.judgeId || j?.judgeUid);
                            return jId && jId === jid;
                        }) || (allJudges || []).find(j =>
                            String(j?.position || '').toUpperCase() === String(proto?.position || proto?.judgePosition || '').toUpperCase()
                        );
                        if (jObj?.position) merged.position = String(jObj.position).toUpperCase();
                    }
                    if (!merged.position && merged.judgePosition) merged.position = String(merged.judgePosition).toUpperCase();
                    if (!merged.judgePosition && merged.position) merged.judgePosition = merged.position;

                    liveProtocolMap.get(sn).set(jid, merged);
                }

                const cur = dressageStatusMap.get(sn) || {};
                dressageStatusMap.set(sn, {
                    ...cur, ...st,
                    state: st?.state || cur.state || 'ongoing',
                    updatedAt: st?.updatedAt || cur.updatedAt
                });
            });
            triggerRender();
        }));

        // Protocols
        unsubscribes.push(listenForDressageProtocolsCollectionGroup(competitionId, getAllEquipages(), (docs) => {
            const grouped = new Map();
            docs.forEach(d => {
                const sn = String(d.startNumber);
                if (!grouped.has(sn)) grouped.set(sn, []);
                grouped.get(sn).push(d);
            });

            grouped.forEach((protocols, sn) => {
                savedProtocolsMap.set(sn, protocols);
                const eq = getAllEquipages().find(e => String(e.startNumber) === sn);
                if (!eq) return;

                const allJudges = getAllJudges();
                const cleanProtocols = deduplicateAndFilterProtocols(protocols, allJudges);
                const programs = getPrograms();
                const result = calculateDressageResult(eq, cleanProtocols, allJudges, programs);

                if (result && result.penalty != null) {
                    const cur = dressageStatusMap.get(sn) || {};
                    dressageStatusMap.set(sn, {
                        ...cur,
                        finalPercent: result.percent,
                        finalPoints: result.points,
                        finalPenalty: result.penalty,
                        errorPoints: result.errorPoints,
                        errorPenalty: result.penalty,
                        _calculated: true
                    });
                }
                maybePushRecent(sn);
            });
            triggerRender();
        }));
    }

    function setupMarathonListeners() {
        const maratonRef = collection(db, 'artifacts', appId, 'public', 'data', 'competitions', competitionId, 'maraton');
        const unsub = onSnapshot(maratonRef, (snapshot) => {
            snapshot.docChanges().forEach(change => {
                const sn = change.doc.id;
                const data = change.doc.data();
                if (change.type === 'removed') {
                    maratonStatusMap.delete(sn);
                } else {
                    maratonStatusMap.set(sn, data);
                    evaluateActiveState(sn, data);
                }
                maybePushRecentMarathon(sn, data);
            });
            triggerRender();
            ensureSpeakerTicker();
        });
        unsubscribes.push(unsub);

        unsubscribes.push(listenForConfig(competitionId, 'maratonConfig', (cfg) => {
            setMarathonConfig(cfg);
            triggerRender();
        }));
    }

    function setupPrecisionListeners() {
        const precisionRef = collection(db, 'artifacts', appId, 'public', 'data', 'competitions', competitionId, 'precision');
        const unsub = onSnapshot(precisionRef, (snapshot) => {
            snapshot.docChanges().forEach(change => {
                const sn = change.doc.id;
                const data = change.doc.data();
                if (change.type === 'removed') {
                    precisionStatusMap.delete(sn);
                } else {
                    data._receivedLocalAt = Date.now();
                    precisionStatusMap.set(sn, data);
                }
                maybePushRecentPrecision(sn, data);
            });
            triggerRender();
        });
        unsubscribes.push(unsub);

        unsubscribes.push(listenForConfig(competitionId, 'precisionConfig', (cfg) => {
            setPrecisionConfig(cfg || {});
            triggerRender();
        }));
    }
}
