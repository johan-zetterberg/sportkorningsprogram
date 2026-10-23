# Operations checklist (before the first real competition)

Things the repository cannot set up: done once by the project owner in the
Firebase / Google Cloud console for project `combined-driving`. Tick them off
and note the date.

## Costs

- [x] **Budget alert**: Cloud Console → Billing → Budgets & alerts → Create
  budget. Scope: project `combined-driving`, thresholds 50 %, 90 %, 100 %
  (actual spend), email to the billing admins. Exists (checked 2026-10-23):
  25 SEK/month; raise it (e.g. 200 SEK) before events with real traffic.
- [x] **Artifact Registry cleanup** (2026-10-23): repository `gcf-artifacts`
  (europe-west1) has the policy `firebase-functions-cleanup` deleting images
  older than 1 day (`firebase functions:artifacts:setpolicy --project
  combined-driving --location europe-west1 --days 1 --force`). Running
  functions are not affected; old function images otherwise accumulate
  storage costs.

## Monitoring

During the beta only **Error Reporting notifications** is needed: it catches
failing background work nobody sees (retention run, mail retries, push,
incident closure) with one mail per new kind of error. The other items are
optional until events have real traffic; the uptime check is worth switching
on for event days only.

- [ ] **Log-based alert on function errors**: Cloud Console → Logging → Logs
  Explorer, query
  `resource.type="cloud_run_revision" severity>=ERROR` → Create alert →
  notification channel (email/SMS). Limit to e.g. 1 notification per 15 min.
- [ ] **Alert on client errors**: same, with the query
  `textPayload:"[klientfel" OR jsonPayload.message:"[klientfel"`
  (logged by `reportClientError` in `functions/index.js`).
- [x] **Error Reporting notifications** (2026-10-23): Cloud Console → Error
  Reporting → Configure notifications → enable for the project (new error
  groups). Mark a fixed error group Resolved after deploying the fix, so a
  recurrence notifies again.
- [ ] **Uptime check during event days**: Cloud Console → Monitoring → Uptime
  checks → Create: HTTPS, `combined-driving.web.app`, path `/`, every 5 min,
  alert to the on-site phone. Pause it between events.
- [ ] **Log retention 30 days**: Cloud Console → Logging → Log storage →
  `_Default` bucket → Edit → retention 30 days (logs can hold e-mail
  addresses in error messages; do not keep them longer than needed).

## Data protection and backups

- [x] **Confirm locations are in the EU** (2026-10-23): Firestore is in
  **europe-north2 (Stockholm)** (`firebase firestore:databases:get
  "(default)"`); functions run in europe-west1; Storage bucket
  `combined-driving.firebasestorage.app` is in the dual-region **EUR4**
  (europe-north1 Finland + europe-west4 Netherlands), read from the Storage
  JSON API. `DATA_LOCATION` in `js/content/privacyNotice.js` states both.
  Status 2026-10-23: delete protection **disabled**, PITR **disabled**, no
  backup schedules (see the three items below).
- [ ] **Firestore point-in-time recovery (7 days)**: Cloud Console →
  Firestore → (default) database → Disaster recovery → enable PITR.
- [ ] **Delete protection**: same page → Delete protection → enable.
- [ ] **Daily scheduled backups**: Firestore → Disaster recovery → Backups →
  Create schedule: daily, retention e.g. 14 days. Or a managed export to an
  EU bucket (`gcloud firestore export gs://<eu-bucket>` via Cloud Scheduler),
  bucket in europe-north2 (same region as the database) with a lifecycle rule
  deleting objects after 30 days. CLI alternative (read the result with
  `firebase firestore:backups:schedules:list --project combined-driving`):
  `firebase firestore:backups:schedules:create --project combined-driving
  --recurrence DAILY --retention 14d`.
- [ ] **Retention function runs**: after deploying, check Cloud Console →
  Cloud Scheduler that the job for `purgeExpiredPersonalData`
  (europe-west1, daily) exists (the Cloud Scheduler API is enabled on first
  deploy; accept if asked), and the next day Logging shows its summary entry.
  Competitions archived longer than their `retentionMonths` (default 12) lose
  their private data then — a week after the run that first finds them due
  (`personalDataPurgeScheduledAt`, shown as a warning in the competition's
  Personuppgifter settings); each run is recorded in the `retentionRuns`
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

