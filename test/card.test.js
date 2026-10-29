const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../lib/figures.js');
const C = require('../lib/card.js');
const X = require('../lib/extract.js');

test('agreementFromSpread maps point spread to 0..1', () => {
  assert.equal(C.agreementFromSpread(0), 1);
  assert.equal(C.agreementFromSpread(6), 0.5);
  assert.ok(Math.abs(C.agreementFromSpread(3) - 0.8) < 1e-9);
  assert.equal(C.agreementFromSpread(null), null);
});

test('mergeEntries builds cards and moves a horse on a corrected race number', () => {
  let r = C.mergeEntries({}, [
    { horse: 'Copper Comet', track: 'sar', date: '9/5/26', race: '7', post: '3', distance: '7f' },
    { horse: 'Iron Quill', track: 'SAR', date: '2026-09-05', race: 'Race 7', post: '1' },
    { horse: 'No Date', track: 'SAR', race: '7', post: '2' },
  ]);
  assert.equal(r.added, 2);
  const id = 'SAR_2026-09-05';
  assert.deepEqual(Object.keys(r.cards), [id]);
  assert.equal(r.cards[id].races['7'].distance, '7f');
  r = C.mergeEntries(r.cards, [{ horse: 'COPPER COMET', track: 'SAR', date: '2026-09-05', race: '8', post: '5' }]);
  assert.equal(r.cards[id].races['7'].entries.length, 1);
  assert.equal(r.cards[id].races['8'].entries[0].post, '5');
  r = C.mergeEntries(r.cards, [{ horse: 'Iron Quill', track: 'SAR', date: '2026-09-05', race: '7', post: '1' }]);
  assert.deepEqual([r.added, r.updated], [0, 0]);
});

test('runningStyle from first-call positions, with printed fallback', () => {
  assert.equal(C.raceStyle({ call1: '1', call1Lengths: '0' }), 'E');
  assert.equal(C.raceStyle({ call1: '3', call1Lengths: '0.5' }), 'E');
  assert.equal(C.raceStyle({ call1: '4', call1Lengths: '3' }), 'P');
  assert.equal(C.raceStyle({ call1: '8', call1Lengths: '9' }), 'C');
  assert.equal(C.raceStyle({ call1: '2', field: '9' }), 'P');
  assert.equal(C.raceStyle({}), null);
  const e = C.runningStyle([{ call1: 1, call1Lengths: 0 }, { call1: 1, call1Lengths: 0 }, { call1: 3, call1Lengths: 2 }]);
  assert.equal(e.style, 'E');
  assert.deepEqual(e.counts, { E: 2, P: 1, C: 0 });
  assert.equal(C.runningStyle([{ call1: 9, call1Lengths: 10 }, { call1: 7, call1Lengths: 6 }]).style, 'C');
  assert.equal(C.runningStyle([], 'E/P').style, 'E');
  assert.equal(C.runningStyle([], 'S').style, 'C');
  assert.equal(C.runningStyle([]).style, null);
});

test('fieldOrderAgreement: 1 when products rank the same, 0 when reversed', () => {
  const src = F.cloneSources();
  const same = [{ productRatings: { beyer: 100, ragozin: 99 } }, { productRatings: { beyer: 95, ragozin: 94 } }, { productRatings: { beyer: 90, ragozin: 91 } }];
  assert.equal(C.fieldOrderAgreement(same, src).score, 1);
  const rev = [{ productRatings: { beyer: 100, ragozin: 90 } }, { productRatings: { beyer: 95, ragozin: 95 } }, { productRatings: { beyer: 90, ragozin: 100 } }];
  assert.equal(C.fieldOrderAgreement(rev, src).score, 0);
  assert.equal(C.fieldOrderAgreement(same.slice(0, 2), src), null);
});

test('buildCard orders races and posts and fills ratings, agreement and style', () => {
  const races = [
    { horse: 'Copper Comet', date: '2026-08-13', distance: '6f', beyer: '104', ragozin: '4', call1: '1', call1Lengths: '0' },
    { horse: 'Copper Comet', date: '2026-07-18', distance: '1m', beyer: '101', ragozin: '9', call1: '1', call1Lengths: '0' },
    { horse: 'Iron Quill', date: '2026-08-13', distance: '1m', beyer: '90', call1: '7', call1Lengths: '8' },
  ];
  const { cards } = C.mergeEntries({}, [
    { horse: 'Iron Quill', track: 'SAR', date: '2026-09-05', race: '10', post: '2' },
    { horse: 'Copper Comet', track: 'SAR', date: '2026-09-05', race: '10', post: '1A' },
    { horse: 'First Timer', track: 'SAR', date: '2026-09-05', race: '2', post: '4' },
  ]);
  const card = C.buildCard('SAR_2026-09-05', cards['SAR_2026-09-05'], races, F.cloneSources());
  assert.deepEqual(card.races.map((r) => r.race), ['2', '10']);
  const r10 = card.races[1];
  assert.deepEqual(r10.horses.map((h) => h.post), ['1A', '2']);
  const cc = r10.horses[0];
  assert.equal(cc.style.style, 'E');
  assert.equal(cc.rank, 1);
  assert.equal(cc.agreementRuns, 2);
  assert.ok(cc.agreement > 0 && cc.agreement <= 1);
  assert.deepEqual(cc.latest, { beyer: '104', ragozin: '4' });
  assert.equal(r10.horses[1].agreement, null, 'single product: no agreement');
  assert.equal(r10.horses[1].style.style, 'C');
  assert.equal(r10.earlyCount, 1);
  assert.equal(card.races[0].horses[0].rating, null);
});

