// js/ui/components.js

/**
 * Renderar ett standardiserat sidhuvud för en tävling.
 * @param {object} competition - Det aktiva tävlingsobjektet.
 * @param {string} title - Sidans titel.
 * @returns {string} En HTML-sträng med sidhuvudet.
 */
//export function getCompetitionHeader(competition, title) {
//    if (!competition) return '';
//    return `
//        <header class="mb-8 text-center">
//            <h1 class="text-4xl font-bold text-gray-800">${competition.name}</h1>
//            <p class="text-lg text-gray-600 mt-2">${title}</p>
//            <p class="text-sm text-gray-500 mt-1">${competition.place} | ${competition.dates} | ${competition.club}</p>
//        </header>
//    `;
//}

// Ny kod med DriveLive-färger
export function getCompetitionHeader(competition, pageTitle) {
    // Om inget tävlingsobjekt finns, visa en standard-header
    if (!competition) {
        return `<header class="bg-brand-darkblue ...">Ingen tävling vald</header>`;
    }

    // --- Datumformatering (robust) ---
    const competitionDates = competition.dates || {};
    let dateString = '';
    try {
        // Försöker bara formatera om datumen är giltiga strängar
        if (competitionDates.start && competitionDates.end) {
            const startDate = new Date(competitionDates.start).toLocaleDateString('sv-SE', { day: 'numeric', month: 'long' });
            const endDate = new Date(competitionDates.end).toLocaleDateString('sv-SE', { day: 'numeric', month: 'long', year: 'numeric' });
            if (startDate === endDate.split(' ')[0] + ' ' + endDate.split(' ')[1]) { // Om samma dag och månad
                dateString = endDate;
            } else {
                dateString = `${startDate} – ${endDate}`;
            }
        } else if (competitionDates.start || competitionDates.end) {
            const singleDate = new Date(competitionDates.start || competitionDates.end).toLocaleDateString('sv-SE', { day: 'numeric', month: 'long', year: 'numeric' });
            dateString = singleDate;
        }
    } catch (e) {
        console.error("Kunde inte formatera datum:", competitionDates);
        // Lämnar dateString tom om datumen är ogiltiga
    }

    return `
        <header class="bg-gradient-to-r from-brand-darkblue to-indigo-950 border-b-4 border-brand-gold p-4 md:p-6 rounded-t-lg mb-6 shadow-xl flex items-center gap-4 md:gap-6">
            
            <img src="/icons/DriveLive_512.png" alt="DriveLive Logga" class="h-16 w-16 md:h-20 md:w-20 rounded-md flex-shrink-0">

            <div class="flex-grow">
                <h1 class="text-2xl md:text-3xl font-bold font text-white">${competition.name || 'Tävling'}</h1>
                <p class="text-lg text-brand-lightblue">${pageTitle || ''}</p>
                
                ${(competition.location || dateString) ? `
                    <div class="text-sm text-gray-300 mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                        ${competition.location ? `<span>📍 ${competition.location}</span>` : ''}
                        ${dateString ? `<span>🗓️ ${dateString}</span>` : ''}
                    </div>
                ` : ''}
            </div>
        </header>
    `;
}

/**
 * Skapar en återanvändbar, sökbar dropdown-meny.
 * @param {HTMLElement} container - Elementet där dropdownen ska renderas.
 * @param {Array<object>} data - Datan som ska visas (måste innehålla startNumber och driverName).
 * @param {Function} onSelect - Callback som körs när ett val görs.
 * @returns {object} Ett objekt med metoder för att interagera med dropdownen.
 */
export function createSearchableDropdown(container, data, onSelect) {
    container.innerHTML = `
        <div class="searchable-dropdown relative bg-white">
            <input type="text" class="search-input w-full p-2 border rounded-md" placeholder="Sök på nr eller namn...">
            <div class="searchable-dropdown-list hidden absolute top-full left-0 right-0 bg-white border mt-1 rounded-md shadow-lg z-10 max-h-60 overflow-y-auto"></div>
        </div>
    `;
    const searchInput = container.querySelector('.search-input');
    const list = container.querySelector('.searchable-dropdown-list');
    let selectedValue = null;

    const renderList = (filter = '') => {
        list.innerHTML = '';
        const filteredData = data.filter(item => {
            const term = filter.toLowerCase();
            return item.startNumber.toString().includes(term) || item.driverName.toLowerCase().includes(term);
        });

        if (filteredData.length === 0) {
            list.innerHTML = '<div class="p-3 text-gray-500">Inga träffar</div>';
        } else {
            filteredData.forEach(item => {
                const itemEl = document.createElement('div');
                itemEl.className = 'p-3 hover:bg-blue-50 cursor-pointer';
                itemEl.textContent = `#${item.startNumber} - ${item.driverName}`;
                itemEl.dataset.value = item.startNumber;
                itemEl.addEventListener('click', () => {
                    searchInput.value = itemEl.textContent;
                    selectedValue = item.startNumber;
                    list.classList.add('hidden');
                    onSelect(data.find(d => d.startNumber == item.startNumber));
                });
                list.appendChild(itemEl);
            });
        }
        list.classList.remove('hidden');
    };

    searchInput.addEventListener('input', () => renderList(searchInput.value));
    searchInput.addEventListener('focus', () => renderList(searchInput.value));
    const docClickHandler = (e) => {
        if (!container.contains(e.target)) {
            list.classList.add('hidden');
        }
    };
    document.addEventListener('click', docClickHandler);

    return {
        setValue: (value) => {
            const item = data.find(d => d.startNumber == value);
            if (item) {
                searchInput.value = `#${item.startNumber} - ${item.driverName}`;
                selectedValue = item.startNumber;
                onSelect(item);
            } else {
                searchInput.value = '';
                selectedValue = null;
                onSelect(null);
            }
        },
        getValue: () => selectedValue,
        destroy: () => {
            document.removeEventListener('click', docClickHandler);
            container.innerHTML = '';
        }
    };
}

/**
 * Visar en modal för meddelanden (t.ex. "Sparat!").
 * @param {string} message - Meddelandet som ska visas.
 * @param {boolean} isSuccess - Om det är ett framgångs- eller felmeddelande.
 */
export function showAlert(message, isSuccess = true) {
    const modal = document.getElementById('alertModal');
    const iconDiv = document.getElementById('alertModalIcon');
    const titleEl = document.getElementById('alertModalTitle');
    const messageEl = document.getElementById('alertModalMessage');
    const button = document.getElementById('closeAlertModal');

    if (isSuccess === 'offline') {
        iconDiv.className = 'mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-yellow-100';
        iconDiv.innerHTML = `<svg class="h-6 w-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>`;
        titleEl.textContent = 'Sparad till kö';
        button.className = "px-4 py-2 bg-yellow-600 text-white text-base font-medium rounded-md w-full shadow-sm hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-yellow-500";
    } else if (isSuccess) {
        iconDiv.className = 'mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100';
        iconDiv.innerHTML = `<svg class="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`;
        titleEl.textContent = 'Klart!';
        button.className = "px-4 py-2 bg-green-600 text-white text-base font-medium rounded-md w-full shadow-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500";
    } else {
        iconDiv.className = 'mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100';
        iconDiv.innerHTML = `<svg class="h-6 w-6 text-red-600" stroke="currentColor" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>`;
        titleEl.textContent = 'Fel!';
        button.className = "px-4 py-2 bg-red-600 text-white text-base font-medium rounded-md w-full shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500";
    }

    messageEl.textContent = message;
    modal.style.display = 'flex';

    // Se till att knappen har en lyssnare
    button.onclick = () => {
        modal.style.display = 'none';
    };
}