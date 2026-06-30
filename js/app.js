// app.js — UI router + screens. Wires store <-> firebase, renders Today / Tasks
// / Goals / Reflect / Settings.

import * as store from './store.js';
import { buildDailyList, scoreTask, eligibleTasks, isBig, todayEffort } from './engine.js';
import { computeStreak, daySummary, mustDoStatus, rollup } from './reflection.js';
import { dashboard, goalProgress, goalTasks } from './dashboard.js';
import * as ai from './ai.js';
import { initFirebase, isConfigured, onAuth, signIn, signOutUser, watchDoc, writeDoc } from './firebase.js';

const CTX_EMOJI = { work: '💼', home: '🏠', outdoor: '🌳', digital: '💻', family: '👨‍👩‍👧', personal: '🧘' };
const PRI_LABEL = { p1: 'P1', p2: 'P2', p3: 'P3', p4: 'P4' };

let view = 'today';
let user = null;
let unsubDoc = null;
let booted = false;

const $ = (s, r = document) => r.querySelector(s);
const app = () => $('#app');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const S = () => store.getState();

// ---------- boot ----------
function boot() {
  store.load();
  const cfgOk = initFirebase();
  store.subscribe(() => { if (booted) render(); });

  if (cfgOk) {
    onAuth((u) => {
      user = u;
      if (unsubDoc) { unsubDoc(); unsubDoc = null; }
      if (u) {
        store.setPushFn((synced) => writeDoc(u.uid, synced).catch((e) => console.warn('push failed', e)));
        unsubDoc = watchDoc(u.uid, (data) => {
          if (data) store.applyCloud(data);
          else store.cloudInitEmpty(); // first run, no cloud doc yet -> seed cloud from local
        });
      } else {
        store.setPushFn(null);
      }
      booted = true;
      render();
    });
  } else {
    // local-only mode: no auth gate, allow pushing to a no-op
    store.cloudInitEmpty();
    booted = true;
    render();
  }
}

