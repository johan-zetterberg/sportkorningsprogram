import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMarathonPdfTableOptions,
  buildMarathonPdfFileName,
  buildMarathonPdfSections,
  drawMarathonPdfHeader,
  findMarathonPdfSection,
  getMarathonPdfBaseStyles,
  renderMarathonPdfPages
} from '../js/pages/marathon/maratonTiderPdfUtils.js';

function fakeSection(title, hasTable = true) {
  const table = hasTable ? { tagName: 'TABLE', title } : null;
  return {
    querySelector(selector) {
      if (selector === 'h3') return { textContent: title };
      if (selector === 'table') return table;
      return null;
    }
  };
}

test('buildMarathonPdfSections extracts titled table sections only', () => {
  const host = {
    children: [
      fakeSection('Stracka A', true),
      fakeSection('Missing table', false),
      {},
      fakeSection('Transport', true)
    ]
  };

  const sections = buildMarathonPdfSections(host);

  assert.deepEqual(sections.map(section => section.title), ['Stracka A', 'Transport']);
  assert.equal(sections[0].table.tagName, 'TABLE');
});

test('findMarathonPdfSection resolves stage labels robustly', () => {
  const sections = [
    { title: 'Stracka A', table: 'A' },
    { title: 'Transport', table: 'T' },
    { title: 'Sträcka B', table: 'B' }
  ];

  assert.equal(findMarathonPdfSection(sections, 'A').table, 'A');
  assert.equal(findMarathonPdfSection(sections, 'Transport').table, 'T');
  assert.equal(findMarathonPdfSection(sections, 'Sträcka B').table, 'B');
  assert.equal(findMarathonPdfSection(sections, 'C'), null);
});

test('marathon pdf filename and styles are stable', () => {
  assert.equal(buildMarathonPdfFileName(12, 'Anna Andersson'), 'maraton_hallttider_12_Anna_Andersson.pdf');
  assert.equal(buildMarathonPdfFileName('', ''), 'maraton_hallttider__ekipage.pdf');
  assert.deepEqual(getMarathonPdfBaseStyles(), {
    font: 'helvetica',
    headFontSize: 12,
    bodyFontSize: 11,
    timeFontSize: 12,
    rowMinH: 28,
    cellPad: 4
  });
});

test('buildMarathonPdfTableOptions highlights time columns', () => {
  const base = getMarathonPdfBaseStyles();
  const options = buildMarathonPdfTableOptions({ startY: 150, base, marginX: 40 });
  const data = {
    table: {
      head: [{ cells: [{ raw: { textContent: 'Tillaten tid' } }] }]
    },
    column: { index: 0 },
    cell: { styles: {} }
  };

  options.didParseCell(data);

  assert.equal(options.startY, 150);
  assert.deepEqual(options.margin, { left: 40, right: 40 });
  assert.equal(data.cell.styles.fontSize, base.timeFontSize);
  assert.equal(data.cell.styles.fontStyle, 'bold');
});

test('drawMarathonPdfHeader writes title, identity and logo', () => {
  const calls = [];
  const pdf = {
    setFont(...args) { calls.push(['setFont', ...args]); return this; },
    setFontSize(...args) { calls.push(['setFontSize', ...args]); return this; },
    text(...args) { calls.push(['text', ...args]); return this; },
    addImage(...args) { calls.push(['addImage', ...args]); return this; }
  };

  drawMarathonPdfHeader(pdf, {
    base: getMarathonPdfBaseStyles(),
    marginX: 40,
    pageWidth: 595,
    stageLabel: 'Stracka A',
    distMeters: 1200,
    tempoLabel: '14 km/h',
    driverName: 'Anna Andersson',
    startNumber: 12,
    displayClassName: 'Latt A',
    className: 'Latt A',
    clubName: 'Testklubben',
    flagImg: { dataUrl: 'flag', w: 48, h: 32 },
    clubImg: { dataUrl: 'club', w: 32, h: 16 },
    logoImg: { dataUrl: 'logo', w: 200, h: 100 },
    title: 'Halltider',
    driverFallback: 'Kusk'
  });

  assert(calls.some(call => call[0] === 'text' && call[1] === '#12 Anna Andersson'));
  assert(calls.some(call => call[0] === 'text' && call[1] === 'Halltider (Stracka A)'));
  assert(calls.some(call => call[0] === 'text' && String(call[1]).includes('Testklubben')));
  assert.equal(calls.filter(call => call[0] === 'addImage').length, 3);
});

test('renderMarathonPdfPages renders A, B and transport pages in order', () => {
  const calls = [];
  const pdf = {
    lastAutoTable: null,
    addPage() { calls.push(['addPage']); },
    deletePage(page) { calls.push(['deletePage', page]); },
    autoTable(opt) {
      calls.push(['autoTable', opt.html]);
      this.lastAutoTable = { finalY: opt.startY + 42 };
    }
  };
  const drawHeader = (...args) => calls.push(['drawHeader', ...args]);

  renderMarathonPdfPages({
    pdf,
    sections: [
      { title: 'Stracka A', table: 'tableA' },
      { title: 'Stracka B', table: 'tableB' },
      { title: 'Transport', table: 'tableT' }
    ],
    base: getMarathonPdfBaseStyles(),
    marginX: 40,
    drawHeader,
    distances: { A: 1000, B: 1200, T: 800 },
    tempoLabels: { A: '14 km/h', B: '13 km/h', T: '200 m/min' }
  });

  assert.deepEqual(calls.map(call => call[0]), [
    'drawHeader',
    'autoTable',
    'addPage',
    'drawHeader',
    'autoTable',
    'addPage',
    'drawHeader',
    'autoTable'
  ]);
  assert.deepEqual(
    calls.filter(call => call[0] === 'autoTable').map(call => call[1]),
    ['tableA', 'tableB', 'tableT']
  );
});

test('renderMarathonPdfPages removes empty first page when A table is missing', () => {
  const calls = [];
  const pdf = {
    lastAutoTable: null,
    addPage() { calls.push(['addPage']); },
    deletePage(page) { calls.push(['deletePage', page]); },
    autoTable(opt) {
      calls.push(['autoTable', opt.html]);
      this.lastAutoTable = { finalY: opt.startY + 42 };
    }
  };

  renderMarathonPdfPages({
    pdf,
    sections: [{ title: 'Stracka B', table: 'tableB' }],
    base: getMarathonPdfBaseStyles(),
    marginX: 40,
    drawHeader: (...args) => calls.push(['drawHeader', ...args]),
    distances: { A: 0, B: 1200, T: 0 },
    tempoLabels: { B: '13 km/h' }
  });

  assert(calls.some(call => call[0] === 'deletePage' && call[1] === 1));
  assert.deepEqual(calls.filter(call => call[0] === 'autoTable').map(call => call[1]), ['tableB']);
});
