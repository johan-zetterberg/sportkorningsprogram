import { getGlobalState } from '../main.js';
import { getEquipages, getConfig, savePrecisionResult } from '../services/firestoreService.js';
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from '../config/firebase-config.js';
import { getCompetitionHeader, createSearchableDropdown, showAlert } from '../ui/components.js';
import { standardPortAllowance, klassTempoData } from '../data/competitionData.js';
import { downloadJson } from '../utils/sharedUtils.js';

// ---------- State ----------
let competitionId = null;
let equipages = [];
let precisionConfig = {};
let currentEquipage = null;
let searchableDropdown = null;

let knocks = new Set();
let extraPenalty = 0;
let comment = '';

let timerInterval = null;
let keydownHandler = null;
let startEpoch = 0;
let pausedMs = 0;
let lastPushedTick = -1; // throttlas nu till ~5 s
let inProgress = false; // <-- NY: håll “Pågår” tills Spara
let wasOverLimit = false; // minns om vi passerat maxtiden
let isRunning = false; // <-- NY explicit flagga

// Race-condition skydd
let currentLoadId = 0;

// ---------- Helpers (tid) ----------
const pad2 = (n) => String(n).padStart(2, '0');
const nowMs = () => Date.now();

function secondsToMMSS(seconds) {
    if (isNaN(seconds) || seconds < 0) return "--:--";
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function msToParts(ms) {
    const t = Math.max(0, Math.floor(ms || 0));
    const m = Math.floor(t / 60000);
    const s = Math.floor((t % 60000) / 1000);
    const cs = Math.floor((t % 1000) / 10);
    return { m, s, cs };
}
function partsToString({ m, s, cs }) { return `${pad2(m)}:${pad2(s)},${pad2(cs)}`; }
function getElapsedMs() {
    if (isRunning) {
        // Elapsad tid = ackumulerad pausad tid + tid sedan senaste start
        return pausedMs + (nowMs() - startEpoch);
    }
    return pausedMs;
}

function digitsToMs(d) {
    const s = (d || "").replace(/\D/g, '').slice(0, 6).padEnd(6, '0');
    const mm = +s.slice(0, 2), ss = +s.slice(2, 4), cs = +s.slice(4, 6);
    return (mm * 60 + ss) * 1000 + cs * 10;
}

// Mirror data to localStorage for redundancy
function mirrorToLocal(sn, data) {
    if (!sn || !data || !competitionId) return;
    try {
        const key = `bkp_${competitionId}_pre_${sn}`;
        localStorage.setItem(key, JSON.stringify({
            ts: Date.now(),
            data
        }));
    } catch (e) {
        console.warn('Could not mirror to localStorage', e);
    }
}

// ---------- Helpers (klass/port/max) ----------
// Normalisera inkommande ekipage-objekt till fält som dropdownen/appen förväntar sig
function normalizeEquipage(e) {
    const startNumber =
        Number(e?.startNumber ?? e?.startnr ?? e?.nr ?? e?.start ?? e?.startNo ?? e?.bib ?? 0);

    const driverName =
        e?.driverName ?? e?.driver ?? e?.name ?? e?.kusk ?? '';

    const className =
        e?.className ?? e?.class ?? e?.klass ?? '';

    const trackWidth =
        Number(e?.trackWidth ?? e?.trackWidthCm ?? e?.vagnbredd ?? e?.spannvidd ?? NaN);

    return {
        ...e, // behåll övriga fält orörda
        startNumber,
        driverName,
        className,
        trackWidth: Number.isFinite(trackWidth) ? trackWidth : null
    };
}

function getAllowanceForClass(cls) {
    const manualOverride = precisionConfig?.portAllowanceByClass?.[cls];
    if (Number.isFinite(manualOverride)) return manualOverride;
    const standardValue = standardPortAllowance[cls];
    if (Number.isFinite(standardValue)) return standardValue;
    return standardPortAllowance['*'] || null;
}
function computePortWidthForEquipage(eq) {
    const trackWidth = Number(eq?.trackWidth);
    const allowance = getAllowanceForClass(eq?.className || '');
    if (!Number.isFinite(trackWidth) || !Number.isFinite(allowance)) return null;
    return trackWidth + allowance;
}
function getMaxSecondsForClass(cls) {
    const courseData = precisionConfig.courses?.[cls];
    const trackLength = courseData?.trackLengthMeters;
    const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9åäö]/g, '');
    const nCls = normalize(cls);

    // 1. Exakt match
    let tempo = klassTempoData[cls];
    if (!tempo) {
        // 2. Normaliserad sökning
        const keys = Object.keys(klassTempoData);
        // Hitta nyckel som är prefix till klassnamnet
        const hit = keys.find(k => nCls.startsWith(normalize(k)));
        if (hit) tempo = klassTempoData[hit];
    }

    // Hämta värdet (kan vara objekt {maraton, precision} eller direkt nummer)
    const tVal = (typeof tempo === 'object') ? tempo.precision : tempo;

    if (trackLength > 0 && tVal > 0) return (trackLength / tVal) * 60;
    return null;
}
function getLabelsForClass(cls) {
    const courseData = precisionConfig.courses?.[cls];
    if (courseData && Array.isArray(courseData.obstacleLabels) && courseData.obstacleLabels.length > 0) {
        return courseData.obstacleLabels;
    }
    return [];
}
function obstaclePenalty() { return knocks.size * 3; }
function calculateLiveTimePenalty() {
    const maxSec = getMaxSecondsForClass(currentEquipage?.className);
    if (!Number.isFinite(maxSec)) return 0;
    const elapsedSec = getElapsedMs() / 1000;
    if (elapsedSec > maxSec) return (elapsedSec - maxSec) * 0.5;
    return 0;
}

