// "Meddela omkörning" on the precision results (precisionDriveOffNotice.js):
// which classes wait for a drive-off and the ready texts to the qualifiers
// and the speaker. Pure: no browser or Firebase imports.

// Who may call a drive-off: those who may write competition messages
// (firestore.rules: admins; the TD a 'driveOff' message only)
const CALL_UP_ROLES = ['admin', 'superadmin', 'td'];

/** Whether the merged roles of the user may call a drive-off */
export function canCallDriveOff(roles = []) {
    return (Array.isArray(roles) ? roles : []).some((r) => CALL_UP_ROLES.includes(r));
}

/**
 * The classes (placing groups) whose drive-off is still to be driven, with
 * their qualifiers. rows: [{ label, ctx }] (ctx: precisionGroupContext's
 * contextOf). -> [{ label, startNumbers }] in the order first seen
 */
export function driveOffCallUpGroups(rows = []) {
    const groups = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
        const ctx = row?.ctx;
        if (!ctx?.driveOffPending) return;
        const label = String(row.label || '');
        if (groups.has(label)) return;
        const startNumbers = (Array.isArray(ctx.qualifierStartNumbers) ? ctx.qualifierStartNumbers : []).map(String);
        if (startNumbers.length >= 2) groups.set(label, { label, startNumbers });
    });
    return [...groups.values()];
}

function whoList(startNumbers = [], equipages = []) {
    const byNumber = new Map((Array.isArray(equipages) ? equipages : []).map((e) => [String(e?.startNumber ?? ''), e]));
    return startNumbers.map((sn) => {
        const name = String(byNumber.get(String(sn))?.driverName || '').trim();
        return `#${sn}${name ? ` ${name}` : ''}`;
    }).join(', ');
}

/**
 * The message to the qualifiers (Swedish and English) and the speaker's
 * short notice. -> { title, titleEn, body, bodyEn, speakerTitle, speakerBody }
 */
export function buildDriveOffMessages({ label = '', startNumbers = [], equipages = [] } = {}) {
    const who = whoList(startNumbers, equipages);
    const cls = String(label || '').trim();
    return {
        title: `Omkörning i precision${cls ? ` – ${cls}` : ''}`,
        titleEn: `Drive-off in the driven cones${cls ? ` – ${cls}` : ''}`,
        body: `Det blir omkörning i precision${cls ? ` i ${cls}` : ''}. Kvalificerade ekipage: ${who}. Kontakta sekretariatet för tid och startordning.`,
        bodyEn: `There will be a drive-off in the driven cones${cls ? ` in ${cls}` : ''}. Qualified equipages: ${who}. Contact the secretariat for the time and the starting order.`,
        speakerTitle: `Omkörning${cls ? ` – ${cls}` : ''}`,
        speakerBody: `Omkörning i precision${cls ? ` i ${cls}` : ''}: ${who}.`
    };
}
