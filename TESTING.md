# Manual Test Checklist

Use this checklist after larger refactors or before going live.

## Critical Path

Run these 5 checks first for a fast go/no-go decision:

1. Dressage completed rows show `Klar`, and `Finalisera` / `Ångra` both work.
2. `Funktionärsportalen` pending counts match the actual rows waiting for attestation.
3. Marathon monitor timers tick correctly for one running stage and one running obstacle.
4. `Rapportcenter` can generate at least one total-results PDF with sane totals.
5. `npm test` passes.

## Seeder Modes

Use `seed_test.html` to generate the right kind of competition before running the checks below.

### Base Seed

- Leave `Inkludera stressfall` off.
- Leave `Inkludera edge cases` off if you only want a clean operational flow.
- Use this when testing:
  - normal dressage finalize flow
  - normal marathon monitor flow
  - normal precision finalization
  - reports and PDFs without extra noise

### Edge-Case Seed

- Turn `Inkludera edge cases` on.
- Use this when testing:
  - multi-judge dressage with one missing judge
  - eliminated dressage
  - eliminated marathon obstacle
  - incomplete precision
  - eliminated precision
  - total-result behavior with unusual result states

### Stress Seed

- Turn `Inkludera stressfall` on.
- Optionally leave `Inkludera edge cases` on as well for the broadest pass.
- Use this when testing:
  - large result lists
  - marathon monitor under heavier load
  - `Funktionärsportalen` with more pending rows
  - PDF generation with more classes and equipages
  - admin officials page with more signups and assignments

### Seeder-Specific Checks

- After seeding, verify the status panel reports the number of created equipages and signups.
- Open:
  - `Resultat`
  - `Funktionarsportal`
  - `Admin Funktionarer`
- Verify all three links open the same seeded competition.

## Before Event

Run this shorter pass when the main goal is operational confidence on competition day.

### Setup

- Open a competition with test data in all three disciplines.
- Make sure there is at least:
  - one completed dressage result
  - one dressage row still in progress
  - one marathon driver on stage
  - one marathon driver in an obstacle
  - one completed precision result

### Dressage

- Open `Dressyr - Start- & Resultatlista`.
- Verify completed rows show `Klar`.
- Verify `Finalisera` works.
- Verify `Ångra` works.
- Verify a finalized row is no longer counted as pending.
- Verify a one-judge class and a multi-judge class both behave correctly.

### Funktionärsportalen

- Open `Funktionärsportalen`.
- Verify pending counts appear for the right discipline roles.
- Verify dressage pending count matches rows that are actually ready to finalize.
- Verify finalized rows disappear from pending counts.
- Verify marathon and precision pending counts still look sane.

### Marathon Input / Monitor

- Open a driver on obstacle input without starting the timer.
- Verify the monitor does not switch to obstacle view yet.
- Start the obstacle timer.
- Verify the monitor switches to the obstacle and the timer ticks.
- Stop/save the obstacle.
- Verify the monitor returns to the correct stage state.
- Verify stale obstacle cards do not remain in `På Banan`.
- Verify a running stage timer ticks in monitor list view.

### Precision

- Open `Precision - Resultat`.
- Verify totals load correctly immediately on first render.
- Finalize one result and undo it.
- Verify pending counts update correctly afterward.

### Reports / PDF

- Open `Rapportcenter`.
- Generate:
  - dressage PDF
  - marathon PDF
  - precision PDF
  - total results PDF
- Verify the files open and contain expected rows, totals, and class grouping.

### Final Check

- Run `npm test`
- Verify all tests pass.

## Field Mode / Offline Recovery

Run this pass after changes to input pages, local backup logic, or field mode behavior.

### Scope

- Dressage input restores the latest saved protocol when Firestore is unavailable.
- Marathon obstacle input restores saved obstacle state from local backup.
- Marathon stages input restores stage timer values, comments, and clocks from local backup.
- Precision input restores timer, penalties, and comments from local backup.
- Field mode does not expose live-only controls such as start/stop timers where manual entry is intended.

