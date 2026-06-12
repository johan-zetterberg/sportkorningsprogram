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

export { OFFICIAL_JOIN_ROLES };
