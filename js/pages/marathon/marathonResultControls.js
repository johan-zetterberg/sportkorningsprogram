import { setupMarathonResultExportButtons } from './marathonResultExports.js';

export function wireMarathonResultControls({
  setViewMode,
  toggleFinalized,
  toggleOnB,
  setShowOnlyFinalized,
  render,
  getEquipages,
  getMarathonMap,
  showDetailsModal,
  getMarathonConfig,
  filteredSortedEquipages,
  getMaxObstacleNo,
  getActiveStages,
  buildPlacementsByClass,
  timingDocFor,
  startTimeFor,
  fmtClock,
  sortState
}) {
  const btnStart = document.getElementById('marBtnStartOrder');
  const btnClass = document.getElementById('marBtnByClass');
  const btnFin = document.getElementById('marToggleFinalized');
  const btnOnB = document.getElementById('marToggleOnB');

  if (btnStart) btnStart.onclick = () => { setViewMode('startorder'); render(); };
  if (btnClass) btnClass.onclick = () => { setViewMode('byclass'); render(); };

  if (btnFin) btnFin.onclick = () => { toggleFinalized(); render(); };
  if (btnOnB) btnOnB.onclick = () => { toggleOnB(); render(); };

  const mobileSort = document.getElementById('mobileSortSelect');
  if (mobileSort) {
    mobileSort.onchange = (e) => {
      setViewMode(e.target.value);
      render();
    };
  }

  const mobileFin = document.getElementById('mobileFinalizedCheck');
  if (mobileFin) {
    mobileFin.onchange = (e) => {
      setShowOnlyFinalized(e.target.checked);
      render();
    };
  }

  const cards = document.getElementById('marathonCards');
  if (cards) {
    cards.onclick = (e) => {
      const card = e.target.closest('[data-sn]');
      if (!card) return;
      const sn = card.dataset.sn;
      showDetailsModal(sn, getEquipages(), getMarathonMap());
    };
  }

  setupMarathonResultExportButtons({
    getEquipages,
    getMarathonConfig,
    getMarathonMap,
    filteredSortedEquipages,
    getMaxObstacleNo,
    getActiveStages,
    buildPlacementsByClass,
    timingDocFor,
    startTimeFor,
    fmtClock
  });

  const table = document.getElementById('marathonTable');
  if (!table) return;

  const thead = document.getElementById('marathonTableHead');
  if (thead) {
    thead.onclick = (e) => {
      const th = e.target.closest('th[data-sort-key]');
      if (!th) return;
      const key = th.dataset.sortKey;
      if (sortState.key === key) {
        sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
      } else {
        sortState.key = key;
        sortState.dir = 'asc';
      }
      render();
    };
  }

  table.onclick = (e) => {
    if (e.target.closest('thead')) return;

    const targetEl = e.target.closest('tr[data-sn]') || e.target.closest('button[data-sn]');
    if (!targetEl) return;
    const sn = targetEl.getAttribute('data-sn');
    if (!sn) return;

    if (e.target.closest('button') && !e.target.closest('.eqLink')) return;

    e.preventDefault();
    showDetailsModal(sn, getEquipages(), getMarathonMap());
  };
}
