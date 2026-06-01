// js/ui/components.js
import { escapeHtml } from '../utils/sharedUtils.js';
import { getCompetitionLogoHtml } from '../utils/competitionLogo.js';

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
        <header class="bg-gradient-to-r from-brand-darkblue to-indigo-950 dark:from-gray-900 dark:to-gray-800 border-b-4 border-brand-gold dark:border-brand-gold/70 p-2 md:p-4 rounded-t-lg mb-2 md:mb-4 shadow-xl flex items-center gap-3 md:gap-4 transition-colors">
            
            ${getCompetitionLogoHtml(competition, {
                fallbackHtml: '<img src="/icons/DriveLive_512.png" alt="DriveLive Logga" class="h-12 w-12 md:h-16 md:w-16 rounded-md flex-shrink-0">'
            })}

            <div class="flex-grow">
                <div class="flex items-center gap-2">
                    <h1 class="text-xl md:text-2xl font-bold font text-white">${competition.name || 'Tävling'}</h1>
                    ${(competition.published === false) ? '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-yellow-400 text-yellow-900 shadow-sm uppercase tracking-wider">UTKAST</span>' : ''}
                </div>
                <p class="text-sm md:text-base text-brand-lightblue dark:text-blue-300">${pageTitle || ''}</p>
                
                ${(competition.location || dateString) ? `
                    <div class="text-xs text-gray-300 dark:text-gray-400 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
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
        <div class="searchable-dropdown relative bg-white dark:bg-gray-800">
            <input type="text" class="search-input w-full p-2 border dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400" placeholder="Sök på nr eller namn...">
            <div class="searchable-dropdown-list hidden absolute top-full left-0 right-0 bg-white dark:bg-gray-700 border dark:border-gray-600 mt-1 rounded-md shadow-lg z-10 max-h-60 overflow-y-auto"></div>
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
                itemEl.className = 'p-3 hover:bg-blue-50 dark:hover:bg-gray-600 cursor-pointer text-gray-900 dark:text-gray-100';
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
        updateData: (newData) => {
            data = newData;
        },
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
        iconDiv.className = 'mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-yellow-100 dark:bg-yellow-900';
        iconDiv.innerHTML = `<svg class="h-6 w-6 text-yellow-600 dark:text-yellow-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>`;
        titleEl.textContent = 'Sparad till kö';
        button.className = "px-4 py-2 bg-yellow-600 text-white text-base font-medium rounded-md w-full shadow-sm hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-yellow-500";
    } else if (isSuccess) {
        iconDiv.className = 'mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100 dark:bg-green-900';
        iconDiv.innerHTML = `<svg class="h-6 w-6 text-green-600 dark:text-green-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`;
        titleEl.textContent = 'Klart!';
        button.className = "px-4 py-2 bg-green-600 text-white text-base font-medium rounded-md w-full shadow-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500";
    } else {
        iconDiv.className = 'mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100 dark:bg-red-900';
        iconDiv.innerHTML = `<svg class="h-6 w-6 text-red-600 dark:text-red-300" stroke="currentColor" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>`;
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

/**
 * Renderar en responsiv klassfilter-komponent.
 * Visar chips på desktop och en dropdown-meny på mobil.
 * @param {HTMLElement} container - Elementet att rendera i.
 * @param {string[]} labels - Lista på klasser/etiketter.
 * @param {Set<string>} activeSet - Set med aktiva filter.
 * @param {Function} onToggle - Callback(label) när ett filter ändras.
 */
export function renderResponsiveClassFilter(container, labels, activeSet, onToggle) {
    if (!container) return;

    // Spara öppet-tillstånd för dropdown (mobil)
    const existingDetails = container.querySelector('.mobile-filter-dropdown');
    const wasOpen = existingDetails ? existingDetails.hasAttribute('open') : false;
    const portalId = container.dataset.responsiveClassFilterId
        || `class-filter-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    container.dataset.responsiveClassFilterId = portalId;
    container.__classFilterPortalCleanup?.();
    container.__classFilterPortalCleanup = null;
    document.querySelector(`[data-class-filter-portal="${portalId}"]`)?.remove();

    // CSS-klasser
    const chipBase = "max-w-full truncate px-2 py-1 rounded border text-sm cursor-pointer transition-colors select-none";
    const chipOn = "bg-gray-800 text-white border-gray-800 shadow-sm dark:bg-gray-200 dark:text-gray-900 dark:border-gray-200";
    const chipOff = "bg-white text-gray-700 border-gray-300 hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-600";

    // Desktop: Chips
    // Vi använder 'hidden md:flex' för att dölja på mobil och visa på desktop
    const desktopHtml = `
        <div class="hidden md:flex flex-wrap gap-2 max-w-full min-w-0 overflow-hidden">
            ${labels.map(lbl => {
        const active = activeSet.has(lbl);
        return `<button type="button" data-filter-val="${escapeHtml(lbl)}" title="${escapeHtml(lbl)}" class="${chipBase} ${active ? chipOn : chipOff}">${escapeHtml(lbl)}</button>`;
    }).join('')}
        </div>
    `;

    // Mobil: Dropdown (Details/Summary)
    const activeCount = activeSet.size;
    const summaryText = activeCount > 0 ? `Filtrera klass (${activeCount})` : 'Filtrera klass';

    const mobileItems = labels.map(lbl => {
        const active = activeSet.has(lbl);
        const checkIcon = active
            ? '<i class="fas fa-check-square text-blue-600 dark:text-blue-400"></i>'
            : '<i class="far fa-square text-gray-400 dark:text-gray-500"></i>';
        const rowBg = active ? 'bg-blue-50 dark:bg-blue-900/30' : '';
        const txtColor = active ? 'text-blue-800 dark:text-blue-200' : 'text-gray-700 dark:text-gray-200';

        return `
            <div data-filter-val="${escapeHtml(lbl)}" class="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-700 last:border-0 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-600 ${rowBg}">
                <div class="w-5 text-center">${checkIcon}</div>
                <span class="text-sm font-medium ${txtColor} min-w-0 truncate" title="${escapeHtml(lbl)}">${escapeHtml(lbl)}</span>
            </div>
         `;
    }).join('');

    const mobileHtml = `
        <details class="mobile-filter-dropdown md:hidden w-full max-w-full group relative z-[90]" ${wasOpen ? 'open' : ''}>
            <summary class="list-none px-3 py-1.5 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-xs md:text-sm font-medium text-gray-700 dark:text-gray-200 cursor-pointer flex items-center justify-between select-none hover:bg-gray-50 dark:hover:bg-gray-600">
                <span class="min-w-0 truncate">${summaryText}</span>
                <i class="fas fa-chevron-down text-gray-400 text-[10px] ml-2 transition-transform group-open:rotate-180"></i>
            </summary>
            <div data-class-filter-menu data-class-filter-portal="${portalId}" class="fixed bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-md shadow-lg max-h-80 overflow-y-auto w-[250px] max-w-[calc(100vw-1rem)]" style="z-index: 2147483647; top: 0; left: 0;" hidden>
                ${mobileItems.length > 0 ? mobileItems : '<div class="p-4 text-gray-500 text-sm italic text-center">Inga klasser tillgängliga</div>'}
            </div>
        </details>
    `;

    container.innerHTML = desktopHtml + mobileHtml;

    const mobileDetails = container.querySelector('.mobile-filter-dropdown');
    const mobileSummary = mobileDetails?.querySelector('summary');
    const mobileMenu = mobileDetails?.querySelector('[data-class-filter-menu]');
    if (mobileMenu) document.body.appendChild(mobileMenu);
    const positionMobileDropdown = () => {
        if (!mobileDetails || !mobileSummary || !mobileMenu || !mobileDetails.open) return;

        const margin = 8;
        const rect = mobileSummary.getBoundingClientRect();
        const menuWidth = Math.min(
            Math.max(rect.width, 250),
            Math.max(250, window.innerWidth - margin * 2)
        );
        const menuHeight = Math.min(mobileMenu.scrollHeight || 320, 320);
        const spaceBelow = window.innerHeight - rect.bottom - margin;
        const top = spaceBelow >= Math.min(menuHeight, 180)
            ? rect.bottom + 4
            : Math.max(margin, rect.top - menuHeight - 4);
        const left = Math.min(
            Math.max(margin, rect.left),
            Math.max(margin, window.innerWidth - menuWidth - margin)
        );

        mobileMenu.hidden = false;
        mobileMenu.style.top = `${Math.round(top)}px`;
        mobileMenu.style.left = `${Math.round(left)}px`;
        mobileMenu.style.width = `${Math.round(menuWidth)}px`;
    };

    const hideMobileDropdown = () => {
        if (mobileMenu) mobileMenu.hidden = true;
    };
    const toggleMobileDropdown = () => {
        if (mobileDetails?.open) requestAnimationFrame(positionMobileDropdown);
        else hideMobileDropdown();
    };
    const handlePortalClick = (e) => {
        const target = e.target.closest('[data-filter-val]');
        if (!target) return;

        e.preventDefault();
        e.stopPropagation();

        const val = target.getAttribute('data-filter-val');
        if (val && onToggle) onToggle(val);
    };
    const handleWindowMove = () => {
        if (mobileDetails?.open) requestAnimationFrame(positionMobileDropdown);
    };
    const removalObserver = new MutationObserver(() => {
        if (!document.body.contains(container)) {
            container.__classFilterPortalCleanup?.();
        }
    });

    mobileDetails?.addEventListener('toggle', toggleMobileDropdown);
    mobileSummary?.addEventListener('click', () => requestAnimationFrame(positionMobileDropdown));
    mobileMenu?.addEventListener('click', handlePortalClick);
    window.addEventListener('resize', handleWindowMove);
    window.addEventListener('scroll', handleWindowMove, true);
    removalObserver.observe(document.body, { childList: true, subtree: true });
    container.__classFilterPortalCleanup = () => {
        mobileDetails?.removeEventListener('toggle', toggleMobileDropdown);
        mobileMenu?.removeEventListener('click', handlePortalClick);
        window.removeEventListener('resize', handleWindowMove);
        window.removeEventListener('scroll', handleWindowMove, true);
        removalObserver.disconnect();
        mobileMenu?.remove();
    };
    if (wasOpen) requestAnimationFrame(positionMobileDropdown);

    // Koppla händelselyssnare (om ej redan gjort på containern)
    if (!container.dataset.wiredResponsive) {
        container.addEventListener('click', (e) => {
            const target = e.target.closest('[data-filter-val]');
            if (!target) return;

            e.preventDefault();
            e.stopPropagation();

            const val = target.getAttribute('data-filter-val');
            if (val && onToggle) {
                onToggle(val);
            }
        });
        container.dataset.wiredResponsive = 'true';
    }
}
