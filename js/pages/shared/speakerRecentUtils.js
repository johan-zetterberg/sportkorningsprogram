function normalizeStartNumber(sn) {
    return String(sn);
}

export function findRecentResultIndex(recentResults, sn) {
    const startNumber = normalizeStartNumber(sn);
    return recentResults.findIndex(result => String(result.sn) === startNumber);
}

export function removeRecentResult(recentResults, sn) {
    const idx = findRecentResultIndex(recentResults, sn);
    if (idx < 0) return false;

    recentResults.splice(idx, 1);
    return true;
}

export function upsertRecentResult(recentResults, entry, options = {}) {
    const idx = findRecentResultIndex(recentResults, entry?.sn);
    if (idx < 0) {
        recentResults.unshift(entry);
        return true;
    }

    if (options.skipUnchanged && JSON.stringify(recentResults[idx]) === JSON.stringify(entry)) {
        return false;
    }

    if (options.mergeExisting) {
        Object.assign(recentResults[idx], entry);
    } else {
        recentResults[idx] = entry;
    }
    return true;
}
