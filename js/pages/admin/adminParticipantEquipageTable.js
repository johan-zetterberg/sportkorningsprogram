function formatPaymentStatus(payment) {
    if (!payment) return '<span class="text-red-400">Ej betald</span>';
    if (payment.status === 'paid') return `<span class="text-green-600 font-bold">OK ${payment.amount ? payment.amount + ' kr' : ''}</span>`;
    if (payment.status === 'partial') return `<span class="text-amber-600 font-bold">Delvis ${payment.amount ? '(' + payment.amount + ' kr)' : ''}</span>`;
    return '<span class="text-red-400">Ej betald</span>';
}

export function renderAdminEquipageTable(equipages, { onSelectEquipage, onRendered } = {}) {
    const head = document.getElementById('adminEquipageTableHead');
    const body = document.getElementById('adminEquipageTableBody');
    if (!body || !head) return;

    const sorted = [...equipages].sort((a, b) => a.startNumber - b.startNumber);

    head.innerHTML = `<tr>
        <th class="p-3 text-left dark:text-gray-300">Startnr</th>
        <th class="p-3 text-left dark:text-gray-300">Kusk</th>
        <th class="p-3 text-left dark:text-gray-300">Klass</th>
        <th class="p-3 text-left dark:text-gray-300">Vagn</th>
        <th class="p-3 text-left dark:text-gray-300">Betald</th>
        <th class="p-3 text-left dark:text-gray-300">Status</th>
    </tr>`;

    body.innerHTML = sorted.map(equipage => `
        <tr class="hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer dark:text-gray-200" id="row-${equipage.startNumber}">
        <td class="p-3 font-bold">${equipage.startNumber}</td>
        <td class="p-3">${equipage.driverName}<div class="text-xs text-gray-500 dark:text-gray-400">${equipage.clubName}</div></td>
        <td class="p-3">${(equipage.useMergedTestForDisplay && equipage.mergedTestLabel) ? equipage.mergedTestLabel : equipage.className}</td>
        <td class="p-3 text-sm text-gray-600 dark:text-gray-400">${equipage.trackWidth || '-'} cm</td>
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
