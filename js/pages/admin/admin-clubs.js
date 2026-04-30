import { getGlobalState } from '../../main.js';
import { getClubLogoHtml, getClubLogoUrl, saveCompetitionLogo, saveGlobalLogo, ensureClubLogosLoaded, updateClubLogo } from '../../services/logosService.js';
import { uploadClubLogo } from '../../services/storageService.js';
import { showAlert } from '../../ui/components.js';

export async function renderClubsTab(container, competitionId) {
    container.innerHTML = `<div class="text-center py-12"><div class="spinner"></div> Laddar klubbar...</div>`;

    // 1. Gather Unique Clubs from all Equipages (Drivers AND Grooms if needed, but usually just drivers)
    // We need 'allEquipages' which is in admin.js local state... 
    // OR we can fetch them. But admin.js passes container. It should probably pass the equipages or we fetch from global state.
    // 'allEquipages' is not globally available easily unless we attach it to window or use a service.
    // admin.js has 'allEquipages'. Let's ask admin.js to pass it or we fetch from global 'currentCompetition'.
    // Actually, getting all equipages might be heavy if not already loaded.
    // Let's assume admin.js calls this function. We can export a function that accepts equipages OR we fetch from Firestore if missing.
    // Simplified: We use getGlobalState('allEquipages') if available? No, global state usually just has currentComp.
    // Admin.js has the list. Let's make renderClubsTab accept (container, competitionId, equipages).

    // Fallback: Fetch from firestore if not passed? 
    // For now, let's assume we rely on the caller to provide data, or we just display what we know.
    // Actually, logosService has a map of clubs -> logos. We can list ALL clubs in that map? 
    // No, we want to list clubs PARTICIPATING in this competition.

    // We will change the signature to: renderClubsTab(container, competitionId, equipages)
    // BUT since we can't change the function signature in this file without changing the caller in the next step, 
    // I will write it to expect 'equipages' as 3rd arg.
}

// Re-writing with proper signature
export async function renderClubs(container, competitionId, equipages = []) {
    await ensureClubLogosLoaded(competitionId);

    // Extract unique clubs
    const clubs = new Set();
    equipages.forEach(eq => {
        if (eq.club) clubs.add(eq.club.trim());
        if (eq.clubName) clubs.add(eq.clubName.trim());
    });

    // Also include clubs that already have a logo in the dynamic config for this competition?
    // Maybe, but primarily we want to help users add logos for current participants.

    const sortedClubs = Array.from(clubs).sort((a, b) => a.localeCompare(b));

    if (sortedClubs.length === 0) {
        container.innerHTML = `<div class="p-8 text-center text-gray-500">Inga klubbar hittades bland ekipagen.</div>`;
        return;
    }

    let html = `
        <div class="max-w-4xl mx-auto bg-white dark:bg-gray-800 p-6 rounded-xl shadow border dark:border-gray-700">
            <h2 class="text-2xl font-bold mb-4 dark:text-white">Hantera Klubbloggor</h2>
            <p class="text-gray-600 dark:text-gray-300 mb-6 text-sm">
                Här kan du ladda upp loggor för klubbar som deltar i tävlingen. 
                Dessa visas i startlistor, resultat och på "Big Screen".
                <br>
                <span class="text-xs italic text-gray-500">Loggan sparas specifikt för denna tävling, men vi kan göra den global på begäran.</span>
            </p>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
    `;

    sortedClubs.forEach(club => {
        if (!club) return;
        const normalizedClub = club;
        const currentUrl = getClubLogoUrl(club);
        const hasLogo = !!currentUrl;

        html += `
            <div class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded border dark:border-gray-700">
                <div class="flex items-center gap-3">
                    <div class="w-12 h-12 flex items-center justify-center bg-white dark:bg-gray-800 rounded border dark:border-gray-600 overflow-hidden shadow-sm">
                        ${currentUrl
                ? `<img src="${currentUrl}" class="max-w-full max-h-full object-contain" id="img-${btoa(encodeURIComponent(club))}">`
                : `<span class="text-gray-300 text-xs text-center leading-none" id="placeholder-${btoa(encodeURIComponent(club))}">Ingen<br>logga</span>`
            }
                    </div>
                    <div>
                        <h3 class="font-bold text-gray-800 dark:text-gray-100 text-sm truncate w-40 md:w-56" title="${club}">${club}</h3>
                        <span id="status-text-${btoa(encodeURIComponent(club))}" class="text-xs ${hasLogo ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}">
                            ${hasLogo ? 'Logga finns' : 'Saknar logga'}
                        </span>
                    </div>
                </div>
                <div>
                    <input type="file" id="file-${btoa(encodeURIComponent(club))}" class="hidden" accept="image/*">
                    <button class="btn-upload px-3 py-1.5 bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50 rounded text-xs font-semibold transition-colors" 
                            data-club="${club}"
                            onclick="document.getElementById('file-${btoa(encodeURIComponent(club))}').click()">
                        Ladda upp
                    </button>
                    ${hasLogo ? '' : '' /* Maybe add delete button later? */}
                </div>
            </div>
        `;
    });

    html += `
            </div>
        </div>
    `;

    container.innerHTML = html;

    // Add Event Listeners for File Inputs
    sortedClubs.forEach(club => {
        const id = btoa(encodeURIComponent(club));
        const fileInput = document.getElementById(`file-${id}`);
        if (!fileInput) return;

        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            // Feedback UI
            const btn = document.querySelector(`button[data-club="${club}"]`);
            const box = document.getElementById(`img-${id}`)?.parentElement || document.getElementById(`placeholder-${id}`)?.parentElement;

            const originalText = btn.textContent;
            btn.textContent = 'Uppladdar...';
            btn.disabled = true;

            try {
                // Upload
                let url;
                try {
                    url = await uploadClubLogo(competitionId, file, true);
                } catch (uploadErr) {
                    console.error('STORAGE UPLOAD ERROR:', uploadErr);
                    throw new Error('Storage Upload Failed: ' + uploadErr.message);
                }

                let saveFailed = false;

                // Save link to Global Firestore
                try {
                    await saveGlobalLogo(club, url);
                } catch (firestoreErr) {
                    saveFailed = true;
                    console.error('FIRESTORE SAVE ERROR:', firestoreErr);
                    // Show the ACTUAL error in the alert so the user can see it
                    showAlert('Loggan uppladdad men spara länk misslyckades: ' + firestoreErr.message + ' (' + firestoreErr.code + ')', false);
                }

                // Update UI immediately (Optimistic update handled by saveCompetitionLogo -> logosService local cache, but we need to update DOM image)
                updateClubLogo(club, url); // Ensure local cache is definitely updated for immediate use

                // Refresh Image
                const imgContainer = box;
                imgContainer.innerHTML = `<img src="${url}" class="max-w-full max-h-full object-contain">`;

                if (!saveFailed) {
                    const statusText = document.getElementById(`status-text-${id}`);
                    if (statusText) {
                        statusText.textContent = 'Logga laddad (Globalt!)';
                        statusText.className = 'text-xs text-green-600 dark:text-green-400 font-bold';
                    }
                    showAlert(`Logga för ${club} uppladdad globalt!`, true);
                }

            } catch (err) {
                console.error(err);
                showAlert('Fel vid uppladdning: ' + err.message, false);
            } finally {
                btn.textContent = originalText;
                btn.disabled = false;
                fileInput.value = ''; // Reset
            }
        });
    });
}