// Ny hjälpfunktion som samlar all live-data
function getLivePayload() {
    const t = getElapsedMs();
    const liveTimePenalty = calculateLiveTimePenalty();
    const liveObstaclePenalty = obstaclePenalty();
    const extraPenaltyVal = parseFloat(document.getElementById('extraPenaltyInput').value) || 0;

    return {
        running: isRunning,
        inProgress: inProgress,
        liveTimeMs: t,
        // NYA fält för perfekt synkning
        liveStartEpoch: isRunning ? startEpoch : null,
        livePausedMs: pausedMs,
        // ---
        liveTimePenalty: parseFloat(liveTimePenalty.toFixed(2)),
        liveObstaclePenalty: liveObstaclePenalty,
        knocks: Array.from(knocks),
        extraPenalty: extraPenaltyVal,
        liveTotalPenalty: parseFloat((liveTimePenalty + liveObstaclePenalty + extraPenaltyVal).toFixed(2)),
        // NYTT:
        eliminated: !!document.getElementById('eliminatedInput').checked
    };
}

// Uppdaterad funktion som använder den nya hjälparen
function pushImmediateState() {
    if (!currentEquipage) return;
    // Anropar den nya funktionen för att få ett komplett och korrekt live-paket
    pushLiveSafe(getLivePayload());
}

function stringTimeToMs(label) {
    // "MM:SS,cc" -> ms
    if (!label || typeof label !== 'string') return 0;
    const m = label.match(/^(\d{1,2}):(\d{2}),(\d{2})$/);
    if (!m) return 0;
    const mm = parseInt(m[1], 10), ss = parseInt(m[2], 10), cs = parseInt(m[3], 10);
    return (mm * 60 + ss) * 1000 + cs * 10;
}

