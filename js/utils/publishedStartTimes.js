// Published start times. The admin's "Publicera" buttons (starttider.js) set
// config/startTimes.published.<discipline>; until then the times are a draft:
// outside the admin pages they must not be shown, used for class time
// windows, or lock the driver's declaration. The server mirrors this in
// functions/src/declarationLock.js. Re-exported from
// js/pages/admin/starttiderUtils.js.

const START_TIME_DISCIPLINES = ['dressage', 'marathon', 'precision'];
// Older documents also hold "maraton" next to "marathon"
const START_TIME_KEY_ALIASES = { maraton: 'marathon', dressyr: 'dressage' };

/** The discipline a start-time key belongs to ('maraton' → 'marathon'), or null */
export function startTimeDiscipline(key) {
    const k = String(key || '').toLowerCase();
    const mapped = START_TIME_KEY_ALIASES[k] || k;
    return START_TIME_DISCIPLINES.includes(mapped) ? mapped : null;
}

/**
 * The published flags of a start-times config in any of its shapes: the
 * document ({ times, published }), a { value: {...} } wrapper, or the times
 * map with .published attached (starttider.js). Missing = not published.
 */
export function startTimesPublishedFlags(config = {}) {
    const flags = config?.published || config?.value?.published || {};
    return {
        dressage: flags.dressage === true,
        marathon: flags.marathon === true || flags.maraton === true,
        precision: flags.precision === true
    };
}

/** Whether a discipline's start times ('dressage' | 'marathon' | 'maraton' | 'precision') are published */
export function isStartTimePublished(config, discipline) {
    const d = startTimeDiscipline(discipline);
    return !!d && startTimesPublishedFlags(config)[d];
}

function startTimesMapOf(config = {}) {
    if (config?.times && typeof config.times === 'object') return config.times;
    if (config?.value?.times && typeof config.value.times === 'object') return config.value.times;
    // The times map itself (keys are start numbers)
    return config && typeof config === 'object' ? config : {};
}

/**
 * One equipage's published start times, e.g. { dressage: '2026-10-13T09:00' }
 * (a "maraton" alias key is kept next to "marathon" when marathon is
 * published). Unpublished disciplines and other keys are left out.
 */
export function publishedTimesFor(config, startNumber) {
    const flags = startTimesPublishedFlags(config);
    const row = startTimesMapOf(config)?.[String(startNumber)] || {};
    const out = {};
    Object.entries(row && typeof row === 'object' ? row : {}).forEach(([key, value]) => {
        const d = startTimeDiscipline(key);
        if (d && flags[d] && value) out[key] = value;
    });
    return out;
}

/** The times map with only published disciplines: { [startNumber]: {...} } */
export function publishedStartTimes(config) {
    const times = startTimesMapOf(config);
    const out = {};
    Object.keys(times || {}).forEach((sn) => {
        if (sn === 'published') return;
        const row = publishedTimesFor(config, sn);
        if (Object.keys(row).length) out[sn] = row;
    });
    return out;
}
