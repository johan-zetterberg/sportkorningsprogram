export function buildArchiveSuccessMessage(result = {}) {
    const rows = Number(result.rows);
    const rowText = Number.isFinite(rows) && rows > 0
        ? ` ${rows} resultatrad${rows === 1 ? '' : 'er'} ingick i arkivet.`
        : '';
    return `Tävlingen är nu avslutad och arkiverad.${rowText}\nPDF har laddats ner.`;
}

export function buildArchiveErrorMessage(error) {
    const message = error?.message ? String(error.message).trim() : '';
    return message
        ? `Arkiveringen avbröts: ${message}`
        : 'Arkiveringen avbröts på grund av ett okänt fel.';
}

export function renderArchiveStatusMessage(statusEl, {
    state = 'loading',
    message = 'Genererar slutresultat och PDF...'
} = {}) {
    if (!statusEl) return;

    const colorClass = state === 'error'
        ? 'text-red-700 dark:text-red-300'
        : state === 'success'
            ? 'text-green-700 dark:text-green-300'
            : 'text-gray-500 dark:text-gray-400 animate-pulse';
    const spinner = state === 'loading' ? '<div class="spinner mx-auto mb-2"></div>' : '';

    statusEl.innerHTML = `
        ${spinner}
        <p class="${colorClass}">${message}</p>
    `;
}
