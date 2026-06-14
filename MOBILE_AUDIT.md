# Mobil-audit

Datum: 2026-06-13

Detta är en kodbaserad mobil-audit av alla navigerbara sidor i systemet.
Den är inte samma sak som full manuell test på riktig telefon, men den ger en
praktisk statuslista och en tydlig prioritering för vidare verifiering.

## Statusnivåer

- `OK`: tydlig mobilanpassning finns i koden, ofta separat mobilrendering.
- `Mindre justering`: sidan bör fungera, men saknar full verifiering eller har
  bara delvis mobilanpassning.
- `Behöver genomgång`: komplex sida utan tydlig separat mobilvy eller med hög
  risk för trängsel, tabellproblem eller arbetsflödesproblem på telefon.

## Sidor

### Publika resultat- och listvyer

| Sida | Status | Kommentar |
| --- | --- | --- |
| `#deltagare` | `OK` | Har separat `renderMobile()` och `renderDesktop()`. |
| `#starttider` | `OK` | Har separat mobil- och desktoprendering. |
| `#dressyr-results` | `OK` | Har separat mobil- och desktoprendering. |
| `#maraton-results` | `OK` | Har mobilkort i mobil och tabell i bredare lägen. |
| `#precision-results` | `OK` | Har separat mobil- och desktoprendering. |
| `#total-resultat` | `OK` | Har separat mobil- och desktoprendering. |

### Sekretariat

| Sida | Status | Kommentar |
| --- | --- | --- |
| `#sekretariat-dressyr` | `Mindre justering` | Har fått mycket UI-polering men ingen tydlig separat mobilrendering i koden. |
| `#sekretariat-maraton` | `Mindre justering` | Troligen användbar i landscape, men bör testas explicit på telefon. |
| `#sekretariat-precision` | `Mindre justering` | Samma läge som ovan, särskilt filterrad och tabellbredd bör verifieras. |

### Inmatning i fält

| Sida | Status | Kommentar |
| --- | --- | --- |
| `#dressyr-input` | `Behöver genomgång` | Funktionellt viktig sida, men ingen tydlig separat mobilvy. |
| `#maraton-input` | `Behöver genomgång` | Tät arbetsvy med många kontroller. Hög risk för trängsel. |
| `#maraton-stages` | `Behöver genomgång` | Komplex timer- och etapplogik. Behöver verklig mobiltest. |
| `#observator-input` | `Behöver genomgång` | Smal specialvy som sannolikt fungerar bäst i live-läge och landscape. |
| `#precision-input` | `Behöver genomgång` | Inmatningssida med många kontroller. Behöver egen mobilgranskning. |
| `#precision-split-input` | `Behöver genomgång` | Smal specialvy som bör verifieras separat. |

### Monitorer och speakerflöden

| Sida | Status | Kommentar |
| --- | --- | --- |
| `#dressyr-monitor` | `Mindre justering` | Har viss responsiv CSS, men bör ses som skärmvy först och mobilvy i andra hand. |
| `#maraton-monitor` | `Mindre justering` | Behöver kontroll av informationsdensitet i landscape. |
| `#precision-monitor` | `Mindre justering` | Samma som ovan. |
| `#speaker` | `Behöver genomgång` | Stor, informationsrik sida utan tydlig separat mobilrendering. |
| `#prize-giving` | `Mindre justering` | Sannolikt enklare vy, men bör verifieras. |

### Admin

| Sida | Status | Kommentar |
| --- | --- | --- |
| `#admin` | `Mindre justering` | Adminöversikt bör verifieras men är normalt mindre kritisk i mobil. |
| `#ekipage` | `Behöver genomgång` | Editeringsvy utan tydlig mobilstruktur i koden. |
| `#hastar` | `Behöver genomgång` | Samma som ovan. |
| `#dressyr-admin` | `Behöver genomgång` | Administrativ detaljsida, sannolikt tät på liten skärm. |
| `#maraton-admin` | `Behöver genomgång` | Hög komplexitet och många inställningar. |
| `#precision-admin` | `Behöver genomgång` | Samma som ovan. |
| `#reports` | `Behöver genomgång` | Rapporter och exportsidor är ofta svåra i mobil. |
| `#official` | `Mindre justering` | Borde kunna fungera, men behöver snabbtest. |
| `#vagnbredd` | `Mindre justering` | Troligen användbar på mobil men bör kontrolleras. |
| `#vet-check` | `Mindre justering` | Har responsiv CSS men bör verifieras i praktiskt arbetsflöde. |

### Delade och informationssidor

| Sida | Status | Kommentar |
| --- | --- | --- |
| `#hub` | `Mindre justering` | Enkel sida, sannolikt nära klar men bör snabbtestas. |
| `#portal` | `Mindre justering` | Kan innehålla många block och länkar, men inte lika riskfylld som input/admin. |
| `#competition-center` | `Mindre justering` | Kräver snabb kontroll av kort och grid-layouter. |
| `#manual` | `Mindre justering` | Innehållstung sida; färg, typografi och radlängd bör verifieras på mobil. |

## Prioriterad testordning

### Prioritet 1

De här sidorna påverkar praktiskt tävlingsarbete mest och bör verifieras först:

1. `#dressyr-input`
2. `#maraton-input`
3. `#maraton-stages`
4. `#precision-input`
5. `#sekretariat-dressyr`
6. `#sekretariat-maraton`
7. `#sekretariat-precision`

### Prioritet 2

Dessa är viktiga men mindre kritiska än aktiv resultat-/fältinmatning:

1. `#ekipage`
2. `#hastar`
3. `#dressyr-admin`
4. `#maraton-admin`
5. `#precision-admin`
6. `#speaker`
7. `#reports`

### Prioritet 3

Övriga sidor kan snabbtestas sist:

1. `#hub`
2. `#portal`
3. `#competition-center`
4. `#manual`
5. `#official`
6. `#vagnbredd`
7. `#vet-check`
8. `#prize-giving`
9. monitorvyerna

## Rekommenderad metod

För varje sida bör vi testa minst tre lägen:

1. Telefon portrait
2. Telefon landscape
3. Smal laptop / surfplatta

För varje sida ska vi kontrollera:

- går det att läsa huvudinformationen utan onödig scroll i två led
- går det att nå alla viktiga knappar
- fungerar dropdowns och modaler ovanpå sticky element
- får formulärfält rimlig bredd
- går det att spara utan att kontroller skyms
- blir tabeller antingen läsbara eller ersatta av kortvy

## Slutsats

Mobilstödet är nu ganska bra på de publika resultat- och listvyerna.
Det som återstår är framför allt att systematiskt verifiera och eventuellt
förenkla de mer komplexa arbetsvyerna: inmatning, sekretariat, admin och
speaker/rapportflöden.
