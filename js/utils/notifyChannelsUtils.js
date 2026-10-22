// The recipients lines of the channel dialog (js/ui/notifyChannelsDialog.js):
// pure, tr(key) gives the dictionary text.

const fill = (text, n) => String(text).replace('{n}', String(n));

/** previewPushAudience's answer as a line: devices, or push not switched on */
export function pushCountLine(result = {}, tr = (key) => key) {
    if (!result || result.available !== true) return tr('notify_push_off');
    return fill(tr('notify_count_devices'), Number(result.devices) || 0);
}

/** previewMailAudience's answer as a line: recipients, without address */
export function mailCountLine(result = {}, tr = (key) => key) {
    const recipients = Number(result?.recipientCount) || 0;
    const without = Array.isArray(result?.withoutEmail) ? result.withoutEmail.length : 0;
    const parts = [fill(tr('mail_preview_recipients'), recipients)];
    if (without) parts.push(fill(tr('mail_preview_without_email'), without));
    return parts.join(' · ');
}

/**
 * notifyStartTimeChange's answer as feedback after the dialog:
 * { ok, text } — sent count, or why nothing (or not everything) went
 */
export function startTimePushResultLine(result = {}, tr = (key) => key) {
    const status = String(result?.status || 'error');
    const sent = Number(result?.sent) || 0;
    const failed = Number(result?.failed) || 0;
    if (status === 'sent') return { ok: true, text: fill(tr('starttime_push_sent'), sent) };
    if (status === 'duplicate') return { ok: true, text: tr('starttime_push_duplicate') };
    if (status === 'partial') return { ok: false, text: fill(tr('starttime_push_partial'), sent).replace('{failed}', String(failed)) };
    if (status === 'disabled') return { ok: false, text: tr('notify_push_off') };
    if (status === 'no_tokens' || status === 'no_targets') return { ok: true, text: tr('starttime_push_no_devices') };
    if (status === 'blocked') return { ok: false, text: tr('starttime_push_blocked') };
    return { ok: false, text: tr('starttime_push_failed') };
}