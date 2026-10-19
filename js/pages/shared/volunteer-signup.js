import { saveVolunteerSignup } from '../../services/officialsService.js';
import { db, appId } from '../../config/firebase-config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { competitionDays } from '../../utils/officialAccessUtils.js';

const urlParams = new URLSearchParams(window.location.search);
const compId = urlParams.get('id');

const form = document.getElementById('volunteerForm');
const statusMsg = document.getElementById('statusMsg');
const btnSubmit = document.getElementById('btnSubmit');
const dietSelect = document.getElementById('volDiet');
const dietOther = document.getElementById('volDietOther');
// The server ignores forms sent sooner than 3 s after the page loaded (bots)
const formOpenedAt = Date.now();

// "Annat" opens a short text field of its own
dietSelect?.addEventListener('change', () => {
    const other = dietSelect.value === 'Annat';
    dietOther?.classList.toggle('hidden', !other);
    if (!other && dietOther) dietOther.value = '';
});

const SHIFT_LABELS = { fm: 'förmiddag', em: 'eftermiddag' };

// Checkboxes per competition day and half day (from the competition's dates)
function renderAvailability(dates) {
    const box = document.getElementById('volAvailabilityBox');
    const list = document.getElementById('volAvailability');
    const days = competitionDays(dates);
    if (!box || !list || !days.length) return;
    list.replaceChildren(...days.flatMap((day) => Object.entries(SHIFT_LABELS).map(([shift, label]) => {
        const wrapper = document.createElement('label');
        wrapper.className = 'flex items-center gap-2';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.name = 'volAvailability';
        input.value = `${day}_${shift}`;
        const date = new Date(`${day}T12:00:00`);
        const dayText = date.toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' });
        wrapper.append(input, document.createTextNode(` ${dayText}, ${label}`));
        return wrapper;
    })));
    box.classList.remove('hidden');
}

(async () => {
    if (!compId) {
        showStatus('Saknar tävlings-ID i länken. Kontakta arrangören.', true);
        btnSubmit.disabled = true;
        btnSubmit.classList.add('opacity-50', 'cursor-not-allowed');
        return;
    }

    try {
        const compRef = doc(db, `artifacts/${appId}/public/data/competitions/${compId}`);
        const snap = await getDoc(compRef);
        if (snap.exists()) {
            const data = snap.data() || {};
            document.querySelector('h1').textContent = `Funktionärsanmälan: ${data.name || ''}`;
            renderAvailability(data.dates);
        }
    } catch (err) {
        console.warn('Could not fetch competition name', err);
    }
})();

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!compId) return;
    if (!document.getElementById('volConsent')?.checked) {
        showStatus('Kryssa i att du godkänner att uppgifterna sparas.', true);
        return;
    }

    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Skickar...';
    statusMsg.classList.add('hidden');

    const data = {
        name: document.getElementById('volName').value.trim(),
        phone: document.getElementById('volPhone').value.trim(),
        email: document.getElementById('volEmail').value.trim(),
        club: document.getElementById('volClub').value.trim(),
        shirtSize: document.getElementById('volShirtSize').value,
        diet: dietSelect?.value || 'Ingen',
        dietOther: dietOther?.value.trim() || '',
        availability: Array.from(document.querySelectorAll('input[name="volAvailability"]:checked')).map((el) => el.value),
        iceName: document.getElementById('volIceName').value.trim(),
        icePhone: document.getElementById('volIcePhone').value.trim(),
        role: document.getElementById('volRole').value,
        notes: document.getElementById('volNotes').value.trim(),
        consent: true,
        website: document.getElementById('volWebsite')?.value.trim() || '',
        elapsedMs: Date.now() - formOpenedAt
    };

    try {
        await saveVolunteerSignup(compId, data);
        // The same answer for every accepted form (the server says nothing
        // about earlier sign-ups with the same email)
        showStatus('Tack! Din anmälan är mottagen. Arrangören återkommer till dig.', false);
        form.reset();
        dietOther?.classList.add('hidden');
        btnSubmit.textContent = 'Skickat!';
    } catch (err) {
        console.error(err);
        // The server's own text for refusals it explains (e.g. too many sign-ups)
        const explained = ['functions/resource-exhausted', 'functions/invalid-argument'].includes(err?.code);
        showStatus(explained && err.message ? err.message : 'Något gick fel. Försök igen eller kontakta arrangören.', true);
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'Skicka anmälan';
    }
});

function showStatus(msg, isError) {
    statusMsg.textContent = msg;
    statusMsg.className = isError
        ? 'text-center mt-4 font-bold text-red-600'
        : 'text-center mt-4 font-bold text-green-600';
    statusMsg.classList.remove('hidden');
}
