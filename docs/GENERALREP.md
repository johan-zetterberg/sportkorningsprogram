# Generalrepetition före första tävling

Flerpersonsövning på riktiga telefoner, ca 2-3 timmar. Syftet är att hitta
fel i samspelet mellan enheter (offline, paus, notiser, resultat) som
enhetstester inte fångar. Använd en **testtävling**, aldrig en riktig.
Knappnamn nedan följer appens texter. Se även `docs/BETA.md`.

## Roller (ca 16 personer, några kan ha flera)

| Roll | Antal | Sida |
|---|---|---|
| Admin / sekretariat | 1-2 | Admin, Sekretariat Dressyr/Maraton/Precision |
| TD / domarkollegium | 1 | Händelselogg & protester (roll td) |
| Dressyrdomare | 2-3 | Inmatning (Dressyr) |
| Hinderdomare | 3-4 | Inmatning Hinder |
| Etappfunktionär start + mål | 2 | Etapper |
| Observatör | 1 | Observatör |
| Precisionsdomare (samma ekipage) | 2 | Precision-inmatning |
| Veterinär | 1 | Veterinär |
| Speaker | 1 | Speaker Dashboard |
| "Kuskar" | 3-4 | Min Portal |

## Förberedelser (dagen innan)

1. Skapa testtävling med ca 10 ekipage i 2-3 klasser: en vanlig klass, en
   **clear round**-klass och en **precision i två faser**. Minst ett lag.
2. Generera startlistor (Starttider), publicera dem, sätt klassernas
   domarscheman och hinderfördelning (hinder per domare).
3. Skapa rollkoder per roll under Admin > Inställningar > Funktionärskoder
   (delas per roll), där även anslutningslänk och QR-kod finns, och dela ut
   dem. Koderna gäller till dagen efter tävlingens datum: ge testtävlingen
   dagens (eller morgondagens) datum, annars "har gått ut". Administratörer
   bjuds in med e-post (Funktionärer > Bjud in
   administratör), inte med kod. TD måste ha en bekräftad e-postadress. Varje
   person går in via koden på sin egen telefon. Kuskarna kopplar sina
   ekipage i Min Portal.
4. Pushnotiser: spara VAPID-nyckeln under Admin > Inställningar >
   Push-notiser. Alla slår på notiser (iPhone: Lägg till på hemskärmen
   först). E-post är valfritt; testa bara om Brevo är inkopplat.
5. Ha en lista med handräknade förväntade poäng för 3 ekipage (se steg 12).
6. Ha tre monitorer/en TV öppna i TV-läge (Öppna i TV-läge) och en dator för
   sekretariatet.
7. Öppna varje inmatningssida en gång med täckning så att data är laddad
   (annars går offlineköning inte).

## Tidsschema och manus

Förväntat resultat står under varje steg. Avvikelser noteras direkt (se sist).

### 1. Start (0:00-0:15)
Alla loggar in, öppnar sin sida. Admin kontrollerar fältenheterna
(Händelselogg > Fältenheter): alla enheter på **inmatningssidor** (domare,
etapper, observatör, precision, veterinär) syns gröna. Speaker, sekretariat,
monitorer och kuskar rapporterar inte och står inte i listan. En telefon med
släckt skärm blir gul efter 2 minuter och röd efter 10 (det är avsiktligt).
- Alla enheter visar rätt tävling och roll. Monitorerna visar startlistan.

### 2. Dressyr (0:15-0:40)
Två dressyrdomare dömer samma ekipage. Domaren vid **C** ger ett ekipage
**Felkörning 1** och ett annat felkörning 1 + 2 (5 resp. 15 straffpoäng); ett
ekipage **Eliminerad**. Domaren vid E ser felpoängen men kan inte ändra dem. Spara protokoll. Sekretariatet finaliserar på resultatsidan.
- Resultatet är identiskt på resultatsidan, monitorn, speakern, Totalt och i
  PDF. Felpoängen läggs på dressyrens straffpoäng (procenten visas före
  felpoängen). Livepoäng syns
  på monitorn under tiden men är inget sparat protokoll.
- Tredje felkörningen frågar innan eliminering.

### 3. Maraton: hinder offline (0:40-1:10)
Hinderdomare startar klocka och sparar via **Spara & nästa**. **Två
telefoner sätts i flygläge** innan de sparar varsitt hinder (olika hinder,
samma ekipage; en med rivningar och hålltid). Efter spara: flygläge av.
- Orange köknapp/"Offline" syns, köas lokalt och töms när täckningen
  återkommer. Båda hindren finns på sekretariatet, resultatsidan och
  monitorn, inget förlorat, inga dubbletter.

### 4. Global paus och återupptag (ca 1:10)
Observatören sätter sin telefon i **flygläge**, trycker **PAUSA TÄVLINGEN**
(orsak, t.ex. Olycka) och slår på nätet igen **inom 2 minuter** (en senare
paus läggs inte in i efterhand utan visas för sekretariatet att granska).
Sekretariatet trycker sedan **ÅTERUPPTA**.
- Paus sparas när observatörens telefon får täckning; röd banner "TÄVLINGEN
  PAUSAD SEDAN ..." på övriga sidor, klockor står still, notis "Paus i
  tävlingen" kommer **en gång** per enhet. Pausens längd dras av rätt från
  ekipagens tider (kontrollera mot klockslagen). Observatörssidan visar inte
  vem som pausade (känd begränsning).

### 5. Etapp-omstart (ca 1:20)
Etappfunktionär startar en etapp (**STARTA**) och därefter **MÅL**. Starta
en etapp som redan går: appen vägrar och ber dig stoppa först. Stoppa, tryck
**STARTA** igen och svara ja på "Starta om och fortsätta tiden?", registrera
mål. Gör sedan **Nollställ** på en annan etapp och starta den på nytt.
- Starttid/måltid på Etapper, Maratontider och sekretariatet stämmer; inga
  hängande klockor. Omstart **fortsätter** tiden: ursprunglig starttid står
  kvar och tiden blir första delen plus andra delen. Nollställ ersätter
  starten helt.

