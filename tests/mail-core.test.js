import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAIL_LIMITS,
  MailError,
  buildRecipientMessage,
  buildSenderName,
  effectiveReplyTo,
  emailHash,
  filterOptOuts,
  isEssentialMail,
  mailDayKey,
  normalizeAudience,
  normalizeExplicitRecipients,
  normalizePersonalTexts,
  normalizeProviderSettings,
  providerStatus,
  reserveDailyQuota,
  resolveRecipients,
  sanitizeMailHtml,
  signMailToken,
  summarizeSendResults,
  textToHtml,
  validateMailContent,
  verifyMailToken
} from '../functions/src/mail/mailCore.js';
import { buildBrevoPayload, createBrevoProvider, createFakeProvider, createMailProvider, sendAll } from '../functions/src/mail/providers.js';
import { renderMailPage } from '../functions/src/mail/mailPages.js';
import { RETENTION_PRIVATE_TREE_COLLECTIONS } from '../functions/src/personalData.js';

const equipages = [
  { id: '1', data: { className: 'Lätt B', driverName: 'Anna' } },
  { id: '2', data: { className: 'Lätt B', driverName: 'Bo', status: 'struken' } },
  { id: '3', data: { className: 'Msv', driverName: 'Cecilia' } },
  { id: '4', data: { className: 'Msv', driverName: 'Anna' } },
  { id: '5', data: { className: 'Msv', driverName: 'Utan Mejl' } }
];
const equipagePrivate = new Map([
  ['1', { email: 'Anna@Example.se' }],
  ['2', { email: 'bo@example.se' }],
  ['3', { email: 'cecilia@example.se', contactEmail: 'agare@example.se' }],
  // The same driver with two horses: one message
  ['4', { email: 'anna@example.se' }],
  ['5', { email: 'not-an-address' }]
]);

test('audience descriptors are checked and normalized', () => {
  assert.deepEqual(normalizeAudience({ drivers: { all: true } }), { drivers: { all: true, includeWithdrawn: false } });
  assert.deepEqual(normalizeAudience({ drivers: { classes: [' Msv ', 'Msv'], startNumbers: [7, '7'] } }),
    { drivers: { classes: ['Msv'], startNumbers: ['7'], includeWithdrawn: false } });
  assert.deepEqual(normalizeAudience({ officials: { roles: ['Marathon', 'judge'] } }), { officials: { roles: ['marathon', 'judge'] } });
  assert.deepEqual(normalizeAudience({ officials: true }), { officials: { all: true } });
  for (const bad of [null, {}, { drivers: {} }, { officials: { roles: [] } }, { drivers: { startNumbers: ['1/../x'] } }, []]) {
    assert.throws(() => normalizeAudience(bad), MailError);
  }
  assert.throws(() => normalizeAudience({ drivers: { startNumbers: Array.from({ length: 1001 }, (_, i) => String(i)) } }), MailError);
});

test('drivers are resolved from the private entries: by class, by start number, all', () => {
  const all = resolveRecipients({ audience: normalizeAudience({ drivers: { all: true } }), equipages, equipagePrivate });
  // Withdrawn #2 left out, #1 and #4 merged, #5 has no valid address
  assert.deepEqual(all.recipients.map((r) => [r.email, r.startNumbers]), [
    ['anna@example.se', ['1', '4']],
    ['cecilia@example.se', ['3']],
    ['agare@example.se', ['3']]
  ]);
  assert.deepEqual(all.withoutEmail, [{ type: 'driver', id: '5' }]);

  const msv = resolveRecipients({ audience: normalizeAudience({ drivers: { classes: ['msv'] } }), equipages, equipagePrivate });
  assert.deepEqual(msv.recipients.map((r) => r.email).sort(), ['agare@example.se', 'anna@example.se', 'cecilia@example.se']);

  // A withdrawn equipage named by its number is included; unknown numbers reported
  const chosen = resolveRecipients({ audience: normalizeAudience({ drivers: { startNumbers: ['2', '99'] } }), equipages, equipagePrivate });
  assert.deepEqual(chosen.recipients.map((r) => r.email), ['bo@example.se']);
  assert.deepEqual(chosen.unknownStartNumbers, ['99']);

  const withWithdrawn = resolveRecipients({ audience: normalizeAudience({ drivers: { classes: ['Lätt B'], includeWithdrawn: true } }), equipages, equipagePrivate });
  assert.deepEqual(withWithdrawn.recipients.map((r) => r.email), ['anna@example.se', 'bo@example.se']);
});

