export function populateEquipageFormFields(data, {
    generateHorseFields,
    inferParaGradeFromClassName,
    isBarnClass,
    isParaClass,
    onClassChange,
    paraGradeSelect,
    populateClassSelect,
    populateHorseFormData,
    syncParaGradeUi,
    updateHorseNumbers
} = {}) {
    document.getElementById('startNumber').value = data.startNumber || '';
    document.getElementById('driverName').value = data.driverName || '';
    document.getElementById('driverEmail').value = data.email || '';
    document.getElementById('clubName').value = data.clubName || '';
    document.getElementById('driverSSN').value = data.ssn || data.driverSSN || '';
    document.getElementById('driverPhone').value = data.phone || '';
    document.getElementById('driverLicense').value = data.licence || data.licenseNo || data.driverLicenseId || '';
    document.getElementById('driverLicenseYear').value = data.licenseYear || data.driverLicenseYear || '';
    document.getElementById('driverBornYear').value = data.bornYear || data.driverBornYear || '';
    document.getElementById('driverGender').value = data.gender || '';
    document.getElementById('driverCountry').value = data.country || '';
    document.getElementById('driverCompany').value = data.company || '';

    const barnklassCheckbox = document.getElementById('isBarnklassCheckbox');
    if (barnklassCheckbox && typeof isBarnClass === 'function') {
        barnklassCheckbox.checked = isBarnClass(data.className);
    }

    const paraCheckbox = document.getElementById('isParaCheckbox');
    if (paraCheckbox) {
        const classIsPara = typeof isParaClass === 'function' ? isParaClass(data.className) : false;
        paraCheckbox.checked = classIsPara || !!data.isPara;
    }
    if (paraGradeSelect) {
        const inferredGrade = typeof inferParaGradeFromClassName === 'function' ? inferParaGradeFromClassName(data.className) : '';
        paraGradeSelect.value = String(data.paraGrade || inferredGrade || '');
    }
    if (typeof syncParaGradeUi === 'function') {
        syncParaGradeUi();
    }
    if (typeof populateClassSelect === 'function') {
        populateClassSelect();
    }

    const addr = data.address || {};
    document.getElementById('driverStreet').value = addr.street || data.street || '';
    document.getElementById('driverZip').value = addr.zipCode || data.zip || '';
    document.getElementById('driverCity').value = addr.city || data.city || '';

    document.getElementById('groomName').value = data.groomName || '';
    document.getElementById('trackWidth').value = data.trackWidth || '';
    document.getElementById('marathonTrackWidth').value = data.marathonTrackWidth || '';
    document.getElementById('notes').value = data.notes || '';
    document.getElementById('adminComments').value = data.adminComments || '';

    const pay = data.payment || {};
    document.getElementById('paymentStatus').value = pay.status || 'unpaid';
    document.getElementById('paymentAmount').value = pay.amount || data.paymentAmount || '';

    document.getElementById('className').value = data.className || '';

    if (typeof onClassChange === 'function') {
        onClassChange({ target: document.getElementById('className') }, (data.horses || []).length);
    } else if (typeof generateHorseFields === 'function') {
        const container = document.getElementById('horses-container');
        if (container) {
            const count = Math.max(1, (data.horses || []).length);
            container.innerHTML = '';
            const isBarn = barnklassCheckbox?.checked || false;
            for (let index = 1; index <= count; index++) {
                container.innerHTML += generateHorseFields(index, index <= 4, isBarn, index > 4);
            }
        }
    }

    setTimeout(() => {
        if (typeof populateHorseFormData === 'function') {
            populateHorseFormData(data.horses);
        }
        if (typeof updateHorseNumbers === 'function') {
            updateHorseNumbers(data.startNumber);
        }
    }, 50);
}
