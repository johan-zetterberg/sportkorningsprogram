// Pure helpers of the E-post card (adminMailCard.js).

const SUFFIX = /\s+via\s+DriveLive\s*$/i;

/**
 * The name for "Visas som: {name} via DriveLive". The server's from name
 * already ends with "via DriveLive", so it is stripped first; otherwise the
 * preview read "Klubb via DriveLive via DriveLive".
 */
export function senderPreviewName(fromName) {
    let name = String(fromName ?? '').trim();
    // Repeated suffixes (a sender name saved with it, then added again)
    while (SUFFIX.test(name)) name = name.replace(SUFFIX, '').trim();
    return name;
}
