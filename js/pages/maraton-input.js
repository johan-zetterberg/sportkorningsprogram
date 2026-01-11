import { getGlobalState } from '../main.js';
import {
  getEquipages,
  getConfig,
  listenForMarathonObstacles,
  getStartTimes,
  saveMarathonObstacleResult,
} from '../services/firestoreService.js';
import {
  setPauseWindows,
  getObstacleCoefficient,
} from '../utils/marathonUtils.js';
import { getCompetitionHeader, createSearchableDropdown, showAlert } from '../ui/components.js';
import { downloadJson } from '../utils/sharedUtils.js';

// Firestore för live (endast det vi använder på denna sida)
import { doc, getDoc, setDoc, serverTimestamp, onSnapshot, Timestamp }
  from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from '../config/firebase-config.js';


// --- Lokal state och hjälpfunktioner för modulen ---
let competitionId = null;
let sortedEquipages = [];
let equipageSearchDropdownMar = null;
let marathonConfigCache = null;     // för att veta hur många portar klassen har
let unsubObstacles = null;   // återkallare för lyssnaren
let boundHandlers = {};      // samlar på oss event-handlers att kunna ta bort
let obstacleList = []; // Sparar listan med hinderkonfiguration

// ---- LIVE state (återanvänder precisionens modell) ----
let currentEquipage = null;
let timerInterval = null;
let startEpoch = 0;
let pausedMs = 0;
let lastPushedTick = -1;
let inProgress = false;
let isRunning = false;
let currentObstacleNumber = null; // vilken hinderpost vi mäter live på just nu
let extraPenaltyLive = 0;         // frivillig snabb-”annat” under pågående mätning

// ---- Tidshjälpare (kopierat från precision) ----
const pad2 = (n) => String(n).padStart(2, '0');
const nowMs = () => Date.now();
function msToParts(ms) {
  const t = Math.max(0, Math.floor(ms || 0));
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const cs = Math.floor((t % 1000) / 10);
  return { m, s, cs };
}
function partsToString({ m, s, cs }) { return `${pad2(m)}:${pad2(s)},${pad2(cs)}`; }
// Mirror data to localStorage for redundancy
function mirrorToLocal(sn, data) {
  if (!sn || !data) return;
  try {
    const key = `bkp_${competitionId}_mar_${sn}`;
    localStorage.setItem(key, JSON.stringify({
      ts: Date.now(),
      data
    }));
  } catch (e) {
    console.warn('Could not mirror to localStorage', e);
  }
}

function getElapsedMsFromState(state) {
  if (!state) return 0;
  const accumulated = state.liveObstacleTimeMs || 0;
  if (state.running && state.liveObstacleStartAt) {
    // Klockan går: ackumulerad tid + tid sedan senaste start
    const startTime = state.liveObstacleStartAt.toMillis();
    const elapsedSinceStart = Date.now() - startTime;
    return accumulated + elapsedSinceStart;
  }
  // Klockan är pausad: visa bara ackumulerad tid
  return accumulated;
}

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
// ==== LIVE-cache för resultatvyn ====
const marathonMap = new Map();

// Formatter för mm:ss,cc i resultatlistan
function fmtMs(ms) {
  const t = Math.max(0, Number(ms) || 0);
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const cs = Math.floor((t % 1000) / 10);
  const pad2 = (n) => String(n).padStart(2, '0');
  return `${pad2(m)}:${pad2(s)},${pad2(cs)}`;
}
function digitsToMs(d) {
  const s = (d || "").replace(/\D/g, '').slice(0, 6).padEnd(6, '0');
  const mm = +s.slice(0, 2), ss = +s.slice(2, 4), cs = +s.slice(4, 6);
  return (mm * 60 + ss) * 1000 + cs * 10;
}

// NY FUNKTION FÖR ATT HANTERA GLOBAL PAUS
function listenForGlobalCompetitionPause_Obstacles() {
  if (!competitionId || !appId) return;
  const statusRef = doc(db, 'artifacts', appId, 'public', 'data', 'competitions', competitionId, 'config', 'globalStatus');
  let lastPauseState = false;
  let pauseStartTime = 0;

  return onSnapshot(statusRef, (docSnap) => {
    const isPaused = docSnap.exists() && docSnap.data().isPaused === true;

    if (isPaused && !lastPauseState) {
      // TÄVLINGEN PAUSAS NU
      console.log("Global paus aktiverad. Stoppar hindertimer.");
      if (timerInterval) clearInterval(timerInterval);
      timerInterval = null;
      pauseStartTime = Date.now();

      // Pausa den pågående mätningen i Firestore
      if (currentLiveState.running) {
        const pausedTime = getElapsedMsFromState(currentLiveState);
        pushLiveSafe({
          running: false, // Markera som pausad
          liveObstacleTimeMs: pausedTime, // Spara ackumulerad tid
          liveObstacleStartAt: null
        });
      }
      document.body.style.filter = 'grayscale(80%)';

    } else if (!isPaused && lastPauseState) {
      // TÄVLINGEN ÅTERUPPTAS NU
      console.log("Global paus avslutad. Återupptar hindertimer.");

      // Återuppta mätningen i Firestore
      if (!currentLiveState.running && currentLiveState.inProgress) {
        pushLiveSafe({
          running: true,
          liveObstacleStartAt: serverTimestamp()
        });
      }
      document.body.style.filter = '';
    }
    lastPauseState = isPaused;
  });
}

// UPPDATERAD MED BÄTTRE LOGIK OCH KOMMENTARER ENLIGT TR
function validateRouteString(routeStr, expectedGates) {
  const tokens = (routeStr || '').trim().split(/\s+/).filter(Boolean);

  // Om ingen väg angetts
  if (tokens.length === 0) {
    return { styledHtml: '<span class="text-gray-400">Väntar på första port...</span>', isElimination: false, reason: 'Ange väg genom hindret.' };
  }

  let expectedIdx = 0;
  let isElimination = false;
  let reason = '';
  const styledTokens = [];
  const passedRequiredGates = new Set();
  let firstErrorFound = false;

  for (const token of tokens) {
    const isUppercase = token === token.toUpperCase() && token !== token.toLowerCase();
    const ucToken = token.toUpperCase();

    // Om vi redan har hittat ett fel, markera resten av portarna som en del av felkörningen
    if (firstErrorFound) {
      styledTokens.push(`<span class="text-red-600">${token}</span>`);
      continue;
    }

    // 1. Korrekt port i sekvensen
    if (isUppercase && ucToken === expectedGates[expectedIdx]) {
      styledTokens.push(`<strong class="text-green-600">${token}</strong>`);
      passedRequiredGates.add(ucToken);
      expectedIdx++;
    }
    // 2. Tillåten passage genom en redan avklarad ("död") port
    else if (passedRequiredGates.has(ucToken)) {
      styledTokens.push(`<span class="text-brand-lightblue underline">${token}</span>`); // Blå för tydlighet
    }
    // 3. Felkörning! Detta är första felet.
    else {
      styledTokens.push(`<strong class="text-red-600">${token}</strong>`);
      reason = `Fel port! Förväntade ${expectedGates[expectedIdx]}, men körde ${token}. (Potentiell felkörning)`;
      firstErrorFound = true;
      // Notera: Vi sätter INTE isElimination här, då felet kan korrigeras.
    }
  }

  // Slutkontroll efter att ha gått igenom alla tokens
  if (!firstErrorFound) {
    // Om alla förväntade portar är tagna och inget fel hittades
    if (expectedIdx === expectedGates.length) {
      reason = 'Vägen är korrekt.';
    } else {
      // Om vägen är korrekt hittills, men inte komplett
      reason = `Vägen korrekt hittills, väntar på port ${expectedGates[expectedIdx]}...`;
    }
  }

  // Om hela vägen har angetts men inte alla portar är med i rätt ordning, DÅ är det eliminering.
  // Detta är domarens slutgiltiga bedömning, men koden kan flagga det som troligt.
  // För att vara säker sätter vi bara eliminering om den sparas i ofullständigt skick.
  if (firstErrorFound) {
    isElimination = true; // En okorrigerad felkörning leder till eliminering
    reason += ' Vägen avslutades utan korrigering.';
  } else if (expectedIdx < expectedGates.length) {
    // Om vägen är slut men inte alla portar har passerats
    isElimination = true;
    reason = `Ej klar! Saknar portar från och med ${expectedGates[expectedIdx]}. (Eliminering)`;
  }


  return {
    styledHtml: styledTokens.join(' '),
    isElimination: isElimination,
    reason: reason
  };
}

