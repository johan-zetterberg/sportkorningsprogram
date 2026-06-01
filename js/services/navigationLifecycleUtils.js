export function getPageUnloadFunction(pageModule) {
  if (!pageModule || typeof pageModule !== 'object') return null;
  if (typeof pageModule.__unload === 'function') return pageModule.__unload;
  if (typeof pageModule.unload === 'function') return pageModule.unload;
  return null;
}

export function isStaleNavigation(navigationId, activeNavigationId) {
  return navigationId !== activeNavigationId;
}
