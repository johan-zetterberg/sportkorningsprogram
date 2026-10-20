// The organisers' messages on the speaker page: the competition's messages
// collection (written from admin → Kommunikation, documentService.js), only
// those for the public — readable by everyone, and what the speaker may
// announce. Newest first, as on the public info page.

import { collection, onSnapshot, query, where } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { db, appId } from '../../config/firebase-config.js';
export { pickSpeakerMessages, renderSpeakerMessagesHtml } from './speakerMessagesView.js';

/** Live public messages of a competition; returns the unsubscribe */
export function listenForPublicMessages(competitionId, callback) {
    if (!competitionId || !appId) return () => { };
    const colRef = collection(db, 'artifacts', appId, 'public', 'data', 'competitions', competitionId, 'messages');
    return onSnapshot(query(colRef, where('audience.public', '==', true)),
        (snap) => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
        (err) => { console.warn('Speaker messages could not be read:', err); callback([]); });
}
