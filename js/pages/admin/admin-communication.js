import {
    getCompetitionMessages,
    getCompetitionDocuments,
    saveCompetitionMessage,
    updateCompetitionMessage,
    deleteCompetitionMessage,
    saveCompetitionDocument,
    deleteCompetitionDocument,
    getMessageAudience,
    getMessageTargetStartNumbers,
    getDocumentAudience
} from '../../services/documentService.js';
import { getEquipages } from '../../services/equipageService.js';
import { getConfig, saveConfig } from '../../services/competitionService.js';
import { getJudges, getOfficials } from '../../services/adminService.js';
import { showAlert, showConfirm } from '../../ui/components.js';
import { t } from '../../utils/i18n.js';
import { buildMessageAudience, messageAudienceMode } from '../../utils/messageAudience.js';
import { buildContactGroups, mailtoBccHref } from '../../utils/contactLists.js';
import { fillTemplate } from '../../utils/officialTaskUtils.js';
import { escapeHtml } from '../../utils/sharedUtils.js';
import {
    renderCommunicationTabMarkup,
    renderMessageAudienceBadge,
    renderDocumentAudienceBadge,
    renderRecipientChecklist,
    renderUploadStatus,
    renderMessagesList,
    renderDocumentsList
} from './admin-communication-view.js';
import { mountEmergencyInfoAdmin } from './adminEmergencyInfo.js';
import { setupMailCard, setupMessageMailOptions } from './adminMailCard.js';
import { queueCompetitionMail } from '../../services/mailService.js';
import { buildMessageMailPayload, messageCategoryForType, newNoticeRequestId } from '../../utils/mailUtils.js';

function formatTimestamp(timestamp) {
    if (!timestamp?.seconds) return '';
    return new Date(timestamp.seconds * 1000).toLocaleString('sv-SE');
}

/** Copies text to the clipboard; the older select-and-copy where the API is missing */
async function copyToClipboard(text) {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (_) { /* fall back below */ }
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    area.remove();
    return ok;
}

function getMessageBadge(message) {
    return renderMessageAudienceBadge(message, getMessageAudience, getMessageTargetStartNumbers);
}

function getDocumentBadge(document) {
    return renderDocumentAudienceBadge(document, getDocumentAudience);
}

// Storage folder of an uploaded file (storage.rules): drivers only -> drivers/
function documentFolderForMode(audienceMode) {
    return audienceMode === 'drivers_only' ? 'drivers' : 'public';
}

