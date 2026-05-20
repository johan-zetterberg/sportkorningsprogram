import {
    getCompetitionMessages,
    getCompetitionDocuments,
    saveCompetitionMessage,
    deleteCompetitionMessage,
    saveCompetitionDocument,
    deleteCompetitionDocument,
    getMessageAudience,
    getMessageTargetStartNumbers,
    getDocumentAudience
} from '../../services/documentService.js';
import { getEquipages } from '../../services/equipageService.js';
import { getConfig, saveConfig } from '../../services/competitionService.js';
import { showAlert } from '../../ui/components.js';
import {
    renderCommunicationTabMarkup,
    renderMessageAudienceBadge,
    renderDocumentAudienceBadge,
    renderRecipientChecklist,
    renderUploadStatus,
    renderMessagesList,
    renderDocumentsList
} from './admin-communication-view.js';

function formatTimestamp(timestamp) {
    if (!timestamp?.seconds) return '';
    return new Date(timestamp.seconds * 1000).toLocaleString('sv-SE');
}

function getMessageBadge(message) {
    return renderMessageAudienceBadge(message, getMessageAudience, getMessageTargetStartNumbers);
}

function getDocumentBadge(document) {
    return renderDocumentAudienceBadge(document, getDocumentAudience);
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
        selectedDriversBox.classList.toggle('hidden', messageAudienceSelect.value !== 'selected_drivers');
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
        const withFormatting = items.map((item) => ({
            ...item,
            _formattedTimestamp: formatTimestamp(item.timestamp)
        }));

        list.innerHTML = renderMessagesList(withFormatting, getMessageBadge);
        list.querySelectorAll('[data-delete-message-id]').forEach((button) => {
            button.addEventListener('click', () => handleDeleteMessage(compId, button.dataset.deleteMessageId));
        });
    }

    async function refreshDocuments(compId) {
        const list = document.getElementById('documentsList');
        const items = await getCompetitionDocuments(compId);

        list.innerHTML = renderDocumentsList(items, getDocumentBadge);
        list.querySelectorAll('[data-delete-document-id]').forEach((button) => {
            button.addEventListener('click', () => handleDeleteDocument(compId, button.dataset.deleteDocumentId));
        });
    }

    async function handleDeleteMessage(compId, id) {
        if (!confirm('Ta bort meddelande?')) return;
        try {
            await deleteCompetitionMessage(compId, id);
            await refreshMessages(compId);
        } catch (err) {
            console.error(err);
            showAlert('Kunde inte ta bort meddelandet.', false);
        }
    }

    async function handleDeleteDocument(compId, id) {
        if (!confirm('Ta bort dokument?')) return;
        try {
            await deleteCompetitionDocument(compId, id);
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
    document.getElementById('clearSelectedDriversBtn')?.addEventListener('click', () => {
        document.querySelectorAll('.msg-driver-checkbox').forEach((checkbox) => {
            checkbox.checked = false;
        });
    });

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
            const { uploadCompetitionDocument } = await import('../../services/storageService.js');
            const url = await uploadCompetitionDocument(competition.id, file);

            urlInput.value = url;
            pendingUploadedFile = {
                name: file.name,
                size: file.size,
                type: file.type || null
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

            const payloadByMode = {
                public_and_drivers: {
                    audience: { public: true, drivers: true },
                    targetStartNumbers: []
                },
                public_only: {
                    audience: { public: true, drivers: false },
                    targetStartNumbers: []
                },
                drivers_only: {
                    audience: { public: false, drivers: true },
                    targetStartNumbers: []
                },
                selected_drivers: {
                    audience: { public: false, drivers: true },
                    targetStartNumbers: selectedDrivers
                }
            };

            await saveCompetitionMessage(competition.id, {
                title: document.getElementById('msgTitle').value.trim(),
                body: document.getElementById('msgBody').value.trim(),
                type: document.getElementById('msgType').value,
                ...payloadByMode[audienceMode]
            });

            showAlert('Meddelande publicerat.');
            messageForm.reset();
            syncAudienceUi();
            document.querySelectorAll('.msg-driver-checkbox').forEach((checkbox) => {
                checkbox.checked = false;
            });
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

            const payload = {
                title: document.getElementById('docTitle').value.trim(),
                category,
                type,
                url: type === 'url' ? document.getElementById('docUrl').value.trim() : null,
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
    syncAudienceUi();
    setUploadState({ status: 'idle' });
    loadPublicInfo(competition.id);
    refreshMessages(competition.id);
    refreshDocuments(competition.id);
    loadEquipages(competition.id);
}

