/* global Figures, SAMPLE_CSV */
(function () {
  'use strict';
  const F = Figures;
  const LOCAL_KEY = 'horsey.v1';      // races + calibration when running outside claude.ai
  const PREFS_KEY = 'horsey.prefs.v1'; // per-browser UI conveniences only
  const MAX_TABLE_ROWS = 300;

  const $ = (sel) => document.querySelector(sel);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v, p = 1) => (v == null || !Number.isFinite(v) ? '–' : v.toFixed(p).replace(/^-(0\.?0*)$/, '$1'));
  const enabled = () => state.sources.filter((s) => s.enabled);
  const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } };

  const state = { races: [], sources: F.cloneSources(), fitReport: null };
  const prefs = Object.assign({ open: {} }, readJSON(PREFS_KEY));

  function withNewSources(sources) {
    // Pick up products added in newer versions without losing saved calibrations.
    const out = (sources || []).map((s) => Object.assign({}, s));
    for (const d of F.DEFAULT_SOURCES) if (!out.find((s) => s.id === d.id)) out.push(Object.assign({}, d));
    return out;
  }

  function sortRaces(races) {
    // New, unnamed rows first so they're visible; then horse A-Z, newest race first.
    return races.sort((a, b) => {
      const ha = String(a.horse || ''), hb = String(b.horse || '');
      if (!ha !== !hb) return ha ? 1 : -1;
      return ha.localeCompare(hb) || String(b.date || '').localeCompare(String(a.date || ''));
    });
  }

  /* =====================================================================
   * Storage
   *
   * Hosted on claude.ai, races and calibration live in the artifact's
   * database, so they follow you to any device and survive cleared browser
   * data. One document per horse (horses/<HORSEKEY>) holds that horse's
   * races; settings/main holds calibration. Opened as a local file, the
   * same state is kept in this browser's localStorage instead.
   * ===================================================================== */
  const store = {
    mode: 'connecting', // connecting | cloud | local | readonly
    db: null,
    downloads: null,
    serverHorses: new Map(), // doc id -> JSON of races as last seen/written
    serverSettings: null,
    writing: new Map(),      // doc id -> {running, again}
    active: 0,
    queue: [],
    failed: false,
  };

  const docId = (horse) => (F.horseKey(horse) || 'UNNAMED').slice(0, 150);

  function groupByHorse(races) {
    const g = new Map();
    for (const r of races) {
      const id = docId(r.horse);
      if (!g.has(id)) g.set(id, []);
      g.get(id).push(r);
    }
    return g;
  }

  function setStatus(text, kind) {
    const el = $('#save-status');
    el.textContent = text;
    el.dataset.kind = kind || '';
  }

  function cloudStatus() {
    const busy = store.active + store.queue.length;
    if (store.mode === 'readonly') setStatus('View only: you can browse but not change this data', 'warn');
    else if (store.failed) setStatus('Some changes did not save. Check your connection; they will retry on your next edit.', 'bad');
    else if (busy) setStatus('Saving…', 'busy');
    else setStatus(`Saved to your Claude account · ${state.races.length} races`, 'ok');
  }

  /** Call after any change to races or calibration. */
  function persist() {
    sortRaces(state.races);
    if (store.mode === 'local') {
      writeJSON(LOCAL_KEY, state);
      setStatus(`Saved in this browser · ${state.races.length} races`, 'ok');
    } else if (store.mode === 'cloud') {
      const groups = groupByHorse(state.races);
      const ids = new Set([...groups.keys(), ...store.serverHorses.keys()]);
      for (const id of ids) {
        const json = groups.has(id) ? JSON.stringify(groups.get(id)) : null;
        if (json !== (store.serverHorses.get(id) ?? null)) scheduleWrite(id);
      }
      const settings = JSON.stringify({ sources: state.sources, fitReport: state.fitReport });
      if (settings !== store.serverSettings) scheduleWrite('@settings');
      cloudStatus();
    }
    renderAll();
  }

  function scheduleWrite(id) {
    const w = store.writing.get(id);
    if (w) { w.again = true; return; }
    store.writing.set(id, { again: false });
    store.queue.push(id);
    pump();
  }

  function pump() {
    while (store.active < 4 && store.queue.length) {
      const id = store.queue.shift();
      store.active++;
      writeDoc(id).finally(() => {
        store.active--;
        const w = store.writing.get(id);
        store.writing.delete(id);
        if (w && w.again) scheduleWrite(id);
        pump();
        cloudStatus();
      });
    }
  }

  async function writeDoc(id) {
    // Always writes the latest state, so a burst of edits collapses into one write.
    let op, json;
    if (id === '@settings') {
      json = JSON.stringify({ sources: state.sources, fitReport: state.fitReport });
      op = () => store.db.doc('settings/main').set(JSON.parse(json));
    } else {
      const races = groupByHorse(state.races).get(id);
      json = races ? JSON.stringify(races) : null;
      const ref = store.db.doc('horses/' + id);
      op = races ? () => ref.set({ name: races[0].horse || '', races, updatedAt: new Date().toISOString() }) : () => ref.delete();
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await op();
        if (id === '@settings') store.serverSettings = json;
        else if (json == null) store.serverHorses.delete(id);
        else store.serverHorses.set(id, json);
        store.failed = false;
        return;
      } catch (e) {
        const code = e && e.code;
        if (code === 'invalid_argument' && store.mode === 'cloud') {
          store.mode = 'readonly';
          renderAll();
          return;
        }
        if (code === 'quota_exceeded') {
          store.failed = true;
          setStatus('Your saved-data space is full. Delete horses you no longer need, then try again.', 'bad');
          return;
        }
        if (code !== 'unavailable' && code !== 'resource_exhausted') break;
        await new Promise((r) => setTimeout(r, 400 * Math.pow(2, attempt) + Math.random() * 300));
      }
    }
    store.failed = true;
  }

  function startLocal() {
    store.mode = 'local';
    const saved = readJSON(LOCAL_KEY);
    if (saved) {
      state.races = saved.races || [];
      state.sources = withNewSources(saved.sources);
      state.fitReport = saved.fitReport || null;
    }
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* optional */ }
    setStatus(`Saved in this browser · ${state.races.length} races`, 'ok');
    renderAll();
  }

  async function startCloud(db) {
    store.db = db;
    store.mode = 'cloud';
    try {
      const user = await window.claude.use('user');
      if (user && typeof user.can === 'function') {
        const can = await user.can('data.write');
        if (can === false) store.mode = 'readonly';
      }
    } catch (e) { /* unknown: keep editing enabled; a refused write will tell us */ }
    try { store.downloads = await window.claude.use('downloads'); } catch (e) { store.downloads = null; }

    setStatus('Loading your saved data…', 'busy');
    let firstHorses = true;
    db.collection('horses').onSnapshot((snap) => {
      const races = [];
      store.serverHorses = new Map();
      for (const d of snap.docs) {
        const body = d.data() || {};
        const list = Array.isArray(body.races) ? body.races : [];
        store.serverHorses.set(d.id, JSON.stringify(list));
        for (const r of list) races.push(Object.assign({}, r));
      }
      // Our own in-flight edits are newer than what the server echoes back.
      if (store.active + store.queue.length && !firstHorses) return;
      sortRaces(races);
      const before = JSON.stringify(state.races);
      state.races = races;
      if (firstHorses) { firstHorses = false; offerLocalMigration(); }
      cloudStatus();
      if (JSON.stringify(races) !== before) renderAll();
    }, () => setStatus('Lost the connection to your saved data. Reload the page to reconnect.', 'bad'));

    db.doc('settings/main').onSnapshot((snap) => {
      if (!snap.exists) return;
      const body = snap.data();
      store.serverSettings = JSON.stringify({ sources: body.sources, fitReport: body.fitReport ?? null });
      if (store.writing.has('@settings')) return;
      state.sources = withNewSources(body.sources);
      state.fitReport = body.fitReport || null;
      renderAll();
    }, () => {});
    renderAll();
  }

  /** Races typed in before the page connected to the account (or kept from an older local version). */
  function offerLocalMigration() {
    const saved = readJSON(LOCAL_KEY);
    const n = saved && saved.races ? saved.races.length : 0;
    const box = $('#migrate');
    if (!n || store.mode !== 'cloud') { box.hidden = true; return; }
    box.hidden = false;
    $('#migrate-text').textContent = `${n} races are saved only in this browser. Add them to your account so they show up everywhere?`;
  }
  $('#migrate-yes').addEventListener('click', () => {
    const saved = readJSON(LOCAL_KEY) || {};
    const r = F.mergeRaces(state.races, saved.races || []);
    state.races = r.races;
    try { localStorage.removeItem(LOCAL_KEY); } catch (e) { /* ignore */ }
    $('#migrate').hidden = true;
    flash(`Moved ${r.added} new and ${r.updated} updated races into your account.`);
    persist();
  });
  $('#migrate-no').addEventListener('click', () => { $('#migrate').hidden = true; });

  function boot() {
    if (!window.claude || typeof window.claude.use !== 'function') { startLocal(); return; }
    setStatus('Connecting to your saved data…', 'busy');
    window.claude.use('db').then((db) => (db ? startCloud(db) : startLocal()), startLocal);
  }

  /* ---------- small UI helpers ---------- */
  let flashTimer;
  function flash(msg) {
    $('#import-msg').textContent = msg;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { $('#import-msg').textContent = ''; }, 12000);
  }

  /** Two-step confirm inside the button itself (dialogs don't work everywhere). */
  function confirmButton(btn, question, action) {
    btn.addEventListener('click', () => {
      if (btn.dataset.armed) {
        clearTimeout(+btn.dataset.timer);
        delete btn.dataset.armed;
        btn.textContent = btn.dataset.label;
        action();
        return;
      }
      const q = question();
      if (!q) return;
      btn.dataset.label = btn.textContent;
      btn.dataset.armed = '1';
      btn.textContent = q;
      btn.dataset.timer = setTimeout(() => { delete btn.dataset.armed; btn.textContent = btn.dataset.label; }, 4000);
    });
  }

  async function offerFile(filename, text, type) {
    if (store.downloads) {
      try { await store.downloads.save({ filename, data: new Blob([text], { type }) }); } catch (e) { /* declined */ }
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const canEdit = () => store.mode === 'cloud' || store.mode === 'local';

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

    const box = $('#blend-inputs');
    if (!box.dataset.built) {
      box.innerHTML = `<label>Distance <input id="blend-distance" data-blend="distance" value="1m" size="8"></label>` +
        state.sources.map((s) => `<label>${esc(s.short)} <input id="blend-${s.id}" data-blend="${s.id}" size="5"></label>`).join('');
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
  function shownRaceIndexes() {
    const q = $('#fig-filter').value.trim().toLowerCase();
    const out = [];
    state.races.forEach((r, i) => { if (!q || String(r.horse || '').toLowerCase().includes(q)) out.push(i); });
    return out;
  }

  function renderFigures() {
    const srcs = enabled();
    const ro = !canEdit();
    document.querySelectorAll('.edit-only').forEach((el) => { el.hidden = ro; });
    const cols = [['horse', 'Horse', 'wide'], ['date', 'Date', ''], ['track', 'Trk', ''], ['distance', 'Dist', '']]
      .concat(srcs.map((s) => [s.id, s.short, 'fig']));
    const shown = shownRaceIndexes();
    const head = '<tr>' + cols.map((c) => `<th>${esc(c[1])}</th>`).join('') + '<th class="num">Unified</th><th class="num">Spread</th><th></th></tr>';
    const body = shown.slice(0, MAX_TABLE_ROWS).map((i) => {
      const r = state.races[i];
      const c = F.combineRace(r, state.sources);
      return '<tr>' + cols.map(([k, , cls]) => {
        let bad = false;
        if (cls === 'fig' && r[k] != null && r[k] !== '') bad = F.parseFigure(r[k]) == null;
        if (k === 'distance' && r[k]) bad = F.parseDistance(r[k]) == null;
        return `<td><input data-row="${i}" data-key="${k}" value="${esc(r[k])}" aria-label="${esc(k)}" class="${cls === 'wide' ? 'wide' : ''}${bad ? ' bad' : ''}"${ro ? ' readonly' : ''}></td>`;
      }).join('') +
        `<td class="num"><b>${c ? fmt(c.unified) : '–'}</b></td><td class="num">${c && c.n > 1 ? fmt(c.spread) : ''}</td>` +
        `<td>${ro ? '' : `<button data-del="${i}" title="Delete row" aria-label="Delete row">&times;</button>`}</td></tr>`;
    }).join('');
    const empty = state.races.length ? 'No horses match that filter.' : 'No races yet. Import your PP or sheet files above, or load the sample.';
    $('#fig-table').innerHTML = head + (body || `<tr><td colspan="${cols.length + 3}" class="hint">${empty}</td></tr>`);
    $('#fig-count').textContent = shown.length > MAX_TABLE_ROWS
      ? `Showing ${MAX_TABLE_ROWS} of ${shown.length} races. Filter by horse to see the rest.`
      : `${shown.length} of ${state.races.length} races`;
  }

  $('#fig-filter').addEventListener('input', renderFigures);
  $('#fig-table').addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.row == null || !canEdit()) return;
    const r = state.races[+t.dataset.row];
    const v = t.value.trim();
    if (v) r[t.dataset.key] = t.dataset.key === 'date' ? F.normalizeDate(v) : v;
    else delete r[t.dataset.key];
    persist();
  });
  $('#fig-table').addEventListener('click', (e) => {
    const d = e.target.dataset.del;
    if (d == null || !canEdit()) return;
    state.races.splice(+d, 1);
    persist();
  });
  $('#add-row').addEventListener('click', () => {
    state.races.push({ horse: '' });
    $('#fig-filter').value = '';
    persist();
    const first = document.querySelector('#fig-table input[data-key="horse"]');
    if (first) first.focus();
  });
  $('#load-sample').addEventListener('click', () => importText(SAMPLE_CSV, 'the fictional sample'));
  $('#paste-toggle').addEventListener('click', () => { $('#paste-box').hidden = !$('#paste-box').hidden; });
  $('#paste-apply').addEventListener('click', () => { importText($('#paste-text').value, 'pasted text'); $('#paste-text').value = ''; });
  $('#csv-file').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    const notes = [];
    for (const f of files) notes.push(importText(await f.text(), f.name, true));
    flash(notes.join(' '));
    persist();
  });
  confirmButton($('#delete-shown'), () => {
    const n = shownRaceIndexes().length;
    if (!n) return null;
    return $('#fig-filter').value.trim() ? `Delete these ${n} races?` : `Delete all ${n} races?`;
  }, () => {
    const drop = new Set(shownRaceIndexes());
    state.races = state.races.filter((_, i) => !drop.has(i));
    persist();
  });
  $('#export-csv').addEventListener('click', () => offerFile('unified-figures.csv', F.toCSV(state.races, state.sources), 'text/csv'));

  function importText(text, label, batch) {
    if (!canEdit()) return '';
    const { races, unknownColumns } = F.parseCSV(text);
    const r = F.mergeRaces(state.races, races);
    state.races = r.races;
    const parts = [`${label}: ${r.added} new race${r.added === 1 ? '' : 's'}`];
    if (r.updated) parts.push(`${r.updated} updated with new figures`);
    if (r.unchanged) parts.push(`${r.unchanged} already saved`);
    const note = parts.join(', ') + '.' + (unknownColumns.length ? ' Ignored columns: ' + unknownColumns.join(', ') + '.' : '');
    if (batch) return note;
    flash(note);
    persist();
    return note;
  }

  /* ---------- backup ---------- */
  $('#backup').addEventListener('click', () => {
    const data = { app: 'horsey', version: 1, savedAt: new Date().toISOString(), races: state.races, sources: state.sources, fitReport: state.fitReport };
    offerFile(`horsey-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 1), 'application/json');
  });
  $('#restore-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f || !canEdit()) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data || !Array.isArray(data.races)) throw new Error('not a backup');
      const r = F.mergeRaces(state.races, data.races);
      state.races = r.races;
      if (Array.isArray(data.sources)) state.sources = withNewSources(data.sources);
      if (data.fitReport !== undefined) state.fitReport = data.fitReport;
      flash(`Restored ${f.name}: ${r.added} new, ${r.updated} updated, ${r.unchanged} already saved. Calibration restored.`);
      persist();
    } catch (err) {
      flash(`${f.name} isn't a Horsey backup file. Choose a .json file made with "Download backup".`);
    }
  });

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
      const open = prefs.open[h.horse];
      const trendCls = h.trend > 1 ? 'up' : h.trend < -1 ? 'down' : '';
      let html = `<tr class="horse" data-horse="${esc(h.horse)}" tabindex="0"><td>${i + 1}</td><td><b>${open ? '▾' : '▸'} ${esc(h.horse)}</b></td>` +
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
    $('#rank-table').innerHTML = head + (body || '<tr><td colspan="9" class="hint">No rated horses yet. Import races on the Figures tab.</td></tr>');
  }
  function toggleHorse(e) {
    const tr = e.target.closest('tr.horse');
    if (!tr || (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    const h = tr.dataset.horse;
    prefs.open[h] = !prefs.open[h];
    writeJSON(PREFS_KEY, prefs);
    renderRankings();
  }
  $('#rank-table').addEventListener('click', toggleHorse);
  $('#rank-table').addEventListener('keydown', toggleHorse);
  ['#opt-lastn', '#opt-decay', '#opt-filter'].forEach((id) => $(id).addEventListener('input', renderRankings));

  /* ---------- calibration ---------- */
  function renderCalibration() {
    const rep = state.fitReport || {};
    const ro = !canEdit();
    const head = '<tr><th>Use</th><th>Product</th><th>Better</th><th>Sheet (lengths)</th><th class="num">Weight</th>' +
      '<th class="num">Intercept</th><th class="num">Slope</th><th class="num">Fit n</th><th class="num">r</th><th class="num">RMSE</th><th>Notes</th></tr>';
    const body = state.sources.map((s, i) => {
      const r = rep[s.id];
      const fitCells = s.anchor ? '<td colspan="3" class="hint">anchor</td>' : !r ? '<td></td><td></td><td></td>' :
        `<td class="num">${r.n}</td><td class="num">${r.fitted ? fmt(Math.abs(r.r), 3) : '–'}</td>` +
        `<td class="num">${r.fitted ? fmt(r.rmse, 2) : `<span class="hint">${r.n < 5 ? 'too few' : 'skipped'}</span>`}</td>`;
      const dis = (extra) => (ro || extra ? ' disabled' : '');
      const num = (k, step, extra) => `<td class="num"><input type="number" step="${step}" id="cal-${s.id}-${k}" data-src="${i}" data-key="${k}" value="${s[k]}" style="width:6.5em"${dis(extra)}></td>`;
      return `<tr><td><input type="checkbox" id="cal-${s.id}-enabled" aria-label="Use ${esc(s.name)}" data-src="${i}" data-key="enabled"${s.enabled ? ' checked' : ''}${dis()}></td>` +
        `<td>${esc(s.name)}</td><td>${s.higherIsBetter ? 'higher' : 'lower'}</td>` +
        `<td><input type="checkbox" id="cal-${s.id}-lengthBased" aria-label="${esc(s.name)} is length-based" data-src="${i}" data-key="lengthBased"${s.lengthBased ? ' checked' : ''}${dis(s.anchor)}></td>` +
        num('weight', 0.1) + num('intercept', 0.5, s.anchor) + num('slope', 0.05, s.anchor) + fitCells +
        `<td class="hint" style="white-space:normal;min-width:220px">${esc(s.note)}</td></tr>`;
    }).join('');
    $('#cal-table').innerHTML = head + body;
    $('#fit').disabled = ro;
    $('#reset-cal').disabled = ro;

    const dist = $('#chart-dist').value;
    const srcs = enabled().filter((s) => !s.anchor);
    const levels = [120, 115, 110, 105, 100, 95, 90, 85, 80, 75, 70, 60];
    $('#eq-table').innerHTML = '<tr><th class="num">Unified</th>' + srcs.map((s) => `<th class="num">${esc(s.short)}</th>`).join('') + '</tr>' +
      levels.map((u) => `<tr><td class="num"><b>${u}</b></td>` + srcs.map((s) =>
        `<td class="num">${fmt(F.fromUnified(s, u, dist), s.lengthBased ? 1 : 0)}</td>`).join('') + '</tr>').join('');
  }

  $('#cal-table').addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.src == null || !canEdit()) return;
    const s = state.sources[+t.dataset.src];
    if (t.type === 'checkbox') s[t.dataset.key] = t.checked;
    else if (t.value !== '' && Number.isFinite(+t.value)) s[t.dataset.key] = +t.value;
    persist();
  });
  $('#chart-dist').addEventListener('input', renderCalibration);
  $('#fit').addEventListener('click', () => {
    if (!state.races.length) { $('#fit-msg').textContent = 'Import races first.'; return; }
    const { sources, report } = F.fitCalibration(state.races, state.sources);
    state.sources = sources;
    state.fitReport = report;
    const fitted = Object.values(report).filter((r) => r.fitted).length;
    $('#fit-msg').textContent = `Fitted ${fitted} product${fitted === 1 ? '' : 's'} from ${state.races.length} races. Saved.`;
    persist();
  });
  confirmButton($('#reset-cal'), () => 'Replace your calibration with defaults?', () => {
    state.sources = F.cloneSources();
    state.fitReport = null;
    $('#fit-msg').textContent = 'Defaults restored.';
    persist();
  });

  function renderAll() {
    const active = document.querySelector('.tab.active').id;
    if (active === 'tab-convert') renderConvert();
    if (active === 'tab-figures') renderFigures();
    if (active === 'tab-rankings') renderRankings();
    if (active === 'tab-calibration') renderCalibration();
  }
  renderAll();
  boot();
})();
