import { isMobile } from '../utils/sharedUtils.js';

let activeTab = 'admin'; // 'admin', 'official', 'judge', 'driver'

export async function load(container) {
  if (!container) return;
  render(container);
}

function render(container) {
  const lang = localStorage.getItem('user_lang_pref') || 'sv';
  const isEn = lang === 'en';

  const ui = {
    title: isEn ? 'User Manual' : 'Användarmanual',
    sub: isEn ? 'Select your role below to see instructions and guides.' : 'Välj din roll nedan för att se instruktioner och guider.',
    tabs: {
      overview: isEn ? 'Overview' : 'Översikt',
      admin: isEn ? 'Admin' : 'Administratör',
      official: isEn ? 'Official' : 'Funktionär',
      judge: isEn ? 'Judge' : 'Domare',
      driver: isEn ? 'Driver' : 'Kusk/Deltagare',
      speaker: 'Speaker', // Same
      secretary: isEn ? 'Secretariat' : 'Sekretariat',
      tech: isEn ? 'Tech/Support' : 'Teknik/Support',
      observer: isEn ? 'Observer' : 'Observatör'
    }
  };

  const content = `
    <div class="max-w-4xl mx-auto px-4 py-6">
      <h1 class="text-2xl font-bold mb-4 text-gray-800">${ui.title}</h1>
      <p class="text-gray-600 mb-6">${ui.sub}</p>

      <!-- TABS -->
      <div class="flex flex-wrap gap-2 mb-6 border-b border-gray-200 pb-2 overflow-x-auto whitespace-nowrap scrollbar-hide">
        ${renderTabBtn('overview', ui.tabs.overview)}
        ${renderTabBtn('admin', ui.tabs.admin)}
        ${renderTabBtn('official', ui.tabs.official)}
        ${renderTabBtn('judge', ui.tabs.judge)}
        ${renderTabBtn('driver', ui.tabs.driver)}
        ${renderTabBtn('speaker', ui.tabs.speaker)}
        ${renderTabBtn('secretary', ui.tabs.secretary)}
        ${renderTabBtn('tech', ui.tabs.tech)}
        ${renderTabBtn('observer', ui.tabs.observer)}
      </div>

      <!-- CONTENT AREA -->
      <div class="bg-white rounded-lg shadow p-6 min-h-[400px]">
        ${getTabContent(activeTab)}
      </div>
    </div>
  `;

  container.innerHTML = content;

  // Add listeners
  document.querySelectorAll('.manual-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      activeTab = e.target.dataset.tab;
      render(container);
    });
  });
}

function renderTabBtn(id, label) {
  const active = activeTab === id;
  const classes = active
    ? 'bg-blue-600 text-white shadow-sm ring-1 ring-blue-700'
    : 'bg-gray-100 text-gray-700 hover:bg-gray-200';

  return `<button class="manual-tab-btn px-4 py-2 rounded-full text-sm font-medium transition-colors ${classes}" data-tab="${id}">
    ${label}
  </button>`;
}

