
// En enkel tjänst för att spåra väntande skrivningar till Firestore.
// Detta låter oss visa användaren exakt vad som väntar på att laddas upp.

const queue = new Map(); // id -> { id, desc, time }
let listeners = [];

export const syncService = {
    // Lägg till en operation i kön
    add(id, description) {
        queue.set(id, {
            id,
            desc: description,
            time: new Date(),
            status: 'pending'
        });
        notify();
    },

    // Ta bort en operation (när den är klar)
    remove(id) {
        if (queue.has(id)) {
            queue.delete(id);
            notify();
        }
    },

    clearAll() {
        queue.clear();
        notify();
    },

    // Hämta alla väntande
    getAll() {
        return Array.from(queue.values()).sort((a, b) => b.time - a.time);
    },

    // Antal väntande
    get count() {
        return queue.size;
    },

    // Prenumerera på ändringar
    subscribe(callback) {
        listeners.push(callback);
        return () => {
            listeners = listeners.filter(l => l !== callback);
        };
    }
};

function notify() {
    const items = syncService.getAll();
    listeners.forEach(cb => cb(items));

    // Uppdatera även den globala synk-indikatorn i main.js om den finns
    if (window.setSyncStatus) {
        window.setSyncStatus(items.length > 0);
    }
}

// Gör den globalt tillgänglig för debugging
window.syncService = syncService;
