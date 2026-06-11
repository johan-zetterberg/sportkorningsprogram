import { getConfig } from '../../services/competitionService.js';
import { saveConfig } from '../../services/competitionService.js';
import { getCompetitionById, deleteCompetition, updateCompetition } from '../../services/competitionService.js';
import { getSecretConfig, saveSecretConfig, listenForCompetitionAdmins, deleteCompetitionAdmin } from '../../services/adminService.js';
import { getEquipages } from '../../services/equipageService.js';
import { uploadCompetitionLogo } from '../../services/storageService.js';
import { getGlobalState, setGlobalState } from '../../main.js';
import { showAlert } from '../../ui/components.js';
import { escapeHtml } from '../../utils/sharedUtils.js';
import { getCompetitionLogoUrl, getCompetitionLogoName } from '../../utils/competitionLogo.js';
import { t } from '../../utils/i18n.js';

let mapInstance = null;
let markerInstance = null;
let activeAdminsUnsub = null;

export function unloadSettingsTab() {
    if (activeAdminsUnsub) {
        try {
            activeAdminsUnsub();
        } catch (error) {
            console.warn('Kunde inte stoppa installnings-lyssnare:', error);
        }
        activeAdminsUnsub = null;
    }

    if (mapInstance) {
        try {
            mapInstance.remove();
        } catch (error) {
            console.warn('Kunde inte ta bort installningskarta:', error);
        }
        mapInstance = null;
        markerInstance = null;
    }
}

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

        <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border dark:border-gray-700">
            <h2 class="text-2xl font-semibold mb-4 border-b dark:border-gray-700 pb-2 dark:text-white">${t('competition_mode')}</h2>
            <label for="competitionModeSelect" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">${t('competition_mode_label')}</label>
            <select id="competitionModeSelect" class="block w-full p-3 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                <option value="live">${t('competition_mode_live')}</option>
                <option value="field">${t('competition_mode_field')}</option>
            </select>
            <p id="competitionModeHint" class="mt-3 text-sm text-gray-600 dark:text-gray-400">
                ${t('competition_mode_intro_hint')}
            </p>
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

        <!-- TÄVLINGENS LOGGA -->
        <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border dark:border-gray-700">
            <h2 class="text-2xl font-semibold mb-4 border-b dark:border-gray-700 pb-2 dark:text-white">Tävlingslogga</h2>
            <p class="text-sm text-gray-500 mb-4 dark:text-gray-400">Ladda upp en logga för tävlingen, arrangören eller föreningen. Den visas i sidhuvuden och i PDF-exporter.</p>

            <div class="flex items-center gap-4">
                <div id="competitionLogoPreview" class="w-20 h-20 rounded-lg border dark:border-gray-600 bg-gray-50 dark:bg-gray-900 flex items-center justify-center overflow-hidden">
                    <span class="text-xs text-gray-400 text-center px-2">Ingen logga</span>
                </div>
                <div class="flex-1 min-w-0">
                    <div id="competitionLogoName" class="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">Ingen logga vald</div>
                    <div id="competitionLogoStatus" class="text-xs text-gray-500 dark:text-gray-400 mt-1">PNG, JPG eller WebP, max 2 MB.</div>
                    <div class="mt-3 flex flex-wrap gap-2">
                        <input id="competitionLogoFileInput" type="file" class="hidden" accept="image/png,image/jpeg,image/webp">
                        <button id="uploadCompetitionLogoBtn" type="button" class="px-3 py-2 bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-200 rounded text-sm font-semibold">
                            Ladda upp logga
                        </button>
                        <button id="removeCompetitionLogoBtn" type="button" class="px-3 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 rounded text-sm font-semibold hidden">
                            Ta bort logga
                        </button>
                    </div>
                </div>
            </div>
        </div>

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

        <!-- BEHÖRIGHETER & ÅTKOMST -->
        <div class="md:col-span-2 bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border dark:border-gray-700 mt-6">
            <h2 class="text-2xl font-semibold mb-4 border-b dark:border-gray-700 pb-2 dark:text-white">Behörigheter & Åtkomst</h2>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                <!-- PIN Kod för inhoppare -->
                <div class="bg-blue-50 dark:bg-blue-900/20 p-5 rounded-lg border border-blue-100 dark:border-blue-800">
                    <h3 class="font-bold text-lg text-blue-900 dark:text-blue-300 mb-2">Funktionärskoder (Engångskoder)</h3>
                    <p class="text-sm text-blue-800 dark:text-blue-200 mb-4">
                        Dela ut rätt pinkod till rätt person (t.ex. maratonkoden till hinderdomaren). 
                        När de knappar in koden via "Min Portal" får de enbart behörighet för den rollen.
                    </p>
                    <div class="space-y-4">
                        <div class="flex items-center justify-between">
                            <span class="font-medium dark:text-gray-200">Admin/Sekretariat:</span>
                            <div class="flex items-center gap-2">
                                <span id="pinCode_admin" class="font-mono font-bold tracking-widest text-brand-darkblue dark:text-brand-lightblue bg-white dark:bg-gray-800 px-2 py-1 rounded shadow-sm border dark:border-gray-700">------</span>
                                <button class="btnGeneratePin text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded" data-role="admin">Ny</button>
                            </div>
                        </div>
                        <div class="flex items-center justify-between">
                            <span class="font-medium dark:text-gray-200">Dressyr:</span>
                            <div class="flex items-center gap-2">
                                <span id="pinCode_dressage" class="font-mono font-bold tracking-widest text-brand-darkblue dark:text-brand-lightblue bg-white dark:bg-gray-800 px-2 py-1 rounded shadow-sm border dark:border-gray-700">------</span>
                                <button class="btnGeneratePin text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded" data-role="dressage">Ny</button>
                            </div>
                        </div>
                        <div class="flex items-center justify-between">
                            <span class="font-medium dark:text-gray-200">Maraton:</span>
                            <div class="flex items-center gap-2">
                                <span id="pinCode_marathon" class="font-mono font-bold tracking-widest text-brand-darkblue dark:text-brand-lightblue bg-white dark:bg-gray-800 px-2 py-1 rounded shadow-sm border dark:border-gray-700">------</span>
                                <button class="btnGeneratePin text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded" data-role="marathon">Ny</button>
                            </div>
                        </div>
                        <div class="flex items-center justify-between">
                            <span class="font-medium dark:text-gray-200">Precision:</span>
                            <div class="flex items-center gap-2">
                                <span id="pinCode_precision" class="font-mono font-bold tracking-widest text-brand-darkblue dark:text-brand-lightblue bg-white dark:bg-gray-800 px-2 py-1 rounded shadow-sm border dark:border-gray-700">------</span>
                                <button class="btnGeneratePin text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded" data-role="precision">Ny</button>
                            </div>
                        </div>
                        <div class="flex items-center justify-between">
                            <span class="font-medium dark:text-gray-200">Speaker:</span>
                            <div class="flex items-center gap-2">
                                <span id="pinCode_speaker" class="font-mono font-bold tracking-widest text-brand-darkblue dark:text-brand-lightblue bg-white dark:bg-gray-800 px-2 py-1 rounded shadow-sm border dark:border-gray-700">------</span>
                                <button class="btnGeneratePin text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded" data-role="speaker">Ny</button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Lista över anslutna -->
                <div>
                    <h3 class="font-bold text-lg text-gray-900 dark:text-gray-100 mb-2">Anslutna via kod</h3>
                    <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
                        Här listas de som knappat in koden ovan. Klicka på soptunnan för att dra in deras rättigheter.
                        <br>
                        <em>Tips: Föranmälda funktionärer syns i <a href="#deltagare" class="text-blue-600 underline" onclick="document.querySelector('[data-i18n=menu_official]').click()">Personregistret</a>.</em>
                    </p>
                    <div class="bg-gray-50 dark:bg-gray-900 border dark:border-gray-700 rounded-md max-h-60 overflow-y-auto">
                        <ul id="pinAdminsList" class="divide-y divide-gray-200 dark:divide-gray-700">
                            <li class="p-4 text-center text-gray-500 italic">Laddar...</li>
                        </ul>
                    </div>
                </div>
            </div>
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

        const competitionMode = compDoc?.competitionMode === 'field' ? 'field' : 'live';
        const competitionModeSelect = document.getElementById('competitionModeSelect');
        const competitionModeHint = document.getElementById('competitionModeHint');
        const updateCompetitionModeHint = (mode) => {
            if (!competitionModeHint) return;
            competitionModeHint.textContent = mode === 'field'
                ? t('competition_mode_field_hint')
                : t('competition_mode_live_hint');
        };

        if (competitionModeSelect) {
            competitionModeSelect.value = competitionMode;
            updateCompetitionModeHint(competitionMode);
            competitionModeSelect.addEventListener('change', () => {
                updateCompetitionModeHint(competitionModeSelect.value);
            });
        }

        setupCompetitionLogoControls(competitionId, compDoc, meta);

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
                    const newCompetitionMode = document.getElementById('competitionModeSelect')?.value === 'field' ? 'field' : 'live';

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

                    await updateCompetition(competitionId, {
                        competitionMode: newCompetitionMode
                    });

                    const currentComp = getGlobalState('currentCompetition');
                    if (currentComp?.id === competitionId) {
                        setGlobalState({
                            key: 'currentCompetition',
                            value: {
                                ...currentComp,
                                competitionMode: newCompetitionMode
                            }
                        });
                    }

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

    // --- 5. BEHÖRIGHETER & PIN-KOD LOGIK ---
    try {
        const currentUser = getGlobalState('currentUser');
        const comp = await getCompetitionById(competitionId);
        
        let isOwner = false;
        if (currentUser) {
            if (currentUser.role === 'superadmin') isOwner = true;
            if (comp && comp.createdBy === currentUser.uid) isOwner = true;
            if (comp && comp.ownerId === currentUser.uid) isOwner = true;
            if (comp && comp.admins && comp.admins.includes(currentUser.uid)) isOwner = true;
            if (currentUser.email && comp.officialEmails && comp.officialEmails.includes(currentUser.email.toLowerCase())) isOwner = true;
            // Admin role is global admin
            if (currentUser.role === 'admin') isOwner = true;
        }

        if (isOwner) {
            // Hämta / Generera PIN-kod
            let secretData = await getSecretConfig(competitionId);
            
            const generateAndSavePin = async (role) => {
                const newPin = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits
                const key = role === 'admin' ? 'accessCode' : `accessCode_${role}`;
                const updateData = { updatedAt: Date.now() };
                updateData[key] = newPin;
                
                await saveSecretConfig(competitionId, updateData);
                const displayEl = document.getElementById(`pinCode_${role}`);
                if (displayEl) displayEl.textContent = newPin;
                return newPin;
            };

            const roles = ['admin', 'dressage', 'marathon', 'precision', 'speaker'];
            
            if (!secretData) {
                secretData = {};
            }

            // Rendera befintliga eller generera om de saknas
            for (const role of roles) {
                const key = role === 'admin' ? 'accessCode' : `accessCode_${role}`;
                const displayEl = document.getElementById(`pinCode_${role}`);
                if (!secretData[key]) {
                    await generateAndSavePin(role);
                } else {
                    if (displayEl) displayEl.textContent = secretData[key];
                }
            }

            document.querySelectorAll('.btnGeneratePin').forEach(btn => {
                btn.onclick = async (e) => {
                    const role = e.currentTarget.dataset.role;
                    if (confirm(`Är du säker på att du vill byta koden för ${role}? De som redan använt gamla koden kommer behålla sina rättigheter, men nya funktionärer måste få den nya koden.`)) {
                        const originalText = e.currentTarget.textContent;
                        e.currentTarget.textContent = "...";
                        await generateAndSavePin(role);
                        e.currentTarget.textContent = originalText;
                    }
                };
            });

            // Lyssna på anslutna admins
            if (activeAdminsUnsub) {
                try { activeAdminsUnsub(); } catch { }
                activeAdminsUnsub = null;
            }
            const listEl = document.getElementById('pinAdminsList');
            
            const renderAdmins = (admins) => {
                if (!listEl) return;
                if (admins.length === 0) {
                    listEl.innerHTML = '<li class="p-4 text-center text-gray-500 italic text-sm">Ingen har anslutit med koden ännu.</li>';
                    return;
                }

                listEl.innerHTML = admins.map(a => {
                    const dateStr = a.joinedAt ? new Date(a.joinedAt).toLocaleString('sv-SE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Okänt';
                    return `
                    <li class="p-3 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                        <div>
                            <p class="text-sm font-semibold text-gray-900 dark:text-gray-100">${a.email || 'Okänd användare'} ${
                                (a.roles || [a.role || 'admin']).map(r => `<span class="text-xs ml-2 px-2 py-0.5 bg-gray-200 dark:bg-gray-700 rounded-full text-gray-700 dark:text-gray-300">${r}</span>`).join('')
                            }</p>
                            <p class="text-xs text-gray-500 dark:text-gray-400">Anslöt: ${dateStr}</p>
                        </div>
                        <button class="delete-admin-btn text-red-500 hover:text-red-700 bg-red-50 dark:bg-red-900/20 p-2 rounded-md transition-colors" data-uid="${a.uid}" title="Ta bort åtkomst">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                              <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                            </svg>
                        </button>
                    </li>
                    `;
                }).join('');

                // Koppla klick-event för borttagning
                document.querySelectorAll('.delete-admin-btn').forEach(btn => {
                    btn.onclick = async (e) => {
                        const uid = e.currentTarget.dataset.uid;
                        if (confirm("Vill du dra in åtkomsten för denna användare omedelbart?")) {
                            e.currentTarget.disabled = true;
                            e.currentTarget.classList.add('opacity-50');
                            await deleteCompetitionAdmin(competitionId, uid);
                        }
                    };
                });
            };

            activeAdminsUnsub = listenForCompetitionAdmins(competitionId, renderAdmins);
        }
    } catch (e) {
        console.warn("Kunde inte ladda behörigheter:", e);
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

function setupCompetitionLogoControls(competitionId, compDoc = {}, meta = {}) {
    const preview = document.getElementById('competitionLogoPreview');
    const nameEl = document.getElementById('competitionLogoName');
    const statusEl = document.getElementById('competitionLogoStatus');
    const fileInput = document.getElementById('competitionLogoFileInput');
    const uploadBtn = document.getElementById('uploadCompetitionLogoBtn');
    const removeBtn = document.getElementById('removeCompetitionLogoBtn');

    if (!preview || !fileInput || !uploadBtn) return;

    const merged = { ...(compDoc || {}), meta: { ...(meta || {}), ...(compDoc?.meta || {}) } };

    const renderLogo = (competitionLike = {}) => {
        const url = getCompetitionLogoUrl(competitionLike);
        const name = getCompetitionLogoName(competitionLike);
        if (url) {
            preview.innerHTML = `<img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" class="max-w-full max-h-full object-contain">`;
            if (nameEl) nameEl.textContent = name;
            if (statusEl) statusEl.textContent = 'Loggan är sparad för tävlingen.';
            if (removeBtn) removeBtn.classList.remove('hidden');
        } else {
            preview.innerHTML = '<span class="text-xs text-gray-400 text-center px-2">Ingen logga</span>';
            if (nameEl) nameEl.textContent = 'Ingen logga vald';
            if (statusEl) statusEl.textContent = 'PNG, JPG eller WebP, max 2 MB.';
            if (removeBtn) removeBtn.classList.add('hidden');
        }
    };

    renderLogo(merged);

    uploadBtn.onclick = () => fileInput.click();
    fileInput.onchange = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const originalText = uploadBtn.textContent;
        uploadBtn.textContent = 'Laddar upp...';
        uploadBtn.disabled = true;

        try {
            let logoUrl = '';
            try {
                logoUrl = await uploadCompetitionLogo(competitionId, file);
            } catch (uploadError) {
                if (uploadError?.code !== 'storage/unauthorized') throw uploadError;
                console.warn('Storage blockerade tävlingsloggan, sparar nedskalad bild i config istället:', uploadError);
                logoUrl = await fileToLogoDataUrl(file);
            }
            const logoName = file.name;
            const logoUpdatedAt = new Date().toISOString();
            const isInlineLogo = String(logoUrl).startsWith('data:');
            const logoStorageMode = isInlineLogo ? 'configDataUrl' : 'storageUrl';
            const payload = { logoUrl, logoName, logoUpdatedAt, logoStorageMode };
            const rootPayload = isInlineLogo
                ? { logoUrl: '', logoName, logoUpdatedAt, logoStorageMode }
                : payload;

            await Promise.all([
                updateCompetition(competitionId, rootPayload).catch(error => {
                    console.warn('Kunde inte spara logga på tävlingsdokumentet:', error);
                    return null;
                }),
                saveConfig(competitionId, 'competitionMeta', payload)
            ]);

            const currentComp = getGlobalState('currentCompetition');
            if (currentComp?.id === competitionId) {
                Object.assign(currentComp, rootPayload);
                currentComp.meta = { ...(currentComp.meta || {}), ...payload };
            }

            renderLogo({ ...payload, meta: payload });
            showAlert('Loggan är uppladdad och sparad.', true);
        } catch (error) {
            console.error('Kunde inte ladda upp tavlingslogga:', error);
            showAlert(error.message || 'Kunde inte ladda upp loggan.', false);
        } finally {
            uploadBtn.textContent = originalText;
            uploadBtn.disabled = false;
            fileInput.value = '';
        }
    };

    if (removeBtn) {
        removeBtn.onclick = async () => {
            if (!confirm('Vill du ta bort tävlingsloggan från denna tävling?')) return;
            const payload = { logoUrl: '', logoName: '', logoUpdatedAt: new Date().toISOString(), logoStorageMode: '' };
            removeBtn.disabled = true;
            try {
                await Promise.all([
                    updateCompetition(competitionId, payload).catch(error => {
                        console.warn('Kunde inte rensa logga på tävlingsdokumentet:', error);
                        return null;
                    }),
                    saveConfig(competitionId, 'competitionMeta', payload)
                ]);

                const currentComp = getGlobalState('currentCompetition');
                if (currentComp?.id === competitionId) {
                    Object.assign(currentComp, payload);
                    currentComp.meta = { ...(currentComp.meta || {}), ...payload };
                }

                renderLogo({});
                showAlert('Loggan är borttagen.', true);
            } catch (error) {
                console.error('Kunde inte ta bort tavlingslogga:', error);
                showAlert('Kunde inte ta bort loggan.', false);
            } finally {
                removeBtn.disabled = false;
            }
        };
    }
}

async function fileToLogoDataUrl(file) {
    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
        throw new Error('Loggan måste vara PNG, JPG eller WebP.');
    }

    const objectUrl = URL.createObjectURL(file);
    try {
        const img = new Image();
        img.src = objectUrl;
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
        });

        const maxSize = 420;
        const scale = Math.min(1, maxSize / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
        const width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
        const height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        if (dataUrl.length > 260000) {
            throw new Error('Loggan är för stor även efter nedskalning. Välj en mindre bild.');
        }
        return dataUrl;
    } finally {
        URL.revokeObjectURL(objectUrl);
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
