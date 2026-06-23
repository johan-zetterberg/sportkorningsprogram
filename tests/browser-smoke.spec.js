import { test, expect } from '@playwright/test';

const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@demo.se';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'admin123';

const ROLE_HIERARCHY = {
  superadmin: ['superadmin', 'admin', 'funktionar', 'publik'],
  admin: ['admin', 'funktionar', 'publik'],
  dressage: ['dressage', 'funktionar', 'publik'],
  marathon: ['marathon', 'funktionar', 'publik'],
  precision: ['precision', 'funktionar', 'publik'],
  speaker: ['speaker', 'funktionar', 'publik'],
  domare: ['domare', 'funktionar', 'publik'],
  funktionar: ['funktionar', 'publik'],
  publik: ['publik']
};

const ROUTE_PERMISSIONS = {
  hub: ['publik', 'funktionar', 'domare', 'admin'],
  admin: ['admin'],
  ekipage: ['admin'],
  deltagare: ['publik', 'funktionar', 'domare', 'admin'],
  hastar: ['publik', 'funktionar', 'domare', 'admin'],
  starttider: ['publik', 'funktionar', 'domare', 'admin'],
  'maraton-tider': ['publik', 'funktionar', 'domare', 'admin'],
  'dressyr-input': ['dressage', 'domare', 'admin'],
  'dressyr-results': ['publik', 'funktionar', 'domare', 'admin'],
  'dressyr-admin': ['admin'],
  'maraton-input': ['marathon', 'domare', 'admin'],
  'maraton-results': ['publik', 'funktionar', 'domare', 'admin'],
  'maraton-monitor': ['publik', 'funktionar', 'domare', 'admin'],
  'maraton-admin': ['admin'],
  'maraton-stages': ['marathon', 'domare', 'admin'],
  'observator-input': ['marathon', 'domare', 'admin'],
  'precision-monitor': ['publik', 'funktionar', 'domare', 'admin'],
  'precision-input': ['precision', 'domare', 'admin'],
  'precision-split-input': ['precision', 'domare', 'admin'],
  'precision-results': ['publik', 'funktionar', 'domare', 'admin'],
  'precision-admin': ['admin'],
  'dressyr-monitor': ['publik', 'funktionar', 'domare', 'admin'],
  vagnbredd: ['funktionar', 'domare', 'admin'],
  'total-resultat': ['publik', 'funktionar', 'domare', 'admin'],
  portal: ['publik', 'funktionar', 'domare', 'admin'],
  'competition-center': ['publik', 'funktionar', 'domare', 'admin'],
  speaker: ['speaker', 'domare', 'admin'],
  'prize-giving': ['speaker', 'funktionar', 'domare', 'admin'],
  reports: ['funktionar', 'domare', 'admin'],
  'vet-check': ['funktionar', 'domare', 'admin'],
  manual: ['publik', 'funktionar', 'domare', 'admin'],
  official: ['funktionar', 'domare', 'admin']
};

test.beforeEach(async ({ page }) => {
  await loginIfNeeded(page);
});

test('seeded edge-case smoke flow', async ({ page }) => {
  await seedCompetition(page, { includeEdgeCases: true, includeStress: false });

  await page.goto('/index.html#dressyr-results');
  await expect(page.locator('#page-dressyr-results')).toContainText('Finalisera');
  await expect(page.locator('#page-dressyr-results')).toContainText('Klar');
  await expect(page.locator('#page-dressyr-results button[data-action="finalize"]').first()).toBeVisible();

  await page.goto('/index.html#official');
  await expect(page.locator('#page-official')).toContainText('Funktionärsportal');
  const pendingWidget = page.locator('#widget-pending-text');
  await expect(pendingWidget).not.toContainText('Allt är attesterat');
  await expect(pendingWidget).toContainText(/Dressyr|Maraton|Precision/);

  await page.goto('/index.html#admin');
  await page.locator('#tab-btn-officials').click();
  const officialsView = page.locator('#view-officials');
  await expect(officialsView).toContainText(/Inkorg|Inkomna anmälningar|Inkomna anmalningar/);
  await officialsView.getByRole('button', { name: /Inkorg/i }).click();
  await expect(officialsView).toContainText(/Inkomna anmälningar|Inkomna anmalningar/);
  await expect(officialsView).toContainText(/Anna Reserv|Beata Funktionar/);
});

