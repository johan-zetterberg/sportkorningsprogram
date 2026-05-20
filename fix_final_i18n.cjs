const fs = require('fs');
const path = 'js/utils/i18n.js';
let c = fs.readFileSync(path, 'utf8');

const newKeys = `
    // Remaining Audited Keys
    'search': { sv: 'Sök', en: 'Search' },
    'marathon': { sv: 'Maraton', en: 'Marathon' },
    'no_equipages_found_for_competition': { sv: 'Inga ekipage hittades för denna tävling.', en: 'No equipages found for this competition.' },
    'click_map_to_close': { sv: 'Klicka var som helst på kartan för att stänga.', en: 'Click anywhere on the map to close.' },
    'loading_map': { sv: 'Laddar karta...', en: 'Loading map...' },
    'no_results': { sv: 'Inga resultat', en: 'No results' },
    'observer_load_error': { sv: 'Kunde inte ladda observatörsdata.', en: 'Could not load observer data.' },
    'linked_badge': { sv: 'Länkad', en: 'Linked' },
    'ranking': { sv: 'Plac.', en: 'Rank' },
    'elim': { sv: 'Elim.', en: 'Elim.' },
    'view_legend': { sv: 'Visa teckenförklaring', en: 'View legend' },
    'legend_short': { sv: 'Teckenförklaring', en: 'Legend' },
    'unknown_driver': { sv: 'Okänd kusk', en: 'Unknown driver' }
`;

if (!c.includes('no_equipages_found_for_competition')) {
    c = c.replace(/};\s*\/\*\*/, newKeys + '\n};\n\n/**');
    fs.writeFileSync(path, c, 'utf8');
    console.log('Fixed final audited i18n keys!');
}