// ---- NYTT: Realtidslyssnare och State Management ----
let unsubMaratonDoc = null; // Håller koll på vår Firestore-lyssnare

// Denna funktion anropas varje gång datan i Firestore ändras för det valda ekipaget
// GLOBALA VARIABLER: Se till att du har dessa högst upp i filen.
let currentLiveState = {}; // Håller alltid den senaste datan från Firestore

// RAD FÖRE (ca 298): let currentLiveState = {}; // Håller alltid den senaste datan från Firestore

function applyLiveStateToUI(data) {
  const commentInput = document.getElementById('maratonComment');
  const commentBtn = document.querySelector('.comment-toggle-btn');

  if (!data || !currentEquipage) {
    // Om inget ekipage är valt eller data är tom, återställ allt
    currentLiveState = {};
    if (timerInterval) clearInterval(timerInterval);
    document.getElementById('maratonObstacleSelect').value = '';
    document.getElementById('routeString').value = '';
    document.getElementById('maratonKnockdowns').value = '0';
    document.getElementById('maratonPenalty').value = '0';
    if (commentInput) commentInput.value = '';
    if (commentBtn) commentBtn.classList.remove('has-comment');
    document.getElementById('maratonEliminated').checked = false;
    document.querySelectorAll('#liveTimerMar').forEach(out => { out.textContent = '00:00,00'; });
    updateHeaderInfoMar();
    renderRoutePreview();
    updateTotalPenaltyDisplay();
    return;
  }

  currentLiveState = data; // Spara senaste läget globalt
  currentObstacleNumber = data.currentObstacle || null;

  // 1. Synka valt hinder
  const obstacleSelect = document.getElementById('maratonObstacleSelect');
  if (obstacleSelect.value != (data.currentObstacle || '')) {
    obstacleSelect.value = data.currentObstacle || '';
    updateKnockdownVisibility();
    renderRouteButtonsForCurrent();
  }
  // === NEW: Fyll på från sparad obstacles[] om live_* saknas ===
  const obstacleNo =
    currentObstacleNumber ||
    Number(document.getElementById('maratonObstacleSelect')?.value || 0) || null;

  const savedObstacle = Array.isArray(data.obstacles)
    ? data.obstacles.find(o => Number(o?.number) === Number(obstacleNo))
    : null;

  // “Effective” fält = live_* om de finns, annars sparat hinderresultat
  const effective = {
    liveObstacleTimeMs: (data.liveObstacleTimeMs ?? (savedObstacle?.timeMs ?? 0)),
    live_routeString: (data.live_routeString ?? (savedObstacle?.routeString ?? '')),
    live_knockdowns: (data.live_knockdowns ?? (savedObstacle?.knockdowns ?? '0')),
    live_otherPenalty: (data.live_otherPenalty ?? (savedObstacle?.otherPenalty ?? '0')),
    live_comment: (data.live_comment ?? (savedObstacle?.comment ?? '')),
    live_eliminated: (data.live_eliminated ?? !!(savedObstacle?.eliminated)),
    live_gateSplits: (data.live_gateSplits ?? (savedObstacle?.gateSplits ?? []))
  };

  // Se till att timern använder “effective” tid, även om liveObstacleTimeMs saknas i docet
  currentLiveState = { ...data, ...effective, currentObstacle: data.currentObstacle || obstacleNo };


  // 2. Synka Timern (NU ROBUST)
  if (timerInterval) clearInterval(timerInterval);
  if (data.running) {
    // Starta en lokal renderingsloop BARA för att uppdatera texten på skärmen
    timerInterval = setInterval(updateTimerViewMar, 90);
  }
  updateTimerViewMar(); // Kör en gång direkt för att visa korrekt tid

  // 3. Synka alla andra formulärfält (använd "effective")
  document.getElementById('routeString').value = effective.live_routeString || '';
  document.getElementById('maratonKnockdowns').value = String(effective.live_knockdowns ?? '0');
  document.getElementById('maratonPenalty').value = String(effective.live_otherPenalty ?? '0');
  if (commentInput) commentInput.value = effective.live_comment || '';
  if (commentBtn) commentBtn.classList.toggle('has-comment', !!(effective.live_comment || ''));
  document.getElementById('maratonEliminated').checked = !!effective.live_eliminated;

  renderRoutePreview();
  updateTotalPenaltyDisplay();
  updateHeaderInfoMar();
}

// RAD EFTER (ca 369): // Nollställer endast formuläret lokalt vid kontextbyte (nytt ekipage/hinder)

// Nollställer endast formuläret lokalt vid kontextbyte (nytt ekipage/hinder)
// – INGEN skrivning till Firestore.
function resetFormLocallyForContextSwitch() {
  // Timeretikett(er)
  document.querySelectorAll('#liveTimerMar').forEach(out => { out.textContent = '00:00,00'; });

  // Fält
  const sel = document.getElementById('maratonObstacleSelect');
  if (sel) sel.value = '';
  const route = document.getElementById('routeString');
  if (route) route.value = '';

  const kd = document.getElementById('maratonKnockdowns');
  if (kd) kd.value = '0';

  const other = document.getElementById('maratonPenalty');
  if (other) other.value = '0';

  const cmt = document.getElementById('maratonComment');
  if (cmt) cmt.value = '';

  const elim = document.getElementById('maratonEliminated');
  if (elim) { elim.checked = false; elim.disabled = false; }

  // UI-uppdateringar
  updateKnockdownVisibility();
  renderRouteButtonsForCurrent();
  renderRoutePreview();
  updateTotalPenaltyDisplay();
  updateHeaderInfoMar();
}


// Startar och stoppar lyssnaren
function subscribeToMarathonDoc(startNumber) {
  if (unsubMaratonDoc) unsubMaratonDoc(); // Stäng tidigare lyssnare

  const docRef = marathonDocRef(startNumber);
  unsubMaratonDoc = onSnapshot(docRef, (snap) => {
    // Uppdatera global synk-status baserat på metadata
    if (typeof window.setSyncStatus === 'function') {
      window.setSyncStatus(snap.metadata.hasPendingWrites);
    }
    const data = snap.exists() ? snap.data() : null;
    if (data) mirrorToLocal(startNumber, data); // Backuppa lokalt
    if (data) applyLiveStateToUI(data);
  }, (error) => {
    console.error("Fel vid lyssning på maratondokument:", error);
  });
}

