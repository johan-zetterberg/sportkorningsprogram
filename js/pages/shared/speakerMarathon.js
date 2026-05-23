import { getObstacleArray, stageStartTS, stageStopTS, analyzeSectorProgress } from '../../utils/marathonUtils.js';
import { msToLabel } from '../../utils/sharedUtils.js';

export function renderObstacleFocus(obstacleFocusVal, context) {
    if (!obstacleFocusVal || context.currentDiscipline !== 'maraton') {
        return '';
    }
    return renderObstacleLeaderboard(obstacleFocusVal, context);
}

export function renderObstacleLeaderboard(obstacleNum, context) {
    const { maratonStatusMap, allEquipages } = context;
    if (!obstacleNum) return '';

    const results = [];
    maratonStatusMap.forEach((data, sn) => {
        const obsArr = getObstacleArray(data);
        const item = obsArr.find(o => Number(o.number) === Number(obstacleNum));
        if (item && Number.isFinite(item.penalty)) {
            const eq = allEquipages.find(e => String(e.startNumber) === sn);
            if (eq) {
                results.push({
                    sn,
                    name: eq.driverName,
                    club: eq.clubName,
                    class: eq.className,
                    penalty: item.penalty
                });
            }
        }
    });

    results.sort((a, b) => a.penalty - b.penalty);
    const top10 = results.slice(0, 10);

    if (top10.length === 0) return '<div class="text-sm text-gray-400 p-4 text-center">Inga resultat för Hinder ' + obstacleNum + ' ännu.</div>';

    return `
    <div class="overflow-x-auto">
        <table class="w-full text-sm text-left text-gray-600 dark:text-gray-300">
            <thead class="text-xs text-gray-700 dark:text-gray-400 uppercase bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600">
                <tr>
                    <th class="px-3 py-2">#</th>
                    <th class="px-3 py-2">Ekipage</th>
                    <th class="px-3 py-2 text-right">Straff</th>
                </tr>
            </thead>
            <tbody>
                ${top10.map((r, i) => `
                <tr class="bg-white dark:bg-gray-800 border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer" onclick="window.selectSpeakerRider('${r.sn}')">
                    <td class="px-3 py-2 font-bold ${i < 3 ? 'text-brand-gold dark:text-yellow-500' : 'text-gray-400 dark:text-gray-500'}">${i + 1}</td>
                    <td class="px-3 py-2">
                        <div class="font-bold text-gray-800 dark:text-gray-200">${r.name}</div>
                        <div class="text-[10px] text-gray-500 dark:text-gray-400">${r.class} • ${r.club}</div>
                    </td>
                    <td class="px-3 py-2 text-right tabular-nums tracking-wide font-black text-gray-900 dark:text-white">${(r.penalty != null) ? r.penalty.toFixed(2) : '—'}</td>
                </tr>
                `).join('')}
            </tbody>
        </table>
    </div>`;
}

