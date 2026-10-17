import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@demo.se';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'admin123';

const ROLE_HIERARCHY = {
  superadmin: ['superadmin', 'admin', 'funktionar', 'publik'],
  admin: ['admin', 'funktionar', 'publik'],
  dressage: ['dressage', 'funktionar', 'publik'],
  marathon: ['marathon', 'funktionar', 'publik'],
  precision: ['precision', 'funktionar', 'publik'],
  speaker: ['speaker', 'funktionar', 'publik'],
  vet: ['vet', 'publik'],
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
  vagnbredd: ['precision', 'domare', 'admin'],
  'total-resultat': ['publik', 'funktionar', 'domare', 'admin'],
  portal: ['publik', 'funktionar', 'domare', 'admin'],
  'competition-center': ['publik', 'funktionar', 'domare', 'admin'],
  speaker: ['speaker', 'domare', 'admin'],
  'prize-giving': ['speaker', 'funktionar', 'domare', 'admin'],
  reports: ['funktionar', 'domare', 'admin'],
  'vet-check': ['vet', 'admin'],
  manual: ['publik', 'funktionar', 'domare', 'admin'],
  official: ['funktionar', 'domare', 'admin']
};

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.title.includes('quick guide keeps keyboard focus')) return;
  await useFirebaseEmulators(page);
  await loginIfNeeded(page);
});