// ---------- Firestore live-doc ----------
function precisionDocRef(startNumber) {
    return doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/precision`, String(startNumber));
}
async function pushLiveSafe(update) {
    if (!currentEquipage) return;
    try {
        const snapshot = {
            startNumber: currentEquipage.startNumber,
            className: currentEquipage.className,
            ...update,
            updatedAt: Date.now() - 100 // Säkerhetsmarginal för klocksynk
        };
        await setDoc(precisionDocRef(currentEquipage.startNumber), snapshot, { merge: true });
        mirrorToLocal(currentEquipage.startNumber, snapshot);
    } catch (e) {
        console.warn('Live push misslyckades (troligen p.g.a. säkerhetsregler):', e.message);
    }
}

// ---------- UI Rendering ----------
// ===== NY renderLayout() i precision-input.js =====
function renderLayout() {
    const comp = getGlobalState('currentCompetition');
    const root = document.getElementById('page-precision-input');
    root.innerHTML = `
        <div class="container mx-auto p-4 md:p-8 max-w-2xl">
            ${getCompetitionHeader(comp, 'Precision – Inmatning (live)')} 

          
            <div class="bg-white p-6 rounded-xl shadow-md space-y-6">


                <div>
                    <label class="block text-sm font-medium">Ekipage</label>
                    <div class="flex items-center gap-2 mt-1">
                        <button id="btnPrevEq" class="p-3 border rounded-md bg-gray-100 hover:bg-gray-200" title="Föregående (←)">&larr;</button>
                        <div id="precisionEquipageSearchContainer" class="flex-grow text-center text-gray-500 italic">Laddar ekipage...</div>
                        <button id="btnNextEq" class="p-3 border rounded-md bg-gray-100 hover:bg-gray-200" title="Nästa (→)">&rarr;</button>
                    </div>
                </div>

              
                <div class="p-4 border rounded-lg bg-gray-50">
                    <div class="flex items-start justify-between gap-4 mb-3">

                        <div>
                            <div id="infoEquipageLine" class="font-semibold">–</div>
                            <div class="text-gray-600 text-sm">
                                Hinderbredd: <span id="infoPortWidth" class="font-medium">–</span> •
                                Maxtid: <span id="infoMaxTime" class="font-medium">–</span>
                            </div>
                        </div>

                        <div class="relative text-right">
                            <div id="liveTimer" class="text-4xl font-bold tabular-nums cursor-pointer" title="Klicka för att ändra tiden">00:00,00</div>
                            <div class="mt-1 text-sm">
                                <span class="text-gray-600">Tidsfel:</span>
                                <span id="uiTimePenaltyTop" class="tabular-nums font-semibold">0.00</span>
                            </div>

                            <div id="manualTimeEditor" class="hidden absolute right-0 mt-2 w-[320px] p-4 rounded-lg border bg-white shadow-lg z-40 text-left">
                                <label class="block text-sm mb-2">Manuell tid (mmsscc)</label>
                                <input id="manualTimeDigits" type="tel" inputmode="numeric" class="w-full text-3xl tracking-widest px-3 py-2 border rounded mb-3" placeholder="mmsscc" maxlength="6" />
                                <div class="flex gap-2">
                                    <button id="btnManualApply" class="flex-1 py-2 rounded bg-emerald-600 text-white">Använd</button>
                                    <button id="btnManualCancel" class="flex-1 py-2 rounded bg-gray-300">Avbryt</button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="flex items-center gap-2 border-t pt-3">
                        <button id="btnStart" class="flex-1 py-3 text-lg font-bold rounded-lg bg-emerald-600 text-white shadow-sm active:scale-95 transition-transform touch-manipulation">Start</button>
                        <button id="btnStop" class="flex-1 py-3 text-lg font-bold rounded-lg bg-red-600 text-white shadow-sm active:scale-95 transition-transform touch-manipulation">Stopp</button>
                        <button id="btnReset" class="py-3 px-4 rounded-lg bg-gray-200 text-gray-700 font-medium active:scale-95 transition-transform touch-manipulation">
                           <span class="sr-only">Nollställ</span>
                           🔄
                        </button>
                    </div>
                </div>

                <div class="p-4 border rounded-lg bg-white">
                    <h3 class="font-semibold mb-2">Hinder</h3>
                    <div id="gatesGrid" class="grid grid-cols-[repeat(auto-fit,minmax(72px,1fr))] gap-3">
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div class="md:col-span-1">
                        <label for="extraPenaltyInput" class="block text-sm font-medium">Extra Straffpoäng</label>
                        <input type="number" id="extraPenaltyInput" value="0" min="0" class="mt-1 w-full p-2 border rounded-md" placeholder="Ex: 10">
                    </div>
                     <!-- NYTT: Eliminerad-checkbox -->
                    <div class="md:col-span-1 flex items-end pb-2">
                       <label class="inline-flex items-center cursor-pointer p-2 border rounded hover:bg-red-50 w-full transition-colors">
                            <input type="checkbox" id="eliminatedInput" class="w-6 h-6 rounded border-gray-300 text-red-600 focus:ring-red-500">
                            <span class="ml-2 font-bold text-red-700">Eliminerad</span>
                        </label>
                    </div>
                    <div class="md:col-span-2">
                        <label for="commentInput" class="block text-sm font-medium">Kommentar</label>
                        <textarea id="commentInput" rows="1" class="mt-1 w-full p-2 border rounded-md" placeholder="Orsak till extra straff, etc."></textarea>
                    </div>
                </div>
        
                <div id="penaltySummary" class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                    <div class="rounded-lg bg-gray-50 px-3 py-2"><div class="text-gray-600">Tidsfel</div><div id="uiTimePenalty" class="font-semibold tabular-nums">0.00</div></div>
                    <div class="rounded-lg bg-gray-50 px-3 py-2"><div class="text-gray-600">Hinderstraff</div><div><span id="uiObstaclePenalty" class="font-semibold tabular-nums">0</span><span id="uiObstacleInfo" class="text-gray-500"></span></div></div>
                    <div class="rounded-lg bg-gray-50 px-3 py-2"><div class="text-gray-600">Annat</div><div id="uiExtraPenalty" class="font-semibold tabular-nums">0</div></div>
                    <div class="rounded-lg bg-blue-50 px-3 py-2"><div class="text-blue-800">Totalt</div><div id="uiTotalPenalty" class="font-semibold tabular-nums text-blue-900">0.00</div></div>
                </div>
                <div class="flex flex-col sm:flex-row gap-4 items-center justify-between">
                    <button id="btnSave" class="w-full md:w-auto text-lg px-6 py-3 bg-brand-darkblue text-white font-bold rounded-lg hover:bg-brand-gold hover:text-brand-darkblue">Spara Slutgiltigt Resultat</button>
                    <button id="btnBackupPreJson" type="button" class="text-xs text-blue-600 hover:underline flex items-center gap-1">
                        <i class="fas fa-file-download"></i> Ladda ner säkerhetskopia (JSON)
                    </button>
                </div>

            </div> 
        </div> 
    `;
}

function updateHeaderInfo() {
    const eq = currentEquipage;
    const equipageEl = document.getElementById('infoEquipageLine');
    const portEl = document.getElementById('infoPortWidth');
    const maxEl = document.getElementById('infoMaxTime');

    if (!eq) {
        [equipageEl, portEl, maxEl].forEach(el => { if (el) el.textContent = '–'; });
        return;
    }

    const portWidth = computePortWidthForEquipage(eq);
    const maxSeconds = getMaxSecondsForClass(eq.className);

    equipageEl.textContent = `#${eq.startNumber} ${eq.driverName || ''} (${eq.className})`;
    portEl.textContent = Number.isFinite(portWidth) ? `${portWidth} cm` : 'Ej angivet';
    maxEl.textContent = Number.isFinite(maxSeconds) ? secondsToMMSS(maxSeconds) : 'Ej angivet';
}