// ---------- top-level render ----------
function render() {
  if (isConfigured() && !user) { renderSignIn(); return; }
  const body = {
    today: viewToday, tasks: viewTasks, goals: viewGoals, reflect: viewReflect, settings: viewSettings,
  }[view] || viewToday;
  app().innerHTML = `
    <header class="topbar">
      <div class="brand">🎯 Life Planner</div>
      <div class="sub">${esc(humanDate(store.todayStr()))} · 🔥 ${computeStreak(S())}-day streak</div>
    </header>
    <main class="screen">${body()}</main>
    <nav class="tabbar">
      ${tab('today', '📋', 'Today')}
      ${tab('tasks', '🗂️', 'Tasks')}
      ${tab('goals', '🎯', 'Goals')}
      ${tab('reflect', '🌙', 'Reflect')}
      ${tab('settings', '⚙️', 'Setup')}
    </nav>`;
  wire();
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
      <form id="signinForm" class="card">
        <label>Email<input type="email" id="email" autocomplete="username" required></label>
        <label>Password<input type="password" id="password" autocomplete="current-password" required></label>
        <button class="primary" type="submit">Sign in</button>
        <p class="err" id="signinErr"></p>
      </form>
    </div>`;
  $('#signinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await signIn($('#email').value, $('#password').value); }
    catch (err) { $('#signinErr').textContent = 'Sign-in failed: ' + (err.code || err.message); }
  });
}

// ---------- TODAY ----------
function viewToday() {
  const st = S();
  if (store.needsSeed()) return emptyStateCard();
  const budget = st.settings.dailyBudgetMins;
  const today = store.todayStr();
  const plan = st.dailyPlan[today] || {};
  const plannedPins = plan.mustDoIds || [];
  const r = buildDailyList(st, { budgetMins: budget, pinnedIds: plannedPins });

  const mustDoHtml = r.mustDo.map((i) => taskRow(i.task, { showEffort: true })).join('') || `<p class="muted">Nothing eligible — add a task or clear some dependencies.</p>`;
  const sugHtml = r.suggestions.map((i) => taskRow(i.task, { compact: true })).join('');
  const bigUndecided = r.flagged.length;

  return `
    <section class="card hero">
      <div class="row between">
        <div><strong>Today's focus</strong><div class="muted small">Top ${r.mustDo.length} · ~${r.plannedMins} of ${budget} min</div></div>
        <label class="budget">Budget
          <select data-action="setBudget">
            ${[30, 60, 90, 120, 180, 240, 360].map((m) => `<option value="${m}" ${m === budget ? 'selected' : ''}>${m}m</option>`).join('')}
          </select>
        </label>
      </div>
      ${bigUndecided ? `<div class="nudge">⚡ ${bigUndecided} big task${bigUndecided > 1 ? 's' : ''} need a next action. Break ${bigUndecided > 1 ? 'them' : 'it'} down so ${bigUndecided > 1 ? 'they' : 'it'} stop${bigUndecided > 1 ? '' : 's'} feeling huge.</div>` : ''}
    </section>
    <h3 class="sech">Must-do</h3>
    <div class="list">${mustDoHtml}</div>
    ${sugHtml ? `<h3 class="sech">If you have more time</h3><div class="list">${sugHtml}</div>` : ''}
    <p class="tip">💡 Tempted to scroll? Start a 10-minute timer on the top task instead — momentum beats motivation.</p>`;
}

function emptyStateCard() {
  return `<section class="card">
    <h2>Welcome 👋</h2>
    <p>This device has no data yet. Import your seed once to load your 10 goals and master task list — it stays private (synced to your account, never committed to code).</p>
    <p><button class="primary" data-nav="settings">Go to Setup → Import</button></p>
  </section>`;
}

// ---------- TASKS ----------
function viewTasks() {
  const st = S();
  if (store.needsSeed()) return emptyStateCard();
  const groups = st.goals.map((g) => ({ g, tasks: goalTasks(st, g.id) }));
  const standalone = st.tasks.filter((t) => !(t.goalIds || []).length);
  let html = `<div class="row between"><h3 class="sech">Master tasks</h3><button class="ghost" data-action="addTask">+ Task</button></div>`;
  for (const grp of groups) {
    if (!grp.tasks.length) continue;
    const done = grp.tasks.filter((t) => t.status === 'done').length;
    html += goalGroup(grp.g.title + ` <span class="muted small">${done}/${grp.tasks.length}</span>`, grp.tasks);
  }
  if (standalone.length) html += goalGroup('Standalone', standalone);
  return html;
}
function goalGroup(title, tasks) {
  const order = { p1: 0, p2: 1, p3: 2, p4: 3 };
  const sorted = tasks.slice().sort((a, b) => (a.status === 'done') - (b.status === 'done') || (order[a.priority] - order[b.priority]));
  return `<details class="grp" open><summary>${title}</summary><div class="list">${sorted.map((t) => taskRow(t, {})).join('')}</div></details>`;
}

function taskRow(t, { showEffort = false, compact = false } = {}) {
  const st = S();
  const goal = st.goals.find((g) => (t.goalIds || []).includes(g.id));
  const big = isBig(t, st.settings.bigTaskThreshold);
  const due = t.deadline || t.dueDate;
  return `<div class="task ${t.status === 'done' ? 'done' : ''}" data-id="${t.id}">
    <button class="chk" data-action="toggle" data-id="${t.id}" aria-label="toggle">${t.status === 'done' ? '✅' : '⬜'}</button>
    <div class="tbody">
      <div class="ttitle">${t.ref ? `<span class="ref">${esc(t.ref)}</span> ` : ''}${esc(t.title)}</div>
      <div class="meta">
        <span class="chip">${CTX_EMOJI[t.context] || ''} ${esc(t.context)}</span>
        <span class="chip pri ${t.priority}">${PRI_LABEL[t.priority]}</span>
        ${showEffort ? `<span class="chip">⏱ ${todayEffort(t, st.settings.bigTaskThreshold)}m</span>` : ''}
        ${due ? `<span class="chip ${t.deadline ? 'hard' : ''}">${t.deadline ? '⛔' : '📅'} ${esc(due)}</span>` : ''}
        ${goal ? `<span class="chip goal">${esc(goal.title.split(':')[0].split('&')[0].trim())}</span>` : ''}
      </div>
      ${t.nextAction ? `<div class="next">➡ ${esc(t.nextAction)}</div>` : ''}
      ${big && !compact ? `<button class="ghost small" data-action="decompose" data-id="${t.id}">⚡ Break it down</button>` : ''}
    </div>
  </div>`;
}

// ---------- GOALS / dashboards ----------
function viewGoals() {
  const st = S();
  if (store.needsSeed()) return emptyStateCard();
  const cards = dashboard(st).map(({ goal, progress }) => `
    <div class="card goalcard">
      <div class="row between"><strong>${esc(goal.title)}</strong><span class="pct">${progress.pct}%</span></div>
      <div class="bar"><span style="width:${progress.pct}%"></span></div>
      <div class="muted small">${esc(progress.label)}${progress.detail ? ' · ' + esc(progress.detail) : ''}</div>
      ${progress.spark && progress.spark.length ? sparkline(progress.spark) : ''}
    </div>`).join('');
  return `${trackersBlock()}<h3 class="sech">Goals</h3>${cards}${rollupBlock()}`;
}

function trackersBlock() {
  const st = S();
  const today = store.todayStr();
  const habits = st.settings.habits || [];
  const hd = st.habitsDaily[today] || {};
  const lastW = (st.weightLog[st.weightLog.length - 1] || {}).lbs;
  return `<section class="card">
    <h3 class="sech tight">Daily trackers</h3>
    <div class="habits">${habits.map((h) => `<button class="habit ${hd[h.id] ? 'on' : ''}" data-action="habit" data-id="${h.id}">${hd[h.id] ? '✅' : '⬜'} ${esc(h.label)}</button>`).join('') || '<span class="muted">No habits configured.</span>'}</div>
    <div class="row weight">
      <label>Weight today <input type="number" step="0.1" id="wIn" placeholder="${lastW != null ? lastW : 'lbs'}"></label>
      <button class="ghost" data-action="logWeight">Log</button>
    </div>
  </section>`;
}

function rollupBlock() {
  const r = rollup(S(), store.todayStr(), 7);
  return `<section class="card"><h3 class="sech tight">Last 7 days</h3>
    <div class="stats">
      <div><b>${r.completedCount}</b><span>tasks done</span></div>
      <div><b>${r.winCount}</b><span>wins</span></div>
      <div><b>${Math.round(r.totalMinutes / 60)}h</b><span>focused</span></div>
    </div></section>`;
}

function sparkline(vals) {
  if (vals.length < 2) return '';
  const w = 220, h = 36, min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - min) / span) * (h - 4) - 2}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}"/></svg>`;
}

