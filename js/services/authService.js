import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, query, where, arrayUnion } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { auth, db, appId } from '../config/firebase-config.js';
import { setGlobalState, getGlobalState } from '../main.js'; // <-- NYTT: Importera setGlobalState
// Lokal state för denna modul
let currentUserRole = 'publik'; // 'publik' är standardrollen
let currentUserId = null;
let onAuthReadyCallback = null;

/**
 * Uppdaterar synligheten för olika UI-element baserat på användarens roll och inloggningsstatus.
 */
export function updateUIVisibility() {
    // --- NYTT: Hämta användaren från global state istället för lokala variabler ---
    const currentUser = getGlobalState('currentUser');
    const userCompRoles = currentUser?.compRoles && currentUser.compRoles.length > 0 ? currentUser.compRoles : [];
    const globalRole = currentUser?.role || 'publik';
    const rolesToCheck = userCompRoles.length > 0 ? userCompRoles : [globalRole];
    // --------------------------------------------------------------------------

    const userInfoDiv = document.getElementById('userInfo');
    const userRoleSpan = document.getElementById('userRole');
    const logoutButton = document.getElementById('logoutButton');
    const loginButton = document.getElementById('loginButton');
    const navLinks = document.querySelectorAll('.nav-link');
    const menuToggle = document.getElementById('menu-toggle');

    if (currentUser) { // Användaren är inloggad
        userInfoDiv.style.display = 'flex';
        if (globalRole !== 'publik') {
            userRoleSpan.textContent = globalRole.charAt(0).toUpperCase() + globalRole.slice(1);
        } else if (userCompRoles.length > 0) {
            userRoleSpan.textContent = userCompRoles.map(r => r.charAt(0).toUpperCase() + r.slice(1)).join(', ');
        } else {
            userRoleSpan.textContent = currentUser.email;
        }
        logoutButton.style.display = 'block';
        loginButton.style.display = 'none';
    } else { // Användaren är utloggad
        userInfoDiv.style.display = 'none';
        logoutButton.style.display = 'none';
        loginButton.style.display = 'block';
    }

    navLinks.forEach(link => {
        const requiredRoles = (link.dataset.roleRequired || 'publik,funktionar,domare,admin').split(',');
        
        // Mappa specifika funktionärsroller till den generella "funktionar"-nivån
        const roleHierarchy = {
            'superadmin': ['superadmin', 'admin', 'funktionar', 'publik'],
            'admin': ['admin', 'funktionar', 'publik'],
            'dressage': ['dressage', 'funktionar', 'publik'],
            'marathon': ['marathon', 'funktionar', 'publik'],
            'precision': ['precision', 'funktionar', 'publik'],
            'speaker': ['speaker', 'funktionar', 'publik'],
            'publik': ['publik']
        };
        
        let hasAccess = false;
        for (const r of rolesToCheck) {
            const expandedRoles = roleHierarchy[r] || [r, 'publik'];
            if (requiredRoles.some(req => expandedRoles.includes(req))) {
                hasAccess = true;
                break;
            }
        }
        
        link.style.display = hasAccess ? 'block' : 'none';
    });

    if (menuToggle) {
        const visibleLinks = Array.from(navLinks).some(link => link.style.display !== 'none');
        menuToggle.style.display = visibleLinks ? 'block' : 'none';
    }
}

export async function resetPassword(email) {
    try {
        await sendPasswordResetEmail(auth, email);
        return true;
    } catch (error) {
        console.error("Reset password failed:", error.code);
        let msg = 'Kunde inte återställa lösenord.';
        if (error.code === 'auth/user-not-found') msg = 'Ingen användare hittades med denna e-post.';
        else if (error.code === 'auth/invalid-email') msg = 'Ogiltig e-postadress.';
        throw new Error(msg);
    }
}

export async function loginUser(email, password) {
    try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        // Försök auto-claima vid inloggning också (om admin lagt till e-post i efterhand)
        try {
            await autoClaimEquipages(cred.user);
        } catch (e) {
            console.warn('Auto-claim vid inloggning misslyckades:', e);
        }
    } catch (error) {
        console.error("Login failed:", error.code);
        let msg = 'Fel e-postadress eller lösenord.';
        if (error.code === 'auth/user-not-found') msg = 'Ingen användare hittades. Har du registrerat ett konto?';
        else if (error.code === 'auth/wrong-password') msg = 'Fel lösenord.';
        else if (error.code === 'auth/invalid-email') msg = 'Ogiltig e-postadress.';
        throw new Error(msg);
    }
}

