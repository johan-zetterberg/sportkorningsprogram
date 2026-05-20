import { test, expect } from '@playwright/test';

const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@demo.se';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'admin123';

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

async function loginIfNeeded(page) {
  await page.goto('/index.html#hub');

  const logoutButton = page.locator('#logoutButton');
  if (await logoutButton.isVisible().catch(() => false)) {
    return;
  }

  const loginButton = page.locator('#loginButton');
  await loginButton.click();
  await page.locator('#email').fill(TEST_EMAIL);
  await page.locator('#password').fill(TEST_PASSWORD);
  await page.locator('#loginForm button[type="submit"]').click();

  await expect(logoutButton).toBeVisible();
}

async function seedCompetition(page, { includeEdgeCases, includeStress }) {
  await page.goto('/seed_test.html');

  const edgeToggle = page.locator('#edgeToggle');
  const stressToggle = page.locator('#stressToggle');
  await edgeToggle.setChecked(includeEdgeCases);
  await stressToggle.setChecked(includeStress);

  await page.locator('#seedBtn').click();
  await expect(page.locator('#linkContainer')).toBeVisible({ timeout: 120000 });
  await expect(page.locator('#status')).toContainText('Fardig', { timeout: 120000 });

  const competitionId = await page.evaluate(() => localStorage.getItem('lastCompetitionId'));
  expect(competitionId).toBeTruthy();
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
