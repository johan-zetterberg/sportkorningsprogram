import { initAuth, updateUIVisibility } from './services/authService.js';
import { initRouter, navigateTo } from './services/navigationService.js';
import { showAlert } from './ui/components.js';
import { getCompetitionById, getConfig, getJudges, getOfficials } from './services/firestoreService.js';
import { initLanguageToggle, t } from './utils/i18n.js';
import { initTheme } from './services/themeService.js';
import './ui/syncQueue.js'; // Registers <sync-queue>

// --- Global State Management ---
// Ett enkelt state-objekt för att hålla reda på den valda tävlingen.
const globalState = {
    currentCompetition: null,
    currentUser: null // Lägg till denna rad
};

import { db, appId } from './config/firebase-config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Exportera funktioner för att andra moduler ska kunna interagera med state.
export async function refreshUserCompRole() {
    const comp = globalState['currentCompetition'];
    const user = globalState['currentUser'];
    if (!comp || !user || !user.uid) return;

    let compRoles = [];

    // 1. Check direct arrays on comp document
    const email = (user.email || '').toLowerCase();
    if (email) {
        if (comp.adminEmails?.map(e=>e.toLowerCase()).includes(email)) compRoles.push('admin');
        if (comp.speakerEmails?.map(e=>e.toLowerCase()).includes(email)) compRoles.push('speaker');
        if (comp.dressageEmails?.map(e=>e.toLowerCase()).includes(email)) compRoles.push('dressage');
        if (comp.marathonEmails?.map(e=>e.toLowerCase()).includes(email)) compRoles.push('marathon');
        if (comp.precisionEmails?.map(e=>e.toLowerCase()).includes(email)) compRoles.push('precision');
    }

    // 2. Check admins subcollection
    try {
        const snap = await getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'competitions', comp.id, 'admins', user.uid));
        if (snap.exists()) {
            const data = snap.data();
            if (Array.isArray(data.roles)) {
                compRoles.push(...data.roles);
            } else if (data.role) {
                compRoles.push(data.role);
            }
        }
    } catch (e) {
        console.warn("Could not fetch compRoles", e);
    }

    // Deduplicate and assign
    user.compRoles = [...new Set(compRoles)];
    updateUIVisibility();
}

export function setGlobalState({ key, value }) {
    // Generell funktion för att sätta värden i globalState
    globalState[key] = value;

    // Specifik logik för när en tävling väljs
    if (key === 'currentCompetition') {
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
    }

    // --- NYTT: Hämta tävlingsspecifik roll om tävling eller användare ändras ---
    if (key === 'currentCompetition' || key === 'currentUser') {
        refreshUserCompRole(); // Kör async i bakgrunden vid state-ändringar
    }
}

export function getGlobalState(key) {
    return globalState[key];
}

// --- Behörighet: får användaren finalisera resultat? ---
export function canFinalize() {
    const role = (getGlobalState('currentUser')?.role) || 'publik';
    // Endast domare, admin eller superadmin får finalisera
    return role === 'domare' || role === 'admin' || role === 'sekretariat' || role === 'superadmin';
}
// Gör även globalt tillgänglig för sidor som inte importerar
window.canFinalize = canFinalize;

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

    // 🆕 SÄKERHETSNÄT: ge kända live/publiceringsknappar class="needs-online"
    (function markKnownOnlineOnlyButtons() {
        const ids = ['startLivestreamBtn', 'stopLivestreamBtn', 'publishLiveBtn', 'toggleLivestreamBtn'];

        function apply() {
            ids.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.classList.add('needs-online');
            });
        }

        // kör direkt om de redan finns
        apply();

        // körs när nya noder läggs in (t.ex. efter sidbyte/render)
        const mo = new MutationObserver(() => apply());
        if (document.body) {
            mo.observe(document.body, { childList: true, subtree: true });
        }

        // kör även vid hash-bytet (navigering i din router)
        window.addEventListener('hashchange', apply);
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
                const lastCompetitionId = localStorage.getItem('lastCompetitionId');
                if (lastCompetitionId) {
                    const comp = await getCompetitionById(lastCompetitionId);
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
        menuToggle.addEventListener('click', () => {
            navLinksContainer.classList.toggle('hidden');
        });
    }

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

        if (mapContainer && mapColumn) {
            if (!infoMapInstance) {
                try {
                    infoMapInstance = L.map(mapContainer, { zoomControl: false, attributionControl: false }).setView([62, 15], 5);
                    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(infoMapInstance);
                } catch (e) { console.warn("L init error", e); }
            }

            if (coords && coords.lat && coords.lng) {
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

            } else {
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