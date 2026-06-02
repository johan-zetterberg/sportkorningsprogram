export function removeMergeGroupsBySelection(groups = {}, groupKeys = [], selectedNums = []) {
    const nextGroups = { ...(groups || {}) };
    const keysToRemove = new Set(groupKeys || []);
    const numsToMatch = new Set((selectedNums || []).map(Number).filter(Number.isFinite));
    const numsToUnmerge = [];
    let changed = false;

    for (const key of keysToRemove) {
        if (!nextGroups[key]) continue;
        numsToUnmerge.push(...(nextGroups[key].members || []));
        delete nextGroups[key];
        changed = true;
    }

    if (numsToMatch.size > 0) {
        for (const [key, group] of Object.entries(nextGroups)) {
            const members = (group?.members || []).map(Number).filter(Number.isFinite);
            if (!members.some(num => numsToMatch.has(num))) continue;
            numsToUnmerge.push(...members);
            delete nextGroups[key];
            changed = true;
        }
    }

    return {
        changed,
        nextGroups,
        numsToUnmerge: [...new Set(numsToUnmerge.map(Number).filter(Number.isFinite))]
    };
}
