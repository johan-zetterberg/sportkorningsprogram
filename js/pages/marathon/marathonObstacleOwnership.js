export function isObstacleStateOwnedByAnotherObstacle(state, obstacleNumber) {
  if (!state || state.currentObstacle == null || obstacleNumber == null) return false;
  if (Number(state.currentObstacle) === Number(obstacleNumber)) return false;

  return state.running === true || state.inProgress === true;
}

export function markObstacleUpdateInProgress(update) {
  const value = update && typeof update === 'object' ? update : {};
  const explicitlySetsProgress = Object.prototype.hasOwnProperty.call(value, 'inProgress');
  const editsLiveField = Object.keys(value).some((key) => key.startsWith('live_'));
  return !explicitlySetsProgress && editsLiveField
    ? { ...value, inProgress: true }
    : value;
}