export async function registerUser(email, password) {
    try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        const user = cred.user;

        // Skapa användardokument i Firestore
        await setDoc(doc(db, 'users', user.uid), {
            email: user.email,
            role: 'publik',
            createdAt: new Date().toISOString(),
            claimedEquipages: []
        });

        // Försök auto-claima direkt
        try {
            await autoClaimEquipages(user);
        } catch (e) {
            console.warn('Auto-claim vid registrering misslyckades (icke-kritisk):', e);
        }

    } catch (error) {
        console.error("Registration failed:", error.code);
        let msg = 'Registrering misslyckades.';
        if (error.code === 'auth/email-already-in-use') msg = 'E-postadressen används redan. Logga in istället.';
        else if (error.code === 'auth/weak-password') msg = 'Lösenordet är för svagt (minst 6 tecken).';
        else if (error.code === 'auth/invalid-email') msg = 'Ogiltig e-postadress.';
        throw new Error(msg);
    }
}

export async function logoutUser() {
    await signOut(auth);
    window.location.hash = '#hub';
    window.location.reload();
}

export function initAuth(callback) {
    onAuthReadyCallback = callback;

    const loginForm = document.getElementById('loginForm');
    const logoutButton = document.getElementById('logoutButton');
    const loginButton = document.getElementById('loginButton');
    const closeLoginModalButton = document.getElementById('closeLoginModal');
    const toggleAuthModeBtn = document.getElementById('toggleAuthMode');
    const modalTitle = document.querySelector('#loginModal h2');
    const loginSubmitBtn = document.querySelector('#loginForm button[type="submit"]');

    let isRegisterMode = false;

    if (toggleAuthModeBtn) {
        toggleAuthModeBtn.addEventListener('click', () => {
            isRegisterMode = !isRegisterMode;
            if (isRegisterMode) {
                modalTitle.textContent = 'Registrera konto';
                loginSubmitBtn.textContent = 'Registrera';
                toggleAuthModeBtn.textContent = 'Har du redan ett konto? Logga in här.';
            } else {
                modalTitle.textContent = 'Logga in';
                loginSubmitBtn.textContent = 'Logga in';
                toggleAuthModeBtn.textContent = 'Har du inget konto? Registrera dig här.';
            }
            const errorP = document.getElementById('loginError');
            if (errorP) errorP.textContent = '';
        });
    }

    const forgotPwBtn = document.getElementById('forgotPasswordLink');
    if (forgotPwBtn) {
        forgotPwBtn.addEventListener('click', async () => {
            const emailField = document.getElementById('email');
            const currentEmail = emailField ? emailField.value : '';
            const email = prompt('Ange din e-postadress för att återställa lösenordet:', currentEmail);
            if (email) {
                try {
                    await resetPassword(email);
                    alert('Återställningslänk har skickats till din e-post.');
                } catch (e) {
                    alert('Fel: ' + e.message);
                }
            }
        });
    }

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const errorP = document.getElementById('loginError');
            if (errorP) errorP.textContent = '';

            try {
                if (isRegisterMode) {
                    await registerUser(email, password);
                } else {
                    await loginUser(email, password);
                }
            } catch (error) {
                if (errorP) errorP.textContent = error.message;
            }
        });
    }

    if (logoutButton) logoutButton.addEventListener('click', logoutUser);
    if (loginButton) loginButton.addEventListener('click', () => {
        const m = document.getElementById('loginModal');
        if (m) m.style.display = 'flex';
    });
    if (closeLoginModalButton) closeLoginModalButton.addEventListener('click', () => {
        const m = document.getElementById('loginModal');
        if (m) m.style.display = 'none';

        // Reset to login mode
        isRegisterMode = false;
        if (modalTitle) modalTitle.textContent = 'Logga in';
        if (loginSubmitBtn) loginSubmitBtn.textContent = 'Logga in';
        if (toggleAuthModeBtn) toggleAuthModeBtn.textContent = 'Har du inget konto? Registrera dig här.';
        if (document.getElementById('loginError')) document.getElementById('loginError').textContent = '';
        if (loginForm) loginForm.reset();
    });

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            // 1. Optimistisk uppdatering: Visa att vi är inloggade direkt (roll 'publik' tills vidare)
            setGlobalState({
                key: 'currentUser',
                value: {
                    uid: user.uid,
                    email: user.email,
                    role: 'publik' // Temporärt
                }
            });
            document.getElementById('loginModal').style.display = 'none';
            updateUIVisibility();

            // 2. Hämta riktig roll asynkront med retry-logik
            let userRole = 'publik';

            // --- SUPERADMIN OVERRIDE ---
            const SUPER_ADMIN_EMAILS = ['admin@demo.se', 'johan.zetterberg@gmail.com'];
            if (user.email && SUPER_ADMIN_EMAILS.includes(user.email.toLowerCase())) {
                userRole = 'superadmin';
            } else {
                let retries = 3;
                while (retries > 0) {
                    try {
                        const userDocRef = doc(db, "users", user.uid);
                        const userDoc = await getDoc(userDocRef);
                        if (userDoc.exists()) {
                            userRole = userDoc.data().role;
                        }
                        // Om vi lyckas, bryt loopen
                        break;
                    } catch (err) {
                        console.warn(`Försök att hämta användarroll misslyckades (${4 - retries}/3):`, err);
                        retries--;
                        if (retries === 0) {
                            console.error('Kunde inte hämta användarroll efter flera försök:', err);
                            // Visa ett felmeddelande eller notifiering om att behörigheter kan saknas
                            alert("Kunde inte ladda din profil fullständigt. Vissa funktioner kanske inte fungerar. Prova att ladda om sidan.");
                        } else {
                            // Vänta lite innan nästa försök (exponential backoff eller fast tid)
                            await new Promise(res => setTimeout(res, 500));
                        }
                    }
                }
            }

            // Uppdatera state med den (förhoppningsvis) uppdaterade rollen
            setGlobalState({
                key: 'currentUser',
                value: {
                    uid: user.uid,
                    email: user.email,
                    role: userRole
                }
            });
            updateUIVisibility();

        } else {
            // --- NYTT: Nollställ det globala state-objektet vid utloggning ---
            setGlobalState({ key: 'currentUser', value: null });
            // -------------------------------------------------------------
            updateUIVisibility();
        }

        if (onAuthReadyCallback) {
            onAuthReadyCallback();
            onAuthReadyCallback = null;
        }
    });
}
export async function getCurrentUserRole() {
    const user = auth.currentUser;
    // Oinloggad publik
    if (!user) return 'publik';

    // Läs roll från root-kollektionen 'users' (matchar dina regler)
    const snap = await getDoc(doc(db, 'users', user.uid));
    const role = snap.exists() ? (snap.data()?.role || 'publik') : 'publik';
    return role;
}

