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

test('normalizeDate reads common PP date styles', () => {
  assert.equal(F.normalizeDate('2026-08-13'), '2026-08-13');
  assert.equal(F.normalizeDate('8/13/26'), '2026-08-13');
  assert.equal(F.normalizeDate('08/13/2026'), '2026-08-13');
  assert.equal(F.normalizeDate('13Aug26'), '2026-08-13');
  assert.equal(F.normalizeDate('13 Aug 2026'), '2026-08-13');
  assert.equal(F.normalizeDate('Aug 13, 2026'), '2026-08-13');
  assert.equal(F.normalizeDate('sometime'), 'sometime');
});

test('mergeRaces combines separate product uploads and ignores re-uploads', () => {
  const drf = [
    { horse: 'Copper Comet', date: '8/13/26', track: 'sar', distance: '6f', beyer: '104' },
    { horse: 'Iron Quill', date: '2026-08-13', beyer: '90' },
  ];
  const rag = [{ horse: 'COPPER COMET (IRE)', date: '13Aug26', ragozin: '4"' }];

  let r = F.mergeRaces([], drf);
  assert.deepEqual([r.added, r.updated, r.unchanged], [2, 0, 0]);
  r = F.mergeRaces(r.races, rag);
  assert.deepEqual([r.added, r.updated, r.unchanged], [0, 1, 0]);
  assert.equal(r.races.length, 2);
  assert.deepEqual(r.races[0], { horse: 'Copper Comet', date: '2026-08-13', track: 'SAR', distance: '6f', beyer: '104', ragozin: '4"' });

  // Uploading the same files again changes nothing.
  r = F.mergeRaces(r.races, drf.concat(rag));
  assert.deepEqual([r.added, r.updated, r.unchanged], [0, 0, 3]);

  // A corrected figure overwrites; blanks never erase.
  r = F.mergeRaces(r.races, [{ horse: 'Iron Quill', date: '2026-08-13', beyer: '92', ragozin: '' }]);
  assert.equal(r.updated, 1);
  assert.equal(r.races[1].beyer, '92');
  assert.equal(r.races[1].ragozin, undefined);

  // Undated rows: exact duplicates skipped, anything else added.
  r = F.mergeRaces([], [{ horse: 'X', beyer: '80' }, { horse: 'X', beyer: '80' }, { horse: 'X', beyer: '81' }]);
  assert.deepEqual([r.added, r.unchanged], [2, 1]);
});

test('undated races with a month still sort by recency', () => {
  const r = F.rateHorses([
    { horse: 'A', month: '2026-03', beyer: 80 },
    { horse: 'A', month: '2026-08', ragozin: '9' },
    { horse: 'A', date: '2026-05-10', beyer: 90 },
  ], F.cloneSources());
  assert.deepEqual(r[0].races.map((x) => x.race.month || x.race.date), ['2026-08', '2026-05-10', '2026-03']);
});

test('linkRaces joins an undated run to the one matching row only', () => {
  const races = [
    { horse: 'Big Apple Patrick', date: '2026-08-02', track: 'RP', distance: '1m', race: '12', finish: '6', call1: '8', beyer: '65' },
    { horse: 'Big Apple Patrick', track: 'RP', distance: '8f', finish: '6', call1: '8', thoromanager: '74' },
    // same track and finish but different distance: not the same run
    { horse: 'Big Apple Patrick', track: 'RP', distance: '6f', finish: '6', call1: '8', thoromanager: '70' },
    // only the track in common: too little to go on
    { horse: 'Big Apple Patrick', track: 'RP', equibase: '80' },
  ];
  const r = F.linkRaces(races);
  assert.equal(r.linked, 1);
  assert.equal(r.races.length, 3);
  assert.equal(r.races[0].thoromanager, '74');
  assert.equal(r.races[0].beyer, '65');

  // Two equally good candidates: leave it alone.
  const amb = F.linkRaces([
    { horse: 'A', date: '2026-08-02', track: 'CD', distance: '6f', finish: '1', beyer: '80' },
    { horse: 'A', date: '2026-09-02', track: 'CD', distance: '6f', finish: '1', beyer: '82' },
    { horse: 'A', track: 'CD', distance: '6f', finish: '1', thoromanager: '90' },
  ]);
  assert.equal(amb.linked, 0);

  // mergeRaces links an incoming undated row to a saved dated one.
  const m = F.mergeRaces([races[0]], [races[1]]);
  assert.deepEqual([m.races.length, m.added, m.updated, m.linked], [1, 0, 1, 1]);
});

