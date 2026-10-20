// The organisers' messages on the speaker page: the competition's messages
// collection (written from admin → Kommunikation, documentService.js) - those
// for the public (readable by everyone, what the speaker may announce) and
// those for the officials that reach the speaker (all officials or the
// speaker role; marked internal in the banner). Newest first.

import { collection, onSnapshot, query, where } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { db, appId } from '../../config/firebase-config.js';
import { listenForOfficialMessages } from '../../services/documentService.js';
import { isMessageForOfficial, viewerOfficialRoleKeys } from '../../utils/messageAudience.js';
export { pickSpeakerMessages, renderSpeakerMessagesHtml } from './speakerMessagesView.js';

/** Live public messages of a competition; returns the unsubscribe */
export function listenForPublicMessages(competitionId, callback) {
    if (!competitionId || !appId) return () => { };
    const colRef = collection(db, 'artifacts', appId, 'public', 'data', 'competitions', competitionId, 'messages');
    return onSnapshot(query(colRef, where('audience.public', '==', true)),
        (snap) => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
        (err) => { console.warn('Speaker messages could not be read:', err); callback([]); });
}

/**
 * Public messages and the officials' messages for the speaker (roles: the
 * viewer's roles; the speaker page's role is added). Returns the unsubscribe.
 */
export function listenForSpeakerMessages(competitionId, roles, callback) {
    let publicList = [];
    let officialList = [];
    const keys = viewerOfficialRoleKeys(roles, 'speaker');
    const emit = () => {
        const byId = new Map();
        [...publicList, ...officialList.filter(m => isMessageForOfficial(m, keys))].forEach(m => byId.set(m.id, m));
        callback([...byId.values()]);
    };
    const unsubPublic = listenForPublicMessages(competitionId, (list) => { publicList = list; emit(); });
    const unsubOfficial = listenForOfficialMessages(competitionId, (list) => { officialList = list; emit(); });
    return () => {
        try { unsubPublic(); } catch (_) { /* already stopped */ }
        try { unsubOfficial(); } catch (_) { /* already stopped */ }
    };
}
