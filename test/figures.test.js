const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../lib/figures.js');
const SAMPLE_CSV = require('../lib/sample-data.js');

const src = (id, sources = F.cloneSources()) => sources.find((s) => s.id === id);

test('parseDistance handles common notations', () => {
  assert.equal(F.parseDistance('6f'), 6);
  assert.equal(F.parseDistance('6 1/2f'), 6.5);
  assert.equal(F.parseDistance('7½f'), 7.5);
  assert.equal(F.parseDistance('1m'), 8);
  assert.equal(F.parseDistance('1 1/16m'), 8.5);
  assert.equal(F.parseDistance('1 1/8 miles'), 9);
  assert.equal(F.parseDistance('1m70y'), 8.318);
  assert.equal(F.parseDistance('8.5'), 8.5);
  assert.equal(F.parseDistance('abc'), null);
  assert.equal(F.parseDistance(''), null);
});

test('parseFigure handles sheet notation', () => {
  assert.equal(F.parseFigure('104'), 104);
  assert.equal(F.parseFigure('12-'), 11.75);
  assert.equal(F.parseFigure('12+'), 12.25);
  assert.equal(F.parseFigure('9"'), 9.5);
  assert.equal(F.parseFigure('9½'), 9.5);
  assert.equal(F.parseFigure('F7'), 7);
  assert.equal(F.parseFigure('-2'), -2);
  assert.equal(F.parseFigure('-2"'), -2.5);
  assert.equal(F.parseFigure(''), null);
  assert.equal(F.parseFigure('n/a'), null);
});

test('toUnified and fromUnified are inverses', () => {
  for (const s of F.cloneSources()) {
    for (const d of ['6f', '1 1/8m']) {
      const uf = F.toUnified(s, 10, d);
      assert.ok(Math.abs(F.fromUnified(s, uf, d) - 10) < 1e-9, s.id);
    }
  }
});

test('lower sheet numbers mean faster, and a length is worth more in sprints', () => {
  const rag = src('ragozin');
  assert.ok(F.toUnified(rag, 5, '1m') > F.toUnified(rag, 10, '1m'));
  const sprintGap = F.toUnified(rag, 5, '6f') - F.toUnified(rag, 6, '6f');
  const routeGap = F.toUnified(rag, 5, '9f') - F.toUnified(rag, 6, '9f');
  assert.ok(Math.abs(sprintGap - 3) < 1e-9);
  assert.ok(Math.abs(routeGap - 2) < 1e-9);
});

test('combineRace blends available figures and skips blanks/disabled', () => {
  const sources = F.cloneSources();
  const c = F.combineRace({ distance: '1m', beyer: '100', brisnet: '', ragozin: '9' }, sources);
  assert.equal(c.n, 2);
  assert.ok(c.unified > 99 && c.unified < 101);
  src('ragozin', sources).enabled = false;
  assert.equal(F.combineRace({ distance: '1m', beyer: '100', ragozin: '9' }, sources).n, 1);
  assert.equal(F.combineRace({ horse: 'x' }, sources), null);
});

test('fitCalibration recovers a known scale', () => {
  const truth = { intercept: 112, slope: -2.6 };
  const races = [];
  for (let i = 0; i < 40; i++) {
    const beyer = 70 + i;
    const d = i % 2 ? '6f' : '1 1/8m';
    const rag = (beyer - truth.intercept) / (truth.slope * F.distFactor({ lengthBased: true }, d));
    races.push({ distance: d, beyer, ragozin: rag });
  }
  const { sources, report } = F.fitCalibration(races, F.cloneSources());
  const rag = src('ragozin', sources);
  assert.ok(report.ragozin.fitted);
  assert.ok(Math.abs(rag.intercept - truth.intercept) < 0.01);
  assert.ok(Math.abs(rag.slope - truth.slope) < 0.001);
  // Sources with no data keep their defaults.
  assert.equal(src('trackmaster', sources).slope, 1);
  assert.equal(report.trackmaster.fitted, false);
});

test('rateHorses orders horses and uses most recent races first', () => {
  const races = [
    { horse: 'A', date: '2026-01-01', beyer: 80 },
    { horse: 'A', date: '2026-03-01', beyer: 100 },
    { horse: 'B', date: '2026-02-01', beyer: 90 },
  ];
  const r = F.rateHorses(races, F.cloneSources());
  assert.deepEqual(r.map((h) => h.horse), ['A', 'B']);
  assert.equal(r[0].last, 100);
  assert.equal(r[0].best, 100);
  assert.ok(r[0].trend > 0);
});

test('CSV round trip with header aliases', () => {
  const { races, unknownColumns } = F.parseCSV('Horse,Dist,BSF,Rag,TG,Bris,TFUS,Foo\n"Copper, Jr",6f,95,"8""",9-,99,118,x');
  assert.deepEqual(unknownColumns, ['Foo']);
  assert.equal(races[0].horse, 'Copper, Jr');
  assert.equal(races[0].ragozin, '8"');
  assert.equal(races[0].thorograph, '9-');
  const out = F.toCSV(races, F.cloneSources());
  const back = F.parseCSV(out).races[0];
  assert.equal(back.horse, 'Copper, Jr');
  assert.equal(back.ragozin, '8"');
});

test('sample data imports cleanly and fits', () => {
  const { races, unknownColumns } = F.parseCSV(SAMPLE_CSV);
  assert.equal(unknownColumns.length, 0);
  assert.ok(races.length >= 40);
  const { report } = F.fitCalibration(races, F.cloneSources());
  for (const id of ['ragozin', 'thorograph', 'brisnet', 'timeform', 'equibase', 'thoromanager']) {
    assert.ok(report[id].fitted, id);
    assert.ok(Math.abs(report[id].r) > 0.9, id);
  }
});
