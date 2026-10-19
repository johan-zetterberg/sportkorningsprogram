// #privacy: the privacy notice, readable without login. With ?id=<competition>
// it names that competition's organiser. Text: js/content/privacyNotice.js.
import { buildPrivacyNotice, organiserFromCompetition, PRIVACY_NOTICE_UPDATED } from '../../content/privacyNotice.js';
import { getCompetitionById, getConfig } from '../../services/competitionService.js';
import { getCurrentLanguage } from '../../utils/i18n.js';
import { escapeHtml } from '../../utils/sharedUtils.js';

let loadSeq = 0;

function requestedCompetitionId() {
    try {
        const hashQuery = window.location.hash.split('?')[1] || '';
        const id = new URLSearchParams(hashQuery).get('id') || new URLSearchParams(window.location.search || '').get('id');
        return id && /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : null;
    } catch {
        return null;
    }
}

async function loadOrganiser(competitionId) {
    if (!competitionId) return null;
    try {
        const competition = await getCompetitionById(competitionId);
        if (!competition) return null;
        let info = null;
        try {
            info = (await getConfig(competitionId, 'eqentriesImport'))?.importedCompetitionInfo || null;
        } catch (_) { /* the organiser block of the import is optional */ }
        return organiserFromCompetition(competition, info);
    } catch (error) {
        console.warn('Kunde inte läsa tävlingen för integritetspolicyn:', error);
        return null;
    }
}

function renderSection(section) {
    const paragraphs = (section.paragraphs || [])
        .map((text) => `<p class="mb-2">${escapeHtml(text)}</p>`).join('');
    const items = section.items?.length
        ? `<ul class="list-disc pl-5 space-y-1">${section.items.map((text) => `<li>${escapeHtml(text)}</li>`).join('')}</ul>`
        : '';
    return `<section id="privacy-${escapeHtml(section.id)}" class="mb-6">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">${escapeHtml(section.title)}</h2>
        ${paragraphs}${items}
    </section>`;
}

function render(container, lang, organiser) {
    const en = lang === 'en';
    const sections = buildPrivacyNotice(lang, organiser);
    const subtitle = organiser?.competitionName
        ? `${en ? 'Competition' : 'Tävling'}: ${organiser.competitionName}`
        : '';
    container.innerHTML = `
        <article class="container mx-auto max-w-3xl p-4 md:p-8 text-gray-700 dark:text-gray-300 text-sm md:text-base leading-relaxed">
            <header class="mb-6 flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                    <h1 class="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">${en ? 'Privacy notice' : 'Integritetspolicy'}</h1>
                    ${subtitle ? `<p class="text-sm text-gray-500 dark:text-gray-400">${escapeHtml(subtitle)}</p>` : ''}
                    <p class="text-xs text-gray-500 dark:text-gray-400">${en ? 'Updated' : 'Uppdaterad'} ${escapeHtml(PRIVACY_NOTICE_UPDATED)}</p>
                </div>
                <button type="button" id="privacyLangBtn" class="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700">${en ? 'På svenska' : 'In English'}</button>
            </header>
            ${sections.map(renderSection).join('')}
        </article>`;
    container.querySelector('#privacyLangBtn')?.addEventListener('click', () => {
        render(container, en ? 'sv' : 'en', organiser);
    });
}

export async function load(container = document.getElementById('page-privacy')) {
    if (!container) return;
    const seq = ++loadSeq;
    const lang = getCurrentLanguage();
    // The generic text at once; the organiser when the competition is read
    render(container, lang, null);
    const organiser = await loadOrganiser(requestedCompetitionId());
    if (seq !== loadSeq || !organiser) return;
    render(container, lang, organiser);
}

export function unload() {
    loadSeq++;
}
