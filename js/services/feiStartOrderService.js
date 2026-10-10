import { getTeamScoringProfile } from './teamRuleProfiles.js';

const FEI_TEAM_BLOCKS = ['B', 'D', 'F'];
const FEI_INDIVIDUAL_BLOCKS = ['A', 'C', 'E'];
const FEI_BLOCK_ORDER = ['A', 'B', 'C', 'D', 'E', 'F'];

function byStartNumber(a, b) {
  return Number(a?.startNumber || 0) - Number(b?.startNumber || 0);
}

function createSeededRandom(seed) {
  let state = 2166136261;
  for (const char of String(seed || 'fei-draw')) {
    state ^= char.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }

  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(items, random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function normalizedMemberIds(team) {
  return (team?.members || []).map(String);
}

export function supportsFeiTeamBlocks(profileOrId) {
  const profile = typeof profileOrId === 'string'
    ? getTeamScoringProfile(profileOrId)
    : profileOrId;
  return profile?.ruleFamily === 'fei' && profile.maximumMembers <= 3;
}

export function getFeiDressageStartSlots(team = {}) {
  const members = normalizedMemberIds(team);
  const savedSlots = Array.isArray(team.feiDressageStartSlots)
    ? team.feiDressageStartSlots.map(slot => (slot == null || slot === '' ? null : String(slot)))
    : [];

  return FEI_TEAM_BLOCKS.map((_, index) => savedSlots[index] ?? null);
}

export function validateFeiDressageStartOrder({
  teams = [],
  equipages = [],
  profileId
} = {}) {
  const profile = getTeamScoringProfile(profileId);
  if (!supportsFeiTeamBlocks(profile)) {
    return ['FEI-blockordning kan bara användas för FEI Championship / CAIO och FEI Para Driving Championship.'];
  }

  const equipageIds = new Set(equipages.map(equipage => String(equipage?.id)));
  const issues = [];

  teams
    .filter(team => normalizedMemberIds(team).length > 0)
    .forEach((team) => {
      const members = normalizedMemberIds(team);
      const slots = getFeiDressageStartSlots(team);
      const selected = slots.filter(Boolean);
      const teamLabel = team.name || 'Namnlöst lag';

      if (members.length < 2 || members.length > 3) {
        issues.push(`${teamLabel}: FEI-blockordning kräver 2 eller 3 deklarerade lagekipage.`);
        return;
      }
      if (!Array.isArray(team.feiDressageStartSlots)) {
        issues.push(`${teamLabel}: deklarera startposition 1-3 för dressyr.`);
        return;
      }
      if (selected.length !== members.length || new Set(selected).size !== selected.length) {
        issues.push(`${teamLabel}: varje lagekipage ska väljas exakt en gång och en tvåmannatrupp ska ha en ledig position.`);
      }
      if (selected.some(memberId => !members.includes(memberId))) {
        issues.push(`${teamLabel}: deklarationen innehåller ett ekipage som inte längre ingår i laget.`);
      }
      if (members.some(memberId => !selected.includes(memberId))) {
        issues.push(`${teamLabel}: alla lagekipage måste ingå i deklarationen.`);
      }
      if (selected.some(memberId => !equipageIds.has(memberId))) {
        issues.push(`${teamLabel}: ett deklarerat ekipage saknas i startlistan.`);
      }
    });

  return issues;
}

export function buildFeiDressageStartOrder({
  teams = [],
  equipages = [],
  profileId,
  seed = ''
} = {}) {
  const issues = validateFeiDressageStartOrder({ teams, equipages, profileId });
  if (issues.length) return { rows: [], blocks: {}, assignments: {}, issues };

  const equipageById = new Map(equipages.map(equipage => [String(equipage.id), equipage]));
  const blocks = Object.fromEntries(FEI_BLOCK_ORDER.map(block => [block, []]));
  const assignedIds = new Set();
  const declaredTeams = teams
    .filter(team => normalizedMemberIds(team).length > 0)
    .map((team) => ({ team, slots: getFeiDressageStartSlots(team) }));
  const random = createSeededRandom(seed);

  const teamOrder = shuffled(declaredTeams, random);
  FEI_TEAM_BLOCKS.forEach((block, slotIndex) => {
    teamOrder.forEach(({ slots }) => {
      const memberId = slots[slotIndex];
      if (!memberId) return;
      const equipage = equipageById.get(memberId);
      if (!equipage) return;
      blocks[block].push(equipage);
      assignedIds.add(memberId);
    });
  });

  const individualRows = shuffled(
    equipages.filter(equipage => !assignedIds.has(String(equipage.id))),
    random
  );
  individualRows.forEach((equipage, index) => {
    blocks[FEI_INDIVIDUAL_BLOCKS[index % FEI_INDIVIDUAL_BLOCKS.length]].push(equipage);
  });

  const rows = FEI_BLOCK_ORDER.flatMap(block => blocks[block]);
  const assignments = Object.fromEntries(
    FEI_BLOCK_ORDER
      .flatMap(block => blocks[block].map(equipage => [String(equipage.startNumber), block]))
  );

  return { rows, blocks, assignments, issues: [] };
}

function getDressagePenalty(row) {
  const value = Number(row?.dressagePenalty);
  return Number.isFinite(value) ? value : null;
}

function getDressageSequenceIndex(dressageSequence, dressageAssignments, row) {
  const sequenceIndex = dressageSequence.indexOf(String(row?.startNumber));
  if (sequenceIndex !== -1) return sequenceIndex;
  const block = dressageAssignments?.[String(row?.startNumber)];
  const index = FEI_TEAM_BLOCKS.indexOf(block);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export function buildFeiMarathonStartOrder({
  teams = [],
  rows = [],
  profileId,
  dressageAssignments = {},
  dressageSequence = []
} = {}) {
  const profile = getTeamScoringProfile(profileId);
  if (!supportsFeiTeamBlocks(profile)) {
    return { rows: [], blocks: {}, assignments: {}, issues: ['FEI-blockordning kan inte användas för valt lagregelverk.'] };
  }

  const rowById = new Map(rows.map(row => [String(row.id), row]));
  const blocks = Object.fromEntries(FEI_BLOCK_ORDER.map(block => [block, []]));
  const assignedIds = new Set();
  const issues = [];

  teams
    .filter(team => normalizedMemberIds(team).length > 0)
    .forEach((team) => {
      const members = normalizedMemberIds(team)
        .map(memberId => rowById.get(memberId))
        .filter(Boolean);
      if (members.length !== normalizedMemberIds(team).length || members.some(row => getDressagePenalty(row) === null)) {
        issues.push(`${team.name || 'Namnlöst lag'}: dressyrresultat saknas för minst ett lagekipage.`);
        return;
      }

      const dressageSlots = getFeiDressageStartSlots(team);
      if (members.length === 2) {
        dressageSlots.forEach((memberId, slotIndex) => {
          if (!memberId) return;
          const row = rowById.get(memberId);
          blocks[FEI_TEAM_BLOCKS[slotIndex]].push(row);
          assignedIds.add(memberId);
        });
        return;
      }

      [...members]
        .sort((a, b) => getDressagePenalty(a) - getDressagePenalty(b) || byStartNumber(a, b))
        .forEach((row, rank) => {
          const block = ['F', 'D', 'B'][rank];
          blocks[block].push(row);
          assignedIds.add(String(row.id));
        });
    });

  const individualRows = rows.filter(row => !assignedIds.has(String(row.id)));
  if (individualRows.some(row => getDressagePenalty(row) === null)) {
    issues.push('Dressyrresultat saknas för minst ett individuellt ekipage.');
  }
  if (issues.length) return { rows: [], blocks: {}, assignments: {}, issues };

  individualRows
    .sort((a, b) => getDressagePenalty(b) - getDressagePenalty(a) || byStartNumber(a, b))
    .forEach((row, index) => {
      const block = FEI_INDIVIDUAL_BLOCKS[Math.min(
        FEI_INDIVIDUAL_BLOCKS.length - 1,
        Math.floor((index * FEI_INDIVIDUAL_BLOCKS.length) / individualRows.length)
      )];
      blocks[block].push(row);
    });

  FEI_TEAM_BLOCKS.forEach((block) => {
    blocks[block].sort((a, b) => getDressageSequenceIndex(dressageSequence, dressageAssignments, a) - getDressageSequenceIndex(dressageSequence, dressageAssignments, b) || byStartNumber(a, b));
  });

  const orderedRows = FEI_BLOCK_ORDER.flatMap(block => blocks[block]);
  const assignments = Object.fromEntries(
    FEI_BLOCK_ORDER
      .flatMap(block => blocks[block].map(row => [String(row.startNumber), block]))
  );
  return { rows: orderedRows, blocks, assignments, issues: [] };
}

export function buildFeiPrecisionStartOrder(rows = []) {
  const missingScore = rows.find(row => !row.retired && !row.eliminated && (
    !Number.isFinite(Number(row.dressagePenalty)) || !Number.isFinite(Number(row.marathonPenalty))
  ));
  if (missingScore) {
    return {
      rows: [],
      issues: [`Dressyr- eller maratonresultat saknas för startnummer ${missingScore.startNumber}.`]
    };
  }

  const orderedRows = [...rows].sort((a, b) => {
    const category = row => row.retired ? 0 : (row.eliminated ? 1 : 2);
    const categoryDifference = category(a) - category(b);
    if (categoryDifference !== 0) return categoryDifference;
    if (category(a) < 2) return byStartNumber(a, b);

    const totalA = Number(a.dressagePenalty) + Number(a.marathonPenalty);
    const totalB = Number(b.dressagePenalty) + Number(b.marathonPenalty);
    if (totalA !== totalB) return totalB - totalA;
    if (Number(a.marathonPenalty) !== Number(b.marathonPenalty)) {
      return Number(b.marathonPenalty) - Number(a.marathonPenalty);
    }
    return byStartNumber(a, b);
  });

  return { rows: orderedRows, issues: [] };
}
