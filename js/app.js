// app.js — UI router + screens. Wires store <-> firebase, renders Today / Tasks
// / Goals / Reflect / Setup, plus the AI-Planner methodology layer (frog, quick
// capture, Pomodoro, Eisenhower matrix, inbox/buckets, reviews).

import * as store from './store.js';
import { buildDailyList, scoreTask, eligibleTasks, isBig, todayEffort, suggestFrog, planDay, quadrant, minToTime, wouldCycle, blockersOf } from './engine.js';
import { computeStreak, daySummary, mustDoStatus, rollup } from './reflection.js';
import { dashboard, goalProgress, goalTasks, weightSeries, weightStats } from './dashboard.js';
import * as ai from './ai.js';
import { initFirebase, isConfigured, onAuth, signInWithGoogle, signOutUser, watchDoc, writeDoc } from './firebase.js';
import { voiceSupported, startListening, stopListening, startDictation, stopDictation, isDictating } from './voice.js';

const PRI_LABEL = { p1: 'P1', p2: 'P2', p3: 'P3', p4: 'P4' };
const BUCKET_LABEL = { inbox: 'Inbox', today: 'Today', tomorrow: 'Tomorrow', later: 'Later', someday: 'Someday' };
const CONTEXT_LABEL = { work: 'Work', home: 'Home', outdoor: 'Outdoor', digital: 'Digital', family: 'Family', personal: 'Personal' };

// --- inline-SVG icon system (replaces the old all-emoji icons; only 🐸 and 🔥
// remain as signature emoji). Paths are minimal line/fill primitives. ---
const ICONS = {
  today:   { vb: '0 0 20 20', p: '<rect x="3" y="3" width="14" height="14" rx="3.5"/><path d="M6.5 10l2 2 4-4.5"/>' },
  tasks:   { vb: '0 0 20 20', p: '<line x1="7" y1="5" x2="16" y2="5"/><line x1="7" y1="10" x2="16" y2="10"/><line x1="7" y1="15" x2="16" y2="15"/><circle cx="3.4" cy="5" r="1.1" fill="currentColor" stroke="none"/><circle cx="3.4" cy="10" r="1.1" fill="currentColor" stroke="none"/><circle cx="3.4" cy="15" r="1.1" fill="currentColor" stroke="none"/>' },
  goals:   { vb: '0 0 20 20', p: '<circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="3.6"/><circle cx="10" cy="10" r="0.8" fill="currentColor" stroke="none"/>' },
  reflect: { vb: '0 0 20 20', p: '<path d="M14.5 10.8A6.5 6.5 0 1 1 9.2 3.5a5.2 5.2 0 0 0 5.3 7.3z"/>', f: true },
  setup:   { vb: '0 0 20 20', p: '<line x1="5" y1="4" x2="5" y2="16"/><circle cx="5" cy="7" r="2" fill="currentColor" stroke="none"/><line x1="10" y1="4" x2="10" y2="16"/><circle cx="10" cy="13" r="2" fill="currentColor" stroke="none"/><line x1="15" y1="4" x2="15" y2="16"/><circle cx="15" cy="9.5" r="2" fill="currentColor" stroke="none"/>' },
  brand:   { vb: '0 0 18 18', p: '<circle cx="9" cy="9" r="6.5"/><circle cx="9" cy="9" r="2"/>' },
  work:    { vb: '0 0 18 18', p: '<rect x="2" y="6" width="14" height="9" rx="1.5"/><path d="M6.5 6V4.5a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5V6"/><line x1="2" y1="10" x2="16" y2="10"/>' },
  home:    { vb: '0 0 18 18', p: '<path d="M3 8.5 9 3l6 5.5"/><path d="M4.5 8v6.5a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V8"/>' },
  outdoor: { vb: '0 0 18 18', p: '<circle cx="9" cy="7" r="4"/><line x1="9" y1="11" x2="9" y2="15.5"/>' },
  digital: { vb: '0 0 18 18', p: '<rect x="2.5" y="3.5" width="13" height="9" rx="1.2"/><line x1="6" y1="15.5" x2="12" y2="15.5"/><line x1="9" y1="12.5" x2="9" y2="15.5"/>' },
  family:  { vb: '0 0 18 18', p: '<circle cx="6.5" cy="7" r="2.3"/><circle cx="12" cy="8" r="2"/><path d="M2.3 15c.5-3 2.3-4.6 4.2-4.6s3.7 1.6 4.2 4.6"/><path d="M11 15c.3-2.2 1.6-3.4 3-3.4"/>' },
  personal:{ vb: '0 0 18 18', p: '<circle cx="9" cy="6" r="2.6"/><path d="M3.5 15c.7-3.6 2.9-5.6 5.5-5.6s4.8 2 5.5 5.6"/>' },
  clock:   { vb: '0 0 18 18', p: '<circle cx="9" cy="9" r="6.5"/><path d="M9 5.5V9l3 1.8"/>' },
  dueHard: { vb: '0 0 18 18', p: '<circle cx="9" cy="9" r="7"/><line x1="9" y1="5.5" x2="9" y2="9.5"/><circle cx="9" cy="12.3" r="0.9" fill="currentColor" stroke="none"/>' },
  dueSoft: { vb: '0 0 18 18', p: '<rect x="2.5" y="3.5" width="13" height="12" rx="1.8"/><line x1="2.5" y1="7.2" x2="15.5" y2="7.2"/>' },
  bolt:    { vb: '0 0 18 18', p: '<path d="M9.5 1.5 4 10.5h4l-1 6.5 6.5-9.5h-4.2l.7-6z"/>', f: true },
  star:    { vb: '0 0 20 20', p: '<path d="M10 1.5l2.35 5.1 5.55.62-4.15 3.83 1.13 5.45L10 13.7l-4.88 2.8 1.13-5.45L2.1 7.22l5.55-.62z"/>', f: true },
  urgent:  { vb: '0 0 18 18', p: '<circle cx="9" cy="9.5" r="6.5"/><path d="M9 6v3.5l2.5 1.5"/><line x1="6.5" y1="1.8" x2="4.5" y2="3.4"/><line x1="11.5" y1="1.8" x2="13.5" y2="3.4"/>' },
  clockMini:{ vb: '0 0 18 18', p: '<circle cx="9" cy="9.5" r="6.5"/><path d="M9 6v3.5l2.5 1.5"/>' },
  recur:   { vb: '0 0 18 18', p: '<path d="M4 9a5 5 0 0 1 8.5-3.5"/><path d="M14 9a5 5 0 0 1-8.5 3.5"/><path d="M12 3.3v2.4h-2.4"/><path d="M6 14.7v-2.4h2.4"/>' },
  arrow:   { vb: '0 0 18 18', p: '<path d="M3 9h11"/><path d="M10 5l4 4-4 4"/>' },
  play:    { vb: '0 0 18 18', p: '<path d="M4.5 2.8v12.4l11-6.2z"/>', f: true },
  pencil:  { vb: '0 0 18 18', p: '<path d="M11.5 2.5l4 4L6 16l-4.5 1L2.5 12.5z"/>' },
  ring:    { vb: '0 0 18 18', p: '<circle cx="9" cy="9" r="5.5"/>' },
  bookReading: { vb: '0 0 18 18', p: '<path d="M9 4.5c-1.3-1-3-1.4-5-1v10c2 -.4 3.7 0 5 1 1.3-1 3-1.4 5-1v-10c-2-.4-3.7 0-5 1z"/><line x1="9" y1="4.5" x2="9" y2="14.5"/>' },
  bookUnread:  { vb: '0 0 18 18', p: '<rect x="3" y="2.5" width="12" height="13" rx="1.5"/>' },
  mic:     { vb: '0 0 18 18', p: '<rect x="6.5" y="2" width="5" height="9" rx="2.5"/><path d="M4 8.5a5 5 0 0 0 10 0"/><line x1="9" y1="13.5" x2="9" y2="16"/><line x1="6.5" y1="16" x2="11.5" y2="16"/>' },
  ai:      { vb: '0 0 20 20', p: '<path d="M4 3.5h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-6.5L6 16.5v-3H4a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z"/><path d="M10 5.8l.85 2.05L12.9 8.7l-2.05.85L10 11.6l-.85-2.05L7.1 8.7l2.05-.85z" fill="currentColor" stroke="none"/>' },
  send:    { vb: '0 0 18 18', p: '<path d="M2.5 9L15.5 3l-3.4 12-3.3-4.6z"/><line x1="8.8" y1="10.4" x2="15.5" y2="3"/>' },
  lock:    { vb: '0 0 18 18', p: '<rect x="4" y="8" width="10" height="7.5" rx="1.5"/><path d="M6.5 8V5.5a2.5 2.5 0 0 1 5 0V8"/>' },
  moon:    { vb: '0 0 18 18', p: '<path d="M13.5 10.2A5.8 5.8 0 1 1 8.3 3.6a4.6 4.6 0 0 0 5.2 6.6z"/>', f: true },
};
function icon(name, size = 14) {
  const d = ICONS[name]; if (!d) return '';
  const a = d.f ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
  return `<svg class="ic" width="${size}" height="${size}" viewBox="${d.vb}" ${a}>${d.p}</svg>`;
}
// The circular "checked" mark used by task/frog checkboxes.
function checkMark(size = 24) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="var(--good)"/><path d="M7.5 12.3l2.8 2.8 6-6.2" stroke="var(--bg)" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
// The finished-book icon (filled green disc + dark check).
function bookFinishedIcon() {
  return `<svg class="ic" width="17" height="17" viewBox="0 0 20 20"><circle cx="10" cy="10" r="10" fill="var(--good)"/><path d="M6 10.3l2.6 2.6 5.4-5.6" stroke="var(--bg)" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
// Plain checkmark glyph (square sub-task checkbox, no disc).
function checkGlyph(size = 14) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="var(--bg)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12.5l4 4 8-9"/></svg>`;
}
// Is this task a sub-task (checklist item) of an existing task?
function isChildOf(st, t) { return !!(t.parentId && st.tasks.some((x) => x.id === t.parentId)); }
// Direct children (checklist steps) of a task.
function childrenOf(st, id) { return st.tasks.filter((c) => c.parentId === id); }
// The inline sub-task checklist for a tile. `board` adds an "add a step" input.
function subtaskChecklist(st, parent, board) {
  const kids = childrenOf(st, parent.id);
  if (!kids.length && !board) return '';
  const items = kids.map((c) => `<div class="subitem ${c.status === 'done' ? 'done' : ''}">
      <button class="subchk ${c.status === 'done' ? 'done' : ''}" data-action="toggle" data-id="${c.id}" aria-label="${c.status === 'done' ? 'Uncheck step' : 'Check step'}">${c.status === 'done' ? checkGlyph(14) : ''}</button>
      <span class="subttl">${esc(c.title)}</span>
      <button class="subx" data-action="deleteTask" data-id="${c.id}" aria-label="Delete step">×</button>
    </div>`).join('');
  const add = board ? `<div class="subadd"><input id="sub-${parent.id}" class="subinput" placeholder="Add a step…" aria-label="Add a step"><button class="subaddbtn" data-action="addSub" data-id="${parent.id}" aria-label="Add step">${icon('arrow', 12)}</button></div>` : '';
  if (!items && !add) return '';
  return `<div class="checklist">${items}${add}</div>`;
}

