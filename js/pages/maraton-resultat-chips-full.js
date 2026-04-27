
function renderObstacleChips(d, maxObs) {
    const arr = getObstacleArray(d);
    let html = '<div class="flex flex-wrap gap-1 mt-2">';
    for (let i = 1; i <= maxObs; i++) {
        const o = arr.find(x => Number(x.number || x.no || x.nr) === i);
        let cls = 'bg-gray-100 dark:bg-gray-700 text-gray-400';
        let val = i;

        if (o) {
            if (o.eliminated) {
                cls = 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 font-bold';
                val = 'E';
            } else if (Number.isFinite(Number(o.penalty))) {
                cls = 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-bold';
                // val = o.penalty; // Visa straff? User interface shows number usually, colored if penalty.
            }
        }

        html += `<div class="w-6 h-6 flex items-center justify-center rounded text-xs ${cls}">${val}</div>`;
    }
    html += '</div>';
    return html;
}

function renderMaratonClassChips() {
    const host = document.getElementById('maratonClassChips');
    if (!host) return;

    // Hämta unika klasser från filtrerad lista
    // Eller alla i maraton_equipages? Bäst att visa alla tillgängliga för att kunna filtrera
    const classes = new Set();
    maraton_equipages.forEach(eq => {
        const k = eq._mergedLabel || eq.className || '';
        if (k) classes.add(k);
    });

    if (classes.size === 0) {
        host.innerHTML = '';
        return;
    }

    const sorted = [...classes].sort();

    host.innerHTML = sorted.map(cls => {
        const active = maraton_activeClassFilters.has(cls);
        const clsStr = active
            ? 'bg-blue-600 text-white shadow-md'
            : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600';

        return `<button data-class="${cls}" class="px-3 py-1 rounded-full text-xs font-medium transition-colors ${clsStr}">
      ${cls}
    </button>`;
    }).join('');
}