// ---------- REFLECT ----------
function viewReflect() {
  const st = S();
  if (store.needsSeed()) return emptyStateCard();
  const today = store.todayStr();
  const sum = daySummary(st, today);
  const tomorrow = store.addDays(today, 1);
  const tPlan = st.dailyPlan[tomorrow] || { mustDoIds: [] };
  const cands = eligibleTasks(st, tomorrow)
    .map((t) => ({ t, s: scoreTask(st, t, { today: tomorrow }) }))
    .sort((a, b) => b.s - a.s).slice(0, 8);

  const winsHtml = sum.wins.map((w) => `<li>${esc(w.text)} <button class="x" data-action="delWin" data-id="${w.id}">×</button></li>`).join('') || '<li class="muted">No wins logged yet.</li>';
  const md = sum.mustDo;

  return `
    <section class="card">
      <h3 class="sech tight">Today's wins 🏆</h3>
      <div class="muted small">${md.planned ? `Must-dos: ${md.done}/${md.planned} done.` : 'No plan was set for today.'}</div>
      <ul class="wins">${winsHtml}</ul>
      <div class="row">
        <input id="winText" placeholder="Log a win (planned or not)…">
        <select id="winGoal"><option value="">— goal —</option>${st.goals.map((g) => `<option value="${g.id}">${esc(g.title.split(':')[0])}</option>`).join('')}</select>
        <button class="ghost" data-action="addWin">Add</button>
      </div>
      <button class="ghost small" data-action="summarize">✨ Summarize my day</button>
      <p id="daySummary" class="summary"></p>
    </section>
    <section class="card">
      <h3 class="sech tight">Plan tomorrow 🌅</h3>
      <div class="muted small">Tap to pin your top priorities for ${esc(humanDate(tomorrow))}.</div>
      <div class="list">${cands.map(({ t }) => {
        const pinned = (tPlan.mustDoIds || []).includes(t.id);
        return `<button class="pinrow ${pinned ? 'pinned' : ''}" data-action="pin" data-id="${t.id}">${pinned ? '📌' : '○'} <span>${esc(t.title)}</span></button>`;
      }).join('')}</div>
    </section>`;
}

