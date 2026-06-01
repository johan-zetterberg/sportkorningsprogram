export function normalizeJudgeRoles(roles) {
    const out = [];
    let dressageRole = null;

    (Array.isArray(roles) ? roles : []).forEach(role => {
        if (!role || !role.discipline) return;

        if (role.discipline === 'dressage') {
            const position = (role.position || '').toString().toUpperCase();
            if (!dressageRole || (!dressageRole.position && position)) {
                dressageRole = { discipline: 'dressage', position };
            }
            return;
        }

        if (role.discipline === 'overjudge') {
            if (!out.some(item => item.discipline === 'overjudge')) {
                out.push({ discipline: 'overjudge' });
            }
            return;
        }

        if (!out.some(item => item.discipline === role.discipline)) {
            out.push({ discipline: role.discipline });
        }
    });

    if (dressageRole) out.push(dressageRole);
    return out;
}
