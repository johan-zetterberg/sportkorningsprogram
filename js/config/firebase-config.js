import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFunctions, connectFunctionsEmulator } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";
import {
  initializeFirestore,
  connectFirestoreEmulator,
  enableIndexedDbPersistence,
  enableMultiTabIndexedDbPersistence,
  setLogLevel
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Tysta ner Firestore-varningar (t.ex. "future update time" pga klockdiff)
setLogLevel('error');
import { getStorage, connectStorageEmulator } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";


const firebaseConfig = {
  apiKey: "AIzaSyAPdFG7gZSuZw8QguARA_ePH4KR3XAdrmk",
  authDomain: "combined-driving.firebaseapp.com",
  projectId: "combined-driving",
  storageBucket: "combined-driving.firebasestorage.app",
  messagingSenderId: "939419750289",
  appId: "1:939419750289:web:9481b3c80e569de5b9d430",
  measurementId: "G-TKTRECX5D9"
};

// Lokala Firebase-emulatorer (används av webbläsartesterna, se scripts/run-smoke-tests.mjs).
// Slås bara på när testet satt flaggan och sidan körs från den egna datorn,
// så att tester aldrig skriver till produktionsdatabasen.
const EMULATOR_PROJECT_ID = 'demo-combined-driving';
export const usingEmulators = globalThis.__USE_FIREBASE_EMULATORS__ === true
  && ['127.0.0.1', 'localhost'].includes(globalThis.location?.hostname);

export const app = initializeApp(usingEmulators
  ? { ...firebaseConfig, projectId: EMULATOR_PROJECT_ID, storageBucket: `${EMULATOR_PROJECT_ID}.appspot.com` }
  : firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, { /* cacheSizeBytes etc om du vill */ });
export const storage = getStorage(app);
export const functions = getFunctions(app, 'europe-west1');

if (usingEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  globalThis.__FIREBASE_EMULATORS_ACTIVE__ = true;
}

// Slå på offline-persistens (multi-tab om möjligt, annars single-tab).
// Whether it worked is kept for the input pages (offlineWrite.js): without it
// a write made without signal lives only in memory and is lost on reload
globalThis.__FIRESTORE_OFFLINE_STORAGE__ = false;
try {
  await enableMultiTabIndexedDbPersistence(db);
  globalThis.__FIRESTORE_OFFLINE_STORAGE__ = true;
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
      globalThis.__FIRESTORE_OFFLINE_STORAGE__ = true;
    } catch (err2) {
      console.warn('Firestore persistence DISABLED:', err2?.code || err2);
    }
  }
}

// Om ni fortfarande använder appId i paths:
export const appId = "combined-driving";
