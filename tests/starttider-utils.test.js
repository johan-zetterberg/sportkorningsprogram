import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addPauseAfterStartNumber,
  assignBulkStartTimes,
  buildLiveStatus,
  buildMarathonDressageResultRows,
  buildPrecisionDressageOrderRows,
  buildPrecisionResultOrderRows,
  buildStarttiderClassOptions,
  buildStarttiderMergeMap,
  byStartNumberAsc,
  formatDateTime,
  getStarttiderPublishButtonView,
  getPublishedState,
  getTimesOnlyPayload,
  moveStartTimeRow,
  parseDateTime,
  recalculateStartTimesFrom,
  renderStarttiderActionButtons,
  renderStarttiderDesktopBody,
  renderStarttiderDesktopHeader,
  renderStarttiderDesktopRow,
  renderStarttiderMobileCard,
  renderStarttiderNowNextChip,
  renderStarttiderPublishResetSection,
  renderStarttiderStatusBadge,
  renderStarttiderTimeCell,
  renderStarttiderToolbarSection,
  reorderStartTimeRow,
  resolveStarttiderStatus,
  resolveStarttiderMergeGrouping,
  toDateTimeLocalString
} from '../js/pages/admin/starttiderUtils.js';

test('buildStarttiderMergeMap maps TDB class numbers to display groups', () => {
  const mergeMap = buildStarttiderMergeMap({
    mergeByClassNumber: {
      'TDBGROUP:1+2': { label: 'Lätt A', members: [2, '1', 'bad'] }
    }
  });

  assert.deepEqual(mergeMap.get(1), { key: 'TDBGROUP:1+2', label: 'Lätt A' });
  assert.deepEqual(mergeMap.get(2), { key: 'TDBGROUP:1+2', label: 'Lätt A' });
  assert.equal(mergeMap.has(Number.NaN), false);
});

test('resolveStarttiderMergeGrouping prefers equipage display override', () => {
  const mergeMap = buildStarttiderMergeMap({
    'TDBGROUP:3+4': { label: 'MSV', members: [3, 4] }
  });

  assert.deepEqual(
    resolveStarttiderMergeGrouping({
      className: 'Original',
      tdbClassNumber: 3,
      useMergedTestForDisplay: true,
      mergedTestKey: 'TEST:LA',
      mergedTestLabel: 'Lätt A'
    }, mergeMap),
    { key: 'TEST:LA', label: 'Lätt A' }
  );
});

test('resolveStarttiderMergeGrouping falls back to TDB group and original class', () => {
  const mergeMap = buildStarttiderMergeMap({
    'TDBGROUP:3+4': { label: 'MSV', members: [3, 4] }
  });

  assert.deepEqual(
    resolveStarttiderMergeGrouping({ className: 'Original', tdbClassNumber: 4 }, mergeMap),
    { key: 'TDBGROUP:3+4', label: 'MSV' }
  );
  assert.deepEqual(
    resolveStarttiderMergeGrouping({ className: 'Original' }, mergeMap),
    { key: 'Original', label: 'Original' }
  );
});

test('start times payload keeps published outside times', () => {
  const startTimes = {
    1: { dressage: '2026-05-25T09:00' },
    published: { dressage: true, marathon: false, precision: false }
  };

  assert.deepEqual(getTimesOnlyPayload(startTimes), {
    1: { dressage: '2026-05-25T09:00' }
  });
  assert.deepEqual(getPublishedState(startTimes), {
    dressage: true,
    marathon: false,
    precision: false
  });
});

test('getStarttiderPublishButtonView builds published and unpublished button state', () => {
  const published = getStarttiderPublishButtonView('dressage', { dressage: true }, {
    colorClass: 'bg-slate-600',
    borderClass: 'border-slate-300',
    shortLabel: 'D'
  });

  assert.equal(published.isPublished, true);
  assert.equal(published.label, 'Publicerad (D)');
  assert.match(published.className, /bg-slate-600/);
  assert.match(published.className, /ring-slate-500/);

  const unpublished = getStarttiderPublishButtonView('precision', { precision: false }, {
    colorClass: 'bg-indigo-600',
    borderClass: 'border-indigo-300',
    shortLabel: 'P'
  });

  assert.equal(unpublished.isPublished, false);
  assert.equal(unpublished.label, 'Publicera P');
  assert.match(unpublished.className, /border-indigo-300/);
  assert.match(unpublished.className, /opacity-80/);
});

