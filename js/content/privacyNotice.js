// The privacy notice (GDPR Art. 13) shown at #privacy. The text lives here
// only: edit it here. OWNER: fill in OPERATOR and DATA_LOCATION before the
// first real competition (see docs/OPS.md).

export const PRIVACY_NOTICE_UPDATED = '2026-10-19';

// The app operator (runs DriveLive for the organising clubs)
export const OPERATOR = {
    name: 'DriveLive',
    email: '' // e.g. the operator's support address; empty shows "contact the organiser"
};

// Where Firestore and Storage keep the data (Firebase console > Project
// settings > General > Default GCP resource location). Null until confirmed.
export const DATA_LOCATION = null;

// Retention defaults (functions/src/personalData.js)
export const DEFAULT_RETENTION_MONTHS = 12;
export const COUNTER_RETENTION_DAYS = 30;

/**
 * The organiser shown for a competition: its privacy contact (admin setting
 * privacyContact), else the organiser from the entry import, else the club.
 * Null without a competition.
 */
export function organiserFromCompetition(competition, importedInfo = null) {
    if (!competition) return null;
    const name = String(importedInfo?.organizer || competition.organizerName || competition.club || '').trim();
    const contact = String(competition.privacyContact || [importedInfo?.email, importedInfo?.phone].filter(Boolean).join(', ')).trim();
    const months = Number(competition.retentionMonths);
    return {
        name: name || String(competition.name || '').trim(),
        contact,
        competitionName: String(competition.name || '').trim(),
        retentionMonths: Number.isInteger(months) && months >= 1 && months <= 120 ? months : DEFAULT_RETENTION_MONTHS
    };
}

/**
 * The notice as sections { id, title, paragraphs?, items? } in 'sv' or 'en'.
 * `organiser`: { name, contact, retentionMonths } when opened for a
 * competition (?id=), else null (generic text). Plain text: the page escapes it.
 */
