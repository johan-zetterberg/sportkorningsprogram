import { listenForTeams } from '../../services/teamService.js';
import { saveTeam, deleteTeam } from '../../services/teamService.js';
import { updateCompetition } from '../../services/competitionService.js';
import { listenForEquipages } from '../../services/equipageService.js';
import { getClubLogoHtml, getClubLogoUrl, ensureClubLogosLoaded } from '../../services/logosService.js';
import { getFlagHtml, flagPngUrl, normalizeCountryCode } from '../../services/flagsService.js';
import { getTeamScoringProfile, getTeamScoringProfileOptions } from '../../services/teamRuleProfiles.js';
import { getTeamCompositionIssues } from '../../services/teamCalculationService.js';
import { getFeiDressageStartSlots, supportsFeiTeamBlocks } from '../../services/feiStartOrderService.js';
import { setGlobalState } from '../../main.js';
import { jsStringAttr } from '../../utils/sharedUtils.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

let currentTeams = [];
let currentEquipages = [];
let currentCompetitionId = null;
let currentCompetition = null;
let unsubscribeTeams = null;
let unsubscribeEquipages = null;

export function unloadTeamsTab() {
  if (unsubscribeTeams) {
    try { unsubscribeTeams(); } catch (error) { console.warn('Kunde inte stoppa lag-lyssnare:', error); }
  }
  if (unsubscribeEquipages) {
    try { unsubscribeEquipages(); } catch (error) { console.warn('Kunde inte stoppa lag-ekipage-lyssnare:', error); }
  }

  unsubscribeTeams = null;
  unsubscribeEquipages = null;
  currentTeams = [];
  currentEquipages = [];
  currentCompetitionId = null;
  currentCompetition = null;

  if (window.deleteTeamHandler === deleteTeamHandler) {
    delete window.deleteTeamHandler;
  }
  if (window.removeMemberHandler === removeMemberHandler) {
    delete window.removeMemberHandler;
  }
}

export function renderTeamsTab(container, competition) {
  if (!container || !competition) return;
  currentCompetitionId = competition.id;
  currentCompetition = competition;
  window.deleteTeamHandler = deleteTeamHandler;
  window.removeMemberHandler = removeMemberHandler;

  // Ensure logos are loaded
  ensureClubLogosLoaded().then(() => renderAll());

  // Grundlayout
  container.innerHTML = `
    <div class="team-admin-container max-w-5xl mx-auto">
      
      <!-- Sektion 1: Inställningar -->
      <div class="mb-8 p-6 bg-white dark:bg-gray-800 rounded-lg shadow border dark:border-gray-700">
        <h2 class="text-xl font-bold mb-4 dark:text-white">Inställningar för Lagtävling</h2>
        <div class="flex items-center justify-between">
          <label class="flex items-center space-x-3 cursor-pointer">
            <input type="checkbox" id="toggle-team-comp" class="form-checkbox h-6 w-6 text-blue-600 rounded transition duration-150 ease-in-out" ${competition.showTeams ? 'checked' : ''}>
            <span class="text-gray-900 dark:text-gray-200 font-medium text-lg">Aktivera Lagtävling</span>
          </label>
          <div class="text-sm text-gray-500 dark:text-gray-400">
            (Visar fliken "Lagtävling" för publiken)
          </div>
        </div>
        <div class="mt-5 pt-5 border-t border-gray-200 dark:border-gray-700">
          <label for="team-scoring-profile" class="block text-sm font-semibold text-gray-800 dark:text-gray-100 mb-2">Regelverk för lagresultat</label>
          <select id="team-scoring-profile" class="w-full max-w-xl rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-2.5">
            ${getTeamScoringProfileOptions().map(profile => `<option value="${escapeAttr(profile.id)}" ${(competition.teamScoringProfile || '') === profile.id ? 'selected' : ''}>${escapeHtml(profile.label)}</option>`).join('')}
          </select>
          <p id="team-scoring-profile-description" class="mt-2 text-sm text-gray-600 dark:text-gray-300"></p>
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Lagets sammansättning kontrolleras direkt nedan och igen när resultatet räknas.</p>
        </div>
      </div>

      <!-- Sektion 2: Dra-och-släpp UI -->
      <div class="flex flex-col md:flex-row gap-6 h-[700px]">
        
        <!-- Vänsterkolumn: Tillgängliga Kuskar -->
        <div class="w-full md:w-1/3 flex flex-col bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg border dark:border-gray-700 shadow-inner">
          <h3 class="font-bold text-gray-700 dark:text-gray-300 mb-2 sticky top-0 bg-inherit z-10 py-2">
            Tillgängliga Kuskar <span id="pool-count" class="text-xs bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded ml-2">0</span>
          </h3>
          <input type="text" id="search-pool" placeholder="Sök kusk..." class="mb-4 p-2 border rounded text-sm dark:bg-gray-800 dark:text-white dark:border-gray-600">
          
          <div id="equipage-pool" class="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar drop-zone" data-team-id="pool">
            <!-- Draggable items will be here -->
          </div>
        </div>

        <!-- Högerkolumn: Lag -->
        <div class="w-full md:w-2/3 flex flex-col">
          
          <!-- Skapa Nytt Lag -->
          <div class="flex gap-2 mb-6 bg-white dark:bg-gray-800 p-4 rounded-lg shadow border dark:border-gray-700">
            <input type="text" id="new-team-name" placeholder="Namn på nytt lag..." class="flex-1 border p-3 rounded text-lg dark:bg-gray-900 dark:text-white dark:border-gray-600 focus:ring-2 focus:ring-blue-500 outline-none">
            <button id="btn-create-team" class="bg-green-600 hover:bg-green-700 text-white font-bold px-6 py-2 rounded transition-colors shadow-md">
              + Skapa Lag
            </button>
          </div>

          <!-- Laglista -->
          <div id="teams-list" class="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar pb-12">
            <!-- Teams will be rendered here -->
          </div>

        </div>
      </div>
    </div>
  `;

  setupEventListeners();
  startListeners(competition);
}

