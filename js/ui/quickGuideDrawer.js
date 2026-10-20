// js/ui/quickGuideDrawer.js
// Kontextuell snabbhjälp och 60-sekunderslathundar för funktionärer och domare.

import { escapeHtml } from '../utils/sharedUtils.js';
import { translateTo } from '../utils/i18n.js';

// Button names come from the same i18n keys as the pages, so the guide says what the screen says
const LABEL = {
  saveProtocol: { sv: translateTo('input_save_protocol', 'sv'), en: translateTo('input_save_protocol', 'en') },
  err1: { sv: translateTo('input_error_1', 'sv'), en: translateTo('input_error_1', 'en') },
  err2: { sv: translateTo('input_error_2', 'sv'), en: translateTo('input_error_2', 'en') },
  err3: { sv: translateTo('input_error_3', 'sv'), en: translateTo('input_error_3', 'en') },
  eliminated: { sv: translateTo('input_eliminated', 'sv'), en: translateTo('input_eliminated', 'en') },
  saveAndNext: { sv: translateTo('marathon_save_and_next', 'sv'), en: translateTo('marathon_save_and_next', 'en') },
  route: { sv: translateTo('marathon_route_through_obstacle', 'sv'), en: translateTo('marathon_route_through_obstacle', 'en') },
  routeUndo: { sv: translateTo('marathon_undo', 'sv'), en: translateTo('marathon_undo', 'en') },
  routeClear: { sv: translateTo('marathon_clear', 'sv'), en: translateTo('marathon_clear', 'en') },
  knockdowns: { sv: translateTo('marathon_knockdowns', 'sv'), en: translateTo('marathon_knockdowns', 'en') },
  holdTime: { sv: translateTo('marathon_hold_time', 'sv'), en: translateTo('marathon_hold_time', 'en') },
  marathonElim: { sv: translateTo('marathon_elim', 'sv'), en: translateTo('marathon_elim', 'en') },
  precisionSave: { sv: translateTo('precision_save_results', 'sv'), en: translateTo('precision_save_results', 'en') },
  precisionExtra: { sv: translateTo('precision_extra_penalty', 'sv'), en: translateTo('precision_extra_penalty', 'en') },
  pause: { sv: translateTo('observer_stop_all', 'sv'), en: translateTo('observer_stop_all', 'en') },
  splitAutoFind: { sv: translateTo('precision_split_auto_find_btn', 'sv'), en: translateTo('precision_split_auto_find_btn', 'en') }
};

// A button name as a coloured chip
function chip(text, color = 'bg-blue-600') {
  return `<span class="${color} text-white px-2 py-0.5 rounded text-xs font-bold">${escapeHtml(text)}</span>`;
}

