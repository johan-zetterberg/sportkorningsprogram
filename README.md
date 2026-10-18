# Sportkörningsprogram (Tävlingssystem)

Ett molnbaserat system för tävlingar i sportkörning: anmälan, startlistor, domarinmatning och liveresultat för dressyr, maraton och precision, med publik-, speaker- och sekretariatsvyer.

**Status:** Aktivt utvecklad
**Ägare:** Johan Zetterberg
**Produktion:** https://combined-driving.web.app (Firebase-projekt `combined-driving`)

## 🚀 Kom igång lokalt

Kräver Node.js 22 och Firebase CLI (`npm install -g firebase-tools`). Emulatorerna kräver Java.

```bash
npm install
cd functions && npm install && cd ..
node scripts/static-server.mjs 5500      # appen på http://localhost:5500
```

Appen måste köras via en webbserver (ES-moduler fungerar inte från `file://`). Utan emulatorer pratar den lokala appen med produktionsdatabasen, så testa mot emulatorerna i stället:

```bash
firebase emulators:start --only auth,firestore,functions,storage --project demo-combined-driving
```

`seed_test.html` skapar testtävlingar i emulatorn (se [TESTING.md](TESTING.md)).

## 🧪 Tester

| Kommando | Vad |
|---|---|
| `npm test` | Enhetstester (resultatmotor, regler, hjälpfunktioner) |
| `npm run test:rules` | Firestore-reglerna mot emulatorn |
| `npm run test:restore` | Säkerhetskopia av en tävling: export, radering och återställning mot emulatorn |
| `npm run test:smoke` | Webbläsartester (Playwright) mot emulatorerna; startar egna om inga körs |
| `node scripts/audit_i18n.cjs` | Letar översättningsnycklar som används men saknas i `js/utils/i18n.js` |

Smoke-testerna startar egna emulatorer. Kör en emulator redan på port 8080 måste alla fyra (auth, firestore, functions, storage) vara igång, annars avbryts körningen.

## 🚢 Driftsättning

```bash
npm run deploy                              # webbplatsen
npm run deploy -- --only functions          # molnfunktionerna
npm run deploy -- --only firestore          # databasreglerna
npm run deploy -- --dry-run                 # bara kontroller och tester
```

`scripts/deploy.mjs` kräver att allt är incheckat och att de lokala filerna i `assets/logos` och `assets/dressage` finns. Sedan kör det enhetstester, regeltester (för firestore/functions) och smoke-tester (hoppa över med `--skip-smoke`), bygger CSS, höjer service worker-versionen (en egen commit) och driftsätter till `combined-driving`.

## 💾 Återställa en tävling från säkerhetskopia

Säkerhetskopian är JSON-filen som tävlingens ägare eller en full administratör laddar ner under Admin > Inställningar (molnfunktionen `exportCompetition`). Den läses tillbaka med `scripts/restore-competition.mjs` (Admin SDK från `functions/node_modules`, så kör `npm --prefix functions install` först).

1. **Prova mot emulatorn** (ingen risk):
   ```bash
   firebase emulators:start --only firestore --project demo-combined-driving
   # i ett annat fönster (PowerShell: $env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080")
   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/restore-competition.mjs backup.json --project demo-combined-driving
   ```
2. **Logga in mot produktionen** med ett servicekonto (`GOOGLE_APPLICATION_CREDENTIALS=<nyckel.json>`) eller `gcloud auth application-default login`, och se till att `FIRESTORE_EMULATOR_HOST` *inte* är satt.
3. **Torrkör**: `node scripts/restore-competition.mjs backup.json --project combined-driving --dry-run` visar vad som skulle skrivas och om tävlingen redan finns. Inget skrivs.
4. **Återställ**: `node scripts/restore-competition.mjs backup.json --project combined-driving --yes-production`.
   - Finns tävlingen redan vägrar skriptet. `--overwrite` skriver över dokumenten i kopian (dokument som bara finns i databasen lämnas orörda och listas).
   - `--as-new-id <nyttId>` återställer en kopia bredvid originalet: alla sökvägar, `competitionId`-fält, dokumentreferenser och tävlingens `id` skrivs om. Byt sedan namn på kopian i appen.
