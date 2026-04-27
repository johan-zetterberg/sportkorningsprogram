import { saveVolunteerSignup } from '../services/officialsService.js';
import { db } from '../config/firebase-config.js'; // Ensure initialization
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { appId } from '../config/firebase-config.js';

const urlParams = new URLSearchParams(window.location.search);
const compId = urlParams.get('id');

const form = document.getElementById('volunteerForm');
const statusMsg = document.getElementById('statusMsg');
const btnSubmit = document.getElementById('btnSubmit');

// Init verification
(async () => {
    if (!compId) {
        showStatus('Saknar tävlings-ID i länken. Kontakta arrangören.', true);
        btnSubmit.disabled = true;
        btnSubmit.classList.add('opacity-50', 'cursor-not-allowed');
        return;
    }

    // Optional: Fetch comp name to show "Anmälan till [Tävling]"
    try {
        const compRef = doc(db, `artifacts/${appId}/public/data/competitions/${compId}`);
        const snap = await getDoc(compRef);
        if (snap.exists()) {
            const data = snap.data();
            document.querySelector('h1').textContent = `Funktionärsanmälan: ${data.name || ''}`;
        }
    } catch (err) {
        console.warn("Could not fetch competition name", err);
    }
})();

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!compId) return;

    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Skickar...';
    statusMsg.classList.add('hidden');

    const data = {
        name: document.getElementById('volName').value.trim(),
        phone: document.getElementById('volPhone').value.trim(),
        email: document.getElementById('volEmail').value.trim(),
        club: document.getElementById('volClub').value.trim(),
        shirtSize: document.getElementById('volShirtSize').value,
        diet: document.getElementById('volDiet').value.trim(),
        iceName: document.getElementById('volIceName').value.trim(),
        icePhone: document.getElementById('volIcePhone').value.trim(),
        role: document.getElementById('volRole').value,
        notes: document.getElementById('volNotes').value.trim(),
    };

    try {
        await saveVolunteerSignup(compId, data);
        showStatus('Tack! Din anmälan är mottagen. Arrangören återkommer till dig.', false);
        form.reset();
        btnSubmit.textContent = 'Skickat!';
    } catch (err) {
        console.error(err);
        showStatus('Något gick fel. Försök igen eller kontakta arrangören.', true);
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'Skicka Anmälan';
    }
});

function showStatus(msg, isError) {
    statusMsg.textContent = msg;
    statusMsg.className = isError ? 'text-center mt-4 font-bold text-red-600' : 'text-center mt-4 font-bold text-green-600';
    statusMsg.classList.remove('hidden');
}