test('officials and judges are resolved from their private docs by role', () => {
  const officials = [
    { id: 'o1', data: { name: 'Olle', role: 'marathon' } },
    { id: 'o2', data: { name: 'Pia', role: 'precision' } },
    { id: 'o3', data: { name: 'Hinderdomare H', role: 'x', roleLabel: 'Hinderdomare' } },
    { id: 'o4', data: { name: 'Ingen', role: 'marathon' } }
  ];
  const officialsPrivate = new Map([['o1', { email: 'olle@example.se' }], ['o2', { email: 'pia@example.se' }], ['o3', { email: 'h@example.se' }]]);
  const judges = [{ id: 'j1', data: { name: 'Domare C' } }];
  const judgesPrivate = new Map([['j1', { email: 'domare@example.se' }]]);
  const input = { officials, officialsPrivate, judges, judgesPrivate };

  const marathon = resolveRecipients({ audience: normalizeAudience({ officials: { roles: ['marathon', 'hinderdomare'] } }), ...input });
  assert.deepEqual(marathon.recipients.map((r) => r.email), ['olle@example.se', 'h@example.se']);
  assert.deepEqual(marathon.withoutEmail, [{ type: 'official', id: 'o4' }]);

  const judgesOnly = resolveRecipients({ audience: normalizeAudience({ officials: { roles: ['domare'] } }), ...input });
  assert.deepEqual(judgesOnly.recipients.map((r) => r.email), ['domare@example.se']);

  const everyone = resolveRecipients({ audience: normalizeAudience({ officials: { all: true }, drivers: { startNumbers: ['3'] } }), equipages, equipagePrivate, ...input });
  assert.equal(everyone.recipients.length, 6);
});

test('explicit recipients from server producers are checked and merged', () => {
  assert.deepEqual(normalizeExplicitRecipients([{ email: ' A@b.se ', name: 'A\nB' }, 'a@b.se', { email: 'bad' }]),
    [{ email: 'a@b.se', name: 'A B', startNumbers: [] }]);
});

test('opt-outs drop information mail only', () => {
  const recipients = [{ email: 'a@b.se' }, { email: 'c@d.se' }];
  const optedOut = new Set([emailHash(' A@B.se ')]);
  assert.equal(emailHash('a@b.se').length, 40);
  assert.deepEqual(filterOptOuts(recipients, optedOut, false), { recipients: [{ email: 'c@d.se' }], skipped: 1 });
  assert.deepEqual(filterOptOuts(recipients, optedOut, true), { recipients, skipped: 0 });
  assert.equal(isEssentialMail({ kind: 'message', category: 'info' }), false);
  assert.equal(isEssentialMail({ kind: 'message', category: 'essential' }), true);
  for (const kind of ['startTimeChange', 'vetDecision', 'volunteerConfirmation', 'replyToVerification']) {
    assert.equal(isEssentialMail({ kind }), true, kind);
  }
});

test('daily caps are all or nothing and start over each Swedish day', () => {
  const day = mailDayKey(Date.UTC(2026, 9, 21, 21, 30)); // 23:30 in Stockholm
  assert.equal(day, '2026-10-21');
  assert.equal(mailDayKey(Date.UTC(2026, 9, 21, 22, 30)), '2026-10-22');
  const first = reserveDailyQuota(null, day, 300, 500, 1);
  assert.deepEqual(first, { allowed: true, remaining: 200, next: { dayKey: day, count: 300, updatedAt: 1 } });
  const tooMany = reserveDailyQuota(first.next, day, 201, 500, 2);
  assert.equal(tooMany.allowed, false);
  assert.equal(tooMany.remaining, 200);
  assert.equal(tooMany.next.count, 300);
  assert.equal(reserveDailyQuota(first.next, day, 200, 500).allowed, true);
  // A counter from yesterday does not count
  assert.equal(reserveDailyQuota({ dayKey: '2026-10-20', count: 500 }, day, 500, 500).allowed, true);
});

test('link tokens are signed, purpose-bound and expire', () => {
  const key = Buffer.from('k'.repeat(32));
  const token = signMailToken({ p: 'u', a: 'drivelive', c: 'comp1', h: 'abc', x: 2000 }, key);
  assert.deepEqual(verifyMailToken(token, key, 'u', 1000), { p: 'u', a: 'drivelive', c: 'comp1', h: 'abc', x: 2000 });
  assert.equal(verifyMailToken(token, key, 'u', 3000), null);
  assert.equal(verifyMailToken(token, key, 'r', 1000), null);
  assert.equal(verifyMailToken(token, Buffer.from('x'.repeat(32)), 'u', 1000), null);
  // A changed payload does not match the signature
  const [body, mac] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ p: 'u', a: 'drivelive', c: 'other', h: 'abc', x: 2000 })).toString('base64url');
  assert.equal(verifyMailToken(`${forged}.${mac}`, key, 'u', 1000), null);
  assert.equal(verifyMailToken(`${body}.${mac}.x`, key, 'u', 1000), null);
  assert.equal(verifyMailToken('garbage', key, 'u'), null);
  assert.equal(verifyMailToken(null, key, 'u'), null);
});

