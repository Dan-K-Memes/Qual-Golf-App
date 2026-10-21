import * as G from './golf.js';
import * as AI from './ai.js';
import * as S from './store.js';

let state = S.load();
const ui = {
  view: 'round',
  reviewRoundId: null,
  openHole: null,
  modal: null,
  draft: '',
  start: { courseId: '', teeName: '', date: today(), ph: '' },
  editCourse: null,
  courseNote: '',
  importOpen: false,
  listening: false,
};
let parsing = false;

const $app = document.getElementById('app');
const $toast = document.getElementById('toast');
const $busy = document.getElementById('busy');
const $busyMsg = document.getElementById('busy-msg');

// ---------- helpers ----------

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const persist = () => {
  if (!S.save(state)) toast('Could not save. Storage may be full or blocked.');
};
const activeRound = () => state.rounds.find((r) => r.id === state.activeRoundId) || null;
const roundById = (id) => state.rounds.find((r) => r.id === id) || null;
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const clone = (o) => JSON.parse(JSON.stringify(o));
const fmt1 = (v) => (v == null ? '-' : v.toFixed(1));
const pct = (v) => (v == null ? '-' : `${Math.round(v * 100)}%`);
const fmtSG = (v) => (v == null ? '-' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}`);
const sgClass = (v) => (v == null ? '' : v > 0.05 ? 'pos' : v < -0.05 ? 'neg' : '');
const timeOf = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

let toastTimer;
function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 2600);
}
function busy(msg) {
  if (msg) { $busyMsg.textContent = msg; $busy.hidden = false; } else { $busy.hidden = true; }
}

function setView(v) {
  ui.view = v;
  ui.modal = null;
  render();
  window.scrollTo(0, 0);
}

// ---------- rounds ----------

function defaultTee(courseId, teeName) {
  const course = state.courses.find((c) => c.id === courseId);
  if (!course) return null;
  return course.tees.find((t) => t.name === teeName) || course.tees[0] || null;
}

function suggestedPH() {
  const tee = defaultTee(ui.start.courseId, ui.start.teeName);
  const idx = state.settings.index;
  if (!tee || idx == null) return '';
  const ch = G.courseHandicap(idx, tee.slope, tee.rating, G.teePar(tee));
  const ph = G.playingHandicap(ch, state.settings.allowance);
  return ph == null ? '' : ph;
}

function startRound() {
  const course = state.courses.find((c) => c.id === ui.start.courseId);
  const tee = defaultTee(ui.start.courseId, ui.start.teeName);
  if (!course || !tee) return toast('Pick a course and tee first');
  const idx = state.settings.index;
  const par = G.teePar(tee);
  const ch = G.courseHandicap(idx, tee.slope, tee.rating, par);
  const ph = ui.start.ph !== '' ? Number(ui.start.ph) : G.playingHandicap(ch, state.settings.allowance) ?? 0;
  const round = {
    id: AI.uid('r'),
    courseId: course.id,
    courseName: course.name,
    date: ui.start.date || today(),
    tee: clone(tee),
    index: idx,
    courseHandicap: ch,
    playingHandicap: ph,
    baselineIndex: state.settings.baseline === 'hcp' ? idx : null,
    notes: [],
    holes: {},
    currentHole: 1,
    status: 'active',
    createdAt: Date.now(),
  };
  if (state.inbox.length) {
    round.notes.push(...state.inbox.map((n) => ({ ...n, hole: n.hole || 1 })));
    state.inbox = [];
  }
  state.rounds.push(round);
  state.activeRoundId = round.id;
  persist();
  render();
}

function addNote(text, kind = 'pre', extra = {}) {
  const clean = String(text || '').trim();
  if (!clean) return false;
  const round = activeRound();
  const note = { id: AI.uid('n'), ts: Date.now(), kind, text: clean, parsed: false, ...extra };
  if (!round) {
    state.inbox.push({ ...note, hole: null });
    persist();
    return 'inbox';
  }
  note.hole = extra.hole ?? round.currentHole;
  round.notes.push(note);
  if (kind === 'recap' && extra.hole == null && round.currentHole < round.tee.holes.length) round.currentHole++;
  persist();
  return note;
}

function unparsedCount(round) {
  return round.notes.filter((n) => !n.parsed).length;
}

async function runParse(round, { silent = false } = {}) {
  if (parsing) return;
  if (!state.settings.apiKey) {
    if (!silent) toast('Add your Claude API key in Settings first');
    return;
  }
  parsing = true;
  if (!silent) busy('Reading your notes…');
  try {
    const touched = await AI.parseRound(round, state.settings);
    persist();
    if (!silent) toast(touched.length ? `Updated hole${touched.length === 1 ? '' : 's'} ${touched.join(', ')}` : 'Nothing new to update');
    else toast('Notes parsed');
  } catch (e) {
    if (!silent) toast(e.message);
  } finally {
    parsing = false;
    busy(false);
    render();
  }
}

// ---------- URL inbox (Shortcut hands a note to the page) ----------

function handleHash() {
  if (!location.hash || location.hash.length < 2) return;
  const params = new URLSearchParams(location.hash.slice(1));
  const text = params.get('note');
  if (text == null) return;
  const kind = params.get('kind') === 'recap' ? 'recap' : 'pre';
  const res = addNote(text, kind);
  history.replaceState(null, '', location.pathname + location.search);
  if (res) {
    toast(res === 'inbox' ? 'Saved. Start a round to attach it' : kind === 'recap' ? `Hole recap saved` : 'Note saved');
    const round = activeRound();
    if (round && kind === 'recap' && state.settings.autoParse) runParse(round, { silent: true });
  }
  ui.view = 'round';
}

// ---------- scorecard photo ----------

// Photos and screenshots become one or more JPEGs. The API shrinks very large images, so tall
// screenshots are sliced (with overlap) to keep small print legible.
const MAX_SIDE = 1568;
const MAX_IMAGES = 8;

async function fileToImages(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('Could not read that image'));
      im.src = url;
    });
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const out = [];
    const encode = (sx, sy, sw, sh) => {
      const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(sw * scale));
      canvas.height = Math.max(1, Math.round(sh * scale));
      canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      return { base64: canvas.toDataURL('image/jpeg', 0.9).split(',')[1], mediaType: 'image/jpeg' };
    };
    if (h > w * 1.8) {
      const slice = Math.max(Math.round(w * 1.5), 1400);
      const step = Math.round(slice * 0.88);
      for (let y = 0; y < h; y += step) {
        const sh = Math.min(slice, h - y);
        out.push(encode(0, y, w, sh));
        if (y + sh >= h) break;
      }
    } else if (w > h * 1.8) {
      const slice = Math.max(Math.round(h * 1.5), 1400);
      const step = Math.round(slice * 0.88);
      for (let x = 0; x < w; x += step) {
        const sw = Math.min(slice, w - x);
        out.push(encode(x, 0, sw, h));
        if (x + sw >= w) break;
      }
    } else {
      out.push(encode(0, 0, w, h));
    }
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function scorecardFromFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  if (!state.settings.apiKey) return toast('Add your Claude API key in Settings first');
  busy('Reading the scorecard…');
  try {
    const images = (await Promise.all(files.map(fileToImages))).flat();
    if (images.length > MAX_IMAGES) throw new Error(`That is ${images.length} image pieces. Try fewer or smaller screenshots (max ${MAX_IMAGES}).`);
    const course = await AI.parseScorecard(images, state.settings);
    ui.editCourse = course;
    ui.courseNote = course.warnings.length
      ? `Check these: ${course.warnings.join('; ')}`
      : 'Check the numbers against the card, then save.';
  } catch (e) {
    toast(e.message);
  } finally {
    busy(false);
    render();
  }
}

// ---------- rendering ----------

function render() {
  const sub = document.getElementById('top-sub');
  const round = activeRound();
  sub.textContent = round ? `${round.courseName} · hole ${round.currentHole}` : '';
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === ui.view));
  const views = { round: viewRound, review: viewReview, stats: viewStats, courses: viewCourses, settings: viewSettings };
  const y = window.scrollY;
  $app.innerHTML = (views[ui.view] || viewRound)() + (ui.modal ? modalHtml() : '');
  window.scrollTo(0, y);
}

// --- Round view ---

function viewRound() {
  const round = activeRound();
  return round ? viewActiveRound(round) : viewStartRound();
}

function viewStartRound() {
  const s = state.settings;
  const courses = state.courses;
  if (!ui.start.courseId && courses[0]) ui.start.courseId = courses[0].id;
  const course = courses.find((c) => c.id === ui.start.courseId);
  if (course && !course.tees.some((t) => t.name === ui.start.teeName)) ui.start.teeName = course.tees[0]?.name || '';
  const tee = defaultTee(ui.start.courseId, ui.start.teeName);
  const ph = suggestedPH();
  if (ui.start.ph === '' && ph !== '') ui.start.ph = ph;
  const ch = tee && s.index != null ? G.courseHandicap(s.index, tee.slope, tee.rating, G.teePar(tee)) : null;
  const inbox = state.inbox.length
    ? `<p class="small chip">${state.inbox.length} note${state.inbox.length === 1 ? '' : 's'} waiting. They attach to your next round.</p>` : '';
  return `
    <div class="card">
      <h3>Start a round</h3>
      ${!courses.length ? `<p class="muted">Add a course first. Snap a photo of the scorecard and it does the rest.</p>
        <button class="big" data-act="nav" data-view="courses">Add a course</button>` : `
      <label>Course</label>
      <select data-bind="startCourse">${courses.map((c) => `<option value="${esc(c.id)}" ${c.id === ui.start.courseId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <label>Tees</label>
      <select data-bind="startTee">${(course?.tees || []).map((t) => `<option ${t.name === ui.start.teeName ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
      <div class="grid2">
        <div><label>Date</label><input type="date" value="${esc(ui.start.date)}" data-bind="startDate"></div>
        <div><label>Playing handicap</label><input type="number" inputmode="numeric" value="${esc(ui.start.ph)}" data-bind="startPH"></div>
      </div>
      <p class="muted small">${s.index == null ? 'Set your handicap index in Settings.' :
        ch == null ? 'This tee has no slope/rating. Enter your playing handicap above.' :
        `Index ${s.index} → course handicap ${ch} on ${esc(tee.name)} (slope ${tee.slope}, rating ${tee.rating}, par ${G.teePar(tee)}).`}</p>
      ${inbox}
      <button class="big" data-act="startRound">Start round</button>`}
    </div>`;
}

function viewActiveRound(round) {
  const th = round.tee.holes[round.currentHole - 1];
  const holeNotes = round.notes.filter((n) => n.hole === round.currentHole).slice().reverse();
  const pending = unparsedCount(round);
  const speech = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  return `
    <div class="card">
      <div class="hole-nav">
        <button class="secondary" data-act="holeDelta" data-d="-1" aria-label="Previous hole">‹</button>
        <div class="grow" style="text-align:center">
          <div class="muted small">Hole</div><div class="num">${round.currentHole}</div>
          <div class="muted">Par ${th.par} · ${th.yards ?? '?'} yds · SI ${th.si ?? '?'}</div>
        </div>
        <button class="secondary" data-act="holeDelta" data-d="1" aria-label="Next hole">›</button>
      </div>
    </div>
    <div class="card">
      <label for="draft" style="margin-top:0">Say it or type it</label>
      <textarea id="draft" data-draft placeholder="e.g. Driver went right in the rough. 190 in, 7 iron, playing for a flyer." >${esc(ui.draft)}</textarea>
      <p class="muted small" style="margin:6px 0 10px">Tip: tap the keyboard mic to dictate.</p>
      <div class="grid2">
        <button data-act="saveNote" data-kind="pre">Save shot note</button>
        <button data-act="saveNote" data-kind="recap">Save hole recap ›</button>
      </div>
      ${speech ? `<button class="secondary" style="width:100%;margin-top:10px" data-act="mic">${ui.listening ? '■ Stop listening' : '🎙 Dictate here'}</button>` : ''}
    </div>
    <div class="card">
      <div class="row between">
        <h3 style="margin:0">Hole ${round.currentHole} notes</h3>
        <span class="chip ${pending ? 'warn' : 'good'}">${pending ? `${pending} not parsed` : 'all parsed'}</span>
      </div>
      ${holeNotes.length ? holeNotes.map((n) => `
        <div class="note"><span class="chip">${n.kind === 'recap' ? 'recap' : n.kind === 'fix' ? 'fix' : 'shot'}</span>
        <span class="muted small">${timeOf(n.ts)}</span><br>${esc(n.text)}
        <button class="ghost small" data-act="delNote" data-id="${esc(n.id)}">delete</button></div>`).join('')
        : '<p class="muted">Nothing yet for this hole.</p>'}
    </div>
    <div class="grid2">
      <button class="secondary" data-act="parseNow">Parse notes (${pending})</button>
      <button class="secondary" data-act="review">Review round</button>
    </div>
    <div class="card" style="margin-top:12px">
      <details ${ui.importOpen ? 'open' : ''}>
        <summary data-act="toggleImport">Import notes from Shortcut file</summary>
        <p class="muted small">Paste lines or choose the .txt your Shortcut has been appending to. One note per line, optionally <code>time|text</code>.</p>
        <textarea id="importText" placeholder="2026-10-21 10:05|hole 1 driver right in the rough..."></textarea>
        <input type="file" accept=".txt,text/plain" data-bind="importFile" style="margin-top:8px">
        <button class="secondary" style="margin-top:8px" data-act="importNotes">Import</button>
      </details>
    </div>
    <button class="danger" style="width:100%" data-act="finishRound">Finish round</button>`;
}

// --- Review view ---

function viewReview() {
  const finished = state.rounds.slice().sort((a, b) => b.createdAt - a.createdAt);
  if (!finished.length) return `<div class="card"><p class="muted">No rounds yet. Start one from the Round tab.</p></div>`;
  const round = roundById(ui.reviewRoundId) || roundById(state.activeRoundId) || finished[0];
  ui.reviewRoundId = round.id;
  const sum = G.roundSummary(round);
  const issues = sum.rows.flatMap((r) => r.issues.filter((i) => i.type !== 'empty').map((i) => ({ hole: r.hole, ...i })));
  const picker = `<select data-bind="reviewRound">${finished.map((r) => `<option value="${esc(r.id)}" ${r.id === round.id ? 'selected' : ''}>${esc(r.date)} · ${esc(r.courseName)}${r.status === 'active' ? ' (in progress)' : ''}</option>`).join('')}</select>`;
  const sgRow = G.SG_CATEGORIES.map((c) => `<div class="stat"><b class="sg ${sgClass(sum.sg[c])}">${fmtSG(sum.sg[c])}</b><span>${G.SG_LABELS[c]}</span></div>`).join('');
  const half = (from, to) => {
    const rows = sum.rows.slice(from, to);
    const tot = (k) => rows.reduce((a, r) => a + (r[k] ?? 0), 0);
    const anyPlayed = rows.some((r) => r.gross != null);
    return `
      <div class="scroll-x"><table>
        <tr><th class="l">Hole</th>${rows.map((r) => `<th>${r.hole}</th>`).join('')}<th>${from ? 'IN' : 'OUT'}</th></tr>
        <tr><td class="l muted">Par</td>${rows.map((r) => `<td>${r.par}</td>`).join('')}<td>${tot('par')}</td></tr>
        <tr><td class="l muted">SI</td>${rows.map((r) => `<td class="muted">${r.si ?? ''}</td>`).join('')}<td></td></tr>
        <tr><td class="l">Gross</td>${rows.map((r) => `<td class="${scoreClass(r)}">${r.gross ?? ''}</td>`).join('')}<td><b>${anyPlayed ? tot('gross') : ''}</b></td></tr>
        <tr><td class="l">Net</td>${rows.map((r) => `<td>${r.net ?? ''}</td>`).join('')}<td><b>${anyPlayed ? tot('net') : ''}</b></td></tr>
      </table></div>`;
  };
  const n = round.tee.holes.length;
  const holeCards = sum.rows.map((r) => holeCard(round, r)).join('');
  return `
    <div class="card">${picker}
      <div class="row between" style="margin-top:10px">
        <div><b>${esc(round.courseName)}</b> · ${esc(round.tee.name)}<br><span class="muted small">${esc(round.date)} · playing handicap ${round.playingHandicap}</span></div>
        <button class="danger" data-act="delRound" data-id="${esc(round.id)}">Delete</button>
      </div>
    </div>
    <div class="card">
      <div class="grid3">
        <div class="stat"><b>${sum.played ? sum.gross : '-'}</b><span>Gross (${sum.played ? G.fmtToPar(sum.toPar) : '-'})</span></div>
        <div class="stat"><b>${sum.played ? sum.net : '-'}</b><span>Net (${sum.played ? G.fmtToPar(sum.netToPar) : '-'})</span></div>
        <div class="stat"><b class="sg ${sgClass(sum.sgTotal)}">${sum.sgShots ? fmtSG(sum.sgTotal) : '-'}</b><span>Strokes gained</span></div>
      </div>
      ${half(0, Math.min(9, n))}
      ${n > 9 ? half(9, n) : ''}
    </div>
    <div class="card"><h3>Strokes gained by area</h3><div class="grid2">${sgRow}</div>
      <p class="muted small">Estimated against ${round.baselineIndex != null ? `a ${round.baselineIndex}-handicap baseline` : 'a PGA Tour style baseline'}. Directional, not exact.</p></div>
    ${issues.length ? `<div class="card"><h3>To fix (${issues.length})</h3>${issues.slice(0, 12).map((i) => `<div class="issue">Hole ${i.hole}: ${esc(i.msg)}</div>`).join('')}
      <p class="muted small">Open a hole below to edit shots or dictate a correction.</p></div>` : ''}
    <div class="row between"><h2 style="margin:0">Holes</h2>
      <button class="secondary" data-act="reparse" data-id="${esc(round.id)}">Re-parse notes</button></div>
    <div style="margin-top:10px">${holeCards}</div>
    <h2>Full notes</h2>
    <div class="card">${round.notes.length ? round.notes.map((nn) => `<div class="note small"><span class="chip">h${nn.parsedHole ?? nn.hole ?? '?'}</span> ${esc(nn.text)}</div>`).join('') : '<p class="muted">No notes.</p>'}</div>`;
}

function scoreClass(r) {
  if (r.gross == null) return '';
  const d = r.gross - r.par;
  if (r.gross === 1 || d <= -2) return 's-eagle';
  if (d === -1) return 's-birdie';
  if (d === 0) return 's-par';
  if (d === 1) return 's-bogey';
  return 's-double';
}

function holeCard(round, r) {
  const hole = round.holes[r.hole] || { hole: r.hole, shots: [] };
  const open = ui.openHole === r.hole;
  const hasData = (hole.shots || []).length || hole.score != null;
  const th = round.tee.holes[r.hole - 1];
  const shots = G.shotsWithSG(hole, th, round.baselineIndex ?? null);
  const notes = round.notes.filter((n) => (n.parsedHole ?? n.hole) === r.hole);
  const flag = r.issues.some((i) => i.type !== 'empty');
  return `
    <div class="card">
      <div class="row between" data-act="toggleHole" data-hole="${r.hole}" style="cursor:pointer">
        <div><b>Hole ${r.hole}</b> <span class="muted small">par ${r.par} · ${r.yards ?? '?'}y</span>
          ${hole.edited ? '<span class="chip">edited</span>' : ''}${flag ? '<span class="chip warn">check</span>' : ''}</div>
        <div><b class="${scoreClass(r)}">${r.gross ?? '-'}</b> <span class="muted small">${open ? '▲' : '▼'}</span></div>
      </div>
      ${hole.summary && open ? `<p class="muted small" style="margin:6px 0 0">${esc(hole.summary)}</p>` : ''}
      ${open ? `
        ${shots.map((s, i) => shotRow(s, i, r.hole)).join('') || '<p class="muted">No shots recorded.</p>'}
        <div class="row" style="margin-top:8px">
          <button class="secondary" data-act="addShot" data-hole="${r.hole}">+ Add shot</button>
          <button class="secondary" data-act="editHole" data-hole="${r.hole}">Edit score</button>
          ${hole.edited ? `<button class="ghost" data-act="unlockHole" data-hole="${r.hole}">Unlock for AI</button>` : ''}
        </div>
        ${r.issues.filter((i) => i.type !== 'empty').map((i) => `<div class="issue" style="margin-top:6px">⚠ ${esc(i.msg)}</div>`).join('')}
        ${notes.length ? `<div class="note-box">${notes.map((n) => `<div>${esc(n.text)}</div>`).join('')}</div>` : ''}
        <label>Add a correction (type or dictate), then re-parse</label>
        <textarea id="fix-${r.hole}" style="min-height:70px" placeholder="e.g. The second shot was a 6 iron from 170, and I two putted from 15 feet"></textarea>
        <button class="secondary" style="margin-top:8px" data-act="addFix" data-hole="${r.hole}">Add correction & re-parse</button>` : ''}
      ${!open && !hasData ? '<div class="muted small">No data</div>' : ''}
    </div>`;
}

function shotRow(s, i, holeNo) {
  const dist = s.start.dist != null ? `${Math.round(s.start.dist)}${s.start.unit}` : '?';
  const res = s.resultLie && s.resultLie !== 'unknown' ? `→ ${s.resultLie}${s.miss && !['none', 'unknown'].includes(s.miss) ? ` (${s.miss})` : ''}` : '';
  return `
    <div class="shot">
      <div class="n">${i + 1}</div>
      <div class="grow">
        <div><b>${esc(s.club || '?')}</b> from ${esc(s.start.lie || '?')} ${dist} ${res}
          ${s.penalty ? `<span class="chip bad">+${s.penalty} pen</span>` : ''}${s.inferred ? '<span class="chip warn">inferred</span>' : ''}</div>
        ${s.intent ? `<div class="muted small">${esc(s.intent)}</div>` : ''}
        <div>${(s.tags || []).map((t) => `<span class="chip">${esc(t.replace(/_/g, ' '))}</span>`).join('')}
          ${s.risk && s.risk !== 'unknown' ? `<span class="chip">${esc(s.risk)}</span>` : ''}</div>
      </div>
      <div style="text-align:right">
        <div class="sg ${sgClass(s.sg)}">${fmtSG(s.sg)}</div>
        <button class="ghost small" data-act="editShot" data-hole="${holeNo}" data-idx="${i}">edit</button>
      </div>
    </div>`;
}

// --- Stats view ---

function viewStats() {
  const rounds = state.rounds.filter((r) => Object.keys(r.holes).length);
  if (!rounds.length) return `<div class="card"><p class="muted">Stats appear once a round has been parsed. Play a few holes, add notes, then tap Parse.</p></div>`;
  const agg = G.aggregateStats(rounds);
  const ins = G.buildInsights(rounds);
  const clubs = G.clubStats(rounds);
  const maxSG = Math.max(1, ...G.SG_CATEGORIES.map((c) => Math.abs(agg.sgPerRound[c] ?? 0)));
  const bar = (v) => {
    if (v == null) return '';
    const w = Math.min(50, (Math.abs(v) / maxSG) * 50);
    return `<div class="bar"><i style="${v >= 0 ? `left:50%;` : `right:50%;`}width:${w}%;background:${v >= 0 ? 'var(--good)' : 'var(--bad)'}"></i></div>`;
  };
  return `
    <div class="card">
      <h3>Overview (${agg.rounds} round${agg.rounds === 1 ? '' : 's'}, ${agg.holes} holes)</h3>
      <div class="grid3">
        <div class="stat"><b>${agg.avgGross != null ? agg.avgGross.toFixed(1) : '-'}</b><span>Avg gross</span></div>
        <div class="stat"><b>${agg.avgToPar != null ? fmt1(agg.avgToPar) : '-'}</b><span>Avg vs par</span></div>
        <div class="stat"><b>${fmt1(agg.puttsPerHole)}</b><span>Putts / hole</span></div>
        <div class="stat"><b>${pct(agg.fir)}</b><span>Fairways</span></div>
        <div class="stat"><b>${pct(agg.gir)}</b><span>Greens</span></div>
        <div class="stat"><b>${pct(agg.scramble)}</b><span>Scrambling</span></div>
      </div>
      <p class="muted small">Par 3 avg ${fmt1(agg.byPar[3])} · Par 4 avg ${fmt1(agg.byPar[4])} · Par 5 avg ${fmt1(agg.byPar[5])} (vs par)</p>
    </div>
    <div class="card">
      <h3>Strokes gained per round</h3>
      ${G.SG_CATEGORIES.map((c) => `<div style="margin:8px 0"><div class="row between"><span>${G.SG_LABELS[c]}</span><b class="sg ${sgClass(agg.sgPerRound[c])}">${fmtSG(agg.sgPerRound[c])}</b></div>${bar(agg.sgPerRound[c])}</div>`).join('')}
      <p class="muted small">Estimated, handicap-adjusted. Needs distance and lie on each shot to be meaningful.</p>
    </div>
    <div class="card">
      <h3>Patterns costing you strokes</h3>
      ${ins.leaks.length ? ins.leaks.map((i) => `<div class="note">${esc(G.insightSentence(i))}</div>`).join('')
        : `<p class="muted">Nothing yet. Patterns show once a tag or decision type has ${G.MIN_SAMPLE}+ shots with data (${ins.shotCount} shots so far).</p>`}
    </div>
    <div class="card">
      <h3>What is working</h3>
      ${ins.strengths.length ? ins.strengths.map((i) => `<div class="note">${esc(G.insightSentence(i))}</div>`).join('')
        : '<p class="muted">Nothing yet.</p>'}
    </div>
    <div class="card scroll-x">
      <h3>Clubs</h3>
      <table><tr><th class="l">Club</th><th>Shots</th><th>Avg dist</th><th>Green %</th><th>SG</th><th>L/R</th></tr>
      ${clubs.map((c) => `<tr><td class="l">${esc(c.club)}</td><td>${c.n}</td><td>${c.avgDist != null ? Math.round(c.avgDist) : '-'}</td><td>${pct(c.greenRate)}</td><td class="sg ${sgClass(c.avgSG)}">${fmtSG(c.avgSG)}</td><td class="muted">${c.misses.left}/${c.misses.right}</td></tr>`).join('')}
      </table>
      <p class="muted small">Avg dist is distance to the pin when you played the club, which includes plays-like decisions.</p>
    </div>
    <div class="card"><h3>Rounds</h3>
      ${agg.trend.slice().reverse().map((t) => `<div class="note row between"><span>${esc(t.date)} ${esc(t.course)}</span><span><b>${t.gross}</b> (${G.fmtToPar(t.toPar)}) · SG ${fmtSG(t.sg)}</span></div>`).join('')}
    </div>`;
}

// --- Courses view ---

function viewCourses() {
  if (ui.editCourse) return viewCourseEditor();
  return `
    <div class="card">
      <h3>Add a course</h3>
      <p class="muted small">Use a photo of the card, or screenshots from the club's website or a golf app. Include every tee with slope, rating, par, stroke index and yardages. For a long page, select all the screenshots at once.</p>
      <label>Screenshots from your photo library (pick one or more)</label>
      <input type="file" accept="image/*" multiple data-bind="scorecardFiles">
      <label>Or take a photo of the card</label>
      <input type="file" accept="image/*" capture="environment" data-bind="scorecardFiles">
      <button class="secondary" style="margin-top:10px;width:100%" data-act="manualCourse">Enter manually instead</button>
    </div>
    <h2>Your courses</h2>
    ${state.courses.length ? state.courses.map((c) => `
      <div class="card row between">
        <div><b>${esc(c.name)}</b><br><span class="muted small">${c.tees.map((t) => esc(t.name)).join(', ') || 'no tees'}</span></div>
        <div><button class="secondary" data-act="editCourse" data-id="${esc(c.id)}">Edit</button></div>
      </div>`).join('') : '<p class="muted">No courses yet.</p>'}`;
}

function viewCourseEditor() {
  const c = ui.editCourse;
  return `
    <div class="card">
      <h3>${state.courses.some((x) => x.id === c.id) ? 'Edit course' : 'New course'}</h3>
      ${ui.courseNote ? `<p class="issue">${esc(ui.courseNote)}</p>` : ''}
      <label>Name</label><input value="${esc(c.name)}" data-bind="cPath" data-path="name">
    </div>
    ${c.tees.map((t, ti) => `
      <div class="card">
        <div class="row between"><h3 style="margin:0">Tee ${ti + 1}</h3>
          <button class="danger" data-act="delTee" data-ti="${ti}">Remove tee</button></div>
        <div class="grid3">
          <div><label>Name</label><input value="${esc(t.name)}" data-bind="cPath" data-path="tees.${ti}.name"></div>
          <div><label>Slope</label><input type="number" inputmode="numeric" value="${esc(t.slope ?? '')}" data-bind="cPath" data-path="tees.${ti}.slope" data-num="1"></div>
          <div><label>Rating</label><input type="number" inputmode="decimal" step="0.1" value="${esc(t.rating ?? '')}" data-bind="cPath" data-path="tees.${ti}.rating" data-num="1"></div>
        </div>
        <div class="scroll-x course-table"><table>
          <tr><th>#</th><th>Par</th><th>SI</th><th>Yards</th></tr>
          ${t.holes.map((h, hi) => `<tr><td>${h.hole}</td>
            ${['par', 'si', 'yards'].map((k) => `<td><input type="number" inputmode="numeric" value="${esc(h[k] ?? '')}" data-bind="cPath" data-path="tees.${ti}.holes.${hi}.${k}" data-num="1"></td>`).join('')}</tr>`).join('')}
          <tr class="tot"><td>Tot</td><td>${G.teePar(t)}</td><td></td><td>${G.teeYards(t)}</td></tr>
        </table></div>
      </div>`).join('')}
    <button class="secondary" style="width:100%;margin-bottom:10px" data-act="addTee">+ Add tee</button>
    <div class="grid2">
      <button data-act="saveCourse">Save course</button>
      <button class="secondary" data-act="cancelCourse">Cancel</button>
    </div>
    ${state.courses.some((x) => x.id === c.id) ? `<button class="danger" style="width:100%;margin-top:10px" data-act="delCourse" data-id="${esc(c.id)}">Delete course</button>` : ''}`;
}

// --- Settings view ---

function viewSettings() {
  const s = state.settings;
  return `
    <div class="card">
      <h3>Handicap</h3>
      <div class="grid2">
        <div><label>Handicap index</label><input type="number" step="0.1" inputmode="decimal" value="${esc(s.index ?? '')}" data-bind="setting" data-key="index" data-num="1"></div>
        <div><label>Allowance %</label><input type="number" inputmode="numeric" value="${esc(s.allowance)}" data-bind="setting" data-key="allowance" data-num="1"></div>
      </div>
      <label>Strokes-gained baseline</label>
      <select data-bind="setting" data-key="baseline">
        <option value="hcp" ${s.baseline === 'hcp' ? 'selected' : ''}>Scaled to my handicap (recommended)</option>
        <option value="pro" ${s.baseline === 'pro' ? 'selected' : ''}>PGA Tour style</option>
      </select>
      <p class="muted small">Course handicap = index × slope ÷ 113 + (rating − par). Playing handicap applies the allowance %. Baseline applies to new rounds.</p>
    </div>
    <div class="card">
      <h3>Claude API</h3>
      <label>API key</label>
      <input type="password" autocomplete="off" value="${esc(s.apiKey)}" placeholder="sk-ant-..." data-bind="setting" data-key="apiKey">
      <label>Model</label>
      <select data-bind="setting" data-key="model">${AI.MODELS.map((m) => `<option value="${m.id}" ${s.model === m.id ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select>
      <label><input type="checkbox" style="width:auto" ${s.autoParse ? 'checked' : ''} data-bind="settingCheck" data-key="autoParse"> Parse automatically after each hole recap</label>
      <p class="muted small">The key stays on this phone and is sent only to Anthropic. Do not share this app with others while a key is saved here.</p>
    </div>
    <div class="card">
      <h3>Your data</h3>
      <p class="muted small">Everything is stored on this device only. Export a backup now and then (the API key is not included).</p>
      <div class="grid2">
        <button class="secondary" data-act="export">Export backup</button>
        <div><input type="file" accept="application/json,.json" data-bind="importBackup"></div>
      </div>
    </div>`;
}

// --- Modal (edit shot / hole) ---

const optList = (list, cur) => list.map((v) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');

function modalHtml() {
  const m = ui.modal;
  const round = roundById(ui.reviewRoundId);
  if (!round) return '';
  const hole = round.holes[m.hole] || { hole: m.hole, shots: [] };
  if (m.type === 'hole') {
    return `<div class="modal"><div class="sheet"><h3>Hole ${m.hole} score</h3>
      <form id="modal-form">
        <label>Gross score</label><input name="score" type="number" inputmode="numeric" value="${esc(hole.score ?? '')}">
        <label>Summary</label><input name="summary" value="${esc(hole.summary || '')}">
        <div class="grid2" style="margin-top:14px"><button data-act="saveHole" type="button">Save</button><button class="secondary" type="button" data-act="closeModal">Cancel</button></div>
      </form></div></div>`;
  }
  const s = hole.shots[m.idx] || {};
  return `<div class="modal"><div class="sheet"><h3>Hole ${m.hole} · shot ${m.idx + 1}</h3>
    <form id="modal-form">
      <div class="grid2">
        <div><label>Club</label><select name="club"><option value=""></option>${optList(AI.CLUBS, s.club)}</select></div>
        <div><label>Lie (from)</label><select name="lie">${optList(AI.LIES, s.lie)}</select></div>
        <div><label>Distance</label><input name="dist" type="number" inputmode="decimal" value="${esc(s.dist ?? '')}"></div>
        <div><label>Unit</label><select name="unit">${optList(['yd', 'ft'], s.unit)}</select></div>
        <div><label>Ended up</label><select name="resultLie">${optList(AI.RESULT_LIES, s.resultLie)}</select></div>
        <div><label>Miss</label><select name="miss">${optList(AI.MISSES, s.miss)}</select></div>
        <div><label>Penalty strokes</label><input name="penalty" type="number" inputmode="numeric" value="${esc(s.penalty || 0)}"></div>
        <div><label>Risk</label><select name="risk">${optList(AI.RISK, s.risk)}</select></div>
        <div><label>Club adjust</label><select name="clubAdjust">${optList(AI.ADJUST, s.clubAdjust)}</select></div>
        <div><label>Quality</label><select name="quality">${optList(AI.QUALITY, s.quality)}</select></div>
      </div>
      <label>Intent</label><input name="intent" value="${esc(s.intent || '')}">
      <label>Tags (comma separated)</label><input name="tags" value="${esc((s.tags || []).join(', '))}">
      <div class="grid2" style="margin-top:14px"><button data-act="saveShot" type="button">Save</button><button class="secondary" type="button" data-act="closeModal">Cancel</button></div>
      <button class="danger" type="button" style="width:100%;margin-top:8px" data-act="delShot">Delete shot</button>
    </form></div></div>`;
}

// ---------- editing ----------

function lockedHole(round, n) {
  if (!round.holes[n]) round.holes[n] = { hole: n, score: null, summary: '', shots: [] };
  round.holes[n].edited = true;
  return round.holes[n];
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
}

function formValues() {
  const form = document.getElementById('modal-form');
  return Object.fromEntries(new FormData(form).entries());
}

// ---------- actions ----------

let recognition = null;

const actions = {
  nav: (t) => setView(t.dataset.view),
  startRound,
  holeDelta: (t) => {
    const r = activeRound();
    r.currentHole = Math.min(r.tee.holes.length, Math.max(1, r.currentHole + Number(t.dataset.d)));
    persist();
    render();
  },
  saveNote: (t) => {
    const kind = t.dataset.kind;
    const r = activeRound();
    const res = addNote(ui.draft, kind);
    if (!res) return toast('Type or dictate something first');
    ui.draft = '';
    toast(kind === 'recap' ? 'Hole recap saved' : 'Note saved');
    render();
    if (kind === 'recap' && r && state.settings.autoParse) runParse(r, { silent: true });
  },
  delNote: (t) => {
    const r = activeRound();
    r.notes = r.notes.filter((n) => n.id !== t.dataset.id);
    persist();
    render();
  },
  parseNow: () => runParse(activeRound()),
  review: () => {
    ui.reviewRoundId = state.activeRoundId;
    setView('review');
  },
  finishRound: async () => {
    const r = activeRound();
    if (!confirm('Finish this round?')) return;
    r.status = 'done';
    state.activeRoundId = null;
    ui.reviewRoundId = r.id;
    persist();
    ui.view = 'review';
    render();
    if (unparsedCount(r) && state.settings.apiKey) await runParse(r);
  },
  toggleImport: () => { ui.importOpen = !ui.importOpen; },
  importNotes: () => {
    const text = document.getElementById('importText').value;
    const r = activeRound();
    const notes = AI.parseNotesText(text);
    if (!notes.length) return toast('Nothing to import');
    r.notes.push(...notes);
    persist();
    ui.importOpen = false;
    toast(`Imported ${notes.length} notes`);
    render();
    if (state.settings.autoParse) runParse(r);
  },
  reparse: (t) => runParse(roundById(t.dataset.id)),
  delRound: (t) => {
    if (!confirm('Delete this round and its notes?')) return;
    state.rounds = state.rounds.filter((r) => r.id !== t.dataset.id);
    if (state.activeRoundId === t.dataset.id) state.activeRoundId = null;
    ui.reviewRoundId = null;
    persist();
    render();
  },
  toggleHole: (t) => {
    const n = Number(t.dataset.hole);
    ui.openHole = ui.openHole === n ? null : n;
    render();
  },
  addShot: (t) => {
    const round = roundById(ui.reviewRoundId);
    const hole = lockedHole(round, Number(t.dataset.hole));
    hole.shots.push(AI.normalizeShot({ lie: hole.shots.length ? 'unknown' : 'tee', unit: 'yd' }));
    persist();
    ui.modal = { type: 'shot', hole: hole.hole, idx: hole.shots.length - 1 };
    render();
  },
  editShot: (t) => {
    ui.modal = { type: 'shot', hole: Number(t.dataset.hole), idx: Number(t.dataset.idx) };
    render();
  },
  editHole: (t) => {
    ui.modal = { type: 'hole', hole: Number(t.dataset.hole) };
    render();
  },
  unlockHole: (t) => {
    const round = roundById(ui.reviewRoundId);
    round.holes[Number(t.dataset.hole)].edited = false;
    persist();
    toast('Unlocked. Re-parse to let the AI rebuild it');
    render();
  },
  closeModal: () => { ui.modal = null; render(); },
  saveShot: () => {
    const m = ui.modal;
    const round = roundById(ui.reviewRoundId);
    const hole = lockedHole(round, m.hole);
    const v = formValues();
    const old = hole.shots[m.idx] || {};
    hole.shots[m.idx] = {
      ...old,
      club: v.club || null,
      lie: v.lie,
      dist: num(v.dist),
      unit: v.lie === 'green' ? 'ft' : v.unit,
      resultLie: v.resultLie,
      miss: v.miss,
      penalty: Math.max(0, parseInt(v.penalty, 10) || 0),
      risk: v.risk,
      clubAdjust: v.clubAdjust,
      quality: v.quality,
      intent: v.intent,
      tags: v.tags.split(',').map((x) => x.trim().toLowerCase().replace(/\s+/g, '_')).filter(Boolean),
      inferred: false,
    };
    persist();
    ui.modal = null;
    render();
  },
  delShot: () => {
    const m = ui.modal;
    const round = roundById(ui.reviewRoundId);
    const hole = lockedHole(round, m.hole);
    hole.shots.splice(m.idx, 1);
    persist();
    ui.modal = null;
    render();
  },
  saveHole: () => {
    const m = ui.modal;
    const round = roundById(ui.reviewRoundId);
    const hole = lockedHole(round, m.hole);
    const v = formValues();
    hole.score = num(v.score);
    hole.summary = v.summary;
    persist();
    ui.modal = null;
    render();
  },
  addFix: async (t) => {
    const n = Number(t.dataset.hole);
    const round = roundById(ui.reviewRoundId);
    const box = document.getElementById(`fix-${n}`);
    const text = box.value.trim();
    if (!text) return toast('Type the correction first');
    round.notes.push({ id: AI.uid('n'), ts: Date.now(), hole: n, kind: 'fix', text, parsed: false });
    if (round.holes[n]) round.holes[n].edited = false;
    persist();
    await runParse(round);
  },
  mic: () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (ui.listening && recognition) { recognition.stop(); return; }
    recognition = new SR();
    recognition.lang = 'en-GB';
    recognition.interimResults = false;
    recognition.continuous = true;
    recognition.onresult = (e) => {
      const text = Array.from(e.results).slice(e.resultIndex).map((r) => r[0].transcript).join(' ');
      const box = document.getElementById('draft');
      ui.draft = `${ui.draft} ${text}`.trim();
      if (box) box.value = ui.draft;
    };
    recognition.onerror = () => toast('Dictation unavailable here. Use the keyboard mic');
    recognition.onend = () => { ui.listening = false; render(); };
    try { recognition.start(); ui.listening = true; } catch (e) { toast('Dictation unavailable here'); }
    render();
  },
  manualCourse: () => {
    const holes = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, si: i + 1, yards: null }));
    ui.editCourse = { id: AI.uid('c'), name: '', tees: [{ name: 'White', slope: null, rating: null, holes }], warnings: [] };
    ui.courseNote = '';
    render();
  },
  editCourse: (t) => {
    ui.editCourse = clone(state.courses.find((c) => c.id === t.dataset.id));
    ui.courseNote = '';
    render();
  },
  addTee: () => {
    const last = ui.editCourse.tees[ui.editCourse.tees.length - 1];
    const tee = last ? clone(last) : { slope: null, rating: null, holes: Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, si: i + 1, yards: null })) };
    tee.name = 'New tee';
    ui.editCourse.tees.push(tee);
    render();
  },
  delTee: (t) => { ui.editCourse.tees.splice(Number(t.dataset.ti), 1); render(); },
  cancelCourse: () => { ui.editCourse = null; render(); },
  saveCourse: () => {
    const c = ui.editCourse;
    if (!c.name.trim()) return toast('Give the course a name');
    if (!c.tees.length) return toast('Add at least one tee');
    delete c.warnings;
    const i = state.courses.findIndex((x) => x.id === c.id);
    if (i >= 0) state.courses[i] = c; else state.courses.push(c);
    ui.start.courseId = c.id;
    ui.start.teeName = c.tees[0].name;
    ui.start.ph = '';
    ui.editCourse = null;
    persist();
    toast('Course saved');
    render();
  },
  delCourse: (t) => {
    if (!confirm('Delete this course? Past rounds keep their own copy of the card.')) return;
    state.courses = state.courses.filter((c) => c.id !== t.dataset.id);
    ui.editCourse = null;
    persist();
    render();
  },
  export: () => {
    const blob = new Blob([S.exportJSON(state)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `qual-golf-backup-${today()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
};

const binds = {
  startCourse: (t) => { ui.start.courseId = t.value; ui.start.teeName = ''; ui.start.ph = ''; render(); },
  startTee: (t) => { ui.start.teeName = t.value; ui.start.ph = ''; render(); },
  startDate: (t) => { ui.start.date = t.value; },
  startPH: (t) => { ui.start.ph = t.value; },
  reviewRound: (t) => { ui.reviewRoundId = t.value; ui.openHole = null; render(); },
  setting: (t) => {
    const key = t.dataset.key;
    state.settings[key] = t.dataset.num ? num(t.value) : t.value.trim();
    if (key === 'allowance' && state.settings.allowance == null) state.settings.allowance = 100;
    persist();
    if (key === 'index' || key === 'allowance') ui.start.ph = '';
  },
  settingCheck: (t) => { state.settings[t.dataset.key] = t.checked; persist(); },
  cPath: (t) => {
    let v = t.value;
    if (t.dataset.num) v = num(v);
    setPath(ui.editCourse, t.dataset.path, v);
    if (/\.(par|si|yards)$/.test(t.dataset.path)) render();
  },
  scorecardFiles: (t) => { scorecardFromFiles(t.files); t.value = ''; },
  importFile: async (t) => {
    if (!t.files[0]) return;
    document.getElementById('importText').value = await t.files[0].text();
  },
  importBackup: async (t) => {
    if (!t.files[0]) return;
    try {
      if (!confirm('Replace everything on this device with that backup?')) return;
      state = S.importJSON(await t.files[0].text(), state);
      persist();
      toast('Backup restored');
      render();
    } catch (e) {
      toast(e.message);
    }
  },
};

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]');
  if (!t || !actions[t.dataset.act]) return;
  if (t.tagName === 'SUMMARY') return actions[t.dataset.act](t);
  actions[t.dataset.act](t, e);
});
document.addEventListener('change', (e) => {
  const t = e.target.closest('[data-bind]');
  if (t && binds[t.dataset.bind]) binds[t.dataset.bind](t, e);
});
document.addEventListener('input', (e) => {
  if (e.target.matches('[data-draft]')) ui.draft = e.target.value;
});
window.addEventListener('hashchange', () => { handleHash(); render(); });

// ---------- boot ----------

handleHash();
render();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Exposed for debugging in the browser console.
window.__qgolf = { get state() { return state; }, ui };
