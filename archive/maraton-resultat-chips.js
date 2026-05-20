
function renderObstacleChips(d, maxObs) {
    const arr = getObstacleArray(d);
    let html = '<div class="flex flex-wrap gap-1 mt-2">';
    for (let i = 1; i <= maxObs; i++) {
        const o = arr.find(x => Number(x.number) === i);
        let cls = 'bg-gray-100 dark:bg-gray-700 text-gray-400';
        let val = i;

        if (o) {
            if (o.eliminated) {
                cls = 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 font-bold';
                val = 'E';
            } else if (Number.isFinite(Number(o.penalty))) {
                cls = 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-bold';
            }
        }

        html += `<div class="w-6 h-6 flex items-center justify-center rounded text-xs ${cls}">${val}</div>`;
    }
    html += '</div>';
    return html;
}
