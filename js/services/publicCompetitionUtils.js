function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseDateTime(value) {
  if (!value || typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatPublicTimeWindow(entries) {
  const dates = toArray(entries)
    .map(parseDateTime)
    .filter(Boolean)
    .sort((a, b) => a - b);

  if (!dates.length) return 'Ej publicerad';

  const fmt = (date) => date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  return dates.length === 1 ? fmt(dates[0]) : `${fmt(dates[0])} - ${fmt(dates[dates.length - 1])}`;
}

export function buildPublicMergeMap(...configs) {
  const mergeMap = new Map();

  configs.filter(Boolean).forEach((raw) => {
    const source = raw?.mergeByClassNumber && typeof raw.mergeByClassNumber === 'object'
      ? raw.mergeByClassNumber
      : raw;

    if (!source || typeof source !== 'object' || Array.isArray(source)) return;

    Object.entries(source).forEach(([groupKey, info]) => {
      const members = toArray(info?.members)
        .map(Number)
        .filter(Number.isFinite)
        .sort((a, b) => a - b);

      if (!members.length) return;

      const label = String(info?.label || `Sammanslagen: TDB #${members.join('/')}`);
      const key = String(groupKey || `TDBGROUP:${members.join('+')}`);
      members.forEach((member) => mergeMap.set(member, { key, label }));
    });
  });

  return mergeMap;
}

export function resolvePublicDisplayClass(equipage, mergeMap = new Map()) {
  if (equipage?.useMergedTestForDisplay && equipage?.mergedTestKey && equipage?.mergedTestLabel) {
    return {
      key: String(equipage.mergedTestKey),
      label: String(equipage.mergedTestLabel)
    };
  }

  const tdbClassNumber = Number(equipage?.tdbClassNumber);
  const merged = Number.isFinite(tdbClassNumber) ? mergeMap.get(tdbClassNumber) : null;
  if (merged) {
    return {
      key: String(merged.key),
      label: String(merged.label)
    };
  }

  const className = String(equipage?._mergedLabel || equipage?.className || '').trim();
  return {
    key: String(equipage?.classId || className || 'okand'),
    label: className
  };
}

function parseDrivenObstacles(value, allObstacles) {
  const allNumbers = toArray(allObstacles)
    .map(o => Number(o.number))
    .filter(Number.isFinite);

  if (!value || typeof value !== 'string') return allNumbers;

  return value
    .split(/[,\s;]+/)
    .map(v => Number(v))
    .filter(Number.isFinite);
}

function commonValue(values) {
  const normalized = values
    .map(value => value ?? null)
    .filter(value => value !== null && value !== '');

  if (!normalized.length) return null;
  return normalized.every(value => String(value) === String(normalized[0])) ? normalized[0] : null;
}

export function buildPublicMarathonDetails(classNames, maratonConfig, marathonObstacles) {
  const classDataList = toArray(classNames)
    .map(className => maratonConfig?.marathonClassData?.[className] || {})
    .filter(Boolean);
  const obstacleMap = new Map(toArray(marathonObstacles).map(o => [Number(o.number), o]));
  const numbers = new Set();

  classDataList.forEach((classData) => {
    parseDrivenObstacles(classData.drivenObstacles, marathonObstacles)
      .forEach(number => numbers.add(Number(number)));
  });

  const drivenObstacles = Array.from(numbers)
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
    .map((number) => {
      const obstacle = obstacleMap.get(number);
      return {
        number,
        name: obstacle?.name || '',
        gateCount: obstacle?.gateCount ?? commonValue(classDataList.map(data => data.gateCount))
      };
    });

  return {
    gateCount: commonValue(classDataList.map(data => data.gateCount)),
    drivenObstacles,
    distanceA: commonValue(classDataList.map(data => data.distanceA)),
    distanceB: commonValue(classDataList.map(data => data.distanceB)),
    distanceT: commonValue(classDataList.map(data => data.distanceT))
  };
}

export function buildPublicPrecisionDetails(classNames, precisionConfig) {
  const courses = toArray(classNames)
    .map(className => precisionConfig?.courses?.[className] || {})
    .filter(Boolean);
  const obstacleLabels = Array.from(new Set(courses.flatMap(course => toArray(course.obstacleLabels))))
    .filter(Boolean);

  return {
    trackLengthMeters: commonValue(courses.map(course => course.trackLengthMeters)),
    tempo: commonValue(courses.map(course => course.tempo)),
    obstacleLabels,
    specialPortAllowance: courses.reduce((acc, course) => ({ ...acc, ...(course.specialPortAllowance || {}) }), {})
  };
}

export function buildPublicClassSummary({
  equipages = [],
  startTimes = {},
  mergeMap = new Map(),
  maratonConfig = {},
  precisionConfig = {},
  marathonObstacles = []
} = {}) {
  const classMap = new Map();

  toArray(equipages).forEach((eq) => {
    const displayClass = resolvePublicDisplayClass(eq, mergeMap);
    const className = displayClass.label;
    if (!className) return;

    if (!classMap.has(displayClass.key)) {
      classMap.set(displayClass.key, {
        className,
        starters: 0,
        dressage: [],
        marathon: [],
        precision: [],
        sourceClassNames: new Set()
      });
    }

    const row = classMap.get(displayClass.key);
    row.starters += 1;
    if (eq.className) row.sourceClassNames.add(String(eq.className));

    const sn = String(eq.startNumber || eq.id || '').trim();
    const times = startTimes[sn] || {};
    if (times.dressage) row.dressage.push(times.dressage);
    if (times.marathon) row.marathon.push(times.marathon);
    if (times.precision) row.precision.push(times.precision);
  });

  return Array.from(classMap.values())
    .map((row) => {
      const sourceClassNames = Array.from(row.sourceClassNames);
      return {
        className: row.className,
        starters: row.starters,
        dressageWindow: formatPublicTimeWindow(row.dressage),
        marathonWindow: formatPublicTimeWindow(row.marathon),
        precisionWindow: formatPublicTimeWindow(row.precision),
        marathonDetails: buildPublicMarathonDetails(sourceClassNames, maratonConfig, marathonObstacles),
        precisionDetails: buildPublicPrecisionDetails(sourceClassNames, precisionConfig)
      };
    })
    .sort((a, b) => a.className.localeCompare(b.className, 'sv'));
}
