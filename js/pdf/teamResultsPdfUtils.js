export function formatTeamMemberDisciplineCell(score, { isCounting = false, isTeamPenalty = false, isElim = false } = {}) {
    if (isTeamPenalty) {
        const text = isCounting ? '500.00* (Lagstr)' : '500.00 (Lagstr)';
        return {
            content: text,
            styles: { textColor: isCounting ? [160, 40, 40] : [150, 150, 150], fontSize: 7, halign: 'center' }
        };
    }
    if (isElim) {
        return {
            content: 'ELIM',
            styles: { textColor: [180, 50, 50], fontSize: 8, halign: 'center' }
        };
    }
    if (score === null || score === undefined || !Number.isFinite(score)) {
        return {
            content: '—',
            styles: { textColor: [150, 150, 150], fontSize: 8, halign: 'center' }
        };
    }
    const valStr = score.toFixed(2);
    const content = isCounting ? `${valStr} *` : `${valStr} (str)`;
    const color = isCounting ? [30, 30, 30] : [150, 150, 150];
    return {
        content,
        styles: { textColor: color, fontSize: 8, halign: 'center', fontStyle: isCounting ? 'bold' : 'normal' }
    };
}
