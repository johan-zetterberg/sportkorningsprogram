export function buildSnapshotErrorHandler(name, callback, fallbackValue) {
  return (error) => {
    console.error(`${name} listener error:`, error);
    if (typeof callback === 'function') {
      callback(fallbackValue);
    }
  };
}