- [x] **Browser API key restrictions** (2026-10-23; the key had been used
  for eight Google Maps APIs, which DriveLive never calls — likely a third
  party; consider disabling the Maps APIs in the project): Cloud Console → APIs & Services →
  Credentials → the "Browser key (auto created by Firebase)" →
  Application restrictions: HTTP referrers
  `https://combined-driving.web.app/*`, `https://combined-driving.firebaseapp.com/*`
  (plus any custom domain); API restrictions: only the APIs the app uses
  (Identity Toolkit, Token Service, Cloud Firestore, Cloud Storage for
  Firebase, Cloud Functions, Firebase Installations, **FCM Registration API**
  — without the last two web push stops working). Test login, a page with
  results, an image upload and "Skicka testnotis" afterwards; to undo, set
  the key back to "Don't restrict key".
- [x] **Password policy** (2026-10-23, verified: ENFORCE, min 10): Firebase Console → Authentication → Settings →
  Password policy → Enforcement mode **Require**, minimum length 10, no other
  boxes (leave "Force upgrade on sign-in" off so existing shorter passwords
  still sign in). Deploy the app first: it shows "minst 10 tecken" for the
  policy's error code `auth/password-does-not-meet-requirements`.
- [x] **Email enumeration protection**: on (checked 2026-10-23 in the
  Identity Toolkit config, `enableImprovedEmailPrivacy: true`).
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

## Push-notiser

Web push via Firebase Cloud Messaging (FCM). The functions deploy and run
without any key: until a superadmin saves the public VAPID key and switches
push on, the app shows push as "not available" and nothing is sent. The same
people as e-mail get them (drivers by their verified login address, officials
by their roles); each device chooses topics (start times, messages, pauses,
vet decisions, declaration changes).

- [ ] **Web Push key pair**: Firebase Console → Project settings (gear) →
  **Cloud Messaging** → **Web configuration / Web Push certificates** →
  **Generate key pair**. Copy the **public** key (about 87 characters,
  starting with `B`). It is not secret (every browser gets it); the private
  half stays with Google and is never needed here. If the Cloud Messaging tab
  says the API is disabled, enable "Firebase Cloud Messaging API (V1)" there.
- [ ] **Configure the app**: as superadmin, paste the key in the superadmin
  push card (or call `setPushSettings` with `{ vapidKey: '<public key>',
  appUrl: 'https://<the app's address>', enabled: false }`). It is stored in
  `appSettings/push` (readable by everyone, written only by the callable).
  `competitionDailyLimit` (default 5000 notifications per competition and day)
  can be set there too.
- [ ] **Switch on**: `setPushSettings` with `{ enabled: true }` (other fields
  are kept). `getPushAdminStatus` shows the number of registered devices.
- [ ] **Test**: on a phone (Android Chrome, or an iPhone/iPad with iOS 16.4+
  where the app is first **added to the home screen** — push does not work in
  a Safari tab), sign in, turn on notifications and press "Skicka testnotis"
  (`sendTestPush`, to your own devices). Check that tapping it opens the app.
  Then post a test message to a test competition's officials.
- [ ] **CSP**: `firebase.json` allows `fcmregistrations.googleapis.com` and
  `firebaseinstallations.googleapis.com` (connect-src); the messaging SDK
  loads from `www.gstatic.com`. Deploy hosting together with the functions.
- [ ] **Retention**: the nightly `purgeExpiredPersonalData` drops devices not
  seen for 60 days and unlinks devices from purged competitions; the push log
  (`pushLog`, counts only) goes with the competition's private data.
- [ ] **Privacy notice**: FCM is named in `js/content/privacyNotice.js`.

## Maintenance

- [ ] **Node.js runtime**: functions run on Node 22 (`functions/package.json`
  `engines`). Upgrade to Node 24 and redeploy before **2027-04-30** (Node 22
  deprecation in Cloud Functions).
