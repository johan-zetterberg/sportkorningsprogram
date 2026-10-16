/**
 * Service for calculating team competition results.
 * Aggregates individual results into team scores.
 */

import { getTeamScoringProfile, TEAM_SCORING_PROFILE_IDS } from './teamRuleProfiles.js';
import { normalizeCountryCode } from './flagsService.js';

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

    const statusLower = String(res.status || '').toLowerCase();
    const isScratched = statusLower.includes('struken') || statusLower === 'withdrawn' || statusLower === 'scratched' || Boolean(res.struken || res.withdrawn);
    // TR V 501.2 (as FEI): an equipage's results count for the team only if
    // it completed the competition without elimination in any phase, so an
    // elimination anywhere takes all of the member's results out
    const isMemberEliminatedFromTeam = isScratched || res.isEliminated === true
      || isDressageElim || isMarathonElim || isPrecisionElim;

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
function calculateLegacyTeamResults(teams, equipageResults) {
    if (!Array.isArray(teams)) return [];
    if (!Array.isArray(equipageResults)) return [];

    const resultMap = new Map();
    equipageResults.forEach((row) => {
        if (row?.id) resultMap.set(String(row.id), row);
    });

    const teamResults = teams.map((team) => {
        const members = (team.members || []).map(memberId => buildMemberResult(memberId, resultMap));

        // 1. DRESSAGE
        const validDressage = members.filter(m => !m.isMemberEliminatedFromTeam && m.dressage !== null && !m.isDressageElim);
        validDressage.sort((a, b) => a.dressage - b.dressage);
        const countingDressage = validDressage.slice(0, 3);
        countingDressage.forEach(m => m.isCountingDressage = true);
        const teamDressage = countingDressage.length > 0 ? Math.round(countingDressage.reduce((sum, m) => sum + m.dressage, 0) * 100) / 100 : null;

        // 2. MARATHON
        const validMarathon = members.filter(m => !m.isMemberEliminatedFromTeam && m.marathon !== null && !m.isMarathonElim);
        validMarathon.sort((a, b) => a.marathon - b.marathon);
        const countingMarathon = validMarathon.slice(0, 3);
        countingMarathon.forEach(m => m.isCountingMarathon = true);
        const teamMarathon = countingMarathon.length > 0 ? Math.round(countingMarathon.reduce((sum, m) => sum + m.marathon, 0) * 100) / 100 : null;

        // 3. PRECISION
        const validPrecision = members.filter(m => !m.isMemberEliminatedFromTeam && m.precision !== null && !m.isPrecisionElim);
        validPrecision.sort((a, b) => a.precision - b.precision);
        const countingPrecision = validPrecision.slice(0, 3);
        countingPrecision.forEach(m => m.isCountingPrecision = true);
        const teamPrecision = countingPrecision.length > 0 ? Math.round(countingPrecision.reduce((sum, m) => sum + m.precision, 0) * 100) / 100 : null;

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

        const teamTotal = Math.round(((teamDressage !== null ? teamDressage : 0) +
                          (teamMarathon !== null ? teamMarathon : 0) +
                          (teamPrecision !== null ? teamPrecision : 0)) * 100) / 100;

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

function getLagSmPhaseElimination(result, discipline) {
    const phase = result?.[discipline] || {};
    const status = String(result?.[`${discipline}Status`] || '').toLowerCase();
    const penalty = discipline === 'dressage'
        ? phase.penalty ?? phase.judgePenalty
        : phase.totalPenalty ?? phase.pen;
    const hasNumericPenalty = Number.isFinite(toFiniteOrNull(penalty));

    return phase.eliminated === true
        || penalty === Infinity
        // Totalresultat kan markera alla moment som ELIM efter en uteslutning.
        // Anvand statusen bara nar det aktuella momentet saknar eget resultat.
        || (!hasNumericPenalty && (status === 'elim' || status === 'eliminated'));
}

function getLagSmPhasePenalty(result, discipline) {
    const phase = result?.[discipline] || {};
    const rawPenalty = discipline === 'dressage'
        ? phase.penalty ?? phase.judgePenalty
        : phase.totalPenalty ?? phase.pen;
    const eliminated = getLagSmPhaseElimination(result, discipline);
    const penalty = toFiniteOrNull(rawPenalty);

    return {
        penalty: eliminated ? 500 : penalty,
        eliminated,
        isTeamPenalty500: eliminated
    };
}

function buildLagSmMemberResult(memberId, resultMap) {
    const result = resultMap.get(String(memberId));
    if (!result) {
        return {
            memberId,
            startNumber: '?',
            name: 'Okand',
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
            isDressageTeamPenalty: false,
            isMarathonTeamPenalty: false,
            isPrecisionTeamPenalty: false,
            isMemberEliminatedFromTeam: false,
            details: {}
        };
    }

    const dressage = getLagSmPhasePenalty(result, 'dressage');
    const marathon = getLagSmPhasePenalty(result, 'marathon');
    const precision = getLagSmPhasePenalty(result, 'precision');
    const statusLower = String(result.status || '').toLowerCase();
    const isScratched = statusLower.includes('struken') || statusLower === 'withdrawn' || statusLower === 'scratched' || Boolean(result.struken || result.withdrawn);
    const phasePenalties = [dressage.penalty, marathon.penalty, precision.penalty];
    const complete = !isScratched && phasePenalties.every(Number.isFinite);
    const currentPenalty = phasePenalties.some(Number.isFinite)
        ? phasePenalties.reduce((sum, penalty) => addFinite(sum, penalty), null)
        : null;

    return {
        memberId,
        startNumber: result.startNumber,
        name: result.driverName,
        dressage: dressage.penalty,
        marathon: marathon.penalty,
        precision: precision.penalty,
        penalty: complete ? currentPenalty : null,
        currentPenalty,
        // A struken ekipage has not started the phase and cannot be replaced by a 500 result.
        eliminated: isScratched,
        complete,
        incomplete: !isScratched && !complete,
        valid: !isScratched && currentPenalty !== null,
        isDressageElim: dressage.eliminated,
        isMarathonElim: marathon.eliminated,
        isPrecisionElim: precision.eliminated,
        isDressageTeamPenalty: dressage.isTeamPenalty500,
        isMarathonTeamPenalty: marathon.isTeamPenalty500,
        isPrecisionTeamPenalty: precision.isTeamPenalty500,
        isMemberEliminatedFromTeam: isScratched,
        details: result
    };
}

function assignLagSmDisciplineRanks(teamResults) {
    ['dressage', 'marathon', 'precision'].forEach((discipline) => {
        const ranked = teamResults
            .filter(team => !team.isInvalid && Number.isFinite(team[discipline]))
            .sort((a, b) => a[discipline] - b[discipline]);

        let previousScore = null;
        let currentRank = 0;
        ranked.forEach((team, index) => {
            if (previousScore === null || Math.abs(team[discipline] - previousScore) > 0.0001) {
                currentRank = index + 1;
            }
            team.disciplineRanks[discipline] = currentRank;
            previousScore = team[discipline];
        });
    });
}

function compareLagSmPlacement(a, b) {
    if (!a.isIncomplete && b.isIncomplete) return -1;
    if (a.isIncomplete && !b.isIncomplete) return 1;
    if (a.isIncomplete && b.isIncomplete) return 0;

    if (a.total !== b.total) return a.total - b.total;
    if (a.marathon !== b.marathon) return a.marathon - b.marathon;
    if (a.dressage !== b.dressage) return a.dressage - b.dressage;
    if (a.lowestIndividualDressage !== b.lowestIndividualDressage) {
        return a.lowestIndividualDressage - b.lowestIndividualDressage;
    }
    return 0;
}

function compareLagSmTeams(a, b) {
    const placementComparison = compareLagSmPlacement(a, b);
    return placementComparison || String(a.teamName || '').localeCompare(String(b.teamName || ''), 'sv');
}

function calculateLagSmResults(teams, equipageResults, profile) {
    const resultMap = new Map();
    equipageResults.forEach((row) => {
        if (row?.id) resultMap.set(String(row.id), row);
    });

    const teamResults = teams.map((team) => {
        const members = (team.members || []).map(memberId => buildLagSmMemberResult(memberId, resultMap));
        const memberCount = members.length;
        const isInvalid = memberCount < profile.minimumMembers || memberCount > profile.maximumMembers;
        const teamScores = {};

        ['dressage', 'marathon', 'precision'].forEach((discipline) => {
            const countingMembers = members
                .filter(member => !member.isMemberEliminatedFromTeam && Number.isFinite(member[discipline]))
                .sort((a, b) => a[discipline] - b[discipline])
                .slice(0, profile.countingPerDiscipline);

            countingMembers.forEach((member) => {
                member[`isCounting${discipline[0].toUpperCase()}${discipline.slice(1)}`] = true;
            });

            teamScores[discipline] = countingMembers.length === profile.countingPerDiscipline
                ? Math.round(countingMembers.reduce((sum, member) => sum + member[discipline], 0) * 100) / 100
                : null;
        });

        members.forEach((member) => {
            member.isCountingDressage = member.isCountingDressage || false;
            member.isCountingMarathon = member.isCountingMarathon || false;
            member.isCountingPrecision = member.isCountingPrecision || false;
            member.isCounting = member.isCountingDressage || member.isCountingMarathon || member.isCountingPrecision;
        });

        const hasAllMomentScores = ['dressage', 'marathon', 'precision']
            .every(discipline => Number.isFinite(teamScores[discipline]));
        const lowestIndividualDressage = Math.min(
            ...members
                .filter(member => !member.isMemberEliminatedFromTeam && Number.isFinite(member.dressage))
                .map(member => member.dressage)
        );
        const isIncomplete = isInvalid || !hasAllMomentScores;

        return {
            teamId: team.id,
            teamName: team.name,
            total: isIncomplete ? null : Math.round((teamScores.dressage + teamScores.marathon + teamScores.precision) * 100) / 100,
            dressage: teamScores.dressage,
            marathon: teamScores.marathon,
            precision: teamScores.precision,
            lowestIndividualDressage: Number.isFinite(lowestIndividualDressage) ? lowestIndividualDressage : null,
            isEliminated: false,
            isIncomplete,
            isInvalid,
            disciplineRanks: {},
            profile,
            members
        };
    });

    assignLagSmDisciplineRanks(teamResults);
    teamResults.sort(compareLagSmTeams);

    let previousFinishedTeam = null;
    let activeIndex = 0;
    teamResults.forEach((team) => {
        if (team.isIncomplete) {
            team.rank = null;
            return;
        }

        activeIndex += 1;
        team.rank = previousFinishedTeam && compareLagSmPlacement(team, previousFinishedTeam) === 0
            ? previousFinishedTeam.rank
            : activeIndex;
        previousFinishedTeam = team;
    });

    return teamResults;
}

function getMemberDetails(member) {
    return member?.details || member || {};
}

function normalizeTeamCountry(member) {
    const details = getMemberDetails(member);
    const rawCountry = details.country ?? details.nation ?? details.nationality;
    if (typeof rawCountry !== 'string' || !rawCountry.trim()) return null;

    return normalizeCountryCode(rawCountry) || rawCountry.trim().toUpperCase();
}

function getFeiRole(member, profile) {
    if (!profile?.requiredRoles?.length) return null;

    const details = getMemberDetails(member);
    const classText = String(details.className || details.class || '').toLowerCase();

    if (profile.id === TEAM_SCORING_PROFILE_IDS.FEI_PONY_CHAMPIONSHIP) {
        if (/\b(enbet|single|h1|p1)\b/.test(classText)) return 'single';
        if (/\b(par|pair|h2|p2)\b/.test(classText)) return 'pair';
        if (/\b(fyrspann|four[ -]?in[ -]?hand|h4|p4)\b/.test(classText)) return 'fourInHand';
    }

    if (profile.id === TEAM_SCORING_PROFILE_IDS.FEI_YOUTH_CHAMPIONSHIP) {
        if (/\b(child|children)\b/.test(classText)) return 'child';
        if (/\bjunior\b/.test(classText)) return 'junior';
        if (/\bu\s*25\b/.test(classText)) return 'u25';
    }

    return null;
}

function getParaGrade(member) {
    const details = getMemberDetails(member);
    const grade = String(details.paraGrade ?? details.grade ?? '').trim().toLowerCase();
    if (grade === '1' || grade === 'grade 1' || grade === 'grade i' || grade === 'i') return '1';
    if (grade === '2' || grade === 'grade 2' || grade === 'grade ii' || grade === 'ii') return '2';
    return null;
}

/**
 * Validates the static composition requirements for the selected profile.
 * This is intentionally exported so the team setup can show the same warnings before scoring.
 */
export function getTeamCompositionIssues(members = [], profileOrId) {
    const profile = typeof profileOrId === 'string'
        ? getTeamScoringProfile(profileOrId)
        : (profileOrId || getTeamScoringProfile());
    const issues = [];

    if (members.length < profile.minimumMembers) {
        issues.push(`Behöver minst ${profile.minimumMembers} ekipage.`);
    }
    if (members.length > profile.maximumMembers) {
        issues.push(`Högst ${profile.maximumMembers} ekipage är tillåtna.`);
    }
    if (profile.ruleFamily !== 'fei') return issues;

    if (profile.requiresSameNation) {
        const countries = members.map(normalizeTeamCountry);
        if (countries.some(country => !country)) {
            issues.push('Alla lagekipage måste ha ett angivet land.');
        } else if (new Set(countries).size > 1) {
            issues.push('Alla lagekipage måste representera samma nation.');
        }
    }

    if (profile.requiredRoles?.length) {
        const roleCounts = new Map(profile.requiredRoles.map(role => [role.id, 0]));
        let unidentifiedCount = 0;
        members.forEach((member) => {
            const role = getFeiRole(member, profile);
            if (roleCounts.has(role)) {
                roleCounts.set(role, roleCounts.get(role) + 1);
            } else {
                unidentifiedCount += 1;
            }
        });

        if (unidentifiedCount > 0) {
            issues.push('En eller flera lagekipage kan inte kopplas till rätt FEI-kategori via klassnamnet.');
        }
        profile.requiredRoles.forEach((role) => {
            const count = roleCounts.get(role.id) || 0;
            if (count < role.minimum) {
                issues.push(`Behöver minst ${role.minimum} ${role.label}.`);
            }
            if (count > role.maximum) {
                issues.push(`Högst ${role.maximum} ${role.label} är tillåtna.`);
            }
        });
    }

    if (profile.requiresParaGradeOne) {
        const grades = members.map(getParaGrade);
        if (grades.some(grade => !grade)) {
            issues.push('Alla lagekipage måste ha Para Grade I eller II angiven.');
        }
        if (!grades.includes('1')) {
            issues.push('Laget måste innehålla minst en deltagare i Grade I.');
        }
        if (profile.maximumMembersPerParaGrade) {
            ['1', '2'].forEach((grade) => {
                if (grades.filter(memberGrade => memberGrade === grade).length > profile.maximumMembersPerParaGrade) {
                    issues.push(`Högst ${profile.maximumMembersPerParaGrade} deltagare i samma Para Grade är tillåtna.`);
                }
            });
        }
    }

    return issues;
}

function getFeiPhasePenalty(result, discipline) {
    const phase = result?.[discipline] || {};
    const rawPenalty = discipline === 'dressage'
        ? phase.penalty ?? phase.judgePenalty
        : phase.totalPenalty ?? phase.pen;
    const status = String(result?.[`${discipline}Status`] || '').toLowerCase();
    const penalty = toFiniteOrNull(rawPenalty);
    const eliminated = phase.eliminated === true
        || rawPenalty === Infinity
        || /elim|utesluten|disqual/.test(status);

    return { penalty, eliminated };
}

function isFeiMemberExcluded(result, phases) {
    const status = String(result?.status || '').toLowerCase();
    const statusMarksExclusion = /elim|utesluten|disqual|struken|withdrawn|retired|dns|dnf/.test(status);
    return result?.isEliminated === true
        || statusMarksExclusion
        || Object.values(phases).some(phase => phase.eliminated);
}

function buildFeiMemberResult(memberId, resultMap, profile) {
    const result = resultMap.get(String(memberId));
    if (!result) {
        return {
            memberId,
            startNumber: '?',
            name: 'Okänd',
            dressage: null,
            marathon: null,
            precision: null,
            penalty: null,
            currentPenalty: null,
            country: null,
            role: null,
            paraGrade: null,
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

    const phases = {
        dressage: getFeiPhasePenalty(result, 'dressage'),
        marathon: getFeiPhasePenalty(result, 'marathon'),
        precision: getFeiPhasePenalty(result, 'precision')
    };
    const excluded = isFeiMemberExcluded(result, phases);
    const complete = !excluded && Object.values(phases).every(phase => Number.isFinite(phase.penalty));
    const currentPenalty = Object.values(phases)
        .map(phase => phase.penalty)
        .filter(Number.isFinite)
        .reduce((sum, penalty) => sum + penalty, null);

    return {
        memberId,
        startNumber: result.startNumber,
        name: result.driverName,
        dressage: phases.dressage.penalty,
        marathon: phases.marathon.penalty,
        precision: phases.precision.penalty,
        penalty: complete ? currentPenalty : null,
        currentPenalty,
        country: normalizeTeamCountry(result),
        role: getFeiRole(result, profile),
        paraGrade: getParaGrade(result),
        eliminated: excluded,
        complete,
        incomplete: !excluded && !complete,
        valid: complete,
        isDressageElim: phases.dressage.eliminated,
        isMarathonElim: phases.marathon.eliminated,
        isPrecisionElim: phases.precision.eliminated,
        isMemberEliminatedFromTeam: excluded,
        details: result
    };
}

const FEI_PHASE_ORDER = ['dressage', 'marathon', 'precision'];

// A member counts in a phase with a score in it and in the phases before it.
// Not "every phase anyone in the competition has started": then the first
// marathon result anywhere emptied every team's live dressage standing.
// Eliminated members are excluded as before, so final totals are unchanged.
function getFeiCountingMembers(members, discipline, profile) {
    const required = FEI_PHASE_ORDER.slice(0, FEI_PHASE_ORDER.indexOf(discipline) + 1);
    const isEligible = (member) => !member.eliminated
        && required.every(d => Number.isFinite(member[d]));

    const selectLowest = (candidates, count) => candidates
        .filter(isEligible)
        .sort((a, b) => a[discipline] - b[discipline])
        .slice(0, count);

    if (!profile.requiredRoles?.length) {
        return selectLowest(members, profile.countingPerDiscipline);
    }

    return profile.requiredRoles.flatMap(role => selectLowest(
        members.filter(member => member.role === role.id),
        1
    ));
}

function assignFeiDisciplineRanks(teamResults) {
    assignLagSmDisciplineRanks(teamResults);
}

function compareFeiPlacement(a, b) {
    const getStatus = (team) => {
        if (team.isInvalid) return 3;
        if (team.isIneligible) return 2;
        if (team.isIncomplete) return 1;
        return 0;
    };
    const statusDifference = getStatus(a) - getStatus(b);
    if (statusDifference !== 0) return statusDifference;
    if (getStatus(a) !== 0) return 0;

    if (a.total !== b.total) return a.total - b.total;
    if (a.marathon !== b.marathon) return a.marathon - b.marathon;
    if (a.dressage !== b.dressage) return a.dressage - b.dressage;
    return 0;
}

function compareFeiTeams(a, b) {
    return compareFeiPlacement(a, b)
        || String(a.teamName || '').localeCompare(String(b.teamName || ''), 'sv');
}

function calculateFeiResults(teams, equipageResults, profile) {
    const resultMap = new Map();
    equipageResults.forEach((row) => {
        if (row?.id) resultMap.set(String(row.id), row);
    });

    const teamResults = teams.map((team) => {
        const members = (team.members || []).map(memberId => buildFeiMemberResult(memberId, resultMap, profile));
        const validationIssues = getTeamCompositionIssues(members, profile);
        const isInvalid = validationIssues.length > 0;
        const teamScores = {};

        ['dressage', 'marathon', 'precision'].forEach((discipline) => {
            const countingMembers = getFeiCountingMembers(members, discipline, profile);
            countingMembers.forEach((member) => {
                member[`isCounting${discipline[0].toUpperCase()}${discipline.slice(1)}`] = true;
            });
            teamScores[discipline] = countingMembers.length === profile.countingPerDiscipline
                ? Math.round(countingMembers.reduce((sum, member) => sum + member[discipline], 0) * 100) / 100
                : null;
        });

        members.forEach((member) => {
            member.isCountingDressage = member.isCountingDressage || false;
            member.isCountingMarathon = member.isCountingMarathon || false;
            member.isCountingPrecision = member.isCountingPrecision || false;
            member.isCounting = member.isCountingDressage || member.isCountingMarathon || member.isCountingPrecision;
        });

        const hasAllMomentScores = ['dressage', 'marathon', 'precision']
            .every(discipline => Number.isFinite(teamScores[discipline]));
        const allMemberOutcomesFinal = members.every(member => member.complete || member.eliminated);
        const isIneligible = !isInvalid && allMemberOutcomesFinal && !hasAllMomentScores;
        const isIncomplete = isInvalid || (!hasAllMomentScores && !isIneligible);

        return {
            teamId: team.id,
            teamName: team.name,
            total: (!isInvalid && !isIneligible && hasAllMomentScores)
                ? Math.round((teamScores.dressage + teamScores.marathon + teamScores.precision) * 100) / 100
                : null,
            dressage: teamScores.dressage,
            marathon: teamScores.marathon,
            precision: teamScores.precision,
            isEliminated: false,
            isIncomplete,
            isIneligible,
            isInvalid,
            validationIssues,
            disciplineRanks: {},
            profile,
            members
        };
    });

    assignFeiDisciplineRanks(teamResults);
    teamResults.sort(compareFeiTeams);

    let previousFinishedTeam = null;
    let activeIndex = 0;
    teamResults.forEach((team) => {
        if (team.isInvalid || team.isIneligible || team.isIncomplete) {
            team.rank = null;
            return;
        }

        activeIndex += 1;
        team.rank = previousFinishedTeam && compareFeiPlacement(team, previousFinishedTeam) === 0
            ? previousFinishedTeam.rank
            : activeIndex;
        previousFinishedTeam = team;
    });

    return teamResults;
}

/**
 * Calculates team results using the competition's selected team-scoring profile.
 * Existing competitions keep the legacy three-counting calculation until a profile is selected.
 */
export function calculateTeamResults(teams, equipageResults, profileId) {
    if (!Array.isArray(teams) || !Array.isArray(equipageResults)) return [];

    const results = equipageResults.map(onlyFinishedPhases);
    const profile = getTeamScoringProfile(profileId);
    if (profile.id === TEAM_SCORING_PROFILE_IDS.LAG_SM_2026) {
        return addPreliminaryTeamStanding(calculateLagSmResults(teams, results, profile));
    }
    if (profile.ruleFamily === 'fei') {
        return addPreliminaryTeamStanding(calculateFeiResults(teams, results, profile));
    }

    return addPreliminaryTeamStanding(calculateLegacyTeamResults(teams, results));
}

const TEAM_PHASES = ['dressage', 'marathon', 'precision'];
const PHASE_ELIM_FLAG = { dressage: 'isDressageElim', marathon: 'isMarathonElim', precision: 'isPrecisionElim' };

// A member is done with a phase when it has a result, is eliminated in it, or
// no longer counts for the team (withdrawn / out of the team)
function memberPhaseDone(member, phase) {
    const value = member?.[phase];
    return Number.isFinite(value) || value === Infinity
        || member?.[PHASE_ELIM_FLAG[phase]] === true
        || member?.eliminated === true
        || member?.isMemberEliminatedFromTeam === true;
}

function teamPhaseDone(team, phase) {
    const members = Array.isArray(team?.members) ? team.members : [];
    return members.length > 0 && members.every(m => memberPhaseDone(m, phase)) && Number.isFinite(team?.[phase]);
}

/**
 * Preliminary team position while the competition is running: the standing
 * after the phases every team has finished (all members done). After dressage
 * the teams are ranked on dressage, after the marathon on dressage + marathon,
 * so a team that has not driven a phase does not look better than one that
 * has. Shared places on ties; eliminated, invalid and ineligible teams get
 * none. Sets team.preliminary = { rank, score, after } on each ranked team, or
 * null when every team is final (the normal ranks apply) or no phase is
 * finished by all teams yet.
 */
export function addPreliminaryTeamStanding(teamResults = []) {
    const teams = Array.isArray(teamResults) ? teamResults : [];
    const eligible = teams.filter(t => !t.isEliminated && !t.isInvalid && !t.isIneligible);
    teams.forEach(t => { t.preliminary = null; });
    if (eligible.length === 0 || eligible.every(t => !t.isIncomplete)) return teams;

    let phaseCount = 0;
    while (phaseCount < TEAM_PHASES.length && eligible.every(t => teamPhaseDone(t, TEAM_PHASES[phaseCount]))) phaseCount++;
    if (phaseCount === 0) return teams;

    const phases = TEAM_PHASES.slice(0, phaseCount);
    const after = phases[phases.length - 1];
    const scored = eligible
        .map(team => ({ team, score: Math.round(phases.reduce((sum, p) => sum + team[p], 0) * 100) / 100 }))
        .sort((a, b) => a.score - b.score);
    scored.forEach((entry, idx) => {
        const rank = (idx > 0 && entry.score === scored[idx - 1].score) ? scored[idx - 1].team.preliminary.rank : idx + 1;
        entry.team.preliminary = { rank, score: entry.score, after };
    });
    // List in preliminary order; teams without a standing keep their order after
    const others = teams.filter(t => !t.preliminary);
    return [...scored.map(entry => entry.team), ...others];
}

/**
 * The team profiles count a phase as done when it has a penalty. The result
 * engine says when a phase is really finished (dressageComplete etc.: every
 * judge, marathon 'Klar' with its settings, precision with a max time); a phase
 * it calls unfinished has its penalty removed here, so no profile ranks a team
 * on a partial result. Eliminations stay; rows without the flags are unchanged.
 */
export function onlyFinishedPhases(result) {
    if (!result || typeof result !== 'object') return result;
    const next = { ...result };
    const clear = (key, fields) => {
        const phase = next[key];
        if (!phase || phase.eliminated === true) return;
        const cleared = { ...phase };
        fields.forEach((field) => {
            if (cleared[field] !== Infinity) cleared[field] = null;
        });
        next[key] = cleared;
    };
    if (result.dressageComplete === false) clear('dressage', ['penalty', 'judgePenalty']);
    if (result.marathonComplete === false) clear('marathon', ['totalPenalty']);
    if (result.precisionComplete === false) clear('precision', ['totalPenalty', 'pen']);
    return next;
}
