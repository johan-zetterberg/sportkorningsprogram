import { getConfig, saveConfig, getCompetitionById, deleteCompetition, getEquipages } from '../services/firestoreService.js';
import { getGlobalState } from '../main.js';
import { showAlert } from '../ui/components.js';

let mapInstance = null;
let markerInstance = null;

export function getSettingsHtml() {
    return `
    <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
        
        <!-- TÄVLINGSTYP -->
        <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border dark:border-gray-700">
            <h2 class="text-2xl font-semibold mb-4 border-b dark:border-gray-700 pb-2 dark:text-white">Tävlingsnivå</h2>
            <div class="flex items-center justify-between">
                <div>
                    <p class="font-medium dark:text-gray-200">Internationell tävling (FEI)</p>
                    <p class="text-sm text-gray-500 dark:text-gray-400">Styr vilka kolumner och rubriker som visas samt vad som hamnar i PDF:en.</p>
                </div>
                <label class="inline-flex items-center cursor-pointer">
                    <input id="isInternationalToggle" type="checkbox" class="sr-only peer">
                    <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:bg-brand-darkblue dark:bg-gray-700 relative">
                        <span class="absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-all peer-checked:translate-x-5"></span>
                    </div>
                </label>
            </div>
            <div class="mt-3 text-sm text-gray-600 dark:text-gray-400" id="intlStatusHint"></div>
        </div>

        <!-- PUBLICERING START -->
        <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border dark:border-gray-700">
            <h2 class="text-2xl font-semibold mb-4 border-b dark:border-gray-700 pb-2 dark:text-white">Publicering</h2>
            <p class="text-sm text-gray-500 mb-4 dark:text-gray-400">Bestäm när tävlingen ska synas för allmänheten på startsidan.</p>
            
            <div class="flex items-center justify-between bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-100 dark:border-blue-800">
                <div>
                    <h3 class="font-bold text-gray-900 dark:text-white" id="publishStatusTitle">Utkast (Dold)</h3>
                    <p class="text-xs text-gray-600 dark:text-gray-300 mt-1" id="publishStatusDesc">Endast synlig för admins.</p>
                </div>
                <label class="inline-flex items-center cursor-pointer">
                    <input id="isPublishedToggle" type="checkbox" class="sr-only peer">
                    <div class="w-14 h-7 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:bg-green-600 dark:bg-gray-700 relative transition-colors">
                        <span class="absolute left-1 top-1 w-5 h-5 bg-white rounded-full transition-all peer-checked:translate-x-7 shadow-sm"></span>
                    </div>
                </label>
            </div>
            <p class="text-xs text-gray-400 mt-3">
              <i class="fas fa-info-circle"></i> 
              När reglaget är grönt syns tävlingen för alla besökare.
            </p>
        </div>
        <!-- PUBLICERING SLUT -->

        <!-- DIGITAL DEKLARERING -->
        <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border dark:border-gray-700">
            <h2 class="text-2xl font-semibold mb-4 border-b dark:border-gray-700 pb-2 dark:text-white">Digital Deklarering</h2>
            <p class="text-sm text-gray-500 mb-4 dark:text-gray-400">Styr när kuskar senast får ändra sina uppgifter (häst, vagn, groom) via "Min Portal".</p>
            
            <div class="mb-4">
                <label for="lockdownMinutesInput" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Låsändring (minuter innan start)</label>
                <div class="flex items-center gap-2 mt-1">
                    <input type="number" id="lockdownMinutesInput" class="block w-32 p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="60">
                    <span class="text-sm text-gray-500 dark:text-gray-400">minuter</span>
                </div>
                <p class="text-xs text-gray-500 mt-1 dark:text-gray-400">Standard: 60 minuter. Sätt till 0 för att alltid tillåta, eller ett högt värde för att låsa tidigare.</p>
            </div>

            <div class="flex items-center gap-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
                <input type="checkbox" id="manualLockdownCheckbox" class="h-5 w-5 text-red-600 rounded focus:ring-red-500 border-gray-300 dark:bg-gray-800 dark:border-gray-600">
                <div>
                    <label for="manualLockdownCheckbox" class="block font-bold text-red-800 dark:text-red-300">Lås alla ändringar NU</label>
                    <p class="text-xs text-red-600 dark:text-red-400">Kryssa i för att omedelbart stänga portalen för alla ändringar, oavsett tid.</p>
                </div>
            </div>
        </div>
        
        <!-- PLATS & KARTA -->
        <div class="md:col-span-2 bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border dark:border-gray-700">
            <h2 class="text-2xl font-semibold mb-4 border-b dark:border-gray-700 pb-2 dark:text-white">Plats & Karta</h2>
            <p class="text-sm text-gray-500 mb-4 dark:text-gray-400">Ange tävlingsplatsens exakta position. Detta visas för deltagare och publik i Info-modalen.</p>
            
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div class="md:col-span-1 space-y-4">
                     <div>
                        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Platsnamn</label>
                         <input type="text" id="settingsPlaceInput" class="mt-1 block w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:text-white" readonly title="Ändras via Hubben" placeholder="Laddar...">
                     </div>
                     <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase dark:text-gray-400">Latitud</label>
                        <input type="text" id="settingsLatInput" class="mt-1 block w-full p-2 border rounded-md font-mono text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" readonly>
                     </div>
                      <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase dark:text-gray-400">Longitud</label>
                        <input type="text" id="settingsLngInput" class="mt-1 block w-full p-2 border rounded-md font-mono text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" readonly>
                     </div>
                     <p class="text-xs text-gray-400 italic">Klicka på kartan för att flytta markören.</p>
                </div>
                <div class="md:col-span-2 h-80 bg-gray-100 dark:bg-gray-900 rounded-lg border dark:border-gray-700 relative z-0" id="settingsMapContainer"></div>
            </div>
        </div>

        <!-- KLASSINSTÄLLNINGAR -->
        <div class="md:col-span-2 bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border dark:border-gray-700">
            <h2 class="text-2xl font-semibold mb-4 border-b dark:border-gray-700 pb-2 dark:text-white">Klass-inställningar</h2>
            <p class="text-sm text-gray-500 mb-6 dark:text-gray-400">Bestäm hur många som ska placeras i varje klass. Systemet föreslår 1/4 (avrundat uppåt) som standard.</p>
            
            <div class="overflow-x-auto">
                <table class="min-w-full divide-y dark:divide-gray-700">
                    <thead>
                        <tr class="text-left text-xs font-bold text-gray-400 uppercase tracking-wider">
                            <th class="px-4 py-2">Klass</th>
                            <th class="px-4 py-2">Antal Startande</th>
                            <th class="px-4 py-2">Antal Placerade</th>
                        </tr>
                    </thead>
                    <tbody id="classSettingsTableBody" class="divide-y dark:divide-gray-700">
                        <!-- Injected via JS -->
                        <tr><td colspan="3" class="p-8 text-center text-gray-400 italic">Laddar klasser...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>

        <div class="md:col-span-2">
            <button id="saveGlobalSettingsBtn" class="px-6 py-3 bg-brand-darkblue text-white font-bold rounded-lg shadow hover:bg-brand-gold hover:text-brand-darkblue dark:bg-blue-600 dark:hover:bg-blue-500">
                Spara alla inställningar
            </button>
        </div>

        <!-- DANGER ZONE -->
        <div id="dangerZone" class="md:col-span-2 mt-12 bg-red-50 dark:bg-red-900/10 p-6 rounded-xl shadow-md border border-red-200 dark:border-red-900" style="display:none;">
            <h2 class="text-2xl font-bold text-red-800 dark:text-red-400 mb-4 border-b border-red-200 dark:border-red-800 pb-2">Danger Zone</h2>
            <p class="text-sm text-red-700 dark:text-red-300 mb-6 font-medium">
                Här kan du radera hela tävlingen permanent.
                Detta tar bort <strong>allt</strong>: inställningar, resultat, anmälda ekipage, funktionärer och loggar.
                <br><br>
                Detta går <u>inte</u> att ångra.
            </p>
            <button id="btnDeleteComp" class="px-5 py-3 bg-red-600 text-white font-bold rounded hover:bg-red-700 shadow-sm transition-colors flex items-center gap-2">
                Radera Tävling
            </button>
        </div>

    </div>
  `;
}