// ---- Firestore doc för live maraton (en per ekipage) ----
function marathonDocRef(startNumber) {
  return doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/maraton`, String(startNumber));
}

// Uppdatera/infoga tidsstämplar i obstacles[] i sammanfattningsdokumentet /maraton/{sn}
async function upsertObstacleTimestamp(equipageId, obstacleNumber, patch) {
  const summaryDocRef = marathonDocRef(equipageId);
  const snap = await getDoc(summaryDocRef);
  const existing = snap.exists() ? (snap.data().obstacles || []) : [];

  const num = Number(obstacleNumber);
  let found = false;
  const next = existing.map(o => {
    if (Number(o?.number) === num) { found = true; return { ...o, ...patch }; }
    return o;
  });
  if (!found) next.push({ number: num, ...patch });

  // Bygg payload för root-dokumentet
  const key = String(num); // map-nyckel måste vara sträng
  const payload = {
    obstacles: next,
    updatedAt: serverTimestamp()
  };

  // Spegla server-tider på rotnivå i obstacleTimes.{number}
  if (patch && patch.enteredAtClient) {
    payload.obstacleTimes = {
      [key]: {
        enteredAt: serverTimestamp(),
        enteredAtClient: patch.enteredAtClient
      }
    };
  }
  if (patch && patch.exitAtClient) {
    // Om enteredAt redan satts i detta anropet (eller tidigare), merge: true kommer att slå ihop
    payload.obstacleTimes = {
      ...(payload.obstacleTimes || {}),
      [key]: {
        ...((payload.obstacleTimes && payload.obstacleTimes[key]) || {}),
        exitAt: serverTimestamp(),
        exitAtClient: patch.exitAtClient
      }
    };
  }

  await setDoc(summaryDocRef, payload, { merge: true });

}

function markObstacleEntered(equipageId, obstacleNumber) {
  return upsertObstacleTimestamp(equipageId, obstacleNumber, {
    enteredAtClient: new Date().toISOString()
  });
}

function markObstacleExit(equipageId, obstacleNumber) {
  return upsertObstacleTimestamp(equipageId, obstacleNumber, {
    exitAtClient: new Date().toISOString()
  });
}


// Skyddad push (som i precision)
async function pushLiveSafe(update) {
  // Skriv bara live när ett ekipage är valt
  if (!currentEquipage) return;

  try {
    // Sätt updatedAt ENDAST när vi uppdaterar tidsrelaterade fält
    const touchUpdatedAtKeys = new Set([
      'running', 'inProgress', 'currentObstacle',
      'liveObstacleStartAt', 'liveObstacleTimeMs'
    ]);
    const shouldTouchUpdatedAt = Object.keys(update || {}).some(k => touchUpdatedAtKeys.has(k));

    const dataToSend = {
      startNumber: currentEquipage.startNumber,
      className: currentEquipage.className || '',
      ...update
    };
    if (shouldTouchUpdatedAt) {
      dataToSend.updatedAt = serverTimestamp();
    }

    await setDoc(marathonDocRef(currentEquipage.startNumber), dataToSend, { merge: true });

  } catch (e) {
    if (e.code !== 'permission-denied') {
      console.error('Ett oväntat fel inträffade vid live-push till maraton:', e);
    }
  }
}

function updateHeaderInfoMar() {
  const setTextAll = (selector, text) => {
    document.querySelectorAll(selector).forEach(el => { el.textContent = text; });
  };

  if (!currentEquipage) {
    setTextAll('#infoEquipageLineMar', '–');
    setTextAll('#infoObstacleLine', '–');
    return;
  }
  const equipageStr = `#${currentEquipage.startNumber} ${currentEquipage.driverName || ''} (${currentEquipage.className})`;
  const obsStr = currentObstacleNumber ? `#${currentObstacleNumber}` : '–';
  setTextAll('#infoEquipageLineMar', equipageStr);
  setTextAll('#infoObstacleLine', obsStr);
}

function updateTimerViewMar() {
  // Använder ALLTID den nya robusta funktionen och senaste state från Firestore
  const t = getElapsedMsFromState(currentLiveState);
  const txt = partsToString(msToParts(t));
  document.querySelectorAll('#liveTimerMar').forEach(out => { out.textContent = txt; });
  updateTotalPenaltyDisplay();
}

function updateKnockdownVisibility() {
  const container = document.getElementById('knockdown-container');
  if (!container) return;

  const obstacleNumber = document.getElementById('maratonObstacleSelect').value;
  const obsConfig = obstacleList.find(o => o.number == obstacleNumber);

  // Hämta global inställning
  const isEnabledGlobally = marathonConfigCache?.obstacleKnockdown?.enabled;

  // Fältet ska visas om knockdowns är på globalt OCH för det specifika hindret
  const shouldShow = isEnabledGlobally && obsConfig?.knockdown?.enabled;

  container.classList.toggle('hidden', !shouldShow);
  // Nollställ värdet om fältet döljs för att undvika fel
  if (!shouldShow) {
    const input = document.getElementById('maratonKnockdowns');
    if (input) input.value = '0';
  }
}
// Funktion för att summera och visa totalt straff
function updateTotalPenaltyDisplay() {
  const display = document.getElementById('totalPenaltyDisplay');
  if (!display) return;

  // KORRIGERING: Använder den korrekta funktionen 'getElapsedMsFromState'
  const timeInSeconds = getElapsedMsFromState(currentLiveState) / 1000;

  const knockdowns = parseInt(document.getElementById('maratonKnockdowns').value) || 0;
  const otherPenalty = parseFloat(document.getElementById('maratonPenalty').value) || 0;

  // Hämta straff per knockdown från config (använder globala värdet)
  const penaltyPerKd = marathonConfigCache?.knockdownPenaltyDefault ?? 5;
  const knockdownPenaltyPoints = knockdowns * penaltyPerKd;

  // Hämta tidskoefficient *specifikt för hinder*
  const timeCoefficient = getObstacleCoefficient(currentEquipage?.className);
  const timePenalty = timeInSeconds * timeCoefficient;

  // Summera de korrekta delarna
  const totalPenalty = timePenalty + knockdownPenaltyPoints + otherPenalty;

  display.textContent = totalPenalty.toFixed(2);
}

