import { initAuth } from './services/authService.js';
import { initRouter, navigateTo } from './services/navigationService.js';
import { showAlert } from './ui/components.js';
import { getCompetitionById } from './services/firestoreService.js';

// --- Global State Management ---
// Ett enkelt state-objekt för att hålla reda på den valda tävlingen.
const globalState = {
    currentCompetition: null,
    currentUser: null // Lägg till denna rad
};

// Exportera funktioner för att andra moduler ska kunna interagera med state.
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
        if (value) {
            compNavInfo.style.display = 'block';
            compNameEl.textContent = value.name;
        } else {
            compNavInfo.style.display = 'none';
            compNameEl.textContent = 'Ingen tävling vald';
        }
    }
}

export function getGlobalState(key) {
    return globalState[key];
}

// --- Behörighet: får användaren finalisera resultat? ---
export function canFinalize() {
    const role = (getGlobalState('currentUser')?.role) || 'publik';
    // Endast domare eller admin får finalisera
    return role === 'domare' || role === 'admin' || role === 'sekretariat';
}
// Gör även globalt tillgänglig för sidor som inte importerar
window.canFinalize = canFinalize;

// Gör showAlert globalt tillgänglig för enkelhetens skull, även om den är importerad
// Detta kan tas bort om alla anrop till showAlert flyttas till att vara importerade.
window.showAlert = showAlert;

// --- Applikationens Initiering ---
function initialize() {
    console.log("Applikationen initieras...");

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
    initAuth(() => {
        console.log("Autentisering klar. Startar router.");
        initRouter();

        // 🆕 Försök återställa senaste tävling + sida om ingen specifik hash önskas
        (async () => {
            const incomingHash = window.location.hash;
            const useStored = !incomingHash || incomingHash === '' || incomingHash === '#hub';

            if (useStored) {
                try {
                    const lastCompetitionId = localStorage.getItem('lastCompetitionId');
                    const lastPageId = localStorage.getItem('lastPageId') || '#hub';

                    if (lastCompetitionId) {
                        const comp = await getCompetitionById(lastCompetitionId);
                        if (comp) {
                            setGlobalState({ key: 'currentCompetition', value: comp });
                            navigateTo(lastPageId);
                            return; // klart
                        }
                    }
                } catch (_) {
                    // fallthrough till standardnavigeringen
                }
            }

            // Standard: följ URL-hashen
            navigateTo(window.location.hash);
            // 3. Navigera till senaste sida om ingen hash finns
            let targetHash = window.location.hash;
            if (!targetHash || targetHash === '#hub') {
                const lastPageKey = localStorage.getItem('lastPageKey');
                if (lastPageKey) {
                    targetHash = `#${lastPageKey}`;
                }
            }
            navigateTo(targetHash);
        })();
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

}

// Kör igång hela applikationen!
initialize();