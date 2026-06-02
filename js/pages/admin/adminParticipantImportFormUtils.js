export function escapeAdminImportHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function buildXmlClassItems(equipagesFromFile = []) {
    return Array
        .from(new Map(
            equipagesFromFile.map(eq => {
                const key = (eq.tdbClassNumber != null)
                    ? `NUM:${eq.tdbClassNumber}`
                    : `NAME:${eq.className}`;
                const display = (eq.tdbClassNumber != null)
                    ? `${eq.tdbClassLabel || eq.className} (TDB #${eq.tdbClassNumber})`
                    : `${eq.className}`;

                return [key, {
                    key,
                    display,
                    className: eq.className,
                    tdbClassNumber: eq.tdbClassNumber ?? null
                }];
            })
        ).values());
}

export function buildClassMappingHtml(uniqueXmlClasses = [], appClassList = []) {
    const appClassOptions = appClassList
        .map(className => {
            const safeClassName = escapeAdminImportHtml(className);
            return `<option value="${safeClassName}">${safeClassName}</option>`;
        })
        .join('');

    const classRows = uniqueXmlClasses.map((item, index) => `
        <div class="grid grid-cols-2 gap-4 items-center mb-2 p-2 bg-gray-50 dark:bg-gray-800 rounded">
      <div class="text-sm">
        <span class="font-semibold dark:text-gray-200">Från fil:</span>
        <p class="text-gray-700 dark:text-gray-400 italic">"${escapeAdminImportHtml(item.display)}"</p>
      </div>
      <div>
        <label for="mapping_${index}" class="text-sm font-semibold dark:text-gray-200">Mappa till:</label>
        <select id="mapping_${index}" data-key="${escapeAdminImportHtml(item.key)}" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200">
          <option value="">-- Välj klass --</option>${appClassOptions}
        </select>
      </div>
    </div>`).join('');

    return `<h3 class="font-semibold mb-2 dark:text-gray-200">Steg 2: Mappa tävlingsklasser</h3>
        <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">Kontrollera och justera de automatiskt matchade klasserna.</p>
        ${classRows}
        <div class="mt-4 p-3 rounded bg-amber-50 dark:bg-amber-900 border border-amber-200 dark:border-amber-700">
    <label class="inline-flex items-center gap-2 text-sm dark:text-amber-100">
      <input id="eqXmlMergePerTestChk" type="checkbox" class="h-4 w-4" checked>
      <span>Sammanslå per test (ignorera Häst/Ponny & Enbet/Par)</span>
    </label>
    <p class="text-xs text-amber-700 dark:text-amber-300 mt-1">När detta är valt sparas även fälten <code>mergedTestKey</code>/<code>mergedTestLabel</code> samt flaggan <code>useMergedTestForDisplay</code> på ekipagen.</p>
  </div>
        <button id="eqXmlDoFinalImport" class="mt-4 w-full bg-emerald-600 text-white py-2 px-4 rounded-lg hover:bg-emerald-700">Slutför import</button>`;
}
