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
- thoromanager: ThoroManager past performances. Take the "Spd" column (the Cramer Speed Rating, higher is better, rarely above 126). Never the Horse Speed Graph number (the same rating where lower is better) and never the 2F, 4F or LP pace ratings.
- ragozin: Ragozin "The Sheets". One horse per sheet. Lower is better. How to read a sheet:
  * One year of races per column, headed like "9 RACES 93" (nine races in 1993). The most recent race is at the top of the rightmost column; read every column, every year. Sheets may show several horses side by side; keep each horse's columns together under its name.
  * Each race is one line, placed in its column at the height of the date it was run: December at the top down to January at the bottom (month names run down the shaded stripes; each stripe is about six days). The year comes from the column header, the month from the height. A figure further left in its column is a better race; that is the graph, not a different column.
  * A line like "MALE 4YO 14AUG91" or "F/M 4YO 15MAR90" marks today's date and the horse's age. It is not a race; skip it.
  * For first-time starters and lightly raced horses the sheets add pages for the sire, the dam (often printed as "Dam-Damsire", e.g. "Sophia's Song-Bellamy Road") and siblings. Those are other horses' races: skip them. Only list races for horses entered today (the horse each sheet is for).
  * A line is: symbols before the figure, the figure, then at the far right trouble/trip letters (V very wide, v wide, Y rail, w won, s/S/D slow start and others) run straight into a code for the class, track and day, e.g. "10AP29" = $10,000 claimer at AP on the 29th, "MSSA14" = maiden race at SA on the 14th, "AWKE3" = allowance/stakes at KE on the 3rd. Use that day with the month and year to give the full date, and give its track letters as track.
  * Symbols before the figure describe the track and conditions (= turf, ^= good turf, .= yielding, := soft, ◇ Polytrack, . sloppy/muddy, : very bad wet track, .. very slow, ' wet fast, ^ good slow, / frozen, r rain, s snow, F first Lasix, g / G wind, ~ approximate, X~ figure at the stretch call, P~ adjusted for slow pace). Right after the figure, + is a quarter point, - is minus a quarter and " is a half; for a negative figure these add to its size ("-1\"" is minus one and a half).
  * Copy the figure token exactly as printed with all its symbols, e.g. ".=12-", "P~9\"", "14+w". Never put the class/track/day code in the figure.
  * Skip lines with no figure: "XX" (did not finish), a missing number, and summary lines for races not shown (e.g. "Rui 5X 2/0/1" = five races at Ruidoso).
  * Surface: "=" before the figure means turf, ◇ means Polytrack; green figures are turf and red are Poly on color sheets.
- thorograph: Thoro-Graph sheets. Same idea as Ragozin: one horse per sheet, lower is better.
For ragozin and thorograph, copy each figure exactly as printed including its symbols (for example 12-, 9", F7, .=14+, -1). For the other products copy the number only.`;

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
   * Share of a PDF page covered by pictures, from pdf.js's operator list
   * (fnArray/argsArray) and its OPS table. A scanned sheet with a caption
   * has a little text and one big picture: the picture holds the figures.
   */
  function imageCoverage(fnArray, argsArray, OPS, pageArea) {
    const paints = new Set(['paintImageXObject', 'paintInlineImageXObject', 'paintImageMaskXObject', 'paintJpegXObject', 'paintImageXObjectRepeat']
      .map((k) => OPS[k]).filter((v) => v != null));
    const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    let area = 0;
    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i];
      if (fn === OPS.save) stack.push(ctm);
      else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (fn === OPS.transform) ctm = mul(ctm, argsArray[i]);
      else if (paints.has(fn)) area += Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]);
    }
    return pageArea > 0 ? Math.min(1, area / pageArea) : 0;
  }

  /** Text that reads like a Ragozin/Thoro-Graph sheet: year headers ("9 RACES 93") or class codes ("AWAQ26"). */
  function looksLikeSheet(text) {
    const t = String(text || '');
    return /\b\d{1,2}\s+RACES?\s+\d{2}\b/.test(t) || (t.match(/\b(?:AW|aw|MS)[A-Z]{2}\s?\d{1,2}\b/g) || []).length >= 3;
  }

  /**
   * The instruction sent with each page (text or images).
   * opts: { product: id | 'auto', today: 'YYYY-MM-DD', source: 'file p.N', text?: string, images?: n }
   */
  function buildPrompt(opts) {
    const o = Object.assign({ product: 'auto', today: new Date().toISOString().slice(0, 10) }, opts);
    const products = (o.products || PRODUCT_IDS).filter((id) => PRODUCT_IDS.includes(id));
    const pp = products.filter((id) => !['beyer', 'ragozin', 'thorograph'].includes(id));
    let productLine = o.product && o.product !== 'auto'
      ? `The person says this is: ${o.product}. Use that product id unless the page clearly shows otherwise.`
      : 'Work out which product this is from the page.';
    if (products.length < PRODUCT_IDS.length) {
      productLine += ` This person only uses these products: ${products.join(', ')}. Answer with one of them.` +
        (pp.length === 1 ? ` Any past-performance page that is not Daily Racing Form is ${pp[0]}, even if it prints figures credited to Equibase, TrackMaster or another data source.` : '');
    }
    const pictured = o.images > 0
      ? `The page is in the attached image${o.images > 1 ? 's (one page split top to bottom, in order, with a small overlap; do not list a race twice)' : ''}. It may be scanned sideways; read it the right way up.`
      : '';
    const material = o.text != null && o.images > 0
      ? `${pictured} Read the figures and their positions from the image. The PDF's own text layer is below for reference; it may hold only a caption, and it loses positions.\n<page source="${o.source || ''}">\n${o.text}\n</page>`
      : o.text != null
        ? `The page text follows, extracted from a PDF with its column spacing kept:\n<page source="${o.source || ''}">\n${o.text}\n</page>`
        : `${pictured} Source: ${o.source || 'photo'}.`;
    return `You are reading a horse racing past-performance page or speed-figure sheet so its speed figures can be saved.

${productLine}
${PRODUCT_GUIDE.split('\n').filter((line) => !line.startsWith('- ') || products.some((id) => line.startsWith(`- ${id}:`))).join('\n')}

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
- horse, track, date (YYYY-MM-DD), race (race number), post (post position or program number as printed, e.g. "1A"), distance, surface, ml (morning line odds as printed, or null), printedStyle (a running-style code printed in the PPs, e.g. Brisnet E, E/P, P, S, or null), psr (ThoroManager's PSR, the Projected Speed Rating printed for today's race, as a number, or null; first-time starters have none).
For ragozin and thorograph sheets give no entries at all ("entries": []): the codes beside sheet figures are class/track/day codes, not post positions.

Reply with only JSON in this shape:
{"product":"${products.join('|')}|unknown","races":[{"horse":"Copper Comet","date":"2026-08-13","month":"2026-08","track":"SAR","race":"6","distance":"6f","surface":"D","figure":"104","call1":1,"call1Lengths":0,"field":8,"finish":1}],"entries":[{"horse":"Copper Comet","track":"SAR","date":"2026-09-05","race":"7","post":"3","distance":"7f","surface":"D","ml":"5-2","printedStyle":"E","psr":98}],"notes":"anything unclear, in one short sentence, or empty"}
If the page has no speed figures and no entries, reply {"product":"unknown","races":[],"entries":[],"notes":"why"}.

${material}`;
  }

  /**
   * Validate Claude's answer and turn it into race rows.
   * Returns { product, rows: [{horse, date?, month?, track?, race?, distance?, surface?, [product]: figure}], skipped, notes }.
   */
  function normalizeExtraction(answer, fallbackProduct, today, remap) {
    const a = answer && typeof answer === 'object' ? answer : {};
    let product = String(a.product || '').toLowerCase().replace(/[^a-z]/g, '');
    if (remap && remap[product]) product = remap[product];
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
      if (product === 'ragozin' || product === 'thorograph') {
        // Sheet track codes (KE, SA, AQ) don't always match PP codes (KEE, SAR, AQU);
        // keep them aside so they never block matching to the DRF/ThoroManager row.
        if (row.track) { row.sheetTrack = row.track; delete row.track; }
        if (!row.surface) { const surf = F.sheetSurface(figure); if (surf) row.surface = surf; }
      }
      row[product] = figure;
      rows.push(row);
    }
    const entries = [];
    // Sheets carry class/track/day codes, not posts; entries come from PPs only.
    const sheet = product === 'ragozin' || product === 'thorograph';
    for (const e of sheet ? [] : Array.isArray(a.entries) ? a.entries : []) {
      if (!e || typeof e !== 'object') continue;
      const horse = clean(e.horse).replace(/\s*\([A-Z]{2,3}\)\s*$/, '');
      const date = F.normalizeDate(clean(e.date));
      const race = clean(e.race);
      if (!horse || !race || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const entry = { horse, date, race, track: clean(e.track).toUpperCase(), post: clean(e.post) };
      for (const k of ['distance', 'ml', 'printedStyle']) if (clean(e[k])) entry[k] = clean(e[k]);
      const psr = Number(clean(e.psr));
      if (clean(e.psr) !== '' && Number.isFinite(psr) && psr > 0 && psr < 200) entry.psr = String(psr);
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

  return { PRODUCT_IDS, layoutText, imageCoverage, looksLikeSheet, buildPrompt, normalizeExtraction, resolveMonthOnlyDates };
});
