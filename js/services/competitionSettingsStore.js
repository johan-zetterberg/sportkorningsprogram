// Result settings of the active competition, in one place.
//
// Pages used to share settings through window globals (window.klassProgramMapping,
// window.dressageJudgeMapping, ...). After switching competitions those could still
// hold the previous competition's values, and a page that was still loading the
// previous competition could write them after the switch. Here every value
// belongs to one competition:
// - main.js activates the competition when the selection changes, which clears
//   all values (and tells listeners, e.g. the marathon engine adapter);
// - a write names its competition and is ignored if that is not the active one;
// - a read returns only the active competition's values.
// The window globals stay as accessors to this store, so existing reads keep
// working and can no longer see another competition's settings.

const WINDOW_SETTING_KEYS = [
    'klassProgramMapping',   // config/dressyrProgramMapping: dressage program per class
    'dressageJudgeMapping',  // config/dressageJudgeMapping: judges per class
    'currentJudgesPresent',  // the competition's judges
    'dressagePrograms',      // built-in programs merged with the competition's own
    'dressyrClassConfig',
    'competitionConfig'
];

let activeCompetitionId = null;
let values = {};
const resetListeners = [];

export function getActiveCompetitionId() {
    return activeCompetitionId;
}

// Called by main.js when the selected competition changes (not on updates of
// the same competition)
export function activateCompetitionSettings(competitionId) {
    const next = competitionId || null;
    if (next === activeCompetitionId) return;
    activeCompetitionId = next;
    values = {};
    resetListeners.forEach((fn) => {
        try { fn(next); } catch (error) { console.warn('competitionSettingsStore: reset listener failed', error); }
    });
}

export function onCompetitionSettingsReset(fn) {
    if (typeof fn === 'function') resetListeners.push(fn);
}

/**
 * Stores a setting for a competition. Ignored (returns false) when another
 * competition is active: a page still loading the previous competition must
 * not overwrite the new one's settings. With no active competition the
 * writer's competition becomes active.
 */
export function setCompetitionSetting(competitionId, key, value) {
    if (!competitionId) return false;
    if (activeCompetitionId === null) activateCompetitionSettings(competitionId);
    if (competitionId !== activeCompetitionId) {
        console.warn(`competitionSettingsStore: ignored "${key}" for ${competitionId}; ${activeCompetitionId} is active`);
        return false;
    }
    values[key] = value;
    return true;
}

export function getCompetitionSetting(key, competitionId = activeCompetitionId) {
    if (!competitionId || competitionId !== activeCompetitionId) return undefined;
    return values[key];
}

// window.<key> reads the active competition's value; assigning stores it for
// the active competition (prefer setCompetitionSetting, which names it)
export function installWindowSettingAccessors(target = (typeof window !== 'undefined' ? window : null)) {
    if (!target) return;
    WINDOW_SETTING_KEYS.forEach((key) => {
        Object.defineProperty(target, key, {
            configurable: true,
            enumerable: false,
            get: () => getCompetitionSetting(key),
            set: (value) => { setCompetitionSetting(activeCompetitionId, key, value); }
        });
    });
}

export { WINDOW_SETTING_KEYS };
