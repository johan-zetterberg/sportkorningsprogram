import { onSnapshot, doc, collection } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { db, appId } from '../../config/firebase-config.js';

import { listenForDressageLiveGroup, listenForDressageStatusCollection, listenForDressageProtocolsCollectionGroup } from '../../services/dressageService.js';
import { listenForConfig } from '../../services/competitionService.js';
import { listenForJudges } from '../../services/adminService.js';

import { getPrograms, deduplicateAndFilterProtocols, normJudgeId } from '../../utils/dressageUtils.js';
import { calculateDressageResult } from '../../services/calculationService.js';
import { setMarathonConfig, buildMergeMap, ensureMergeDecorations, setPauseWindows } from '../../utils/marathonUtils.js';

import { expandDressagePosition } from './speakerHelpers.js';
import {
    applySpeakerDressageCalculatedResult,
    applySpeakerDressageLiveDoc,
    applySpeakerDressageStatusDocs,
    applySpeakerMarathonDocChanges,
    applySpeakerPrecisionDocChanges,
    groupSpeakerDressageProtocolsByStartNumber
} from './speakerStateUtils.js';

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
    savedProtocolsMap.clear();
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

    function getEquipageByStartNumber() {
        return new Map((getAllEquipages() || []).map(eq => [String(eq.startNumber), eq]));
    }

    function setupDressageListeners() {
        // Status
        unsubscribes.push(listenForDressageStatusCollection(competitionId, (docs) => {
            const previousStates = new Map();
            const equipageByStartNumber = getEquipageByStartNumber();
            docs.forEach(st => {
                const sn = String(st.id || st.startNumber);
                if (!sn) return;
                previousStates.set(sn, dressageStatusMap.get(sn) || {});
            });

            const changedStartNumbers = applySpeakerDressageStatusDocs(docs, dressageStatusMap, liveProtocolMap);

            changedStartNumbers.forEach(sn => {
                const cur = previousStates.get(sn) || {};
                const normalized = dressageStatusMap.get(sn) || {};

                if (normalized.state === 'finished' && normalized.finalPenalty != null && cur.state !== 'finished') {
                    const eq = equipageByStartNumber.get(sn);
                    if (eq && typeof verifyDressageResult === 'function') verifyDressageResult(sn, normalized, eq);
                }

                maybePushRecent(sn);
            });
            triggerRender();
        }));

        // Live
        unsubscribes.push(listenForDressageLiveGroup(competitionId, getAllEquipages(), (docs) => {
            docs.forEach(st => {
                applySpeakerDressageLiveDoc(st, dressageStatusMap, liveProtocolMap, getAllJudges(), normJudgeId);
            });
            triggerRender();
        }));

        // Protocols
        unsubscribes.push(listenForDressageProtocolsCollectionGroup(competitionId, getAllEquipages(), (docs) => {
            const grouped = groupSpeakerDressageProtocolsByStartNumber(docs);
            const equipageByStartNumber = getEquipageByStartNumber();
            const allJudges = getAllJudges();
            const programs = getPrograms();

            grouped.forEach((protocols, sn) => {
                savedProtocolsMap.set(sn, protocols);
                const eq = equipageByStartNumber.get(sn);
                if (!eq) return;

                const cleanProtocols = deduplicateAndFilterProtocols(protocols, allJudges);
                const result = calculateDressageResult(eq, cleanProtocols, allJudges, programs);

                if (result && result.penalty != null) {
                    applySpeakerDressageCalculatedResult(dressageStatusMap, liveProtocolMap, sn, result, { _calculated: true });
                }
                maybePushRecent(sn);
            });
            triggerRender();
        }));
    }

    function setupMarathonListeners() {
        const maratonRef = collection(db, 'artifacts', appId, 'public', 'data', 'competitions', competitionId, 'maraton');
        const unsub = onSnapshot(maratonRef, (snapshot) => {
            const changes = snapshot.docChanges();
            applySpeakerMarathonDocChanges(changes, maratonStatusMap, activeEquipages, evaluateActiveState);
            changes.forEach(change => {
                if (change.type !== 'removed') maybePushRecentMarathon(change.doc.id, change.doc.data());
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
            const changes = snapshot.docChanges();
            applySpeakerPrecisionDocChanges(changes, precisionStatusMap, Date.now());
            changes.forEach(change => {
                if (change.type !== 'removed') maybePushRecentPrecision(change.doc.id, change.doc.data());
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
