// Pages tell the update prompt (js/appUpdate.js) when a reload would lose or
// interrupt work: unsaved drafts, a running clock. Then a new version only asks
// the user to reload instead of reloading the tab. Kept on globalThis so every
// copy of this module shares one list.

const checks = globalThis.__unsavedWorkChecks || (globalThis.__unsavedWorkChecks = new Map());

/** Registers a check (true = work would be lost or interrupted); returns an unregister function */
export function registerUnsavedWork(name, check) {
  checks.set(name, check);
  return () => { if (checks.get(name) === check) checks.delete(name); };
}

/** Names of the checks that report work now; a check that fails counts as work */
export function unsavedWorkReasons() {
  const reasons = [];
  for (const [name, check] of checks) {
    let busy = true;
    try { busy = !!check(); } catch { /* unknown: keep the work */ }
    if (busy) reasons.push(name);
  }
  return reasons;
}
