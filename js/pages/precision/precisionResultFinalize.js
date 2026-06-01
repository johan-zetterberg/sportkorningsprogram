export function isPrecisionFinalized(startNumber, precisionMap = new Map(), finalizeCache = new Map()) {
  const sn = String(startNumber);
  const data = precisionMap.get(sn);
  if (data && typeof data.finalized === 'boolean') return data.finalized;
  if (finalizeCache.has(sn)) return finalizeCache.get(sn);
  return false;
}

export function patchPrecisionFinalizeBadge(startNumber, finalized, root = document) {
  const sn = String(startNumber);
  const finalBadge = root.querySelector(`#prec-final-badge-${sn}`);
  const finalizeButton = root.querySelector(`[data-prec-action="finalize"][data-sn="${sn}"]`);
  const unfinalizeButton = root.querySelector(`[data-prec-action="unfinalize"][data-sn="${sn}"]`);

  if (finalBadge) finalBadge.style.display = finalized ? 'inline-flex' : 'none';
  if (finalizeButton) finalizeButton.style.display = finalized ? 'none' : '';
  if (unfinalizeButton) unfinalizeButton.style.display = finalized ? '' : 'none';
}

export function renderPrecisionFinalizeButtons(options = {}) {
  const {
    startNumber,
    finalized = false,
    canFinalize = false,
    labels = {}
  } = options;

  if (!canFinalize) return '';

  const sn = String(startNumber);
  const finalizedBadge = labels.finalizedBadge || 'Finaliserad';
  const finalizeLabel = labels.finalize || 'Finalisera';
  const undoLabel = labels.undo || 'Ångra';

  return `
    <div class="mt-2 flex items-center justify-center gap-2" data-prec-finalize-slot>
      <span id="prec-final-badge-${sn}"
            class="inline-flex items-center px-2 py-1 rounded text-[11px] font-medium bg-emerald-100 text-emerald-800"
            style="display:${finalized ? 'inline-flex' : 'none'}">
        ${finalizedBadge}
      </span>
      <button type="button" data-prec-action="finalize" data-sn="${sn}" class="px-2 py-1 text-xs rounded bg-emerald-600 text-white hover:bg-emerald-700" style="display:${finalized ? 'none' : ''}" >${finalizeLabel}</button>
      <button type="button" data-prec-action="unfinalize" data-sn="${sn}" class="px-2 py-1 text-xs rounded border border-emerald-600 text-emerald-700 hover:bg-emerald-50" style="display:${finalized ? '' : 'none'}" >${undoLabel}</button>
    </div>`;
}

export function buildPrecisionFinalizePayload(currentData = {}) {
  return { prioritized: true, ...currentData, finalized: true };
}

export function buildPrecisionUnfinalizePayload() {
  return { finalized: false };
}
