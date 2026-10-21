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

## E-post

The functions deploy and run without any e-mail provider: until one is set up,
every mail (club messages, changed start times, vet decisions, volunteer
confirmations) waits in the competition's queue with status `not_configured`.
All mail goes from one app address with "<Klubbnamn> via DriveLive" as the
sender name and the club's checked address as Reply-To.

- [ ] **Domain**: buy a domain for the app (e.g. `drivelive.se`) at any
  registrar that lets you edit DNS records. The sending address will be e.g.
  `noreply@<domain>`.
- [ ] **Brevo account (EU)**: create an account at brevo.com (Brevo is
  Sendinblue SAS, France) with the operator's details. Sign their data
  processing agreement (Account → Security/Legal, "DPA"). The free plan sends
  300 mails a day; choose a paid plan before bigger events.
- [ ] **Verify the domain in Brevo**: Senders, Domains & Dedicated IPs →
  Domains → Add a domain → copy the DNS records Brevo shows into the
  registrar's DNS: the Brevo verification code (TXT), **DKIM** (TXT/CNAME as
  shown), **SPF** (TXT on the root with the include Brevo shows, typically
  `v=spf1 include:spf.brevo.com ~all`; with an SPF record already there, add
  the include to it — only one SPF record per domain) and **DMARC** (TXT on `_dmarc.<domain>`, start with
  `v=DMARC1; p=none; rua=mailto:<your address>`, tighten to
  `p=quarantine` once reports look clean). Wait until Brevo shows the domain
  as authenticated (DNS can take hours).
- [ ] **Sender**: Senders → add `noreply@<domain>` (the address the app sends
  from).
- [ ] **API key**: SMTP & API → API keys → Generate a new key (name it
  "DriveLive functions"). Copy it once; it is never shown again in the app.
- [ ] **Configure the app**: as superadmin, call `setEmailProviderSettings`
  (or use the superadmin e-mail page when it exists) with
  `{ provider: 'brevo', apiKey: '<key>', fromAddress: 'noreply@<domain>',
  dailyLimit: 300, competitionDailyLimit: 500, enabled: false }`. The key is
  stored server side in `serverSettings/email` (no client can read it) and is
  never returned; send it again only to replace it.
- [ ] **Test mail**: call `sendTestEmail` (works while `enabled` is false); it
  sends to your own login address. Check it arrives, not in spam, and that the
  message headers show `dkim=pass`, `spf=pass` and `dmarc=pass`.
- [ ] **Switch on**: call `setEmailProviderSettings` with `{ enabled: true }`
  (other fields are kept). Mails that waited can then be sent with
  `retryQueuedMail` (all waiting ones, or one by `competitionId` + `mailId`);
  mails older than 7 days are closed instead (`maxAgeDays` changes that).
- [ ] **Check the scheduled retry job**: Cloud Scheduler shows a job for
  `processMailRetries` (every 10 minutes); it resends mails the provider
  refused for a while (rate limit, server error).
- [ ] **Each club**: Admin → e-post settings: sender name, reply-to address
  (confirmed through the link mailed to it; until then mails have no
  Reply-To) and signature.
- [ ] **Privacy notice**: the e-mail processor (Brevo) is named in
  `js/content/privacyNotice.js`; change it there if another provider is used.

## Maintenance

- [ ] **Node.js runtime**: functions run on Node 22 (`functions/package.json`
  `engines`). Upgrade to Node 24 and redeploy before **2027-04-30** (Node 22
  deprecation in Cloud Functions).
