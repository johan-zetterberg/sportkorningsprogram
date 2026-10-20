import test from 'node:test';
import assert from 'node:assert/strict';

import { hasRoleAccess, mergeUserRoles } from '../js/utils/roleAccess.js';
import {
    createToastQueue, isRouteBoundToast, normalizeAlertOptions, normalizeAlertType, shouldUseToast, toastTimeout
} from '../js/ui/toastQueue.js';
import {
    competitionDateRange, competitionTimeStatus, matchesCompetitionSearch, sortCompetitionsForVisitors
} from '../js/pages/shared/hubCompetitionUtils.js';
import {
    assignmentKind, buildOfficialTasks, fillTemplate, findMyRecords, mergeObstacleLocations
} from '../js/utils/officialTaskUtils.js';

// --- Roles: global and competition roles together ---

test('a global admin keeps admin access when they also hold a competition role', () => {
    const roles = mergeUserRoles({ role: 'admin', compRoles: ['dressage'] });
    assert.deepEqual(roles.sort(), ['admin', 'dressage']);
    assert.equal(hasRoleAccess(roles, ['admin']), true);
    assert.equal(hasRoleAccess(roles, ['dressage', 'domare', 'admin']), true);
});

test('superadmin from the roles list reaches every page', () => {
    const roles = mergeUserRoles({ role: 'publik', roles: ['superadmin'], compRoles: ['marathon'] });
    assert.ok(roles.includes('superadmin'));
    assert.equal(hasRoleAccess(roles, ['admin']), true);
    assert.equal(hasRoleAccess(roles, ['vet']), true);
});

test('competition roles alone, and nobody signed in', () => {
    assert.deepEqual(mergeUserRoles(null), ['publik']);
    assert.deepEqual(mergeUserRoles({ role: 'publik', compRoles: [] }), ['publik']);
    const vet = mergeUserRoles({ role: 'publik', compRoles: ['vet'] });
    assert.deepEqual(vet, ['vet']);
    assert.equal(hasRoleAccess(vet, ['funktionar', 'domare', 'admin']), false);
    assert.equal(hasRoleAccess(vet, ['admin', 'vet']), true);
    assert.equal(hasRoleAccess(['marathon'], ['funktionar']), true);
    assert.equal(hasRoleAccess(['publik'], ['marathon', 'domare', 'admin']), false);
});

// --- Feedback: toast or modal, and the toast queue ---

test('alert types: successes, info and queued saves are toasts; errors and warnings are modal', () => {
    assert.equal(normalizeAlertType(true), 'success');
    assert.equal(normalizeAlertType(undefined), 'success');
    assert.equal(normalizeAlertType(false), 'error');
    assert.equal(normalizeAlertType('error'), 'error');
    assert.equal(normalizeAlertType('offline'), 'queued');
    assert.equal(normalizeAlertType('info'), 'info');
    assert.equal(normalizeAlertType('warning'), 'warning');
    assert.equal(shouldUseToast('success'), true);
    assert.equal(shouldUseToast('queued'), true);
    assert.equal(shouldUseToast('info'), true);
    assert.equal(shouldUseToast('error'), false);
    assert.equal(shouldUseToast('warning'), false);
    assert.equal(shouldUseToast('success', { modal: true }), false);
    assert.deepEqual(normalizeAlertOptions(12000), { timeout: 12000 });
    assert.deepEqual(normalizeAlertOptions({ modal: true }), { modal: true });
    assert.deepEqual(normalizeAlertOptions(null), {});
});

test('toast timeout grows with the text, within limits', () => {
    assert.equal(toastTimeout('Sparad', 'success'), 4000);
    assert.equal(toastTimeout('x'.repeat(1000), 'success'), 10000);
    assert.equal(toastTimeout('Sparad', 'queued'), 6000);
    assert.equal(toastTimeout('Sparad', 'success', 2500), 2500);
});

test('toast queue: a repeated message replaces the old one, the oldest goes above max', () => {
    const queue = createToastQueue({ max: 2 });
    const a = queue.push({ type: 'success', message: 'Hinder 3 sparat' });
    const b = queue.push({ type: 'success', message: 'Hinder 3 sparat' });
    assert.deepEqual(b.removed.map(i => i.id), [a.item.id]);
    assert.equal(queue.list().length, 1);
    queue.push({ type: 'info', message: 'Slutet av listan' });
    const c = queue.push({ type: 'queued', message: 'I kö' });
    assert.deepEqual(c.removed.map(i => i.id), [b.item.id]);
    assert.deepEqual(queue.list().map(i => i.type), ['info', 'queued']);
    // A route change takes the page notices, not the save results
    const gone = queue.clear(isRouteBoundToast);
    assert.deepEqual(gone.map(i => i.type), ['info']);
    assert.deepEqual(queue.list().map(i => i.type), ['queued']);
    assert.equal(queue.remove(c.item.id).id, c.item.id);
    assert.equal(queue.remove(999), null);
});

// --- Public hub ---

test('competition dates from the stored formats', () => {
    assert.deepEqual(competitionDateRange({ dates: '2026-05-01 – 2026-05-03 ' }), { start: '2026-05-01', end: '2026-05-03' });
    assert.deepEqual(competitionDateRange({ dates: '2026-05-01' }), { start: '2026-05-01', end: '2026-05-01' });
    assert.deepEqual(competitionDateRange({ dates: { start: '2026-06-02', end: '2026-06-04' } }), { start: '2026-06-02', end: '2026-06-04' });
    assert.deepEqual(competitionDateRange({ dates: 'snart' }), { start: '', end: '' });
});

