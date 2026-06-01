export function resolveTotalResultsJsPdf({
    jspdfNamespace = typeof window !== 'undefined' ? window.jspdf : null,
    alertFn = typeof alert !== 'undefined' ? alert : null,
    throwOnMissing = false
} = {}) {
    const jsPDF = jspdfNamespace?.jsPDF;
    if (jsPDF) return jsPDF;

    const message = 'Kunde inte ladda PDF-biblioteket.';
    if (throwOnMissing) {
        throw new Error(message);
    }

    if (typeof alertFn === 'function') {
        alertFn(message);
    }
    return null;
}