export function renderCommunicationTab(container, competition) {
    container.innerHTML = renderCommunicationTabMarkup();

    const typeSelect = document.getElementById('docType');
    const categorySelect = document.getElementById('docCategory');
    const urlGroup = document.getElementById('docInputUrl');
    const htmlGroup = document.getElementById('docInputHtml');
    const customCategoryWrap = document.getElementById('docCustomCategoryWrap');
    const customCategoryInput = document.getElementById('docCustomCategory');
    const messageAudienceSelect = document.getElementById('msgAudienceMode');
    const selectedDriversBox = document.getElementById('selectedDriversBox');
    const uploadButton = document.getElementById('btnUploadDoc');
    const uploadInput = document.getElementById('docUploadInput');
    const urlInput = document.getElementById('docUrl');
    const uploadStatusEl = document.getElementById('docUploadStatus');
    const docForm = document.getElementById('commDocForm');
    const messageForm = document.getElementById('commMetaForm');
    const publicInfoForm = document.getElementById('publicInfoForm');

    let availableEquipages = [];
    let pendingUploadedFile = null;
    let uploadState = { status: 'idle' };

    function setUploadState(nextState) {
        uploadState = nextState;
        if (!uploadStatusEl) return;
        uploadStatusEl.innerHTML = renderUploadStatus(uploadState);
        document.getElementById('replaceUploadedFileBtn')?.addEventListener('click', () => {
            pendingUploadedFile = null;
            urlInput.value = '';
            urlInput.readOnly = false;
            setUploadState({ status: 'idle' });
            uploadInput.click();
        });
    }

    function resetDocumentFormUi() {
        pendingUploadedFile = null;
        docForm.reset();
        typeSelect.value = 'url';
        categorySelect.value = 'Startlista';
        document.getElementById('docAudienceMode').value = 'public_and_drivers';
        customCategoryInput.value = '';
        urlGroup.classList.remove('hidden');
        htmlGroup.classList.add('hidden');
        urlInput.required = true;
        document.getElementById('docHtmlContent').required = false;
        urlInput.readOnly = false;
        syncCategoryUi();
        setUploadState({ status: 'idle' });
    }

    function syncCategoryUi() {
        const isCustom = categorySelect.value === '__custom__';
        customCategoryWrap.classList.toggle('hidden', !isCustom);
        customCategoryInput.required = isCustom;
    }

    function syncAudienceUi() {
        const mode = messageAudienceSelect.value;
        selectedDriversBox.classList.toggle('hidden', mode !== 'selected_drivers');
        const hint = document.getElementById('msgAudienceHint');
        if (hint) {
            const hintKey = mode === 'public' ? 'msg_aud_hint_public'
                : (mode === 'officials' || mode.startsWith('official:')) ? 'msg_aud_hint_officials'
                    : 'msg_aud_hint_drivers';
            hint.textContent = t(hintKey);
        }
        mailOptions?.refresh();
    }

    let loadedMessages = [];
    let mailOptions = null;

    function currentMailAudience() {
        return {
            mode: messageAudienceSelect.value,
            selectedDrivers: Array.from(document.querySelectorAll('.msg-driver-checkbox:checked')).map(box => box.value)
        };
    }

    // "Skicka som notis": on for a new message; for an edit "Skicka
    // uppdatering som notis", off unless ticked
    function setPushEditing(editing) {
        const box = document.getElementById('msgSendPush');
        const label = document.getElementById('msgSendPushLabel');
        if (box) box.checked = !editing;
        if (label) label.textContent = t(editing ? 'msg_update_send_push' : 'msg_send_push');
    }

    function setEditMode(message) {
        const editing = !!message;
        mailOptions?.setEditing(editing);
        setPushEditing(editing);
        document.getElementById('msgEditId').value = editing ? message.id : '';
        document.getElementById('msgEditNotice')?.classList.toggle('hidden', !editing);
        const submit = document.getElementById('msgSubmitBtn');
        if (submit) submit.textContent = t(editing ? 'msg_save_changes_btn' : 'msg_publish_btn');
        if (!editing) return;
        document.getElementById('msgTitle').value = message.title || '';
        document.getElementById('msgBody').value = message.body || message.message || '';
        document.getElementById('msgTitleEn').value = message.titleEn || '';
        document.getElementById('msgBodyEn').value = message.bodyEn || '';
        if (message.titleEn || message.bodyEn) document.getElementById('msgEnglishDetails').open = true;
        document.getElementById('msgType').value = message.type === 'alert' ? 'alert' : 'info';
        mailOptions?.setEssential(message.type === 'alert');
        messageAudienceSelect.value = messageAudienceMode(message);
        const targets = new Set(getMessageTargetStartNumbers(message));
        document.querySelectorAll('.msg-driver-checkbox').forEach((checkbox) => {
            checkbox.checked = targets.has(checkbox.value);
        });
        syncAudienceUi();
        messageForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
        document.getElementById('msgTitle').focus({ preventScroll: true });
    }

    function resetMessageForm() {
        messageForm.reset();
        setEditMode(null);
        mailOptions?.reset();
        document.getElementById('msgEnglishDetails').open = false;
        document.querySelectorAll('.msg-driver-checkbox').forEach((checkbox) => {
            checkbox.checked = false;
        });
        syncAudienceUi();
    }

    // --- Contact lists (private contact data: admins only) ---
    let contactGroups = null;
    let contactGroupsLoading = null;

    function selectedContactGroup() {
        const id = document.getElementById('contactListGroup')?.value;
        return (contactGroups || []).find(group => group.id === id) || null;
    }

    function contactGroupLabel(group) {
        return fillTemplate(t(group.labelKey), group.labelParams);
    }

    function syncContactListUi() {
        const group = selectedContactGroup();
        const summary = document.getElementById('contactListSummary');
        const phonesBtn = document.getElementById('copyContactPhonesBtn');
        const emailsBtn = document.getElementById('copyContactEmailsBtn');
        const mailto = document.getElementById('contactMailtoLink');
        if (!group) return;
        if (summary) {
            summary.textContent = fillTemplate(t(group.kind === 'officials' ? 'contact_lists_summary_officials' : 'contact_lists_summary_drivers'), {
                count: group.count,
                emails: group.emails.length,
                phones: group.phones.length,
                missing: group.missingEmail
            });
        }
        if (emailsBtn) emailsBtn.disabled = group.emails.length === 0;
        // Phone numbers are copied for officials (the drivers are reached by e-mail and the portal)
        if (phonesBtn) {
            phonesBtn.disabled = group.kind !== 'officials' || group.phones.length === 0;
            phonesBtn.classList.toggle('hidden', group.kind !== 'officials');
        }
        if (mailto) {
            const href = mailtoBccHref(group.emails);
            mailto.setAttribute('href', href || '#');
            mailto.setAttribute('aria-disabled', href ? 'false' : 'true');
        }
    }

    async function loadContactGroups(compId) {
        if (contactGroups) return contactGroups;
        if (!contactGroupsLoading) {
            contactGroupsLoading = Promise.all([
                getEquipages(compId, { includePrivate: true }).catch(() => []),
                getOfficials(compId).catch(() => []),
                getJudges(compId).catch(() => [])
            ]).then(([equipages, officials, judges]) => {
                contactGroups = buildContactGroups({ equipages, officials, judges });
                const select = document.getElementById('contactListGroup');
                if (select) {
                    select.innerHTML = contactGroups.map(group => `<option value="${escapeHtml(group.id)}">${escapeHtml(contactGroupLabel(group))} (${group.count})</option>`).join('');
                }
                syncContactListUi();
                return contactGroups;
            }).catch((err) => {
                console.warn('Kontaktlistorna kunde inte läsas:', err);
                contactGroupsLoading = null;
                return [];
            });
        }
        return contactGroupsLoading;
    }

    async function loadPublicInfo(compId) {
        try {
            const publicInfo = await getConfig(compId, 'publicInfo');
            document.getElementById('publicInfoEnabled').checked = publicInfo.enabled !== false;
            document.getElementById('publicInfoIntro').value = publicInfo.introHtml || '';
            document.getElementById('publicInfoVenueAddress').value = publicInfo.spectatorInfo?.venueAddress || '';
            document.getElementById('publicInfoParkingAddress').value = publicInfo.spectatorInfo?.parkingAddress || '';
            document.getElementById('publicInfoParking').value = publicInfo.spectatorInfo?.parking || '';
            document.getElementById('publicInfoEntrance').value = publicInfo.spectatorInfo?.entrance || '';
            document.getElementById('publicInfoKiosk').value = publicInfo.spectatorInfo?.kiosk || '';
            document.getElementById('publicInfoToilets').value = publicInfo.spectatorInfo?.toilets || '';
            document.getElementById('publishClassSummary').checked = publicInfo.publish?.classSummary !== false;
            document.getElementById('publishDocuments').checked = publicInfo.publish?.documents !== false;
            document.getElementById('publishMessages').checked = publicInfo.publish?.messages !== false;
            document.getElementById('publishMaps').checked = publicInfo.publish?.maps !== false;
        } catch (err) {
            console.warn('Kunde inte läsa publicInfo', err);
        }
    }

    async function loadEquipages(compId) {
        try {
            const equipages = await getEquipages(compId);
            availableEquipages = Array.isArray(equipages) ? equipages.slice() : [];
            const checklist = document.getElementById('recipientChecklist');
            if (!checklist) return;
            checklist.innerHTML = renderRecipientChecklist(availableEquipages);
        } catch (err) {
            console.error('Kunde inte ladda kuskar:', err);
        }
    }

    async function refreshMessages(compId) {
        const list = document.getElementById('messagesList');
        const items = await getCompetitionMessages(compId);
        loadedMessages = items;
        const withFormatting = items.map((item) => ({
            ...item,
            _formattedTimestamp: formatTimestamp(item.timestamp),
            _formattedEdited: formatTimestamp(item.editedAt)
        }));

        list.innerHTML = renderMessagesList(withFormatting, getMessageBadge);
        list.querySelectorAll('[data-delete-message-id]').forEach((button) => {
            button.addEventListener('click', () => handleDeleteMessage(compId, button.dataset.deleteMessageId));
        });
        list.querySelectorAll('[data-edit-message-id]').forEach((button) => {
            button.addEventListener('click', () => {
                const message = loadedMessages.find(item => item.id === button.dataset.editMessageId);
                if (message) setEditMode(message);
            });
        });
    }

    async function refreshDocuments(compId) {
        const list = document.getElementById('documentsList');
        // Driver-only files are saved by path: a URL for this view
        const { resolveDocumentUrls } = await import('../../services/storageService.js');
        const items = await resolveDocumentUrls(await getCompetitionDocuments(compId));

        list.innerHTML = renderDocumentsList(items, getDocumentBadge);
        list.querySelectorAll('[data-delete-document-id]').forEach((button) => {
            const item = items.find(entry => entry.id === button.dataset.deleteDocumentId);
            button.addEventListener('click', () => handleDeleteDocument(compId, button.dataset.deleteDocumentId, item?.storagePath));
        });
    }

    async function handleDeleteMessage(compId, id) {
        if (!await showConfirm(t('msg_delete_confirm'), { danger: true, confirmLabel: t('msg_delete_btn') })) return;
        try {
            await deleteCompetitionMessage(compId, id);
            if (document.getElementById('msgEditId')?.value === id) resetMessageForm();
            await refreshMessages(compId);
        } catch (err) {
            console.error(err);
            showAlert('Kunde inte ta bort meddelandet.', false);
        }
    }

    async function handleDeleteDocument(compId, id, storagePath) {
        if (!confirm('Ta bort dokument?')) return;
        try {
            await deleteCompetitionDocument(compId, id);
            // The uploaded file too (documents saved with a storage path)
            if (storagePath) {
                const { deleteStoredDocument } = await import('../../services/storageService.js');
                await deleteStoredDocument(storagePath).catch(err => console.warn('Could not remove the file:', err));
            }
            await refreshDocuments(compId);
        } catch (err) {
            console.error(err);
            showAlert('Kunde inte ta bort dokumentet.', false);
        }
    }

    typeSelect.addEventListener('change', (event) => {
        if (event.target.value === 'url') {
            urlGroup.classList.remove('hidden');
            htmlGroup.classList.add('hidden');
            document.getElementById('docUrl').required = true;
            document.getElementById('docHtmlContent').required = false;
        } else {
            urlGroup.classList.add('hidden');
            htmlGroup.classList.remove('hidden');
            document.getElementById('docUrl').required = false;
            document.getElementById('docHtmlContent').required = true;
        }
    });

    categorySelect.addEventListener('change', syncCategoryUi);
    messageAudienceSelect.addEventListener('change', syncAudienceUi);
    // "Viktigt / varning" is essential for push and e-mail alike
    document.getElementById('msgType')?.addEventListener('change', (event) => {
        mailOptions?.setEssential(event.target.value === 'alert');
    });
    document.getElementById('msgCancelEditBtn')?.addEventListener('click', resetMessageForm);

    document.getElementById('contactListGroup')?.addEventListener('change', syncContactListUi);
    document.getElementById('copyContactEmailsBtn')?.addEventListener('click', async () => {
        await loadContactGroups(competition.id);
        const group = selectedContactGroup();
        if (!group?.emails.length) { showAlert(t('contact_lists_none'), 'info'); return; }
        // Separated by commas: a mail program's BCC field takes the list as it is
        const ok = await copyToClipboard(group.emails.join(', '));
        if (ok) showAlert(fillTemplate(t('contact_lists_copied_emails'), { count: group.emails.length, group: contactGroupLabel(group) }));
        else showAlert(t('contact_lists_copy_failed'), false);
    });
    document.getElementById('copyContactPhonesBtn')?.addEventListener('click', async () => {
        await loadContactGroups(competition.id);
        const group = selectedContactGroup();
        if (!group?.phones.length) { showAlert(t('contact_lists_none'), 'info'); return; }
        const ok = await copyToClipboard(group.phones.join('\n'));
        if (ok) showAlert(fillTemplate(t('contact_lists_copied_phones'), { count: group.phones.length, group: contactGroupLabel(group) }));
        else showAlert(t('contact_lists_copy_failed'), false);
    });
    document.getElementById('contactMailtoLink')?.addEventListener('click', (event) => {
        if (event.currentTarget.getAttribute('aria-disabled') === 'true') {
            event.preventDefault();
            showAlert(t('contact_lists_none'), 'info');
        }
    });
    document.getElementById('clearSelectedDriversBtn')?.addEventListener('click', () => {
        document.querySelectorAll('.msg-driver-checkbox').forEach((checkbox) => {
            checkbox.checked = false;
        });
        mailOptions?.refresh();
    });
    // Chosen drivers change the e-mail recipient preview
    selectedDriversBox.addEventListener('change', () => mailOptions?.refresh());

    uploadButton.addEventListener('click', () => uploadInput.click());

    uploadInput.addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        if (file.size > 10 * 1024 * 1024) {
            showAlert('Filen är för stor. Max 10 MB.', false);
            uploadInput.value = '';
            return;
        }

        setUploadState({
            status: 'uploading',
            fileName: file.name
        });

        const originalButtonText = uploadButton.textContent;
        uploadButton.textContent = 'Laddar upp...';
        uploadButton.disabled = true;
        urlInput.readOnly = true;

        try {
            // The folder follows the chosen audience; submit moves the file
            // if the audience is changed afterwards
            const { uploadCompetitionDocumentFile, getStoredDocumentUrl } = await import('../../services/storageService.js');
            const folder = documentFolderForMode(document.getElementById('docAudienceMode').value);
            const uploaded = await uploadCompetitionDocumentFile(competition.id, file, folder);

            // Shown to the admin only; for drivers/ the URL is not saved
            urlInput.value = uploaded.url || await getStoredDocumentUrl(uploaded.storagePath) || '';
            pendingUploadedFile = {
                name: file.name,
                size: file.size,
                type: file.type || null,
                file,
                folder: uploaded.folder,
                storagePath: uploaded.storagePath,
                url: uploaded.url
            };

            const titleInput = document.getElementById('docTitle');
            if (!titleInput.value) {
                titleInput.value = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
            }

            setUploadState({
                status: 'ready',
                fileName: file.name,
                fileSize: file.size,
                fileType: file.type || null
            });
            showAlert('Fil uppladdad.');
        } catch (err) {
            console.error(err);
            pendingUploadedFile = null;
            setUploadState({
                status: 'error',
                message: `Uppladdningen misslyckades: ${err.message}`
            });
            showAlert(`Uppladdning misslyckades: ${err.message}`, false);
        } finally {
            uploadButton.textContent = originalButtonText;
            uploadButton.disabled = false;
            if (!pendingUploadedFile) {
                urlInput.readOnly = false;
            }
            uploadInput.value = '';
        }
    });

    publicInfoForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = event.submitter;
        button.disabled = true;

        try {
            await saveConfig(competition.id, 'publicInfo', {
                enabled: document.getElementById('publicInfoEnabled').checked,
                introHtml: document.getElementById('publicInfoIntro').value.trim(),
                spectatorInfo: {
                    venueAddress: document.getElementById('publicInfoVenueAddress').value.trim(),
                    parkingAddress: document.getElementById('publicInfoParkingAddress').value.trim(),
                    parking: document.getElementById('publicInfoParking').value.trim(),
                    entrance: document.getElementById('publicInfoEntrance').value.trim(),
                    kiosk: document.getElementById('publicInfoKiosk').value.trim(),
                    toilets: document.getElementById('publicInfoToilets').value.trim()
                },
                publish: {
                    classSummary: document.getElementById('publishClassSummary').checked,
                    documents: document.getElementById('publishDocuments').checked,
                    messages: document.getElementById('publishMessages').checked,
                    maps: document.getElementById('publishMaps').checked
                }
            });
            showAlert('Publik info sparad.');
        } catch (err) {
            console.error(err);
            showAlert(`Kunde inte spara publik info: ${err.message}`, false);
        } finally {
            button.disabled = false;
        }
    });

    messageForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = event.submitter;
        button.disabled = true;

        try {
            const audienceMode = messageAudienceSelect.value;
            const selectedDrivers = Array.from(document.querySelectorAll('.msg-driver-checkbox:checked')).map((checkbox) => checkbox.value);

            if (audienceMode === 'selected_drivers' && selectedDrivers.length === 0) {
                showAlert('Välj minst en kusk för riktat meddelande.', false);
                button.disabled = false;
                return;
            }
            // An essential e-mail needs its reason (logged) before anything is published
            if (mailOptions?.essential() && !mailOptions.reason?.()) {
                showAlert(t('mail_msg_reason_required'), false);
                button.disabled = false;
                return;
            }

            const type = document.getElementById('msgType').value;
            const sendPush = document.getElementById('msgSendPush')?.checked === true;
            const payload = {
                title: document.getElementById('msgTitle').value.trim(),
                body: document.getElementById('msgBody').value.trim(),
                titleEn: document.getElementById('msgTitleEn').value.trim(),
                bodyEn: document.getElementById('msgBodyEn').value.trim(),
                type,
                // "Viktigt / varning" is an essential push (reaches devices
                // that switched messages off), as the e-mail
                category: messageCategoryForType(type),
                ...buildMessageAudience(audienceMode, { selectedDrivers })
            };
            const editId = document.getElementById('msgEditId').value;
            let queuedOffline = false;

            if (editId) {
                // An update notice only when asked: a new id per send (the
                // trigger notifies once per id)
                if (sendPush) payload.updateNotice = newNoticeRequestId();
                await updateCompetitionMessage(competition.id, editId, payload);
                showAlert(t('msg_updated'));
            } else {
                // Offline: saved on the device, sent (and pushed) with the signal
                const saveState = await saveCompetitionMessage(competition.id, { ...payload, push: sendPush });
                if (saveState === 'queued') showAlert(t('msg_saved_queued'), 'offline');
                else showAlert('Meddelande publicerat.');
                queuedOffline = saveState === 'queued';
            }
            // The e-mail needs the server: offline, sent again later by hand
            if (queuedOffline && mailOptions?.requested()) {
                showAlert(t('notify_needs_connection_resend'), 'offline');
            } else if (mailOptions?.requested()) {
                const mailPayload = buildMessageMailPayload({
                    competitionId: competition.id,
                    title: payload.title,
                    body: payload.body,
                    titleEn: payload.titleEn,
                    bodyEn: payload.bodyEn,
                    mode: audienceMode,
                    selectedDrivers,
                    essential: mailOptions.essential(),
                    reason: mailOptions.reason?.() || '',
                    update: !!editId
                });
                try {
                    if (!mailPayload) throw new Error(t('mail_msg_no_audience'));
                    if (mailPayload.category === 'essential' && !mailPayload.reason) throw new Error(t('mail_msg_reason_required'));
                    await queueCompetitionMail(mailPayload);
                    showAlert(t('mail_msg_queued'), 'success');
                } catch (mailErr) {
                    console.error(mailErr);
                    showAlert(`${t('mail_msg_failed')} ${mailErr?.message || ''}`.trim(), false);
                }
            }
            resetMessageForm();
            await refreshMessages(competition.id);
        } catch (err) {
            console.error(err);
            showAlert(`Kunde inte spara meddelande: ${err.message}`, false);
        } finally {
            button.disabled = false;
        }
    });

    docForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = event.submitter;
        button.disabled = true;

        try {
            const type = typeSelect.value;
            const audienceMode = document.getElementById('docAudienceMode').value;
            const audienceByMode = {
                public_and_drivers: { public: true, drivers: true },
                public_only: { public: true, drivers: false },
                drivers_only: { public: false, drivers: true }
            };

            const category = categorySelect.value === '__custom__'
                ? (customCategoryInput.value.trim() || 'Övrigt')
                : categorySelect.value;

            // An uploaded file lies in the folder of its audience
            // (storage.rules): moved when the audience changed after upload.
            // Driver-only files are saved by path only, without a URL
            let uploadedFile = type === 'url' ? pendingUploadedFile : null;
            const folder = documentFolderForMode(audienceMode);
            if (uploadedFile && uploadedFile.folder !== folder) {
                const { uploadCompetitionDocumentFile, deleteStoredDocument } = await import('../../services/storageService.js');
                const moved = await uploadCompetitionDocumentFile(competition.id, uploadedFile.file, folder);
                await deleteStoredDocument(uploadedFile.storagePath).catch(err => console.warn('Could not remove the old file:', err));
                uploadedFile = { ...uploadedFile, ...moved };
                pendingUploadedFile = uploadedFile;
            }
            const linkUrl = uploadedFile
                ? (uploadedFile.folder === 'public' ? uploadedFile.url : null)
                : (type === 'url' ? document.getElementById('docUrl').value.trim() : null);

            const payload = {
                title: document.getElementById('docTitle').value.trim(),
                category,
                type,
                url: linkUrl,
                storagePath: uploadedFile?.storagePath || null,
                content: type === 'html' ? document.getElementById('docHtmlContent').value.trim() : null,
                audience: audienceByMode[audienceMode],
                isUpload: type === 'url' && !!pendingUploadedFile,
                originalFileName: pendingUploadedFile?.name || null,
                mimeType: pendingUploadedFile?.type || null,
                fileSize: pendingUploadedFile?.size || null
            };

            await saveCompetitionDocument(competition.id, payload);
            showAlert('Dokument sparat.');
            resetDocumentFormUi();
            await refreshDocuments(competition.id);
        } catch (err) {
            console.error(err);
            showAlert(`Kunde inte spara dokument: ${err.message}`, false);
        } finally {
            button.disabled = false;
        }
    });

    syncCategoryUi();
    mailOptions = setupMessageMailOptions(competition.id, currentMailAudience);
    syncAudienceUi();
    setupMailCard(competition);
    setUploadState({ status: 'idle' });
    loadPublicInfo(competition.id);
    // Emergency info (alarm number, first aid, persons on duty) after the public info form
    mountEmergencyInfoAdmin(publicInfoForm, competition);
    refreshMessages(competition.id);
    refreshDocuments(competition.id);
    loadEquipages(competition.id);
    loadContactGroups(competition.id);
}