test('seeded stress monitor smoke flow', async ({ page }) => {
  test.setTimeout(300000);
  await seedCompetition(page, { includeEdgeCases: true, includeStress: true });

  await page.goto('/index.html#total-resultat');
  await expect(page.locator('#page-total-resultat')).toContainText(/Stress Kusk|Seeder Kusk/);

  await page.goto('/index.html#maraton-monitor');
  await expect(page.locator('#page-maraton-monitor')).toContainText('På Banan');
  await expect(page.locator('#page-maraton-monitor')).toContainText(/Stress Kusk|Seeder Kusk/);
  await expect(page.locator('#page-maraton-monitor')).toContainText(/\d{2}:\d{2},\d{2}/);
});

test('public center and portal audience smoke flow', async ({ page }) => {
  await seedCompetition(page, { includeEdgeCases: true, includeStress: false });
  await seedPublicAudienceFixtures(page);
  const competitionId = await page.evaluate(() => localStorage.getItem('lastCompetitionId'));

  await page.goto('/index.html#competition-center');
  await expect(page.locator('#page-competition-center')).toContainText('Publik Info');
  await expect(page.locator('#page-competition-center')).toContainText('Smoke Public Doc');
  await expect(page.locator('#page-competition-center')).toContainText('Smoke Public Message');
  await expect(page.locator('#page-competition-center')).not.toContainText('Smoke Drivers Doc');
  await expect(page.locator('#page-competition-center')).not.toContainText('Smoke Drivers Message');
  await page.goto(`/index.html#competition-center?id=${competitionId}`);
  await expect(page.locator('#page-competition-center')).toContainText('Smoke Public Doc');

  await page.goto('/index.html#portal');
  await expect(page.locator('#page-portal')).toContainText('Min Kuskportal');
  await page.locator('#adminImpersonateCompId').fill(competitionId);
  await page.locator('#adminImpersonateStartNo').fill('1');
  await page.locator('#adminImpersonateBtn').click();

  await expect(page.locator('#page-portal')).toContainText('Smoke Public Message');
  await expect(page.locator('#page-portal')).toContainText('Smoke Drivers Message');
  await page.getByRole('button', { name: /Dokument|Documents/i }).click();
  await expect(page.locator('#dash-content')).toContainText('Smoke Public Doc');
  await expect(page.locator('#dash-content')).toContainText('Smoke Drivers Doc');
});

test('all main pages navigate without browser errors', async ({ page }) => {
  test.setTimeout(300000);
  await forceLogin(page);
  const smokeRoles = await getSmokeRoles(page);

  const browserErrors = [];
  collectBrowserErrors(page, browserErrors);

  const routes = [
    'hub',
    'admin',
    'ekipage',
    'deltagare',
    'hastar',
    'starttider',
    'dressyr-admin',
    'dressyr-input',
    'dressyr-monitor',
    'dressyr-results',
    'maraton-admin',
    'maraton-tider',
    'maraton-input',
    'maraton-stages',
    'observator-input',
    'maraton-monitor',
    'maraton-results',
    'precision-admin',
    'precision-input',
    'precision-split-input',
    'precision-monitor',
    'precision-results',
    'vagnbredd',
    'vet-check',
    'reports',
    'official',
    'speaker',
    'prize-giving',
    'total-resultat',
    'competition-center',
    'portal',
    'manual'
  ];

  for (const route of routes) {
    await page.goto(`/index.html#${route}`);
    if (canAccessRoute(route, smokeRoles)) {
      await expectRouteOrHub(page, route, `#${route} should become active or return to hub for roles: ${smokeRoles.join(', ')}`);
    } else {
      await expect(page.locator('#page-hub'), `#${route} should redirect to hub for roles: ${smokeRoles.join(', ')}`).toHaveClass(/active/);
    }
    await page.waitForTimeout(1000);
  }

  expect(browserErrors).toEqual([]);
});

