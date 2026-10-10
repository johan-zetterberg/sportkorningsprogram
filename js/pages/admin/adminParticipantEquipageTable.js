function formatPaymentStatus(payment) {
    if (!payment) return '<span class="text-red-400">Ej betald</span>';
    if (payment.status === 'paid') return `<span class="text-green-600 font-bold">OK ${payment.amount ? payment.amount + ' kr' : ''}</span>`;
    if (payment.status === 'partial') return `<span class="text-amber-600 font-bold">Delvis ${payment.amount ? '(' + payment.amount + ' kr)' : ''}</span>`;
    return '<span class="text-red-400">Ej betald</span>';
}

function formatTdbClassNumber(equipage) {
    if (equipage?.tdbClassNumber == null || equipage.tdbClassNumber === '') return '-';
    return `#${equipage.tdbClassNumber}`;
}

export function renderAdminEquipageTable(equipages, { onSelectEquipage, onRendered } = {}) {
    const head = document.getElementById('adminEquipageTableHead');
    const body = document.getElementById('adminEquipageTableBody');
    if (!body || !head) return;

    const sorted = [...equipages].sort((a, b) => a.startNumber - b.startNumber);

    head.innerHTML = `<tr>
        <th class="p-3 text-left dark:text-gray-300">Startnr</th>
        <th class="p-3 text-left dark:text-gray-300">Kusk</th>
        <th class="p-3 text-left dark:text-gray-300">TDB</th>
        <th class="p-3 text-left dark:text-gray-300">Klass</th>
        <th class="p-3 text-left dark:text-gray-300">Vagn</th>
        <th class="p-3 text-left dark:text-gray-300">Betald</th>
        <th class="p-3 text-left dark:text-gray-300">Status</th>
    </tr>`;

    body.innerHTML = sorted.map(equipage => `
        <tr class="hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer dark:text-gray-200" id="row-${equipage.startNumber}">
        <td class="p-3 font-bold">${equipage.startNumber}</td>
        <td class="p-3">
            <div class="flex items-center gap-1.5 flex-wrap">
                <span class="font-medium">${equipage.driverName}</span>
                ${equipage.hasMultipleStarts ? `
                    <span class="inline-flex items-center gap-1 rounded bg-indigo-100 dark:bg-indigo-900/40 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800" title="Kusken har ${equipage.driverStartCount} starter (TR Mom 535.4)">
                        <i class="fa fa-clone text-[10px]"></i> ${equipage.driverStartCount} starter
                    </span>
                ` : ''}
            </div>
            <div class="text-xs text-gray-500 dark:text-gray-400">${equipage.clubName}</div>
        </td>
        <td class="p-3 text-sm font-mono text-gray-600 dark:text-gray-400">${formatTdbClassNumber(equipage)}</td>
        <td class="p-3">${(equipage.useMergedTestForDisplay && equipage.mergedTestLabel) ? equipage.mergedTestLabel : equipage.className}</td>
        <td class="p-3 text-sm text-gray-600 dark:text-gray-400">
            ${equipage.trackWidth ? `${equipage.trackWidth} cm` : '-'}
            ${equipage.trackWidthSource === 'registry' ? '<span class="ml-1 text-[10px] text-blue-600 dark:text-blue-400 font-medium" title="Förifylld från sparad vagn">(sparad)</span>' : ''}
        </td>
        <td class="p-3">${formatPaymentStatus(equipage.payment)}</td>
        <td class="p-3 ${equipage.status === 'struken' ? 'text-red-500 dark:text-red-400' : 'text-green-600 dark:text-green-400'}">${equipage.status}</td>
    </tr>
        `).join('');

    Array.from(body.rows).forEach((row, index) => {
        row.onclick = () => {
            if (typeof onSelectEquipage === 'function') {
                onSelectEquipage(sorted[index]);
            }
        };
    });

    if (typeof onRendered === 'function') {
        onRendered();
    }
}
