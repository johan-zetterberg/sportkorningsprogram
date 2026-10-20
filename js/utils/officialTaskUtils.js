// The official portal's "Din uppgift": what an official is to do in a
// competition, from the admin's assignment plan (assignments collection,
// js/pages/admin/admin-officials.js), their judge roles and their system
// roles (dressage, marathon, ...). Pure: the page formats the keys.

// One icon per kind of task, the same everywhere in the portal
export const TASK_ICONS = Object.freeze({
    dressage: '🎩',
    obstacle: '🚧',
    marathon: '🚧',
    stages: '🚩',
    observer: '👁️',
    precision: '🎯',
    carriageWidth: '📏',
    vet: '🩺',
    speaker: '🎤',
    admin: '🛠️',
    secretariat: '🗂️',
    general: '📋'
});

const ROUTES = Object.freeze({
    dressage: '#dressyr-input',
    obstacle: '#maraton-input',
    marathon: '#maraton-input',
    stages: '#maraton-stages',
    observer: '#observator-input',
    precision: '#precision-input',
    carriageWidth: '#vagnbredd',
    vet: '#vet-check',
    speaker: '#speaker',
    admin: '#admin',
    secretariat: '',
    general: ''
});

const normalize = (value) => String(value ?? '').trim().toLowerCase();

/** "OBSTACLE_5" (or an obstacle location with a number) -> 5, else null */
export function obstacleNumberFromLocation(location = {}, locationId = '') {
    if (location && Number.isInteger(Number(location.obstacleNumber)) && Number(location.obstacleNumber) > 0) {
        return Number(location.obstacleNumber);
    }
    const match = /^OBSTACLE_(\d+)$/.exec(String(locationId || location?.id || ''));
    return match ? Number(match[1]) : null;
}

/**
 * The assignment plan's locations with the competition's real obstacles in
 * place of the fixed "Hinder 1-8": one location per obstacle (with its name),
 * plus any stored obstacle location an assignment still points at.
 */
export function mergeObstacleLocations(locations = [], obstacles = [], assignments = []) {
    const list = Array.isArray(locations) ? locations : [];
    const realObstacles = (Array.isArray(obstacles) ? obstacles : [])
        .map(o => ({ number: Number(o?.number ?? o?.obstacleNumber), name: String(o?.name || '').trim() }))
        .filter(o => Number.isInteger(o.number) && o.number > 0)
        .sort((a, b) => a.number - b.number);
    if (!realObstacles.length) return list.slice();

    const used = new Set((Array.isArray(assignments) ? assignments : []).map(a => String(a?.locationId || '')));
    const obstacleLocations = realObstacles.map(o => ({
        id: `OBSTACLE_${o.number}`,
        label: o.name ? `Hinder ${o.number} – ${o.name}` : `Hinder ${o.number}`,
        type: 'obstacle',
        obstacleNumber: o.number
    }));
    const realIds = new Set(obstacleLocations.map(l => l.id));
    const out = [];
    let inserted = false;
    list.forEach((loc) => {
        if (loc?.type === 'obstacle' && !loc.isCustom) {
            if (!inserted) { out.push(...obstacleLocations); inserted = true; }
            // An old obstacle location kept only while an assignment uses it
            if (!realIds.has(loc.id) && used.has(String(loc.id))) out.push(loc);
            return;
        }
        out.push(loc);
    });
    if (!inserted) out.push(...obstacleLocations);
    return out;
}

/** The official records (officials/{id} with private part) that are this user */
export function findMyRecords(records = [], user = {}) {
    const email = normalize(user?.email);
    const uid = String(user?.uid || '');
    const name = normalize(user?.displayName);
    return (Array.isArray(records) ? records : []).filter((r) => {
        if (uid && (String(r?.uid || '') === uid || String(r?.userId || '') === uid)) return true;
        if (email && normalize(r?.email) === email) return true;
        return Boolean(name) && normalize(r?.name) === name;
    });
}

/** The kind of task an assignment is, from its place and role */
export function assignmentKind(assignment = {}, location = null) {
    const role = normalize(assignment.roleLabel || assignment.role);
    const type = normalize(location?.type || assignment.locationType);
    const discipline = normalize(assignment.discipline);
    if (obstacleNumberFromLocation(location || {}, assignment.locationId) || type === 'obstacle') return 'obstacle';
    if (role.includes('observat')) return 'observer';
    if (role.includes('veterin') || role.includes('vet')) return 'vet';
    if (role.includes('speaker')) return 'speaker';
    if (role.includes('vagnbredd')) return 'carriageWidth';
    if (role.includes('sekretariat') || type === 'section') return 'secretariat';
    if (type === 'start_finish_m' || role.includes('start/mål') || role.includes('start/mal')) return 'stages';
    if (type.endsWith('_p') || type.includes('_p_') || discipline === 'precision') return 'precision';
    if (type === 'dressage_func' || type === 'court' || discipline === 'dressage') {
        return role.includes('domare') || role.includes('protokoll') ? 'dressage' : 'general';
    }
    if (type.endsWith('_m') || type.includes('_m_') || discipline === 'marathon') return 'marathon';
    return 'general';
}

