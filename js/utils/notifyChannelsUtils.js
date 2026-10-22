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
