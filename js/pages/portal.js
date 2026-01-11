import { getGlobalState, setGlobalState } from '../main.js';
import { getDoc, doc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from '../config/firebase-config.js';
import { getCompetitionHeader, showAlert } from '../ui/components.js';
import { autoClaimEquipages } from '../services/authService.js';
import {
    getComputedResultForEquipage,
    getEquipages,
    getConfig,
    getDressageResultsForEquipage,
    getMarathonTimingForEquipage,
    getPrecisionResultForEquipage,
    getMarathonLiveDocument,
    getMarathonObstacleResults,
    listenForDressageProtocols,
    saveEquipage
} from '../services/firestoreService.js';
import { renderDressageContent } from '../ui/dressageModal.js';
import { renderMarathonContent, renderTimeCard } from '../ui/marathonModal.js';
import { renderPrecisionContent } from '../ui/precisionModal.js';
import { getFlagHtml } from '../services/flagsService.js';

import { listenForJudges, getOfficials, getJudges, getCompetitionDocuments, getCompetitionMessages, listenForCompetitionMessages, listenForConfig } from '../services/firestoreService.js';
import { getClubLogoHtml, ensureClubLogosLoaded } from '../services/logosService.js';
import { getPrograms, computeFinalFromSaved } from '../utils/dressageUtils.js';

let messageUnsub = null;

export async function load() {
    const container = document.getElementById('page-portal');
    if (!container) return;

    // 1. Kontrollera inloggning
    const user = getGlobalState('currentUser');
    if (!user) {
        container.innerHTML = `
            <div class="p-8 text-center">
                <h2 class="text-xl font-bold text-gray-800 mb-2">Logga in</h2>
                <p class="text-gray-600 mb-4">Du måste vara inloggad för att se din portal.</p>
                <div id="portal-login-placeholder"></div>
            </div>
        `;
        return;
    }

    // 2. Hämta uppdaterad användardata (för att få senaste claims)
    let userData = user;
    try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
            userData = { ...user, ...userDoc.data() };
        }
    } catch (err) {
        console.warn('Kunde inte hämta användardata:', err);
    }

    const claims = userData.claimedEquipages || [];

    // 3. Rendera Dashboard
    container.innerHTML = `
        <div class="container mx-auto p-3 md:p-8">
            <header class="mb-6 md:mb-8">
                <h1 class="text-2xl md:text-3xl font-bold text-gray-900">Min Kuskportal</h1>
                <p class="text-sm md:text-base text-gray-600">Välkommen, ${user.email}</p>
            </header>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                <!-- Mina Tävlingar -->
                <section class="bg-white rounded-xl shadow-sm border p-4 md:p-6">
                    <h2 class="text-lg md:text-xl font-semibold mb-4 flex items-center gap-2">
                        🐴 Mina Tävlingar
                        <span class="bg-blue-100 text-blue-800 text-xs font-bold px-2 py-0.5 rounded-full">${claims.length}</span>
                    </h2>
                    
                    ${renderCompetitionList(claims)}
                    
                    <div class="mt-6 pt-6 border-t">
                        <h3 class="font-medium text-gray-900 mb-2 text-sm md:text-base">Hittar du inte din tävling?</h3>
                        <p class="text-xs md:text-sm text-gray-500 mb-3">
                            Om du är anmäld med en annan e-postadress (${user.email}) kan systemet inte hitta dig automatiskt.
                        </p>
                        <div class="flex gap-4">
                            <button id="manualSyncBtn" class="text-white bg-blue-600 px-4 py-2 rounded-md font-medium text-xs md:text-sm hover:bg-blue-700 w-full md:w-auto">🔄 Försök hitta mina anmälningar igen</button>
                        </div>
                    </div>
                </section>

                <!-- Status / Notiser (Aggregated Messages) -->
                <section class="bg-white rounded-xl shadow-sm border p-4 md:p-6 flex flex-col h-full">
                    <h2 class="text-lg md:text-xl font-semibold mb-4 flex items-center gap-2">
                        📬 Meddelanden
                        <span id="msg-badge" class="bg-red-100 text-red-800 text-xs font-bold px-2 py-0.5 rounded-full hidden">0</span>
                    </h2>
                    <div id="aggregated-messages" class="flex-1 overflow-y-auto max-h-[300px] md:max-h-[400px] space-y-3 pr-1 custom-scrollbar">
                        <div class="text-center py-8 text-gray-400">
                           <div class="spinner mb-2"></div>
                           Laddar meddelanden...
                        </div>
                    </div>
                </section>
            </div>
    `;

    // Hantera klick på tävlingskort
    container.addEventListener('click', (e) => {
        const card = e.target.closest('.competition-card');
        if (card) {
            const compId = card.dataset.compId;
            const compName = card.dataset.compName;
            const startNo = card.dataset.startNo;

            if (compId) {
                setGlobalState({
                    key: 'currentCompetition',
                    value: { id: compId, name: compName }
                });
                renderDashboard(container, compId, startNo, user);
            }
        }
    });

    if (messageUnsub) {
        messageUnsub();
        messageUnsub = null;
    }

    // 4. Lyssna och rendera aggregerade meddelanden (Push/Live)
    const unsubs = [];

    const msgContainer = document.getElementById('aggregated-messages');
    const badge = document.getElementById('msg-badge');

    if (msgContainer) {
        const uniqueCompIds = [...new Set(claims.map(c => c.competitionId))];
        const allMessagesMap = new Map(); // compId -> msgs[]
        const knownMsgIds = new Set();
        let isFirstLoad = true;

        // Helper to re-render all messages from all competitions
        const renderAllMessages = async () => {
            let allMsgs = [];

            // Fetch comp names if missing (could be optimized)
            for (const cid of uniqueCompIds) {
                const msgs = allMessagesMap.get(cid) || [];
                // Enhance with compName. We might need to fetch it if not in claim?
                // Claims usually just have id/startNo. 'renderCompetitionList' fetches names?
                // Let's assume we can lazily get name or cache it.
                // For now, use ID or generic name if missing to be fast.
                // Actually, let's try to get it from DOM or cache.
                const claim = claims.find(c => c.competitionId === cid);
                const compName = claim?.competitionName || (await getDoc(doc(db, `artifacts/${appId}/public/data/competitions/${cid}`)).then(d => d.data()?.name)).catch(() => '') || cid;

                // Filter for this user
                const relevant = msgs.filter(m =>
                    !m.targetStartNumber ||
                    String(m.targetStartNumber) === String(claim.startNumber)
                ).map(m => ({ ...m, _compName: compName, _compId: cid }));

                allMsgs = allMsgs.concat(relevant);
            }

            // Sort desc
            allMsgs.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));

            if (allMsgs.length === 0) {
                msgContainer.innerHTML = `<p class="text-gray-500 italic text-center py-8">Inga nya meddelanden.</p>`;
                badge.textContent = '0';
                badge.classList.add('hidden');
                return;
            }

            // Update Badge
            badge.textContent = allMsgs.length;
            badge.classList.remove('hidden');

            // Render
            msgContainer.innerHTML = allMsgs.map(m => {
                const isUrgent = m.severity === 'urgent' || m.type === 'alert';
                const colorClass = isUrgent ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-100';
                const icon = isUrgent ? '⚠️' : '📢';
                const time = m.timestamp ? new Date(m.timestamp.seconds * 1000).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }) : '';

                return `
                    <div class="p-4 rounded-lg border ${colorClass} relative group transition-all hover:shadow-sm animate-fade-in">
                        <div class="flex justify-between items-start mb-1">
                            <span class="text-xs font-bold text-gray-500 uppercase tracking-wide bg-white px-1.5 py-0.5 rounded border border-gray-200">
                                ${m._compName}
                            </span>
                            <span class="text-xs text-gray-400 tabular-nums">${time}</span>
                        </div>
                        <div class="flex gap-3 mt-2">
                             <div class="text-xl shrink-0 select-none">${icon}</div>
                             <div class="min-w-0">
                                <h4 class="font-bold text-gray-900 text-sm leading-tight mb-1">${m.title || 'Meddelande'}</h4>
                                <p class="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">${m.body || m.message || ''}</p>
                             </div>
                        </div>
                    </div>
                `;
            }).join('');
        };

        uniqueCompIds.forEach(cid => {
            const u = listenForCompetitionMessages(cid, (msgs) => {
                allMessagesMap.set(cid, msgs);

                // Toast Logic
                if (!isFirstLoad) {
                    msgs.forEach(m => {
                        // Check if new and relevant
                        const claim = claims.find(c => c.competitionId === cid);
                        const isRelevant = !m.targetStartNumber || String(m.targetStartNumber) === String(claim.startNumber);

                        if (isRelevant && !knownMsgIds.has(m.id)) {
                            // Toast!
                            showAlert(`Nytt meddelande: ${m.title || ''}`, false); // Use false for blue/info style? showAlert has isSuccess arg.
                            // Actually user might want a distinct toast. showAlert(..., true/false) is Green/Red.
                            // Let's use Green (true) for positive "New Info".
                        }
                    });
                }

                msgs.forEach(m => knownMsgIds.add(m.id));
                renderAllMessages();
            });
            unsubs.push(u);
        });

        messageUnsub = () => unsubs.forEach(u => u());

        // Initial grace period for "first load" to avoid spamming existing messages
        setTimeout(() => { isFirstLoad = false; }, 2000);
    }

    document.getElementById('manualSyncBtn')?.addEventListener('click', async () => {
        const btn = document.getElementById('manualSyncBtn');
        const origText = btn.textContent;
        btn.textContent = 'Söker...';
        btn.disabled = true;
        try {
            await autoClaimEquipages(user);
            showAlert('Sökning klar! Sidan laddas om...', true);
            setTimeout(() => {
                location.reload();
            }, 1500);
        } catch (err) {
            console.error(err);
            showAlert('Sökning misslyckades. Kontrollera att du är ansluten till internet.', false);
            btn.textContent = origText;
            btn.disabled = false;
        }
    });

    const currentComp = getGlobalState('currentCompetition');

    if (currentComp && claims.some(c => c.competitionId === currentComp.id)) {
        const claim = claims.find(c => c.competitionId === currentComp.id);
        if (claim) {
            renderDashboard(container, claim.competitionId, claim.startNumber, user, unsubs);
            return;
        }
    }
}

