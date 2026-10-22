// "Personuppgifter" in the admin settings: how long the competition's private
// data is kept after archiving (retentionMonths, read by the scheduled
// purgeExpiredPersonalData), the organiser's privacy contact shown in the
// privacy notice, and an access request export (exportPersonData).
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js';
import { functions } from '../../config/firebase-config.js';
import { updateCompetition } from '../../services/competitionService.js';
import { escapeHtml } from '../../utils/sharedUtils.js';
import {
    RETENTION_MONTHS_DEFAULT,
    RETENTION_MONTHS_MAX,
    RETENTION_MONTHS_MIN,
    parseRetentionMonths,
    personExportFileName
} from '../../utils/personalDataUtils.js';

export function getPrivacySettingsHtml() {
    return `
        <div id="privacySettingsSection" class="md:col-span-2 mt-12 p-6 rounded-xl shadow-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700" style="display:none;">
            <h2 class="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-1">Personuppgifter</h2>
            <p class="text-sm text-gray-600 dark:text-gray-300 mb-4">
                Kontaktuppgifter, ICE, personnummer, hästtemperaturer, veterinäruppgifter och funktionärsanmälningar raderas
                automatiskt efter att tävlingen arkiverats. Resultaten ligger kvar.
                <a href="#privacy" id="privacySettingsNoticeLink" class="text-blue-600 dark:text-blue-400 hover:underline">Visa integritetspolicyn</a>
            </p>
            <p id="privacyPurgeWarning" role="alert" class="hidden mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"></p>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <label class="block text-sm text-gray-700 dark:text-gray-200">
                    <span class="font-semibold">Gallra efter (månader efter arkivering)</span>
                    <input type="number" id="retentionMonthsInput" min="${RETENTION_MONTHS_MIN}" max="${RETENTION_MONTHS_MAX}" step="1" inputmode="numeric"
                        class="w-full p-2 mt-1 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="${RETENTION_MONTHS_DEFAULT}">
                </label>
                <label class="block text-sm text-gray-700 dark:text-gray-200">
                    <span class="font-semibold">Kontakt för personuppgiftsfrågor (visas i integritetspolicyn)</span>
                    <input type="text" id="privacyContactInput" maxlength="200"
                        class="w-full p-2 mt-1 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="t.ex. sekreterare@klubben.se">
                </label>
            </div>
            <button id="btnSavePrivacySettings" type="button" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-md disabled:opacity-50">Spara</button>
            <span id="privacySettingsStatus" class="ml-3 text-sm text-gray-600 dark:text-gray-300" aria-live="polite"></span>

            <h3 class="font-bold text-lg text-gray-900 dark:text-gray-100 mt-6 mb-1">Exportera en persons data (registerutdrag)</h3>
            <p class="text-sm text-gray-600 dark:text-gray-300 mb-3">
                Söker på e-postadressen i alla tävlingar du administrerar (anmälningar, funktionärer, domare, funktionärsanmälningar, roller)
                och laddar ner det som hittas som en JSON-fil, att lämna till personen. Filen innehåller personuppgifter: hantera den varsamt.
            </p>
            <div class="flex flex-col sm:flex-row gap-2 max-w-xl">
                <input type="email" id="personExportEmail" autocomplete="off" placeholder="personens@e-post.se"
                    class="flex-1 p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                <button id="btnPersonExport" type="button" class="px-4 py-2 bg-gray-700 hover:bg-gray-800 text-white font-semibold rounded-md disabled:opacity-50">Exportera</button>
            </div>
            <p id="personExportStatus" class="mt-2 text-sm text-gray-600 dark:text-gray-300" aria-live="polite"></p>
        </div>`;
}

function downloadJson(data, fileName) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120000);
}

