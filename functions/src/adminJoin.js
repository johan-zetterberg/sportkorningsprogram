// 'vet' is a limited role: the vet inspection page and the vet's private data
const OFFICIAL_JOIN_ROLES = ['admin', 'dressage', 'marathon', 'precision', 'speaker', 'vet'];

const SECRET_FIELD_BY_ROLE = {
  admin: 'accessCode',
  dressage: 'accessCode_dressage',
  marathon: 'accessCode_marathon',
  precision: 'accessCode_precision',
  speaker: 'accessCode_speaker',
  vet: 'accessCode_vet'
};

export function normalizeJoinEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export function normalizeJoinRoles(roles = [], fallbackRole = '') {
  const items = Array.isArray(roles) ? [...roles] : [];
  if (fallbackRole && OFFICIAL_JOIN_ROLES.includes(fallbackRole)) items.push(fallbackRole);
  return [...new Set(items.filter((role) => OFFICIAL_JOIN_ROLES.includes(role)))];
}

export function resolveJoinRoleForPin(pinCode, secrets = {}) {
  const normalizedPin = typeof pinCode === 'string' ? pinCode.trim() : '';
  if (!normalizedPin) return null;

  return OFFICIAL_JOIN_ROLES.find((role) => {
    const field = SECRET_FIELD_BY_ROLE[role];
    const expectedPin = typeof secrets?.[field] === 'string' ? secrets[field].trim() : '';
    return expectedPin && expectedPin === normalizedPin;
  }) || null;
}

export function buildCompetitionAdminJoinPayload(existingData = {}, role, email, joinedAt = Date.now()) {
  const normalizedEmail = normalizeJoinEmail(email);
  const roles = normalizeJoinRoles(existingData.roles, existingData.role);
  const mergedRoles = normalizeJoinRoles([...roles, role], role);

  return {
    email: normalizedEmail,
    joinedAt,
    role,
    roles: mergedRoles
  };
}

// Wrong PINs allowed before joining is refused for a while. New PINs have 8
// digits (older ones 6); the per-competition caps stop spreading guesses over
// many accounts: a low one for unverified emails, a high one for verified
// emails (which can be created in bulk too, but real officials never come near it)
export const PIN_ATTEMPT_LIMITS = {
  perUser: { max: 5, windowMs: 15 * 60 * 1000 },
  perCompetition: { max: 100, windowMs: 60 * 60 * 1000 },
  perCompetitionVerified: { max: 500, windowMs: 60 * 60 * 1000 }
};

// Failed attempts still inside the window, as stored: { failures: [ms, ...] }
function recentFailures(state, windowMs, now) {
  const list = Array.isArray(state?.failures) ? state.failures : [];
  return list.filter((t) => Number.isFinite(t) && now - t < windowMs);
}

/**
 * Whether a join attempt is allowed now, given the stored failure state for
 * the user (in this competition) and for the competition. When refused,
 * retryAfterMs says when the oldest counted failure leaves the window.
 */
//
// The competition-wide limit stops guessing with many throwaway accounts, but
// anyone could also use it to lock real officials out on competition day. So
// accounts with a confirmed email get a much higher cap (unverified accounts
// alone cannot reach it, being refused at the low cap).
export function checkPinAttempts(userState, competitionState, now = Date.now(), limits = PIN_ATTEMPT_LIMITS, { emailVerified = false } = {}) {
  const checks = emailVerified
    ? [[userState, limits.perUser], [competitionState, limits.perCompetitionVerified || limits.perCompetition]]
    : [[userState, limits.perUser], [competitionState, limits.perCompetition]];
  for (const [state, { max, windowMs }] of checks) {
    const recent = recentFailures(state, windowMs, now);
    if (recent.length >= max) {
      return { allowed: false, retryAfterMs: Math.max(0, Math.min(...recent) + windowMs - now) };
    }
  }
  return { allowed: true, retryAfterMs: 0 };
}

// State to store after a failed attempt (old entries outside the window dropped)
export function recordPinFailure(state, windowMs, now = Date.now()) {
  return { failures: [...recentFailures(state, windowMs, now), now] };
}

// A competition id from a client is one document id: a value with "/" would
// address nested documents (e.g. "X/equipages/12")
export function isValidCompetitionId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export { OFFICIAL_JOIN_ROLES };
