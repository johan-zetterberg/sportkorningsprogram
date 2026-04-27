/**
 * js/services/themeService.js
 * Hanterar Dark Mode-logik, persistence och system-lyssnare.
 */

export function initTheme() {
    const toggleContainer = document.getElementById('theme-toggle-container');
    if (!toggleContainer) return;

    // Skapa knapp om den inte finns
    // Vi använder en enkel knapp som cyklar mellan: Light -> Dark -> Auto? 
    // Eller bara Light <-> Dark toggle för enkelhetens skull, med Auto som startvärde.
    // Låt oss göra en snygg toggle-knapp.

    // Läs nuvarande state (synkat med head-scriptet i index.html)
    const isDark = document.documentElement.classList.contains('dark');

    // Rendera knapp
    renderToggle(toggleContainer, isDark);
}

function renderToggle(container, isDark) {
    container.innerHTML = `
        <button id="themeToggleBtn" 
            class="p-2 rounded-full text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700 transition-colors focus:outline-none"
            title="${isDark ? 'Växla till ljust läge' : 'Växla till mörkt läge'}">
            ${isDark ? getIcon('moon') : getIcon('sun')}
        </button>
    `;

    document.getElementById('themeToggleBtn').addEventListener('click', () => {
        toggleTheme();
    });
}

function getIcon(type) {
    if (type === 'sun') {
        // Sol-ikon (för ljust läge -> visar att man kan byta till mörkt? Nej, visar nuvarande state? 
        // Standard är ofta: Visa ikonen för det läge man BYTER TILL, eller det läge man ÄR i.
        // Tailwind docs visar måne när det är ljust (för att byta till mörkt) och sol när det är mörkt.
        // Vi kör: Visa SOL när det är LJUST, visa MÅNE när det är MÖRKT. (Status-indikator)
        return `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>`;
    } else {
        // Måne-ikon
        return `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>`;
    }
}

function toggleTheme() {
    const html = document.documentElement;
    const isDark = html.classList.contains('dark');

    if (isDark) {
        html.classList.remove('dark');
        localStorage.setItem('theme', 'light');
        renderToggle(document.getElementById('theme-toggle-container'), false);
    } else {
        html.classList.add('dark');
        localStorage.setItem('theme', 'dark');
        renderToggle(document.getElementById('theme-toggle-container'), true);
    }
}
