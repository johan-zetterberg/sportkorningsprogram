
function getMaxObstacleNo() {
    let max = 0;
    // Gå igenom alla laddade (och relevanta) ekipage i mappen
    for (const eq of maraton_equipages) {
        const sn = String(eq.startNumber);
        const d = maraton_marathonMap.get(sn);
        if (!d) continue;

        // 1) Kolla 'obstacles' array
        const arr = d.obstacles || d.hinder || [];
        if (Array.isArray(arr)) {
            arr.forEach(o => {
                const n = Number(o.number);
                if (Number.isFinite(n) && n > max) max = n;
            });
        }

        // 2) Kolla om det finns "obstacles.{items}" från calculateMarathonResult?
        // Nej, vi tittar på rådata här.
    }

    // Fallback: om ingen har data, visa 8 st (standard)
    return max > 0 ? max : 8;
}

function rowStageCellsHTML(res) {
    const STAGE_KEYS = ['A', 'transport', 'B'];
    // Visa bara de som är aktiverade (enkelt filter eller alla)
    // Vi kör alla 3 kolumnerna om vi inte har strikt config
    // Men i renderTable har vi activeStages. 
    // Här hårdkodar vi generering för A, T, B för enkelhetens skull, 
    // eller så måste vi veta vilka som är aktiva.
    // Låt oss generera alla tre, CSS/Table-headern styr vad som visas?
    // Nej, vi måste matcha headern.

    // Vi kollar global config om vi kommer åt den, annars default.
    // För säkerhets skull: generera celler för de sträckor som syns i headern.
    // Headern i renderTable: activeStages.
    // Vi gör en snabbkoll på maraton_marathonConfig eller bara A, T, B.

    // Bäst att matcha STAGE_KEYS.filter(stageEnabled) logiken.
    const active = STAGE_KEYS.filter(stageEnabled);

    return active.map(st => {
        const s = res.stages[st];
        if (!s) return '<td></td>';

        // Tid (durationMs) -> "mm:ss"
        const timeLabel = s.durationMs ? formatMsLive(s.durationMs) : '—';
        // Straff
        const pen = s.timePenalty;
        const penLabel = (pen === Infinity) ? 'ELIM' : (isNum(pen) ? pen.toFixed(2) : '');

        // Bygg innehåll
        // Vi visar Tid överst, Straff underst (liten text)
        return `
      <td class="px-2 py-2 text-center text-sm">
        <div class="text-gray-900 dark:text-gray-200">${timeLabel}</div>
        ${(pen > 0 || pen === Infinity) ? `<div class="text-xs text-red-600 font-bold">${penLabel}</div>` : ''}
      </td>
    `;
    }).join('');
}

function stageEnabled(s) {
    // Enkelt: Visa alltid A och B. Transport (T) om config säger det.
    if (s === 'A' || s === 'B') return true;
    if (s === 'transport') {
        // Kolla config
        return maraton_marathonConfig?.showTransport === true;
    }
    return false;
}