test('cleanupRaces: repeats, near-miss details, two spellings, wrong years', () => {
  const races = [
    // dated run with both products, plus an undated repeat of its ThoroManager figure
    { horse: 'Big Apple Patrick', date: '2025-12-20', track: 'RP', distance: '8f', race: '12', finish: '6', call1: '8', thoromanager: '74' },
    { horse: 'Big Apple Patrick', track: 'RP', distance: '8f', finish: '6', call1: '8', thoromanager: '74' },
    { horse: 'Big Apple Patrick', track: 'RP', distance: '1m', race: '12', field: '11', finish: '6', call1: '8', beyer: '65' },
    // one side misread the distance; race, finish, first call and field all agree
    { horse: 'Coach Pope', date: '2026-10-03', track: 'KEE', distance: '8.5f', race: '9', field: '6', finish: '2', call1: '2', thoromanager: '94' },
    { horse: 'Coach Pope', track: 'KEE', distance: '1m', race: '9', field: '6', finish: '2', call1: '2', beyer: '83' },
    // products put the first call a position apart
    { horse: 'Burnham Square', date: '2026-09-05', track: 'KD', distance: '12f', finish: '7', call1: '6', beyer: '93' },
    { horse: 'Burnham Square', track: 'KD', distance: '12f', finish: '7', call1: '7', trackmaster: '96' },
    // one horse, two spellings, same dates
    { horse: 'Disaster', date: '2026-10-01', track: 'BEL', finish: '1', beyer: '103' },
    { horse: 'Disaster', date: '2026-08-29', track: 'SAR', finish: '6', beyer: '74' },
    { horse: 'R Disaster', date: '2026-10-01', track: 'BEL', finish: '1', equibase: '111' },
    { horse: 'R Disaster', date: '2026-08-29', track: 'SAR', finish: '6', equibase: '81' },
    // a year misread into the future
    { horse: 'Induction', date: '2026-12-26', track: 'CD', beyer: '73' },
  ];
  const c = F.cleanupRaces(races, { today: '2026-10-29', preferNames: ['R Disaster'] });
  assert.equal(c.repeats, 1);
  assert.equal(c.linked, 3);
  assert.deepEqual(c.aliases, [['Disaster', 'R Disaster']]);
  assert.equal(c.fixedDates, 1);
  const find = (h, d) => c.races.filter((r) => F.horseKey(r.horse) === F.horseKey(h) && (!d || r.date === d));
  assert.equal(find('Big Apple Patrick').length, 1);
  assert.equal(find('Big Apple Patrick')[0].beyer, '65');
  assert.equal(find('Coach Pope')[0].beyer, '83');
  assert.equal(find('Burnham Square')[0].trackmaster, '96');
  assert.equal(find('Disaster').length, 0);
  assert.deepEqual(find('R Disaster', '2026-10-01').map((r) => [r.beyer, r.equibase]), [['103', '111']]);
  assert.equal(find('Induction')[0].date, '2025-12-26');
  assert.equal(c.races.length, 6);
  // Nothing left to do the second time.
  assert.equal(F.cleanupRaces(c.races, { today: '2026-10-29' }).total, 0);
});

test('cleanupRaces leaves genuinely different runs apart', () => {
  const races = [
    { horse: 'Floodlites', date: '2025-08-30', track: 'KD', distance: '6f', race: '4', field: '12', finish: '12', call1: '4', equibase: '73' },
    { horse: 'Floodlites', track: 'KD', distance: '6f', race: '5', field: '12', finish: '1', call1: '4', beyer: '72' },
    { horse: 'Ways and Means', date: '2026-06-05', track: 'SAR', distance: '7f', finish: '1', call1: '2', beyer: '107' },
    { horse: 'Ways and Means', date: '2025-06-06', track: 'SAR', distance: '7f', finish: '1', call1: '2', beyer: '108' },
    { horse: 'Ways and Means', track: 'SAR', distance: '7f', finish: '1', call1: '2', trackmaster: '107' },
  ];
  const c = F.cleanupRaces(races, { today: '2026-10-29', sources: F.cloneSources().map((s) => Object.assign(s, { enabled: true })) });
  assert.equal(c.total, 0, 'different race and finish; two equally close candidates');
});

