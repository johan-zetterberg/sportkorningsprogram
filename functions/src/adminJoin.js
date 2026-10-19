// Roles an admins/{uid} doc can hold. 'admin' only from the old admin PIN
// (removed: competition admins are invited by email, roleEmails); kept here so
// such entries can still be listed and revoked.
// 'vet' is a limited role: the vet inspection page and the vet's private data
const OFFICIAL_JOIN_ROLES = ['admin', 'dressage', 'marathon', 'precision', 'speaker', 'vet'];
// Roles that can be joined with a role code
const PIN_JOIN_ROLES = ['dressage', 'marathon', 'precision', 'speaker', 'vet'];

const SECRET_FIELD_BY_ROLE = {
  admin: 'accessCode',
  dressage: 'accessCode_dressage',
  marathon: 'accessCode_marathon',
  precision: 'accessCode_precision',
  speaker: 'accessCode_speaker',
  vet: 'accessCode_vet'
};

// Role codes: no 0/O/1/I look-alikes, shown in uppercase (so no l either;
// lowercase is accepted and uppercased). 32 symbols, 10 characters = 50 bits.
export const ROLE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROLE_CODE_LENGTH = 10;
// Stored codes shorter than this (the old 6-8 digit PINs) are not accepted
export const ROLE_CODE_MIN_LENGTH = 10;

/** A code as typed: case-insensitive, dashes and spaces ignored */
export function normalizeRoleCode(value) {
  return typeof value === 'string' ? value.replace(/[\s-]+/g, '').toUpperCase() : '';
}

/** Shown grouped by four: ABCD-EFGH-JK */
export function formatRoleCode(value) {
  const code = normalizeRoleCode(value);
  return code.match(/.{1,4}/g)?.join('-') || '';
}

export function isStrongRoleCode(value) {
  const code = normalizeRoleCode(value);
  return code.length >= ROLE_CODE_MIN_LENGTH && code.length <= 12
    && [...code].every((ch) => ROLE_CODE_ALPHABET.includes(ch));
}

/**
 * A new role code. `randomBytes(n)` returns n random bytes (crypto); 256 is
 * a multiple of the alphabet's 32 symbols, so byte % 32 is unbiased.
 */
export function generateRoleCode(randomBytes, length = ROLE_CODE_LENGTH) {
  const bytes = randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) code += ROLE_CODE_ALPHABET[bytes[i] % ROLE_CODE_ALPHABET.length];
  return code;
}

export function secretFieldForRole(role) {
  return SECRET_FIELD_BY_ROLE[role] || null;
}

export function normalizeJoinEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export function normalizeJoinRoles(roles = [], fallbackRole = '') {
  const items = Array.isArray(roles) ? [...roles] : [];
  if (fallbackRole && OFFICIAL_JOIN_ROLES.includes(fallbackRole)) items.push(fallbackRole);
  return [...new Set(items.filter((role) => OFFICIAL_JOIN_ROLES.includes(role)))];
}

/**
 * The role whose code was typed, or null. A match with the old admin PIN
 * returns 'admin' so the caller can refuse it with an explanation; old short
 * role PINs no longer match (the settings page replaces them).
 */
export function resolveJoinRoleForPin(pinCode, secrets = {}) {
  const typed = normalizeRoleCode(pinCode);
  if (!typed) return null;

  const role = PIN_JOIN_ROLES.find((candidate) => {
    const stored = secrets?.[SECRET_FIELD_BY_ROLE[candidate]];
    return isStrongRoleCode(stored) && normalizeRoleCode(stored) === typed;
  });
  if (role) return role;
  const adminPin = typeof secrets?.accessCode === 'string' ? normalizeRoleCode(secrets.accessCode) : '';
  return adminPin && adminPin === typed ? 'admin' : null;
}

// Midnight in Stockholm after the given day (YYYY-MM-DD), in ms
export function endOfDayStockholmMs(dateStr) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!match) return null;
  const utcMidnight = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1);
  if (!Number.isFinite(utcMidnight)) return null;
  // The Stockholm offset at that moment (+1 h or +2 h)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Stockholm', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).formatToParts(new Date(utcMidnight));
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  const asLocal = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'));
  return utcMidnight - (asLocal - utcMidnight);
}

/**
 * Whether the role codes have expired (secrets.accessCodesExpireAt, a day
 * YYYY-MM-DD: the codes work through that day, Swedish time). No date: never.
 */