// ---------- SETTINGS ----------
function viewSettings() {
  const cfg = ai.getConfig();
  const st = S();
  const synced = isConfigured();
  return `
    <section class="card">
      <h3 class="sech tight">Sync</h3>
      ${synced
        ? `<div class="muted small">Signed in as <b>${esc(user ? user.email : '')}</b> · cloud sync on.</div><button class="ghost" data-action="signout">Sign out</button>`
        : `<div class="muted small">Local-only mode (Firebase not configured). Data lives on this device; use Export to back up.</div>`}
    </section>
    <section class="card">
      <h3 class="sech tight">Data</h3>
      <p class="muted small">Your goals & tasks are private — bootstrapped from a seed file, never stored in code.</p>
      <div class="row wrap">
        <label class="filebtn">📥 Import seed / backup<input type="file" accept="application/json,.json" id="importFile" hidden></label>
        <button class="ghost" data-action="export">📤 Export JSON</button>
      </div>
      <p id="ioMsg" class="muted small"></p>
    </section>
    <section class="card">
      <h3 class="sech tight">Daily engine</h3>
      <label>Default focus budget (min)<input type="number" id="budgetCfg" value="${st.settings.dailyBudgetMins}"></label>
      <label>"Big task" threshold (min)<input type="number" id="bigCfg" value="${st.settings.bigTaskThreshold}"></label>
      <button class="ghost" data-action="saveEngineCfg">Save</button>
    </section>
    <section class="card">
      <h3 class="sech tight">AI assist (optional)</h3>
      <p class="muted small">For task breakdown & daily suggestions. Key stored only on this device. The app works fully without it.</p>
      <label>Provider<select id="aiProvider">${['anthropic', 'openai', 'gemini'].map((p) => `<option ${cfg.provider === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
      <label>Model<input id="aiModel" value="${esc(cfg.model)}"></label>
      <label>API key<input id="aiKey" type="password" value="${esc(cfg.apiKey)}" placeholder="sk-…"></label>
      <button class="ghost" data-action="saveAi">Save AI settings</button>
    </section>`;
}

// ---------- event wiring (delegation) ----------
function wire() {
  app().querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => { view = b.dataset.nav; render(); }));
  app().addEventListener('click', onClick);
  const imp = $('#importFile'); if (imp) imp.addEventListener('change', onImport);
}

async function onClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  const st = S();
  switch (action) {
    case 'toggle': {
      const t = st.tasks.find((x) => x.id === id);
      if (t) (t.status === 'done' ? store.uncompleteTask(id) : store.completeTask(id));
      break;
    }
    case 'setBudget': break; // handled by change below
    case 'habit': store.toggleHabit(id); break;
    case 'logWeight': {
      const v = parseFloat($('#wIn').value); if (!isNaN(v)) store.logWeight(v); break;
    }
    case 'addWin': {
      const text = $('#winText').value.trim(); if (!text) break;
      store.addWin({ text, goalId: $('#winGoal').value || null });
      break;
    }
    case 'delWin': store.deleteWin(id); break;
    case 'pin': {
      const tomorrow = store.addDays(store.todayStr(), 1);
      const plan = st.dailyPlan[tomorrow] || { mustDoIds: [] };
      const set = new Set(plan.mustDoIds || []);
      set.has(id) ? set.delete(id) : set.add(id);
      store.setDailyPlan(tomorrow, { mustDoIds: [...set] });
      break;
    }
    case 'decompose': {
      const t = st.tasks.find((x) => x.id === id); if (!t) break;
      btn.textContent = '⚡ Thinking…'; btn.disabled = true;
      const out = await ai.decomposeTask(t);
      store.patchTask(id, { nextAction: out.nextAction });
      // add subtasks as child tasks
      for (const subTitle of out.subtasks) store.upsertTask({ title: subTitle, parentId: id, goalIds: t.goalIds, context: t.context, priority: t.priority, effortMins: 20 });
      break;
    }
    case 'addTask': {
      const title = prompt('New task'); if (!title) break;
      store.upsertTask({ title, context: 'personal', priority: 'p3', effortMins: 30 });
      break;
    }
    case 'summarize': {
      const out = await ai.summarizeDay(daySummary(st, store.todayStr()).wins);
      $('#daySummary').textContent = out; break;
    }
    case 'export': downloadJSON(); break;
    case 'saveEngineCfg': {
      st.settings.dailyBudgetMins = parseInt($('#budgetCfg').value, 10) || 120;
      st.settings.bigTaskThreshold = parseInt($('#bigCfg').value, 10) || 60;
      store.save(); break;
    }
    case 'saveAi': {
      ai.setConfig({ provider: $('#aiProvider').value, model: $('#aiModel').value.trim(), apiKey: $('#aiKey').value.trim() });
      msg('#ioMsg', 'AI settings saved.'); break;
    }
    case 'signout': await signOutUser(); break;
  }
}

// budget select uses change, not click
document.addEventListener('change', (e) => {
  const sel = e.target.closest('[data-action="setBudget"]');
  if (sel) { S().settings.dailyBudgetMins = parseInt(sel.value, 10); store.save(); }
});

async function onImport(e) {
  const file = e.target.files[0]; if (!file) return;
  try {
    const obj = JSON.parse(await file.text());
    store.importState(obj, { markSeed: true });
    msg('#ioMsg', 'Imported ✓');
    view = 'today'; render();
  } catch (err) { msg('#ioMsg', 'Import failed: ' + err.message); }
}

function downloadJSON() {
  const blob = new Blob([store.exportJSON()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `life-planner-backup-${store.todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function msg(sel, text) { const el = $(sel); if (el) el.textContent = text; }
function humanDate(s) {
  return new Date(s + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

boot();