function renderGates() {
    const host = document.getElementById('gatesGrid');
    if (!host) return;
    const labels = getLabelsForClass(currentEquipage?.className);

    if (labels.length === 0) {
        host.innerHTML = `<p class="text-sm text-gray-500">Inga hinder definierade för denna klass i Precision Admin.</p>`;
        return;
    }

    host.innerHTML = labels.map(label => {
        const active = knocks.has(label);
        return `<button data-g="${label}" class="gateBtn p-1 aspect-square flex items-center justify-center rounded border text-lg ${active ? 'bg-red-600 text-white' : 'bg-white'}">${label}</button>`;
    }).join('');

    host.querySelectorAll('.gateBtn').forEach(btn => {
        btn.addEventListener('click', () => {
            const g = btn.dataset.g;
            if (knocks.has(g)) knocks.delete(g); else knocks.add(g);
            renderGates(); // uppdatera stil
            const liveTimePenalty = calculateLiveTimePenalty();
            const liveObstaclePenalty = obstaclePenalty();
            const extraPenaltyVal = parseFloat(document.getElementById('extraPenaltyInput').value) || 0;
            pushLiveSafe({
                knocks: Array.from(knocks),
                liveObstaclePenalty,
                liveTotalPenalty: parseFloat((liveTimePenalty + liveObstaclePenalty + extraPenaltyVal).toFixed(2))
            });
        });
    });
}

// ---------- Timer Controls & Event Handlers ----------

