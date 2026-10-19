import { initAuth, recallRoles, rememberRoles, updateUIVisibility } from './services/authService.js';
import { initRouter, navigateTo } from './services/navigationService.js';
import { showAlert } from './ui/components.js';
import { getCompetitionById, getConfig } from './services/competitionService.js';
import { getJudges, getOfficials } from './services/adminService.js';
import { initLanguageToggle, setCompetitionLanguageContext, t } from './utils/i18n.js';
import { initTheme } from './services/themeService.js';
import './ui/syncQueue.js'; // Registers <sync-queue>
import { activateCompetitionSettings, installWindowSettingAccessors } from './services/competitionSettingsStore.js';

// window.klassProgramMapping, window.dressageJudgeMapping, ... read and write the
// active competition's settings (see competitionSettingsStore.js)
installWindowSettingAccessors();

// --- Global State Management ---
// Ett enkelt state-objekt för att hålla reda på den valda tävlingen.
const globalState = {
    currentCompetition: null,
    currentUser: null // Lägg till denna rad
};

import { db, appId } from './config/firebase-config.js';
import { installErrorReporter } from './utils/errorReporter.js';
import { installDomActions } from './utils/domActions.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Uncaught errors are reported (no personal data, see errorReportUtils.js)
installErrorReporter({ getCompetitionId: () => getGlobalState('currentCompetition')?.id || '' });

const adminRoleCache = new Map();
const emailRoleCache = new Map();
let roleRefreshInFlight = null;
let roleRefreshInFlightKey = '';

function normalizeEmail(value) {
    return String(value || '').toLowerCase().trim();
}

function normalizeRoleList(roles) {
    return [...new Set((Array.isArray(roles) ? roles : []).filter(Boolean))].sort();
}

function getRoleListSignature(roles) {
    return normalizeRoleList(roles).join('|');
}

function buildRoleContextKey(comp, user) {
    return [comp?.id || '', user?.uid || '', normalizeEmail(user?.email)].join('|');
}

async function fetchCompetitionEmailRoles(compId, email) {
    const normalizedEmail = normalizeEmail(email);
    if (!compId || !normalizedEmail) return [];

    const snap = await getDoc(doc(
        db,
        'artifacts',
        appId,
        'public',
        'data',
        'competitions',
        compId,
        'roleEmails',
        normalizedEmail
    ));
    if (!snap.exists()) return [];

    const data = snap.data() || {};
    if (Array.isArray(data.roles)) return data.roles;
    if (data.role) return [data.role];
    return [];
}

function applyCompetitionRoles(contextKey, roles) {
    const currentComp = globalState.currentCompetition;
    const currentUser = globalState.currentUser;
    if (!currentComp || !currentUser || buildRoleContextKey(currentComp, currentUser) !== contextKey) {
        return normalizeRoleList(roles);
    }

    const normalizedRoles = normalizeRoleList(roles);
    if (getRoleListSignature(currentUser.compRoles) !== getRoleListSignature(normalizedRoles)) {
        currentUser.compRoles = normalizedRoles;
        updateUIVisibility();
    }
    return normalizedRoles;
}

async function fetchCompetitionAdminRoles(compId, userId) {
    const snap = await getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'competitions', compId, 'admins', userId));
    if (!snap.exists()) return [];

    const data = snap.data();
    if (Array.isArray(data.roles)) return data.roles;
    if (data.role) return [data.role];
    return [];
}

