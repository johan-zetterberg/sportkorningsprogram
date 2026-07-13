import { getGlobalState, setGlobalState } from '../../main.js';
import { getDoc, doc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from '../../config/firebase-config.js';
import { getCompetitionHeader, showAlert } from '../../ui/components.js';
import { autoClaimEquipages } from '../../services/authService.js';
import { getComputedResultForEquipage, getEquipagePrivateData, saveEquipage } from '../../services/equipageService.js';
import { getMarathonTimingForEquipage, getMarathonLiveDocument } from '../../services/marathonService.js';
import { getPrecisionResultForEquipage } from '../../services/precisionService.js';
import { listenForDressageProtocols } from '../../services/dressageService.js';
import { getDressageResultsForEquipage } from '../../services/dressageService.js';
import { getEquipages } from '../../services/equipageService.js';
import { getConfig } from '../../services/competitionService.js';
import { getMarathonObstacleResults } from '../../services/marathonService.js';
import { renderDressageContent } from '../../ui/dressageModal.js';
import { renderMarathonContent, renderTimeCard } from '../../ui/marathonModal.js';
import { renderPrecisionContent } from '../../ui/precisionModal.js';
import { getFlagHtml } from '../../services/flagsService.js';
import {
    calculatePortalTotalPenaltyLabel,
    formatPortalPenalty,
    getPortalPenaltyToneClass
} from './portalResultFormatUtils.js';
import {
    formatPortalTimestamp,
    getPortalMinutesToNextStart,
    getPortalStartTimesForEquipage,
    normalizePortalStartTimesConfig,
    resolvePortalDisciplinePenalties,
    sortPortalItemsByTimestampDesc
} from './portalDataUtils.js';
import {
    buildHorseTemperatureSlots,
    getHorseTemperatureRecord,
    getTemperatureHorses,
    normalizeHorseTemperatureConfig,
    normalizeHorseTemperatureValue,
    summarizeHorseTemperatures
} from './horseTemperatureUtils.js';

import { joinCompetitionAsAdmin, getJudges } from '../../services/adminService.js';
import { getCompetitionDocuments, getCompetitionMessages, listenForCompetitionMessages, isMessageVisibleToDriver, isDocumentVisibleToDriver } from '../../services/documentService.js';
import { listenForConfig } from '../../services/competitionService.js';
import { listenForJudges } from '../../services/adminService.js';
import { getOfficials } from '../../services/adminService.js';
import { getClubLogoHtml, ensureClubLogosLoaded } from '../../services/logosService.js';
import { getPrograms, guessProgramKeyFromClass, deduplicateAndFilterProtocols, normalizeMovements } from '../../utils/dressageUtils.js';
import { calculateDressageResult, calculateSingleJudgeDressageResult } from '../../services/calculationService.js';
import { t } from '../../utils/i18n.js';
import { escapeHtml } from '../../utils/sharedUtils.js';

let messageUnsub = null;
let dashboardUnsub = null;
let portalLoadToken = 0;
const escapeAttr = (value) => escapeHtml(value ?? '');

function sanitizePortalUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '#';
    if (/^(https?:|mailto:|\/)/i.test(raw)) return raw;
    return '#';
}

function normalizePortalEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function canSelfServiceEditEquipage(user, equipage, privateData) {
    const userEmail = normalizePortalEmail(user?.email);
    const equipageEmail = normalizePortalEmail(privateData?.email || equipage?.email);
    if (equipage) equipage.email = privateData?.email || equipage?.email;
    return !!userEmail && !!equipageEmail && userEmail === equipageEmail;
}

function getSelfServiceRestrictionMessage(user, equipage, privateData) {
    const equipageEmail = normalizePortalEmail(privateData?.email || equipage?.email);
    if (!equipageEmail) {
        return 'Ekipaget saknar kopplad e-postadress för självservice. Kontakta sekretariatet om du behöver ändra deklarationen.';
    }
    return `Du är inloggad som ${user?.email || 'okänd användare'}, men ekipaget är kopplat till ${equipage.email}. Kontakta sekretariatet om du behöver ändra deklarationen.`;
}

function cleanupPortalSubscriptions() {
    if (messageUnsub) {
        messageUnsub();
        messageUnsub = null;
    }
    if (dashboardUnsub) {
        dashboardUnsub();
        dashboardUnsub = null;
    }
}

