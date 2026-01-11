import { isMobile } from '../utils/sharedUtils.js';

let activeTab = 'admin'; // 'admin', 'official', 'judge', 'driver'

export async function load(container) {
    if (!container) return;
    render(container);
}

function render(container) {
    const isMob = isMobile();

    const content = `
    <div class="max-w-4xl mx-auto px-4 py-6">
      <h1 class="text-2xl font-bold mb-4 text-gray-800">Användarmanual</h1>
      <p class="text-gray-600 mb-6">Välj din roll nedan för att se instruktioner och guider.</p>

      <!-- TABS -->
      <div class="flex flex-wrap gap-2 mb-6 border-b border-gray-200 pb-2 overflow-x-auto whitespace-nowrap scrollbar-hide">
        ${renderTabBtn('admin', 'Administratör')}
        ${renderTabBtn('official', 'Funktionär')}
        ${renderTabBtn('judge', 'Domare')}
        ${renderTabBtn('driver', 'Kusk/Deltagare')}
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
    switch (tab) {
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
                <li><strong>Välj Tävling:</strong> Klicka på en tävling i listan för att göra den aktiv och börja arbeta med den.</li>
              </ul>
            </div>
          </section>

          <section>
            <h3 class="font-bold text-lg mb-2 text-blue-700 border-l-4 border-blue-500 pl-2">2. Administrationspanelen</h3>
            <p class="text-gray-700 mb-2">Gå till <strong>Admin</strong> i menyn. Här finns fyra huvudflikar:</p>
            
            <div class="space-y-4">
              <div class="bg-white border rounded-lg p-3 shadow-sm">
                <h4 class="font-bold text-gray-800">Anmälan & Data</h4>
                <ul class="list-disc list-inside text-sm text-gray-600 ml-2 mt-1">
                  <li><strong>Importera:</strong> Ladda upp en <code>.eqentries.xml</code>-fil för att massimportera ekipage.</li>
                  <li><strong>Hantera Ekipage:</strong> Lägg till nya manuellt eller redigera befintliga (klicka på dem i listan).</li>
                  <li><strong>Domare & Funktionärer:</strong> Lägg till juryn och nyckelfunktionärer så att de blir valbara i protokollen.</li>
                </ul>
              </div>

              <div class="bg-white border rounded-lg p-3 shadow-sm">
                <h4 class="font-bold text-gray-800">Inställningar</h4>
                <ul class="list-disc list-inside text-sm text-gray-600 ml-2 mt-1">
                  <li><strong>Tävlingsnivå:</strong> Växla mellan Nationell (SvRF) och Internationell (FEI) för att anpassa kolumner och PDF:er.</li>
                  <li><strong>Digital Deklarering:</strong> Styr när "Min Portal" låses för kuskar (t.ex. 60 min före start).</li>
                </ul>
              </div>

              <div class="bg-white border rounded-lg p-3 shadow-sm">
                <h4 class="font-bold text-gray-800">Arkivering</h4>
                <p class="text-sm text-gray-600 mt-1">
                  När tävlingen är slut, klicka på <strong>Avsluta Tävling</strong>. 
                  Detta låser resultaten och genererar en komplett Resultat-PDF.
                </p>
              </div>
            </div>
          </section>

          <section>
            <h3 class="font-bold text-lg mb-2 text-blue-700 border-l-4 border-blue-500 pl-2">3. Hantera Starttider</h3>
            <p class="text-gray-700 mb-2">Gå till <strong>Starttider</strong> för att schemalägga starterna.</p>
            <ul class="list-decimal list-inside text-gray-700 ml-2 space-y-1">
               <li>Välj vilka klasser som ska starta.</li>
               <li>Ange första starttid och tidsintervall (minuter).</li>
               <li>Klicka <strong>Generera</strong> och sedan <strong>Spara & Publicera</strong>.</li>
            </ul>
          </section>
        </div>
      `;

        case 'official':
            return `
        <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">För Funktionärer</h2>
        <div class="space-y-8">
          
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
                    <li><strong>Eliminering:</strong> Kryssa i rutan "Eliminerad" om ekipaget utesluts (t.ex. vält vagn, ej rättad felkörning).</li>
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
                  <strong>Under ritten:</strong>
                  <ul class="list-disc list-inside ml-4 mt-1 text-sm">
                    <li>Fyll i poäng (0-10) för varje moment. Använd HEL- eller HALV-poäng (t.ex. 6, 6.5, 7).</li>
                    <li>Systemet autosparar ("Heartbeat") var 30:e sekund och vid varje fältbyte, så att publiken kan följa live (om aktiverat).</li>
                    <li>Lägg till <strong>Kommentarer</strong> vi behov genom att klicka på "💬 Kom.".</li>
                  </ul>
                </li>
                <li>
                  <strong>Vid felridning:</strong>
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
        </div>
      `;

        case 'driver':
            return `
        <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">För Kuskar & Deltagare</h2>
        
        <div class="grid gap-4 md:grid-cols-2">
          <div class="bg-amber-50 p-4 rounded-lg border border-amber-100">
            <h3 class="font-bold text-amber-800 mb-2">Min Portal</h3>
            <p class="text-sm text-amber-900 mb-2">
              Logga in med din e-post eller kod för att se din personliga sida.
              Här ser du dina <strong>starttider</strong>, ev. <strong>protokoll</strong> (när de släpps) och din placering.
            </p>
          </div>

          <div class="bg-blue-50 p-4 rounded-lg border border-blue-100">
            <h3 class="font-bold text-blue-800 mb-2">Startlistor & Resultat</h3>
            <p class="text-sm text-blue-900 mb-2">
              Under <strong>Publik</strong>-menyn hittar du alla listor.
              Resultat uppdateras live så fort en domare eller funktionär matar in dem.
            </p>
          </div>
        </div>

        <div class="mt-6 space-y-4">
          <section>
            <h3 class="font-bold text-gray-800">Vanliga frågor</h3>
            <details class="group bg-gray-50 rounded-lg p-2 cursor-pointer">
              <summary class="font-medium text-gray-700 list-none flex items-center justify-between">
                <span>Varför ser jag inte mitt resultat?</span>
                <span class="transition group-open:rotate-180">▼</span>
              </summary>
              <p class="text-gray-600 mt-2 text-sm pl-2">
                Resultatet kan vara preliminärt och väntar på godkännande av domare. Kontrollera om statusen står som "Klar".
              </p>
            </details>

            <details class="group bg-gray-50 rounded-lg p-2 cursor-pointer">
              <summary class="font-medium text-gray-700 list-none flex items-center justify-between">
                <span>Hur laddar jag ner mitt protokoll?</span>
                <span class="transition group-open:rotate-180">▼</span>
              </summary>
              <p class="text-gray-600 mt-2 text-sm pl-2">
                Gå till ditt ekipage i resultatlistan eller logga in på Portalen. Där finns en knapp (ofta PDF-ikon) för att ladda ner protokollet.
              </p>
            </details>
          </div>
        </div>
      `;

        default:
            return '<p>Välj en roll ovan.</p>';
    }
}

export function unload() {
    // Cleanup if needed
}
