import { getGlobalState } from '../../main.js';
import { getCompetitionHeader } from '../../ui/components.js';
import { t } from '../../utils/i18n.js';
import { getOfficials } from '../../services/adminService.js';
import { getJudges } from '../../services/adminService.js';
import { getCompetitionStatistics } from '../../services/competitionService.js';
import { getEquipages } from '../../services/equipageService.js';
import { getConfig } from '../../services/competitionService.js';

export async function load() {
    const user = getGlobalState('currentUser');
    const container = document.getElementById('page-official');
    if (!container) return;

    if (!user) {
        container.innerHTML = `
            <div class="p-8 text-center text-gray-600">
                <h2 class="text-xl font-bold mb-2">Åtkomst nekad</h2>
                <p>Du måste vara inloggad som funktionär för att se denna sida.</p>
            </div>`;
        return;
    }

    const competition = getGlobalState('currentCompetition');
    if (!competition) {
        container.innerHTML = `
            <div class="p-8 text-center text-gray-600">
                <h2 class="text-xl font-bold mb-2">Ingen tävling vald</h2>
                <p>Välj en tävling från Hubben först.</p>
            </div>`;
        return;
    }

    container.innerHTML = `
        <div class="container mx-auto p-3 sm:p-4 md:p-8">
            ${getCompetitionHeader(competition, 'Funktionärsportal')}
            
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6 mt-6">
                <!-- VÄLKOMMEN / STATUS -->
                <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-4 md:p-6 lg:col-span-2 border-t-4 border-blue-500">
                    <h2 class="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">
                        Välkommen, ${user.displayName || user.email}!
                    </h2>
                        Detta är din kontrollpanel för tävlingen. Här hittar du snabblänkar och dina uppgifter.
                    </p>

                    <!-- DASHBOARD WIDGETS -->
                    <div id="official-dashboard-widgets" class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 hidden">
                        <!-- Next Start Widget -->
                        <div class="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded border border-indigo-100 dark:border-indigo-800 flex items-start gap-3">
                            <div class="text-2xl">⏳</div>
                            <div>
                                <h4 class="font-bold text-indigo-900 dark:text-indigo-100 text-sm uppercase mb-1">Nästa Start</h4>
                                <div id="widget-next-start" class="text-sm text-indigo-800 dark:text-indigo-200">
                                    Laddar...
                                </div>
                            </div>
                        </div>
                        
                        <!-- Pending Actions Widget (Admin/Sekretariat) -->
                        <div id="widget-pending-container" class="bg-orange-50 dark:bg-orange-900/20 p-4 rounded border border-orange-100 dark:border-orange-800 flex items-start gap-3 hidden">
                             <div class="text-2xl">📝</div>
                            <div>
                                <h4 class="font-bold text-orange-900 dark:text-orange-100 text-sm uppercase mb-1">Att Attestera</h4>
                                <div id="widget-pending-text" class="text-sm text-orange-800 dark:text-orange-200">
                                    -
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
                         <!-- GENVÄGAR -->
                        <a href="#reports" class="flex flex-col items-start gap-3 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg hover:bg-blue-50 dark:hover:bg-gray-700 transition border border-gray-100 dark:border-gray-600 group sm:flex-row sm:items-center">
                            <div class="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xl group-hover:scale-110 transition-transform">📄</div>
                            <div>
                                <div class="font-bold text-gray-900 dark:text-gray-100">Rapportcenter</div>
                                <div class="text-xs text-gray-500 dark:text-gray-400">Startlistor & Resultat</div>
                            </div>
                        </a>

                        <a href="#speaker" class="flex flex-col items-start gap-3 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg hover:bg-yellow-50 dark:hover:bg-gray-700 transition border border-gray-100 dark:border-gray-600 group sm:flex-row sm:items-center">
                            <div class="w-10 h-10 rounded-full bg-yellow-100 text-yellow-600 flex items-center justify-center text-xl group-hover:scale-110 transition-transform">🎤</div>
                            <div>
                                <div class="font-bold text-gray-900 dark:text-gray-100">Speaker</div>
                                <div class="text-xs text-gray-500 dark:text-gray-400">Liverapportering</div>
                            </div>
                        </a>

                        <a href="#vet-check" class="flex flex-col items-start gap-3 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg hover:bg-green-50 dark:hover:bg-gray-700 transition border border-gray-100 dark:border-gray-600 group sm:flex-row sm:items-center">
                            <div class="w-10 h-10 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-xl group-hover:scale-110 transition-transform">🩺</div>
                            <div>
                                <div class="font-bold text-gray-900 dark:text-gray-100">Veterinär</div>
                                <div class="text-xs text-gray-500 dark:text-gray-400">Besiktning & Status</div>
                            </div>
                        </a>

                        <a href="#dressyr-monitor" class="flex flex-col items-start gap-3 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg hover:bg-purple-50 dark:hover:bg-gray-700 transition border border-gray-100 dark:border-gray-600 group sm:flex-row sm:items-center">
                            <div class="w-10 h-10 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-xl group-hover:scale-110 transition-transform">📺</div>
                            <div>
                                <div class="font-bold text-gray-900 dark:text-gray-100">Dressyr Monitor</div>
                                <div class="text-xs text-gray-500 dark:text-gray-400">Publikvisning</div>
                            </div>
                        </a>

                        <a href="#maraton-monitor" class="flex flex-col items-start gap-3 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg hover:bg-orange-50 dark:hover:bg-gray-700 transition border border-gray-100 dark:border-gray-600 group sm:flex-row sm:items-center">
                            <div class="w-10 h-10 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center text-xl group-hover:scale-110 transition-transform">⏱️</div>
                            <div>
                                <div class="font-bold text-gray-900 dark:text-gray-100">Maraton Monitor</div>
                                <div class="text-xs text-gray-500 dark:text-gray-400">Publikvisning</div>
                            </div>
                        </a>

                        <a href="#precision-monitor" class="flex flex-col items-start gap-3 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg hover:bg-red-50 dark:hover:bg-gray-700 transition border border-gray-100 dark:border-gray-600 group sm:flex-row sm:items-center">
                            <div class="w-10 h-10 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-xl group-hover:scale-110 transition-transform">⚠️</div>
                            <div>
                                <div class="font-bold text-gray-900 dark:text-gray-100">Precision Monitor</div>
                                <div class="text-xs text-gray-500 dark:text-gray-400">Publikvisning</div>
                            </div>
                        </a>
                    </div>
                </div>

                <!-- MIN NÄSTA UPPGIFT / STATUS -->
                <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-4 md:p-6 border-t-4 border-orange-500">
                    <h3 class="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4">Dina Uppdrag</h3>
                    <div id="official-assignments" class="space-y-4">
                        <div class="animate-pulse flex space-x-4">
                            <div class="flex-1 space-y-2 py-1">
                                <div class="h-4 bg-gray-200 rounded w-3/4"></div>
                                <div class="h-4 bg-gray-200 rounded"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="mt-8 bg-white dark:bg-gray-800 rounded-lg shadow p-4 md:p-6">
                 <h3 class="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4">Verktyg & Inmatning</h3>
                 <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                    <button onclick="location.hash='#dressyr-input'" class="p-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 rounded text-center transition">
                        <div class="text-2xl mb-1">📝</div>
                        <div class="font-bold text-sm text-slate-800 dark:text-slate-200">Dressyr</div>
                    </button>
                    <button onclick="location.hash='#maraton-input'" class="p-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 rounded text-center transition">
                        <div class="text-2xl mb-1">⏱️</div>
                        <div class="font-bold text-sm text-slate-800 dark:text-slate-200">Hinder</div>
                    </button>
                    <button onclick="location.hash='#maraton-stages'" class="p-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 rounded text-center transition">
                        <div class="text-2xl mb-1">🚩</div>
                        <div class="font-bold text-sm text-slate-800 dark:text-slate-200">Sträckor</div>
                    </button>
                    <button onclick="location.hash='#precision-input'" class="p-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 rounded text-center transition">
                        <div class="text-2xl mb-1">⚠️</div>
                        <div class="font-bold text-sm text-slate-800 dark:text-slate-200">Precision</div>
                    </button>
                 </div>
            </div>
        </div>
    `;

    // Load assignments asynchronously
    loadAssignments(competition.id, user);
    loadDashboard(competition.id);
}

