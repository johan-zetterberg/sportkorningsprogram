import {
  listenForTeams,
  saveTeam,
  deleteTeam,
  updateCompetition,
  listenForEquipages
} from '../../services/firestoreService.js';
import { getClubLogoHtml, getClubLogoUrl, ensureClubLogosLoaded } from '../../services/logosService.js';
import { getFlagHtml, flagPngUrl, normalizeCountryCode } from '../../services/flagsService.js';

let currentTeams = [];
let currentEquipages = [];
let currentCompetitionId = null;

export function renderTeamsTab(container, competition) {
  if (!container || !competition) return;
  currentCompetitionId = competition.id;

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

// Globala lyssnare
let unsubscribeTeams = null;
let unsubscribeEquipages = null;

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

  container.innerHTML = currentTeams.map(team => {
    const members = Array.isArray(team.members) ? team.members : [];

    // Hämta hela ekipageobjekten för medlemmarna
    const memberObjects = members.map(mId => currentEquipages.find(e => String(e.id) === String(mId))).filter(Boolean);

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
                <span class="text-xs bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-full">${members.length} / 3-4</span>
            </h3>
          </div>
          <button class="text-red-500 hover:text-red-700 text-sm px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20" onclick="window.deleteTeamHandler('${team.id}', '${team.name}')">
            Ta bort lag
          </button>
        </div>

        <!-- Drop Zone for this team -->
        <div class="p-3 min-h-[80px] space-y-2 drop-zone bg-gray-50/50 dark:bg-gray-900/20 transition-colors" data-team-id="${team.id}">
          ${memberObjects.length === 0
        ? `<div class="text-sm text-gray-400 text-center py-4 italic pointer-events-none">Dra kuskar hit...</div>`
        : memberObjects.map(eq => createDraggableCard(eq, team.id)).join('')
      }
        </div>
      </div>
    `;
  }).join('');

  // Re-attach drag events to new zones
  container.querySelectorAll('.drop-zone').forEach(el => addDragEvents(el));
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
         data-id="${eq.id}">
      <div class="flex flex-col overflow-hidden">
        <span class="font-bold text-sm text-gray-900 dark:text-gray-100 truncate">
          <span class="text-blue-600 dark:text-blue-400 w-6 inline-block font-mono">#${eq.startNumber}</span>
          ${flag} ${eq.driverName}
        </span>
        <span class="text-xs text-gray-500 dark:text-gray-400 ml-6 truncate flex items-center gap-1">
            ${eq.clubName || ''} ${clubLogo}
        </span>
      </div>
      
      ${currentTeamId ? `
      <!-- Remove button if in team -->
      <button class="text-gray-400 hover:text-red-500 p-1 opacity-0 group-hover:opacity-100 transition-opacity" 
              onclick="window.removeMemberHandler('${currentTeamId}', '${eq.id}')" title="Ta bort från lag">
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

  // Optimistic UI Update (optional, but let's trust Firestore listener for simplicity first)

  // 1. Remove from source
  if (sourceTeam) {
    const newMembers = sourceTeam.members.filter(m => String(m) !== eqId);
    await saveTeam(currentCompetitionId, { id: sourceTeam.id, members: newMembers });
  }

  // 2. Add to target
  if (targetTeamId !== 'pool') {
    const targetTeam = currentTeams.find(t => t.id === targetTeamId);
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
window.deleteTeamHandler = async (teamId, teamName) => {
  if (confirm(`Är du säker på att du vill ta bort laget "${teamName}" ? `)) {
    await deleteTeam(currentCompetitionId, teamId);
  }
};

window.removeMemberHandler = async (teamId, memberId) => {
  // Move to pool logic essentially
  // Just remove from team.
  const team = currentTeams.find(t => t.id === teamId);
  if (team) {
    const newMembers = team.members.filter(m => String(m) !== String(memberId));
    await saveTeam(currentCompetitionId, { id: teamId, members: newMembers });
  }
};
