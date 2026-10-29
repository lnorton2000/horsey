/*
 * Horsey figure engine.
 *
 * Every speed-figure product uses its own scale. This module maps each one onto a
 * single "Unified Figure" (UF) expressed on a Beyer-equivalent scale (higher is
 * better, ~100 = solid stakes-quality dirt figure), then blends them.
 *
 * Conversion model for a source s, raw figure r, distance d (furlongs):
 *
 *     UF = intercept_s + slope_s * r * distFactor_s(d)
 *
 * distFactor is 1 for figures already in "points" (Beyer, Brisnet, Equibase, ...).
 * For length-based sheet figures (Ragozin, Thoro-Graph) one sheet point is roughly
 * one length, and a length is worth more Beyer points in sprints than in routes
 * (~3 pts at 6f, ~2 pts at 9f), so distFactor = 8 / d (normalized to a mile).
 *
 * Default calibrations are rough industry rules of thumb. The intended workflow is
 * to load your own historical figures and run fitCalibration(), which estimates
 * intercept/slope for every source by regression against the consensus of the
 * other sources (Beyer is the fixed anchor of the scale).
 *
 * Works in the browser (window.Figures) and in Node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Figures = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_SOURCES = [
    {
      id: 'beyer', name: 'Beyer (DRF PPs)', short: 'Beyer',
      higherIsBetter: true, lengthBased: false, anchor: true,
      intercept: 0, slope: 1, weight: 1, enabled: true,
      note: 'Anchor of the unified scale. Unified figures read like Beyers.',
    },
    {
      id: 'ragozin', name: 'Ragozin Sheets', short: 'Rag',
      higherIsBetter: false, lengthBased: true, anchor: false,
      intercept: 120, slope: -2.25, weight: 1, enabled: true,
      note: 'Lower is better; ~1 point per length. Rag 0 ~ Beyer 120; ~3 Beyer pts/pt at 6f, ~2 at 9f.',
    },
    {
      id: 'thorograph', name: 'Thoro-Graph', short: 'TG',
      higherIsBetter: false, lengthBased: true, anchor: false,
      intercept: 118, slope: -2.25, weight: 1, enabled: true,
      note: 'Lower is better; length-based like Ragozin, runs slightly differently.',
    },
    {
      id: 'brisnet', name: 'Brisnet Speed', short: 'Bris',
      higherIsBetter: true, lengthBased: false, anchor: false,
      intercept: -5, slope: 1, weight: 0.8, enabled: true,
      note: 'Typically runs a few points above Beyer.',
    },
    {
      id: 'timeform', name: 'TimeformUS', short: 'TFUS',
      higherIsBetter: true, lengthBased: false, anchor: false,
      intercept: 4, slope: 0.8, weight: 0.9, enabled: true,
      note: 'Wider scale; TFUS 120 ~ Beyer 100.',
    },
    {
      id: 'equibase', name: 'Equibase Speed', short: 'EQB',
      higherIsBetter: true, lengthBased: false, anchor: false,
      intercept: -2, slope: 1, weight: 0.7, enabled: true,
      note: 'Roughly Beyer-like; calibrate from your data.',
    },
    {
      id: 'trackmaster', name: 'TrackMaster Speed', short: 'TM',
      higherIsBetter: true, lengthBased: false, anchor: false,
      intercept: 0, slope: 1, weight: 0.6, enabled: false,
      note: 'Roughly Beyer-like; calibrate from your data.',
    },
    {
      id: 'thoromanager', name: 'ThoroManager PPs', short: 'TMgr',
      higherIsBetter: true, lengthBased: false, anchor: false,
      intercept: 0, slope: 1, weight: 0.6, enabled: true,
      note: 'No published scale; defaults to identity. Fit from your data before trusting it.',
    },
  ];

  // Header aliases for CSV import (lower-cased, non-alphanumerics stripped).
  const HEADER_ALIASES = {
    horse: 'horse', name: 'horse', horsename: 'horse',
    date: 'date', racedate: 'date',
    track: 'track', trk: 'track',
    race: 'race', raceno: 'race', racenumber: 'race',
    distance: 'distance', dist: 'distance',
    surface: 'surface', surf: 'surface',
    beyer: 'beyer', bsf: 'beyer', drf: 'beyer', beyerspeed: 'beyer', drfpp: 'beyer',
    ragozin: 'ragozin', rag: 'ragozin', sheets: 'ragozin', ragozinsheets: 'ragozin',
    thorograph: 'thorograph', tg: 'thorograph',
    brisnet: 'brisnet', bris: 'brisnet', brisspeed: 'brisnet', brisnetspeed: 'brisnet',
    timeform: 'timeform', timeformus: 'timeform', tfus: 'timeform',
    equibase: 'equibase', eqb: 'equibase', equibasespeed: 'equibase',
    trackmaster: 'trackmaster', tm: 'trackmaster',
    thoromanager: 'thoromanager', tmgr: 'thoromanager', thoromanagerpp: 'thoromanager',
  };

  const RACE_FIELDS = ['horse', 'date', 'track', 'race', 'distance', 'surface'];

  function cloneSources(sources) {
    return (sources || DEFAULT_SOURCES).map((s) => Object.assign({}, s));
  }

  /* ---------- parsing ---------- */

  const FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };

  /**
   * Distance -> furlongs. Accepts "6f", "6 1/2f", "6.5", "1m", "1 1/16m",
   * "1m70y", "1 mile 70 yards", "7½f". Bare numbers are furlongs.
   * Returns null when unparseable.
   */
  function parseDistance(input) {
    if (input == null) return null;
    if (typeof input === 'number') return input > 0 ? input : null;
    let s = String(input).trim().toLowerCase();
    if (!s) return null;
    for (const [ch, v] of Object.entries(FRACTIONS)) s = s.split(ch).join(' ' + v + ' ');
    s = s.replace(/miles?/g, 'm').replace(/furlongs?|fur/g, 'f').replace(/yards?|yds?/g, 'y');

    const num = (str) => {
      // "1 1/16", "6 0.5", "6.5", "1/2"
      let total = 0;
      let seen = false;
      for (const part of str.trim().split(/\s+/)) {
        if (!part) continue;
        const frac = part.match(/^(\d+)\/(\d+)$/);
        if (frac) { total += Number(frac[1]) / Number(frac[2]); seen = true; continue; }
        const n = Number(part);
        if (Number.isNaN(n)) return null;
        total += n; seen = true;
      }
      return seen ? total : null;
    };

    const m = s.match(/^([\d.\/\s]+)\s*(m|f|y)?\s*(?:([\d.\/\s]+)\s*(y|f)?)?$/);
    if (!m) return null;
    const a = num(m[1]);
    if (a == null) return null;
    const unit = m[2] || 'f';
    let furlongs = unit === 'm' ? a * 8 : unit === 'y' ? a / 220 : a;
    if (m[3]) {
      const b = num(m[3]);
      if (b == null) return null;
      furlongs += (m[4] || 'y') === 'f' ? b : b / 220;
    }
    return furlongs > 0 ? Math.round(furlongs * 1000) / 1000 : null;
  }

  /**
   * Figure -> number. Handles plain numbers plus sheet notation:
   *   leading flags/letters (e.g. "F12", "w9") are ignored,
   *   trailing "-" = -0.25, "+" = +0.25, '"' or "½" = +0.5, "¼" = +0.25, "¾" = +0.75.
   * Sheet legends vary by publisher; adjust here if yours differs.
   */
  function parseFigure(input) {
    if (input == null) return null;
    if (typeof input === 'number') return Number.isFinite(input) ? input : null;
    let s = String(input).trim();
    if (!s) return null;
    const m = s.match(/^[^\d\-+.]*?(-?\d+(?:\.\d+)?)\s*(["”½¼¾]|-|\+)?\s*[A-Za-z]*$/);
    if (!m) return null;
    let v = Number(m[1]);
    const neg = v < 0 || m[1].startsWith('-');
    const sign = neg ? -1 : 1;
    switch (m[2]) {
      case '-': v -= 0.25; break;
      case '+': v += 0.25; break;
      case '"': case '”': case '½': v += 0.5 * sign; break;
      case '¼': v += 0.25 * sign; break;
      case '¾': v += 0.75 * sign; break;
      default: break;
    }
    return v;
  }

  /* ---------- conversion ---------- */

  function distFactor(source, furlongs) {
    if (!source.lengthBased) return 1;
    const d = typeof furlongs === 'number' ? furlongs : parseDistance(furlongs);
    return d ? 8 / d : 1; // unknown distance: treat as a mile
  }

  function toUnified(source, raw, distance) {
    const r = parseFigure(raw);
    if (r == null) return null;
    return source.intercept + source.slope * r * distFactor(source, distance);
  }

  function fromUnified(source, uf, distance) {
    const k = source.slope * distFactor(source, distance);
    if (!k) return null;
    return (uf - source.intercept) / k;
  }

  /** Convert one figure from one source into every other source's scale. */
  function convertAcross(sources, fromId, raw, distance) {
    const from = sources.find((s) => s.id === fromId);
    if (!from) return null;
    const uf = toUnified(from, raw, distance);
    if (uf == null) return null;
    return {
      unified: uf,
      equivalents: sources.map((s) => ({ id: s.id, name: s.name, value: fromUnified(s, uf, distance) })),
    };
  }

  /* ---------- combining ---------- */

  /**
   * Blend every available figure for one race into a single Unified Figure.
   * Returns null if the race has no usable figures.
   *   unified    weighted mean of converted figures
   *   spread     max - min of converted figures (disagreement between products)
   *   confidence 0..1 from source count and agreement
   */
  function combineRace(race, sources, opts) {
    const o = Object.assign({ excludeId: null }, opts);
    const parts = [];
    for (const s of sources) {
      if (!s.enabled || s.id === o.excludeId || !(s.weight > 0)) continue;
      const uf = toUnified(s, race[s.id], race.distance);
      if (uf == null) continue;
      parts.push({ id: s.id, short: s.short, raw: parseFigure(race[s.id]), converted: uf, weight: s.weight });
    }
    if (!parts.length) return null;
    const wsum = parts.reduce((a, p) => a + p.weight, 0);
    const unified = parts.reduce((a, p) => a + p.converted * p.weight, 0) / wsum;
    const vals = parts.map((p) => p.converted);
    const spread = Math.max(...vals) - Math.min(...vals);
    const countScore = 1 - Math.exp(-parts.length / 2);     // 1 src .39, 2 .63, 3 .78, 4 .86
    const agreeScore = 1 / (1 + Math.pow(spread / 8, 2));   // 8-pt spread halves it
    const confidence = parts.length === 1 ? countScore * 0.8 : countScore * agreeScore;
    return { unified, spread, n: parts.length, confidence, parts };
  }

  /* ---------- calibration ---------- */

  function ols(xs, ys) {
    const n = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      sxx += (xs[i] - mx) ** 2;
      sxy += (xs[i] - mx) * (ys[i] - my);
      syy += (ys[i] - my) ** 2;
    }
    if (sxx === 0 || syy === 0 || sxy === 0) return null;
    // Reduced major axis (geometric-mean) regression: both sides are noisy
    // measurements of the same performance, so ordinary least squares would
    // shrink the slope toward zero (regression dilution).
    const slope = Math.sign(sxy) * Math.sqrt(syy / sxx);
    const intercept = my - slope * mx;
    let sse = 0;
    for (let i = 0; i < n; i++) sse += (ys[i] - (intercept + slope * xs[i])) ** 2;
    return {
      intercept, slope, n,
      r: syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy),
      rmse: Math.sqrt(sse / n),
    };
  }

  /**
   * Fit intercept/slope for every non-anchor source from your own data.
   * Each source is regressed against the leave-one-out consensus of the other
   * sources; repeated a few times so mutually-calibrated sources settle.
   * Sources with fewer than minPairs paired races keep their current values.
   * Returns { sources, report: {id: {n, r, rmse, fitted}} }.
   */
  function fitCalibration(races, sources, opts) {
    const o = Object.assign({ minPairs: 5, iterations: 6 }, opts);
    let cur = cloneSources(sources);
    const report = {};
    for (let it = 0; it < o.iterations; it++) {
      const next = cloneSources(cur);
      // Anchor counts fully even if the user disabled it for blending.
      const refSources = cur.map((c) => (c.anchor ? Object.assign({}, c, { enabled: true, weight: Math.max(c.weight, 1) }) : c));
      for (const s of next) {
        if (s.anchor) continue;
        const xs = [], ys = [];
        for (const race of races) {
          const raw = parseFigure(race[s.id]);
          if (raw == null) continue;
          const ref = combineRace(race, refSources, { excludeId: s.id });
          if (!ref) continue;
          xs.push(raw * distFactor(s, race.distance));
          ys.push(ref.unified);
        }
        if (xs.length < o.minPairs) { report[s.id] = { n: xs.length, fitted: false }; continue; }
        const fit = ols(xs, ys);
        if (!fit || (s.higherIsBetter ? fit.slope <= 0 : fit.slope >= 0)) {
          report[s.id] = { n: xs.length, fitted: false, r: fit ? fit.r : null, reason: 'bad-direction' };
          continue;
        }
        s.intercept = round(fit.intercept, 3);
        s.slope = round(fit.slope, 4);
        report[s.id] = { n: fit.n, r: fit.r, rmse: fit.rmse, fitted: true };
      }
      cur = next;
    }
    return { sources: cur, report };
  }

  /* ---------- horse ratings ---------- */

  function parseDate(d) {
    if (!d) return null;
    const t = Date.parse(d);
    return Number.isNaN(t) ? null : t;
  }

  /**
   * Rate every horse from its race-level Unified Figures.
   * opts.lastN    only the most recent N races count (default 6)
   * opts.decay    weight multiplier per race back (default 0.8; 1 = flat average)
   * Rating = recency-and-confidence-weighted mean of the last N unified figures.
   */
  function rateHorses(races, sources, opts) {
    const o = Object.assign({ lastN: 6, decay: 0.8 }, opts);
    const byHorse = new Map();
    races.forEach((race, idx) => {
      const name = String(race.horse || '').trim() || '(unnamed)';
      const combined = combineRace(race, sources);
      if (!combined) return;
      if (!byHorse.has(name)) byHorse.set(name, []);
      byHorse.get(name).push(Object.assign({ race, idx, t: parseDate(race.date) }, combined));
    });

    const out = [];
    for (const [horse, list] of byHorse) {
      // Most recent first; undated rows keep entry order, after dated ones.
      list.sort((a, b) => {
        if (a.t != null && b.t != null) return b.t - a.t;
        if (a.t != null) return -1;
        if (b.t != null) return 1;
        return b.idx - a.idx;
      });
      const recent = list.slice(0, o.lastN);
      let wsum = 0, acc = 0;
      recent.forEach((r, i) => {
        const w = Math.pow(o.decay, i) * (0.5 + 0.5 * r.confidence);
        wsum += w; acc += w * r.unified;
      });
      const figs = recent.map((r) => r.unified);
      const last3 = figs.slice(0, 3).slice().sort((a, b) => b - a);
      const top2of3 = last3.length >= 2 ? (last3[0] + last3[1]) / 2 : last3[0];
      const trend = figs.length >= 2 ? figs[0] - avg(figs.slice(1, 4)) : 0;
      out.push({
        horse,
        rating: acc / wsum,
        last: figs[0],
        best: Math.max(...figs),
        top2of3,
        trend,
        starts: list.length,
        avgSpread: avg(recent.map((r) => r.spread)),
        races: list,
      });
    }
    out.sort((a, b) => b.rating - a.rating);
    return out;
  }

  /* ---------- CSV ---------- */

  function splitCSVLine(line, delim) {
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"' && cur.trim() === '') { q = true; cur = ''; }
      else if (c === delim) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map((v) => v.trim());
  }

  function normalizeHeader(h) {
    return HEADER_ALIASES[String(h).toLowerCase().replace(/[^a-z0-9]/g, '')] || null;
  }

  /** Parse CSV/TSV text into race rows. Unknown columns are ignored and reported. */
  function parseCSV(text) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim());
    if (!lines.length) return { races: [], unknownColumns: [] };
    const delim = lines[0].includes('\t') ? '\t' : lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
    const headers = splitCSVLine(lines[0], delim);
    const keys = headers.map(normalizeHeader);
    const unknownColumns = headers.filter((h, i) => !keys[i] && h);
    const races = lines.slice(1).map((line) => {
      const cells = splitCSVLine(line, delim);
      const race = {};
      keys.forEach((k, i) => { if (k && cells[i] != null && cells[i] !== '') race[k] = cells[i]; });
      return race;
    }).filter((r) => Object.keys(r).length);
    return { races, unknownColumns };
  }

  function csvCell(v) {
    if (v == null) return '';
    const s = typeof v === 'number' ? String(round(v, 2)) : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(races, sources) {
    const cols = RACE_FIELDS.concat(sources.map((s) => s.id));
    const header = cols.concat(['unified', 'spread', 'sources_used']);
    const rows = races.map((race) => {
      const c = combineRace(race, sources);
      return cols.map((k) => race[k]).concat(c ? [c.unified, c.spread, c.n] : ['', '', 0]);
    });
    return [header].concat(rows).map((r) => r.map(csvCell).join(',')).join('\n');
  }

  /* ---------- utils ---------- */

  function avg(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
  function round(v, p) { const k = Math.pow(10, p); return Math.round(v * k) / k; }

  return {
    DEFAULT_SOURCES, RACE_FIELDS,
    cloneSources, parseDistance, parseFigure, distFactor,
    toUnified, fromUnified, convertAcross,
    combineRace, fitCalibration, rateHorses,
    parseCSV, toCSV, normalizeHeader,
  };
});
