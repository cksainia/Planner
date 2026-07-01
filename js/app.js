// app.js — UI router + screens. Wires store <-> firebase, renders Today / Tasks
// / Goals / Reflect / Setup, plus the AI-Planner methodology layer (frog, quick
// capture, Pomodoro, Eisenhower matrix, inbox/buckets, reviews).

import * as store from './store.js';
import { buildDailyList, scoreTask, eligibleTasks, isBig, todayEffort, suggestFrog, planDay, quadrant, minToTime } from './engine.js';
import { computeStreak, daySummary, mustDoStatus, rollup } from './reflection.js';
import { dashboard, goalProgress, goalTasks } from './dashboard.js';
import * as ai from './ai.js';
import { initFirebase, isConfigured, onAuth, signInWithGoogle, signOutUser, watchDoc, writeDoc } from './firebase.js';

const CTX_EMOJI = { work: '💼', home: '🏠', outdoor: '🌳', digital: '💻', family: '👨‍👩‍👧', personal: '🧘' };
const PRI_LABEL = { p1: 'P1', p2: 'P2', p3: 'P3', p4: 'P4' };
const BUCKET_LABEL = { inbox: '📥 Inbox', today: '📌 Today', tomorrow: '🌅 Tomorrow', later: '🗄️ Later', someday: '💭 Someday' };

let view = 'today';
let tasksView = 'goal'; // goal | inbox | buckets | matrix
let user = null;
let unsubDoc = null;
let booted = false;
let editing = null; // task-editor working state
let pomo = null;    // pomodoro session
let syncStatus = 'ok'; // 'ok' | 'error' — surfaced in the header when a cloud write fails

const $ = (s, r = document) => r.querySelector(s);
const app = () => $('#app');
const overlay = () => $('#overlay');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const S = () => store.getState();

// ---------- boot ----------
function boot() {
  store.load();
  if (!$('#overlay')) { const o = document.createElement('div'); o.id = 'overlay'; document.body.appendChild(o); }
  // The overlay lives on <body>, outside #app — delegate its clicks too, else
  // modal buttons (Save/Delete/Close, focus, frog picker) never fire.
  $('#overlay').addEventListener('click', onClick);
  const cfgOk = initFirebase();
  store.subscribe(() => { if (booted) render(); });

  if (cfgOk) {
    onAuth((u) => {
      user = u;
      if (unsubDoc) { unsubDoc(); unsubDoc = null; }
      if (u) {
        store.setPushFn((synced) => writeDoc(u.uid, synced).then(() => setSync('ok'))
          .catch((e) => { console.warn('push failed', e); setSync('error'); }));
        unsubDoc = watchDoc(u.uid, (data) => {
          if (data) store.applyCloud(data); else store.cloudInitEmpty();
          store.doRollover();
          startDay();
        }, () => setSync('error'));
      } else { store.setPushFn(null); }
      booted = true;
      render();
    });
  } else {
    store.cloudInitEmpty();
    store.doRollover();
    startDay();
    booted = true;
    render();
  }
}

// Update sync status and refresh the header badge (only when it actually changes).
function setSync(s) { if (s === syncStatus) return; syncStatus = s; if (booted) render(); }

// Once-per-day setup done OFF the render path (never write during render): pick
// the day's frog if none, and stamp the engine's must-do set so the evening
// review counts the plan the user actually worked from.
function startDay() { ensureDailyFrog(); ensureDailyPlan(); }
function ensureDailyFrog() {
  const st = S();
  if (store.needsSeed()) return;
  const today = store.todayStr();
  const fid = store.getFrogId(today);
  const cur = fid && st.tasks.find((t) => t.id === fid && t.status !== 'done');
  if (!cur) { const sug = suggestFrog(st, {}); if (sug.task) store.setFrog(sug.task.id, today); }
}
function ensureDailyPlan() {
  const st = S();
  if (store.needsSeed()) return;
  const today = store.todayStr();
  const plan = st.dailyPlan[today] || {};
  if (plan.stamped === today) return; // already captured today's plan
  const frogId = store.getFrogId(today);
  const r = buildDailyList(st, { today, budgetMins: st.settings.dailyBudgetMins, frogId });
  store.setDailyPlan(today, { mustDoIds: r.mustDo.map((i) => i.task.id), capacityMins: st.settings.dailyBudgetMins, stamped: today });
}

// ---------- top-level render ----------
let rendering = false;
let lastView = null;
function render() {
  if (rendering) return;          // guard: mutations during render won't nest
  rendering = true;
  try { renderInner(); } finally { rendering = false; }
}
function renderInner() {
  if (isConfigured() && !user) { renderSignIn(); return; }
  // Preserve scroll + focus across in-place updates so completing/triaging a task
  // deep in a list doesn't bounce the user to the top or drop their caret.
  const samePage = lastView === view;
  const scrollEl = document.scrollingElement || document.documentElement;
  const prevScroll = samePage ? scrollEl.scrollTop : 0;
  const active = document.activeElement;
  const focusId = samePage && active && active.id && app().contains(active) ? active.id : null;
  const caret = (focusId && 'selectionStart' in active) ? active.selectionStart : null;

  const body = { today: viewToday, tasks: viewTasks, goals: viewGoals, reflect: viewReflect, settings: viewSettings }[view] || viewToday;
  app().innerHTML = `
    <header class="topbar">
      <div class="brand">🎯 Life Planner</div>
      <div class="sub">${esc(humanDate(store.todayStr()))} · ${streakLabel(S())}${syncBadge()}</div>
    </header>
    <main class="screen">${body()}</main>
    <nav class="tabbar">
      ${tab('today', '📋', 'Today')}${tab('tasks', '🗂️', 'Tasks')}${tab('goals', '🎯', 'Goals')}${tab('reflect', '🌙', 'Reflect')}${tab('settings', '⚙️', 'Setup')}
    </nav>`;
  wire();
  lastView = view;
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) { try { el.focus({ preventScroll: true }); if (caret != null && 'selectionStart' in el) el.setSelectionRange(caret, caret); } catch (e) {} }
  }
  scrollEl.scrollTop = prevScroll;
}
// Streak reads "extended today" once today is active, else "intact (grace)" so the
// header doesn't imply activity on a day nothing's been done yet (#13).
function streakLabel(st) {
  const n = computeStreak(st);
  if (!n) return 'No streak yet';
  const active = (st.wins || []).some((w) => w.date === store.todayStr());
  return `🔥 ${n}-day streak${active ? '' : ' · keep it alive'}`;
}
function syncBadge() {
  if (!isConfigured() || !user) return '';
  if (syncStatus === 'error') return ' · <span class="syncerr" title="Last cloud write failed — changes are saved on this device and will retry.">⚠️ sync failed</span>';
  return '';
}
function tab(id, icon, label) {
  return `<button class="tabbtn ${view === id ? 'active' : ''}" data-nav="${id}"><span>${icon}</span>${label}</button>`;
}