// Rolldefinitioner med guider på både svenska och engelska
export const GUIDES = {
  'dressage': {
    title: { sv: 'Dressyr – Domare & Skrivare', en: 'Dressage – Judge & Scribe' },
    badge: { sv: 'Dressyrprotokoll', en: 'Dressage Protocol' },
    icon: '📝',
    steps: {
      sv: [
        'Välj <strong>Ekipage</strong> i sökfältet eller med pilarna « ». Program och domare fylls i från klassens domarschema.',
        'Kontrollera att rätt <strong>Program</strong> och <strong>Domare</strong> (din position, t.ex. C, E, B) visas. Byt i listan om det inte stämmer.',
        'Börja döma när ekipaget hälsar. Raden högst upp följer med när du skrollar och visar ekipage, procent, poäng och hur många moment som är ifyllda (t.ex. "12/20 ifyllda").'
      ],
      en: [
        'Select the <strong>Equipage</strong> in the search box or with the « » arrows. Test and judge are filled in from the class judging plan.',
        'Check that the right <strong>Test</strong> and <strong>Judge</strong> (your position, e.g. C, E, B) are shown. Change them in the list if not.',
        'Start judging when the equipage salutes. The bar at the top stays visible while you scroll and shows the equipage, percent, points and how many movements are filled (e.g. "12/20 filled").'
      ]
    },
    during: {
      sv: [
        '<strong>Betyg 0–10:</strong> Skriv siffran direkt. Halva poäng är tillåtna (t.ex. 6, 6.5, 7.5).',
        '<strong>Tangentbordsgenvägar:</strong> Tryck <kbd class="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded border text-xs font-mono">Enter</kbd> för att hoppa till nästa rörelse. Tryck <kbd class="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded border text-xs font-mono">Tab</kbd> för att öppna och skriva kommentar för aktuell rörelse.',
        '<strong>Kommentarer:</strong> Klicka på <span class="text-blue-600 font-semibold">💬</span> vid behov för att motivera poängen.',
        `<strong>Felkörning / Avdrag:</strong> Första felkörningen ger 5 straffpoäng, den andra ger ytterligare 10 straffpoäng (15 totalt) och den tredje innebär uteslutning. Använd knapparna "${LABEL.err1.sv}", "${LABEL.err2.sv}" och "${LABEL.err3.sv}" (frågar innan ekipaget markeras som eliminerat), eller fyll i övriga straff längst ner i protokollet.`,
        `<strong>Spara:</strong> Tryck på ${chip(LABEL.saveProtocol.sv)} när sista momentet är bedömt. Saknar något moment poäng frågar appen först. Poängen du skriver visas live för publiken under tiden, men det är inget sparat protokoll. Protokollet blir inte låst eller officiellt förrän resultatet finaliseras på resultatsidan.`
      ],
      en: [
        '<strong>Marks 0–10:</strong> Type marks directly. Half points allowed (e.g. 6.5, 7.5).',
        '<strong>Keyboard navigation:</strong> Press <kbd class="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded border text-xs font-mono">Enter</kbd> to move to next movement. Press <kbd class="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded border text-xs font-mono">Tab</kbd> to jump to comments for the current movement.',
        '<strong>Comments:</strong> Click <span class="text-blue-600 font-semibold">💬</span> to add explanatory notes.',
        `<strong>Errors of course:</strong> The first error gives 5 penalty points, the second adds 10 more (15 total), and the third results in elimination. Use the "${LABEL.err1.en}", "${LABEL.err2.en}" and "${LABEL.err3.en}" buttons (the third asks before marking the turnout eliminated), or enter other penalties at the bottom.`,
        `<strong>Save:</strong> Press ${chip(LABEL.saveProtocol.en)} once the last movement is marked. If a movement has no mark, the app asks first. The marks you type are shown live to spectators meanwhile, but that is not a saved protocol. The protocol is not locked or official until the result is finalized on the results page.`
      ]
    },
    troubleshooting: {
      sv: [
        {
          q: 'Kunde inte spara eller dålig mobiltäckning (Offline)?',
          a: 'Om domarvyn och tävlingsdatan redan är laddade kan du klicka på Spara som vanligt. Kontrollera att protokollet visas som köat, håll fliken öppen och vänta tills köindikatorn är borta (allt skickat) innan du lämnar sidan.'
        },
        {
          q: 'Skrev fel poäng eller kommentar?',
          a: 'Klicka bara i rutan och ändra siffran direkt. Den nya poängen uppdateras omedelbart i sammanställningen.'
        },
        {
          q: 'Ekipaget utesluts eller utgår?',
          a: 'Kryssa i rutan "Eliminerad" längst ner och klicka på Spara Protokoll.'
        },
        {
          q: 'Måste ändra ett redan sparat protokoll?',
          a: 'Om resultatet inte är finaliserat kan du välja ekipaget igen, rätta uppgiften och spara på nytt. Är resultatet finaliserat måste en behörig användare först återöppna det på resultatsidan.'
        }
      ],
      en: [
        {
          q: 'Lost internet connection / Offline warning?',
          a: 'If the judge view and competition data were already loaded, click Save as usual. Verify that the protocol is queued, keep the tab open, and wait until the queue indicator is gone (everything sent) before leaving the page.'
        },
        {
          q: 'Entered the wrong mark or remark?',
          a: 'Click into the field and edit it directly. The summary updates immediately.'
        },
        {
          q: 'Equipage eliminated?',
          a: 'Check the "Eliminated" box at the bottom and click Save Protocol.'
        },
        {
          q: 'Need to edit an already saved protocol?',
          a: 'If the result has not been finalized, select the equipage again, correct the entry, and save it again. If it is finalized, an authorized user must first reopen it on the results page.'
        }
      ]
    },
    symbols: {
      sv: [
        { sym: '⌨️ Enter', desc: 'Hoppa till nästa rörelse' },
        { sym: '⌨️ Tab', desc: 'Öppna och skriv kommentar' },
        { sym: '☁️ Bock', desc: 'Synkad med servern' },
        { sym: '☁️ Siffra', desc: 'Sparad lokalt (köad offline)' },
        { sym: '📊 x/N ifyllda', desc: 'Moment med poäng av alla moment' }
      ],
      en: [
        { sym: '⌨️ Enter', desc: 'Jump to next movement' },
        { sym: '⌨️ Tab', desc: 'Open and type comment' },
        { sym: '☁️ Check', desc: 'Synced with server' },
        { sym: '☁️ Count', desc: 'Stored locally in offline queue' },
        { sym: '📊 x/N filled', desc: 'Movements with a mark, of all movements' }
      ]
    }
  },

  'marathon-obstacle': {
    title: { sv: 'Maraton – Hinderdomare', en: 'Marathon – Obstacle Judge' },
    badge: { sv: 'Hinderinmatning', en: 'Obstacle Input' },
    icon: '🚩',
    steps: {
      sv: [
        'Välj <strong>Ekipage</strong> (sökfältet överst eller pilarna « ») när ekipaget närmar sig hindret.',
        'Kontrollera att ditt <strong>Hinder</strong> är valt i listan bredvid (appen minns hindret du valde senast).',
        'Stå redo med blicken på hindrets in- och utfartsflaggor.'
      ],
      en: [
        'Select the <strong>Equipage</strong> (search box at the top or the « » arrows) as it approaches the obstacle.',
        'Check that your <strong>Obstacle</strong> is selected in the list next to it (the app remembers the one you chose last).',
        'Stand ready watching the obstacle entry and exit flags.'
      ]
    },
    during: {
      sv: [
        `<strong>Starta klockan:</strong> Tryck på ${chip('START', 'bg-emerald-600')} exakt när första hästens nos skär linjen mellan infartsflaggorna.`,
        `<strong>${LABEL.route.sv}:</strong> Tryck på portarna (A, B, C …) i den ordning ekipaget kör dem. Appen varnar om en port kommer i fel ordning. ${LABEL.routeUndo.sv} tar bort den senaste porten, ${LABEL.routeClear.sv} tömmer vägen.`,
        `<strong>Stoppa klockan:</strong> Tryck på ${chip('STOPP', 'bg-red-600')} exakt när ekipaget passerar ut mellan utfartsflaggorna.`,
        `<strong>${LABEL.knockdowns.sv}:</strong> Fältet finns bara på hinder med rivningsbara element. Ange antal nedslagna element eller bollar (2 straffpoäng per rivet element, TR V 525.5).`,
        `<strong>${LABEL.holdTime.sv}:</strong> Om ekipaget hålls kvar (t.ex. föregående ekipage i hindret eller hinderreparation): ange hålltiden i <strong>minuter</strong> med snabbknapparna +½, +1, +2 eller skriv t.ex. 2,5, och välj orsak. Tiden dras av från sträcka B.`,
        `<strong>Spara:</strong> Tryck på ${chip(LABEL.saveAndNext.sv, 'bg-emerald-600')}. Resultatet sparas och nästa ekipage i startordningen väljs.`
      ],
      en: [
        `<strong>Start clock:</strong> Press ${chip('START', 'bg-emerald-600')} the instant the first horse's nose crosses the entry flags.`,
        `<strong>${LABEL.route.en}:</strong> Tap the gates (A, B, C …) in the order the turnout drives them. The app warns when a gate comes out of order. ${LABEL.routeUndo.en} removes the last gate, ${LABEL.routeClear.en} empties the route.`,
        `<strong>Stop clock:</strong> Press ${chip('STOP', 'bg-red-600')} the instant the turnout crosses the exit flags.`,
        `<strong>${LABEL.knockdowns.en}:</strong> Shown only on obstacles with breakable elements. Enter the number of elements or balls knocked down (2 penalty points per element knocked down).`,
        `<strong>${LABEL.holdTime.en}:</strong> If the turnout is held (e.g. previous turnout still in the obstacle, obstacle repair): enter the hold time in <strong>minutes</strong> with the +½, +1, +2 quick buttons or type e.g. 2.5, and pick a reason. It is deducted from section B.`,
        `<strong>Save:</strong> Press ${chip(LABEL.saveAndNext.en, 'bg-emerald-600')}. The result is saved and the next turnout in the start order is selected.`
      ]
    },
    troubleshooting: {
      sv: [
        {
          q: 'Klockan startades för tidigt eller för sent?',
          a: 'Klicka direkt på tidssiffrorna på skärmen för att öppna den manuella tidsredigeraren. Där kan du korrigera tiden exakt.'
        },
        {
          q: 'Råkade trycka på fel port?',
          a: `Tryck ${LABEL.routeUndo.sv} för att ta bort den senaste porten, eller ${LABEL.routeClear.sv} för att börja om vägen. Antalet rivningar ändrar du direkt i fältet.`
        },
        {
          q: 'Dålig täckning / Mobilnätet svajar ute i skogen?',
          a: '<strong>Ingen fara!</strong> Klicka på Spara som vanligt. Resultatet sparas säkert i surfplattan och skickas automatiskt in till sekretariatet så fort nätkontakten återfås.'
        },
        {
          q: 'Ekipaget kör fel väg eller välter?',
          a: `Kryssa i "${LABEL.marathonElim.sv}", skriv en kort förklarande kommentar och tryck ${LABEL.saveAndNext.sv}.`
        },
        {
          q: 'Skärmen släcker sig mitt i en ritt?',
          a: 'Appen aktiverar Screen Wake Lock automatiskt så länge fliken är öppen. Kontrollera att enhetens energisparläge inte stänger av skärmen aggressivt. Ha gärna en powerbank ansluten under heldag i fält.'
        }
      ],
      en: [
        {
          q: 'Started the timer too early or too late?',
          a: 'Tap the large timer digits on screen to open the manual time editor and adjust the exact time.'
        },
        {
          q: 'Tapped the wrong gate?',
          a: `Press ${LABEL.routeUndo.en} to remove the last gate, or ${LABEL.routeClear.en} to start the route over. Change the knockdown count directly in its field.`
        },
        {
          q: 'Poor mobile coverage in the woods?',
          a: '<strong>Do not worry!</strong> Tap Save as usual. Results are stored locally and will synchronize automatically once connectivity returns.'
        },
        {
          q: 'Turnout goes wrong course or overturns?',
          a: `Check "${LABEL.marathonElim.en}", write a concise remark, and press ${LABEL.saveAndNext.en}.`
        },
        {
          q: 'Screen dims or locks during a round?',
          a: 'The app engages Screen Wake Lock automatically while the tab remains open. Ensure aggressive battery saver mode is disabled and consider connecting a power bank for full-day field use.'
        }
      ]
    },
    symbols: {
      sv: [
        { sym: '🟢 START', desc: 'Passage av startflaggor' },
        { sym: '🔴 STOPP', desc: 'Passage av målflaggor' },
        { sym: '⚪ Port A–F', desc: 'Tryck i körordning; fel ordning varnas' },
        { sym: '⏱️ Tidsjustering', desc: 'Klicka på siffrorna för manuell tid' }
      ],
      en: [
        { sym: '🟢 START', desc: 'Crossing entry flags' },
        { sym: '🔴 STOP', desc: 'Crossing exit flags' },
        { sym: '⚪ Gate A–F', desc: 'Tap in driving order; wrong order is flagged' },
        { sym: '⏱️ Manual time', desc: 'Tap timer digits to edit' }
      ]
    }
  },

  'marathon-stages': {
    title: { sv: 'Maraton – Sträcktider & Etapper', en: 'Marathon – Section & Phase Timing' },
    badge: { sv: 'Etapptidtagning', en: 'Phase Timing' },
    icon: '⏱️',
    steps: {
      sv: [
        'Välj aktiv <strong>Etapp</strong> i flikarna (Warm-up, A, Transp. eller B).',
        'Välj <strong>Startnummer / Ekipage</strong> i rullistan när ekipaget närmar sig tidskontrollen.',
        'Kontrollera ekipagets idealtid och tidsfönster (min/max) på skärmen.'
      ],
      en: [
        'Select active <strong>Phase</strong> in the tabs (Warm-up, A, Transp. or B).',
        'Select <strong>Start Number / Equipage</strong> as turnout approaches the timing station.',
        'Check time window (min/optimum/max) displayed on screen.'
      ]
    },
    during: {
      sv: [
        '<strong>Tidtagning vid passage:</strong> Klicka på klock-ikonen vid Start eller Mål exakt när ekipaget passerar tidskontrollen.',
        '<strong>Automatisk beräkning:</strong> Systemet räknar automatiskt ut förfluten tid och eventuella tidsstraff mot gällande tidsfönster.',
        '<strong>Manuell tid:</strong> Om tiden tagits med ett officiellt tidtagarur: tryck på etappens tid och skriv in den körda tiden som mmsscc (t.ex. 251530 = 25:15,30).',
        '<strong>Aktiva ekipage:</strong> Fäll ut listan "Aktiva ekipage" för att se vilka som befinner sig på sträckan just nu.',
        `<strong>Tävlingspaus:</strong> En global paus sätts från observatörssidan (${LABEL.pause.sv}). Klockorna på den här sidan pausas då automatiskt, och tiden under pausen räknas inte.`
      ],
      en: [
        '<strong>Passage timing:</strong> Tap the clock icon at Start or Finish the moment the equipage passes.',
        '<strong>Automatic calculation:</strong> Elapsed time and penalties are computed automatically according to rules ledger.',
        '<strong>Manual time:</strong> If the time was taken with an official stopwatch: tap the section time and enter the driven time as mmsscc (e.g. 251530 = 25:15.30).',
        '<strong>Active turnouts:</strong> Expand "Active Timers" to monitor all equipages currently on the phase.',
        `<strong>Competition pause:</strong> A global pause is set from the observer page (${LABEL.pause.en}). The clocks on this page then pause automatically, and the paused time does not count.`
      ]
    },
    troubleshooting: {
      sv: [
        {
          q: 'Tiden registrerades vid fel klockslag?',
          a: 'Tryck på etappens tid för att öppna rutan för manuell tid och skriv in den körda tiden (mmsscc).'
        },
        {
          q: 'Kusken körde för fort eller för långsamt?',
          a: 'Utanför tidsfönstret ges 0,25 straffpoäng per sekund på A och B (TR V 523.2). Uteslutning sker först vid tidsgränsen: maxtid + 20 % på A, dubbla maxtiden på B och transportsträckan (523.3). Transportsträckan har bara tidsgränsen, inga tidsstraff.'
        },
        {
          q: 'Offline vid mål A eller start B?',
          a: 'På en redan laddad vy kan tider köas lokalt. Kontrollera köindikatorn, håll fliken öppen och vänta tills köindikatorn är borta när nätverket är tillbaka.'
        }
      ],
      en: [
        {
          q: 'Time was recorded incorrectly?',
          a: 'Tap the section time to open the manual time box and enter the driven time (mmsscc).'
        },
        {
          q: 'Equipage outside the time window?',
          a: 'Outside the time window 0.25 penalties per second are given on sections A and B. Elimination comes only at the time limit: max time + 20 % on A, double the max time on B and the transfer. The transfer has only the time limit, no time penalties.'
        },
        {
          q: 'Offline at checkpoint?',
          a: 'Times are queued locally in browser storage and sync when connected.'
        }
      ]
    },
    symbols: {
      sv: [
        { sym: '🟢 Klocka', desc: 'Registrera tid vid passage' },
        { sym: '⚠️ Röd tid', desc: 'Över maxtid: 0,25 straffpoäng/s (uteslutning först vid tidsgränsen)' },
        { sym: '🟡 Gul tid', desc: 'Utanför tidsfönster (straff)' },
        { sym: '🚨 Paus', desc: 'Sätts från observatörssidan; pausar alla klockor' }
      ],
      en: [
        { sym: '🟢 Clock', desc: 'Stamp time at passage' },
        { sym: '⚠️ Red time', desc: 'Over max time: 0.25 penalties/s (elimination only at the time limit)' },
        { sym: '🟡 Yellow time', desc: 'Outside time window (penalties)' },
        { sym: '🚨 Pause', desc: 'Set from the observer page; holds all clocks' }
      ]
    }
  },

  'precision': {
    title: { sv: 'Precision – Tidtagare & Banpersonal', en: 'Precision – Timer & Ring Official' },
    badge: { sv: 'Precisionsinmatning', en: 'Precision Input' },
    icon: '🎯',
    steps: {
      sv: [
        'Välj <strong>Startnummer / Ekipage</strong> i rullistan eller med pilarna.',
        'Kontrollera klassens <strong>Tillåtna tid</strong> och <strong>Maxtid</strong> som visas under timern.',
        'Stå redo med blicken på startlinjen.'
      ],
      en: [
        'Select <strong>Start Number / Equipage</strong> from dropdown or with arrow keys.',
        'Check <strong>Time Allowed</strong> and <strong>Time Limit</strong> shown below the timer.',
        'Watch the entry gates ready to start.'
      ]
    },
    during: {
      sv: [
        '<strong>Start:</strong> Klicka på <span class="bg-emerald-600 text-white px-2 py-0.5 rounded text-xs font-bold">START</span> när ekipaget korsar startlinjen.',
        '<strong>Rivningar (Bollar):</strong> Klicka på motsvarande portknapp (t.ex. 1, 4, 12A) så fort en boll trillar. Knappen blir röd och 3 straff läggs till direkt. Klicka igen om bollen dömdes fel för att ångra.',
        '<strong>Ombyggnad:</strong> Måste ett hinder byggas om under ritten, tryck på <strong>+10 s (ombyggnad)</strong> under klockan. 10 sekunder läggs på tiden per ombyggnad; −1 ångrar en.',
        `<strong>Målgång:</strong> Klicka på ${chip('STOPP', 'bg-red-600')} när ekipaget skär mållinjen.`,
        `<strong>${LABEL.precisionExtra.sv}:</strong> Ange eventuella övriga straff (t.ex. groom avstigen) i fältet "${LABEL.precisionExtra.sv}".`,
        `<strong>Spara:</strong> Klicka på ${chip(LABEL.precisionSave.sv, 'bg-brand-darkblue')}.`
      ],
      en: [
        '<strong>Start:</strong> Press <span class="bg-emerald-600 text-white px-2 py-0.5 rounded text-xs font-bold">START</span> when crossing the start line.',
        '<strong>Knockdowns:</strong> Tap the gate button (e.g. 1, 4, 12A) immediately when a ball falls. Button turns red (+3 penalties). Tap again to toggle/undo.',
        '<strong>Rebuild:</strong> If an obstacle has to be rebuilt during the round, press <strong>+10 s (ombyggnad)</strong> under the clock. 10 seconds are added per rebuild; −1 undoes one.',
        `<strong>Finish:</strong> Press ${chip('STOP', 'bg-red-600')} when crossing the finish line.`,
        `<strong>${LABEL.precisionExtra.en}:</strong> Enter any other penalties (e.g. groom dismounting) in "${LABEL.precisionExtra.en}".`,
        `<strong>Save:</strong> Click ${chip(LABEL.precisionSave.en, 'bg-brand-darkblue')}.`
      ]
    },
    troubleshooting: {
      sv: [
        {
          q: 'Tiden överskred tillåten tid?',
          a: 'Klockan skiftar färg och tidsstraff beräknas automatiskt (0,5 straffpoäng per sekund över tillåten tid, med två decimaler, TR V 525.9).'
        },
        {
          q: 'Klockan överskred maxtiden?',
          a: 'Över dubbla tillåtna tiden utesluts ekipaget. I Lätt B Barn räcker det att tillåten tid överskrids (TR V Bilaga 5).'
        },
        {
          q: 'Missade att trycka Start eller manuell klocka användes?',
          a: 'Klicka direkt på de stora tidssiffrorna på skärmen för att skriva in den manuella tiden i formatet MMSSCC.'
        },
        {
          q: 'Offline i ridhuset / på banan?',
          a: 'På en redan laddad vy kan du klicka Spara som vanligt. Kontrollera köindikatorn, håll fliken öppen och vänta tills köindikatorn är borta när nätverket är tillbaka.'
        }
      ],
      en: [
        {
          q: 'Time exceeded Time Allowed?',
          a: 'Timer highlights and time penalty is calculated automatically (0.5 penalty points per second over Time Allowed, to two decimals).'
        },
        {
          q: 'Time exceeded Time Limit?',
          a: 'Above double the Time Allowed the turnout is eliminated. In Lätt B Barn, exceeding the Time Allowed is enough.'
        },
        {
          q: 'Missed start click or used stopwatch?',
          a: 'Tap the large timer digits on screen to manually type time in MMSSCC format.'
        },
        {
          q: 'Offline in arena?',
          a: 'On an already loaded view, save normally, verify the queue indicator, keep the tab open, and wait until the queue indicator is gone after reconnecting.'
        }
      ]
    },
    symbols: {
      sv: [
        { sym: '⌨️ ← / →', desc: 'Föregående / nästa ekipage' },
        { sym: '🔴 Röd port', desc: 'Rivning registrerad (+3 straff)' },
        { sym: '⏱️ Klicka tid', desc: 'Öppna manuell tidsinmatning' },
        { sym: '🔄 Återställ', desc: 'Nollställ klocka och rivningar' }
      ],
      en: [
        { sym: '⌨️ ← / →', desc: 'Previous / next equipage' },
        { sym: '🔴 Red gate', desc: 'Knockdown registered (+3 pen)' },
        { sym: '⏱️ Tap digits', desc: 'Manual time input' },
        { sym: '🔄 Reset', desc: 'Reset timer and cones' }
      ]
    }
  },

  'observer': {
    title: { sv: 'Maraton – Observatör på sträcka', en: 'Marathon – Course Observer' },
    badge: { sv: 'Observatörslogg', en: 'Observer Log' },
    icon: '👁️',
    steps: {
      sv: [
        'Välj <strong>Startnummer / Ekipage</strong> när du ser ekipaget närma sig din observationspost.',
        'Håll uppsikt över föreskriven gångart (t.ex. skritt på skrittsträcka).',
        'Var beredd att agera vid otillåten hjälp, galopp eller otillåtna halter.'
      ],
      en: [
        'Select <strong>Start Number / Equipage</strong> as they approach your observation post.',
        'Monitor prescribed gait (e.g. walk on walk section).',
        'Watch for unauthorized assistance, canter in walk, or unauthorized halts.'
      ]
    },
    during: {
      sv: [
        '<strong>Fel gångart (Galopp i skritt):</strong> Klicka på START vid första galoppsprånget. Klicka på STOPP när hästen skrittar igen. Varje start–stopp blir ett eget tillfälle: rättat inom 5 s ger inget straff, annars 1 straffpoäng per påbörjad 5-sekundersperiod (TR V 523.1).',
        '<strong>Otillåten halt:</strong> Klicka START när ekipaget stannar olovligen och STOPP när det rör sig framåt igen.',
        '<strong>Noteringar / Kommentarer:</strong> Skriv en kort förklaring vid behov (t.ex. "Galopp ca 15 m").',
        `<strong>Tävlingspaus:</strong> Vid allvarlig incident eller blockerat spår: öppna panelen för paus och tryck på den röda knappen <strong>${LABEL.pause.sv}</strong>. Alla tävlingsklockor pausas. Sidor som är öppna visar då att tävlingen är pausad, men ingen larmas: meddela tävlingsledningen via radio eller telefon.`
      ],
      en: [
        '<strong>Wrong gait (Canter in walk):</strong> Click START on first canter stride. Click STOP when back to walk. Each start–stop is one incident: corrected within 5 s gives no penalty, otherwise 1 penalty per commenced 5-second period.',
        '<strong>Unauthorized halt:</strong> Click START on halt and STOP when moving forward.',
        '<strong>Remarks:</strong> Type explanatory notes (e.g. "Cantered approx 15 m").',
        `<strong>Competition pause:</strong> If the track is blocked or in an emergency, open the pause panel and press the red <strong>${LABEL.pause.en}</strong> button. All competition clocks pause. Pages that are open then show that the competition is paused, but nobody is alerted: tell the competition management by radio or phone.`
      ]
    },
    troubleshooting: {
      sv: [
        {
          q: 'Råkade klicka start för tidigt?',
          a: 'Klicka Stopp och radera den felaktiga händelsen direkt i logglistan.'
        },
        {
          q: 'Tappad anslutning ute på sträckan?',
          a: 'Observatörsloggen lagras lokalt på din enhet och synkas automatiskt när du får signal igen.'
        }
      ],
      en: [
        {
          q: 'Started wrong gait timer accidentally?',
          a: 'Click stop, then remove the incident with the trash button in the wrong-gait list.'
        },
        {
          q: 'Poor cell coverage?',
          a: 'Log entries buffer locally and submit automatically when connection is restored.'
        }
      ]
    },
    symbols: {
      sv: [
        { sym: '🚨 Pausa tävlingen', desc: 'Pausar tidtagning för alla ekipage' },
        { sym: '🐎 Gångart', desc: 'Mäter sekunder i otillåten gångart' },
        { sym: '🛑 Halt', desc: 'Registrerar otillåten stillastående tid' }
      ],
      en: [
        { sym: '🚨 Pause competition', desc: 'Pauses timing for all equipages' },
        { sym: '🐎 Gait', desc: 'Tracks seconds in unauthorized gait' },
        { sym: '🛑 Halt', desc: 'Logs unauthorized stationary time' }
      ]
    }
  },

  'vet-check': {
    title: { sv: 'Veterinärbesiktning & Hästkontroll', en: 'Vet Inspection & Horse Welfare' },
    badge: { sv: 'Veterinär', en: 'Veterinary' },
    icon: '🩺',
    steps: {
      sv: [
        'Sök upp <strong>Startnummer / Ekipage / Häst</strong> i sökfältet.',
        'Välj rätt kontrollflik: <strong>Förbesiktning, Selning, Vilobox</strong> eller <strong>Slutbesiktning</strong>.',
        'Kontrollera chipnummer och passuppgifter mot skärmen vid behov.',
        'Genomför besiktningen tillsammans med tävlingsveterinären.'
      ],
      en: [
        'Search <strong>Start Number / Equipage / Horse</strong> in search box.',
        'Select the correct inspection tab: <strong>Initial, Harness, Rest Area</strong>, or <strong>Final</strong>.',
        'Verify microchip and passport details if requested.',
        'Conduct inspection with treating/official veterinarian.'
      ]
    },
    during: {
      sv: [
        '🟢 <strong>Godkänd:</strong> Hästen är i fullgott skick och godkänd för start.',
        '🟡 <strong>Holding Box (Återbesiktning):</strong> Hästen skickas till Holding Box för fördjupad kontroll före slutligt beslut.',
        '🔴 <strong>Ej godkänd / Struken:</strong> Hästen får ej starta. Beslutet rapporteras direkt till domarkollegiets ordförande (händelseloggen) och ekipaget stryks när domarkollegiet fastställt det.',
        '<strong>Vilobox:</strong> Registrera puls, andning och allmäntillstånd i fliken Vilobox. Dessa fält visas inte i övriga kontroller.',
        '<strong>Spara:</strong> Hästens status sparas direkt när du trycker på statusknappen. För en ändrad veterinärnotering visas en separat knapp märkt Spara.'
      ],
      en: [
        '🟢 <strong>Passed:</strong> Fit to compete.',
        '🟡 <strong>Holding Box:</strong> Referred for re-inspection before final verdict.',
        '🔴 <strong>Not fit / Withdrawn:</strong> Not permitted to start. The decision is reported at once to the President of the Ground Jury (incident log); the equipage is withdrawn when the ground jury confirms it.',
        '<strong>Rest Area:</strong> Record pulse, respiration, and general condition on the Rest Area tab. These fields are not shown for the other inspections.',
        '<strong>Saving:</strong> The horse status is saved immediately when you press its status button. A separate Save button appears after you edit the veterinary note.'
      ]
    },
    troubleshooting: {
      sv: [
        {
          q: 'Status ändrades efter ombesiktning?',
          a: 'Öppna samma häst igen och tryck på den nya statusen. Ändringen sparas direkt.'
        },
        {
          q: 'Offline vid stallarna?',
          a: 'På en redan laddad vy kan uppgifterna köas lokalt. Kontrollera köindikatorn och vänta tills köindikatorn är borta (allt skickat) innan du lämnar sidan.'
        }
      ],
      en: [
        {
          q: 'Status updated after holding box?',
          a: 'Open the same horse again and press the new status. The change is saved immediately.'
        },
        {
          q: 'Offline near stables?',
          a: 'On an already loaded view, results can queue locally. Verify the queue indicator and wait until the queue indicator is gone (everything sent) before leaving the page.'
        }
      ]
    },
    symbols: {
      sv: [
        { sym: '🟢 Godkänd', desc: 'Klar för start' },
        { sym: '🟡 Holding', desc: 'Skickad till återbesiktning' },
        { sym: '🔴 Ej godkänd', desc: 'Får ej starta' }
      ],
      en: [
        { sym: '🟢 Passed', desc: 'Approved to start' },
        { sym: '🟡 Holding', desc: 'Sent to holding box' },
        { sym: '🔴 Not fit', desc: 'Not permitted to compete' }
      ]
    }
  },

  'secretariat': {
    title: { sv: 'Sekretariat – Översikt & Arbetsgång', en: 'Secretariat – Workflow & Review' },
    badge: { sv: 'Sekretariat', en: 'Secretariat' },
    icon: '📊',
    steps: {
      sv: [
        'Kontrollera att startlistor är genererade och officiella tidsgränser inställda.',
        'Övervaka inkommande resultat i realtid från banorna.',
        'Granska, lås och exportera officiella resultat- och prisutdelningslistor.'
      ],
      en: [
        'Ensure start lists are generated and official time limits configured.',
        'Monitor incoming live results from field stations in real time.',
        'Review, finalize and export official results and prize lists.'
      ]
    },
    during: {
      sv: [
        '<strong>Statusmärken:</strong> Orange "Pågår" = ritten pågår, blå "Klar" = klar men inte finaliserad, grön "Finaliserad" = låst officiellt resultat. Grå = ej startad.',
        '<strong>Granskning före finalisering:</strong> Kontrollera att alla domarbetyg och etapptider inkommit innan knappen "Finalisera" klickas.',
        '<strong>Lås upp vid protest / korrigering:</strong> Om ett domarprotokoll behöver korrigeras, lås upp raden, gör ändringen tillsammans med överdomaren och spara om.',
        '<strong>PDF & Utskrift:</strong> Skapa officiella resultatlistor, protokoll och speakerunderlag via Rapportcenter.',
        '<strong>Händelselogg:</strong> Protester, incidenter och domarkollegiets beslut i <strong>Händelselogg &amp; protester</strong>; där finns också notiserna (veterinärbeslut, "Ändrad av kusk") och <strong>Fältenheter</strong> (vilka inmatningsenheter som lever).'
      ],
      en: [
        '<strong>Status badges:</strong> Amber "Running" = in progress, blue "Finished" = done but not finalized, green "Finalized" = locked official result. Grey = not started.',
        '<strong>Review before finalizing:</strong> Verify that all judges and timing points reported in before finalizing.',
        '<strong>Unlock on query / protest:</strong> If correction is required, unlock the record, update with Ground Jury and re-save.',
        '<strong>PDF & Printouts:</strong> Generate official result sheets, protocols and speaker material via Report Center.',
        '<strong>Incident log:</strong> Protests, incidents and ground jury decisions in <strong>Incidents &amp; protests</strong>; it also holds the notifications (vet decisions, "Changed by driver") and <strong>Field devices</strong> (which input devices are alive).'
      ]
    },
    troubleshooting: {
      sv: [
        {
          q: 'Ett hinderresultat eller tid saknas?',
          a: 'Kontrollera med funktionären i fält via radio om deras enhet är offline (resultaten laddas upp så fort enheten får nätverk).'
        },
        {
          q: 'Skiljer sig beräknad tid från manuellt klockat resultat?',
          a: 'Sekretariatet har administrativ behörighet att redigera och fastställa den officiella tiden.'
        }
      ],
      en: [
        {
          q: 'Missing obstacle score or stage time?',
          a: 'Check via radio whether field official is offline; queued records upload automatically on reconnect.'
        },
        {
          q: 'Discrepancy between automated and manual timing?',
          a: 'Secretariat has administrative privilege to override and confirm official times.'
        }
      ]
    },
    symbols: {
      sv: [
        { sym: '🔒 Låst / Finaliserat', desc: 'Officiellt resultat, låst mot ändring' },
        { sym: '🔓 Upplåst', desc: 'Öppet för granskning och redigering' },
        { sym: '🖨️ PDF-export', desc: 'Generera officiella anslag och protokoll' }
      ],
      en: [
        { sym: '🔒 Finalized', desc: 'Official result locked from tampering' },
        { sym: '🔓 Unlocked', desc: 'Open for verification and editing' },
        { sym: '🖨️ PDF Export', desc: 'Generate official notices and reports' }
      ]
    }
  },

  'vagnbredd': {
    title: { sv: 'Funktionskontroll & Vagnbredd', en: 'Carriage Check & Track Width' },
    badge: { sv: 'Vagnmätning', en: 'Carriage measuring' },
    icon: '📏',
    steps: {
      sv: [
        'Välj <strong>Ekipage</strong> i sökfältet eller med pilarna « ».',
        'Mät vagnens spårvidd (yttermått mellan hjulen vid marken) för dressyr/precision och, om en annan vagn används, för maraton.',
        'Kontrollera vagnens utrustning (bromsar, reflexer, baksele) enligt "Vagnregler för godkännande".'
      ],
      en: [
        'Select the <strong>Equipage</strong> in the search box or with the « » arrows.',
        'Measure the track width (outside of the wheels at ground level) for dressage/cones and, if another carriage is used, for marathon.',
        'Check the carriage equipment (brakes, reflectors, breeching) against "Vagnregler för godkännande".'
      ]
    },
    during: {
      sv: [
        '<strong>Bredd dressyr/precision (cm):</strong> Bredden styr portbredden i precision (spårvidd + klassens tillägg). Appen varnar om vagnen är smalare än TR Bilaga 2 tillåter.',
        '<strong>Bredd maraton (cm):</strong> Fyll i om ekipaget kör maraton med en annan vagn.',
        '<strong>Tidigare vagn:</strong> Har kusken mätts tidigare föreslår appen de sparade måtten; tryck Använd om vagnen är densamma.',
        '<strong>Funktionskontroll:</strong> Kryssa i "Vagn godkänd" och skriv en anmärkning vid behov (t.ex. bromsar, reflexer).',
        `<strong>Spara:</strong> Tryck på ${chip('Spara & gå till nästa', 'bg-brand-darkblue')}. Nästa ekipage väljs direkt.`
      ],
      en: [
        '<strong>Width dressage/cones (cm):</strong> It sets the cone width in precision (track width + the class allowance). The app warns when the carriage is narrower than TR Annex 2 allows.',
        '<strong>Width marathon (cm):</strong> Fill in when the turnout drives marathon with another carriage.',
        '<strong>Earlier carriage:</strong> If the driver was measured before, the app suggests the saved widths; press Använd (Use) when it is the same carriage.',
        '<strong>Function check:</strong> Tick "Vagn godkänd" (carriage approved) and add a remark if needed (e.g. brakes, reflectors).',
        `<strong>Save:</strong> Press ${chip('Spara & gå till nästa', 'bg-brand-darkblue')} (save & next). The next turnout is selected.`
      ]
    },
    troubleshooting: {
      sv: [
        {
          q: 'Mätte fel?',
          a: 'Välj ekipaget igen, rätta måttet och spara på nytt. Precisionens portbredd räknas om från det sparade måttet.'
        },
        {
          q: 'Vagnen är för smal?',
          a: 'Varningen visar klassens minimimått. Vagnen kan sparas ändå; kontakta teknisk delegat eller överdomare innan start.'
        }
      ],
      en: [
        {
          q: 'Measured wrong?',
          a: 'Select the turnout again, correct the width and save again. The cone width in precision is recalculated from the saved width.'
        },
        {
          q: 'Carriage too narrow?',
          a: 'The warning shows the minimum width of the class. It can still be saved; contact the technical delegate or the president of the ground jury before the start.'
        }
      ]
    },
    symbols: {
      sv: [
        { sym: '« / »', desc: 'Föregående / nästa ekipage' },
        { sym: 'x av N', desc: 'Antal kontrollerade ekipage (under knappen)' }
      ],
      en: [
        { sym: '« / »', desc: 'Previous / next turnout' },
        { sym: 'x av N', desc: 'Turnouts checked so far (below the button)' }
      ]
    }
  },

  'precision-split': {
    title: { sv: 'Precision – Gate Observer (livekarta)', en: 'Cones – Gate Observer (live map)' },
    badge: { sv: 'Passager', en: 'Passages' },
    icon: '📍',
    steps: {
      sv: [
        `Välj <strong>Ekipage</strong> i sökfältet, eller tryck ${chip(LABEL.splitAutoFind.sv, 'bg-emerald-600')} för att hitta ekipaget som är startat.`,
        'Kontrollera att rätt ekipage visas under "Aktuellt Ekipage".',
        'Ställ dig så att du ser start, mål och de portar som är utplacerade på kartan.'
      ],
      en: [
        `Select the <strong>Equipage</strong> in the search box, or press ${chip(LABEL.splitAutoFind.en, 'bg-emerald-600')} to find the turnout that has started.`,
        'Check that the right turnout is shown under "Current Equipage".',
        'Stand where you can see the start, the finish and the gates placed on the map.'
      ]
    },
    during: {
      sv: [
        '<strong>Passage:</strong> Tryck på start, porten eller mål när ekipaget passerar. Tiden stämplas direkt.',
        '<strong>Ångra:</strong> Tryck på en redan loggad passage för att ta bort den (appen frågar först).',
        '<strong>Påverkar inte resultatet:</strong> Passagerna driver bara animeringen på monitorkartan. Tid och rivningar registreras på sidan Inmatning Precision.',
        '<strong>Finaliserat resultat:</strong> Passager kan inte ändras förrän resultatet är upplåst.'
      ],
      en: [
        '<strong>Passage:</strong> Tap start, the gate or finish when the turnout passes. The time is stamped at once.',
        '<strong>Undo:</strong> Tap a logged passage to remove it (the app asks first).',
        '<strong>Does not affect the result:</strong> Passages only drive the animation on the monitor map. Time and knockdowns are entered on the Precision input page.',
        '<strong>Finalized result:</strong> Passages cannot be changed until the result is unlocked.'
      ]
    },
    troubleshooting: {
      sv: [
        {
          q: 'Sidan säger att live-kartan inte är aktiverad?',
          a: 'Live-kartan slås på av admin i precisionsinställningarna. Utan den behövs inga passager.'
        },
        {
          q: 'Dålig täckning vid banan?',
          a: 'På en redan laddad vy köas passagerna lokalt. Håll fliken öppen tills köindikatorn är borta.'
        }
      ],
      en: [
        {
          q: 'The page says the live map is not enabled?',
          a: 'The admin turns the live map on in the precision settings. Without it no passages are needed.'
        },
        {
          q: 'Poor coverage at the arena?',
          a: 'On an already loaded view passages are queued locally. Keep the tab open until the queue indicator is gone.'
        }
      ]
    },
    symbols: {
      sv: [
        { sym: '📍 Port', desc: 'Tryck vid passage' },
        { sym: '⏱️ Tid', desc: 'Loggad passage – tryck för att ångra' }
      ],
      en: [
        { sym: '📍 Gate', desc: 'Tap on passage' },
        { sym: '⏱️ Time', desc: 'Logged passage – tap to undo' }
      ]
    }
  }
};

