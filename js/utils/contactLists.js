// Contact lists for the admin's communication page: e-mail addresses (for a
// BCC send-out) and phone numbers per group - all drivers, drivers per class,
// all officials and officials per role. Pure: the page reads the private
// contact documents (admins only) and copies the result.

import { OFFICIAL_ROLE_KEYS } from './messageAudience.js';

const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase();
const looksLikeEmail = (value) => /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(value);
const normalizePhone = (value) => String(value ?? '').trim();

/** The official audience keys an official or judge belongs to */
export function officialRoleKeysOf(person = {}) {
    const keys = new Set();
    const systemRoles = Array.isArray(person.roles) ? person.roles : [];
    systemRoles.forEach((role) => {
        // Judge records: [{ discipline, position }]
        const value = typeof role === 'object' && role ? role.discipline : role;
        const r = String(value || '').toLowerCase();
        if (r === 'admin') keys.add('secretariat');
        else if (OFFICIAL_ROLE_KEYS.includes(r)) keys.add(r);
    });
    if (person.position && !systemRoles.length) keys.add('dressage');
    const label = String(person.role || person.roleLabel || '').toLowerCase();
    if (label.includes('veterin')) keys.add('vet');
    if (label.includes('speaker')) keys.add('speaker');
    if (label.includes('sekretariat') || label.includes('secretar')) keys.add('secretariat');
    if (label.includes('dressyr') || label.includes('dressage')) keys.add('dressage');
    if (label.includes('hinder') || label.includes('maraton') || label.includes('marathon') || label.includes('observat')) keys.add('marathon');
    if (label.includes('precision') || label.includes('koner') || label.includes('cones')) keys.add('precision');
    return [...keys];
}

function collect(people, { emailOf, phoneOf }) {
    const emails = [];
    const phones = [];
    let missingEmail = 0;
    let missingPhone = 0;
    const seenEmails = new Set();
    const seenPhones = new Set();
    people.forEach((person) => {
        const email = normalizeEmail(emailOf(person));
        if (email && looksLikeEmail(email)) {
            if (!seenEmails.has(email)) { seenEmails.add(email); emails.push(email); }
        } else {
            missingEmail += 1;
        }
        const phone = normalizePhone(phoneOf(person));
        if (phone) {
            const key = phone.replace(/[^\d+]/g, '');
            if (!seenPhones.has(key)) { seenPhones.add(key); phones.push(phone); }
        } else {
            missingPhone += 1;
        }
    });
    return { emails, phones, count: people.length, missingEmail, missingPhone };
}

const driverEmail = (e) => e?.email || e?.contactEmail || '';
const driverPhone = (e) => e?.phone || e?.mobile || e?.contactPhone || '';
const officialEmail = (o) => o?.email || '';
const officialPhone = (o) => o?.mobile || o?.phone || o?.telephone || '';

/**
 * The groups: { id, kind: 'drivers'|'officials', labelKey, labelParams,
 * emails, phones, count, missingEmail, missingPhone }. Officials and judges
 * with the same e-mail count once.
 */
export function buildContactGroups({ equipages = [], officials = [], judges = [] } = {}) {
    const groups = [];
    const drivers = (Array.isArray(equipages) ? equipages : []).filter(Boolean);
    groups.push({ id: 'drivers:all', kind: 'drivers', labelKey: 'contact_group_all_drivers', labelParams: {}, ...collect(drivers, { emailOf: driverEmail, phoneOf: driverPhone }) });
    const classes = [...new Set(drivers.map(e => String(e._mergedLabel || e.className || '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'sv', { numeric: true, sensitivity: 'base' }));
    classes.forEach((className) => {
        const inClass = drivers.filter(e => String(e._mergedLabel || e.className || '').trim() === className);
        groups.push({ id: `drivers:class:${className}`, kind: 'drivers', labelKey: 'contact_group_class_drivers', labelParams: { class: className }, ...collect(inClass, { emailOf: driverEmail, phoneOf: driverPhone }) });
    });

    // One person per e-mail (an official may also be a judge)
    const people = [];
    const byEmail = new Map();
    [...(Array.isArray(officials) ? officials : []), ...(Array.isArray(judges) ? judges : [])].filter(Boolean).forEach((person) => {
        const email = normalizeEmail(officialEmail(person));
        const roles = officialRoleKeysOf(person);
        if (email && byEmail.has(email)) {
            const existing = byEmail.get(email);
            roles.forEach(r => { if (!existing._roleKeys.includes(r)) existing._roleKeys.push(r); });
            if (!officialPhone(existing) && officialPhone(person)) existing.phone = officialPhone(person);
            return;
        }
        const entry = { ...person, _roleKeys: roles };
        if (email) byEmail.set(email, entry);
        people.push(entry);
    });
    groups.push({ id: 'officials:all', kind: 'officials', labelKey: 'contact_group_all_officials', labelParams: {}, ...collect(people, { emailOf: officialEmail, phoneOf: officialPhone }) });
    OFFICIAL_ROLE_KEYS.forEach((role) => {
        const inRole = people.filter(p => p._roleKeys.includes(role));
        if (!inRole.length) return;
        groups.push({ id: `officials:${role}`, kind: 'officials', labelKey: `msg_aud_official_${role}`, labelParams: {}, ...collect(inRole, { emailOf: officialEmail, phoneOf: officialPhone }) });
    });
    return groups;
}

/** A mailto: link with every address as BCC (empty when there is none) */
export function mailtoBccHref(emails = []) {
    const list = (Array.isArray(emails) ? emails : []).filter(Boolean);
    if (!list.length) return '';
    return `mailto:?bcc=${list.map(encodeURIComponent).join(',')}`;
}