test('status: live, today (field mode), upcoming, finished', () => {
    const today = '2026-05-02';
    assert.equal(competitionTimeStatus({ dates: '2026-05-01 – 2026-05-03' }, today), 'live');
    assert.equal(competitionTimeStatus({ dates: '2026-05-02', competitionMode: 'field' }, today), 'today');
    assert.equal(competitionTimeStatus({ dates: '2026-06-01' }, today), 'upcoming');
    assert.equal(competitionTimeStatus({ dates: '2026-04-01' }, today), 'finished');
    assert.equal(competitionTimeStatus({ dates: '2026-05-02', archived: true }, today), 'finished');
    assert.equal(competitionTimeStatus({}, today), 'unknown');
});

test('visitors see competitions on now first, then the soonest, then the latest finished', () => {
    const today = '2026-05-02';
    const comps = [
        { id: 'old', dates: '2026-01-01' },
        { id: 'later', dates: '2026-09-01' },
        { id: 'live', dates: '2026-05-01 – 2026-05-03' },
        { id: 'soon', dates: '2026-06-01' },
        { id: 'older', dates: '2025-01-01' }
    ];
    assert.deepEqual(sortCompetitionsForVisitors(comps, today).map(e => e.comp.id), ['live', 'soon', 'later', 'old', 'older']);
    assert.equal(matchesCompetitionSearch({ name: 'Flyinge Indoor', place: 'Flyinge' }, 'flyinge'), true);
    assert.equal(matchesCompetitionSearch({ name: 'Flyinge Indoor' }, 'strömsholm'), false);
    assert.equal(matchesCompetitionSearch({ name: 'X' }, ''), true);
});

// --- Official portal: "Din uppgift" ---

test('the real obstacle list replaces the fixed Hinder 1-8 places', () => {
    const stored = [
        { id: 'SECRETARIAT', label: 'Sekretariat', type: 'section' },
        ...[1, 2, 3, 4, 5, 6, 7, 8].map(n => ({ id: `OBSTACLE_${n}`, label: `Hinder ${n}`, type: 'obstacle' })),
        { id: 'CUSTOM_1', label: 'Egen', type: 'obstacle', isCustom: true }
    ];
    const obstacles = [{ number: 1, name: 'Vattnet' }, { number: 2 }, { number: 3 }];
    const assignments = [{ locationId: 'OBSTACLE_7' }];
    const merged = mergeObstacleLocations(stored, obstacles, assignments);
    const obstacleIds = merged.filter(l => l.type === 'obstacle').map(l => l.id);
    assert.deepEqual(obstacleIds, ['OBSTACLE_1', 'OBSTACLE_2', 'OBSTACLE_3', 'OBSTACLE_7', 'CUSTOM_1']);
    assert.equal(merged.find(l => l.id === 'OBSTACLE_1').label, 'Hinder 1 – Vattnet');
    // No obstacles yet: the stored places as they are
    assert.equal(mergeObstacleLocations(stored, [], []).length, stored.length);
});

test('an official gets their plan entries with a page to open, then judge and role tasks', () => {
    const user = { uid: 'u1', email: 'Anna@Example.se' };
    const officials = findMyRecords([{ id: 'o1', email: 'anna@example.se' }, { id: 'o2', email: 'b@x.se' }], user);
    assert.deepEqual(officials.map(o => o.id), ['o1']);
    const judges = findMyRecords([{ id: 'j1', email: 'anna@example.se', roles: [{ discipline: 'dressage', position: 'c' }] }], user);
    const tasks = buildOfficialTasks({
        roles: ['dressage', 'marathon', 'speaker'],
        officials,
        judges,
        assignments: [
            { id: 'a1', officialId: 'o1', role: 'Hinderdomare', locationId: 'OBSTACLE_5', startTime: '09:00', endTime: '12:00', dateString: '2026-05-02', meetingPoint: 'Tältet' },
            { id: 'a2', officialId: 'o2', role: 'Hinderdomare', locationId: 'OBSTACLE_6' }
        ],
        locations: [{ id: 'OBSTACLE_5', label: 'Hinder 5', type: 'obstacle' }],
        obstacles: [{ number: 5, name: 'Bron' }]
    });
    assert.deepEqual(tasks.map(t => t.titleKey), [
        'official_task_obstacle', 'official_task_dressage_judge', 'official_task_speaker'
    ]);
    const [obstacle, judge] = tasks;
    assert.equal(obstacle.route, '#maraton-input');
    assert.equal(obstacle.obstacleNumber, 5);
    assert.equal(obstacle.titleParams.name, 'Bron');
    assert.equal(obstacle.time, '09:00–12:00');
    assert.equal(obstacle.meetingPoint, 'Tältet');
    assert.equal(judge.route, '#dressyr-input');
    assert.equal(fillTemplate('Domare {position}', judge.titleParams), 'Domare C');
});

test('assignment kinds from place and role', () => {
    assert.equal(assignmentKind({ role: 'Tidtagare (Start/Mål)', locationType: 'start_finish_m' }), 'stages');
    assert.equal(assignmentKind({ role: 'Observatör', locationType: 'section_m_custom' }), 'observer');
    assert.equal(assignmentKind({ role: 'Domare', locationType: 'course_p' }), 'precision');
    assert.equal(assignmentKind({ role: 'Parkering', locationType: 'dressage_func' }), 'general');
    assert.equal(assignmentKind({ role: 'Protokollskrivare', locationType: 'dressage_func' }), 'dressage');
});