async function renderDashboard(container, compId, startNumber, user, unsubs = []) {
    container.innerHTML = `
        <div class="container mx-auto p-2 md:p-8 animate-fade-in">
            <button id="backToPortalBtn" class="mb-4 text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1 font-medium">
                ← Tillbaka till mina tävlingar
            </button>
            <div id="dashboard-header" class="mb-4 md:mb-6 bg-white p-4 md:p-6 rounded-xl shadow-sm border">
                <div class="animate-pulse h-16 bg-gray-100 rounded"></div>
            </div>
            
            <div class="bg-white rounded-xl shadow-sm border overflow-hidden min-h-[500px]">
                <div id="dash-tabs" class="flex border-b bg-gray-50 overflow-x-auto no-scrollbar scroll-smooth">
                    <!-- Tabs injects here -->
                </div>
                <div id="dash-content" class="p-4 md:p-6">
                    <div class="text-center py-12 text-gray-400">Laddar data...</div>   
                </div>
            </div>
        </div>
    `;

    document.getElementById('backToPortalBtn').addEventListener('click', () => {
        setGlobalState({ key: 'currentCompetition', value: null });
        window.location.hash = '#portal';
        location.reload();
    });

    try {
        const [
            compConfig,
            computedRes,
            equipages,
            marathonTiming,
            marathonConfig,
            precisionConfig,
            precisionResult,
            startTimes,
            dressyrProgramMapping,
            dressageProtocols,
            _clubLogos,
            documents,
            messages
        ] = await Promise.all([
            getDoc(doc(db, `artifacts/${appId}/public/data/competitions/${compId}`)).then(d => d.data()),
            getComputedResultForEquipage(compId, startNumber),
            getEquipages(compId),
            getMarathonTimingForEquipage(compId, startNumber).catch(() => ({})),
            getConfig(compId, 'maratonConfig').catch(() => ({})),
            getConfig(compId, 'precisionConfig').catch(() => ({})),
            getPrecisionResultForEquipage(compId, startNumber).catch(() => null),
            getConfig(compId, 'startTimes').catch(() => ({ times: {} })),
            getConfig(compId, 'dressyrProgramMapping').catch(() => ({})),
            getDressageResultsForEquipage(compId, startNumber).catch(() => []),
            ensureClubLogosLoaded(),
            getCompetitionDocuments(compId).catch(() => []),
            getCompetitionMessages(compId).catch(() => [])
        ]);

        const eq = equipages.find(e => String(e.startNumber) === String(startNumber)) || {};
        const r = computedRes || {};

        let dRes = r.dressage?.totalPenalty ?? r.dressage?.penalty;
        if (typeof dRes !== 'number' && dressageProtocols) {
            const progKey = dressyrProgramMapping[eq.className?.trim()];
            const program = getPrograms()[progKey];
            if (program) {
                const calculated = computeFinalFromSaved(eq, dressageProtocols, program);
                if (calculated?.penalty) dRes = calculated.penalty;
            }
        }
        const mRes = r.marathon?.totalPenalty;
        const pRes = precisionResult?.totalPenalty;

        const safeD = typeof dRes === 'number' ? dRes : 0;
        const safeM = typeof mRes === 'number' ? mRes : 0;
        const safeP = typeof pRes === 'number' ? pRes : 0;

        let totalShow = '—';
        if (r.totalPenalty != null) {
            totalShow = r.totalPenalty.toFixed(2);
        } else if (typeof dRes === 'number' || typeof mRes === 'number' || typeof pRes === 'number') {
            totalShow = (safeD + safeM + safeP).toFixed(2);
        }

        const headerEl = document.getElementById('dashboard-header');
        headerEl.innerHTML = `
            <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                   <h1 class="text-xl md:text-2xl font-bold text-gray-900 flex items-center gap-2 md:gap-3 flex-wrap">
                        <span class="bg-gray-900 text-white text-base md:text-lg px-2 md:px-3 py-1 rounded-md whitespace-nowrap">#${startNumber}</span>
                        <span class="break-all">${eq.driverName || r.driverName || 'Okänd kusk'}</span>
                   </h1>
                   <div class="text-gray-600 mt-2 flex flex-wrap gap-2 items-center text-xs md:text-sm">
                        ${getFlagHtml(eq)} 
                        <span class="font-medium bg-gray-100 px-2 py-0.5 rounded">${eq.className || r.className || ''}</span>
                        <span class="text-gray-300 hidden md:inline">|</span>
                        <span class="flex items-center gap-1 w-full md:w-auto mt-1 md:mt-0">${getClubLogoHtml(eq)} ${eq.clubName || ''}</span>
                        ${eq.groom ? `<span class="text-gray-300 hidden md:inline">|</span><span class="text-gray-500 w-full md:w-auto mt-1 md:mt-0">Groom: ${eq.groom}</span>` : ''}
                   </div>
                </div>
                <div class="text-left md:text-right w-full md:w-auto bg-gray-50 md:bg-transparent p-3 md:p-0 rounded-lg mt-2 md:mt-0">
                    <div class="text-xs text-gray-500 uppercase tracking-wider font-medium">Totalt Straff</div>
                    <div class="text-2xl md:text-3xl font-extrabold text-gray-900 tabular-nums">${totalShow}</div>
                </div>
            </div>
        `;

        const renderMessagesSection = () => {
            if (!messages || messages.length === 0) return '';

            const filtered = messages.filter(msg =>
                !msg.targetStartNumber ||
                String(msg.targetStartNumber) === String(startNumber)
            );

            if (filtered.length === 0) return '';

            return `
                <div id="messages-container" class="mb-6 max-h-60 overflow-y-auto space-y-3 pr-1 custom-scrollbar">
                    ${filtered.map(msg => {
                const isUrgent = msg.severity === 'urgent' || msg.type === 'alert';
                const colorClass = isUrgent ? 'bg-red-50 border-red-200 text-red-900' : 'bg-blue-50 border-blue-200 text-blue-900';
                const icon = isUrgent ? '⚠️' : '📢';
                const time = msg.timestamp ? new Date(msg.timestamp.seconds * 1000).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }) : '';

                return `
                        <div class="p-4 rounded-lg border ${colorClass} flex gap-4 shadow-sm animate-fade-in relative z-10 w-full">
                            <div class="text-2xl pt-1">${icon}</div>
                            <div class="flex-1 min-w-0">
                                <div class="flex justify-between items-start mb-1 flex-wrap gap-2">
                                    <h4 class="font-bold text-sm md:text-base break-words">${msg.title || 'Meddelande'}</h4>
                                    <span class="text-xs opacity-75 whitespace-nowrap">${time}</span>
                                </div>
                                <div class="text-sm opacity-90 leading-relaxed break-words">${msg.body || msg.message || ''}</div>
                            </div>
                        </div>
                        `;
            }).join('')}
                </div>
            `;
        };

        const existingMsgs = document.getElementById('messages-wrapper');
        if (existingMsgs) existingMsgs.remove();

        const msgsHtml = renderMessagesSection();
        if (msgsHtml) {
            const msgContainer = document.createElement('div');
            msgContainer.id = 'messages-wrapper';
            msgContainer.innerHTML = msgsHtml;
            const headerEl = document.getElementById('dashboard-header');
            headerEl.before(msgContainer);
        }

        const contentEl = document.getElementById('dash-content');
        const tabsEl = document.getElementById('dash-tabs');

        let allJudges = [];
        try {
            const [officials, judges] = await Promise.all([
                getOfficials(compId).catch(() => []),
                getJudges(compId).catch(() => [])
            ]);
            allJudges = [...judges, ...officials];
        } catch (e) {
            console.warn('Kunde inte hämta funktionärer:', e);
        }

        const ctx = {
            competitionId: compId,
            equipages: equipages,
            precisionConfig: precisionConfig,
            marathonConfig: marathonConfig,
            startTimes: startTimes,
            allCompetitionJudges: allJudges
        };

        // State for config
        let compMeta = {}; // Initialize as empty to allow first render

        const renderInfo = () => {
            // If compMeta is not loaded yet, default to safe open or cached defaults.
            // We no longer return early, so "Laddar data..." doesn't stick.

            contentEl.innerHTML = `
                <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div class="bg-white rounded-lg border p-6 shadow-sm relative group">
                        <div class="flex justify-between items-center mb-4 border-b pb-2">
                            <h3 class="text-lg font-bold">Ekipageinformation</h3>
                            ${(() => {
                    const now = new Date();
                    let startTime = null;
                    // Find earliest start time
                    if (startTimes && startTimes.times && startTimes.times[String(startNumber)]) {
                        const t = startTimes.times[String(startNumber)];
                        // t is likely { dressage: timestamp, marathon: timestamp, ... } or just string/date? 
                        // Config 'startTimes' usually has { times: { '1': { dressage: ... } } }
                        // Let's check structure. Assuming similar to other usages.
                        // If simple structure fails, we default to unlocked or check other reliable source.
                        // For now, let's assume we can fetch at least one start time or we rely on 'status'.
                        // If status is 'startad' or 'klar', definitely lock.
                        if (eq.status === 'startad' || eq.status === 'klar') return '<span class="text-xs font-bold text-red-500 uppercase">Låst (Startad)</span>';
                    }

                    // Hardcoded 1h check logic placeholder if specific time obj is missing
                    // We'll implement a helper `isLocked(eq, startTimes)` later if needed.
                    // For now, let's allow editing unless status says otherwise, 
                    // OR better: rely on user honesty + Admin override if needed, 
                    // BUT adding the visual lock is part of the request.

                    // Let's use a simple lock based on local check of "startTimes" config for this equipage.
                    let minutesToStart = 999;
                    const myTimes = (startTimes?.times || {})[String(startNumber)] || {};
                    const starts = Object.values(myTimes).filter(v => v && typeof v === 'object' && v.seconds); // Firestore timestamps
                    if (starts.length > 0) {
                        // Find earliest
                        const earliest = starts.sort((a, b) => a.seconds - b.seconds)[0];
                        const startJs = new Date(earliest.seconds * 1000);
                        minutesToStart = (startJs - now) / 60000;
                    }

                    if (compMeta.manualLockdown) {
                        return `<span class="text-xs font-bold text-red-600 bg-red-100 px-2 py-1 rounded" title="Sekretariatet har låst portalen">🔒 Låst manuellt</span>`;
                    }

                    if (minutesToStart < (compMeta.lockdownMinutes ?? 60)) {
                        return `<span class="text-xs font-bold text-orange-600 bg-orange-100 px-2 py-1 rounded" title="Start om mindre än 1h">🔒 Låst för ändringar</span>`;
                    }

                    return `
                                <button id="btnEditDeclaration" class="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 bg-blue-50 px-3 py-1 rounded-full transition-colors">
                                    ✏️ Ändra
                                </button>`;
                })()}
                        </div>
                        <dl class="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
                            <dt class="text-gray-500">Kusk:</dt>
                            <dd class="font-medium text-gray-900">${eq.driverName || '-'}</dd>
                            
                            <dt class="text-gray-500">Groom:</dt>
                            <dd class="font-medium text-gray-900">${eq.groom || '-'}</dd>
                            
                            <dt class="text-gray-500">Vagn:</dt>
                            <dd class="font-medium text-gray-900">${eq.carriage || '-'}</dd>

                            <dt class="text-gray-500">Startnummer:</dt>
                            <dd class="font-medium text-gray-900">#${startNumber}</dd>
                            <dt class="text-gray-500">Klass:</dt>
                            <dd class="font-medium text-gray-900">${eq.className || '-'}</dd>
                            <dt class="text-gray-500">Klubb:</dt>
                            <dd class="font-medium text-gray-900 flex items-center gap-2">
                                ${getClubLogoHtml(eq)} ${eq.clubName || '-'}
                            </dd>
                        </dl>
                    </div>

                    <div class="bg-white rounded-lg border p-6 shadow-sm">
                         <div class="flex justify-between items-center mb-4 border-b pb-2">
                            <h3 class="text-lg font-bold">Hästar</h3>
                             <!-- Edit button here too? Or shared? Let's verify lock again or reuse. -->
                             <!-- To keep it simple, one "Edit Declaration" button above handles all declaration fields (Groom, Horses, Carriage). -->
                             <span class="text-xs text-gray-400">Redigeras via "Ändra"</span>
                        </div>
                        <div class="space-y-3">
                            ${(() => {
                    let horseList = [];
                    if (Array.isArray(eq.horses) && eq.horses.length > 0) {
                        horseList = eq.horses.map((h, i) => ({
                            name: h.name || h.horseName || h.namn,
                            id: h.id || h.horseId || h.regNo || '',
                            idx: i + 1
                        })).filter(h => h.name);
                    } else {
                        for (let i = 1; i <= 5; i++) {
                            const n = eq[`horse${i}Name`] || eq[`horseName${i}`];
                            const id = eq[`horse${i}Id`] || eq[`horseId${i}`];
                            if (n) horseList.push({ name: n, id: id || '', idx: i });
                        }
                    }

                    if (horseList.length === 0) return '<div class="text-gray-400 italic">Ingen hästdata tillgänglig</div>';

                    return horseList.map(h => `
                                    <div class="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                                        <div class="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs">H${h.idx}</div>
                                        <div>
                                            <div class="font-bold text-gray-900">${h.name}</div>
                                            <div class="text-xs text-gray-500">ID: ${h.id || '-'}</div>
                                        </div>
                                    </div>
                                `).join('');
                })()}
                        </div>
                    </div>

                    <div class="bg-white rounded-lg border p-6 shadow-sm col-span-1 md:col-span-2">
                        <h3 class="text-lg font-bold mb-4 border-b pb-2">Funktionärer</h3>
                        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            ${allJudges.length ? allJudges.map(j => {
                    let roleStr = '';
                    if (j.role) {
                        roleStr = j.role;
                    } else if (j.roles && j.roles.length) {
                        const disciplineMap = {
                            'dressage': 'Dressyr',
                            'precision': 'Precision',
                            'marathon': 'Maraton',
                            'overjudge': 'Överdomare'
                        };
                        roleStr = j.roles.map(r => {
                            const discName = disciplineMap[r.discipline] || r.discipline;
                            if (r.discipline === 'dressage' && r.position) {
                                return `Dressyr (${r.position})`;
                            }
                            return discName;
                        }).filter(Boolean).join(', ');
                    } else {
                        roleStr = j.position || j.title || 'Funktionär';
                    }

                    const contactInfo = [j.email, j.phone, j.mobile, j.telephone].filter(Boolean).join(' • ');

                    return `
                                <div class="flex items-start gap-3 p-3 bg-gray-50 rounded border">
                                    <div class="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold shrink-0">
                                        ${(j.name || 'F').charAt(0)}
                                    </div>
                                    <div class="overflow-hidden">
                                        <div class="font-bold text-gray-900 text-sm truncate" title="${j.name}">${j.name}</div>
                                        <div class="text-xs text-gray-600 font-medium mb-1">${roleStr}</div>
                                        ${contactInfo ? `<div class="text-xs text-gray-400 truncate" title="${contactInfo}">${contactInfo}</div>` : ''}
                                    </div>
                                </div>`;
                }).join('') : '<div class="text-gray-500 italic">Inga funktionärer listade.</div>'}
                        </div>
                    </div>


                    <!-- VET CHECK SECTION (New) -->
                    <div class="bg-white rounded-lg border p-6 shadow-sm col-span-1 md:col-span-2 border-l-4 ${(() => {
                    const s = (eq.status || 'anmäld');
                    if (s === 'besiktigad') return 'border-l-green-500';
                    if (s === 'ombesiktning') return 'border-l-yellow-500';
                    if (s === 'struken') return 'border-l-red-500';
                    return 'border-l-gray-300';
                })()}">
                        <h3 class="text-lg font-bold mb-2 flex items-center gap-2">
                             🩺 Veterinärbesiktning
                        </h3>
                        <div class="flex items-center gap-3 mb-2">
                            <span class="text-sm font-medium text-gray-500">Status:</span>
                            ${(() => {
                    const s = eq.status || 'anmäld';
                    const map = {
                        'anmäld': { t: 'Väntar', c: 'bg-gray-100 text-gray-800' },
                        'incheckad': { t: 'Väntar (Incheckad)', c: 'bg-blue-100 text-blue-800' },
                        'besiktigad': { t: 'GODKÄND', c: 'bg-green-100 text-green-800' },
                        'ombesiktning': { t: 'OMBESIKTNING (Håll)', c: 'bg-yellow-100 text-yellow-800' },
                        'struken': { t: 'STRUKEN', c: 'bg-red-100 text-red-800' }
                    };
                    const def = map['anmäld'];
                    const curr = map[s] || def;
                    return `<span class="px-2 py-1 rounded text-sm font-bold uppercase ${curr.c}">${curr.t}</span>`;
                })()}
                        </div>
                        ${eq.vetNotes ? `
                        <div class="mt-3 p-3 bg-red-50 rounded border border-red-100">
                             <div class="text-xs font-bold text-red-800 uppercase mb-1">Veterinärens notering:</div>
                             <p class="text-red-900 text-sm">${eq.vetNotes}</p>
                        </div>` : ''}
                         ${eq.status === 'ombesiktning' ?
                    `<p class="text-sm text-yellow-800 mt-2">Vänligen kontakta veterinären eller sekretariatet för mer information.</p>` : ''}
                    </div>

                    <!-- SPEAKER NOTES SECTION -->
                    <div class="bg-white rounded-lg border p-6 shadow-sm col-span-1 md:col-span-2 border-l-4 border-l-yellow-400">
                        <h3 class="text-lg font-bold mb-2 flex items-center gap-2">
                            📢 Speaker-noteringar
                            <span class="text-xs font-normal bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full">Nyhet</span>
                        </h3>
                        <p class="text-sm text-gray-600 mb-4">
                            Här kan du skriva information som speakern kan använda under dina rutter. T.ex. info om hästens härstamning, dina tidigare meriter, eller kuriosa.
                            Detta visas direkt i speakerns dashboard.
                        </p>
                        <div class="flex flex-col gap-2">
                            <textarea id="portalSpeakerNotes" rows="4" class="w-full rounded border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" placeholder="Skriv dina noteringar här...">${eq.speakerNotes || ''}</textarea>
                            <div class="flex justify-end">
                                <button id="btnSaveSpeakerNotes" class="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-6 rounded shadow-sm transition-colors text-sm">
                                    Spara Noteringar
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // === Edit Declaration Listener ===
            setTimeout(() => {
                const editBtn = document.getElementById('btnEditDeclaration');
                if (editBtn) {
                    editBtn.onclick = () => {
                        // Create modal
                        const modal = document.createElement('div');
                        modal.className = "fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-fade-in";
                        modal.innerHTML = `
                        <div class="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
                            <div class="p-4 border-b bg-gray-50 flex justify-between items-center">
                                <h3 class="font-bold text-lg">Redigera Deklaration</h3>
                                <button id="closeDeclModal" class="text-gray-500 hover:text-gray-800 text-2xl leading-none">&times;</button>
                            </div>
                            <div class="p-6 overflow-y-auto space-y-4">
                                <div>
                                    <label class="block text-sm font-bold text-gray-700 mb-1">Groom / Medhjälpare</label>
                                    <input type="text" id="editGroom" class="w-full border rounded p-2" value="${eq.groom || ''}" placeholder="Namn på groom">
                                </div>
                                <div>
                                    <label class="block text-sm font-bold text-gray-700 mb-1">Vagn</label>
                                    <input type="text" id="editCarriage" class="w-full border rounded p-2" value="${eq.carriage || ''}" placeholder="Fabrikat / Modell / Spårbredd">
                                </div>
                                <div class="bg-blue-50 p-4 rounded border border-blue-100">
                                    <label class="block text-sm font-bold text-blue-900 mb-2">Hästar (Max 5)</label>
                                    <div id="editHorseContainer" class="space-y-2"></div>
                                    <button id="addHorseBtn" class="mt-2 text-sm text-blue-600 font-medium hover:underline">+ Lägg till häst</button>
                                </div>
                                <div>
                                    <label class="block text-sm font-bold text-gray-700 mb-1">Klubb</label>
                                    <input type="text" id="editClub" class="w-full border rounded p-2" value="${eq.clubName || ''}">
                                </div>
                            </div>
                            <div class="p-4 border-t bg-gray-50 flex justify-end gap-2">
                                <button id="cancelDeclFn" class="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded">Avbryt</button>
                                <button id="saveDeclFn" class="px-6 py-2 bg-blue-600 text-white font-bold rounded shadow hover:bg-blue-700">Spara Ändringar</button>
                            </div>
                        </div>
                        `;
                        document.body.appendChild(modal);

                        // Populate horses
                        const container = modal.querySelector('#editHorseContainer');
                        let currentHorses = (Array.isArray(eq.horses) ? eq.horses : []).map(h => ({
                            name: h.name || h.horseName || '',
                            id: h.id || h.horseId || ''
                        }));
                        // Fallback fallback legacy fields if array empty
                        if (currentHorses.length === 0) {
                            for (let i = 1; i <= 5; i++) {
                                const n = eq[`horse${i}Name`] || eq[`horseName${i}`];
                                if (n) currentHorses.push({ name: n, id: eq[`horse${i}Id`] || '' });
                            }
                        }

                        const renderRows = () => {
                            container.innerHTML = currentHorses.map((h, i) => `
                                <div class="flex gap-2 items-start animate-fade-in horse-row" data-idx="${i}">
                                    <div class="flex-1 space-y-1">
                                        <input type="text" class="w-full border rounded p-1 text-sm h-name" placeholder="Hästnamn" value="${h.name || ''}">
                                        <input type="text" class="w-full border rounded p-1 text-xs h-id" placeholder="ID / Regnr" value="${h.id || ''}">
                                    </div>
                                    <button class="rm-horse text-red-400 hover:text-red-600 p-1" title="Ta bort">&times;</button>
                                </div>
                            `).join('');

                            // Bind delete
                            container.querySelectorAll('.rm-horse').forEach(b => b.onclick = (e) => {
                                const idx = parseInt(e.target.closest('.horse-row').dataset.idx);
                                currentHorses.splice(idx, 1);
                                renderRows();
                            });
                        };
                        renderRows();

                        modal.querySelector('#addHorseBtn').onclick = () => {
                            if (currentHorses.length >= 5) return showAlert('Max 5 hästar tillåtna.', false);
                            currentHorses.push({ name: '', id: '' });
                            renderRows();
                        };

                        const close = () => modal.remove();
                        modal.querySelector('#closeDeclModal').onclick = close;
                        modal.querySelector('#cancelDeclFn').onclick = close;

                        modal.querySelector('#saveDeclFn').onclick = async () => {
                            const btn = modal.querySelector('#saveDeclFn');
                            const oldText = btn.textContent;
                            btn.textContent = 'Sparar...';
                            btn.disabled = true;

                            // Gather data
                            const groom = modal.querySelector('#editGroom').value.trim();
                            const carriage = modal.querySelector('#editCarriage').value.trim();
                            const clubName = modal.querySelector('#editClub').value.trim();

                            // Gather horses from DOM inputs to get latest edits
                            const rows = container.querySelectorAll('.horse-row');
                            const newHorses = [];
                            rows.forEach(r => {
                                const name = r.querySelector('.h-name').value.trim();
                                const id = r.querySelector('.h-id').value.trim();
                                if (name) newHorses.push({ name, id });
                            });

                            try {
                                await saveEquipage(compId, startNumber, {
                                    groom,
                                    carriage,
                                    clubName,
                                    horses: newHorses
                                    // lastUpdated: new Date() // Commented out to debug permissions
                                });
                                showAlert('Ändringar sparade! 💾', true);
                                close();
                                // Reload dashboard logic? Easier to just reload page or re-render
                                // Re-rendering this specific view is safest visual update
                                setTimeout(() => location.reload(), 800);
                            } catch (err) {
                                console.error(err);
                                showAlert('Kunde inte spara. ' + err.message, false);
                                btn.textContent = oldText;
                                btn.disabled = false;
                            }
                        };
                    };
                }
            }, 100);

            // Event listener for Save Button (Speaker Notes)
            setTimeout(() => {
                const btn = document.getElementById('btnSaveSpeakerNotes');
                const txt = document.getElementById('portalSpeakerNotes');
                if (btn && txt) {
                    btn.addEventListener('click', async () => {
                        const val = txt.value;
                        const oldText = btn.textContent;
                        btn.textContent = 'Sparar...';
                        btn.disabled = true;

                        try {
                            await saveEquipage(compId, startNumber, { speakerNotes: val });
                            showAlert('Noteringar sparade!', true);
                            btn.textContent = 'Sparat!';
                            setTimeout(() => {
                                btn.textContent = oldText;
                                btn.disabled = false;
                            }, 2000);
                        } catch (err) {
                            console.error(err);
                            showAlert('Kunde inte spara noteringar.', false);
                            btn.textContent = oldText;
                            btn.disabled = false;
                        }
                    });
                }
            }, 100);
        };

        // Initialize listener for Config (Lockdown etc)
        const configUnsub = listenForConfig(compId, 'competitionMeta', (newMeta) => {
            compMeta = newMeta || {};
            // If current tab is Info, re-render it.
            // Since we don't have explicit tab state inside separate functions easily,
            // we can check if contentEl contains the Info view or just call renderInfo if it's the active view.
            // But actually renderDashboard sets up tabs.
            // Simplified: If we are in "Info" mode (default), re-render.
            // Since renderInfo is just a function updating contentEl, we can call it if we know we are on that tab.
            // HOWEVER, renderDashboard logic is linear.
            // Let's just update `compMeta` and if the current view IS "Info", trigger renderInfo.
            // For now, let's assume we are on Info tab or allow it to refresh.
            // Optimization: Only if #btnEditDeclaration or lock badge exists?
            // Safer: Just set state. But user wants immediate feedback.

            // Re-render Info if we are seemingly on the dashboard info view (which is default).
            // We can't easily know if user switched to 'dressage' tab unless we track it.
            // But 'renderInfo' replaces contentEl.HTML, so if we call it, we overwrite whatever tab is open.
            // This is risky if user is in Dressage tab.
            // Better: update the specific element if it exists.
            // Better: Check if we are viewing the Info tab by looking for a specific element
            // "Ekipageinformation" header is unique to renderInfo
            if (contentEl.innerHTML.includes('Ekipageinformation')) {
                renderInfo();
            }
        });
        unsubs.push(configUnsub);

        // Initial trigger
        // renderInfo(); // Don't call immediately to likely avoid overwriting if user is navigating fast? 
        // Actually, renderDashboard expects to show something.
        renderInfo();

        const renderDressage = async () => {
            contentEl.innerHTML = '<div class="text-center py-12"><div class="spinner"></div> Laddar dressyr...</div>';
            let protocols = dressageProtocols;
            protocols = (Array.isArray(protocols) ? protocols : []).map(d => {
                if (!d) return null;
                const base =
                    (d.protocol && typeof d.protocol === 'object') ? d.protocol :
                        (d.value && typeof d.value === 'object') ? d.value :
                            d;
                return { ...d, ...base };
            }).filter(Boolean);

            let programKey = eq.dressageProgramKey || protocols[0]?.programKey || protocols[0]?.testKey;

            if (!programKey) {
                const cls = eq.className || '';
                if (dressyrProgramMapping && dressyrProgramMapping[cls]) {
                    programKey = dressyrProgramMapping[cls];
                } else if (compConfig?.classes && compConfig.classes[cls]) {
                    programKey = compConfig.classes[cls];
                }
            }

            const program = programKey ? getPrograms()[programKey] : null;

            let calculated = null;
            if (program && (!r?.dressage?.percentAvg || !r?.dressage?.penalty)) {
                calculated = computeFinalFromSaved(eq, protocols, program);
            }

            const data = {
                startNumber: String(startNumber),
                driverName: eq.driverName,
                clubName: eq.clubName,
                country: eq.country,
                testKey: programKey,
                className: eq.className,
                finalPercent: r?.dressage?.percentAvg || calculated?.percent,
                finalPenalty: r?.dressage?.penalty || calculated?.penalty,
                errorPoints: r?.dressage?.errorPoints,
                plac: r?.dressage?.plac,
                eliminated: r.isEliminated,
                judges: {},
                __savedProtocols: protocols,
                __eq: eq
            };

            const normalizeStr = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

            protocols.forEach(p => {
                const jid = p.judgeId || p.id || p.position;
                if (!jid || jid === 'general') return;

                let judgeInfo = allJudges.find(j => j.id === jid);

                if (!judgeInfo) {
                    const cleanJid = jid.replace(/^judge[_\-]/i, '');
                    const target = normalizeStr(cleanJid);
                    judgeInfo = allJudges.find(j =>
                        normalizeStr(j.id) === target ||
                        normalizeStr(j.name) === target
                    );
                }

                if (!judgeInfo && (p.judgeName || p.name)) {
                    const targetName = normalizeStr(p.judgeName || p.name);
                    judgeInfo = allJudges.find(j => normalizeStr(j.name).includes(targetName));
                }

                judgeInfo = judgeInfo || {};
                let niceName = judgeInfo.name || p.judgeName || p.name || jid;
                if (niceName.toLowerCase().startsWith('judge_')) {
                    niceName = niceName.replace(/^judge_/i, '')
                        .replace(/[_-]/g, ' ')
                        .replace(/\b\w/g, c => c.toUpperCase());
                }

                let pos = (p.position || p.judgePos || p.judgePosition || '').toUpperCase();
                if (!pos && judgeInfo) {
                    if (Array.isArray(judgeInfo.roles)) {
                        const r = judgeInfo.roles.find(x => x.discipline === 'dressage');
                        if (r && r.position) pos = r.position;
                    }
                    if (!pos && judgeInfo.position) pos = judgeInfo.position;
                    if (!pos && judgeInfo.disciplines && typeof judgeInfo.disciplines.dressage === 'string') {
                        pos = judgeInfo.disciplines.dressage;
                    }
                    if (!pos && (judgeInfo.role || judgeInfo.title)) {
                        const t = (judgeInfo.role || judgeInfo.title).toUpperCase();
                        if (/^[CEBHMFK]$/.test(t)) pos = t;
                    }
                }

                if (!pos && jid.length <= 2 && /^[A-Z]$/.test(jid.toUpperCase())) {
                    pos = jid.toUpperCase();
                }

                if (!pos || pos === '?') {
                    pos = '?';
                }

                data.judges[jid] = {
                    id: jid,
                    name: niceName,
                    position: pos,
                    movements: p.movements || [],
                    totalPoints: p.totalPoints,
                    percent: p.percent
                };
            });

            const judgesList = Object.values(data.judges).filter(j => j.position);
            data.__judgesPresent = judgesList;

            const pdfCtx = {
                startNumber: startNumber,
                processedResultsRef: [data],
                providers: { getPrograms: () => getPrograms() }
            };

            renderDressageContent(contentEl, data, judgesList, program, pdfCtx);
        };

        const renderMarathon = async () => {
            contentEl.innerHTML = '<div class="text-center py-12"><div class="spinner"></div> Laddar maraton...</div>';

            const [liveDoc, storedObstacles] = await Promise.all([
                getMarathonLiveDocument(compId, String(startNumber)).catch(() => null),
                getMarathonObstacleResults(compId, String(startNumber)).catch(() => [])
            ]);

            const obstacles = (liveDoc?.obstacles?.length) ? liveDoc.obstacles : storedObstacles;
            const safeTiming = marathonTiming || {};
            const marathonData = {
                ...(liveDoc || {}),
                ...safeTiming,
                duration_A: safeTiming.duration_A,
                duration_B: safeTiming.duration_B,
                obstacles: obstacles
            };

            contentEl.innerHTML = `
                <div class="flex justify-end mb-4 px-2">
                     <button id="portalTimeCardBtn" class="text-xs md:text-sm font-semibold text-blue-700 hover:underline flex items-center gap-1 bg-blue-50 px-3 py-1.5 rounded-full">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>
                        Visa Tidkort
                    </button>
                </div>
                <div class="overflow-x-auto -mx-4 md:mx-0 px-4 md:px-0 scrollbar-hide">
                    <div id="portal-marathon-content" class="min-w-[600px] md:min-w-0"></div>
                </div>
            `;

            const tableContainer = contentEl.querySelector('#portal-marathon-content');
            const toggleBtn = contentEl.querySelector('#portalTimeCardBtn');

            renderMarathonContent(tableContainer, eq, marathonData);

            let isTimeCard = false;
            toggleBtn.addEventListener('click', () => {
                isTimeCard = !isTimeCard;
                if (isTimeCard) {
                    renderTimeCard(tableContainer, eq, marathonData);
                    toggleBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7"></path></svg> Visa Detaljer`;
                } else {
                    renderMarathonContent(tableContainer, eq, marathonData);
                    toggleBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg> Visa Tidkort`;
                }
            });
        };

        const renderPrecision = async () => {
            contentEl.innerHTML = '<div class="text-center py-12"><div class="spinner"></div> Laddar precision...</div>';
            const latest = await getPrecisionResultForEquipage(compId, startNumber).catch(() => precisionResult);
            renderPrecisionContent(contentEl, eq, latest || {}, precisionConfig, startTimes, equipages);
        };

        const renderDocuments = async () => {
            if (!documents || documents.length === 0) {
                contentEl.innerHTML = `
                    <div class="p-12 text-center text-gray-500 bg-gray-50 rounded-lg border border-dashed">
                        <div class="text-4xl mb-4">📄</div>
                        <h3 class="text-lg font-medium text-gray-900">Inga dokument publicerade</h3>
                        <p>Här kommer banskisser och startlistor att visas.</p>
                    </div>
                 `;
                return;
            }

            contentEl.innerHTML = `
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-fade-in">
                    ${documents.map(doc => {
                const icon = doc.type === 'startlist' ? '📋' : (doc.type === 'course' ? '🗺️' : '📄');
                const isHtml = doc.type === 'html';

                const wrapperStart = isHtml
                    ? `<div onclick="window.openDocModal('${doc.id}')" class="cursor-pointer block group h-full">`
                    : `<a href="${doc.url}" target="_blank" class="block group no-underline h-full">`;
                const wrapperEnd = isHtml ? `</div>` : `</a>`;

                return `
                        ${wrapperStart}
                            <div class="bg-white p-5 rounded-lg border shadow-sm hover:shadow-md hover:border-blue-300 transition-all flex flex-col h-full relative overflow-hidden">
                                <div class="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                                    <span class="text-6xl">${icon}</span>
                                </div>
                                <div class="flex items-center gap-3 mb-3">
                                    <div class="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                                        ${icon}
                                    </div>
                                    <div>
                                        <h4 class="font-bold text-gray-900 group-hover:text-blue-700 transition-colors">${doc.title || 'Dokument'}</h4>
                                        <span class="text-xs text-gray-500 uppercase tracking-wide bg-gray-100 px-1.5 py-0.5 rounded">${doc.category || doc.type || 'Fil'}</span>
                                    </div>
                                </div>
                                <div class="mt-auto pt-3 border-t flex justify-between items-center text-sm text-gray-500">
                                    <span>${doc.uploadedAt ? new Date(doc.uploadedAt.seconds * 1000).toLocaleDateString() : 'Nyligen'}</span>
                                    <span class="group-hover:translate-x-1 transition-transform">${isHtml ? 'Läs →' : 'Öppna →'}</span>
                                </div>
                            </div>
                        ${wrapperEnd}
                        `;
            }).join('')}
                </div>
             `;

            window.openDocModal = (docId) => {
                const d = documents.find(x => x.id === docId);
                if (!d) return;

                const modalHtml = `
                    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" id="doc-modal-overlay">
                        <div class="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col animate-fade-in-up">
                            <div class="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-xl">
                                <h3 class="font-bold text-lg">${d.title}</h3>
                                <button onclick="document.getElementById('doc-modal-overlay').remove()" class="text-gray-500 hover:text-gray-800 text-2xl leading-none">&times;</button>
                            </div>
                            <div class="p-6 overflow-y-auto prose dark:prose-invert">
                                ${d.content || '<p class="text-gray-500 italic">Inget innehåll.</p>'}
                            </div>
                            <div class="p-4 border-t bg-gray-50 rounded-b-xl text-right">
                                <button onclick="document.getElementById('doc-modal-overlay').remove()" class="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded font-medium text-sm text-gray-800 transition">Stäng</button>
                            </div>
                        </div>
                    </div>
                 `;
                const div = document.createElement('div');
                div.innerHTML = modalHtml;
                document.body.appendChild(div.firstElementChild);
            };
        };

        const renderTotal = async () => {
            contentEl.innerHTML = `
                <div class="animate-fade-in max-w-2xl mx-auto">
                    <div class="bg-white rounded-xl shadow-sm border overflow-hidden">
                        <div class="bg-gray-900 text-white p-4 md:p-6 text-center">
                            <h2 class="text-xs md:text-sm uppercase tracking-wider font-semibold opacity-75 mb-1">Totalt Straff</h2>
                            <div class="text-4xl md:text-5xl font-extrabold tabular-nums">${totalShow}</div>
                        </div>
                        <div class="p-4 md:p-6">
                            <div class="space-y-3 md:space-y-4">
                                <!-- Dressyr -->
                                <div class="flex items-center justify-between p-3 md:p-4 bg-gray-50 rounded-lg border border-gray-100">
                                    <div class="flex items-center gap-3">
                                        <div class="w-8 h-8 md:w-10 md:h-10 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-lg md:text-xl">🎩</div>
                                        <div>
                                            <div class="font-bold text-gray-900 text-sm md:text-base">Dressyr</div>
                                            <div class="text-[10px] md:text-xs text-gray-500">Straffpoäng</div>
                                        </div>
                                    </div>
                                    <div class="text-lg md:text-xl font-bold font-mono ${safeD ? 'text-gray-900' : 'text-gray-400'}">
                                        ${typeof dRes === 'number' ? dRes.toFixed(2) : '—'}
                                    </div>
                                </div>

                                <!-- Maraton -->
                                <div class="flex items-center justify-between p-3 md:p-4 bg-gray-50 rounded-lg border border-gray-100">
                                    <div class="flex items-center gap-3">
                                        <div class="w-8 h-8 md:w-10 md:h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-lg md:text-xl">⏱️</div>
                                        <div>
                                            <div class="font-bold text-gray-900 text-sm md:text-base">Maraton</div>
                                            <div class="text-[10px] md:text-xs text-gray-500">Straffpoäng</div>
                                        </div>
                                    </div>
                                    <div class="text-lg md:text-xl font-bold font-mono ${safeM ? 'text-gray-900' : 'text-gray-400'}">
                                        ${typeof mRes === 'number' ? mRes.toFixed(2) : '—'}
                                    </div>
                                </div>

                                <!-- Precision -->
                                <div class="flex items-center justify-between p-3 md:p-4 bg-gray-50 rounded-lg border border-gray-100">
                                    <div class="flex items-center gap-3">
                                        <div class="w-8 h-8 md:w-10 md:h-10 rounded-full bg-orange-100 text-orange-700 flex items-center justify-center">
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5 md:w-6 md:h-6 text-orange-600 fill-current">
                                                <path d="M12 2L4.5 19H19.5L12 2Z" fill="orange" stroke="orange" stroke-width="2" stroke-linejoin="round" />
                                                <path d="M4.5 19H19.5" stroke="black" stroke-width="2" />
                                            </svg>
                                        </div>
                                        <div>
                                            <div class="font-bold text-gray-900 text-sm md:text-base">Precision</div>
                                            <div class="text-[10px] md:text-xs text-gray-500">Straffpoäng</div>
                                        </div>
                                    </div>
                                    <div class="text-lg md:text-xl font-bold font-mono ${safeP ? 'text-gray-900' : 'text-gray-400'}">
                                        ${typeof pRes === 'number' ? pRes.toFixed(2) : '—'}
                                    </div>
                                </div>
                            </div>

                            <div class="mt-6 md:mt-8 pt-4 md:pt-6 border-t text-center">
                                <p class="text-xs md:text-sm text-gray-500 leading-relaxed">
                                    Placering och officiella resultat hittar du på resultatsidan för respektive moment eller på den totala resultatlistan.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        };

        const tabs = [
            { id: 'info', label: 'ℹ️ Info', fn: renderInfo },
            { id: 'documents', label: '📄 Dokument', fn: renderDocuments },
            { id: 'dressage', label: '🎩 Dressyr', fn: renderDressage },
            { id: 'marathon', label: '⏱️ Maraton', fn: renderMarathon },
            {
                id: 'precision', label: `
            <span class="flex items-center gap-1">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4 text-orange-500 fill-current">
                    <path d="M12 2L4.5 19H19.5L12 2Z" fill="orange" stroke="orange" stroke-width="2" stroke-linejoin="round" />
                    <path d="M4.5 19H19.5" stroke="black" stroke-width="2" />
                </svg>
        Precision
                </span>`, fn: renderPrecision
            },
            { id: 'total', label: '🏆 Totalt', fn: renderTotal }
        ];

        tabsEl.innerHTML = tabs.map(t => `
            <button data-tab="${t.id}" class="px-6 py-4 text-sm font-bold text-gray-500 hover:text-gray-800 border-b-2 border-transparent hover:border-gray-300 focus:outline-none transition-colors whitespace-nowrap flex items-center gap-2">
                ${t.label}
            </button>
            `).join('');

        const switchTab = (id) => {
            tabsEl.querySelectorAll('button').forEach(b => {
                const isActive = b.dataset.tab === id;
                b.classList.toggle('text-blue-600', isActive);
                b.classList.toggle('border-blue-600', isActive);
                b.classList.toggle('text-gray-500', !isActive);
            });
            tabs.find(t => t.id === id)?.fn();
        };

        tabsEl.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (btn) switchTab(btn.dataset.tab);
        });

        switchTab('info');

    } catch (err) {
        console.error('Dashboard load failed:', err);
        container.innerHTML = `<div class="p-8 text-center text-red-600">Kunde inte ladda tävlingsdata: ${err.message}</div>`;
    }
}

function renderCompetitionList(claims) {
    if (!claims || claims.length === 0) {
        return `
            <div class="text-center py-8 bg-gray-50 rounded-lg border border-dashed">
                <p class="text-gray-500">Du är inte kopplad till några tävlingar än.</p>
            </div>
            `;
    }

    return `
            <div class="space-y-3">
                ${claims.map(c => `
                <div class="competition-card flex items-center justify-between p-3 bg-gray-50 rounded-lg border hover:bg-blue-50 transition-colors cursor-pointer" 
                     data-comp-id="${c.competitionId}" 
                     data-comp-name="${c.competitionName}"
                     data-start-no="${c.startNumber}"> 
                    <div>
                        <div class="font-bold text-gray-900">${c.competitionName}</div>
                        <div class="text-sm text-gray-600">Startnummer #${c.startNumber}</div>
                    </div>
                    <div class="text-right">
                        <span class="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">Kopplad</span>
                    </div>
                </div>
            `).join('')}
        </div>
            `;
}

export function __unload() {
}