function startTimerMar() {
  if (!currentEquipage || !currentObstacleNumber) {
    showAlert("Välj ekipage och hinder först.", false);
    return;
  }

  const accumulatedMs = currentLiveState.liveObstacleTimeMs || 0;

  // *** VIKTIG ÄNDRING: ***
  // Skapa ETT lokalt timestamp här. Vi kommer använda detta
  // både för det optimistiska UI:t OCH för datan vi skickar till servern.
  const localStartTimestamp = Timestamp.now();

  // --- OPTIMISTISK UPPDATERING ---
  // 1. Skapa ett "låtsas-state" som använder det lokala timestampet.
  const optimisticState = {
    ...currentLiveState,
    running: true,
    inProgress: true,
    currentObstacle: currentObstacleNumber,
    liveObstacleTimeMs: accumulatedMs,
    liveObstacleStartAt: localStartTimestamp // <-- Använd det lokala timestampet
  };

  // 2. Applicera detta state på UI *direkt*.
  applyLiveStateToUI(optimisticState);

  // --- SERVERUPPDATERING ---
  // 3. Skicka det *riktiga* kommandot till servern i bakgrunden.
  pushLiveSafe({
    running: true,
    inProgress: true,
    currentObstacle: currentObstacleNumber,
    liveObstacleStartAt: localStartTimestamp, // <-- SKICKA DET LOKALA TIMESTAMPET
    live_staticStartAt: localStartTimestamp,  // <-- Persistent start time (cleared only on Save)
    liveObstacleTimeMs: accumulatedMs
  });
  markObstacleEntered(currentEquipage.startNumber, currentObstacleNumber);
}

function stopTimerMar() {
  if (!currentEquipage || !currentLiveState.running) return;

  // 1. Beräkna den slutgiltiga tiden *lokalt*
  const finalTimeMs = getElapsedMsFromState(currentLiveState);

  // --- OPTIMISTISK UPPDATERING ---
  // 2. Skapa ett optimistiskt state som stoppar klockan
  const optimisticState = {
    ...currentLiveState,
    running: false,
    liveObstacleTimeMs: finalTimeMs, // Sätt den slutgiltiga tiden
    liveObstacleStartAt: null
    // live_staticStartAt bevaras!
  };

  // 3. Applicera detta state på UI *direkt*.
  //    Detta rensar `timerInterval` omedelbart.
  applyLiveStateToUI(optimisticState);

  // --- SERVERUPPDATERING ---
  // 4. Skicka det *riktiga* kommandot till servern i bakgrunden.
  pushLiveSafe({
    running: false,
    liveObstacleTimeMs: finalTimeMs,
    liveObstacleStartAt: null // Viktigt att nollställa 'aktiv' timer-start
    // live_staticStartAt skickas inte här, så den ligger kvar
  });
  markObstacleExit(currentEquipage.startNumber, currentObstacleNumber);
}

function resetTimerMar(force = false) {
  if (!currentEquipage) return;
  if (force || confirm("Är du säker? Detta nollställer tid och formulär för BÅDA användarna.")) {

    // 1. Definiera exakt vad som ska skickas till servern för nollställning
    const serverUpdatePayload = {
      running: false,
      inProgress: false,
      liveObstacleTimeMs: 0,
      liveObstacleStartAt: null,
      live_staticStartAt: null,
      live_routeString: '',
      live_knockdowns: '0',
      live_otherPenalty: '0',
      live_comment: '',
      live_eliminated: false,
      live_gateSplits: []
    };

    // --- OPTIMISTISK UPPDATERING ---
    // 2. Skapa det nya "låtsas-state" genom att slå ihop det nuvarande
    //    med nollställningsdatan.
    const optimisticResetState = {
      ...currentLiveState,
      ...serverUpdatePayload
      // currentObstacle behålls, vilket är korrekt
    };

    // 3. Applicera detta state på UI *direkt*.
    //    Detta stoppar klockan och rensar alla fält omedelbart.
    applyLiveStateToUI(optimisticResetState);

    // --- SERVERUPPDATERING ---
    // 4. Skicka det *riktiga* kommandot till servern i bakgrunden.
    pushLiveSafe(serverUpdatePayload);
  }
}

// NY funktion för att skicka formulärdata live
function pushFormField(fieldName, value) {
  if (!currentEquipage || currentObstacleNumber == null) return;
  pushLiveSafe({ [fieldName]: value });
}

async function onMarathonEquipageSelected(equipage) {
  currentEquipage = equipage || null;

  // Stäng gammal lyssnare
  if (unsubMaratonDoc) unsubMaratonDoc();
  unsubMaratonDoc = null;

  renderRouteButtonsForCurrent();

  if (equipage) {
    // Starta en ny lyssnare för det valda ekipaget
    subscribeToMarathonDoc(equipage.startNumber);
  } else {
    // Rensa UI om inget ekipage är valt
    applyLiveStateToUI(null);
  }

  // Ladda befintligt resultat för det hinder som eventuellt redan är valt i dropdown
  const sel = document.getElementById('maratonObstacleSelect');
  if (sel && sel.value) {
    await loadExistingResult();
  } else {
    updateHeaderInfoMar();
  }
}
/**
 * Fyller dropdown-menyn för hinder.
 * @param {Array<object>} obstacles - Lista på maratonhinder.
 */
function populateObstacleSelector(obstacles) {
  obstacleList = obstacles || [];
  const obstacleSelect = document.getElementById('maratonObstacleSelect');
  if (!obstacleSelect) return;

  const currentVal = obstacleSelect.value;
  obstacleSelect.innerHTML = '<option value="">Välj hinder...</option>';

  obstacles.forEach(obs => {
    const option = document.createElement('option');
    option.value = obs.number;
    option.textContent = `Hinder ${obs.number}${obs.name ? ` (${obs.name})` : ''}`;
    obstacleSelect.appendChild(option);
  });
  obstacleSelect.value = currentVal;
  // Auto-select om inget valt: live.currentObstacle -> senaste sparade -> första i listan
  if (!obstacleSelect.value) {
    const livePref = currentLiveState?.currentObstacle || null;
    const saved = Array.isArray(currentLiveState?.obstacles) ? currentLiveState.obstacles : [];
    const lastSaved = saved.length ? Math.max(...saved.map(o => Number(o.number) || 0)) : null;
    const firstOpt = (obstacles && obstacles.length) ? obstacles[0].number : null;

    const pick = String(livePref || lastSaved || firstOpt || '');
    if (pick) obstacleSelect.value = pick;
  }

  // Synka UI för valt hinder och ladda ev. sparade fält
  updateKnockdownVisibility();
  renderRouteButtonsForCurrent();
  // Ladda in sparat resultat för det nu valda hindret (utan att nollställa något i Firestore)
  loadExistingResult();

}

/**
 * Hämtar och visar ett befintligt resultat om det finns sparat.
 */

// UPPDATERAD FÖR ATT LADDA SPARAD DATA
// RAD FÖRE (ca 823): // UPPDATERAD FÖR ATT LADDA SPARAD DATA

