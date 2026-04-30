import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  initializeFirestore,
  enableIndexedDbPersistence,
  enableMultiTabIndexedDbPersistence,
  setLogLevel
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Tysta ner Firestore-varningar (t.ex. "future update time" pga klockdiff)
setLogLevel('error');
import { getStorage } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";


const firebaseConfig = {
  apiKey: "AIzaSyAPdFG7gZSuZw8QguARA_ePH4KR3XAdrmk",
  authDomain: "combined-driving.firebaseapp.com",
  projectId: "combined-driving",
  storageBucket: "combined-driving.firebasestorage.app",
  messagingSenderId: "939419750289",
  appId: "1:939419750289:web:9481b3c80e569de5b9d430",
  measurementId: "G-TKTRECX5D9"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, { /* cacheSizeBytes etc om du vill */ });
export const storage = getStorage(app);

// Slå på offline-persistens (multi-tab om möjligt, annars single-tab)
try {
  await enableMultiTabIndexedDbPersistence(db);
} catch (err) {
  if (err.code === 'failed-precondition' || err.code === 'unimplemented') {
    console.warn('Firestore persistence failed/not possible:', err.code);
  } else if (err.name === 'QuotaExceededError' || err.code === 'quota-exceeded') {
    console.error('Firestore storage quota exceeded! Persistence DISABLED to prevent crash.');
    console.warn('Please clear browser site data (Application -> Storage -> Clear site data).');
  } else {
    console.warn('Fallback single-tab persistence due to:', err);
    try {
      await enableIndexedDbPersistence(db);
    } catch (err2) {
      console.warn('Firestore persistence DISABLED:', err2?.code || err2);
    }
  }
}

// Om ni fortfarande använder appId i paths:
export const appId = "combined-driving";