// As PURGE_GRACE_MS in functions/src/personalData.js
const PURGE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** When the scheduled deletion happens at the earliest, or null when none is scheduled */
export function purgeDateMs(scheduledAt) {
    const ms = typeof scheduledAt === 'number' ? scheduledAt
        : scheduledAt?.toMillis?.() ?? (Number.isFinite(scheduledAt?.seconds) ? scheduledAt.seconds * 1000 : null);
    return Number.isFinite(ms) && ms > 0 ? ms + PURGE_GRACE_MS : null;
}

/** Shows and wires the section (for those who may maintain the competition) */
export function setupPrivacySettings(competitionId, comp = {}) {
    const section = document.getElementById('privacySettingsSection');
    if (!section) return;
    section.style.display = 'block';
    const noticeLink = document.getElementById('privacySettingsNoticeLink');
    if (noticeLink) noticeLink.href = `#privacy?id=${encodeURIComponent(competitionId)}`;

    const monthsInput = document.getElementById('retentionMonthsInput');
    const contactInput = document.getElementById('privacyContactInput');
    if (monthsInput && Number.isInteger(comp?.retentionMonths)) monthsInput.value = String(comp.retentionMonths);
    if (contactInput) contactInput.value = comp?.privacyContact || '';

    // The retention run has scheduled the deletion (personalDataPurgeScheduledAt,
    // functions/src/personalData.js): it happens a week later at the earliest
    const warning = document.getElementById('privacyPurgeWarning');
    const purgeAt = purgeDateMs(comp?.personalDataPurgeScheduledAt);
    if (warning && purgeAt) {
        const date = new Date(purgeAt).toLocaleDateString('sv-SE', { year: 'numeric', month: 'long', day: 'numeric' });
        warning.textContent = `Personuppgifterna gallras ${date} (eller vid första körningen därefter). Öka antalet månader nedan om de ska sparas längre.`;
        warning.classList.remove('hidden');
    }

    const saveBtn = document.getElementById('btnSavePrivacySettings');
    const saveStatus = document.getElementById('privacySettingsStatus');
    saveBtn?.addEventListener('click', async () => {
        const typed = monthsInput?.value ?? '';
        const months = typed.trim() === '' ? RETENTION_MONTHS_DEFAULT : parseRetentionMonths(typed);
        if (months === null) {
            saveStatus.textContent = `Ange ett helt antal månader, ${RETENTION_MONTHS_MIN}–${RETENTION_MONTHS_MAX}.`;
            return;
        }
        saveBtn.disabled = true;
        saveStatus.textContent = 'Sparar…';
        try {
            await updateCompetition(competitionId, {
                retentionMonths: months,
                privacyContact: String(contactInput?.value || '').trim().slice(0, 200)
            });
            saveStatus.textContent = 'Sparat.';
        } catch (error) {
            console.error('Kunde inte spara personuppgiftsinställningarna:', error);
            saveStatus.textContent = `Kunde inte spara: ${error?.message || error}`;
        } finally {
            saveBtn.disabled = false;
        }
    });

    const exportBtn = document.getElementById('btnPersonExport');
    const exportStatus = document.getElementById('personExportStatus');
    exportBtn?.addEventListener('click', async () => {
        const email = String(document.getElementById('personExportEmail')?.value || '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
            exportStatus.textContent = 'Ange en giltig e-postadress.';
            return;
        }
        exportBtn.disabled = true;
        exportStatus.textContent = 'Söker…';
        try {
            const { data } = await httpsCallable(functions, 'exportPersonData', { timeout: 300000 })({ email });
            downloadJson(data, personExportFileName(email));
            exportStatus.innerHTML = `Klar: ${escapeHtml(String(data?.documentCount ?? 0))} dokument i ${escapeHtml(String(data?.competitionCount ?? 0))} tävling(ar).`;
        } catch (error) {
            console.error('Export av personuppgifter misslyckades:', error);
            exportStatus.textContent = `Kunde inte exportera: ${error?.message || error}`;
        } finally {
            exportBtn.disabled = false;
        }
    });
}