function updateTimerView() {
    const t = getElapsedMs();
    const out = document.getElementById('liveTimer');

    // --- 1) Klockan ---
    if (out) {
        out.textContent = partsToString(msToParts(t));

        // Röd/blink om över maxtid i input-vyn
        const cls = currentEquipage?.className;
        const maxSec = cls ? getMaxSecondsForClass(cls) : null;   // sekunder eller null
        const overLimitNow = Number.isFinite(maxSec) && t > (maxSec * 1000);

        out.classList.toggle('text-red-600', overLimitNow);
        out.classList.toggle('animate-pulse', overLimitNow);
        out.classList.toggle('font-semibold', overLimitNow);

        // --- 2) Tidsfel direkt under klockan ---
        const topTP = document.getElementById('uiTimePenaltyTop');
        if (topTP) {
            const liveTimePenaltyTop = calculateLiveTimePenalty();
            topTP.textContent = liveTimePenaltyTop.toFixed(2);
            topTP.classList.toggle('text-red-600', overLimitNow);
            topTP.classList.toggle('animate-pulse', overLimitNow);
            topTP.classList.toggle('font-semibold', overLimitNow);
        }

        // --- 3) Summeringspanelen längst ner ---
        const tpEl = document.getElementById('uiTimePenalty');
        const opEl = document.getElementById('uiObstaclePenalty');
        const oiEl = document.getElementById('uiObstacleInfo');
        const epEl = document.getElementById('uiExtraPenalty');
        const ttEl = document.getElementById('uiTotalPenalty');

        if (tpEl || opEl || epEl || ttEl) {
            const liveTimePenalty = calculateLiveTimePenalty();           // Number
            const liveObstaclePenalty = obstaclePenalty();                    // ex. rivningar*3
            const extraPenaltyVal = parseFloat(document.getElementById('extraPenaltyInput').value) || 0;
            const total = liveTimePenalty + liveObstaclePenalty + extraPenaltyVal;

            if (tpEl) {
                tpEl.textContent = liveTimePenalty.toFixed(2);
                // Matcha röd/blink även i panelen
                tpEl.classList.toggle('text-red-600', overLimitNow);
                tpEl.classList.toggle('animate-pulse', overLimitNow);
                tpEl.classList.toggle('font-semibold', overLimitNow);
            }
            if (opEl) opEl.textContent = Number.isFinite(liveObstaclePenalty) ? liveObstaclePenalty.toFixed(0) : '0';
            if (oiEl) {
                const rivningar = Number.isFinite(liveObstaclePenalty) ? Math.round(liveObstaclePenalty / 3) : 0;
                oiEl.textContent = rivningar > 0 ? ` (${rivningar} × 3)` : '';
            }
            if (epEl) epEl.textContent = Number.isFinite(extraPenaltyVal) ? extraPenaltyVal.toFixed(2) : '0.00';
            if (ttEl) ttEl.textContent = Number.isFinite(total) ? total.toFixed(2) : '—';
        }
    }

    // --- 4) Din befintliga throttlade live-push (~ var 5:e sekund) ---
    const tick = Math.floor(t / 5000);
    if (tick !== lastPushedTick) {
        lastPushedTick = tick;
        const liveTimePenalty = calculateLiveTimePenalty();
        const liveObstaclePenalty = obstaclePenalty();
        const extraPenaltyVal = parseFloat(document.getElementById('extraPenaltyInput').value) || 0;

        pushLiveSafe({
            running: !!timerInterval,
            liveStartEpoch: startEpoch, // VIKTIGT: Skicka med startEpoch för att "läka" om start-pushen misslyckades
            liveTimeMs: t,
            liveTimePenalty: parseFloat(liveTimePenalty.toFixed(2)),
            liveObstaclePenalty: liveObstaclePenalty,
            extraPenalty: extraPenaltyVal,
            liveTotalPenalty: parseFloat((liveTimePenalty + liveObstaclePenalty + extraPenaltyVal).toFixed(2))
        });
    }
}


function startTimer() {
    // Städa upp ev. gammalt interval
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    if (isRunning) return;

    isRunning = true;
    // Viktigt: starta från "nu" – vi ska INTE baka in pausedMs i startEpoch
    startEpoch = nowMs();

    timerInterval = setInterval(updateTimerView, 90); // ~10 fps i UI
    updateTimerView();     // uppdatera UI direkt
    inProgress = true;     // <-- NYTT
    pushImmediateState();  // meddela resultatvyn att vi kör (och att vi är inProgress)
}
function stopTimer() {
    // Om redan stoppad: pusha ändå läget (running:false)
    if (!isRunning) { pushImmediateState(); return; }

    // Lägg till den körda tiden till den ackumulerade
    pausedMs += (nowMs() - startEpoch);
    isRunning = false;

    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    updateTimerView();     // visa stoppad tid korrekt
    pushImmediateState();  // meddela live: running=false
}