test('buildStarttiderClassOptions returns unique sorted classes and option html', () => {
  const result = buildStarttiderClassOptions([
    { className: 'MSV' },
    { className: 'Lätt A' },
    { className: 'MSV' },
    { _mergedLabel: 'Sammanslagen', className: 'Lätt B' },
    { className: '' },
    {}
  ], 'Alla');

  assert.deepEqual(result.classes, ['Lätt A', 'MSV', 'Sammanslagen']);
  assert.match(result.html, /<option value="">Alla<\/option>/);
  assert.match(result.html, /<option value="Sammanslagen">Sammanslagen<\/option>/);
});

test('renderStarttiderPublishResetSection preserves control ids and labels', () => {
  const html = renderStarttiderPublishResetSection({
    publishButtons: {
      dressage: { className: 'dressage-class', label: 'Publicera D' },
      marathon: { className: 'marathon-class', label: 'Publicera M' },
      precision: { className: 'precision-class', label: 'Publicera P' }
    },
    labels: {
      publishTitle: 'Publicering',
      resetTitle: 'Rensa',
      clearDressage: 'Rensa D',
      clearMarathon: 'Rensa M',
      clearPrecision: 'Rensa P'
    }
  });

  assert.match(html, /id="pubDressage"/);
  assert.match(html, /id="pubMarathon"/);
  assert.match(html, /id="pubPrecision"/);
  assert.match(html, /id="clearDressage"/);
  assert.match(html, /id="clearMarathon"/);
  assert.match(html, /id="clearPrecision"/);
  assert.match(html, /Publicering/);
  assert.match(html, /Rensa P/);
  assert.match(html, /precision-class/);
});

test('renderStarttiderToolbarSection preserves toolbar ids and public mode save visibility', () => {
  const editorHtml = renderStarttiderToolbarSection({
    publicMode: false,
    labels: {
      publicMode: 'Publikt',
      saveTimes: 'Spara',
      startOrder: 'Startordning',
      groupByClass: 'Klass',
      pdfDressage: 'PDF D',
      pdfMarathon: 'PDF M',
      pdfPrecision: 'PDF P'
    }
  });

  assert.match(editorHtml, /id="togglePublic"/);
  assert.match(editorHtml, /id="btnSaveTimes"/);
  assert.match(editorHtml, /id="viewModeStartOrder"/);
  assert.match(editorHtml, /id="viewModeByClass"/);
  assert.match(editorHtml, /id="pdfDropdownContainer"/);
  assert.match(editorHtml, /id="btnPdfDropdown"/);
  assert.match(editorHtml, /id="pdfDropdownMenu"/);
  assert.match(editorHtml, /id="btnExportStarttiderCsv"/);
  assert.match(editorHtml, /data-action="pdf-dressage"/);
  assert.match(editorHtml, /PDF P/);

  const publicHtml = renderStarttiderToolbarSection({
    publicMode: true,
    labels: { editorMode: 'Redigera' }
  });

  assert.match(publicHtml, /Redigera/);
  assert.doesNotMatch(publicHtml, /id="btnSaveTimes"/);
});

test('resolveStarttiderStatus detects discipline states', () => {
  assert.equal(resolveStarttiderStatus('dressage', '1', {
    dressageFinalizationMap: new Map([['1', { finalized: true }]])
  }), 'done');
  assert.equal(resolveStarttiderStatus('dressage', '2', {
    dressageStatusMap: new Map([['2', { state: 'ongoing' }]])
  }), 'running');
  assert.equal(resolveStarttiderStatus('precision', '3', {
    precisionResultsMap: new Map([['3', { running: true }]])
  }), 'running');
  assert.equal(resolveStarttiderStatus('precision', '4', {
    precisionResultsMap: new Map([['4', { time: 82 }]])
  }), 'done');
  assert.equal(resolveStarttiderStatus('marathon', '5', {
    marathonStatusMap: new Map([['5', { start_A: '2026-05-25T10:00' }]])
  }), 'running');
  assert.equal(resolveStarttiderStatus('marathon', '6', {
    marathonTimingMap: new Map([['6', { netTimeSeconds: 123 }]])
  }), 'done');
  assert.equal(resolveStarttiderStatus('marathon', '7'), 'not-started');
});