// One stable hue per goal (assigned by creation order; cycles a 5-hue palette).
const GOAL_HUES = ['oklch(72% 0.15 264)', 'oklch(72% 0.15 190)', 'oklch(72% 0.15 150)', 'oklch(72% 0.15 55)', 'oklch(72% 0.15 320)'];
function goalColor(st, goalId) {
  if (!goalId) return 'transparent';
  const i = (st.goals || []).findIndex((g) => g.id === goalId);
  return i >= 0 ? GOAL_HUES[i % GOAL_HUES.length] : 'transparent';
}

let view = 'today';
let tasksView = 'goal'; // goal | inbox | buckets | matrix
let user = null;
let unsubDoc = null;
let booted = false;
let editing = null; // task-editor working state
let pomo = null;    // pomodoro session
let syncStatus = 'ok'; // 'ok' | 'error' — surfaced in the header when a cloud write fails
let selectedTaskId = null; // iPad master-detail selection (not persisted)
let micTarget = null;      // which input is being dictated into: quick|title|win|brain
let micBtnEl = null;       // the active mic button element (for state class)
const WIDE_MQ = '(min-width: 960px)';
function isWide() { return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(WIDE_MQ).matches; }
const NAV = [['today', 'Today'], ['tasks', 'Tasks'], ['goals', 'Goals'], ['ai', 'AI'], ['reflect', 'Reflect'], ['setup', 'Setup']];

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
  if (typeof window !== 'undefined' && window.matchMedia) {
    const mql = window.matchMedia(WIDE_MQ);
    const onMq = () => { if (booted) render(); };
    if (mql.addEventListener) mql.addEventListener('change', onMq); else if (mql.addListener) mql.addListener(onMq);
  }
  // wake locks auto-release when the page is hidden — re-arm if still dictating
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', () => { if (!document.hidden && isDictating()) acquireWakeLock(); });
  }

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
  // a live dictation transcript lives in the textarea — never lose it to a re-render
  const dictEl = isDictating() ? $('#chatIn') : null;
  const dictVal = dictEl ? dictEl.value : null;

  const body = { today: viewToday, tasks: viewTasks, goals: viewGoals, ai: viewAssistant, reflect: viewReflect, settings: viewSettings, weight: viewWeight }[view] || viewToday;
  if (isWide()) app().innerHTML = wideShell(body);
  else app().innerHTML = `
    <header class="topbar">
      <div class="brand"><span class="brandmark">${icon('brand', 13)}</span>Life Planner</div>
      <div class="sub">${esc(humanDate(store.todayStr()))} · ${streakLabel(S())}${syncBadge()}</div>
    </header>
    <main class="screen">${body()}</main>
    <nav class="tabbar">
      ${NAV.map(([id, label]) => tab(id === 'setup' ? 'settings' : id, id, label)).join('')}
    </nav>`;
  wire();
  lastView = view;
  if (dictVal != null) { const f = $('#chatIn'); if (f) f.value = dictVal; }
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
  if (!n) return 'Fresh start — one small win counts';
  const active = (st.wins || []).some((w) => w.date === store.todayStr());
  return `🔥 ${n}-day streak${active ? '' : ' · keep it alive'}`;
}
function syncBadge() {
  if (!isConfigured() || !user) return '';
  if (syncStatus === 'error') return ' · <span class="syncerr" title="Last cloud write failed — changes are saved on this device and will retry.">⚠️ sync failed</span>';
  return '';
}
function tab(viewId, iconName, label) {
  return `<button class="tabbtn ${view === viewId ? 'active' : ''}" data-nav="${viewId}"><span class="tabic">${icon(iconName, 17)}</span>${label}</button>`;
}
// iPad frame: persistent sidebar + titled main pane (replaces the bottom tab bar).
function wideShell(body) {
  const st = S();
  const title = { today: 'Today', tasks: 'Tasks', goals: 'Goals', ai: 'AI Assistant', reflect: 'Reflect', settings: 'Setup', weight: 'Weight' }[view] || 'Today';
  const nav = NAV.map(([id, label]) => {
    const vid = id === 'setup' ? 'settings' : id;
    return `<button class="navbtn ${view === vid ? 'on' : ''}" data-nav="${vid}">${icon(id, 18)}<span>${label}</span></button>`;
  }).join('');
  return `<div class="frame">
    <aside class="sidebar">
      <div class="sbrand"><span class="brandmark">${icon('brand', 13)}</span><strong>Life Planner</strong></div>
      <div class="sbdate">${esc(humanDate(store.todayStr()))}</div>
      <div class="sbstreak">🔥 ${computeStreak(st)}-day streak</div>
      <div class="sbdiv"></div>
      ${nav}
      <div style="flex:1"></div>
      <div class="sbfoot">${isConfigured() && user ? (syncStatus === 'error' ? '⚠️ sync failed' : 'Signed in · synced ✓') : 'Local-only mode'}</div>
    </aside>
    <div class="mainpane">
      <div class="paneHead"><strong>${esc(title)}</strong></div>
      <div class="paneBody">${body()}</div>
    </div>
  </div>`;
}

// ---------- sign in ----------
function renderSignIn() {
  app().innerHTML = `
    <div class="signin">
      <h1><span class="brandmark" style="width:30px;height:30px;vertical-align:middle;margin-right:8px">${icon('brand', 17)}</span>Life Planner</h1>
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
    <input id="quickIn" aria-label="Quick add a task" placeholder="Quick add… Draft deck ! ~45m #MVP">
    ${micBtn('quick')}<button class="addbtn" data-action="quickAdd" aria-label="Add task">+</button>
  </div>
  <div class="quickhint">! important · * urgent · ~ deep · #project · @context · 30m/2h</div>`;
}
function budgetChips(budget) {
  return [60, 90, 120, 150, 180, 240].map((m) => `<button class="bchip ${m === budget ? 'on' : ''}" data-action="setBudget" data-m="${m}">${m}m</button>`).join('');
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
  const deepPct = Math.min(100, Math.round(deepDone / deepTarget * 100));

  const frogHtml = frog ? `<div class="frog ${frog.status === 'done' ? 'done' : ''}">
      <button class="chk big ${frog.status === 'done' ? 'done' : ''}" data-action="toggle" data-id="${frog.id}" aria-label="${frog.status === 'done' ? 'Mark frog not done' : 'Mark frog done'}">${frog.status === 'done' ? checkMark(30) : ''}</button>
      <div class="fbody"><div class="flabel">🐸 Eat the frog — today's one big win</div>
        <div class="ftitle">${esc(frog.title)}</div></div>
      <div class="frogbtns"><button class="focuspill" data-action="focus" data-id="${frog.id}">${icon('play', 11)}Focus</button>
        <button class="swaplink" data-action="pickFrog" aria-label="Swap the frog">Swap</button></div>
    </div>` : '';

  const mustDoHtml = r.mustDo.filter((i) => i.task.id !== frogId).map((i) => taskRow(i.task, { showEffort: true, focus: true })).join('')
    || `<p class="muted small">Nothing else queued — capture a task above.</p>`;
  const sugHtml = r.suggestions.map((i) => taskRow(i.task, { compact: true, focus: true })).join('');

  const hero = `<section class="card hero">
      <div class="row between">
        <div><div class="focustitle">Today's focus</div><div class="focussub">Top ${r.mustDo.length} · ~${r.plannedMins} of ${budget} min</div></div>
        <div class="budgetchips">${budgetChips(budget)}</div>
      </div>
      <div class="deepbar"><div class="deeprow"><span>${icon('bolt', 11)} Deep work</span><span>${deepDone} / ${deepTarget} min</span></div>
        <div class="bar"><span style="width:${deepPct}%"></span></div></div>
      ${r.flagged.length ? `<div class="nudge">${icon('bolt', 13)} ${r.flagged.length} big task${r.flagged.length > 1 ? 's' : ''} need a next action — break ${r.flagged.length > 1 ? 'them' : 'it'} down.</div>` : ''}
    </section>`;
  const mustDo = `<div class="sech">Must-do</div><div class="list">${mustDoHtml}</div>`;
  const sug = sugHtml ? `<div class="sech">If you have more time</div><div class="list">${sugHtml}</div>` : '';
  const tip = `<p class="tip">Tempted to scroll? Hit ▶ Focus on the frog and start a 25-minute timer.</p>`;

  if (isWide()) {
    return `<div class="today-grid">
      <div>${quickBar()}${hero}${frogHtml}${mustDo}</div>
      <div>${sug}${rollupBlock()}</div>
    </div>${tip}`;
  }
  return `${quickBar()}${hero}${frogHtml}${mustDo}${sug}${tip}`;
}

function emptyStateCard() {
  return `<section class="card"><h2>Welcome</h2>
    <p>This device has no data yet. Import your seed once to load your goals and tasks — it stays private.</p>
    <p><button class="primary" data-nav="settings">Go to Setup → Import</button></p></section>`;
}

// ---------- TASKS (with view switcher) ----------
function viewTasks() {
  const st = S();
  if (store.needsSeed()) return emptyStateCard();
  const wide = isWide();
  const segMeta = { goal: 'By goal', inbox: 'Inbox', buckets: 'Buckets', matrix: 'Matrix' };
  const seg = ['goal', 'inbox', 'buckets', 'matrix'].map((v) =>
    `<button class="segbtn ${tasksView === v ? 'on' : ''}" data-action="tasksView" data-v="${v}">${segMeta[v]}</button>`).join('');
  const openAction = wide ? 'selectTask' : 'edit';
  let body = '';
  if (tasksView === 'goal') body = tasksByGoal(st, openAction);
  else if (tasksView === 'inbox') body = tasksInbox(st);
  else if (tasksView === 'buckets') body = tasksBuckets(st, openAction);
  else if (tasksView === 'matrix') body = tasksMatrix(st);
  const left = `<div class="row between" style="margin-bottom:14px"><div class="seg">${seg}</div><button class="ghost" data-action="newTask">+ Task</button></div>${body}`;
  if (wide) return `<div class="tasks-md"><div>${left}</div><div>${detailPanel()}</div></div>`;
  return `${quickBar()}${left}`;
}