export function roleCodesExpired(secrets = {}, now = Date.now()) {
  const end = endOfDayStockholmMs(secrets?.accessCodesExpireAt);
  return end !== null && now >= end;
}

export function buildCompetitionAdminJoinPayload(existingData = {}, role, email, joinedAt = Date.now(), name = '') {
  const normalizedEmail = normalizeJoinEmail(email);
  const roles = normalizeJoinRoles(existingData.roles, existingData.role);
  const mergedRoles = normalizeJoinRoles([...roles, role], role);
  const previousByRole = existingData.joinedAtByRole && typeof existingData.joinedAtByRole === 'object'
    ? existingData.joinedAtByRole : {};

  const payload = {
    email: normalizedEmail,
    joinedAt,
    // When each role was joined (the list in the settings shows it)
    joinedAtByRole: { ...previousByRole, [role]: joinedAt },
    role,
    roles: mergedRoles
  };
  const cleanName = typeof name === 'string' ? name.trim().slice(0, 120) : '';
  if (cleanName) payload.name = cleanName;
  return payload;
}

/**
 * The change to an admins/{uid} doc when `role` is taken away: { delete: true }
 * when no role is left, else { update } with the remaining roles, or null
 * when the doc does not hold the role.
 */
export function planRoleRemoval(existingData = {}, role) {
  const roles = normalizeJoinRoles(existingData.roles, existingData.role);
  // A doc without role fields counted as admin (rules: role defaults to 'admin')
  const effective = roles.length ? roles : ['admin'];
  if (!effective.includes(role)) return null;
  const remaining = effective.filter((r) => r !== role);
  if (!remaining.length) return { delete: true };
  const byRole = { ...(existingData.joinedAtByRole || {}) };
  delete byRole[role];
  return { update: { roles: remaining, role: remaining[remaining.length - 1], joinedAtByRole: byRole } };
}

// Wrong codes allowed before joining is refused for a while.
//
// With 10-character codes from 32 symbols (2^50 combinations) guessing is
// infeasible even at the caps below: at 1000 wrong codes an hour for a whole
// year (~8.8 million) the chance to hit one code is about 1 in 10^8. The caps
// are there against floods, not to make guessing slow:
// - perUser: typos by one person (long codes are mistyped more often)
// - perRole: all accounts together, counted per role the join link names
//   (one flooded role does not lock out the others); unverified accounts get
//   the low cap, accounts with a verified email the high one
// - officials invited by email (verified address in roleEmails or the
//   officials register) are not held by the shared caps at all, so nobody can
//   lock them out on competition day; only their own perUser limit applies.
export const PIN_ATTEMPT_LIMITS = {
  perUser: { max: 10, windowMs: 15 * 60 * 1000 },
  perCompetition: { max: 200, windowMs: 60 * 60 * 1000 },
  perCompetitionVerified: { max: 1000, windowMs: 60 * 60 * 1000 }
};

// The shared counter's document id: per competition and role named by the
// join link ('any' when the official typed the code without a link)
export function pinAttemptBucketId(competitionId, roleHint) {
  const role = PIN_JOIN_ROLES.includes(roleHint) ? roleHint : 'any';
  return `${competitionId}__role__${role}`;
}

// Failed attempts still inside the window, as stored: { failures: [ms, ...] }
function recentFailures(state, windowMs, now) {
  const list = Array.isArray(state?.failures) ? state.failures : [];
  return list.filter((t) => Number.isFinite(t) && now - t < windowMs);
}

/**
 * Whether a join attempt is allowed now, given the stored failure state for
 * the user (in this competition) and for the competition's role bucket. When
 * refused, retryAfterMs says when the oldest counted failure leaves the window.
 * `invited`: a verified email the competition invited (not held by the
 * shared cap, see PIN_ATTEMPT_LIMITS).
 */
export function checkPinAttempts(userState, competitionState, now = Date.now(), limits = PIN_ATTEMPT_LIMITS, { emailVerified = false, invited = false } = {}) {
  const checks = [[userState, limits.perUser]];
  if (!invited) {
    checks.push([competitionState, emailVerified ? (limits.perCompetitionVerified || limits.perCompetition) : limits.perCompetition]);
  }
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

export { OFFICIAL_JOIN_ROLES, PIN_JOIN_ROLES };