// ---------- sign in ----------
function renderSignIn() {
  app().innerHTML = `
    <div class="signin">
      <h1>🎯 Life Planner</h1>
      <p class="muted">Private. Synced across your devices.</p>
      <div class="card">
        <button class="primary gbtn" id="googleBtn"><span class="glogo">G</span> Continue with Google</button>
        <p class="err" id="signinErr"></p>
      </div>
    </div>`;
  $('#googleBtn').addEventListener('click', async () => {
    $('#signinErr').textContent = '';
    try { await signInWithGoogle(); } catch (err) { $('#signinErr').textContent = 'Sign-in failed: ' + (err.code || err.message); }
  });
}

// ---------- quick-add bar ----------
function quickBar() {
  return `<div class="quickbar">
    <input id="quickIn" aria-label="Quick add a task" placeholder="Quick add… e.g. Draft Q3 deck ! ~ 2h #Q3 tomorrow">
    <button class="ghost" data-action="quickAdd" aria-label="Add task">＋</button>
  </div>
  <div class="quickhint muted small">! important · * urgent · ~ deep · #project · @work · 30m/2h · today/tomorrow/later</div>`;
}

// ---------- TODAY ----------
function viewToday() {
  const st = S();
  if (store.needsSeed()) return emptyStateCard();
  const today = store.todayStr();
  // Read the day's frog for display only — persistence happens in startDay()/on
  // delete, never during render. If the stored frog was deleted, fall back to the
  // suggestion just for this paint (startDay persists it on the next load/delete).
  let frogId = store.getFrogId(today);
  let frog = frogId ? st.tasks.find((t) => t.id === frogId) : null;
  if (!frog) { const sug = suggestFrog(st, {}); frog = sug.task || null; frogId = frog ? frog.id : null; }

  const budget = st.settings.dailyBudgetMins;
  const plan = st.dailyPlan[today] || {};
  const r = buildDailyList(st, { budgetMins: budget, pinnedIds: plan.mustDoIds || [], frogId });
  const deepDone = st.pomos.filter((p) => p.date === today).reduce((a, p) => a + (p.mins || 0), 0);
  const deepTarget = st.settings.deepTargetMins || 120;

  const frogHtml = frog ? `<div class="frog ${frog.status === 'done' ? 'done' : ''}">
      <button class="chk" data-action="toggle" data-id="${frog.id}" aria-label="${frog.status === 'done' ? 'Mark frog not done' : 'Mark frog done'}">${frog.status === 'done' ? '✅' : '⬜'}</button>
      <div class="fbody"><div class="flabel">🐸 Eat the frog — your one big win today</div>
        <div class="ftitle">${esc(frog.title)}</div></div>
      <div class="frogbtns"><button class="ghost small" data-action="focus" data-id="${frog.id}">▶ Focus</button>
        <button class="ghost small" data-action="pickFrog" aria-label="Swap the frog">swap</button></div>
    </div>` : '';

  const mustDoHtml = r.mustDo.filter((i) => i.task.id !== frogId).map((i) => taskRow(i.task, { showEffort: true, focus: true })).join('')
    || `<p class="muted">Nothing else queued — capture a task above.</p>`;
  const sugHtml = r.suggestions.map((i) => taskRow(i.task, { compact: true, focus: true })).join('');

  return `${quickBar()}
    <section class="card hero">
      <div class="row between">
        <div><strong>Today's focus</strong><div class="muted small">Top ${r.mustDo.length} · ~${r.plannedMins} of ${budget} min</div></div>
        <label class="budget">Budget
          <select id="budgetSel" data-action="setBudget" aria-label="Daily focus budget">${[30, 60, 90, 120, 180, 240, 360].map((m) => `<option value="${m}" ${m === budget ? 'selected' : ''}>${m}m</option>`).join('')}</select>
        </label>
      </div>
      <div class="deepbar"><div class="row between small"><span>🧠 Deep work today</span><span>${deepDone} / ${deepTarget} min</span></div>
        <div class="bar"><span style="width:${Math.min(100, Math.round(deepDone / deepTarget * 100))}%"></span></div></div>
      ${r.flagged.length ? `<div class="nudge">⚡ ${r.flagged.length} big task${r.flagged.length > 1 ? 's' : ''} need a next action — break ${r.flagged.length > 1 ? 'them' : 'it'} down.</div>` : ''}
    </section>
    ${frogHtml}
    <h3 class="sech">Must-do</h3>
    <div class="list">${mustDoHtml}</div>
    ${sugHtml ? `<h3 class="sech">If you have more time</h3><div class="list">${sugHtml}</div>` : ''}
    <p class="tip">💡 Tempted to scroll? Hit ▶ Focus on the frog and start a 25-minute timer.</p>`;
}

function emptyStateCard() {
  return `<section class="card"><h2>Welcome 👋</h2>
    <p>This device has no data yet. Import your seed once to load your goals and tasks — it stays private.</p>
    <p><button class="primary" data-nav="settings">Go to Setup → Import</button></p></section>`;
}

