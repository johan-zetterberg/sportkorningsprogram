export const DEFAULT_HORSE_TEMPERATURE_CONFIG = {
    enabled: false,
    daysBefore: 3,
    checksPerDay: 2,
    warningTemperatureC: null,
    instructions: ''
};

function clampInt(value, fallback, min, max) {
    const number = Number.parseInt(value, 10);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
}

export function normalizeHorseTemperatureValue(value) {
    if (value === null || value === undefined || value === '') return null;
    const normalized = Number.parseFloat(String(value).replace(',', '.'));
    if (!Number.isFinite(normalized)) return null;
    return Math.round(normalized * 10) / 10;
}

export function normalizeHorseTemperatureConfig(config = {}) {
    const warningTemperatureC = normalizeHorseTemperatureValue(config.warningTemperatureC);

    return {
        enabled: !!config.enabled,
        daysBefore: clampInt(config.daysBefore, DEFAULT_HORSE_TEMPERATURE_CONFIG.daysBefore, 1, 14),
        checksPerDay: Number(config.checksPerDay) === 1 ? 1 : 2,
        warningTemperatureC,
        instructions: String(config.instructions || '').trim()
    };
}

export function parseCompetitionStartDate(dates) {
    const match = String(dates || '').match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);

    if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
    ) {
        return null;
    }

    return date;
}

function pad2(value) {
    return String(value).padStart(2, '0');
}