function setupEventListeners() {
  // Toggle Visibility
  document.getElementById('toggle-team-comp').addEventListener('change', async (e) => {
    if (!currentCompetitionId) return;
    try {
      await updateCompetition(currentCompetitionId, { showTeams: e.target.checked });
      // showToast('Inställningar sparade', 'success');
    } catch (err) {
      console.error(err);
      alert('Kunde inte spara inställningar.');
      e.target.checked = !e.target.checked; // Revert
    }
  });

  const profileSelect = document.getElementById('team-scoring-profile');
  updateTeamProfileDescription();
  profileSelect?.addEventListener('change', async (e) => {
    const profileId = e.target.value;
    try {
      await updateCompetition(currentCompetitionId, { teamScoringProfile: profileId });
      currentCompetition = { ...currentCompetition, teamScoringProfile: profileId };
      setGlobalState({ key: 'currentCompetition', value: currentCompetition });
      updateTeamProfileDescription();
      renderTeamsList();
    } catch (error) {
      console.error(error);
      alert('Kunde inte spara lagregelverk.');
      e.target.value = currentCompetition?.teamScoringProfile || '';
    }
  });

  // Create Team
  document.getElementById('btn-create-team').addEventListener('click', async () => {
    const input = document.getElementById('new-team-name');
    const name = input.value.trim();
    if (!name) return;

    try {
      await saveTeam(currentCompetitionId, {
        name: name,
        members: [] // Empty start
      });
      input.value = '';
    } catch (err) {
      console.error(err);
      alert('Kunde inte skapa lag.');
    }
  });

  // Search Filter
  document.getElementById('search-pool').addEventListener('input', (e) => {
    renderPool(e.target.value);
  });
}

function getSelectedTeamProfile() {
  return getTeamScoringProfile(currentCompetition?.teamScoringProfile);
}

function updateTeamProfileDescription() {
  const description = document.getElementById('team-scoring-profile-description');
  if (!description) return;

  description.textContent = getSelectedTeamProfile().description;
}

