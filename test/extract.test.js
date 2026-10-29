const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../lib/extract.js');

test('layoutText keeps rows and column spacing', () => {
  const items = [
    { str: 'Copper Comet', x: 10, y: 700, w: 60, h: 10 },
    { str: '13Aug26', x: 10, y: 680, w: 35, h: 10 },
    { str: 'Sar', x: 50, y: 680.5, w: 15, h: 10 },
    { str: '104', x: 150, y: 679.8, w: 15, h: 10 },
  ];
  const lines = X.layoutText(items).split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0], 'Copper Comet');
  assert.match(lines[1], /^13Aug26 +Sar +104$/);
  assert.ok(lines[1].indexOf('104') > 20, 'wide gap preserved');
  assert.equal(X.layoutText([]), '');
});

test('buildPrompt includes product hint, date and material', () => {
  const p = X.buildPrompt({ product: 'ragozin', today: '2026-10-29', text: 'PAGE', source: 'a.pdf p.1' });
  assert.match(p, /this is: ragozin/);
  assert.match(p, /Today is 2026-10-29/);
  assert.match(p, /<page source="a.pdf p.1">\nPAGE\n<\/page>/);
  assert.match(X.buildPrompt({ images: 2 }), /attached images/);
});

test('normalizeExtraction validates and maps figures to the product column', () => {
  const r = X.normalizeExtraction({
    product: 'Ragozin',
    races: [
      { horse: 'Copper Comet (IRE)', date: '8/13/26', month: '2026-08', track: 'sar', distance: '6f', surface: 'd', figure: '4"' },
      { horse: 'Iron Quill', date: null, month: '2026-7', figure: '11-' },
      { horse: 'No Fig', date: '2026-08-01', figure: '' },
      { horse: 'Bad', date: '2026-08-01', figure: 'n/a' },
      'junk',
    ],
    notes: null,
  });
  assert.equal(r.product, 'ragozin');
  assert.equal(r.skipped, 3);
  assert.deepEqual(r.rows[0], { horse: 'Copper Comet', date: '2026-08-13', month: '2026-08', track: 'SAR', distance: '6f', surface: 'D', ragozin: '4"' });
  assert.deepEqual(r.rows[1], { horse: 'Iron Quill', month: '2026-07', ragozin: '11-' });
  assert.equal(X.normalizeExtraction({ product: 'mystery', races: [{ horse: 'A', figure: '90' }] }, 'beyer').rows[0].beyer, '90');
  assert.equal(X.normalizeExtraction({ product: 'mystery', races: [{ horse: 'A', figure: '90' }] }).rows.length, 0);
});

test('resolveMonthOnlyDates fills a day only when the match is unique', () => {
  const existing = [
    { horse: 'Copper Comet', date: '2026-08-13', track: 'SAR', beyer: '104' },
    { horse: 'Iron Quill', date: '2026-07-04', beyer: '90' },
    { horse: 'Iron Quill', date: '2026-07-25', beyer: '92' },
  ];
  const rows = [
    { horse: 'COPPER COMET', month: '2026-08', ragozin: '4' },
    { horse: 'Iron Quill', month: '2026-07', ragozin: '11' },
    { horse: 'Copper Comet', month: '2026-08', track: 'BEL', thorograph: '5' },
  ];
  assert.equal(X.resolveMonthOnlyDates(rows, existing), 1);
  assert.equal(rows[0].date, '2026-08-13');
  assert.equal(rows[1].date, undefined, 'two July races: ambiguous');
  assert.equal(rows[2].date, undefined, 'track mismatch');
});