// Exportera funktioner för att andra moduler ska kunna interagera med state.
export async function refreshUserCompRole() {
    const comp = globalState['currentCompetition'];
    const user = globalState['currentUser'];
    if (!user) return [];

    if (!comp || !user.uid) {
        if (getRoleListSignature(user.compRoles) !== '') {
            user.compRoles = [];
            updateUIVisibility();
        }
        return [];
    }

    const contextKey = buildRoleContextKey(comp, user);
    const cachedEmailRoles = emailRoleCache.get(contextKey);
    const cachedAdminRoles = adminRoleCache.get(contextKey);

    if (cachedEmailRoles && cachedAdminRoles) {
        return applyCompetitionRoles(contextKey, [...cachedEmailRoles, ...cachedAdminRoles]);
    }

    if (roleRefreshInFlight && roleRefreshInFlightKey === contextKey) {
        return roleRefreshInFlight;
    }

    roleRefreshInFlightKey = contextKey;
    roleRefreshInFlight = (async () => {
        let emailRoles = [];
        let adminRoles = [];
        try {
            [emailRoles, adminRoles] = await Promise.all([
                fetchCompetitionEmailRoles(comp.id, user.email),
                fetchCompetitionAdminRoles(comp.id, user.uid)
            ]);
            emailRoles = normalizeRoleList(emailRoles);
            adminRoles = normalizeRoleList(adminRoles);
            emailRoleCache.set(contextKey, emailRoles);
            adminRoleCache.set(contextKey, adminRoles);
            rememberRoles(`comp|${contextKey}`, [...emailRoles, ...adminRoles]);
        } catch (e) {
            console.warn("Could not fetch compRoles", e);
            // A reload without signal: the roles this device last saw here
            const noSignal = navigator.onLine === false || e?.code === 'unavailable';
            const remembered = noSignal ? recallRoles(`comp|${contextKey}`) : null;
            if (Array.isArray(remembered)) emailRoles = normalizeRoleList(remembered);
        }

        return applyCompetitionRoles(contextKey, [...emailRoles, ...adminRoles]);
    })().finally(() => {
        if (roleRefreshInFlightKey === contextKey) {
            roleRefreshInFlight = null;
            roleRefreshInFlightKey = '';
        }
    });

    return roleRefreshInFlight;
}

export function setGlobalState({ key, value }) {
    // Generell funktion för att sätta värden i globalState
    globalState[key] = value;

    // Specifik logik för när en tävling väljs
    if (key === 'currentCompetition') {
        setCompetitionLanguageContext(value);
        initLanguageToggle();
        updateNavigationTranslations();
        // A different competition: its result settings start empty (an update
        // of the same competition keeps them)
        activateCompetitionSettings(value?.id || null);
        try {
            if (value?.id) {
                localStorage.setItem('lastCompetitionId', value.id);
            }
        } catch (_) { }

        const compNavInfo = document.getElementById('competition-nav-info');
        const compNameEl = document.getElementById('active-comp-name');
        const infoBtn = document.getElementById('compInfoBtn'); // Get button

        if (value) {
            compNavInfo.style.display = 'flex'; // Changed to flex for alignment
            compNameEl.textContent = value.name;
            if (infoBtn) infoBtn.style.display = 'block'; // Show button
        } else {
            compNavInfo.style.display = 'none';
            compNameEl.textContent = 'Ingen tävling vald';
            if (infoBtn) infoBtn.style.display = 'none'; // Hide button
        }
        updateCompactPageContext();
    }

    // --- NYTT: Hämta tävlingsspecifik roll om tävling eller användare ändras ---
    if (key === 'currentCompetition' || key === 'currentUser') {
        refreshUserCompRole(); // Kör async i bakgrunden vid state-ändringar
    }
}

export function getGlobalState(key) {
    return globalState[key];
}

export function getCompetitionMode(comp = globalState.currentCompetition) {
    return comp?.competitionMode === 'field' ? 'field' : 'live';
}

export function isFieldMode(comp = globalState.currentCompetition) {
    return getCompetitionMode(comp) === 'field';
}

// --- Behörighet: får användaren finalisera resultat? ---
export function canFinalize() {
    const role = (getGlobalState('currentUser')?.role) || 'publik';
    // Endast domare, admin eller superadmin får finalisera
    return role === 'domare' || role === 'admin' || role === 'sekretariat' || role === 'superadmin';
}
// Gör även globalt tillgänglig för sidor som inte importerar
window.canFinalize = canFinalize;
window.getGlobalState = getGlobalState;
window.setGlobalState = setGlobalState;

export function updateNavigationTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (key) {
            const hasArrow = el.textContent.includes('▼');
            const translated = t(key);
            el.textContent = translated + (hasArrow ? ' ▼' : '');
        }
    });
}
window.updateNavigationTranslations = updateNavigationTranslations;

// Gör showAlert globalt tillgänglig för enkelhetens skull, även om den är importerad
// Detta kan tas bort om alla anrop till showAlert flyttas till att vara importerade.
window.showAlert = showAlert;

// --- Applikationens Initiering ---
function getRequestedCompetitionIdFromUrl() {
    try {
        const hashQuery = window.location.hash.split('?')[1] || '';
        const hashParams = new URLSearchParams(hashQuery);
        const hashId = hashParams.get('id');
        if (hashId) return hashId;

        const searchParams = new URLSearchParams(window.location.search || '');
        return searchParams.get('id');
    } catch {
        return null;
    }
}

