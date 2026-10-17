// Contact persons the drivers of a competition may see (getDriverContacts).
// Only officials the admin marked as a contact for drivers, and only the
// contact details chosen for each; nothing else of their private data.

const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);

/** Whether an official's public doc marks them as a contact for drivers */
export function isDriverContact(official = {}) {
    return official?.driverContact?.show === true;
}

/**
 * officials: [{ id, data }] (public docs), privateById: Map id -> private doc
 * data. Returns [{ id, name, role, phone?, email? }] sorted by role, then name.
 */
export function buildDriverContacts(officials = [], privateById = new Map()) {
    return officials
        .filter(({ data }) => isDriverContact(data))
        .map(({ id, data }) => {
            const priv = privateById.get(id) || {};
            const choice = data.driverContact || {};
            const contact = { id, name: text(data.name), role: text(data.role) };
            const phone = text(priv.mobile || priv.phone || data.phone, 40);
            const email = text(priv.email || data.email, 120).toLowerCase();
            if (choice.phone === true && phone) contact.phone = phone;
            if (choice.email === true && email) contact.email = email;
            return contact;
        })
        .filter(contact => contact.name)
        .sort((a, b) => (a.role || '~').localeCompare(b.role || '~', 'sv') || a.name.localeCompare(b.name, 'sv'));
}