test('html from clients is cut down to simple formatting', () => {
  assert.equal(sanitizeMailHtml('<p onclick="x()">Hej <b>du</b><script>alert(1)</script></p>'), '<p>Hej <b>du</b></p>');
  assert.equal(sanitizeMailHtml('<a href="https://x.se/?a=1&amp;b=2" style="color:red">länk</a>'),
    '<a href="https://x.se/?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">länk</a>');
  assert.equal(sanitizeMailHtml('<a href="javascript:alert(1)">x</a>'), '<a>x</a>');
  assert.equal(sanitizeMailHtml('<a href="java\tscript:alert(1)">x</a>'), '<a>x</a>');
  assert.equal(sanitizeMailHtml('<a href=" jav&#x61;script:alert(1)">x</a>'), '<a>x</a>');
  assert.equal(sanitizeMailHtml('<img src=x onerror=alert(1)>text<iframe src="https://e"></iframe>'), 'text');
  assert.equal(sanitizeMailHtml('<style>p{}</style><!-- hidden --><div>kvar</div>'), 'kvar');
  // A '>' inside an attribute ends the tag: the rest is plain text
  assert.equal(sanitizeMailHtml('<a href="x>y" onclick=alert(1)>z'), '<a>y" onclick=alert(1)&gt;z');
  assert.equal(sanitizeMailHtml('a < b <br/> c'), 'a &lt; b <br> c');
  assert.equal(sanitizeMailHtml('<svg><script>x</script></svg>ok'), 'ok');
});

test('plain text becomes escaped html with links', () => {
  assert.equal(textToHtml('Hej <du>\nrad två\n\nSe https://drivelive.se/x?a=1&b=2.'),
    '<p>Hej &lt;du&gt;<br>rad två</p>\n<p>Se <a href="https://drivelive.se/x?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">https://drivelive.se/x?a=1&amp;b=2</a>.</p>');
});

test('mail content is validated; html is sanitized or made from the text', () => {
  const ok = validateMailContent({ subject: ' Hej\r\nBcc: x ', text: 'Text' });
  assert.equal(ok.subject, 'Hej Bcc: x');
  assert.equal(ok.html, '<p>Text</p>');
  assert.equal(validateMailContent({ subject: 's', text: 't', html: '<p>A<script>x</script></p>' }).html, '<p>A</p>');
  assert.throws(() => validateMailContent({ subject: '', text: 't' }), MailError);
  assert.throws(() => validateMailContent({ subject: 's', text: ' ' }), MailError);
  assert.throws(() => validateMailContent({ subject: 'x'.repeat(201), text: 't' }), MailError);
  assert.throws(() => validateMailContent({ subject: 's', text: 'x'.repeat(MAIL_LIMITS.textMax + 1) }), MailError);
  assert.deepEqual(normalizePersonalTexts([{ startNumber: 3, text: 'Dressyr 10:20' }, { startNumber: '3', text: 'Precision 14:00' }]),
    { 3: 'Dressyr 10:20\nPrecision 14:00' });
  assert.throws(() => normalizePersonalTexts([]), MailError);
  assert.throws(() => normalizePersonalTexts([{ startNumber: 'x/y', text: 'a' }]), MailError);
});

