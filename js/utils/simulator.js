
/**
 * simulator.js - Stress Test Simulator for Speaker Dashboard
 * 
 * Allows simulating a high-load environment directly in the browser.
 * Mocks incoming data streams for Marathon.
 */

export function startMarathonSimulation(options = {}) {
    const {
        driverCount = 15,
        updateInterval = 1000,
        activeRunnerCount = 5
    } = options;

    console.log(`🚀 Starting Marathon Simulation: ${driverCount} drivers, ${activeRunnerCount} active.`);

    // Access internals exposed by speaker.js (we need to ensure they are exposed)
    // We expect window.speakerInternals to be available or we can try to manipulate DOM directly?
    // No, better to simulate by injecting into the data structures if exposed.

    // Actually, since speaker.js uses `activeEquipages` (Map) and `maratonStatusMap` (Map),
    // and `triggerRender`.

    if (!window.speakerInternals) {
        console.error("❌ Speaker internals not exposed. Cannot run simulation.");
        return;
    }

    const {
        allEquipages,
        maratonStatusMap,
        triggerRender,
        activeEquipages
    } = window.speakerInternals;

    // 1. Generate Fake Drivers if needed (or use existing)
    // We will use existing equipages but override their status
    if (allEquipages.length < 5) {
        console.warn("⚠️ Too few equipages to simulate properly.");
    }

    // Reset status for simulation
    maratonStatusMap.clear();
    activeEquipages.clear();

    const simulationDrivers = allEquipages.slice(0, driverCount).map(e => ({ ...e }));

    // State tracking
    const runners = simulationDrivers.map(d => ({
        sn: d.startNumber,
        state: 'waiting', // waiting, on_course, finished
        lastObstacle: 0,
        startTime: 0,
        splits: [],
        totalPenalty: 0
    }));

    // Start Loop
    setInterval(() => {
        const now = Date.now();

        // Manage Runners
        runners.forEach(r => {
            if (r.state === 'waiting') {
                // Randomly start some
                if (runners.filter(x => x.state === 'on_course').length < activeRunnerCount) {
                    if (Math.random() > 0.8) {
                        r.state = 'on_course';
                        r.startTime = now;
                        console.log(`🏁 #${r.sn} Started!`);
                    }
                }
            } else if (r.state === 'on_course') {
                // Randomly progress obstacle
                if (Math.random() > 0.7) {
                    r.lastObstacle++;
                    r.totalPenalty += (Math.random() * 5); // Add random penalty

                    // Add split
                    r.splits.push({
                        id: r.lastObstacle,
                        number: r.lastObstacle,
                        timeSec: 30 + (Math.random() * 30),
                        penalty: Math.random() > 0.5 ? 2 : 0,
                        ts: now
                    });

                    console.log(`🚧 #${r.sn} Cleared Obstacle ${r.lastObstacle}`);

                    if (r.lastObstacle > 6) {
                        r.state = 'finished';
                        console.log(`🏁 #${r.sn} Finished!`);
                    }
                }
            }
        });

        // Sync to Speaker Maps
        runners.forEach(r => {
            const statusData = {
                state: r.state === 'on_course' ? 'ongoing' : (r.state === 'finished' ? 'finished' : 'waiting'),
                totalPenalty: r.totalPenalty,
                started: r.state !== 'waiting',
                startTime: r.startTime,
                // Mock movements/obstacles
                obstacles: r.splits.map(s => ({
                    id: s.id,
                    number: s.number,
                    penalty: s.penalty,
                    timeInSeconds: s.timeSec
                }))
            };

            maratonStatusMap.set(String(r.sn), statusData);

            if (r.state === 'on_course') {
                activeEquipages.set(String(r.sn), {
                    sn: r.sn,
                    startTime: r.startTime,
                    pausedMs: 0,
                    eq: allEquipages.find(e => e.startNumber === r.sn),
                    task: { type: 'obstacle', key: r.lastObstacle + 1, name: `Hinder ${r.lastObstacle + 1}` },
                    data: { live_gateSplits: [] }
                });
            } else {
                activeEquipages.delete(String(r.sn));
            }
        });

        // Force Update
        triggerRender();

    }, updateInterval);
}