export function buildPrivacyNotice(lang = 'sv', organiser = null) {
    const en = lang === 'en';
    const months = Number.isInteger(organiser?.retentionMonths) ? organiser.retentionMonths : DEFAULT_RETENTION_MONTHS;
    const operatorContact = OPERATOR.email
        ? `${OPERATOR.name}, ${OPERATOR.email}`
        : OPERATOR.name;
    const location = DATA_LOCATION
        || (en ? 'a Google Cloud region chosen by the operator (stated here once confirmed)' : 'en Google Cloud-region som operatören valt (anges här när den är bekräftad)');

    const controller = organiser?.name
        ? (en
            ? `For this competition the controller is the organiser: ${organiser.name}${organiser.contact ? ` (${organiser.contact})` : ''}.`
            : `För den här tävlingen är arrangören personuppgiftsansvarig: ${organiser.name}${organiser.contact ? ` (${organiser.contact})` : ''}.`)
        : (en
            ? 'For each competition the organising club is the controller of the personal data of that competition. Open this page from a competition to see its organiser.'
            : 'För varje tävling är den arrangerande klubben personuppgiftsansvarig för tävlingens personuppgifter. Öppna sidan från en tävling för att se dess arrangör.');

    if (en) {
        return [
            { id: 'controller', title: 'Who is responsible', paragraphs: [
                controller,
                `The app operator (${operatorContact}) provides the service to the organisers and is responsible for user accounts.`
            ] },
            { id: 'processor', title: 'Processor and where data is stored', paragraphs: [
                'The app runs on Google Firebase (Google Ireland Ltd / Google LLC) under Google\'s data processing terms (Cloud Data Processing Addendum).',
                `Server functions run in europe-west1 (Belgium). The database and file storage are in ${location}.`,
                'Login (Firebase Authentication) may process data, such as email address and IP address, outside the EU/EEA. Such transfers are covered by the EU standard contractual clauses and the EU–US Data Privacy Framework.'
            ] },
            { id: 'purposes', title: 'Purposes and legal bases', items: [
                'Competition administration (entries, start lists, judging, results): performance of the contract with the participant (Art. 6(1)(b)) and the organiser\'s legitimate interest (Art. 6(1)(f)).',
                'Publication of results (name, club, horse, placing): legitimate interest; results are part of the sport.',
                'Safety: emergency contact (ICE) for participants and officials: legitimate interest and vital interests (Art. 6(1)(d)).',
                'Vet checks and horse welfare (temperatures, vet findings): legitimate interest (horse welfare and disease control under the competition rules) and, where applicable, a legal obligation (Art. 6(1)(c)).',
                'Optional details (e.g. diet, clothing size, notes): consent, which you can withdraw at any time by contacting the organiser.'
            ] },
            { id: 'public', title: 'What is public and what is not', items: [
                'Public: names, club, horse names, class, start times and results.',
                'Not public (organisers and the officials who need it): contact details, personal identity number, emergency contact (ICE), health and vet data, volunteer sign-ups.'
            ] },
            { id: 'retention', title: 'How long data is kept', items: [
                `Contact details, ICE, personal identity numbers, horse temperatures, vet data and volunteer sign-ups are deleted automatically ${months} months after the competition was archived${organiser?.name ? '' : ' (12 months unless the organiser chose otherwise)'}.`,
                'Results stay published as the sport\'s result history.',
                'Logs of changes are kept without names and email addresses.',
                `Technical counters (login attempts, rate limits) are deleted after ${COUNTER_RETENTION_DAYS} days; technical logs are normally kept for 30 days.`,
                'Your account is kept until you delete it.'
            ] },
            { id: 'rights', title: 'Your rights', paragraphs: [
                'You have the right to access, rectification, erasure, restriction and objection, and to data portability where it applies. Contact the organiser of the competition; they can export your data from the app. You may also complain to the Swedish Authority for Privacy Protection (IMY), imy.se.'
            ] },
            { id: 'delete-account', title: 'Deleting your account', paragraphs: [
                'Signed in: open My Portal, scroll to My account and choose "Delete my account". You confirm by typing your email address. Your login, your roles and your links to entries are removed, and contact details in entries of archived competitions are deleted. Published results remain. If you own competitions, transfer or delete them first.'
            ] }
        ];
    }
    return [
        { id: 'controller', title: 'Vem som ansvarar', paragraphs: [
            controller,
            `Appens operatör (${operatorContact}) tillhandahåller tjänsten åt arrangörerna och ansvarar för användarkontona.`
        ] },
        { id: 'processor', title: 'Personuppgiftsbiträde och var uppgifterna lagras', paragraphs: [
            'Appen körs på Google Firebase (Google Ireland Ltd / Google LLC) enligt Googles personuppgiftsbiträdesavtal (Cloud Data Processing Addendum).',
            `Serverfunktionerna körs i europe-west1 (Belgien). Databasen och fillagringen finns i ${location}.`,
            'Inloggningen (Firebase Authentication) kan behandla uppgifter, t.ex. e-postadress och IP-adress, utanför EU/EES. Sådana överföringar omfattas av EU:s standardavtalsklausuler och EU–US Data Privacy Framework.'
        ] },
        { id: 'purposes', title: 'Ändamål och rättslig grund', items: [
            'Tävlingsadministration (anmälan, startlistor, bedömning, resultat): fullgörande av avtal med deltagaren (art. 6.1 b) och arrangörens berättigade intresse (art. 6.1 f).',
            'Publicering av resultat (namn, klubb, häst, placering): berättigat intresse; resultaten är en del av sporten.',
            'Säkerhet: nödkontakt (ICE) för deltagare och funktionärer: berättigat intresse och grundläggande intressen (art. 6.1 d).',
            'Veterinärkontroll och hästvälfärd (temperaturer, veterinärens fynd): berättigat intresse (hästvälfärd och smittskydd enligt tävlingsreglerna) och, i förekommande fall, rättslig förpliktelse (art. 6.1 c).',
            'Frivilliga uppgifter (t.ex. kost, klädstorlek, anteckningar): samtycke, som du när som helst kan återkalla genom att kontakta arrangören.'
        ] },
        { id: 'public', title: 'Vad som är offentligt och inte', items: [
            'Offentligt: namn, klubb, hästnamn, klass, starttider och resultat.',
            'Inte offentligt (arrangören och de funktionärer som behöver det): kontaktuppgifter, personnummer, nödkontakt (ICE), hälso- och veterinäruppgifter, funktionärsanmälningar.'
        ] },
        { id: 'retention', title: 'Hur länge uppgifterna sparas', items: [
            `Kontaktuppgifter, ICE, personnummer, hästtemperaturer, veterinäruppgifter och funktionärsanmälningar raderas automatiskt ${months} månader efter att tävlingen arkiverats${organiser?.name ? '' : ' (12 månader om arrangören inte valt annat)'}.`,
            'Resultaten ligger kvar publicerade som sportens resultathistorik.',
            'Loggar över ändringar sparas utan namn och e-postadresser.',
            `Tekniska räknare (inloggningsförsök, hastighetsgränser) raderas efter ${COUNTER_RETENTION_DAYS} dagar; tekniska loggar sparas normalt i 30 dagar.`,
            'Ditt konto finns kvar tills du raderar det.'
        ] },
        { id: 'rights', title: 'Dina rättigheter', paragraphs: [
            'Du har rätt till tillgång (registerutdrag), rättelse, radering, begränsning och att invända, samt dataportabilitet där den gäller. Kontakta tävlingens arrangör; arrangören kan exportera dina uppgifter ur appen. Du kan också klaga hos Integritetsskyddsmyndigheten (IMY), imy.se.'
        ] },
        { id: 'delete-account', title: 'Radera ditt konto', paragraphs: [
            'Inloggad: öppna Min Portal, gå till Mitt konto och välj "Radera mitt konto". Du bekräftar genom att skriva din e-postadress. Inloggningen, dina roller och kopplingar till anmälningar tas bort, och kontaktuppgifterna i anmälningar i arkiverade tävlingar raderas. Publicerade resultat ligger kvar. Äger du tävlingar behöver de först överlåtas eller raderas.'
        ] }
    ];
}
