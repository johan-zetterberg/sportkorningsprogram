// "Today's discipline": the part of the competition people follow now. The
// bottom bar's Live / Results / Secretariat tabs and the discipline row on
// those pages open it first. An admin can set it (competition.currentPhase);
// otherwise it comes from the start times, which hold date and time per
// discipline (config/startTimes.times[startNumber][discipline]).

export const DISCIPLINES = Object.freeze(['dressage', 'marathon', 'precision']);
export const PHASES = Object.freeze([...DISCIPLINES, 'total']);

const localDay = (date) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

// "2026-05-16T09:00" (local time, as the start lists store it)
const parseLocal = (value) => {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(String(value || ''));
    return m ? { day: m[1], minutes: Number(m[2]) * 60 + Number(m[3]) } : null;
};

/** Per discipline: its days, and its first start per day in minutes */
export function disciplineSchedule(times = {}) {
    const schedule = {};
    Object.values(times || {}).forEach((row) => {
        DISCIPLINES.forEach((discipline) => {
            const at = parseLocal(row?.[discipline]);
            if (!at) return;
            const days = (schedule[discipline] ||= {});
            days[at.day] = Math.min(days[at.day] ?? Infinity, at.minutes);
        });
    });
    return schedule;
}

/**
 * The phase to show: 'dressage' | 'marathon' | 'precision' | 'total'.
 * - override (an admin's choice) wins;
 * - a day with starts: the discipline that has begun last (two on one day:
 *   the second once its first start has come), else the day's first;
 * - before the first day: the first discipline; after the last day: total;
 * - between days: the discipline of the last day that has passed;
 * - no start times: dressage.
 */
export function currentDiscipline({ times = {}, override = null, now = new Date() } = {}) {
    if (PHASES.includes(override)) return override;
    const schedule = disciplineSchedule(times);
    const entries = [];
    Object.entries(schedule).forEach(([discipline, days]) => {
        Object.entries(days).forEach(([day, minutes]) => entries.push({ discipline, day, minutes }));
    });
    if (!entries.length) return 'dressage';
    const order = (a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.minutes - b.minutes);
    entries.sort(order);
    const today = localDay(now);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const todays = entries.filter(e => e.day === today);
    if (todays.length) {
        const begun = todays.filter(e => e.minutes <= nowMinutes);
        return (begun.length ? begun[begun.length - 1] : todays[0]).discipline;
    }
    if (today < entries[0].day) return entries[0].discipline;
    const last = entries[entries.length - 1];
    if (today > last.day) return 'total';
    const past = entries.filter(e => e.day < today);
    return past[past.length - 1].discipline;
}