test('parseFigure reads every Ragozin legend symbol', () => {
  const cases = {
    '.=12-': 11.75, '..9"': 9.5, 'P~14': 14, 'X~14+': 14.25, '◇11': 11, '^=9"&': 9.5, '14+w': 14.25,
    '12"D<': 12.5, "'11": 11, '../15': 15, 'r:13+s': 13.25, 'F7+': 7.25, '-2-': -1.75, '-1"': -1.5, '.12': 12, ':=10[': 10, '~8"Y': 8.5,
  };
  for (const [t, v] of Object.entries(cases)) assert.equal(F.parseFigure(t), v, t);
  assert.equal(F.parseFigure('XX'), null);
  assert.equal(F.sheetSurface('.=12-'), 'T');
  assert.equal(F.sheetSurface('◇11'), 'S');
  assert.equal(F.sheetSurface('12-'), null);
});

test('sheet cleanup: country suffixes, impossible dates, today lines, misread days', () => {
  assert.equal(F.horseKey('FINAL OBJECTIVE-IR'), F.horseKey('Final Objective'));
  assert.equal(F.horseKey('Pikachu-GB'), 'PIKACHU');
  assert.equal(F.horseKey('Copper Comet (IRE)'), 'COPPERCOMET');
  assert.equal(F.horseKey('Sophia\'s Song-Bellamy Road'), 'SOPHIASSONGBELLAMYROAD', 'a dam-damsire is not a country code');
  assert.equal(F.normalizeDate('2020-04-40'), '');
  assert.equal(F.normalizeDate('2026-02-29'), '');
  assert.equal(F.normalizeDate('2024-02-29'), '2024-02-29');
  assert.equal(F.trackCompatible('KE', 'KEE'), true);
  assert.equal(F.trackCompatible('SR', 'SAR'), true);
  assert.equal(F.trackCompatible('BE', 'CD'), false);

  const races = [
    { horse: 'Adonius', date: '2026-10-04', track: 'KEE', beyer: '77', thoromanager: '83' },
    { horse: 'ADONIUS-IR', date: '2026-10-03', sheetTrack: 'KE', ragozin: '15-' },           // day misread by one
    { horse: 'Drake\'s Passage', date: '2026-09-01', track: 'CD', beyer: '80' },
    { horse: 'Drake\'s Passage', date: '2026-10-30', sheetTrack: 'IN', ragozin: '13"' },     // the sheet's today line
    { horse: 'El Cordobes', date: '2025-10-05', track: 'BEL', beyer: '90' },
    { horse: 'El Cordobes', date: '2025-10-01', sheetTrack: 'SA', ragozin: '10-' },          // incompatible track: not joined
    { horse: 'El Cordobes', date: '2024-06-01', sheetTrack: 'BE', ragozin: '12' },           // older race, nothing to join
  ];
  const c = F.cleanupRaces(races, { today: '2026-10-29', preferNames: ['Adonius', 'Drake\'s Passage'], entryDates: { DRAKESPASSAGE: '2026-10-30' } });
  assert.equal(c.todayLines, 1);
  assert.equal(c.sheetJoined, 1);
  assert.equal(c.names, 1);
  const ad = c.races.filter((r) => F.horseKey(r.horse) === 'ADONIUS');
  assert.deepEqual(ad, [{ horse: 'Adonius', date: '2026-10-04', track: 'KEE', beyer: '77', thoromanager: '83', ragozin: '15-', sheetTrack: 'KE' }]);
  assert.equal(c.races.filter((r) => F.horseKey(r.horse) === 'ELCORDOBES').length, 3);
  assert.equal(c.races.length, 5);
  // Ratings treat both spellings as one horse.
  assert.equal(F.rateHorses([{ horse: 'A-IR', date: '2026-01-01', ragozin: '10' }, { horse: 'A', date: '2026-02-01', beyer: '90' }], F.cloneSources()).length, 1);
});

test('sheets never create race-card entries', () => {
  const X = require('../lib/extract.js');
  const r = X.normalizeExtraction({ product: 'ragozin', races: [], entries: [{ horse: 'Roja', track: 'KE', date: '2026-10-29', race: '5', post: '512T' }] });
  assert.deepEqual(r.entries, []);
});
