// "Veterinärstrykning avvaktar domarkollegiet": a chip next to an equipage
// while a vet's strike waits for the ground jury (equipage.vetStrikePending).
// Shown to staff and the speaker; the driver's own portal gets the longer
// wording. Pure HTML helper: all text through t(), nothing from user data.

import { t } from '../utils/i18n.js';

/** Whether the equipage has a vet strike waiting for the ground jury */
export function isVetStrikePending(equipage) {
    const pending = equipage?.vetStrikePending;
    return !!pending && typeof pending === 'object';
}

/**
 * The chip's HTML ('' when nothing is pending). own: the driver's own
 * equipage (portal wording); compact: shorter text for tight rows.
 */
export function vetStrikeChipHtml(equipage, { own = false, compact = false } = {}) {
    if (!isVetStrikePending(equipage)) return '';
    const text = t(own ? 'vet_strike_pending_driver' : 'vet_strike_pending_chip');
    // compact: a slightly smaller chip for tight rows (the text is the same)
    const size = compact ? 'text-[10px]' : 'text-[11px]';
    return `<span class="inline-flex items-center gap-1 rounded-full border border-amber-400 bg-amber-100 px-2 py-0.5 ${size} font-bold leading-tight text-amber-900 dark:border-amber-600 dark:bg-amber-900/40 dark:text-amber-100" data-vet-strike-pending><span aria-hidden="true">&#9888;</span>${text}</span>`;
}

/**
 * Puts the chip (or removes it) right after an element whose text the page
 * sets with textContent (the equipage line of an input page).
 */
export function syncVetStrikeChip(anchor, equipage, options = {}) {
    if (!anchor || !anchor.parentNode) return;
    const next = anchor.nextElementSibling;
    const existing = next && next.hasAttribute('data-vet-strike-slot') ? next : null;
    const html = vetStrikeChipHtml(equipage, options);
    if (!html) {
        if (existing) existing.remove();
        return;
    }
    const slot = existing || document.createElement('span');
    slot.setAttribute('data-vet-strike-slot', '');
    slot.className = 'ml-2 align-middle';
    slot.innerHTML = html;
    if (!existing) anchor.after(slot);
}
