import { getGlobalState } from '../main.js';
import { competitionClasses, klassTempoData } from '../data/competitionData.js';
import { getCompetitionHeader } from '../ui/components.js';

// --- Lokal state för modulen ---
let tableBody = null; // Referens till tabellens body-element

/**
 * Beräknar och uppdaterar maxtiden för alla rader i tabellen.
 */
function updateAllTimes() {
    if (!tableBody) return;
    tableBody.querySelectorAll("tr").forEach(row => {
        const length = parseFloat(row.querySelector(".banlangd-input").value);
        const tempo = parseFloat(row.querySelector(".tempo-input").value);
        const outputCell = row.querySelector(".maxtid-output");
        if (length > 0 && tempo > 0) {
            const totalMinutes = length / tempo;
            const mins = Math.floor(totalMinutes);
            const secs = Math.round((totalMinutes - mins) * 60);
            outputCell.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        } else {
            outputCell.textContent = "-";
        }
    });
}

/**
 * Lägger till en ny, tom rad i kalkylator-tabellen.
 */
function addRow() {
    if (!tableBody) return;

    const row = document.createElement("tr");
    let klassOptions = '';
    for (const group in competitionClasses) {
        klassOptions += `<optgroup label="${group}">`;
        competitionClasses[group].forEach(c => {
           klassOptions += `<option value="${c}">${c}</option>`;
        });
        klassOptions += `</optgroup>`;
    }

    row.innerHTML = `
        <td class="border px-2 py-1"><select class="w-full p-1 border rounded klass-select"><option value="">Välj klass</option>${klassOptions}</select></td>
        <td class="border px-2 py-1"><select class="w-full p-1 border rounded kategori-select"><option value="Ponny">Ponny (A–D)</option><option value="Häst">Häst (H)</option></select></td>
        <td class="border px-2 py-1"><input type="number" class="w-full p-1 border rounded banlangd-input" placeholder="Ex: 500"></td>
        <td class="border px-2 py-1"><input type="number" class="w-full p-1 border rounded tempo-input" placeholder="Tempo" readonly></td>
        <td class="border px-2 py-1 text-center font-semibold maxtid-output">-</td>
    `;
    tableBody.appendChild(row);
}

/**
 * Sätter upp alla händelselyssnare för sidan.
 */
function setupEventListeners() {
    tableBody = document.getElementById("maxtidTableBody");

    // Lyssnare för ändringar i input-fält
    tableBody.addEventListener('input', (e) => {
        if (e.target.classList.contains('banlangd-input')) {
            updateAllTimes();
        }
    });

    // Lyssnare för när en klass väljs
    tableBody.addEventListener('change', (e) => {
        if (e.target.classList.contains('klass-select')) {
            const selectedClass = e.target.value;
            const tempoInput = e.target.closest("tr").querySelector(".tempo-input");
            // Hämta tempot från vår importerade data-fil
            tempoInput.value = klassTempoData[selectedClass] || "";
            updateAllTimes();
        }
    });

    // Lyssnare för knappar
    document.getElementById('maxtidAddRow').addEventListener('click', addRow);

    document.getElementById('maxtidExportExcel').addEventListener('click', () => {
        const ws_data = [["Klass", "Kategori", "Banlängd (m)", "Tempo (m/min)", "Maxtid"]];
        tableBody.querySelectorAll("tr").forEach(row => {
            const rowData = [];
            // Använd textContent för den sista cellen istället för värdet på ett input-fält
            rowData.push(row.querySelector(".klass-select").value);
            rowData.push(row.querySelector(".kategori-select").value);
            rowData.push(row.querySelector(".banlangd-input").value);
            rowData.push(row.querySelector(".tempo-input").value);
            rowData.push(row.querySelector(".maxtid-output").textContent);
            ws_data.push(rowData);
        });
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(ws_data);
        XLSX.utils.book_append_sheet(wb, ws, "Maxtider");
        XLSX.writeFile(wb, "maxtidslista.xlsx");
    });

    document.getElementById('maxtidExportPDF').addEventListener('click', () => {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const head = [["Klass", "Kategori", "Banlängd (m)", "Tempo (m/min)", "Maxtid"]];
        const body = Array.from(tableBody.querySelectorAll("tr")).map(row => [
            row.querySelector(".klass-select").value,
            row.querySelector(".kategori-select").value,
            row.querySelector(".banlangd-input").value,
            row.querySelector(".tempo-input").value,
            row.querySelector(".maxtid-output").textContent
        ]);
        doc.setFontSize(14);
        doc.text("Maxtidslista för precision", 14, 15);
        doc.autoTable({ startY: 20, head: head, body: body, theme: 'grid' });
        doc.save("maxtidslista.pdf");
    });

    // Lyssnare för sortering
    document.querySelectorAll('.sortable-maxtid').forEach(th => {
        th.addEventListener('click', () => {
            const colIndex = parseInt(th.dataset.colIndex);
            const rows = Array.from(tableBody.querySelectorAll("tr"));
            rows.sort((a, b) => {
                const aVal = (a.children[colIndex].querySelector("select, input")).value;
                const bVal = (b.children[colIndex].querySelector("select, input")).value;
                return aVal.localeCompare(bVal, 'sv', { numeric: true });
            });
            rows.forEach(row => tableBody.appendChild(row));
        });
    });
}