function resetTimer() {
    stopTimer();
    pausedMs = 0;
    lastPushedTick = -1;
    inProgress = false;     // <-- NYTT: inte pågående längre
    updateTimerView();
    pushImmediateState();   // <-- pusha statusändringen direkt
}

async function onEquipageSelected(equipage) {
    // 1. Alltid nollställ formuläret först
    resetTimer();
    knocks.clear();
    document.getElementById('extraPenaltyInput').value = 0;
    document.getElementById('eliminatedInput').checked = false; // Reset
    document.getElementById('commentInput').value = '';

    // Nollställ även hinder visuellt direkt (så vi inte väntar på loadDriverData)
    renderGates();

    if (!equipage) {
        currentEquipage = null;
        updateHeaderInfo();
        return;
    }
    currentEquipage = equipage;

    // Anropa loadDriverData (som i sin tur laddar ev tidigare resultat)
    await loadDriverData(equipage);
}
// <-- onEquipageSelected slutar här

async function loadDriverData(equipage) {
    if (!equipage) return;

    let isFinalized = false;
    try {
        const docSnap = await getDoc(precisionDocRef(equipage.startNumber));
        // Grundåterställning av formulär - GÖR DETTA IGEN HÄR FÖR SÄKERHETS SKULL
        // (Men behåll eliminatedInput.checked = false om du vill vara säker på att det är rent innan load)
        knocks.clear();

        if (docSnap.exists()) {
            const data = docSnap.data();
            console.log('[PrecisionInput] Loaded data for', equipage.startNumber, data);

            // Kolla om klart
            isFinalized = !!data.finalized || data.status === 'Klar';

            // Ladda eliminerad-status - VIKTIGT: Sätt detta EXPLICIT baserat på data
            const isElim = !!data.eliminated;
            console.log('[PrecisionInput] Setting eliminated check to:', isElim);
            document.getElementById('eliminatedInput').checked = isElim;

            // Rivningar
            if (Array.isArray(data.knocks)) {
                knocks = new Set(data.knocks);
            }

            // Tid: prioritera timeMs, annars parsa "MM:SS,cc", annars ev. liveTimeMs
            if (Number.isFinite(data.timeMs)) {
                pausedMs = Math.max(0, data.timeMs | 0);
            } else if (typeof data.time === 'string') {
                pausedMs = stringTimeToMs(data.time);
            } else if (Number.isFinite(data.liveTimeMs)) {
                pausedMs = Math.max(0, data.liveTimeMs | 0);
            } else {
                pausedMs = 0;
            }

            // Extra straff och kommentar (ta sparade värden om de finns)
            if (Number.isFinite(data.extraPenalty)) {
                document.getElementById('extraPenaltyInput').value = data.extraPenalty;
            }
            if (typeof data.comment === 'string') {
                document.getElementById('commentInput').value = data.comment;
            }

            // Vi startar inte timern automatiskt även om data.running === true
            // Operatören får aktivt trycka Start om en pågående körning ska återupptas.
            updateTimerView();
            mirrorToLocal(equipage.startNumber, data);
        } else {
            // Om inget dokument finns, se till att eliminering är false (redan gjort i reset, men för tydlighet)
            document.getElementById('eliminatedInput').checked = false;
        }
    } catch (e) {
        console.error("Kunde inte ladda befintligt resultat:", e);
    }

    // Uppdatera headerraden och hinderknapparna efter att knocks/pausedMs satts
    updateHeaderInfo();
    renderGates();

    // Informera resultatvyn om basfakta (påverkar inte tid/straff)
    // Sänd med eliminated-statusen vi just laddat (eller nollställt)

    // NYTT: Om föraren INTE är klar, markera den som pågående direkt när vi laddar den
    // så att den syns på monitorn ("Väntar på start").
    // isFinalized har satts i try-blocket ovan om dokumentet fanns
    // Vi använder den direkt här.

    // Uppdatera lokal flagga för säkerhets skull
    inProgress = !isFinalized;

    pushLiveSafe({
        portWidthCm: computePortWidthForEquipage(equipage),
        trackWidthCm: Number(equipage.trackWidth) || null,
        eliminated: !!document.getElementById('eliminatedInput').checked,
        inProgress: inProgress
    });
}

