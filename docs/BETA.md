# Betaversion: omfattning och kända begränsningar

För arrangörsklubbens admin och utvecklaren. Beskriver vad DriveLive-betan
gör, vad som ska räknas för hand och vilka begränsningar som är kända.
Konsolpunkter inför riktig tävling finns i `docs/OPS.md`; övningsplan i
`docs/GENERALREP.md`.

## Vad betan omfattar

- **Dressyr**: protokoll per domare med felkörning (5/10 straffpoäng, tredje
  = uteslutning), finalisering, resultat och monitor.
- **Maraton**: hinder (klocka, portordning, rivningar, hålltid), etapper
  (start/mål), observatör, global paus/återupptag, maratontider och resultat.
- **Precision**: normal, två faser (fas 1/fas 2) och omkörning
  (Meddela omkörning, Finalisera omkörning), ombyggnad +10 s.
- **Totalresultat** över grenarna, **lag** (FEI och Lag-SM) och **clear round**
  (Godkänd / Ej godkänd).
- **Veterinär** (besiktning, strykning som avvaktar domarkollegiet), **speaker**,
  **monitorer/TV-läge**, **prisutdelning**.
- **Sekretariat** (rättelser med orsak), **händelselogg/TD** (protester,
  domarkollegiets beslut, korrigeringar).
- **Meddelanden** till publik, kuskar och funktionärer. **E-post** (kräver
  inkopplad e-posttjänst) och **pushnotiser** (kräver VAPID-nyckel).
- **TDB-underlag** i Rapportcenter för manuell inmatning i TDB.
- **Säkerhetskopia/återställning** och **integritet/gallring** (personuppgifter
  rensas efter lagringstiden per tävling).

## Utanför betan: räkna manuellt

- **Precision tidstävling**, **vinnarrunda** (winning round) och **Young
  Horse/Pony** stöds inte. Klassen visas med "stöds inte – räkna manuellt"
  och får inga placeringar.
- **Sen start** matas in som övrigt straff (manuellt).
- **TDB** har ingen filimport för körning: skriv in resultaten för hand med
  TDB-underlaget. DriveLive skapar ingen fil.
- **FEI-resultatfil (XML)** finns inte.

## Kända begränsningar

- **iPhone**: notiser kräver att appen läggs på hemskärmen (iOS 16.4 eller nyare).
- **App Check** är inte påslaget.
- Vissa texter finns bara på svenska (portal, rapporter, veterinärsidan).
- Om en ändring av starttider sparats utan täckning kan notis/e-post inte
  skickas om därifrån. Skicka ett vanligt meddelande istället.
- Observatörssidan visar inte vem som pausade (övriga sidor visar orsak, vem och var).
- E-post kräver egen domän och Brevo (se `docs/OPS.md`).
- Säkerhetskopior, PITR och raderingsskydd måste slås på i konsolen före
  riktig tävling (se `docs/OPS.md`). Idag är de avstängda.

## Hur fel rapporteras under betan

Notera direkt, helst med skärmdump:

1. **Tid** (klockslag, gärna sekund) och datum.
2. **Enhet** (modell, iPhone/Android, webbläsare, installerad app eller flik).
3. **Sida och roll** (t.ex. `Inmatning Hinder`, hinder 4, roll maraton).
4. **Vad som hände** jämfört med vad du väntade dig, samt om enheten var
   offline och vad som stod i kön (orange köknapp).
5. Startnummer/klass som berördes.

Klientfel loggas automatiskt (`[klientfel` i Cloud Logging, se `docs/OPS.md`),
så tiden och enheten räcker för att hitta posten. Skicka rapporten till
utvecklaren; samla fel i en gemensam lista under tävlingen.
