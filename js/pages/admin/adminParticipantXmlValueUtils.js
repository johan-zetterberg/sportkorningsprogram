export function normalizeXmlNumber(value, { integer = false } = {}) {
    if (value === null || value === undefined || value === '') return null;

    const normalized = String(value)
        .trim()
        .replace(/\s+/g, '')
        .replace(',', '.');
    if (!normalized) return null;

    const number = Number(normalized);
    if (!Number.isFinite(number)) return null;

    return integer ? Math.trunc(number) : number;
}

export function normalizeTdbClassNumber(value) {
    const number = normalizeXmlNumber(value, { integer: true });
    return number != null && number > 0 ? number : null;
}

export function isAdministrativeFeeClass(value) {
    const number = normalizeTdbClassNumber(value);
    return number != null && number > 900;
}

export function resolveImportedEntryStatus(status) {
    const normalized = String(status || '').trim().toUpperCase();
    return ['REMOVED', 'WITHDRAWN', 'STRUKEN'].includes(normalized) ? 'struken' : 'anmäld';
}

export function resolveImportedPaymentStatus(entryStatus, paidAmount) {
    const normalizedStatus = String(entryStatus || '').trim().toUpperCase();
    const amount = normalizeXmlNumber(paidAmount);
    return normalizedStatus === 'PAID' || (amount != null && amount > 0) ? 'paid' : '';
}

export function calculateImportedHorseAge(bornYear, currentYear = new Date().getFullYear()) {
    const year = normalizeXmlNumber(bornYear, { integer: true });
    if (!year || year < 1900 || year > currentYear) return '';
    return currentYear - year;
}

export function extractTrackWidthsFromTexts(texts = []) {
    const list = Array.isArray(texts) ? texts : [texts];
    const combined = list.filter(Boolean).map(t => String(t)).join(' ');
    if (!combined.trim()) return { trackWidth: null, marathonTrackWidth: null };

    let trackWidth = null;
    let marathonTrackWidth = null;

    // 1. Maraton-specifik bredd (t.ex. "maraton 125", "maratonbredd: 126 cm", "maratonspårvidd 125")
    const marathonMatch = combined.match(/(?:maraton(?:vagn|spårvidd|bredd)?|marathon)[\s:cm\-=]*(\d{2,3})/i);
    if (marathonMatch) {
        const w = parseInt(marathonMatch[1], 10);
        if (w >= 100 && w <= 200) {
            marathonTrackWidth = w;
        }
    }

    // 2. Dressyr / Precision / Allmän vagnbredd / spårvidd
    const dressPrecisionMatch = combined.match(/(?:dressyr(?:bredd|spårvidd)?|precision(?:sbredd|spårvidd)?|vagns?bredd|spårvidd|vagn(?:en)?(?:bredd)?)[\s:cm\-=]*(\d{2,3})/i);
    if (dressPrecisionMatch) {
        const w = parseInt(dressPrecisionMatch[1], 10);
        if (w >= 100 && w <= 200) {
            trackWidth = w;
        }
    }

    // 3. Fallback: två mått separerade med snedstreck (t.ex. "138 / 125" eller "138/125 cm")
    if (!trackWidth) {
        const slashMatch = combined.match(/(\d{3})\s*[\/]\s*(\d{3})\s*(?:cm)?/i);
        if (slashMatch) {
            const w1 = parseInt(slashMatch[1], 10);
            const w2 = parseInt(slashMatch[2], 10);
            if (w1 >= 110 && w1 <= 200 && w2 >= 110 && w2 <= 200) {
                trackWidth = w1;
                if (!marathonTrackWidth) marathonTrackWidth = w2;
            }
        }
    }

    // 4. Fallback: generisk "bredd 138" om det inte redan fångats
    if (!trackWidth) {
        const genericMatch = combined.match(/\bbredd[\s:cm\-=]*(\d{2,3})/i);
        if (genericMatch) {
            const w = parseInt(genericMatch[1], 10);
            if (w >= 100 && w <= 200) {
                trackWidth = w;
            }
        }
    }

    return { trackWidth, marathonTrackWidth };
}

export function isSingleHarness(className = '', category = '') {
    const norm = `${className} ${category}`.toLowerCase();
    if (/(par(?!a)|fyrspann|tandem|tvåspann|2\s*-\s*spann)/i.test(norm)) {
        return false;
    }
    return true;
}

export function buildEquipageImportKey({ driverName = '', classNumber = '', horseName = '', className = '' } = {}) {
    const cleanDriver = String(driverName || '').trim();
    const cleanClass = String(classNumber || '').trim();
    const isSingle = isSingleHarness(className);
    if (isSingle && horseName) {
        const cleanHorse = String(horseName || '').trim();
        return `${cleanDriver}|${cleanClass}|${cleanHorse}`;
    }
    return `${cleanDriver}|${cleanClass}`;
}

export function annotateMultipleDriverStarts(equipages = []) {
    if (!Array.isArray(equipages) || !equipages.length) return equipages;

    const countByDriver = new Map();
    const listByDriver = new Map();

    equipages.forEach(eq => {
        const driver = String(eq?.driverName || '').trim();
        if (!driver) return;
        const norm = driver.toLowerCase();
        countByDriver.set(norm, (countByDriver.get(norm) || 0) + 1);
        if (!listByDriver.has(norm)) listByDriver.set(norm, []);
        listByDriver.get(norm).push(eq);
    });

    return equipages.map(eq => {
        const driver = String(eq?.driverName || '').trim();
        const norm = driver.toLowerCase();
        const totalStarts = countByDriver.get(norm) || 1;
        const otherStarts = (listByDriver.get(norm) || [])
            .filter(other => other !== eq)
            .map(other => ({
                startNumber: other.startNumber,
                className: other.className,
                horseName: other.horses?.[0]?.name || ''
            }));

        return {
            ...eq,
            driverStartCount: totalStarts,
            hasMultipleStarts: totalStarts > 1,
            driverOtherStarts: otherStarts
        };
    });
}
