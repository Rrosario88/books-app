'use strict';
/* Books — reading list + free LibriVox audiobook player. Plain JS, no dependencies. */

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------- storage ---------- */
const KEY = { books: 'books.v1', progress: 'books.progress.v1', lv: 'books.lvmatch.v1', settings: 'books.settings.v1' };
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('Storage full — export a backup'); } };

let books = load(KEY.books, []);
let progress = load(KEY.progress, {});   // identifier -> {track, time, updated, title, author}
let lvMatch = load(KEY.lv, {});          // bookId -> {id|null, checked}
let settings = load(KEY.settings, { speed: 1, shelf: 'want' });

const saveBooks = () => save(KEY.books, books);
const saveProgress = () => save(KEY.progress, progress);

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}
const fmtTime = (s) => {
  if (!isFinite(s) || s < 0) s = 0; s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
};
const parseLen = (v) => {
  if (v == null) return 0; v = String(v);
  if (v.includes(':')) return v.split(':').map(Number).reduce((a, b) => a * 60 + b, 0);
  return parseFloat(v) || 0;
};
const stars = (n) => n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '';
const SHELVES = { want: 'Want to Read', reading: 'Reading', finished: 'Finished' };
const olCover = (b, size = 'M') => b.coverId ? `https://covers.openlibrary.org/b/id/${b.coverId}-${size}.jpg`
  : (b.isbn ? `https://covers.openlibrary.org/b/isbn/${b.isbn}-${size}.jpg?default=false` : (b.coverUrl || ''));
const iaThumb = (id) => `https://archive.org/services/img/${encodeURIComponent(id)}`;
function coverHtml(src, alt, cls = 'cover') {
  if (!src) return `<div class="${cls}">${esc(alt).slice(0, 40)}</div>`;
  return `<img class="${cls}" loading="lazy" src="${esc(src)}" alt="" onerror="this.outerHTML='<div class=&quot;${cls}&quot;>No cover</div>'">`;
}

/* ---------- navigation ---------- */
const TITLES = { library: 'Library', discover: 'Discover', listen: 'Listen' };
function show(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  $('#viewTitle').textContent = TITLES[view];
  if (view === 'listen') renderListen();
  if (view === 'library') renderLibrary();
  window.scrollTo(0, 0);
  if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
}
document.querySelectorAll('.tabbar button').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));

/* ---------- library ---------- */
$('#shelfSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  settings.shelf = b.dataset.shelf; save(KEY.settings, settings); renderLibrary();
});