// Säkerställ att stilar injiceras en gång i <head>
function injectGuideStyles() {
  if (document.getElementById('quick-guide-styles')) return;
  const css = `
    .qg-backdrop {
      position: fixed;
      inset: 0;
      z-index: 2147483640;
      background: rgba(15, 23, 42, 0.65);
      backdrop-filter: blur(4px);
      display: flex;
      justify-content: flex-end;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .qg-backdrop.visible {
      opacity: 1;
      pointer-events: auto;
    }
    .qg-drawer {
      background: #ffffff;
      width: 100%;
      max-width: 620px;
      height: 100%;
      box-shadow: -4px 0 25px rgba(0, 0, 0, 0.18);
      display: flex;
      flex-direction: column;
      transform: translateX(100%);
      transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      overflow: hidden;
    }
    .qg-backdrop.visible .qg-drawer {
      transform: translateX(0);
    }
    .dark .qg-drawer {
      background: #0f172a;
      color: #f1f5f9;
      border-left: 1px solid #1e293b;
    }
    .qg-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 0.75rem;
      padding: 1rem;
    }
    .dark .qg-card {
      background: #1e293b;
      border-color: #334155;
    }
    .qg-highlight {
      border-left: 4px solid #2563eb;
    }
    .dark .qg-highlight {
      border-left-color: #60a5fa;
    }
    .quick-guide-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.35rem 0.65rem;
      border-radius: 0.5rem;
      font-size: 0.8125rem;
      font-weight: 700;
      line-height: 1;
      background: #fef3c7;
      color: #92400e;
      border: 1px solid #fcd34d;
      box-shadow: 0 1px 2px rgba(0,0,0,0.05);
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;
    }
    .quick-guide-btn:hover {
      background: #fde68a;
      color: #78350f;
      transform: translateY(-1px);
    }
    .dark .quick-guide-btn {
      background: #78350f;
      color: #fef3c7;
      border-color: #b45309;
    }
    .dark .quick-guide-btn:hover {
      background: #92400e;
    }
    /* Only while the drawer is open; otherwise printing the page would come out blank. */
    @media print {
      body.qg-open * {
        visibility: hidden !important;
      }
      body.qg-open .qg-backdrop,
      body.qg-open .qg-drawer,
      body.qg-open .qg-drawer * {
        visibility: visible !important;
      }
      .qg-backdrop {
        position: static !important;
        background: transparent !important;
        opacity: 1 !important;
        pointer-events: auto !important;
      }
      .qg-drawer {
        position: static !important;
        transform: none !important;
        max-width: 100% !important;
        box-shadow: none !important;
        height: auto !important;
      }
      .qg-no-print {
        display: none !important;
      }
    }
  `;
  const styleEl = document.createElement('style');
  styleEl.id = 'quick-guide-styles';
  styleEl.textContent = css;
  document.head.appendChild(styleEl);
}

