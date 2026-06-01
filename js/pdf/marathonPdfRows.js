function timestampToMs(value) {
  if (!value) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function normalizeObstacleNumber(obstacle) {
  return String(obstacle?.number || obstacle?.obstacleNumber || obstacle?.id || '').trim();
}

export function buildMarathonHoldDeductionRows(obstacles = [], obstacleTimes = {}, formatTime = () => '—') {
  return (Array.isArray(obstacles) ? obstacles : [])
    .map(obstacle => {
      const holdTimeSec = Number(obstacle?.holdTimeSec || 0);
      if (!Number.isFinite(holdTimeSec) || holdTimeSec <= 0) return null;

      const obstacleNumber = normalizeObstacleNumber(obstacle);
      const times = obstacleTimes[String(obstacleNumber)] || {};
      const enteredAt = times.enteredAtClient || times.enteredAt || obstacle.enteredAtClient || obstacle.enteredAt;
      const exitAt = times.exitAtClient || times.exitAt || obstacle.exitAtClient || obstacle.exitAt;
      const timeLabel = [enteredAt, exitAt]
        .map(value => timestampToMs(value))
        .map(value => (value ? formatTime(value) : '—'))
        .join(' / ');

      return {
        obstacleNumber: obstacleNumber || '—',
        timeLabel,
        holdTimeSec,
        reason: String(obstacle.comment || '').trim() || '—'
      };
    })
    .filter(Boolean);
}

export function formatMarathonStageTimeLabel(durationMs, holdTimeMs, formatDuration) {
  const timeLabel = Number.isFinite(durationMs) ? formatDuration(durationMs) : '—';
  if (!Number.isFinite(holdTimeMs) || holdTimeMs <= 0) return timeLabel;
  return `Netto: ${timeLabel}\nAvdrag uppehåll: -${Math.round(holdTimeMs / 1000)}s`;
}