async function loadExistingResult() {
  const equipageId = currentEquipage?.startNumber;
  const obstacleNumber = document.getElementById('maratonObstacleSelect').value;
  currentObstacleNumber = obstacleNumber ? Number(obstacleNumber) : null;

  // Uppdatera knapparna (A/B/C) eftersom hindret kan ha specifikt antal portar
  renderRouteButtonsForCurrent();

  updateHeaderInfoMar(); // Uppdatera rubriken direkt

  if (!equipageId || !currentObstacleNumber) {
    // Om ekipage eller hinder av-selekteras, rensa live-vyn lokalt
    // KORRIGERING: Skicka det existerande state men med null-hinder
    const stateWithoutObstacle = {
      ...currentLiveState,
      currentObstacle: null,
      running: false,
      inProgress: false,
      liveObstacleTimeMs: null,
      live_routeString: null,
      live_knockdowns: '0',
      live_otherPenalty: '0',
      live_comment: '',
      live_eliminated: false,
      live_gateSplits: []
    };
    applyLiveStateToUI(stateWithoutObstacle);
    return;
  }

  try {
    const docRef = marathonDocRef(equipageId);
    const docSnap = await getDoc(docRef);

    let resultToLoad = null;
    if (docSnap.exists()) {
      const data = docSnap.data();
      const savedObstacles = data.obstacles || [];
      resultToLoad = savedObstacles.find(o => o.number === currentObstacleNumber);
    }

    let liveDataUpdate;
    if (resultToLoad) {
      // Om vi hittade ett sparat resultat, förbered att ladda in dess data
      showAlert(`Laddade sparat resultat för hinder ${currentObstacleNumber}.`, true);
      liveDataUpdate = {
        currentObstacle: currentObstacleNumber,
        running: false,
        inProgress: true,
        liveObstacleTimeMs: resultToLoad.timeMs || 0,
        liveObstacleStartAt: null, // Ensure stale start time is cleared
        live_staticStartAt: null, // Wipe old static start
        live_routeString: resultToLoad.routeString || '',
        live_knockdowns: resultToLoad.knockdowns ?? '0',
        live_otherPenalty: resultToLoad.otherPenalty ?? '0',
        live_comment: resultToLoad.comment || '',
        live_eliminated: resultToLoad.eliminated || false,
        live_gateSplits: resultToLoad.gateSplits || []
      };
    } else {
      // Om inget sparat resultat fanns, nollställ för ny tidtagning
      liveDataUpdate = {
        currentObstacle: currentObstacleNumber,
        running: false,
        inProgress: false,
        liveObstacleTimeMs: 0, // Ändrat från null
        live_routeString: '', // Ändrat från null
        live_knockdowns: '0',
        live_otherPenalty: '0',
        live_comment: '',
        live_eliminated: false,
        live_gateSplits: []
      };
    }

    // Applicera datan lokalt och skicka sedan till Firestore för att synka alla användare
    // Slå ihop med existerande state för att inte tappa bort ekipage-info
    const finalState = { ...currentLiveState, ...liveDataUpdate };
    applyLiveStateToUI(finalState);
    await pushLiveSafe(liveDataUpdate);

  } catch (error) {
    console.error("Kunde inte ladda hinderresultat:", error);
    showAlert("Ett fel inträffade vid hämtning av sparat resultat.", false);
  }
}

// RAD EFTER (ca 882): function renderRoutePreview() {

function renderRoutePreview() {
  const preview = document.getElementById('routePreview');
  const inp = document.getElementById('routeString');
  const eliminatedCheckbox = document.getElementById('maratonEliminated');
  if (!preview || !inp || !eliminatedCheckbox) return;

  const cls = currentEquipage?.className || null;
  const result = getGateLettersForClass(cls); // Nu returnerar denna { count, source }

  const allLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
  const expectedGates = allLetters.slice(0, result.count);

  const validation = validateRouteString(inp.value, expectedGates);

  // Uppdatera den färgkodade förhandsvisningen
  preview.innerHTML = validation.styledHtml;

  // Visa statusmeddelande under
  const statusEl = document.querySelector('#routePreview + .text-sm');
  if (statusEl) {
    statusEl.textContent = validation.reason + ` (Källa: ${result.source})`;
    statusEl.className = 'text-sm mt-1'; // Nollställ klasser
    if (validation.isElimination) {
      statusEl.classList.add('text-red-600', 'font-bold');
    } else if (validation.hasCorrectedError) {
      statusEl.classList.add('text-amber-600', 'font-semibold');
    } else {
      statusEl.classList.add('text-green-600');
    }
  }
}

/**
 * Hanterar sparandet av formulärdata.
 * @param {Event} e - Submit-eventet från formuläret.
 */
async function saveResult(e) {
  e.preventDefault();
  const equipageId = equipageSearchDropdownMar.getValue();
  const obstacleNumber = document.getElementById('maratonObstacleSelect').value;
  if (!equipageId || !obstacleNumber) {
    showAlert("Välj både ekipage och hinder.", false);
    return;
  }

  // Säkerställ att klockan är stoppad innan vi sparar
  if (currentLiveState.running) {
    stopTimerMar();
  }

  const timeMs = currentLiveState.liveObstacleTimeMs || getElapsedMsFromState(currentLiveState);
  const timeInSeconds = Number((timeMs / 1000).toFixed(2));

  let comment = document.getElementById('maratonComment').value || '';
  let eliminated = !!document.getElementById('maratonEliminated').checked;

  const maxObstacleSeconds = marathonConfigCache?.obstacleMaxTime ?? 300;
  if (timeInSeconds > maxObstacleSeconds) {
    eliminated = true;
    comment += ` (Automatiskt eliminerad: tid > ${maxObstacleSeconds}s).`;
  }

  const knockdowns = parseInt(document.getElementById('maratonKnockdowns').value) || 0;
  const otherPenalty = parseFloat(document.getElementById('maratonPenalty').value) || 0;
  const penaltyPerKd = marathonConfigCache?.knockdownPenaltyDefault ?? 5;
  const knockdownPenaltyPoints = knockdowns * penaltyPerKd;

  // NYTT: Hämta rätt koefficient
  const timeCoefficient = getObstacleCoefficient(currentEquipage?.className);
  const timePenalty = timeInSeconds * timeCoefficient;

  const totalObstaclePenalty = timePenalty + knockdownPenaltyPoints + otherPenalty;

  // Hämta starttid för att spara den i resultatet (gör statistiken robust)
  const enteredAt = currentLiveState.live_staticStartAt || currentLiveState.liveObstacleStartAt || Timestamp.now();

  const resultData = {
    number: Number(obstacleNumber),
    timeInSeconds, timeMs, timePenalty: +timePenalty.toFixed(2),
    knockdowns, knockdownPenalty: knockdownPenaltyPoints, otherPenalty,
    penalty: +totalObstaclePenalty.toFixed(2),
    comment: comment.trim(), eliminated,
    routeString: (document.getElementById('routeString')?.value || '').trim(),
    gateSplits: currentLiveState.live_gateSplits || [],
    enteredAt: enteredAt // Sparas nu direkt i resultatet!
  };

  try {
    const summaryDocRef = marathonDocRef(equipageId);
    const snap = await getDoc(summaryDocRef);
    const existingData = snap.exists() ? snap.data() : {};

    const obstacles = (existingData.obstacles || []).filter(o => o.number != obstacleNumber);
    obstacles.push(resultData);
    obstacles.sort((a, b) => a.number - b.number);

    await setDoc(summaryDocRef, {
      ...existingData,
      obstacles,
      updatedAt: serverTimestamp(),
      // Reset live state on SAVE
      currentObstacle: null,
      running: false,
      inProgress: false,
      liveObstacleTimeMs: 0,
      liveObstacleStartAt: null, // Explicit cleanup
      live_staticStartAt: null, // Wipe static start
      live_routeString: '',
      live_gateSplits: []
    }, { merge: true });

    if (!navigator.onLine) {
      showAlert(`Resultat för hinder ${obstacleNumber} har lagts i kön (Offline).`, 'offline');
    } else {
      showAlert(`Resultat för hinder ${obstacleNumber} har sparats.`);
    }

    // KORRIGERING: Anropa den rena navigeringsfunktionen som BARA byter ekipage.
    navigateEquipage(1);

  } catch (error) {
    console.error("Kunde inte spara maratonresultat:", error);
    showAlert("Ett allvarligt fel inträffade vid sparande. Kontrollera konsolen (F12).", false);
  }
}