async function loadDashboard(competitionId) {
    const nextStartEl = document.getElementById('widget-next-start');
    const container = document.getElementById('official-dashboard-widgets');

    if (nextStartEl && container) {
        container.classList.remove('hidden');

        try {
            const [equipages, startTimes] = await Promise.all([
                getEquipages(competitionId),
                getConfig(competitionId, 'startTimes')
            ]);

            const times = (startTimes && startTimes.times) ? startTimes.times : {};
            const now = new Date();

            // Samla ALLA framtida starter
            let allUpcoming = [];

            equipages.forEach(eq => {
                const sn = String(eq.startNumber);
                const tEntry = times[sn];
                if (!tEntry) return;

                // Helper to parse and add
                const addIfFuture = (timeStr, type, label) => {
                    if (!timeStr) return;
                    // Hantera "2024-05-10T09:00" eller "09:00" (om datum finns i kontext, annars ignorera tid utan datum för global sortering)
                    let date;
                    if (timeStr.includes('T')) {
                        date = new Date(timeStr);
                    } else {
                        // Utan datum kan vi inte vara säkra på "nästa", så vi hoppar över dem för denna widget
                        return;
                    }

                    if (!isNaN(date.getTime()) && date > now) {
                        allUpcoming.push({ eq, date, type, label });
                    }
                };

                addIfFuture(tEntry.dressage || tEntry.dressyr, 'dressage', 'Dressyr');
                addIfFuture(tEntry.marathon || tEntry.maraton, 'marathon', 'Maraton');
                addIfFuture(tEntry.precision || tEntry.precision, 'precision', 'Precision');
            });

            // Sortera alla framtida starter
            allUpcoming.sort((a, b) => a.date - b.date);
            const next = allUpcoming[0]; // Den absolut närmsta

            if (next) {
                const timeStr = next.date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
                // Ikon baserat på typ
                const icon = next.type === 'dressage' ? '🎩' : (next.type === 'marathon' ? '⏱️' : '⚠️');

                nextStartEl.innerHTML = `
                    <div class="flex items-center gap-2 mb-1">
                        <span class="text-xl">${icon}</span>
                        <div class="font-bold text-lg leading-none">${timeStr}</div>
                        <div class="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 font-bold">${next.label}</div>
                    </div>
                    <div class="font-medium truncate">#${next.eq.startNumber} ${next.eq.driverName}</div>
                    <div class="text-xs opacity-75 truncate">${next.eq.className || ''}</div>
                `;
            } else {
                nextStartEl.textContent = "Inga fler starter idag.";
            }

            // --- Pending Verifications (Endast Admin/Sekretariat/Domare) ---
            const user = getGlobalState('currentUser');
            const roles = new Set([
                user?.role || 'publik',
                ...((Array.isArray(user?.compRoles) ? user.compRoles : []))
            ]);
            const canSeePending = ['admin', 'sekretariat', 'superadmin', 'domare', 'dressage', 'marathon', 'precision']
                .some(role => roles.has(role));
            if (canSeePending) {
                const pendingWidget = document.getElementById('widget-pending-container');
                const pendingText = document.getElementById('widget-pending-text');

                if (pendingWidget && pendingText) {
                    pendingWidget.classList.remove('hidden');

                    // Fetch stats
                    getCompetitionStatistics(competitionId).then(stats => {
                        const total = (stats.dressage || 0) + (stats.marathon || 0) + (stats.precision || 0);

                        // Bygg länkar baserat på vad som finns
                        // Bygg länkar baserat på vad som finns
                        let links = [];
                        if (stats.dressage > 0) links.push(`<a href="#dressyr-results" class="underline hover:text-orange-900 dark:hover:text-orange-100">${stats.dressage} Dressyr</a>`);
                        if (stats.marathon > 0) links.push(`<a href="#maraton-results" class="underline hover:text-orange-900 dark:hover:text-orange-100">${stats.marathon} Maraton</a>`);
                        if (stats.precision > 0) links.push(`<a href="#precision-results" class="underline hover:text-orange-900 dark:hover:text-orange-100">${stats.precision} Precision</a>`);

                        if (total > 0) {
                            pendingText.innerHTML = `
                                <div class="font-bold text-orange-700 dark:text-orange-300">${total} attestrader väntar</div>
                                <div class="text-xs text-orange-600 dark:text-orange-400 mt-1 flex flex-wrap gap-2">
                                    ${links.join('<span class="opacity-50">•</span>')}
                                </div>
                             `;
                        } else {
                            pendingText.innerHTML = `<span class="text-green-600 dark:text-green-400 text-sm font-medium flex items-center gap-1">Allt är attesterat! ✅</span>`;
                            pendingWidget.classList.replace('bg-orange-50', 'bg-green-50');
                            pendingWidget.classList.replace('border-orange-100', 'border-green-100');
                            pendingWidget.classList.replace('dark:bg-orange-900/20', 'dark:bg-green-900/20');
                            pendingWidget.classList.replace('dark:border-orange-800', 'dark:border-green-800');
                        }
                    });
                }
            }

        } catch (err) {
            console.error("Dashboard load error:", err);
            nextStartEl.textContent = "Kunde inte ladda data.";
        }
    }
}


