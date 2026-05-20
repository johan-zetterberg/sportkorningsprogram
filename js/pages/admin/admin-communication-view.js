function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatFileSize(bytes) {
    const size = Number(bytes);
    if (!Number.isFinite(size) || size <= 0) return '';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function renderMessageAudienceBadge(message, getMessageAudience, getMessageTargetStartNumbers) {
    const audience = getMessageAudience(message);
    const targets = getMessageTargetStartNumbers(message);

    if (targets.length > 0) {
        return `<span class="bg-slate-200 text-slate-700 dark:bg-slate-600 dark:text-slate-100 text-[10px] uppercase px-1.5 py-0.5 rounded-full font-bold">Valda kuskar: ${targets.map(target => `#${escapeHtml(target)}`).join(', ')}</span>`;
    }
    if (audience.public && audience.drivers) {
        return '<span class="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200 text-[10px] uppercase px-1.5 py-0.5 rounded-full font-bold">Publik och kuskar</span>';
    }
    if (audience.public) {
        return '<span class="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200 text-[10px] uppercase px-1.5 py-0.5 rounded-full font-bold">Endast publik</span>';
    }
    if (audience.drivers) {
        return '<span class="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200 text-[10px] uppercase px-1.5 py-0.5 rounded-full font-bold">Alla kuskar</span>';
    }
    return '';
}

export function renderDocumentAudienceBadge(document, getDocumentAudience) {
    const audience = getDocumentAudience(document);

    if (audience.public && audience.drivers) {
        return '<span class="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200 px-1.5 py-0.5 rounded ml-1">Publik och kuskar</span>';
    }
    if (audience.public) {
        return '<span class="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200 px-1.5 py-0.5 rounded ml-1">Publik</span>';
    }
    if (audience.drivers) {
        return '<span class="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200 px-1.5 py-0.5 rounded ml-1">Kuskar</span>';
    }
    return '';
}

export function renderRecipientChecklist(equipages) {
    return equipages
        .slice()
        .sort((a, b) => Number(a.startNumber) - Number(b.startNumber))
        .map((equipage) => `
            <label class="flex items-center gap-3 p-2 rounded hover:bg-white dark:hover:bg-gray-800 cursor-pointer">
                <input type="checkbox" class="msg-driver-checkbox h-4 w-4" value="${escapeHtml(equipage.startNumber)}">
                <span>#${escapeHtml(equipage.startNumber)} ${escapeHtml(equipage.driverName || 'Okänd')}</span>
            </label>
        `)
        .join('');
}

export function renderUploadStatus(uploadState) {
    if (!uploadState || uploadState.status === 'idle') {
        return `
            <div class="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-3 text-xs text-gray-500 dark:text-gray-400">
                Ingen fil uppladdad ännu. Du kan antingen klistra in en länk eller ladda upp en fil.
            </div>
        `;
    }

    if (uploadState.status === 'uploading') {
        return `
            <div class="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20 p-3 text-sm text-blue-800 dark:text-blue-200">
                Laddar upp <strong>${escapeHtml(uploadState.fileName || 'fil')}</strong>...
            </div>
        `;
    }

    if (uploadState.status === 'ready') {
        return `
            <div class="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20 p-3">
                <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div class="text-sm text-green-800 dark:text-green-200">
                        <div class="font-semibold">${escapeHtml(uploadState.fileName || 'Fil uppladdad')}</div>
                        <div class="text-xs opacity-80">${escapeHtml(formatFileSize(uploadState.fileSize))}${uploadState.fileType ? ` · ${escapeHtml(uploadState.fileType)}` : ''}</div>
                    </div>
                    <button type="button" id="replaceUploadedFileBtn" class="text-xs font-semibold text-green-900 dark:text-green-100 hover:underline">
                        Byt fil
                    </button>
                </div>
            </div>
        `;
    }

    return `
        <div class="rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20 p-3 text-sm text-red-800 dark:text-red-200">
            ${escapeHtml(uploadState.message || 'Uppladdningen misslyckades.')}
        </div>
    `;
}

export function renderCommunicationTabMarkup() {
    return `
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div class="lg:col-span-2 bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border-l-4 border-violet-500 border dark:border-gray-700">
                <h2 class="text-2xl font-semibold mb-4 flex items-center gap-2 dark:text-white">
                    Publik Competition Center
                </h2>
                <p class="text-sm text-gray-500 mb-4 dark:text-gray-400">
                    Den publika sidan bygger automatiskt på starttider, dokument och publika meddelanden. Fyll bara i det som saknas för besökare.
                </p>

                <form id="publicInfoForm" class="space-y-4">
                    <label class="flex items-center gap-3">
                        <input type="checkbox" id="publicInfoEnabled" class="h-4 w-4">
                        <span class="text-sm font-medium text-gray-700 dark:text-gray-300">Aktivera publik infosida</span>
                    </label>

                    <div>
                        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Kort intro</label>
                        <textarea id="publicInfoIntro" rows="2" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="Kort information till publik och anhöriga."></textarea>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Tävlingsadress</label>
                            <input type="text" id="publicInfoVenueAddress" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Parkeringsadress</label>
                            <input type="text" id="publicInfoParkingAddress" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Parkering</label>
                            <input type="text" id="publicInfoParking" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Entré</label>
                            <input type="text" id="publicInfoEntrance" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Kiosk</label>
                            <input type="text" id="publicInfoKiosk" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Toaletter</label>
                            <input type="text" id="publicInfoToilets" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                        </div>
                    </div>

                    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                        <label class="flex items-center gap-2"><input type="checkbox" id="publishClassSummary" class="h-4 w-4"> Klassöversikt</label>
                        <label class="flex items-center gap-2"><input type="checkbox" id="publishDocuments" class="h-4 w-4"> Dokument</label>
                        <label class="flex items-center gap-2"><input type="checkbox" id="publishMessages" class="h-4 w-4"> Meddelanden</label>
                        <label class="flex items-center gap-2"><input type="checkbox" id="publishMaps" class="h-4 w-4"> Kartor</label>
                    </div>

                    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <button type="submit" class="bg-violet-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-violet-700 transition">
                            Spara publik info
                        </button>
                        <a href="#competition-center" class="text-sm text-violet-700 dark:text-violet-300 font-medium">Öppna publik sida</a>
                    </div>
                </form>
            </div>

            <div class="space-y-6">
                <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border-l-4 border-blue-500 border dark:border-gray-700">
                    <h2 class="text-2xl font-semibold mb-4 flex items-center gap-2 dark:text-white">
                        Meddelanden
                    </h2>
                    <p class="text-sm text-gray-500 mb-4 dark:text-gray-400">
                        Skicka information till publik, alla kuskar eller valda kuskar. Viktiga meddelanden markeras tydligare i portalen.
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
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Typ</label>
                                <select id="msgType" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                                    <option value="info">Information</option>
                                    <option value="alert">Viktigt / varning</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Målgrupp</label>
                                <select id="msgAudienceMode" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                                    <option value="public_and_drivers">Publik och alla kuskar</option>
                                    <option value="public_only">Endast publik</option>
                                    <option value="drivers_only">Endast alla kuskar</option>
                                    <option value="selected_drivers">Valda kuskar</option>
                                </select>
                            </div>
                        </div>
                        <div id="selectedDriversBox" class="hidden border rounded-lg p-3 bg-gray-50 dark:bg-gray-900/20 dark:border-gray-700">
                            <div class="flex items-center justify-between gap-3 mb-2">
                                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Välj en eller flera kuskar</label>
                                <button type="button" id="clearSelectedDriversBtn" class="text-xs text-blue-700 dark:text-blue-300 hover:underline">Rensa val</button>
                            </div>
                            <div id="recipientChecklist" class="max-h-48 overflow-y-auto space-y-2 pr-1 text-sm">
                                <div class="text-gray-400">Laddar kuskar...</div>
                            </div>
                        </div>
                        <button type="submit" class="w-full bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-blue-700 transition dark:bg-blue-700 dark:hover:bg-blue-600">
                            Publicera meddelande
                        </button>
                    </form>
                </div>

                <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border dark:border-gray-700">
                    <h3 class="text-lg font-semibold mb-3 dark:text-white">Publicerade meddelanden</h3>
                    <div id="messagesList" class="space-y-3 min-h-[100px]">
                        <div class="text-center py-4 dark:text-gray-400"><div class="spinner"></div></div>
                    </div>
                </div>
            </div>

            <div class="space-y-6">
                <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border-l-4 border-emerald-500 border dark:border-gray-700">
                    <h2 class="text-2xl font-semibold mb-4 flex items-center gap-2 dark:text-white">
                        Dokument och länkar
                    </h2>
                    <p class="text-sm text-gray-500 mb-4 dark:text-gray-400">
                        Ladda upp filer eller länkar till startlistor, banskisser och annan viktig information.
                    </p>

                    <form id="commDocForm" class="space-y-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Dokumentnamn</label>
                            <input type="text" id="docTitle" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="t.ex. Banskiss maraton" required>
                        </div>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Kategori</label>
                                <select id="docCategory" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                                    <option value="Startlista">Startlista</option>
                                    <option value="Banskiss">Banskiss</option>
                                    <option value="Karta">Karta</option>
                                    <option value="Information">Information</option>
                                    <option value="__custom__">Egen kategori</option>
                                    <option value="Övrigt">Övrigt</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Typ</label>
                                <select id="docType" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                                    <option value="url">Länk eller fil</option>
                                    <option value="html">Text / HTML</option>
                                </select>
                            </div>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Målgrupp</label>
                            <select id="docAudienceMode" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                                <option value="public_and_drivers">Publik och kuskar</option>
                                <option value="public_only">Endast publik</option>
                                <option value="drivers_only">Endast kuskar</option>
                            </select>
                        </div>
                        <div id="docCustomCategoryWrap" class="hidden">
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Egen kategori</label>
                            <input type="text" id="docCustomCategory" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="t.ex. PM, Parkering, Publikinformation">
                        </div>

                        <div id="docInputUrl" class="space-y-2">
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Länk till dokument</label>
                            <div class="flex flex-col sm:flex-row gap-2">
                                <input type="url" id="docUrl" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="https://..." required>
                                <input type="file" id="docUploadInput" class="hidden">
                                <button type="button" id="btnUploadDoc" class="mt-1 whitespace-nowrap w-full sm:w-auto bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 px-3 py-2 rounded-md text-sm font-semibold hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors" title="Ladda upp fil till Storage">
                                    Ladda upp fil
                                </button>
                            </div>
                            <p class="text-[10px] text-gray-400 italic">Klistra in en länk eller ladda upp en fil som sedan sparas som dokumentlänk.</p>
                            <div id="docUploadStatus"></div>
                        </div>

                        <div id="docInputHtml" class="hidden">
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Innehåll</label>
                            <textarea id="docHtmlContent" rows="3" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="Informationstext..."></textarea>
                        </div>

                        <button type="submit" class="w-full bg-emerald-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-emerald-700 transition dark:bg-emerald-700 dark:hover:bg-emerald-600" id="submitDocBtn">
                            Spara dokument
                        </button>
                    </form>
                </div>

                <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border dark:border-gray-700">
                    <h3 class="text-lg font-semibold mb-3 dark:text-white">Publicerade dokument</h3>
                    <div id="documentsList" class="space-y-3 min-h-[100px]">
                        <div class="text-center py-4 dark:text-gray-400"><div class="spinner"></div></div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

export function renderMessagesList(items, badgeRenderer) {
    if (!items.length) {
        return '<div class="text-sm text-gray-400 italic text-center p-4">Inga meddelanden ännu.</div>';
    }

    return items.map((message) => `
        <div class="p-4 rounded border flex flex-col sm:flex-row justify-between items-start gap-3 ${message.type === 'alert' ? 'bg-red-50 border-red-100 dark:bg-red-900/20 dark:border-red-800' : 'bg-gray-50 border-gray-100 dark:bg-gray-700/50 dark:border-gray-600'}">
            <div class="flex-1">
                <div class="flex items-center gap-2 mb-1">
                    <h4 class="font-bold text-gray-800 dark:text-gray-200">${escapeHtml(message.title)}</h4>
                    ${badgeRenderer(message)}
                </div>
                <p class="text-sm text-gray-600 mt-1 whitespace-pre-wrap dark:text-gray-300">${escapeHtml(message.body || '')}</p>
                <div class="text-xs text-gray-400 mt-2">${escapeHtml(message._formattedTimestamp || '')}</div>
            </div>
            <button class="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 p-1 self-end sm:self-auto" data-delete-message-id="${escapeHtml(message.id)}" type="button">
                Ta bort
            </button>
        </div>
    `).join('');
}

export function renderDocumentsList(items, badgeRenderer) {
    if (!items.length) {
        return '<div class="text-sm text-gray-400 italic text-center p-4">Inga dokument ännu.</div>';
    }

    return items.map((document) => `
        <div class="p-3 rounded border bg-white dark:bg-gray-800 dark:border-gray-700 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 group hover:bg-gray-50 dark:hover:bg-gray-700">
            <div class="flex items-center gap-3 min-w-0 w-full">
                <div class="text-2xl">${document.category === 'Banskiss' ? 'K' : 'D'}</div>
                <div class="min-w-0">
                    <div class="font-medium text-gray-900 dark:text-gray-200 truncate">${escapeHtml(document.title)}</div>
                    <div class="text-xs text-gray-500 dark:text-gray-400 flex flex-wrap items-center gap-1">
                        <span class="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-gray-600 dark:text-gray-300">${escapeHtml(document.category)}</span>
                        ${badgeRenderer(document)}
                        ${document.isUpload ? '<span class="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 px-1.5 py-0.5 rounded">Uppladdad fil</span>' : ''}
                        ${document.type === 'url' ? `<a href="${escapeHtml(document.url)}" target="_blank" class="text-blue-600 dark:text-blue-400 hover:underline">Öppna</a>` : '<span class="text-gray-400">(Text)</span>'}
                    </div>
                </div>
            </div>
            <button class="text-gray-500 hover:text-red-600 dark:hover:text-red-400 px-2 py-1 text-sm opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0 self-end sm:self-auto" data-delete-document-id="${escapeHtml(document.id)}" type="button">
                Ta bort
            </button>
        </div>
    `).join('');
}