function getPreferredLanguage() {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('user_lang_pref') || 'sv';
    }
  } catch {}
  return 'sv';
}

/**
 * Renderar HTML för en lathund-knapp.
 * @param {string} roleKey - Nyckel för rollen ('dressage', 'marathon-obstacle', etc.)
 * @param {object} options - Valfria inställningar
 * @returns {string} HTML-sträng för knappen
 */
export function renderQuickGuideButton(roleKey = 'dressage', options = {}) {
  const isEn = getPreferredLanguage() === 'en';
  const label = options.label || (isEn ? 'Cheat Sheet' : 'Lathund');
  const extraClass = options.extraClass || '';
  const title = isEn ? 'Open 60-second role cheat sheet' : 'Öppna 60-sekunders lathund för denna sida';
  // The button's own styles live in the same sheet, so inject it now rather than on first open
  if (typeof document !== 'undefined') injectGuideStyles();

  return `
    <button
      type="button"
      class="quick-guide-btn ${escapeHtml(extraClass)}"
      data-guide-role="${escapeHtml(roleKey)}"
      title="${escapeHtml(title)}"
      aria-label="${escapeHtml(title)}"
    >
      <span class="text-base leading-none">❓</span>
      <span>${escapeHtml(label)}</span>
    </button>
  `;
}

