const OFFICIAL_JOIN_ROLES = ['admin', 'dressage', 'marathon', 'precision', 'speaker'];

const SECRET_FIELD_BY_ROLE = {
  admin: 'accessCode',
  dressage: 'accessCode_dressage',
  marathon: 'accessCode_marathon',
  precision: 'accessCode_precision',
  speaker: 'accessCode_speaker'
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

// Wrong PINs allowed before joining is refused for a while. PINs are 6 digits;
// the per-competition cap stops spreading guesses over many accounts.
export const PIN_ATTEMPT_LIMITS = {
  perUser: { max: 5, windowMs: 15 * 60 * 1000 },
  perCompetition: { max: 100, windowMs: 60 * 60 * 1000 }
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
export function checkPinAttempts(userState, competitionState, now = Date.now(), limits = PIN_ATTEMPT_LIMITS) {
  for (const [state, { max, windowMs }] of [[userState, limits.perUser], [competitionState, limits.perCompetition]]) {
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