test('quick guide keeps keyboard focus inside the dialog and restores it on close', async ({ page }) => {
  // This UI component has no Firebase dependency. Loading a same-origin static
  // resource gives the module a browser document without coupling the test to
  // emulator login or competition state.
  await page.goto('/service-worker.js');

  await page.evaluate(async () => {
    document.body.innerHTML = '';
    const opener = document.createElement('button');
    opener.id = 'quick-guide-test-opener';
    opener.textContent = 'Open guide';
    document.body.appendChild(opener);
    opener.focus();

    const { openQuickGuide } = await import('/js/ui/quickGuideDrawer.js');
    openQuickGuide('dressage');
  });

  const dialog = page.locator('.qg-backdrop[role="dialog"]');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#qg-close-btn')).toBeFocused();

  await page.locator('#qg-footer-close').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#qg-pdf-btn')).toBeFocused();

  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#qg-footer-close')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('#quick-guide-test-opener')).toBeFocused();
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
  // The widget fills in once its data has loaded, which takes longer when the whole suite runs
  await expect(pendingWidget).toContainText(/Dressyr|Maraton|Precision/, { timeout: 60000 });

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

test('names with HTML are shown as text on public pages, never run', async ({ page }) => {
  test.setTimeout(300000);
  const competitionId = await seedCompetition(page, { includeEdgeCases: false, includeStress: false });
  const payload = (tag) => `<img src=x onerror="window.__xss=(window.__xss||[]).concat('${tag}')">${tag}`;

  await page.evaluate(async ({ competitionId, names }) => {
    const { getEquipages, saveEquipage } = await import('../js/services/equipageService.js');
    const { updateCompetition } = await import('../js/services/competitionService.js');
    const equipages = await getEquipages(competitionId);
    const eq = equipages.find(e => e.startNumber != null) || equipages[0];
    await saveEquipage(competitionId, eq.startNumber, {
      driverName: names.driver, clubName: names.club, horseName: names.horse, speakerNotes: names.notes
    });
    await updateCompetition(competitionId, { name: names.comp, location: names.loc });
  }, {
    competitionId,
    names: {
      driver: payload('DRIVER'), club: payload('CLUB'), horse: payload('HORSE'),
      notes: `</textarea>${payload('NOTES')}`, comp: payload('COMP'), loc: payload('LOC')
    }
  });

  const routes = ['deltagare', 'hastar', 'starttider', 'dressyr-results', 'maraton-results', 'precision-results',
    'total-resultat', 'dressyr-monitor', 'maraton-monitor', 'precision-monitor', 'speaker', 'competition-center',
    'admin', 'ekipage', 'maraton-admin', 'precision-admin', 'dressyr-input', 'maraton-stages', 'observator-input'];
  for (const route of routes) {
    await page.goto(`/index.html#${route}`);
    await page.waitForTimeout(2500);
    const fired = await page.evaluate(() => window.__xss || []);
    expect(fired, `HTML in data ran as code on #${route}`).toEqual([]);
  }
  // The header shows the name as text
  await page.goto('/index.html#deltagare');
  await expect(page.locator('.competition-page-header h1').first()).toContainText('<img src=x');
});

test('deleting a competition removes its personal data and results', async ({ page }) => {
  test.setTimeout(300000);
  const competitionId = await seedCompetition(page, { includeEdgeCases: true, includeStress: false });
  const left = await page.evaluate(async (competitionId) => {
    const { db, appId } = await import('../js/config/firebase-config.js');
    const { collection, doc, getDocs, setDoc } = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js');
    const { deleteCompetition } = await import('../js/services/competitionService.js');
    const { saveOfficial } = await import('../js/services/adminService.js');
    const base = `artifacts/${appId}/public/data/competitions/${competitionId}`;
    // A protocol without a parent document (as the judges' page writes them),
    // and an official with contact details
    // (the last equipage: the seed finalizes the first ones, which locks them)
    const sn = (await getDocs(collection(db, `${base}/equipages`))).docs.at(-1).id;
    await setDoc(doc(db, `${base}/dressage/${sn}/protocols/judge_x`), { startNumber: sn, movements: [] });
    await saveOfficial(competitionId, { name: 'Radera Mig', phone: '070', email: 'radera@example.com' });
    await deleteCompetition(competitionId);
    // Counted with the emulator's admin access: without the competition
    // nobody may list its private collections any more
    const counts = {};
    for (const path of ['equipages', 'equipagePrivate', 'officials', 'officialsPrivate', 'precision', 'maraton', `dressage/${sn}/protocols`, 'config']) {
      const res = await fetch(`http://127.0.0.1:8080/v1/projects/demo-combined-driving/databases/(default)/documents/${base}/${path}`, {
        headers: { Authorization: 'Bearer owner' }
      });
      counts[path.startsWith('dressage/') ? 'protocols' : path] = ((await res.json()).documents || []).length;
    }
    // The finalization locks outside the artifacts tree, and the competition itself
    for (const path of [`competitions/${competitionId}/precisionFinalization`, `competitions/${competitionId}/marathonFinalization`, `competitions/${competitionId}/dressageFinalization`]) {
      const res = await fetch(`http://127.0.0.1:8080/v1/projects/demo-combined-driving/databases/(default)/documents/${path}`, {
        headers: { Authorization: 'Bearer owner' }
      });
      counts[path.split('/').at(-1)] = ((await res.json()).documents || []).length;
    }
    const compRes = await fetch(`http://127.0.0.1:8080/v1/projects/demo-combined-driving/databases/(default)/documents/${base}`, {
      headers: { Authorization: 'Bearer owner' }
    });
    counts.competition = compRes.status;
    return counts;
  }, competitionId);
  expect(left).toEqual({
    equipages: 0, equipagePrivate: 0, officials: 0, officialsPrivate: 0, precision: 0, maraton: 0, protocols: 0, config: 0,
    precisionFinalization: 0, marathonFinalization: 0, dressageFinalization: 0, competition: 404
  });
});

test('archiving saves a snapshot and locks results until the competition is reopened', async ({ page }) => {
  test.setTimeout(300000);
  const competitionId = await seedCompetition(page, { includeEdgeCases: false, includeStress: false });
  // The archiving service loads main.js (through the PDF code): run it in the app page
  await page.goto('/index.html#hub');
  await expect(page.locator('#logoutButton')).toBeVisible({ timeout: 30000 });
  const outcome = await page.evaluate(async (competitionId) => {
    const { db, appId } = await import('../js/config/firebase-config.js');
    const { doc, getDoc, setDoc, collection, getDocs } = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js');
    const { finalizeCompetition, reopenCompetition } = await import('../js/services/archivingService.js');
    const base = `artifacts/${appId}/public/data/competitions/${competitionId}`;
    const out = {};
    // The seed leaves equipages unfinished: refused first, then allowed
    try {
      await finalizeCompetition(competitionId);
      out.refused = false;
    } catch (error) {
      out.refused = error.code === 'archive-incomplete';
    }
    const result = await finalizeCompetition(competitionId, { allowIncomplete: true });
    const snapshot = await getDoc(doc(db, `${base}/archive/${result.snapshotId}`));
    out.snapshotRows = snapshot.data()?.rows?.length || 0;
    out.locked = (await getDoc(doc(db, base))).data()?.locked === true;
    const sn = (await getDocs(collection(db, `${base}/equipages`))).docs.at(-1).id;
    try {
      await setDoc(doc(db, `${base}/precision/${sn}`), { extraPenalty: 1 }, { merge: true });
      out.writeWhileArchived = 'allowed';
    } catch (error) {
      out.writeWhileArchived = error.code;
    }
    await reopenCompetition(competitionId);
    await setDoc(doc(db, `${base}/precision/${sn}`), { extraPenalty: 0 }, { merge: true });
    out.writeAfterReopen = 'allowed';
    out.reopenLogged = ((await getDoc(doc(db, base))).data()?.reopenHistory || []).length;
    return out;
  }, competitionId);
  expect(outcome.refused).toBe(true);
  expect(outcome.snapshotRows).toBeGreaterThan(0);
  expect(outcome.locked).toBe(true);
  expect(outcome.writeWhileArchived).toBe('permission-denied');
  expect(outcome.writeAfterReopen).toBe('allowed');
  expect(outcome.reopenLogged).toBe(1);
});

test('logout leaves no competition data on a shared device', async ({ page }) => {
  await page.goto('/index.html#hub');
  await expect(page.locator('#logoutButton')).toBeVisible({ timeout: 30000 });
  await page.evaluate(() => {
    localStorage.setItem('bkp_comp_dre_12', JSON.stringify({ protocol: { judgeId: 'x' } }));
    localStorage.setItem('configCache:comp:display', JSON.stringify({ ts: Date.now(), data: {} }));
    localStorage.setItem('theme', 'dark');
  });
  // Logout ends with a reload: check after it
  const reloaded = page.waitForEvent('load', { timeout: 30000 });
  await page.locator('#logoutButton').click();
  await reloaded;
  await expect(page.locator('#loginButton')).toBeVisible({ timeout: 30000 });
  const left = await page.evaluate(() => Object.keys(localStorage));
  expect(left.filter(k => k.startsWith('bkp_') || k.startsWith('configCache:'))).toEqual([]);
  expect(left).toContain('theme'); // personal settings stay
});

test('a driver gets their own messages from the server, not other drivers\'', async ({ page }) => {
  test.setTimeout(300000);
  const competitionId = await seedCompetition(page, { includeEdgeCases: false, includeStress: false });
  const titles = await page.evaluate(async (competitionId) => {
    const { getEquipages, saveEquipage } = await import('../js/services/equipageService.js');
    const { saveCompetitionMessage, getDriverInbox } = await import('../js/services/documentService.js');
    const { auth } = await import('../js/config/firebase-config.js');
    const [mine, other] = await getEquipages(competitionId);
    await saveEquipage(competitionId, String(mine.startNumber), { email: auth.currentUser.email });
    const send = (title, extra) => saveCompetitionMessage(competitionId, { title, body: '-', ...extra });
    await send('Till alla', { audience: { public: true, drivers: true } });
    await send('Alla förare', { audience: { public: false, drivers: true } });
    await send('Till mig', { audience: { public: false, drivers: true }, targetStartNumbers: [String(mine.startNumber)] });
    await send('Till någon annan', { audience: { public: false, drivers: true }, targetStartNumbers: [String(other.startNumber)] });
    const inbox = await getDriverInbox(competitionId);
    return inbox.messages.map(m => m.title).sort();
  }, competitionId);
  expect(titles).toEqual(['Alla förare', 'Till alla', 'Till mig']);
});

test('officials contact details are stored privately and still shown to the admin', async ({ page }) => {
  test.setTimeout(300000);
  const competitionId = await seedCompetition(page, { includeEdgeCases: false, includeStress: false });
  const result = await page.evaluate(async (competitionId) => {
    const { saveOfficial, getOfficials, migrateOfficialsPrivacy } = await import('../js/services/adminService.js');
    const { db, appId } = await import('../js/config/firebase-config.js');
    const { doc, getDoc, setDoc } = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js');
    const base = `artifacts/${appId}/public/data/competitions/${competitionId}`;
    const id = await saveOfficial(competitionId, { name: 'Test Funktionär', role: 'Hinderdomare', phone: '070-111', email: 'Test@Example.com', iceName: 'Bo', icePhone: '070-222' });
    // An official stored the old way, with the contact details on the public document
    await setDoc(doc(db, `${base}/officials/legacy-1`), { name: 'Gammal', phone: '070-333', email: 'gammal@example.com' });
    const moved = await migrateOfficialsPrivacy(competitionId);
    const publicNew = (await getDoc(doc(db, `${base}/officials/${id}`))).data();
    const publicLegacy = (await getDoc(doc(db, `${base}/officials/legacy-1`))).data();
    const merged = await getOfficials(competitionId);
    return {
      moved,
      publicNewHasPhone: 'phone' in publicNew || 'email' in publicNew,
      publicLegacyHasPhone: 'phone' in publicLegacy,
      adminSees: merged.find(o => o.id === id)?.phone,
      adminSeesEmail: merged.find(o => o.id === id)?.email,
      adminSeesLegacy: merged.find(o => o.id === 'legacy-1')?.phone
    };
  }, competitionId);
  expect(result).toEqual({
    moved: 1, publicNewHasPhone: false, publicLegacyHasPhone: false,
    adminSees: '070-111', adminSeesEmail: 'test@example.com', adminSeesLegacy: '070-333'
  });
});

test('a driver declaration keeps the vet results on the horses', async ({ page }) => {
  test.setTimeout(300000);
  const competitionId = await seedCompetition(page, { includeEdgeCases: false, includeStress: false });
  const outcome = await page.evaluate(async (competitionId) => {
    const { getEquipages, saveEquipage, updateEquipageDeclaration } = await import('../js/services/equipageService.js');
    const { auth } = await import('../js/config/firebase-config.js');
    const eq = (await getEquipages(competitionId))[0];
    const sn = String(eq.startNumber);
    // The seed's start times are today, which locks the declaration: start in a week
    const { saveConfig, getConfig } = await import('../js/services/competitionService.js');
    const inAWeek = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    const later = `${inAWeek.getFullYear()}-${pad(inAWeek.getMonth() + 1)}-${pad(inAWeek.getDate())}T10:00`;
    const seeded = (await getConfig(competitionId, 'startTimes', true))?.times?.[sn] || {};
    const moved = Object.fromEntries(['dressage', 'marathon', 'precision', ...Object.keys(seeded)].map(key => [key, later]));
    await saveConfig(competitionId, 'startTimes', { times: { [sn]: moved } });
    // This (verified) user is the equipage's contact; one horse is inspected
    await saveEquipage(competitionId, sn, {
      email: auth.currentUser.email,
      horses: [{ name: 'Ella', id: 'SE001', chip: '752', vetStatus: 'underkänd', inspections: { first: { status: 'underkänd' } } }]
    });
    await updateEquipageDeclaration(competitionId, sn, {
      groom: 'Anna', carriage: 'Maraton', clubName: 'Klubben',
      horses: [{ name: 'Ella', id: 'SE001', vetStatus: 'godkänd' }, { name: 'Ny häst', id: '' }]
    });
    let renameRefused = '';
    try {
      await updateEquipageDeclaration(competitionId, sn, { horses: [{ name: 'Annan', id: 'SE001' }] });
    } catch (error) { renameRefused = error.message; }
    const after = (await getEquipages(competitionId)).find(e => String(e.startNumber) === sn);
    return { horses: after.horses, groom: after.groom, renameRefused };
  }, competitionId);

  expect(outcome.groom).toBe('Anna');
  expect(outcome.horses[0]).toMatchObject({ name: 'Ella', chip: '752', vetStatus: 'underkänd' });
  expect(outcome.horses[1]).toMatchObject({ name: 'Ny häst' });
  expect(outcome.renameRefused).toMatch(/besiktad/);
});

test('after an update the app starts without signal and opens pages not visited yet', async ({ page, context }) => {
  test.setTimeout(300000);
  await page.goto('/index.html#hub');
  // The service worker installs (precache) and takes over this page
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 120000 });
  await page.evaluate(() => navigator.serviceWorker.ready);

  // What an offline start needs is stored ahead of time by the update: the
  // input pages (loaded with import()) and the Firebase SDK. Checked in the
  // cache directly, since the browser's offline mode does not cover the
  // service worker's own requests
  const precached = await page.evaluate(async () => {
    const name = (await caches.keys()).find(k => k.startsWith('driving-app-'));
    const urls = name ? (await (await caches.open(name)).keys()).map(r => r.url) : [];
    const has = (end) => urls.some(u => u.endsWith(end));
    return {
      precisionInput: has('/js/pages/precision/precision-input.js'),
      stagesInput: has('/js/pages/marathon/maraton-stages-input.js'),
      manual: has('/js/pages/shared/manual.js'),
      firestoreSdk: has('/firebasejs/11.6.1/firebase-firestore.js'),
      appSdk: has('/firebasejs/11.6.1/firebase-app.js')
    };
  });
  expect(precached).toEqual({ precisionInput: true, stagesInput: true, manual: true, firestoreSdk: true, appSdk: true });

  // The worker runs the page's version and knows which version this tab runs
  // (it keeps that cache while the tab is open); the first install taking
  // over the page is not a new version (no reload, no prompt)
  const versions = await page.evaluate(async () => {
    const { APP_VERSION } = await import('/js/appVersion.js');
    const worker = await new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (event) => resolve(event.data?.version);
      navigator.serviceWorker.controller.postMessage({ type: 'CLIENT_VERSION', version: APP_VERSION }, [channel.port2]);
    });
    return { page: APP_VERSION, worker };
  });
  expect(versions.worker).toBe(versions.page);
  await expect.poll(() => page.evaluate(async () => {
    const res = await (await caches.open('app-sw-clients')).match('/__sw-clients.json');
    return res ? Object.values(await res.json()) : [];
  })).toContain(versions.page);
  await expect(page.locator('#appUpdateNotice')).toHaveCount(0);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#page-hub')).toHaveClass(/active/, { timeout: 30000 });
  for (const route of ['manual', 'total-resultat', 'precision-results']) {
    await page.goto(`/index.html#${route}`);
    const pageEl = page.locator(`#page-${route}`);
    await expect(pageEl).toHaveClass(/active/, { timeout: 30000 });
    await page.waitForTimeout(1500);
    await expect(pageEl, `#${route} offline`).not.toContainText(/kunde inte laddas|Ett fel uppstod vid laddning/);
    // Rendered by the page module (e.g. "Ingen tävling vald." when none is chosen)
    expect((await pageEl.innerText()).trim().length, `#${route} rendered offline`).toBeGreaterThan(10);
  }
  await context.setOffline(false);
});