test('sender name, checked reply-to and the recipient message', () => {
  assert.equal(buildSenderName('Körklubben "Syd" <x@y>'), 'Körklubben Syd xy via DriveLive');
  assert.equal(buildSenderName(''), 'DriveLive');
  assert.equal(effectiveReplyTo({ replyTo: 'Info@K.se', replyToVerified: true, replyToVerifiedAddress: 'info@k.se' }), 'info@k.se');
  assert.equal(effectiveReplyTo({ replyTo: 'ny@k.se', replyToVerified: true, replyToVerifiedAddress: 'info@k.se' }), null);
  assert.equal(effectiveReplyTo({ replyTo: 'info@k.se' }), null);

  const mail = { kind: 'startTimeChange', subject: 'Ändrad starttid', text: 'Nya tider:', html: '', personalTexts: { 1: 'Dressyr 10:20', 4: 'Dressyr 11:00' } };
  const message = buildRecipientMessage(mail, { email: 'anna@example.se', name: 'Anna', startNumbers: ['1', '4'] },
    { competitionName: 'Vårtävlingen', signature: 'Hälsningar\nKörklubben', replyTo: null });
  assert.deepEqual(message.to, { email: 'anna@example.se', name: 'Anna' });
  assert.match(message.text, /Nya tider:\n\nDressyr 10:20\nDressyr 11:00\n\nHälsningar\nKörklubben/);
  assert.match(message.text, /Det går inte att svara/);
  assert.doesNotMatch(message.text, /Avsluta/);
  const info = buildRecipientMessage({ kind: 'message', subject: 'Info', text: 'Hej <alla>' }, { email: 'a@b.se' },
    { competitionName: 'T', replyTo: 'info@k.se', unsubscribeUrl: 'https://x/unsubscribeEmail?t=a.b' });
  assert.match(info.text, /Avsluta här: https:\/\/x\/unsubscribeEmail\?t=a\.b/);
  assert.match(info.html, /Hej &lt;alla&gt;/);
  assert.match(info.html, /<a href="https:\/\/x\/unsubscribeEmail\?t=a\.b">Avsluta utskicken<\/a>/);
  assert.doesNotMatch(info.text, /Det går inte att svara/);
});

