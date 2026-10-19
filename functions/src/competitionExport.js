// A complete copy of one competition as JSON (exportCompetition): every
// document under the competition's public tree, its private tree and the
// finalization tree, as { path, data }, without access PINs and (unless asked
// for) personal identity numbers (redactExportDocuments). Firestore types are written so a
// restore can recreate them: { __type: 'timestamp', ms }, { __type:
// 'geopoint', lat, lng }, { __type: 'ref', path }, and numbers JSON cannot
// hold (a stored Infinity penalty) as { __type: 'number', value: 'Infinity' }.
// scripts/restore-competition.mjs writes such a file back (fromExportValue,
// rewriteCompetitionId).

export const EXPORT_FORMAT = 'drivelive-competition-export';
export const EXPORT_FORMAT_VERSION = 1;

export function toExportValue(value) {
    if (value === null || value === undefined) return value ?? null;
    if (typeof value === 'number' && !Number.isFinite(value)) return { __type: 'number', value: String(value) };
    if (Array.isArray(value)) return value.map(toExportValue);
    if (typeof value !== 'object') return value;
    if (typeof value.toMillis === 'function' && typeof value.seconds === 'number') {
        return { __type: 'timestamp', ms: value.toMillis() };
    }
    if (typeof value.latitude === 'number' && typeof value.longitude === 'number' && Object.keys(value).length <= 2) {
        return { __type: 'geopoint', lat: value.latitude, lng: value.longitude };
    }
    if (typeof value.path === 'string' && typeof value.collection === 'function' && value.firestore) {
        return { __type: 'ref', path: value.path };
    }
    if (typeof value.toBase64 === 'function') {
        return { __type: 'bytes', base64: value.toBase64() };
    }
    // The Admin SDK reads bytes as a Buffer (a Uint8Array)
    if (value instanceof Uint8Array && typeof Buffer !== 'undefined') {
        return { __type: 'bytes', base64: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64') };
    }
    const out = {};
    Object.entries(value).forEach(([key, v]) => { out[key] = toExportValue(v); });
    return out;
}

/**
 * The opposite of toExportValue, for a restore. The Firestore types come from
 * factories (the Admin SDK in scripts/restore-competition.mjs), so this module
 * needs no dependencies: { timestamp(ms), geopoint(lat, lng), ref(path),
 * bytes(base64) }. Infinity/NaN need no factory.
 */
export function fromExportValue(value, factories = {}) {
    if (value === null || value === undefined) return null;
    if (Array.isArray(value)) return value.map(item => fromExportValue(item, factories));
    if (typeof value !== 'object') return value;
    const type = typeof value.__type === 'string' ? value.__type : '';
    const make = (name, ...args) => {
        if (typeof factories[name] !== 'function') throw new Error(`Kan inte återskapa typen ${name}`);
        return factories[name](...args);
    };
    if (type === 'number' && ['Infinity', '-Infinity', 'NaN'].includes(value.value)) return Number(value.value);
    if (type === 'timestamp' && Number.isFinite(value.ms)) return make('timestamp', value.ms);
    if (type === 'geopoint' && Number.isFinite(value.lat) && Number.isFinite(value.lng)) return make('geopoint', value.lat, value.lng);
    if (type === 'ref' && typeof value.path === 'string') return make('ref', value.path);
    if (type === 'bytes' && typeof value.base64 === 'string') return make('bytes', value.base64);
    if (type) throw new Error(`Okänt eller trasigt värde i säkerhetskopian: ${JSON.stringify(value).slice(0, 120)}`);
    const out = {};
    Object.entries(value).forEach(([key, v]) => { out[key] = fromExportValue(v, factories); });
    return out;
}

// The three trees an export covers (the same list as exportCompetition)
export function competitionRootPaths(appId, competitionId) {
    return [
        `artifacts/${appId}/public/data/competitions/${competitionId}`,
        `artifacts/${appId}/private/data/competitions/${competitionId}`,
        `competitions/${competitionId}`
    ];
}

// Fields that hold the competition's own id
const COMPETITION_ID_FIELDS = /^(competitionId|compId)$/i;

// Only a path segment right after "competitions" is the competition id, so
// e.g. an equipage or judge with the same id is left alone
function rewritePath(path, oldId, newId) {
    if (!path.includes('/')) return path;
    const parts = path.split('/');
    let changed = false;
    for (let i = 1; i < parts.length; i++) {
        if (parts[i] === oldId && parts[i - 1] === 'competitions') {
            parts[i] = newId;
            changed = true;
        }
    }
    return changed ? parts.join('/') : path;
}

function rewriteValue(value, key, oldId, newId, count) {
    if (Array.isArray(value)) return value.map(item => rewriteValue(item, null, oldId, newId, count));
    if (typeof value === 'string') {
        const next = (key !== null && COMPETITION_ID_FIELDS.test(key) && value === oldId) ? newId : rewritePath(value, oldId, newId);
        if (next !== value) count.fields++;
        return next;
    }
    if (!value || typeof value !== 'object') return value;
    if (value.__type === 'ref' && typeof value.path === 'string') {
        const path = rewritePath(value.path, oldId, newId);
        if (path !== value.path) count.fields++;
        return { ...value, path };
    }
    if (typeof value.__type === 'string') return value;
    const out = {};
    Object.entries(value).forEach(([k, v]) => { out[k] = rewriteValue(v, k, oldId, newId, count); });
    return out;
}

/**
 * Moves exported { path, data } documents to another competition id (a copy
 * next to the original): document paths, fields like competitionId, document
 * references and path strings ("competitions/{id}/..."). The competition
 * documents' own "id" field follows too. Returns { documents, fieldsChanged }.
 */
export function rewriteCompetitionId(documents = [], oldId, newId) {
    if (!oldId || !newId) throw new Error('Både gammalt och nytt Competition ID krävs');
    const count = { fields: 0 };
    const rootSuffix = `competitions/${oldId}`;
    const out = documents.map(({ path, data }) => {
        let next = rewriteValue(data, null, oldId, newId, count);
        if ((path === rootSuffix || path.endsWith(`/${rootSuffix}`)) && next && next.id === oldId) {
            next = { ...next, id: newId };
            count.fields++;
        }
        return { path: rewritePath(path, oldId, newId), data: next };
    });
    return { documents: out, fieldsChanged: count.fields };
}

/**
 * What a restore of this export cannot bring back, as Swedish lines for the
 * admin: PINs, personal identity numbers left out, Storage files (only their
 * names are in the export) and login accounts.
 */
export function restoreWarnings(exportData = {}) {
    const redacted = Array.isArray(exportData.redacted) ? exportData.redacted : [];
    const secrets = redacted.filter(r => r.reason === 'secret');
    const personal = redacted.filter(r => r.reason === 'personalNumber');
    const storageFiles = Array.isArray(exportData.storageFiles) ? exportData.storageFiles : [];
    const warnings = [];
    if (secrets.length) {
        warnings.push(`PIN-koder och hemligheter fanns inte i säkerhetskopian (${secrets.length} st, t.ex. config/secrets och accessCode_*). Sätt nya PIN-koder för tävlingen innan den används.`);
    }
    if (personal.length) {
        warnings.push(`Personnummer togs inte med i säkerhetskopian (${personal.length} fält). De måste föras in igen om de behövs.`);
    }
    if (storageFiles.length) {
        const shown = storageFiles.slice(0, 10).join(', ');
        warnings.push(`${storageFiles.length} filer i Storage återställs inte (bara namnen finns i kopian): ${shown}${storageFiles.length > 10 ? ', ...' : ''}`);
    }
    warnings.push('Inloggningskonton (Firebase Auth) och användardokument (users/{uid}) ingår inte; konton som saknas måste skapas och bjudas in igen.');
    return warnings;
}

function hasGlobalAdminRole(identity = {}) {
    const roles = Array.isArray(identity?.roles) ? identity.roles : [];
    return identity?.superadmin === true
        || identity?.role === 'admin' || identity?.role === 'superadmin'
        || roles.includes('admin') || roles.includes('superadmin');
}

/**
 * Whether this caller may export personal identity numbers: only the
 * competition's owner (createdBy/ownerId) or a global admin (token claims or
 * users/{uid}). Other competition admins export without them.
 */
export function canExportPersonalNumbers({ uid = '', token = {}, competitionData = {}, userData = {} } = {}) {
    if (!uid) return false;
    if (competitionData?.createdBy === uid || competitionData?.ownerId === uid) return true;
    return hasGlobalAdminRole(token) || hasGlobalAdminRole(userData);
}

/** The private auditLog entry for one export (who, when, with personal numbers) */
export function buildExportAuditEntry({ uid, email = '', includePersonalNumbers = false, documentCount = 0, at = Date.now() }) {
    return {
        source: 'exportCompetition',
        action: 'export',
        exportedBy: uid,
        exportedByEmail: String(email || '').trim().toLowerCase() || null,
        includePersonalNumbers: includePersonalNumbers === true,
        documentCount,
        exportedAt: at
    };
}

// Access PINs and other secrets are never exported: whole documents by path,
// fields by name wherever they are (also nested and in archive copies)
const SECRET_DOCUMENT_PATTERNS = [/\/config\/secrets$/];
const SECRET_FIELD_PATTERNS = [
    /^accessCode(_|$)/i,
    /^(pin|pinCode|pinHash|password|passwordHash|secret|secrets|token|apiKey|privateKey)$/i
];
// Swedish personal identity numbers: only when the admin chooses to include them
const PERSONAL_NUMBER_FIELDS = new Set(['ssn', 'driverssn', 'personnummer', 'personalnumber', 'personnumber']);

function isSecretField(key) {
    return SECRET_FIELD_PATTERNS.some(pattern => pattern.test(key));
}

function isPersonalNumberField(key) {
    return PERSONAL_NUMBER_FIELDS.has(String(key).toLowerCase());
}

function redactValue(value, fieldPath, options, removed) {
    if (Array.isArray(value)) {
        return value.map((item, index) => redactValue(item, `${fieldPath}[${index}]`, options, removed));
    }
    if (!value || typeof value !== 'object' || typeof value.__type === 'string') return value;
    const out = {};
    Object.entries(value).forEach(([key, v]) => {
        const path = fieldPath ? `${fieldPath}.${key}` : key;
        if (isSecretField(key)) {
            removed.push({ field: path, reason: 'secret' });
            return;
        }
        if (!options.includePersonalNumbers && isPersonalNumberField(key)) {
            removed.push({ field: path, reason: 'personalNumber' });
            return;
        }
        out[key] = redactValue(v, path, options, removed);
    });
    return out;
}

/**
 * Removes secrets (always) and personal identity numbers (unless
 * includePersonalNumbers) from exported { path, data } documents. Returns the
 * kept documents and what was removed: { path, reason } for a whole document,
 * { path, field, reason } for a field.
 */
export function redactExportDocuments(documents = [], { includePersonalNumbers = false } = {}) {
    const options = { includePersonalNumbers: includePersonalNumbers === true };
    const redacted = [];
    const kept = [];
    documents.forEach(({ path, data }) => {
        if (SECRET_DOCUMENT_PATTERNS.some(pattern => pattern.test(path))) {
            redacted.push({ path, reason: 'secret' });
            return;
        }
        const removed = [];
        const clean = redactValue(data, '', options, removed);
        removed.forEach(entry => redacted.push({ path, ...entry }));
        kept.push({ path, data: clean });
    });
    return { documents: kept, redacted };
}

/**
 * Every document at or under docRef, including documents below a parent that
 * has no data of its own (e.g. dressage/{sn}/protocols). Stops with an error
 * past maxDocuments, so a runaway export cannot exhaust the function.
 */
export async function collectDocuments(docRef, { maxDocuments = 50000, out = [] } = {}) {
    const snap = await docRef.get();
    if (snap.exists) out.push({ path: docRef.path, data: toExportValue(snap.data()) });
    if (out.length > maxDocuments) throw new Error(`Fler än ${maxDocuments} dokument`);
    const collections = await docRef.listCollections();
    for (const collection of collections) {
        const refs = await collection.listDocuments();
        for (const ref of refs) {
            await collectDocuments(ref, { maxDocuments, out });
        }
    }
    return out;
}
