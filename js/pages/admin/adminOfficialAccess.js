// Admin > Inställningar: role codes for officials (one shared code per role),
// their expiry, join links with QR codes, and who joined with a code (with
// revocation). Competition admins are not joined by code: they are invited by
// email (Funktionärer > Bjud in administratör).
import { deleteField } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import {
    getSecretConfig,
    saveSecretConfig,
    listenForCompetitionAdmins,
    migrateLegacyCompetitionRoleEmails,
    revokeOfficialAccess
} from '../../services/adminService.js';
import { showAlert } from '../../ui/components.js';
import { escapeHtml } from '../../utils/sharedUtils.js';
import {
    PIN_JOIN_ROLES,
    ROLE_CODE_LABELS,
    buildRoleJoinLink,
    defaultCodeExpiryDate,
    formatRoleCode,
    generateRoleCode,
    roleCodeField,
    rolesNeedingNewCode
} from '../../utils/officialAccessUtils.js';
import { qrSvg } from '../../../lib/qrcode-svg.js';

let adminsUnsub = null;

const BUTTON = 'text-xs px-2 py-1 rounded transition-colors';
const BUTTON_BLUE = `${BUTTON} bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-200 dark:hover:bg-blue-800/60`;
const BUTTON_RED = `${BUTTON} bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-200 dark:hover:bg-red-800/50`;

export function getOfficialAccessHtml() {
    return `
            <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                <!-- Role codes -->
                <div class="bg-blue-50 dark:bg-blue-900/20 p-5 rounded-lg border border-blue-100 dark:border-blue-800">
                    <h3 class="font-bold text-lg text-blue-900 dark:text-blue-300 mb-2">Funktionärskoder (delas per roll)</h3>
                    <p class="text-sm text-blue-800 dark:text-blue-200 mb-3">
                        Varje roll har en egen kod som delas med alla funktionärer i rollen (t.ex. maratonkoden till hinderdomarna).
                        Koden ger bara den rollen. Skicka helst länken eller QR-koden: då är tävlingen redan ifylld och funktionären skriver bara koden.
                    </p>
                    <p class="text-xs text-blue-800 dark:text-blue-300 mb-4">
                        Administratörer ansluts inte med kod. Bjud in dem med e-post under
                        <a href="#admin?tab=officials&amp;focus=view-officials" class="underline">Funktionärer &gt; Bjud in administratör</a>.
                    </p>
                    <div class="flex flex-wrap items-end gap-2 mb-4">
                        <label class="text-sm text-blue-900 dark:text-blue-200">
                            <span class="block text-xs font-semibold mb-1">Koderna gäller till och med</span>
                            <input type="date" id="roleCodesExpireAt" class="p-1.5 border rounded text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-white">
                        </label>
                        <button type="button" id="saveRoleCodesExpiry" class="${BUTTON_BLUE}">Spara datum</button>
                        <button type="button" id="regenerateAllRoleCodes" class="${BUTTON_RED} ml-auto">Byt alla koder</button>
                    </div>
                    <p id="roleCodesExpiryNote" class="text-xs text-blue-800 dark:text-blue-300 mb-3"></p>
                    <div id="roleCodeRows" class="space-y-3">
                        <p class="text-sm text-gray-500 italic">Laddar...</p>
                    </div>
                </div>

                <!-- Joined with a code -->
                <div>
                    <h3 class="font-bold text-lg text-gray-900 dark:text-gray-100 mb-2">Anslutna via kod</h3>
                    <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
                        De som anslutit med en kod, per roll. Ta bort en person, eller dra tillbaka åtkomsten för hela rollen (då byts rollens kod också).
                        <br>
                        <em>Tips: Föranmälda funktionärer syns i <a href="#admin?tab=officials&amp;focus=view-officials" class="text-blue-600 underline">Funktionärsregistret</a>.</em>
                    </p>
                    <div class="bg-gray-50 dark:bg-gray-900 border dark:border-gray-700 rounded-md max-h-96 overflow-y-auto">
                        <div id="pinAdminsList" class="divide-y divide-gray-200 dark:divide-gray-700">
                            <p class="p-4 text-center text-gray-500 italic">Laddar...</p>
                        </div>
                    </div>
                    <div id="roleEmailMigrationPanel" class="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-900/20">
                        <div class="font-semibold text-amber-900 dark:text-amber-200">Migrera gamla rollmejl</div>
                        <p class="mt-1 text-amber-800 dark:text-amber-300">
                            Flytta äldre listor med funktionärsmejl till privat lagring och rensa bort dem från publika tävlingsdokument.
                        </p>
                        <button id="migrateRoleEmailsBtn" type="button" class="mt-3 rounded bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700 dark:bg-amber-700 dark:hover:bg-amber-600">
                            Migrera rollmejl
                        </button>
                    </div>
                </div>
            </div>`;
}