export function renderSectorAnalysis(context) {
    const { currentDiscipline, allEquipages, maratonStatusMap, formatMsLive, marathonConfig, limitsFor } = context;

    if (currentDiscipline !== 'maraton' && currentDiscipline !== 'totalt') {
        return { isHidden: true, html: '' };
    }

    const sectors = ['A', 'transport', 'B'];
    const entries = [];

    allEquipages.forEach(eq => {
        const sn = String(eq.startNumber);
        const data = maratonStatusMap.get(sn);
        if (!data) return;

        sectors.forEach(s => {
            const analysis = analyzeSectorProgress(data, s, eq);
            if (analysis) {
                // Only show if live OR finished < 5 mins ago
                const stop = stageStopTS(data, s);
                if (!stop || (Date.now() - stop < 300000)) {
                    entries.push({ sn, eq, analysis, data });
                }
            }
        });
    });

    if (entries.length === 0) {
        const reasons = [];
        let activeCount = 0;
        let limitFailures = 0;

        if (!marathonConfig) {
            reasons.push("DEBUG: Saknar maraton-konfiguration (marathonConfig).");
        } else if (maratonStatusMap.size === 0) {
            reasons.push("DEBUG: Inga status-data laddade (maratonStatusMap empty).");
        } else {
            allEquipages.forEach(eq => {
                const sn = String(eq.startNumber);
                const data = maratonStatusMap.get(sn);
                if (!data) return;
                ['A', 'transport', 'B'].forEach(s => {
                    const start = stageStartTS(data, s);
                    const stop = stageStopTS(data, s);
                    if (start && (!stop || (Date.now() - stop < 300000))) {
                        activeCount++;
                        const lim = limitsFor ? limitsFor(eq, s) : null;
                        if (!lim) {
                            limitFailures++;
                            const cls = eq.className;
                            const cfg = marathonConfig?.marathonClassData || {};
                            const keys = Object.keys(cfg);
                            const match = keys.find(k => cls.trim().toLowerCase().startsWith(k.trim().toLowerCase()));

                            if (!match) {
                                reasons.push(`DEBUG: Klass "${cls}" matchar inte någon nyckel i konfig. (Finns: ${keys.slice(0, 3).join(', ')}...)`);
                            } else {
                                const cData = cfg[match];
                                const flatDist = cData[`distance${s}`] || cData[`distance${s.toUpperCase()}`];
                                const nestDist = cData[s] ? cData[s].distance : undefined;
                                const nestDistUpper = cData[s.toUpperCase()] ? cData[s.toUpperCase()].distance : undefined;
                                const hasDist = (flatDist > 0 || nestDist > 0 || nestDistUpper > 0);

                                if (!hasDist) {
                                    reasons.push(`DEBUG: Klass "${cls}" (matchar "${match}") saknar DISTANS för ${s}. Gå till Inställningar.`);
                                } else {
                                    reasons.push(`DEBUG: Okänt fel på gränsvärden för "${cls}" (${s}).`);
                                }
                            }
                        }
                    }
                });
            });

            if (activeCount > 0 && limitFailures > 0) {
                reasons.push(`DEBUG: ${activeCount} aktiva, men ${limitFailures} saknar gränsvärden. <br>`);
            }
        }

        const msg = (reasons.length > 0)
            ? `<span class="text-red-500 font-bold text-left block text-xs overflow-x-auto whitespace-pre-wrap">${reasons.join('<br>')}</span>`
            : "Inga ekipage på vägsträckor just nu.";

        return {
            isHidden: false,
            html: `<div class="p-4 text-center text-gray-400 dark:text-gray-500 italic text-xs flex justify-center">${msg}</div>`
        };
    }

    entries.sort((a, b) => {
        if (a.analysis.isLive && !b.analysis.isLive) return -1;
        if (!a.analysis.isLive && b.analysis.isLive) return 1;
        return Math.abs(b.analysis.diff) - Math.abs(a.analysis.diff);
    });

    const html = `
    <div class="overflow-x-auto">
        <table class="w-full text-xs text-left text-gray-600 dark:text-gray-300">
            <thead class="text-[10px] text-gray-500 dark:text-gray-400 uppercase bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600">
                <tr>
                    <th class="px-3 py-2"># Ekipage</th>
                    <th class="px-3 py-2">Etapp</th>
                    <th class="px-3 py-2 text-right">Ideal</th>
                    <th class="px-3 py-2 text-right">Live / Result</th>
                    <th class="px-3 py-2 text-right">Diff</th>
                </tr>
            </thead>
            <tbody>
                ${entries.map(e => {
        const a = e.analysis;
        const diffSign = a.diff > 0 ? '+' : '';
        const livePulse = a.isLive ? 'animate-pulse' : '';
        const stageLabel = a.stage === 'transport' ? 'Transport' : `Etapp ${a.stage}`;

        const absDiff = Math.abs(a.diff);
        const m = Math.floor(absDiff / 60);
        const s = (absDiff % 60).toFixed(1);
        const diffText = m > 0
            ? `${diffSign}${m}:${s.padStart(4, '0')}`
            : `${diffSign}${s}s`;

        const stageKey = (String(a.stage || '').toUpperCase() === 'T') ? 'transport' : a.stage;
        const realStart = stageStartTS(e.data, stageKey);

        const liveAttrs = a.isLive
            ? `class="sector-live-timer font-bold tabular-nums tracking-wide px-3 py-2 text-right ${a.color} ${livePulse}" data-sn="${e.sn}" data-stage="${stageKey}" data-start="${realStart}" data-ideal="${a.ideal}"`
            : `class="font-bold tabular-nums tracking-wide px-3 py-2 text-right ${a.color}"`;

        return `
                    <tr class="bg-white dark:bg-gray-800 border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer" onclick="window.selectSpeakerRider('${e.sn}')">
                        <td class="px-3 py-2">
                             <div class="font-bold text-gray-900 dark:text-white leading-tight">#${e.sn} ${e.eq.driverName}</div>
                             <div class="text-[10px] text-gray-400 capitalize">${e.eq.clubName}</div>
                        </td>
                        <td class="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">${stageLabel}</td>
                        <td class="px-3 py-2 text-right tabular-nums tracking-wide">${msToLabel(a.ideal * 1000, false)}</td>
                        <td ${e.analysis.isLive ? `class="sector-live-elapsed px-3 py-2 text-right tabular-nums tracking-wide text-gray-900 dark:text-gray-200 font-bold" data-sn="${e.sn}" data-stage="${stageKey}" data-start="${realStart}"` : `class="px-3 py-2 text-right tabular-nums tracking-wide text-gray-400 dark:text-gray-500"`}>${formatMsLive(a.ms)}</td>
                        <td ${liveAttrs}>
                             ${diffText}
                        </td>
                    </tr>`;
    }).join('')}
            </tbody>
        </table>
    </div>`;

    return { isHidden: false, html };
}