test('normalizeExtraction keeps call data and entries', () => {
  const r = X.normalizeExtraction({
    product: 'beyer',
    races: [{ horse: 'A', date: '2026-08-13', figure: '90', call1: 2, call1Lengths: '1.5', field: 8, finish: 'x' }],
    entries: [{ horse: 'A (GB)', track: 'sar', date: '9/5/26', race: '7', post: '3', ml: '5-2', printedStyle: 'E/P' }, { horse: 'B', race: '7' }],
  });
  assert.deepEqual(r.rows[0], { horse: 'A', date: '2026-08-13', month: '2026-08', call1: '2', call1Lengths: '1.5', field: '8', beyer: '90' });
  assert.deepEqual(r.entries, [{ horse: 'A', date: '2026-09-05', race: '7', track: 'SAR', post: '3', ml: '5-2', printedStyle: 'E/P' }]);
});

test('agreement uses the average pairwise gap, not the extremes', () => {
  const src = F.cloneSources();
  const c = F.combineRace({ distance: '1m', beyer: '100', brisnet: '105', timeform: '120' }, src);
  // converted: 100, 100, 100 -> perfect agreement
  assert.ok(c.gap < 1e-9 && c.spread < 1e-9);
  const d = F.combineRace({ beyer: '100', brisnet: '111', equibase: '102' }, src); // 100, 106, 100
  assert.equal(d.spread, 6);
  assert.ok(Math.abs(d.gap - 4) < 1e-9);
});

test('products not in use are filed under the one PP product in use', () => {
  const src = F.cloneSources().map((s) => Object.assign(s, { enabled: ['beyer', 'thoromanager', 'ragozin'].includes(s.id) }));
  const map = F.productRemap(src);
  assert.deepEqual(map, { brisnet: 'thoromanager', timeform: 'thoromanager', equibase: 'thoromanager', trackmaster: 'thoromanager' });
  const r = F.relabelProducts([
    { horse: 'A', date: '2026-10-01', beyer: '90', equibase: '100' },
    { horse: 'B', date: '2026-10-01', trackmaster: '95', thoromanager: '95' },
    { horse: 'C', date: '2026-10-01', ragozin: '9' },
  ], map);
  assert.equal(r.relabeled, 2);
  assert.deepEqual(r.races[0], { horse: 'A', date: '2026-10-01', beyer: '90', thoromanager: '100' });
  assert.deepEqual(r.races[1], { horse: 'B', date: '2026-10-01', thoromanager: '95' });
  // Two PP products in use: no guessing.
  assert.deepEqual(F.productRemap(F.cloneSources().map((s) => Object.assign(s, { enabled: ['beyer', 'thoromanager', 'equibase'].includes(s.id) }))), {});

  const prompt = X.buildPrompt({ products: ['beyer', 'thoromanager', 'ragozin'], text: 'x' });
  assert.match(prompt, /only uses these products: beyer, thoromanager, ragozin/);
  assert.match(prompt, /is not Daily Racing Form is thoromanager/);
  assert.doesNotMatch(prompt, /- equibase:/);
  assert.equal(X.normalizeExtraction({ product: 'equibase', races: [{ horse: 'A', date: '2026-10-01', figure: '88' }] }, null, '2026-10-29', map).rows[0].thoromanager, '88');
});

test('PSR is read from entries, kept on the card and ranked in the field', () => {
  const x = X.normalizeExtraction({ product: 'thoromanager', races: [], entries: [
    { horse: 'A', track: 'KEE', date: '2026-10-31', race: '5', post: '1', psr: 98 },
    { horse: 'B', track: 'KEE', date: '2026-10-31', race: '5', post: '2', psr: 'null' },
    { horse: 'C', track: 'KEE', date: '2026-10-31', race: '5', post: '3', psr: '101' },
  ] });
  assert.deepEqual(x.entries.map((e) => e.psr), ['98', undefined, '101']);
  const { cards } = C.mergeEntries({}, x.entries);
  const card = C.buildCard('KEE_2026-10-31', cards['KEE_2026-10-31'], [], F.cloneSources());
  assert.deepEqual(card.races[0].horses.map((h) => [h.horse, h.psr, h.psrRank]), [['A', 98, 2], ['B', null, undefined], ['C', 101, 1]]);
  // A CSV with a psr column works too.
  const csv = F.parseCSV('track,date,race,post,horse,PSR\nKEE,2026-10-31,5,4,D,95').races;
  assert.equal(C.mergeEntries(cards, csv).cards['KEE_2026-10-31'].races['5'].entries.find((e) => e.horse === 'D').psr, '95');
  assert.match(X.buildPrompt({ text: 'x' }), /psr \(ThoroManager's PSR/);
  assert.match(X.buildPrompt({ text: 'x' }), /Never the Horse Speed Graph/);
});
