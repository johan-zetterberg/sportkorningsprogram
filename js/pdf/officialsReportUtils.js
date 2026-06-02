export function buildCheckInPdfRows(officials = []) {
    return [...officials]
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'sv'))
        .map(person => [
            person.isCheckedIn ? '[ X ]' : '[   ]',
            person.name || '',
            person.role || '',
            person.hasVest ? '[ X ]' : '[   ]',
            person.hasRadio ? '[ X ]' : '[   ]',
            person.checkInNotes || ''
        ]);
}