test('precision knocks can be recorded without signal and reach the server afterwards', async ({ page, context }) => {
  test.setTimeout(300000);
  const competitionId = await seedCompetition(page, { includeEdgeCases: false, includeStress: false });
  // The seed has no precision course: give every class three gates
  await page.evaluate(async (competitionId) => {
    const { getEquipages } = await import('../js/services/equipageService.js');
    const { getConfig, saveConfig } = await import('../js/services/competitionService.js');
    const classes = [...new Set((await getEquipages(competitionId)).map(e => e.className).filter(Boolean))];
    const config = (await getConfig(competitionId, 'precisionConfig')) || {};
    const courses = { ...(config.courses || {}) };
    classes.forEach((cls) => { courses[cls] = { ...(courses[cls] || {}), obstacleLabels: ['1', '2', '3'] }; });
    await saveConfig(competitionId, 'precisionConfig', { ...config, courses });
  }, competitionId);

  await page.goto('/index.html#precision-input');
  await expect(page.locator('#precisionEquipageSearchContainer .search-input')).toBeVisible();
  await page.locator('#btnNextEq').click();
  const gate = page.locator('#gatesGrid .gateBtn').first();
  await expect(gate).toBeVisible();
  const gateLabel = await gate.getAttribute('data-g');
  const startNumber = await page.evaluate(() => document.querySelector('#precisionEquipageSearchContainer .search-input')?.value?.match(/#(\d+)/)?.[1]);
  expect(startNumber).toBeTruthy();
  await page.waitForTimeout(1500);

  // No signal: the knock must stay (it was rolled back with an error before)
  await context.setOffline(true);
  await gate.click();
  await page.waitForTimeout(6000);
  await expect(gate).toHaveClass(/bg-red-600/);
  await expect(page.locator('#alertModal')).not.toContainText(/Fel|fel/);

  // Signal back: the queued write reaches the server
  await context.setOffline(false);
  await expect.poll(async () => page.evaluate(async ({ competitionId, startNumber }) => {
    const { db, appId } = await import('../js/config/firebase-config.js');
    const { doc, getDocFromServer } = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js');
    try {
      const snap = await getDocFromServer(doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/precision/${startNumber}`));
      return snap.exists() ? (snap.data().knocks || []) : [];
    } catch { return []; }
  }, { competitionId, startNumber }), { timeout: 60000 }).toContain(gateLabel);
});

test('marathon input loads a seeded equipage with obstacle data without errors', async ({ page }) => {
  await seedCompetition(page, { includeEdgeCases: true, includeStress: false });
  // Errors in loading a result are caught and logged (console.error), errors
  // in the live listener are uncaught (pageerror): collect both
  const browserErrors = [];
  collectBrowserErrors(page, browserErrors);

  await page.goto('/index.html#maraton-input');
  await expect(page.locator('#maratonObstacleSelect')).toBeVisible();
  // The seed has an equipage running at obstacle 3: selecting the obstacle
  // auto-selects that driver and applies its live state (applyLiveStateToUI,
  // which also reads the waiting/hold-time list)
  const select = page.locator('#maratonObstacleSelect');
  await expect.poll(async () => select.locator('option[value="3"]').count()).toBe(1);
  await select.selectOption('3');
  await page.waitForTimeout(2000);
  await page.locator('#nextEquipage').click();
  await page.waitForTimeout(1500);

  expect(browserErrors).toEqual([]);
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

test('public center explicit competition id overrides previous selection', async ({ page }) => {
  test.setTimeout(240000);
  const firstCompetitionId = await seedCompetition(page, { includeEdgeCases: true, includeStress: false });
  await setPublicInfoIntro(page, firstCompetitionId, 'Smoke explicit first competition');

  const secondCompetitionId = await seedCompetition(page, { includeEdgeCases: true, includeStress: false });
  await setPublicInfoIntro(page, secondCompetitionId, 'Smoke explicit second competition');

  await page.goto(`/index.html#competition-center?id=${secondCompetitionId}`);
  await expect(page.locator('#page-competition-center')).toContainText('Smoke explicit second competition');

  await page.goto(`/index.html#competition-center?id=${firstCompetitionId}`);
  await expect(page.locator('#page-competition-center')).toContainText('Smoke explicit first competition');
  await expect(page.locator('#page-competition-center')).not.toContainText('Smoke explicit second competition');
});

test('all main pages navigate without browser errors @mobile', async ({ page }) => {
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

  // Reset asks for confirmation
  page.once('dialog', dialog => dialog.accept());
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

test('critical ui interactions open and close without browser errors @mobile', async ({ page }) => {
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
  // A table row on a computer, a card on a phone
  await page.locator('#page-maraton-results [data-sn]:visible').first().click();
  await expect(page.locator('#marathonDetailsModal.visible')).toBeVisible();
  await page.locator('#toggleTimeCardBtn').click();
  await page.locator('#closeMarathonModalBtn').click();
  await expect(page.locator('#marathonDetailsModal.visible')).toHaveCount(0);

  await page.goto('/index.html#precision-results');
  await expect(page.locator('#page-precision-results')).toContainText(/Seeder Kusk|Kusk/);
  await page.locator('#page-precision-results [data-sn]:visible').first().click();
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

// Testerna skriver data (seedade tävlingar m.m.) och får aldrig köras mot produktion.
// Kör dem med `npm run test:smoke`, som startar Firebase-emulatorerna.

// The PDF reports officials print: each is downloaded, then read with the
// app's own PDF reader (pdf.js) to check pages, headings and content
const PDF_REPORTS = [
  { call: 'reports_generateStartListPdf(\'dressage\')', names: true, headings: [/DRESSYR – STARTLISTA/, /Kusk \/ Häst/, /Klass/] },
  { call: 'reports_generateStartListPdf(\'marathon\')', names: true, headings: [/MARATON – STARTLISTA/, /Kusk \/ Häst/] },
  { call: 'reports_generateStartListPdf(\'precision\')', names: true, headings: [/PRECISION – STARTLISTA/, /Kusk \/ Häst/] },
  { call: 'reports_generateDressagePdf()', names: true, headings: [/DRESSYR – RESULTATLISTA/, /Plac/, /%/, /Straff/] },
  { call: 'reports_generateDressageOfficialsPdf()', headings: [/FUNKTIONÄRSLISTA DRESSYR/, /Program/] },
  { call: 'reports_generateMarathonPdf()', names: true, headings: [/RESULTAT/, /Straff A/, /Straff B/, /Totalt/] },
  { call: 'reports_generateMarathonFunctionaryPdf()', headings: [/FUNKTIONÄRSLISTA MARATON \(TIDER\)/, /Start A/, /Mål A/] },
  { call: 'reports_generateMarathonObstaclePdf()', headings: [/FUNKTIONÄRSLISTA MARATON \(HINDER\)/, /Vagnbredd/] },
  { call: 'reports_generatePrecisionPdf()', names: true, headings: [/PRECISION – RESULTATLISTA/, /Hinder/, /Tidfel/, /Totalt/] },
  { call: 'reports_generatePrecisionOfficialsPdf()', headings: [/FUNKTIONÄRSLISTA – PRECISION/, /Maxtid/] },
  { call: 'reports_generatePrecisionCourseSetupPdf()', headings: [/BANA & PORTAR/, /Maxtid/] },
  { call: 'reports_generateTotalPdf()', names: true, headings: [/RESULTAT/, /Plac/, /Dressyr/, /Maraton/, /Precision/, /Totalt/] },
  // Only when the competition has teams (the seeded one has none)
  { call: 'reports_generateTeamPdf()', optional: true },
  { call: 'reports_generateVetCheckPdf()', names: true, headings: [/VETERINÄRBESIKTNING/, /Häst/] }
];

test('PDF reports are generated with pages, headings and the equipages', async ({ page }) => {
  test.setTimeout(420000);
  const competitionId = await seedCompetition(page, { includeEdgeCases: false, includeStress: false });
  const browserErrors = [];
  collectBrowserErrors(page, browserErrors);
  page.on('dialog', dialog => dialog.accept().catch(() => { }));

  const driverNames = await page.evaluate(async (competitionId) => {
    const { getEquipages } = await import('../js/services/equipageService.js');
    return (await getEquipages(competitionId)).map(e => String(e.driverName || '').trim()).filter(Boolean);
  }, competitionId);
  expect(driverNames.length).toBeGreaterThan(0);

  await page.goto('/index.html#reports');
  await expect(page.locator('button[onclick="window.reports_generateTotalPdf()"]')).toBeVisible({ timeout: 60000 });
  await page.waitForTimeout(2000); // the page's results are computed after load

  const results = {};
  for (const report of PDF_REPORTS) {
    const button = page.locator(`button[onclick="window.${report.call}"]`);
    if (await button.count() === 0) { results[report.call] = { missing: !report.optional, skipped: true }; continue; }
    const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
    await button.first().click();
    const download = await downloadPromise;
    const bytes = readFileSync(await download.path());
    const parsed = await page.evaluate(async (b64) => {
      const pdfjs = await import('/lib/pdfjs/build/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = '/lib/pdfjs/build/pdf.worker.min.mjs';
      const data = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const doc = await pdfjs.getDocument({ data }).promise;
      let text = '';
      for (let i = 1; i <= doc.numPages; i++) {
        const content = await (await doc.getPage(i)).getTextContent();
        text += content.items.map(item => item.str).join(' ') + '\n';
      }
      return { pages: doc.numPages, text };
    }, bytes.toString('base64'));
    results[report.call] = { file: download.suggestedFilename(), header: bytes.subarray(0, 5).toString('latin1'), ...parsed };
    if (process.env.PDF_TEST_DUMP) console.log(`\n=== ${report.call} (${parsed.pages} p) ${download.suggestedFilename()}\n${parsed.text.slice(0, 400)}`);
  }

  for (const report of PDF_REPORTS) {
    const result = results[report.call];
    if (result.skipped && !result.missing) continue;
    expect(result.missing, `${report.call}: button missing`).toBeUndefined();
    expect(result.header, `${report.call}: not a PDF`).toBe('%PDF-');
    expect(result.pages, `${report.call}: no pages`).toBeGreaterThan(0);
    expect(result.text.trim().length, `${report.call}: empty`).toBeGreaterThan(40);
    // Missing data printed as code values
    expect(result.text, `${report.call}: prints undefined`).not.toMatch(/\bundefined\b/);
    expect(result.text, `${report.call}: prints NaN`).not.toMatch(/\bNaN\b/);
    expect(result.text, `${report.call}: prints [object Object]`).not.toContain('[object Object]');
    for (const heading of report.headings || []) {
      expect(result.text, `${report.call}: heading ${heading}`).toMatch(heading);
    }
    if (report.names) {
      expect(driverNames.some(name => result.text.includes(name)), `${report.call}: no equipage listed`).toBe(true);
    }
  }
  expect(browserErrors).toEqual([]);
});

// Judges enter results on phones, and drivers and spectators read the results
// there: no page may need sideways scrolling (tables scroll inside their own box)
test('input and result pages fit a phone screen without sideways scrolling @mobile-only', async ({ page }) => {
  test.setTimeout(300000);
  await seedCompetition(page, { includeEdgeCases: true, includeStress: false });
  const browserErrors = [];
  collectBrowserErrors(page, browserErrors);

  const routes = ['hub', 'deltagare', 'starttider', 'dressyr-input', 'maraton-input', 'maraton-stages',
    'observator-input', 'precision-input', 'precision-split-input', 'vet-check',
    'dressyr-results', 'maraton-results', 'precision-results', 'total-resultat', 'competition-center', 'portal'];
  const overflowing = [];
  for (const route of routes) {
    await page.goto(`/index.html#${route}`);
    await page.waitForTimeout(2000);
    const widths = await page.evaluate(() => ({
      page: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      viewport: window.innerWidth
    }));
    if (widths.page > widths.viewport + 1) overflowing.push(`#${route}: ${widths.page}px > ${widths.viewport}px`);
  }
  expect(overflowing).toEqual([]);
  expect(browserErrors).toEqual([]);
});


test('a competition can be downloaded as a complete backup file', async ({ page }) => {
  test.setTimeout(300000);
  const competitionId = await seedCompetition(page, { includeEdgeCases: true, includeStress: false });
  await page.goto('/index.html#admin?tab=settings');
  const button = page.locator('#btnExportComp');
  await expect(button).toBeVisible({ timeout: 60000 });
  const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
  await button.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^sakerhetskopia_.*\.json$/);
  const backup = JSON.parse(readFileSync(await download.path(), 'utf8'));
  expect(backup.format).toBe('drivelive-competition-export');
  expect(backup.competitionId).toBe(competitionId);
  expect(backup.documentCount).toBe(backup.documents.length);
  const paths = backup.documents.map(d => d.path);
  // The competition itself, its equipages, and the
  // dressage protocols (stored below parents without data)
  expect(paths).toContain(`artifacts/${backup.appId}/public/data/competitions/${competitionId}`);
  expect(paths.some(p => p.includes('/equipages/'))).toBe(true);
  // Private parts (contact details) are included too
  expect(paths.some(p => /\/(equipagePrivate|officialsPrivate|judgesPrivate)\//.test(p))).toBe(true);
  expect(paths.some(p => /\/dressage\/[^/]+\/protocols\//.test(p))).toBe(true);
  await expect(page.locator('#exportCompStatus')).toContainText('dokument');
});

async function useFirebaseEmulators(page) {
  await page.addInitScript(() => {
    window.__USE_FIREBASE_EMULATORS__ = true;
  });
  await page.goto('/index.html#hub');
  const active = await page.waitForFunction(() => window.__FIREBASE_EMULATORS_ACTIVE__ === true, null, { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  if (!active) {
    throw new Error('Appen är inte kopplad till Firebase-emulatorerna. Kör testerna med `npm run test:smoke`.');
  }
}

async function loginIfNeeded(page) {
  await page.goto('/index.html#hub');

  // Both buttons stay hidden until the auth state is known
  await expect(page.locator('#loginButton:visible, #logoutButton:visible').first()).toBeVisible({ timeout: 20000 });

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
    // Logout clears the device's data and then reloads the page; continuing
    // before that reload races it
    await Promise.all([
      page.waitForEvent('load', { timeout: 20000 }),
      logoutButton.click()
    ]);
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
  return competitionId;
}

async function setPublicInfoIntro(page, competitionId, introHtml) {
  await page.evaluate(async ({ competitionId, introHtml }) => {
    const { saveConfig } = await import('../js/services/competitionService.js');
    await saveConfig(competitionId, 'publicInfo', {
      enabled: true,
      introHtml,
      publish: {
        classSummary: true,
        documents: true,
        messages: true,
        maps: true
      }
    });
  }, { competitionId, introHtml });
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
