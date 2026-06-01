import { saveJudge, saveOfficial } from '../../services/adminService.js';
import { normalizeJudgeRoles } from './adminJudgeRoleUtils.js';
import { getXmlElements, getXmlText, parseAdminXml } from './adminXmlUtils.js';

export async function importOfficialsFromXml(xmlFile, competitionId, existingJudges = [], existingOfficials = []) {
    const text = await xmlFile.text();
    const xml = parseAdminXml(text, { requiredRootTag: 'TInternetEntrys' });

    const all = getXmlElements;
    const getText = getXmlText;

    const licenseMap = new Map();
    const riderNodes = all(xml, 'Riders').flatMap(node => all(node, 'o'));
    for (const riderNode of riderNodes) {
        const id = getText(riderNode, 'foreignId');
        const license = getText(riderNode, 'licens');
        if (id && license) {
            licenseMap.set(id, license);
        }
    }

    const allOfficialBlocks = all(xml, 'Officials');
    if (allOfficialBlocks.length === 0) return { judges: 0, officials: 0 };
    const officialNodes = allOfficialBlocks.flatMap(node => all(node, 'o'));

    let judgesImported = 0;
    let officialsImported = 0;
    const existingOfficialNames = new Set(existingOfficials.map(official => official.name));

    const roleMap = {
        event_director: 'Tävlingsledare',
        veterinary: 'Veterinär',
        press_official: 'Pressansvarig',
        safety_official: 'Säkerhetsansvarig',
        contact_person: 'Kontaktperson',
        precision_course_designer: 'Banbyggare',
        maraton_course_designer: 'Banbyggare',
        results_accountable: 'Resultatansvarig'
    };

    const judgesMap = new Map();
    const officialsMap = new Map();

    for (const node of officialNodes) {
        const foreignId = getText(node, 'foreignId');
        const fullName = getText(node, 'fullName');
        if (!fullName) continue;

        const kind = getText(node, 'kind');
        const phone = getText(node, 'phone');
        const email = getText(node, 'email');
        const licenseNo = (foreignId ? licenseMap.get(foreignId) : '') || '';

        if (['head_judge', 'driving_dressage_judge', 'maraton_judge', 'precision_judge'].includes(kind)) {
            const judgeId = fullName.replace(/\s+/g, '-').toLowerCase();
            const newRoles = [];

            if (kind === 'driving_dressage_judge') newRoles.push({ discipline: 'dressage', position: '' });
            else if (kind === 'maraton_judge') newRoles.push({ discipline: 'marathon' });
            else if (kind === 'precision_judge') newRoles.push({ discipline: 'precision' });
            else if (kind === 'head_judge') newRoles.push({ discipline: 'overjudge' });

            if (!judgesMap.has(judgeId)) {
                judgesMap.set(judgeId, {
                    id: judgeId,
                    name: fullName,
                    phone,
                    email,
                    license: licenseNo,
                    roles: []
                });
            }

            const entry = judgesMap.get(judgeId);
            entry.roles.push(...newRoles);
            if (!entry.phone && phone) entry.phone = phone;
            if (!entry.email && email) entry.email = email;
            if (!entry.license && licenseNo) entry.license = licenseNo;
            continue;
        }

        const role = roleMap[kind] || kind.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());

        if (!officialsMap.has(fullName)) {
            officialsMap.set(fullName, {
                name: fullName,
                roles: new Set(),
                phone,
                email,
                license: licenseNo
            });
        }

        const official = officialsMap.get(fullName);
        official.roles.add(role);
        if (!official.phone && phone) official.phone = phone;
        if (!official.email && email) official.email = email;
        if (!official.license && licenseNo) official.license = licenseNo;
    }

    for (const judge of judgesMap.values()) {
        judge.roles = normalizeJudgeRoles(judge.roles);
        judge.isOverJudge = judge.roles.some(role => role.discipline === 'overjudge');

        try {
            await saveJudge(competitionId, judge.id, judge);
            judgesImported++;
        } catch (err) {
            console.error(`Kunde inte spara domare ${judge.name}: `, err);
        }
    }

    for (const official of officialsMap.values()) {
        if (existingOfficialNames.has(official.name)) continue;

        const finalObj = {
            name: official.name,
            role: Array.from(official.roles).join(', '),
            phone: official.phone,
            email: official.email,
            license: official.license
        };

        try {
            await saveOfficial(competitionId, finalObj);
            officialsImported++;
        } catch (err) {
            console.error(`Kunde inte spara funktionär ${official.name}: `, err);
        }
    }

    return { judges: judgesImported, officials: officialsImported };
}