function formatJoinedAt(ms) {
    return ms ? new Date(ms).toLocaleString('sv-SE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'okänt';
}

// The people per role from the admins/{uid} docs (a doc without roles: old admin)
export function groupJoinedByRole(admins = []) {
    const groups = {};
    admins.forEach((a) => {
        const roles = Array.isArray(a.roles) && a.roles.length ? a.roles : [a.role || 'admin'];
        roles.forEach((role) => {
            (groups[role] = groups[role] || []).push({
                uid: a.uid,
                name: a.name || '',
                email: a.email || '',
                joinedAt: a.joinedAtByRole?.[role] || a.joinedAt || null
            });
        });
    });
    Object.values(groups).forEach((list) => list.sort((x, y) => (y.joinedAt || 0) - (x.joinedAt || 0)));
    return groups;
}

export async function setupOfficialAccess(competitionId, comp) {
    const rowsEl = document.getElementById('roleCodeRows');
    const listEl = document.getElementById('pinAdminsList');
    if (!rowsEl || !listEl) return;

    let secrets = await getSecretConfig(competitionId) || {};
    const openLinks = new Set();

    const save = async (data) => {
        await saveSecretConfig(competitionId, { ...data, updatedAt: Date.now() });
        secrets = { ...secrets, ...data };
        Object.keys(data).forEach((key) => { if (key === 'accessCode') delete secrets.accessCode; });
    };

    // Old short PINs and missing codes replaced, the old admin PIN removed,
    // and a default last day (the day after the competition) set once
    const startup = {};
    rolesNeedingNewCode(secrets).forEach((role) => { startup[roleCodeField(role)] = generateRoleCode(); });
    if (typeof secrets.accessCode === 'string') startup.accessCode = deleteField();
    if (secrets.accessCodesExpireAt === undefined) {
        const fallback = defaultCodeExpiryDate(comp?.dates);
        if (fallback) startup.accessCodesExpireAt = fallback;
    }
    if (Object.keys(startup).length) {
        try {
            await save(startup);
        } catch (error) {
            console.warn('Kunde inte uppdatera funktionärskoderna:', error);
        }
    }

    const expiryInput = document.getElementById('roleCodesExpireAt');
    const expiryNote = document.getElementById('roleCodesExpiryNote');
    const renderExpiry = () => {
        if (expiryInput) expiryInput.value = secrets.accessCodesExpireAt || '';
        if (expiryNote) {
            expiryNote.textContent = secrets.accessCodesExpireAt
                ? `Efter ${secrets.accessCodesExpireAt} går det inte att ansluta med koderna (de som redan anslutit behåller sin roll).`
                : 'Inget slutdatum: koderna gäller tills de byts.';
        }
    };
    renderExpiry();
    document.getElementById('saveRoleCodesExpiry')?.addEventListener('click', async () => {
        const value = expiryInput?.value || null;
        try {
            await save({ accessCodesExpireAt: value });
            renderExpiry();
            showAlert(value ? `Koderna gäller till och med ${value}.` : 'Koderna gäller utan slutdatum.', true);
        } catch (error) {
            console.error('Kunde inte spara datumet:', error);
            showAlert('Kunde inte spara datumet.', false);
        }
    });

    const renderRows = () => {
        rowsEl.innerHTML = PIN_JOIN_ROLES.map((role) => {
            const code = formatRoleCode(secrets[roleCodeField(role)] || '');
            const link = buildRoleJoinLink(window.location.href, competitionId, role);
            const open = openLinks.has(role);
            let qr = '';
            if (open) {
                try {
                    qr = qrSvg(link, { size: 176, label: `QR-kod för ${ROLE_CODE_LABELS[role]}` });
                } catch (error) {
                    qr = '<p class="text-xs text-red-600">Kunde inte skapa QR-koden.</p>';
                }
            }
            return `
                <div class="rounded border border-blue-100 dark:border-blue-800 bg-white/60 dark:bg-gray-800/60 p-2">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <span class="font-medium dark:text-gray-200">${escapeHtml(ROLE_CODE_LABELS[role])}:</span>
                        <span id="pinCode_${role}" class="font-mono font-bold tracking-wider text-brand-darkblue dark:text-brand-lightblue bg-white dark:bg-gray-800 px-2 py-1 rounded shadow-sm border dark:border-gray-700">${escapeHtml(code || '–')}</span>
                    </div>
                    <div class="flex flex-wrap gap-1 mt-2">
                        <button type="button" class="${BUTTON_BLUE}" data-code-action="link" data-role="${role}">${open ? 'Dölj länk' : 'Länk & QR'}</button>
                        <button type="button" class="${BUTTON_BLUE}" data-code-action="new" data-role="${role}">Ny kod</button>
                        <button type="button" class="${BUTTON_RED}" data-code-action="revoke" data-role="${role}">Dra tillbaka åtkomst för ${escapeHtml(ROLE_CODE_LABELS[role].toLowerCase())}</button>
                    </div>
                    ${open ? `
                    <div class="mt-2 flex flex-col sm:flex-row gap-3 items-start">
                        <div class="shrink-0 bg-white p-1 rounded border">${qr}</div>
                        <div class="min-w-0 flex-1">
                            <input type="text" readonly value="${escapeHtml(link)}" class="w-full p-1 border rounded text-xs font-mono dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200" aria-label="Anslutningslänk för ${escapeHtml(ROLE_CODE_LABELS[role])}">
                            <button type="button" class="${BUTTON_BLUE} mt-1" data-code-action="copy" data-role="${role}">Kopiera länk</button>
                            <p class="text-xs text-gray-600 dark:text-gray-400 mt-1">Länken öppnar Min portal med tävlingen ifylld. Koden skickas separat (inte i länken).</p>
                        </div>
                    </div>` : ''}
                </div>`;
        }).join('');
    };
    renderRows();

    const newCodes = async (roles) => {
        const update = {};
        roles.forEach((role) => { update[roleCodeField(role)] = generateRoleCode(); });
        await save(update);
        renderRows();
    };

    rowsEl.addEventListener('click', async (event) => {
        const btn = event.target.closest('[data-code-action]');
        if (!btn) return;
        const role = btn.dataset.role;
        const label = ROLE_CODE_LABELS[role] || role;
        const action = btn.dataset.codeAction;
        if (action === 'link') {
            if (openLinks.has(role)) openLinks.delete(role); else openLinks.add(role);
            renderRows();
            return;
        }
        if (action === 'copy') {
            try {
                await navigator.clipboard.writeText(buildRoleJoinLink(window.location.href, competitionId, role));
                showAlert('Länken kopierad.', true);
            } catch {
                showAlert('Kunde inte kopiera länken. Markera och kopiera den själv.', false);
            }
            return;
        }
        if (action === 'new') {
            if (!confirm(`Byta koden för ${label}? De som redan anslutit behåller sin roll, men nya funktionärer behöver den nya koden.`)) return;
            btn.disabled = true;
            try {
                await newCodes([role]);
            } catch (error) {
                console.error('Kunde inte byta koden:', error);
                showAlert('Kunde inte byta koden.', false);
                btn.disabled = false;
            }
            return;
        }
        if (action === 'revoke') {
            if (!confirm(`Dra tillbaka åtkomsten för alla som anslutit som ${label}? Rollens kod byts också, så den gamla slutar fungera.`)) return;
            btn.disabled = true;
            try {
                const result = await revokeOfficialAccess(competitionId, role);
                if (result.code) secrets[roleCodeField(role)] = result.code;
                renderRows();
                showAlert(`Åtkomsten återkallad för ${result.removed} person(er). Ny kod: ${formatRoleCode(result.code || '')}`, true);
            } catch (error) {
                console.error('Kunde inte dra tillbaka åtkomsten:', error);
                showAlert(error?.message || 'Kunde inte dra tillbaka åtkomsten.', false);
                btn.disabled = false;
            }
        }
    });

    document.getElementById('regenerateAllRoleCodes')?.addEventListener('click', async (event) => {
        if (!confirm('Byta koderna för alla roller? De som redan anslutit behåller sina roller; nya funktionärer behöver de nya koderna.')) return;
        const btn = event.currentTarget;
        btn.disabled = true;
        try {
            await newCodes(PIN_JOIN_ROLES);
            showAlert('Alla koder bytta.', true);
        } catch (error) {
            console.error('Kunde inte byta koderna:', error);
            showAlert('Kunde inte byta koderna.', false);
        } finally {
            btn.disabled = false;
        }
    });

    document.getElementById('migrateRoleEmailsBtn')?.addEventListener('click', async (event) => {
        if (!window.confirm('Detta flyttar äldre rollmejl till privat lagring och rensar bort dem från publika tävlingsdata. Fortsätta?')) return;
        const button = event.currentTarget;
        const originalText = button.textContent;
        button.disabled = true;
        button.textContent = 'Migrerar...';
        try {
            const result = await migrateLegacyCompetitionRoleEmails(competitionId);
            showAlert(`Rollmejl migrerade. ${result.migratedEmails} e-postposter uppdaterades.`, true);
        } catch (error) {
            console.error('Kunde inte migrera rollmejl:', error);
            showAlert('Kunde inte migrera rollmejl.', false);
        } finally {
            button.disabled = false;
            button.textContent = originalText;
        }
    });

    const renderJoined = (admins) => {
        const groups = groupJoinedByRole(admins);
        const roles = ['admin', ...PIN_JOIN_ROLES].filter((role) => groups[role]?.length);
        if (!roles.length) {
            listEl.innerHTML = '<p class="p-4 text-center text-gray-500 italic text-sm">Ingen har anslutit med en kod ännu.</p>';
            return;
        }
        listEl.innerHTML = roles.map((role) => `
            <section class="p-3">
                <div class="flex items-center justify-between gap-2 mb-2">
                    <h4 class="text-sm font-bold text-gray-800 dark:text-gray-100">${escapeHtml(ROLE_CODE_LABELS[role] || role)} (${groups[role].length})</h4>
                    ${role === 'admin' ? `<button type="button" class="${BUTTON_RED}" data-joined-revoke-role="admin">Dra tillbaka åtkomst för alla</button>` : ''}
                </div>
                <ul class="space-y-1">
                    ${groups[role].map((p) => `
                    <li class="flex items-center justify-between gap-2 text-sm">
                        <div class="min-w-0">
                            <p class="font-semibold text-gray-900 dark:text-gray-100 truncate">${escapeHtml(p.name || p.email || 'Okänd användare')}</p>
                            <p class="text-xs text-gray-500 dark:text-gray-400 truncate">${p.name ? `${escapeHtml(p.email)} · ` : ''}Anslöt ${escapeHtml(formatJoinedAt(p.joinedAt))}</p>
                        </div>
                        <button type="button" class="${BUTTON_RED} shrink-0" data-joined-revoke-uid="${escapeHtml(p.uid)}" data-role="${escapeHtml(role)}" title="Ta bort personens åtkomst för rollen">Ta bort</button>
                    </li>`).join('')}
                </ul>
            </section>`).join('');
    };

    listEl.addEventListener('click', async (event) => {
        const personBtn = event.target.closest('[data-joined-revoke-uid]');
        const roleBtn = event.target.closest('[data-joined-revoke-role]');
        const btn = personBtn || roleBtn;
        if (!btn) return;
        const role = btn.dataset.role || btn.dataset.joinedRevokeRole;
        const uid = personBtn ? btn.dataset.joinedRevokeUid : undefined;
        const question = uid
            ? `Ta bort personens åtkomst som ${ROLE_CODE_LABELS[role] || role}?`
            : 'Ta bort alla som anslöt med den gamla admin-PIN-koden? De bjuds i stället in med e-post.';
        if (!confirm(question)) return;
        btn.disabled = true;
        try {
            await revokeOfficialAccess(competitionId, role, uid);
        } catch (error) {
            console.error('Kunde inte ta bort åtkomsten:', error);
            showAlert(error?.message || 'Kunde inte ta bort åtkomsten.', false);
            btn.disabled = false;
        }
    });

    if (adminsUnsub) {
        try { adminsUnsub(); } catch { }
    }
    adminsUnsub = listenForCompetitionAdmins(competitionId, renderJoined);
}

export function unloadOfficialAccess() {
    if (adminsUnsub) {
        try { adminsUnsub(); } catch { }
        adminsUnsub = null;
    }
}