function renderFeiDressageDeclaration(team, memberObjects, profile) {
  if (!supportsFeiTeamBlocks(profile) || !memberObjects.length) return '';

  const slots = getFeiDressageStartSlots(team);
  const memberOptions = memberObjects.map((equipage) => (
    `<option value="${escapeAttr(equipage.id)}">#${escapeHtml(equipage.startNumber)} ${escapeHtml(equipage.driverName)}</option>`
  )).join('');
  const slotLabels = [
    { position: 1, block: 'B' },
    { position: 2, block: 'D' },
    { position: 3, block: 'F' }
  ];

  return `
    <div class="border-t border-sky-200 bg-sky-50/70 p-3 dark:border-sky-900/60 dark:bg-sky-950/20" data-fei-dressage-declaration="${escapeAttr(team.id)}">
      <div class="text-sm font-semibold text-sky-950 dark:text-sky-100">FEI-deklaration för dressyr</div>
      <p class="mt-1 text-xs text-sky-800 dark:text-sky-200">Välj lagets positioner efter hästbesiktningen. Position 1, 2 och 3 hamnar i block B, D respektive F. För ett lag med två ekipage lämnas en position ledig.</p>
      <div class="mt-3 grid gap-2 sm:grid-cols-3">
        ${slotLabels.map(({ position, block }, index) => `
          <label class="text-xs font-medium text-sky-950 dark:text-sky-100">
            Position ${position} (block ${block})
            <select data-fei-dressage-slot="${index}" class="mt-1 w-full rounded border border-sky-200 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-sky-800 dark:bg-gray-900 dark:text-gray-100">
              <option value="">Ledig position</option>
              ${memberOptions.replace(`value="${escapeAttr(slots[index] || '')}"`, `value="${escapeAttr(slots[index] || '')}" selected`)}
            </select>
          </label>
        `).join('')}
      </div>
      <button type="button" data-action="save-fei-dressage-declaration" data-team-id="${escapeAttr(team.id)}" class="mt-3 rounded bg-sky-700 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-800">Spara deklaration</button>
    </div>
  `;
}

async function saveFeiDressageDeclaration(button) {
  const teamId = button?.dataset?.teamId;
  const team = currentTeams.find(item => String(item.id) === String(teamId));
  const declaration = button?.closest('[data-fei-dressage-declaration]');
  if (!team || !declaration) return;

  const slots = [0, 1, 2].map((index) => (
    declaration.querySelector(`[data-fei-dressage-slot="${index}"]`)?.value || null
  ));
  const members = (team.members || []).map(String);
  const selected = slots.filter(Boolean);
  const isValid = selected.length === members.length
    && new Set(selected).size === selected.length
    && selected.every(memberId => members.includes(memberId))
    && members.every(memberId => selected.includes(memberId));

  if (!isValid) {
    alert('Välj varje lagekipage exakt en gång. Ett lag med två ekipage ska ha en ledig position.');
    return;
  }

  try {
    await saveTeam(currentCompetitionId, { id: team.id, feiDressageStartSlots: slots });
  } catch (error) {
    console.error(error);
    alert('Kunde inte spara FEI-deklarationen.');
  }
}

function startListeners(competition) {
  if (unsubscribeTeams) unsubscribeTeams();
  if (unsubscribeEquipages) unsubscribeEquipages();

  unsubscribeTeams = listenForTeams(competition.id, (teams) => {
    currentTeams = teams.sort((a, b) => a.name.localeCompare(b.name));
    renderAll();
  });

  unsubscribeEquipages = listenForEquipages(competition.id, (equipages) => {
    currentEquipages = equipages;
    renderAll();
  });
}

function renderAll() {
  renderPool(document.getElementById('search-pool')?.value || '');
  renderTeamsList();
}

/**
 * Renders the list of unassigned drivers.
 */
function renderPool(filterText = '') {
  const container = document.getElementById('equipage-pool');
  if (!container) return; // Tab switched away

  // 1. Hitta alla kuskar som REDAN är med i ett lag
  const assignedIds = new Set();
  currentTeams.forEach(t => {
    if (Array.isArray(t.members)) {
      t.members.forEach(mId => assignedIds.add(String(mId)));
    }
  });

  // 2. Filtrera poolen: Inte i lag + matchar sök
  const ft = filterText.toLowerCase();
  const pool = currentEquipages.filter(eq => {
    if (assignedIds.has(String(eq.id))) return false;
    const searchStr = `${eq.startNumber} ${eq.driverName} ${eq.clubName} ${eq.horses} `.toLowerCase();
    return searchStr.includes(ft);
  }); // Sort by startNumber
  pool.sort((a, b) => (a.startNumber || 0) - (b.startNumber || 0));

  document.getElementById('pool-count').textContent = pool.length;

  container.innerHTML = pool.map(eq => createDraggableCard(eq)).join('');

  // Re-attach drag events
  addDragEvents(container);
}

/**
 * Renders the teams.
 */