export async function setupSettingsLogic(competitionId) {
    try {
        const meta = await getConfig(competitionId, 'competitionMeta').catch(() => ({}));

        // --- 1. Basic Settings (Meta) ---
        // International Toggle
        const isInt = !!meta?.isInternational;
        const tgl = document.getElementById('isInternationalToggle');
        const hint = document.getElementById('intlStatusHint');

        if (tgl) tgl.checked = isInt;
        if (hint) hint.textContent = isInt ? 'Läge: Internationell (FEI).' : 'Läge: Nationell (SvRF).';

        if (tgl) {
            tgl.addEventListener('change', () => {
                const val = tgl.checked;
                if (hint) hint.textContent = val ? 'Läge: Internationell (FEI).' : 'Läge: Nationell (SvRF).';
            });
        }

        // Lockdown
        const ldInput = document.getElementById('lockdownMinutesInput');
        if (ldInput) {
            ldInput.value = (meta.lockdownMinutes !== undefined) ? meta.lockdownMinutes : 60;
        }
        const ldCheck = document.getElementById('manualLockdownCheckbox');
        if (ldCheck) {
            ldCheck.checked = !!meta.manualLockdown;
        }

        // --- 2. Map & Coordinates (From Config) ---
        // We fetch 'map' config. Fallback to competition doc 'coordinates' for migration/legacy.
        const mapConfig = await getConfig(competitionId, 'map').catch(() => ({}));
        const compDoc = await getCompetitionById(competitionId);

        let initialCoords = mapConfig.coordinates;
        if (!initialCoords && compDoc && compDoc.coordinates) {
            initialCoords = compDoc.coordinates;
        }

        if (compDoc) {
            document.getElementById('settingsPlaceInput').value = compDoc.place || '';
        }

        // --- 1.5 Publishing Status (Root Doc) ---
        // Defaults to TRUE if undefined (backward compatibility)
        const isPub = (compDoc.published !== false);
        const pubToggle = document.getElementById('isPublishedToggle');
        const pubTitle = document.getElementById('publishStatusTitle');
        const pubDesc = document.getElementById('publishStatusDesc');

        const updatePubUI = (published) => {
            if (pubTitle) pubTitle.textContent = published ? 'Publicerad (Synlig)' : 'Utkast (Dold)';
            if (pubTitle) pubTitle.className = published ? 'font-bold text-green-700 dark:text-green-400' : 'font-bold text-gray-600 dark:text-gray-300';
            if (pubDesc) pubDesc.textContent = published ? 'Tävlingen syns nu för alla.' : 'Endast synlig för admins.';
        };

        if (pubToggle) {
            pubToggle.checked = isPub;
            updatePubUI(isPub);

            pubToggle.addEventListener('change', async () => {
                const newState = pubToggle.checked;
                updatePubUI(newState);

                // Save immediately (separate from global save button to be responsive)
                try {
                    // Dynamic import to avoid circular dependency issues if any, though we imported deleteCompetition etc.
                    // We need updateCompetition from services.
                    const { updateCompetition } = await import('../services/firestoreService.js');
                    await updateCompetition(competitionId, { published: newState });

                    // Show small toast or just rely on toggle state
                    // showAlert(newState ? 'Tävlingen är nu publicerad.' : 'Tävlingen är nu dold.', true);
                } catch (err) {
                    console.error('Failed to toggle publish status:', err);
                    pubToggle.checked = !newState; // Revert
                    updatePubUI(!newState);
                    showAlert('Kunde inte ändra status.', false);
                }
            });
        }

        // Init Map
        initSettingsMap(initialCoords);

        // --- 3. Save Handler ---
        const btn = document.getElementById('saveGlobalSettingsBtn');
        if (btn) {
            btn.onclick = async () => {
                btn.textContent = 'Sparar...';
                btn.disabled = true;
                try {
                    // Meta
                    const newValIntl = !!document.getElementById('isInternationalToggle')?.checked;
                    const newValLock = Number(document.getElementById('lockdownMinutesInput')?.value ?? 60);
                    const newValManual = !!document.getElementById('manualLockdownCheckbox')?.checked;

                    // Coordinates
                    const lat = document.getElementById('settingsLatInput').value;
                    const lng = document.getElementById('settingsLngInput').value;
                    let newCoords = null;
                    if (lat && lng) {
                        newCoords = { lat: parseFloat(lat), lng: parseFloat(lng) };
                    }

                    // Class Settings
                    const classSettings = {};
                    document.querySelectorAll('#classSettingsTableBody tr').forEach(row => {
                        const className = row.dataset.className;
                        const input = row.querySelector('.placed-count-input');
                        if (className && input) {
                            const val = parseInt(input.value);
                            if (!isNaN(val)) {
                                classSettings[className] = { placedCount: val };
                            }
                        }
                    });

                    // Save Meta
                    await saveConfig(competitionId, 'competitionMeta', {
                        isInternational: newValIntl,
                        lockdownMinutes: newValLock,
                        manualLockdown: newValManual
                    });

                    // Save Class Settings
                    await saveConfig(competitionId, 'classSettings', classSettings);

                    // Save Coordinates to Config (Safe Path)
                    // We save to `config/map` as updating root document often fails due to permissions.
                    await saveConfig(competitionId, 'map', {
                        coordinates: newCoords,
                        updatedAt: new Date()
                    });

                    showAlert('Inställningar sparade! ✅', true);
                } catch (err) {
                    console.error(err);
                    showAlert('Kunde inte spara inställningar.', false);
                } finally {
                    btn.textContent = 'Spara alla inställningar';
                    btn.disabled = false;
                }
            };
        }

        // --- 4. Class Settings Logic ---
        const [equipages, classConfig] = await Promise.all([
            getEquipages(competitionId),
            getConfig(competitionId, 'classSettings').catch(() => ({}))
        ]);

        const tableBody = document.getElementById('classSettingsTableBody');
        if (tableBody && equipages) {
            const classes = [...new Set(equipages.map(e => e.className || 'Okänd'))].sort();
            
            tableBody.innerHTML = classes.map(cls => {
                const starters = equipages.filter(e => e.className === cls).length;
                const defaultPlaced = Math.ceil(starters / 4) || 1;
                const savedPlaced = classConfig[cls]?.placedCount;
                
                return `
                    <tr data-class-name="${cls}">
                        <td class="px-4 py-3 font-medium dark:text-white">${cls}</td>
                        <td class="px-4 py-3 text-gray-500 dark:text-gray-400">${starters}</td>
                        <td class="px-4 py-3">
                            <input type="number" min="1" step="1" 
                                class="placed-count-input w-20 p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" 
                                value="${savedPlaced ?? defaultPlaced}"
                                placeholder="${defaultPlaced}">
                        </td>
                    </tr>
                `;
            }).join('');
        }

    } catch (e) {
        console.warn('Kunde inte läsa/spara inställningar', e);
    }

    // --- DANGER ZONE LOGIC ---
    try {
        const currentUser = getGlobalState('currentUser');
        // Vi hämtar tävlingen igen för att vara säkra på att vi har senaste ägar-infon
        const comp = await getCompetitionById(competitionId);

        let isAllowed = false;
        if (currentUser) {
            if (currentUser.role === 'superadmin') isAllowed = true;
            if (comp && comp.createdBy && comp.createdBy === currentUser.uid) isAllowed = true;
        }

        if (isAllowed) {
            const dz = document.getElementById('dangerZone');
            if (dz) dz.style.display = 'block';

            document.getElementById('btnDeleteComp')?.addEventListener('click', async () => {
                if (confirm('⚠️ VARNING! ⚠️\n\nÄr du SÄKER på att du vill radera HELA tävlingen?\n\nDetta raderar ALLA resultat, ekipage och inställningar permanent.\nDet går INTE att ångra!')) {
                    const name = prompt(`För att bekräfta, skriv tävlingens exakta namn:\n"${comp.name}"`);
                    if (name === comp.name) {
                        try {
                            const btn = document.getElementById('btnDeleteComp');
                            btn.disabled = true;
                            btn.textContent = 'Raderar...';

                            await deleteCompetition(competitionId);

                            alert('Tävlingen har raderats.');
                            window.location.hash = '#hub';
                            window.location.reload();
                        } catch (err) {
                            console.error(err);
                            alert('Fel vid radering: ' + err.message);
                            const btn = document.getElementById('btnDeleteComp');
                            if (btn) {
                                btn.disabled = false;
                                btn.innerHTML = 'Radera Tävling';
                            }
                        }
                    } else {
                        if (name !== null) alert('Felaktigt namn. Radering avbruten.');
                    }
                }
            });
        }
    } catch (err) {
        console.warn('Error checking danger zone permissions:', err);
    }
}

