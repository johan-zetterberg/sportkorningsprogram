// Admin > Kommunikation > Publik info: the emergency information. Names and
// the first aid point are public (config/emergencyInfo); the phone numbers of
// named persons are private (emergencyPrivate/contacts: officials and the
// competition's drivers only). Mounted after the public info form.
import { getEmergencyPrivate, getEmergencyPublic, saveEmergencyInfo } from '../../services/emergencyInfoService.js';
import { DEFAULT_EMERGENCY_NUMBER, EMERGENCY_PERSONS } from '../../services/emergencyInfoUtils.js';
import { showAlert } from '../../ui/components.js';
import { escapeHtml } from '../../utils/sharedUtils.js';
import { t } from '../../utils/i18n.js';

const inputClass = 'mt-1 block w-full min-h-[44px] p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white';
const labelClass = 'block text-sm font-medium text-gray-700 dark:text-gray-300';

function field(id, labelKey, { type = 'text', placeholder = '', hintKey = '' } = {}) {
    return `
        <div>
            <label for="${id}" class="${labelClass}">${escapeHtml(t(labelKey))}</label>
            <input id="${id}" type="${type}" class="${inputClass}" ${placeholder ? `placeholder="${escapeHtml(placeholder)}"` : ''} autocomplete="off">
            ${hintKey ? `<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">${escapeHtml(t(hintKey))}</p>` : ''}
        </div>`;
}

function renderForm() {
    const persons = EMERGENCY_PERSONS.map((person) => `
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            ${field(`emergency_${person.nameField}`, person.labelKey)}
            ${field(`emergency_${person.phoneField}`, 'emergency_admin_phone_private', { type: 'tel' })}
        </div>`).join('');
    return `
        <form id="emergencyInfoForm" class="mt-6 rounded-lg border-2 border-red-200 dark:border-red-900/60 bg-red-50/40 dark:bg-red-950/20 p-4 space-y-4">
            <div>
                <h3 class="text-lg font-bold text-red-900 dark:text-red-100">🚑 ${escapeHtml(t('emergency_admin_title'))}</h3>
                <p class="text-sm text-gray-600 dark:text-gray-300">${escapeHtml(t('emergency_admin_intro'))}</p>
            </div>
            <label class="inline-flex items-center gap-2 text-sm dark:text-gray-200"><input type="checkbox" id="emergency_enabled" class="rounded" checked> ${escapeHtml(t('emergency_admin_enabled'))}</label>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                ${field('emergency_emergencyNumber', 'emergency_number', { type: 'tel', placeholder: DEFAULT_EMERGENCY_NUMBER })}
                ${field('emergency_firstAidPlace', 'emergency_admin_first_aid_place')}
                ${field('emergency_firstAidPhone', 'emergency_admin_first_aid_phone', { type: 'tel' })}
            </div>
            ${persons}
            <div class="flex justify-end">
                <button type="submit" class="min-h-[44px] px-4 py-2 rounded-md bg-red-700 hover:bg-red-800 text-white font-semibold">${escapeHtml(t('emergency_admin_save'))}</button>
            </div>
        </form>`;
}

const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value ?? '';
};
const getValue = (id) => document.getElementById(id)?.value ?? '';

/** Mounts the emergency form after `anchor` (the public info form) */
export function mountEmergencyInfoAdmin(anchor, competition) {
    if (!anchor || !competition?.id) return;
    document.getElementById('emergencyInfoForm')?.remove();
    anchor.insertAdjacentHTML('afterend', renderForm());
    const form = document.getElementById('emergencyInfoForm');

    Promise.all([getEmergencyPublic(competition.id), getEmergencyPrivate(competition.id)]).then(([pub, priv]) => {
        const publicDoc = pub || {};
        const privateDoc = priv || {};
        const enabled = document.getElementById('emergency_enabled');
        if (enabled) enabled.checked = publicDoc.enabled !== false;
        setValue('emergency_emergencyNumber', publicDoc.emergencyNumber || DEFAULT_EMERGENCY_NUMBER);
        setValue('emergency_firstAidPlace', publicDoc.firstAidPlace);
        setValue('emergency_firstAidPhone', publicDoc.firstAidPhone);
        EMERGENCY_PERSONS.forEach(({ nameField, phoneField }) => {
            setValue(`emergency_${nameField}`, publicDoc[nameField]);
            setValue(`emergency_${phoneField}`, privateDoc[phoneField]);
        });
    });

    form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = event.submitter;
        if (button) button.disabled = true;
        const values = {
            enabled: document.getElementById('emergency_enabled')?.checked !== false,
            emergencyNumber: getValue('emergency_emergencyNumber'),
            firstAidPlace: getValue('emergency_firstAidPlace'),
            firstAidPhone: getValue('emergency_firstAidPhone')
        };
        EMERGENCY_PERSONS.forEach(({ nameField, phoneField }) => {
            values[nameField] = getValue(`emergency_${nameField}`);
            values[phoneField] = getValue(`emergency_${phoneField}`);
        });
        try {
            await saveEmergencyInfo(competition.id, values);
            showAlert(t('emergency_admin_saved'));
        } catch (error) {
            console.error(error);
            showAlert(`${t('emergency_admin_save_failed')} ${error?.message || ''}`, false);
        } finally {
            if (button) button.disabled = false;
        }
    });
}