test('buildLiveStatus finds current and next starts', () => {
  const live = buildLiveStatus({
    1: { dressage: '2026-05-25T09:00' },
    2: { marathon: '2026-05-25T09:04' },
    3: { precision: '2026-05-25T09:10' },
    published: { dressage: true }
  }, new Date('2026-05-25T09:08'));

  assert.deepEqual(live.current, { sn: 2, discipline: 'marathon' });
  assert.deepEqual(live.next, { sn: 3, discipline: 'precision' });
});

test('starttider render helpers output status and now/next chips', () => {
  assert.match(renderStarttiderStatusBadge('done', { doneLabel: 'Klar' }), /Klar/);
  assert.match(renderStarttiderStatusBadge('running', { runningLabel: 'Pågår' }), /bg-yellow-100/);
  assert.match(renderStarttiderStatusBadge('not-started', { notStartedLabel: 'Ej startad' }), /Ej startad/);

  const liveStatus = {
    current: { sn: 1, discipline: 'dressage' },
    next: { sn: 2, discipline: 'marathon' }
  };

  assert.match(renderStarttiderNowNextChip('dressage', 1, liveStatus, { nowLabel: 'Nu' }), /Nu/);
  assert.match(renderStarttiderNowNextChip('marathon', 2, liveStatus, { nextLabel: 'Nästa' }), /Nästa/);
  assert.equal(renderStarttiderNowNextChip('precision', 3, liveStatus), '');
});

test('renderStarttiderTimeCell renders readonly and editable cells', () => {
  const readonly = renderStarttiderTimeCell({
    discipline: 'dressage',
    startNumber: 1,
    value: '2026-05-25T09:05',
    editable: false,
    nowNextHtml: '<span>Nu</span>',
    statusHtml: '<span>Klar</span>'
  });

  assert.match(readonly, /09:05/);
  assert.match(readonly, /Klar/);
  assert.doesNotMatch(readonly, /datetime-local/);

  const editable = renderStarttiderTimeCell({
    discipline: 'precision',
    startNumber: 2,
    value: '2026-05-25T10:15',
    editable: true,
    publicMode: false,
    statusHtml: '<span>Ej startad</span>'
  });

  assert.match(editable, /id="precision-2"/);
  assert.match(editable, /type="datetime-local"/);
  assert.match(editable, /value="2026-05-25T10:15"/);
});

test('renderStarttiderActionButtons renders desktop and mobile controls', () => {
  const desktop = renderStarttiderActionButtons({
    discipline: 'dressage',
    startNumber: 12,
    index: 0,
    totalRows: 3,
    variant: 'desktop',
    labels: { pause: 'Paus', moveUp: 'Upp', moveDown: 'Ner' }
  });

  assert.match(desktop, /data-action="pause"/);
  assert.match(desktop, /data-discipline="dressage"/);
  assert.match(desktop, /data-sn="12"/);
  assert.match(desktop, /title="Upp"/);
  assert.match(desktop, /opacity-25/);
  assert.match(desktop, />D<\/span>/);

  const mobile = renderStarttiderActionButtons({
    discipline: 'precision',
    startNumber: 15,
    index: 2,
    totalRows: 3,
    variant: 'mobile'
  });

  assert.match(mobile, /Precision:/);
  assert.match(mobile, /data-dir="down"/);
  assert.match(mobile, /data-sn="15"/);
  assert.match(mobile, /opacity-25/);
});

