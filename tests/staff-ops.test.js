import test from 'node:test';
import assert from 'node:assert/strict';

import {
  correctionsForIncident,
  filterAuditEntries,
  incidentsToCsv,
  matchIncidentForReference,
  nextIncidentNumber,
  validateIncidentEntry
} from '../js/services/incidentUtils.js';
import {
  decideResultStatus,
  requiredForDiscipline,
  requiredForTotalRows,
  resultStatusKeys
} from '../js/pdf/resultStatusUtils.js';
import { DICTIONARY } from '../js/utils/i18n.js';
import {
  appendDeclarationChange,
  buildDeclarationChangeEntry,
  buildDeclarationNotice,
  diffDeclaration
} from '../functions/src/declarationUtils.js';
import {
  buildVetStrikeDecisionPatch,
  buildVetStrikeIncident,
  gateVetStrikePayload,
  vetStrikeStateOf,
  vetStrikeTransition
} from '../js/services/vetDecisionUtils.js';
import { buildVetStatusUpdate } from '../js/pages/shared/vetCheckUtils.js';
import { buildVetDecisionDriverMessage } from '../functions/src/vetDecisionNotify.js';
import {
  buildHeartbeatDoc,
  contextFromHash,
  generateDeviceId,
  heartbeatFreshness,
  isFieldPage,
  isValidDeviceId,
  summarizeDevices
} from '../js/services/deviceHeartbeatUtils.js';
import { buildEmergencyCard, splitEmergencyInfo, telHref } from '../js/services/emergencyInfoUtils.js';
import { normalizeJoinRoles, resolveJoinRoleForPin, secretFieldForRole } from '../functions/src/adminJoin.js';
import { hasRoleAccess } from '../js/utils/roleAccess.js';
import { equipageWriteAffectsResults } from '../functions/src/triggerFilters.js';

// --- Incident log ---

test('validateIncidentEntry: needs a type and a description; decided entries need the decision', () => {
  const ok = validateIncidentEntry({ type: 'protest', description: '  Protest mot hinder 3  ', startNumber: '#12', discipline: 'marathon' });
  assert.equal(ok.ok, true);
  assert.equal(ok.entry.description, 'Protest mot hinder 3');
  assert.equal(ok.entry.startNumber, '12');
  assert.equal(ok.entry.status, 'open');

  assert.deepEqual(validateIncidentEntry({ type: 'nope', description: 'x' }).errors, ['incident_error_type']);
  assert.ok(validateIncidentEntry({ type: 'protest', description: '' }).errors.includes('incident_error_description'));
  assert.ok(validateIncidentEntry({ type: 'protest', description: 'x', status: 'decided' }).errors.includes('incident_error_decision'));
  assert.equal(validateIncidentEntry({ type: 'protest', description: 'x', status: 'decided', decision: 'Avslås' }).ok, true);
  assert.ok(validateIncidentEntry({ type: 'other', description: 'x', startNumber: '1 2' }).errors.includes('incident_error_start_number'));
  assert.ok(validateIncidentEntry({ type: 'other', description: 'x'.repeat(4001) }).errors.includes('incident_error_too_long'));
  assert.ok(validateIncidentEntry({ type: 'other', description: 'x', discipline: 'polo' }).errors.includes('incident_error_discipline'));
});

test('nextIncidentNumber continues after the highest number', () => {
  assert.equal(nextIncidentNumber([]), 1);
  assert.equal(nextIncidentNumber([{ number: 2 }, { number: 7 }, { number: 'x' }]), 8);
});

