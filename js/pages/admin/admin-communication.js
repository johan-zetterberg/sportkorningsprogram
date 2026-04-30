import { getCompetitionMessages, getCompetitionDocuments } from '../../services/documentService.js';
import { saveCompetitionMessage, deleteCompetitionMessage, saveCompetitionDocument, deleteCompetitionDocument } from '../../services/documentService.js';
import { getEquipages } from '../../services/equipageService.js';
import { showAlert } from '../../ui/components.js';

export function renderCommunicationTab(container, competition) {
    container.innerHTML = `
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
            
            <!-- MESSAGES SECTION -->
            <div class="space-y-6">
                <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border-l-4 border-blue-500 border dark:border-gray-700">
                    <h2 class="text-2xl font-semibold mb-4 flex items-center gap-2 dark:text-white">
                        📢 Meddelanden till Kuskar
                    </h2>
                    <p class="text-sm text-gray-500 mb-4 dark:text-gray-400">
                        Här kan du skriva nyheter som visas direkt i kuskarnas portal. "Viktigt" markerar meddelandet med rött.
                    </p>

                    <form id="commMetaForm" class="space-y-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Rubrik</label>
                            <input type="text" id="msgTitle" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="t.ex. Uppdaterad startlista" required>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Meddelande</label>
                            <textarea id="msgBody" rows="3" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="Skriv ditt meddelande här..." required></textarea>
                        </div>
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Typ</label>
                                <select id="msgType" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                                    <option value="info">Information (Blå)</option>
                                    <option value="alert">Viktigt / Varning (Röd)</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Mottagare</label>
                                <select id="msgRecipient" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                                    <option value="all">Alla (Publikt)</option>
                                    <optgroup label="Specifik kusk" id="recipientList">
                                        <option disabled>Laddar kuskar...</option>
                                    </optgroup>
                                </select>
                            </div>
                        </div>
                        <button type="submit" class="w-full bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-blue-700 transition dark:bg-blue-700 dark:hover:bg-blue-600">
                            Publicera Meddelande
                        </button>
                    </form>
                </div>

                <!-- LIST MESSAGES -->
                <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border dark:border-gray-700">
                    <h3 class="text-lg font-semibold mb-3 dark:text-white">Publicerade Meddelanden</h3>
                    <div id="messagesList" class="space-y-3 min-h-[100px]">
                        <div class="text-center py-4 dark:text-gray-400"><div class="spinner"></div></div>
                    </div>
                </div>
            </div>

            <!-- DOCUMENTS SECTION -->
            <div class="space-y-6">
                <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border-l-4 border-emerald-500 border dark:border-gray-700">
                    <h2 class="text-2xl font-semibold mb-4 flex items-center gap-2 dark:text-white">
                        📂 Dokument & Länkar
                    </h2>
                    <p class="text-sm text-gray-500 mb-4 dark:text-gray-400">
                        Ladda upp länkar till startlistor, banskisser eller annan information.
                    </p>
                    
                    <!-- GUIDE BOX -->
                    <div class="bg-emerald-50 dark:bg-emerald-900/20 p-4 rounded-lg border border-emerald-100 dark:border-emerald-800 text-sm text-emerald-900 dark:text-emerald-100 mb-6">
                        <h4 class="font-bold flex items-center gap-2 mb-2">
                            💡 Så här lägger du till filer (PDF m.m.)
                        </h4>
                        <ol class="list-decimal list-inside space-y-1 ml-1">
                            <li>Ladda upp din fil till <strong>Google Drive</strong>, <strong>Dropbox</strong> eller din klubbs hemsida.</li>
                            <li>Kopiera dela-länken (Se till att den är "öppen för alla").</li>
                            <li>Klistra in länken i fältet <strong>Länk (URL)</strong> nedan.</li>
                        </ol>
                    </div>

                    <form id="commDocForm" class="space-y-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Dokumentnamn</label>
                            <input type="text" id="docTitle" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="t.ex. Banskiss Maraton" required>
                        </div>
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Kategori</label>
                                <select id="docCategory" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                                    <option value="Startlista">Startlista</option>
                                    <option value="Banskiss">Banskiss</option>
                                    <option value="Karta">Karta</option>
                                    <option value="Information">Information</option>
                                    <option value="Övrigt">Övrigt</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Typ</label>
                                <select id="docType" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                                    <option value="url">Länk (URL)</option>
                                    <option value="html">Text / HTML</option>
                                </select>
                            </div>
                        </div>
                        
                        <!-- URL INPUT -->
                        <div id="docInputUrl">
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Länk till dokument (URL)</label>
                            <div class="flex gap-2">
                                <input type="url" id="docUrl" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="https://..." required>
                                <input type="file" id="docUploadInput" class="hidden">
                                <button type="button" id="btnUploadDoc" class="mt-1 whitespace-nowrap bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 px-3 py-2 rounded-md text-sm font-semibold hover:bg-blue-100 dark:hover:bg-blue-900/50 flex items-center gap-2 transition-colors" title="Ladda upp fil till Storage">
                                    <span>📤 Ladda upp</span>
                                </button>
                            </div>
                            <p class="text-[10px] text-gray-400 mt-1 italic">Ladda upp fil (PDF/Bild) ELLER klistra in länk.</p>
                        </div>

                        <!-- HTML INPUT (Hidden by default) -->
                        <div id="docInputHtml" class="hidden">
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Innehåll</label>
                            <textarea id="docHtmlContent" rows="3" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="Informationstext..."></textarea>
                        </div>

                        <button type="submit" class="w-full bg-emerald-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-emerald-700 transition dark:bg-emerald-700 dark:hover:bg-emerald-600" id="submitDocBtn">
                            Spara Dokument
                        </button>
                    </form>
                </div>

                <!-- LIST DOCUMENTS -->
                <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border dark:border-gray-700">
                    <h3 class="text-lg font-semibold mb-3 dark:text-white">Uppladdade Dokument</h3>
                    <div id="documentsList" class="space-y-3 min-h-[100px]">
                         <div class="text-center py-4 dark:text-gray-400"><div class="spinner"></div></div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // --- LOGIC ---

    // Toggle Document Input Type
    const typeSelect = document.getElementById('docType');
    const urlGroup = document.getElementById('docInputUrl');
    const htmlGroup = document.getElementById('docInputHtml');

    typeSelect.addEventListener('change', (e) => {
        if (e.target.value === 'url') {
            urlGroup.classList.remove('hidden');
            htmlGroup.classList.add('hidden');
            document.getElementById('docUrl').required = true;
            document.getElementById('docHtmlContent').required = false;
        } else {
            urlGroup.classList.add('hidden');
            htmlGroup.classList.remove('hidden');
            document.getElementById('docUrl').required = false;
            document.getElementById('docHtmlContent').required = true;
        }
    });

    // --- UPLOAD LOGIC ---
    const btnUpload = document.getElementById('btnUploadDoc');
    const inputUpload = document.getElementById('docUploadInput');
    const urlInput = document.getElementById('docUrl');

    btnUpload.addEventListener('click', () => inputUpload.click());

    inputUpload.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Basic validation
        if (file.size > 10 * 1024 * 1024) { // 10MB limit
            showAlert('Filen är för stor (Max 10MB).', false);
            return;
        }

        const btnText = btnUpload.querySelector('span');
        const originalText = btnText.textContent;
        btnText.textContent = '⏳';
        btnUpload.disabled = true;
        urlInput.readOnly = true;

        try {
            const { uploadCompetitionDocument } = await import('../services/storageService.js');
            const url = await uploadCompetitionDocument(competition.id, file);

            urlInput.value = url;
            urlInput.classList.add('bg-green-50');
            setTimeout(() => urlInput.classList.remove('bg-green-50'), 1500);

            // Auto-suggest title if empty
            const titleInput = document.getElementById('docTitle');
            if (!titleInput.value) {
                // Remove extension and underscores
                let niceName = file.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");
                titleInput.value = niceName;
            }

            showAlert('Fil uppladdad!');
        } catch (err) {
            console.error(err);
            showAlert('Uppladdning misslyckades: ' + err.message, false);
        } finally {
            btnText.textContent = originalText;
            btnUpload.disabled = false;
            urlInput.readOnly = false;
            inputUpload.value = '';
        }
    });

    // LOAD DATA
    refreshMessages(competition.id);
    refreshDocuments(competition.id);
    loadEquipages(competition.id);

    async function loadEquipages(compId) {
        try {
            const equipages = await getEquipages(compId);
            const group = document.getElementById('recipientList');
            if (!group) return;
            group.innerHTML = equipages
                .sort((a, b) => Number(a.startNumber) - Number(b.startNumber))
                .map(e => `<option value="${e.startNumber}">#${e.startNumber} ${e.driverName || 'Okänd'}</option>`)
                .join('');
        } catch (err) {
            console.error('Kunde inte ladda kuskar:', err);
        }
    }

    // MESSAGE SUBMIT
    document.getElementById('commMetaForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.submitter;
        btn.disabled = true;
        try {
            const recipient = document.getElementById('msgRecipient').value;
            await saveCompetitionMessage(competition.id, {
                title: document.getElementById('msgTitle').value,
                body: document.getElementById('msgBody').value,
                type: document.getElementById('msgType').value,
                targetStartNumber: recipient === 'all' ? null : recipient
            });
            showAlert('Meddelande publicerat!');
            e.target.reset();
            refreshMessages(competition.id);
        } catch (err) {
            console.error(err);
            showAlert('Kunde inte spara meddelande: ' + err.message, false);
        } finally {
            btn.disabled = false;
        }
    });

    // DOCUMENT SUBMIT
    document.getElementById('commDocForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.submitter;
        btn.disabled = true;

        try {
            const type = document.getElementById('docType').value;
            const payload = {
                title: document.getElementById('docTitle').value,
                category: document.getElementById('docCategory').value,
                type: type,
                url: (type === 'url') ? document.getElementById('docUrl').value : null,
                content: (type === 'html') ? document.getElementById('docHtmlContent').value : null
            };

            await saveCompetitionDocument(competition.id, payload);
            showAlert('Dokument sparat!');
            e.target.reset();

            // Allow user to add another link immediately (UX improvement)
            typeSelect.value = 'url';
            urlGroup.classList.remove('hidden');
            htmlGroup.classList.add('hidden');

            refreshDocuments(competition.id);

        } catch (err) {
            console.error(err);
            showAlert('Kunde inte spara dokument: ' + err.message, false);
        } finally {
            btn.disabled = false;
        }
    });

    // --- HELPERS ---

    async function refreshMessages(compId) {
        const list = document.getElementById('messagesList');
        const items = await getCompetitionMessages(compId);

        if (items.length === 0) {
            list.innerHTML = '<div class="text-sm text-gray-400 italic text-center p-4">Inga meddelanden ännu.</div>';
            return;
        }

        list.innerHTML = items.map(m => `
            <div class="p-4 rounded border flex justify-between items-start ${m.type === 'alert' ? 'bg-red-50 border-red-100 dark:bg-red-900/20 dark:border-red-800' : 'bg-gray-50 border-gray-100 dark:bg-gray-700/50 dark:border-gray-600'}">
                <div class="flex-1">
                    <div class="flex items-center gap-2 mb-1">
                        <h4 class="font-bold text-gray-800 dark:text-gray-200">${m.title}</h4>
                        ${m.targetStartNumber ? `<span class="bg-gray-200 text-gray-700 dark:bg-gray-600 dark:text-gray-200 text-[10px] uppercase px-1.5 py-0.5 rounded-full font-bold">Privat: #${m.targetStartNumber}</span>` : ''}
                    </div>
                    <p class="text-sm text-gray-600 mt-1 whitespace-pre-wrap dark:text-gray-300">${m.body || ''}</p>
                    <div class="text-xs text-gray-400 mt-2">
                        ${m.timestamp ? new Date(m.timestamp.seconds * 1000).toLocaleString('sv-SE') : ''}
                    </div>
                </div>
                <button class="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 p-1" onclick="return false;">
                    🗑️
                </button>
            </div>
        `).join('');

        list.querySelectorAll('button').forEach((btn, idx) => {
            btn.onclick = () => handleDeleteMessage(compId, items[idx].id);
        });
    }

    async function refreshDocuments(compId) {
        const list = document.getElementById('documentsList');
        const items = await getCompetitionDocuments(compId);

        if (items.length === 0) {
            list.innerHTML = '<div class="text-sm text-gray-400 italic text-center p-4">Inga dokument ännu.</div>';
            return;
        }

        list.innerHTML = items.map(d => `
            <div class="p-3 rounded border bg-white dark:bg-gray-800 dark:border-gray-700 flex justify-between items-center group hover:bg-gray-50 dark:hover:bg-gray-700">
                <div class="flex items-center gap-3">
                    <div class="text-2xl">${d.category === 'Banskiss' ? '🗺️' : '📄'}</div>
                    <div>
                        <div class="font-medium text-gray-900 dark:text-gray-200">${d.title}</div>
                        <div class="text-xs text-gray-500 dark:text-gray-400">
                            <span class="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-gray-600 dark:text-gray-300">${d.category}</span>
                            ${d.isUpload ? '<span class="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 px-1.5 py-0.5 rounded ml-1">Fil</span>' : ''}
                            ${d.type === 'url' ? `<a href="${d.url}" target="_blank" class="text-blue-600 dark:text-blue-400 hover:underline ml-1">Öppna ↗</a>` : '<span class="text-gray-400 text-xs">(Text)</span>'}
                        </div>
                    </div>
                </div>
                <button class="text-gray-400 hover:text-red-600 dark:hover:text-red-400 p-2 opacity-0 group-hover:opacity-100 transition-opacity" onclick="return false;">
                    🗑️
                </button>
            </div>
        `).join('');

        // Attach listeners
        list.querySelectorAll('button').forEach((btn, idx) => {
            btn.onclick = () => handleDeleteDocument(compId, items[idx].id);
        });
    }

    async function handleDeleteMessage(compId, id) {
        if (!confirm('Ta bort meddelande?')) return;
        try {
            await deleteCompetitionMessage(compId, id);
            refreshMessages(compId);
        } catch (e) {
            console.error(e);
            showAlert('Kunde inte ta bort.', false);
        }
    }

    async function handleDeleteDocument(compId, id) {
        if (!confirm('Ta bort dokument?')) return;
        try {
            await deleteCompetitionDocument(compId, id);
            refreshDocuments(compId);
        } catch (e) {
            console.error(e);
            showAlert('Kunde inte ta bort.', false);
        }
    }
}