function tasksByGoal(st, openAction) {
  let html = '';
  for (const g of st.goals) {
    const ts = goalTasks(st, g.id).filter((t) => !isChildOf(st, t)); // sub-tasks show nested, not here
    if (!ts.length) continue;
    const done = ts.filter((t) => t.status === 'done').length;
    html += taskGroup(goalColor(st, g.id), esc(g.title.split(':')[0]), `${done}/${ts.length}`, ts, openAction);
  }
  const standalone = st.tasks.filter((t) => !(t.goalIds || []).length && !isChildOf(st, t));
  if (standalone.length) html += taskGroup('var(--muted3)', 'Standalone', '', standalone, openAction);
  return html || '<p class="muted small">No tasks yet.</p>';
}
function taskGroup(color, title, count, tasks, openAction) {
  const order = { p1: 0, p2: 1, p3: 2, p4: 3 };
  const sorted = tasks.slice().sort((a, b) => (a.status === 'done') - (b.status === 'done') || (order[a.priority] - order[b.priority]));
  return `<div class="grp"><div class="grphead">${color ? `<span class="gdot" style="background:${color}"></span>` : ''}<strong>${title}</strong>${count ? `<span class="muted small">${count}</span>` : ''}</div>
    <div class="list">${sorted.map((t) => taskRow(t, { openAction, selected: t.id === selectedTaskId, board: true })).join('')}</div></div>`;
}

function tasksInbox(st) {
  const inbox = st.tasks.filter((t) => t.bucket === 'inbox' && t.status !== 'done' && !isChildOf(st, t));
  if (!inbox.length) return `<p class="muted" style="text-align:center;margin:28px 8px">Inbox zero — nicely done.</p>`;
  return `<p class="muted small">Triage: send each to a day, or open to tag a goal.</p><div class="list">${inbox.map((t) => `
    <div class="task" data-id="${t.id}"><div class="trow">
      <button class="chk" data-action="toggle" data-id="${t.id}" aria-label="Mark done"></button>
      <div class="tbody" data-action="edit" data-id="${t.id}"><div class="ttitle">${esc(t.title)}</div></div>
      <div class="triage">
        <button class="btn xs solid" data-action="bucket" data-id="${t.id}" data-b="today">Today</button>
        <button class="btn xs" data-action="bucket" data-id="${t.id}" data-b="tomorrow">Tmrw</button>
      </div></div></div>`).join('')}</div>`;
}

function tasksBuckets(st, openAction) {
  return ['today', 'tomorrow', 'later', 'someday', 'inbox'].map((b) => {
    const ts = st.tasks.filter((t) => t.bucket === b && t.status !== 'done' && !isChildOf(st, t));
    if (!ts.length) return '';
    return taskGroup(null, BUCKET_LABEL[b], String(ts.length), ts, openAction);
  }).join('') || `<p class="muted small">No open tasks.</p>`;
}

function tasksMatrix(st) {
  const open = st.tasks.filter((t) => t.status !== 'done' && !isChildOf(st, t));
  const colors = { qdo: 'var(--danger)', qsched: 'var(--accent)', qdel: 'var(--warn)', qdrop: 'var(--muted)' };
  const quads = [
    { k: 'qdo', label: 'Do first', f: (t) => t.important && t.urgent },
    { k: 'qsched', label: 'Schedule', f: (t) => t.important && !t.urgent },
    { k: 'qdel', label: 'Delegate', f: (t) => !t.important && t.urgent },
    { k: 'qdrop', label: 'Later / drop', f: (t) => !t.important && !t.urgent },
  ];
  const open2 = isWide() ? 'selectTask' : 'edit';
  return `<p class="muted small">Tap a task to set Important / Urgent.</p><div class="matrix">${quads.map((q) => {
    const ts = open.filter(q.f);
    return `<div class="quad"><div class="qhead ${q.k}"><span class="qc" style="background:${colors[q.k]}"></span>${q.label} <span class="qn">${ts.length}</span></div>${ts.map((t) =>
      `<div class="qtask" data-action="${open2}" data-id="${t.id}">${t.id === store.getFrogId() ? '🐸 ' : ''}${esc(t.title)}</div>`).join('') || '<div class="muted small">—</div>'}</div>`;
  }).join('')}</div>`;
}

// iPad master-detail: live-editing panel for the selected task (no Save button).
function detailPanel() {
  const st = S();
  const t = selectedTaskId ? st.tasks.find((x) => x.id === selectedTaskId) : null;
  if (!t) return `<div class="detail"><div class="detail-empty">Select a task on the left to edit it here.</div></div>`;
  const goal = st.goals.find((g) => (t.goalIds || []).includes(g.id));
  const dueTxt = t.deadline ? 'Deadline ' + t.deadline : (t.dueDate ? 'Due ' + t.dueDate : 'No date');
  const sub = [goal ? esc(goal.title.split(':')[0]) : 'No goal', (t.effortMins || 0) + 'm', dueTxt].join(' · ');
  const ctxBtns = ['work', 'home', 'outdoor', 'digital', 'family', 'personal'].map((c) =>
    `<button class="tg ${t.context === c ? 'on' : ''}" data-action="detCtx" data-id="${t.id}" data-c="${c}">${icon(c, 12)}${CONTEXT_LABEL[c]}</button>`).join('');
  const bkBtns = ['inbox', 'today', 'tomorrow', 'later', 'someday'].map((b) =>
    `<button class="tg ${t.bucket === b ? 'on' : ''}" data-action="detBucket" data-id="${t.id}" data-b="${b}">${BUCKET_LABEL[b]}</button>`).join('');
  return `<div class="detail">
    <div class="dtitle">${esc(t.title)}</div>
    <div class="dsub">${sub}</div>
    <label class="fld">Priority (Eisenhower)</label>
    <div class="toggles"><button class="tg ${t.important ? 'on' : ''}" data-action="detImportant" data-id="${t.id}">${icon('star', 12)}Important</button><button class="tg ${t.urgent ? 'on' : ''}" data-action="detUrgent" data-id="${t.id}">${icon('clockMini', 12)}Urgent</button></div>
    <label class="fld">Work type</label>
    <div class="toggles"><button class="tg ${t.depth === 'deep' ? 'on good' : ''}" data-action="detDeep" data-id="${t.id}">${icon('bolt', 11)}Deep</button><button class="tg ${t.depth !== 'deep' ? 'on' : ''}" data-action="detShallow" data-id="${t.id}">${icon('ring', 11)}Shallow</button></div>
    <label class="fld">Context</label>
    <div class="toggles ctxgrid">${ctxBtns}</div>
    <label class="fld">When</label>
    <div class="toggles wrap">${bkBtns}</div>
    <label class="fld">Blocked by</label>
    ${depControls(st, t.id, t.deps || [], 'det')}
    <label class="fld">Steps</label>
    ${subtaskChecklist(st, t, true)}
    <div class="btnrow"><button class="focuspill" style="flex:1;justify-content:center" data-action="focus" data-id="${t.id}">${icon('play', 11)}Focus</button><button class="danger" data-action="deleteTask" data-id="${t.id}">Delete</button></div>
  </div>`;
}

function shortT(s, n = 22) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
// "Blocked by" chips + add-select, shared by the overlay editor (mode 'ed',
// edits the in-memory `editing` object) and the iPad detail panel (mode 'det',
// patches the store live). Candidates exclude self, sub-tasks, and anything
// that would create a circular chain.
function depControls(st, taskId, deps, mode) {
  const chips = (deps || []).map((d) => {
    const b = st.tasks.find((x) => x.id === d);
    if (!b) return '';
    return `<span class="depchip ${b.status === 'done' ? 'done' : ''}" title="${b.status === 'done' ? 'Done — no longer blocking' : 'Must finish first'}">${icon('lock', 10)}${esc(shortT(b.title))}<button class="depx" data-action="${mode}RmDep" data-id="${taskId || ''}" data-dep="${d}" aria-label="Remove blocker">×</button></span>`;
  }).join('');
  const cands = st.tasks.filter((c) =>
    c.status !== 'done' && c.id !== taskId && !isChildOf(st, c)
    && !(deps || []).includes(c.id) && !(taskId && wouldCycle(st, taskId, c.id)));
  const sel = `<select class="in depadd" id="${mode}DepAdd" data-id="${taskId || ''}"><option value="">+ Add a blocker (must finish first)…</option>${cands.map((c) => `<option value="${c.id}">${esc(shortT(c.title, 48))}</option>`).join('')}</select>`;
  return `<div class="depwrap">${chips ? `<div class="depchips">${chips}</div>` : ''}${sel}</div>`;
}

function taskRow(t, { showEffort = false, compact = false, focus = false, openAction = 'edit', selected = false, board = false } = {}) {
  const st = S();
  const gid = (t.goalIds || [])[0];
  const goal = st.goals.find((g) => g.id === gid);
  const gc = goalColor(st, gid);
  const big = isBig(t, st.settings.bigTaskThreshold);
  const eff = showEffort ? todayEffort(t, st.settings.bigTaskThreshold) : t.effortMins;
  const kids = childrenOf(st, t.id);
  const meta = [`<span class="pdot ${t.priority}" title="${PRI_LABEL[t.priority]}"></span>`];
  if (t.context) meta.push(`<span class="mi ctx" title="${esc(t.context)}">${icon(t.context)}</span>`);
  if (eff) meta.push(`<span class="mi">${icon('clock', 12)}${eff}m</span>`);
  if (t.deadline) meta.push(`<span class="mi hard">${icon('dueHard', 12)}${esc(t.deadline)}</span>`);
  else if (t.dueDate) meta.push(`<span class="mi">${icon('dueSoft', 12)}${esc(t.dueDate)}</span>`);
  if (kids.length) meta.push(`<span class="mi">${icon('tasks', 12)} ${kids.filter((c) => c.status === 'done').length}/${kids.length}</span>`);
  if (t.depth === 'deep') meta.push(`<span class="deepchip">${icon('bolt', 10)}deep</span>`);
  if (t.important) meta.push(`<span class="flagi imp" title="Important">${icon('star', 12)}</span>`);
  if (t.urgent) meta.push(`<span class="flagi urg" title="Urgent">${icon('urgent', 12)}</span>`);
  if (t.recur && t.recur !== 'none') meta.push(`<span class="flagi rec" title="Repeats">${icon('recur', 12)}</span>`);
  const blockers = blockersOf(st, t);
  if (blockers.length) meta.push(`<span class="mi blockedchip" title="Waits on: ${esc(blockers.map((b) => b.title).join(', '))}">${icon('lock', 11)}${esc(shortT(blockers[0].title, 18))}${blockers.length > 1 ? ' +' + (blockers.length - 1) : ''}</span>`);
  if (goal) meta.push(`<span class="goaltag" style="--goalc:${gc}">${esc(goal.title.split(':')[0].split('&')[0].trim())}</span>`);

  return `<div class="task ${t.status === 'done' ? 'done' : ''} ${selected ? 'sel' : ''}" data-id="${t.id}" style="--goalc:${gc}">
    <div class="trow">
      <button class="chk ${t.status === 'done' ? 'done' : ''}" data-action="toggle" data-id="${t.id}" aria-label="${t.status === 'done' ? 'Mark not done' : 'Mark done'}">${t.status === 'done' ? checkMark(24) : ''}</button>
      <div class="tbody" data-action="${openAction}" data-id="${t.id}">
        <div class="ttitle">${t.ref ? `<span class="ref">${esc(t.ref)}</span> ` : ''}${esc(t.title)}</div>
        <div class="meta">${meta.join('')}</div>
        ${t.nextAction ? `<div class="next">${icon('arrow', 11)}${esc(t.nextAction)}</div>` : ''}
        ${big && !compact ? `<button class="breakdown" data-action="decompose" data-id="${t.id}">${icon('bolt', 10)}Break it down</button>` : ''}
      </div>
      ${focus && t.status !== 'done' ? `<button class="focusbtn" data-action="focus" data-id="${t.id}" title="Focus timer" aria-label="Start focus timer">${icon('play', 12)}</button>` : ''}
    </div>
    ${subtaskChecklist(st, t, board)}
  </div>`;
}

