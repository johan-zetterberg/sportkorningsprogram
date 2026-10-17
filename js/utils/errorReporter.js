// Sends uncaught errors and rejected promises from the browser to the
// reportClientError function, which logs them to Cloud Logging / Error
// Reporting. At most a few reports per page load, each error once, and none
// from local tests (emulators). See errorReportUtils.js for what is sent.
import { functions, usingEmulators } from '../config/firebase-config.js';
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";
import { APP_VERSION } from '../appVersion.js';
import { RESULT_ENGINE_VERSION } from '../core-engine/version.js';
import { buildErrorReport, isIgnorableError, reportKey } from './errorReportUtils.js';

const MAX_REPORTS_PER_LOAD = 5;
let installed = false;

export function installErrorReporter({ getCompetitionId = () => '' } = {}) {
    if (installed || usingEmulators) return;
    installed = true;
    const sent = new Set();
    const callable = httpsCallable(functions, 'reportClientError');

    const send = (input) => {
        try {
            if (sent.size >= MAX_REPORTS_PER_LOAD) return;
            let competitionId = '';
            try { competitionId = getCompetitionId() || ''; } catch { }
            const report = buildErrorReport({
                ...input,
                hash: location.hash,
                competitionId,
                appVersion: APP_VERSION,
                engineVersion: RESULT_ENGINE_VERSION
            });
            const key = reportKey(report);
            if (sent.has(key)) return;
            sent.add(key);
            // Fire and forget: reporting must never cause an error of its own
            callable(report).catch(() => { });
        } catch { }
    };

    window.addEventListener('error', (event) => {
        // Failed resource loads (img/script tags) have no error object: skipped
        if (!event.error && !event.message) return;
        if (isIgnorableError({ message: event.message, filename: event.filename }, location.origin)) return;
        send({ error: event.error, message: event.message, filename: event.filename, kind: 'error' });
    });
    window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason;
        // Offline is not an app error
        if (reason?.code === 'unavailable' || /network|offline|Failed to fetch/i.test(String(reason?.message || ''))) return;
        send({ error: reason instanceof Error ? reason : null, message: reason?.message || String(reason ?? ''), kind: 'rejection' });
    });
}