function renderTeamsList() {
  const container = document.getElementById('teams-list');
  if (!container) return;
  const profile = getSelectedTeamProfile();

  container.innerHTML = currentTeams.map(team => {
    const members = Array.isArray(team.members) ? team.members : [];
    // Hämta hela ekipageobjekten för medlemmarna
    const memberObjects = members.map(mId => currentEquipages.find(e => String(e.id) === String(mId))).filter(Boolean);
    const compositionIssues = getTeamCompositionIssues(memberObjects, profile);
    const memberCountIsValid = compositionIssues.length === 0;
    const memberCountMessage = memberCountIsValid
      ? ''
      : `<div class="px-3 py-2 text-xs font-medium text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">${compositionIssues.map(issue => `<div>${escapeHtml(issue)}</div>`).join('')}</div>`;

    // Resolve Team Assets
    let teamAssetHtml = '';

    // 1. Club Logo?
    const clubUrl = getClubLogoUrl(team.name);
    if (clubUrl) {
      teamAssetHtml += `<img src="${clubUrl}" alt="Logga" class="h-8 w-auto object-contain mr-2">`;
    }

    // 2. Nation Flag? (If name is a country)
    const cc = normalizeCountryCode(team.name);
    if (cc) {
      const flagUrl = flagPngUrl(cc);
      teamAssetHtml += `<img src="${flagUrl}" alt="${cc}" class="h-6 w-auto object-contain mr-2 shadow-sm">`;
    }

    return `
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow border dark:border-gray-700 overflow-hidden" data-team-id="${team.id}">
        <!-- Header -->
        <div class="flex items-center justify-between p-3 bg-gray-100 dark:bg-gray-700/50 border-b dark:border-gray-700">
          <div class="flex items-center gap-2">
            ${teamAssetHtml}
            <h3 class="font-bold text-gray-800 dark:text-white flex items-center gap-2">
                <span class="text-blue-600">🏆</span> ${team.name}
                <span class="text-xs ${memberCountIsValid ? 'bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300' : 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200'} px-2 py-0.5 rounded-full">${members.length} / ${profile.minimumMembers}-${profile.maximumMembers}</span>
            </h3>
          </div>
          <button class="text-red-500 hover:text-red-700 text-sm px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20" onclick="window.deleteTeamHandler(${jsStringAttr(team.id)}, ${jsStringAttr(team.name)})">
            Ta bort lag
          </button>
        </div>

        ${memberCountMessage}

        <!-- Drop Zone for this team -->
        <div class="p-3 min-h-[80px] space-y-2 drop-zone bg-gray-50/50 dark:bg-gray-900/20 transition-colors" data-team-id="${team.id}">
          ${memberObjects.length === 0
        ? `<div class="text-sm text-gray-400 text-center py-4 italic pointer-events-none">Dra kuskar hit...</div>`
        : memberObjects.map(eq => createDraggableCard(eq, team.id)).join('')
      }
        </div>
        ${renderFeiDressageDeclaration(team, memberObjects, profile)}
      </div>
    `;
  }).join('');

  // Re-attach drag events to new zones
  container.querySelectorAll('.drop-zone').forEach(el => addDragEvents(el));
  container.querySelectorAll('[data-action="save-fei-dressage-declaration"]').forEach((button) => {
    button.addEventListener('click', () => saveFeiDressageDeclaration(button));
  });
}

function createDraggableCard(eq, currentTeamId = null) {
  const flagParams = { className: 'inline-block h-3 w-auto mr-1 shadow-sm' };
  const clubParams = { className: 'inline-block h-4 w-auto ml-1 align-sub opacity-80', style: '' };

  // Hämta HTML
  const flag = getFlagHtml(eq); // Returns generic img string
  // logosService helper 'getClubLogoHtml' accepts params
  const clubLogo = getClubLogoHtml(eq, clubParams);

  return `
    <div class="draggable-card bg-white dark:bg-gray-700 p-2 rounded border dark:border-gray-600 shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow flex items-center justify-between group" 
         draggable="true" 
         data-id="${escapeAttr(eq.id)}">
      <div class="flex flex-col overflow-hidden">
        <span class="font-bold text-sm text-gray-900 dark:text-gray-100 truncate">
          <span class="text-blue-600 dark:text-blue-400 w-6 inline-block font-mono">#${escapeHtml(eq.startNumber)}</span>
          ${flag} ${escapeHtml(eq.driverName)}
        </span>
        <span class="text-xs text-gray-500 dark:text-gray-400 ml-6 truncate flex items-center gap-1">
            ${escapeHtml(eq.clubName || '')} ${clubLogo}
        </span>
      </div>
      
      ${currentTeamId ? `
      <!-- Remove button if in team -->
      <button class="text-gray-400 hover:text-red-500 p-1 opacity-0 group-hover:opacity-100 transition-opacity" 
              onclick="window.removeMemberHandler(${jsStringAttr(currentTeamId)}, ${jsStringAttr(eq.id)})" title="Ta bort från lag">
        ✕
      </button>
      ` : ''}
    </div>
  `;
}