function getTabContent(tab) {
  const lang = localStorage.getItem('user_lang_pref') || 'sv';
  if (lang === 'en') {
    return getTabContentEN(tab);
  }

  switch (tab) {
    case 'tech':
      return `
        <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">Teknik & Support</h2>
        <div class="space-y-8">
            
            <section>
                <h3 class="font-bold text-lg mb-2 text-cyan-700 border-l-4 border-cyan-500 pl-2">Installera som App</h3>
                <p class="text-gray-700 mb-2">För bästa prestanda och stabilitet bör du lägga till systemet på hemskärmen.</p>
                <div class="grid md:grid-cols-2 gap-4">
                    <div class="bg-gray-50 p-4 rounded border">
                        <strong class="block mb-2">🍏 iPad / iPhone (Safari)</strong>
                        <ol class="list-decimal list-inside text-sm text-gray-700 space-y-1">
                            <li>Tryck på <strong>Dela-knappen</strong> (fyrkant med pil uppåt).</li>
                            <li>Scrolla ner och välj <strong>"Lägg till på hemskärmen"</strong>.</li>
                            <li>Bekräfta med "Lägg till".</li>
                        </ol>
                    </div>
                    <div class="bg-gray-50 p-4 rounded border">
                        <strong class="block mb-2">🤖 Android (Chrome)</strong>
                        <ol class="list-decimal list-inside text-sm text-gray-700 space-y-1">
                            <li>Tryck på menyn (tre prickar).</li>
                            <li>Välj <strong>"Installera app"</strong> eller "Lägg till på hemskärmen".</li>
                            <li>Följ instruktionerna.</li>
                        </ol>
                    </div>
                </div>
            </section>

             <section>
                <h3 class="font-bold text-lg mb-2 text-orange-700 border-l-4 border-orange-500 pl-2">Offline-läge (Utan Internet)</h3>
                <div class="bg-orange-50 p-4 rounded-lg border border-orange-200">
                    <p class="text-gray-700 mb-2">
                        Systemet är byggt för att klara svajigt internet ute på fältet.
                    </p>
                    <ul class="list-disc list-inside text-sm text-gray-700 space-y-2">
                        <li><strong>Du kan fortsätta mata in tider/resultat även om du tappar täckning.</strong></li>
                        <li>Datat sparas lokalt ("I kön") och skickas automatiskt när internet kommer tillbaka.</li>
                        <li class="font-bold text-red-600">VIKTIGT: Stäng INTE webbläsarfliken om du är offline! Då kan icke-sparad data gå förlorad.</li>
                    </ul>
                </div>
            </section>

             <section>
                <h3 class="font-bold text-lg mb-2 text-green-700 border-l-4 border-green-500 pl-2">Batteri & Skärmlås</h3>
                <div class="bg-green-50 p-4 rounded-lg border border-green-200">
                    <p class="text-gray-700 mb-2">
                        Systemet håller automatiskt din skärm vaken ("Wake Lock") när du är inne på sidor för tidtagning eller dömning.
                    </p>
                    <ul class="list-disc list-inside text-sm text-gray-700 space-y-1">
                        <li>Du behöver inte ändra telefonens inställningar för skärmtid.</li>
                        <li><strong>Tips:</strong> Ha gärna en Powerbank till hands om du ska stå ute hela dagen, då skärmen drar batteri.</li>
                    </ul>
                </div>
            </section>

             <section>
                <h3 class="font-bold text-lg mb-2 text-gray-700 border-l-4 border-gray-500 pl-2">Felsökning</h3>
                <ul class="list-disc list-inside text-sm text-gray-700 space-y-1">
                   <li><strong>"Sidan ser konstig ut":</strong> Prova att ladda om sidan (dra neråt eller tryck F5).</li>
                   <li><strong>"Inget händer när jag klickar":</strong> Kontrollera din internetuppkoppling. Syns en "Offline"-symbol?</li>
                   <li><strong>Synk-kö (Moln-ikonen):</strong>
                       <ul class="list-circle list-inside ml-4 mt-1 text-xs">
                           <li><span class="text-green-600">Grön:</span> Allt är sparat i molnet.</li>
                           <li><span class="text-amber-500">Gul (Puls):</span> Sparar just nu... (Vänta tills den blir grön).</li>
                           <li><span class="text-red-500">Röd/Streckad:</span> Offline. Datan sparas lokalt och skickas senare.</li>
                       </ul>
                   </li>
                </ul>
            </section>

        </div>
            `;

    case 'secretary':
      return `
        <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">För Sekretariatet</h2>
        <div class="space-y-8">
            
            <section>
                <h3 class="font-bold text-lg mb-2 text-blue-700 border-l-4 border-blue-500 pl-2">Rapportcenter (Listor)</h3>
                <p class="text-gray-700 mb-2">Här genererar du alla PDF-filer för utskrift och webbpublicering.</p>
                <div class="bg-blue-50 p-4 rounded-lg space-y-2">
                    <ul class="list-disc list-inside text-sm text-gray-700">
                        <li><strong>Startlistor:</strong> Skapas per gren (Dressyr, Maraton, Precision). Systemet sorterar automatiskt på starttid.</li>
                        <li><strong>Funktionärslistor (Nytt!):</strong>
                            <ul class="list-circle list-inside ml-4 text-xs mt-1 space-y-1">
                                <li><strong>Maraton Tider:</strong> Tidslinje med beräknade tider för Start A, Mål A, Start B etc. (Kräver att starttider och sträckor är inställda).</li>
                                <li><strong>Maraton Hinder:</strong> Lista för hinderdomare. Inkluderar beräknad starttid för B-sträckan.</li>
                                <li><strong>Dressyr:</strong> Startordning med program och häst för scribes/ringmaster.</li>
                            </ul>
                            <p class="text-[10px] text-blue-800 mt-1"><em>* Strukna ekipage filtreras automatiskt bort från dessa listor.</em></p>
                        </li>
                        <li><strong>Resultatlistor:</strong> Resultat räknas ut live. Du behöver inte "räkna" något manuellt.</li>
                        <li><strong>CSV-export:</strong> Använd knapparna "CSV" för att få ut rådata till Excel om du behöver göra egna analyser.</li>
                    </ul>
                     <p class="text-xs text-blue-900 mt-2 font-bold">
                        Tips: Använd "Filtrera på klass" högst upp för att skriva ut listor för en klass i taget.
                     </p>
                </div>
            </section>

            <section>
                <h3 class="font-bold text-lg mb-2 text-yellow-700 border-l-4 border-yellow-500 pl-2">Prisutdelning</h3>
                <p class="text-gray-700 mb-2">En vy speciellt anpassad för prisutdelaren eller speakern vid ceremonin.</p>
                
                <div class="bg-white border rounded p-4 shadow-sm">
                    <h4 class="font-bold text-gray-800 mb-2">Funktioner:</h4>
                    <ol class="list-decimal list-inside text-sm text-gray-700 space-y-2">
                        <li><strong>Podium-vy:</strong> De 3 främsta presenteras med stora kort.</li>
                        <li><strong>"På plats"-kryssrutan:</strong> 
                            <span class="block ml-5 text-gray-600">Klicka i rutan "PÅ PLATS" när kusken anländer till prisutdelningen. Detta hjälper er se vilka som saknas innan ceremonin startar.</span>
                        </li>
                    </ol>
                </div>
            </section>

             <section>
                <h3 class="font-bold text-lg mb-2 text-indigo-700 border-l-4 border-indigo-500 pl-2">📺 Publikskärmar (Monitors)</h3>
                <p class="text-gray-700 mb-2">
                    Systemet har tre speciella "Monitor"-sidor som är designade för att visas på stora TV-skärmar i cafeterian eller publikområdet.
                    Dessa sidor roterar automatiskt innehåll och visar alltid det senaste.
                </p>
                <div class="bg-indigo-50 p-4 rounded-lg border border-indigo-200">
                    <ul class="list-disc list-inside text-sm text-gray-700 space-y-2">
                        <li><strong>Monitor Dressyr:</strong> Visar pågående ekipage, aktuella poäng och en rullande resultatlista.</li>
                        <li><strong>Monitor Maraton:</strong> Visar en karta med liverapportering från hindren. Publikfavorit!</li>
                        <li><strong>Monitor Precision:</strong> Visar tid, fel och <strong>Maximaltid</strong> (gräns för uteslutning) direkt vid målgång.</li>
                    </ul>
                    <p class="text-xs text-indigo-800 mt-2 font-bold">
                        Tips: Koppla in en dator/iPad till TV:n och navigera till respektive sida via huvudmenyn. Tryck F11 för helskärm!
                    </p>
                </div>
            </section>
        </div>
            `;

    case 'overview':
      return `
        <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">Översikt</h2>
        <div class="space-y-8">
            <section>
                <div class="bg-gradient-to-r from-blue-50 to-indigo-50 p-6 rounded-xl border border-blue-100 text-center relative overflow-hidden">
                    <div class="absolute top-2 right-2 opacity-10">
                        <span class="text-6xl">🌍</span>
                    </div>
                    <h3 class="text-2xl font-bold text-blue-900 mb-2">Välkommen till Tävlingssystemet!</h3>
                    <p class="text-gray-700 max-w-2xl mx-auto mb-4">
                        Detta är ett heltäckande system för att hantera sportkörningstävlingar – från anmälan till slutresultat.
                        Systemet är <strong>molnbaserat</strong> vilket innebär att alla ändringar sker i realtid ("Live").
                    </p>
                    <div class="inline-flex items-center gap-2 bg-white px-3 py-1 rounded-full border border-blue-200 text-sm text-blue-800 shadow-sm">
                        <span>💡 Tips: Byt språk (🇸🇪/🇬🇧) på flaggan. Använd månen 🌙 i menyn för Mörkt Läge.</span>
                    </div>
                </div>
            </section>

            <section>
                <h3 class="font-bold text-lg mb-2 text-indigo-700 border-l-4 border-indigo-500 pl-2">🏠 Huvudmenyn & Navigering</h3>
                <p class="text-gray-700 mb-2">
                    När du startar systemet hamnar du i <strong>Hubben</strong>. Här ser du en lista över alla tillgängliga tävlingar.
                </p>
                <div class="grid md:grid-cols-2 gap-4">
                    <div class="bg-white p-4 rounded border shadow-sm">
                        <h4 class="font-bold text-gray-800 mb-1">Hitta din tävling</h4>
                        <ul class="list-disc list-inside text-sm text-gray-600 space-y-1">
                            <li>Använd <strong>Sök-rutan</strong> för att filtrera på namn eller plats.</li>
                            <li>Klicka på kortet för att öppna tävlingen.</li>
                            <li>Knappen <strong>"Öppna"</strong> går till publik/deltagarvyn.</li>
                            <li>Knappen <strong>"Admin"</strong> (om du är behörig) går till administrationsvyn.</li>
                        </ul>
                    </div>
                    <div class="bg-white p-4 rounded border shadow-sm">
                        <h4 class="font-bold text-gray-800 mb-1">Tips & Tricks</h4>
                        <ul class="list-disc list-inside text-sm text-gray-600 space-y-1">
                            <li><strong>Gå tillbaka:</strong> Klicka alltid på loggan (längst upp till vänster) för att återgå till Hubben och byta tävling.</li>
                            <li><strong>Skapa Nytt:</strong> (Endast Admin) Använd formuläret i Hubben för att starta en ny tävling.</li>
                            <li><strong>Uppdatera:</strong> Systemet är "Live". Du behöver sällan ladda om sidan manuellt.</li>
                            <li><strong>Mobilanpassning:</strong> På små skärmar blir filter-knapparna (t.ex. "Klass") automatiskt en rullgardinsmeny för att spara plats.</li>
                        </ul>
                    </div>
                </div>
            </section>

            <section class="grid md:grid-cols-3 gap-6">
                <!-- PRE -->
                <div class="space-y-4">
                    <div class="flex items-center gap-2 mb-2">
                        <div class="bg-blue-600 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold">1</div>
                        <h4 class="font-bold text-gray-800">Före Tävling</h4>
                    </div>
                    <div class="bg-white p-4 rounded shadow-sm border-l-4 border-blue-600">
                        <p class="text-sm font-bold text-gray-900">Administratören</p>
                        <p class="text-sm text-gray-600">Skapar tävling, importerar ekipage och schemalägger starttider.</p>
                    </div>
                    <div class="flex justify-center text-gray-400">↓</div>
                     <div class="bg-white p-4 rounded shadow-sm border-l-4 border-amber-500">
                        <p class="text-sm font-bold text-gray-900">Kusken (Min Portal)</p>
                        <p class="text-sm text-gray-600">Loggar in, kontrollerar sina uppgifter och gör ev. ändringar (hästbyte, groom) inför start.</p>
                    </div>
                </div>

                <!-- DURING -->
                <div class="space-y-4">
                    <div class="flex items-center gap-2 mb-2">
                         <div class="bg-green-600 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold">2</div>
                        <h4 class="font-bold text-gray-800">Under Tävling</h4>
                    </div>
                     <div class="bg-white p-4 rounded shadow-sm border-l-4 border-purple-600">
                        <p class="text-sm font-bold text-gray-900">Domare (Dressyr)</p>
                        <p class="text-sm text-gray-600">Dömer digitalt i iPad. Resultat skickas direkt till molnet.</p>
                    </div>
                     <div class="bg-white p-4 rounded shadow-sm border-l-4 border-green-600">
                        <p class="text-sm font-bold text-gray-900">Funktionär (Maraton/Precision)</p>
                        <p class="text-sm text-gray-600">Startar klockor och registrerar rivningar. Allt synkas live.</p>
                    </div>
                     <div class="bg-white p-4 rounded shadow-sm border-l-4 border-indigo-600">
                        <p class="text-sm font-bold text-gray-900">Speaker</p>
                        <p class="text-sm text-gray-600">Följer dramatiken live via Dashboard och ser mellantider.</p>
                    </div>
                </div>

                <!-- POST -->
                <div class="space-y-4">
                    <div class="flex items-center gap-2 mb-2">
                         <div class="bg-gray-800 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold">3</div>
                        <h4 class="font-bold text-gray-800">Efter Tävling</h4>
                    </div>
                     <div class="bg-white p-4 rounded shadow-sm border-l-4 border-gray-800">
                        <p class="text-sm font-bold text-gray-900">Publik & Kusk</p>
                        <p class="text-sm text-gray-600">Ser slutresultat online. Kusken laddar ner sitt protokoll.</p>
                    </div>
                     <div class="bg-white p-4 rounded shadow-sm border-l-4 border-blue-900">
                        <p class="text-sm font-bold text-gray-900">Admin (Arkivering)</p>
                        <p class="text-sm text-gray-600">Låser tävlingen och exporterar officiella resultatlistor (PDF).</p>
                    </div>
                </div>
            </section>
        </div>
        `;

    case 'admin':
      return `
        <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">För Administratörer</h2>
        <div class="space-y-8">
          
          <section>
            <h3 class="font-bold text-lg mb-2 text-blue-700 border-l-4 border-blue-500 pl-2">1. Skapa & Hantera Tävling</h3>
            <div class="bg-blue-50 p-4 rounded-lg space-y-2 text-gray-700">
              <p>Som administratör har du full kontroll över tävlingens upplägg under <strong>Start</strong>-menyn.</p>
              <ul class="list-disc list-inside ml-2">
                <li><strong>Skapa Tävling:</strong> Ange namn, datum och plats.</li>
                <li><strong>Nytt: Basera på tidigare tävling:</strong> Du kan välja en gammal tävling i rullistan för att kopiera inställningar (Hinder, Klasser, Parametrar) till den nya.</li>
                <li><strong>Välj Tävling:</strong> Klicka på en tävling i listan för att göra den aktiv och börja arbeta med den.</li>
              </ul>
            </div>
          </section>

          <section>
            <h3 class="font-bold text-lg mb-2 text-blue-700 border-l-4 border-blue-500 pl-2">2. Administrationspanelen</h3>
            <p class="text-gray-700 mb-2">Gå till <strong>Admin</strong> i menyn. Här finns fyra huvudflikar:</p>
            
            <div class="space-y-6">
              <!-- Anmälan & Data -->
              <div class="bg-white border rounded-lg p-4 shadow-sm">
                <h4 class="font-bold text-gray-800 text-base mb-2">📋 Anmälan & Data</h4>
                
                <h5 class="text-sm font-bold text-gray-700 mt-2">Hantera Deltagare</h5>
                <ul class="list-disc list-inside text-sm text-gray-600 ml-2 space-y-1">
                  <li><strong>Importera:</strong> Ladda upp en <code>.eqentries.xml</code>-fil för att slippa manuell inmatning.</li>
                  <li><strong>Redigera:</strong> Klicka på ett ekipage i listan. Du kan ändra allt från hästar till klass.
                    <div class="mt-1 ml-4 p-2 bg-gray-50 rounded border text-xs bg-yellow-50 text-yellow-900 border-yellow-200">
                        <strong>Betalning:</strong> Du kan markera status som "Betald", "Delbetald" eller "Obetald" samt ange summa. Detta syns dock <em>inte</em> för kusken i nuläget, utan är för din egen kontroll.
                    </div>
                  </li>
                  <li><strong>Strykningar:</strong> Ändra status till "Struken" i dropdown-menyn inne på ekipaget.</li>
                </ul>

                <h5 class="text-sm font-bold text-gray-700 mt-3">Domare & Funktionärer</h5>
                <ul class="list-disc list-inside text-sm text-gray-600 ml-2 space-y-1">
                    <li><strong>Måste finnas!</strong> För att kunna döma dressyr eller ta tid i maraton MÅSTE personen finnas inlagd här.</li>
                    <li><strong>Roller:</strong> Se till att tilldela rätt roll (t.ex. "Dressyr - C" eller "Start A").</li>
                    <li><strong>Nytt:</strong> Du kan nu lägga in <strong>ICE-kontakt</strong>, <strong>Kost/Allergi</strong> och <strong>Tröjstorlek</strong> för varje funktionär. Detta underlättar säkerhetsarbetet och logistiken.</li>
                </ul>

                <h5 class="text-sm font-bold text-gray-700 mt-3">Utskrifter & Listor (För Funktionärer)</h5>
                <p class="text-xs text-gray-600 mb-1">Gå till underfliken <strong>" 🖨️ Rapporter"</strong> eller <strong>"👀 Översikt & Print"</strong>:</p>
                <ul class="list-disc list-inside text-sm text-gray-600 ml-2 space-y-1">
                    <li><strong>Översikt (NY):</strong> Få en utskriftsvänlig lista grupperad per hinder/plats. Använd "PDF" för papper eller "CSV" för Excel.</li>
                    <li><strong>Funktionärslistor (PDF/CSV):</strong> Exportera kompletta listor med kontaktuppgifter, roller och tillval (kost/tröja) för incheckning eller utdelning.</li>
                    <li><strong>Telefonlista:</strong> En kompakt lista med alla funktionärers namn och telefonnummer.</li>
                    <li><strong>Catering:</strong> En sammanställning av allergier och antal luncher som behövs.</li>
                    <li><strong>Incheckning:</strong> En utskrivbar lista för att bocka av ankomst.</li>
                </ul>
              </div>

              <div class="bg-white border rounded-lg p-4 shadow-sm">
                <h4 class="font-bold text-gray-800 text-base mb-2">📢 Kommunikation</h4>
                <p class="text-sm text-gray-600 mb-2">Skicka meddelanden till kuskarnas portaler.</p>
                <ul class="list-disc list-inside text-sm text-gray-600 ml-2 space-y-1 mb-3">
                    <li><strong>Broadcast (Alla):</strong> Skicka en blänkare till ALLA deltagare (t.ex. vid tidsförskjutningar).</li>
                    <li><strong>Privat Meddelande:</strong> Välj en specifik kusk i rullistan ("Mottagare") för att skicka info som bara rör dem (t.ex. påminnelse om pass/vaccination).</li>
                    <li><strong>Meddelandetyper:</strong>
                        <ul class="list-circle list-inside ml-4 text-xs mt-1">
                            <li><strong>Info (Blå):</strong> Allmän information.</li>
                            <li><strong>Viktigt (Röd):</strong> Akuta eller kritiska meddelanden som sticker ut.</li>
                        </ul>
                    </li>
                </ul>
                <h4 class="font-bold text-gray-800 text-sm mb-2">📂 Dokument & Banskisser</h4>
                <p class="text-xs text-gray-600 mb-3">Du kan länka in externa filer som visas i kuskportalen (t.ex. PDF-kartor från Google Drive/Dropbox).</p>
                <div class="bg-yellow-50 p-2 rounded text-xs text-yellow-800 border border-yellow-100 space-y-2">
                    <p><strong>Tips 1:</strong> Se till att länken är publik ("Alla med länken kan se"). Välj kategorin "Banskiss" för rätt ikon.</p>
                    <p><strong>Tips 2:</strong> Välj <strong>Typ: "Text / HTML"</strong> för att skapa en enkel infosida (t.ex. "Regler för framkörning") direkt i systemet utan att ladda upp en fil.</p>
                </div>
              </div>

              <!-- Inställningar -->
              <div class="bg-white border rounded-lg p-4 shadow-sm">
                <h4 class="font-bold text-gray-800 text-base mb-2">⚙️ Inställningar</h4>
                <div class="space-y-2 text-sm text-gray-600">
                  <p><strong>Tävlingsnivå (FEI/Nationell):</strong> Påverkar vilka PDF-mallar som används. FEI ger engelska rubriker.</p>
                  <p><strong>Publicering (Visa på startsidan):</strong></p>
                  <ul class="list-circle list-inside ml-4 mt-1 text-xs text-gray-500">
                    <li><strong>Utkast (Dold):</strong> Tävlingen syns inte för allmänheten. Perfekt medan du sätter upp klasser och resultat.</li>
                    <li><strong>Publicerad (Grön):</strong> Gör tävlingen synlig på startsidan. Slå på detta när du är redo för besökare!</li>
                  </ul>
                  <p><strong>Digital Deklarering & Låsning:</strong></p>
                  <ul class="list-circle list-inside ml-4 mt-1 text-xs text-gray-500">
                    <li><strong>Timer:</strong> Ställ in hur många minuter före start portalen ska låsas (standard 60 min).</li>
                    <li><strong>Nödlåsning:</strong> Knappen "Lås alla ändringar NU" fryser startlistorna direkt.</li>
                  </ul>
                  <p class="mt-2"><strong>Globala Inställningar (Precision):</strong></p>
                  <ul class="list-circle list-inside ml-4 mt-1 text-xs text-gray-500">
                    <li>Här kan du ändra straffpoäng för rivning (t.ex. 3 eller 4 poäng) och tidsfel per sekund. Gäller alla klasser om inget annat anges.</li>
                  </ul>
                </div>
              </div>

              <!-- Arkivering -->
              <div class="bg-white border rounded-lg p-4 shadow-sm">
                <h4 class="font-bold text-gray-800 text-base mb-2">📦 Arkivering & Utskrift</h4>
                <ul class="list-disc list-inside text-sm text-gray-600 ml-2 mt-1">
                    <li><strong>Avsluta Tävling:</strong> Låser alla resultat så inga fler ändringar kan ske. Genererar "Master List" (PDF).</li>
                    <li><strong>Utskrifter:</strong> Gå till respektive resultatsida (Startlistor, Dressyrprotokoll etc) och använd webbläsarens "Skriv ut" eller "Spara som PDF". Systemet är anpassat för A4.</li>
                </ul>
              </div>
            </div>
          </section>

            </div>
          </section>

            </div>
          </section>
          
          <section>
            <h3 class="font-bold text-lg mb-2 text-orange-700 border-l-4 border-orange-500 pl-2">3. Admin: Banfakta (Maraton/Precision)</h3>
            <p class="text-gray-700 mb-2">För att systemet ska kunna räkna ut tider och straff rätt måste du ställa in banfakta.</p>
            
            <div class="grid md:grid-cols-2 gap-4 text-sm text-gray-700">
                <div class="bg-orange-50 p-4 rounded border border-orange-200">
                    <strong class="block text-orange-900 mb-2">🌲 Maraton: Sträckor & Tider</strong>
                    <ul class="list-disc list-inside space-y-1">
                        <li>Gå till fliken <strong>Maraton</strong> i Admin.</li>
                        <li>Fyll i <strong>Längd (m)</strong> och <strong>Tempo</strong> för Sträcka A, Transport och Sträcka B.</li>
                        <li>Systemet räknar automatiskt ut <em>Idealtid</em>, <em>Maxtid</em> och <em>Minimumtid</em>.</li>
                        <li><strong>Viktigt:</strong> Gör detta INNAN tävlingen börjar! Annars får funktionärerna inga tidsfönster.</li>
                    </ul>
                </div>
                <div class="bg-purple-50 p-4 rounded border border-purple-200">
                    <strong class="block text-purple-900 mb-2">🏁 Precision: Maxtid & Bredd</strong>
                    <ul class="list-disc list-inside space-y-1">
                        <li>Gå till fliken <strong>Precision</strong> i Admin.</li>
                        <li>Ange <strong>Banans Längd</strong> och <strong>Tempo</strong> (eller sätt en fast Maxtid manuellt).</li>
                        <li>Ange <strong>Hinderbredd</strong> (t.ex. Vagnbredd + 20cm).</li>
                        <li>Detta styr när klockan blir röd (Tidsfel) på monitorn.</li>
                    </ul>
                </div>
            </div>
          </section>

          <section>
            <h3 class="font-bold text-lg mb-2 text-indigo-700 border-l-4 border-indigo-500 pl-2">4. Maraton: Specialklasser & Tempo</h3>
            <p class="text-gray-700 mb-2">Så här hanterar du sammanslagna klasser, parakuskar och barnklasser.</p>
            
            <div class="space-y-4">
              <!-- Mixed Classes -->
              <div class="bg-white border rounded p-4 shadow-sm">
                  <strong class="text-indigo-900 block font-bold mb-1">1. Sammanslagna Klasser (Mixed)</strong>
                  <p class="text-sm text-gray-700 mb-2">Om en klass innehåller både ponny och häst men ska följa en specifik mall (t.ex. "Lätt B"):</p>
                  <ul class="list-disc list-inside text-sm text-gray-700 ml-2">
                      <li>Gå till <strong>Maratoninställningar</strong>.</li>
                      <li>Välj rätt nivå i rullistan <strong>"Tempo-mall"</strong> (t.ex. "Lätt B").</li>
                      <li>Systemet ger då automatiskt rätt idealtid till Ponny A, Ponny B, Häst etc.</li>
                  </ul>
              </div>

              <!-- Para -->
              <div class="bg-white border rounded p-4 shadow-sm">
                  <strong class="text-indigo-900 block font-bold mb-1">2. Parakuskar (Undantag)</strong>
                  <p class="text-sm text-gray-700 mb-2">Om en enskild kusk i en vanlig klass ska ha Para-tempo:</p>
                  <ul class="list-disc list-inside text-sm text-gray-700 ml-2">
                      <li>Gå till <strong>Deltagare</strong> och redigera kusken.</li>
                      <li>Kryssa i rutan <strong>"Parakusk"</strong>.</li>
                      <li>Hen får då automatiskt sin klass nivå minus Para-anpassning.</li>
                  </ul>
              </div>

              <!-- Barnklass -->
              <div class="bg-white border rounded p-4 shadow-sm">
                  <strong class="text-indigo-900 block font-bold mb-1">3. Barnklass</strong>
                  <ul class="list-disc list-inside text-sm text-gray-700 ml-2">
                      <li>Välj <strong>"Barnklass"</strong> i "Tempo-mall" under Maratoninställningar.</li>
                      <li>Ger automatiskt <strong>10 minuter Warm-up</strong> (Fast tid).</li>
                      <li>Tempo sätts enligt Barnklass-reglementet (Lätt B-hastigheter).</li>
                  </ul>
              </div>
              
                <!-- Warm-up -->
              <div class="bg-white border rounded p-4 shadow-sm">
                  <strong class="text-indigo-900 block font-bold mb-1">4. Warm-up (Istället för Sträcka A)</strong>
                  <p class="text-sm text-gray-700 mb-2">För att göra om Sträcka A till en ren uppvärmning:</p>
                  <ul class="list-disc list-inside text-sm text-gray-700 ml-2">
                      <li>Gå till <strong>Maratoninställningar</strong>.</li>
                      <li>Fyll i minuter i rutan <strong>"Fast tid (WU)"</strong> (t.ex. 30).</li>
                      <li>Sträckan döps om till "Warm-up" och får fast tid utan fönster.</li>
                  </ul>
              </div>
            </div>
          </section>

          <section>
            <h3 class="font-bold text-lg mb-2 text-purple-700 border-l-4 border-purple-500 pl-2">5. Dressyr: Avancerat</h3>
            <div class="bg-purple-50 p-4 rounded-lg space-y-4 text-gray-700">
              <div>
                <strong class="text-purple-900 block font-bold">📄 PDF-import av program</strong>
                <p class="text-sm">Du behöver inte skriva in varje rörelse manuellt! Ladda upp programmets officiella PDF från Ridsportförbundet, så "läser" systemet av texten och skapar protokollet åt dig.</p>
              </div>
              <div>
                <strong class="text-purple-900 block font-bold">👨‍⚖️ Domartilldelning</strong>
                <p class="text-sm">Välj <strong>Admin > Dressyr</strong> för att styra vilka domare (C, E, H) som dömer respektive klass. Systemet håller koll på behörigheter.</p>
              </div>
              <div>
                <strong class="text-purple-900 block font-bold">✨ Clear Round / Pay & Drive</strong>
                <p class="text-sm">För träningsklasser kan du aktivera "Clear Round". Då döljs de exakta straffpoängen för publiken och ersätts med "Godkänd" om kuskens procent når över din valda gräns (t.ex. 60%).</p>
              </div>
            </div>
          </section>

            <section>
              <h3 class="font-bold text-lg mb-2 text-blue-700 border-l-4 border-blue-500 pl-2">5. Hantera Starttider</h3>
              <p class="text-gray-700 mb-2">Gå till <strong>Starttider</strong> för att schemalägga starterna.</p>
              <div class="bg-gray-50 p-3 rounded text-sm text-gray-700">
                  <strong>Tips för smidig planering:</strong>
                  <ol class="list-decimal list-inside mt-1 ml-2">
                      <li>Välj klasser och sätt ett intervall (t.ex. 10 min).</li>
                      <li>Klicka "Generera".</li>
                      <li><strong>Dra och släpp:</strong> Du kan ta tag i en rad och flytta den upp/ner för att finjustera startordningen <em>innan</em> du sparar.</li>
                       <li><strong>Lägg in paus:</strong> Klicka på kaffekoppen <span class="text-sm">☕</span> på en rad för att lägga in en paus (t.ex. 15 min) <em>efter</em> den kusken. Alla efterföljande tider skjuts framåt.</li>
                      <li>Glöm inte <strong>"Spara & Publicera"</strong>! Innan dess ser ingen tiderna.</li>
                      <li><strong>Nytt:</strong> Knappen "Publicera startlista" (Toggle) gör tiderna synliga för publiken. Du kan arbeta med tiderna i lugn och ro innan du slår på denna.</li>
                  </ol>
                  
                  <h4 class="font-bold text-gray-800 text-sm mt-3 mb-1">🔥 Avancerad Generering</h4>
                  <p class="text-xs text-gray-600 mb-2">För Maraton och Precision kan du låta tidigare resultat styra startordningen:</p>
                  <ul class="list-disc list-inside text-xs text-gray-600 space-y-1 ml-1">
                      <li><strong>Maraton efter Dressyr:</strong> Sämst dressyrresultat startar först (eller tvärtom).</li>
                      <li><strong>Precision ("Omvänd Startordning"):</strong> För att skapa spänning kan du låta de med <em>sämst</em> totalresultat (Dressyr + Maraton) starta först, så att ledaren startar sist. Välj "Sortera efter Resultat" i inställningarna.</li>
                  </ul>
              </div>
            </section>

            <section>
              <h3 class="font-bold text-lg mb-2 text-green-700 border-l-4 border-green-500 pl-2">6. Admin: Maraton (Karta)</h3>
              <p class="text-gray-700 mb-2">För att "Monitor Maraton" (publikskärmen) ska visa en snygg karta:</p>
              <div class="bg-green-50 p-4 rounded-lg space-y-3 text-sm text-gray-700">
                  <div>
                      <strong class="text-green-900 font-bold block">1. Ladda upp bild</strong>
                      <ul class="list-disc list-inside ml-2">
                          <li>Ladda upp din banskiss (bild) till <strong>Google Drive</strong>.</li>
                          <li>Högerklicka på filen i Drive -> "Dela" -> "Kopiera länk" (Alla med länken).</li>
                          <li>I systemet: Klicka på knappen <strong>"📁 G-Drive"</strong> och klistra in länken. Systemet konverterar den automatiskt till en bildlänk.</li>
                      </ul>
                  </div>
                  <div>
                      <strong class="text-green-900 font-bold block">2. Placera ut hinder</strong>
                      <ul class="list-disc list-inside ml-2">
                          <li>Välj vad du vill placera i rullistan (t.ex. "Hinder 1").</li>
                          <li>Klicka på en punkt på förhandsvisningen av kartan.</li>
                          <li>En röd prick dyker upp. Koordinaterna sparas automatiskt.</li>
                          <li>Upprepa för alla hinder, start och mål.</li>
                      </ul>
                  </div>
              </div>
            </section>

          <section>
            <h3 class="font-bold text-lg mb-2 text-blue-700 border-l-4 border-blue-500 pl-2">7. Korrigera Resultat</h3>
            <p class="text-gray-700 mb-2">Om ett dressyrprotokoll blivit felaktigt signerat kan du öppna det igen.</p>
            <div class="bg-red-50 p-4 rounded-lg space-y-2 border border-red-100">
                <h4 class="font-bold text-red-800 text-sm">Lås upp ("Unfinalize") protokoll</h4>
                <ol class="list-decimal list-inside text-sm text-gray-700 ml-2">
                    <li>Gå till <strong>Resultat > Dressyr</strong>.</li>
                    <li>Leta upp ekipaget i listan.</li>
                    <li>I kolumnen längst till höger ("Finalisera"), klicka på knappen <span class="border border-emerald-600 text-emerald-700 px-1 rounded text-xs">Ångra</span>.</li>
                    <li>Protokollet är nu "öppet" igen och domaren kan göra ändringar i sin iPad.</li>
                </ol>
            </div>
          </section>


          <section>
            <h3 class="font-bold text-lg mb-2 text-cyan-700 border-l-4 border-cyan-500 pl-2">8. Lag & Team (Teams)</h3>
            <p class="text-gray-700 mb-2">Här administrerar du lagtävlingen. Gå till fliken <strong>Teams</strong> i Admin.</p>
            
            <div class="space-y-4">
                <div class="bg-cyan-50 p-4 rounded border border-cyan-200">
                    <strong class="text-cyan-900 block font-bold mb-1">Skapa & Hantera Lag</strong>
                    <ul class="list-disc list-inside text-sm text-gray-700 ml-2">
                        <li><strong>Aktivera:</strong> Slå på "Aktivera lagtävling" högst upp.</li>
                        <li><strong>Skapa Lag:</strong> Klicka "Nytt Lag", ange namn och spara.</li>
                        <li><strong>Lägg till Kuskar:</strong>
                            <ul class="list-circle list-inside ml-4 mt-1">
                                <li>Till höger finns en lista med alla tillgängliga kuskar ("Ej placerade").</li>
                                <li><strong>Drag-and-Drop:</strong> Ta tag i en kusk och dra den till önskat lagkort. Släpp för att lägga till.</li>
                                <li>Du kan också dra kuskar <em>mellan</em> lag om du behöver flytta dem.</li>
                            </ul>
                        </li>
                    </ul>
                </div>

                <div class="bg-white border rounded p-4 shadow-sm">
                    <strong class="text-gray-800 block font-bold mb-1">Flaggor & Loggor</strong>
                    <p class="text-sm text-gray-600 mb-2">Systemet försöker automatiskt matcha lagets utseende:</p>
                    <ul class="list-disc list-inside text-sm text-gray-600 ml-2">
                        <li><strong>Klubblogga:</strong> Om lagnamnet matchar en klubb (t.ex. "Körsällskapet ..."), visas klubbens logga.</li>
                        <li><strong>Nationsflagga:</strong> Om laget heter ett land (t.ex. "Sweden", "Denmark", "Germany"), visas landets flagga.</li>
                    </ul>
                    <p class="text-xs text-gray-500 mt-2">
                        <em>Tips: Kuskarna har sina egna flaggor/loggor baserat på sin profil (Nationalitet/Klubb).</em>
                    </p>
                </div>
            </div>
          </section>
        </div>
      `;

    // ... 'official' and 'judge' blocks remain handled by 'default' case re-rendering logic or previous code ...
    // Wait, replace_file_content replaces the BLOCK. The user asked to update Admin and Driver. 
    // I need to be careful not to delete 'official' and 'judge' if they are inside the replaced range.
    // The prompt says "Replace the 'admin' and 'driver' tab contents".
    // BUT my target range covers everything from line 60 to 320 which includes ALL tabs. 
    // So I must provide the content for ALL tabs in the ReplacementContent to avoid deleting them.

    case 'official':
      return `
        <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">För Funktionärer</h2>
        <div class="space-y-8">

          <!-- ÖVERSIKT & DASHBOARD -->
          <section>
            <h3 class="font-bold text-lg mb-2 text-indigo-700 border-l-4 border-indigo-500 pl-2">Översikt & Dashboard</h3>
            <p class="text-gray-700 mb-2">När du loggar in som funktionär möts du av en <strong>Dashboard</strong> som ger dig snabb överblick.</p>
            <div class="bg-indigo-50 p-4 rounded-lg space-y-3">
              <ul class="list-disc list-inside text-sm text-gray-700 space-y-2">
                <li><strong>Nästa Start:</strong> Visar vilket ekipage som står på tur för dig (baserat på din roll och position). Klicka på knappen "Gå till..." för att komma direkt till inmatningen för det ekipaget.</li>
                <li><strong>Att Göra / Synk:</strong> Visar om du har några protokoll eller tider som inte skickats iväg än (Synk-kö).</li>
                <li><strong>Genvägar:</strong> Länkar direkt till de verktyg du behöver (t.ex. Tidtagning, Hinder, Besiktning).</li>
              </ul>
            </div>
          </section>
          
          <!-- MARATON: TIDER -->
          <section>
            <h3 class="font-bold text-lg mb-2 text-green-700 border-l-4 border-green-500 pl-2">Maraton: Tidtagning (Sträckor)</h3>
            <p class="text-gray-700 mb-2">Används av starter och tidtagare vid Start A, Mål A, Start B, etc.</p>
            
            <div class="bg-green-50 p-4 rounded-lg space-y-3">
              <h4 class="font-semibold text-green-800">Arbetsflöde:</h4>
              <ol class="list-decimal list-inside space-y-2 text-gray-700">
                <li>Välj <strong>Maraton Tidtagning</strong> i menyn.</li>
                <li>Välj din start/mål-position i listan (t.ex. "Start Sträcka B").</li>
                <li>
                  <strong>När ett ekipage kommer:</strong>
                  <ul class="list-disc list-inside ml-4 mt-1 space-y-1">
                    <li>Leta upp ekipaget i listan (du kan söka på nummer).</li>
                    <li>Tryck på den gröna <strong>KLOCKA-ikonen</strong> exakt när de passerar linjen.</li>
                    <li>Tiden sparas direkt. En grön bock visas.</li>
                  </ul>
                </li>
                <li>
                  <strong class="text-green-800">Aktiva Timers (Nytt):</strong>
                  <br><span class="ml-4">Längst upp finns en rullgardin som visar ALLA klockor du just nu har igång. Det gör att du kan starta ekipage #1, gå in på ekipage #2, men ändå se tiden för #1 ticka.</span>
                </li>
                <li>
                  <strong class="text-red-800">Global Paus:</strong>
                  <br><span class="ml-4">Om skärmen blir grå (svartvitt) betyder det att tävlingen är <strong>Pausad</strong> av tävlingsledningen. Ingen tidtagning ska ske då.</span>
                </li>
                <li>
                  <strong>Om du klockade fel:</strong>
                  <ul class="list-disc list-inside ml-4 mt-1 space-y-1">
                    <li>Tryck på tiden (textfältet) för att redigera den manuellt.</li>
                    <li>Ange rätt tid i formatet <code>TT:MM:SS</code> och spara.</li>
                  </ul>
                </li>
              </ol>

              <div class="mt-2 text-sm text-green-800 bg-green-100 p-2 rounded">
                <strong>Tips:</strong> Systemet räknar automatiskt ut idealtider och tidsfönster för att hjälpa dig se om ekipaget ligger bra till.
              </div>
            </div>
          </section>

          <!-- MARATON: HINDER -->
          <section>
            <h3 class="font-bold text-lg mb-2 text-blue-700 border-l-4 border-blue-500 pl-2">Maraton: Hinderdomare</h3>
            <p class="text-gray-700 mb-2">Används ute vid hindren för att logga tider och fel.</p>

            <div class="bg-blue-50 p-4 rounded-lg space-y-3">
              <h4 class="font-semibold text-blue-800">Steg-för-steg:</h4>
              <ol class="list-decimal list-inside space-y-2 text-gray-700">
                <li>Gå till <strong>Inmatning Hinder</strong>.</li>
                <li>Välj <strong>Hinder nr</strong> (det hinder du bevakar).</li>
                <li>
                  <strong>När ekipaget startar (passerar startlinjerna):</strong>
                  <br><span class="ml-4">Tryck på <span class="font-bold text-white bg-green-600 px-2 py-0.5 rounded text-xs">START</span>. Klockan börjar ticka.</span>
                </li>
                <li>
                  <strong>Vid målgång (ut ur hindret):</strong>
                  <br><span class="ml-4">Tryck på <span class="font-bold text-white bg-red-600 px-2 py-0.5 rounded text-xs">STOPP</span>. Tiden stannar.</span>
                </li>
                <li>
                  <strong>Rapportera fel (Rivningar/Väg):</strong>
                  <ul class="list-disc list-inside ml-4 mt-1 space-y-1">
                    <li><strong>Väg:</strong> Om kusk kör fel, ange vilken port de missade. Systemet varnar för felkörning.</li>
                    <li><strong>Rivning:</strong> Ange antal nedslagna bollar i fältet "Antal rivningar".</li>
                    <li><strong>Eliminering:</strong> Kryssa i rutan "Eliminerad" om ekipaget utesluts.</li>
                  </ul>
                </li>
                <li>
                  <strong>Slutför:</strong>
                  <br><span class="ml-4">Tryck <span class="font-bold text-white bg-blue-900 px-2 py-0.5 rounded text-xs">SPARA RESULTAT</span> när du är klar. Datan skickas till sekretariatet.</span>
                </li>
              </ol>
            </div>
          </section>

          <!-- PRECISION -->
          <section>
            <h3 class="font-bold text-lg mb-2 text-purple-700 border-l-4 border-purple-500 pl-2">Precision: Inmatning</h3>
            <p class="text-gray-700 mb-2">För tidtagare och banpersonal på precisionsbanan.</p>

            <div class="bg-purple-50 p-4 rounded-lg space-y-3">
              <h4 class="font-semibold text-purple-800">Instruktioner:</h4>
              <ol class="list-decimal list-inside space-y-2 text-gray-700">
                <li>Gå till <strong>Inmatning Precision</strong>.</li>
                <li>Välj aktuellt ekipage (nr).</li>
                <li>
                  <strong>Tidtagning:</strong>
                  <ul class="list-disc list-inside ml-4 mt-1 space-y-1">
                    <li>Tryck <strong>Start</strong> när startlinjen passeras.</li>
                    <li>Tryck <strong>Stopp</strong> vid målgång. Tiden stannar.</li>
                    <li>Om maxtiden överskrids visas tiden i rött (straff läggs på automatiskt).</li>
                  </ul>
                </li>
                <li>
                  <strong>Hinderfel:</strong>
                  <ul class="list-disc list-inside ml-4 mt-1 space-y-1">
                    <li>Klicka på knapparna för de hinder som rivs (t.ex. <span class="border px-1 bg-white text-xs rounded">1</span>, <span class="border px-1 bg-white text-xs rounded">5A</span>).</li>
                    <li>Varje klick lägger till/tar bort 3 straffpoäng.</li>
                  </ul>
                </li>
                <li>Tryck på <strong>Spara Slutgiltigt Resultat</strong> för att publicera.</li>
              </ol>
            </div>
          </section>

          <!-- SPECIAL: BESIKTNING -->
          <section>
            <h3 class="font-bold text-lg mb-2 text-gray-700 border-l-4 border-gray-500 pl-2">Specialfunktioner (Besiktning)</h3>
            
            <div class="grid md:grid-cols-2 gap-6">
                <!-- Veterinär -->
                <div class="bg-gray-50 p-4 rounded-lg border border-gray-200">
                    <h4 class="font-bold text-gray-800 flex items-center gap-2">🩺 Veterinär</h4>
                    <p class="text-sm text-gray-600 mb-2">Används vid incheckning/förbesiktning.</p>
                    <ul class="list-disc list-inside text-sm text-gray-700 space-y-1">
                        <li><strong>Sök ekipage:</strong> Skriv namn eller nummer för att hitta rätt häst. Eller välj direkt i rullistan!</li>
                        <li><strong>Status:</strong>
                            <ul class="list-disc list-inside ml-4 text-xs mt-1">
                                <li><strong>Godkänd (Grön):</strong> Hästen är ok för start.</li>
                                <li><strong>Håll (Gul):</strong> Osäker status, skickas till ombesiktning (Holding Box).</li>
                                <li><strong>Struken (Röd):</strong> Hästen får ej starta.</li>
                            </ul>
                        </li>
                        <li><strong>Noteringar:</strong> Du kan skriva in sårskador eller andra observationer som sparas på ekipaget.</li>
                    </ul>
                </div>

                <!-- Vagn & Funktion -->
                <div class="bg-gray-50 p-4 rounded-lg border border-gray-200">
                    <h4 class="font-bold text-gray-800 flex items-center gap-2">⚖️ Vagn & Funktion</h4>
                    <p class="text-sm text-gray-600 mb-2">Mätning av vagnbredd och säkerhetskoll.</p>
                    <ul class="list-disc list-inside text-sm text-gray-700 space-y-1">
                        <li><strong>Mätning:</strong> Fyll i bredden för Precision och Maraton. Systemet varnar om vagnen är för smal enligt reglerna (Vagnbredd + 20cm).</li>
                        <li><strong>Säkerhetskoll:</strong> Kryssa i rutan "Vagn Godkänd" om utrustningen är korrekt.</li>
                        <li><strong>Spara:</strong> Tryck Enter eller klicka Spara för att hoppa till nästa ekipage i listan.</li>
                    </ul>
                </div>
            </div>
          </section>

        </div>
      `;

    case 'observer':
      return `
        <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">För Observatörer (Maraton)</h2>
        <div class="space-y-8">
            
            <section>
                <h3 class="font-bold text-lg mb-2 text-red-700 border-l-4 border-red-500 pl-2">STOPPA TÄVLINGEN (Nödläge)</h3>
                <div class="bg-red-100 p-4 rounded-lg border-2 border-red-500">
                    <p class="font-bold text-red-900 text-lg mb-2">⚠️ VARNING</p>
                    <p class="text-red-900 mb-2">
                        Om en olycka sker eller om tävlingen måste pausas akut av annan anledning:
                    </p>
                    <ol class="list-decimal list-inside font-bold text-red-900 ml-2 text-lg">
                        <li>Tryck på den STORA RÖDA KNAPPEN "PAUSA TÄVLINGEN".</li>
                        <li>Bekräfta i rutan som dyker upp.</li>
                    </ol>
                    <p class="text-red-800 mt-4 text-sm">
                        <strong>Vad händer då?</strong><br>
                        Alla klockor i hela systemet (start, mål, hinder) stoppas tillfälligt. En stor röd skylt visas för alla funktionärer.
                    </p>
                    <p class="text-green-800 mt-4 font-bold">
                        För att återuppta: Tryck på den GRÖNA knappen "ÅTERUPPTA TÄVLINGEN" när banan är fri.
                    </p>
                </div>
            </section>

            <section>
                <h3 class="font-bold text-lg mb-2 text-orange-700 border-l-4 border-orange-500 pl-2">Logga Händelser (Fel gångart / Halt)</h3>
                <p class="text-gray-700 mb-4">Används för att notera otillåtna gångarter eller halter på sträckan.</p>

                <div class="bg-white border p-4 rounded shadow-sm space-y-4">
                    
                    <div>
                        <h4 class="font-bold text-gray-800 border-b pb-1 mb-2">1. Välj Ekipage</h4>
                        <p class="text-sm text-gray-600">Välj det ekipage du observerar i rullistan högst upp (t.ex. "Start nr 15").</p>
                    </div>

                    <div class="grid md:grid-cols-2 gap-6">
                        <!-- Fel Gångart -->
                        <div class="bg-orange-50 p-3 rounded">
                            <strong class="block text-orange-900 mb-2">🐎 Fel Gångart (Tid)</strong>
                            <ul class="list-disc list-inside text-sm text-gray-700 space-y-2">
                                <li>Tryck <span class="bg-orange-500 text-white px-2 py-0.5 rounded font-bold">START</span> när hästen slår över i galopp (eller annan fel gångart).</li>
                                <li>Tryck <span class="bg-red-600 text-white px-2 py-0.5 rounded font-bold">STOPP</span> när hästen återgår till trav.</li>
                                <li> tiden sparas automatiskt i listan nedanför.</li>
                            </ul>
                        </div>

                        <!-- Halt -->
                        <div class="bg-blue-50 p-3 rounded">
                            <strong class="block text-blue-900 mb-2">🛑 Halt (Straff)</strong>
                            <ul class="list-disc list-inside text-sm text-gray-700 space-y-2">
                                <li>Tryck <span class="bg-blue-600 text-white px-2 py-0.5 rounded font-bold">REGISTRERA HALT</span> om ekipaget stannar <strong>utanför</strong> hinderområde (ej tillåtet).</li>
                                <li>Ett fönster öppnas där du kan skriva en kommentar.</li>
                                <li>Klicka "Spara". Straffpoäng läggs till.</li>
                            </ul>
                        </div>
                    </div>

                    <div class="mt-4">
                        <h4 class="font-bold text-gray-800 border-b pb-1 mb-2">Rätta fel</h4>
                        <p class="text-sm text-gray-600">Om du råkade trycka fel:</p>
                        <ul class="list-disc list-inside text-sm text-gray-600 ml-2 mt-1">
                            <li><strong>Redigera tid:</strong> Klicka på penn-ikonen bredvid noteringen i historiken längst ner.</li>
                            <li><strong>Ta bort:</strong> Klicka på soptunnan för att radera en felaktig registrering.</li>
                        </ul>
                    </div>

                </div>
            </section>

        </div>
      `;

    case 'judge':
      return `
        <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">För Domare</h2>
        <div class="space-y-8">
          
          <section>
            <h3 class="font-bold text-lg mb-2 text-purple-700 border-l-4 border-purple-500 pl-2">Digitala Dressyrprotokoll</h3>
            <p class="text-gray-700 mb-2">Du (eller din skrivare) använder sidan <strong>Inmatning Dressyr</strong> för att protokollföra ritten direkt i systemet.</p>

            <div class="bg-purple-50 p-4 rounded-lg space-y-3">
              <h4 class="font-semibold text-purple-800">Arbetsgång:</h4>
              <ol class="list-decimal list-inside space-y-3 text-gray-700">
                <li>
                  <strong>Förberedelser:</strong>
                  <ul class="list-disc list-inside ml-4 mt-1 text-sm">
                    <li>Välj din <strong>Domarprofil</strong> (t.ex. "C – Anna Andersson") i listan.</li>
                    <li>Välj aktuellt <strong>Ekipage</strong> som ska bedömas.</li>
                    <li>Kontrollera att rätt <strong>Program</strong> laddas automatiskt.</li>
                  </ul>
                </li>
                <li>
                  <strong>Under körningen:</strong>
                  <ul class="list-disc list-inside ml-4 mt-1 text-sm">
                    <li>Fyll i poäng (0-10) för varje moment. Använd HEL- eller HALV-poäng (t.ex. 6, 6.5, 7).</li>
                    <li>Systemet autosparar ("Heartbeat") var 30:e sekund och vid varje fältbyte.</li>
                    <li>Lägg till <strong>Kommentarer</strong> vi behov genom att klicka på "💬 Kom.".</li>
                  </ul>
                  <div class="mt-2 ml-4 p-2 bg-white border border-purple-200 rounded text-xs text-purple-900">
                      <strong>💡 Tips för snabbare inmatning (Tangentbord):</strong>
                      <ul class="list-disc list-inside mt-1">
                          <li><strong>Enter:</strong> Hoppa direkt till nästa poängruta.</li>
                          <li><strong>Tab:</strong> Öppna och hoppa till kommentarsfältet för <em>aktuell</em> rörelse.</li>
                      </ul>
                  </div>
                </li>
                <li>
                  <strong>Vid felkörning:</strong>
                  <br><span class="ml-4 text-sm">Använd knapparna för "Fel 1" / "Fel 2" eller fyll i "Övriga avdrag" manuellt längst ner.</span>
                </li>
                <li>
                  <strong>Signera & Spara:</strong>
                  <br><span class="ml-4 text-sm">När protokollet är klart, klicka på <strong>Spara Protokoll</strong>. Detta låser resultatet och gör det officiellt.</span>
                </li>
              </ol>
            </div>
          </section>

            <section>
            <h3 class="font-bold text-lg mb-2 text-purple-700 border-l-4 border-purple-500 pl-2">Överdomare / Godkännande</h3>
            <p class="text-gray-700 mb-2">För att verifiera resultat innan prisutdelning:</p>
            <ul class="list-disc list-inside ml-2 text-gray-700">
              <li>Gå till <strong>Resultat Dressyr</strong> eller <strong>Totalresultat</strong>.</li>
              <li>Kontrollera att alla domare har status "Klar" (grön bock).</li>
              <li>Vid strykningar eller uteslutning, se till att detta är markerat i systemet.</li>
            </ul>
          </section>

          <section class="bg-red-50 p-4 rounded border-l-4 border-red-500">
            <h4 class="font-bold text-red-800 text-sm uppercase mb-1">Felsökning & Problem</h4>
            <div class="text-sm text-red-900 space-y-2">
                <p><strong>⚠️ Tappad anslutning (Off-line):</strong><br>
                Om internet försvinner kan du fortsätta döma, men tryck INTE på "Spara Protokoll" förrän anslutningen är tillbaka. Notera resultaten på papper som backup.</p>
                <p><strong>✍️ Rättelse i efterhand:</strong><br>
                Ett signerat protokoll är låst. För att ändra måste en <strong>Administratör</strong> låsa upp det, eller redigera direkt i databasen. Kontakta sekretariatet.</p>
            </div>
          </section>
        </div>
      `;

    case 'driver':
      return `
        <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">För Kuskar & Deltagare</h2>
        
        <div class="space-y-8">
            
            <!-- MIN PORTAL -->
            <section>
                <h3 class="font-bold text-lg mb-2 text-amber-700 border-l-4 border-amber-500 pl-2">1. Min Portal</h3>
                <p class="text-gray-700 mb-2">Kom ihåg att logga in med samma e-postadress som du angav vid anmälan för att se dina uppgifter.</p>
                
                <div class="bg-amber-50 p-4 rounded-lg space-y-4">
                    <h4 class="font-semibold text-amber-800">Funktioner i portalen:</h4>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div class="bg-white p-3 rounded border border-amber-100">
                            <strong class="text-amber-900 block mb-1">🏁 Starttider & Resultat</strong>
                            <p class="text-xs text-gray-600">Se din personliga starttid och status (t.ex. "Startad", "Veterinärbesiktigad").</p>
                        </div>
                        <div class="bg-white p-3 rounded border border-amber-100">
                             <strong class="text-amber-900 block mb-1">✏️ Digital Deklarering</strong>
                             <p class="text-xs text-gray-600">Ändra hästar, vagn och groom direkt i mobilen.</p>
                             <p class="text-xs text-red-500 mt-1 font-medium">Obs! Låses X minuter före start!</p>
                        </div>
                        <div class="bg-white p-3 rounded border border-amber-100">
                             <strong class="text-amber-900 block mb-1">🩺 Veterinärstatus</strong>
                             <p class="text-xs text-gray-600">Se om din häst är godkänd ("Grön") eller har anmärkningar.</p>
                        </div>
                        <div class="bg-white p-3 rounded border border-amber-100">
                             <strong class="text-amber-900 block mb-1">📢 Speaker-noteringar</strong>
                             <p class="text-xs text-gray-600">Skriv in text som speakern kan läsa upp under din ritt (t.ex. kuriosa).</p>
                        </div>
                    </div>
                </div>
            </section>

             <!-- RESULTAT & NOTISER -->
             <section>
                <h3 class="font-bold text-lg mb-2 text-blue-700 border-l-4 border-blue-500 pl-2">2. Resultat & Meddelanden</h3>
                <div class="space-y-4 text-gray-700">
                    <ul class="list-disc list-inside ml-2">
                        <li><strong>Meddelanden:</strong> Här tar du emot både <strong>personliga meddelanden</strong> (riktade bara till dig) och allmänna utrop (till alla).</li>
                        <li><strong>Protokoll:</strong> När dressyren är klar och signerad kan du ofta ladda ner ditt protokoll som PDF direkt från resultatlistan.</li>
                    </ul>
                    
                    <div class="bg-gray-50 p-4 rounded-lg">
                        <h4 class="font-bold text-gray-800 mb-2">Vanliga frågor</h4>
                        <details class="group cursor-pointer mb-2">
                            <summary class="font-medium text-gray-700 list-none flex items-center justify-between border-b pb-1">
                                <span>Varför kan jag inte ändra mina hästar?</span>
                                <span class="transition group-open:rotate-180">▼</span>
                            </summary>
                            <p class="text-gray-600 mt-2 text-sm">
                                Portalen låses automatiskt en viss tid (ofta 60 min) före din starttid för att sekretariatet ska hinna skriva ut startlistor. Kontakta sekretariatet om du behöver ändra akut.
                            </p>
                        </details>
                        <details class="group cursor-pointer">
                            <summary class="font-medium text-gray-700 list-none flex items-center justify-between border-b pb-1">
                                <span>Jag hittar inte min tävling i listan?</span>
                                <span class="transition group-open:rotate-180">▼</span>
                            </summary>
                            <p class="text-gray-600 mt-2 text-sm">
                                Klicka på knappen <strong>"Försök hitta mina anmälningar igen"</strong> i portalen. Om det inte fungerar, kontrollera att du är inloggad med exakt samma e-post som finns registrerad i anmälningssystemet.
                            </p>
                        </details>
                    </div>
                </div>
            </section>
        </div>
      `;

    case 'speaker':
      return `
        <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">För Speaker</h2>
        <div class="space-y-8">
          
          <section>
            <h3 class="font-bold text-lg mb-2 text-indigo-700 border-l-4 border-indigo-500 pl-2">Översikt & Dashboard</h3>
            <p class="text-gray-700 mb-2">Speaker-vyn är framtagen för att ge dig realtidsinformation utan att du behöver klicka runt. Byt gren via knapparna högst upp (Dressyr, Maraton, Precision).</p>
            
            <div class="grid md:grid-cols-2 gap-4 text-sm mb-4">
                <div class="bg-indigo-50 p-3 rounded border border-indigo-100">
                    <strong class="text-indigo-900 block mb-1">📢 Speaker-noteringar</strong>
                    <p class="text-gray-700">Visar texten som kusken själv lagt in i sin portal.</p>
                </div>
                
                <div class="bg-indigo-50 p-3 rounded border border-indigo-100">
                    <strong class="text-indigo-900 block mb-1">🗺️ Interaktiv Maratonkarta</strong>
                    <p class="text-gray-700">
                        Kartan är klickbar! Tryck på en prick för att se straff och status.
                        Använd listan till höger för att "flyga" direkt till en kusk.
                    </p>
                </div>
                <div class="bg-indigo-50 p-3 rounded border border-indigo-100">
                   <strong class="text-indigo-900 block mb-1">🔍 Live-data</strong>
                   <p class="text-gray-700 leading-relaxed">
                     <strong>Dressyr:</strong> Visar löpande poängprocent om "live-protokoll" används.<br>
                     <strong>Maraton:</strong> Visar exakt var kusken är på banan och tider i hinder.<br>
                     <strong>Precision:</strong> Visar tid och fel direkt vid målgång.
                   </p>
                </div>
            </div>
          </section>

          <section>
             <h3 class="font-bold text-lg mb-2 text-blue-700 border-l-4 border-blue-500 pl-2">Maraton: Command Center</h3>
             <p class="text-sm text-gray-600 mb-4">Maraton-vyn är extra detaljerad. Här är de viktigaste verktygen:</p>

             <div class="space-y-6">
                 
                 <!-- Hinderfokus -->
                 <div class="bg-white border p-4 rounded shadow-sm">
                     <h4 class="font-bold text-gray-800 flex items-center gap-2">
                        🎯 Hinder-fokus
                        <span class="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full uppercase">Nyhet</span>
                     </h4>
                     <p class="text-gray-600 text-sm mt-1 mb-2">Istället för att se alla hinder, kan du "låsa" vyn på ett specifikt hinder (t.ex. Vattenhindret).</p>
                     <ul class="list-disc list-inside text-gray-600 text-sm ml-2">
                         <li>Använd dropdown-menyn <strong>"Välj Hinder"</strong> uppe till vänster.</li>
                         <li>Vyn visar nu endast tider och händelser för detta hinder, perfekt om du sitter vid just det hindret.</li>
                     </ul>
                 </div>

                 <!-- Redigera Noteringar -->
                 <div class="bg-white border p-4 rounded shadow-sm">
                     <h4 class="font-bold text-gray-800">📝 Redigera Noteringar Live</h4>
                     <p class="text-gray-600 text-sm mt-1 mb-2">Ibland saknas info eller så vill du lägga till något du precis fick höra.</p>
                     <ol class="list-decimal list-inside text-gray-600 text-sm ml-2 space-y-1">
                         <li>Klicka på knappen <strong>"✎ Ändra"</strong> vid noteringarna.</li>
                         <li>Skriv in ny text i rutan.</li>
                         <li>Klicka <strong>Spara</strong>. Detta uppdateras direkt i systemet (och syns även för kusken).</li>
                     </ol>
                 </div>

                 <!-- Sektoranalys -->
                 <div class="bg-white border p-4 rounded shadow-sm">
                    <h4 class="font-bold text-gray-800">⏱️ Sektoranalys (A / Transport)</h4>
                    <p class="text-gray-600 text-sm mt-1">Visar kuskar som är ute på sträckorna (ej i hinder).</p>
                    <div class="mt-2 bg-gray-50 p-2 rounded text-xs font-mono text-gray-700 border border-gray-200">
                        <span class="text-red-500 font-bold">+0:45</span> = Kusken är 45 sekunder efter idealtid.<br>
                        <span class="text-green-600 font-bold">-0:10</span> = Kusken är 10 sekunder snabbare än idealtid.
                    </div>
                 </div>

             </div>
          </section>

          <section>
            <h3 class="font-bold text-lg mb-2 text-green-700 border-l-4 border-green-500 pl-2">Topplistor & Filtrering</h3>
             <ul class="list-disc list-inside text-gray-700 ml-2 space-y-2">
                <li><strong>Topplistan (Högerkanten):</strong> Uppdateras live. Den visar ställningen i klassen.</li>
                <li><strong>Byt Klass:</strong> Klicka på dropdown-menyn högst upp i topplistan (t.ex. "MSV Klass") för att se ställningen i andra klasser utan att lämna sidan.</li>
                <li><strong>Pågående:</strong> Ekipaget som kör just nu markeras tydligt med <span class="bg-blue-100 text-blue-800 px-1 rounded font-bold text-xs">BLÅTT</span> i listan.</li>
             </ul>
          </section>

          <section class="bg-yellow-50 p-4 rounded border-l-4 border-yellow-400">
            <h4 class="font-bold text-yellow-800 text-sm uppercase mb-1">Felsökning</h4>
            <p class="text-sm text-yellow-900">
                Om "Pågående ekipage" fastnar eller inte verkar stämma: 
                <span class="font-semibold block mt-1">Prova att växla gren (t.ex. till Dressyr och tillbaka till Maraton) för att tvinga en omstart av live-kopplingen.</span>
            </p>
          </section>

        </div>
      `;

    default:
      return '<p>Välj en roll ovan.</p>';
  }
}