// ---------- TASKS (with view switcher) ----------
function viewTasks() {
  const st = S();
  if (store.needsSeed()) return emptyStateCard();
  const seg = ['goal', 'inbox', 'buckets', 'matrix'].map((v) =>
    `<button class="segbtn ${tasksView === v ? 'on' : ''}" data-action="tasksView" data-v="${v}">${{ goal: 'By goal', inbox: 'Inbox', buckets: 'Buckets', matrix: 'Matrix' }[v]}</button>`).join('');
  let body = '';
  if (tasksView === 'goal') body = tasksByGoal(st);
  else if (tasksView === 'inbox') body = tasksInbox(st);
  else if (tasksView === 'buckets') body = tasksBuckets(st);
  else if (tasksView === 'matrix') body = tasksMatrix(st);
  return `${quickBar()}
    <div class="row between"><div class="seg">${seg}</div><button class="ghost" data-action="newTask">+ Task</button></div>
    ${body}`;
}

function tasksByGoal(st) {
  let html = '';
  for (const g of st.goals) {
    const ts = goalTasks(st, g.id);
    if (!ts.length) continue;
    const done = ts.filter((t) => t.status === 'done').length;
    html += goalGroup(esc(g.title) + ` <span class="muted small">${done}/${ts.length}</span>`, ts);
  }
  const standalone = st.tasks.filter((t) => !(t.goalIds || []).length);
  if (standalone.length) html += goalGroup('Standalone', standalone);
  return html;
}
function goalGroup(title, tasks) {
  const order = { p1: 0, p2: 1, p3: 2, p4: 3 };
  const sorted = tasks.slice().sort((a, b) => (a.status === 'done') - (b.status === 'done') || (order[a.priority] - order[b.priority]));
  return `<details class="grp" open><summary>${title}</summary><div class="list">${sorted.map((t) => taskRow(t, {})).join('')}</div></details>`;
}

function tasksInbox(st) {
  const inbox = st.tasks.filter((t) => t.bucket === 'inbox' && t.status !== 'done');
  if (!inbox.length) return `<p class="muted" style="text-align:center;margin:24px">📥 Inbox zero — nicely done. ✨</p>`;
  return `<p class="muted small">Triage: send each to a day, or open to tag a goal.</p><div class="list">${inbox.map((t) => `
    <div class="task" data-id="${t.id}">
      <button class="chk" data-action="toggle" data-id="${t.id}" aria-label="Mark done">⬜</button>
      <div class="tbody" data-action="edit" data-id="${t.id}"><div class="ttitle">${esc(t.title)}</div></div>
      <div class="triage">
        <button class="btn xs" data-action="bucket" data-id="${t.id}" data-b="today">Today</button>
        <button class="btn xs" data-action="bucket" data-id="${t.id}" data-b="tomorrow">Tmrw</button>
        <button class="btn xs ghost" data-action="bucket" data-id="${t.id}" data-b="later">Later</button>
      </div></div>`).join('')}</div>`;
}

function tasksBuckets(st) {
  return ['today', 'tomorrow', 'later', 'someday', 'inbox'].map((b) => {
    const ts = st.tasks.filter((t) => t.bucket === b && t.status !== 'done');
    if (!ts.length) return '';
    return `<details class="grp" ${b === 'today' || b === 'tomorrow' ? 'open' : ''}><summary>${BUCKET_LABEL[b]} <span class="muted small">${ts.length}</span></summary><div class="list">${ts.map((t) => taskRow(t, {})).join('')}</div></details>`;
  }).join('') || `<p class="muted">No open tasks.</p>`;
}

function tasksMatrix(st) {
  const open = st.tasks.filter((t) => t.status !== 'done');
  const quads = [
    { k: 'do', label: '🔴 Do First', f: (t) => t.important && t.urgent },
    { k: 'schedule', label: '🔵 Schedule', f: (t) => t.important && !t.urgent },
    { k: 'delegate', label: '🟡 Delegate', f: (t) => !t.important && t.urgent },
    { k: 'drop', label: '⚪ Later / Drop', f: (t) => !t.important && !t.urgent },
  ];
  return `<p class="muted small">Tap a task to set ⭐ Important / ⏰ Urgent.</p><div class="matrix">${quads.map((q) => {
    const ts = open.filter(q.f);
    return `<div class="quad"><div class="qhead">${q.label} <span class="muted small">${ts.length}</span></div>${ts.map((t) =>
      `<div class="qtask" data-action="edit" data-id="${t.id}">${t.id === store.getFrogId() ? '🐸 ' : ''}${esc(t.title)}</div>`).join('') || '<div class="muted small">—</div>'}</div>`;
  }).join('')}</div>`;
}

function taskRow(t, { showEffort = false, compact = false, focus = false } = {}) {
  const st = S();
  const goal = st.goals.find((g) => (t.goalIds || []).includes(g.id));
  const big = isBig(t, st.settings.bigTaskThreshold);
  const due = t.deadline || t.dueDate;
  const flags = `${t.important ? '<span class="chip flag">⭐</span>' : ''}${t.urgent ? '<span class="chip flag">⏰</span>' : ''}${t.depth === 'deep' ? '<span class="chip">🧠 deep</span>' : ''}${t.recur !== 'none' ? '<span class="chip">🔁</span>' : ''}`;
  return `<div class="task ${t.status === 'done' ? 'done' : ''}" data-id="${t.id}">
    <button class="chk" data-action="toggle" data-id="${t.id}" aria-label="toggle">${t.status === 'done' ? '✅' : '⬜'}</button>
    <div class="tbody" data-action="edit" data-id="${t.id}">
      <div class="ttitle">${t.ref ? `<span class="ref">${esc(t.ref)}</span> ` : ''}${esc(t.title)}</div>
      <div class="meta">
        <span class="chip">${CTX_EMOJI[t.context] || ''} ${esc(t.context)}</span>
        <span class="chip pri ${t.priority}">${PRI_LABEL[t.priority]}</span>
        ${showEffort ? `<span class="chip">⏱ ${todayEffort(t, st.settings.bigTaskThreshold)}m</span>` : ''}
        ${due ? `<span class="chip ${t.deadline ? 'hard' : ''}">${t.deadline ? '⛔' : '📅'} ${esc(due)}</span>` : ''}
        ${flags}
        ${goal ? `<span class="chip goal">${esc(goal.title.split(':')[0].split('&')[0].trim())}</span>` : ''}
      </div>
      ${t.nextAction ? `<div class="next">➡ ${esc(t.nextAction)}</div>` : ''}
      ${big && !compact ? `<button class="ghost small" data-action="decompose" data-id="${t.id}">⚡ Break it down</button>` : ''}
    </div>
    ${focus && t.status !== 'done' ? `<button class="focusbtn" data-action="focus" data-id="${t.id}" title="Focus timer" aria-label="Start focus timer">▶</button>` : ''}
  </div>`;
}