### Recommended Setup

- Create or open a test competition in `field` mode.
- Add at least one equipage for each relevant discipline.
- Save one realistic result in:
  - dressage
  - marathon obstacle
  - marathon stages
  - precision
- Confirm the save has completed once before simulating offline behavior.

### Manual Verification

- Dressage:
  - open the saved protocol once while online
  - disconnect network or block Firestore
  - reopen the same equipage and judge
  - verify movements, comments, and general penalties are restored

- Marathon obstacle:
  - save a driven obstacle with route, time, and penalties
  - disconnect network or block Firestore
  - reopen the same obstacle
  - verify time, route, penalties, and elimination state are restored

- Marathon stages:
  - save a stage with start clock, finish clock, elapsed time, and comments
  - disconnect network or block Firestore
  - reopen the same equipage and active stage
  - verify elapsed time, clocks, comments, and penalty fields are restored
  - verify reset clears both timer value and saved clock labels

- Precision:
  - save a result with time, penalties, and comment
  - disconnect network or block Firestore
  - reopen the same equipage
  - verify elapsed time, penalty fields, and comment are restored

### Acceptance

- No input page should crash when the Firestore document is missing or unreadable.
- The latest local backup should be shown automatically when remote data is unavailable.
- Restored values must match the last saved local state closely enough for the functionary to continue work.
- Live-only controls must stay hidden in field mode where manual-only workflow is intended.

## Before Release

Run this longer pass before shipping a refactor or deploying a new version.

### Full Setup

- Repeat the `Before Event` setup.
- Include at least one eliminated result in each relevant discipline if possible.
- Include at least one incomplete precision or marathon row.

### Reports / Exports

- Open `Rapportcenter`.
- Generate:
  - start list PDF
  - dressage PDF
  - marathon PDF
  - precision PDF
  - total results PDF
- Verify the files open and contain expected rows, totals, and class grouping.

### Archive / Finalize Competition

- Open `Admin -> Arkivering`.
- Run `Avsluta tävlingen`.
- Verify:
  - the total PDF is generated
  - totals and placements look correct
  - the competition is locked only after PDF generation succeeds
- Run reopen/unlock.
- Verify the competition becomes editable again.

### Navigation / Cleanup

- Move repeatedly between:
  - dressage results
  - marathon monitor
  - precision results
  - portal
- Verify there are no duplicate timers, duplicate live updates, or broken buttons after navigation.

### Automated Tests

- Run `npm test`
- Verify all tests pass.

## Browser Smoke Automation

This is a lightweight Playwright pass for the most useful seeded checks.

### What It Covers

- login through the app UI
- seed a competition through `seed_test.html`
- dressage results page loads with `Klar` and `Finalisera`
- `Funktionarsportal` shows pending work
- marathon monitor loads active cards and visible timers
- admin officials tab shows seeded signups

### Prerequisites

- the app must be running on a local URL
- install Playwright test dependency:
  - `npm install`
- install browser binaries once:
  - `npx playwright install`

Default local setup in this repo:

- `PLAYWRIGHT_BASE_URL = http://127.0.0.1:5500`
- `TEST_EMAIL = admin@demo.se`
- `TEST_PASSWORD = admin123`

So on this machine, the normal command should just be:

```powershell
npm run test:smoke
```

If PowerShell blocks `npm.ps1` on the machine, run the same command through `cmd` instead:

```powershell
cmd /c npm run test:smoke
```

For a visible browser:

```powershell
npm run test:smoke:headed
```

For the marathon stages timer flow only:

```powershell
npm run test:smoke:stages
```

This verifies start, pause, resume, saved state after navigation, and reset.

If you want to override the defaults for another environment:

```powershell
$env:PLAYWRIGHT_BASE_URL="http://127.0.0.1:5500"
$env:TEST_EMAIL="your-email@example.com"
$env:TEST_PASSWORD="your-password"
npm run test:smoke
```