function updateCompactPageContext() {
    const compEl = document.getElementById('mobile-page-context-comp');
    const titleEl = document.getElementById('mobile-page-context-title');
    if (!compEl || !titleEl) return;

    const activePage = document.querySelector('.page.active');
    const header = activePage?.querySelector('.competition-page-header');
    const currentComp = globalState.currentCompetition;

    const competitionName = header?.dataset.competitionName
        || currentComp?.name
        || '';
    const pageTitle = header?.dataset.pageTitle
        || '';

    compEl.textContent = competitionName;
    titleEl.textContent = pageTitle;
}

function initialize() {
    initLanguageToggle();
    initTheme();
    updateNavigationTranslations();

    // Sätt upp globala lyssnare för modaler
    const closeModalBtn = document.getElementById('closeModal');
    const detailsModal = document.getElementById('detailsModal');
    closeModalBtn.addEventListener('click', () => { detailsModal.style.display = 'none'; });
    window.addEventListener('click', (e) => {
        if (e.target == detailsModal) {
            detailsModal.style.display = 'none';
        }
    });

    window.updateCompactPageContext = updateCompactPageContext;
    const mainEl = document.querySelector('main');
    if (mainEl) {
        // Live pages write the DOM ~10 times a second: update at most once a frame
        let contextUpdateQueued = false;
        const observer = new MutationObserver(() => {
            if (contextUpdateQueued) return;
            contextUpdateQueued = true;
            requestAnimationFrame(() => {
                contextUpdateQueued = false;
                updateCompactPageContext();
            });
        });
        observer.observe(mainEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-competition-name', 'data-page-title'] });
    }

    // 🆕 Offline/Online-badge i nav
    (function wireNetworkBadge() {
        const el = document.getElementById('net-badge');
        if (!el) return;

        function render() {
            const offline = !navigator.onLine;
            const syncing = window.__isSyncing === true;

            if (offline) {
                el.style.display = 'inline-flex';
                el.style.background = '#444';
                el.textContent = 'Offline';
            } else if (syncing) {
                el.style.display = 'inline-flex';
                el.style.background = '#C2A145'; // Guld/Orange för synk
                el.textContent = 'Synkar...';
            } else {
                el.style.display = 'none';
            }

            document.documentElement.toggleAttribute('data-offline', offline);

            // Toggle Global Banner
            const banner = document.getElementById('offline-banner');
            if (banner) {
                if (offline) banner.classList.remove('hidden');
                else banner.classList.add('hidden');
            }
        }

        window.addEventListener('online', render);
        window.addEventListener('offline', render);

        // Exponera funktion för att uppdatera synk-status externt
        window.setSyncStatus = (isSyncing) => {
            window.__isSyncing = isSyncing;
            render();
        };

        render();
    })();

    // 1. Initiera autentiseringen. Vi skickar med en callback-funktion.
    initAuth(async () => {
        initRouter();

        // 1. Bestäm målsida (nuvarande URL, sparad sida eller hubben)
        let targetHash = window.location.hash;
        if (!targetHash || targetHash === '' || targetHash === '#hub') {
            targetHash = localStorage.getItem('lastPageId') || '#hub';
        }

        // 2. Återställ tävlingskontext om den saknas
        // Vi gör detta oavsett vilken sida man landar på, så att sub-sidor fungerar direkt vid reload.
        if (!getGlobalState('currentCompetition')) {
            try {
                const requestedCompetitionId = getRequestedCompetitionIdFromUrl();
                const fallbackCompetitionId = localStorage.getItem('lastCompetitionId');
                const competitionId = requestedCompetitionId || fallbackCompetitionId;
                if (competitionId) {
                    const comp = await getCompetitionById(competitionId);
                    if (comp) {
                        setGlobalState({ key: 'currentCompetition', value: comp });
                        await refreshUserCompRole(); // <--- Await roles before navigating
                    }
                }
            } catch (e) {
                console.warn('Kunde inte återställa senaste tävlingen:', e);
            }
        }

        // 3. Slutför navigering
        navigateTo(targetHash);
    });

    // Logik för att hantera dropdown-menyer i navigationen
    const dropdownToggles = document.querySelectorAll('.dropdown-toggle');

    dropdownToggles.forEach(toggle => {
        toggle.addEventListener('click', (event) => {
            event.stopPropagation(); // Förhindra att klicket stänger hela mobilmenyn direkt

            const dropdownMenu = toggle.nextElementSibling;

            // Stäng alla andra öppna dropdowns först
            document.querySelectorAll('.dropdown-menu').forEach(menu => {
                if (menu !== dropdownMenu) {
                    menu.classList.add('hidden');
                }
            });

            // Toggla sedan den aktuella dropdown-menyn
            dropdownMenu.classList.toggle('hidden');
        });
    });

    // Stäng alla dropdowns om man klickar någon annanstans på sidan
    window.addEventListener('click', (event) => {
        if (!event.target.closest('.dropdown-container')) {
            document.querySelectorAll('.dropdown-menu').forEach(menu => {
                menu.classList.add('hidden');
            });
        }
    });
    // 4. Sätt upp logik för mobilmenyn
    const menuToggle = document.getElementById('menu-toggle');
    const navLinksContainer = document.getElementById('nav-links');
    if (menuToggle) {
        menuToggle.setAttribute('aria-expanded', 'false');
        menuToggle.addEventListener('click', () => {
            navLinksContainer.classList.toggle('hidden');
            menuToggle.setAttribute('aria-expanded', String(!navLinksContainer.classList.contains('hidden')));
        });
    }

    // data-action handlers in rendered markup (no inline onclick: CSP)
    installDomActions();

    // Klickbara element som inte är knappar (role="button" data-kbd-click, t.ex.
    // klockor att trycka på för att ändra tid) går att använda med Enter och mellanslag
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const target = event.target;
        if (!(target instanceof HTMLElement) || !target.hasAttribute('data-kbd-click')) return;
        event.preventDefault();
        target.click();
    });

    if (navLinksContainer) {
        // Hitta ALLA länkar, även de i undermenyerna
        const navLinks = navLinksContainer.querySelectorAll('a.nav-link');

        navLinks.forEach(link => {
            link.addEventListener('click', () => {
                // ----> DENNA DEL ÄR TILLAGD <----
                // Stäng alla öppna dropdown-menyer först.
                document.querySelectorAll('.dropdown-menu').forEach(menu => {
                    menu.classList.add('hidden');
                });
                // --------------------------------

                // Stäng sedan hela mobilmenyn (om vi är i mobilläge)
                if (menuToggle && menuToggle.offsetParent !== null) {
                    navLinksContainer.classList.add('hidden');
                }
            });
        });
    }

    // 5. Setup Info Modal Logic
    const infoBtn = document.getElementById('compInfoBtn');
    const infoModal = document.getElementById('compInfoModal');
    const closeInfoModal = document.getElementById('closeCompInfoModal');
    let infoMapInstance = null;
    let infoMarkerInstance = null;

    // Loading State Helper
    const setElementText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };

    // Define globally to allow access from Hub cards
    // Define globally to allow access from Hub cards
    window.openCompetitionInfo = async (comp) => {
        if (!comp) return;

        // Ensure modal exists (if called before full init or if elements missing)
        const modal = document.getElementById('compInfoModal');
        if (!modal) return;

        // Populate Basic Info
        setElementText('infoModalTitle', comp.name || 'Namnlös tävling');
        setElementText('infoModalClub', comp.club || '');
        setElementText('infoModalDates', comp.dates || 'Datum ej satt');
        setElementText('infoModalPlace', comp.place || 'Plats ej angiven');

        // Reset Sections
        document.getElementById('infoModalOrganizerSection').classList.add('hidden');

        modal.classList.remove('hidden');

        // --- MAP LOGIC ---
        // New Layout: Map is in #infoMapColumn, Fallback Link is #infoFallbackMapLink
        const mapColumn = document.getElementById('infoMapColumn');
        const mapContainer = document.getElementById('infoMapContainer');
        const googleButton = document.getElementById('infoGoogleMapsButton');
        const fallbackLink = document.getElementById('infoFallbackMapLink');

        // Fetch coordinates from Config (Safe path) or fallback to root doc
        let coords = comp.coordinates || null;
        try {
            const mapConfig = await getConfig(comp.id, 'map');
            if (mapConfig && mapConfig.coordinates) {
                coords = mapConfig.coordinates;
            }
        } catch (e) { console.warn('Could not fetch map config', e); }

        // --- MAP RENDER (Leaflet) ---
        const hasLeaflet = typeof window.L !== 'undefined';

        if (mapContainer && mapColumn) {
            if (!hasLeaflet) {
                mapColumn.classList.add('hidden');
                if (googleButton && coords?.lat && coords?.lng) {
                    googleButton.href = `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`;
                }
                if (fallbackLink) {
                    const fallbackQuery = coords?.lat && coords?.lng
                        ? `${coords.lat},${coords.lng}`
                        : (comp.place ? `${comp.place}${comp.club ? ` ${comp.club}` : ''}` : '');
                    if (fallbackQuery) {
                        fallbackLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fallbackQuery)}`;
                        fallbackLink.classList.remove('hidden');
                    } else {
                        fallbackLink.classList.add('hidden');
                    }
                }
            } else if (!infoMapInstance) {
                try {
                    infoMapInstance = L.map(mapContainer, { zoomControl: false, attributionControl: false }).setView([62, 15], 5);
                    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(infoMapInstance);
                } catch (e) { console.warn("L init error", e); }
            }

            if (hasLeaflet && coords && coords.lat && coords.lng) {
                // SHOW MAP (Desktop Column)
                mapColumn.classList.remove('hidden');
                if (fallbackLink) fallbackLink.classList.add('hidden');

                if (googleButton) {
                    googleButton.href = `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`;
                }

                // Double-buffer resize to ensure layout is ready (transient modal animations)
                const triggerResize = () => {
                    if (infoMapInstance) {
                        infoMapInstance.invalidateSize();
                        // Ensure numerical coordinates
                        const lat = Number(coords.lat);
                        const lng = Number(coords.lng);
                        if (!isNaN(lat) && !isNaN(lng)) {
                            infoMapInstance.setView([lat, lng], 13);
                        }
                    }
                };

                requestAnimationFrame(triggerResize);
                setTimeout(triggerResize, 300); // Robust fallback for CSS transitions

                if (infoMarkerInstance) infoMapInstance.removeLayer(infoMarkerInstance);
                infoMarkerInstance = L.marker([coords.lat, coords.lng]).addTo(infoMapInstance);

            } else if (hasLeaflet) {
                // NO COORDINATES -> Hide Map Column, Show Fallback Link next to Place
                mapColumn.classList.add('hidden');

                if (comp.place && fallbackLink) {
                    const q = encodeURIComponent(comp.place + (comp.club ? ` ${comp.club}` : ''));
                    fallbackLink.href = `https://www.google.com/maps/search/?api=1&query=${q}`;
                    fallbackLink.classList.remove('hidden');
                } else {
                    if (fallbackLink) fallbackLink.classList.add('hidden');
                }
            }
        }

        // --- FETCH DETAILS (Organizer Only) ---
        try {
            // 1. Organizer from eqentriesImport config
            const importConfig = await getConfig(comp.id, 'eqentriesImport');
            if (importConfig && importConfig.importedCompetitionInfo) {
                const info = importConfig.importedCompetitionInfo;
                if (info.organizer) {
                    setElementText('infoModalOrgName', info.organizer);
                    setElementText('infoModalOrgCity', info.city ? `${info.zipCode || ''} ${info.city}` : '');
                    setElementText('infoModalOrgContact', [info.phone, info.email].filter(Boolean).join(' • '));
                    document.getElementById('infoModalOrganizerSection').classList.remove('hidden');
                }
            }

        } catch (e) {
            console.warn("Could not fetch competition details for modal:", e);
        }
    };

    if (infoBtn) {
        infoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const comp = getGlobalState('currentCompetition');
            if (comp) window.openCompetitionInfo(comp);
        });
    }

    // Close handlers
    const hide = () => {
        const modal = document.getElementById('compInfoModal');
        if (modal) modal.classList.add('hidden');
    };

    if (closeInfoModal) closeInfoModal.addEventListener('click', hide);
    // Listen on document/window for closure if modal variable isn't captured perfectly in all scopes
    const modalRef = document.getElementById('compInfoModal');
    if (modalRef) {
        modalRef.addEventListener('click', (e) => {
            if (e.target === modalRef) hide();
        });
    }

}

// Kör igång hela applikationen!
initialize();
