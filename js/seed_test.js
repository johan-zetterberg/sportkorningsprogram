import { auth } from './config/firebase-config.js';
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
    console.log(msg);
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
                "Msv": { distanceA: 3000, tempoA: 250, distanceB: 5000, tempoB: 233.333, windowA: 2, windowB: 3, obstaclePenaltyRate: 0.25 },
                "LA": { distanceA: 2500, tempoA: 250, distanceB: 4000, tempoB: 216.666, windowA: 2, windowB: 3, obstaclePenaltyRate: 0.25 },
                "LB": { distanceA: 2000, tempoA: 250, distanceB: 3500, tempoB: 200.0, windowA: 2, windowB: 3, obstaclePenaltyRate: 0.25 },
                "Msv Para": { distanceA: 3000, tempoA: 250, distanceB: 5000, tempoB: 216.666, windowA: 2, windowB: 3, obstaclePenaltyRate: 0.25 }
            },
            timePenaltyRate: 0.25
        });

        logInfo('Sparar precisionskonfiguration...');
        await saveConfig(compId, 'precisionConfig', {
            maxTimeByClass: {
                "Msv": 180,
                "LA": 190,
                "LB": 200,
                "Msv Para": 210
            },
            timePenaltyRate: 0.5,
            knockdownPenalty: 3
        });

        // 3. Ekipage & Resultat
        const drivers = [
            { id: 1, name: "Testkusk 1 (Standard Msv)", className: "Msv", horse: "Mock Horse 1", testKey: "SvMsvB" },
            { id: 2, name: "Testkusk 2 (LA, Straff)", className: "LA", horse: "Mock Horse 2", testKey: "SvLA" },
            { id: 3, name: "Testkusk 3 (LB, Manuell Straff)", className: "LB", horse: "Mock Horse 3", testKey: "SvLB" },
            { id: 4, name: "Testkusk 4 (Eliminerad Maraton)", className: "Msv Para", horse: "Mock Horse 4", testKey: "SvMsvB" }
        ];

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

            // --- DRESSYR ---
            logInfo(`    -> Dressyrprotokoll...`);
            let p1Score = 6, p2Score = 7;
            let errPoints = 0;
            if (driver.id === 2) { errPoints = 5; } // LA: 5 felkörningspoäng
            
            await saveDressageGeneralData(compId, driver.id, { errorPoints: errPoints, errorComment: errPoints > 0 ? "Felkörning" : "" });
            
            await saveDressageJudgeProtocol(compId, driver.id, "1", {
                testKey: driver.testKey,
                movements: [{ momentNo: 1, score: p1Score }, { momentNo: 2, score: p1Score + 1 }, { momentNo: 3, score: p1Score - 1 }]
            });
            await saveDressageJudgeProtocol(compId, driver.id, "2", {
                testKey: driver.testKey,
                movements: [{ momentNo: 1, score: p2Score }, { momentNo: 2, score: p2Score + 1 }, { momentNo: 3, score: p2Score - 1 }]
            });

            // --- MARATON ---
            logInfo(`    -> Maraton...`);
            let durA = 720, durB = 1200; // Msv idealA: 720s. LA idealA: 600s.
            if (driver.id === 2) { durA = 750; } // 150s över för LA (Ideal 600s, max 600s) -> time penalty
            
            await saveMarathonTimingData(compId, driver.id, {
                className: driver.className,
                duration_A_ms: durA * 1000,
                duration_B_ms: durB * 1000
            });

            if (driver.id === 4) {
                // ELIM i maraton
                await saveMarathonObstacleResult(compId, driver.id, 1, {
                    timeSeconds: 50, penalty: 0, eliminated: true, comment: "Utesluten i hinder 1"
                });
            } else {
                // Vanliga hinder
                await saveMarathonObstacleResult(compId, driver.id, 1, {
                    timeSeconds: 40, penalty: (driver.id === 3 ? 5 : 0), eliminated: false // Extrastraff för driver 3
                });
                await saveMarathonObstacleResult(compId, driver.id, 2, {
                    timeSeconds: 60, penalty: (driver.id === 3 ? 2 : 0), eliminated: false
                });
            }

            // --- PRECISION ---
            logInfo(`    -> Precision...`);
            let pTime = 175000; // 175s
            let pKnocks = 0;
            let pExtra = 0;
            
            if (driver.id === 1) { pTime = 185000; } // 185s -> 5s tidsfel för Msv (max 180)
            if (driver.id === 2) { pKnocks = 2; pTime = 195000; } // Rivningar + tidsfel (max 190)
            if (driver.id === 3) { pExtra = 10; } // Manuell extrastraff
            
            let precisionPayload = {
                finalized: true,
                status: 'Klar',
                timeMs: pTime,
                extraPenalty: pExtra,
                knocks: Array(pKnocks).fill("X"),
                obstaclePenalty: pKnocks * 3,
                eliminated: false
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