test('renderStarttiderDesktopRow renders editable row with injected cells and actions', () => {
  const html = renderStarttiderDesktopRow({
    equipage: {
      startNumber: 12,
      driverName: 'Anna Andersson',
      className: 'Lätt A',
      clubName: 'Testklubben'
    },
    startTimes: {
      12: {
        dressage: '2026-05-25T09:00',
        marathon: '2026-05-25T11:00',
        precision: '2026-05-25T13:00'
      },
      published: { dressage: false, marathon: false, precision: false }
    },
    index: 0,
    totalRows: 2,
    isEditable: true,
    enableDnD: true,
    isEliminated: true,
    getHorseLabel: () => 'Hästen',
    getFlagHtml: () => '<span>SE</span>',
    getClubLogoHtml: () => '<span>Logo</span>',
    renderTimeCell: (discipline, sn, value, editable) => `<time data-discipline="${discipline}" data-sn="${sn}" data-edit="${editable}">${value}</time>`,
    renderActions: discipline => `<button>${discipline}</button>`
  });

  assert.match(html, /draggable="true"/);
  assert.match(html, /bg-red-50/);
  assert.match(html, /Anna Andersson/);
  assert.match(html, /Hästen/);
  assert.match(html, /Testklubben/);
  assert.match(html, /data-discipline="dressage"/);
  assert.match(html, /data-edit="true"/);
  assert.match(html, /<button>precision<\/button>/);
});

test('renderStarttiderDesktopRow respects unpublished public times', () => {
  const html = renderStarttiderDesktopRow({
    equipage: { startNumber: 3, driverName: 'Public Rider' },
    startTimes: {
      3: { dressage: '2026-05-25T09:00' },
      published: { dressage: false, marathon: true, precision: true }
    },
    isEditable: false,
    publicMode: true,
    renderTimeCell: discipline => `<time>${discipline}</time>`,
    unpublishedHtml: '<span>Inte publicerad</span>'
  });

  assert.match(html, /Inte publicerad/);
  assert.match(html, /<time>marathon<\/time>/);
  assert.doesNotMatch(html, /<time>dressage<\/time>/);
  assert.doesNotMatch(html, /data-action="pause"/);
});

