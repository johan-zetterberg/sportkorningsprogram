import { auth } from './config/firebase-config.js';
import { dressagePrograms } from './data/dressagePrograms.js';
import { 
    createCompetition, 
    updateCompetition,
    saveConfig,
    saveEquipage,
    saveDressageJudgeProtocol,
    saveDressageGeneralData,
    saveMarathonTimingData,
    saveMarathonObstacleResult,
    setDocData 
} from './services/firestoreService.js';

const statusEl = document.getElementById('status');
const seedBtn = document.getElementById('seedBtn');
const linkContainer = document.getElementById('linkContainer');
const portalLink = document.getElementById('portalLink');

function logInfo(msg) {
    statusEl.textContent += `\n[${new Date().toLocaleTimeString()}] ${msg}`;
    statusEl.scrollTop = statusEl.scrollHeight;
}

seedBtn.addEventListener('click', async () => {
    seedBtn.disabled = true;
    seedBtn.classList.add('opacity-50', 'cursor-not-allowed');
    linkContainer.classList.add('hidden');
    
    try {
        if (!auth.currentUser) {
            logInfo('Väntar på autentisering...');
            await new Promise(resolve => {
                const unsubscribe = auth.onAuthStateChanged(user => {
                    if (user) {
                        unsubscribe();
                        resolve();
                    }
                });
                setTimeout(() => resolve(), 3000); // timeout
            });
            if (!auth.currentUser) {
                throw new Error("Du måste vara inloggad (superadmin/admin) för att köra seeder.");
            }
        }

        logInfo(`Inloggad som: ${auth.currentUser.email}`);
        logInfo('Skapar testtävling...');

        // 1. Skapa tävlingen
        const compRef = await createCompetition({
            name: "AUTO-TEST: Core Engine Validation",
            place: "Virtual Arena",
            dates: new Date().toISOString().split('T')[0],
            club: "Test Club"
        });
        const compId = compRef.id;
        logInfo(`Tävling skapad med ID: ${compId}`);

        await updateCompetition(compId, { published: true });

        // 2. Sätt Konfigurationer
        logInfo('Sparar maratonkonfiguration...');
        await saveConfig(compId, 'maratonConfig', {
            marathonClassData: {
                "Lätt B": { distanceA: 2000, tempoA: 250, distanceB: 3500, tempoB: 200.0, windowA: 2, windowB: 3, obstaclePenaltyRate: 0.25, maxObstacles: 4 },
                "Lätt A": { distanceA: 2500, tempoA: 250, distanceB: 4000, tempoB: 216.666, windowA: 2, windowB: 3, obstaclePenaltyRate: 0.25, maxObstacles: 5 },
                "Msv": { distanceA: 3000, tempoA: 250, distanceB: 5000, tempoB: 233.333, windowA: 2, windowB: 3, obstaclePenaltyRate: 0.25, maxObstacles: 6 },
                "Svår": { distanceA: 3500, tempoA: 250, distanceB: 6000, tempoB: 233.333, windowA: 2, windowB: 3, obstaclePenaltyRate: 0.25, maxObstacles: 7 },
                "FEI_CAI1": { distanceA: 3500, tempoA: 250, distanceB: 6000, tempoB: 233.333, windowA: 2, windowB: 3, obstaclePenaltyRate: 0.25, maxObstacles: 7 },
                "Msv Para": { distanceA: 3000, tempoA: 250, distanceB: 5000, tempoB: 216.666, windowA: 2, windowB: 3, obstaclePenaltyRate: 0.25, maxObstacles: 6 }
            },
            timePenaltyRate: 0.25
        });

        logInfo('Sparar precisionskonfiguration...');
        await saveConfig(compId, 'precisionConfig', {
            maxTimeByClass: {
                "Lätt B": 200,
                "Lätt A": 190,
                "Msv": 180,
                "Svår": 170,
                "FEI_CAI1": 170,
                "Msv Para": 210
            },
            timePenaltyRate: 0.5,
            knockdownPenalty: 3
        });

        // 3. Ekipage & Resultat (30 Drivers)
        const classes = [
            { className: "Lätt B", testKey: "SvLB", idealA: 480, idealB: 1050, precMax: 200, obsCount: 4 },
            { className: "Lätt A", testKey: "SvLA", idealA: 600, idealB: 1108, precMax: 190, obsCount: 5 },
            { className: "Msv", testKey: "SvMsvB", idealA: 720, idealB: 1286, precMax: 180, obsCount: 6 },
            { className: "Svår", testKey: "SvMsvC", idealA: 840, idealB: 1543, precMax: 170, obsCount: 7 },
            { className: "FEI_CAI1", testKey: "FEI_CAI1_Para", idealA: 840, idealB: 1543, precMax: 170, obsCount: 7 },
            { className: "Msv Para", testKey: "SvMsvB", idealA: 720, idealB: 1385, precMax: 210, obsCount: 6 }
        ];

        const drivers = [];
        let idCounter = 1;
        for (const cls of classes) {
            for (let i = 0; i < 5; i++) {
                const id = idCounter++;
                const profileType = i; 
                let description = "";
                if (i === 0) description = "Felfri";
                if (i === 1) description = "Dressyrfel + Prec Tidsfel";
                if (i === 2) description = "Maraton Tidsfel + Prec Manuell";
                if (i === 3) description = "Maraton Hinderfel + Prec Riv";
                if (i === 4) {
                    if (id % 3 === 0) description = "Elim Dressyr";
                    else if (id % 3 === 1) description = "Elim Maraton";
                    else description = "Elim Precision";
                }

                drivers.push({
                    id,
                    name: `Kusk ${id} - ${description}`,
                    className: cls.className,
                    horse: `Häst ${id}`,
                    testKey: cls.testKey,
                    idealA: cls.idealA,
                    idealB: cls.idealB,
                    precMax: cls.precMax,
                    obsCount: cls.obsCount,
                    profileType
                });
            }
        }

        for (const driver of drivers) {
            logInfo(`\n>>> Skapar ekipage #${driver.id}: ${driver.name} (${driver.className})`);
            await saveEquipage(compId, driver.id, {
                startNumber: driver.id,
                driverName: driver.name,
                className: driver.className,
                horseName: driver.horse,
                testKey: driver.testKey,
                category: "horse"
            });

            // Parse elimination rules
            let dElim = driver.profileType === 4 && driver.id % 3 === 0;
            let mElim = driver.profileType === 4 && driver.id % 3 === 1;
            let pElim = driver.profileType === 4 && driver.id % 3 === 2;

            // --- DRESSYR ---
            logInfo(`    -> Dressyrprotokoll...`);
            let p1Score = 6, p2Score = 7;
            let errPoints = 0;
            if (driver.profileType === 1) errPoints = 5;
            
            await saveDressageGeneralData(compId, driver.id, { errorPoints: errPoints, errorComment: errPoints > 0 ? "Felkörning" : "", eliminated: dElim });
            
            // Dynamically generate the full protocol from the actual program definition
            const program = dressagePrograms[driver.testKey];
            const movements1 = [];
            const movements2 = [];
            
            if (program && program.movements) {
                for (const m of program.movements) {
                    let s1 = (Math.floor(Math.random() * 3) + 6); // 6, 7, or 8
                    let s2 = (Math.floor(Math.random() * 3) + 6);
                    
                    if (driver.profileType === 1 && m.no === 3) {
                        s1 = 4; s2 = 4; // Emulate a bad movement
                    }
                    
                    movements1.push({ momentNo: m.no, score: s1 });
                    movements2.push({ momentNo: m.no, score: s2 });
                }
            } else {
                movements1.push({ momentNo: 1, score: 6 });
                movements2.push({ momentNo: 1, score: 7 });
            }
            
            await saveDressageJudgeProtocol(compId, driver.id, "1", {
                testKey: driver.testKey, eliminated: dElim,
                movements: movements1
            });
            await saveDressageJudgeProtocol(compId, driver.id, "2", {
                testKey: driver.testKey, eliminated: dElim,
                movements: movements2
            });

            // --- MARATON ---
            logInfo(`    -> Maraton...`);
            let durA = driver.idealA;
            let durB = driver.idealB; 
            if (driver.profileType === 2) durA += 60; // 60s over ideal A
            if (driver.profileType === 1) durB += 10; // slightly slow in B
            
            await saveMarathonTimingData(compId, driver.id, {
                className: driver.className,
                duration_A_ms: durA * 1000,
                duration_B_ms: durB * 1000
            });

            for (let obs = 1; obs <= driver.obsCount; obs++) {
                let t = 40 + (obs * 2);
                let p = 0;
                let isElim = mElim && obs === 2; // Eliminate at obstacle 2
                
                if (driver.profileType === 3 && obs === 1) p = 3; // 3 penalty points on obs 1
                
                // Simulate passing gates A, B, C, D
                const baseTs = Date.now();
                const gateSplits = [
                    { char: 'A', ts: baseTs },
                    { char: 'B', ts: baseTs + 10000 },
                    { char: 'C', ts: baseTs + 20000 },
                    { char: 'D', ts: baseTs + 30000 }
                ];

                await saveMarathonObstacleResult(compId, driver.id, obs, {
                    timeSeconds: t, penalty: p, eliminated: isElim, comment: isElim ? "Utesluten i hinder 2" : "",
                    gateSplits: gateSplits
                });
                
                if (isElim) break;
            }

            // --- PRECISION ---
            logInfo(`    -> Precision...`);
            let pTime = driver.precMax * 1000 - 10000; // 10s under max
            let pKnocks = 0;
            let knocksArray = [];
            let pExtra = 0;
            
            if (driver.profileType === 1) pTime = driver.precMax * 1000 + 5000; // 5s over time limit
            if (driver.profileType === 3) {
                pKnocks = 2; // 2 knockdowns
                knocksArray = ["4", "7A"];
            }
            if (driver.profileType === 2) pExtra = 5; // 5 extra manual penalty
            
            let precisionPayload = {
                finalized: true,
                status: 'Klar',
                timeMs: pTime,
                extraPenalty: pExtra,
                knocks: knocksArray,
                obstaclePenalty: pKnocks * 3,
                eliminated: pElim
            };

            await setDocData(`competitions/${compId}/precision`, String(driver.id), precisionPayload);
        }

        logInfo('\n✅ Seeding slutförd framgångsrikt!');
        
        localStorage.setItem('lastCompetitionId', compId);
        portalLink.href = `index.html#total-resultat`;
        linkContainer.classList.remove('hidden');

    } catch (e) {
        logInfo(`❌ FEL: ${e.message}`);
        console.error(e);
    } finally {
        seedBtn.disabled = false;
        seedBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
});