test('corrections link to the entry their reference names', () => {
  const incidents = [
    { id: 'a', number: 3, type: 'protest' },
    { id: 'b', number: 3, type: 'groundJury' },
    { id: 'c', number: 4, type: 'incident' }
  ];
  assert.equal(matchIncidentForReference(incidents, { type: 'protest', value: 'Nr 3' })?.id, 'a');
  assert.equal(matchIncidentForReference(incidents, { type: 'groundJury', value: '#3' })?.id, 'b');
  assert.equal(matchIncidentForReference(incidents, { type: 'protest', value: '4' })?.id, 'c', 'number only as fallback');
  assert.equal(matchIncidentForReference(incidents, { type: 'judgeRequest', value: '3' }), null);
  assert.equal(matchIncidentForReference(incidents, { type: 'protest', value: '' }), null);

  const audit = [
    { id: 'x1', discipline: 'marathon', startNumber: '12', reference: { type: 'protest', value: '3' } },
    { id: 'x2', discipline: 'precision', startNumber: '7', reference: null },
    { id: 'x3', discipline: 'marathon', startNumber: '7', reference: { type: 'groundJury', value: '3' } }
  ];
  assert.deepEqual(correctionsForIncident(audit, incidents[0], incidents).map(e => e.id), ['x1']);
  assert.deepEqual(filterAuditEntries(audit, { discipline: 'marathon' }).map(e => e.id), ['x1', 'x3']);
  assert.deepEqual(filterAuditEntries(audit, { startNumber: '#7' }).map(e => e.id), ['x2', 'x3']);
});

test('incidentsToCsv: number order, labels, quoting, no formulas', () => {
  const csv = incidentsToCsv([
    { number: 2, type: 'groundJury', status: 'decided', description: 'Rad;ett\n"två"', decision: '=SUM(A1)', startNumber: '5' },
    { number: 1, type: 'protest', status: 'open', description: 'Första', discipline: 'dressage' }
  ]);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'Nr;Typ;Mottagen;Startnr;Gren;Hinder/moment;Beskrivning;Beslut;Beslutat av;Status');
  assert.match(lines[1], /^1;Protest;;;Dressyr;;Första;;;Öppen$/);
  assert.ok(csv.includes('"Rad;ett\n""två"""'));
  assert.ok(csv.includes("'=SUM(A1)"));
  assert.match(incidentsToCsv([], { lang: 'en' }), /^No\.;Type;Received/);
});

// --- Result PDF status ---

test('decideResultStatus: official only when every result is finalized or archived', () => {
  const required = requiredForDiscipline('dressage', ['1', 2, '']);
  assert.equal(required.length, 2);
  assert.equal(decideResultStatus({ required, finalized: { dressage: new Set(['1']) } }), 'provisional');
  assert.equal(decideResultStatus({ required, finalized: { dressage: new Set(['1', '2']) } }), 'official');
  assert.equal(decideResultStatus({ required, finalized: { dressage: ['1', '2'] } }), 'official');
  assert.equal(decideResultStatus({ required: [], finalized: {} }), 'provisional');
  assert.equal(decideResultStatus({ archived: true, required, finalized: {} }), 'official');
  assert.equal(decideResultStatus({ override: 'official', required, finalized: {} }), 'official');
  assert.equal(decideResultStatus({ archived: true, override: 'provisional' }), 'provisional');
});

test('requiredForTotalRows: every phase of every row, also phases not started; withdrawn left out', () => {
  const rows = [
    { startNumber: 1, className: 'A', dressage: { penalty: 40 }, marathon: { totalPenalty: 80 } },
    { startNumber: 2, className: 'A', dressage: { penalty: 45 } },
    { startNumber: 3, className: 'B', dressage: { penalty: 50 } },
    { startNumber: 4, className: 'A', status: 'struken', dressage: { penalty: 1 } }
  ];
  const required = requiredForTotalRows(rows).map(r => `${r.discipline}:${r.startNumber}`).sort();
  assert.deepEqual(required, [
    'dressage:1', 'dressage:2', 'dressage:3',
    'marathon:1', 'marathon:2', 'marathon:3',
    'precision:1', 'precision:2', 'precision:3'
  ]);
  // A competition without precision
  assert.equal(requiredForTotalRows(rows, { disciplines: ['dressage', 'marathon'] }).length, 6);
});

test('result status labels exist in both languages', () => {
  for (const status of ['official', 'provisional']) {
    const keys = resultStatusKeys(status);
    for (const key of [keys.title, keys.printed]) assert.ok(DICTIONARY[key]?.sv && DICTIONARY[key]?.en, key);
  }
  assert.equal(DICTIONARY.pdf_status_provisional.sv, 'PRELIMINÄRT RESULTAT');
  assert.equal(DICTIONARY.pdf_status_official.en, 'OFFICIAL RESULTS');
  assert.equal(resultStatusKeys('official').signature, 'pdf_ground_jury_president');
  assert.equal(resultStatusKeys('provisional').signature, null);
});