// ---------- GOALS ----------
function viewGoals() {
  const st = S();
  if (store.needsSeed()) return emptyStateCard();
  const wide = isWide();
  const cards = dashboard(st).map(({ goal, progress }) => {
    const c = goalColor(st, goal.id);
    return `<div class="card goalcard">
      <div class="row between">
        <div class="goaltitle"><span class="gdot" style="background:${c}"></span><strong>${esc(goal.title)}</strong></div>
        <div class="row" style="gap:8px;align-items:center"><span class="pct" style="color:${c}">${progress.pct}%</span><button class="editgoal" data-action="editGoal" data-id="${goal.id}" aria-label="Edit goal">${icon('pencil', 12)}</button></div>
      </div>
      <div class="gbar"><span style="width:${progress.pct}%;background:${c}"></span></div>
      <div class="muted small">${esc(progress.label)}${progress.detail ? ' · ' + esc(progress.detail) : ''}</div>
      ${progress.spark && progress.spark.length ? sparkline(progress.spark, c) : ''}
      ${goal.metric === 'weight' ? '<button class="ghost small" data-action="openWeight">View analytics →</button>' : ''}
    </div>`;
  }).join('') || '<p class="muted small">No goals yet — add your first one.</p>';
  const head = `<div class="row between" style="margin:2px 2px 10px"><h3 class="sech" style="margin:0">Goals</h3><button class="ghost" data-action="newGoal">+ Goal</button></div>`;
  const cardsWrap = wide ? `<div class="goals-grid2">${cards}</div>` : cards;
  const books = booksBlock(st);
  const bottom = (wide && books) ? `<div class="two-col">${books}${rollupBlock()}</div>` : `${books}${rollupBlock()}`;
  return `${trackersBlock()}${head}${cardsWrap}${bottom}`;
}
// Reading-list tracker — the only path to move a 'count' goal (spec: 12 books).
function booksBlock(st) {
  if (!st.goals.some((g) => g.metric === 'count')) return '';
  const books = st.books || [];
  const rows = books.map((b) => {
    const ic = b.status === 'finished' ? bookFinishedIcon() : (b.status === 'reading' ? icon('bookReading', 17) : icon('bookUnread', 17));
    return `<div class="book">
      <button class="bookcyc ${b.status}" data-action="cycleBook" data-id="${b.id}" aria-label="Cycle reading status">${ic}</button>
      <div class="booktitle ${b.status === 'finished' ? 'finished' : ''}">${esc(b.title)}${b.author ? ` <span class="bookauthor">— ${esc(b.author)}</span>` : ''}</div>
      <button class="x" data-action="delBook" data-id="${b.id}" aria-label="Delete book">×</button>
    </div>`;
  }).join('');
  const finished = books.filter((b) => b.status === 'finished').length;
  return `<section class="card"><h3 class="sech tight" style="display:flex;justify-content:space-between">Reading list <span class="muted small" style="text-transform:none;letter-spacing:0">${finished} finished</span></h3>
    <div class="list">${rows || '<p class="muted small">No books yet — add one below.</p>'}</div>
    <div class="row" style="margin-top:10px"><input id="bookIn" aria-label="Book title" placeholder="Add a book title…"><button class="ghost" data-action="addBook" aria-label="Add book">+ Add</button></div>
    <p class="muted small" style="margin-top:8px">Tap the box to cycle unread → reading → finished.</p></section>`;
}
function trackersBlock() {
  const st = S();
  const today = store.todayStr();
  const habits = st.settings.habits || [];
  const hd = st.habitsDaily[today] || {};
  const series = weightSeries(st);
  const last = series[series.length - 1];
  return `<section class="card"><h3 class="sech tight">Daily trackers</h3>
    <div class="habits">${habits.map((h) => `<button class="habit ${hd[h.id] ? 'on' : ''}" data-action="habit" data-id="${h.id}">${esc(h.label)}</button>`).join('') || '<span class="muted small">No habits configured.</span>'}</div>
    <div class="row between" style="margin-top:14px;align-items:center">
      <div><div class="muted small">Weight · synced from Withings</div><div style="font-size:20px;font-weight:700">${last ? last.lbs + ' <span class="muted small" style="font-weight:400">lb</span>' : '—'}</div></div>
      <button class="ghost" data-action="openWeight">Analytics →</button>
    </div>
  </section>`;
}
function rollupBlock() {
  const r = rollup(S(), store.todayStr(), 7);
  const deep = S().pomos.filter((p) => p.date >= r.start && p.date <= r.end).reduce((a, p) => a + (p.mins || 0), 0);
  return `<section class="card"><h3 class="sech tight">Last 7 days</h3>
    <div class="stats"><div><b class="s-tasks">${r.completedCount}</b><span>tasks done</span></div><div><b class="s-wins">${r.winCount}</b><span>wins</span></div><div><b class="s-deep">${Math.round(deep / 60)}h</b><span>deep work</span></div></div></section>`;
}
function sparkline(vals, color = 'var(--good)') {
  if (vals.length < 2) return '';
  const w = 220, h = 34, min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - min) / span) * (h - 4) - 2}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" style="stroke:${color}"/></svg>`;
}

// ---------- WEIGHT ANALYTICS (Withings-fed, interactive) ----------
let weightUI = null; // { series, goalWeight, lo, hi, preset } — drives the interactive chart

