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

export function getTemperatureHorseStableKey(horse = {}, index = 0) {
    return String(
        horse.id ||
        horse.uid ||
        horse.chipNumber ||
        horse.chip ||
        horse.lic ||
        horse.license ||
        horse.name ||
        horse.horseName ||
        `horse-${index + 1}`
    );
}

export function getTemperatureHorseName(horse = {}, index = 0) {
    return String(horse.name || horse.horseName || horse.namn || `Häst ${index + 1}`);
}

export function getTemperatureHorses(equipage = {}) {
    if (Array.isArray(equipage.horses) && equipage.horses.length > 0) {
        return equipage.horses.map((horse, index) => ({
            ...horse,
            _temperatureKey: getTemperatureHorseStableKey(horse, index),
            _temperatureName: getTemperatureHorseName(horse, index),
            _temperatureIndex: index
        }));
    }

    const horses = [];
    for (let i = 1; i <= 5; i += 1) {
        const name = equipage[`horse${i}Name`] || equipage[`horseName${i}`];
        if (!name) continue;
        const id = equipage[`horse${i}Id`] || equipage[`horseId${i}`] || name;
        horses.push({
            id,
            name,
            _temperatureKey: String(id || name || `horse-${i}`),
            _temperatureName: String(name),
            _temperatureIndex: i - 1
        });
    }

    return horses;
}

export function getHorseTemperatureRecord(equipage = {}, horseKey, slotId) {
    const log = equipage.horseTemperatures || {};
    const record = log?.[String(horseKey)]?.[String(slotId)];
    return record && typeof record === 'object' ? record : null;
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
            .map(slot => ({ slot, record: getHorseTemperatureRecord(equipage, horseKey, slot.id) }))
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