/**
 * Sätter upp alla händelselyssnare för sidan.
 */

// RAD FÖRE (ca 1009): }

async function setupPage() {
  // Hämta all nödvändig data parallellt för snabbare laddning
  const [equipagesRaw, startTimesData, marathonConfig] = await Promise.all([
    getEquipages(competitionId),
    getStartTimes(competitionId),
    getConfig(competitionId, 'maratonConfig')
  ]);

  marathonConfigCache = marathonConfig || {};

  const allEquipages = (equipagesRaw || []).map(normalizeEquipage);
  const activeEquipages = allEquipages.filter(e => e.status !== 'struken');

  // NY KORREKT SORTERING: Sortera efter maratonstarttid
  sortedEquipages = [...activeEquipages].sort((a, b) => {
    const timeA = (startTimesData && startTimesData[a.startNumber]?.maraton) || '99:99';
    const timeB = (startTimesData && startTimesData[b.startNumber]?.maraton) || '99:99';
    if (timeA !== timeB) return timeA.localeCompare(timeB);
    return a.startNumber - b.startNumber; // Fallback till startnummer
  });

  const equipageSearchContainer = document.getElementById('equipageSearchContainerMar');
  equipageSearchDropdownMar = createSearchableDropdown(equipageSearchContainer, sortedEquipages, onMarathonEquipageSelected);

  // NYTT: Bättre event-hantering för live-push
  boundHandlers.formInputHandler = (e) => {
    const target = e.target;
    if (!target) return;

    if (target.id === 'maratonKnockdowns') {
      updateTotalPenaltyDisplay();
      pushFormField('live_knockdowns', target.value);
    } else if (target.id === 'maratonPenalty') {
      updateTotalPenaltyDisplay();
      pushFormField('live_otherPenalty', target.value);
    } else if (target.id === 'maratonComment') {
      const btn = document.querySelector('.comment-toggle-btn');
      if (btn) btn.classList.toggle('has-comment', target.value.trim() !== '');
      pushFormField('live_comment', target.value);
    } else if (target.id === 'maratonEliminated') {
      pushFormField('live_eliminated', target.checked);
    }
  };

  // NYTT: Klick-hanterare för kommentarsknappen
  boundHandlers.formClickHandler = (e) => {
    const btn = e.target.closest('.comment-toggle-btn');
    if (!btn) return;
    const wrapper = document.querySelector('.comment-wrapper');
    if (!wrapper) return;

    wrapper.classList.toggle('comment-visible');
    if (wrapper.classList.contains('comment-visible')) {
      wrapper.querySelector('textarea').focus();
    }
  };

  unsubObstacles = listenForMarathonObstacles(competitionId, populateObstacleSelector);

  // Koppla alla knappar och event
  boundHandlers.obstacleChange = loadExistingResult;
  boundHandlers.submitHandler = (e) => saveResult(e);
  boundHandlers.prevClick = () => navigateEquipage(-1);
  boundHandlers.nextClick = () => navigateEquipage(1);
  boundHandlers.startH = () => startTimerMar();
  boundHandlers.stopH = () => stopTimerMar();
  boundHandlers.resetH = () => resetTimerMar();
  boundHandlers.timerClick = () => document.getElementById('manualTimeEditorMar')?.classList.remove('hidden');
  boundHandlers.cancelClick = () => document.getElementById('manualTimeEditorMar')?.classList.add('hidden');
  boundHandlers.applyClick = () => applyManualTime();
  boundHandlers.routeUndo = () => updateRouteString('undo');
  boundHandlers.routeClear = () => updateRouteString('clear');

  const form = document.getElementById('addMaratonResultForm');
  if (form) {
    form.addEventListener('submit', boundHandlers.submitHandler);
    form.addEventListener('input', boundHandlers.formInputHandler);
    form.addEventListener('click', boundHandlers.formClickHandler); // För kommentarsknappen
  }

  document.getElementById('maratonObstacleSelect')?.addEventListener('change', boundHandlers.obstacleChange);
  document.getElementById('prevEquipage')?.addEventListener('click', boundHandlers.prevClick);
  document.getElementById('nextEquipage')?.addEventListener('click', boundHandlers.nextClick);
  document.getElementById('btnStartMar')?.addEventListener('click', boundHandlers.startH);
  document.getElementById('btnStopMar')?.addEventListener('click', boundHandlers.stopH);
  document.getElementById('btnResetMar')?.addEventListener('click', boundHandlers.resetH);
  document.getElementById('liveTimerMar')?.addEventListener('click', boundHandlers.timerClick);
  document.getElementById('btnManualCancelMar')?.addEventListener('click', boundHandlers.cancelClick);
  document.getElementById('btnManualApplyMar')?.addEventListener('click', boundHandlers.applyClick);
  document.getElementById('routeUndo')?.addEventListener('click', boundHandlers.routeUndo);
  document.getElementById('routeClear')?.addEventListener('click', boundHandlers.routeClear);

  document.getElementById('btnBackupMarJson')?.addEventListener('click', () => {
    const backup = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith(`bkp_${competitionId}_mar_`)) {
        backup[key] = JSON.parse(localStorage.getItem(key));
      }
    }
    const filename = `backup_maraton_hinder_${competitionId}_${new Date().toISOString().split('T')[0]}.json`;
    downloadJson(filename, backup);
  });

  listenForGlobalCompetitionPause_Obstacles();
}

// RAD EFTER (ca 1062): // Hanterar Föregående/Nästa-knapparna

// Hanterar Föregående/Nästa-knapparna
function navigateEquipage(delta) {
  const currentValue = equipageSearchDropdownMar.getValue();
  let currentIndex = -1;

  if (currentValue) {
    currentIndex = sortedEquipages.findIndex(e => e.startNumber == currentValue);
  }

  const nextIndex = currentIndex + delta;

  if (nextIndex >= 0 && nextIndex < sortedEquipages.length) {
    equipageSearchDropdownMar.setValue(sortedEquipages[nextIndex].startNumber);
  } else if (delta > 0) {
    showAlert("Du har nått slutet av startlistan.");
  } else {
    showAlert("Du är redan vid början av startlistan.");
  }
}

// Hanterar när man matar in tid manuellt
function applyManualTime() {
  const digits = (document.getElementById('manualTimeDigitsMar')?.value || '');
  pausedMs = digitsToMs(digits);
  isRunning = false;
  inProgress = true;
  updateTimerViewMar();
  document.getElementById('manualTimeEditorMar')?.classList.add('hidden');

  // Skicka en komplett ögonblicksbild av tillståndet
  pushLiveSafe({
    running: isRunning,
    inProgress: inProgress,
    currentObstacle: currentObstacleNumber,
    liveObstacleTimeMs: pausedMs
  });
}