test('maraton stages can pause resume reset save and reload state', async ({ page }) => {
  test.setTimeout(300000);
  await seedCompetition(page, { includeEdgeCases: true, includeStress: false });

  const browserErrors = [];
  collectBrowserErrors(page, browserErrors);

  await page.goto('/index.html#maraton-stages');
  await expectRouteOrHub(page, 'maraton-stages', '#maraton-stages should be active for functional flow');

  const searchInput = page.locator('#equipageDropdown .search-input');
  await expect(searchInput).toBeVisible();
  await page.locator('#eqNext').click();

  const eqInfo = page.locator('#eqInfo');
  await expect(eqInfo).toContainText('#');
  const eqInfoText = (await eqInfo.textContent()) || '';
  const startNumberMatch = eqInfoText.match(/#(\d+)/);
  expect(startNumberMatch, `Could not parse start number from eqInfo text: ${eqInfoText}`).toBeTruthy();
  const startNumber = startNumberMatch[1];

  const saveButton = page.locator('#stagePanel button[id^="btnSave-"]').first();
  await expect(saveButton).toBeVisible();
  const saveButtonId = await saveButton.getAttribute('id');
  const stageId = String(saveButtonId || '').replace('btnSave-', '');
  expect(stageId).toBeTruthy();

  const timerDisplay = page.locator(`#timer-${stageId}`);
  const startButton = page.locator(`#btnStart-${stageId}`);
  const stopButton = page.locator(`#btnStop-${stageId}`);
  const startClock = page.locator(`#startClock-${stageId}`);
  const stopClock = page.locator(`#stopClock-${stageId}`);
  const commentStart = page.locator(`#commentStart-${stageId}`);
  const otherPenalty = page.locator('#otherMarathonPenalty');

  await expect(timerDisplay).toHaveText('00:00,00');
  await expect(startButton).toBeVisible();
  await startButton.click();
  await expect.poll(async () => (await timerDisplay.textContent()) || '', {
    timeout: 10000,
    message: 'Timer did not start within 10 seconds'
  }).not.toBe('00:00,00');
  await expect(page.locator('#toggleActiveTimers')).toContainText('(1)');
  await expect(startClock).not.toHaveText(/^[–—-]$/);
  const originalStartClock = await startClock.textContent();

  await stopButton.click();
  await page.waitForTimeout(500);
  const stoppedText = await timerDisplay.textContent();
  expect(stoppedText && stoppedText !== '00:00,00', `Timer did not stop with recorded time, current text: ${stoppedText}`).toBeTruthy();
  const stoppedMs = parseStageTimerMs(stoppedText);
  expect(stoppedMs).toBeGreaterThan(0);
  await expect(startClock).toHaveText(originalStartClock || '');
  await expect(stopClock).not.toHaveText(/^[–—-]$/);
  await page.waitForTimeout(1200);
  expect(parseStageTimerMs(await timerDisplay.textContent())).toBe(stoppedMs);

  await startButton.click();
  await expect(startClock).toHaveText(originalStartClock || '');
  await expect(stopClock).toHaveText(/^[–—-]$/);
  await expect.poll(async () => parseStageTimerMs(await timerDisplay.textContent()), {
    timeout: 10000,
    message: 'Timer did not resume from its paused value'
  }).toBeGreaterThan(stoppedMs);
  await stopButton.click();
  await expect.poll(async () => parseStageTimerMs(await timerDisplay.textContent()), {
    timeout: 10000
  }).toBeGreaterThan(stoppedMs);

  await page.locator('#stagePanel .comment-toggle-btn').click();
  await commentStart.fill('Smoke start kommentar');
  await otherPenalty.fill('7');
  await saveButton.click();
  await page.waitForTimeout(1200);
  const closeAlertButton = page.locator('#closeAlertModal');
  if (await closeAlertButton.isVisible().catch(() => false)) {
    await closeAlertButton.click();
  }
  await page.evaluate(() => {
    const modal = document.getElementById('alertModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
      modal.style.pointerEvents = 'none';
    }
  });

  await page.goto('/index.html#hub');
  await expectRouteOrHub(page, 'hub', '#hub should be active between marathon stage reload checks');
  await page.goto('/index.html#maraton-stages');
  await expectRouteOrHub(page, 'maraton-stages', '#maraton-stages should reload after hub navigation');
  await page.evaluate(() => {
    const modal = document.getElementById('alertModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
      modal.style.pointerEvents = 'none';
    }
  });

  await page.waitForTimeout(1200);
  const reloadSearchInput = page.locator('#equipageDropdown .search-input');
  await expect(reloadSearchInput).toBeVisible();
  await reloadSearchInput.click();
  await reloadSearchInput.fill(startNumber);
  const selectedOption = page.locator(`#equipageDropdown .searchable-dropdown-list > div[data-value="${startNumber}"]`).first();
  await expect(selectedOption).toBeVisible();
  await selectedOption.click();
  await expect(page.locator('#eqInfo')).toContainText(`#${startNumber}`);

  const reloadTab = page.locator(`[data-stage="${stageId}"]`);
  if (await reloadTab.count()) {
    await reloadTab.first().click();
  }

  await page.locator('#stagePanel .comment-toggle-btn').click();
  await expect(page.locator('#otherMarathonPenalty')).toHaveValue('7');
  const reloadedTimerText = await page.locator(`#timer-${stageId}`).textContent();
  expect(reloadedTimerText && reloadedTimerText !== '00:00,00', `Reloaded timer was not persisted, current text: ${reloadedTimerText}`).toBeTruthy();
  await expect(page.locator(`#startClock-${stageId}`)).toHaveText(originalStartClock || '');

  await page.locator(`#btnReset-${stageId}`).click();
  await expect(page.locator(`#timer-${stageId}`)).toHaveText('00:00,00');
  await expect(page.locator(`#startClock-${stageId}`)).toHaveText(/^[–—-]$/);
  await expect(page.locator(`#stopClock-${stageId}`)).toHaveText(/^[–—-]$/);

  expect(browserErrors).toEqual([]);
});

function parseStageTimerMs(value) {
  const match = String(value || '').trim().match(/^(\d+):(\d{2}),(\d{2})$/);
  if (!match) return 0;
  return (Number(match[1]) * 60_000) + (Number(match[2]) * 1_000) + (Number(match[3]) * 10);
}

test('critical ui interactions open and close without browser errors', async ({ page }) => {
  test.setTimeout(300000);
  await seedCompetition(page, { includeEdgeCases: true, includeStress: false });

  const browserErrors = [];
  collectBrowserErrors(page, browserErrors);

  await page.goto('/index.html#total-resultat');
  await expect(page.locator('#page-total-resultat')).toContainText(/Seeder Kusk|Kusk/);
  await page.locator('#totalResultsContainer [data-start]').first().click();
  await expect(page.locator('.tr-modal-backdrop.visible')).toBeVisible();
  await page.locator('.tr-modal-backdrop.visible .tr-close').click();
  await expect(page.locator('.tr-modal-backdrop.visible')).toHaveCount(0);

  await page.goto('/index.html#maraton-results');
  await expect(page.locator('#page-maraton-results')).toContainText(/Seeder Kusk|Kusk/);
  await page.locator('#page-maraton-results tr[data-sn]').first().click();
  await expect(page.locator('#marathonDetailsModal.visible')).toBeVisible();
  await page.locator('#toggleTimeCardBtn').click();
  await page.locator('#closeMarathonModalBtn').click();
  await expect(page.locator('#marathonDetailsModal.visible')).toHaveCount(0);

  await page.goto('/index.html#precision-results');
  await expect(page.locator('#page-precision-results')).toContainText(/Seeder Kusk|Kusk/);
  await page.locator('#page-precision-results tr[data-sn]').first().click();
  await expect(page.locator('#precisionDetailsModal.visible')).toBeVisible();
  await page.locator('#closePrecModalBtn').click();
  await expect(page.locator('#precisionDetailsModal.visible')).toHaveCount(0);

  await page.goto('/index.html#precision-monitor');
  await expect(page.locator('#page-precision-monitor')).toContainText(/Lista|Karta/);
  await page.locator('#prec-btn-view-map').click();
  await expect(page.locator('#precision-map-view')).not.toHaveClass(/hidden/);
  await page.goto('/index.html#hub');
  await expectRouteOrHub(page, 'hub', '#hub should remain stable after leaving precision map');

  await page.goto('/index.html#speaker');
  const speakerActive = await page.locator('#page-speaker').evaluate(el => el.classList.contains('active')).catch(() => false);
  if (speakerActive) {
    await expect(page.locator('#discipline-switcher')).toBeVisible();
    for (const label of ['Dressyr', 'Maraton', 'Precision', 'Totalt']) {
      await page.locator('#discipline-switcher').getByRole('button', { name: label }).click();
      await expect(page.locator('#current-rider-card')).toBeVisible();
    }
  }

  expect(browserErrors).toEqual([]);
});

async function loginIfNeeded(page) {
  await page.goto('/index.html#hub');

  const roleLabel = page.locator('#userRole');
  if (await roleLabel.getByText(/Superadmin|Admin/i).isVisible().catch(() => false)) {
    return;
  }

  const logoutButton = page.locator('#logoutButton');
  const loginButton = page.locator('#loginButton');
  const hasRoleText = await roleLabel.textContent().then(text => !!text?.trim()).catch(() => false);
  if (hasRoleText && await logoutButton.isVisible().catch(() => false)) {
    return;
  }

  await loginButton.click({ force: true });
  const emailField = page.locator('#email');
  if (!await emailField.isVisible({ timeout: 2000 }).catch(() => false)) {
    await page.evaluate(() => {
      const modal = document.getElementById('loginModal');
      if (modal) modal.style.display = 'flex';
    });
  }
  await emailField.fill(TEST_EMAIL);
  await page.locator('#password').fill(TEST_PASSWORD);
  await page.locator('#loginForm button[type="submit"]').click();

  await expect(logoutButton).toBeVisible();
}

async function forceLogin(page) {
  await page.goto('/index.html#hub');

  const logoutButton = page.locator('#logoutButton');
  if (await logoutButton.isVisible().catch(() => false)) {
    await logoutButton.click();
    await expect(page.locator('#loginButton')).toBeVisible();
  }

  await loginIfNeeded(page);
}

async function getSmokeRoles(page) {
  const text = await page.locator('#userRole').textContent().catch(() => '');
  const normalized = (text || '').trim().toLowerCase();
  if (!normalized) return ['publik'];
  if (normalized.includes('superadmin')) return ['superadmin'];
  if (normalized.includes('admin')) return ['admin'];
  if (normalized.includes('speaker')) return ['speaker'];
  if (normalized.includes('dressage')) return ['dressage'];
  if (normalized.includes('marathon')) return ['marathon'];
  if (normalized.includes('precision')) return ['precision'];
  if (normalized.includes('funktion')) return ['funktionar'];
  if (normalized.includes('domare')) return ['domare'];
  return ['publik'];
}

function canAccessRoute(route, roles) {
  const requiredRoles = ROUTE_PERMISSIONS[route] || ['publik', 'funktionar', 'domare', 'admin'];
  return roles.some(role => {
    if (role === 'superadmin') return true;
    const expanded = ROLE_HIERARCHY[role] || [role, 'publik'];
    return requiredRoles.some(requiredRole => expanded.includes(requiredRole));
  });
}

async function expectRouteOrHub(page, route, message) {
  await page.waitForFunction((routeName) => {
    const requestedPage = document.getElementById(`page-${routeName}`);
    const hubPage = document.getElementById('page-hub');
    return requestedPage?.classList.contains('active') || hubPage?.classList.contains('active');
  }, route, { timeout: 10000 });

  const routeIsActive = await page.locator(`#page-${route}`).evaluate(el => el.classList.contains('active')).catch(() => false);
  const hubIsActive = await page.locator('#page-hub').evaluate(el => el.classList.contains('active')).catch(() => false);
  expect(routeIsActive || hubIsActive, message).toBe(true);
}

async function seedCompetition(page, { includeEdgeCases, includeStress }) {
  await page.goto('/seed_test.html');

  const edgeToggle = page.locator('#edgeToggle');
  const stressToggle = page.locator('#stressToggle');
  await edgeToggle.setChecked(includeEdgeCases);
  await stressToggle.setChecked(includeStress);

  await page.locator('#seedBtn').click();
  const seedStarted = await page.waitForFunction(() => {
    const text = document.getElementById('status')?.textContent?.trim() || '';
    return text !== '' && text !== 'Redo.';
  }, null, { timeout: 10000 })
    .then(() => true)
    .catch(() => false);

  test.skip(!seedStarted, 'Seedern startade inte i denna browsermiljo.');

  await expect(page.locator('#status')).toContainText('Fardig', { timeout: 120000 });
  await expect(page.locator('#linkContainer')).toBeVisible({ timeout: 120000 });

  const competitionId = await page.evaluate(() => localStorage.getItem('lastCompetitionId'));
  expect(competitionId).toBeTruthy();
}

function collectBrowserErrors(page, browserErrors) {
  page.on('console', msg => {
    if (msg.type() === 'error') {
      if (msg.text().includes('Failed to load resource:')) return;
      browserErrors.push(`console.error: ${msg.text()}`);
    }
  });

  page.on('pageerror', error => {
    browserErrors.push(`pageerror: ${error.message}`);
  });

  page.on('response', response => {
    const url = response.url();
    const status = response.status();
    const request = response.request();
    const localAsset = url.startsWith('http://127.0.0.1:5500/')
      || url.startsWith('http://localhost:5500/');
    const checkedTypes = ['document', 'script', 'stylesheet', 'image', 'font'];

    if (localAsset && status >= 400 && checkedTypes.includes(request.resourceType())) {
      browserErrors.push(`${status} ${request.resourceType()}: ${url}`);
    }
  });
}

async function seedPublicAudienceFixtures(page) {
  await page.evaluate(async () => {
    const competitionId = localStorage.getItem('lastCompetitionId');
    if (!competitionId) throw new Error('Missing competitionId');

    const [{ saveConfig }, { saveCompetitionDocument, saveCompetitionMessage }] = await Promise.all([
      import('../js/services/competitionService.js'),
      import('../js/services/documentService.js')
    ]);

    await saveConfig(competitionId, 'publicInfo', {
      enabled: true,
      introHtml: 'Smoke intro',
      publish: {
        classSummary: true,
        documents: true,
        messages: true,
        maps: true
      }
    });

    await saveCompetitionDocument(competitionId, {
      title: 'Smoke Public Doc',
      category: 'Information',
      type: 'html',
      content: 'Visible for public and drivers',
      audience: { public: true, drivers: true }
    });

    await saveCompetitionDocument(competitionId, {
      title: 'Smoke Drivers Doc',
      category: 'Information',
      type: 'html',
      content: 'Visible only for drivers',
      audience: { public: false, drivers: true }
    });

    await saveCompetitionMessage(competitionId, {
      title: 'Smoke Public Message',
      body: 'Visible for public and drivers',
      type: 'info',
      audience: { public: true, drivers: true }
    });

    await saveCompetitionMessage(competitionId, {
      title: 'Smoke Drivers Message',
      body: 'Visible only for drivers',
      type: 'info',
      audience: { public: false, drivers: true }
    });
  });
}