export function unload() {
  // Cleanup if needed
}

function getTabContentEN(tab) {
  switch (tab) {
    case 'tech':
      return `
        <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">Tech & Support</h2>
        <div class="space-y-8">
            
            <section>
                <h3 class="font-bold text-lg mb-2 text-cyan-700 border-l-4 border-cyan-500 pl-2">Install as App</h3>
                <p class="text-gray-700 mb-2">For best performance and stability, you should add the system to your home screen.</p>
                <div class="grid md:grid-cols-2 gap-4">
                    <div class="bg-gray-50 p-4 rounded border">
                        <strong class="block mb-2">🍏 iPad / iPhone (Safari)</strong>
                        <ol class="list-decimal list-inside text-sm text-gray-700 space-y-1">
                            <li>Tap the <strong>Share button</strong> (square with arrow up).</li>
                            <li>Scroll down and select <strong>"Add to Home Screen"</strong>.</li>
                            <li>Confirm with "Add".</li>
                        </ol>
                    </div>
                    <div class="bg-gray-50 p-4 rounded border">
                        <strong class="block mb-2">🤖 Android (Chrome)</strong>
                        <ol class="list-decimal list-inside text-sm text-gray-700 space-y-1">
                            <li>Tap the menu (three dots).</li>
                            <li>Select <strong>"Install App"</strong> or "Add to Home Screen".</li>
                            <li>Follow the instructions.</li>
                        </ol>
                    </div>
                </div>
            </section>

             <section>
                <h3 class="font-bold text-lg mb-2 text-orange-700 border-l-4 border-orange-500 pl-2">Offline Mode (No Internet)</h3>
                <div class="bg-orange-50 p-4 rounded-lg border border-orange-200">
                    <p class="text-gray-700 mb-2">
                        The system is built to handle unstable internet connections in the field.
                    </p>
                    <ul class="list-disc list-inside text-sm text-gray-700 space-y-2">
                        <li><strong>You can continue to enter times/results even if you lose coverage.</strong></li>
                        <li>Data is saved locally ("In Queue") and sent automatically when internet returns.</li>
                        <li class="font-bold text-red-600">IMPORTANT: DO NOT close the browser tab if you are offline! Unsaved data may be lost.</li>
                    </ul>
                </div>
            </section>

             <section>
                <h3 class="font-bold text-lg mb-2 text-green-700 border-l-4 border-green-500 pl-2">Battery & Screen Lock</h3>
                <div class="bg-green-50 p-4 rounded-lg border border-green-200">
                    <p class="text-gray-700 mb-2">
                        The system automatically keeps your screen awake ("Wake Lock") while you are on valid timing or judging pages.
                    </p>
                    <ul class="list-disc list-inside text-sm text-gray-700 space-y-1">
                        <li>You do not need to change your phone's screen timeout settings.</li>
                        <li><strong>Tip:</strong> Keep a Powerbank handy if you are stationed outside all day, as the screen consumes battery.</li>
                    </ul>
                </div>
            </section>

             <section>
                <h3 class="font-bold text-lg mb-2 text-gray-700 border-l-4 border-gray-500 pl-2">Troubleshooting</h3>
                <ul class="list-disc list-inside text-sm text-gray-700 space-y-1">
                   <li><strong>"Page looks weird":</strong> Try reloading the page (pull down or press F5).</li>
                   <li><strong>"Nothing happens when I click":</strong> Check your internet connection. Is there an "Offline" symbol visible?</li>
                   <li><strong>Sync Queue (Cloud Icon):</strong>
                       <ul class="list-circle list-inside ml-4 mt-1 text-xs">
                           <li><span class="text-green-600">Green:</span> All saved to cloud.</li>
                           <li><span class="text-amber-500">Yellow (Pulse):</span> Saving right now... (Wait until green).</li>
                           <li><span class="text-red-500">Red/Strikethrough:</span> Offline. Data saved locally and sent later.</li>
                       </ul>
                   </li>
                </ul>
            </section>

        </div>
            `;

    case 'secretary':
      return `
        <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">For The Secretariat</h2>
        <div class="space-y-8">
            
            <section>
                <h3 class="font-bold text-lg mb-2 text-blue-700 border-l-4 border-blue-500 pl-2">Report Center (Lists)</h3>
                <p class="text-gray-700 mb-2">Here you generate all PDF files for printing and web publishing.</p>
                <div class="bg-blue-50 p-4 rounded-lg space-y-2">
                    <ul class="list-disc list-inside text-sm text-gray-700">
                        <li><strong>Start Lists:</strong> Created per discipline (Dressage, Marathon, Precision). The system automatically sorts by start time.</li>
                        <li><strong>Officials Lists (New!):</strong>
                            <ul class="list-circle list-inside ml-4 text-xs mt-1 space-y-1">
                                <li><strong>Marathon Times:</strong> Timeline with calculated times for Start A, Finish A, Start B etc. (Requires start times and distances to be set).</li>
                                <li><strong>Marathon Obstacles:</strong> List for obstacle judges. Includes calculated start time for Section B.</li>
                                <li><strong>Dressage:</strong> Start order with program and horse for scribes/ringmaster.</li>
                            </ul>
                            <p class="text-[10px] text-blue-800 mt-1"><em>* Scratched entries are automatically filtered out from these lists.</em></p>
                        </li>
                        <li><strong>Result Lists:</strong> Results are calculated live. You don't need to "calculate" anything manually.</li>
                        <li><strong>CSV Export:</strong> Use the "CSV" buttons to get raw data for Excel if you need to perform custom analysis.</li>
                    </ul>
                     <p class="text-xs text-blue-900 mt-2 font-bold">
                        Tip: Use "Filter by Class" at the top to print lists for one class at a time.
                     </p>
                </div>
            </section>

            <section>
                <h3 class="font-bold text-lg mb-2 text-yellow-700 border-l-4 border-yellow-500 pl-2">Prize Giving</h3>
                <p class="text-gray-700 mb-2">A view specially adapted for the prize presenter or speaker at the ceremony.</p>
                
                <div class="bg-white border rounded p-4 shadow-sm">
                    <h4 class="font-bold text-gray-800 mb-2">Features:</h4>
                    <ol class="list-decimal list-inside text-sm text-gray-700 space-y-2">
                        <li><strong>Podium View:</strong> The top 3 are presented with large cards.</li>
                        <li><strong>"On Site" Checkbox:</strong> 
                            <span class="block ml-5 text-gray-600">Check the "ON SITE" box when the driver arrives at the ceremony. This helps you see who is missing before the ceremony starts.</span>
                        </li>
                    </ol>
                </div>
            </section>

             <section>
                <h3 class="font-bold text-lg mb-2 text-indigo-700 border-l-4 border-indigo-500 pl-2">📺 Public Screens (Monitors)</h3>
                <p class="text-gray-700 mb-2">
                    The system has three special "Monitor" pages designed to be displayed on large TV screens in the cafeteria or public area.
                    These pages automatically rotate content and always show the latest info.
                </p>
                <div class="bg-indigo-50 p-4 rounded-lg border border-indigo-200">
                    <ul class="list-disc list-inside text-sm text-gray-700 space-y-2">
                        <li><strong>Monitor Dressage:</strong> Shows current entry, current scores, and a rolling result list.</li>
                        <li><strong>Monitor Marathon:</strong> Shows a map with live reporting from obstacles. Crowd favorite!</li>
                        <li><strong>Monitor Precision:</strong> Shows time, faults, and <strong>Max Time</strong> (elimination limit) immediately at the finish.</li>
                    </ul>
                    <p class="text-xs text-indigo-800 mt-2 font-bold">
                        Tip: Connect a laptop/iPad to the TV and navigate to the respective page via the main menu. Press F11 for fullscreen!
                    </p>
                </div>
            </section>
        </div>`;

    case 'overview':
      return `
        <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">Overview</h2>
        <div class="space-y-8">
            <section>
                <div class="bg-gradient-to-r from-blue-50 to-indigo-50 p-6 rounded-xl border border-blue-100 text-center relative overflow-hidden">
                    <div class="absolute top-2 right-2 opacity-10">
                        <span class="text-6xl">🌍</span>
                    </div>
                    <h3 class="text-2xl font-bold text-blue-900 mb-2">Welcome to the Competition System!</h3>
                    <p class="text-gray-700 max-w-2xl mx-auto mb-4">
                        This is a comprehensive system for managing carriage driving competitions – from entry to final results.
                        The system is <strong>cloud-based</strong>, meaning all changes happen in real-time ("Live").
                    </p>
                    <div class="inline-flex items-center gap-2 bg-white px-3 py-1 rounded-full border border-blue-200 text-sm text-blue-800 shadow-sm">
                        <span>💡 Tip: Switch language (🇸🇪/🇬🇧) via the flag. Use the moon 🌙 in the menu for Dark Mode.</span>
                    </div>
                </div>
            </section>

            <section>
                <h3 class="font-bold text-lg mb-2 text-indigo-700 border-l-4 border-indigo-500 pl-2">🏠 Main Menu & Navigation</h3>
                <p class="text-gray-700 mb-2">
                    When you start the system, you land in the <strong>Hub</strong>. Here you see a list of all available competitions.
                </p>
                <div class="grid md:grid-cols-2 gap-4">
                    <div class="bg-white p-4 rounded border shadow-sm">
                        <h4 class="font-bold text-gray-800 mb-1">Find Your Competition</h4>
                        <ul class="list-disc list-inside text-sm text-gray-600 space-y-1">
                            <li>Use the <strong>Search box</strong> to filter by name or location.</li>
                            <li>Click on a card to open the competition.</li>
                            <li>The <strong>"Open"</strong> button goes to the public/participant view.</li>
                            <li>The <strong>"Admin"</strong> button (if authorized) goes to the administration view.</li>
                        </ul>
                    </div>
                    <div class="bg-white p-4 rounded border shadow-sm">
                        <h4 class="font-bold text-gray-800 mb-1">Tips & Tricks</h4>
                        <ul class="list-disc list-inside text-sm text-gray-600 space-y-1">
                            <li><strong>Go Back:</strong> Always click the logo (top left) to return to the Hub and switch competitions.</li>
                            <li><strong>Create New:</strong> (Admin only) Use the form in the Hub to start a new competition.</li>
                            <li><strong>Refresh:</strong> The system is "Live". You rarely need to reload the page manually.</li>
                            <li><strong>Mobile Friendly:</strong> On small screens, filter buttons (e.g., "Class") automatically become a dropdown menu to save space.</li>
                        </ul>
                    </div>
                </div>
            </section>

            <section class="grid md:grid-cols-3 gap-6">
                <!-- PRE -->
                <div class="space-y-4">
                    <div class="flex items-center gap-2 mb-2">
                        <div class="bg-blue-600 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold">1</div>
                        <h4 class="font-bold text-gray-800">Before Competition</h4>
                    </div>
                    <div class="bg-white p-4 rounded shadow-sm border-l-4 border-blue-600">
                        <p class="text-sm font-bold text-gray-900">Administrator</p>
                        <p class="text-sm text-gray-600">Creates competition, imports entries, and schedules start times.</p>
                    </div>
                    <div class="flex justify-center text-gray-400">↓</div>
                     <div class="bg-white p-4 rounded shadow-sm border-l-4 border-amber-500">
                        <p class="text-sm font-bold text-gray-900">Driver (My Portal)</p>
                        <p class="text-sm text-gray-600">Logs in, checks their details, and makes any changes (horse sway, groom) before start.</p>
                    </div>
                </div>

                <!-- DURING -->
                <div class="space-y-4">
                    <div class="flex items-center gap-2 mb-2">
                         <div class="bg-green-600 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold">2</div>
                        <h4 class="font-bold text-gray-800">During Competition</h4>
                    </div>
                     <div class="bg-white p-4 rounded shadow-sm border-l-4 border-purple-600">
                        <p class="text-sm font-bold text-gray-900">Judge (Dressage)</p>
                        <p class="text-sm text-gray-600">Judges digitally on iPad. Results are sent directly to the cloud.</p>
                    </div>
                     <div class="bg-white p-4 rounded shadow-sm border-l-4 border-green-600">
                        <p class="text-sm font-bold text-gray-900">Official (Marathon/Precision)</p>
                        <p class="text-sm text-gray-600">Starts clocks and logs knockdowns. Everything syncs live.</p>
                    </div>
                     <div class="bg-white p-4 rounded shadow-sm border-l-4 border-indigo-600">
                        <p class="text-sm font-bold text-gray-900">Speaker</p>
                        <p class="text-sm text-gray-600">Follows the drama live via Dashboard and sees split times.</p>
                    </div>
                </div>

                <!-- POST -->
                <div class="space-y-4">
                    <div class="flex items-center gap-2 mb-2">
                         <div class="bg-gray-800 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold">3</div>
                        <h4 class="font-bold text-gray-800">After Competition</h4>
                    </div>
                     <div class="bg-white p-4 rounded shadow-sm border-l-4 border-gray-800">
                        <p class="text-sm font-bold text-gray-900">Public & Driver</p>
                        <p class="text-sm text-gray-600">See final results online. Driver downloads their protocol.</p>
                    </div>
                     <div class="bg-white p-4 rounded shadow-sm border-l-4 border-blue-900">
                        <p class="text-sm font-bold text-gray-900">Admin (Archiving)</p>
                        <p class="text-sm text-gray-600">Locks the competition and exports official result lists (PDF).</p>
                    </div>
                </div>
            </section>
        </div>
        `;

    case 'admin':
      return `
        <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">For Administrators</h2>
        <div class="space-y-8">
          
          <section>
            <h3 class="font-bold text-lg mb-2 text-blue-700 border-l-4 border-blue-500 pl-2">1. Create & Manage Competition</h3>
            <div class="bg-blue-50 p-4 rounded-lg space-y-2 text-gray-700">
              <p>As administrator, you have full control over the competition setup under the <strong>Start</strong> menu.</p>
              <ul class="list-disc list-inside ml-2">
                <li><strong>Create Competition:</strong> Enter name, date, and location.</li>
                <li><strong>New: Base on previous competition:</strong> Select an old competition in the dropdown to copy settings (Obstacles, Classes, Parameters) to the new one.</li>
                <li><strong>Select Competition:</strong> Click on a competition in the list to make it active and start working on it.</li>
              </ul>
            </div>
          </section>

          <section>
            <h3 class="font-bold text-lg mb-2 text-blue-700 border-l-4 border-blue-500 pl-2">2. The Admin Panel</h3>
            <p class="text-gray-700 mb-2">Go to <strong>Admin</strong> in the menu. There are four main tabs:</p>
            
            <div class="space-y-6">
              <!-- Entries & Data -->
              <div class="bg-white border rounded-lg p-4 shadow-sm">
                <h4 class="font-bold text-gray-800 text-base mb-2">📋 Entries & Data</h4>
                
                <h5 class="text-sm font-bold text-gray-700 mt-2">Manage Participants</h5>
                <ul class="list-disc list-inside text-sm text-gray-600 ml-2 space-y-1">
                  <li><strong>Import:</strong> Upload an <code>.eqentries.xml</code> file to avoid manual data entry.</li>
                  <li><strong>Edit:</strong> Click on an entry in the list. You can change everything from horses to class.
                    <div class="mt-1 ml-4 p-2 bg-gray-50 rounded border text-xs bg-yellow-50 text-yellow-900 border-yellow-200">
                        <strong>Payment:</strong> You can mark status as "Paid", "Partially Paid", or "Unpaid" and enter amount. This is currently <em>not</em> visible to the driver, but for your own control.
                    </div>
                  </li>
                  <li><strong>Scratched:</strong> Change status to "Struken" (Scratched) in the dropdown menu inside the entry details.</li>
                </ul>

                <h5 class="text-sm font-bold text-gray-700 mt-3">Judges & Officials</h5>
                <ul class="list-disc list-inside text-sm text-gray-600 ml-2 space-y-1">
                    <li><strong>Must exist!</strong> To judge dressage or time marathon, the person MUST be added here.</li>
                    <li><strong>Roles:</strong> Ensure correct role assignment (e.g., "Dressage - C" or "Start A").</li>
                    <li><strong>New:</strong> You can now add <strong>ICE Contact</strong>, <strong>Diet/Allergy</strong>, and <strong>T-shirt Size</strong> for each official. This facilitates safety and logistics.</li>
                </ul>

                <h5 class="text-sm font-bold text-gray-700 mt-3">Prints & Lists (For Officials)</h5>
                <p class="text-xs text-gray-600 mb-1">Go to the sub-tab <strong>" 🖨️ Reports"</strong> or <strong>"👀 Overview & Print"</strong>:</p>
                <ul class="list-disc list-inside text-sm text-gray-600 ml-2 space-y-1">
                    <li><strong>Overview (NEW):</strong> Get a print-friendly list grouped by obstacle/location. Use "PDF" for paper or "CSV" for Excel.</li>
                    <li><strong>Officials Lists (PDF/CSV):</strong> Export complete lists with contact info, roles, and extras (diet/shirt) for check-in or distribution.</li>
                    <li><strong>Phone List:</strong> A compact list with all officials' names and phone number.</li>
                    <li><strong>Catering:</strong> A summary of allergies and number of lunches needed.</li>
                    <li><strong>Check-in:</strong> A printable list to tick off arrivals.</li>
                </ul>
              </div>

              <div class="bg-white border rounded-lg p-4 shadow-sm">
                <h4 class="font-bold text-gray-800 text-base mb-2">📢 Communication</h4>
                <p class="text-sm text-gray-600 mb-2">Send messages to driver portals.</p>
                <ul class="list-disc list-inside text-sm text-gray-600 ml-2 space-y-1 mb-3">
                    <li><strong>Broadcast (All):</strong> Send a notification to ALL participants (e.g., regarding time delays).</li>
                    <li><strong>Private Message:</strong> Select a specific driver in the dropdown ("Recipient") to send info concerning only them (e.g., passport/vaccination reminder).</li>
                    <li><strong>Message Types:</strong>
                        <ul class="list-circle list-inside ml-4 text-xs mt-1">
                            <li><strong>Info (Blue):</strong> General information.</li>
                            <li><strong>Important (Red):</strong> Urgent or critical messages that stand out.</li>
                        </ul>
                    </li>
                </ul>
                <h4 class="font-bold text-gray-800 text-sm mb-2">📂 Documents & Course Maps</h4>
                <p class="text-xs text-gray-600 mb-3">You can link external files that appear in the driver portal (e.g., PDF maps from Google Drive/Dropbox).</p>
                <div class="bg-yellow-50 p-2 rounded text-xs text-yellow-800 border border-yellow-100 space-y-2">
                    <p><strong>Tip 1:</strong> Ensure the link is public ("Anyone with the link can view"). Choose category "Course Map" for the correct icon.</p>
                    <p><strong>Tip 2:</strong> Select <strong>Type: "Text / HTML"</strong> to create a simple info page (e.g., "Warm-up Rules") directly in the system without uploading a file.</p>
                </div>
              </div>

              <!-- Settings -->
              <div class="bg-white border rounded-lg p-4 shadow-sm">
                <h4 class="font-bold text-gray-800 text-base mb-2">⚙️ Settings</h4>
                <div class="space-y-2 text-sm text-gray-600">
                  <p><strong>Competition Level (FEI/National):</strong> Affects which PDF templates are used. FEI gives English headers.</p>
                  <p><strong>Digital Declaration & Locking:</strong></p>
                  <ul class="list-circle list-inside ml-4 mt-1 text-xs text-gray-500">
                    <li><strong>Timer:</strong> Set how many minutes before start the portal should lock (default 60 min).</li>
                    <li><strong>Emergency Lock:</strong> Button "Lock all changes NOW" freezes start lists immediately.</li>
                  </ul>
                  <p class="mt-2"><strong>Global Settings (Precision):</strong></p>
                  <ul class="list-circle list-inside ml-4 mt-1 text-xs text-gray-500">
                    <li>Here you can change penalty points for knockdowns (e.g., 3 or 4 points) and time faults per second. Applies to all classes unless otherwise specified.</li>
                  </ul>
                </div>
              </div>

              <!-- Archiving -->
              <div class="bg-white border rounded-lg p-4 shadow-sm">
                <h4 class="font-bold text-gray-800 text-base mb-2">📦 Archiving & Printing</h4>
                <ul class="list-disc list-inside text-sm text-gray-600 ml-2 mt-1">
                    <li><strong>End Competition:</strong> Locks all results so no further changes can occur. Generates "Master List" (PDF).</li>
                    <li><strong>Printing:</strong> Go to the respective result page (Start Lists, Dressage Protocols, etc.) and use user browser "Print" or "Save as PDF". System is adapted for A4.</li>
                </ul>
              </div>
            </div>
          </section>
          
          <section>
            <h3 class="font-bold text-lg mb-2 text-orange-700 border-l-4 border-orange-500 pl-2">3. Admin: Course Data (Maraton/Precision)</h3>
            <p class="text-gray-700 mb-2">For the system to calculate times and penalties correctly, you must set course data.</p>
            
            <div class="grid md:grid-cols-2 gap-4 text-sm text-gray-700">
                <div class="bg-orange-50 p-4 rounded border border-orange-200">
                    <strong class="block text-orange-900 mb-2">🌲 Marathon: Sections & Times</strong>
                    <ul class="list-disc list-inside space-y-1">
                        <li>Go to tab <strong>Maraton</strong> in Admin.</li>
                        <li>Fill in <strong>Length (m)</strong> and <strong>Speed</strong> for Section A, Transfer, and Section B.</li>
                        <li>The system automatically calculates <em>Ideal Time</em>, <em>Max Time</em>, and <em>Minimum Time</em>.</li>
                        <li><strong>Important:</strong> Do this BEFORE competition starts! Otherwise, officials get no time windows.</li>
                    </ul>
                </div>
                <div class="bg-purple-50 p-4 rounded border border-purple-200">
                    <strong class="block text-purple-900 mb-2">🏁 Precision: Max Time & Width</strong>
                    <ul class="list-disc list-inside space-y-1">
                        <li>Go to tab <strong>Precision</strong> in Admin.</li>
                        <li>Enter <strong>Course Length</strong> and <strong>Speed</strong> (or set a fixed Max Time manually).</li>
                        <li>Enter <strong>Gate Width</strong> (e.g., Carriage Width + 20cm).</li>
                        <li>This controls when the clock turns red (Time Faults) on the monitor.</li>
                    </ul>
                </div>
            </div>
          </section>

          <section>
            <h3 class="font-bold text-lg mb-2 text-indigo-700 border-l-4 border-indigo-500 pl-2">4. Marathon: Special Classes & Tempo</h3>
            <p class="text-gray-700 mb-2">How to handle mixed classes, para-drivers, and children's classes.</p>
            
            <div class="space-y-4">
              <!-- Mixed Classes -->
              <div class="bg-white border rounded p-4 shadow-sm">
                  <strong class="text-indigo-900 block font-bold mb-1">1. Mixed / Combined Classes</strong>
                  <p class="text-sm text-gray-700 mb-2">If a class contains mixed categories (e.g., Pony & Horse) but should follow a specific rule set (e.g., "Lätt B"):</p>
                  <ul class="list-disc list-inside text-sm text-gray-700 ml-2">
                      <li>Go to <strong>Marathon Settings</strong>.</li>
                      <li>Select the correct level in the <strong>"Tempo Template"</strong> dropdown (e.g., "Lätt B").</li>
                      <li>The system automatically calculates the correct ideal time for Pony A, Pony B, Horse, etc.</li>
                  </ul>
              </div>

              <!-- Para -->
              <div class="bg-white border rounded p-4 shadow-sm">
                  <strong class="text-indigo-900 block font-bold mb-1">2. Para-Drivers (Exception)</strong>
                  <p class="text-sm text-gray-700 mb-2">If a single driver in a normal class needs Para-tempo:</p>
                  <ul class="list-disc list-inside text-sm text-gray-700 ml-2">
                      <li>Go to <strong>Participants</strong> and edit the driver.</li>
                      <li>Check the box <strong>"Para Driver"</strong>.</li>
                      <li>They automatically get their class level adjusted for Para rules.</li>
                  </ul>
              </div>

              <!-- Barnklass -->
              <div class="bg-white border rounded p-4 shadow-sm">
                  <strong class="text-indigo-900 block font-bold mb-1">3. Children's Class ("Barnklass")</strong>
                  <ul class="list-disc list-inside text-sm text-gray-700 ml-2">
                      <li>Select <strong>"Barnklass"</strong> in the "Tempo Template" dropdown.</li>
                      <li>Automatically looks up <strong>10 minutes Warm-up</strong> (Fixed Time).</li>
                      <li>Tempo is set according to Barnklass rules (Lätt B speeds).</li>
                  </ul>
              </div>
              
                <!-- Warm-up -->
              <div class="bg-white border rounded p-4 shadow-sm">
                  <strong class="text-indigo-900 block font-bold mb-1">4. Warm-up (Instead of Section A)</strong>
                  <p class="text-sm text-gray-700 mb-2">To turn Section A into a pure warm-up:</p>
                  <ul class="list-disc list-inside text-sm text-gray-700 ml-2">
                      <li>Go to <strong>Marathon Settings</strong>.</li>
                      <li>Enter minutes in the box <strong>"Fixed Time (WU)"</strong> (e.g., 30).</li>
                      <li>The section is renamed "Warm-up" and gets a fixed time without windows.</li>
                  </ul>
              </div>
            </div>
          </section>

          <section>
            <h3 class="font-bold text-lg mb-2 text-purple-700 border-l-4 border-purple-500 pl-2">5. Dressage: Advanced</h3>
            <div class="bg-purple-50 p-4 rounded-lg space-y-4 text-gray-700">
              <div>
                <strong class="text-purple-900 block font-bold">📄 PDF Import of Programs</strong>
                <p class="text-sm">You don't need to type in every movement manually! Upload the program's official PDF, and the system "reads" the text and creates the protocol for you.</p>
              </div>
              <div>
                <strong class="text-purple-900 block font-bold">👨‍⚖️ Judge Assignment</strong>
                <p class="text-sm">Choose <strong>Admin > Dressage</strong> to control which judges (C, E, H) judge which class. System tracks qualifications.</p>
              </div>
              <div>
                <strong class="text-purple-900 block font-bold">✨ Clear Round / Pay & Drive</strong>
                <p class="text-sm">For training classes, you can enable "Clear Round". This hides exact penalties from the public and replaces them with "Approved" if the driver's percentage is above your chosen limit (e.g., 60%).</p>
              </div>
            </div>
          </section>

            <section>
              <h3 class="font-bold text-lg mb-2 text-blue-700 border-l-4 border-blue-500 pl-2">5. Manage Start Times</h3>
              <p class="text-gray-700 mb-2">Go to <strong>Start Times</strong> to schedule starts.</p>
              <div class="bg-gray-50 p-3 rounded text-sm text-gray-700">
                  <strong>Tips for smooth planning:</strong>
                  <ol class="list-decimal list-inside mt-1 ml-2">
                      <li>Select classes and set an interval (e.g., 10 min).</li>
                      <li>Click "Generate".</li>
                      <li><strong>Drag and drop:</strong> You can grab a row and move it up/down to fine-tune start order <em>before</em> saving.</li>
                      <li><strong>Insert Pause:</strong> Click the coffee cup <span class="text-sm">☕</span> on a row to insert a break (e.g., 15 min) <em>after</em> that driver. All subsequent times are pushed forward.</li>
                      <li>Don't forget <strong>"Save & Publish"</strong>! Before that, no one sees the times.</li>
                      <li><strong>New:</strong> The "Publish Startlist" toggle makes times visible to the public. You can work on the schedule privately until you switch this on.</li>
                  </ol>
                  
                  <h4 class="font-bold text-gray-800 text-sm mt-3 mb-1">🔥 Advanced Generation</h4>
                  <p class="text-xs text-gray-600 mb-2">For Marathon and Precision, you can let previous results dictate start order:</p>
                  <ul class="list-disc list-inside text-xs text-gray-600 space-y-1 ml-1">
                      <li><strong>Marathon after Dressage:</strong> Worst dressage result starts first (or vice versa).</li>
                      <li><strong>Precision ("Reverse Order"):</strong> To create suspense, you can let those with the <em>worst</em> total result (Dressage + Marathon) start first, so the leader starts last. Choose "Sort by Result" in settings.</li>
                  </ul>
              </div>
            </section>

            <section>
              <h3 class="font-bold text-lg mb-2 text-green-700 border-l-4 border-green-500 pl-2">6. Admin: Marathon (Map)</h3>
              <p class="text-gray-700 mb-2">For "Monitor Marathon" (public screen) to show a nice map:</p>
              <div class="bg-green-50 p-4 rounded-lg space-y-3 text-sm text-gray-700">
                  <div>
                      <strong class="text-green-900 font-bold block">1. Upload Image</strong>
                      <ul class="list-disc list-inside ml-2">
                          <li>Upload your course map (image) to <strong>Google Drive</strong>.</li>
                          <li>Right-click file in Drive -> "Share" -> "Copy link" (Anyone with link).</li>
                          <li>In system: Click button <strong>"📁 G-Drive"</strong> and paste link. System converts it automatically to an image link.</li>
                      </ul>
                  </div>
                  <div>
                      <strong class="text-green-900 font-bold block">2. Place Obstacles</strong>
                      <ul class="list-disc list-inside ml-2">
                          <li>Select what you want to place in dropdown (e.g., "Obstacle 1").</li>
                          <li>Click a point on the map preview.</li>
                          <li>A red dot appears. Coordinates save automatically.</li>
                          <li>Repeat for all obstacles, start, and finish.</li>
                      </ul>
                  </div>
              </div>
            </section>

          <section>
            <h3 class="font-bold text-lg mb-2 text-blue-700 border-l-4 border-blue-500 pl-2">7. Correcting Results</h3>
            <p class="text-gray-700 mb-2">If a dressage protocol was signed incorrectly, you can reopen it.</p>
            <div class="bg-red-50 p-4 rounded-lg space-y-2 border border-red-100">
                <h4 class="font-bold text-red-800 text-sm">Unlock ("Unfinalize") Protocol</h4>
                <ol class="list-decimal list-inside text-sm text-gray-700 ml-2">
                    <li>Go to <strong>Results > Dressage</strong>.</li>
                    <li>Find the entry in the list.</li>
                    <li>In the column far right ("Finalize"), click button <span class="border border-emerald-600 text-emerald-700 px-1 rounded text-xs">Undo</span>.</li>
                    <li>Protocol is now "open" again and judge can make changes in iPad.</li>
                </ol>
            </div>
          </section>

          <section>
            <h3 class="font-bold text-lg mb-2 text-cyan-700 border-l-4 border-cyan-500 pl-2">8. Teams & Groups</h3>
            <p class="text-gray-700 mb-2">Here you manage the team competition. Go to the <strong>Teams</strong> tab in Admin.</p>
            
            <div class="space-y-4">
                <div class="bg-cyan-50 p-4 rounded border border-cyan-200">
                    <strong class="text-cyan-900 block font-bold mb-1">Create & Manage Teams</strong>
                    <ul class="list-disc list-inside text-sm text-gray-700 ml-2">
                        <li><strong>Activate:</strong> Switch on "Activate Team Competition" at the top.</li>
                        <li><strong>Create Team:</strong> Click "New Team", enter name, and save.</li>
                        <li><strong>Add Drivers:</strong>
                            <ul class="list-circle list-inside ml-4 mt-1">
                                <li>On the right, you see a list of available drivers ("Unassigned").</li>
                                <li><strong>Drag-and-Drop:</strong> Grab a driver card and drag it to the desired team box. Drop to add.</li>
                                <li>You can also drag drivers <em>between</em> teams to move them.</li>
                            </ul>
                        </li>
                    </ul>
                </div>

                <div class="bg-white border rounded p-4 shadow-sm">
                    <strong class="text-gray-800 block font-bold mb-1">Flags & Logos</strong>
                    <p class="text-sm text-gray-600 mb-2">The system automatically tries to match team assets:</p>
                    <ul class="list-disc list-inside text-sm text-gray-600 ml-2">
                        <li><strong>Club Logo:</strong> If the team name matches a club (e.g., "Körsällskapet ..."), the club logo is shown.</li>
                        <li><strong>National Flag:</strong> If the team is named after a country (e.g., "Sweden", "Denmark", "Germany"), the flag is shown.</li>
                    </ul>
                    <p class="text-xs text-gray-500 mt-2">
                        <em>Tip: Drivers display their own flags/logos based on their profile data (Nationality/Club).</em>
                    </p>
                </div>
            </div>
          </section>
        </div>
      `;

    case 'official':
      return `
        <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">For Officials</h2>
        <div class="space-y-8">

          <!-- DASHBOARD -->
          <section>
            <h3 class="font-bold text-lg mb-2 text-indigo-700 border-l-4 border-indigo-500 pl-2">Overview & Dashboard</h3>
            <p class="text-gray-700 mb-2">When you log in as an official, you are greeted by a <strong>Dashboard</strong> giving you a quick overview.</p>
            <div class="bg-indigo-50 p-4 rounded-lg space-y-3">
              <ul class="list-disc list-inside text-sm text-gray-700 space-y-2">
                <li><strong>Next Start:</strong> Shows which equipage is up next for you (based on your role). Click "Go to..." to jump directly to the input screen for that driver.</li>
                <li><strong>To Do / Sync:</strong> Shows if you have any protocols or times pending upload (Sync Queue).</li>
                <li><strong>Shortcuts:</strong> Direct access to the tools you need (e.g., Timing, Obstacles, Vet Check).</li>
              </ul>
            </div>
          </section>
          
          <section>
            <h3 class="font-bold text-lg mb-2 text-green-700 border-l-4 border-green-500 pl-2">Marathon: Timing (Positions)</h3>
            <p class="text-gray-700 mb-2">For Start/Finish A, B, etc.</p>
            <div class="bg-green-50 p-4 rounded-lg space-y-3">
                <h4 class="font-semibold text-green-800">Workflow:</h4>
                <ol class="list-decimal list-inside space-y-2 text-gray-700">
                    <li><strong>Log in:</strong> Ensure you are logged in (top right).</li>
                    <li><strong>Select View:</strong> Choose <strong>Marathon Timing</strong> in the menu.</li>
                    <li><strong>Select Position:</strong> Choose which line you are manning (e.g., "Start B").</li>
                    <li><strong>Timing:</strong>
                        <ul class="list-disc list-inside ml-5 mt-1">
                            <li>Wait for the equipage.</li>
                            <li><strong>Tap the big green CLOCK icon</strong> exactly when the nose crosses the line.</li>
                            <li><em>Correction:</em> If you tapped too early/late, you can adjust the time manually in the list below.</li>
                        </ul>
                    </li>
                    <li><strong>Active Timers:</strong> The dropdown at the top shows currently running clocks. It allows you to start #1, switch to #2, while still seeing #1 ticking.</li>
                    <li>
                      <strong class="text-red-800">Global Pause:</strong>
                      <br><span class="ml-4">If the screen turns grey, the competition is <strong>PAUSED</strong>. Do not time anything.</span>
                    </li>
                </ol>
            </div>
          </section>

          <section>
            <h3 class="font-bold text-lg mb-2 text-blue-700 border-l-4 border-blue-500 pl-2">Maraton: Obstacles (Tablet)</h3>
            <p class="text-gray-700 mb-2">For obstacle judges.</p>
            <ol class="list-decimal list-inside space-y-2 text-gray-700 bg-white p-4 border rounded shadow-sm">
                <li><strong>Select View:</strong> Choose <strong>Obstacle Input</strong> in the menu.</li>
                <li><strong>Select Obstacle:</strong> Choose your obstacle number (e.g., "Hinder 1").</li>
                <li><strong>Timing:</strong>
                     <ul class="list-disc list-inside ml-5 mt-1">
                        <li>Tap <strong>START</strong> when the horse's nose enters the entry gate ("A-port").</li>
                        <li>Tap <strong>STOP</strong> when the horse's nose leaves the exit gate ("B-port").</li>
                    </ul>
                </li>
                <li><strong>Penalties:</strong>
                     <ul class="list-disc list-inside ml-5 mt-1">
                        <li><strong>Groom Down/Knockdown:</strong> Tap the buttons to log incidents.</li>
                        <li><strong>Wrong Course:</strong> If they drive wrong, mark "Vägfel".</li>
                    </ul>
                </li>
                <li><strong>SAVE:</strong> Click "Save Result". The row turns green in the list.</li>
            </ol>
          </section>

          <section>
             <h3 class="font-bold text-lg mb-2 text-purple-700 border-l-4 border-purple-500 pl-2">Precision (Cones) Input</h3>
             <ul class="list-disc list-inside text-gray-700 text-sm bg-white p-4 border rounded shadow-sm">
                <li>Select <strong>Precision Input</strong>.</li>
                <li><strong>Timer:</strong> Works like a stopwatch. Start when nose crosses start, Stop when nose crosses finish.</li>
                <li><strong>Balls Down:</strong> Tap the ball numbers (1, 2, 3...) that correspond to the cone numbers knocked down. Each tap adds +3 points.</li>
                <li><strong>Save:</strong> Click Save to publish the result live to the scoreboard.</li>
             </ul>
          </section>

          <section>
            <h3 class="font-bold text-lg mb-2 text-gray-700 border-l-4 border-gray-500 pl-2">Special Features (Inspection)</h3>
            
            <div class="grid md:grid-cols-2 gap-6">
                <!-- Vet -->
                <div class="bg-gray-50 p-4 rounded-lg border border-gray-200">
                    <h4 class="font-bold text-gray-800 flex items-center gap-2">🩺 Veterinarian</h4>
                    <p class="text-sm text-gray-600 mb-2">Used during check-in/pre-inspection.</p>
                    <ul class="list-disc list-inside text-sm text-gray-700 space-y-1">
                        <li><strong>Search Entry:</strong> Type name or number to find the horse, or select directly from the dropdown list!</li>
                        <li><strong>Status:</strong>
                            <ul class="list-disc list-inside ml-4 text-xs mt-1">
                                <li><strong>Approved (Green):</strong> Horse is OK to start.</li>
                                <li><strong>Hold (Yellow):</strong> Uncertain status, sent to Holding Box.</li>
                                <li><strong>Scratched (Red):</strong> Horse may not start.</li>
                            </ul>
                        </li>
                        <li><strong>Notes:</strong> You can enter observations (e.g., wounds) that are saved on the entry.</li>
                    </ul>
                </div>

                <!-- Carriage & Function -->
                <div class="bg-gray-50 p-4 rounded-lg border border-gray-200">
                    <h4 class="font-bold text-gray-800 flex items-center gap-2">⚖️ Carriage & Function</h4>
                    <p class="text-sm text-gray-600 mb-2">Measuring carriage width and safety check.</p>
                    <ul class="list-disc list-inside text-sm text-gray-700 space-y-1">
                        <li><strong>Measurement:</strong> Enter width for Precision and Marathon. System warns if width is too narrow according to rules (Width + 20cm).</li>
                        <li><strong>Safety Check:</strong> Check "Carriage Approved" if equipment is correct.</li>
                        <li><strong>Save:</strong> Press Enter or click Save to jump to the next entry.</li>
                    </ul>
                </div>
            </div>
          </section>
        </div>`;

    case 'judge':
      return `
        <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">For Judges (Dressage)</h2>
        <div class="space-y-8">
           <section>
            <h3 class="font-bold text-lg mb-2 text-purple-700 border-l-4 border-purple-500 pl-2">Digital Protocols (iPad)</h3>
            <p class="text-gray-700 mb-2">Forget paper! You judge directly on the screen.</p>
            
            <div class="bg-purple-50 p-4 rounded-lg space-y-3 border border-purple-100">
                <h4 class="font-bold text-purple-900 text-sm">Typical Workflow:</h4>
                <ol class="list-decimal list-inside space-y-2 text-gray-700 text-sm">
                    <li><strong>Log in:</strong> You will receive a login from the organizer (or select your name in the list if open).</li>
                    <li><strong>Select View:</strong> Choose <strong>"Judge Dressage"</strong>.</li>
                    <li><strong>Select Current Drive:</strong> Click on the equipage currently on track.</li>
                    <li><strong>Scoring:</strong>
                        <ul class="list-disc list-inside ml-5 mt-1">
                            <li><strong>Points:</strong> Enter 0-10. Decimals (e.g., 6.5) work fine.</li>
                            <li><strong>Comments:</strong> Type comments in the text box.</li>
                            <li><strong>Navigation:</strong> Use the <code>TAB</code> key to jump to comment, and <code>ENTER</code> to jump to the next movement.</li>
                        </ul>
                    </li>
                    <li><strong>Sign & Save:</strong> When finished, scroll down. Sign with your signature (scribble with finger) and click <strong>"Sign Protocol"</strong>.</li>
                </ol>
            </div>
           </section>

           <section class="bg-white p-4 rounded border-l-4 border-red-500 shadow-sm">
             <h4 class="font-bold text-red-800 text-sm flex items-center gap-2">
                <span>📡</span> Offline Mode / No Internet
             </h4>
             <p class="text-sm text-red-900 mt-1">
                If the internet goes down, <strong>DO NOT CLOSE THE PAGE</strong>.
                Continue judging as usual. The button will say "Save Locally (Queue)".
                When internet returns, the system automatically uploads all saved protocols.
             </p>
           </section>

           <section>
                <h3 class="font-bold text-lg mb-2 text-gray-700 border-l-4 border-gray-500 pl-2">Common Errors & Course Errors</h3>
                <div class="bg-gray-50 p-4 rounded text-sm text-gray-700 border">
                    <p class="mb-2"><strong>First Error (-5):</strong> Click the button "-5" at the top.</p>
                    <p class="mb-2"><strong>Second Error (-10):</strong> Click the button again.</p>
                    <p><strong>Elimination:</strong> Explain why in the "General Comments" at the bottom and click "Eliminate".</p>
                </div>
           </section>
        </div>`;

    case 'driver':
      return `
        <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">For Drivers</h2>
        <div class="space-y-8">
            <section>
                <h3 class="font-bold text-lg mb-2 text-amber-700 border-l-4 border-amber-500 pl-2">My Portal (The App)</h3>
                <p class="text-gray-700 mb-2">
                    As a driver, you have your own protected page. Access it by logging in with exactly the same <strong>email address</strong> you used when registering in the entry system.
                </p>
                 <div class="bg-amber-50 p-6 rounded-lg space-y-4 border border-amber-200">
                     <h4 class="font-bold text-amber-900">What you can do here:</h4>
                     <ul class="list-disc list-inside text-sm text-gray-800 space-y-2">
                        <li><strong>Start Times:</strong> See exactly when you start in all disciplines.</li>
                        <li><strong>Live Results:</strong> Your result appears here immediately after you finish.</li>
                        <li><strong>Digital Self-Declaration:</strong>
                            <p class="text-xs text-gray-600 ml-5 mt-1">
                                Instead of paper forms! Change Horse, Carriage, Groom, or Wheel Width.
                                <br><span class="font-bold text-red-600">Note:</span> Logic locks 60 minutes before your start time. After that, you must visit the Secretariat.
                            </p>
                        </li>
                        <li><strong>Vet Control:</strong> See if your horse is "Accepted" or "Holding Box".</li>
                        <li><strong>Speaker Notes:</strong> Write a fun text about your horse/groom for the speaker to read during your drive.</li>
                        <li><strong>Protocols:</strong> After the class is finished, download your Dressage Protocol (PDF) directly to your phone.</li>
                     </ul>
                 </div>
            </section>

             <section>
                <h3 class="font-bold text-lg mb-2 text-blue-700 border-l-4 border-blue-500 pl-2">Results & Messages</h3>
                <div class="space-y-4 text-gray-700">
                    <ul class="list-disc list-inside ml-2">
                        <li><strong>Messages:</strong> Receive personal messages (just to you) and broadcasts (to everyone).</li>
                    </ul>
                    
                    <div class="bg-gray-50 p-4 rounded-lg">
                        <h4 class="font-bold text-gray-800 mb-2">FAQ</h4>
                        <details class="group cursor-pointer mb-2">
                            <summary class="font-medium text-gray-700 list-none flex items-center justify-between border-b pb-1">
                                <span>Why can't I change my horse?</span>
                                <span class="transition group-open:rotate-180">▼</span>
                            </summary>
                            <p class="text-gray-600 mt-2 text-sm">
                                The portal locks automatically a set time (often 60 min) before your start. Contact the secretariat for urgent changes.
                            </p>
                        </details>
                        <details class="group cursor-pointer">
                            <summary class="font-medium text-gray-700 list-none flex items-center justify-between border-b pb-1">
                                <span>I can't see my competition?</span>
                                <span class="transition group-open:rotate-180">▼</span>
                            </summary>
                            <p class="text-gray-600 mt-2 text-sm">
                                Try clicking <strong>"Find my entries again"</strong> in the portal. Ensure you are logged in with the email used for entry.
                            </p>
                        </details>
                    </div>
                </div>
            </section>
        </div>`;

    case 'speaker':
      return `
        <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">For Speaker</h2>
        <div class="space-y-8">
            <section>
                <h3 class="font-bold text-lg mb-2 text-indigo-700 border-l-4 border-indigo-500 pl-2">The Dashboard</h3>
                <p class="text-gray-700 mb-4">
                    The Speaker Dashboard is your command center. You don't need to jump between pages – everything automagically appears here.
                </p>
                
                <div class="bg-white border p-4 rounded-lg shadow-sm">
                    <ul class="list-none space-y-4 text-gray-700 text-sm">
                        <li class="flex items-start gap-3">
                            <span class="text-2xl">🎤</span>
                            <div>
                                <strong>Speaker Notes:</strong> 
                                <p class="text-gray-600">When a driver enters the arena/course, their "Bio" (fun facts) pops up automatically.</p>
                            </div>
                        </li>
                        <li class="flex items-start gap-3">
                            <span class="text-2xl">🗺️</span>
                            <div>
                                <strong>Interactive Map (Marathon):</strong> 
                                <p class="text-gray-600">You see tracking dots moving on the map. Click a dot to see details.</p>
                            </div>
                        </li>
                        <li class="flex items-start gap-3">
                            <span class="text-2xl">⏱️</span>
                            <div>
                                <strong>Live Data:</strong> 
                                <p class="text-gray-600">Intermediate times and faults appear instantly.</p>
                            </div>
                        </li>
                    </ul>
                </div>
            </section>

          <section>
             <h3 class="font-bold text-lg mb-2 text-blue-700 border-l-4 border-blue-500 pl-2">Marathon: Command Center</h3>
             <p class="text-sm text-gray-600 mb-4">The Marathon view is extra detailed. Tools:</p>

             <div class="space-y-6">
                 
                 <!-- Obstacle Focus -->
                 <div class="bg-white border p-4 rounded shadow-sm">
                     <h4 class="font-bold text-gray-800 flex items-center gap-2">
                        🎯 Obstacle Focus
                        <span class="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full uppercase">New</span>
                     </h4>
                     <p class="text-gray-600 text-sm mt-1 mb-2">You can "lock" the view to a specific obstacle (e.g., Water Obstacle).</p>
                     <ul class="list-disc list-inside text-gray-600 text-sm ml-2">
                         <li>Use the dropdown <strong>"Select Obstacle"</strong> top left.</li>
                         <li>The view now shows only times and events for this obstacle.</li>
                     </ul>
                 </div>

                 <!-- Edit Notes -->
                 <div class="bg-white border p-4 rounded shadow-sm">
                     <h4 class="font-bold text-gray-800">📝 Edit Notes Live</h4>
                     <p class="text-gray-600 text-sm mt-1 mb-2">Change or add speaker notes live.</p>
                     <ol class="list-decimal list-inside text-gray-600 text-sm ml-2 space-y-1">
                         <li>Click the button <strong>"✎ Edit"</strong> by the notes.</li>
                         <li>Type new text in the box and click <strong>Save</strong>.</li>
                     </ol>
                 </div>
             </div>
          </section>

          <section>
            <h3 class="font-bold text-lg mb-2 text-green-700 border-l-4 border-green-500 pl-2">Leaderboards & Filtering</h3>
             <ul class="list-disc list-inside text-gray-700 ml-2 space-y-2">
                <li><strong>Leaderboard (Right side):</strong> Updates live with current standings.</li>
                <li><strong>Change Class:</strong> Click the dropdown at the top of the leaderboard to flip between classes.</li>
                <li><strong>In Progress:</strong> The entry currently driving is marked in <span class="bg-blue-100 text-blue-800 px-1 rounded font-bold text-xs">BLUE</span>.</li>
             </ul>
          </section>
        </div>`;

    case 'observer':
      return `
        <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">For Observers</h2>
        <div class="space-y-8">
             <section>
                <h3 class="font-bold text-lg mb-2 text-red-700 border-l-4 border-red-500 pl-2">Emergency & Safety</h3>
                <p class="text-gray-700 mb-2">As a Technical Delegate or Safety Officer.</p>
                
                <div class="bg-red-50 p-6 rounded-lg border-2 border-red-500 mt-4">
                    <div class="flex items-center gap-3 mb-4">
                        <span class="text-4xl">🛑</span>
                        <h4 class="font-bold text-red-900 text-xl">PAUSE COMPETITION</h4>
                    </div>
                    
                    <p class="text-red-900 font-bold mb-2">If a serious accident occurs:</p>
                    <ol class="list-decimal list-inside text-red-900 font-semibold space-y-1">
                        <li>Press the BIG RED BUTTON available in your view.</li>
                        <li>Confirm the action.</li>
                    </ol>
                    <p class="text-red-800 mt-2 text-sm italic">Stops all timers system-wide.</p>
                </div>
            </section>

            <section>
                <h3 class="font-bold text-lg mb-2 text-orange-700 border-l-4 border-orange-500 pl-2">Log Events (Wrong Gait / Halt)</h3>
                <p class="text-gray-700 mb-4">Used to note unauthorized gaits or halts on the section.</p>

                <div class="bg-white border p-4 rounded shadow-sm space-y-4">
                    
                    <div>
                        <h4 class="font-bold text-gray-800 border-b pb-1 mb-2">1. Select Entry</h4>
                        <p class="text-sm text-gray-600">Choose the entry you are observing in the dropdown (e.g., "Start no 15").</p>
                    </div>

                    <div class="grid md:grid-cols-2 gap-6">
                        <!-- Wrong Gait -->
                        <div class="bg-orange-50 p-3 rounded">
                            <strong class="block text-orange-900 mb-2">🐎 Wrong Gait (Time)</strong>
                            <ul class="list-disc list-inside text-sm text-gray-700 space-y-2">
                                <li>Press <span class="bg-orange-500 text-white px-2 py-0.5 rounded font-bold">START</span> when horse breaks into canter.</li>
                                <li>Press <span class="bg-red-600 text-white px-2 py-0.5 rounded font-bold">STOP</span> when horse returns to trot.</li>
                                <li>The time is saved automatically.</li>
                            </ul>
                        </div>

                        <!-- Halt -->
                        <div class="bg-blue-50 p-3 rounded">
                            <strong class="block text-blue-900 mb-2">🛑 Halt (Penalty)</strong>
                            <ul class="list-disc list-inside text-sm text-gray-700 space-y-2">
                                <li>Press <span class="bg-blue-600 text-white px-2 py-0.5 rounded font-bold">REGISTER HALT</span> if entry stops.</li>
                                <li>Add a comment/reason in the popup.</li>
                                <li>Click "Save". Penalty points are added.</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </section>
        </div>`;

    default:
      return '<p>Select a role above.</p>';
  }
}