### 6. Veterinärstrykning (ca 1:30)
Veterinären stryker ett ekipage. TD öppnar Händelselogg och trycker
**Fastställ strykning** (en annan strykning testas med **Upphäv**).
- Före beslut visas "Veterinärstrykning avvaktar domarkollegiet" hos
  sekretariat, speaker, funktionärer, startlista och monitor, och kusken ser
  "Veterinärbeslut avvaktar domarkollegiets beslut" i Min Portal. Efter
  Fastställ är ekipaget struket överallt; efter Upphäv försvinner märkningen.

### 7. Sekretariatsrättelse (ca 1:40)
Sekretariat Maraton: rätta ett hindertid/straff på ett ekipage med **orsak**
och referens. Finaliserat resultat måste först låsas upp.
- Resultat uppdateras på alla sidor. Rättelsen syns under fliken
  **Korrigeringar** i Händelselogg med orsak, referens och ändringar.

### 8. Precision två faser och omkörning (1:45-2:15)
Två precisionsdomare matar in samma ekipage på varsin telefon (båda slår
kägleslag). Fas 1, därefter fas 2. Tryck **+10 s (ombyggnad)** på ett
hinder. Skapa lika straff på första plats och tryck **Meddela omkörning**,
kör omkörningen och **Finalisera omkörning**.
- Båda enheternas slag finns kvar (inga tappade slag, inga dubbletter);
  fas 1-resultat stämmer före fas 2; +10 s syns i tiden; omkörningsmeddelandet
  når bara de kvalificerade (och en kort text till speakern). Prisutdelning i
  precision väntar tills omkörningen är klar.

### 9. Ändrade starttider (ca 2:15)
Starttider > **Skjut resten X minuter** för t.ex. en klass: Förhandsgranska,
**Spara förskjutningen**. I dialogen "Meddela berörda kuskar?" välj
**Meddelande i appen**, **Notis**, ev. **E-post**.
- Kuskarna ser "ändrad" på sin tid och får **en** notis (bara sina egna
  tider). Antal mottagare i dialogen stämmer. Testa också att spara utan
  täckning: notisen skickas då inte, och det syns.

### 10. Meddelanden (ca 2:20)
Admin > Kommunikation: ett meddelande till funktionärer, ett markerat
Viktigt till kuskarna, ett till publik.
- Funktionärsbanner visas överst; Viktigt är rött och når även dem som
  stängt av meddelandenotiser; speakern ser sin ruta ("Internt - ej utrop"
  för icke-publika); varje mottagare får ingenting dubbelt. Viktig e-post
  kräver orsak.

### 11. Prisutdelning, arkiv, TDB, kopia (2:25-2:45)
Finalisera alla klasser. **Prisutdelning**: kontrollera ceremonilistor och
lag. Admin > Arkivering > **Avsluta Tävling**: testa med ett öppet ärende
i händelseloggen (öppen protest eller väntande veterinärstrykning) och se att
arkiveringen stoppas med en lista över ärendena (en admin kan gå vidare genom
att skriva ÅSIDOSÄTT och ange ett skäl, som loggas); avgör ärendet och försök
igen. Rapportcenter > **TDB-underlag** (inkl. PDF), kontrollera
placeringskoder (99/98/1/0). Hämta säkerhetskopian under Admin > Inställningar
> Riskzon > **Ladda ner säkerhetskopia** och gör en
`--dry-run` av `scripts/restore-competition.mjs` mot en kopia.
- Arkivet visar "Visar arkiverat resultat" med samma placeringar som före
  arkivering. TDB-underlaget visar domarkollegiets öppna ärenden. Filen går
  att öppna och dry-run klarar.

### 12. Resultatjämförelse (2:45-3:00)
Räkna för hand tre ekipage (ett vanligt, ett med felkörning/strykning, ett
med paus/hålltid/ombyggnad): dressyrens straffpoäng inklusive felpoäng, maratonstraff
(tid, hinder, rivningar), precisionsstraff, totalen. Jämför mot **Totalt**,
resultat-PDF och arkivet.
- Alla tre källor och handräkningen ger samma straffpoäng och placering.

## Godkänt om...

- Resultat är identiska på alla sidor, monitor, PDF och arkiv och stämmer
  med handräkningen för de tre ekipagen.
- Inga inmatningar (hinder, slag, protokoll) har försvunnit eller dubblerats
  efter offline/flygläge.
- Pausen subtraherades korrekt och återupptag fungerade från annan enhet.
- Varje notis/meddelande kom exakt en gång per mottagare och bara till rätt
  grupp.
- Veterinärstrykningens märkning syntes överallt och försvann/fastställdes
  korrekt.
- Rättelsen syns i Korrigeringar med orsak.
- Ingen enhet behövde laddas om eller loggas in på nytt för att ta emot data.
- Backupfilen kunde hämtas och återställnings-dry-run gick igenom.

## Om något misslyckas, anteckna

Tid (sekund), enhet och webbläsare/installerad app, roll och sida, startnummer
och klass, vad du gjorde, förväntat mot faktiskt resultat, om enheten var
offline och vad kön visade, samt skärmdump av sidan och av berörd rad på
sekretariatet. Notera också vilka andra enheter som visade rätt/fel. Klientfel
loggas automatiskt (`[klientfel` i Cloud Logging); utvecklaren söker på
tidpunkten. Ett fel i "Godkänt om..." stoppar tävlingsstart tills det är
åtgärdat och övningen delvis upprepats.
