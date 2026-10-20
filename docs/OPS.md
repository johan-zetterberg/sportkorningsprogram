# Operations checklist (before the first real competition)

Things the repository cannot set up: done once by the project owner in the
Firebase / Google Cloud console for project `combined-driving`. Tick them off
and note the date.

## Costs

- [ ] **Budget alert**: Cloud Console → Billing → Budgets & alerts → Create
  budget. Scope: project `combined-driving`, amount 200 SEK/month, thresholds
  50 %, 90 %, 100 % (actual spend), email to the billing admins.
- [ ] **Artifact Registry cleanup**: Cloud Console → Artifact Registry →
  repository `gcf-artifacts` (europe-west1) → Edit → Cleanup policies: delete
  images older than e.g. 30 days, keep the 2 most recent versions. (Or
  `firebase functions:artifacts:setpolicy`.) Old function images otherwise
  accumulate storage costs.

## Monitoring

- [ ] **Log-based alert on function errors**: Cloud Console → Logging → Logs
  Explorer, query
  `resource.type="cloud_run_revision" severity>=ERROR` → Create alert →
  notification channel (email/SMS). Limit to e.g. 1 notification per 15 min.
- [ ] **Alert on client errors**: same, with the query
  `textPayload:"[klientfel" OR jsonPayload.message:"[klientfel"`
  (logged by `reportClientError` in `functions/index.js`).
- [ ] **Error Reporting notifications**: Cloud Console → Error Reporting →
  Configure notifications → enable for the project (new error groups).
- [ ] **Uptime check during event days**: Cloud Console → Monitoring → Uptime
  checks → Create: HTTPS, `combined-driving.web.app`, path `/`, every 5 min,
  alert to the on-site phone. Pause it between events.
- [ ] **Log retention 30 days**: Cloud Console → Logging → Log storage →
  `_Default` bucket → Edit → retention 30 days (logs can hold e-mail
  addresses in error messages; do not keep them longer than needed).

## Data protection and backups

- [ ] **Confirm locations are in the EU**: Firebase Console → Project settings
  → General → "Default GCP resource location", and Firestore → Database
  details, and Storage → bucket location. The repository does not record
  them (functions run in europe-west1). Write the confirmed location into
  `DATA_LOCATION` in `js/content/privacyNotice.js` (the privacy notice states
  it; until then it says the location is to be confirmed).
- [ ] **Firestore point-in-time recovery (7 days)**: Cloud Console →
  Firestore → (default) database → Disaster recovery → enable PITR.
- [ ] **Delete protection**: same page → Delete protection → enable.
- [ ] **Daily scheduled backups**: Firestore → Disaster recovery → Backups →
  Create schedule: daily, retention e.g. 14 days. Or a managed export to an
  EU bucket (`gcloud firestore export gs://<eu-bucket>` via Cloud Scheduler),
  bucket in europe-north1/europe-west1 with a lifecycle rule deleting objects
  after 30 days.
- [ ] **Retention function runs**: after deploying, check Cloud Console →
  Cloud Scheduler that the job for `purgeExpiredPersonalData`
  (europe-west1, daily) exists (the Cloud Scheduler API is enabled on first
  deploy; accept if asked), and the next day Logging shows its summary entry.
  Competitions archived longer than their `retentionMonths` (default 12) lose
  their private data then; each run is recorded in the `retentionRuns`
  collection (Firestore console). The retention per competition is set in
  Admin → Inställningar → Personuppgifter.
- [ ] **Privacy notice**: fill in the operator's name and contact (`OPERATOR`)
  in `js/content/privacyNotice.js` and check the text at `#privacy` (the
  organising club is the controller per competition).
- [ ] **Restore script credentials**: `scripts/restore-competition.mjs` uses
  Application Default Credentials. On the machine that restores: install the
  Google Cloud SDK and run `gcloud auth application-default login` (or set
  `GOOGLE_APPLICATION_CREDENTIALS` to a service-account key, kept out of the
  repository). Try a `--dry-run` against a copy before you need it.
- [ ] **TTL for field device status**: Firebase Console → Firestore Database →
  Time-to-live → Create policy: collection group `devices`, timestamp field
  `expireAt` (or `gcloud firestore fields ttls update expireAt
  --collection-group=devices --enable-ttl`). Each field device overwrites one
  document while an input page is open; the policy deletes it 7 days after
  its last report (the retention job also removes the collection with the
  competition's other private data).
- [ ] **TD role code**: existing competitions have no `accessCode_td` yet:
  Admin → Inställningar → role codes → create new codes (or generate only the
  TD one) before handing it to the technical delegate / ground jury.

## Access and authentication

- [ ] **Browser API key restrictions**: Cloud Console → APIs & Services →
  Credentials → the "Browser key (auto created by Firebase)" →
  Application restrictions: HTTP referrers
  `https://combined-driving.web.app/*`, `https://combined-driving.firebaseapp.com/*`
  (plus any custom domain); API restrictions: only the APIs the app uses
  (Identity Toolkit, Token Service, Cloud Firestore, Cloud Storage for
  Firebase, Cloud Functions, Firebase Installations). Test login afterwards.
- [ ] **Password policy**: Firebase Console → Authentication → Settings →
  Password policy → require at least 10 characters (enforce).
- [ ] **Email enumeration protection**: Authentication → Settings → User
  actions → enable "Email enumeration protection".
- [ ] **TOTP MFA for admin accounts**: Authentication → Sign-in method →
  Multi-factor authentication → enable TOTP (requires Identity Platform
  upgrade, free at this volume); the owner and global admins enrol.
- [ ] **App Check (later, when ready)**: Firebase Console → App Check →
  register the web app with reCAPTCHA Enterprise, monitor for a week, then
  enforce for Firestore, Storage and Functions.

## Maintenance

- [ ] **Node.js runtime**: functions run on Node 22 (`functions/package.json`
  `engines`). Upgrade to Node 24 and redeploy before **2027-04-30** (Node 22
  deprecation in Cloud Functions).
