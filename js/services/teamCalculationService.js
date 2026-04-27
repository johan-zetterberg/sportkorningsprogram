/**
 * Service for calculating Team Competition results.
 * Aggregates individual results into team scores.
 */

/**
 * Calculates team results based on individual equipage results.
 * 
 * Rules (Standard):
 * - Each team has 3-4 members.
 * - Best 3 scores count.
 * - If a team has fewer than 3 completing members, they are usually eliminated or ranked at bottom.
 *   (For now: we sum available scores but mark as incomplete/eliminated if < 3)
 * 
 * @param {Array} teams - List of team objects [{ id, name, members: [id, id...] }]
 * @param {Array} equipageResults - List of calculated results [{ startNumber, totalPenalty, isEliminated, ... }]
 * @returns {Array} - List of team results with detailed member data and sorted by rank.
 */
export function calculateTeamResults(teams, equipageResults) {
    if (!teams || !Array.isArray(teams)) return [];
    if (!equipageResults || !Array.isArray(equipageResults)) return [];

    // Map results by ID (string) for fast lookup
    // total-resultat.js uses startNumber or id? 
    // equipageResults comes from processedResults which has startNumber (int/string) and id (string)
    // Check total-resultat.js: it uses equipages which have 'id'.
    // We should map by 'id' since teams store 'id'.
    const resultMap = new Map();
    equipageResults.forEach(r => {
        // We need the ID. processedResults in total-resultat usually merges equipage data.
        // Let's assume r.id matches the team member ID.
        if (r.id) resultMap.set(String(r.id), r);
    });

    const teamResults = teams.map(team => {
        const members = (team.members || []).map(mId => {
            const res = resultMap.get(String(mId));
            if (!res) {
                // Resultat saknas helt (kanske struken innan tävling)
                return {
                    memberId: mId,
                    startNumber: '?',
                    name: 'Okänd',
                    penalty: 9999,
                    eliminated: true,
                    valid: false
                };
            }

            return {
                memberId: mId,
                startNumber: res.startNumber,
                name: res.driverName,
                // Individual Penalties
                dressage: res.dressage?.penalty || 0,
                marathon: res.marathon?.totalPenalty || 0,
                precision: res.precision?.totalPenalty || 0,

                penalty: Number(res.totalPenalty) || 0,
                eliminated: !!res.isEliminated || res.totalPenalty == null, // Null penalty = not done/elim
                valid: !res.isEliminated && res.totalPenalty != null,
                details: res // Keep full ref for UI if needed
            };
        });

        // Sortera medlemmar: Lägst straff först. Eliminerade sist.
        members.sort((a, b) => {
            if (a.valid && !b.valid) return -1;
            if (!a.valid && b.valid) return 1;
            return a.penalty - b.penalty;
        });

        // Räkna poäng (Bästa 3)
        let teamTotal = 0;
        let teamDressage = 0;
        let teamMarathon = 0;
        let teamPrecision = 0;

        let validCount = 0;
        const countingMembers = [];
        const scratchMembers = [];

        // Vi tar de 3 bästa GILTIGA resultaten
        // Om vi har färre än 3 giltiga, är laget uteslutet (eller ofullständigt)

        for (let i = 0; i < members.length; i++) {
            const m = members[i];
            // We sum the best 3 TOTAL results. 
            // The team discipline scores are the sum of those SAME 3 members' discipline scores.
            if (m.valid && validCount < 3) {
                teamTotal += m.penalty;
                teamDressage += m.dressage;
                teamMarathon += m.marathon;
                teamPrecision += m.precision;

                validCount++;
                countingMembers.push(m);
                m.isCounting = true;
            } else {
                scratchMembers.push(m);
                m.isCounting = false;
            }
        }

        const isEliminated = validCount < 3;

        return {
            teamId: team.id,
            teamName: team.name,
            total: teamTotal,
            dressage: teamDressage,
            marathon: teamMarathon,
            precision: teamPrecision,
            isEliminated: isEliminated,
            members: members // Sorted: Counting first, then scratches
        };
    });

    // Sortera lagen
    // 1. Icke-eliminerade före eliminerade
    // 2. Lägst totalstraff
    teamResults.sort((a, b) => {
        if (!a.isEliminated && b.isEliminated) return -1;
        if (a.isEliminated && !b.isEliminated) return 1;
        if (a.isEliminated && b.isEliminated) return 0; // Båda ute
        return a.total - b.total;
    });

    // Tilldela placering
    let place = 1;
    teamResults.forEach(t => {
        if (!t.isEliminated) {
            t.rank = place++;
        } else {
            t.rank = null;
        }
    });

    return teamResults;
}
