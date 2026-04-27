/**
 * js/ui/languageToggle.js
 * Handles the user-facing language switcher (Flag button).
 * Persists choice to localStorage so i18n.js can pick it up.
 */

import { t } from '../utils/i18n.js';

const STORAGE_KEY = 'user_lang_pref';

/**
 * Gets the current user preference.
 * @returns {'sv' | 'en' | null}
 */
export function getUserLanguage() {
    return localStorage.getItem(STORAGE_KEY);
}

/**
 * Toggles the language between Swedish and English.
 */
export function toggleUserLanguage() {
    const current = getUserLanguage();
    // Logic: If currently 'en', switch to 'sv'. Otherwise (null or 'sv'), switch to 'en'.
    // If null, we assume they might be seeing default. 
    // But simplest toggle: "Not English" -> English. "English" -> Swedish.
    const newLang = current === 'en' ? 'sv' : 'en';
    localStorage.setItem(STORAGE_KEY, newLang);
    window.location.reload();
}

/**
 * Renders the language toggle button into a container.
 * @param {HTMLElement} container - The element to append the toggle to.
 * @param {boolean} isInternationalDefault - The competition default (used to show "Default" state if needed).
 */
export function renderLanguageToggle(container) {
    if (!container) return;

    const current = getUserLanguage();
    // If current is null, we strictly don't know what they see (it depends on isInternational).
    // But we can just show the flag they WOULD switch to, or the flag of the current language.
    // Let's show the flag of the *active* language (or what we think it is).

    // Better UX: Show a button with the flag of the *other* language (Switch to...).
    // OR: Show current flag. Standard is often showing current flag or a dropdown.
    // Let's go with a simple clickable flag representing the *current* state, clicking it swaps.

    // If preference is 'en', show UK flag.
    // If preference is 'sv', show SE flag.
    // If null, we might need to guess based on context, but let's default to showing "SW/EN" text or similar if ambiguous?
    // Actually, let's keep it simple: Default to "Switch Language" icon if unsure, or just cycle.

    const isEn = current === 'en'; // Strict check

    // SVG Flags (Inline for robustness)
    const svFlag = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 10" class="w-6 h-4 shadow-sm"><rect width="16" height="10" fill="#006aa7"/><rect width="2" height="10" x="5" fill="#fecc00"/><rect width="16" height="2" y="4" fill="#fecc00"/></svg>`;
    const enFlag = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 30" class="w-6 h-4 shadow-sm"><clipPath id="s"><path d="M0,0 v30 h60 v-30 z"/></clipPath><clipPath id="t"><path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z"/></clipPath><g clip-path="url(#s)"><path d="M0,0 v30 h60 v-30 z" fill="#012169"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" stroke-width="6"/><path d="M0,0 L60,30 M60,0 L0,30" clip-path="url(#t)" stroke="#C8102E" stroke-width="4"/><path d="M30,0 v30 M0,15 h60" stroke="#fff" stroke-width="10"/><path d="M30,0 v30 M0,15 h60" stroke="#C8102E" stroke-width="6"/></g></svg>`;

    // If current is SE -> Show "Switch to English" button? 
    // Or show "Current: SE"? 
    // Standard Toggle (Status Quo but prettier): Show current flag + label.
    // Allow user to click to SWAP.

    // Icon to show: The CURRENT language. (So they know what they have selected)
    const icon = isEn ? enFlag : svFlag;
    const label = isEn ? 'English' : 'Svenska';
    const nextParams = isEn ? 'Byt till Svenska' : 'Switch to English';

    const btn = document.createElement('button');
    btn.className = 'flex items-center gap-2 px-3 py-1.5 rounded-full bg-white hover:bg-gray-50 text-sm font-medium transition-all border border-gray-300 shadow-sm';
    btn.title = nextParams;
    btn.innerHTML = `<span class="flex items-center justify-center w-6 h-4 overflow-hidden rounded-[2px]">${icon}</span> <span class="hidden sm:inline text-gray-700">${label}</span>`;

    btn.onclick = (e) => {
        e.preventDefault();
        toggleUserLanguage();
    };

    container.appendChild(btn);
}
