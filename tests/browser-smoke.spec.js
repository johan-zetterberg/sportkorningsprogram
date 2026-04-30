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
  await seedCompetition(page, { includeEdgeCases: true, includeStress: true });

  await page.goto('/index.html#total-resultat');
  await expect(page.locator('#page-total-resultat')).toContainText(/Stress Kusk|Seeder Kusk/);

  await page.goto('/index.html#maraton-monitor');
  await expect(page.locator('#page-maraton-monitor')).toContainText('På Banan');
  await expect(page.locator('#page-maraton-monitor')).toContainText(/Stress Kusk|Seeder Kusk/);
  await expect(page.locator('#page-maraton-monitor')).toContainText(/\d{2}:\d{2},\d{2}/);
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