test('Brevo payload: one recipient, display name, Reply-To, unsubscribe headers', () => {
  const payload = buildBrevoPayload({
    from: { email: 'noreply@drivelive.se', name: 'Körklubben via DriveLive' },
    replyTo: 'info@korklubben.se',
    to: { email: 'anna@example.se', name: 'Anna' },
    subject: 'Hej', text: 'Text', html: '<p>Text</p>',
    headers: { 'List-Unsubscribe': '<https://x>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    tags: ['message']
  });
  assert.deepEqual(payload, {
    sender: { email: 'noreply@drivelive.se', name: 'Körklubben via DriveLive' },
    to: [{ email: 'anna@example.se', name: 'Anna' }],
    subject: 'Hej',
    htmlContent: '<p>Text</p>',
    textContent: 'Text',
    replyTo: { email: 'info@korklubben.se' },
    headers: { 'List-Unsubscribe': '<https://x>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    tags: ['message']
  });
  const noReply = buildBrevoPayload({ from: { email: 'a@b.se', name: 'N' }, replyTo: null, to: { email: 'c@d.se', name: '' }, subject: 's', text: 't', html: 'h' });
  assert.equal('replyTo' in noReply, false);
  assert.equal('bcc' in noReply, false);
  assert.deepEqual(noReply.to, [{ email: 'c@d.se' }]);
});

test('Brevo provider: api-key header, success, retryable and permanent failures', async () => {
  const calls = [];
  const replies = [
    { ok: true, status: 201, json: async () => ({ messageId: '<id-1@brevo>' }) },
    { ok: false, status: 429, json: async () => ({ code: 'too_many_requests', message: 'slow down' }) },
    { ok: false, status: 400, json: async () => ({ code: 'invalid_parameter', message: 'bad email' }) }
  ];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const reply = replies.shift();
    if (!reply) throw new Error('offline');
    return reply;
  };
  const provider = createBrevoProvider({ apiKey: 'xkeysib-test', fetchImpl });
  const message = { from: { email: 'a@b.se', name: 'A' }, to: { email: 'c@d.se', name: '' }, subject: 's', text: 't', html: 'h' };
  assert.deepEqual(await provider.send(message), { ok: true, messageId: '<id-1@brevo>' });
  assert.equal(calls[0].url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(calls[0].init.headers['api-key'], 'xkeysib-test');
  assert.equal(JSON.parse(calls[0].init.body).to[0].email, 'c@d.se');
  assert.deepEqual(await provider.send(message), { ok: false, retryable: true, error: 'Brevo 429 too_many_requests: slow down' });
  assert.deepEqual(await provider.send(message), { ok: false, retryable: false, error: 'Brevo 400 invalid_parameter: bad email' });
  const offline = await provider.send(message);
  assert.equal(offline.ok, false);
  assert.equal(offline.retryable, true);
});

test('provider factory: nothing until configured and switched on', async () => {
  assert.equal(createMailProvider(null), null);
  assert.equal(createMailProvider({ provider: 'brevo', apiKey: 'k'.repeat(20), enabled: false }), null);
  assert.equal(createMailProvider({ provider: 'brevo', enabled: true }), null);
  assert.equal(createMailProvider({ provider: 'brevo', apiKey: 'k'.repeat(20), enabled: true }).name, 'brevo');
  const sink = [];
  const fake = createMailProvider({ provider: 'fake', enabled: true }, { fake: { sink } });
  const results = await sendAll(fake, [1, 2, 3].map((n) => ({ to: { email: `${n}@x.se` } })), 2);
  assert.equal(results.every((r) => r.ok), true);
  assert.deepEqual(sink.map((m) => m.to.email), ['1@x.se', '2@x.se', '3@x.se']);
  const failing = createFakeProvider({ fail: (m) => (m.to.email === 'bad@x.se' ? 'permanent' : null) });
  assert.equal((await failing.send({ to: { email: 'bad@x.se' } })).retryable, false);
});

test('send results: retry with backoff, then partial or failed', () => {
  const r = (email, ok, retryable = false) => ({ recipient: { email }, ok, retryable, messageId: ok ? `id-${email}` : null, error: ok ? null : 'fel' });
  const first = summarizeSendResults([r('a', true), r('b', false, true), r('c', false)], { attempts: 1 });
  assert.equal(first.status, 'queued');
  assert.equal(first.retryDelayMs, 5 * 60 * 1000);
  assert.deepEqual(first.retryRecipients, [{ email: 'b' }]);
  assert.equal(first.failed, 1);
  assert.deepEqual(first.messageIds, ['id-a']);
  const last = summarizeSendResults([r('b', false, true)], { attempts: MAIL_LIMITS.maxAttempts, earlierSent: 1 });
  assert.equal(last.status, 'partial');
  assert.equal(last.failed, 1);
  assert.equal(summarizeSendResults([r('a', false)], { attempts: 1 }).status, 'failed');
  assert.equal(summarizeSendResults([r('a', true)], { attempts: 1 }).status, 'sent');
});

test('provider settings: API key write-only, limits checked, status without the key', () => {
  const settings = normalizeProviderSettings({ provider: 'brevo', apiKey: 'xkeysib-1234567890', fromAddress: 'NoReply@DriveLive.se', enabled: true });
  assert.deepEqual(settings, {
    provider: 'brevo', apiKey: 'xkeysib-1234567890', fromAddress: 'noreply@drivelive.se', fromDomain: 'drivelive.se',
    dailyLimit: 300, competitionDailyLimit: 500, enabled: true, linkBaseUrl: ''
  });
  // Left out: the key is kept; cleared on request
  assert.equal(normalizeProviderSettings({ dailyLimit: 1000 }, settings).apiKey, 'xkeysib-1234567890');
  assert.equal(normalizeProviderSettings({ dailyLimit: 1000 }, settings).dailyLimit, 1000);
  assert.equal(normalizeProviderSettings({ clearApiKey: true }, settings).apiKey, '');
  assert.throws(() => normalizeProviderSettings({ provider: 'fake', fromAddress: 'a@b.se' }), MailError);
  assert.equal(normalizeProviderSettings({ provider: 'fake', fromAddress: 'a@b.se' }, {}, { allowFake: true }).provider, 'fake');
  assert.throws(() => normalizeProviderSettings({ provider: 'brevo', fromAddress: 'a@b.se', fromDomain: 'c.se' }), MailError);
  assert.throws(() => normalizeProviderSettings({ provider: 'brevo', fromAddress: 'a@b.se', dailyLimit: 0 }), MailError);
  assert.throws(() => normalizeProviderSettings({ provider: 'brevo', fromAddress: 'a@b.se', apiKey: 'short' }), MailError);
  assert.throws(() => normalizeProviderSettings({ provider: 'brevo', fromAddress: 'a@b.se', linkBaseUrl: 'http://x.se' }), MailError);

  const status = providerStatus(settings);
  assert.equal(JSON.stringify(status).includes('xkeysib'), false);
  assert.equal(status.configured, true);
  assert.equal(status.enabled, true);
  assert.deepEqual(providerStatus(null).configured, false);
  assert.equal(providerStatus({ ...settings, apiKey: '' }).configured, false);
});

test('link pages escape their text and post the token', () => {
  const html = renderMailPage({ title: 'Bekräfta <x>', message: 'a@b.se "x"', form: { action: '', token: 'a.b"c', button: 'OK' } });
  assert.match(html, /Bekräfta &lt;x&gt;/);
  assert.match(html, /a@b\.se &quot;x&quot;/);
  assert.match(html, /<form method="post" action=""><input type="hidden" name="t" value="a\.b&quot;c">/);
});

test('the retention job removes the mail collections', () => {
  for (const name of ['mailQueue', 'mailLog', 'mailOptOuts']) {
    assert.ok(RETENTION_PRIVATE_TREE_COLLECTIONS.includes(name), name);
  }
});
