import { seedCompetition } from './seed-competition.js';

const statusEl = document.getElementById('status');
const seedBtn = document.getElementById('seedBtn');
const linkContainer = document.getElementById('linkContainer');
const totalResultsLink = document.getElementById('totalResultsLink');
const officialPortalLink = document.getElementById('officialPortalLink');
const officialsAdminLink = document.getElementById('officialsAdminLink');
const stressToggle = document.getElementById('stressToggle');
const edgeToggle = document.getElementById('edgeToggle');

function log(msg) {
  statusEl.textContent += `\n[${new Date().toLocaleTimeString()}] ${msg}`;
  statusEl.scrollTop = statusEl.scrollHeight;
}

if (window.location.protocol === 'file:') {
  statusEl.textContent = [
    'Den här sidan verkar vara öppnad som lokal fil.',
    'Öppna den via samma webbserver som appen, till exempel /seed_test.html.',
    'ES-moduler och Firebase fungerar ofta inte korrekt från file://.'
  ].join('\n');
}

seedBtn.addEventListener('click', async () => {
  seedBtn.disabled = true;
  seedBtn.classList.add('opacity-50', 'cursor-not-allowed');
  linkContainer.classList.add('hidden');
  statusEl.textContent = 'Startar seeder...';

  try {
    const includeStress = !!stressToggle?.checked;
    const includeEdgeCases = !!edgeToggle?.checked;
    const result = await seedCompetition({ log, includeStress, includeEdgeCases });
    localStorage.setItem('lastCompetitionId', result.competitionId);
    totalResultsLink.href = result.links.totalResults;
    officialPortalLink.href = result.links.officialPortal;
    officialsAdminLink.href = result.links.officialsAdmin;
    totalResultsLink.textContent = `Resultat (${result.competitionId})`;
    linkContainer.classList.remove('hidden');
    log(`Fardig. Competition ID: ${result.competitionId}`);
    log(`Skapade ${result.stats.equipages} ekipage och ${result.stats.volunteerSignups} funktionarsanmalningar.`);
  } catch (error) {
    console.error(error);
    log(`FEL: ${error.message}`);
  } finally {
    seedBtn.disabled = false;
    seedBtn.classList.remove('opacity-50', 'cursor-not-allowed');
  }
});