export async function autoClaimEquipages(user) {
    if (!user || !user.email) return;

    try {
        const email = user.email.trim().toLowerCase(); // Matchning sker alltid mot gemener

        // 1. Hämta alla tävlingar från rätt path
        const compsRef = collection(db, `artifacts/${appId}/public/data/competitions`);
        const compsSnap = await getDocs(compsRef);

        let newClaims = [];

        for (const compDoc of compsSnap.docs) {
            const compId = compDoc.id;
            const compData = compDoc.data();

            // 2. Sök efter ekipage i denna tävlings underkollektion
            const equipagesRef = collection(db, `artifacts/${appId}/public/data/competitions/${compId}/equipages`);
            const q = query(equipagesRef, where('email', '==', email));
            const eqSnap = await getDocs(q);

            eqSnap.forEach(doc => {
                const eqData = doc.data();
                newClaims.push({
                    competitionId: compId,
                    startNumber: eqData.startNumber,
                    competitionName: compData.name || compId
                });
            });
        }

        if (newClaims.length > 0) {
            await updateDoc(doc(db, 'users', user.uid), {
                claimedEquipages: arrayUnion(...newClaims)
            });
        }
    } catch (err) {
        console.error('Auto-claim failed:', err);
        throw err; // Kasta vidare så att registerUser ser det (om vi vill)
    }
}