test('renderStarttiderMobileCard renders editable card with status and actions', () => {
  const html = renderStarttiderMobileCard({
    equipage: {
      startNumber: 7,
      driverName: 'Mobil Kusk',
      _mergedLabel: 'MSV',
      clubName: 'Mobilklubben'
    },
    startTimes: {
      7: { dressage: '2026-05-25T09:00' },
      published: { dressage: false, marathon: false, precision: false }
    },
    index: 1,
    totalRows: 3,
    isEditable: true,
    isEliminated: true,
    classHeaderHtml: '<div>Grupp</div>',
    getHorseLabel: () => 'Mobilhästen',
    renderStatus: discipline => `<span>${discipline}-status</span>`,
    renderActions: discipline => `<button>${discipline}-action</button>`,
    labels: { actions: 'Åtgärder' }
  });

  assert.match(html, /Grupp/);
  assert.match(html, /#7 Mobil Kusk/);
  assert.match(html, /Mobilhästen/);
  assert.match(html, /MSV/);
  assert.match(html, /bg-red-50/);
  assert.match(html, /id="dressage-7"/);
  assert.match(html, /dressage-status/);
  assert.match(html, /precision-action/);
});

test('renderStarttiderMobileCard respects unpublished public times', () => {
  const html = renderStarttiderMobileCard({
    equipage: { startNumber: 8, driverName: 'Publik Kusk', className: 'Lätt B' },
    startTimes: {
      8: { dressage: '2026-05-25T09:00', marathon: '2026-05-25T11:00' },
      published: { dressage: false, marathon: true, precision: false }
    },
    isEditable: false,
    getHorseLabel: () => 'Publikhäst',
    renderStatus: discipline => `<span>${discipline}</span>`,
    unpublishedHtml: '<span>Inte publicerad</span>'
  });

  assert.match(html, /Inte publicerad/);
  assert.match(html, /11:00/);
  assert.doesNotMatch(html, /id="dressage-8"/);
  assert.doesNotMatch(html, /action-btn/);
});

test('renderStarttiderDesktopHeader marks sortable sorted column', () => {
  const html = renderStarttiderDesktopHeader([
    { key: 'startNumber', label: '#' },
    { key: 'driverName', label: 'Ekipage' },
    { key: 'actions', label: 'Åtgärder' }
  ], { key: 'driverName', direction: 'desc' });

  assert.match(html, /<thead/);
  assert.match(html, /data-key="driverName"/);
  assert.match(html, /Ekipage ▼/);
  assert.match(html, /sortable-header/);
});

test('renderStarttiderDesktopBody renders grouped and start order rows', () => {
  const rows = [
    { startNumber: 2, className: 'B' },
    { startNumber: 1, className: 'A' }
  ];

  const startOrder = renderStarttiderDesktopBody(rows, {
    viewMode: 'startorder',
    renderRow: row => `<tr><td>${row.startNumber}</td></tr>`
  });
  assert.equal(startOrder.match(/<tr>/g).length, 2);
  assert.match(startOrder, />2<\/td>/);

  const grouped = renderStarttiderDesktopBody(rows, {
    viewMode: 'byclass',
    colspan: 7,
    renderRow: row => `<tr><td>${row.startNumber}</td></tr>`
  });

  assert.match(grouped, /colspan="7"/);
  assert.ok(grouped.indexOf('>A<') < grouped.indexOf('>B<'));
  assert.match(grouped, />1<\/td>/);
  assert.match(grouped, />2<\/td>/);
});

test('date helpers parse, format and sort start times', () => {
  const date = parseDateTime('2026-05-25T09:05');
  assert.equal(toDateTimeLocalString(date), '2026-05-25T09:05');
  assert.match(formatDateTime(date), /09:05/);
  assert.equal(parseDateTime('2026-05-25'), null);

  const sorted = [{ startNumber: 12 }, { startNumber: 2 }].sort(byStartNumberAsc);
  assert.deepEqual(sorted.map(row => row.startNumber), [2, 12]);
});

test('assignBulkStartTimes fills rows with interval and respects onlyEmpty', () => {
  const startTimes = { 2: { dressage: '2026-05-25T08:00' } };
  const rows = [{ startNumber: 1 }, { startNumber: 2 }, { startNumber: 3 }];

  const result = assignBulkStartTimes(startTimes, rows, {
    discipline: 'dressage',
    firstDateTime: new Date('2026-05-25T09:00'),
    intervalMin: 10,
    onlyEmpty: true
  });

  assert.equal(result.assignedCount, 2);
  assert.equal(startTimes[1].dressage, '2026-05-25T09:00');
  assert.equal(startTimes[2].dressage, '2026-05-25T08:00');
  assert.equal(startTimes[3].dressage, '2026-05-25T09:10');
});

test('addPauseAfterStartNumber shifts later starts only', () => {
  const startTimes = {
    1: { marathon: '2026-05-25T09:00' },
    2: { marathon: '2026-05-25T09:10' },
    3: { marathon: '2026-05-25T09:20' }
  };

  const result = addPauseAfterStartNumber(startTimes, [{ startNumber: 1 }, { startNumber: 2 }, { startNumber: 3 }], {
    discipline: 'marathon',
    afterStartNumber: 1,
    pauseMinutes: 15
  });

  assert.equal(result.changedCount, 2);
  assert.equal(startTimes[1].marathon, '2026-05-25T09:00');
  assert.equal(startTimes[2].marathon, '2026-05-25T09:25');
  assert.equal(startTimes[3].marathon, '2026-05-25T09:35');
});

test('recalculateStartTimesFrom preserves anchor rules', () => {
  const startTimes = {
    1: { precision: '2026-05-25T09:00' },
    2: { precision: '2026-05-25T09:10' },
    3: { precision: '2026-05-25T09:20' }
  };

  const result = recalculateStartTimesFrom(startTimes, [{ startNumber: 1 }, { startNumber: 2 }, { startNumber: 3 }], {
    discipline: 'precision',
    startIndex: 1,
    intervalMin: 7
  });

  assert.equal(result.error, null);
  assert.equal(startTimes[2].precision, '2026-05-25T09:07');
  assert.equal(startTimes[3].precision, '2026-05-25T09:14');
});

test('moveStartTimeRow and reorderStartTimeRow preserve schedule anchors', () => {
  const startTimes = {
    1: { dressage: '2026-05-25T09:00' },
    2: { dressage: '2026-05-25T09:10' },
    3: { dressage: '2026-05-25T09:20' }
  };

  const moved = moveStartTimeRow(startTimes, [{ startNumber: 1 }, { startNumber: 2 }, { startNumber: 3 }], {
    discipline: 'dressage',
    startNumber: 3,
    direction: 'up',
    intervalMin: 10
  });

  assert.equal(moved.error, null);
  assert.deepEqual(moved.sortedRows.map(row => row.startNumber), [1, 3, 2]);
  assert.equal(startTimes[3].dressage, '2026-05-25T09:10');
  assert.equal(startTimes[2].dressage, '2026-05-25T09:20');

  const reordered = reorderStartTimeRow(startTimes, moved.sortedRows, {
    discipline: 'dressage',
    droppedStartNumber: 1,
    targetStartNumber: 2,
    intervalMin: 10
  });

  assert.equal(reordered.error, null);
  assert.deepEqual(reordered.sortedRows.map(row => row.startNumber), [3, 2, 1]);
  assert.equal(startTimes[3].dressage, '2026-05-25T09:00');
  assert.equal(startTimes[2].dressage, '2026-05-25T09:10');
  assert.equal(startTimes[1].dressage, '2026-05-25T09:20');
});

test('buildPrecisionDressageOrderRows sorts by dressage start time', () => {
  const rows = [
    { startNumber: 3, className: 'Lätt A' },
    { startNumber: 1, className: 'Lätt A' },
    { startNumber: 2, className: 'Lätt A' }
  ];
  const startTimes = {
    1: { dressage: '2026-05-25T09:20' },
    2: { dressage: '2026-05-25T09:00' }
  };

  const sorted = buildPrecisionDressageOrderRows(rows, startTimes, {
    className: 'Lätt A',
    includeEliminated: true
  });

  assert.deepEqual(sorted.map(row => row.startNumber), [3, 2, 1]);
});

test('buildMarathonDressageResultRows ranks worst dressage first with diagnostics', () => {
  const rows = [{ startNumber: 1 }, { startNumber: 2 }, { startNumber: 3 }];
  const results = new Map([
    ['1', { penalty: 45 }],
    ['2', { penalty: 60 }],
    ['3', { eliminated: true }]
  ]);

  const { rankedRows, diagnostics } = buildMarathonDressageResultRows(rows, {
    includeEliminated: true,
    getDressageResult: row => results.get(String(row.startNumber)),
    getProtocolCount: row => row.startNumber
  });

  assert.deepEqual(rankedRows.map(row => row.startNumber), [3, 2, 1]);
  assert.deepEqual(diagnostics, {
    totalChecked: 3,
    totalProtos: 6,
    missingPenalties: 1
  });
});

test('buildPrecisionResultOrderRows ranks worst combined result first', () => {
  const rows = [{ startNumber: 1 }, { startNumber: 2 }, { startNumber: 3 }];
  const dressage = new Map([
    ['1', { penalty: 45 }],
    ['2', { penalty: 50 }],
    ['3', { penalty: 40 }]
  ]);
  const marathon = new Map([
    ['1', { totalPenalty: 20 }],
    ['2', { totalPenalty: 10 }],
    ['3', { eliminated: true, totalPenalty: null }]
  ]);

  const ranked = buildPrecisionResultOrderRows(rows, {
    includeEliminated: true,
    getDressageResult: row => dressage.get(String(row.startNumber)),
    getMarathonData: row => marathon.get(String(row.startNumber)),
    getMarathonResult: (_row, data) => data
  });

  assert.deepEqual(ranked.map(row => row.startNumber), [3, 1, 2]);
});