// --- Drag and Drop Logic ---
// We use simple HTML5 DnD. 
// "sourceId" is stored in dataTransfer.

function addDragEvents(element) {
  element.addEventListener('dragover', (e) => {
    e.preventDefault(); // Allow drop
    e.dataTransfer.dropEffect = 'move';
    element.classList.add('bg-blue-50', 'dark:bg-blue-900/20');
  });

  element.addEventListener('dragleave', (e) => {
    element.classList.remove('bg-blue-50', 'dark:bg-blue-900/20');
  });

  element.addEventListener('drop', async (e) => {
    e.preventDefault();
    element.classList.remove('bg-blue-50', 'dark:bg-blue-900/20');

    const equipageId = e.dataTransfer.getData('text/plain');
    const targetTeamId = element.dataset.teamId; // 'pool' or team ID

    if (!equipageId || !targetTeamId) return;

    await handleMove(equipageId, targetTeamId);
  });

  // Draggable items inside this container
  const items = element.querySelectorAll('[draggable="true"]');
  items.forEach(item => {
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', item.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => item.classList.add('opacity-50'), 0);
    });
    item.addEventListener('dragend', (e) => {
      item.classList.remove('opacity-50');
    });
  });
}

/**
 * Handles logic when an equipage is dropped.
 * 1. Remove from old team (if any).
 * 2. Add to new team (if not 'pool').
 */
async function handleMove(equipageId, targetTeamId) {
  const eqId = String(equipageId);

  // Find current team (if any)
  const sourceTeam = currentTeams.find(t => t.members && t.members.includes(eqId));
  const sourceTeamId = sourceTeam ? sourceTeam.id : 'pool';

  if (sourceTeamId === targetTeamId) return; // No change

  const targetTeam = targetTeamId === 'pool'
    ? null
    : currentTeams.find(team => team.id === targetTeamId);
  const profile = getSelectedTeamProfile();
  if (targetTeam) {
    const targetMembers = targetTeam.members || [];
    if (!targetMembers.includes(eqId) && targetMembers.length >= profile.maximumMembers) {
      alert(`${profile.label} tillåter högst ${profile.maximumMembers} ekipage per lag.`);
      return;
    }
  }

  // Optimistic UI Update (optional, but let's trust Firestore listener for simplicity first)

  // 1. Remove from source
  if (sourceTeam) {
    const newMembers = sourceTeam.members.filter(m => String(m) !== eqId);
    await saveTeam(currentCompetitionId, { id: sourceTeam.id, members: newMembers });
  }

  // 2. Add to target
  if (targetTeamId !== 'pool') {
    if (targetTeam) {
      const currentMembers = targetTeam.members || [];
      // Safety check: avoid duplicates (though UI prevents it by removing from pool)
      if (!currentMembers.includes(eqId)) {
        await saveTeam(currentCompetitionId, {
          id: targetTeamId,
          members: [...currentMembers, eqId]
        });
      }
    }
  }
}

// --- Global Handlers for inline onclicks ---
async function deleteTeamHandler(teamId, teamName) {
  if (confirm(`Är du säker på att du vill ta bort laget "${teamName}" ? `)) {
    await deleteTeam(currentCompetitionId, teamId);
  }
}

async function removeMemberHandler(teamId, memberId) {
  // Move to pool logic essentially
  // Just remove from team.
  const team = currentTeams.find(t => t.id === teamId);
  if (team) {
    const newMembers = team.members.filter(m => String(m) !== String(memberId));
    await saveTeam(currentCompetitionId, { id: teamId, members: newMembers });
  }
}

window.deleteTeamHandler = deleteTeamHandler;
window.removeMemberHandler = removeMemberHandler;