// ---------- GOALS ----------
function viewGoals() {
  const st = S();
  if (store.needsSeed()) return emptyStateCard();
  const cards = dashboard(st).map(({ goal, progress }) => `
    <div class="card goalcard">
      <div class="row between"><strong>${esc(goal.title)}</strong><span class="row" style="gap:8px;align-items:center"><span class="pct">${progress.pct}%</span><button class="iconBtn" data-action="editGoal" data-id="${goal.id}" aria-label="Edit goal">✎</button></span></div>
      <div class="bar"><span style="width:${progress.pct}%"></span></div>
      <div class="muted small">${esc(progress.label)}${progress.detail ? ' · ' + esc(progress.detail) : ''}</div>
      ${progress.spark && progress.spark.length ? sparkline(progress.spark) : ''}
    </div>`).join('') || '<p class="muted small">No goals yet — add your first one.</p>';
  return `${trackersBlock()}
    <div class="row between"><h3 class="sech" style="margin:0">Goals</h3><button class="ghost" data-action="newGoal">+ Goal</button></div>
    ${cards}${booksBlock(st)}${rollupBlock()}`;
}
// Reading-list tracker — the only path to move a 'count' goal (spec: 12 books).
function booksBlock(st) {
  if (!st.goals.some((g) => g.metric === 'count')) return '';
  const books = st.books || [];
  const icon = { unread: '⬜', reading: '📖', finished: '✅' };
  const rows = books.map((b) => `<div class="task">
      <button class="chk" data-action="cycleBook" data-id="${b.id}" aria-label="Cycle reading status">${icon[b.status] || '⬜'}</button>
      <div class="tbody"><div class="ttitle ${b.status === 'finished' ? 'done' : ''}">${esc(b.title)}${b.author ? ` <span class="muted small">— ${esc(b.author)}</span>` : ''}</div>
        <div class="meta"><span class="chip">${esc(b.status)}</span></div></div>
      <button class="x" data-action="delBook" data-id="${b.id}" aria-label="Delete book">×</button>
    </div>`).join('');
  const finished = books.filter((b) => b.status === 'finished').length;
  return `<section class="card"><h3 class="sech tight">📚 Reading list <span class="muted small">${finished} finished</span></h3>
    <div class="list">${rows || '<p class="muted small">No books yet — add one below.</p>'}</div>
    <div class="row"><input id="bookIn" aria-label="Book title" placeholder="Add a book title…"><button class="ghost" data-action="addBook" aria-label="Add book">＋ Add</button></div>
    <p class="muted small">Tap the box to cycle unread → reading → finished.</p></section>`;
}
function trackersBlock() {
  const st = S();
  const today = store.todayStr();
  const habits = st.settings.habits || [];
  const hd = st.habitsDaily[today] || {};
  const lastW = (st.weightLog[st.weightLog.length - 1] || {}).lbs;
  return `<section class="card"><h3 class="sech tight">Daily trackers</h3>
    <div class="habits">${habits.map((h) => `<button class="habit ${hd[h.id] ? 'on' : ''}" data-action="habit" data-id="${h.id}">${hd[h.id] ? '✅' : '⬜'} ${esc(h.label)}</button>`).join('') || '<span class="muted">No habits configured.</span>'}</div>
    <div class="row weight"><label>Weight today <input type="number" min="1" step="0.1" id="wIn" placeholder="${lastW != null ? lastW : 'lbs'}"></label><button class="ghost" data-action="logWeight" aria-label="Log today's weight">Log</button></div>
  </section>`;
}
function rollupBlock() {
  const r = rollup(S(), store.todayStr(), 7);
  const deep = S().pomos.filter((p) => p.date >= r.start && p.date <= r.end).reduce((a, p) => a + (p.mins || 0), 0);
  return `<section class="card"><h3 class="sech tight">Last 7 days</h3>
    <div class="stats"><div><b>${r.completedCount}</b><span>tasks done</span></div><div><b>${r.winCount}</b><span>wins</span></div><div><b>${Math.round(deep / 60)}h</b><span>deep work</span></div></div></section>`;
}
function sparkline(vals) {
  if (vals.length < 2) return '';
  const w = 220, h = 36, min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - min) / span) * (h - 4) - 2}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}"/></svg>`;
}