// --- Driver declaration changes ---

test('diffDeclaration: text fields and horses added, removed, renamed', () => {
  const before = { groom: 'Anna', carriage: 'Maraton', clubName: 'K', horses: [{ name: 'Blixt', id: 'SE1' }, { name: 'Storm' }] };
  const after = { groom: 'Bo', carriage: 'Maraton', clubName: 'K', horses: [{ name: 'Blixten', id: 'SE1' }, { name: 'Ny' }] };
  const texts = diffDeclaration(before, after).map(c => c.text);
  assert.deepEqual(texts, ['Groom: Anna → Bo', 'Häst omdöpt: Blixt → Blixten', 'Häst tillagd: Ny', 'Häst borttagen: Storm']);
  assert.deepEqual(diffDeclaration(before, before), []);
});

test('buildDeclarationChangeEntry flags a horse added after the vet inspection', () => {
  const inspected = { horses: [{ name: 'Blixt' }], vetInspection_initial: { status: 'besiktigad', horses: { Blixt: { status: 'besiktigad' } } } };
  const entry = buildDeclarationChangeEntry(inspected, { horses: [{ name: 'Blixt' }, { name: 'Ny' }] }, 1000);
  assert.equal(entry.newHorseAfterVet, true);
  assert.equal(entry.at, 1000);
  assert.equal(buildDeclarationChangeEntry({ horses: [] }, { horses: [{ name: 'Ny' }] }).newHorseAfterVet, false);
  assert.equal(buildDeclarationChangeEntry(inspected, { horses: [{ name: 'Blixt' }] }), null);

  const list = Array.from({ length: 25 }, (_, i) => ({ at: i }));
  const capped = appendDeclarationChange(list, entry);
  assert.equal(capped.length, 20);
  assert.equal(capped.at(-1), entry);

  const notice = buildDeclarationNotice(entry, { startNumber: '12', driverName: 'Kim' });
  assert.equal(notice.kind, 'declarationChange');
  assert.match(notice.summary, /^#12 Kim: Häst tillagd: Ny/);
  assert.equal(notice.newHorseAfterVet, true);
});

test('declaration change fields do not trigger a recalculation', () => {
  const before = { startNumber: 1, groom: 'A' };
  assert.equal(equipageWriteAffectsResults(before, { ...before, declarationChanges: [{ at: 1 }], declarationChangedAt: 5, vetStrikePending: { phase: 'initial' } }), false);
});

// --- Vet strike for the ground jury ---

test('vetStrikeTransition: pending until the ground jury confirms or overturns', () => {
  assert.equal(vetStrikeTransition('none', 'vetStrike'), 'pending');
  assert.equal(vetStrikeTransition('pending', 'confirm'), 'confirmed');
  assert.equal(vetStrikeTransition('pending', 'overturn'), 'overturned');
  assert.equal(vetStrikeTransition('pending', 'vetClear'), 'none');
  assert.equal(vetStrikeTransition('none', 'confirm'), 'none');
  assert.equal(vetStrikeTransition('confirmed', 'vetStrike'), 'confirmed');
  assert.equal(vetStrikeTransition('overturned', 'vetStrike'), 'pending');
});

test('gateVetStrikePayload: the vet never writes status struken; the strike waits', () => {
  const equipage = { startNumber: 5, status: 'anmäld', horses: [{ name: 'A', id: 'H1' }] };
  const { payload } = buildVetStatusUpdate(equipage, 'initial', { status: 'struken', nowIso: 'T' });
  assert.equal(payload.status, 'struken');
  const gated = gateVetStrikePayload(payload, { equipage, phase: 'initial', uid: 'vet', nowIso: 'T', incidentId: 'inc1' });
  assert.equal(gated.strike, true);
  assert.equal('status' in gated.payload, false);
  assert.deepEqual(gated.payload.vetStrikePending, { phase: 'initial', at: 'T', by: 'vet', horseKeys: [], incidentId: 'inc1' });
  assert.equal(gated.payload.vetInspection_initial.status, 'struken', 'the vet result is recorded');

  // Already waiting: no second report
  const again = gateVetStrikePayload(payload, { equipage: { ...equipage, vetStrikePending: { phase: 'initial' } }, phase: 'initial' });
  assert.equal(again.strike, false);
  // Approved again before the decision: the pending flag goes
  const approved = buildVetStatusUpdate(equipage, 'initial', { status: 'besiktigad' }).payload;
  const cleared = gateVetStrikePayload(approved, { equipage: { ...equipage, vetStrikePending: { phase: 'initial' } }, phase: 'initial' });
  assert.equal(cleared.payload.vetStrikePending, null);
  assert.equal(cleared.payload.status, 'besiktigad');
  // Rest area: the safety flag stays, the strike waits too
  const rest = buildVetStatusUpdate(equipage, 'restArea', { status: 'struken', horseKeys: ['H1'] }).payload;
  const restGated = gateVetStrikePayload(rest, { equipage, phase: 'restArea', horseKeys: ['H1'] });
  assert.equal(restGated.payload.vetUnfitStageB, true);
  assert.equal(restGated.strike, true);
  // A confirmed (withdrawn) equipage: nothing new
  assert.equal(gateVetStrikePayload(payload, { equipage: { ...equipage, status: 'struken' }, phase: 'initial' }).strike, false);
});

test('buildVetStrikeDecisionPatch: confirm strikes, overturn clears; nothing when not pending', () => {
  const pending = { startNumber: 5, vetStrikePending: { phase: 'initial', incidentId: 'i1' } };
  assert.equal(vetStrikeStateOf(pending), 'pending');
  const confirm = buildVetStrikeDecisionPatch(pending, 'confirm', { uid: 'td1', name: 'TD', nowIso: 'T' });
  assert.equal(confirm.status, 'struken');
  assert.equal(confirm.vetStrikePending, null);
  assert.equal(confirm.vetStrikeDecision.outcome, 'confirmed');
  const overturn = buildVetStrikeDecisionPatch(pending, 'overturn', { nowIso: 'T' });
  assert.equal('status' in overturn, false);
  assert.equal(overturn.vetStrikeDecision.outcome, 'overturned');
  assert.equal(vetStrikeStateOf({ vetStrikeDecision: overturn.vetStrikeDecision }), 'overturned');
  assert.equal(buildVetStrikeDecisionPatch({ startNumber: 5 }, 'confirm'), null);
  assert.equal(Object.keys(confirm.vetStrikeDecision).length <= 10, true, 'fits the rules map size');
});

test('buildVetStrikeIncident is a valid open vet entry', () => {
  const entry = buildVetStrikeIncident({ startNumber: 5, driverName: 'Kim', phase: 'restArea', phaseLabel: 'Vilobox', horseNames: ['A'], note: 'Hög puls' });
  assert.equal(entry.type, 'vet');
  assert.equal(entry.source, 'vet');
  assert.equal(entry.vetStrike.outcome, 'pending');
  assert.match(entry.description, /domarkollegiets ordförande/);
  const { vetStrike, source, ...form } = entry;
  assert.equal(validateIncidentEntry(form).ok, true);
});

test('the driver hears of the vet decision when reported and when decided', () => {
  const created = { type: 'vet', startNumber: '5', vetStrike: { phase: 'initial', outcome: 'pending' } };
  const first = buildVetDecisionDriverMessage(null, created);
  assert.deepEqual(first.audience, { public: false, drivers: true });
  assert.deepEqual(first.targetStartNumbers, ['5']);
  assert.match(first.body, /domarkollegiets ordförande/);
  assert.equal(buildVetDecisionDriverMessage(created, { ...created, decision: 'x' }), null, 'no message without a decision');
  const confirmed = buildVetDecisionDriverMessage(created, { ...created, vetStrike: { outcome: 'confirmed' } });
  assert.match(confirmed.body, /struket/);
  const overturned = buildVetDecisionDriverMessage(created, { ...created, vetStrike: { outcome: 'overturned' } });
  assert.equal(overturned.type, 'info');
  assert.equal(buildVetDecisionDriverMessage(null, { type: 'protest', startNumber: '5' }), null);
  assert.equal(buildVetDecisionDriverMessage(null, { type: 'vet', startNumber: '' }), null);
});

// --- Field device heartbeat ---

test('heartbeatFreshness: green under 2 min, amber under 10, red after', () => {
  const now = 1_000_000_000;
  assert.equal(heartbeatFreshness(now - 30_000, now), 'green');
  assert.equal(heartbeatFreshness(now - 3 * 60_000, now), 'amber');
  assert.equal(heartbeatFreshness(now - 11 * 60_000, now), 'red');
  assert.equal(heartbeatFreshness(null, now), 'red');
  const rows = summarizeDevices([{ id: 'a', lastSeenMs: now - 700_000 }, { id: 'b', lastSeenMs: now - 1000 }], now);
  assert.deepEqual(rows.map(r => [r.id, r.freshness]), [['b', 'green'], ['a', 'red']]);
});

test('heartbeat documents are small and match the rules shape', () => {
  const id = generateDeviceId((arr) => arr.fill(7));
  assert.equal(isValidDeviceId(id), true);
  assert.equal(isValidDeviceId('bad/id'), false);
  const doc = buildHeartbeatDoc({ deviceId: id, uid: 'u1', page: 'maraton-input', obstacle: 3, queueSize: 2.7, clockSyncedAt: 123.4 });
  assert.deepEqual(Object.keys(doc).sort(), ['appVersion', 'clockSyncedAt', 'deviceId', 'obstacle', 'online', 'page', 'queueSize', 'role', 'startNumber', 'uid', 'userName']);
  assert.equal(doc.queueSize, 2);
  assert.equal(doc.obstacle, '3');
  assert.equal(doc.clockSyncedAt, 123);
  assert.equal(buildHeartbeatDoc({ queueSize: -1 }).queueSize, 0);
  assert.equal(isFieldPage('vet-check'), true);
  assert.equal(isFieldPage('hub'), false);
  assert.deepEqual(contextFromHash('#maraton-input?obstacle=4&sn=12'), { startNumber: '12', obstacle: '4' });
});

// --- Emergency info ---

test('emergency info: phones of named persons only in the private part', () => {
  const { publicDoc, privateDoc } = splitEmergencyInfo({
    emergencyNumber: '', firstAidPlace: 'Sekretariatet', firstAidPhone: '010-123 45',
    vetName: 'Dr Ek', vetPhone: '070-111 22 33<script>', farrierName: 'Hans', farrierPhone: ''
  });
  assert.equal(publicDoc.emergencyNumber, '112');
  assert.equal(publicDoc.vetName, 'Dr Ek');
  assert.equal('vetPhone' in publicDoc, false);
  assert.equal(privateDoc.vetPhone, '070-111 22 33');
  assert.deepEqual(Object.keys(privateDoc).sort(), ['chiefStewardPhone', 'farrierPhone', 'safetyOfficerPhone', 'vetPhone']);

  const publicCard = buildEmergencyCard(publicDoc, null);
  assert.equal(publicCard.showsPrivate, false);
  assert.deepEqual(publicCard.persons.map(p => [p.key, p.phone]), [['vet', ''], ['farrier', '']]);
  const staffCard = buildEmergencyCard(publicDoc, privateDoc);
  assert.equal(staffCard.persons[0].phone, '070-111 22 33');
  assert.equal(telHref('070-111 22 33'), 'tel:0701112233');
  assert.equal(telHref('+46 70+1'), 'tel:+46701');
  assert.equal(telHref('saknas'), '');
});

// --- TD role ---

test('td: joinable with its own role code, official pages but no input pages', () => {
  assert.equal(secretFieldForRole('td'), 'accessCode_td');
  assert.deepEqual(normalizeJoinRoles(['td', 'bogus']), ['td']);
  assert.equal(resolveJoinRoleForPin('tdke-yabc-de', { accessCode_td: 'TDKEYABCDE' }), 'td');
  assert.equal(hasRoleAccess(['td'], ['admin', 'td']), true, 'incidents, secretariat');
  assert.equal(hasRoleAccess(['td'], ['funktionar']), true, 'official pages');
  assert.equal(hasRoleAccess(['td'], ['marathon', 'domare', 'admin']), false, 'no obstacle input');
});