// Förenklad funktion för att hantera rutt-strängen
function updateRouteString(action) {
  const inp = document.getElementById('routeString');
  if (!inp) return;

  let splits = currentLiveState.live_gateSplits || [];

  if (action === 'clear') {
    inp.value = '';
    splits = [];
  } else if (action === 'undo') {
    const parts = inp.value.trim().split(/\s+/);
    parts.pop();
    inp.value = parts.join(' ');
    // Remove last split
    if (splits.length > 0) {
      splits = splits.slice(0, -1);
    }
  }
  renderRoutePreview();

  // Optimistic update
  currentLiveState.live_gateSplits = splits;

  pushLiveSafe({
    live_routeString: inp.value,
    live_gateSplits: splits
  });
}

const DEFAULT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
function getGateLettersForClass(className) {
  // 1. Check overrides in current obstacle (if any)
  if (currentObstacleNumber != null && Array.isArray(obstacleList)) {
    // Use loose equality (==) to handle string/number mismatch
    const obsConfig = obstacleList.find(o => o.number == currentObstacleNumber);

    // 1a. Prioritera klass-specifikt undantag
    if (obsConfig && obsConfig.classOverrides && className) {
      const override = obsConfig.classOverrides[className];
      if (Number.isInteger(override) && override > 0) {
        return { count: override, source: `Override (${className})` };
      }
    }

    // 1b. Annars använd hindrets globala inställning (om satt)
    if (obsConfig && Number.isInteger(obsConfig.gateCount) && obsConfig.gateCount > 0) {
      return { count: obsConfig.gateCount, source: 'Obstacle Global' };
    }
  }

  // 2. Annars använd klassens inställning
  if (!className || !marathonConfigCache) return { count: 6, source: 'Default (No Class/Config)' };

  const classData = marathonConfigCache.marathonClassData?.[className];
  const count = classData?.gateCount;

  if (Number.isInteger(count) && count > 0) {
    return { count: count, source: `Class Default (${className})` };
  }

  // Fallback till standard A-F
  return { count: 6, source: 'Fallback' };
}

function renderRouteButtonsForCurrent() {
  const wrap = document.getElementById('routeButtons');
  if (!wrap) return;
  wrap.innerHTML = '';

  const cls = currentEquipage?.className || null;
  const result = getGateLettersForClass(cls);
  const count = result.count;
  const letters = DEFAULT_LETTERS.slice(0, count);

  // Grupp: versaler (rätt håll)
  const upperRow = document.createElement('div');
  upperRow.className = 'grid grid-cols-4 sm:grid-cols-6 gap-2'; // 4 columns on mobile is optimal (A,B,C,D)
  letters.forEach(L => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'py-4 text-xl font-bold rounded-lg bg-emerald-100 text-emerald-800 border-2 border-emerald-600 hover:bg-emerald-600 hover:text-white active:scale-95 transition-all touch-manipulation shadow-sm';
    btn.textContent = L;
    btn.addEventListener('click', () => appendRouteLetter(L));
    upperRow.appendChild(btn);
  });

  // Grupp: gemener (bakifrån)
  const lowerRow = document.createElement('div');
  lowerRow.className = 'grid grid-cols-4 sm:grid-cols-6 gap-2';
  letters.forEach(L => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'py-3 text-lg font-medium rounded-lg bg-red-100 text-red-800 border border-red-300 hover:bg-red-500 hover:text-white active:scale-95 transition-all touch-manipulation opacity-80';
    btn.textContent = L.toLowerCase();
    btn.addEventListener('click', () => appendRouteLetter(L.toLowerCase()));
    lowerRow.appendChild(btn);
  });

  const labelU = document.createElement('div');
  labelU.className = 'text-xs text-gray-600';
  labelU.textContent = `Portar (rätt håll) - ${result.source}:`;

  const labelL = document.createElement('div');
  labelL.className = 'text-xs text-gray-600 mt-1';
  labelL.textContent = 'Portar (bakifrån):';

  wrap.appendChild(labelU);
  wrap.appendChild(upperRow);
  wrap.appendChild(labelL);
  wrap.appendChild(lowerRow);
}

function appendRouteLetter(ch) {
  const inp = document.getElementById('routeString');
  if (!inp) return;
  const before = (inp.value || '').trim();
  const newValue = before ? `${before} ${ch}` : ch;
  inp.value = newValue; // Uppdatera lokalt för snabb feedback
  renderRoutePreview();

  const splits = currentLiveState.live_gateSplits || [];
  const newSplits = [...splits, { char: ch, ts: Date.now() }];

  // Optimistic update
  currentLiveState.live_gateSplits = newSplits;

  // KORRIGERING: Skicka BARA den ändrade väg-strängen och gateSplits.
  // Detta förhindrar att tiden och andra fält påverkas av misstag.
  pushLiveSafe({
    live_routeString: newValue,
    live_gateSplits: newSplits
  });
}

/**
 * Huvudfunktion som anropas av routern för att ladda och initiera sidan.
 */
// RAD FÖRE (ca 1234): }

