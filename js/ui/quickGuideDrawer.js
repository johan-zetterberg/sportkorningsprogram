// js/ui/quickGuideDrawer.js
// Kontextuell snabbhjälp och 60-sekunderslathundar för funktionärer och domare.

import { escapeHtml } from '../utils/sharedUtils.js';

// Rolldefinitioner med guider på både svenska och engelska
export const GUIDES = {
  'dressage': {
    title: { sv: 'Dressyr – Domare & Skrivare', en: 'Dressage – Judge & Scribe' },
    badge: { sv: 'Dressyrprotokoll', en: 'Dressage Protocol' },
    icon: '📝',
    steps: {
      sv: [
        'Välj din <strong>Domarposition</strong> (t.ex. C, B, E) och kontrollera att rätt namn visas.',
        'Välj <strong>Startnummer / Ekipage</strong> i sökfältet eller med pilarna. Kontrollera att rätt program laddas automatiskt.',
        'Börja döma när ekipaget hälsar och klockan ringer. Poäng registreras fortlöpande.'
      ],
      en: [
        'Select your <strong>Judge Position</strong> (e.g. C, B, E) and verify your name.',
        'Select <strong>Start Number / Equipage</strong>. Verify the correct test loads automatically.',
        'Start judging when the equipage enters and salutes. Enter marks continuously.'
      ]
    },
    during: {
      sv: [
        '<strong>Betyg 0–10:</strong> Skriv siffran direkt. Halva poäng är tillåtna (t.ex. 6, 6.5, 7.5).',
        '<strong>Tangentbordsgenvägar:</strong> Tryck <kbd class="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded border text-xs font-mono">Enter</kbd> för att hoppa till nästa rörelse. Tryck <kbd class="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded border text-xs font-mono">Tab</kbd> för att öppna och skriva kommentar för aktuell rörelse.',
        '<strong>Kommentarer:</strong> Klicka på <span class="text-blue-600 font-semibold">💬 Kom.</span> vid behov för att motivera poängen.',
        '<strong>Felridning / Avdrag:</strong> Klicka på knapparna för felridning (+2, +4 straff) eller fyll i övriga straff längst ner i protokollet.',
        '<strong>Autosparning:</strong> Resultatet sparas automatiskt i bakgrunden var 30:e sekund och vid varje ändring.',
        '<strong>Slutför:</strong> Klicka på <span class="bg-blue-600 text-white px-2 py-0.5 rounded text-xs font-bold">SPARA PROTOKOLL</span> när sista momentet är bedömt.'
      ],
      en: [
        '<strong>Marks 0–10:</strong> Type marks directly. Half points allowed (e.g. 6.5, 7.5).',
        '<strong>Keyboard navigation:</strong> Press <kbd class="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded border text-xs font-mono">Enter</kbd> to move to next movement. Press <kbd class="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded border text-xs font-mono">Tab</kbd> to jump to comments for the current movement.',
        '<strong>Comments:</strong> Click <span class="text-blue-600 font-semibold">💬 Remarks</span> to add explanatory notes.',
        '<strong>Errors of course:</strong> Click Error buttons (+2, +4 points) or enter manual penalty points at the bottom.',
        '<strong>Autosave:</strong> Progress is saved in the background every 30 seconds and on change.',
        '<strong>Finalize:</strong> Click <span class="bg-blue-600 text-white px-2 py-0.5 rounded text-xs font-bold">SAVE PROTOCOL</span> once the test is finished.'
      ]
    },
    troubleshooting: {
      sv: [
        {
          q: 'Kunde inte spara eller dålig mobiltäckning (Offline)?',
          a: '<strong>Systemet är offline-säkrat!</strong> Klicka på Spara som vanligt. Protokollet sparas tryggt i surfplattans minne och skickas in till sekretariatet i samma sekund som nätet återkommer. Håll bara koll på moln-ikonen.'
        },
        {
          q: 'Skrev fel poäng eller kommentar?',
          a: 'Klicka bara i rutan och ändra siffran direkt. Den nya poängen uppdateras omedelbart i sammanställningen.'
        },
        {
          q: 'Ekipaget utesluts eller utgår?',
          a: 'Kryssa i rutan "Utesluten" eller "Utgått" längst ner och klicka på Spara Protokoll.'
        },
        {
          q: 'Måste ändra ett redan sparat protokoll?',
          a: 'Sparade protokoll låses för säkerhets skull. Kontakta sekretariatet så låser de upp protokollet åt dig.'
        }
      ],
      en: [
        {
          q: 'Lost internet connection / Offline warning?',
          a: '<strong>The app works offline!</strong> Click Save as usual. All scores are safely stored locally in your device and automatically synced to the secretariat when connection restores.'
        },
        {
          q: 'Entered the wrong mark or remark?',
          a: 'Click into the field and edit it directly. The summary updates immediately.'
        },
        {
          q: 'Equipage eliminated or retired?',
          a: 'Check the "Eliminated" or "Retired" checkbox at the bottom and click Save.'
        },
        {
          q: 'Need to edit an already saved protocol?',
          a: 'Saved protocols are locked against accidental changes. Contact the secretariat to unlock it.'
        }
      ]
    },
    symbols: {
      sv: [
        { sym: '⌨️ Enter', desc: 'Hoppa till nästa rörelse' },
        { sym: '⌨️ Tab', desc: 'Öppna och skriv kommentar' },
        { sym: '☁️ Bock', desc: 'Synkad med servern' },
        { sym: '☁️ Siffra', desc: 'Sparad lokalt (köad offline)' },
        { sym: '🟢 Grön', desc: 'Godkänt / klart' }
      ],
      en: [
        { sym: '⌨️ Enter', desc: 'Jump to next movement' },
        { sym: '⌨️ Tab', desc: 'Open and type comment' },
        { sym: '☁️ Check', desc: 'Synced with server' },
        { sym: '☁️ Count', desc: 'Stored locally in offline queue' },
        { sym: '🟢 Green', desc: 'Completed and verified' }
      ]
    }
  },

  'marathon-obstacle': {
    title: { sv: 'Maraton – Hinderdomare', en: 'Marathon – Obstacle Judge' },
    badge: { sv: 'Hinderinmatning', en: 'Obstacle Input' },
    icon: '🚩',
    steps: {
      sv: [
        'Välj ditt <strong>Hinder nr</strong> i listan (det hinder du är placerad vid).',
        'Välj <strong>Startnummer / Ekipage</strong> när ekipaget närmar sig hindret.',
        'Stå redo med blicken på de röda och vita startflaggorna.'
      ],
      en: [
        'Select your <strong>Obstacle number</strong> in the dropdown.',
        'Select the <strong>Start Number / Equipage</strong> as they approach the obstacle.',
        'Stand ready watching the red/white entry flags.'
      ]
    },
    during: {
      sv: [
        '<strong>Starta klockan:</strong> Tryck på <span class="bg-green-600 text-white px-2 py-0.5 rounded text-xs font-bold">START</span> exakt när första hästens nos skär linjen mellan startflaggorna.',
        '<strong>Portmarkering (A, B, C...):</strong> Klicka på respektive portknapp när porten passeras för att verifiera korrekt körväg.',
        '<strong>Rivningar (Bollar):</strong> Om en boll trillar av en port, klicka på porten eller öka antalet rivningar (+2 sekunder per boll).',
        '<strong>Stoppa klockan:</strong> Tryck på <span class="bg-red-600 text-white px-2 py-0.5 rounded text-xs font-bold">STOPP</span> exakt när ekipaget passerar ut mellan de röda och vita målflaggorna.',
        '<strong>Uppehåll i hinder:</strong> Om ekipaget tvingas stanna på grund av hinderblockering eller tekniskt fel: Klicka på Uppehåll, ange sekunder och orsak. Tiden dras då av från sträcktiden.',
        '<strong>Spara:</strong> Klicka på <span class="bg-blue-900 text-white px-2 py-0.5 rounded text-xs font-bold">SPARA RESULTAT</span>.'
      ],
      en: [
        '<strong>Start clock:</strong> Press <span class="bg-green-600 text-white px-2 py-0.5 rounded text-xs font-bold">START</span> the instant the first horse\'s nose crosses the entry flags.',
        '<strong>Gate tracking (A, B, C...):</strong> Tap gate buttons as they are negotiated to track the correct route.',
        '<strong>Knockdowns (Balls):</strong> If a ball falls, tap the gate or increment balls (+2 seconds penalty per ball).',
        '<strong>Stop clock:</strong> Press <span class="bg-red-600 text-white px-2 py-0.5 rounded text-xs font-bold">STOP</span> the instant the turnout crosses the exit flags.',
        '<strong>Hold time / Delay:</strong> If held by officials or obstruction, record hold time in seconds and enter note. This time is deducted from Phase B.',
        '<strong>Save:</strong> Click <span class="bg-blue-900 text-white px-2 py-0.5 rounded text-xs font-bold">SAVE RESULT</span>.'
      ]
    },
    troubleshooting: {
      sv: [
        {
          q: 'Klockan startades för tidigt eller för sent?',
          a: 'Klicka direkt på tidssiffrorna på skärmen för att öppna den manuella tidsredigeraren. Där kan du korrigera tiden exakt.'
        },
        {
          q: 'Råkade klicka på fel port eller fel rivning?',
          a: 'Klicka bara på knappen en gång till för att avmarkera och nollställa.'
        },
        {
          q: 'Dålig täckning / Mobilnätet svajar ute i skogen?',
          a: '<strong>Ingen fara!</strong> Klicka på Spara som vanligt. Resultatet sparas säkert i surfplattan och skickas automatiskt in till sekretariatet så fort nätkontakten återfås.'
        },
        {
          q: 'Ekipaget kör fel väg eller välter?',
          a: 'Markera "Eliminerad" med kryssrutan, skriv en kort förklarande kommentar och klicka på Spara.'
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
          q: 'Accidentally tapped the wrong gate or knockdown?',
          a: 'Tap the button once more to toggle and clear it.'
        },
        {
          q: 'Poor mobile coverage in the woods?',
          a: '<strong>Do not worry!</strong> Tap Save as usual. Results are stored locally and will synchronize automatically once connectivity returns.'
        },
        {
          q: 'Turnout goes wrong course or overturns?',
          a: 'Check "Eliminated", write a concise remark, and save.'
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
        { sym: '⚪ Port A–F', desc: 'Grön = passerad, Röd = rivning' },
        { sym: '⏱️ Tidsjustering', desc: 'Klicka på siffrorna för manuell tid' }
      ],
      en: [
        { sym: '🟢 START', desc: 'Crossing entry flags' },
        { sym: '🔴 STOP', desc: 'Crossing exit flags' },
        { sym: '⚪ Gate A–F', desc: 'Green = cleared, Red = knockdown' },
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
        'Välj aktiv **Etapp** i flikarna (Warmup, Sträcka A, Transfer eller Sträcka B).',
        'Välj **Startnummer / Ekipage** i rullistan när ekipaget närmar sig tidskontrollen.',
        'Kontrollera ekipagets idealtid och tidsfönster (min/max) på skärmen.'
      ],
      en: [
        'Select active **Phase** in tabs (Warmup, Section A, Transfer or Section B).',
        'Select **Start Number / Equipage** as turnout approaches the timing station.',
        'Check time window (min/optimum/max) displayed on screen.'
      ]
    },
    during: {
      sv: [
        '<strong>Tidtagning vid passage:</strong> Klicka på klock-ikonen vid Start eller Mål exakt när ekipaget passerar tidskontrollen.',
        '<strong>Automatisk beräkning:</strong> Systemet räknar automatiskt ut förfluten tid och eventuella tidsstraff mot gällande tidsfönster.',
        '<strong>Manuell tidsinmatning:</strong> Om officiellt tidtagarur eller tidrapport används: Klicka på tidsfältet och skriv in klockslaget (TT:MM:SS) manuellt.',
        '<strong>Aktiva ekipage:</strong> Fäll ut listan "Aktiva ekipage" för att se vilka som befinner sig på sträckan just nu.',
        '<strong>Nödstopp / Banpaus:</strong> Om en olycka sker på sträckan, fäll ut Nöd-paus och aktivera tävlingspaus. Alla domare och sekretariatet meddelas omedelbart.'
      ],
      en: [
        '<strong>Passage timing:</strong> Tap the clock icon at Start or Finish the moment the equipage passes.',
        '<strong>Automatic calculation:</strong> Elapsed time and penalties are computed automatically according to rules ledger.',
        '<strong>Manual entry:</strong> If using physical timing logs: Tap the time box and enter official time (HH:MM:SS).',
        '<strong>Active turnouts:</strong> Expand "Active Timers" to monitor all equipages currently on the phase.',
        '<strong>Emergency pause:</strong> In case of accident or blocked track, activate Global Emergency Pause to freeze timing across all stations.'
      ]
    },
    troubleshooting: {
      sv: [
        {
          q: 'Tiden registrerades vid fel klockslag?',
          a: 'Klicka på tidsrutan och välj "Redigera tid". Skriv in rätt klockslag och bekräfta.'
        },
        {
          q: 'Kusken körde för fort eller för långsamt?',
          a: 'Systemet lägger automatiskt på 0.25 straffpoäng per påbörjad sekund utanför tidsfönstret. Om maxtiden överskridits flaggas ekipaget som uteslutet.'
        },
        {
          q: 'Offline vid mål A eller start B?',
          a: 'Alla tider sparas säkert lokalt i surfplattan och synkroniseras mot sekretariatet så fort nätverket är tillbaka.'
        }
      ],
      en: [
        {
          q: 'Time was recorded incorrectly?',
          a: 'Tap the time box, choose "Edit time", enter the correct timestamp and confirm.'
        },
        {
          q: 'Equipage outside the time window?',
          a: 'The engine automatically adds 0.25 penalty per second outside window. Exceeding time limit triggers elimination warning.'
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
        { sym: '⚠️ Röd tid', desc: 'Överskriden maxtid (uteslutning)' },
        { sym: '🟡 Gul tid', desc: 'Utanför tidsfönster (straff)' },
        { sym: '🚨 Nödpaus', desc: 'Stoppar tid för alla på sträckan' }
      ],
      en: [
        { sym: '🟢 Clock', desc: 'Stamp time at passage' },
        { sym: '⚠️ Red time', desc: 'Over time limit (elimination)' },
        { sym: '🟡 Yellow time', desc: 'Outside time window (penalties)' },
        { sym: '🚨 Pause', desc: 'Global race hold for all drivers' }
      ]
    }
  },

  'precision': {
    title: { sv: 'Precision – Tidtagare & Banpersonal', en: 'Precision – Timer & Ring Official' },
    badge: { sv: 'Precisionsinmatning', en: 'Precision Input' },
    icon: '🎯',
    steps: {
      sv: [
        'Välj **Startnummer / Ekipage** i rullistan eller med pilarna.',
        'Kontrollera klassens **Tillåtna tid** och **Maxtid** som visas under timern.',
        'Stå redo med blicken på startlinjen.'
      ],
      en: [
        'Select **Start Number / Equipage** from dropdown or with arrow keys.',
        'Check **Time Allowed** and **Time Limit** shown below the timer.',
        'Watch the entry gates ready to start.'
      ]
    },
    during: {
      sv: [
        '<strong>Start:</strong> Klicka på <span class="bg-emerald-600 text-white px-2 py-0.5 rounded text-xs font-bold">START</span> (eller tryck <kbd class="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded border text-xs">Mellanslag</kbd>) när ekipaget korsar startlinjen.',
        '<strong>Rivningar (Bollar):</strong> Klicka på motsvarande portknapp (t.ex. 1, 4, 12A) så fort en boll trillar. Knappen blir röd och 3 straff läggs till direkt. Klicka igen om bollen dömdes fel för att ångra.',
        '<strong>Målgång:</strong> Klicka på <span class="bg-red-600 text-white px-2 py-0.5 rounded text-xs font-bold">STOPP</span> (eller tryck <kbd class="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded border text-xs">Mellanslag</kbd>) när ekipaget skär mållinjen.',
        '<strong>Övriga straff:</strong> Ange eventuella straff (t.ex. 5 straff för groom avstigen) i fältet "Övriga straff".',
        '<strong>Spara:</strong> Klicka på <span class="bg-blue-600 text-white px-2 py-0.5 rounded text-xs font-bold">SPARA RESULTAT</span>.'
      ],
      en: [
        '<strong>Start:</strong> Press <span class="bg-emerald-600 text-white px-2 py-0.5 rounded text-xs font-bold">START</span> (or press <kbd class="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded border text-xs">Space</kbd>) when crossing the start line.',
        '<strong>Knockdowns:</strong> Tap the gate button (e.g. 1, 4, 12A) immediately when a ball falls. Button turns red (+3 penalties). Tap again to toggle/undo.',
        '<strong>Finish:</strong> Press <span class="bg-red-600 text-white px-2 py-0.5 rounded text-xs font-bold">STOP</span> (or press <kbd class="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded border text-xs">Space</kbd>) when crossing finish line.',
        '<strong>Other penalties:</strong> Enter additional penalties (e.g. groom dismounting, 5 pts) in "Other Penalties".',
        '<strong>Save:</strong> Click <span class="bg-blue-600 text-white px-2 py-0.5 rounded text-xs font-bold">SAVE RESULT</span>.'
      ]
    },
    troubleshooting: {
      sv: [
        {
          q: 'Tiden överskred tillåten tid?',
          a: 'Klockan skiftar färg och tidsstraff beräknas automatiskt (1 straffpoäng per påbörjad sekund över tillåten tid enligt TR V).'
        },
        {
          q: 'Klockan överskred maxtiden?',
          a: 'Systemet varnar automatiskt för uteslutning (dubbla tillåtna tiden).'
        },
        {
          q: 'Missade att trycka Start eller manuell klocka användes?',
          a: 'Klicka direkt på de stora tidssiffrorna på skärmen för att skriva in den manuella tiden i formatet MMSSCC.'
        },
        {
          q: 'Offline i ridhuset / på banan?',
          a: 'Klicka Spara som vanligt. Resultatet sparas tryggt i enheten och laddas upp automatiskt till sekretariatet så fort nätverket nås.'
        }
      ],
      en: [
        {
          q: 'Time exceeded Time Allowed?',
          a: 'Timer highlights and time penalty is calculated automatically (1 penalty per started second over Time Allowed).'
        },
        {
          q: 'Time exceeded Time Limit?',
          a: 'System flags elimination (exceeding double Time Allowed).'
        },
        {
          q: 'Missed start click or used stopwatch?',
          a: 'Tap the large timer digits on screen to manually type time in MMSSCC format.'
        },
        {
          q: 'Offline in arena?',
          a: 'Save normally. All records queue locally and upload when online.'
        }
      ]
    },
    symbols: {
      sv: [
        { sym: '⌨️ Mellanslag', desc: 'Starta / Stoppa klockan' },
        { sym: '🔴 Röd port', desc: 'Rivning registrerad (+3 straff)' },
        { sym: '⏱️ Klicka tid', desc: 'Öppna manuell tidsinmatning' },
        { sym: '🔄 Återställ', desc: 'Nollställ klocka och rivningar' }
      ],
      en: [
        { sym: '⌨️ Spacebar', desc: 'Start / Stop timer' },
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
        'Välj **Startnummer / Ekipage** när du ser ekipaget närma sig din observationspost.',
        'Håll uppsikt över föreskriven gångart (t.ex. skritt på skrittsträcka).',
        'Var beredd att agera vid otillåten hjälp, galopp eller otillåtna halter.'
      ],
      en: [
        'Select **Start Number / Equipage** as they approach your observation post.',
        'Monitor prescribed gait (e.g. walk on walk section).',
        'Watch for unauthorized assistance, canter in walk, or unauthorized halts.'
      ]
    },
    during: {
      sv: [
        '<strong>Fel gångart (Galopp i skritt):</strong> Klicka på START vid första galoppsprånget. Klicka på STOPP när hästen skrittar igen. Sekunderna räknas ihop automatiskt.',
        '<strong>Otillåten halt:</strong> Klicka START när ekipaget stannar olovligen och STOPP när det rör sig framåt igen.',
        '<strong>Noteringar / Kommentarer:</strong> Skriv en kort förklaring vid behov (t.ex. "Galopp ca 15 m").',
        '<strong>Nödstopp (Global Paus):</strong> Vid allvarlig incident eller blockerat spår: Klicka på den röda knappen **NÖD-PAUS**. Detta fryser officiell tid för hela sträckan och larmar funktionärer omedelbart.'
      ],
      en: [
        '<strong>Wrong gait (Canter in walk):</strong> Click START on first canter stride. Click STOP when back to walk. Seconds accumulate automatically.',
        '<strong>Unauthorized halt:</strong> Click START on halt and STOP when moving forward.',
        '<strong>Remarks:</strong> Type explanatory notes (e.g. "Cantered approx 15 m").',
        '<strong>Emergency pause:</strong> If track is blocked or in an emergency, hit **EMERGENCY PAUSE** to freeze race clocks and alert officials.'
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
          a: 'Click stop and remove the mistaken entry from the log list.'
        },
        {
          q: 'Poor cell coverage?',
          a: 'Log entries buffer locally and submit automatically when connection is restored.'
        }
      ]
    },
    symbols: {
      sv: [
        { sym: '🚨 Nöd-Paus', desc: 'Pausar tidtagning för alla ekipage' },
        { sym: '🐎 Gångart', desc: 'Mäter sekunder i otillåten gångart' },
        { sym: '🛑 Halt', desc: 'Registrerar otillåten stillastående tid' }
      ],
      en: [
        { sym: '🚨 Emergency', desc: 'Freezes timing for all equipages' },
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
        'Sök upp **Startnummer / Ekipage / Häst** i sökfältet.',
        'Kontrollera chipnummer och passuppgifter mot skärmen vid behov.',
        'Genomför besiktningen tillsammans med tävlingsveterinären.'
      ],
      en: [
        'Search **Start Number / Equipage / Horse** in search box.',
        'Verify microchip and passport details if requested.',
        'Conduct inspection with treating/official veterinarian.'
      ]
    },
    during: {
      sv: [
        '🟢 **Godkänd:** Hästen är i fullgott skick och godkänd för start.',
        '🟡 **Holding Box (Återbesiktning):** Hästen skickas till Holding Box för fördjupad kontroll före slutligt beslut.',
        '🔴 **Ej godkänd / Struken:** Hästen får ej starta.',
        '<strong>Puls & Noteringar:</strong> Fyll i uppmätt puls samt eventuella sår eller kommentarer.',
        'Klicka på **SPARA BEDÖMNING**.'
      ],
      en: [
        '🟢 **Passed:** Fit to compete.',
        '🟡 **Holding Box:** Referred for re-inspection before final verdict.',
        '🔴 **Not fit / Withdrawn:** Not permitted to start.',
        '<strong>Heart rate & Remarks:</strong> Record measured pulse and any skin lesions/notes.',
        'Click **SAVE EVALUATION**.'
      ]
    },
    troubleshooting: {
      sv: [
        {
          q: 'Status ändrades efter ombesiktning?',
          a: 'Öppna samma häst igen, ändra status till Godkänd (eller Struken) och spara på nytt.'
        },
        {
          q: 'Offline vid stallarna?',
          a: 'Besiktningsprotokollet sparas lokalt och laddas upp till sekretariatet så fort nätverket återfås.'
        }
      ],
      en: [
        {
          q: 'Status updated after holding box?',
          a: 'Open the equipage again, update status to Passed (or Not Fit) and save.'
        },
        {
          q: 'Offline near stables?',
          a: 'Results are stored offline and synchronize automatically.'
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
        '<strong>Realtidsöversikt:</strong> Gula rader visar pågående eller oavslutade ritter; gröna rader är klara.',
        '<strong>Granskning före finalisering:</strong> Kontrollera att alla domarbetyg och etapptider inkommit innan knappen "Finalisera" klickas.',
        '<strong>Lås upp vid protest / korrigering:</strong> Om ett domarprotokoll behöver korrigeras, lås upp raden, gör ändringen tillsammans med överdomaren och spara om.',
        '<strong>PDF & Utskrift:</strong> Skapa officiella resultatlistor, protokoll och speakerunderlag via Rapportcenter.'
      ],
      en: [
        '<strong>Live Overview:</strong> Yellow rows indicate in-progress or unfinalized entries; green rows are finalized.',
        '<strong>Review before finalizing:</strong> Verify that all judges and timing points reported in before finalizing.',
        '<strong>Unlock on query / protest:</strong> If correction is required, unlock the record, update with Ground Jury and re-save.',
        '<strong>PDF & Printouts:</strong> Generate signed official result sheets and speaker dashboards via Report Center.'
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
    @media print {
      body * {
        visibility: hidden !important;
      }
      .qg-backdrop,
      .qg-drawer,
      .qg-drawer * {
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
            <span>${isEn ? 'Offline-Protected System' : 'Offline-säkrat system'}</span>
          </div>
          <p class="leading-normal opacity-90">
            ${isEn
              ? 'All entries are safely backed up inside your device\'s local storage. You do not need to wait for internet to hit Save!'
              : 'Alla inmatningar och sparningar köas och skyddas tryggt i enhetens lokala minne. Du behöver aldrig vänta med att trycka på Spara!'}
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
    });
  }

  renderContent();

  backdrop.appendChild(drawer);
  document.body.appendChild(backdrop);

  // Animera in
  requestAnimationFrame(() => {
    backdrop.classList.add('visible');
  });

  function closeGuide() {
    document.removeEventListener('keydown', onKeyDown);
    backdrop.classList.remove('visible');
    setTimeout(() => {
      try {
        backdrop.remove();
      } catch {}
    }, 220);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      closeGuide();
    }
  }

  document.addEventListener('keydown', onKeyDown);
  backdrop.__qgRemoveKeyListener = () => document.removeEventListener('keydown', onKeyDown);

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