async function saveFinal() {
    if (!currentEquipage) {
        showAlert("Inget ekipage valt.", false);
        return;
    }

    // 1) Stoppa och räkna ut tid + straff
    stopTimer();
    const timeMs = getElapsedMs();
    const timeStr = partsToString(msToParts(timeMs));
    const timeSec = timeMs / 1000;
    const maxSec = getMaxSecondsForClass(currentEquipage.className);

    const timePenaltyValue = (Number.isFinite(maxSec) && timeSec > maxSec)
        ? (timeSec - maxSec) * 0.5
        : 0;

    const obstaclePenaltyValue = obstaclePenalty(); // 3 p per rivning
    const extraPenaltyValue = parseFloat(document.getElementById('extraPenaltyInput').value) || 0;
    const totalPenaltyValue = parseFloat((timePenaltyValue + obstaclePenaltyValue + extraPenaltyValue).toFixed(2));

    const payload = {
        // --- FINAL FÄLT (det som resultat-vyn ska läsa) ---
        running: false,
        inProgress: false,
        finalized: true,                          // <-- VIKTIGT: Markera som klar
        status: 'Klar',                           // <-- VIKTIGT: Sätt status explicit
        time: timeStr,                            // "MM:SS,cc"
        timeMs: timeMs,                           // praktiskt att ha sparat också
        knocks: Array.from(knocks),               // ["5A","7",...]
        obstaclePenalty: obstaclePenaltyValue,    // heltal (3 per rivning)
        timePenalty: parseFloat(timePenaltyValue.toFixed(2)),
        extraPenalty: extraPenaltyValue,
        totalPenalty: totalPenaltyValue,
        eliminated: !!document.getElementById('eliminatedInput').checked, // Spara till final
        comment: document.getElementById('commentInput').value || '',

        // --- Rensa/överskugga live-fält så de inte missförstås ---
        liveTimeMs: timeMs,           // behåll offset för ev. klienter, men...
        liveTimePenalty: null,        // …nolla live-beräknat
        liveObstaclePenalty: null,
        liveTotalPenalty: null,
        // Nollställ även synk-fälten
        liveStartEpoch: null,
        livePausedMs: null,
    };

    try {
        await setDoc(
            precisionDocRef(currentEquipage.startNumber),
            {
                startNumber: currentEquipage.startNumber,
                className: currentEquipage.className,
                ...payload,
                updatedAt: Date.now()
            },
            { merge: true }
        );

        console.log('[PrecisionInput] saveFinal SUCCESS. Payload:', payload);
        if (!navigator.onLine) {
            showAlert(`Slutgiltigt resultat för #${currentEquipage.startNumber} har lagts i kön (Offline).`, 'offline');
        } else {
            showAlert(`Slutgiltigt resultat för #${currentEquipage.startNumber} har sparats.`);
        }
        // Raden som byter ekipage automatiskt är borttagen.
    } catch (err) {
        console.error('Fel vid sparning av precision:', err);
        showAlert('Kunde inte spara resultat.', false);
    }
}

// ---------- Lifecycle ----------