export function load() {
  const competition = getGlobalState('currentCompetition');
  const page = document.getElementById('page-maraton-input');

  if (!competition) {
    page.innerHTML = `<p class="p-8 text-center text-red-500">Ingen tävling vald.</p>`;
    return;
  }
  competitionId = competition.id;

  page.innerHTML = `
  <style>
      .comment-wrapper {
          display: none;
          margin-top: 8px;
      }
      .movement-card.comment-visible .comment-wrapper,
      .comment-wrapper.comment-visible {
          display: block;
      }
      .toggle-btn {
          background: none;
          border: 1px solid #cbd5e1; /* gray-300 */
          border-radius: 99px; /* rounded-full */
          padding: 4px 10px;
          font-size: 11px;
          line-height: 1.2;
          color: #475569; /* gray-600 */
          cursor: pointer;
          white-space: nowrap;
      }
      .toggle-btn:hover {
          background: #f1f5f9; /* gray-100 */
      }
      .toggle-btn.has-comment {
          border-color: #2563eb; /* blue-600 */
          color: #2563eb;
          font-weight: 600;
      }
  </style>
  <div class="container mx-auto p-4 md:p-8 max-w-2xl">
    ${getCompetitionHeader(competition, 'Inmatning Maratonhinder')}

    <div class="bg-white p-6 rounded-xl shadow-md">
      <h2 class="text-2xl font-semibold mb-4 border-b pb-2">Rapportera Resultat</h2>

      <div class="sticky top-[63px] -mx-6 px-6 py-2 bg-white/95 backdrop-blur border-b z-20">
        <div class="flex items-start justify-between gap-4">
          <div>
            <div id="infoEquipageLineMar" class="font-semibold">–</div>
            <div class="text-gray-600 text-sm">
              Hinder: <span id="infoObstacleLine" class="font-medium">–</span>
            </div>
          </div>
          <div class="relative">
            <div id="liveTimerMar" class="text-3xl font-bold tabular-nums cursor-pointer text-center" title="Klicka för att ändra tiden">00:00,00</div>
            <div id="manualTimeEditorMar" class="hidden absolute right-0 mt-2 w-[320px] p-4 rounded-lg border bg-white shadow-lg z-40">
              <label class="block text-sm mb-2">Manuell tid (mmsscc)</label>
              <input id="manualTimeDigitsMar" type="tel" inputmode="numeric" class="w-full text-3xl tracking-widest px-3 py-2 border rounded mb-3" placeholder="mmsscc" maxlength="6" />
              <div class="flex gap-2">
                <button id="btnManualApplyMar" class="flex-1 py-2 rounded bg-emerald-600 text-white">Använd</button>
                <button id="btnManualCancelMar" class="flex-1 py-2 rounded bg-gray-300">Avbryt</button>
              </div>
            </div>
          </div>
        </div>
        <div class="mt-2 flex items-center gap-2">
          <button id="btnStartMar" class="flex-1 px-4 py-3 rounded-lg bg-emerald-600 text-white font-bold text-lg active:scale-95 transition-transform touch-manipulation shadow-sm">Start</button>
          <button id="btnStopMar"  class="flex-1 px-4 py-3 rounded-lg bg-red-600 text-white font-bold text-lg active:scale-95 transition-transform touch-manipulation shadow-sm">Stopp</button>
          <button id="btnResetMar" class="px-4 py-3 rounded-lg bg-gray-200 text-gray-700 font-medium active:scale-95 transition-transform touch-manipulation">
            <span class="sr-only">Nollställ</span>
            🔄
          </button>
        </div>
      </div>

      <form id="addMaratonResultForm" class="space-y-3">
        
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label class="block text-sm font-medium">Välj Ekipage</label>
            <div class="flex items-center space-x-2">
              <button id="prevEquipage" type="button" class="p-3 border rounded-md hover:bg-gray-100">«</button>
              <div id="equipageSearchContainerMar" class="mt-1 flex-grow"></div>
              <button id="nextEquipage" type="button" class="p-3 border rounded-md hover:bg-gray-100">»</button>
            </div>
          </div>

          <div>
            <label for="maratonObstacleSelect" class="block text-sm font-medium">Välj Hinder</label>
            <select id="maratonObstacleSelect" required class="mt-1 block w-full p-3 text-lg border rounded-md"></select>
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium">Väg genom hindret</label>
          <div id="routeButtons" class="mt-1 space-y-1">
            </div>
          <input id="routeString" class="mt-2 block w-full p-2 text-base border rounded-md bg-gray-50" placeholder="Ex: A b C d …" readonly>
          <div id="routePreview" class="mt-1 text-base leading-7 font-bold tracking-wider"></div>
          <p class="text-sm mt-1 text-gray-500"></p>
          <div class="mt-2 flex gap-2">
            <button id="routeUndo"  type="button" class="px-3 py-1 text-sm rounded bg-gray-200 hover:bg-gray-300">Ångra</button>
            <button id="routeClear" type="button" class="px-3 py-1 text-sm rounded bg-gray-200 hover:bg-gray-300">Rensa</button>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div id="knockdown-container" class="hidden">
            <label for="maratonKnockdowns" class="block text-sm font-medium">Knockdowns</label>
            <input type="number" inputmode="numeric" id="maratonKnockdowns" value="0" min="0" class="mt-1 block w-full p-2 text-base border rounded-md">
          </div>
          
          <div>
            <label for="maratonPenalty" class="block text-sm font-medium">Övrigt straff</label>
            <input type="number" inputmode="numeric" id="maratonPenalty" value="0" min="0" class="mt-1 block w-full p-2 text-base border rounded-md" placeholder="t.ex. 10">
          </div>

          <div class="flex items-center md:mt-6">
            <input type="checkbox" id="maratonEliminated" class="h-5 w-5 rounded border-gray-300">
            <label for="maratonEliminated" class="ml-2 block text-md font-medium">Eliminerad</label>
          </div>
        </div>

        <div>
          <button type="button" class="toggle-btn comment-toggle-btn" data-target="comment">💬 Kom.</button>
          <div class="comment-wrapper">
            <textarea id="maratonComment" rows="2" class="mt-1 block w-full p-2 border rounded-md" placeholder="Lägg till kommentar..."></textarea>
          </div>
        </div>
        
        <div class="mt-4 border-t pt-4 grid grid-cols-2 gap-4 items-center">
            <div>
              <label class="block text-sm font-medium">Totalt Straff Hinder</label>
              <div id="totalPenaltyDisplay" class="mt-1 block w-full p-2 text-lg font-bold bg-gray-100 border rounded-md">
                  0.00
              </div>
              <p class="text-xs text-gray-500 mt-1">Tid + Knockdowns + Övrigt</p>
            </div>

            <button type="submit" class="w-full bg-green-600 text-white font-semibold py-3 px-6 rounded-lg hover:bg-green-700 text-lg">
              Spara & Nästa
            </button>
        </div>
        <div class="mt-4 pt-3 border-t flex justify-end">
          <button id="btnBackupMarJson" type="button" class="text-xs text-blue-600 hover:underline flex items-center gap-1">
            <i class="fas fa-file-download"></i> Ladda ner säkerhetskopia (JSON)
          </button>
        </div>
      </form>
    </div>
  </div>
`;

  // Kör init EFTER att DOM-contenten ovan finns
  setupPage();
}


/**
 * Städas när sidan lämnas (för att inte störa t.ex. precision-input)
 */
// RAD FÖRE (ca 1370): /**

export function __unload() {
  try {
    // Stoppa klockan/interval
    if (timerInterval) clearInterval(timerInterval);
    isRunning = false;
    inProgress = false;

    // Stäng lyssnare mot Firestore
    if (typeof unsubObstacles === 'function') {
      try { unsubObstacles(); } catch { }
      unsubObstacles = null;
    }
    if (unsubMaratonDoc) {
      try { unsubMaratonDoc(); } catch { }
      unsubMaratonDoc = null;
    }

    // Ta bort DOM-lyssnare vi satte i setupPage()
    const rm = (sel, ev, fn) => {
      const el = document.getElementById(sel);
      if (el && typeof fn === 'function') {
        try { el.removeEventListener(ev, fn); } catch { }
      }
    };

    // NYTT: Ta bort de nya formulär-lyssnarna
    const form = document.getElementById('addMaratonResultForm');
    if (form) {
      if (boundHandlers.submitHandler) form.removeEventListener('submit', boundHandlers.submitHandler);
      if (boundHandlers.formInputHandler) form.removeEventListener('input', boundHandlers.formInputHandler);
      if (boundHandlers.formClickHandler) form.removeEventListener('click', boundHandlers.formClickHandler);
    }

    rm('maratonObstacleSelect', 'change', boundHandlers.obstacleChange);
    rm('prevEquipage', 'click', boundHandlers.prevClick);
    rm('nextEquipage', 'click', boundHandlers.nextClick);
    rm('btnStartMar', 'click', boundHandlers.startH);
    rm('btnStopMar', 'click', boundHandlers.stopH);
    rm('btnResetMar', 'click', boundHandlers.resetH);
    rm('liveTimerMar', 'click', boundHandlers.timerClick);
    rm('btnManualCancelMar', 'click', boundHandlers.cancelClick);
    rm('btnManualApplyMar', 'click', boundHandlers.applyClick);
    rm('routeUndo', 'click', boundHandlers.routeUndo);
    rm('routeClear', 'click', boundHandlers.routeClear);

    // Stäng ev. dropdown
    if (equipageSearchDropdownMar?.destroy) {
      try { equipageSearchDropdownMar.destroy(); } catch { }
    }
    equipageSearchDropdownMar = null;

    boundHandlers = {};
  } catch (e) {
    console.warn('maraton-input __unload cleanup issue:', e);
  }
}