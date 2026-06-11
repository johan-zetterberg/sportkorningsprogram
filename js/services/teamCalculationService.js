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
            valid: false,
            isDressageElim: false,
            isMarathonElim: false,
            isPrecisionElim: false,
            isMemberEliminatedFromTeam: false,
            details: {}
        };
    }

    const dressagePenalty = toFiniteOrNull(res.dressage?.penalty ?? res.dressage?.judgePenalty);
    const marathonPenalty = toFiniteOrNull(res.marathon?.totalPenalty);
    const precisionPenalty = toFiniteOrNull(res.precision?.totalPenalty ?? res.precision?.pen);
    const totalPenalty = toFiniteOrNull(res.totalPenalty);

    const isDressageElim = res.dressageStatus === 'elim' || res.dressage?.eliminated === true;
    const isMarathonElim = res.marathonStatus === 'elim' || res.marathon?.eliminated === true || res.marathon?.totalPenalty === Infinity;
    const isPrecisionElim = res.precisionStatus === 'elim' || res.precision?.eliminated === true || res.precision?.totalPenalty === Infinity;

    const isScratched = String(res.status || '').toLowerCase().includes('struken');
    const isMemberEliminatedFromTeam = isScratched || (isDressageElim && isMarathonElim && isPrecisionElim);

    const isDressageComplete = dressagePenalty !== null || isDressageElim;
    const isMarathonComplete = marathonPenalty !== null || isMarathonElim;
    const isPrecisionComplete = precisionPenalty !== null || isPrecisionElim;
    const complete = !isMemberEliminatedFromTeam && isDressageComplete && isMarathonComplete && isPrecisionComplete;
    const currentParts = [
        dressagePenalty !== null && !isDressageElim ? dressagePenalty : null,
        marathonPenalty !== null && !isMarathonElim ? marathonPenalty : null,
        precisionPenalty !== null && !isPrecisionElim ? precisionPenalty : null
    ].filter(v => v !== null);
    const currentPenalty = currentParts.length ? currentParts.reduce((sum, value) => sum + value, 0) : null;

    return {
        memberId,
        startNumber: res.startNumber,
        name: res.driverName,
        dressage: dressagePenalty,
        marathon: marathonPenalty,
        precision: precisionPenalty,
        penalty: complete ? totalPenalty : null,
        currentPenalty,
        eliminated: isMemberEliminatedFromTeam,
        complete,
        incomplete: !isMemberEliminatedFromTeam && !complete,
        valid: !isMemberEliminatedFromTeam && (complete || currentPenalty != null),
        isDressageElim,
        isMarathonElim,
        isPrecisionElim,
        isMemberEliminatedFromTeam,
        details: res
    };
}

/**
 * Calculates team results based on individual equipage results.
 *
 * Rules:
 * - Best 3 results in Dressage, Marathon, and Cones (Precision) count separately.
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

        // 1. DRESSAGE
        const validDressage = members.filter(m => m.dressage !== null && !m.isDressageElim);
        validDressage.sort((a, b) => a.dressage - b.dressage);
        const countingDressage = validDressage.slice(0, 3);
        countingDressage.forEach(m => m.isCountingDressage = true);
        const teamDressage = countingDressage.length > 0 ? countingDressage.reduce((sum, m) => sum + m.dressage, 0) : null;

        // 2. MARATHON
        const validMarathon = members.filter(m => m.marathon !== null && !m.isMarathonElim);
        validMarathon.sort((a, b) => a.marathon - b.marathon);
        const countingMarathon = validMarathon.slice(0, 3);
        countingMarathon.forEach(m => m.isCountingMarathon = true);
        const teamMarathon = countingMarathon.length > 0 ? countingMarathon.reduce((sum, m) => sum + m.marathon, 0) : null;

        // 3. PRECISION
        const validPrecision = members.filter(m => m.precision !== null && !m.isPrecisionElim);
        validPrecision.sort((a, b) => a.precision - b.precision);
        const countingPrecision = validPrecision.slice(0, 3);
        countingPrecision.forEach(m => m.isCountingPrecision = true);
        const teamPrecision = countingPrecision.length > 0 ? countingPrecision.reduce((sum, m) => sum + m.precision, 0) : null;

        // Set counting flags and overall counting flag for UI
        members.forEach(m => {
            m.isCountingDressage = m.isCountingDressage || false;
            m.isCountingMarathon = m.isCountingMarathon || false;
            m.isCountingPrecision = m.isCountingPrecision || false;
            m.isCounting = m.isCountingDressage || m.isCountingMarathon || m.isCountingPrecision;
        });

        // Determine if team is eliminated or incomplete
        const potentiallyCountingCount = members.filter(m => !m.isMemberEliminatedFromTeam).length;
        const remainingMembersAreFinal = members.every(m => m.isMemberEliminatedFromTeam || m.complete);
        const isEliminated = potentiallyCountingCount < 3 && remainingMembersAreFinal;

        const isAnyCountingIncomplete = members.some(m => m.isCounting && !m.complete);
        const hasFewerThanThreeStarters = potentiallyCountingCount < 3;
        const isIncomplete = !isEliminated && (isAnyCountingIncomplete || hasFewerThanThreeStarters || teamDressage === null || teamMarathon === null || teamPrecision === null);

        const teamTotal = (teamDressage !== null ? teamDressage : 0) +
                          (teamMarathon !== null ? teamMarathon : 0) +
                          (teamPrecision !== null ? teamPrecision : 0);

        return {
            teamId: team.id,
            teamName: team.name,
            total: (isEliminated || isIncomplete) ? null : teamTotal,
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

        if (a.isIncomplete && b.isIncomplete) {
            const scoreA = (a.dressage ?? 0) + (a.marathon ?? 0) + (a.precision ?? 0);
            const scoreB = (b.dressage ?? 0) + (b.marathon ?? 0) + (b.precision ?? 0);
            if (scoreA !== scoreB) return scoreA - scoreB;
            return 0;
        }

        // Both are complete
        if (a.total !== b.total) return a.total - b.total;

        // Tie-breakers!
        // 1. Best individual placement among counting members
        const getBestIndividualPlac = (team) => {
            const places = team.members
                .filter(m => m.isCounting && m.details && m.details.plac != null)
                .map(m => Number(m.details.plac));
            return places.length > 0 ? Math.min(...places) : Infinity;
        };
        const bestPlacA = getBestIndividualPlac(a);
        const bestPlacB = getBestIndividualPlac(b);
        if (bestPlacA !== bestPlacB) return bestPlacA - bestPlacB;

        // 2. Sum of counting marathon scores (lowest first)
        const marA = a.marathon ?? Infinity;
        const marB = b.marathon ?? Infinity;
        if (marA !== marB) return marA - marB;

        // 3. Sum of counting dressage scores (lowest first)
        const drA = a.dressage ?? Infinity;
        const drB = b.dressage ?? Infinity;
        if (drA !== drB) return drA - drB;

        // 4. Sum of counting precision scores (lowest first)
        const prA = a.precision ?? Infinity;
        const prB = b.precision ?? Infinity;
        if (prA !== prB) return prA - prB;

        return 0;
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