function toLocalDateString(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function toDefaultDateTime(date, time) {
    return `${toLocalDateString(date)}T${time}`;
}

export function buildHorseTemperatureSlots(competitionDates, rawConfig = {}) {
    const config = normalizeHorseTemperatureConfig(rawConfig);
    if (!config.enabled) return [];

    const startDate = parseCompetitionStartDate(competitionDates);
    if (!startDate) return [];

    const periods = config.checksPerDay === 1
        ? [{ key: 'daily', label: 'Kontroll', defaultTime: '08:00' }]
        : [
            { key: 'morning', label: 'Morgon', defaultTime: '08:00' },
            { key: 'evening', label: 'Kväll', defaultTime: '18:00' }
        ];

    const slots = [];
    for (let offset = config.daysBefore; offset >= 1; offset -= 1) {
        const slotDate = new Date(startDate);
        slotDate.setDate(startDate.getDate() - offset);
        const dateKey = toLocalDateString(slotDate);

        periods.forEach(period => {
            slots.push({
                id: `${dateKey}_${period.key}`,
                date: dateKey,
                dayOffset: offset,
                label: `${dateKey} ${period.label}`,
                periodLabel: period.label,
                defaultDateTime: toDefaultDateTime(slotDate, period.defaultTime)
            });
        });
    }

    return slots;
}

// Identifiers that stay with the horse when it is renamed, most preferred
// first (the registration id the driver declares comes first)
const HORSE_ID_FIELDS = ['id', 'horseId', 'regNo', 'ueln', 'uid', 'chipNumber', 'chip', 'lic', 'license'];
const HORSE_NAME_FIELDS = ['name', 'horseName', 'namn'];

const cleanKey = (value) => String(value ?? '').trim();

/**
 * Every key a horse's temperatures may be stored under: the stable key first,
 * then older keys (its name, or another id field) that earlier versions used,
 * so temperatures saved before the horse got an id are still found.
 */
export function getTemperatureHorseKeys(horse = {}, index = 0) {
    const keys = [...HORSE_ID_FIELDS, ...HORSE_NAME_FIELDS]
        .map(field => cleanKey(horse?.[field]))
        .filter(Boolean);
    if (!keys.length) keys.push(`horse-${index + 1}`);
    return [...new Set(keys)];
}

export function getTemperatureHorseStableKey(horse = {}, index = 0) {
    return getTemperatureHorseKeys(horse, index)[0];
}

export function getTemperatureHorseName(horse = {}, index = 0) {
    return String(horse.name || horse.horseName || horse.namn || `Häst ${index + 1}`);
}

export function getTemperatureHorses(equipage = {}) {
    if (Array.isArray(equipage.horses) && equipage.horses.length > 0) {
        return equipage.horses.map((horse, index) => {
            const keys = getTemperatureHorseKeys(horse, index);
            return {
                ...horse,
                _temperatureKey: keys[0],
                _temperatureKeys: keys,
                _temperatureName: getTemperatureHorseName(horse, index),
                _temperatureIndex: index
            };
        });
    }

    const horses = [];
    for (let i = 1; i <= 5; i += 1) {
        const name = equipage[`horse${i}Name`] || equipage[`horseName${i}`];
        if (!name) continue;
        const id = equipage[`horse${i}Id`] || equipage[`horseId${i}`] || '';
        const keys = getTemperatureHorseKeys({ id, name }, i - 1);
        horses.push({
            id: id || name,
            name,
            _temperatureKey: keys[0],
            _temperatureKeys: keys,
            _temperatureName: String(name),
            _temperatureIndex: i - 1
        });
    }

    return horses;
}

/**
 * The record for a horse and slot. `horseKey` is a key or a list of keys
 * (getTemperatureHorseKeys): the first key that has the slot wins, so data
 * stored under an older key (e.g. the name) is still read. A single stable
 * key also finds the horse's older keys, so callers that pass
 * horse._temperatureKey (vet check) read the same data.
 */
export function getHorseTemperatureRecord(equipage = {}, horseKey, slotId) {
    const log = equipage.horseTemperatures || {};
    let keys = Array.isArray(horseKey) ? horseKey : [horseKey];
    if (!Array.isArray(horseKey)) {
        const horse = getTemperatureHorses(equipage).find(h => h._temperatureKey === String(horseKey));
        if (horse) keys = horse._temperatureKeys;
    }
    for (const key of keys) {
        const record = log?.[String(key)]?.[String(slotId)];
        if (record && typeof record === 'object') return record;
    }
    return null;
}

/**
 * The slots a save writes: only those the user changed compared with what was
 * shown (`rows`: { horseKeys, slotId, value, takenAt, defaultTakenAt,
 * horseName, slotLabel }), so values others saved meanwhile in other slots
 * stay as on the server. Returns { writes: [{ horseKey, slotId, record }],
 * errors }; record null removes the slot (the user cleared a shown value).
 */
export function buildHorseTemperatureChanges(shownEquipage = {}, rows = [], meta = {}) {
    const writes = [];
    const errors = [];

    rows.forEach(row => {
        const keys = (row.horseKeys || []).map(String).filter(Boolean);
        const stableKey = keys[0];
        const slotId = String(row.slotId || '');
        if (!stableKey || !slotId) return;

        const shown = getHorseTemperatureRecord(shownEquipage, keys, slotId);
        const shownTemperature = normalizeHorseTemperatureValue(shown?.temperatureC);
        const valueRaw = String(row.value ?? '').trim();
        const takenAt = row.takenAt || row.defaultTakenAt || '';

        if (!valueRaw) {
            // Nothing was shown either: nothing to change
            if (shownTemperature !== null) writes.push({ horseKey: stableKey, slotId, record: null });
            return;
        }

        const temperature = normalizeHorseTemperatureValue(valueRaw);
        if (temperature === null || temperature < 35 || temperature > 42.5) {
            errors.push(`${row.horseName || 'Häst'} ${row.slotLabel || ''}: ange en temperatur mellan 35,0 och 42,5.`);
            return;
        }

        const shownTakenAt = shown?.takenAt || row.defaultTakenAt || '';
        if (shownTemperature === temperature && shownTakenAt === takenAt) return;

        writes.push({
            horseKey: stableKey,
            slotId,
            record: {
                temperatureC: temperature,
                takenAt,
                slotId,
                slotLabel: row.slotLabel || slotId,
                horseKey: stableKey,
                horseName: row.horseName || '',
                updatedAt: meta.now || new Date().toISOString(),
                // The account id only: the equipage is public and the email is private
                updatedBy: meta.uid || ''
            }
        });
    });

    return { writes, errors };
}

/**
 * Temperatures of the equipage's horses still stored under an older key (the
 * name, from before the horse had an id): copies to the stable key and the
 * old keys to remove, so each horse has one key and stranded keys do not
 * count toward the rules' limit on keys. Slots in `skip` ("stableKey|slotId",
 * the ones being saved now) are not copied. A key that is some horse's
 * stable key is never removed.
 */
export function buildHorseTemperatureKeyMigration(equipage = {}, skip = new Set()) {
    const log = equipage.horseTemperatures || {};
    const horses = getTemperatureHorses(equipage);
    const stableKeys = new Set(horses.map(horse => String(horse._temperatureKey)));
    const copies = [];
    const removeKeys = new Set();

    horses.forEach(horse => {
        const [stableKey, ...olderKeys] = (horse._temperatureKeys || [horse._temperatureKey]).map(String);
        olderKeys.forEach(oldKey => {
            if (stableKeys.has(oldKey) || removeKeys.has(oldKey)) return;
            const slots = log[oldKey];
            if (!slots || typeof slots !== 'object') return;
            Object.entries(slots).forEach(([slotId, record]) => {
                if (!record || typeof record !== 'object') return;
                if (skip.has(`${stableKey}|${slotId}`)) return;
                if (log?.[stableKey]?.[slotId]) return; // the stable key wins
                copies.push({ horseKey: stableKey, slotId, record: { ...record, horseKey: stableKey } });
            });
            removeKeys.add(oldKey);
        });
    });

    return { copies, removeKeys: [...removeKeys] };
}

function recordTimestamp(record = {}) {
    const value = record.takenAt || record.updatedAt || record.createdAt;
    const ms = value ? new Date(value).getTime() : 0;
    return Number.isFinite(ms) ? ms : 0;
}

export function summarizeHorseTemperatures(equipage = {}, competitionDates, rawConfig = {}) {
    const config = normalizeHorseTemperatureConfig(rawConfig);
    const slots = buildHorseTemperatureSlots(competitionDates, config);
    const horses = getTemperatureHorses(equipage);
    const warningLimit = config.warningTemperatureC;

    const horseSummaries = horses.map(horse => {
        const horseKey = horse._temperatureKey;
        const records = slots
            .map(slot => ({ slot, record: getHorseTemperatureRecord(equipage, horse._temperatureKeys, slot.id) }))
            .filter(item => normalizeHorseTemperatureValue(item.record?.temperatureC) !== null);
        const highRecords = warningLimit !== null
            ? records.filter(item => normalizeHorseTemperatureValue(item.record?.temperatureC) >= warningLimit)
            : [];
        const latest = records
            .map(item => item.record)
            .sort((a, b) => recordTimestamp(b) - recordTimestamp(a))[0] || null;

        return {
            horseKey,
            horseName: horse._temperatureName,
            completed: records.length,
            total: slots.length,
            missing: Math.max(0, slots.length - records.length),
            complete: slots.length > 0 && records.length >= slots.length,
            highCount: highRecords.length,
            latest
        };
    });

    const total = horses.length * slots.length;
    const completed = horseSummaries.reduce((sum, item) => sum + item.completed, 0);
    const highCount = horseSummaries.reduce((sum, item) => sum + item.highCount, 0);

    return {
        enabled: config.enabled,
        slots,
        horses,
        horseSummaries,
        total,
        completed,
        missing: Math.max(0, total - completed),
        complete: total > 0 && completed >= total,
        highCount
    };
}
