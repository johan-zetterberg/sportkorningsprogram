/**
 * Service for calculating team competition results.
 * Aggregates individual results into team scores.
 */

function toFiniteOrNull(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function addFinite(sum, value) {
    return Number.isFinite(value) ? (sum ?? 0) + value : sum;
}

function buildMemberResult(memberId, resultMap) {
    const res = resultMap.get(String(memberId));
    if (!res) {
        return {
            memberId,
            startNumber: '?',
            name: 'Okänd',
            dressage: null,
            marathon: null,
            precision: null,
            penalty: null,
            currentPenalty: null,
            eliminated: false,
            complete: false,
            incomplete: true,
            valid: false
        };
    }

    const dressagePenalty = toFiniteOrNull(res.dressage?.penalty ?? res.dressage?.judgePenalty);
    const marathonPenalty = toFiniteOrNull(res.marathon?.totalPenalty);
    const precisionPenalty = toFiniteOrNull(res.precision?.totalPenalty ?? res.precision?.pen);
    const totalPenalty = toFiniteOrNull(res.totalPenalty);
    const isEliminated = !!res.isEliminated || res.totalPenalty === Infinity;
    const currentParts = [dressagePenalty, marathonPenalty, precisionPenalty].filter(Number.isFinite);
    const currentPenalty = currentParts.length ? currentParts.reduce((sum, value) => sum + value, 0) : null;
    const complete = !isEliminated && totalPenalty != null;

    return {
        memberId,
        startNumber: res.startNumber,
        name: res.driverName,
        dressage: dressagePenalty,
        marathon: marathonPenalty,
        precision: precisionPenalty,
        penalty: complete ? totalPenalty : null,
        currentPenalty,
        eliminated: isEliminated,
        complete,
        incomplete: !isEliminated && !complete,
        valid: !isEliminated && (complete || currentPenalty != null),
        details: res
    };
}

/**
 * Calculates team results based on individual equipage results.
 *
 * Rules:
 * - Best 3 non-eliminated members count.
 * - Missing future disciplines make the team incomplete, not eliminated.
 * - A team is eliminated only when fewer than 3 members can still count.
 *
 * @param {Array} teams - List of team objects [{ id, name, members: [id, id...] }]
 * @param {Array} equipageResults - List of calculated result rows
 * @returns {Array} Team results with member data and rank.
 */
export function calculateTeamResults(teams, equipageResults) {
    if (!Array.isArray(teams)) return [];
    if (!Array.isArray(equipageResults)) return [];

    const resultMap = new Map();
    equipageResults.forEach((row) => {
        if (row?.id) resultMap.set(String(row.id), row);
    });

    const teamResults = teams.map((team) => {
        const members = (team.members || []).map(memberId => buildMemberResult(memberId, resultMap));

        members.sort((a, b) => {
            if (a.valid && !b.valid) return -1;
            if (!a.valid && b.valid) return 1;
            return (a.currentPenalty ?? Infinity) - (b.currentPenalty ?? Infinity);
        });

        let teamDressage = null;
        let teamMarathon = null;
        let teamPrecision = null;
        let teamTotal = null;
        let validCount = 0;
        const countingMembers = [];

        members.forEach((member) => {
            if (member.valid && validCount < 3) {
                teamDressage = addFinite(teamDressage, member.dressage);
                teamMarathon = addFinite(teamMarathon, member.marathon);
                teamPrecision = addFinite(teamPrecision, member.precision);
                if (member.complete) teamTotal = addFinite(teamTotal, member.penalty);

                validCount += 1;
                countingMembers.push(member);
                member.isCounting = true;
            } else {
                member.isCounting = false;
            }
        });

        const potentiallyCountingCount = members.filter(member => !member.eliminated).length;
        const remainingMembersAreFinal = members.every(member => member.eliminated || member.complete);
        const isEliminated = potentiallyCountingCount < 3 && remainingMembersAreFinal;
        const isIncomplete = !isEliminated && (validCount < 3 || countingMembers.some(member => !member.complete));

        return {
            teamId: team.id,
            teamName: team.name,
            total: isIncomplete ? null : teamTotal,
            dressage: teamDressage,
            marathon: teamMarathon,
            precision: teamPrecision,
            isEliminated,
            isIncomplete,
            members
        };
    });

    teamResults.sort((a, b) => {
        if (!a.isEliminated && b.isEliminated) return -1;
        if (a.isEliminated && !b.isEliminated) return 1;
        if (!a.isIncomplete && b.isIncomplete) return -1;
        if (a.isIncomplete && !b.isIncomplete) return 1;
        if (a.isEliminated && b.isEliminated) return 0;
        if (a.isIncomplete && b.isIncomplete) return (a.dressage ?? Infinity) - (b.dressage ?? Infinity);
        return (a.total ?? Infinity) - (b.total ?? Infinity);
    });

    let place = 1;
    teamResults.forEach((team) => {
        if (!team.isEliminated && !team.isIncomplete) {
            team.rank = place++;
        } else {
            team.rank = null;
        }
    });

    return teamResults;
}
