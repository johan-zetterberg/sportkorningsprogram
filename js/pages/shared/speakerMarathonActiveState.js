function timestampToMs(value) {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        const parsed = new Date(value).getTime();
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}

function fallbackStageStartTS(data = {}, stage) {
    if (stage === 'transport') return timestampToMs(data.start_transfer || data.start_transport || data.transportStartAt);
    return timestampToMs(data[`start_${stage}`] || data?.timing?.[stage]?.startAt);
}

function fallbackStageStopTS(data = {}, stage) {
    if (stage === 'transport') return timestampToMs(data.finish_transfer || data.stop_transfer || data.transportStopAt);
    return timestampToMs(data[`finish_${stage}`] || data[`stop_${stage}`] || data?.timing?.[stage]?.stopAt);
}

function fallbackStageDurationMsSaved(data = {}, stage) {
    return Number(data?.timing?.[stage]?.durationMs) || 0;
}

function fallbackIsWithdrawnOrExcluded(state, eqLikeObj = {}) {
    const text = [
        state,
        eqLikeObj.status,
        eqLikeObj.eqStatus,
        eqLikeObj.result,
        eqLikeObj.outcome
    ].map(v => String(v || '').toLowerCase()).join(' ');

    return !!(
        eqLikeObj.withdrawn ||
        eqLikeObj.scratched ||
        eqLikeObj.didNotStart ||
        eqLikeObj.dns ||
        eqLikeObj.eliminated ||
        eqLikeObj.excluded ||
        eqLikeObj.retired ||
        text.includes('withdrawn') ||
        text.includes('scratched') ||
        text.includes('did-not-start') ||
        text.includes('eliminated') ||
        text.includes('excluded') ||
        text.includes('retired') ||
        text.includes('struken')
    );
}

function findLatestObstacleResult(data = {}) {
    let latestExit = 0;
    let latestObstacle = null;
    const obstacleTimes = data.obstacleTimes || {};

    (data.obstacles || []).forEach(obstacle => {
        const numStr = String(obstacle.number || obstacle.obstacleNumber || obstacle.id);
        const timing = obstacleTimes[numStr];
        const exit = timestampToMs(timing?.exitAt || timing?.exitAtClient || obstacle.exitAt || obstacle.exitAtClient);

        if (exit > latestExit) {
            latestExit = exit;
            latestObstacle = obstacle;
        }
    });

    return { latestExit, latestObstacle };
}

export function buildSpeakerMarathonActiveEntry(sn, eq, data, options = {}) {
    if (!sn || !eq || !data) return null;

    const now = typeof options === 'number' ? options : (options.now ?? Date.now());
    const getLimitsFor = options.limitsFor || (() => null);
    const getStageStartTS = options.stageStartTS || fallbackStageStartTS;
    const getStageStopTS = options.stageStopTS || fallbackStageStopTS;
    const getStageDurationMsSaved = options.stageDurationMsSaved || fallbackStageDurationMsSaved;
    const isWithdrawn = options.isWithdrawnOrExcluded || fallbackIsWithdrawnOrExcluded;

    let task = { type: 'unknown', name: '', key: '' };
    let startTime = 0;
    let pausedMs = 0;
    let fixedElapsedMs = null;
    let timerBaseMs = 0;
    let isActive = false;

    if (data.currentObstacle && (data.liveObstacleStartAt || (data.liveObstacleTimeMs && data.liveObstacleTimeMs > 0))) {
        isActive = true;
        task = { type: 'obstacle', name: `Hinder ${data.currentObstacle}`, key: data.currentObstacle };

        if (data.running === true) {
            const lastUpdateMs = Number(data.liveObstacleTimeMs) || 0;
            const lastUpdateTime = timestampToMs(data.updatedAt) || now;
            timerBaseMs = lastUpdateTime - lastUpdateMs;
        } else {
            fixedElapsedMs = Number(data.liveObstacleTimeMs) || 0;
        }
    } else {
        let flashFound = false;
        if (Array.isArray(data.obstacles) && data.obstacles.length > 0) {
            const { latestExit, latestObstacle } = findLatestObstacleResult(data);

            if (latestObstacle && latestExit > 0 && (now - latestExit < 20000)) {
                isActive = true;
                flashFound = true;
                task = { type: 'result_flash', name: `Resultat Hinder ${latestObstacle.number}`, key: 'flash', data: latestObstacle };
                fixedElapsedMs = latestObstacle.timeMs || (latestObstacle.timeInSeconds * 1000) || 0;
                startTime = latestExit;
            }
        }

        if (!flashFound) {
            const limitsA = getLimitsFor(eq, 'A');
            const isFixedTimeA = limitsA && limitsA.ideal > 0 && limitsA.max === limitsA.ideal && limitsA.min === 0;
            const stages = [
                { key: 'A', name: isFixedTimeA ? 'Warm-up' : 'Etapp A' },
                { key: 'B', name: 'Etapp B' },
                { key: 'transport', name: 'Transport' }
            ];

            for (const stage of stages) {
                const start = getStageStartTS(data, stage.key);
                const stop = getStageStopTS(data, stage.key);
                if (start && !stop) {
                    isActive = true;
                    task = { type: 'stage', name: stage.name, key: stage.key };
                    timerBaseMs = start;
                    pausedMs = getStageDurationMsSaved(data, stage.key) || 0;
                    startTime = start;
                    break;
                }
            }
        }
    }

    if (!isActive) {
        const stateStr = String(data.state || eq.status || '').toLowerCase();
        if (!isWithdrawn(stateStr, { ...eq, ...data })) {
            const hasStopA = getStageStopTS(data, 'A');
            const hasStartB = getStageStartTS(data, 'B');
            if (hasStopA && !hasStartB) {
                isActive = true;
                task = { type: 'transport', name: 'Transport / Paus', key: 'wait_b' };
                timerBaseMs = hasStopA;
                startTime = hasStopA;
            }
        }
    }

    if (!isActive) return null;

    return {
        sn,
        eq,
        data,
        task,
        startTime,
        pausedMs,
        timerBaseMs,
        fixedElapsedMs,
        updatedAt: now
    };
}