export async function load() {
    __unload();
    const currentLoadToken = ++portalLoadToken;

    const container = document.getElementById('page-portal');
    if (!container) return;

    // 1. Kontrollera inloggning
    const user = getGlobalState('currentUser');
    if (!user) {
        container.innerHTML = `
            <div class="p-8 text-center">
                <h2 class="text-xl font-bold text-gray-800 mb-2">${t('login_required_title')}</h2>
                <p class="text-gray-600 mb-4">${t('login_required_msg')}</p>
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

    if (currentLoadToken !== portalLoadToken) return;

    const claims = userData.claimedEquipages || [];

    let adminImpersonateHtml = '';
    if (userData.role === 'admin' || userData.role === 'superadmin') {
        const compId = getGlobalState('currentCompetition')?.id || '';
        adminImpersonateHtml = `
            <div class="mt-6 pt-6 border-t dark:border-gray-700">
                <h3 class="font-bold text-purple-900 dark:text-purple-300 mb-2 flex items-center gap-2">🛡️ Admin: Granska portal</h3>
                <div class="flex gap-2">
                    <input type="text" id="adminImpersonateCompId" placeholder="Tävlings-ID" class="px-3 py-2 border rounded-md text-sm flex-1 dark:bg-gray-700 dark:border-gray-600 dark:text-white" value="${compId}">
                    <input type="text" id="adminImpersonateStartNo" placeholder="Startnr" class="px-3 py-2 border rounded-md text-sm w-24 dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                    <button id="adminImpersonateBtn" class="bg-purple-600 text-white px-4 py-2 rounded-md text-sm font-bold hover:bg-purple-700 transition-colors">Granska</button>
                </div>
            </div>
        `;
    }

    // 3. Rendera Dashboard
    container.innerHTML = `
        <div class="container mx-auto p-3 md:p-8">
            <header class="mb-6 md:mb-8">
                <h1 class="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">${t('my_portal')}</h1>
                <p class="text-sm md:text-base text-gray-600 dark:text-gray-400">${t('welcome')}, ${user.email}</p>
            </header>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                <!-- Mina Tävlingar -->
                <section class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700 p-4 md:p-6">
                    <h2 class="text-lg md:text-xl font-semibold mb-4 flex items-center gap-2 dark:text-gray-100">
                        🐴 ${t('my_competitions')}
                        <span class="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100 text-xs font-bold px-2 py-0.5 rounded-full">${claims.length}</span>
                    </h2>
                    
                    ${renderCompetitionList(claims)}
                    
                    <div class="mt-6 pt-6 border-t dark:border-gray-700">
                        <h3 class="font-medium text-gray-900 dark:text-gray-200 mb-2 text-sm md:text-base">${t('cant_find_comp')} / Extra rättigheter</h3>
                        <p class="text-xs md:text-sm text-gray-500 dark:text-gray-400 mb-3">
                            Tryck på Synkronisera om en tävling saknas, eller Bli Funktionär om du fått en tillfällig PIN-kod.
                        </p>
                        <div class="flex flex-col sm:flex-row gap-3 sm:gap-4">
                            <button id="manualSyncBtn" class="text-white bg-blue-600 px-4 py-2 rounded-md font-medium text-xs md:text-sm hover:bg-blue-700 w-full md:w-auto">🔄 ${t('sync_btn')}</button>
                            <button id="joinAsAdminBtn" class="text-blue-600 bg-blue-50 border border-blue-200 px-4 py-2 rounded-md font-medium text-xs md:text-sm hover:bg-blue-100 w-full md:w-auto transition-colors">🔐 Bli Funktionär</button>
                        </div>
                    </div>
                    ${adminImpersonateHtml}
                </section>

                <!-- Status / Notiser (Aggregated Messages) -->
                <section class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700 p-4 md:p-6 flex flex-col h-full">
                    <h2 class="text-lg md:text-xl font-semibold mb-4 flex items-center gap-2 dark:text-gray-100">
                        📬 ${t('messages')}
                        <span id="msg-badge" class="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100 text-xs font-bold px-2 py-0.5 rounded-full hidden">0</span>
                    </h2>
                    <div id="aggregated-messages" class="flex-1 overflow-y-auto max-h-[300px] md:max-h-[400px] space-y-3 pr-1 custom-scrollbar">
                        <div class="text-center py-8 text-gray-400">
                           <div class="spinner mb-2"></div>
                           ${t('loading_messages')}
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
                renderDashboard(container, compId, startNo, userData);
            }
        }
    });

    cleanupPortalSubscriptions();

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
            if (currentLoadToken !== portalLoadToken) return;
            let allMsgs = [];

            for (const cid of uniqueCompIds) {
                const msgs = allMessagesMap.get(cid) || [];
                const claim = claims.find(c => c.competitionId === cid);
                const compName = claim?.competitionName || (await getDoc(doc(db, `artifacts/${appId}/public/data/competitions/${cid}`)).then(d => d.data()?.name)).catch(() => '') || cid;
                if (currentLoadToken !== portalLoadToken) return;

                // Filter for this user
                const relevant = msgs
                    .filter(m => isMessageVisibleToDriver(m, claim.startNumber))
                    .map(m => ({ ...m, _compName: compName, _compId: cid }));

                allMsgs = allMsgs.concat(relevant);
            }

            allMsgs = sortPortalItemsByTimestampDesc(allMsgs, 'timestamp');

            if (allMsgs.length === 0) {
                msgContainer.innerHTML = `<p class="text-gray-500 italic text-center py-8">${t('no_new_messages')}</p>`;
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
                const colorClass = isUrgent ? 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800' : 'bg-gray-50 border-gray-100 dark:bg-gray-700/50 dark:border-gray-600';
                const icon = isUrgent ? '⚠️' : '📢';
                const time = formatPortalTimestamp(m.timestamp, 'sv-SE', { dateStyle: 'short', timeStyle: 'short' });
                const compName = escapeHtml(m._compName || '');
                const title = escapeHtml(m.title || t('message_default_title'));
                const body = escapeHtml(m.body || m.message || '');
                const safeTime = escapeHtml(time || '');

                return `
                    <div class="p-4 rounded-lg border ${colorClass} relative group transition-all hover:shadow-sm animate-fade-in">
                        <div class="flex justify-between items-start mb-1">
                            <span class="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide bg-white dark:bg-gray-700 px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600">
                                ${compName}
                            </span>
                            <span class="text-xs text-gray-400 dark:text-gray-500 tabular-nums">${safeTime}</span>
                        </div>
                        <div class="flex gap-3 mt-2">
                             <div class="text-xl shrink-0 select-none">${icon}</div>
                             <div class="min-w-0">
                                <h4 class="font-bold text-gray-900 dark:text-gray-100 text-sm leading-tight mb-1">${title}</h4>
                                <p class="text-sm text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">${body}</p>
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
                        const isRelevant = isMessageVisibleToDriver(m, claim.startNumber);

                        if (isRelevant && !knownMsgIds.has(m.id)) {
                            // Toast!
                            showAlert(`${t('new_message_alert')}: ${m.title || ''}`, false);
                        }
                    });
                }

                msgs.forEach(m => knownMsgIds.add(m.id));
                renderAllMessages();
            });
            unsubs.push(u);
        });

        messageUnsub = () => unsubs.forEach(u => {
            try { if (typeof u === 'function') u(); } catch (err) { console.warn('Portal message cleanup failed:', err); }
        });

        // Initial grace period for "first load" to avoid spamming existing messages
        setTimeout(() => { isFirstLoad = false; }, 2000);
    }

    document.getElementById('manualSyncBtn')?.addEventListener('click', async () => {
        const btn = document.getElementById('manualSyncBtn');
        const origText = btn.textContent;
        btn.textContent = t('syncing');
        btn.disabled = true;
        try {
            await autoClaimEquipages(user);
            showAlert(t('sync_success'), true);
            setTimeout(() => {
                location.reload();
            }, 1500);
        } catch (err) {
            console.error(err);
            showAlert(t('sync_fail'), false);
            btn.textContent = origText;
            btn.disabled = false;
        }
    });

    document.getElementById('joinAsAdminBtn')?.addEventListener('click', () => {
        const modal = document.createElement('div');
        modal.className = "fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-fade-in";
        modal.innerHTML = `
        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col transform transition-all scale-100">
            <div class="p-5 border-b dark:border-gray-700 bg-blue-50 dark:bg-blue-900/30 flex justify-between items-center">
                <h3 class="font-bold text-lg text-blue-900 dark:text-blue-100">🔐 Ange Funktionärskod</h3>
                <button id="closePinModal" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-2xl leading-none">&times;</button>
            </div>
            <div class="p-6">
                <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">Ange den 6-siffriga koden du fått av arrangören för att låsa upp funktionärs-rättigheter.</p>
                <div class="space-y-4">
                    <div>
                        <label class="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1 uppercase">Tävlings-ID (Finns i URLen)</label>
                        <input type="text" id="pinCompId" class="w-full border rounded-md p-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500" placeholder="t.ex. my-competition-2026">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1 uppercase">PIN-kod</label>
                        <input type="text" id="pinCodeInput" class="w-full border rounded-md p-3 text-center text-2xl tracking-widest font-mono font-bold dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500" maxlength="6" placeholder="000000">
                    </div>
                </div>
            </div>
            <div class="p-4 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 flex justify-end">
                <button id="submitPinBtn" class="px-6 py-2 bg-brand-darkblue text-white font-bold rounded shadow hover:bg-brand-gold hover:text-brand-darkblue transition-colors w-full">${t('unlock')}</button>
            </div>
        </div>
        `;
        document.body.appendChild(modal);

        // Autofill CompID if available in URL hash #portal/compId ? Wait, we don't know it. But usually users just copy paste. 
        // Better yet, if they already clicked on a comp card before, we could pre-fill it.
        const currentComp = getGlobalState('currentCompetition');
        if (currentComp && currentComp.id) {
            modal.querySelector('#pinCompId').value = currentComp.id;
        }

        modal.querySelector('#closePinModal').onclick = () => modal.remove();
        modal.querySelector('#submitPinBtn').onclick = async () => {
            const btn = modal.querySelector('#submitPinBtn');
            const compId = modal.querySelector('#pinCompId').value.trim();
            const pin = modal.querySelector('#pinCodeInput').value.trim();

            if (!compId || !pin) {
                showAlert('Fyll i både Tävlings-ID och PIN-kod.', false);
                return;
            }

            btn.disabled = true;
            btn.textContent = 'Verifierar...';

            try {
                const joinedRole = await joinCompetitionAsAdmin(compId, pin, user);
                const roleLabels = { admin: t('secretariat'), dressage: t('dressage_role'), marathon: t('marathon_role'), precision: 'Precision', speaker: 'Speaker' };
                const roleStr = roleLabels[joinedRole] || joinedRole;
                showAlert(`Rättigheter beviljade (${roleStr})! Synkroniserar...`, true);
                modal.remove();
                
                // Kör autoClaimEquipages för att uppdatera användarens roller lokalt i firestore users dokumentet (claims)
                await autoClaimEquipages(user);
                
                // Sätt aktiv tävling så att de slipper gå via Hubben
                try {
                    const compDoc = await getDoc(doc(db, `artifacts/${appId}/public/data/competitions/${compId}`));
                    if (compDoc.exists()) {
                        setGlobalState({
                            key: 'currentCompetition',
                            value: { id: compId, name: compDoc.data().name || compId }
                        });
                    }
                } catch(e) {}

                setTimeout(() => location.reload(), 1500);
            } catch (err) {
                console.error(err);
                showAlert(err.message || 'Fel PIN-kod eller Tävlings-ID.', false);
                btn.disabled = false;
                btn.textContent = t('unlock');
            }
        };
    });

    document.getElementById('adminImpersonateBtn')?.addEventListener('click', () => {
        const cid = document.getElementById('adminImpersonateCompId').value.trim();
        const sno = document.getElementById('adminImpersonateStartNo').value.trim();
        if (cid && sno) {
            setGlobalState({ key: 'currentCompetition', value: { id: cid, name: 'Admin Impersonation' } });
            renderDashboard(container, cid, sno, userData);
        } else {
            showAlert('Fyll i både Tävlings-ID och Startnummer', false);
        }
    });

    const currentComp = getGlobalState('currentCompetition');

    if (currentComp && claims.some(c => c.competitionId === currentComp.id)) {
        const claim = claims.find(c => c.competitionId === currentComp.id);
        if (claim) {
            renderDashboard(container, claim.competitionId, claim.startNumber, userData);
            return;
        }
    }
}

async function renderDashboard(container, compId, startNumber, user) {
    cleanupPortalSubscriptions();
    const dashboardUnsubs = [];

    container.innerHTML = `
        <div class="container mx-auto p-2 md:p-8 animate-fade-in">
            <button id="backToPortalBtn" class="mb-4 text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1 font-medium">
                ← ${t('back_to_comps')}
            </button>
            <div id="dashboard-header" class="mb-4 md:mb-6 bg-white dark:bg-gray-800 p-3 sm:p-4 md:p-6 rounded-xl shadow-sm border dark:border-gray-700">
                <div class="animate-pulse h-16 bg-gray-100 rounded"></div>
            </div>
            
            <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700 overflow-hidden min-h-[500px]">
                <div id="dash-tabs" class="flex border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 overflow-x-auto no-scrollbar scroll-smooth">
                    <!-- Tabs injects here -->
                </div>
                <div id="dash-content" class="p-3 sm:p-4 md:p-6">
                    <div class="text-center py-12 text-gray-400">${t('loading_data')}</div>   
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
            privateEquipage,
            marathonTiming,
            marathonConfig,
            precisionConfig,
            precisionResult,
            startTimes,
            horseTemperatureConfigRaw,
            dressyrProgramMapping,
            dressageProtocols,
            _clubLogos,
            documents,
            messages,
            officials,
            judges
        ] = await Promise.all([
            getDoc(doc(db, `artifacts/${appId}/public/data/competitions/${compId}`)).then(d => d.data()),
            getComputedResultForEquipage(compId, startNumber),
            getEquipages(compId),
            getEquipagePrivateData(compId, startNumber).catch(() => null),
            getMarathonTimingForEquipage(compId, startNumber).catch(() => ({})),
            getConfig(compId, 'maratonConfig').catch(() => ({})),
            getConfig(compId, 'precisionConfig').catch(() => ({})),
            getPrecisionResultForEquipage(compId, startNumber).catch(() => null),
            getConfig(compId, 'startTimes').catch(() => ({ times: {} })),
            getConfig(compId, 'horseTemperature').catch(() => ({})),
            getConfig(compId, 'dressyrProgramMapping').catch(() => ({})),
            getDressageResultsForEquipage(compId, startNumber).catch(() => []),
            ensureClubLogosLoaded(),
            getCompetitionDocuments(compId).catch(() => []),
            getCompetitionMessages(compId).catch(() => []),
            getOfficials(compId).catch(() => []),
            getJudges(compId).catch(() => [])
        ]);

        const allJudges = [...(judges || []), ...(officials || [])];
        const portalStartTimes = normalizePortalStartTimesConfig(startTimes);
        const horseTemperatureConfig = normalizeHorseTemperatureConfig(horseTemperatureConfigRaw);
        const horseTemperatureSlots = buildHorseTemperatureSlots(compConfig?.dates, horseTemperatureConfig);

        const eq = equipages.find(e => String(e.startNumber) === String(startNumber)) || {};
        const canSelfEdit = canSelfServiceEditEquipage(user, eq, privateEquipage);
        const isAdminUser = user?.role === 'admin' || user?.role === 'superadmin';
        const canEditTemperatures = canSelfEdit || isAdminUser;
        const selfServiceRestrictionMessage = canSelfEdit ? '' : getSelfServiceRestrictionMessage(user, eq, privateEquipage);
        const r = computedRes || {};
        const allPrograms = getPrograms();
        const programKey = dressyrProgramMapping[eq.className] || guessProgramKeyFromClass(eq.className, allPrograms);

        let calculatedDressagePenalty = null;
        const computedDressagePenalty = r.dressage?.totalPenalty ?? r.dressage?.penalty;
        if (computedDressagePenalty == null && dressageProtocols?.length) {
            const allPrograms = getPrograms();
            const result = calculateDressageResult(eq, dressageProtocols, allJudges, allPrograms);
            if (result && result.penalty != null) {
                calculatedDressagePenalty = result.penalty;
            }
        }
        const { dRes, mRes, pRes } = resolvePortalDisciplinePenalties({
            computedResult: r,
            dressagePenalty: calculatedDressagePenalty,
            marathonTiming,
            precisionResult
        });

        let totalShow = '—';
        totalShow = calculatePortalTotalPenaltyLabel([dRes, mRes, pRes], r.totalPenalty, { eliminated: r.isEliminated });
        const safeStartNumber = escapeHtml(String(startNumber ?? ''));
        const safeDriverName = escapeHtml(eq.driverName || r.driverName || 'Okänd kusk');
        const safeClassName = escapeHtml(eq.className || r.className || '');
        const safeClubName = escapeHtml(eq.clubName || '');
        const safeGroom = escapeHtml(eq.groom || '');
        const safeRestrictionMessage = escapeHtml(selfServiceRestrictionMessage || '');

        const headerEl = document.getElementById('dashboard-header');
        headerEl.innerHTML = `
            <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                   <h1 class="text-xl md:text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2 md:gap-3 flex-wrap">
                        <span class="bg-gray-900 dark:bg-gray-700 text-white text-base md:text-lg px-2 md:px-3 py-1 rounded-md whitespace-nowrap">#${safeStartNumber}</span>
                        <span class="break-all">${safeDriverName}</span>
                   </h1>
                   <div class="text-gray-600 dark:text-gray-400 mt-2 flex flex-wrap gap-2 items-center text-xs md:text-sm">
                        ${getFlagHtml(eq)} 
                        <span class="font-medium bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded text-gray-900 dark:text-gray-200">${safeClassName}</span>
                        <span class="text-gray-300 dark:text-gray-600 hidden md:inline">|</span>
                        <span class="flex items-center gap-1 w-full md:w-auto mt-1 md:mt-0">${getClubLogoHtml(eq)} ${safeClubName}</span>
                        ${eq.groom ? `<span class="text-gray-300 dark:text-gray-600 hidden md:inline">|</span><span class="text-gray-500 dark:text-gray-400 w-full md:w-auto mt-1 md:mt-0">Groom: ${safeGroom}</span>` : ''}
                   </div>
                </div>
                <div class="text-left md:text-right w-full md:w-auto bg-gray-50 dark:bg-gray-800/50 md:bg-transparent p-3 md:p-0 rounded-lg mt-2 md:mt-0 flex flex-col items-end gap-2">
                    <div id="lang-toggle-container"></div>
                    <div>
                        <div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider font-medium">${t('total_penalty', compConfig?.isInternational)}</div>
                        <div class="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-white tabular-nums">${totalShow}</div>
                    </div>
                </div>
            </div>
        `;

        // Inject Language Toggle
        const langContainer = headerEl.querySelector('#lang-toggle-container');
        if (langContainer) {
            import('../../ui/languageToggle.js').then(mod => {
                mod.renderLanguageToggle(langContainer);
            });
        }

        const renderMessagesSection = () => {
            if (!messages || messages.length === 0) return '';

            const filtered = messages.filter(msg => isMessageVisibleToDriver(msg, startNumber));

            if (filtered.length === 0) return '';

            return `
                <div id="messages-container" class="mb-6 max-h-60 overflow-y-auto space-y-3 pr-1 custom-scrollbar">
                    ${filtered.map(msg => {
                const isUrgent = msg.severity === 'urgent' || msg.type === 'alert';
                const colorClass = isUrgent ? 'bg-red-50 border-red-200 text-red-900' : 'bg-blue-50 border-blue-200 text-blue-900';
                const icon = isUrgent ? '⚠️' : '📢';
                const time = formatPortalTimestamp(msg.timestamp, 'sv-SE', { dateStyle: 'short', timeStyle: 'short' });

                return `
                        <div class="p-4 rounded-lg border ${colorClass} flex gap-4 shadow-sm animate-fade-in relative z-10 w-full">
                            <div class="text-2xl pt-1">${icon}</div>
                            <div class="flex-1 min-w-0">
                                <div class="flex justify-between items-start mb-1 flex-wrap gap-2">
                                    <h4 class="font-bold text-sm md:text-base break-words">${escapeHtml(msg.title || 'Meddelande')}</h4>
                                    <span class="text-xs opacity-75 whitespace-nowrap">${escapeHtml(time || '')}</span>
                                </div>
                                <div class="text-sm opacity-90 leading-relaxed break-words">${escapeHtml(msg.body || msg.message || '')}</div>
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


        const ctx = {
            competitionId: compId,
            equipages: equipages,
            precisionConfig: precisionConfig,
            marathonConfig: marathonConfig,
            startTimes: portalStartTimes,
            allCompetitionJudges: allJudges
        };

        const formatTemperature = (value) => {
            const normalized = normalizeHorseTemperatureValue(value);
            return normalized === null ? '' : String(normalized).replace('.', ',');
        };

        const renderHorseTemperatureChart = (horseKey) => {
            if (!horseTemperatureSlots.length) return '';

            const values = horseTemperatureSlots.map((slot, index) => {
                const record = getHorseTemperatureRecord(eq, horseKey, slot.id);
                const temperature = normalizeHorseTemperatureValue(record?.temperatureC);
                if (temperature === null) return null;
                return { index, temperature };
            }).filter(Boolean);

            if (values.length < 2) {
                return '<div class="mt-3 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-center text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-900/30 dark:text-gray-400">Graf visas när minst två temperaturer är ifyllda.</div>';
            }

            const width = 320;
            const height = 110;
            const padX = 18;
            const padY = 18;
            const minValue = Math.min(...values.map(item => item.temperature), horseTemperatureConfig.warningTemperatureC ?? 37.0) - 0.3;
            const maxValue = Math.max(...values.map(item => item.temperature), horseTemperatureConfig.warningTemperatureC ?? 39.0) + 0.3;
            const span = Math.max(0.5, maxValue - minValue);
            const maxIndex = Math.max(1, horseTemperatureSlots.length - 1);
            const pointFor = (item) => {
                const x = padX + (item.index / maxIndex) * (width - padX * 2);
                const y = height - padY - ((item.temperature - minValue) / span) * (height - padY * 2);
                return `${x.toFixed(1)},${y.toFixed(1)}`;
            };
            const points = values.map(pointFor).join(' ');
            const warning = horseTemperatureConfig.warningTemperatureC;
            const warningLine = warning !== null
                ? (() => {
                    const y = height - padY - ((warning - minValue) / span) * (height - padY * 2);
                    return `<line x1="${padX}" y1="${y.toFixed(1)}" x2="${width - padX}" y2="${y.toFixed(1)}" stroke="#f97316" stroke-width="1.5" stroke-dasharray="4 4" />`;
                })()
                : '';

            return `
                <div class="mt-3 overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900/30">
                    <svg viewBox="0 0 ${width} ${height}" class="h-28 w-full" role="img" aria-label="Temperaturgraf">
                        <rect x="0" y="0" width="${width}" height="${height}" fill="currentColor" class="text-gray-50 dark:text-gray-900"></rect>
                        ${warningLine}
                        <polyline points="${points}" fill="none" stroke="#2563eb" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>
                        ${values.map(item => {
                const [x, y] = pointFor(item).split(',');
                return `<circle cx="${x}" cy="${y}" r="4" fill="#2563eb"></circle>`;
            }).join('')}
                    </svg>
                </div>
            `;
        };

        const renderHorseTemperatureSection = () => {
            if (!horseTemperatureConfig.enabled) return '';

            const horses = getTemperatureHorses(eq);
            const summary = summarizeHorseTemperatures(eq, compConfig?.dates, horseTemperatureConfig);
            const warningLimit = horseTemperatureConfig.warningTemperatureC;

            if (!horseTemperatureSlots.length) {
                return `
                    <div class="bg-white dark:bg-gray-800 rounded-lg border border-amber-200 dark:border-amber-800 p-4 md:p-6 shadow-sm col-span-1 md:col-span-2">
                        <h3 class="text-lg font-bold mb-2 text-gray-900 dark:text-white">Hästtemperatur</h3>
                        <p class="text-sm text-amber-800 dark:text-amber-200">Temperaturkontroll är aktiverad, men tävlingsdatum kunde inte tolkas. Kontrollera datum i hubben.</p>
                    </div>
                `;
            }

            if (!horses.length) {
                return `
                    <div class="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 md:p-6 shadow-sm col-span-1 md:col-span-2">
                        <h3 class="text-lg font-bold mb-2 text-gray-900 dark:text-white">Hästtemperatur</h3>
                        <p class="text-sm text-gray-600 dark:text-gray-400">Inga hästar finns registrerade på ekipaget.</p>
                    </div>
                `;
            }

            const statusClass = summary.complete
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100'
                : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100';
            const instruction = horseTemperatureConfig.instructions || 'Fyll i temperatur och tidpunkt för varje häst enligt arrangörens instruktion.';

            return `
                <div class="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 md:p-6 shadow-sm col-span-1 md:col-span-2">
                    <div class="flex flex-col gap-3 border-b pb-4 dark:border-gray-700 md:flex-row md:items-start md:justify-between">
                        <div>
                            <h3 class="text-lg font-bold text-gray-900 dark:text-white">Hästtemperatur</h3>
                            <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">${escapeHtml(instruction)}</p>
                            ${warningLimit !== null ? `<p class="mt-1 text-xs text-orange-700 dark:text-orange-300">Varning markeras från ${formatTemperature(warningLimit)} °C.</p>` : ''}
                        </div>
                        <span class="inline-flex self-start rounded-full px-3 py-1 text-sm font-bold ${statusClass}">
                            ${summary.completed}/${summary.total} ifyllda
                        </span>
                    </div>

                    ${!canEditTemperatures ? `
                    <div class="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                        ${safeRestrictionMessage}
                    </div>` : ''}
                    ${isAdminUser && !canSelfEdit ? `
                    <div class="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-100">
                        Adminläge: du kan hjälpa kusken att spara temperaturer. Övriga portaländringar är fortsatt låsta.
                    </div>` : ''}

                    <div class="mt-5 space-y-5">
                        ${horses.map((horse, horseIndex) => {
                const horseKey = horse._temperatureKey;
                const horseSummary = summary.horseSummaries.find(item => item.horseKey === horseKey);
                const highClass = horseSummary?.highCount
                    ? 'border-orange-300 bg-orange-50 dark:border-orange-800 dark:bg-orange-900/20'
                    : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/20';

                return `
                    <div class="rounded-xl border p-3 md:p-4 ${highClass}">
                        <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                            <div>
                                <h4 class="font-bold text-gray-900 dark:text-white">${escapeHtml(horse._temperatureName || `Häst ${horseIndex + 1}`)}</h4>
                                <div class="text-xs text-gray-500 dark:text-gray-400">${horseSummary?.completed || 0}/${horseTemperatureSlots.length} kontroller ifyllda</div>
                            </div>
                            ${horseSummary?.latest ? `<div class="text-sm font-semibold text-gray-800 dark:text-gray-100">Senaste: ${formatTemperature(horseSummary.latest.temperatureC)} °C</div>` : ''}
                        </div>

                        <div class="mt-3 grid gap-2">
                            ${horseTemperatureSlots.map(slot => {
                    const record = getHorseTemperatureRecord(eq, horseKey, slot.id);
                    const temperature = normalizeHorseTemperatureValue(record?.temperatureC);
                    const isHigh = warningLimit !== null && temperature !== null && temperature >= warningLimit;
                    const rowClass = isHigh
                        ? 'border-orange-300 bg-orange-100/70 dark:border-orange-800 dark:bg-orange-900/30'
                        : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800/70';
                    return `
                        <div class="horse-temp-row grid gap-2 rounded-lg border p-2 md:grid-cols-[minmax(130px,1fr)_150px_130px] md:items-center ${rowClass}"
                            data-horse-key="${escapeAttr(horseKey)}"
                            data-horse-name="${escapeAttr(horse._temperatureName || '')}"
                            data-slot-id="${escapeAttr(slot.id)}"
                            data-slot-label="${escapeAttr(slot.label)}"
                            data-default-taken-at="${escapeAttr(slot.defaultDateTime)}">
                            <div>
                                <div class="text-sm font-semibold text-gray-900 dark:text-white">${escapeHtml(slot.date)}</div>
                                <div class="text-xs text-gray-500 dark:text-gray-400">${escapeHtml(slot.periodLabel)}</div>
                            </div>
                            <input type="datetime-local" class="horse-temp-taken-at rounded border-gray-300 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white" value="${escapeAttr(record?.takenAt || slot.defaultDateTime)}" ${canEditTemperatures ? '' : 'disabled'}>
                            <div class="flex items-center gap-2">
                                <input type="text" inputmode="decimal" class="horse-temp-value w-full rounded border-gray-300 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white" placeholder="37,8" value="${escapeAttr(formatTemperature(temperature))}" ${canEditTemperatures ? '' : 'disabled'}>
                                <span class="text-sm text-gray-500 dark:text-gray-400">°C</span>
                            </div>
                        </div>
                    `;
                }).join('')}
                        </div>
                        ${renderHorseTemperatureChart(horseKey)}
                    </div>
                `;
            }).join('')}
                    </div>

                    <div class="mt-5 flex justify-end">
                        <button id="btnSaveHorseTemperatures" class="rounded bg-blue-600 px-5 py-2 text-sm font-bold text-white shadow hover:bg-blue-700 disabled:bg-gray-400" ${canEditTemperatures ? '' : 'disabled'}>
                            Spara temperaturer
                        </button>
                    </div>
                </div>
            `;
        };

        const attachHorseTemperatureHandlers = () => {
            const button = document.getElementById('btnSaveHorseTemperatures');
            if (!button) return;

            button.addEventListener('click', async () => {
                if (!canEditTemperatures) {
                    showAlert(selfServiceRestrictionMessage, false);
                    return;
                }

                const rows = Array.from(document.querySelectorAll('.horse-temp-row'));
                const nextTemperatures = JSON.parse(JSON.stringify(eq.horseTemperatures || {}));
                const errors = [];
                const now = new Date().toISOString();

                rows.forEach(row => {
                    const horseKey = row.dataset.horseKey;
                    const slotId = row.dataset.slotId;
                    if (!horseKey || !slotId) return;

                    const valueRaw = row.querySelector('.horse-temp-value')?.value.trim() || '';
                    const takenAt = row.querySelector('.horse-temp-taken-at')?.value || row.dataset.defaultTakenAt || '';
                    nextTemperatures[horseKey] ||= {};

                    if (!valueRaw) {
                        nextTemperatures[horseKey][slotId] = null;
                        return;
                    }

                    const temperature = normalizeHorseTemperatureValue(valueRaw);
                    if (temperature === null || temperature < 35 || temperature > 42.5) {
                        errors.push(`${row.dataset.horseName || 'Häst'} ${row.dataset.slotLabel || ''}: ange en temperatur mellan 35,0 och 42,5.`);
                        return;
                    }

                    nextTemperatures[horseKey][slotId] = {
                        temperatureC: temperature,
                        takenAt,
                        slotId,
                        slotLabel: row.dataset.slotLabel || slotId,
                        horseKey,
                        horseName: row.dataset.horseName || '',
                        updatedAt: now,
                        updatedBy: user?.email || user?.uid || ''
                    };
                });

                if (errors.length) {
                    showAlert(errors.slice(0, 3).join('\n'), false);
                    return;
                }

                const oldText = button.textContent;
                button.disabled = true;
                button.textContent = 'Sparar...';

                try {
                    await saveEquipage(compId, startNumber, { horseTemperatures: nextTemperatures });
                    eq.horseTemperatures = nextTemperatures;
                    showAlert('Temperaturer sparade.', true);
                    renderInfo();
                } catch (error) {
                    console.error('Could not save horse temperatures', error);
                    showAlert('Kunde inte spara temperaturer.', false);
                    button.disabled = false;
                    button.textContent = oldText;
                }
            });
        };

        // State for config
        let compMeta = {}; // Initialize as empty to allow first render
        let activeTabId = 'info';

        const renderInfo = () => {
            // If compMeta is not loaded yet, default to safe open or cached defaults.
            // We no longer return early, so "Laddar data..." doesn't stick.

            contentEl.innerHTML = `
                <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div class="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 md:p-6 shadow-sm relative group">
                        <div class="flex justify-between items-center mb-4 border-b dark:border-gray-700 pb-2">
                            <h3 class="text-lg font-bold text-gray-900 dark:text-white">${t('equipage_info', compConfig?.isInternational)}</h3>
                            ${(() => {
                    const minutesToStart = getPortalMinutesToNextStart(portalStartTimes, startNumber) ?? 999;

                    if (compMeta.manualLockdown) {
                        return `<span class="text-xs font-bold text-red-600 bg-red-100 px-2 py-1 rounded" title="Sekretariatet har låst portalen">🔒 ${t('locked_manual', compConfig?.isInternational)}</span>`;
                    }

                    if (minutesToStart < (compMeta.lockdownMinutes ?? 60)) {
                        return `<span class="text-xs font-bold text-orange-600 bg-orange-100 px-2 py-1 rounded" title="Start om mindre än 1h">🔒 ${t('locked_time', compConfig?.isInternational)}</span>`;
                    }

                    if (!canSelfEdit) {
                        return `<span class="text-xs font-bold text-amber-700 bg-amber-100 px-2 py-1 rounded" title="${safeRestrictionMessage}">🔒 Endast sekretariat</span>`;
                    }

                    return `
                                <button id="btnEditDeclaration" class="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium flex items-center gap-1 bg-blue-50 dark:bg-blue-900/30 px-3 py-1 rounded-full transition-colors">
                                    ✏️ ${t('edit', compConfig?.isInternational)}
                                </button>`;
                })()}
                        </div>
                        <dl class="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
                            <dt class="text-gray-500 dark:text-gray-400">${t('driver', compConfig?.isInternational)}:</dt>
                            <dd class="font-medium text-gray-900 dark:text-white">${escapeHtml(eq.driverName || '-')}</dd>
                            
                            <dt class="text-gray-500 dark:text-gray-400">Groom:</dt>
                            <dd class="font-medium text-gray-900 dark:text-white">${escapeHtml(eq.groom || '-')}</dd>
                            
                            <dt class="text-gray-500 dark:text-gray-400">${t('carriage', compConfig?.isInternational)}:</dt>
                            <dd class="font-medium text-gray-900 dark:text-white">${escapeHtml(eq.carriage || '-')}</dd>

                            <dt class="text-gray-500 dark:text-gray-400">${t('startno', compConfig?.isInternational)}:</dt>
                            <dd class="font-medium text-gray-900 dark:text-white">#${safeStartNumber}</dd>
                            <dt class="text-gray-500 dark:text-gray-400">${t('class', compConfig?.isInternational)}:</dt>
                            <dd class="font-medium text-gray-900 dark:text-white">${escapeHtml(eq.className || '-')}</dd>
                            <dt class="text-gray-500 dark:text-gray-400">${t('club', compConfig?.isInternational)}:</dt>
                            <dd class="font-medium text-gray-900 dark:text-white flex items-center gap-2">
                                ${getClubLogoHtml(eq)} ${escapeHtml(eq.clubName || '-')}
                            </dd>
                        </dl>
                        ${!canSelfEdit ? `
                        <div class="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                            ${safeRestrictionMessage}
                        </div>` : ''}
                    </div>

                    <div class="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 md:p-6 shadow-sm">
                         <div class="flex justify-between items-center mb-4 border-b dark:border-gray-700 pb-2">
                            <h3 class="text-lg font-bold text-gray-900 dark:text-white">${t('horses', compConfig?.isInternational)}</h3>
                             <span class="text-xs text-gray-400 dark:text-gray-500">${t('edit_via_edit', compConfig?.isInternational)}</span>
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

                    if (horseList.length === 0) return `<div class="text-gray-400 italic">${t('no_horse_data', compConfig?.isInternational)}</div>`;

                    return horseList.map(h => `
                                    <div class="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                                        <div class="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-300 font-bold text-xs">H${h.idx}</div>
                                        <div>
                                            <div class="font-bold text-gray-900 dark:text-gray-100">${escapeHtml(h.name || '')}</div>
                                            <div class="text-xs text-gray-500 dark:text-gray-400">ID: ${escapeHtml(h.id || '-')}</div>
                                        </div>
                                    </div>
                                `).join('');
                })()}
                        </div>
                    </div>

                    <div class="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 md:p-6 shadow-sm col-span-1 md:col-span-2">
                        <h3 class="text-lg font-bold mb-4 border-b dark:border-gray-700 pb-2 text-gray-900 dark:text-white">${t('officials', compConfig?.isInternational)}</h3>
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
                                <div class="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded border dark:border-gray-700">
                                    <div class="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-700 dark:text-blue-300 font-bold shrink-0">
                                        ${(j.name || 'F').charAt(0)}
                                    </div>
                                    <div class="overflow-hidden">
                                        <div class="font-bold text-gray-900 dark:text-white text-sm truncate" title="${escapeAttr(j.name || '')}">${escapeHtml(j.name || '')}</div>
                                        <div class="text-xs text-gray-600 dark:text-gray-400 font-medium mb-1">${escapeHtml(roleStr)}</div>
                                        ${contactInfo ? `<div class="text-xs text-gray-400 dark:text-gray-500 truncate" title="${escapeAttr(contactInfo)}">${escapeHtml(contactInfo)}</div>` : ''}
                                    </div>
                                </div>`;
                }).join('') : `<div class="text-gray-500 italic">${t('no_officials_listed', compConfig?.isInternational)}</div>`}
                        </div>
                    </div>


                    <div class="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 md:p-6 shadow-sm col-span-1 md:col-span-2 border-l-4 ${(() => {
                    const s = (eq.status || 'anmäld');
                    if (s === 'besiktigad') return 'border-l-green-500';
                    if (s === 'ombesiktning') return 'border-l-yellow-500';
                    if (s === 'struken') return 'border-l-red-500';
                    return 'border-l-gray-300 dark:border-l-gray-600';
                })()}">
                        <h3 class="text-lg font-bold mb-2 flex items-center gap-2 text-gray-900 dark:text-white">
                             🩺 ${t('vet_check', compConfig?.isInternational)}
                        </h3>
                        <div class="flex items-center gap-3 mb-2">
                            <span class="text-sm font-medium text-gray-500 dark:text-gray-400">${t('status', compConfig?.isInternational)}:</span>
                            ${(() => {
                    const s = eq.status || 'anmäld';
                    const map = {
                        'anmäld': { t: t('waiting', compConfig?.isInternational), c: 'bg-gray-100 text-gray-800' },
                        'incheckad': { t: t('waiting_checked_in', compConfig?.isInternational), c: 'bg-blue-100 text-blue-800' },
                        'besiktigad': { t: t('approved', compConfig?.isInternational), c: 'bg-green-100 text-green-800' },
                        'ombesiktning': { t: t('reinspection', compConfig?.isInternational), c: 'bg-yellow-100 text-yellow-800' },
                        'struken': { t: t('withdrawn', compConfig?.isInternational), c: 'bg-red-100 text-red-800' }
                    };
                    const def = map['anmäld'];
                    const curr = map[s] || def;
                    return `<span class="px-2 py-1 rounded text-sm font-bold uppercase ${curr.c}">${curr.t}</span>`;
                })()}
                        </div>
                        ${eq.vetNotes ? `
                        <div class="mt-3 p-3 bg-red-50 dark:bg-red-900/20 rounded border border-red-100 dark:border-red-800">
                             <div class="text-xs font-bold text-red-800 dark:text-red-400 uppercase mb-1">${t('vet_note', compConfig?.isInternational)}:</div>
                             <p class="text-red-900 dark:text-red-200 text-sm">${eq.vetNotes}</p>
                        </div>` : ''}
                         ${eq.status === 'ombesiktning' ?
                    `<p class="text-sm text-yellow-800 dark:text-yellow-400 mt-2">${t('contact_secretariat', compConfig?.isInternational)}</p>` : ''}
                    </div>

                    ${renderHorseTemperatureSection()}

                    <!-- SPEAKER NOTES SECTION -->
                    <div class="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 md:p-6 shadow-sm col-span-1 md:col-span-2 border-l-4 border-l-yellow-400">
                        <h3 class="text-lg font-bold mb-2 flex items-center gap-2 text-gray-900 dark:text-white">
                            📢 ${t('speaker_notes', compConfig?.isInternational)}
                            <span class="text-xs font-normal bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-200 px-2 py-0.5 rounded-full">${t('new', compConfig?.isInternational)}</span>
                        </h3>
                        <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
                            ${t('speaker_notes_desc', compConfig?.isInternational)}
                        </p>
                        ${!canSelfEdit ? `
                        <div class="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                            ${selfServiceRestrictionMessage}
                        </div>` : ''}
                        <div class="flex flex-col gap-2">
                            <textarea id="portalSpeakerNotes" rows="4" class="w-full rounded border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60" placeholder="Skriv dina noteringar här..." ${canSelfEdit ? '' : 'disabled'}>${eq.speakerNotes || ''}</textarea>
                            <div class="flex justify-end">
                                <button id="btnSaveSpeakerNotes" class="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 px-6 rounded shadow-sm transition-colors text-sm" ${canSelfEdit ? '' : 'disabled'}>
                                    Spara Noteringar
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            attachHorseTemperatureHandlers();

            // === Edit Declaration Listener ===
            setTimeout(() => {
                const editBtn = document.getElementById('btnEditDeclaration');
                if (editBtn) {
                    editBtn.onclick = () => {
                        if (!canSelfEdit) {
                            showAlert(selfServiceRestrictionMessage, false);
                            return;
                        }
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
                                    <input type="text" id="editGroom" class="w-full border rounded p-2" value="${escapeAttr(eq.groom || '')}" placeholder="Namn på groom">
                                </div>
                                <div>
                                    <label class="block text-sm font-bold text-gray-700 mb-1">Vagn</label>
                                    <input type="text" id="editCarriage" class="w-full border rounded p-2" value="${escapeAttr(eq.carriage || '')}" placeholder="Fabrikat / Modell / Spårbredd">
                                </div>
                                <div class="bg-blue-50 p-4 rounded border border-blue-100">
                                    <label class="block text-sm font-bold text-blue-900 mb-2">Hästar (Max 5)</label>
                                    <div id="editHorseContainer" class="space-y-2"></div>
                                    <button id="addHorseBtn" class="mt-2 text-sm text-blue-600 font-medium hover:underline">+ Lägg till häst</button>
                                </div>
                                <div>
                                    <label class="block text-sm font-bold text-gray-700 mb-1">Klubb</label>
                                    <input type="text" id="editClub" class="w-full border rounded p-2" value="${escapeAttr(eq.clubName || '')}">
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
                                        <input type="text" class="w-full border rounded p-1 text-sm h-name" placeholder="Hästnamn" value="${escapeAttr(h.name || '')}">
                                        <input type="text" class="w-full border rounded p-1 text-xs h-id" placeholder="ID / Regnr" value="${escapeAttr(h.id || '')}">
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
                        if (!canSelfEdit) {
                            showAlert(selfServiceRestrictionMessage, false);
                            return;
                        }
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
            if (activeTabId === 'info') {
                renderInfo();
            }
        });
        dashboardUnsubs.push(configUnsub);
        dashboardUnsub = () => dashboardUnsubs.forEach(u => {
            try { if (typeof u === 'function') u(); } catch (err) { console.warn('Portal dashboard cleanup failed:', err); }
        });

        renderInfo();

        const renderDressage = async () => {
            contentEl.innerHTML = '<div class="text-center py-12"><div class="spinner"></div> Laddar dressyr...</div>';
            const programs = getPrograms();
            const program = programKey ? programs[programKey] : null;

            // 1. Clean Protocols
            const validProtocols = deduplicateAndFilterProtocols(dressageProtocols || [], allJudges || []);

            // 2. Final Aggregated Result
            const result = calculateDressageResult(eq, validProtocols, allJudges || [], programs);

            const data = {
                startNumber: String(startNumber),
                driverName: eq.driverName,
                clubName: eq.clubName,
                country: eq.country,
                testKey: programKey,
                className: eq.className,
                finalPercent: result.percent,
                finalPenalty: result.penalty,
                errorPoints: result.errorPoints,
                errorPenalty: result.errorPenalty,
                plac: r?.dressage?.plac,
                eliminated: result.eliminated || r.isEliminated,
                judges: {},
                __savedProtocols: validProtocols,
                __eq: eq
            };

            validProtocols.forEach(p => {
                let jid = p.judgeId || p.id || p.position;
                if (!jid) return;
                if (typeof jid === 'string' && jid.startsWith('judge_')) jid = jid.slice(6);

                const jr = calculateSingleJudgeDressageResult(p, program, eq);
                if (jr) {
                    const foundJ = allJudges.find(j => j.id === jid || j.id === `judge_${jid}`);
                    
                    // Robust Name extraction
                    let safeName = p.judgeName || p.name || (foundJ ? foundJ.name : null);
                    if (!safeName || safeName === jid || safeName.includes('-')) {
                        safeName = jid.charAt(0).toUpperCase() + jid.slice(1).replace(/-/g, ' '); 
                    }

                    // Robust Position extraction
                    let safePos = (p.position || p.judgePos || '').toUpperCase();
                    if (!safePos || safePos === '?') {
                        if (foundJ) {
                            if (foundJ.position) safePos = foundJ.position;
                            else if (Array.isArray(foundJ.roles)) {
                                const role = foundJ.roles.find(x => x && x.discipline === 'dressage');
                                if (role && role.position) safePos = role.position;
                            } else if (foundJ.disciplines && foundJ.disciplines.dressage) {
                                safePos = foundJ.disciplines.dressage;
                            }
                        }
                    }

                    data.judges[jid] = {
                        id: jid,
                        name: safeName,
                        position: safePos || '?',
                        movements: normalizeMovements(p.movements),
                        totalPoints: jr.points,
                        percent: jr.percent,
                        penalty: jr.penalty,
                        eliminated: jr.eliminated
                    };
                } else {
                }
            });

            const judgesList = Object.values(data.judges).filter(j => !!j.id);
            data.__judgesPresent = judgesList;


            const pdfCtx = {
                startNumber: startNumber,
                processedResultsRef: [data],
                providers: { getPrograms: () => getPrograms() }
            };

            renderDressageContent(contentEl, data, judgesList, program, pdfCtx, compConfig?.isInternational);
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
                ...storedObstacles,
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
            renderPrecisionContent(contentEl, eq, latest || {}, precisionConfig, portalStartTimes, equipages);
        };

        const renderDocuments = async () => {
            const visibleDocuments = (documents || []).filter(isDocumentVisibleToDriver);
            if (!visibleDocuments || visibleDocuments.length === 0) {
                contentEl.innerHTML = `
                    <div class="p-12 text-center text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 rounded-lg border dark:border-gray-700 border-dashed">
                        <div class="text-4xl mb-4">📄</div>
                        <h3 class="text-lg font-medium text-gray-900 dark:text-gray-100">${t('no_docs_title')}</h3>
                        <p>${t('no_docs_desc')}</p>
                    </div>
                 `;
                return;
            }

            contentEl.innerHTML = `
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-fade-in">
                    ${visibleDocuments.map(doc => {
                const icon = doc.type === 'startlist' ? '📋' : (doc.type === 'course' ? '🗺️' : '📄');
                const isHtml = doc.type === 'html';

                const wrapperStart = isHtml
                    ? `<button type="button" data-doc-id="${escapeAttr(doc.id || '')}" class="cursor-pointer block group h-full text-left w-full">`
                    : `<a href="${escapeAttr(sanitizePortalUrl(doc.url))}" target="_blank" rel="noopener noreferrer" class="block group no-underline h-full">`;
                const wrapperEnd = isHtml ? `</button>` : `</a>`;

                return `
                        ${wrapperStart}
                            <div class="bg-white dark:bg-gray-800 p-5 rounded-lg border dark:border-gray-700 shadow-sm hover:shadow-md hover:border-blue-300 dark:hover:border-blue-500 transition-all flex flex-col h-full relative overflow-hidden">
                                <div class="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                                    <span class="text-6xl">${icon}</span>
                                </div>
                                <div class="flex items-center gap-3 mb-3">
                                    <div class="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-900 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                                        ${icon}
                                    </div>
                                    <div>
                                        <h4 class="font-bold text-gray-900 dark:text-gray-100 group-hover:text-blue-700 dark:group-hover:text-blue-400 transition-colors">${escapeHtml(doc.title || t('doc_default_title'))}</h4>
                                        <span class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">${escapeHtml(doc.category || doc.type || t('file_default_cat'))}</span>
                                    </div>
                                </div>
                                <div class="mt-auto pt-3 border-t dark:border-gray-700 flex justify-between items-center text-sm text-gray-500 dark:text-gray-400">
                                    <span>${escapeHtml(formatPortalTimestamp(doc.uploadedAt || doc.timestamp, 'sv-SE', { dateStyle: 'short' }) || t('new'))}</span>
                                    <span class="group-hover:translate-x-1 transition-transform">${isHtml ? `${t('read_btn')} →` : `${t('open_btn')} →`}</span>
                                </div>
                            </div>
                        ${wrapperEnd}
                        `;
            }).join('')}
                </div>
             `;

            const openDocModal = (docId) => {
                const d = visibleDocuments.find(x => x.id === docId);
                if (!d) return;

                const modalHtml = `
                    <div class="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4" id="doc-modal-overlay">
                        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col animate-fade-in-up border dark:border-gray-700">
                            <div class="p-4 border-b dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-900/50 rounded-t-xl">
                                <h3 class="font-bold text-lg text-gray-900 dark:text-white">${escapeHtml(d.title || t('doc_default_title'))}</h3>
                                <button type="button" data-close-doc-modal class="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 text-2xl leading-none">&times;</button>
                            </div>
                            <div class="p-6 overflow-y-auto prose dark:prose-invert max-w-none text-gray-800 dark:text-gray-200">
                                ${d.content || `<p class="text-gray-500 italic">${t('no_content')}</p>`}
                            </div>
                            <div class="p-4 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 rounded-b-xl text-right">
                                <button type="button" data-close-doc-modal class="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded font-medium text-sm text-gray-800 dark:text-gray-200 transition">${t('close_btn')}</button>
                            </div>
                        </div>
                    </div>
                 `;
                const div = document.createElement('div');
                div.innerHTML = modalHtml;
                const modal = div.firstElementChild;
                modal.addEventListener('click', (event) => {
                    if (event.target === modal || event.target.closest('[data-close-doc-modal]')) {
                        modal.remove();
                    }
                });
                document.body.appendChild(modal);
            };

            contentEl.querySelectorAll('[data-doc-id]').forEach(button => {
                button.addEventListener('click', () => openDocModal(button.dataset.docId));
            });
        };

        const renderTotal = async () => {
            contentEl.innerHTML = `
                <div class="animate-fade-in max-w-2xl mx-auto">
                    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700 overflow-hidden">
                        <div class="bg-gray-900 dark:bg-gray-900 text-white p-4 md:p-6 text-center">
                            <h2 class="text-xs md:text-sm uppercase tracking-wider font-semibold opacity-75 mb-1">${t('total_penalty_title')}</h2>
                            <div class="text-4xl md:text-5xl font-extrabold tabular-nums">${totalShow}</div>
                        </div>
                        <div class="p-4 md:p-6">
                            <div class="space-y-3 md:space-y-4">
                                <!-- Dressyr -->
                                <div class="flex items-center justify-between p-3 md:p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-100 dark:border-gray-600">
                                    <div class="flex items-center gap-3">
                                        <div class="w-8 h-8 md:w-10 md:h-10 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-lg md:text-xl">🎩</div>
                                        <div>
                                            <div class="font-bold text-gray-900 dark:text-gray-100 text-sm md:text-base">${t('tab_dressage')}</div>
                                            <div class="text-[10px] md:text-xs text-gray-500 dark:text-gray-400">${t('penalty_points')}</div>
                                        </div>
                                    </div>
                                    <div class="text-lg md:text-xl font-bold font-mono ${getPortalPenaltyToneClass(dRes)}">
                                        ${formatPortalPenalty(dRes)}
                                    </div>
                                </div>

                                <!-- Maraton -->
                                <div class="flex items-center justify-between p-3 md:p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-100 dark:border-gray-600">
                                    <div class="flex items-center gap-3">
                                        <div class="w-8 h-8 md:w-10 md:h-10 rounded-full bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 flex items-center justify-center text-lg md:text-xl">⏱️</div>
                                        <div>
                                            <div class="font-bold text-gray-900 dark:text-gray-100 text-sm md:text-base">${t('tab_marathon')}</div>
                                            <div class="text-[10px] md:text-xs text-gray-500 dark:text-gray-400">${t('penalty_points')}</div>
                                        </div>
                                    </div>
                                    <div class="text-lg md:text-xl font-bold font-mono ${getPortalPenaltyToneClass(mRes)}">
                                        ${formatPortalPenalty(mRes)}
                                    </div>
                                </div>

                                <!-- Precision -->
                                <div class="flex items-center justify-between p-3 md:p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-100 dark:border-gray-600">
                                    <div class="flex items-center gap-3">
                                        <div class="w-8 h-8 md:w-10 md:h-10 rounded-full bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300 flex items-center justify-center">
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5 md:w-6 md:h-6 text-orange-600 dark:text-orange-400 fill-current">
                                                <path d="M12 2L4.5 19H19.5L12 2Z" fill="orange" stroke="orange" stroke-width="2" stroke-linejoin="round" />
                                                <path d="M4.5 19H19.5" stroke="black" stroke-width="2" />
                                            </svg>
                                        </div>
                                        <div>
                                            <div class="font-bold text-gray-900 dark:text-gray-100 text-sm md:text-base">${t('tab_precision')}</div>
                                            <div class="text-[10px] md:text-xs text-gray-500 dark:text-gray-400">${t('penalty_points')}</div>
                                        </div>
                                    </div>
                                    <div class="text-lg md:text-xl font-bold font-mono ${getPortalPenaltyToneClass(pRes)}">
                                        ${formatPortalPenalty(pRes)}
                                    </div>
                                </div>
                            </div>

                            <div class="mt-6 md:mt-8 pt-4 md:pt-6 border-t text-center">
                                <p class="text-xs md:text-sm text-gray-500 leading-relaxed">
                                    ${t('total_disclaimer')}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        };

        const tabs = [
            { id: 'info', label: `ℹ️ ${t('tab_info')}`, fn: renderInfo },
            { id: 'documents', label: `📄 ${t('tab_docs')}`, fn: renderDocuments },
            { id: 'dressage', label: `🎩 ${t('tab_dressage')}`, fn: renderDressage },
            { id: 'marathon', label: `⏱️ ${t('tab_marathon')}`, fn: renderMarathon },
            {
                id: 'precision', label: `
            <span class="flex items-center gap-1">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4 text-orange-500 fill-current">
                    <path d="M12 2L4.5 19H19.5L12 2Z" fill="orange" stroke="orange" stroke-width="2" stroke-linejoin="round" />
                    <path d="M4.5 19H19.5" stroke="black" stroke-width="2" />
                </svg>
        ${t('tab_precision')}
                </span>`, fn: renderPrecision
            },
            { id: 'total', label: `🏆 ${t('tab_total')}`, fn: renderTotal }
        ];

        tabsEl.innerHTML = tabs.map(t => `
            <button data-tab="${t.id}" class="px-6 py-4 text-sm font-bold text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 border-b-2 border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:outline-none transition-colors whitespace-nowrap flex items-center gap-2">
                ${t.label}
            </button>
            `).join('');

        const switchTab = (id) => {
            activeTabId = id;
            tabsEl.querySelectorAll('button').forEach(b => {
                const isActive = b.dataset.tab === id;
                b.classList.toggle('text-blue-600', isActive);
                b.classList.toggle('dark:text-blue-400', isActive);
                b.classList.toggle('border-blue-600', isActive);
                b.classList.toggle('text-gray-500', !isActive);
                b.classList.toggle('dark:text-gray-400', !isActive);
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
        container.innerHTML = `<div class="p-8 text-center text-red-600">Kunde inte ladda tävlingsdata: ${escapeHtml(err.message || '')}</div>`;
    }
}

function renderCompetitionList(claims) {
    if (!claims || claims.length === 0) {
        return `
            <div class="text-center py-8 bg-gray-50 dark:bg-gray-800/50 rounded-lg border dark:border-gray-700 border-dashed">
                <p class="text-gray-500 dark:text-gray-400 font-medium">${t('no_comps_linked')}</p>
            </div>
            `;
    }

    return `
            <div class="space-y-3">
                ${claims.map(c => `
                <div class="competition-card flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg border dark:border-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors cursor-pointer"
                     data-comp-id="${escapeAttr(c.competitionId || '')}"
                     data-comp-name="${escapeAttr(c.competitionName || '')}"
                     data-start-no="${escapeAttr(c.startNumber || '')}">
                    <div>
                        <div class="font-bold text-gray-900 dark:text-white">${escapeHtml(c.competitionName || '')}</div>
                        <div class="text-sm text-gray-600 dark:text-gray-400">Startnummer #${escapeHtml(String(c.startNumber || ''))}</div>
                    </div>
                    <div class="text-right">
                        <span class="text-xs bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300 px-2 py-1 rounded">${t('linked_badge')}</span>
                    </div>
                </div>
            `).join('')}
        </div>
            `;
}

export function __unload() {
    portalLoadToken++;
    cleanupPortalSubscriptions();
    const modal = document.getElementById('doc-modal-overlay');
    if (modal) modal.remove();
}
