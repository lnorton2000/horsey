/* global Figures, SAMPLE_CSV */
(function () {
  'use strict';
  const F = Figures;
  const STORE_KEY = 'horsey.v1';

  const state = load() || { races: [], sources: F.cloneSources(), fitReport: null, open: {} };
  // Pick up sources added in newer versions without losing saved calibrations.
  for (const d of F.DEFAULT_SOURCES) {
    if (!state.sources.find((s) => s.id === d.id)) state.sources.push(Object.assign({}, d));
  }

  const $ = (sel) => document.querySelector(sel);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v, p = 1) => (v == null || !Number.isFinite(v) ? '–' : v.toFixed(p).replace(/^-(0\.?0*)$/, '$1'));
  const enabled = () => state.sources.filter((s) => s.enabled);

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { return null; }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
  }
  function changed() { save(); renderAll(); }

  /* ---------- tabs ---------- */
  document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
    renderAll();
  }));

  /* ---------- quick convert ---------- */
  function renderConvert() {
    const sel = $('#cv-source');
    const prev = sel.value || 'beyer';
    sel.innerHTML = state.sources.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    sel.value = state.sources.some((s) => s.id === prev) ? prev : 'beyer';

    const dist = $('#cv-dist').value;
    const fur = F.parseDistance(dist);
    const res = F.convertAcross(state.sources, sel.value, $('#cv-value').value, dist);
    if (!res) { $('#cv-out').innerHTML = '<p class="hint">Enter a figure.</p>'; return; }
    $('#cv-out').innerHTML =
      `<div class="row"><span>Unified</span><span class="big">${fmt(res.unified)}</span>` +
      `<span class="hint">${fur ? fur + ' furlongs' : '<span class="warn">distance not recognised; sheets assume 1 mile</span>'}</span></div>` +
      '<div class="cards">' + res.equivalents.filter((e) => e.id !== sel.value).map((e) => {
        const s = state.sources.find((x) => x.id === e.id);
        const p = s.lengthBased ? 2 : 0;
        return `<div class="card"><div class="k">${esc(s.name)}</div><div class="v">${fmt(e.value, p)}</div></div>`;
      }).join('') + '</div>';

    // Blend inputs: build once, keep values.
    const box = $('#blend-inputs');
    if (!box.dataset.built) {
      box.innerHTML = `<label>Distance <input data-blend="distance" value="1m" size="8"></label>` +
        state.sources.map((s) => `<label>${esc(s.short)} <input data-blend="${s.id}" size="5"></label>`).join('');
      box.dataset.built = '1';
      box.addEventListener('input', renderBlend);
    }
    renderBlend();
  }

  function renderBlend() {
    const race = {};
    document.querySelectorAll('[data-blend]').forEach((i) => { race[i.dataset.blend] = i.value; });
    const c = F.combineRace(race, state.sources);
    $('#blend-out').innerHTML = !c ? '<p class="hint">No figures entered.</p>' :
      `<div class="row"><span>Unified</span><span class="big">${fmt(c.unified)}</span>` +
      `<span class="hint">${c.n} source${c.n > 1 ? 's' : ''} &middot; spread ${fmt(c.spread)} &middot; confidence ${Math.round(c.confidence * 100)}%</span></div>` +
      '<div>' + c.parts.map((p) => `<span class="chip">${esc(p.short)} ${esc(p.raw)} &rarr; ${fmt(p.converted)}</span>`).join('') + '</div>';
  }

  ['#cv-source', '#cv-value', '#cv-dist'].forEach((id) => $(id).addEventListener('input', renderConvert));

  /* ---------- figures table ---------- */
  function renderFigures() {
    const srcs = enabled();
    const cols = [['horse', 'Horse', 'wide'], ['date', 'Date', ''], ['track', 'Trk', ''], ['distance', 'Dist', '']]
      .concat(srcs.map((s) => [s.id, s.short, 'fig']));
    const head = '<tr>' + cols.map((c) => `<th>${esc(c[1])}</th>`).join('') + '<th class="num">Unified</th><th class="num">Spread</th><th></th></tr>';
    const body = state.races.map((r, i) => {
      const c = F.combineRace(r, state.sources);
      return '<tr>' + cols.map(([k, , cls]) => {
        let bad = false;
        if (cls === 'fig' && r[k] != null && r[k] !== '') bad = F.parseFigure(r[k]) == null;
        if (k === 'distance' && r[k]) bad = F.parseDistance(r[k]) == null;
        return `<td><input data-row="${i}" data-key="${k}" value="${esc(r[k])}" class="${cls === 'wide' ? 'wide' : ''}${bad ? ' bad' : ''}"></td>`;
      }).join('') +
        `<td class="num"><b>${c ? fmt(c.unified) : '–'}</b></td><td class="num">${c && c.n > 1 ? fmt(c.spread) : ''}</td>` +
        `<td><button data-del="${i}" title="Delete row">&times;</button></td></tr>`;
    }).join('');
    $('#fig-table').innerHTML = head + (body || `<tr><td colspan="${cols.length + 3}" class="hint">No races yet. Add a row, import a CSV, or load the sample.</td></tr>`);
  }

  $('#fig-table').addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.row == null) return;
    state.races[+t.dataset.row][t.dataset.key] = t.value.trim();
    changed();
  });
  $('#fig-table').addEventListener('click', (e) => {
    const d = e.target.dataset.del;
    if (d == null) return;
    state.races.splice(+d, 1);
    changed();
  });
  $('#add-row').addEventListener('click', () => {
    const last = state.races[state.races.length - 1];
    state.races.push({ horse: last ? last.horse : '' });
    changed();
  });
  $('#load-sample').addEventListener('click', () => importText(SAMPLE_CSV, 'sample'));
  $('#paste-toggle').addEventListener('click', () => { $('#paste-box').hidden = !$('#paste-box').hidden; });
  $('#paste-apply').addEventListener('click', () => { importText($('#paste-text').value, 'pasted text'); $('#paste-text').value = ''; });
  $('#csv-file').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    f.text().then((t) => importText(t, f.name));
    e.target.value = '';
  });
  $('#clear-all').addEventListener('click', () => {
    if (!state.races.length || confirm('Delete all ' + state.races.length + ' rows?')) { state.races = []; changed(); }
  });
  $('#export-csv').addEventListener('click', () => {
    const blob = new Blob([F.toCSV(state.races, state.sources)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'unified-figures.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  function importText(text, label) {
    const { races, unknownColumns } = F.parseCSV(text);
    state.races = state.races.concat(races);
    $('#import-msg').textContent = `Imported ${races.length} row${races.length === 1 ? '' : 's'} from ${label}.` +
      (unknownColumns.length ? ' Ignored columns: ' + unknownColumns.join(', ') + '.' : '');
    changed();
  }

  /* ---------- rankings ---------- */
  function renderRankings() {
    const lastN = Math.max(1, +$('#opt-lastn').value || 6);
    const decay = Math.min(1, Math.max(0.3, +$('#opt-decay').value || 0.8));
    const q = $('#opt-filter').value.trim().toLowerCase();
    const rows = F.rateHorses(state.races, state.sources, { lastN, decay }).filter((h) => !q || h.horse.toLowerCase().includes(q));
    const srcs = enabled();
    const head = '<tr><th>#</th><th>Horse</th><th class="num">Rating</th><th class="num">Last</th><th class="num">Best</th>' +
      '<th class="num">Top 2 of 3</th><th class="num">Trend</th><th class="num">Starts</th><th class="num">Avg spread</th></tr>';
    const body = rows.map((h, i) => {
      const open = state.open[h.horse];
      const trendCls = h.trend > 1 ? 'up' : h.trend < -1 ? 'down' : '';
      let html = `<tr class="horse" data-horse="${esc(h.horse)}"><td>${i + 1}</td><td><b>${open ? '▾' : '▸'} ${esc(h.horse)}</b></td>` +
        `<td class="num"><b>${fmt(h.rating)}</b></td><td class="num">${fmt(h.last)}</td><td class="num">${fmt(h.best)}</td>` +
        `<td class="num">${fmt(h.top2of3)}</td><td class="num ${trendCls}">${h.trend > 0 ? '+' : ''}${fmt(h.trend)}</td>` +
        `<td class="num">${h.starts}</td><td class="num${h.avgSpread > 6 ? ' warn' : ''}">${fmt(h.avgSpread)}</td></tr>`;
      if (open) {
        html += `<tr class="detail"><td></td><td colspan="8"><table><tr><th>Date</th><th>Trk</th><th>Dist</th>` +
          srcs.map((s) => `<th class="num">${esc(s.short)}</th>`).join('') +
          '<th class="num">Unified</th><th class="num">Spread</th><th>Confidence</th></tr>' +
          h.races.map((r) => {
            const byId = Object.fromEntries(r.parts.map((p) => [p.id, p]));
            return `<tr><td>${esc(r.race.date)}</td><td>${esc(r.race.track)}</td><td>${esc(r.race.distance)}</td>` +
              srcs.map((s) => {
                const p = byId[s.id];
                return `<td class="num">${p ? `${esc(r.race[s.id])} <span class="hint">(${fmt(p.converted)})</span>` : ''}</td>`;
              }).join('') +
              `<td class="num"><b>${fmt(r.unified)}</b></td><td class="num">${r.n > 1 ? fmt(r.spread) : ''}</td>` +
              `<td><span class="conf"><i style="width:${Math.round(r.confidence * 100)}%"></i></span></td></tr>`;
          }).join('') + '</table></td></tr>';
      }
      return html;
    }).join('');
    $('#rank-table').innerHTML = head + (body || '<tr><td colspan="9" class="hint">No rated horses yet.</td></tr>');
  }
  $('#rank-table').addEventListener('click', (e) => {
    const tr = e.target.closest('tr.horse');
    if (!tr) return;
    const h = tr.dataset.horse;
    state.open[h] = !state.open[h];
    changed();
  });
  ['#opt-lastn', '#opt-decay', '#opt-filter'].forEach((id) => $(id).addEventListener('input', renderRankings));

  /* ---------- calibration ---------- */
  function renderCalibration() {
    const rep = state.fitReport || {};
    const head = '<tr><th>Use</th><th>Product</th><th>Better</th><th>Sheet (lengths)</th><th class="num">Weight</th>' +
      '<th class="num">Intercept</th><th class="num">Slope</th><th class="num">Fit n</th><th class="num">r</th><th class="num">RMSE</th><th>Notes</th></tr>';
    const body = state.sources.map((s, i) => {
      const r = rep[s.id];
      const fitCells = s.anchor ? '<td colspan="3" class="hint">anchor</td>' : !r ? '<td></td><td></td><td></td>' :
        `<td class="num">${r.n}</td><td class="num">${r.fitted ? fmt(Math.abs(r.r), 3) : '–'}</td>` +
        `<td class="num">${r.fitted ? fmt(r.rmse, 2) : `<span class="hint">${r.n < 5 ? 'too few' : 'skipped'}</span>`}</td>`;
      const num = (k, step, dis) => `<td class="num"><input type="number" step="${step}" data-src="${i}" data-key="${k}" value="${s[k]}" style="width:6.5em"${dis ? ' disabled' : ''}></td>`;
      return `<tr><td><input type="checkbox" data-src="${i}" data-key="enabled"${s.enabled ? ' checked' : ''}></td>` +
        `<td>${esc(s.name)}</td><td>${s.higherIsBetter ? 'higher' : 'lower'}</td>` +
        `<td><input type="checkbox" data-src="${i}" data-key="lengthBased"${s.lengthBased ? ' checked' : ''}${s.anchor ? ' disabled' : ''}></td>` +
        num('weight', 0.1) + num('intercept', 0.5, s.anchor) + num('slope', 0.05, s.anchor) + fitCells +
        `<td class="hint" style="white-space:normal;min-width:220px">${esc(s.note)}</td></tr>`;
    }).join('');
    $('#cal-table').innerHTML = head + body;

    // Equivalence chart.
    const dist = $('#chart-dist').value;
    const srcs = enabled();
    const levels = [120, 115, 110, 105, 100, 95, 90, 85, 80, 75, 70, 60];
    $('#eq-table').innerHTML = '<tr><th class="num">Unified</th>' + srcs.filter((s) => !s.anchor).map((s) => `<th class="num">${esc(s.short)}</th>`).join('') + '</tr>' +
      levels.map((u) => `<tr><td class="num"><b>${u}</b></td>` + srcs.filter((s) => !s.anchor).map((s) =>
        `<td class="num">${fmt(F.fromUnified(s, u, dist), s.lengthBased ? 1 : 0)}</td>`).join('') + '</tr>').join('');
  }

  $('#cal-table').addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.src == null) return;
    const s = state.sources[+t.dataset.src];
    if (t.type === 'checkbox') s[t.dataset.key] = t.checked;
    else if (t.value !== '' && Number.isFinite(+t.value)) s[t.dataset.key] = +t.value;
    changed();
  });
  $('#chart-dist').addEventListener('input', renderCalibration);
  $('#fit').addEventListener('click', () => {
    if (!state.races.length) { $('#fit-msg').textContent = 'Add or import races first.'; return; }
    const { sources, report } = F.fitCalibration(state.races, state.sources);
    state.sources = sources;
    state.fitReport = report;
    const fitted = Object.values(report).filter((r) => r.fitted).length;
    $('#fit-msg').textContent = `Fitted ${fitted} product${fitted === 1 ? '' : 's'} from ${state.races.length} races.`;
    changed();
  });
  $('#reset-cal').addEventListener('click', () => {
    state.sources = F.cloneSources();
    state.fitReport = null;
    $('#fit-msg').textContent = 'Defaults restored.';
    changed();
  });

  function renderAll() {
    const active = document.querySelector('.tab.active').id;
    if (active === 'tab-convert') renderConvert();
    if (active === 'tab-figures') renderFigures();
    if (active === 'tab-rankings') renderRankings();
    if (active === 'tab-calibration') renderCalibration();
  }
  renderAll();
})();
