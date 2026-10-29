/* global Figures, Card, SAMPLE_CSV, SAMPLE_ENTRIES_CSV */
(function () {
  'use strict';
  const F = Figures;
  const C = Card;
  const LOCAL_KEY = 'horsey.v1';      // races + calibration when running outside claude.ai
  const PREFS_KEY = 'horsey.prefs.v1'; // per-browser UI conveniences only
  const MAX_TABLE_ROWS = 300;

  const $ = (sel) => document.querySelector(sel);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v, p = 1) => (v == null || !Number.isFinite(v) ? '–' : v.toFixed(p).replace(/^-(0\.?0*)$/, '$1'));
  const enabled = () => src().filter((s) => s.enabled);

  /*
   * Calibration actually used for every figure on screen. With automatic
   * calibration on (the default), each product's scale is fitted from the
   * saved races whenever they change, so products that run hot or cold
   * (ThoroManager and Equibase run ~10 points above Beyer) line up before
   * they are blended or compared.
   */
  let dataRev = 0;
  let calMemo = { key: null, value: null };
  function calibrated() {
    const key = `${dataRev}|${state.autoCal}|${JSON.stringify(state.sources)}`;
    if (calMemo.key === key) return calMemo.value;
    let value = { sources: state.sources, report: state.fitReport };
    if (state.autoCal && state.races.length) {
      const fit = F.fitCalibration(state.races, state.sources, { minPairs: 20 });
      value = { sources: fit.sources, report: fit.report };
    }
    calMemo = { key, value };
    return value;
  }
  const src = () => calibrated().sources;
  const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } };

  const state = { races: [], cards: {}, sources: F.cloneSources(), fitReport: null, autoCal: true };
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
    serverCards: new Map(),  // card id -> JSON of the card as last seen/written
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

  const settingsJSON = () => JSON.stringify({ sources: state.sources, fitReport: state.fitReport, autoCalibrate: state.autoCal });

  /** Call after any change to races or calibration. */
  function persist() {
    dataRev++;
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
      for (const id of new Set([...Object.keys(state.cards), ...store.serverCards.keys()])) {
        const json = state.cards[id] ? JSON.stringify(state.cards[id]) : null;
        if (json !== (store.serverCards.get(id) ?? null)) scheduleWrite('card:' + id);
      }
      if (settingsJSON() !== store.serverSettings) scheduleWrite('@settings');
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
    let cardId = null;
    if (id === '@settings') {
      json = settingsJSON();
      op = () => store.db.doc('settings/main').set(JSON.parse(json));
    } else if (id.startsWith('card:')) {
      cardId = id.slice(5);
      const card = state.cards[cardId];
      json = card ? JSON.stringify(card) : null;
      const ref = store.db.doc('cards/' + cardId);
      op = card ? () => ref.set(JSON.parse(json)) : () => ref.delete();
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
        else if (cardId) { if (json == null) store.serverCards.delete(cardId); else store.serverCards.set(cardId, json); }
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
      state.cards = saved.cards || {};
      state.autoCal = saved.autoCal !== false;
      dataRev++;
    }
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* optional */ }
    offerRelink();
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
      dataRev++;
      if (firstHorses) { firstHorses = false; offerLocalMigration(); }
      offerRelink();
      cloudStatus();
      if (JSON.stringify(races) !== before) renderAll();
    }, () => setStatus('Lost the connection to your saved data. Reload the page to reconnect.', 'bad'));

    db.collection('cards').onSnapshot((snap) => {
      const cards = {};
      store.serverCards = new Map();
      for (const d of snap.docs) {
        const body = d.data();
        if (!body) continue;
        store.serverCards.set(d.id, JSON.stringify(body));
        cards[d.id] = JSON.parse(JSON.stringify(body));
      }
      if ([...store.writing.keys()].some((k) => k.startsWith('card:'))) return;
      if (JSON.stringify(cards) !== JSON.stringify(state.cards)) { state.cards = cards; renderAll(); offerRelink(); }
    }, () => {});

    db.doc('settings/main').onSnapshot((snap) => {
      if (!snap.exists) return;
      const body = snap.data();
      store.serverSettings = JSON.stringify({ sources: body.sources, fitReport: body.fitReport ?? null, autoCalibrate: body.autoCalibrate !== false });
      if (store.writing.has('@settings')) return;
      state.sources = withNewSources(body.sources);
      state.fitReport = body.fitReport || null;
      state.autoCal = body.autoCalibrate !== false;
      renderAll();
      offerRelink();
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
    const r = F.mergeRaces(state.races, saved.races || [], mergeOpts());
    state.races = r.races;
    try { localStorage.removeItem(LOCAL_KEY); } catch (e) { /* ignore */ }
    $('#migrate').hidden = true;
    flash(`Moved ${r.added} new and ${r.updated} updated races into your account.`);
    persist();
  });
  $('#migrate-no').addEventListener('click', () => { $('#migrate').hidden = true; });

  /** Options for combining rows: calibrated figures break ties, names on race cards win. */
  function mergeOpts() {
    const preferNames = [];
    for (const c of Object.values(state.cards)) for (const r of Object.values(c.races || {})) for (const e of r.entries) preferNames.push(e.horse);
    return { today: new Date().toISOString().slice(0, 10), sources: src(), preferNames, remap: F.productRemap(state.sources) };
  }

  function describeCleanup(c) {
    const bits = [];
    const target = Object.values(F.productRemap(state.sources))[0];
    if (c.relabeled) bits.push(`${c.relabeled} figures filed under a product you don't use, moved to ${(state.sources.find((s) => s.id === target) || { name: target }).name.replace(/ PPs$/, '')}`);
    if (c.repeats) bits.push(`${c.repeats} repeated runs (a second read that missed the date)`);
    if (c.linked) bits.push(`${c.linked} runs saved separately per product`);
    if (c.aliases.length) bits.push(`${c.aliases.length} horse${c.aliases.length === 1 ? '' : 's'} saved under two names (${c.aliases.map(([a, b]) => `${a} = ${b}`).join(', ')})`);
    if (c.fixedDates) bits.push(`${c.fixedDates} date${c.fixedDates === 1 ? '' : 's'} with the wrong year`);
    return bits.join('; ');
  }

  /** Saved rows that don't combine correctly yet (saved before the current matching rules). */
  let relinkDismissed = false;
  let relinkMemo = { rev: '', result: null };
  function pendingCleanup() {
    const rev = `${dataRev}|${state.sources.map((s) => +!!s.enabled).join('')}|${Object.keys(state.cards).length}`;
    if (relinkMemo.rev !== rev) relinkMemo = { rev, result: F.cleanupRaces(state.races, mergeOpts()) };
    return relinkMemo.result;
  }
  function offerRelink() {
    if (relinkDismissed || !canEdit() || store.active + store.queue.length) return;
    const c = pendingCleanup();
    $('#relink').hidden = !c.total;
    if (c.total) $('#relink-text').textContent = `Your saved races can be combined better: ${describeCleanup(c)}. Clean them up?`;
  }
  $('#relink-yes').addEventListener('click', () => {
    const c = pendingCleanup();
    const before = state.races.length;
    state.races = c.races;
    relinkDismissed = true;
    $('#relink-text').textContent = `Cleaned up: ${describeCleanup(c)}. ${before} rows are now ${c.races.length}.`;
    $('#relink-yes').hidden = true;
    $('#relink-no').textContent = 'Close';
    persist();
  });
  $('#relink-no').addEventListener('click', () => {
    relinkDismissed = true;
    $('#relink').hidden = true;
    $('#relink-yes').hidden = false;
    $('#relink-no').textContent = 'Not now';
  });

  function boot() {
    initSample();
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

  async function offerFile(filename, data, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    if (store.downloads) {
      try { await store.downloads.save({ filename, data: blob }); } catch (e) { /* declined */ }
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
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
    sel.innerHTML = enabled().map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    sel.value = enabled().some((s) => s.id === prev) ? prev : 'beyer';

    const dist = $('#cv-dist').value;
    const fur = F.parseDistance(dist);
    const res = F.convertAcross(src(), sel.value, $('#cv-value').value, dist);
    if (!res) { $('#cv-out').innerHTML = '<p class="hint">Enter a figure.</p>'; return; }
    $('#cv-out').innerHTML =
      `<div class="row"><span>Unified</span><span class="big">${fmt(res.unified)}</span>` +
      `<span class="hint">${fur ? fur + ' furlongs' : '<span class="warn">distance not recognised; sheets assume 1 mile</span>'}</span></div>` +
      '<div class="cards">' + res.equivalents.filter((e) => e.id !== sel.value && enabled().some((s) => s.id === e.id)).map((e) => {
        const s = src().find((x) => x.id === e.id);
        const p = s.lengthBased ? 2 : 0;
        return `<div class="card"><div class="k">${esc(s.name)}</div><div class="v">${fmt(e.value, p)}</div></div>`;
      }).join('') + '</div>';

    const box = $('#blend-inputs');
    const used = enabled().map((s) => s.id).join(',');
    if (box.dataset.built !== used) {
      const keep = {};
      box.querySelectorAll('[data-blend]').forEach((i) => { keep[i.dataset.blend] = i.value; });
      box.innerHTML = `<label>Distance <input id="blend-distance" data-blend="distance" value="${esc(keep.distance ?? '1m')}" size="8"></label>` +
        enabled().map((s) => `<label>${esc(s.short)} <input id="blend-${s.id}" data-blend="${s.id}" value="${esc(keep[s.id] ?? '')}" size="5"></label>`).join('');
      if (!box.dataset.built) box.addEventListener('input', renderBlend);
      box.dataset.built = used;
    }
    renderBlend();
  }

  function renderBlend() {
    const race = {};
    document.querySelectorAll('[data-blend]').forEach((i) => { race[i.dataset.blend] = i.value; });
    const c = F.combineRace(race, src());
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
      const c = F.combineRace(r, src());
      return '<tr>' + cols.map(([k, , cls]) => {
        let bad = false;
        if (cls === 'fig' && r[k] != null && r[k] !== '') bad = F.parseFigure(r[k]) == null;
        if (k === 'distance' && r[k]) bad = F.parseDistance(r[k]) == null;
        return `<td><input data-row="${i}" data-key="${k}" value="${esc(r[k])}" aria-label="${esc(k)}"${k === 'date' && !r.date && r.month ? ` placeholder="${esc(r.month)}"` : ''} class="${cls === 'wide' ? 'wide' : ''}${bad ? ' bad' : ''}"${ro ? ' readonly' : ''}></td>`;
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
  $('#load-sample').addEventListener('click', () => {
    const races = importText(SAMPLE_CSV, 'the fictional sample', true);
    const cards = importEntries(F.parseCSV(SAMPLE_ENTRIES_CSV).races, 'sample race card');
    flash(races + ' ' + cards);
    persist();
  });
  $('#paste-toggle').addEventListener('click', () => { $('#paste-box').hidden = !$('#paste-box').hidden; });
  $('#paste-apply').addEventListener('click', () => {
    const text = $('#paste-text').value;
    $('#paste-text').value = '';
    // Rows with figure columns import directly; anything else (text copied out of a PP) goes to Claude.
    if (hasFigureColumns(F.parseCSV(text).races) || !raw.sample) importText(text, 'pasted text');
    else processRawFiles([new File([text], 'pasted text.txt', { type: 'text/plain' })]);
  });
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
  $('#export-csv').addEventListener('click', () => offerFile('unified-figures.csv', F.toCSV(state.races, src()), 'text/csv'));

  /** CSV with race + post columns: today's entries. Track and date may be columns too. */
  function importEntries(rows, label) {
    const r = C.mergeEntries(state.cards, rows);
    state.cards = r.cards;
    if (r.changedIds.length) ui.card = r.changedIds[0];
    const skipped = rows.length - r.added - r.updated;
    return `${label}: ${r.added} entries added, ${r.updated} updated` + (skipped ? ` (${skipped} unchanged or missing a track/date)` : '') + '.';
  }

  function importText(text, label, batch) {
    if (!canEdit()) return '';
    const { races, unknownColumns } = F.parseCSV(text);
    if (races.some((r) => r.post && r.race)) {
      const note = importEntries(races, label);
      if (!batch) { flash(note); persist(); }
      return note;
    }
    const r = F.mergeRaces(state.races, races, mergeOpts());
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

  /* ---------- raw files: PDFs and photos read by Claude ---------- */
  const X = window.Extract;
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  const raw = { sample: null, limits: null, ctl: null, rows: [], entries: [], running: false, seq: 0 };

  function renderProductPicker() {
    const sel = $('#raw-product');
    const prev = sel.value || 'auto';
    const label = { beyer: 'DRF (Beyer)' };
    sel.innerHTML = '<option value="auto">Detect automatically</option>' +
      enabled().map((s) => `<option value="${s.id}">${esc(label[s.id] || s.name)}</option>`).join('');
    sel.value = [...sel.options].some((op) => op.value === prev) ? prev : 'auto';
  }

  async function initSample() {
    try { raw.sample = window.claude ? await window.claude.use('sample') : null; } catch (e) { raw.sample = null; }
    if (raw.sample) {
      try { raw.limits = await raw.sample.limits(); } catch (e) { raw.limits = null; }
    }
    $('#raw-cost').textContent = raw.sample
      ? 'Claude reads PDFs and photos on your account, so it uses some of your Claude usage. Nothing is saved until you check it.'
      : 'Reading PDFs and photos uses Claude, which works on the hosted page at claude.ai. CSV files import here.';
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load the PDF reader. Check your connection and try again.'));
      document.head.appendChild(s);
    });
  }
  let pdfReady;
  function pdfjs() {
    // The worker script runs on the main thread (pdf.js picks up window.pdfjsWorker),
    // because the page can't start workers from another site.
    pdfReady = pdfReady || loadScript(PDFJS + 'pdf.min.js').then(() => loadScript(PDFJS + 'pdf.worker.min.js')).then(() => window.pdfjsLib);
    return pdfReady;
  }

  const kindOf = (f) => (/\.pdf$/i.test(f.name) || f.type === 'application/pdf' ? 'pdf'
    : /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|heic)$/i.test(f.name) ? 'image' : 'text');

  /** Split a tall page or photo into overlapping strips so small print stays legible. */
  async function tiles(source, w, h) {
    const max = Math.max(1, Math.min((raw.limits && raw.limits.images && raw.limits.images.maxCount) || 3, 3));
    const n = Math.min(max, h > w * 2.2 ? 3 : h > w * 1.2 ? 2 : 1);
    const overlap = n > 1 ? Math.round(h * 0.04) : 0;
    const step = Math.ceil(h / n);
    const out = [];
    for (let i = 0; i < n; i++) {
      const y0 = Math.max(0, i * step - overlap);
      const y1 = Math.min(h, (i + 1) * step + overlap);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = y1 - y0;
      c.getContext('2d').drawImage(source, 0, y0, w, y1 - y0, 0, 0, w, y1 - y0);
      out.push(await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9)));
    }
    return out;
  }

  async function imageJob(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error(`${file.name} isn't an image this browser can open. Try a JPEG or PNG.`));
        i.src = url;
      });
      return { kind: 'images', blobs: await tiles(img, img.naturalWidth, img.naturalHeight), source: file.name };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function pdfJobs(file) {
    const lib = await pdfjs();
    const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const jobs = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const text = X.layoutText(content.items.map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height })));
      const source = `${file.name} p.${n}`;
      if (text.replace(/\s/g, '').length >= 30) {
        jobs.push({ kind: 'text', text, source });
      } else {
        // Scanned page with no text layer: send a picture instead.
        const vp1 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: Math.min(3, 2400 / Math.max(vp1.width, vp1.height)) });
        const c = document.createElement('canvas');
        c.width = Math.round(vp.width);
        c.height = Math.round(vp.height);
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        jobs.push({ kind: 'images', blobs: await tiles(c, c.width, c.height), source });
      }
    }
    return jobs;
  }

  function textJobs(text, source) {
    const jobs = [];
    const CHUNK = 14000;
    for (let i = 0, part = 1; i < text.length; i += CHUNK, part++) {
      jobs.push({ kind: 'text', text: text.slice(i, i + CHUNK), source: text.length > CHUNK ? `${source} part ${part}` : source });
    }
    return jobs;
  }

  const hasFigureColumns = (races) => races.some((r) => X.PRODUCT_IDS.some((p) => r[p] != null));

  function progress(text) {
    $('#raw-progress').hidden = false;
    $('#raw-progress-text').textContent = text;
    $('#raw-stop').hidden = !raw.running;
  }

  const SAMPLE_ERRORS = {
    not_granted: 'Claude wasn\'t allowed to read files on this page. Reload and choose Allow to read PDFs and photos.',
    sampling_disabled: 'Claude isn\'t available on this account, so PDFs and photos can\'t be read here. CSV files still work.',
    rate_limited: 'You\'ve hit a Claude usage limit. What was read so far is below; drop the remaining files again later.',
    session_expired: 'Your claude.ai session expired. Sign in again, then drop the files again.',
    images_unavailable: 'Photos and scanned pages can\'t be read in this view. PDFs with text and CSV files still work.',
  };

  async function processRawFiles(files) {
    if (!canEdit() || raw.running || !files.length) return;
    const product = $('#raw-product').value;
    const jobs = [];
    const notes = [];
    raw.running = true;
    raw.ctl = new AbortController();
    try {
      progress('Opening files…');
      for (const f of files) {
        const kind = kindOf(f);
        try {
          if (kind === 'text') {
            const text = await f.text();
            const parsed = F.parseCSV(text);
                  if (hasFigureColumns(parsed.races)) { notes.push(importText(text, f.name, true)); continue; }
            if (raw.sample) jobs.push(...textJobs(text, f.name));
            else notes.push(`${f.name}: no figure columns found.`);
          } else if (!raw.sample) {
            notes.push(`${f.name}: reading PDFs and photos needs the hosted page at claude.ai.`);
          } else if (kind === 'pdf') {
            jobs.push(...await pdfJobs(f));
          } else {
            if (!raw.limits || !raw.limits.images) { notes.push(`${f.name}: ${SAMPLE_ERRORS.images_unavailable}`); continue; }
            jobs.push(await imageJob(f));
          }
        } catch (e) {
          notes.push(`${f.name}: couldn't be opened (${(e && e.message) || 'unknown error'}).`);
        }
      }
      if (notes.length) { flash(notes.join(' ')); persist(); }

      let done = 0, found = 0, failed = 0, stopReason = '';
      const today = new Date().toISOString().slice(0, 10);
      const runJob = async (job) => {
        const prompt = X.buildPrompt({ product, products: state.sources.filter((s) => s.enabled).map((s) => s.id), today, source: job.source, text: job.kind === 'text' ? job.text : undefined, images: job.blobs ? job.blobs.length : 0 });
        const opts = { signal: raw.ctl.signal, cache: { gcTime: 86400000 } };
        if (job.blobs) opts.images = job.blobs;
        try {
          const answer = await raw.sample.json(prompt, opts);
          const res = X.normalizeExtraction(answer, product === 'auto' ? null : product, today, F.productRemap(state.sources));
          for (const r of res.rows) raw.rows.push(Object.assign(r, { _id: ++raw.seq, _src: job.source, _checked: true }));
          raw.entries.push(...res.entries);
          found += res.rows.length;
          renderRaw();
        } catch (e) {
          const code = e && e.code;
          if (code === 'cancelled') { stopReason = stopReason || 'Stopped.'; return; }
          if (SAMPLE_ERRORS[code] && code !== 'images_unavailable') { stopReason = SAMPLE_ERRORS[code]; raw.ctl.abort(); return; }
          failed++;
        } finally {
          done++;
          if (!stopReason) progress(`Reading page ${Math.min(done + 1, jobs.length)} of ${jobs.length}… ${found} races found so far.`);
        }
      };
      if (jobs.length) {
        progress(`Reading page 1 of ${jobs.length}…`);
        let next = 0;
        const worker = async () => { while (next < jobs.length && !raw.ctl.signal.aborted) await runJob(jobs[next++]); };
        await Promise.all([worker(), worker()]);
      }
      raw.running = false;
      const filled = X.resolveMonthOnlyDates(raw.rows.filter((r) => !r.date), state.races.concat(raw.rows.filter((r) => r.date)));
      if (jobs.length) {
        const bits = [`Read ${done} page${done === 1 ? '' : 's'}: ${found} races found.`];
        if (filled) bits.push(`${filled} sheet dates matched to known races.`);
        if (failed) bits.push(`${failed} page${failed === 1 ? '' : 's'} couldn't be read; drop that file again to retry.`);
        if (stopReason) bits.push(stopReason);
        progress(bits.join(' '));
      } else {
        $('#raw-progress').hidden = true;
      }
      renderRaw();
    } finally {
      raw.running = false;
      $('#raw-stop').hidden = true;
    }
  }

  function rawStatus(r) {
    if (!r.date) return `<span class="pill warn">no exact date${r.month ? ` (${esc(r.month)})` : ''}</span>`;
    const k = F.raceKey(r);
    const saved = state.races.some((s) => F.raceKey(s) === k);
    const tag = r.dateFrom === 'matched' ? ' (day matched)' : '';
    if (saved) return `<span class="pill ok">adds to a saved race${tag}</span>`;
    const first = raw.rows.find((o) => o._checked && F.raceKey(o) === k);
    if (first && first !== r) {
      const p = X.PRODUCT_IDS.find((id) => first[id] != null);
      return `<span class="pill ok">same race as the ${esc((state.sources.find((s) => s.id === p) || { short: p }).short)} row${tag}</span>`;
    }
    return `<span class="pill">new race${tag}</span>`;
  }

  function renderRaw() {
    const box = $('#raw-review');
    if (!raw.rows.length && !raw.entries.length) { box.hidden = true; return; }
    box.hidden = false;
    const name = (id) => (state.sources.find((s) => s.id === id) || { short: id }).short;
    const head = '<tr><th></th><th>Horse</th><th>Date</th><th>Trk</th><th>Dist</th><th>Product</th><th>Figure</th><th>Status</th><th>From</th></tr>';
    const body = raw.rows.map((r) => {
      const p = X.PRODUCT_IDS.find((id) => r[id] != null);
      const inp = (k, cls) => `<input type="text" id="raw-${r._id}-${k}" data-raw="${r._id}" data-key="${k}" value="${esc(r[k])}" class="${cls || ''}" aria-label="${k}">`;
      return `<tr><td><input type="checkbox" id="raw-${r._id}-check" data-raw="${r._id}" data-key="_checked" aria-label="Save this race"${r._checked ? ' checked' : ''}></td>` +
        `<td>${inp('horse')}</td><td>${inp('date', 'date')}${!r.date && r.month ? `<div class="hint">${esc(r.month)}</div>` : ''}</td>` +
        `<td>${inp('track')}</td><td>${inp('distance')}</td><td>${esc(name(p))}</td><td>${inp(p)}</td>` +
        `<td>${rawStatus(r)}</td><td class="hint">${esc(r._src)}</td></tr>`;
    }).join('');
    $('#raw-table').innerHTML = head + body;
    const checked = raw.rows.filter((r) => r._checked).length;
    const undated = raw.rows.filter((r) => !r.date).length;
    $('#raw-save').textContent = `Save ${checked} checked race${checked === 1 ? '' : 's'}`;
    const cardsSeen = new Set(raw.entries.map((e) => C.cardId(e.track, e.date)));
    $('#raw-save').disabled = (!checked && !raw.entries.length) || raw.running;
    if (!checked && raw.entries.length) $('#raw-save').textContent = 'Save entries';
    $('#raw-summary').textContent = `${raw.rows.length} past races read.` +
      (raw.entries.length ? ` Also found ${raw.entries.length} entries (post positions) on ${cardsSeen.size} race card${cardsSeen.size === 1 ? '' : 's'}; they're saved with the races.` : '') +
      (undated ? ` ${undated} have no exact date. They'll still be saved and rated, but they can't combine with the same race from another product; type a date (YYYY-MM-DD) if you know it.` : '') +
      ' Fix anything that looks wrong before saving.';
  }

  $('#raw-table').addEventListener('change', (e) => {
    const t = e.target;
    const r = raw.rows.find((x) => x._id === +t.dataset.raw);
    if (!r) return;
    r._touched = true;
    if (t.dataset.key === '_checked') r._checked = t.checked;
    else {
      const v = t.value.trim();
      if (!v) delete r[t.dataset.key];
      else r[t.dataset.key] = t.dataset.key === 'date' ? F.normalizeDate(v) : v;
      if (t.dataset.key === 'date') delete r.dateFrom;
    }
    renderRaw();
  });
  $('#raw-all').addEventListener('change', (e) => {
    for (const r of raw.rows) r._checked = e.target.checked;
    renderRaw();
  });
  $('#raw-save').addEventListener('click', () => {
    const picked = raw.rows.filter((r) => r._checked).map((r) => {
      const o = {};
      for (const [k, v] of Object.entries(r)) if (!k.startsWith('_') && k !== 'dateFrom' && !(k === 'month' && r.date)) o[k] = v;
      return o;
    });
    const res = F.mergeRaces(state.races, picked, mergeOpts());
    state.races = res.races;
    raw.rows = raw.rows.filter((r) => !r._checked);
    let entryNote = '';
    if (raw.entries.length) {
      const er = C.mergeEntries(state.cards, raw.entries);
      state.cards = er.cards;
      raw.entries = [];
      entryNote = ` Race cards: ${er.added} entries added, ${er.updated} updated. See the Race card tab.`;
      if (er.changedIds.length) ui.card = er.changedIds[0];
    }
    flash(`Saved: ${res.added} new races, ${res.updated} existing races got new figures, ${res.unchanged} were already saved.` + entryNote);
    $('#raw-progress').hidden = true;
    persist();
    renderRaw();
  });
  confirmButton($('#raw-discard'), () => `Discard ${raw.rows.length + raw.entries.length} unsaved items?`, () => {
    raw.rows = [];
    raw.entries = [];
    $('#raw-progress').hidden = true;
    renderRaw();
  });
  $('#raw-stop').addEventListener('click', () => { if (raw.ctl) raw.ctl.abort(); });

  const dz = $('#dropzone');
  dz.addEventListener('click', () => $('#raw-files').click());
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#raw-files').click(); } });
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('over');
    processRawFiles(Array.from(e.dataTransfer.files || []));
  });
  $('#raw-files').addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    processRawFiles(files);
  });

  /* ---------- race card ---------- */
  const ui = { card: prefs.card || null, openCard: {} };
  const STYLE_NAME = { E: 'Early', P: 'Presser', C: 'Closer' };
  const SURFACE_NAME = { D: 'Dirt', T: 'Turf', S: 'Synthetic' };

  function cardOptions() {
    const ids = Object.keys(state.cards).sort((a, b) => (state.cards[b].date || '').localeCompare(state.cards[a].date || '') || a.localeCompare(b));
    if (!ids.includes(ui.card)) ui.card = ids[0] || null;
    return ids;
  }

  function agreeLabel(v) {
    if (v == null) return { text: '–', cls: '', word: 'one product' };
    return v >= 0.8 ? { text: v.toFixed(2), cls: 'up', word: 'agree' } : v >= 0.5 ? { text: v.toFixed(2), cls: '', word: 'mixed' } : { text: v.toFixed(2), cls: 'down', word: 'conflict' };
  }

  function styleTitle(st) {
    if (!st.style) return 'No running-line data yet';
    if (st.source === 'printed') return 'From the style printed in the PPs';
    return `${STYLE_NAME[st.style]}: E ${st.counts.E}, P ${st.counts.P}, C ${st.counts.C} over ${st.n} races`;
  }

  function currentReport() {
    const lastN = Math.max(1, +$('#opt-lastn').value || 6);
    const decay = Math.min(1, Math.max(0.3, +$('#opt-decay').value || 0.8));
    return ui.card && state.cards[ui.card] ? C.buildCard(ui.card, state.cards[ui.card], state.races, src(), { lastN, decay }) : null;
  }

  function renderCard() {
    const ids = cardOptions();
    const sel = $('#card-select');
    sel.innerHTML = ids.map((id) => {
      const c = state.cards[id];
      const n = Object.keys(c.races || {}).length;
      return `<option value="${esc(id)}">${esc(c.track || '?')} · ${esc(c.date)} · ${n} race${n === 1 ? '' : 's'}</option>`;
    }).join('');
    sel.value = ui.card || '';
    const has = !!ids.length;
    $('#card-controls').hidden = !has;
    $('#card-delete').hidden = !has || !canEdit();
    const rep = currentReport();
    if (!rep) {
      $('#card-out').innerHTML = `<div class="empty"><strong>No race cards yet</strong>
        <p>Drop the PP or sheet files for a card on the <b>Figures</b> tab. Claude picks up each horse's race number and post position from the PP headers and builds the card here.</p>
        <p>You can also import a CSV with <code>track, date, race, post, horse</code> columns, or load the fictional sample.</p></div>`;
      return;
    }
    const srcs = enabled();
    $('#card-out').innerHTML = rep.races.map((r) => {
      const order = r.order ? agreeLabel(r.order.score) : null;
      const head = `<div class="race-head"><h3>Race ${esc(r.race)}</h3>
        <span>${esc([r.distance, SURFACE_NAME[r.surface] || r.surface, r.conditions].filter(Boolean).join(' · '))}</span>
        ${order ? `<span class="pill ${order.cls}" title="Do the products rank this field in the same order? 1 = identical order">Order agreement ${order.text} · ${order.word}</span>` : ''}
        <span class="pill" title="Horses whose running style is E (early)">Early speed: ${r.earlyCount} E</span></div>`;
      const th = '<tr><th>PP</th><th>Horse</th><th>ML</th><th>Style</th><th class="num">Rating</th><th class="num">Last</th><th class="num">Best</th><th class="num">Trend</th>' +
        srcs.map((s) => `<th class="num" title="Most recent ${esc(s.name)} figure">${esc(s.short)}</th>`).join('') +
        '<th class="num" title="0 to 1: how closely the products agree on this horse\'s recent runs">Agree</th><th class="num">Starts</th></tr>';
      const rows = r.horses.map((h) => {
        const key = `${r.race}|${F.horseKey(h.horse)}`;
        const open = ui.openCard[key];
        const ag = agreeLabel(h.agreement);
        const trendCls = h.trend > 1 ? 'up' : h.trend < -1 ? 'down' : '';
        let html = `<tr class="horse" data-cardkey="${esc(key)}" tabindex="0"><td><span class="post">${esc(h.post || '–')}</span></td>` +
          `<td><b>${open ? '▾' : '▸'} ${esc(h.horse)}</b></td><td>${esc(h.ml)}</td>` +
          `<td>${h.style.style ? `<span class="style style-${h.style.style}" title="${esc(styleTitle(h.style))}">${h.style.style}</span>` : '<span class="hint" title="No running-line data yet">–</span>'}</td>` +
          `<td class="num"><b>${fmt(h.rating)}</b>${h.rank ? ` <span class="hint">#${h.rank}</span>` : ''}</td><td class="num">${fmt(h.last)}</td><td class="num">${fmt(h.best)}</td>` +
          `<td class="num ${trendCls}">${h.trend == null ? '–' : (h.trend > 0 ? '+' : '') + fmt(h.trend)}</td>` +
          srcs.map((s) => `<td class="num">${esc(h.latest[s.id] ?? '')}</td>`).join('') +
          `<td class="num ${ag.cls}" title="${h.agreementRuns ? `${h.agreementRuns} runs with 2+ products` : 'Only one product so far'}">${ag.text}</td><td class="num">${h.starts}</td></tr>`;
        if (open) {
          html += `<tr class="detail"><td></td><td colspan="${8 + srcs.length + 2}">` + (h.races.length ? `<table><tr><th>Date</th><th>Trk</th><th>Dist</th><th>1st call</th>` +
            srcs.map((s) => `<th class="num">${esc(s.short)}</th>`).join('') + '<th class="num">Unified</th><th class="num">Agree</th></tr>' +
            h.races.map((x) => {
              const byId = Object.fromEntries(x.parts.map((p) => [p.id, p]));
              const a = x.n > 1 ? agreeLabel(C.agreementFromSpread(x.gap)) : agreeLabel(null);
              const st = C.raceStyle(x.race);
              return `<tr><td>${esc(x.race.date)}</td><td>${esc(x.race.track)}</td><td>${esc(x.race.distance)}</td>` +
                `<td>${x.race.call1 != null ? `${esc(x.race.call1)}${x.race.call1Lengths != null ? ` (${esc(x.race.call1Lengths)}L)` : ''} ${st ? `<span class="style style-${st}">${st}</span>` : ''}` : ''}</td>` +
                srcs.map((s) => { const p = byId[s.id]; return `<td class="num">${p ? `${esc(x.race[s.id])} <span class="hint">(${fmt(p.converted)})</span>` : ''}</td>`; }).join('') +
                `<td class="num"><b>${fmt(x.unified)}</b></td><td class="num ${a.cls}">${a.text}</td></tr>`;
            }).join('') + '</table>' : '<p class="hint">No past figures saved for this horse yet.</p>') + '</td></tr>';
        }
        return html;
      }).join('');
      return `<section class="race">${head}<div class="scroll"><table>${th}${rows}</table></div></section>`;
    }).join('');
  }

  $('#card-select').addEventListener('change', (e) => {
    ui.card = e.target.value;
    prefs.card = ui.card;
    writeJSON(PREFS_KEY, prefs);
    renderCard();
  });
  function toggleCardHorse(e) {
    const tr = e.target.closest('tr.horse');
    if (!tr || (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    ui.openCard[tr.dataset.cardkey] = !ui.openCard[tr.dataset.cardkey];
    renderCard();
  }
  $('#card-out').addEventListener('click', toggleCardHorse);
  $('#card-out').addEventListener('keydown', toggleCardHorse);
  confirmButton($('#card-delete'), () => (ui.card ? 'Delete this card? Past figures stay saved.' : null), () => {
    delete state.cards[ui.card];
    ui.card = null;
    persist();
  });

  /* ---------- PDF report (built in the page, no Claude usage) ---------- */
  const JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  const AUTOTABLE = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js';
  let pdfLibReady;
  const pdfText = (v) => String(v == null ? '' : v).replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x20-\x7E]/g, '');

  async function downloadPdf() {
    const rep = currentReport();
    if (!rep) return;
    const btn = $('#card-pdf');
    btn.disabled = true;
    btn.textContent = 'Building PDF…';
    try {
      pdfLibReady = pdfLibReady || loadScript(JSPDF).then(() => loadScript(AUTOTABLE));
      await pdfLibReady;
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
      const srcs = enabled();
      const detail = $('#pdf-detail').checked;
      const W = doc.internal.pageSize.getWidth();
      const M = 36;
      const green = [31, 107, 74];
      const title = `${rep.track || ''} ${rep.date} - Horsey unified figures`;

      doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
      doc.text(pdfText(title), M, M + 6);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(90);
      const legend = [
        'Rating: unified figure on a Beyer-equivalent scale (higher is better), recency weighted over the last races. #n = rank in the field.',
        'Agree: 0 to 1, how closely the figure products matched on the same runs (1 = identical, 0.5 = about 6 points apart). Order agreement: whether the products rank the field in the same order.',
        'Style from first-call position: E early (on the lead or within 1 length), P presser (within 5), C closer. Product columns show each horse\'s most recent figure.',
        `Made ${new Date().toISOString().slice(0, 10)} from ${state.races.length} saved races. Figures are estimates.`,
      ];
      doc.text(legend.map(pdfText), M, M + 22);
      let y = M + 22 + legend.length * 10 + 8;
      doc.setTextColor(0);

      for (const r of rep.races) {
        if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = M; }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
        doc.text(pdfText(`Race ${r.race}`), M, y + 10);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
        const meta = [r.distance, SURFACE_NAME[r.surface] || r.surface, r.conditions,
          r.order ? `Order agreement ${r.order.score.toFixed(2)} (${agreeLabel(r.order.score).word})` : null,
          `Early speed: ${r.earlyCount} E`].filter(Boolean).join('   |   ');
        doc.text(pdfText(meta), M + 58, y + 10);
        const head = [['PP', 'Horse', 'ML', 'Style', 'Rating', 'Rank', 'Last', 'Best', 'Trend', ...srcs.map((s) => s.short), 'Agree', 'Starts']];
        const body = r.horses.map((h) => [
          h.post || '-', h.horse, h.ml || '', h.style.style || '-', fmt(h.rating), h.rank || '-', fmt(h.last), fmt(h.best),
          h.trend == null ? '-' : (h.trend > 0 ? '+' : '') + fmt(h.trend),
          ...srcs.map((s) => h.latest[s.id] ?? ''), h.agreement == null ? '-' : h.agreement.toFixed(2), String(h.starts),
        ].map(pdfText));
        doc.autoTable({
          head, body, startY: y + 16, margin: { left: M, right: M }, theme: 'grid',
          styles: { fontSize: 8.5, cellPadding: 3, lineColor: [210, 210, 205], lineWidth: 0.5 },
          headStyles: { fillColor: green, textColor: 255, fontStyle: 'bold' },
          columnStyles: { 0: { cellWidth: 26, fontStyle: 'bold' }, 1: { cellWidth: 130, fontStyle: 'bold' } },
          didParseCell: (d) => {
            if (d.section === 'body' && d.column.index > 3 && d.column.index !== 1) d.cell.styles.halign = 'right';
            if (d.section === 'body' && d.column.index === head[0].length - 2) {
              const v = parseFloat(d.cell.raw);
              if (v >= 0.8) d.cell.styles.textColor = green; else if (v < 0.5) d.cell.styles.textColor = [179, 38, 30];
            }
          },
        });
        y = doc.lastAutoTable.finalY + 10;

        if (detail) {
          const dhead = [['Horse / date', 'Trk', 'Dist', '1st call', ...srcs.map((s) => s.short), 'Unified', 'Agree']];
          const dbody = [];
          for (const h of r.horses) {
            dbody.push([{ content: pdfText(`${h.post || '-'}  ${h.horse}`), colSpan: dhead[0].length, styles: { fontStyle: 'bold', fillColor: [238, 243, 239] } }]);
            const list = h.races.slice(0, 6);
            if (!list.length) dbody.push([{ content: 'No past figures saved', colSpan: dhead[0].length, styles: { textColor: 120 } }]);
            for (const x of list) {
              dbody.push([
                x.race.date || '', x.race.track || '', x.race.distance || '',
                x.race.call1 != null ? `${x.race.call1}${x.race.call1Lengths != null ? ` (${x.race.call1Lengths}L)` : ''} ${C.raceStyle(x.race) || ''}` : '',
                ...srcs.map((s) => x.race[s.id] ?? ''), fmt(x.unified), x.n > 1 ? C.agreementFromSpread(x.gap).toFixed(2) : '-',
              ].map(pdfText));
            }
          }
          if (y > doc.internal.pageSize.getHeight() - 80) { doc.addPage(); y = M; }
          doc.autoTable({
            head: dhead, body: dbody, startY: y, margin: { left: M + 26, right: M }, theme: 'plain',
            styles: { fontSize: 7.5, cellPadding: 2 }, headStyles: { textColor: 90, fontStyle: 'bold' },
          });
          y = doc.lastAutoTable.finalY + 18;
        } else {
          y += 8;
        }
      }
      const pages = doc.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setFontSize(8); doc.setTextColor(120);
        doc.text(pdfText(`${rep.track || ''} ${rep.date}  ·  page ${i} of ${pages}`), W - M, doc.internal.pageSize.getHeight() - 16, { align: 'right' });
      }
      const blob = doc.output('blob');
      await offerFile(`horsey-${rep.track || 'card'}-${rep.date}.pdf`.replace(/[^\w.-]+/g, '-'), blob, 'application/pdf');
    } catch (e) {
      flash(`The PDF couldn't be built (${(e && e.message) || 'unknown error'}). Check your connection and try again.`);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Download PDF report';
    }
  }
  $('#card-pdf').addEventListener('click', downloadPdf);

  /* ---------- backup ---------- */
  $('#backup').addEventListener('click', () => {
    const data = { app: 'horsey', version: 1, savedAt: new Date().toISOString(), races: state.races, cards: state.cards, sources: state.sources, fitReport: state.fitReport, autoCalibrate: state.autoCal };
    offerFile(`horsey-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 1), 'application/json');
  });
  $('#restore-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f || !canEdit()) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data || !Array.isArray(data.races)) throw new Error('not a backup');
      const r = F.mergeRaces(state.races, data.races, mergeOpts());
      state.races = r.races;
      if (Array.isArray(data.sources)) state.sources = withNewSources(data.sources);
      if (data.fitReport !== undefined) state.fitReport = data.fitReport;
      if (data.autoCalibrate !== undefined) state.autoCal = data.autoCalibrate !== false;
      if (data.cards && typeof data.cards === 'object') state.cards = Object.assign({}, state.cards, data.cards);
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
    const rows = F.rateHorses(state.races, src(), { lastN, decay }).filter((h) => !q || h.horse.toLowerCase().includes(q));
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
    const cal = calibrated();
    const rep = cal.report || {};
    const ro = !canEdit();
    const auto = state.autoCal;
    $('#auto-cal').checked = auto;
    $('#auto-cal').disabled = ro;
    $('#fit').hidden = auto;
    const head = '<tr><th>I use</th><th>Product</th><th>Better</th><th>Sheet (lengths)</th><th class="num">Weight</th>' +
      '<th class="num">Intercept</th><th class="num">Slope</th><th class="num">Fit n</th><th class="num">r</th><th class="num">RMSE</th><th>Notes</th></tr>';
    const body = cal.sources.map((s, i) => {
      const r = rep[s.id];
      const fitCells = s.anchor ? '<td colspan="3" class="hint">anchor</td>' : !r ? '<td></td><td></td><td></td>' :
        `<td class="num">${r.n}</td><td class="num">${r.fitted ? fmt(Math.abs(r.r), 3) : '–'}</td>` +
        `<td class="num">${r.fitted ? fmt(r.rmse, 2) : `<span class="hint">${r.n < (auto ? 20 : 5) ? 'too few' : 'skipped'}</span>`}</td>`;
      const dis = (extra) => (ro || extra ? ' disabled' : '');
      const num = (k, step, extra) => `<td class="num"><input type="number" step="${step}" id="cal-${s.id}-${k}" data-src="${i}" data-key="${k}" value="${s[k]}" style="width:6.5em"${dis(extra)}></td>`;
      return `<tr><td><input type="checkbox" id="cal-${s.id}-enabled" aria-label="Use ${esc(s.name)}" data-src="${i}" data-key="enabled"${s.enabled ? ' checked' : ''}${dis()}></td>` +
        `<td>${esc(s.name)}</td><td>${s.higherIsBetter ? 'higher' : 'lower'}</td>` +
        `<td><input type="checkbox" id="cal-${s.id}-lengthBased" aria-label="${esc(s.name)} is length-based" data-src="${i}" data-key="lengthBased"${s.lengthBased ? ' checked' : ''}${dis(s.anchor)}></td>` +
        num('weight', 0.1) + num('intercept', 0.5, s.anchor || auto) + num('slope', 0.05, s.anchor || auto) + fitCells +
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
  $('#auto-cal').addEventListener('change', (e) => {
    if (!canEdit()) return;
    if (!e.target.checked) {
      // Keep the fitted values as the starting point for manual edits.
      const cal = calibrated();
      state.sources = cal.sources.map((s) => Object.assign({}, s));
      state.fitReport = cal.report;
    }
    state.autoCal = e.target.checked;
    $('#fit-msg').textContent = state.autoCal ? 'Automatic calibration on.' : 'Automatic calibration off. You can edit intercepts and slopes.';
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
    state.sources = F.cloneSources().map((d) => {
      const cur = state.sources.find((s) => s.id === d.id);
      return cur ? Object.assign(d, { enabled: cur.enabled, weight: cur.weight }) : d;
    });
    state.fitReport = null;
    state.autoCal = true;
    $('#fit-msg').textContent = 'Defaults restored; automatic calibration on.';
    persist();
  });

  function renderAll() {
    const active = document.querySelector('.tab.active').id;
    if (active === 'tab-card') renderCard();
    if (active === 'tab-convert') renderConvert();
    if (active === 'tab-figures') { renderFigures(); renderProductPicker(); }
    if (active === 'tab-rankings') renderRankings();
    if (active === 'tab-calibration') renderCalibration();
  }
  renderAll();
  boot();
})();