function renderLibrary() {
  const shelf = settings.shelf || 'want';
  document.querySelectorAll('#shelfSeg button').forEach(b => b.classList.toggle('on', b.dataset.shelf === shelf));
  for (const s in SHELVES) $(`[data-count="${s}"]`).textContent = books.filter(b => b.status === s).length || '';
  const list = books.filter(b => b.status === shelf).sort((a, b) => (b.updatedAt || b.addedAt) - (a.updatedAt || a.addedAt));
  const el = $('#libraryList');
  if (!list.length) {
    el.innerHTML = `<div class="empty"><div class="big">📖</div><p>Nothing on “${SHELVES[shelf]}” yet.</p>
      <button class="btn primary" onclick="show('discover')">Find books</button></div>`;
    return;
  }
  el.innerHTML = list.map(b => {
    const m = lvMatch[b.id];
    const listen = m && m.id ? `<button class="btn small listen" data-listen="${esc(m.id)}">🎧 Listen free</button>` : '';
    return `<div class="card" data-book="${b.id}">
      ${coverHtml(olCover(b), b.title)}
      <div class="info">
        <div class="title">${esc(b.title)}</div>
        <div class="sub">${esc(b.author || 'Unknown author')}${b.year ? ' · ' + esc(b.year) : ''}</div>
        ${b.rating ? `<div class="stars">${stars(b.rating)}</div>` : ''}
        ${b.notes ? `<div class="notes-preview">📝 ${esc(b.notes)}</div>` : ''}
        <div class="row">
          <select class="btn small" data-move="${b.id}" aria-label="Move to shelf">
            ${Object.entries(SHELVES).map(([k, v]) => `<option value="${k}" ${k === b.status ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
          <button class="btn small" data-edit="${b.id}">Notes & rating</button>
          ${listen}
        </div>
      </div></div>`;
  }).join('');
  checkLibriVoxMatches(list);
}
$('#libraryList').addEventListener('change', e => {
  const s = e.target.closest('[data-move]'); if (!s) return;
  const b = books.find(x => x.id === s.dataset.move); if (!b) return;
  b.status = s.value; b.updatedAt = Date.now();
  if (s.value === 'finished' && !b.finishedAt) b.finishedAt = Date.now();
  saveBooks(); toast('Moved to ' + SHELVES[s.value]); renderLibrary();
});
$('#libraryList').addEventListener('click', e => {
  const ed = e.target.closest('[data-edit]'); if (ed) return editBook(ed.dataset.edit);
  const li = e.target.closest('[data-listen]'); if (li) { show('listen'); return openAudiobook(li.dataset.listen); }
  const card = e.target.closest('[data-book]');
  if (card && !e.target.closest('select,button')) editBook(card.dataset.book);
});

/* ---------- sheet (dialog) ---------- */
const sheet = $('#sheet');
function openSheet(html) { $('#sheetBody').innerHTML = html; if (!sheet.open) sheet.showModal(); }
function closeSheet() { if (sheet.open) sheet.close(); }
sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });

function editBook(id) {
  const b = books.find(x => x.id === id); if (!b) return;
  let rating = b.rating || 0;
  const m = lvMatch[b.id];
  openSheet(`<div class="sheet-head">${coverHtml(olCover(b), b.title)}
      <div><h3>${esc(b.title)}</h3><div class="sub">${esc(b.author || '')}${b.year ? ' · ' + esc(b.year) : ''}</div>
      ${b.olKey ? `<a class="link" target="_blank" rel="noopener" href="https://openlibrary.org${esc(b.olKey)}">View on Open Library</a>` : ''}</div></div>
    <div class="field"><label>Shelf</label><select id="eShelf">${Object.entries(SHELVES).map(([k, v]) => `<option value="${k}" ${k === b.status ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div class="field"><label>Rating</label><div class="rate" id="eRate">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-r="${n}" aria-label="${n} stars">★</button>`).join('')}
      <button type="button" class="link" data-r="0" style="font-size:14px;margin-left:8px">clear</button></div></div>
    <div class="field"><label>Notes</label><textarea id="eNotes" placeholder="Thoughts, quotes, who recommended it…">${esc(b.notes || '')}</textarea></div>
    <div class="sheet-actions">
      ${m && m.id ? `<button class="btn listen" id="eListen">🎧 Listen free</button>` : `<button class="btn" id="eFind">Find audiobook</button>`}
      <button class="btn danger" id="eDel">Remove</button>
      <button class="btn" id="eCancel">Cancel</button>
      <button class="btn primary" id="eSave">Save</button>
    </div>`);
  const paint = () => document.querySelectorAll('#eRate [data-r]').forEach(x => x.classList.toggle('on', +x.dataset.r <= rating && +x.dataset.r > 0));
  paint();
  $('#eRate').onclick = e => { const r = e.target.closest('[data-r]'); if (r) { rating = +r.dataset.r; paint(); } };
  $('#eCancel').onclick = closeSheet;
  $('#eSave').onclick = () => {
    b.rating = rating; b.notes = $('#eNotes').value.trim();
    const ns = $('#eShelf').value; if (ns === 'finished' && b.status !== 'finished') b.finishedAt = Date.now();
    b.status = ns; b.updatedAt = Date.now(); saveBooks(); closeSheet(); renderLibrary(); toast('Saved');
  };
  $('#eDel').onclick = () => {
    if (!confirm(`Remove “${b.title}” from your library?`)) return;
    books = books.filter(x => x.id !== id); saveBooks(); closeSheet(); renderLibrary(); toast('Removed');
  };
  const l = $('#eListen'); if (l) l.onclick = () => { closeSheet(); show('listen'); openAudiobook(m.id); };
  const f = $('#eFind'); if (f) f.onclick = () => { closeSheet(); show('listen'); $('#lvQuery').value = b.title + (b.author ? ' ' + b.author : ''); searchLibriVox(b.title, b.author); };
}

function addBook(data, status = 'want') {
  const dup = books.find(b => (data.olKey && b.olKey === data.olKey) ||
    (b.title.toLowerCase() === data.title.toLowerCase() && (b.author || '').toLowerCase() === (data.author || '').toLowerCase()));
  if (dup) { toast('Already in your library'); return dup; }
  const b = { id: uid(), status, rating: 0, notes: '', addedAt: Date.now(), ...data };
  books.push(b); saveBooks(); toast('Added to ' + SHELVES[status]);
  return b;
}

/* ---------- discover (Open Library) ---------- */
let olResults = [];
$('#olForm').addEventListener('submit', async e => {
  e.preventDefault();
  const q = $('#olQuery').value.trim(); if (!q) return;
  $('#olQuery').blur();
  $('#olStatus').textContent = 'Searching Open Library…'; $('#olResults').innerHTML = '';
  try {
    const url = 'https://openlibrary.org/search.json?limit=25&fields=key,title,author_name,first_publish_year,cover_i,isbn,number_of_pages_median&q=' + encodeURIComponent(q);
    const r = await fetch(url); if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    olResults = (d.docs || []).map(x => ({
      olKey: x.key, title: x.title, author: (x.author_name || []).slice(0, 2).join(', '),
      year: x.first_publish_year || '', coverId: x.cover_i || null, isbn: (x.isbn || [])[0] || '', pages: x.number_of_pages_median || ''
    }));
    $('#olStatus').textContent = olResults.length ? `${d.numFound.toLocaleString()} results` : 'No results. Try different words, or add it manually below.';
    renderOl();
  } catch (err) {
    $('#olStatus').textContent = navigator.onLine ? 'Search failed — please try again.' : 'You appear to be offline.';
  }
});
function renderOl() {
  $('#olResults').innerHTML = olResults.map((b, i) => {
    const have = books.find(x => x.olKey === b.olKey);
    return `<div class="card">${coverHtml(olCover(b), b.title)}
      <div class="info"><div class="title">${esc(b.title)}</div>
      <div class="sub">${esc(b.author || 'Unknown author')}${b.year ? ' · ' + b.year : ''}${b.pages ? ' · ' + b.pages + ' pp' : ''}</div>
      <div class="row">${have ? `<span class="pill">✓ ${SHELVES[have.status]}</span>` :
        `<button class="btn small primary" data-add="${i}" data-s="want">+ Want to Read</button>
         <button class="btn small" data-add="${i}" data-s="reading">Reading</button>
         <button class="btn small" data-add="${i}" data-s="finished">Finished</button>`}</div></div></div>`;
  }).join('');
}
$('#olResults').addEventListener('click', e => {
  const a = e.target.closest('[data-add]'); if (!a) return;
  const b = addBook(olResults[+a.dataset.add], a.dataset.s);
  renderOl(); if (b) checkLibriVoxMatches([b]);
});
$('#manualAddBtn').addEventListener('click', () => {
  openSheet(`<h3>Add a book</h3>
    <div class="field"><label>Title *</label><input id="mTitle" required></div>
    <div class="field"><label>Author</label><input id="mAuthor"></div>
    <div class="field"><label>Year</label><input id="mYear" inputmode="numeric"></div>
    <div class="field"><label>Cover image URL (optional)</label><input id="mCover" type="url" placeholder="https://…"></div>
    <div class="field"><label>Shelf</label><select id="mShelf">${Object.entries(SHELVES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    <div class="sheet-actions"><button class="btn" id="mCancel">Cancel</button><button class="btn primary" id="mSave">Add</button></div>`);
  $('#mTitle').value = $('#olQuery').value.trim();
  $('#mCancel').onclick = closeSheet;
  $('#mSave').onclick = () => {
    const title = $('#mTitle').value.trim(); if (!title) { $('#mTitle').focus(); return; }
    const b = addBook({ title, author: $('#mAuthor').value.trim(), year: $('#mYear').value.trim(), coverUrl: $('#mCover').value.trim() }, $('#mShelf').value);
    closeSheet(); checkLibriVoxMatches([b]);
  };
});

/* ---------- LibriVox / Internet Archive ---------- */
const luceneClean = (s) => String(s || '').replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/\s+/g, ' ').trim();
async function iaSearch(query, rows = 30) {
  const p = new URLSearchParams({ q: query, rows, page: 1, output: 'json', sort: 'downloads desc' });
  ['identifier', 'title', 'creator', 'downloads', 'runtime'].forEach(f => p.append('fl[]', f));
  const r = await fetch('https://archive.org/advancedsearch.php?' + p);
  if (!r.ok) throw new Error('IA ' + r.status);
  return (await r.json()).response.docs || [];
}
async function searchLibriVox(title, author) {
  const t = luceneClean(title), a = luceneClean(author);
  if (!t && !a) return;
  $('#lvStatus').textContent = 'Searching LibriVox…'; $('#lvResults').innerHTML = '';
  try {
    let q = 'collection:librivoxaudio';
    if (author !== undefined) {
      q += ` AND title:(${t})` + (a ? ` AND creator:(${a.split(',')[0]})` : '');
    } else {
      q += ` AND (title:(${t}) OR creator:(${t}))`;
    }
    let docs = await iaSearch(q);
    if (!docs.length && author !== undefined) docs = await iaSearch(`collection:librivoxaudio AND title:(${t})`);
    $('#lvStatus').textContent = docs.length ? `${docs.length} free audiobook${docs.length > 1 ? 's' : ''}` :
      'No LibriVox recording found. LibriVox covers public-domain books (mostly published before ~1929).';
    $('#lvResults').innerHTML = docs.map(d => lvCard(d.identifier, d.title, [].concat(d.creator || []).join(', '),
      d.downloads ? d.downloads.toLocaleString() + ' plays' : '')).join('');
  } catch {
    $('#lvStatus').textContent = 'Search failed — please try again.';
  }
}
function lvCard(id, title, author, extra = '', btn = 'Open') {
  return `<div class="card" data-ia="${esc(id)}">${coverHtml(iaThumb(id), title, 'cover sq')}
    <div class="info"><div class="title">${esc(title)}</div><div class="sub">${esc(author || '')}</div>
    <div class="row">${extra ? `<span class="pill">${esc(extra)}</span>` : ''}<button class="btn small primary" data-open="${esc(id)}">${btn}</button></div></div></div>`;
}
$('#lvForm').addEventListener('submit', e => { e.preventDefault(); $('#lvQuery').blur(); searchLibriVox($('#lvQuery').value); });
['#lvResults', '#recentList'].forEach(s => $(s).addEventListener('click', e => {
  const c = e.target.closest('[data-ia]'); if (c) openAudiobook(c.dataset.ia);
}));

/* Look for LibriVox matches for library books (cached, sequential, polite). */
let matching = false;
async function checkLibriVoxMatches(list) {
  if (matching || !navigator.onLine) return;
  matching = true;
  const WEEK = 7 * 864e5;
  try {
    for (const b of list) {
      const c = lvMatch[b.id];
      if (c && (c.id || Date.now() - c.checked < WEEK)) continue;
      const t = luceneClean(b.title).split(' ').slice(0, 8).join(' ');
      const last = luceneClean((b.author || '').split(',')[0]).split(' ').pop();
      if (!t) continue;
      let found = null;
      try {
        const docs = await iaSearch(`collection:librivoxaudio AND title:(${t})` + (last ? ` AND creator:(${last})` : ''), 5);
        const norm = s => luceneClean(s).toLowerCase();
        const nt = norm(b.title);
        found = docs.find(d => norm(d.title).startsWith(nt) || nt.startsWith(norm(d.title).replace(/ version \d+.*$/, ''))) || null;
        if (!found && last) found = docs[0] || null;
      } catch { continue; }
      lvMatch[b.id] = { id: found ? found.identifier : null, checked: Date.now() };
      save(KEY.lv, lvMatch);
      if (found) {
        const card = document.querySelector(`#libraryList [data-book="${b.id}"] .row`);
        if (card && !card.querySelector('[data-listen]')) card.insertAdjacentHTML('beforeend', `<button class="btn small listen" data-listen="${esc(found.identifier)}">🎧 Listen free</button>`);
      }
    }
  } finally { matching = false; }
}

/* ---------- player ---------- */
const audio = $('#audio');
let cur = null; // {id, title, author, cover, tracks:[{name,title,len,url}], track}
let sleepAt = 0, sleepEndOfChapter = false, sleepTimer = null, pendingSeek = 0;
const metaCache = new Map();

async function fetchAudiobook(id) {
  if (metaCache.has(id)) return metaCache.get(id);
  const r = await fetch('https://archive.org/metadata/' + encodeURIComponent(id));
  if (!r.ok) throw new Error('meta ' + r.status);
  const d = await r.json();
  if (!d.files) throw new Error('No files');
  const mp3 = d.files.filter(f => /\.mp3$/i.test(f.name));
  // Prefer 64kbps (smaller, good for phones); fall back to any MP3 original.
  let pick = mp3.filter(f => /64kbps/i.test(f.format || '') || /_64kb\.mp3$/i.test(f.name));
  if (!pick.length) pick = mp3.filter(f => f.source === 'original');
  if (!pick.length) pick = mp3;
  const num = f => parseInt(String(f.track || '').split('/')[0], 10);
  pick.sort((a, b) => (num(a) || 0) - (num(b) || 0) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const md = d.metadata || {};
  const book = {
    id, title: [].concat(md.title || id)[0], author: [].concat(md.creator || '').join(', '),
    cover: iaThumb(id),
    tracks: pick.map((f, i) => ({
      name: f.name, title: f.title || f.name.replace(/\.mp3$/i, '').replace(/_/g, ' '), len: parseLen(f.length),
      url: 'https://archive.org/download/' + encodeURIComponent(id) + '/' + f.name.split('/').map(encodeURIComponent).join('/')
    }))
  };
  if (!book.tracks.length) throw new Error('No audio');
  metaCache.set(id, book);
  return book;
}

async function openAudiobook(id, autoplay = false) {
  if (cur && cur.id === id) { renderNow(); if (autoplay) audio.play(); return; }
  $('#nowPlaying').classList.remove('hidden');
  $('#nowPlaying').innerHTML = '<div class="status">Loading audiobook…</div>';
  try {
    const book = await fetchAudiobook(id);
    if (cur) saveCurrentProgress();
    cur = { ...book, track: 0 };
    const p = progress[id];
    loadTrack(p ? Math.min(p.track, book.tracks.length - 1) : 0, p ? p.time : 0, autoplay);
    progress[id] = { ...(p || { track: 0, time: 0 }), title: book.title, author: book.author, updated: Date.now(), total: book.tracks.length };
    saveProgress();
    settings.lastBook = id; save(KEY.settings, settings);
    renderNow(); updateMini();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (p && (p.track || p.time > 5)) toast(`Resuming ${book.tracks[cur.track].title} at ${fmtTime(p.time)}`);
  } catch (e) {
    $('#nowPlaying').innerHTML = `<div class="status">Couldn't load that audiobook. ${navigator.onLine ? 'Try another version.' : 'You are offline.'}</div>`;
  }
}

function loadTrack(i, time = 0, play = false) {
  if (!cur) return;
  cur.track = i;
  const t = cur.tracks[i];
  audio.src = t.url;
  audio.playbackRate = settings.speed || 1;
  pendingSeek = time > 3 ? time - 2 : 0;
  if (play) audio.play().catch(() => {});
  setMediaSession();
  renderNow(); updateMini();
}

function saveCurrentProgress() {
  if (!cur || pendingSeek) return;
  const p = progress[cur.id] || {};
  progress[cur.id] = { ...p, track: cur.track, time: audio.currentTime || 0, updated: Date.now(), title: cur.title, author: cur.author, total: cur.tracks.length };
  saveProgress();
}

function togglePlay() { if (!cur) return; audio.paused ? audio.play().catch(() => toast('Tap play again to start')) : audio.pause(); }
function skip(sec) { if (!cur) return; audio.currentTime = Math.max(0, Math.min((audio.duration || 1e9) - 0.5, audio.currentTime + sec)); }
function nextTrack() { if (cur && cur.track < cur.tracks.length - 1) loadTrack(cur.track + 1, 0, true); }
function prevTrack() {
  if (!cur) return;
  if (audio.currentTime > 5 || cur.track === 0) audio.currentTime = 0; else loadTrack(cur.track - 1, 0, true);
}

function renderNow() {
  const el = $('#nowPlaying');
  if (!cur) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const t = cur.tracks[cur.track];
  const speeds = [0.75, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5];
  const sleepLabel = sleepEndOfChapter ? 'eoc' : (sleepAt ? 'on' : '0');
  el.innerHTML = `<div class="now-head"><img src="${esc(cur.cover)}" alt="">
      <div style="min-width:0"><div class="now-title">${esc(cur.title)}</div><div class="sub">${esc(cur.author)}</div>
      <div class="now-ch" id="nowCh">${cur.track + 1}/${cur.tracks.length} · ${esc(t.title)}</div></div></div>
    <input type="range" class="seek" id="seek" min="0" max="1000" value="0" aria-label="Seek">
    <div class="times"><span id="tCur">0:00</span><span id="tLeft">-0:00</span></div>
    <div class="controls">
      <button class="icon-btn" id="bPrev" aria-label="Previous chapter">⏮</button>
      <button class="icon-btn" id="bBack" aria-label="Back 15 seconds">↺15</button>
      <button class="bigplay" id="bPlay" aria-label="Play/Pause">${audio.paused ? '▶' : '❚❚'}</button>
      <button class="icon-btn" id="bFwd" aria-label="Forward 30 seconds">30↻</button>
      <button class="icon-btn" id="bNext" aria-label="Next chapter">⏭</button>
    </div>
    <div class="opts">
      <select id="speedSel" aria-label="Playback speed">${speeds.map(s => `<option value="${s}" ${s == (settings.speed || 1) ? 'selected' : ''}>${s}× speed</option>`).join('')}</select>
      <select id="sleepSel" aria-label="Sleep timer">
        <option value="0" ${sleepLabel === '0' ? 'selected' : ''}>🌙 Sleep: off</option>
        ${sleepLabel === 'on' ? `<option value="keep" selected id="sleepLeft">🌙 ${fmtTime((sleepAt - Date.now()) / 1000)} left</option>` : ''}
        <option value="5">5 min</option><option value="15">15 min</option><option value="30">30 min</option>
        <option value="45">45 min</option><option value="60">60 min</option>
        <option value="eoc" ${sleepLabel === 'eoc' ? 'selected' : ''}>End of chapter</option>
      </select>
    </div>
    <div class="chapters" id="chapters">${cur.tracks.map((c, i) => `<button data-tr="${i}" class="${i === cur.track ? 'cur' : ''}">
      <span class="n">${i + 1}</span><span class="t">${esc(c.title)}</span><span class="d">${c.len ? fmtTime(c.len) : ''}</span></button>`).join('')}</div>`;
  $('#bPlay').onclick = togglePlay; $('#bBack').onclick = () => skip(-15); $('#bFwd').onclick = () => skip(30);
  $('#bPrev').onclick = prevTrack; $('#bNext').onclick = nextTrack;
  $('#speedSel').onchange = e => { settings.speed = +e.target.value; audio.playbackRate = settings.speed; save(KEY.settings, settings); setPositionState(); };
  $('#sleepSel').onchange = e => setSleep(e.target.value);
  const seek = $('#seek'); let dragging = false;
  seek.oninput = () => { dragging = true; if (audio.duration) $('#tCur').textContent = fmtTime(seek.value / 1000 * audio.duration); };
  seek.onchange = () => { dragging = false; if (audio.duration) audio.currentTime = seek.value / 1000 * audio.duration; };
  seek._dragging = () => dragging;
  $('#chapters').onclick = e => { const b = e.target.closest('[data-tr]'); if (b) loadTrack(+b.dataset.tr, 0, true); };
  const curBtn = $('#chapters .cur'); if (curBtn) curBtn.scrollIntoView({ block: 'nearest' });
  updateTimes();
}

function updateTimes() {
  const seek = $('#seek');
  const d = audio.duration || (cur && cur.tracks[cur.track].len) || 0, t = audio.currentTime || 0;
  if (seek && !(seek._dragging && seek._dragging())) {
    seek.value = d ? Math.round(t / d * 1000) : 0;
    $('#tCur').textContent = fmtTime(t); $('#tLeft').textContent = '-' + fmtTime(d - t);
  }
  $('#miniBar').style.width = d ? (t / d * 100) + '%' : '0';
  const sl = $('#sleepLeft'); if (sl && sleepAt) sl.textContent = '🌙 ' + fmtTime((sleepAt - Date.now()) / 1000) + ' left';
}

function updateMini() {
  const m = $('#mini');
  if (!cur) { m.classList.add('hidden'); return; }
  m.classList.remove('hidden');
  $('#miniCover').src = cur.cover;
  $('#miniTitle').textContent = cur.title;
  $('#miniSub').textContent = cur.tracks[cur.track].title;
  $('#miniPlay').textContent = audio.paused ? '▶' : '❚❚';
  $('#miniPlay').setAttribute('aria-label', audio.paused ? 'Play' : 'Pause');
  const bp = $('#bPlay'); if (bp) bp.textContent = audio.paused ? '▶' : '❚❚';
}
$('#miniPlay').onclick = togglePlay;
$('#miniBack').onclick = () => skip(-15);
$('#miniOpen').onclick = () => show('listen');
$('#miniCover').onclick = () => show('listen');

function setSleep(v) {
  clearTimeout(sleepTimer); sleepAt = 0; sleepEndOfChapter = false;
  if (v === 'keep') return;
  if (v === 'eoc') { sleepEndOfChapter = true; toast('Will stop at end of chapter'); }
  else if (+v > 0) {
    sleepAt = Date.now() + v * 60000;
    sleepTimer = setTimeout(() => { fadeOutAndPause(); sleepAt = 0; renderNow(); toast('Sleep timer: paused'); }, v * 60000);
    toast(`Sleep timer: ${v} min`);
  } else toast('Sleep timer off');
  renderNow();
}
function fadeOutAndPause() {
  const start = audio.volume; let n = 0;
  const iv = setInterval(() => { n++; audio.volume = Math.max(0, start * (1 - n / 10)); if (n >= 10) { clearInterval(iv); audio.pause(); audio.volume = start; } }, 300);
}

/* audio events */
let lastSave = 0;
audio.addEventListener('timeupdate', () => {
  updateTimes();
  if (Date.now() - lastSave > 5000) { lastSave = Date.now(); saveCurrentProgress(); setPositionState(); }
});
audio.addEventListener('play', () => { updateMini(); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'; });
audio.addEventListener('pause', () => { updateMini(); saveCurrentProgress(); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'; });
audio.addEventListener('loadedmetadata', () => {
  if (pendingSeek) { audio.currentTime = pendingSeek; pendingSeek = 0; }
  audio.playbackRate = settings.speed || 1;
  updateTimes(); setPositionState();
});
audio.addEventListener('ended', () => {
  if (sleepEndOfChapter) { sleepEndOfChapter = false; saveCurrentProgressNext(); renderNow(); toast('Sleep timer: stopped at end of chapter'); return; }
  if (cur.track < cur.tracks.length - 1) loadTrack(cur.track + 1, 0, true);
  else { progress[cur.id] = { ...progress[cur.id], track: 0, time: 0, finished: true }; saveProgress(); toast('Finished the audiobook 🎉'); }
});
audio.addEventListener('error', () => { if (cur && audio.src) toast('Audio failed to load — check your connection'); });
function saveCurrentProgressNext() {
  // stopped at end of chapter: resume from the start of the next one
  if (cur.track < cur.tracks.length - 1) { loadTrack(cur.track + 1, 0, false); saveCurrentProgress(); }
}
window.addEventListener('pagehide', saveCurrentProgress);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveCurrentProgress(); });

/* Media Session: lock screen / headphones / car controls */
function setMediaSession() {
  if (!('mediaSession' in navigator) || !cur) return;
  const t = cur.tracks[cur.track];
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title, artist: cur.author, album: cur.title,
      artwork: [{ src: cur.cover, sizes: '180x180', type: 'image/jpeg' }, { src: new URL('icons/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' }]
    });
  } catch {}
  const h = {
    play: () => audio.play(), pause: () => audio.pause(),
    seekbackward: (d) => skip(-(d.seekOffset || 15)), seekforward: (d) => skip(d.seekOffset || 30),
    previoustrack: prevTrack, nexttrack: nextTrack,
    seekto: (d) => { if (d.fastSeek && 'fastSeek' in audio) audio.fastSeek(d.seekTime); else audio.currentTime = d.seekTime; },
    stop: () => audio.pause()
  };
  for (const [k, fn] of Object.entries(h)) { try { navigator.mediaSession.setActionHandler(k, fn); } catch {} }
}
function setPositionState() {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  const d = audio.duration;
  if (!isFinite(d) || d <= 0) return;
  try { navigator.mediaSession.setPositionState({ duration: d, playbackRate: audio.playbackRate || 1, position: Math.min(audio.currentTime, d) }); } catch {}
}

/* Listen view */
function renderListen() {
  renderNow();
  const recent = Object.entries(progress).filter(([id]) => !cur || id !== cur.id)
    .sort((a, b) => (b[1].updated || 0) - (a[1].updated || 0)).slice(0, 12);
  $('#recentH').classList.toggle('hidden', !recent.length);
  $('#recentList').innerHTML = recent.map(([id, p]) => lvCard(id, p.title || id, p.author,
    p.finished ? 'Finished' : `Ch. ${(p.track || 0) + 1}${p.total ? '/' + p.total : ''} · ${fmtTime(p.time)}`, p.finished ? 'Replay' : 'Resume')).join('');
  if (!cur && !recent.length && !$('#lvResults').innerHTML) {
    $('#lvStatus').innerHTML = 'Try: <button class="link" data-q="Pride and Prejudice">Pride and Prejudice</button>, <button class="link" data-q="Sherlock Holmes">Sherlock Holmes</button>, <button class="link" data-q="Mark Twain">Mark Twain</button>';
  }
}
$('#lvStatus').addEventListener('click', e => { const b = e.target.closest('[data-q]'); if (b) { $('#lvQuery').value = b.dataset.q; searchLibriVox(b.dataset.q); } });

/* ---------- backup menu ---------- */
$('#menuBtn').addEventListener('click', () => {
  openSheet(`<h3>Backup & data</h3><p class="sub" style="white-space:normal">Your books live on this device. Export a backup to move them to another phone or computer.</p>
    <button class="menu-item" id="mExport">⬇️ Export backup (JSON)</button>
    <button class="menu-item" id="mImport">⬆️ Import backup…</button>
    <button class="menu-item" id="mRecheck">🎧 Re-check free audiobook matches</button>
    <button class="menu-item" id="mClose">Close</button>
    <p class="hint small">${books.length} books · ${Object.keys(progress).length} audiobooks in progress</p>`);
  $('#mClose').onclick = closeSheet;
  $('#mExport').onclick = exportData;
  $('#mImport').onclick = () => $('#importFile').click();
  $('#mRecheck').onclick = () => { lvMatch = {}; save(KEY.lv, lvMatch); closeSheet(); show('library'); toast('Checking LibriVox…'); };
});
function exportData() {
  const data = { app: 'Books', version: 1, exportedAt: new Date().toISOString(), books, progress, settings: { speed: settings.speed } };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const name = `books-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && /iphone|ipad|android/i.test(navigator.userAgent)) {
    navigator.share({ files: [file], title: 'Books backup' }).catch(() => downloadBlob(blob, name));
  } else downloadBlob(blob, name);
}
function downloadBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('Backup downloaded');
}
$('#importFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!Array.isArray(d.books)) throw new Error('bad');
    const merge = books.length && confirm('Merge with your current library?\n\nOK = merge, Cancel = replace everything.');
    if (merge) {
      const keyOf = b => b.olKey || (b.title + '|' + (b.author || '')).toLowerCase();
      const have = new Map(books.map(b => [keyOf(b), b]));
      for (const b of d.books) { const k = keyOf(b); if (have.has(k)) Object.assign(have.get(k), b, { id: have.get(k).id }); else books.push({ ...b, id: b.id || uid() }); }
      progress = { ...d.progress, ...progress };
    } else { books = d.books.map(b => ({ ...b, id: b.id || uid() })); progress = d.progress || {}; }
    if (d.settings && d.settings.speed) settings.speed = d.settings.speed;
    saveBooks(); saveProgress(); save(KEY.settings, settings);
    closeSheet(); show('library'); toast(`Imported ${d.books.length} books`);
  } catch { toast('That file isn’t a Books backup'); }
});

/* ---------- boot ---------- */
window.show = show;
const start = (location.hash || '#library').slice(1);
show(TITLES[start] ? start : 'library');
if (settings.lastBook) {
  // restore the last audiobook (paused) so the mini player is ready to resume
  fetchAudiobook(settings.lastBook).then(book => {
    if (cur) return;
    const p = progress[book.id] || { track: 0, time: 0 };
    cur = { ...book, track: Math.min(p.track || 0, book.tracks.length - 1) };
    loadTrack(cur.track, p.time || 0, false);
    if ($('#view-listen').classList.contains('active')) renderListen();
  }).catch(() => {});
}
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
