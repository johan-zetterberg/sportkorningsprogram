# Sportkörningsprogram (Tävlingssystem)

Ett modernt, molnbaserat system för att hantera tävlingar i sportkörning. Systemet hanterar hela flödet från anmälan och startlistor till liveresultat för Dressyr, Maraton och Precision.

**Status:** Aktivt utvecklad 
**Ägare:** Johan Zetterberg

## 🚀 Kom igång lokalt

För att köra systemet på din egen dator behöver du en enkel webbserver, eftersom moderna webbläsare stoppar vissa funktioner (som moduler och CORS) om du bara öppnar `index.html` direkt från filhanteraren.

### Alternativ 1: VS Code (Rekommenderas)
1. Öppna mappen i **VS Code**.
2. Installera tillägget **"Live Server"** (av Ritwick Dey).
3. Klicka på "Go Live" längst ner i högra hörnet.
4. Systemet öppnas i din webbläsare.

### Alternativ 2: Python
Om du har Python installerat kan du köra följande i terminalen:
```bash
# Python 3
python -m http.server 8000
```
Gå sedan till `http://localhost:8000` i din webbläsare.

---

## ☁️ Online vs Offline

### Online (Standard)
Systemet är **Cloud-First**. Det innebär att:
- All data lagras i **Google Firebase** (molndatabas).
- Rättelser och resultat syns direkt ("Live") för alla anslutna enheter (publik, speaker, sekretariat).
- Det krävs internetuppkoppling för att *spara* data.

### Offline (Säkerhetsläge)
Om nätverket går ner under en tävling:
1. **APPEN FORTSÄTTER FUNGERA:** Du kan fortsätta klicka i resultat, starta klockor etc.
2. **Lokal lagring:** Data sparas tillfälligt i webbläsaren.
3. **VARNING:** Stäng INTE webbläsaren.
4. **Synkronisering:** Så fort nätverket kommer tillbaka försöker systemet skicka upp all data automatiskt.

> **VIKTIGT:** Om du dömer Dressyr offline – skriv upp poängen på papper som backup tills du ser att den gröna bocken ("Sparad") visas.

---

## 📂 Strukturöversikt

Kort guide till projektets mappar för dig som vill utveckla vidare:

- **`index.html`** – Startpunkten. Innehåller grundläggande layout och laddar huvudscriptet.
- **`js/`** – All logik.
    - **`main.js`** – Bootstrappar appen, hanterar routing.
    - **`pages/`** – Vyer för olika roller (t.ex. `admin.js`, `judge.js`, `speaker.js`, `manual.js`).
    - **`services/`** – Kommunikation med databasen (`firestoreService.js`), autentisering och arkivering.
    - **`utils/`** – Hjälpfunktioner för tidsberäkning, validering och formatering.
- **`css/`** – Styling.
    - **`index.css`** – Tailwind-direktiv och globala stilar.
- **`assets/`** – Bilder och ikoner.
    - **`logos/`** – *Obs! Vissa logotyper är borttagna från detta repo pga upphovsrätt.* Placeras här lokalt.
- **`lib/`** – Externa bibliotek (t.ex. `jspdf` för PDF-generering, `qrcode` etc).

---

## 🔒 Privata Assets & Licenser
Detta repository innehåller inte upphovsrättsskyddade logotyper eller specifika föreningsdokument.
- **Loggor:** Om du sätter upp systemet för en ny förening, lägg era loggor i `assets/logos/`.
- **PDF-mallar:** Systemet genererar PDF:er dynamiskt, men använder ibland `assets/header-bg.png` som bakgrund.

## 🛠 Teknisk Stack
- **Frontend:** Vanilla JavaScript (ES6 Modules) + Tailwind CSS (via CDN för enkelhet).
- **Backend:** Firebase (Firestore, Auth, Functions).
- **Bygge:** Inget byggsteg krävs! (No-build). "What you see is what you run".