export function refreshMap() {
    if (mapInstance && document.getElementById('settingsMapContainer')) {
        mapInstance.invalidateSize();
        if (markerInstance) {
            const ll = markerInstance.getLatLng();
            mapInstance.setView(ll, mapInstance.getZoom());
        }
    }
}

function initSettingsMap(startCoords) {
    const mapEl = document.getElementById('settingsMapContainer');
    if (!mapEl) return;

    // cleanup old if any (though usually full re-render)
    if (mapInstance) {
        mapInstance.remove();
        mapInstance = null;
        markerInstance = null;
    }

    const defaultLat = 62.0;
    const defaultLng = 15.0;
    const defaultZoom = 5;

    let initialPos = [defaultLat, defaultLng];
    let initialZoom = defaultZoom;

    if (startCoords && startCoords.lat && startCoords.lng) {
        initialPos = [startCoords.lat, startCoords.lng];
        initialZoom = 13;

        document.getElementById('settingsLatInput').value = startCoords.lat;
        document.getElementById('settingsLngInput').value = startCoords.lng;
    }

    mapInstance = L.map(mapEl).setView(initialPos, initialZoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapInstance);

    // Initial marker
    if (startCoords && startCoords.lat) {
        markerInstance = L.marker(initialPos).addTo(mapInstance);
    }

    // Click to move
    mapInstance.on('click', (e) => {
        const { lat, lng } = e.latlng;
        if (markerInstance) {
            markerInstance.setLatLng(e.latlng);
        } else {
            markerInstance = L.marker(e.latlng).addTo(mapInstance);
        }
        document.getElementById('settingsLatInput').value = lat;
        document.getElementById('settingsLngInput').value = lng;
    });

    // Fix render
    setTimeout(() => { mapInstance.invalidateSize(); }, 200);
}