async function loadAssignments(competitionId, user) {
    const el = document.getElementById('official-assignments');
    if (!el) return;

    try {
        const [officials, judges] = await Promise.all([
            getOfficials(competitionId),
            getJudges(competitionId)
        ]);

        // Find my entries (simple email or name match as fallback)
        const myOfficials = officials.filter(o => (o.email && o.email === user.email) || (o.name === user.displayName));
        const myJudges = judges.filter(j => (j.email && j.email === user.email) || (j.name === user.displayName));

        if (myOfficials.length === 0 && myJudges.length === 0) {
            el.innerHTML = `<p class="text-sm text-gray-500 italic">Inga specifika uppdrag hittades kopplade till ditt konto.</p>`;
            return;
        }

        let html = '';

        if (myJudges.length > 0) {
            html += `<div class="mb-4">
                <h4 class="text-xs font-bold text-gray-500 uppercase flex items-center gap-1">⚖️ Domaruppdrag</h4>
                <ul class="mt-2 space-y-2">
                    ${myJudges.map(j => `
                        <li class="bg-orange-50 dark:bg-orange-900/30 p-2 rounded border border-orange-100 dark:border-orange-800 text-sm flex justify-between items-center">
                            <div>
                                <span class="font-bold text-orange-900 dark:text-orange-100">${j.position || 'Domare'}</span>
                            </div>
                            <span class="text-orange-700 dark:text-orange-300 text-xs px-2 py-0.5 bg-orange-100 dark:bg-orange-800 rounded-full font-mono">${j.id}</span>
                        </li>
                    `).join('')}
                </ul>
            </div>`;
        }

        if (myOfficials.length > 0) {
            html += `<div>
                <h4 class="text-xs font-bold text-gray-500 uppercase flex items-center gap-1">🛡️ Funktionär</h4>
                <ul class="mt-2 space-y-2">
                    ${myOfficials.map(o => `
                        <li class="bg-blue-50 dark:bg-blue-900/30 p-2 rounded border border-blue-100 dark:border-blue-800 text-sm">
                            <div class="font-bold text-blue-900 dark:text-blue-100">${o.role || o.titel || 'Funktionär'}</div>
                            ${o.area ? `<div class="text-xs text-blue-700 dark:text-blue-300">Område: ${o.area}</div>` : ''}
                        </li>
                    `).join('')}
                </ul>
            </div>`;
        }

        el.innerHTML = html;

    } catch (err) {
        console.error("Error loading assignments:", err);
        el.innerHTML = `<p class="text-red-500 text-sm">Kunde inte ladda uppdrag.</p>`;
    }
}
