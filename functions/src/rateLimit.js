// Fixed-window counters for public endpoints (volunteer sign-up). A counter
// document holds { windowStart, count }; a call is allowed while the count of
// the current window is below the limit.

export const VOLUNTEER_SIGNUP_LIMITS = {
    windowMs: 60 * 60 * 1000,
    perAddress: 15,       // per hour from one network address (a club Wi-Fi or a mobile operator shares one)
    perCompetition: 20,   // sign-ups per hour to one competition
    dayWindowMs: 24 * 60 * 60 * 1000,
    perCompetitionDay: 200 // sign-ups per day to one competition
};

/**
 * Next state of a counter after one more call at `now`, and whether that call
 * is allowed. A counter from an earlier window starts over.
 */
export function nextCounter(current, now, limit, windowMs) {
    const windowStart = Number(current?.windowStart) || 0;
    const sameWindow = now - windowStart < windowMs;
    const count = sameWindow ? (Number(current?.count) || 0) : 0;
    if (count >= limit) {
        return { allowed: false, next: { windowStart, count } };
    }
    return { allowed: true, next: { windowStart: sameWindow ? windowStart : now, count: count + 1 } };
}
