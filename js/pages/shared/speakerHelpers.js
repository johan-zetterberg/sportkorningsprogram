import { stageStartTS } from '../../utils/marathonUtils.js';

export const formatTime = (iso) => {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    } catch {
        return '—';
    }
};

export function isWithdrawnOrExcluded(state, eqLikeObj) {
    const toStr = v => String(v || '').toLowerCase();
    const badStates = new Set(['withdrawn', 'scratched', 'did-not-start', 'dns', 'retired', 'eliminated', 'excluded', 'ute', 'struken', 'struken?']);
    if (badStates.has(toStr(state))) return true;

    const flags = [
        eqLikeObj?.withdrawn,
        eqLikeObj?.scratched,
        eqLikeObj?.struken,
        eqLikeObj?.didNotStart,
        eqLikeObj?.dns,
        eqLikeObj?.eliminated,
        eqLikeObj?.excluded,
        eqLikeObj?.retired
    ];
    if (flags.some(v => v === true)) return true;

    const textCandidates = [
        eqLikeObj?.status,
        eqLikeObj?.eqStatus,
        eqLikeObj?.dressageStatus,
        eqLikeObj?.result,
        eqLikeObj?.outcome,
        eqLikeObj?.statusText,
        eqLikeObj?.reason
    ].map(toStr);

    return textCandidates.some(s =>
        s && (
            s.includes('withdrawn') ||
            s.includes('scratched') ||
            s.includes('did-not-start') ||
            s === 'dns' ||
            s.includes('eliminated') ||
            s.includes('excluded') ||
            s.includes('struken') ||
            s.includes(' ute')
        )
    );
}

export function expandDressagePosition(j) {
    if (Array.isArray(j?.roles)) {
        const withPos = j.roles.find(r => r && r.discipline === 'dressage' && r.position);
        if (withPos) return String(withPos.position).toUpperCase();
    }
    if (j?.position) return String(j.position).toUpperCase();
    return '';
}

export function normState(v) {
    return String(v || '').toLowerCase().trim();
}

export function getEquipageClassLabels(eq = {}) {
    return [
        eq.className,
        eq._mergedLabel,
        eq.mergedTestLabel,
        eq._mergedKey,
        eq.mergedTestKey
    ].filter(Boolean).map(v => String(v));
}

export function matchesDisplayClass(eq, targetClass) {
    if (!targetClass) return false;
    const target = String(targetClass);
    return getEquipageClassLabels(eq).some(label => label === target);
}

export function hasMarathonStarted(data = {}) {
    return !!(
        stageStartTS(data, 'A') ||
        stageStartTS(data, 'transport') ||
        stageStartTS(data, 'B') ||
        data.currentObstacle ||
        data.running ||
        data.inProgress ||
        (Array.isArray(data.obstacles) && data.obstacles.length > 0)
    );
}