export async function load() {
    // Öka load-ID för att ogiltigförklara tidigare anrop
    currentLoadId++;
    const myLoadId = currentLoadId;

    const comp = getGlobalState('currentCompetition');
    competitionId = comp?.id;
    const root = document.getElementById('page-precision-input');
    if (!competitionId) {
        if (root) root.innerHTML = '<p class="p-8 text-center">Ingen tävling vald.</p>';
        return;
    }

    renderLayout();

    try {
        // Wrapper för timeout
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Timeout vid dataladdning (10s)")), 10000)
        );

        // 1) Hämta rådata med timeout
        const [equipagesRaw, precisionCfg] = await Promise.race([
            Promise.all([
                getEquipages(competitionId),
                getConfig(competitionId, 'precisionConfig')
            ]),
            timeoutPromise
        ]);

        // Om ett nytt anrop har gjorts medan vi väntade, avbryt tyst
        if (myLoadId !== currentLoadId) {
            console.log(`Load #${myLoadId} avbruten (ny load #${currentLoadId} pågår).`);
            return;
        }

        precisionConfig = precisionCfg || {};

        // 2) Normalisera + sortera
        equipages = (equipagesRaw || []).map(normalizeEquipage);
        const list = [...equipages].sort((a, b) => (a.startNumber || 0) - (b.startNumber || 0));

        // 3) Skapa sökbar dropdown med den normaliserade listan
        const searchContainer = document.getElementById('precisionEquipageSearchContainer');
        if (searchContainer) {
            searchableDropdown = createSearchableDropdown(searchContainer, list, onEquipageSelected);
        } else {
            console.error("Search container disappeared!");
        }

        // Event Listeners
        document.getElementById('btnStart').addEventListener('click', startTimer);
        document.getElementById('btnStop').addEventListener('click', stopTimer);
        document.getElementById('btnReset').addEventListener('click', () => {
            resetTimer();
            pushLiveSafe({ liveTimeMs: 0, running: false });
        });
        document.getElementById('btnSave').addEventListener('click', saveFinal);
        document.getElementById('extraPenaltyInput').addEventListener('input', () => {
            const liveTimePenalty = calculateLiveTimePenalty();
            const liveObstaclePenalty = obstaclePenalty();
            const extraPenaltyVal = parseFloat(document.getElementById('extraPenaltyInput').value) || 0;

            pushLiveSafe({
                extraPenalty: extraPenaltyVal,
                liveTotalPenalty: parseFloat((liveTimePenalty + liveObstaclePenalty + extraPenaltyVal).toFixed(2))
            });
        });

        // Koppla eliminering till live-uppdatering
        document.getElementById('eliminatedInput').addEventListener('change', () => {
            pushImmediateState();
        });



        const goNext = () => {
            const idx = list.findIndex(e => e.startNumber === currentEquipage?.startNumber);
            if (idx > -1 && idx < list.length - 1) {
                searchableDropdown.setValue(list[idx + 1].startNumber);
            }
        };
        const goPrev = () => {
            const idx = list.findIndex(e => e.startNumber === currentEquipage?.startNumber);
            if (idx > 0) {
                searchableDropdown.setValue(list[idx - 1].startNumber);
            }
        };


        document.getElementById('btnNextEq').addEventListener('click', goNext);
        document.getElementById('btnPrevEq').addEventListener('click', goPrev);
        keydownHandler = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (e.key === 'ArrowLeft') goPrev();
            if (e.key === 'ArrowRight') goNext();
        };
        window.addEventListener('keydown', keydownHandler);

        document.getElementById('btnBackupPreJson')?.addEventListener('click', () => {
            const backup = {};
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key.startsWith(`bkp_${competitionId}_pre_`)) {
                    backup[key] = JSON.parse(localStorage.getItem(key));
                }
            }
            const filename = `backup_precision_${competitionId}_${new Date().toISOString().split('T')[0]}.json`;
            downloadJson(filename, backup);
        });

        // Manuell tid
        const manualEditor = document.getElementById('manualTimeEditor');
        document.getElementById('liveTimer').addEventListener('click', () => manualEditor.classList.remove('hidden'));
        document.getElementById('btnManualCancel').addEventListener('click', () => manualEditor.classList.add('hidden'));
        document.getElementById('btnManualApply').addEventListener('click', () => {
            pausedMs = digitsToMs(document.getElementById('manualTimeDigits').value);
            stopTimer();         // garanterar running:false och uppdaterar pausedMs
            updateTimerView();   // visar tiden
            pushImmediateState(); // <-- meddela resultatvyn den nya stoppade tiden
            manualEditor.classList.add('hidden');
        });

    } catch (error) {
        // Ignorera fel om vi bytt load-session
        if (myLoadId !== currentLoadId) return;

        console.error("Kunde inte ladda precisionsinmatning:", error);
        const el = document.getElementById('precisionEquipageSearchContainer');
        if (el) el.innerHTML = `<span class="text-red-500 font-bold">Kunde inte ladda ekipage.<br><span class="text-xs font-normal text-gray-700">${error.message}</span></span>`;
        // showAlert("Ett kritiskt fel uppstod vid laddning av sidan.", false);
    }
}

export function __unload() {
    // Invalidera pågående load
    currentLoadId++;

    // Stoppa timer
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }

    // Ta bort keydown-lyssnaren med rätt referens
    if (keydownHandler) {
        try { window.removeEventListener('keydown', keydownHandler); } catch { }
        keydownHandler = null;
    }

    // Förstör dropdown om den finns
    if (searchableDropdown && typeof searchableDropdown.destroy === 'function') {
        try { searchableDropdown.destroy(); } catch (e) { console.warn("Destroy dropdown misslyckades:", e); }
    }

    // Nollställ state EFTER att vi förstört komponenter
    isRunning = false;
    currentEquipage = null;
    equipages = [];
    searchableDropdown = null;
}