/**
 * Öppnar snabbhjälpspanelen / lathunden för vald roll.
 * @param {string} initialRoleKey - Rollnyckel (t.ex. 'dressage', 'marathon-obstacle')
 */
export function openQuickGuide(initialRoleKey = 'dressage') {
  injectGuideStyles();

  const previouslyFocusedElement = document.activeElement;

  // Ta bort eventuell redan öppen guide
  if (typeof document !== 'undefined') {
    // ...with its Escape listener (removing only the element left it behind)
    document.querySelectorAll('.qg-backdrop').forEach((el) => {
      try { el.__qgRemoveKeyListener?.(); } catch {}
      el.remove();
    });
  }

  let activeRole = GUIDES[initialRoleKey] ? initialRoleKey : 'dressage';
  const isEn = getPreferredLanguage() === 'en';
  const lang = isEn ? 'en' : 'sv';

  const backdrop = document.createElement('div');
  backdrop.className = 'qg-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-labelledby', 'qg-title');

  const drawer = document.createElement('div');
  drawer.className = 'qg-drawer';
  drawer.tabIndex = -1;

  function renderContent() {
    const guide = GUIDES[activeRole] || GUIDES['dressage'];
    const titleText = guide.title[lang] || guide.title.sv;
    const badgeText = guide.badge[lang] || guide.badge.sv;
    const stepsList = guide.steps[lang] || guide.steps.sv;
    const duringList = guide.during[lang] || guide.during.sv;
    const faqList = guide.troubleshooting[lang] || guide.troubleshooting.sv;
    const symbolsList = guide.symbols[lang] || guide.symbols.sv;

    const roleOptionsHtml = Object.keys(GUIDES).map((k) => {
      const g = GUIDES[k];
      const selected = k === activeRole ? 'selected' : '';
      return `<option value="${escapeHtml(k)}" ${selected}>${g.icon} ${escapeHtml(g.title[lang] || g.title.sv)}</option>`;
    }).join('');

    drawer.innerHTML = `
      <!-- TOPP-HEADER (Fast) -->
      <header class="p-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center justify-between gap-3 shrink-0">
        <div class="flex items-center gap-2.5 min-w-0">
          <span class="text-2xl">${guide.icon}</span>
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h2 id="qg-title" class="font-bold text-base md:text-lg text-gray-900 dark:text-white truncate leading-tight">${escapeHtml(titleText)}</h2>
              <span class="hidden sm:inline-block px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wider bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">${escapeHtml(badgeText)}</span>
            </div>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">${isEn ? '60-second in-field cheat sheet' : '60-sekunders lathund i fält'}</p>
          </div>
        </div>

        <div class="flex items-center gap-2 shrink-0 qg-no-print">
          <button
            type="button"
            id="qg-pdf-btn"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50 border border-blue-200 dark:border-blue-800 transition-colors shadow-sm"
            title="${isEn ? 'Create and download official A4 PDF cheat sheet' : 'Skapa och ladda ner officiell 1-sidig A4 PDF-lathund'}"
            aria-label="${isEn ? 'PDF Cheat Sheet' : 'PDF Lathund'}"
          >
            <span>📄</span>
            <span>${isEn ? 'PDF Cheat Sheet' : 'PDF Lathund'}</span>
          </button>
          <button
            type="button"
            id="qg-close-btn"
            class="p-2 rounded-lg text-2xl leading-none text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title="${isEn ? 'Close' : 'Stäng'}"
            aria-label="${isEn ? 'Close' : 'Stäng'}"
          >
            &times;
          </button>
        </div>
      </header>

      <!-- ROLL-VÄLJARE & SNABBVÄXLING (qg-no-print) -->
      <div class="px-4 py-2 bg-gray-50 dark:bg-gray-900/60 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between gap-2 shrink-0 qg-no-print">
        <label for="qg-role-select" class="text-xs font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap">
          ${isEn ? 'Switch role:' : 'Byt roll:'}
        </label>
        <select
          id="qg-role-select"
          class="text-xs font-medium py-1 px-2.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 max-w-[280px]"
        >
          ${roleOptionsHtml}
        </select>
      </div>

      <!-- SCROLLBART INNEHÅLL -->
      <div class="flex-1 overflow-y-auto p-4 md:p-6 space-y-5">
        
        <!-- 1. SNABBSTART (3 STEG) -->
        <section class="qg-card qg-highlight">
          <div class="flex items-center gap-2 mb-2">
            <span class="text-lg">🚀</span>
            <h3 class="font-bold text-sm uppercase tracking-wider text-blue-900 dark:text-blue-300">
              ${isEn ? 'Quick Start (3 Steps)' : 'Snabbstart (3 steg)'}
            </h3>
          </div>
          <ol class="space-y-2 text-xs md:text-sm text-gray-700 dark:text-gray-300 list-decimal list-inside pl-1 leading-relaxed">
            ${stepsList.map((st) => `<li>${st}</li>`).join('')}
          </ol>
        </section>

        <!-- 2. UNDER RITTEN / MOMENTET -->
        <section class="qg-card">
          <div class="flex items-center gap-2 mb-2">
            <span class="text-lg">⏱️</span>
            <h3 class="font-bold text-sm uppercase tracking-wider text-gray-900 dark:text-white">
              ${isEn ? 'During the Round' : 'Under ritten / momentet'}
            </h3>
          </div>
          <ul class="space-y-2 text-xs md:text-sm text-gray-700 dark:text-gray-300 list-disc list-inside pl-1 leading-relaxed">
            ${duringList.map((item) => `<li>${item}</li>`).join('')}
          </ul>
        </section>

        <!-- 3. FELSÖKNING & VANLIGA MISSTAG ("VAD GÖR JAG OM...") -->
        <section class="qg-card">
          <div class="flex items-center gap-2 mb-2">
            <span class="text-lg">🛠️</span>
            <h3 class="font-bold text-sm uppercase tracking-wider text-gray-900 dark:text-white">
              ${isEn ? 'Troubleshooting ("What if...")' : 'Felsökning ("Vad gör jag om...")'}
            </h3>
          </div>
          <div class="space-y-2.5">
            ${faqList.map((faq) => `
              <div class="p-2.5 rounded bg-white dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700/80">
                <div class="font-bold text-xs md:text-sm text-gray-900 dark:text-white mb-1 flex items-start gap-1.5">
                  <span class="text-amber-500 shrink-0">❓</span>
                  <span>${escapeHtml(faq.q)}</span>
                </div>
                <div class="text-xs text-gray-600 dark:text-gray-300 pl-5 leading-normal">
                  ${faq.a}
                </div>
              </div>
            `).join('')}
          </div>
        </section>

        <!-- 4. GENVÄGAR & SYMBOLER -->
        <section class="qg-card">
          <div class="flex items-center gap-2 mb-2">
            <span class="text-lg">⌨️</span>
            <h3 class="font-bold text-sm uppercase tracking-wider text-gray-900 dark:text-white">
              ${isEn ? 'Shortcuts & Symbols' : 'Genvägar & Symboler'}
            </h3>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            ${symbolsList.map((s) => `
              <div class="p-2 rounded bg-white dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700/80 flex items-center justify-between">
                <span class="font-bold text-gray-800 dark:text-gray-200">${escapeHtml(s.sym)}</span>
                <span class="text-gray-500 dark:text-gray-400 text-[11px] text-right">${escapeHtml(s.desc)}</span>
              </div>
            `).join('')}
          </div>
        </section>

        <!-- OFFLINE-TRYGGHET BANNER -->
        <section class="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 text-xs">
          <div class="flex items-center gap-2 font-bold mb-0.5">
            <span>🛡️</span>
            <span>${isEn ? 'Offline Queue Support' : 'Stöd för offlinekö'}</span>
          </div>
          <p class="leading-normal opacity-90">
            ${isEn
              ? 'In an already loaded input view, press Save and verify the local queue. Keep the tab open until the queue indicator is gone.'
              : 'I en redan laddad inmatningsvy: tryck på Spara och kontrollera den lokala kön. Håll fliken öppen tills köindikatorn är borta.'}
          </p>
        </section>

      </div>

      <!-- FOOTER MED MANUAL-LÄNK (qg-no-print) -->
      <footer class="p-3 md:p-4 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 flex items-center justify-between gap-3 shrink-0 qg-no-print">
        <a
          href="#manual"
          id="qg-open-full-manual"
          class="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1.5"
        >
          <span>📖</span>
          <span>${isEn ? 'Open Full Manual & Guidelines' : 'Öppna fullständiga manualen & reglemente'}</span>
        </a>

        <button
          type="button"
          id="qg-footer-close"
          class="px-4 py-2 text-xs font-bold rounded-lg bg-gray-200 dark:bg-gray-800 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-700 transition-colors"
        >
          ${isEn ? 'Close' : 'Stäng'}
        </button>
      </footer>
    `;

    // Knyt lokala lyssnare i drawern
    drawer.querySelector('#qg-close-btn')?.addEventListener('click', closeGuide);
    drawer.querySelector('#qg-footer-close')?.addEventListener('click', closeGuide);

    drawer.querySelector('#qg-open-full-manual')?.addEventListener('click', () => {
      closeGuide();
    });

    drawer.querySelector('#qg-pdf-btn')?.addEventListener('click', async () => {
      const btn = drawer.querySelector('#qg-pdf-btn');
      const originalHtml = btn?.innerHTML;
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span>⏳</span> <span>${isEn ? 'Creating PDF...' : 'Skapar PDF...'}</span>`;
      }
      try {
        const [{ generateQuickGuidePdf }, { getGlobalState }] = await Promise.all([
          import('../pdf/quickGuidePdf.js'),
          import('../main.js')
        ]);
        const comp = (typeof getGlobalState === 'function' ? getGlobalState('currentCompetition') : null)
          || (typeof window !== 'undefined' ? window.currentCompetition : null);
        await generateQuickGuidePdf(activeRole, comp);
      } catch (err) {
        console.error('Kunde inte skapa PDF-lathund:', err);
        alert(isEn ? 'Could not generate PDF cheat sheet.' : 'Kunde inte skapa PDF-lathund.');
      } finally {
        if (btn) {
          btn.innerHTML = originalHtml;
          btn.disabled = false;
        }
      }
    });

    drawer.querySelector('#qg-role-select')?.addEventListener('change', (e) => {
      activeRole = e.target.value;
      renderContent();
      drawer.querySelector('#qg-role-select')?.focus();
    });
  }

  renderContent();

  backdrop.appendChild(drawer);
  document.body.appendChild(backdrop);
  document.body.classList.add('qg-open');

  // Animera in
  requestAnimationFrame(() => {
    backdrop.classList.add('visible');
    drawer.querySelector('#qg-close-btn')?.focus();
  });

  let isClosing = false;

  function closeGuide() {
    if (isClosing) return;
    isClosing = true;
    removeKeyListeners();
    backdrop.classList.remove('visible');
    setTimeout(() => {
      try {
        backdrop.remove();
      } catch {}
      if (!document.querySelector('.qg-backdrop')) document.body.classList.remove('qg-open');
      if (previouslyFocusedElement?.isConnected && typeof previouslyFocusedElement.focus === 'function') {
        previouslyFocusedElement.focus();
      }
    }, 220);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeGuide();
      return;
    }

    if (e.key === 'Tab') {
      const focusable = Array.from(drawer.querySelectorAll(
        'a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter((element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true');

      if (focusable.length === 0) {
        e.preventDefault();
        drawer.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;

      if (e.shiftKey && (activeElement === first || !drawer.contains(activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (activeElement === last || !drawer.contains(activeElement))) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  // Keys must not reach the page behind the drawer (its arrow/1-4/Space shortcuts are
  // document/window bubble listeners). Keys inside the drawer stop at the backdrop so
  // the drawer's own controls still work; keys aimed elsewhere stop in the capture phase.
  function onDrawerKeyDown(e) {
    onKeyDown(e);
    e.stopPropagation();
  }
  function onOutsideKeyDown(e) {
    if (backdrop.contains(e.target)) return;
    onKeyDown(e);
    e.stopPropagation();
  }
  function removeKeyListeners() {
    backdrop.removeEventListener('keydown', onDrawerKeyDown);
    document.removeEventListener('keydown', onOutsideKeyDown, true);
  }
  backdrop.addEventListener('keydown', onDrawerKeyDown);
  document.addEventListener('keydown', onOutsideKeyDown, true);
  backdrop.__qgRemoveKeyListener = removeKeyListeners;

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      closeGuide();
    }
  });

  drawer.addEventListener('click', (e) => {
    e.stopPropagation();
  });
}

/**
 * Global klick-lyssnare: aktiveras automatiskt för alla element med `[data-guide-role]`.
 */
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-guide-role]');
    if (btn) {
      e.preventDefault();
      const role = btn.dataset.guideRole || 'dressage';
      openQuickGuide(role);
    }
  });
}

// Exponera på window för smidig integration och felsökning
if (typeof window !== 'undefined') {
  window.openQuickGuide = openQuickGuide;
  window.renderQuickGuideButton = renderQuickGuideButton;
}