/**
 * Huvudfunktion som anropas av routern för att ladda och initiera sidan.
 */
export function load() {
    const competition = getGlobalState('currentCompetition');
    const page = document.getElementById('page-maxtid-precision');

    if (!competition) {
        page.innerHTML = `<p class="p-8 text-center text-red-500">Ingen tävling vald. Gå tillbaka till hubben och välj en tävling.</p>`;
        return;
    }

    page.innerHTML = `
        <div class="container mx-auto p-4 md:p-8">
            ${getCompetitionHeader(competition, 'Verktyg - Maxtid Precision')}
            <div class="max-w-6xl mx-auto bg-white p-6 rounded-xl shadow">
              <h1 class="text-2xl font-bold mb-4">🕒 Generera maxtidslista för precision</h1>
              <p class="mb-4 text-sm text-gray-600">Fyll i varje rad. Tempo sätts automatiskt baserat på vald klass. Klicka på rubrikerna för att sortera.</p>
              <div class="overflow-x-auto">
                  <table id="maxtidInputTable" class="w-full table-auto text-sm border mb-4">
                    <thead class="bg-gray-200">
                      <tr>
                        <th class="border px-2 py-1 cursor-pointer sortable-maxtid" data-col-index="0">Klass ⬍</th>
                        <th class="border px-2 py-1 cursor-pointer sortable-maxtid" data-col-index="1">Kategori ⬍</th>
                        <th class="border px-2 py-1 cursor-pointer sortable-maxtid" data-col-index="2">Banlängd (m) ⬍</th>
                        <th class="border px-2 py-1 cursor-pointer sortable-maxtid" data-col-index="3">Tempo (m/min) ⬍</th>
                        <th class="border px-2 py-1">Maxtid</th>
                      </tr>
                    </thead>
                    <tbody id="maxtidTableBody"></tbody>
                  </table>
              </div>
              <div class="flex flex-wrap gap-2">
                <button id="maxtidAddRow" class="bg-brand-darkblue text-white px-4 py-2 rounded hover:bg-brand-gold hover:text-brand-darkblue">+ Lägg till rad</button>
                <button id="maxtidExportExcel" class="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">⬇️ Exportera till Excel</button>
                <button id="maxtidExportPDF" class="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700">⬇️ Exportera till PDF</button>
              </div>
            </div>
        </div>
    `;
    
    setupEventListeners();
    addRow(); // Starta med en rad
}