// ---------- REFLECT (nightly + weekly) ----------
function viewReflect() {
  const st = S();
  if (store.needsSeed()) return emptyStateCard();
  const today = store.todayStr();
  const sum = daySummary(st, today);
  const tomorrow = store.addDays(today, 1);
  const tPlan = st.dailyPlan[tomorrow] || { mustDoIds: [] };
  const tomorrowTasks = st.tasks.filter((t) => t.bucket === 'tomorrow' && t.status !== 'done');
  const cands = eligibleTasks(st, tomorrow).map((t) => ({ t, s: scoreTask(st, t, { today: tomorrow }) })).sort((a, b) => b.s - a.s).slice(0, 8);
  const winsHtml = sum.wins.map((w) => `<li>${esc(w.text)} <button class="x" data-action="delWin" data-id="${w.id}" aria-label="Delete win">×</button></li>`).join('') || '<li class="muted">No wins logged yet.</li>';
  const md = sum.mustDo;

  // weekly review surfaced when 7+ days since last (or never)
  const lastWk = st.lastWeeklyReview;
  const weekDue = !lastWk || store.addDays(lastWk, 7) <= today;

  return `
    <section class="card">
      <h3 class="sech tight">Today's wins 🏆</h3>
      <div class="muted small">${md.planned ? `Must-dos: ${md.done}/${md.planned} done.` : ''} 🔥 ${computeStreak(st)}-day streak</div>
      <ul class="wins">${winsHtml}</ul>
      <div class="row"><input id="winText" placeholder="Log a win (planned or not)…"><select id="winGoal"><option value="">— goal —</option>${st.goals.map((g) => `<option value="${g.id}">${esc(g.title.split(':')[0])}</option>`).join('')}</select><button class="ghost" data-action="addWin">Add</button></div>
      <button class="ghost small" data-action="summarize">✨ Summarize my day</button>
      <p id="daySummary" class="summary"></p>
    </section>
    <section class="card">
      <h3 class="sech tight">🧠 Brain-dump for tomorrow</h3>
      <div class="muted small">One task per line — they land in Tomorrow. You can use ! ~ #proj 30m too.</div>
      <textarea id="brainDump" class="brain" placeholder="Email Priya re: contract !\nGym ~ 45m @personal\nDraft Q3 deck ~ 2h #Q3"></textarea>
      <button class="ghost" data-action="brainAdd">＋ Add to tomorrow</button>
    </section>
    <section class="card">
      <h3 class="sech tight">🐸 Tomorrow's frog</h3>
      <div class="muted small">Pick the one task that makes ${esc(humanDate(tomorrow))} a win.</div>
      ${tomorrowTasks.length || cands.length ? `<select id="frogSel"><option value="">— auto-pick the most important —</option>${(tomorrowTasks.length ? tomorrowTasks : cands.map((c) => c.t)).map((t) => `<option value="${t.id}" ${store.getFrogId(tomorrow) === t.id ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}</select><button class="good ghost" data-action="setTomorrowFrog">Set frog</button>` : '<div class="muted small">Nothing queued for tomorrow yet.</div>'}
    </section>
    <section class="card ${weekDue ? 'due' : ''}">
      <h3 class="sech tight">📆 Weekly review ${weekDue ? '<span class="badge">due</span>' : ''}</h3>
      <div class="muted small">${weekDue ? 'Clear stale tasks and reset priorities.' : 'Done recently — ' + esc(prettyDate(lastWk)) + '.'}</div>
      ${weekDue ? weeklyReviewBody(st) : ''}
    </section>`;
}
function weeklyReviewBody(st) {
  const today = store.todayStr();
  const stale = st.tasks.filter((t) => t.status !== 'done' && (
    (t.deadline || t.dueDate) && store.addDays(t.deadline || t.dueDate, 0) < today
    || (t.bucket === 'later' && t.createdAt && t.createdAt.slice(0, 10) <= store.addDays(today, -21))));
  const list = stale.slice(0, 12).map((t) => `<div class="task"><div class="tbody"><div class="ttitle">${esc(t.title)}</div></div>
    <div class="triage"><button class="btn xs" data-action="bucket" data-id="${t.id}" data-b="today">Today</button><button class="btn xs ghost" data-action="bucket" data-id="${t.id}" data-b="someday">Someday</button></div></div>`).join('');
  return `<div class="muted small" style="margin:8px 0">${stale.length} stale / overdue task${stale.length === 1 ? '' : 's'} to triage:</div>
    <div class="list">${list || '<span class="muted small">Nothing stale — great shape. ✨</span>'}</div>
    <button class="primary" style="margin-top:12px" data-action="finishWeekly">Finish weekly review</button>`;
}

// ---------- SETTINGS ----------
function viewSettings() {
  const cfg = ai.getConfig();
  const st = S();
  const synced = isConfigured();
  const s = st.settings;
  return `
    <section class="card"><h3 class="sech tight">Sync</h3>
      ${synced ? `<div class="muted small">Signed in as <b>${esc(user ? user.email : '')}</b> · ${syncStatus === 'error' ? '<span class="syncerr">⚠️ last cloud write failed</span> — saved locally, will retry.' : 'cloud sync on ✓'}</div><button class="ghost" data-action="signout">Sign out</button>` : `<div class="muted small">Local-only mode. Use Export to back up.</div>`}
    </section>
    <section class="card"><h3 class="sech tight">Data</h3>
      <p class="muted small">Your goals & tasks are private — bootstrapped from a seed file, never in code.</p>
      <div class="row wrap"><label class="filebtn">📥 Import seed / backup<input type="file" accept="application/json,.json" id="importFile" hidden></label><button class="ghost" data-action="export">📤 Export JSON</button></div>
      <p id="ioMsg" class="muted small"></p>
    </section>
    <section class="card"><h3 class="sech tight">Daily engine & deep work</h3>
      <label>Default focus budget (min)<input type="number" min="15" step="15" id="budgetCfg" value="${s.dailyBudgetMins}"></label>
      <label>"Big task" threshold (min)<input type="number" min="5" step="5" id="bigCfg" value="${s.bigTaskThreshold}"></label>
      <label>Daily deep-work target (min)<input type="number" min="15" step="15" id="deepCfg" value="${s.deepTargetMins}"></label>
      <div class="row"><label style="flex:1">Day starts<input type="time" id="wsCfg" value="${s.workStart}"></label><label style="flex:1">Day ends<input type="time" id="weCfg" value="${s.workEnd}"></label></div>
      <div class="row"><label style="flex:1">Pomodoro (min)<input type="number" min="5" step="5" id="pomoCfg" value="${s.pomoMins}"></label><label style="flex:1">Break (min)<input type="number" min="1" id="breakCfg" value="${s.breakMins}"></label></div>
      <button class="ghost" data-action="saveEngineCfg">Save</button>
      <p id="engineMsg" class="muted small"></p>
    </section>
    <section class="card"><h3 class="sech tight">AI assist (optional)</h3>
      <p class="muted small">Task breakdown & daily suggestions. Key stays on this device.</p>
      <label>Provider<select id="aiProvider">${['anthropic', 'openai', 'gemini'].map((p) => `<option ${cfg.provider === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
      <label>Model<input id="aiModel" value="${esc(cfg.model)}"></label>
      <label>API key<input id="aiKey" type="password" value="${esc(cfg.apiKey)}" placeholder="sk-…"></label>
      <button class="ghost" data-action="saveAi">Save AI settings</button>
      <button class="ghost" data-action="testAi">🧪 Test connection</button>
      <p id="aiMsg" class="muted small">${cfg.apiKey ? '● Key saved on this device.' : ''}</p>
    </section>`;
}

// ---------- task editor (overlay) ----------
function openEditor(id) {
  const st = S();
  const t = id ? st.tasks.find((x) => x.id === id) : null;
  editing = t ? { ...t } : { id: null, title: '', notes: '', goalIds: [], projectId: null, context: 'personal', priority: 'p3', effortMins: 30, dueDate: null, deadline: null, bucket: 'today', important: false, urgent: false, depth: 'shallow', recur: 'none' };
  const e = editing;
  const tg = (on, act, val, lbl) => `<button class="tg ${on ? 'on' : ''}" data-ed="${act}" data-v="${val}">${lbl}</button>`;
  overlay().innerHTML = `<div class="scrim" data-action="closeOverlay"></div><div class="sheet">
    <div class="sheetHead"><h3>${id ? 'Edit task' : 'New task'}</h3><button class="iconBtn" data-action="closeOverlay" aria-label="Close">✕</button></div>
    <label class="fld">Task<input class="in" id="eTitle" value="${esc(e.title)}" placeholder="What needs doing?"></label>
    <label class="fld">Notes<textarea class="in" id="eNotes" placeholder="Details, links…">${esc(e.notes || '')}</textarea></label>
    <div class="fld">Priority (Eisenhower)</div><div class="toggles">${tg(e.important, 'important', '1', '⭐ Important')}${tg(e.urgent, 'urgent', '1', '⏰ Urgent')}</div>
    <div class="fld">Work type</div><div class="toggles">${tg(e.depth === 'deep', 'depth', 'deep', '🧠 Deep')}${tg(e.depth !== 'deep', 'depth', 'shallow', '⚡ Shallow')}</div>
    <div class="fld">Context</div><div class="toggles wrap">${Object.keys(CTX_EMOJI).map((c) => tg(e.context === c, 'context', c, CTX_EMOJI[c] + ' ' + c)).join('')}</div>
    <div class="fld">When</div><div class="toggles wrap">${['inbox', 'today', 'tomorrow', 'later', 'someday'].map((b) => tg(e.bucket === b, 'bucket', b, b)).join('')}</div>
    <div class="row"><label class="fld" style="flex:1">Estimate (min)<input class="in" type="number" min="1" step="5" id="eEst" value="${e.effortMins || ''}"></label><label class="fld" style="flex:1">Due (soft)<input class="in" type="date" id="eDue" value="${e.dueDate || ''}"></label></div>
    <label class="fld">Deadline (immovable)<input class="in" type="date" id="eDeadline" value="${e.deadline || ''}"></label>
    <label class="fld">Goal<select class="in" id="eGoal"><option value="">— no goal —</option>${st.goals.map((g) => `<option value="${g.id}" ${(e.goalIds || [])[0] === g.id ? 'selected' : ''}>${esc(g.title.split(':')[0])}</option>`).join('')}</select></label>
    <div class="row"><label class="fld" style="flex:1">Priority<select class="in" id="ePri">${['p1', 'p2', 'p3', 'p4'].map((p) => `<option ${e.priority === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
      <label class="fld" style="flex:1">Repeat<select class="in" id="eRecur">${['none', 'daily', 'weekly', 'monthly'].map((r) => `<option ${e.recur === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label></div>
    <div class="btnrow"><button class="primary" data-action="saveTask">${id ? 'Save' : 'Add task'}</button>${id ? `<button class="ghost" data-action="deleteTask" data-id="${id}" style="color:var(--p1)">Delete</button>` : ''}</div>
  </div>`;
  overlay().querySelectorAll('[data-ed]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.ed, v = b.dataset.v;
    if (k === 'important' || k === 'urgent') editing[k] = !editing[k];
    else editing[k] = v;
    b.classList.toggle('on');
    if (k === 'depth' || k === 'bucket' || k === 'context') { // single-select group
      b.parentElement.querySelectorAll('.tg').forEach((x) => x.classList.toggle('on', x.dataset.v === v));
    }
  }));
}
function saveTaskFromEditor() {
  const e = editing; if (!e) return;
  e.title = $('#eTitle').value.trim(); if (!e.title) { $('#eTitle').focus(); return; }
  e.notes = $('#eNotes').value;
  { const v = parseInt($('#eEst').value, 10); e.effortMins = Number.isFinite(v) && v > 0 ? v : 30; }
  e.dueDate = $('#eDue').value || null;
  e.deadline = $('#eDeadline').value || null;
  e.priority = $('#ePri').value;
  e.recur = $('#eRecur').value;
  const gid = $('#eGoal').value;
  e.goalIds = gid ? [gid] : [];
  store.upsertTask(e);
  editing = null; closeOverlay(); render();
}

// ---------- goal editor (overlay) ----------
let editingGoal = null;
const GOAL_METRICS = [
  ['taskPercent', '% of linked tasks done'], ['weight', 'Weight (lbs lost)'],
  ['count', 'Count (e.g. books read)'], ['shipped', 'Deliverables shipped'],
  ['habit', 'Habit adherence'], ['none', 'No numeric metric'],
];
function openGoalEditor(id) {
  const st = S();
  const g = id ? st.goals.find((x) => x.id === id) : null;
  editingGoal = g ? { ...g } : { id: null, title: '', metric: 'taskPercent', target: null, baseline: null, weight: 3, status: 'in_progress' };
  const e = editingGoal;
  overlay().innerHTML = `<div class="scrim" data-action="closeOverlay"></div><div class="sheet">
    <div class="sheetHead"><h3>${id ? 'Edit goal' : 'New goal'}</h3><button class="iconBtn" data-action="closeOverlay" aria-label="Close">✕</button></div>
    <label class="fld">Goal<input class="in" id="gTitle" value="${esc(e.title)}" placeholder="What do you want to achieve?"></label>
    <label class="fld">Progress metric<select class="in" id="gMetric">${GOAL_METRICS.map(([v, l]) => `<option value="${v}" ${e.metric === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <div class="row"><label class="fld" style="flex:1">Target<input class="in" type="number" id="gTarget" value="${e.target ?? ''}" placeholder="e.g. 12 or 40"></label>
      <label class="fld" style="flex:1">Baseline<input class="in" type="number" id="gBaseline" value="${e.baseline ?? ''}" placeholder="start value"></label></div>
    <label class="fld">Importance 1–5 (drives task priority)<input class="in" type="number" min="1" max="5" id="gWeight" value="${e.weight ?? 3}"></label>
    <div class="btnrow"><button class="primary" data-action="saveGoal">${id ? 'Save' : 'Add goal'}</button>${id ? `<button class="ghost" data-action="deleteGoal" data-id="${id}" style="color:var(--p1)">Delete</button>` : ''}</div>
    ${id ? '<p class="muted small">Deleting a goal keeps its tasks — they just become unlinked.</p>' : ''}
  </div>`;
}
function saveGoalFromEditor() {
  const e = editingGoal; if (!e) return;
  e.title = $('#gTitle').value.trim(); if (!e.title) { $('#gTitle').focus(); return; }
  e.metric = $('#gMetric').value;
  const tg = parseFloat($('#gTarget').value); e.target = Number.isFinite(tg) ? tg : null;
  const bl = parseFloat($('#gBaseline').value); e.baseline = Number.isFinite(bl) ? bl : null;
  const w = parseInt($('#gWeight').value, 10); e.weight = Number.isFinite(w) ? Math.max(1, Math.min(5, w)) : 3;
  store.upsertGoal(e);
  editingGoal = null; closeOverlay(); render();
}

// ---------- pomodoro (overlay) ----------
function openFocus(taskId) {
  if (pomo && pomo.timer) clearInterval(pomo.timer); // guard against a leftover timer
  const st = S();
  const t = taskId ? st.tasks.find((x) => x.id === taskId) : null;
  const mins = st.settings.pomoMins || 25;
  pomo = { taskId, remain: mins * 60, total: mins * 60, mode: 'focus', mins };
  renderFocus(t);
  pomo.timer = setInterval(tickFocus, 1000);
}
function renderFocus(t) {
  const pct = Math.round((1 - pomo.remain / pomo.total) * 100);
  overlay().innerHTML = `<div class="scrim"></div><div class="sheet focus">
    <div class="flabel2">${pomo.mode === 'focus' ? '🧠 Deep focus' : '☕ Break'}</div>
    <div class="pomoClock" id="pomoClock">${fmtClock(pomo.remain)}</div>
    <div class="ftitle2">${esc(t ? t.title : 'Focus session')}</div>
    <div class="bar big"><span id="pomoRing" style="width:${pct}%"></span></div>
    <div class="btnrow" style="margin-top:18px"><button class="primary" data-action="focusDone">✓ Done early</button><button class="ghost" data-action="focusCancel">Stop</button></div>
    <p class="muted small" style="text-align:center;margin-top:12px">${pomo.mode === 'focus' ? 'Logs ' + pomo.mins + ' deep-work minutes when the timer ends.' : 'Stretch, breathe, hydrate.'}</p>
  </div>`;
}
function tickFocus() {
  pomo.remain--;
  const c = $('#pomoClock'); if (c) c.textContent = fmtClock(pomo.remain);
  const ring = $('#pomoRing'); if (ring) ring.style.width = Math.round((1 - pomo.remain / pomo.total) * 100) + '%';
  if (pomo.remain <= 0) finishFocusPhase();
}
function finishFocusPhase() {
  clearInterval(pomo.timer);
  if (pomo.mode === 'focus') {
    store.logPomo(pomo.taskId, pomo.mins);
    const st = S();
    pomo = { taskId: pomo.taskId, mode: 'break', mins: st.settings.breakMins || 5, remain: (st.settings.breakMins || 5) * 60, total: (st.settings.breakMins || 5) * 60 };
    renderFocus(pomo.taskId ? st.tasks.find((x) => x.id === pomo.taskId) : null);
    pomo.timer = setInterval(tickFocus, 1000);
  } else { closeFocus(); }
}
function closeFocus(logIfFocus) {
  if (pomo) {
    clearInterval(pomo.timer);
    if (logIfFocus && pomo.mode === 'focus') {
      const elapsed = Math.round((pomo.total - pomo.remain) / 60);
      if (elapsed >= 1) store.logPomo(pomo.taskId, elapsed);
    }
  }
  pomo = null; closeOverlay(); render();
}
function fmtClock(sec) { sec = Math.max(0, sec); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }

// ---------- frog picker (overlay) ----------
function openFrogPicker() {
  const st = S();
  const today = store.todayStr();
  const r = buildDailyList(st, {});
  const cands = r.mustDo.concat(r.suggestions).map((i) => i.task);
  overlay().innerHTML = `<div class="scrim" data-action="closeOverlay"></div><div class="sheet">
    <div class="sheetHead"><h3>🐸 Pick today's frog</h3><button class="iconBtn" data-action="closeOverlay">✕</button></div>
    <div class="list">${cands.map((t) => `<button class="pinrow ${store.getFrogId(today) === t.id ? 'pinned' : ''}" data-action="chooseFrog" data-id="${t.id}">${store.getFrogId(today) === t.id ? '🐸' : '○'} <span>${esc(t.title)}</span></button>`).join('') || '<p class="muted">No candidates — add a task first.</p>'}</div>
  </div>`;
}

function closeOverlay() { overlay().innerHTML = ''; editing = null; editingGoal = null; }

// ---------- event wiring ----------
function wire() {
  app().querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => { view = b.dataset.nav; render(); }));
  app().addEventListener('click', onClick);
  const imp = $('#importFile'); if (imp) imp.addEventListener('change', onImport);
  const q = $('#quickIn'); if (q) q.addEventListener('keydown', (e) => { if (e.key === 'Enter') doQuickAdd(); });
  const bk = $('#bookIn'); if (bk) bk.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const t = bk.value.trim(); if (t) store.upsertBook({ title: t }); } });
}
function doQuickAdd() {
  const el = $('#quickIn'); if (!el) return;
  const v = el.value.trim(); if (!v) return;
  store.quickAdd(v);
  el.value = ''; render();
  const nq = $('#quickIn'); if (nq) nq.focus();
}

async function onClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  const st = S();
  switch (action) {
    case 'quickAdd': doQuickAdd(); break;
    case 'tasksView': tasksView = btn.dataset.v; render(); break;
    case 'newTask': openEditor(null); break;
    case 'edit': openEditor(id); break;
    case 'saveTask': saveTaskFromEditor(); break;
    case 'deleteTask': store.deleteTask(id); ensureDailyFrog(); editing = null; closeOverlay(); render(); break;
    case 'closeOverlay': closeOverlay(); break;
    case 'toggle': { const t = st.tasks.find((x) => x.id === id); if (t) (t.status === 'done' ? store.uncompleteTask(id) : store.completeTask(id)); break; }
    case 'bucket': store.setTaskBucket(id, btn.dataset.b); break;
    case 'focus': openFocus(id); break;
    case 'focusDone': closeFocus(true); break;
    case 'focusCancel': closeFocus(false); break;
    case 'pickFrog': openFrogPicker(); break;
    case 'chooseFrog': store.setFrog(id); closeOverlay(); render(); break;
    case 'newGoal': openGoalEditor(null); break;
    case 'editGoal': openGoalEditor(id); break;
    case 'saveGoal': saveGoalFromEditor(); break;
    case 'deleteGoal': store.deleteGoal(id); closeOverlay(); render(); break;
    case 'addBook': { const el = $('#bookIn'); const t = (el && el.value || '').trim(); if (t) store.upsertBook({ title: t }); break; }
    case 'cycleBook': { const b = (st.books || []).find((x) => x.id === id); if (b) { const nx = { unread: 'reading', reading: 'finished', finished: 'unread' }[b.status] || 'reading'; store.upsertBook({ id: b.id, status: nx, finishedDate: nx === 'finished' ? store.todayStr() : null }); } break; }
    case 'delBook': store.deleteBook(id); break;
    case 'habit': store.toggleHabit(id); break;
    case 'logWeight': { const v = parseFloat($('#wIn').value); if (!isNaN(v) && v > 0) store.logWeight(v); break; }
    case 'addWin': { const text = $('#winText').value.trim(); if (text) store.addWin({ text, goalId: $('#winGoal').value || null }); break; }
    case 'delWin': store.deleteWin(id); break;
    case 'brainAdd': {
      const lines = ($('#brainDump').value || '').split('\n').map((l) => l.trim()).filter(Boolean);
      for (const l of lines) { const t = store.quickAdd(l); if (t) store.setTaskBucket(t.id, 'tomorrow'); }
      render(); break;
    }
    case 'setTomorrowFrog': { const sel = $('#frogSel').value; const tomorrow = store.addDays(store.todayStr(), 1); if (sel) store.setFrog(sel, tomorrow); else { const sug = suggestFrog(st, { today: tomorrow }); if (sug.task) store.setFrog(sug.task.id, tomorrow); } render(); break; }
    case 'finishWeekly': store.getState().lastWeeklyReview = store.todayStr(); store.save(); break;
    case 'setBudget': break;
    case 'decompose': {
      const t = st.tasks.find((x) => x.id === id); if (!t) break;
      btn.textContent = '⚡ Thinking…'; btn.disabled = true;
      const out = await ai.decomposeTask(t);
      store.patchTask(id, { nextAction: out.nextAction });
      for (const subTitle of out.subtasks) store.upsertTask({ title: subTitle, parentId: id, goalIds: t.goalIds, context: t.context, priority: t.priority, effortMins: 20, bucket: 'later' });
      break;
    }
    case 'summarize': { const out = await ai.summarizeDay(daySummary(st, store.todayStr()).wins); $('#daySummary').textContent = out; break; }
    case 'export': downloadJSON(); break;
    case 'saveEngineCfg': {
      const s = st.settings;
      const posInt = (sel, def, min = 1) => { const v = parseInt($(sel).value, 10); return Number.isFinite(v) && v >= min ? v : def; };
      s.dailyBudgetMins = posInt('#budgetCfg', 120, 15);
      s.bigTaskThreshold = posInt('#bigCfg', 60, 5);
      s.deepTargetMins = posInt('#deepCfg', 120, 15);
      s.workStart = $('#wsCfg').value || '09:00';
      s.workEnd = $('#weCfg').value || '18:00';
      s.pomoMins = posInt('#pomoCfg', 25, 5);
      s.breakMins = posInt('#breakCfg', 5, 1);
      msg('#engineMsg', 'Saved ✓'); store.save(); break;
    }
    case 'saveAi': { ai.setConfig({ provider: $('#aiProvider').value, model: $('#aiModel').value.trim(), apiKey: $('#aiKey').value.trim() }); msg('#aiMsg', 'Saved ✓ — hit Test connection to verify.'); break; }
    case 'testAi': {
      ai.setConfig({ provider: $('#aiProvider').value, model: $('#aiModel').value.trim(), apiKey: $('#aiKey').value.trim() });
      msg('#aiMsg', 'Testing…'); btn.disabled = true;
      const r = await ai.testConnection();
      btn.disabled = false;
      msg('#aiMsg', r.ok ? '✅ Working — model replied.' : '❌ Failed: ' + r.error + (/40[012]/.test(r.error) ? ' (check the key / add billing credits)' : ''));
      break;
    }
    case 'signout': await signOutUser(); break;
  }
}

document.addEventListener('change', (e) => {
  const sel = e.target.closest('[data-action="setBudget"]');
  if (sel) { S().settings.dailyBudgetMins = parseInt(sel.value, 10); store.save(); }
});

async function onImport(e) {
  const file = e.target.files[0]; if (!file) return;
  try { store.importState(JSON.parse(await file.text()), { markSeed: true }); msg('#ioMsg', 'Imported ✓'); view = 'today'; render(); }
  catch (err) { msg('#ioMsg', 'Import failed: ' + err.message); }
}
function downloadJSON() {
  const blob = new Blob([store.exportJSON()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `life-planner-backup-${store.todayStr()}.json`; a.click(); URL.revokeObjectURL(a.href);
}
function msg(sel, text) { const el = $(sel); if (el) el.textContent = text; }
function humanDate(s) { return new Date(s + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }
function prettyDate(s) { if (!s) return 'never'; const t = store.todayStr(); if (s === t) return 'today'; if (s === store.addDays(t, -1)) return 'yesterday'; return new Date(s + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }

boot();