function weightGoalTarget(st, series) {
  const goal = st.goals.find((g) => g.metric === 'weight');
  if (!goal) return { goalWeight: null, baseline: series.length ? series[0].lbs : null, toLose: null };
  const baseline = goal.baseline != null ? goal.baseline : (series.length ? series[0].lbs : null);
  const toLose = goal.target != null ? goal.target : null;
  const goalWeight = (baseline != null && toLose != null) ? Math.round((baseline - toLose) * 10) / 10 : null;
  return { goalWeight, baseline, toLose };
}
function fmtDelta(x, unit = 'lb') {
  if (x == null || Number.isNaN(x)) return '—';
  const cls = x < 0 ? 'down' : x > 0 ? 'up' : '';
  const sign = x < 0 ? '−' : x > 0 ? '+' : '';
  return `<span class="wdelta ${cls}">${sign}${Math.abs(x)} ${unit}</span>`;
}
function fullDate(s) { return new Date(s + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
function monthYear(s) { return new Date(s + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', year: 'numeric' }); }

function viewWeight() {
  const st = S();
  const series = weightSeries(st);
  const back = `<button class="ghost" data-nav="goals" aria-label="Back to Goals">← Goals</button>`;
  const head = `<div class="wxhead">${back}<h2 class="wxtitle">Weight analytics</h2></div>`;
  if (series.length < 2) return `${head}<section class="card"><p class="muted">Not enough weigh-ins yet. Your Withings scale syncs automatically — data will appear here.</p></section>`;

  const n = series.length;
  const cur = series[n - 1];
  const year = +cur.date.slice(0, 4);
  const { goalWeight, baseline, toLose } = weightGoalTarget(st, series);
  const ytd = weightStats(series, year + '-01-01', cur.date);
  const lastYr = weightStats(series, (year - 1) + '-01-01', (year - 1) + '-12-31');
  const allTime = weightStats(series, null, null);
  const r30 = weightStats(series, store.addDays(cur.date, -30), cur.date);
  const r90 = weightStats(series, store.addDays(cur.date, -90), cur.date);

  const lostTotal = baseline != null ? Math.round((baseline - cur.lbs) * 10) / 10 : null;
  const remaining = goalWeight != null ? Math.round((cur.lbs - goalWeight) * 10) / 10 : null;
  const goalPct = (toLose && lostTotal != null) ? Math.max(0, Math.min(100, Math.round((lostTotal / toLose) * 100))) : null;
  let projection = 'Keep going';
  if (remaining != null && remaining > 0.1) {
    if (r90.perWeek < -0.05) { const weeks = remaining / Math.abs(r90.perWeek); projection = '~' + monthYear(store.addDays(cur.date, Math.round(weeks * 7))); }
    else projection = 'Trend has stalled';
  } else if (remaining != null && remaining <= 0.1) projection = 'Goal reached 🎉';

  // set up the interactive chart state (preserve the user's selection across re-renders)
  const prev = weightUI;
  weightUI = { series, goalWeight, lo: 0, hi: n - 1, preset: 'all' };
  if (prev && prev.hi <= n - 1 && prev.lo <= prev.hi && prev.series && prev.series.length === n) {
    weightUI.lo = prev.lo; weightUI.hi = prev.hi; weightUI.preset = prev.preset;
  } else {
    const start = store.addDays(cur.date, -365); const lo = series.findIndex((e) => e.date >= start);
    weightUI.lo = lo < 0 ? 0 : lo; weightUI.preset = '1y';
  }

  const stat = (label, value, sub = '') => `<div class="wstat"><div class="wslabel">${label}</div><div class="wsval">${value}</div>${sub ? `<div class="wssub">${sub}</div>` : ''}</div>`;
  const stats = `<div class="wstats">
    ${stat('Current', `${cur.lbs} <span class="wunit">lb</span>`, fullDate(cur.date))}
    ${goalWeight != null ? stat('Goal', `${goalWeight} <span class="wunit">lb</span>`, remaining > 0 ? fmtDelta(-remaining, 'lb') + ' to go' : 'reached') : ''}
    ${stat('This year', ytd.count > 1 ? fmtDelta(ytd.change) : '—', ytd.count > 1 ? 'since ' + fullDate(ytd.first.date) : 'no data yet')}
    ${stat('Last year', lastYr.count > 1 ? fmtDelta(lastYr.change) : '—', lastYr.count > 1 ? (year - 1) + ' full year' : 'no data')}
    ${stat('All time', fmtDelta(allTime.change), 'since ' + fullDate(allTime.first.date))}
    ${stat('Rate (30d)', r30.count > 1 ? fmtDelta(r30.perWeek, 'lb/wk') : '—', 'lowest ' + allTime.min.lbs + ' lb')}
  </div>`;

  const goalBar = goalPct != null ? `<div class="wgoalprog"><div class="row between small"><span class="muted">${lostTotal} of ${toLose} lb lost · ${remaining > 0 ? remaining + ' lb to 165' : 'goal reached'}</span><span class="muted">ETA ${projection}</span></div><div class="gbar"><span style="width:${goalPct}%;background:var(--good)"></span></div></div>` : '';

  const presets = [['30', '30d'], ['90', '90d'], ['ytd', 'YTD'], ['365', '1y'], ['all', 'All']]
    .map(([d, l]) => `<button class="bchip ${weightUI.preset === (d === '365' ? '1y' : d) ? 'on' : ''}" data-action="wfRange" data-days="${d}">${l}</button>`).join('');

  const chartCard = `<section class="card">
    <div class="row between" style="margin-bottom:8px"><h3 class="sech tight" style="margin:0">Trend</h3><div class="budgetchips">${presets}</div></div>
    <div id="wf-chart">${drawWeightChart(series.slice(weightUI.lo, weightUI.hi + 1), goalWeight)}</div>
    <div class="wrange"><span id="wf-from">${fullDate(series[weightUI.lo].date)}</span><span id="wf-minmax" class="muted"></span><span id="wf-to">${fullDate(series[weightUI.hi].date)}</span></div>
    <div class="wsliders">
      <label class="wsl">From<input type="range" id="wf-lo" min="0" max="${n - 1}" value="${weightUI.lo}" step="1"></label>
      <label class="wsl">To<input type="range" id="wf-hi" min="0" max="${n - 1}" value="${weightUI.hi}" step="1"></label>
    </div>
    <div class="wwin"><span>In range: <b id="wf-change"></b></span><span><b id="wf-rate"></b></span></div>
  </section>`;

  return `${head}${goalBar}${stats}${chartCard}`;
}

// Pure SVG line chart of a weigh-in slice (area + goal line + trend + last dot).
function drawWeightChart(slice, goalWeight) {
  if (!slice || slice.length < 2) return `<div class="muted small" style="padding:24px;text-align:center">Not enough data in this range.</div>`;
  const W = 640, H = 220, PADX = 6, PADY = 12;
  const vals = slice.map((e) => e.lbs);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (goalWeight != null) { lo = Math.min(lo, goalWeight); hi = Math.max(hi, goalWeight); }
  const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
  const span = (hi - lo) || 1;
  const x = (i) => PADX + (i / (slice.length - 1)) * (W - 2 * PADX);
  const y = (v) => PADY + (1 - (v - lo) / span) * (H - 2 * PADY);
  const pts = slice.map((e, i) => `${x(i).toFixed(1)},${y(e.lbs).toFixed(1)}`).join(' ');
  const area = `${x(0).toFixed(1)},${H - PADY} ${pts} ${x(slice.length - 1).toFixed(1)},${H - PADY}`;
  const last = slice[slice.length - 1];
  const goalLine = goalWeight != null && goalWeight > lo && goalWeight < hi
    ? `<line x1="${PADX}" y1="${y(goalWeight).toFixed(1)}" x2="${W - PADX}" y2="${y(goalWeight).toFixed(1)}" class="wgoalline"/>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" class="wchart">
    <polygon points="${area}" class="warea"/>
    ${goalLine}
    <polyline points="${pts}" class="wline"/>
    <circle cx="${x(slice.length - 1).toFixed(1)}" cy="${y(last.lbs).toFixed(1)}" r="3.5" class="wdot"/>
  </svg>`;
}
// Redraw chart + in-range figures in place (no full app render — keeps slider focus).
function weightRedraw() {
  if (!weightUI) return;
  const slice = weightUI.series.slice(weightUI.lo, weightUI.hi + 1);
  const chart = $('#wf-chart'); if (chart) chart.innerHTML = drawWeightChart(slice, weightUI.goalWeight);
  const s = weightStats(slice);
  const set = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };
  if (s.count) {
    set('#wf-from', fullDate(s.first.date)); set('#wf-to', fullDate(s.last.date));
    set('#wf-minmax', `${s.min.lbs}–${s.max.lbs} lb`);
    set('#wf-change', fmtDelta(s.change)); set('#wf-rate', s.count > 1 ? fmtDelta(s.perWeek, 'lb/wk') : '—');
  }
}
function onWeightSlider(which, val) {
  if (!weightUI) return;
  val = parseInt(val, 10);
  if (which === 'lo') weightUI.lo = Math.min(val, weightUI.hi);
  else weightUI.hi = Math.max(val, weightUI.lo);
  const lo = $('#wf-lo'), hi = $('#wf-hi'); if (lo) lo.value = weightUI.lo; if (hi) hi.value = weightUI.hi;
  weightUI.preset = null;
  document.querySelectorAll('[data-action=wfRange]').forEach((b) => b.classList.remove('on'));
  weightRedraw();
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

  const draftNote = dictDraft() ? `<p class="muted small" style="margin:8px 0 0;color:var(--warn)">${icon('mic', 11)} A saved dictation is waiting in the chat — nothing was lost.</p>` : '';
  const debriefCard = `<section class="card debriefcard">
      <h3 class="sech tight">${icon('moon', 14)} Evening debrief</h3>
      <p class="muted small" style="margin:6px 0 10px">Talk through your day for a few minutes — I'll log the wins (planned or not), close what you finished, gently re-home what slipped, and set up tomorrow. Zero guilt, every night is a fresh start.</p>
      <button class="primary" data-action="startDebrief" style="width:100%">Start tonight's debrief</button>${draftNote}
    </section>`;
  const winsCard = `<section class="card">
      <h3 class="sech tight">Today's wins</h3>
      <div class="muted small">${md.planned ? `Must-dos: ${md.done}/${md.planned} done. ` : ''}🔥 ${computeStreak(st)}-day streak</div>
      <ul class="wins">${winsHtml}</ul>
      <div class="row"><input id="winText" placeholder="Log a win (planned or not)…">${micBtn('win')}<select id="winGoal"><option value="">— goal —</option>${st.goals.map((g) => `<option value="${g.id}">${esc(g.title.split(':')[0])}</option>`).join('')}</select><button class="ghost" data-action="addWin">Add</button></div>
      <button class="ghost small" data-action="summarize">Summarize my day</button>
      <p id="daySummary" class="summary"></p>
    </section>`;
  const brainCard = `<section class="card">
      <h3 class="sech tight">Brain-dump for tomorrow</h3>
      <div class="muted small">One task per line — they land in Tomorrow. You can use ! ~ #proj 30m too.</div>
      <textarea id="brainDump" class="brain" placeholder="Email Priya re: contract !\nGym ~ 45m @personal\nDraft Q3 deck ~ 2h #Q3"></textarea>
      <div class="row">${micBtn('brain')}<button class="ghost" data-action="brainAdd">+ Add to tomorrow</button></div>
    </section>`;
  const frogCard = `<section class="card">
      <h3 class="sech tight">🐸 Tomorrow's frog</h3>
      <div class="muted small">Pick the one task that makes ${esc(humanDate(tomorrow))} a win.</div>
      ${tomorrowTasks.length || cands.length ? `<div class="row" style="margin-top:8px"><select id="frogSel" style="flex:1"><option value="">— auto-pick the most important —</option>${(tomorrowTasks.length ? tomorrowTasks : cands.map((c) => c.t)).map((t) => `<option value="${t.id}" ${store.getFrogId(tomorrow) === t.id ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}</select><button class="ghost" data-action="setTomorrowFrog">Set frog</button></div>` : '<div class="muted small">Nothing queued for tomorrow yet.</div>'}
    </section>`;
  const weeklyCard = `<section class="card ${weekDue ? 'due' : ''}">
      <h3 class="sech tight">Weekly review ${weekDue ? '<span class="badge">due</span>' : ''}</h3>
      <div class="muted small">${weekDue ? 'Clear stale tasks and reset priorities.' : 'Done recently — ' + esc(prettyDate(lastWk)) + '.'}</div>
      ${weekDue ? weeklyReviewBody(st) : ''}
    </section>`;
  if (isWide()) return `<div class="two-col"><div>${debriefCard}${winsCard}${brainCard}</div><div>${frogCard}${weeklyCard}</div></div>`;
  return `${debriefCard}${winsCard}${brainCard}${frogCard}${weeklyCard}`;
}
// Tasks that drifted past their dates or have sat untouched in the backlog.
function staleTasks(st, today) {
  return st.tasks.filter((t) => t.status !== 'done' && !isChildOf(st, t) && (
    (t.deadline || t.dueDate) && store.addDays(t.deadline || t.dueDate, 0) < today
    || (t.bucket === 'later' && t.createdAt && t.createdAt.slice(0, 10) <= store.addDays(today, -21))));
}
function weeklyReviewBody(st) {
  const today = store.todayStr();
  const stale = staleTasks(st, today);
  const list = stale.slice(0, 12).map((t) => `<div class="task"><div class="trow"><div class="tbody"><div class="ttitle">${esc(t.title)}</div></div>
    <div class="triage"><button class="btn xs" data-action="bucket" data-id="${t.id}" data-b="today">Today</button><button class="btn xs ghost" data-action="bucket" data-id="${t.id}" data-b="someday">Someday</button></div></div></div>`).join('');
  return `<div class="muted small" style="margin:8px 0">${stale.length} task${stale.length === 1 ? ' has' : 's have'} drifted past their dates — normal life, nothing to answer for. Re-home them:</div>
    <div class="list">${list || '<span class="muted small">Nothing has drifted — great shape.</span>'}</div>
    ${stale.length ? `<button class="ghost" style="margin-top:12px;width:100%" data-action="freshStart">Fresh start: move all ${stale.length} to Later (clears old soft dates)</button>` : ''}
    <button class="primary" style="margin-top:10px" data-action="finishWeekly">Finish weekly review</button>`;
}

// ---------- SETTINGS ----------
function viewSettings() {
  const cfg = ai.getConfig();
  const st = S();
  const synced = isConfigured();
  const s = st.settings;
  const sync = `<section class="card"><h3 class="sech tight">Sync</h3>
      ${synced ? `<div class="muted small">Signed in as <b>${esc(user ? user.email : '')}</b> · ${syncStatus === 'error' ? '<span class="syncerr">⚠️ last cloud write failed</span> — saved locally, will retry.' : 'cloud sync on ✓'}</div><button class="ghost" data-action="signout" style="margin-top:10px">Sign out</button>` : `<div class="muted small">Local-only mode. Use Export to back up.</div>`}
    </section>`;
  const data = `<section class="card"><h3 class="sech tight">Data</h3>
      <p class="muted small">Your goals &amp; tasks are private — bootstrapped from a seed file, never in code.</p>
      <div class="row wrap"><label class="filebtn">Import seed / backup<input type="file" accept="application/json,.json" id="importFile" hidden></label><button class="ghost" data-action="export">Export JSON</button></div>
      <p id="ioMsg" class="muted small"></p>
    </section>`;
  const engine = `<section class="card"><h3 class="sech tight">Daily engine &amp; deep work</h3>
      <label>Default focus budget (min)<input type="number" min="15" step="15" id="budgetCfg" value="${s.dailyBudgetMins}"></label>
      <label>"Big task" threshold (min)<input type="number" min="5" step="5" id="bigCfg" value="${s.bigTaskThreshold}"></label>
      <label>Daily deep-work target (min)<input type="number" min="15" step="15" id="deepCfg" value="${s.deepTargetMins}"></label>
      <div class="row"><label style="flex:1">Day starts<input type="time" id="wsCfg" value="${s.workStart}"></label><label style="flex:1">Day ends<input type="time" id="weCfg" value="${s.workEnd}"></label></div>
      <div class="row"><label style="flex:1">Pomodoro (min)<input type="number" min="5" step="5" id="pomoCfg" value="${s.pomoMins}"></label><label style="flex:1">Break (min)<input type="number" min="1" id="breakCfg" value="${s.breakMins}"></label></div>
      <button class="primary" data-action="saveEngineCfg" style="margin-top:6px">Save</button>
      <p id="engineMsg" class="muted small"></p>
    </section>`;
  const aiCard = `<section class="card"><h3 class="sech tight">AI assist (optional)</h3>
      <p class="muted small">Powers the AI chat tab, voice capture, task breakdown &amp; daily suggestions. Key stays on this device.</p>
      <label>Provider<select id="aiProvider">${['anthropic', 'openai', 'gemini'].map((p) => `<option ${cfg.provider === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
      <label>Model<input id="aiModel" value="${esc(cfg.model)}"></label>
      <label>API key<input id="aiKey" type="password" value="${esc(cfg.apiKey)}" placeholder="sk-…"></label>
      <button class="primary" data-action="saveAi" style="margin-top:6px">Save AI settings</button>
      <button class="ghost" data-action="testAi" style="margin-top:8px">Test connection</button>
      <p id="aiMsg" class="muted small">${cfg.apiKey ? '● Key saved on this device.' : ''}</p>
    </section>`;
  if (isWide()) return `<div class="two-col"><div>${sync}${data}</div><div>${engine}${aiCard}</div></div>`;
  return `${sync}${data}${engine}${aiCard}`;
}

// ---------- AI ASSISTANT (free-form chat over the whole planner) ----------
// The model sees a snapshot of goals/tasks and proposes structured ops; nothing
// touches the store until the user taps Apply on the review card.
let chat = { msgs: [], busy: false, mode: 'chat' }; // session-only; not synced

const CHAT_EXAMPLES = [
  'Plan my day — what should I focus on?',
  'Break my frog into small steps',
  'Add: renew passports by end of July, high priority',
  'Which of my tasks aren’t linked to any goal? Fix that.',
];
const DEBRIEF_OPENER = 'Good evening — this is a no-judgment zone. However today went, we start from here.\n\nTap the mic and just talk, as long as you like — pauses are fine, I won’t cut you off. What did you actually get into today? What felt good? What got skipped? Don’t organize it.\n\nWhen you’ve said it all, just say “Claude, I’m done” (or tap the mic again) and I’ll pull out the wins — including the off-plan ones — close anything you finished, and set up tomorrow with you.';

function viewAssistant() {
  const hasKey = ai.aiEnabled();
  const keyWarn = hasKey ? '' : `<div class="nudge">The assistant needs an API key — add one in <a href="#" data-nav="settings" style="color:inherit">Setup → AI assist</a>.</div>`;
  const banner = chat.mode === 'debrief' ? `<div class="debriefbar">${icon('moon', 14)} Evening debrief — no judgment, just a reset. <button class="ghost small" data-action="endDebrief">End</button></div>` : '';
  const draft = !isDictating() && dictDraft();
  const restore = draft ? `<section class="card dictrestore">
      <h3 class="sech tight">${icon('mic', 13)} Recovered dictation</h3>
      <p class="muted small" style="margin:6px 0 4px">I saved everything you said (${agoLabel(draft.at)}) — nothing was lost:</p>
      <p class="draftpreview">“${esc(draft.text.length > 220 ? draft.text.slice(0, 220) + '…' : draft.text)}”</p>
      <div class="btnrow" style="margin-top:10px">
        <button class="primary" data-action="dictSend" style="flex:1">Send it</button>
        <button class="ghost" data-action="dictResume">Keep dictating</button>
        <button class="ghost" data-action="dictDiscard" style="color:var(--muted)">Discard</button>
      </div>
    </section>` : '';
  const intro = chat.msgs.length ? '' : `<section class="card">
      <h3 class="sech tight">${icon('ai', 15)} Your planner, on tap</h3>
      <p class="muted small" style="margin:6px 0 10px">I can see all your goals and tasks. Ask me to plan, re-prioritize, break work down, categorize, or add things — I'll propose the exact changes and you approve them with one tap.</p>
      <div class="exchips"><button class="exchip debrief" data-action="startDebrief">${icon('moon', 12)} Evening debrief — talk through my day</button>${CHAT_EXAMPLES.map((q) => `<button class="exchip" data-action="chatEx" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
    </section>`;
  const msgs = chat.msgs.map((m, i) => {
    if (m.role === 'user') return `<div class="cmsg user">${esc(m.text)}</div>`;
    const ops = (m.ops && m.ops.length) ? `<div class="opsbox">
        ${m.ops.map((o) => `<div class="opline"><span class="opic">${icon(OP_ICON[o.op] || 'arrow', 13)}</span><span>${esc(o.label)}</span></div>`).join('')}
        ${m.skipped ? `<div class="muted small" style="margin-top:6px">${m.skipped} suggestion${m.skipped === 1 ? '' : 's'} couldn't be validated and ${m.skipped === 1 ? 'was' : 'were'} dropped.</div>` : ''}
        ${m.applied ? `<div class="opsdone">✓ ${esc(m.applied)}</div>` : `<button class="primary opsapply" data-action="chatApply" data-i="${i}">Apply ${m.ops.length} change${m.ops.length === 1 ? '' : 's'}</button>`}
      </div>` : '';
    return `<div class="cmsg ai">${esc(m.text)}</div>${ops}`;
  }).join('');
  const busy = chat.busy ? `<div class="cmsg ai typing"><i></i><i></i><i></i></div>` : '';
  const clear = chat.msgs.length ? `<div style="text-align:center"><button class="ghost small" data-action="chatClear">Clear conversation</button></div>` : '';
  const ph = chat.mode === 'debrief' ? 'Tap the mic and talk about your day…' : 'Ask or tell me anything about your plan…';
  return `<div class="chatwrap">${banner}${restore}${keyWarn}${intro}${msgs}${busy}${clear}<div id="chatEnd"></div></div>
    <div class="chatbar"><textarea id="chatIn" rows="1" placeholder="${ph}" aria-label="Message the assistant"></textarea>${micBtn('chat')}<button class="addbtn" data-action="chatSend" aria-label="Send">${icon('send', 15)}</button></div>
    <div id="dictHint" class="dicthint ${isDictating() ? 'show' : ''}">${icon('mic', 11)} Listening — pauses are fine, the screen stays awake, and every word is saved as you go. Say <b>“Claude, I’m done”</b> or tap the mic again to finish.</div>`;
}
const OP_ICON = { add_task: 'tasks', add_subtask: 'arrow', update_task: 'pencil', complete_task: 'today', delete_task: 'ring', add_win: 'star', add_goal: 'goals', update_goal: 'goals', set_frog: 'play' };

function scrollChat() {
  const go = () => { const el = $('#chatEnd'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'end' }); };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go); else setTimeout(go, 0);
}
async function chatSend(text) {
  text = (text || '').trim();
  if (!text || chat.busy) return;
  const history = chat.msgs.map((m) => ({ role: m.role, text: m.text }));
  chat.msgs.push({ role: 'user', text });
  chat.busy = true;
  render(); scrollChat();
  const r = await ai.assistant(text, S(), history, store.todayStr(), chat.mode);
  chat.busy = false;
  chat.msgs.push({ role: 'assistant', text: r.reply, ops: r.ops || [], skipped: r.skipped || 0 });
  render(); scrollChat();
}
// Apply one validated op through the normal store mutators. `ctx.created` maps
// lowercased titles of tasks created earlier in this batch → their new ids, so
// deps can reference same-batch tasks by title (see normOps).
function resolveDeps(deps, forId, ctx) {
  return (deps || [])
    .map((d) => S().tasks.some((t) => t.id === d) ? d : ((ctx && ctx.created) || {})[String(d).trim().toLowerCase()])
    .filter((d) => d && d !== forId && !(forId && wouldCycle(S(), forId, d)));
}
function applyOp(o, ctx) {
  switch (o.op) {
    case 'add_task': {
      const fields = { ...o.fields };
      if (fields.deps) fields.deps = resolveDeps(fields.deps, null, ctx);
      const t = store.addTaskFields(fields, { bucket: o.fields.bucket || 'inbox' });
      if (t && ctx && ctx.created) ctx.created[t.title.trim().toLowerCase()] = t.id;
      return !!t;
    }
    case 'add_subtask': return !!store.addSubtask(o.parentId, o.title);
    case 'update_task': {
      const fields = { ...o.fields };
      if (fields.deps) fields.deps = resolveDeps(fields.deps, o.id, ctx);
      return !!store.patchTask(o.id, fields);
    }
    case 'complete_task': return !!store.completeTask(o.id);
    case 'delete_task': store.deleteTask(o.id); return true;
    case 'add_win': return !!store.addWin({ text: o.text, goalId: o.goalId || null });
    case 'add_goal': return !!store.upsertGoal({ ...o.goal });
    case 'update_goal': { const cur = S().goals.find((g) => g.id === o.id); if (!cur) return false; return !!store.upsertGoal({ ...cur, ...o.patch }); }
    case 'set_frog': store.setFrog(o.id, o.day === 'tomorrow' ? store.addDays(store.todayStr(), 1) : null); return true;
  }
  return false;
}
function applyAssistantOps(i) {
  const m = chat.msgs[i];
  if (!m || !m.ops || !m.ops.length || m.applied) return;
  let n = 0;
  const ctx = { created: {} };
  for (const o of m.ops) { try { if (applyOp(o, ctx)) n++; } catch (e) { console.warn('op failed', o, e); } }
  m.applied = `${n} of ${m.ops.length} applied`;
  ensureDailyFrog();
  render(); scrollChat();
}

// ---------- voice input (Web Speech capture → Claude structuring) ----------
const MIC_FIELD = { quick: '#quickIn', title: '#eTitle', win: '#winText', brain: '#brainDump', chat: '#chatIn' };
function micBtn(target) {
  if (!voiceSupported()) return '';
  const on = target === 'chat' ? isDictating() : micTarget === target;
  return `<button class="mic ${on ? 'listening' : ''}" data-action="mic" data-target="${target}" aria-label="Dictate with voice" title="Speak">${icon('mic', 15)}</button>`;
}
function endMic() { if (micBtnEl) micBtnEl.classList.remove('listening'); micTarget = null; micBtnEl = null; }
function toggleMic(target, btn) {
  if (target === 'chat') { toggleDictation(btn); return; }  // long-form: no auto-stop
  if (micTarget === target) { stopListening(); return; }   // tap again = stop
  if (micTarget) stopListening();
  micTarget = target; micBtnEl = btn; btn.classList.add('listening');
  const started = startListening({
    onPartial: (t) => { const f = $(MIC_FIELD[target]); if (f) f.value = t; },
    onError: (code) => { endMic(); if (/not-allowed|service-not-allowed/.test(code)) console.warn('[voice] mic permission blocked'); },
    onFinal: (t) => { onVoiceFinal(target, t); },
    onEnd: () => { endMic(); },
  });
  if (!started) endMic();
}
// ---- long-form dictation for the chat/debrief: listens through pauses,
// finishes only on tap or a spoken "Claude, I'm done". Every update is saved to
// device storage (crash/lock-proof), and a screen wake lock keeps the phone
// from sleeping mid-rant — a locked screen kills the mic AND the page.
const DICT_DRAFT_KEY = 'lifeplanner.dictDraft.v1';
function saveDictDraft(text) {
  try { localStorage.setItem(DICT_DRAFT_KEY, JSON.stringify({ text, at: Date.now(), mode: chat.mode })); } catch (e) {}
}
function dictDraft() {
  try { const d = JSON.parse(localStorage.getItem(DICT_DRAFT_KEY) || 'null'); return d && d.text && d.text.trim() ? d : null; } catch (e) { return null; }
}
function clearDictDraft() { try { localStorage.removeItem(DICT_DRAFT_KEY); } catch (e) {} }

let wakeLock = null;
async function acquireWakeLock() {
  try { if (navigator.wakeLock && navigator.wakeLock.request) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* denied/unsupported — draft persistence still protects the dump */ }
}
function releaseWakeLock() { try { if (wakeLock) wakeLock.release(); } catch (e) {} wakeLock = null; }

let dictBtnEl = null;
function setDictUI(on) {
  if (dictBtnEl) dictBtnEl.classList.toggle('listening', on);
  const h = $('#dictHint'); if (h) h.classList.toggle('show', on);
  if (!on) dictBtnEl = null;
}
function toggleDictation(btn, seedText) {
  if (isDictating()) { stopDictation(); return; }  // tap again = finish & send (onDone)
  if (micTarget) stopListening();
  dictBtnEl = btn;
  // continue from whatever is already in the box (typed prefix or recovered draft)
  const box = $('#chatIn');
  const seed = seedText !== undefined ? seedText : (box ? box.value.trim() : '');
  const started = startDictation({
    seed,
    onUpdate: (t) => {
      const f = $('#chatIn'); if (f) { f.value = t; f.scrollTop = f.scrollHeight; }
      saveDictDraft(t);
    },
    onDone: (t) => {
      setDictUI(false); releaseWakeLock(); clearDictDraft();
      const f = $('#chatIn'); if (f) f.value = '';
      if (t) chatSend(t); else render();
    },
    onError: (code, textSoFar) => {
      // keep the draft — whatever was captured is safe and offered for recovery
      setDictUI(false); releaseWakeLock();
      if (textSoFar) saveDictDraft(textSoFar);
      if (/not-allowed|service-not-allowed/.test(code)) console.warn('[voice] mic permission blocked');
      render();
      const f = $('#chatIn'); if (f && textSoFar) f.value = textSoFar;
    },
  });
  if (started) { setDictUI(true); if (seed) saveDictDraft(seed); acquireWakeLock(); }
}

async function onVoiceFinal(target, text) {
  text = (text || '').trim();
  if (!text) return;
  if (target === 'win') { const el = $('#winText'); if (el) el.value = text; return; } // dictation only
  if (target === 'chat') {                                     // dictate straight into the assistant
    const el = $('#chatIn'); if (el) el.value = '';
    chatSend(text);
    return;
  }
  if (target === 'title') {                                    // structure into the open editor
    syncEditorInputs();
    const arr = await ai.parseTasks(text, { multi: false, state: S() });
    if (editing) { if (arr && arr[0]) applyParsedToEditor(arr[0]); else editing.title = text; renderEditor(); }
    return;
  }
  const busy = $(MIC_FIELD[target]); if (busy) busy.value = '…structuring…';   // quick / brain
  const arr = await ai.parseTasks(text, { multi: true, state: S() });
  const n = createTasksFromParsed(arr, target);
  render();
  const el = $(MIC_FIELD[target]); if (el) el.value = n ? '' : text;   // nothing parsed → keep transcript
}
function toFields(p) {
  const f = { title: p.title };
  if (p.important) f.important = true;
  if (p.urgent) f.urgent = true;
  if (p.deep) f.depth = 'deep';
  if (p.effortMins) f.effortMins = p.effortMins;
  if (p.context) f.context = p.context;
  if (p.priority) f.priority = p.priority;
  if (p.project) f._projName = p.project;
  if (p.goal) { const gid = ai.resolveGoalId(S(), p.goal); if (gid) f.goalIds = [gid]; }
  return f;
}
function createTasksFromParsed(arr, target) {
  const defaultBucket = target === 'brain' ? 'tomorrow' : 'inbox';
  let n = 0;
  for (const p of (arr || [])) { if (store.addTaskFields(toFields(p), { bucket: p.bucket || defaultBucket })) n++; }
  return n;
}
function applyParsedToEditor(p) {
  if (!editing) return;
  if (p.title) editing.title = p.title;
  editing.important = !!p.important;
  editing.urgent = !!p.urgent;
  if (p.deep) editing.depth = 'deep';
  if (p.effortMins) editing.effortMins = p.effortMins;
  if (p.context) editing.context = p.context;
  if (p.priority) editing.priority = p.priority;
  if (p.bucket) editing.bucket = p.bucket;
}

// ---------- task editor (overlay) ----------
function openEditor(id) {
  const st = S();
  const t = id ? st.tasks.find((x) => x.id === id) : null;
  editing = t ? { ...t } : { id: null, title: '', notes: '', goalIds: [], projectId: null, context: 'personal', priority: 'p3', effortMins: 30, dueDate: null, deadline: null, bucket: 'today', important: false, urgent: false, depth: 'shallow', recur: 'none', deps: [] };
  renderEditor();
}
// Pull the current DOM field values back into `editing` (so a voice re-render doesn't lose typed input).
function syncEditorInputs() {
  const e = editing; if (!e) return;
  const g = (sel) => { const el = $(sel); return el ? el.value : undefined; };
  if (g('#eTitle') !== undefined) e.title = $('#eTitle').value;
  if (g('#eNotes') !== undefined) e.notes = $('#eNotes').value;
  const est = g('#eEst'); if (est !== undefined) { const v = parseInt(est, 10); if (Number.isFinite(v) && v > 0) e.effortMins = v; }
  if (g('#eDue') !== undefined) e.dueDate = $('#eDue').value || null;
  if (g('#eDeadline') !== undefined) e.deadline = $('#eDeadline').value || null;
  if (g('#ePri') !== undefined) e.priority = $('#ePri').value;
  if (g('#eRecur') !== undefined) e.recur = $('#eRecur').value;
  const gid = g('#eGoal'); if (gid !== undefined) e.goalIds = gid ? [gid] : [];
}
function renderEditor() {
  const st = S();
  const e = editing; if (!e) return;
  const id = e.id;
  const tg = (on, act, val, lbl) => `<button class="tg ${on ? 'on' : ''}" data-ed="${act}" data-v="${val}">${lbl}</button>`;
  overlay().innerHTML = `<div class="scrim" data-action="closeOverlay"></div><div class="sheet">
    <div class="sheetHead"><h3>${id ? 'Edit task' : 'New task'}</h3><button class="iconBtn" data-action="closeOverlay" aria-label="Close">✕</button></div>
    <div class="fld">Task</div><div class="microw"><input class="in" id="eTitle" value="${esc(e.title)}" placeholder="What needs doing?">${micBtn('title')}</div>
    <label class="fld">Notes<textarea class="in" id="eNotes" placeholder="Details, links…">${esc(e.notes || '')}</textarea></label>
    <div class="fld">Priority (Eisenhower)</div><div class="toggles">${tg(e.important, 'important', '1', icon('star', 12) + 'Important')}${tg(e.urgent, 'urgent', '1', icon('clockMini', 12) + 'Urgent')}</div>
    <div class="fld">Work type</div><div class="toggles">${tg(e.depth === 'deep', 'depth', 'deep', icon('bolt', 11) + 'Deep')}${tg(e.depth !== 'deep', 'depth', 'shallow', icon('ring', 11) + 'Shallow')}</div>
    <div class="fld">Context</div><div class="toggles ctxgrid">${['work', 'home', 'outdoor', 'digital', 'family', 'personal'].map((c) => tg(e.context === c, 'context', c, icon(c, 12) + CONTEXT_LABEL[c])).join('')}</div>
    <div class="fld">When</div><div class="toggles wrap">${['inbox', 'today', 'tomorrow', 'later', 'someday'].map((b) => tg(e.bucket === b, 'bucket', b, BUCKET_LABEL[b])).join('')}</div>
    <div class="row"><label class="fld" style="flex:1">Estimate (min)<input class="in" type="number" min="1" step="5" id="eEst" value="${e.effortMins || ''}"></label><label class="fld" style="flex:1">Due (soft)<input class="in" type="date" id="eDue" value="${e.dueDate || ''}"></label></div>
    <label class="fld">Deadline (immovable)<input class="in" type="date" id="eDeadline" value="${e.deadline || ''}"></label>
    <label class="fld">Goal<select class="in" id="eGoal"><option value="">— no goal —</option>${st.goals.map((g) => `<option value="${g.id}" ${(e.goalIds || [])[0] === g.id ? 'selected' : ''}>${esc(g.title.split(':')[0])}</option>`).join('')}</select></label>
    <div class="fld">Blocked by</div>
    ${depControls(st, e.id, e.deps || [], 'ed')}
    <div class="row"><label class="fld" style="flex:1">Priority<select class="in" id="ePri">${['p1', 'p2', 'p3', 'p4'].map((p) => `<option ${e.priority === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
      <label class="fld" style="flex:1">Repeat<select class="in" id="eRecur">${['none', 'daily', 'weekly', 'monthly'].map((r) => `<option ${e.recur === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label></div>
    <div class="btnrow"><button class="primary" data-action="saveTask">${id ? 'Save' : 'Add task'}</button>${id ? `<button class="ghost" data-action="deleteTask" data-id="${id}" style="color:var(--p1)">Delete</button>` : ''}</div>
  </div>`;
  const eDep = overlay().querySelector('#edDepAdd');
  if (eDep) eDep.addEventListener('change', () => {
    if (!eDep.value) return;
    syncEditorInputs(); // keep typed title/notes across the re-render
    editing.deps = [...(editing.deps || []), eDep.value];
    renderEditor();
  });
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
const POMO_CIRC = 2 * Math.PI * 66; // ring circumference (r=66)
function renderFocus(t) {
  const offset = POMO_CIRC * (pomo.remain / pomo.total);
  overlay().innerHTML = `<div class="scrim"></div><div class="sheet focus">
    <div class="flabel2">${pomo.mode === 'focus' ? 'Deep focus' : 'Break'}</div>
    <div class="pomoWrap">
      <svg width="150" height="150" viewBox="0 0 150 150">
        <circle cx="75" cy="75" r="66" fill="none" stroke="var(--bg)" stroke-width="10"></circle>
        <circle id="pomoRing" cx="75" cy="75" r="66" fill="none" stroke="var(--good)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${POMO_CIRC.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"></circle>
      </svg>
      <div class="pomoClock" id="pomoClock">${fmtClock(pomo.remain)}</div>
    </div>
    <div class="ftitle2">${esc(t ? t.title : 'Focus session')}</div>
    <div class="focusbtns"><button class="primary" data-action="focusDone">✓ Done early</button><button class="stop" data-action="focusCancel">Stop</button></div>
    <p class="muted small" style="text-align:center;margin-top:12px">${pomo.mode === 'focus' ? 'Logs ' + pomo.mins + ' deep-work minutes when the timer ends.' : 'Stretch, breathe, hydrate.'}</p>
  </div>`;
}
function tickFocus() {
  pomo.remain--;
  const c = $('#pomoClock'); if (c) c.textContent = fmtClock(pomo.remain);
  const ring = $('#pomoRing'); if (ring) ring.setAttribute('stroke-dashoffset', (POMO_CIRC * (Math.max(0, pomo.remain) / pomo.total)).toFixed(2));
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
  app().querySelectorAll('.subinput').forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const v = el.value.trim(); if (v) store.addSubtask(el.id.slice(4), v); } }));
  const ci = $('#chatIn');
  if (ci) ci.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const v = ci.value.trim(); ci.value = ''; chatSend(v); } });
  const dDep = $('#detDepAdd');
  if (dDep) dDep.addEventListener('change', () => {
    const tid = dDep.dataset.id, dep = dDep.value;
    if (!tid || !dep) return;
    const t = S().tasks.find((x) => x.id === tid);
    if (t && !wouldCycle(S(), tid, dep)) store.patchTask(tid, { deps: [...(t.deps || []), dep] });
  });
  if (view === 'ai') scrollChat();
  if (view === 'weight') {
    const lo = $('#wf-lo'); if (lo) lo.addEventListener('input', (e) => onWeightSlider('lo', e.target.value));
    const hi = $('#wf-hi'); if (hi) hi.addEventListener('input', (e) => onWeightSlider('hi', e.target.value));
    weightRedraw(); // fill the in-range figures on first paint
  }
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
    case 'deleteTask': if (selectedTaskId === id) selectedTaskId = null; store.deleteTask(id); ensureDailyFrog(); editing = null; closeOverlay(); render(); break;
    case 'selectTask': selectedTaskId = id; render(); break;
    case 'detImportant': store.toggleFlag(id, 'important'); break;
    case 'detUrgent': store.toggleFlag(id, 'urgent'); break;
    case 'detDeep': store.setDepth(id, 'deep'); break;
    case 'detShallow': store.setDepth(id, 'shallow'); break;
    case 'detCtx': store.patchTask(id, { context: btn.dataset.c }); break;
    case 'detBucket': store.setTaskBucket(id, btn.dataset.b); break;
    case 'detRmDep': { const t = st.tasks.find((x) => x.id === id); if (t) store.patchTask(id, { deps: (t.deps || []).filter((d) => d !== btn.dataset.dep) }); break; }
    case 'edRmDep': if (editing) { syncEditorInputs(); editing.deps = (editing.deps || []).filter((d) => d !== btn.dataset.dep); renderEditor(); } break;
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
    case 'addSub': { const el = $('#sub-' + id); const v = (el && el.value || '').trim(); if (v) store.addSubtask(id, v); break; }
    case 'mic': toggleMic(btn.dataset.target, btn); break;
    case 'chatSend': {
      if (isDictating()) { stopDictation(); break; }  // finishes the dump → onDone sends it
      const el = $('#chatIn'); const v = (el && el.value || '').trim(); if (el) el.value = ''; chatSend(v); break;
    }
    case 'chatEx': chatSend(btn.dataset.q); break;
    case 'chatApply': applyAssistantOps(parseInt(btn.dataset.i, 10)); break;
    case 'chatClear': chat = { msgs: [], busy: false, mode: 'chat' }; render(); break;
    case 'dictSend': {
      const d = dictDraft(); clearDictDraft();
      if (d) { if (d.mode === 'debrief') chat.mode = 'debrief'; chatSend(d.text); } else render();
      break;
    }
    case 'dictResume': {
      const d = dictDraft(); clearDictDraft();
      if (d && d.mode === 'debrief') chat.mode = 'debrief';
      render();
      const f = $('#chatIn'); if (f && d) f.value = d.text;
      const mb = $('[data-action=mic][data-target=chat]');
      if (mb) toggleDictation(mb, d ? d.text : '');
      break;
    }
    case 'dictDiscard': clearDictDraft(); render(); break;
    case 'startDebrief': {
      view = 'ai'; chat.mode = 'debrief';
      const last = chat.msgs[chat.msgs.length - 1];
      if (!last || !last.opener) chat.msgs.push({ role: 'assistant', text: DEBRIEF_OPENER, ops: [], opener: true });
      render(); scrollChat(); break;
    }
    case 'endDebrief': chat.mode = 'chat'; render(); break;
    case 'openWeight': view = 'weight'; render(); break;
    case 'wfRange': {
      if (!weightUI) break;
      const nn = weightUI.series.length, days = btn.dataset.days;
      let lo = 0;
      if (days !== 'all') {
        const today = weightUI.series[nn - 1].date;
        const startDate = days === 'ytd' ? today.slice(0, 4) + '-01-01' : store.addDays(today, -parseInt(days, 10));
        lo = weightUI.series.findIndex((e) => e.date >= startDate); if (lo < 0) lo = 0;
      }
      weightUI.lo = lo; weightUI.hi = nn - 1; weightUI.preset = days === '365' ? '1y' : days;
      const l = $('#wf-lo'), h = $('#wf-hi'); if (l) l.value = lo; if (h) h.value = nn - 1;
      document.querySelectorAll('[data-action=wfRange]').forEach((b) => b.classList.toggle('on', b.dataset.days === days));
      weightRedraw();
      break;
    }
    case 'addWin': { const text = $('#winText').value.trim(); if (text) store.addWin({ text, goalId: $('#winGoal').value || null }); break; }
    case 'delWin': store.deleteWin(id); break;
    case 'brainAdd': {
      const lines = ($('#brainDump').value || '').split('\n').map((l) => l.trim()).filter(Boolean);
      for (const l of lines) { const t = store.quickAdd(l); if (t) store.setTaskBucket(t.id, 'tomorrow'); }
      render(); break;
    }
    case 'setTomorrowFrog': { const sel = $('#frogSel').value; const tomorrow = store.addDays(store.todayStr(), 1); if (sel) store.setFrog(sel, tomorrow); else { const sug = suggestFrog(st, { today: tomorrow }); if (sug.task) store.setFrog(sug.task.id, tomorrow); } render(); break; }
    case 'finishWeekly': store.getState().lastWeeklyReview = store.todayStr(); store.save(); break;
    case 'freshStart': {
      // no-guilt bulk re-home: everything that drifted goes to Later; old SOFT
      // due-dates are cleared (immovable deadlines are kept — they're real).
      for (const t of staleTasks(st, store.todayStr())) {
        t.bucket = 'later';
        if (t.dueDate && t.dueDate < store.todayStr()) t.dueDate = null;
      }
      store.save(); render(); break;
    }
    case 'setBudget': st.settings.dailyBudgetMins = parseInt(btn.dataset.m, 10) || 120; store.save(); break;
    case 'decompose': {
      const t = st.tasks.find((x) => x.id === id); if (!t) break;
      btn.textContent = 'Thinking…'; btn.disabled = true;
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
function agoLabel(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 2) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60);
  return h < 24 ? h + 'h ago' : Math.round(h / 24) + 'd ago';
}
function prettyDate(s) { if (!s) return 'never'; const t = store.todayStr(); if (s === t) return 'today'; if (s === store.addDays(t, -1)) return 'yesterday'; return new Date(s + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }

boot();