function assignmentTask(assignment, location, obstacles) {
    const kind = assignmentKind(assignment, location);
    const obstacleNumber = kind === 'obstacle' ? obstacleNumberFromLocation(location || {}, assignment.locationId) : null;
    const obstacle = obstacleNumber ? (obstacles || []).find(o => Number(o?.number) === obstacleNumber) : null;
    const timeRange = assignment.startTime
        ? `${assignment.startTime}${assignment.endTime ? `–${assignment.endTime}` : ''}`
        : (assignment.shift && assignment.shift !== 'all' ? String(assignment.shift).trim() : '');
    return {
        id: `assignment:${assignment.id || ''}`,
        source: 'plan',
        kind,
        icon: TASK_ICONS[kind],
        route: ROUTES[kind],
        titleKey: obstacleNumber ? 'official_task_obstacle' : `official_task_${kind}`,
        titleParams: { number: obstacleNumber ?? '', name: obstacle?.name || '' },
        obstacleNumber,
        roleLabel: String(assignment.roleLabel || assignment.role || ''),
        place: String(location?.label || assignment.locationLabel || ''),
        date: String(assignment.dateString || ''),
        time: timeRange,
        meetingPoint: String(assignment.meetingPoint || ''),
        briefing: String(assignment.briefing || assignment.notes || '')
    };
}

function judgeTasks(judge) {
    const roles = Array.isArray(judge?.roles) && judge.roles.length
        ? judge.roles
        : (judge?.position ? [{ discipline: 'dressage', position: judge.position }] : []);
    return roles.map((role) => {
        const discipline = normalize(role?.discipline);
        const position = String(role?.position || '').toUpperCase();
        if (discipline === 'dressage') {
            return {
                id: `judge:${judge.id}:dressage:${position}`,
                source: 'judge',
                kind: 'dressage',
                icon: TASK_ICONS.dressage,
                route: ROUTES.dressage,
                titleKey: position ? 'official_task_dressage_judge' : 'official_task_dressage',
                titleParams: { position }
            };
        }
        if (discipline === 'precision') {
            return { id: `judge:${judge.id}:precision`, source: 'judge', kind: 'precision', icon: TASK_ICONS.precision, route: ROUTES.precision, titleKey: 'official_task_precision_judge', titleParams: {} };
        }
        if (discipline === 'marathon') {
            return { id: `judge:${judge.id}:marathon`, source: 'judge', kind: 'marathon', icon: TASK_ICONS.marathon, route: ROUTES.marathon, titleKey: 'official_task_marathon_judge', titleParams: {} };
        }
        if (discipline === 'overjudge') {
            return { id: `judge:${judge.id}:overjudge`, source: 'judge', kind: 'general', icon: TASK_ICONS.general, route: '', titleKey: 'official_task_overjudge', titleParams: {} };
        }
        return null;
    }).filter(Boolean);
}

// A system role's input page, when nothing more specific says what to do
const ROLE_TASKS = Object.freeze({
    dressage: 'dressage',
    marathon: 'marathon',
    precision: 'precision',
    speaker: 'speaker',
    vet: 'vet',
    admin: 'admin'
});

/**
 * The official's tasks, the most specific first: the assignment plan, then
 * judge roles, then a system role's input page (only for a discipline no
 * earlier task covers).
 */
export function buildOfficialTasks({ roles = [], officials = [], judges = [], assignments = [], locations = [], obstacles = [] } = {}) {
    const myOfficialIds = new Set((officials || []).map(o => String(o?.id || '')));
    const locationById = new Map((locations || []).map(l => [String(l?.id || ''), l]));
    const tasks = [];

    (assignments || [])
        .filter(a => myOfficialIds.has(String(a?.officialId || '')))
        .map(a => assignmentTask(a, locationById.get(String(a.locationId || '')) || null, obstacles))
        .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
        .forEach(task => tasks.push(task));

    (judges || []).forEach(judge => tasks.push(...judgeTasks(judge)));

    const coveredKinds = new Set(tasks.map(task => (task.kind === 'obstacle' ? 'marathon' : task.kind)));
    [...new Set((roles || []).map(String))].forEach((role) => {
        const kind = ROLE_TASKS[role];
        if (!kind || coveredKinds.has(kind)) return;
        coveredKinds.add(kind);
        tasks.push({
            id: `role:${role}`,
            source: 'role',
            kind,
            icon: TASK_ICONS[kind],
            route: ROUTES[kind],
            titleKey: `official_task_${kind}`,
            titleParams: {}
        });
    });

    // The same page and title once (e.g. a judge role and a plan entry)
    const seen = new Set();
    return tasks.filter((task) => {
        const key = `${task.route}|${task.titleKey}|${JSON.stringify(task.titleParams)}|${task.date || ''}|${task.time || ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/** "Inmatning Dressyr – Domare {position}" with its params filled in */
export function fillTemplate(text, params = {}) {
    return String(text || '').replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? ''));
}
