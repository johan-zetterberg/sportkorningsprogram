export function generateHorseFields(index, isRequired, isBarn = false, isReserve = false) {
    const req = isRequired ? 'required' : '';
    const title = isReserve ? `Häst ${index} (Reserv)` : `Häst ${index}`;
    const types = isBarn ? `<option value="A-ponny">A-ponny</option><option value="B-ponny">B-ponny</option><option value="C-ponny">C-ponny</option>`
        : `<option value="Häst">Häst</option><option value="A-ponny">A-ponny</option><option value="B-ponny">B-ponny</option><option value="C-ponny">C-ponny</option><option value="D-ponny">D-ponny</option>`;
    return `<div class="p-4 border border-gray-200 dark:border-gray-600 rounded-lg space-y-3 mt-4">
    <h3 class="font-semibold text-md dark:text-gray-200">${title}</h3>
    <div class="grid grid-cols-2 gap-4">
       <div><label class="dark:text-gray-300">ID</label><input type="text" id="horseId_${index}" readonly class="w-full p-2 border bg-gray-100 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300"></div>
       <div><label class="dark:text-gray-300">Namn${isRequired ? '*' : ''}</label><input type="text" id="horseName_${index}" ${req} class="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"></div>
    </div>
    <div class="grid grid-cols-2 gap-4">
       <div><label class="dark:text-gray-300">Typ</label><select id="horseType_${index}" ${req} class="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"><option value="">Välj</option>${types}</select></div>
       <div><label class="dark:text-gray-300">Kön</label><input type="text" id="gender_${index}" class="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"></div>
    </div>
     <div class="grid grid-cols-3 gap-4">
        <div><label class="dark:text-gray-300">Färg</label><input type="text" id="color_${index}" class="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"></div>
        <div><label class="dark:text-gray-300">Ras</label><input type="text" id="breed_${index}" class="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"></div>
        <div><label class="dark:text-gray-300">Födelseår</label><input type="text" id="bornYear_${index}" class="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"></div>
    </div>
     <div class="grid grid-cols-2 gap-4">
        <div><label class="dark:text-gray-300">Chip</label><input type="text" id="chip_${index}" class="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"></div>
        <div><label class="dark:text-gray-300">UELN</label><input type="text" id="ueln_${index}" class="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"></div>
    </div>
     <div class="grid grid-cols-3 gap-4">
        <div><label class="dark:text-gray-300">Licens</label><input type="text" id="license_${index}" class="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"></div>
        <div><label class="dark:text-gray-300">Lic.År</label><input type="text" id="licenseYear_${index}" class="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"></div>
        <div><label class="dark:text-gray-300">FEI</label><input type="text" id="feiPass_${index}" class="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"></div>
    </div>
    <div class="hidden"><input type="text" id="studbook_${index}"></div>
  </div>`;
}

export function updateHorseNumbers(startNumber) {
    const num = parseInt(startNumber);
    if (!num) return;
    const fields = document.querySelectorAll('[id^="horseId_"]');
    fields.forEach((field, index) => {
        field.value = fields.length === 1 ? (100 + num) : `${100 + num} ${String.fromCharCode(65 + index)} `;
    });
}

export function getHorseFormData() {
    const result = [];
    for (let i = 1; i <= 6; i++) {
        if (!document.getElementById(`horseName_${i}`)?.value) continue;

        result.push({
            id: document.getElementById(`horseId_${i}`).value,
            name: document.getElementById(`horseName_${i}`).value,
            type: document.getElementById(`horseType_${i}`).value,
            bornYear: document.getElementById(`bornYear_${i}`).value,
            gender: document.getElementById(`gender_${i}`).value,
            color: document.getElementById(`color_${i}`).value,
            breed: document.getElementById(`breed_${i}`).value,
            chip: document.getElementById(`chip_${i}`).value,
            ueln: document.getElementById(`ueln_${i}`).value,
            license: document.getElementById(`license_${i}`).value,
            licenseYear: document.getElementById(`licenseYear_${i}`).value,
            feiPass: document.getElementById(`feiPass_${i}`).value
        });
    }
    return result;
}

export function populateHorseFormData(horses) {
    if (!horses) return;
    horses.forEach((horse, index) => {
        const idx = index + 1;
        if (!document.getElementById(`horseName_${idx}`)) return;

        document.getElementById(`horseName_${idx}`).value = horse.name || '';
        document.getElementById(`horseType_${idx}`).value = horse.type || '';
        document.getElementById(`bornYear_${idx}`).value = horse.bornYear || '';
        document.getElementById(`gender_${idx}`).value = horse.gender || '';
        document.getElementById(`color_${idx}`).value = horse.color || '';
        document.getElementById(`breed_${idx}`).value = horse.breed || '';
        document.getElementById(`chip_${idx}`).value = horse.chip || '';
        document.getElementById(`ueln_${idx}`).value = horse.ueln || '';
        document.getElementById(`license_${idx}`).value = horse.license || '';
        document.getElementById(`licenseYear_${idx}`).value = horse.licenseYear || '';
        document.getElementById(`feiPass_${idx}`).value = horse.feiPass || '';
    });
}