5. **Efteråt** (skriptet skriver ut detta som varningar):
   - **PIN-koder** finns aldrig i kopian (`config/secrets`, `accessCode_*`): sätt nya PIN-koder för tävlingen.
   - **Personnummer** finns bara med om de valdes vid exporten.
   - **Filer i Storage** (`competitions/{id}/...`) listas bara med namn och återställs inte.
   - **Inloggningskonton** (Firebase Auth) och `users/{uid}` ingår inte.
   - Molnfunktionerna räknar om resultaten när dokumenten skrivs.

Skriptet vägrar utan `--project` och skriver till `combined-driving` bara med `--yes-production`. Hela kedjan (export, radering, återställning, kopia med nytt ID) testas mot emulatorn med `npm run test:restore`.

> **Säkerhetskopiera också de lokala filerna:** `assets/logos/` och `assets/dressage/` finns inte i git (se nedan) och ingår inte i tävlingens säkerhetskopia. Spara dem separat.

## ☁️ Online och offline

- All data ligger i **Firestore**. Ändringar syns direkt på alla anslutna enheter.
- **Utan uppkoppling** sparas ändringar i en kö på enheten och skickas när nätet kommer tillbaka. Appen visar då "Sparad till kö" i stället för "Klart!".
- **Stäng inte webbläsaren** och logga inte ut innan kön är tom. Utloggning väntar på osparade ändringar och vägrar om de inte går att skicka.
- Service workern (`service-worker.js`) lagrar appen och biblioteken så att den startar även utan nät. Efter en driftsättning visas en uppdateringsruta.

> **VIKTIGT:** Dömer du dressyr offline, skriv upp poängen på papper tills protokollet visar att det är sparat.

## 📂 Struktur

- **`index.html`**: startsidan; laddar `js/main.js` och de externa biblioteken.
- **`js/`**
  - **`main.js`**: startar appen; routing finns i `services/navigationService.js`.
  - **`core-engine/`**: **resultatmotorn**, samma kod i webbläsaren och i molnfunktionerna. Den kopieras till `functions/src/core-engine` av `scripts/copy-core-engine.js` före driftsättning; ändra bara i `js/core-engine`.
  - **`pages/`**: vyerna, uppdelade per gren (`dressage/`, `marathon/`, `precision/`), `admin/`, `secretariat/` och `shared/` (resultat, speaker, portal m.m.).
  - **`services/`**: Firestore, inloggning, köer och offline-skrivningar.
  - **`ui/`**: delade komponenter och modaler.
  - **`pdf/`**: PDF-generering (jsPDF).
  - **`utils/`**: hjälpfunktioner, t.ex. `sharedUtils.js` (`escapeHtml` med flera) och översättningarna i `i18n.js`.
- **`functions/`**: molnfunktioner. De räknar om resultaten till `computed_equipages` när data ändras och har anropbara funktioner för anslutning med PIN-kod, kuskarnas deklarationer och kuskarnas inkorg.
- **`firestore.rules`**, **`storage.rules`**: behörigheterna; testas i `tests/firestore-rules.spec.js`.
- **`css/`**: `tailwind.input.css` byggs till `tailwind.css` (`npm run build:css`); egna stilar i `style.css`.
- **`lib/`**: lokala bibliotek (pdf.js, jsPDF).
- **`tests/`**, **`scripts/`**: tester och verktyg.

## 🔒 Filer som inte finns i git

Upphovsrättsskyddade eller licensierade filer hålls utanför repot och finns bara på driftsättningsdatorn:
- **`assets/logos/`**: föreningarnas logotyper (mappning i `assets/config/club-logos.json`). Håll dem små, högst cirka 320 px.
- **`assets/dressage/`**: dressyrprogrammen som PDF.

## 🛠 Teknik

- **Frontend:** Vanilla JavaScript (ES-moduler), Tailwind CSS (förbyggd), Leaflet för kartor, Font Awesome-ikoner.
- **Backend:** Firebase (Firestore, Auth, Cloud Functions v2 i `europe-west1`, Storage, Hosting).
- **Bygge:** inget byggsteg för JavaScript; bara CSS byggs.

## 🤝 Bidra

Se [CONTRIBUTING.md](CONTRIBUTING.md).
