import { klassProgramMapping } from '../../data/competitionData.js';

export function inferParaGradeFromClassName(className = '') {
    const s = String(className || '').toLowerCase();
    if (!/para/.test(s)) return '';
    if (/grad\s*1|grade\s*1|l[aä]tt\s*a|\bla\b/.test(s)) return '1';
    if (/grad\s*2|grade\s*2|msv|medelsv|sv[aå]r/.test(s)) return '2';
    return '2';
}

export function resolveProgramKeyForClass(className = '', paraGrade = '') {
    const label = String(className || '').trim();
    if (!label) return '';
    if (/para/i.test(label)) {
        const grade = String(paraGrade || inferParaGradeFromClassName(label) || '');
        if (grade === '1') return 'FEIParaG1';
        if (grade === '2') return 'FEIParaG2';
    }
    return klassProgramMapping[label] || '';
}

export function normalizeTestForMerge(label) {
    if (!label) return { key: '', label: '' };
    let s = String(label)
        .replace(/\b((?:Enbet|Par|Tvåspann|Fyrspann|Häst|Ponny)(?:\s+)?)+\b/gi, '')
        .replace(/\b([ABCD]-ponny)\b/gi, '')
        .trim();
    s = s.replace(/\s+/g, ' ');

    const foundKey = Object.keys(klassProgramMapping || {}).find(k => k.toLowerCase() === String(label).toLowerCase());
    if (foundKey) {
        return { key: `PROG:${klassProgramMapping[foundKey]} `, label: s };
    }

    return { key: `TEST:${s.toUpperCase()} `, label: s };
}

export function resolveTestLevelMergeForClass(className = '') {
    const base = normalizeTestForMerge(className);
    const fallbackLabel = String(className || '').trim();
    return {
        key: base.key || (fallbackLabel ? `TEST:${fallbackLabel.toUpperCase()} ` : ''),
        label: base.label || fallbackLabel
    };
}

export function normalizeEqClassName(name) {
    if (!name) return '';
    let out = String(name)
        .normalize('NFKC')
        .replace(/\s+/g, ' ')
        .trim();

    out = out
        .replace(/\bLA\b/gi, 'Lätt A')
        .replace(/\bLB\b/gi, 'Lätt B')
        .replace(/\bLC\b/gi, 'Lätt C')
        .replace(/\bLE\b/gi, 'Lätt E')
        .replace(/\bl[aä]tt\s*a\b/gi, 'Lätt A')
        .replace(/\bl[aä]tt\s*b\b/gi, 'Lätt B')
        .replace(/\bmedelsv[aå]r\b/gi, 'MSV')
        .replace(/\bsv[aå]r\b/gi, 'Svår')
        .replace(/\benb(et)?\b/gi, 'Enbet')
        .replace(/\bpar(?!a)\b/gi, 'Par')
        .replace(/\bfyr(spann)?\b/gi, 'Fyrspann')
        .replace(/\btandem\b/gi, 'Tandem');

    out = out.replace(/\bMSV[\s:.\-]*([0-9IVX]+)\b/gi, (_, g) => {
        const roman = { I: '1', II: '2', III: '3', IV: '4', V: '5' };
        const num = /^[0-9]+$/.test(g) ? g : (roman[g.toUpperCase()] || g);
        return `Msv ${num} `;
    });

    out = out
        .replace(/\bponn?y\b/gi, 'Ponny')
        .replace(/\bh[aä]st\b/gi, 'Häst');

    return out.replace(/\s{2,}/g, ' ').trim();
}

export function findBestClassMatch(xmlClassName, availableAppClasses) {
    if (!xmlClassName || !availableAppClasses || availableAppClasses.length === 0) return null;

    const xmlNorm = normalizeEqClassName(xmlClassName).toLowerCase();
    const xmlHasBarn = /\b(barn|children|ch)\b/i.test(xmlClassName);
    const xmlHasPara = /\bpara\b/i.test(xmlClassName);
    const xmlHasJunior = /\b(junior|"j"|\bj\b)\b/i.test(xmlClassName);
    const xmlHasU25 = /\bu25\b/i.test(xmlClassName);
    const spanMatch = xmlNorm.match(/\b(enbet|par(?!a)|fyrspann|tandem)\b/);
    const xmlSpan = spanMatch ? spanMatch[1] : null;

    let best = null;
    let bestScore = -1;

    for (const appClass of availableAppClasses) {
        const appNorm = normalizeEqClassName(appClass).toLowerCase();
        const appHasBarn = /\b(barn|children|ch)\b/i.test(appClass);
        const appHasPara = /\bpara\b/i.test(appClass);
        const appHasJunior = /\b(junior|"j"|\bj\b)\b/i.test(appClass);
        const appHasU25 = /\bu25\b/i.test(appClass);
        let score = 0;

        if (xmlNorm === appNorm) score += 100;
        if (xmlHasPara !== appHasPara) score -= 100;

        if (/lätt/.test(xmlNorm) && /lätt/.test(appNorm)) score += 5;
        if (/msv/.test(xmlNorm) && /msv/.test(appNorm)) score += 5;
        if (/svår/.test(xmlNorm) && /svår/.test(appNorm)) score += 5;

        const nXml = (xmlNorm.match(/\bmsv\s*(\d)\b/) || [])[1];
        const nApp = (appNorm.match(/\bmsv\s*(\d)\b/) || [])[1];
        if (nXml && nApp && nXml === nApp) score += 8;

        if (xmlSpan && !xmlHasPara && !appHasPara) {
            if (new RegExp(`\\b${xmlSpan}\\b`).test(appNorm)) score += 10;
            else score -= 4;
        } else if (!xmlHasPara && !xmlHasBarn && !xmlHasJunior && !xmlHasU25) {
            if (/\benbet\b/.test(appNorm)) score += 6;
            if (/\bpar\b(?!a)/.test(appNorm)) score -= 2;
            if (/\bfyrspann\b/.test(appNorm)) score -= 2;
        }

        if (/\bponny\b/.test(xmlNorm) && /\bponny\b/.test(appNorm)) score += 3;
        if (/\bhäst\b/.test(xmlNorm) && /\bhäst\b/.test(appNorm)) score += 3;

        if (xmlHasBarn) score += appHasBarn ? 12 : -8;
        else if (appHasBarn) score -= 4;

        if (xmlHasPara) {
            score += appHasPara ? 12 : -10;
            if (/l.*tt\s*a/.test(xmlNorm) && /l.*tt\s*a/.test(appNorm)) score += 10;
            if (/\bmsv\b/.test(xmlNorm) && /\bmsv\b/.test(appNorm)) score += 10;
            if (/sv.*r/.test(xmlNorm) && /sv.*r/.test(appNorm)) score += 10;
            if (/msv(\s*\d+)?/.test(xmlNorm) && /\bmsv\b/.test(appNorm)) score += 10;
        } else if (appHasPara) {
            score -= 4;
        }

        if (xmlHasJunior) score += appHasJunior ? 8 : -4;
        else if (appHasJunior) score -= 2;

        if (xmlHasU25) score += appHasU25 ? 8 : -4;
        else if (appHasU25) score -= 2;

        if (score > bestScore) {
            bestScore = score;
            best = appClass;
        }
    }

    return best;
}
