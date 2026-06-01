import {
    normalizeEqClassName,
    normalizeTestForMerge
} from './adminParticipantClassUtils.js';
import { getXmlElements, getXmlText, parseAdminXml } from './adminXmlUtils.js';
import {
    calculateImportedHorseAge,
    isAdministrativeFeeClass,
    normalizeTdbClassNumber,
    normalizeXmlNumber,
    resolveImportedEntryStatus,
    resolveImportedPaymentStatus
} from './adminParticipantXmlValueUtils.js';

export async function parseEqEntriesXml(file) {
    const text = await file.text();
    const xml = parseAdminXml(text, { requiredRootTag: 'TInternetEntrys' });

    const _all = getXmlElements;
    const _text = getXmlText;
    const horseTypeMap = {
        'H': 'Häst', 'A': 'A-ponny', 'B': 'B-ponny',
        'C': 'C-ponny', 'D': 'D-ponny', 'P': 'Ponny'
    };

    const root = xml.getElementsByTagName('TInternetEntrys')[0];
    if (!root) throw new Error('Okänt XML-format: filen saknar <TInternetEntrys>-taggen.');

    const orgNode = xml.getElementsByTagName('Organization')[0];
    const meetingNode = xml.getElementsByTagName('MeetingSettings')[0];
    const propositionNodes = _all(root, 'Propositions').flatMap(p => _all(p, 'o'));
    const fallbackLocation = propositionNodes.find(prop => _text(prop, 'location')) ? _text(propositionNodes.find(prop => _text(prop, 'location')), 'location') : '';

    const competitionInfo = {
        name: _text(meetingNode, 'name'),
        location: _text(meetingNode, 'location') || fallbackLocation,
        organizer: _text(orgNode, 'name'),
        organizerId: _text(orgNode, 'orgNr'),
        address: _text(orgNode, 'Address'),
        zipCode: _text(orgNode, 'zipCode'),
        city: _text(orgNode, 'city'),
        phone: _text(orgNode, 'phone'),
        fax: _text(orgNode, 'fax')
    };

    const classInfoMap = new Map();

    propositionNodes.forEach(prop => {
        const classNumber = _text(prop, 'clabbNumber');
        const classLabel = _text(prop, 'AclassName');
        const horseCode = _text(prop, 'horse'); // 'H','P','A','B','C','D'
        if (classNumber && classLabel) {
            classInfoMap.set(classNumber, { label: classLabel, horse: horseCode });
        }
    });

    const equipagesByClass = {};
    const administrativeFeesByDriver = new Map();
    _all(root, 'Riders').flatMap(r => _all(r, 'o')).forEach(riderNode => {
        const driverName = `${_text(riderNode, 'firstName')} ${_text(riderNode, 'lastName')} `.trim();
        if (!driverName) return;

        const clubName = _text(riderNode, 'orgName');
        const totalAmountPaidByRider = normalizeXmlNumber(_text(riderNode, 'paid'));

        // --- Hämta kuskens kontakt-, licens- och adressinfo ---
        const licenseNo = _text(riderNode, 'licens');
        const licenseYear = _text(riderNode, 'licens_year');
        const gender = _text(riderNode, 'gender');
        const bornYear = _text(riderNode, 'bornYear');
        const country = _text(riderNode, 'country');
        const company = _text(riderNode, 'company');
        const contactEmail = _text(riderNode, 'email');
        const contactPhone = _text(riderNode, 'phone') || _text(riderNode, 'cellPhone') || _text(riderNode, 'workPhone');
        const address = {
            street: _text(riderNode, 'street'),
            zipCode: _text(riderNode, 'zipCode'),
            city: _text(riderNode, 'city')
        };

        _all(riderNode, 'Horses').flatMap(h => _all(h, 'o')).forEach(horseNode => {
            const notes = _text(horseNode, 'PM').replace(/(\r\n|\n|\r)/gm, " ").trim();
            const groomMatch = notes.match(/(?:groomar? åt|delar groom med)\s+([A-ZÅÄÖ][a-zåäö]+(?:\s+[A-ZÅÄÖ][a-zåäö]+)?)/i);
            const groomName = groomMatch ? groomMatch[1].trim() : '';
            const horseCategory = _text(horseNode, 'category');

            const horse = {
                regNo: _text(horseNode, 'regNo'),
                chip: _text(horseNode, 'chipNo'),
                ueln: _text(horseNode, 'uelnNo'),
                license: _text(horseNode, 'licens'),
                feiPass: _text(horseNode, 'feipass'),
                color: _text(horseNode, 'color'),
                name: _text(horseNode, 'horseName'),
                type: horseTypeMap[horseCategory] || horseCategory,
                age: calculateImportedHorseAge(_text(horseNode, 'bornYear')),
                bornYear: _text(horseNode, 'bornYear'),
                lineage: `e.${_text(horseNode, 'father')} u.${_text(horseNode, 'mother')} ue.${_text(horseNode, 'grandFather')} `,
                licenseYear: _text(horseNode, 'licenseYear'),
                owner: _text(horseNode, 'owner'),
                breeder: _text(horseNode, 'breeder'),
                gender: ({ 'V': 'Valack', 'S': 'Sto', 'H': 'Hingst' })[_text(horseNode, 'sex')] || _text(horseNode, 'sex'),
                breed: _text(horseNode, 'breed'),
                studbook: _text(horseNode, 'studbook'),
                vaccinationDate: _text(horseNode, 'vaccinationCardDate')
            };

            const riderComment = _text(riderNode, 'Comment') || _text(riderNode, 'Remarks');
            const horseComment = _text(horseNode, 'Comment') || _text(horseNode, 'Remarks');

            _all(horseNode, 'Classes').flatMap(c => _all(c, 'o')).forEach(classEntryNode => {
                const classNumber = _text(classEntryNode, 'clabbNumber');
                const tdbClassNumber = normalizeTdbClassNumber(classNumber);

                const propInfo = classInfoMap.get(classNumber) || {};
                let className = normalizeEqClassName(propInfo.label || `Okänd post(${classNumber})`);

                const entryStatus = _text(classEntryNode, 'status');
                const uniqueKey = `${driverName}| ${classNumber} `;

                // Anspänning och hästtyp baserat på klassrubriken i propositionen.
                // Exempel: "LA par" -> Par, "LB" (utan markör) -> Enbet.
                const hasAnsp = /(enbet|par(?!a)|fyrspann|tandem)/i.test(className);
                const hasSpecies = /(ponny|häst)/i.test(className);

                if (!hasAnsp) {
                    const labelNorm = normalizeEqClassName(propInfo.label || '').toLowerCase();
                    let span = 'Enbet';
                    if (/\bpar\b(?!a)|\btvåspann\b|\b2\s*-\s*spann\b/.test(labelNorm)) span = 'Par';
                    else if (/\bfyrspann\b/.test(labelNorm)) span = 'Fyrspann';
                    else if (/\btandem\b/.test(labelNorm)) span = 'Tandem';
                    className += ` ${span} `;
                }

                if (!hasSpecies) {
                    const speciesCode = (propInfo.horse || _text(riderNode, 'horse') || '').toUpperCase(); // 'P'/'H'
                    const species = speciesCode === 'P' ? 'Ponny' : 'Häst';
                    className += ` ${species} `;
                }


                const hasPaidAmount = totalAmountPaidByRider !== null && totalAmountPaidByRider > 0;
                const paymentStatus = resolveImportedPaymentStatus(entryStatus, totalAmountPaidByRider);

                if (isAdministrativeFeeClass(classNumber)) {
                    const fees = administrativeFeesByDriver.get(driverName) || [];
                    if (!fees.includes(className)) {
                        fees.push(className);
                        administrativeFeesByDriver.set(driverName, fees);
                    }
                    return;
                }

                const equipageStatus = resolveImportedEntryStatus(entryStatus);

                if (!equipagesByClass[uniqueKey]) {
                    const widthMatch = notes.match(/(?:vagnsbredd|bredd|spårvidd)[\s:cm]*(\d{2,3})/i);
                    const marathonWidthMatch = notes.match(/maratonbredd[\s:cm]*(\d{2,3})/i);

                    const tdbClassLabel = (propInfo && propInfo.label) || '';
                    const tdbHorseCode = ((propInfo && propInfo.horse) || '').toUpperCase(); // 'H','P','A','B','C','D'
                    const tdbHorseText = horseTypeMap[tdbHorseCode] || '';

                    // Matcha testnamn även när TDB-rubriken varierar med häst/ponny/anspänning.
                    const baseForMerge = normalizeTestForMerge(tdbClassLabel || className || '');
                    const mergedTestKey = baseForMerge.key;
                    const mergedTestLabel = baseForMerge.label;

                    equipagesByClass[uniqueKey] = {
                        startNumber: null,
                        driverName, clubName, className,
                        tdbClassNumber,
                        tdbClassLabel: tdbClassLabel || '',
                        tdbHorseCode: tdbHorseCode || '',
                        tdbHorseText: tdbHorseText || '',
                        tdbOriginalXmlClassName: className || '',
                        mergedTestKey,
                        mergedTestLabel,
                        groomName,
                        notes,
                        trackWidth: widthMatch ? normalizeXmlNumber(widthMatch[1], { integer: true }) : null,
                        marathonTrackWidth: marathonWidthMatch ? normalizeXmlNumber(marathonWidthMatch[1], { integer: true }) : null,
                        horses: [horse],
                        status: equipageStatus,
                        administrativeFees: [],
                        payment: {
                            status: paymentStatus,
                            amount: totalAmountPaidByRider,
                            method: '',
                            reference: ''
                        },
                        adminComments: [riderComment, horseComment].filter(Boolean).join(' | ') || '',
                        licence: licenseNo,
                        email: contactEmail,
                        phone: contactPhone,
                        address,
                        gender, bornYear, country, company, licenseYear
                    };
                } else {
                    const E = equipagesByClass[uniqueKey];
                    if (!E.mergedTestKey || !E.mergedTestLabel) {
                        const base = normalizeTestForMerge(tdbClassLabel || className || '');
                        E.mergedTestKey = base.key;
                        E.mergedTestLabel = base.label;
                    }
                    if (E.tdbClassNumber == null) {
                        E.tdbClassNumber = tdbClassNumber;
                        E.tdbClassLabel = (propInfo && propInfo.label) || '';
                        E.tdbHorseCode = ((propInfo && propInfo.horse) || '').toUpperCase();
                        E.tdbHorseText = horseTypeMap[E.tdbHorseCode] || '';
                        if (!E.tdbOriginalXmlClassName) E.tdbOriginalXmlClassName = className || '';
                    }
                    if (equipageStatus !== 'struken') equipagesByClass[uniqueKey].status = 'anmäld';
                    if (!equipagesByClass[uniqueKey].horses.some(h => h.name === horse.name)) {
                        equipagesByClass[uniqueKey].horses.push(horse);
                    }
                    const pay = (equipagesByClass[uniqueKey].payment ||= {});
                    if (paymentStatus) pay.status = paymentStatus;
                    if (hasPaidAmount) pay.amount = totalAmountPaidByRider;
                }
            });
        });
    });

    for (const [driverName, fees] of administrativeFeesByDriver.entries()) {
        Object.keys(equipagesByClass).forEach(key => {
            if (!key.startsWith(driverName + '|')) return;
            const equipage = equipagesByClass[key];
            if (!equipage.administrativeFees) {
                equipage.administrativeFees = [];
            }
            fees.forEach(fee => {
                if (!equipage.administrativeFees.includes(fee)) {
                    equipage.administrativeFees.push(fee);
                }
            });
        });
    }

    let tempStartNumber = 1;
    const finalEquipages = Object.values(equipagesByClass).map(eq => {
        if (eq.status !== 'struken') eq.startNumber = tempStartNumber++;
        return eq;
    });

    finalEquipages.sort((a, b) => {
        if (a.status === 'struken' && b.status !== 'struken') return 1;
        if (a.status !== 'struken' && b.status === 'struken') return -1;
        return (a.startNumber || 9999) - (b.startNumber || 9999);
    });

    return { equipages: finalEquipages, competitionInfo };
}

