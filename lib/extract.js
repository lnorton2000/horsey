/*
 * Horsey raw-file extraction helpers.
 *
 * Turns raw past performances and sheets (PDF text, photos) into race rows by
 * asking Claude to read them. This module holds the pure parts: rebuilding a
 * PDF page's text with its column layout, writing the prompt, and checking
 * and normalizing Claude's JSON answer. The page (app.js) does the I/O.
 *
 * Works in the browser (window.Extract) and in Node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./figures.js'));
  else root.Extract = factory(root.Figures);
})(typeof self !== 'undefined' ? self : this, function (F) {
  'use strict';

  const PRODUCT_IDS = F.DEFAULT_SOURCES.map((s) => s.id);

  const PRODUCT_GUIDE = `How to recognise each product and which number to take:
- beyer: Daily Racing Form (DRF) past performances. Take the Beyer Speed Figure printed on each past-performance line (usually bold, after the race class/conditions and before the running positions). Not the DRF pace figures.
- brisnet: Brisnet / BRIS past performances. Take the "SPD" speed rating on each line. Not E1, E2, LP, the class rating, or Prime Power.
- timeform: TimeformUS past performances. Take the TFUS speed figure for each line, not the pace figures.
- equibase: Equibase past performances. Take the Equibase Speed Figure for each line.
- trackmaster: TrackMaster past performances. Take the speed figure for each line.
- thoromanager: ThoroManager past performances. Take its speed figure for each line.
- ragozin: Ragozin "The Sheets". One horse per sheet; races are lines in year columns, placed by month, with the figure followed by small symbols. Lower is better.
- thorograph: Thoro-Graph sheets. Same idea as Ragozin: one horse per sheet, lower is better.
For ragozin and thorograph, copy each figure exactly as printed including its symbols (for example 12-, 9", F7, 14+, -1). For the other products copy the number only.`;

  /**
   * Rebuild readable lines from pdf.js text items, keeping the horizontal
   * layout with spaces so columns (and sheet grids) stay aligned.
   * items: [{str, x, y, w}] in PDF units (y grows upward, as pdf.js gives it).
   */
  function layoutText(items) {
    const parts = items.filter((it) => it && String(it.str).trim() !== '');
    if (!parts.length) return '';
    // Typical character width, to turn x gaps into spaces.
    const widths = parts.filter((p) => p.w > 0 && p.str.length).map((p) => p.w / p.str.length).sort((a, b) => a - b);
    const cw = widths.length ? widths[Math.floor(widths.length / 2)] : 5;
    const heights = parts.map((p) => p.h || cw * 2).sort((a, b) => a - b);
    const tol = Math.max(1, heights[Math.floor(heights.length / 2)] * 0.45);

    const sorted = parts.slice().sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    for (const p of sorted) {
      const line = lines.length && Math.abs(lines[lines.length - 1].y - p.y) <= tol ? lines[lines.length - 1] : null;
      if (line) line.items.push(p);
      else lines.push({ y: p.y, items: [p] });
    }
    const minX = Math.min(...parts.map((p) => p.x));
    return lines.map((line) => {
      line.items.sort((a, b) => a.x - b.x);
      let out = '';
      for (const it of line.items) {
        const col = Math.round((it.x - minX) / cw);
        if (col > out.length) out += ' '.repeat(col - out.length);
        else if (out && !out.endsWith(' ')) out += ' ';
        out += it.str;
      }
      return out.replace(/\s+$/, '');
    }).join('\n');
  }

  /**
   * The instruction sent with each page (text or images).
   * opts: { product: id | 'auto', today: 'YYYY-MM-DD', source: 'file p.N', text?: string, images?: n }
   */
  function buildPrompt(opts) {
    const o = Object.assign({ product: 'auto', today: new Date().toISOString().slice(0, 10) }, opts);
    const productLine = o.product && o.product !== 'auto'
      ? `The person says this is: ${o.product}. Use that product id unless the page clearly shows otherwise.`
      : 'Work out which product this is from the page.';
    const material = o.text != null
      ? `The page text follows, extracted from a PDF with its column spacing kept:\n<page source="${o.source || ''}">\n${o.text}\n</page>`
      : `The page is in the attached image${o.images > 1 ? 's (one page split top to bottom, in order, with a small overlap; do not list a race twice)' : ''}. Source: ${o.source || 'photo'}.`;
    return `You are reading a horse racing past-performance page or speed-figure sheet so its speed figures can be saved.

${productLine}
${PRODUCT_GUIDE}

Extract every completed past race that shows a speed figure from that product, for every horse on the page.
Skip workouts, today's race conditions, entries with no figure, and summary boxes (best figure, averages).

For each race give:
- horse: the horse's name as printed, without country suffixes.
- date: the race date as YYYY-MM-DD. Every past-performance line starts with its date (e.g. 13Aug26, 08/13/26, 8-13-26); always give it, even when it is printed in its own column or above the line. Two-digit years are 20xx. Today is ${o.today}; no race is later than today, so a date that would be in the future is from the year before.
- month: YYYY-MM. Always fill this in when you know the month, even if you also give the date.
  On sheets where you can tell the month and year but not the day, set date to null and give month.
- track: the track code if shown (e.g. SAR, BEL, AQU, GP, KEE, CD, SA), else null.
- race: race number if shown, else null.
- distance: as printed (e.g. "6f", "1 1/16m", "7 1/2f"), else null.
- surface: "D" dirt, "T" turf, "S" synthetic, or null.
- figure: the speed figure as a string, copied exactly.
- call1: the horse's position at the first call of that race (a number), when the running line shows it, else null.
- call1Lengths: lengths behind the leader at the first call (0 if leading), when shown, else null. Beaten-length superscripts may be run into the position digits in extracted text; separate them sensibly.
- field: number of starters, when shown, else null.
- finish: finishing position, when shown, else null.

Also list the upcoming race each horse is entered in, when the page shows it (the race header with track, date and race number, and each horse's post position or program number). For each horse give:
- horse, track, date (YYYY-MM-DD), race (race number), post (post position or program number as printed, e.g. "1A"), distance, surface, ml (morning line odds as printed, or null), printedStyle (a running-style code printed in the PPs, e.g. Brisnet E, E/P, P, S, or null).
Sheets list the horse's own races only; give entries only if the sheet shows today's race and post.

Reply with only JSON in this shape:
{"product":"beyer|brisnet|timeform|equibase|trackmaster|thoromanager|ragozin|thorograph|unknown","races":[{"horse":"Copper Comet","date":"2026-08-13","month":"2026-08","track":"SAR","race":"6","distance":"6f","surface":"D","figure":"104","call1":1,"call1Lengths":0,"field":8,"finish":1}],"entries":[{"horse":"Copper Comet","track":"SAR","date":"2026-09-05","race":"7","post":"3","distance":"7f","surface":"D","ml":"5-2","printedStyle":"E"}],"notes":"anything unclear, in one short sentence, or empty"}
If the page has no speed figures and no entries, reply {"product":"unknown","races":[],"entries":[],"notes":"why"}.

${material}`;
  }

  /**
   * Validate Claude's answer and turn it into race rows.
   * Returns { product, rows: [{horse, date?, month?, track?, race?, distance?, surface?, [product]: figure}], skipped, notes }.
   */
  function normalizeExtraction(answer, fallbackProduct, today) {
    const a = answer && typeof answer === 'object' ? answer : {};
    let product = String(a.product || '').toLowerCase().replace(/[^a-z]/g, '');
    if (!PRODUCT_IDS.includes(product)) product = PRODUCT_IDS.includes(fallbackProduct) ? fallbackProduct : null;
    const rows = [];
    let skipped = 0;
    for (const r of Array.isArray(a.races) ? a.races : []) {
      if (!r || typeof r !== 'object') { skipped++; continue; }
      const horse = clean(r.horse);
      const figure = clean(r.figure);
      if (!horse || !figure || !product || F.parseFigure(figure) == null) { skipped++; continue; }
      const row = { horse: horse.replace(/\s*\([A-Z]{2,3}\)\s*$/, '') };
      const date = clean(r.date);
      if (date) {
        const d = F.normalizeDate(date);
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) row.date = F.fixFutureDates([{ date: d }], today).races[0].date;
      }
      const month = clean(r.month);
      if (row.date) row.month = row.date.slice(0, 7);
      else if (month && /^\d{4}-\d{1,2}$/.test(month)) row.month = month.replace(/-(\d)$/, '-0$1');
      for (const k of ['track', 'race', 'distance']) {
        const v = clean(r[k]);
        if (v) row[k] = k === 'track' ? v.toUpperCase() : v;
      }
      const surf = clean(r.surface);
      if (surf && /^[DTS]$/i.test(surf)) row.surface = surf.toUpperCase();
      for (const k of ['call1', 'call1Lengths', 'field', 'finish']) {
        const n = Number(clean(r[k]));
        if (clean(r[k]) !== '' && Number.isFinite(n) && n >= 0 && n < 100) row[k] = String(n);
      }
      row[product] = figure;
      rows.push(row);
    }
    const entries = [];
    for (const e of Array.isArray(a.entries) ? a.entries : []) {
      if (!e || typeof e !== 'object') continue;
      const horse = clean(e.horse).replace(/\s*\([A-Z]{2,3}\)\s*$/, '');
      const date = F.normalizeDate(clean(e.date));
      const race = clean(e.race);
      if (!horse || !race || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const entry = { horse, date, race, track: clean(e.track).toUpperCase(), post: clean(e.post) };
      for (const k of ['distance', 'ml', 'printedStyle']) if (clean(e[k])) entry[k] = clean(e[k]);
      const surf = clean(e.surface);
      if (surf && /^[DTS]$/i.test(surf)) entry.surface = surf.toUpperCase();
      entries.push(entry);
    }
    return { product, rows, entries, skipped, notes: clean(a.notes) || '' };
  }

  /**
   * Sheets often give only the month. Fill in the day when exactly one known
   * race (already saved, or read from another file in this batch) matches the
   * same horse, month and (when both have one) track.
   * Mutates rows; returns how many dates were filled.
   */
  function resolveMonthOnlyDates(rows, existingRaces) {
    const known = existingRaces.concat(rows).filter((r) => r.date);
    let filled = 0;
    for (const row of rows) {
      if (row.date || !row.month) continue;
      const hk = F.horseKey(row.horse);
      const used = new Set(rows.filter((r) => r !== row && r.date && F.horseKey(r.horse) === hk && sameProductSlot(r, row)).map((r) => r.date));
      const cands = new Set(known
        .filter((k) => F.horseKey(k.horse) === hk && F.normalizeDate(k.date).startsWith(row.month))
        .filter((k) => !row.track || !k.track || String(k.track).toUpperCase() === row.track)
        .map((k) => F.normalizeDate(k.date))
        .filter((d) => !used.has(d)));
      if (cands.size === 1) { row.date = [...cands][0]; row.dateFrom = 'matched'; filled++; }
    }
    return filled;
  }

  // Two rows from the same product can't be the same race.
  function sameProductSlot(a, b) {
    return PRODUCT_IDS.some((p) => a[p] != null && b[p] != null);
  }

  function clean(v) {
    if (v == null) return '';
    const s = String(v).trim();
    return s.toLowerCase() === 'null' ? '' : s;
  }

  return { PRODUCT_IDS, layoutText, buildPrompt, normalizeExtraction, resolveMonthOnlyDates };
});
