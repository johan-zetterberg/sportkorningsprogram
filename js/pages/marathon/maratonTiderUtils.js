export function kmhToMmin(kmh) {
  return (Number(kmh) * 1000) / 60;
}

export function formatMaratonDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '-';
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function parseExtraDistancesInput(value) {
  return String(value || '')
    .split(',')
    .map(part => Number.parseInt(part.trim(), 10))
    .filter(distance => Number.isFinite(distance) && distance > 0);
}

export function buildMarathonCheckpoints(distanceMeters, extraDistances = [], { includeFinal300 = true } = {}) {
  const distance = Number(distanceMeters);
  if (!Number.isFinite(distance) || distance <= 0) return [];

  const checkpoints = [];
  const kmCount = Math.floor(distance / 1000);
  for (let km = 1; km <= kmCount; km++) checkpoints.push(km * 1000);

  const final300 = distance - 300;
  if (includeFinal300 && distance > 300 && !checkpoints.includes(final300)) {
    checkpoints.push(final300);
  }

  (extraDistances || []).forEach(extra => {
    const value = Number(extra);
    if (Number.isFinite(value) && value > 0 && value < distance && !checkpoints.includes(value)) {
      checkpoints.push(value);
    }
  });

  return checkpoints.sort((a, b) => a - b);
}

export function resolveWarmupMinutes(className, manualWarmupMinutes) {
  if (Number.isFinite(manualWarmupMinutes)) return manualWarmupMinutes;
  const normalizedClassName = String(className || '')
    .toLowerCase()
    .replace(/[\u00c3\u00e3][\u00a4\u00a5]/g, 'a')
    .normalize('NFD')
    .replace(/a[\u0308\u030a]/g, 'a')
    .replace(/[\u0308\u030a]/g, '');
  return /barn/.test(normalizedClassName) && /latt\s*b/.test(normalizedClassName) ? 10 : 20;
}

export function calculateStageTiming(distanceMeters, tempoKmh, windowMinutes, stage) {
  const distance = Number(distanceMeters);
  const tempo = Number(tempoKmh);
  if (!Number.isFinite(distance) || distance <= 0 || !Number.isFinite(tempo) || tempo <= 0) {
    return null;
  }

  const tempoMpm = kmhToMmin(tempo);
  const windowMs = Number(windowMinutes || 0) * 60000;
  const allowedMs = (distance / tempoMpm) * 60000;
  const minMs = Math.max(0, allowedMs - windowMs);
  const avgMs = (minMs + allowedMs) / 2;
  const timeLimitFactor = stage === 'A' ? 1.2 : 2.0;

  return {
    tempoMpm,
    allowedMs,
    minMs,
    avgMs,
    timeLimitMs: allowedMs * timeLimitFactor
  };
}

export function buildStageTimingRows(distanceMeters, tempoKmh, windowMinutes, stage, extraDistances = []) {
  const distance = Number(distanceMeters);
  const timing = calculateStageTiming(distance, tempoKmh, windowMinutes, stage);
  if (!timing) return null;

  const checkpoints = buildMarathonCheckpoints(distance, extraDistances);
  const rows = checkpoints.map(distanceAtCheckpoint => {
    const allowedMs = (distanceAtCheckpoint / timing.tempoMpm) * 60000;
    const minMs = (distanceAtCheckpoint / distance) * timing.minMs;
    return {
      distance: distanceAtCheckpoint,
      minMs,
      avgMs: (minMs + allowedMs) / 2,
      allowedMs,
      isFinal300: distanceAtCheckpoint === distance - 300
    };
  });

  rows.push({
    distance,
    minMs: timing.minMs,
    avgMs: timing.avgMs,
    allowedMs: timing.allowedMs,
    isFinal: true,
    isFinal300: false
  });

  return {
    ...timing,
    rows
  };
}

export function calculateTransportTiming(distanceMeters, tempoMpm, extraDistances = []) {
  const distance = Number(distanceMeters);
  const tempo = Number(tempoMpm);
  if (!Number.isFinite(distance) || distance <= 0 || !Number.isFinite(tempo) || tempo <= 0) {
    return null;
  }

  const checkpoints = buildMarathonCheckpoints(distance, extraDistances, { includeFinal300: false })
    .map(distanceAtCheckpoint => ({
      distance: distanceAtCheckpoint,
      timeMs: (distanceAtCheckpoint / tempo) * 60000
    }));

  return {
    allowedMs: (distance / tempo) * 60000,
    checkpoints
  };
}
