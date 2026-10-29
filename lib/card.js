/*
 * Horsey race cards: today's entries by race and post position, with each
 * horse's unified rating, how well the figure products agree, and running style.
 *
 * Agreement (0-1, 1 = total agreement)
 *   Race-level: products' converted figures for the same run, scored from
 *   the average gap between each pair of products, in Beyer-equivalent
 *   points: 1 / (1 + (gap / 6)^2).
 *   0 pts apart = 1.00, 3 = 0.80, 6 = 0.50, 12 = 0.20.
 *   Horse-level: the average over the horse's recent runs that have two or
 *   more products.
 *   Field order: for a race on the card, whether each product ranks the
 *   horses in the same order (Kendall's tau between products, rescaled from
 *   -1..1 to 0..1).
 *
 * Running style, from the position at the first call in recent races:
 *   E  early: on the lead or within 1 length
 *   P  presser/stalker: within 5 lengths
 *   C  closer: further back
 * The horse's style is the average over its last 6 races with call data
 * (E=1, P=2, C=3; up to 1.6 is E, up to 2.4 is P, else C). When no call
 * data exists, a style printed in the PPs (e.g. Brisnet E, E/P, P, S) is used.
 *
 * Works in the browser (window.Card) and in Node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./figures.js'));
  else root.Card = factory(root.Figures);
})(typeof self !== 'undefined' ? self : this, function (F) {
  'use strict';

  function agreementFromSpread(spread) {
    if (spread == null || !Number.isFinite(spread)) return null;
    return 1 / (1 + Math.pow(spread / 6, 2));
  }

  /* ---------- entries ---------- */

  function cardId(track, date) {
    return `${String(track || 'TRACK').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'TRACK'}_${F.normalizeDate(date) || 'UNDATED'}`;
  }

  /**
   * Merge entries ({horse, track, date, race, post, distance?, surface?, ml?,
   * printedStyle?}) into a cards map {id: {track, date, races: {raceNo:
   * {distance, surface, entries: [{post, horse, ml, printedStyle}]}}}}.
   * A horse appears once per card; a later upload updates its post or race.
   * Returns { cards, added, updated, changedIds }. The input map is not modified.
   */
  function mergeEntries(cards, entries) {
    const out = JSON.parse(JSON.stringify(cards || {}));
    let added = 0, updated = 0;
    const changedIds = new Set();
    for (const e of entries) {
      const horse = String(e.horse || '').trim();
      const race = String(e.race || '').trim().replace(/^R(ace)?\s*/i, '');
      const date = F.normalizeDate(e.date);
      if (!horse || !race || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const track = String(e.track || '').toUpperCase().trim();
      const id = cardId(track, date);
      const card = out[id] || (out[id] = { track, date, races: {} });
      const hk = F.horseKey(horse);
      // Remove the horse from any other race on this card (a corrected race number).
      for (const [rn, r] of Object.entries(card.races)) {
        if (rn === race) continue;
        const i = r.entries.findIndex((x) => F.horseKey(x.horse) === hk);
        if (i >= 0) { r.entries.splice(i, 1); if (!r.entries.length) delete card.races[rn]; }
      }
      const r = card.races[race] || (card.races[race] = { entries: [] });
      for (const k of ['distance', 'surface', 'conditions']) if (e[k] && !r[k]) r[k] = String(e[k]);
      const entry = { horse, post: String(e.post || '').trim() };
      if (e.ml) entry.ml = String(e.ml).trim();
      if (e.printedStyle) entry.printedStyle = String(e.printedStyle).trim();
      const existing = r.entries.find((x) => F.horseKey(x.horse) === hk);
      if (!existing) { r.entries.push(entry); added++; changedIds.add(id); continue; }
      let changed = false;
      for (const [k, v] of Object.entries(entry)) {
        if (k === 'horse' || !v) continue;
        if (existing[k] !== v) { existing[k] = v; changed = true; }
      }
      if (changed) { updated++; changedIds.add(id); }
    }
    return { cards: out, added, updated, changedIds: [...changedIds] };
  }

  const postSort = (a, b) => {
    const pa = parseInt(a.post, 10), pb = parseInt(b.post, 10);
    if (Number.isNaN(pa) !== Number.isNaN(pb)) return Number.isNaN(pa) ? 1 : -1;
    return (pa - pb) || String(a.post).localeCompare(String(b.post)) || a.horse.localeCompare(b.horse);
  };
  const raceSort = (a, b) => (parseInt(a, 10) - parseInt(b, 10)) || String(a).localeCompare(String(b));

  /* ---------- running style ---------- */

  function raceStyle(r) {
    const pos = num(r.call1);
    const lengths = num(r.call1Lengths);
    if (pos == null && lengths == null) return null;
    if (pos === 1 || (lengths != null && lengths <= 1)) return 'E';
    if (lengths != null) return lengths <= 5 ? 'P' : 'C';
    const field = num(r.field);
    if (field) return pos <= Math.max(2, Math.ceil(field / 3)) ? 'P' : 'C';
    return pos <= 3 ? 'P' : 'C';
  }

  /** races: the horse's races, most recent first. */
  function runningStyle(races, printedStyle) {
    const seen = races.map(raceStyle).filter(Boolean).slice(0, 6);
    if (!seen.length) {
      const p = String(printedStyle || '').toUpperCase().replace(/\s/g, '');
      const map = { E: 'E', 'E/P': 'E', EP: 'E', P: 'P', S: 'C', C: 'C', NA: null };
      return p && map[p] ? { style: map[p], counts: null, n: 0, source: 'printed' } : { style: null, counts: null, n: 0, source: null };
    }
    const score = { E: 1, P: 2, C: 3 };
    const avg = seen.reduce((a, s) => a + score[s], 0) / seen.length;
    const counts = { E: 0, P: 0, C: 0 };
    seen.forEach((s) => counts[s]++);
    return { style: avg <= 1.6 ? 'E' : avg <= 2.4 ? 'P' : 'C', counts, n: seen.length, source: 'calls' };
  }

  /* ---------- field order agreement ---------- */

  /** Each product's own rating for a horse: recency-weighted converted figures of that product alone. */
  function productRatings(horseRaces, sources, opts) {
    const o = Object.assign({ lastN: 6, decay: 0.8 }, opts);
    const out = {};
    for (const s of sources) {
      if (!s.enabled) continue;
      let w = 0, acc = 0, i = 0;
      for (const r of horseRaces) {
        const v = F.toUnified(s, r.race[s.id], r.race.distance);
        if (v == null) continue;
        if (i >= o.lastN) break;
        const wt = Math.pow(o.decay, i++);
        w += wt; acc += wt * v;
      }
      if (w) out[s.id] = acc / w;
    }
    return out;
  }

  function kendall(xs, ys) {
    let c = 0, d = 0;
    for (let i = 0; i < xs.length; i++) {
      for (let j = i + 1; j < xs.length; j++) {
        const s = Math.sign(xs[i] - xs[j]) * Math.sign(ys[i] - ys[j]);
        if (s > 0) c++; else if (s < 0) d++;
      }
    }
    return c + d ? (c - d) / (c + d) : null;
  }

  /**
   * horses: [{productRatings}] for one race. Returns {score 0..1, pairs, details}
   * or null when no two products both rate at least 3 horses.
   */
  function fieldOrderAgreement(horses, sources) {
    const ids = sources.filter((s) => s.enabled).map((s) => s.id);
    let wsum = 0, acc = 0;
    const details = [];
    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) {
        const both = horses.filter((h) => h.productRatings[ids[a]] != null && h.productRatings[ids[b]] != null);
        if (both.length < 3) continue;
        const tau = kendall(both.map((h) => h.productRatings[ids[a]]), both.map((h) => h.productRatings[ids[b]]));
        if (tau == null) continue;
        const score = (tau + 1) / 2;
        details.push({ a: ids[a], b: ids[b], n: both.length, score });
        wsum += both.length; acc += both.length * score;
      }
    }
    return wsum ? { score: acc / wsum, pairs: details.length, details } : null;
  }

  /* ---------- the report ---------- */

  /**
   * Everything the card view and the PDF need for one card.
   * Returns {id, track, date, races: [{race, distance, surface, conditions,
   *   order, earlyCount, horses: [{post, horse, ml, rating..., agreement,
   *   style, latest: {productId: raw}, races}]}]}.
   */
  function buildCard(cardIdValue, card, allRaces, sources, opts) {
    const o = Object.assign({ lastN: 6, decay: 0.8 }, opts);
    const rated = new Map(F.rateHorses(allRaces, sources, o).map((h) => [F.horseKey(h.horse), h]));
    const races = Object.keys(card.races || {}).sort(raceSort).map((rn) => {
      const r = card.races[rn];
      const horses = r.entries.slice().sort(postSort).map((e) => {
        const h = rated.get(F.horseKey(e.horse));
        const list = h ? h.races : [];
        const recent = list.slice(0, o.lastN).filter((x) => x.n >= 2);
        const agreement = recent.length ? recent.reduce((a, x) => a + agreementFromSpread(x.gap), 0) / recent.length : null;
        const latest = {};
        for (const s of sources) {
          const hit = list.find((x) => x.race[s.id] != null && x.race[s.id] !== '');
          if (hit) latest[s.id] = hit.race[s.id];
        }
        return {
          post: e.post, horse: e.horse, ml: e.ml || '',
          rating: h ? h.rating : null, last: h ? h.last : null, best: h ? h.best : null,
          top2of3: h ? h.top2of3 : null, trend: h ? h.trend : null, starts: h ? h.starts : 0,
          agreement, agreementRuns: recent.length,
          style: runningStyle(list.map((x) => x.race), e.printedStyle),
          latest, races: list,
          productRatings: productRatings(list, sources, o),
        };
      });
      const ranked = horses.filter((h) => h.rating != null).sort((a, b) => b.rating - a.rating);
      ranked.forEach((h, i) => { h.rank = i + 1; });
      return {
        race: rn, distance: r.distance || '', surface: r.surface || '', conditions: r.conditions || '',
        order: fieldOrderAgreement(horses, sources),
        earlyCount: horses.filter((h) => h.style.style === 'E').length,
        horses,
      };
    });
    return { id: cardIdValue, track: card.track, date: card.date, races };
  }

  function num(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  return { agreementFromSpread, cardId, mergeEntries, raceStyle, runningStyle, productRatings, fieldOrderAgreement, buildCard };
});
