// engine.js — the daily priority engine (spec §4.2).
// Pure functions over state; no DOM, no storage. Unit-tested in JXA.
//
// Design goals:
//   * Realistic: cap the day to a focus budget so it stays achievable.
//   * Anti-overwhelm: a top 3-5 "must-do" set, not a wall of tasks.
//   * Anti-procrastination: big tasks are represented by their *smallest next
//     action*; a big task with no next action is flagged for decomposition
//     rather than silently dominating or being deferred forever.

const PRIORITY_SCORE = { p1: 40, p2: 25, p3: 12, p4: 5 };
const MAX_MUST_DO = 5;
const MIN_MUST_DO = 3;
const NEXT_ACTION_CHUNK = 30; // mins we assume you'll spend on a big task today

// --- date math (string YYYY-MM-DD) ---
function daysUntil(dateStr, today) {
  if (!dateStr) return null;
  const a = new Date(dateStr + 'T00:00:00');
  const b = new Date((today || isoToday()) + 'T00:00:00');
  return Math.round((a - b) / 86400000);
}
function isoToday(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function isBig(task, threshold = 60) {
  return (task.effortMins || 0) > threshold && !task.nextAction;
}

// What you'll actually spend on this task *today* (anti-overwhelm capacity unit).
export function todayEffort(task, threshold = 60) {
  if ((task.effortMins || 0) > threshold) {
    return task.nextAction ? Math.min(task.effortMins, NEXT_ACTION_CHUNK) : 15; // 15m = "decompose it"
  }
  return task.effortMins || 30;
}

// Tasks that are actionable right now: not done, and all dependencies satisfied.
export function eligibleTasks(state, today) {
  today = today || isoToday();
  const byId = Object.fromEntries(state.tasks.map((t) => [t.id, t]));
  const isDone = (id) => byId[id] && byId[id].status === 'done';
  return state.tasks.filter((t) => {
    if (t.status === 'done') return false;
    if (t.parentId && !isDone(t.parentId)) { /* sub-tasks still eligible alongside parent */ }
    const deps = (t.deps || []).filter((d) => byId[d]); // ignore dangling deps
    return deps.every(isDone);
  });
}

// How many not-done tasks are blocked waiting on this one.
function unblockCount(state, taskId) {
  return state.tasks.filter((t) => t.status !== 'done' && (t.deps || []).includes(taskId)).length;
}

function goalWeight(state, task) {
  const ws = (task.goalIds || []).map((gid) => {
    const g = state.goals.find((x) => x.id === gid);
    return g ? (g.weight || 3) : 3;
  });
  return ws.length ? Math.max(...ws) : 2; // standalone tasks get a small baseline
}

function urgencyScore(task, today) {
  let s = 0;
  const dl = daysUntil(task.deadline, today); // immovable — weighs heavily
  if (dl !== null) {
    if (dl < 0) s += 70; else if (dl === 0) s += 55; else if (dl <= 2) s += 38; else if (dl <= 7) s += 22; else s += Math.max(0, 15 - dl);
  }
  const du = daysUntil(task.dueDate, today); // soft — half weight
  if (du !== null) {
    if (du < 0) s += 35; else if (du === 0) s += 28; else if (du <= 2) s += 19; else if (du <= 7) s += 11; else s += Math.max(0, 8 - du);
  }
  return s;
}

function ageScore(task, today) {
  if (!task.createdAt) return 0;
  const created = task.createdAt.slice(0, 10);
  const age = -1 * (daysUntil(created, today) || 0); // days old
  return Math.min(10, Math.max(0, age * 0.4)); // creeps up so nothing rots forever
}

export function scoreTask(state, task, opts = {}) {
  const today = opts.today || isoToday();
  const threshold = opts.bigThreshold || 60;
  let s = 0;
  s += PRIORITY_SCORE[task.priority] || 5;
  s += urgencyScore(task, today);
  s += goalWeight(state, task) * 6;             // up to 30
  s += Math.min(20, unblockCount(state, task.id) * 5); // doing blockers frees others
  s += ageScore(task, today);
  if (task.status === 'in_progress') s += 8;    // finish what you started
  // Eisenhower flags (AI-Planner), layered on top of p1-p4:
  if (task.important && task.urgent) s += 40;
  else if (task.important) s += 25;
  else if (task.urgent) s += 15;
  if (task.depth === 'deep') s += 3;            // slight tilt toward high-leverage focus work
  if (opts.frogId && task.id === opts.frogId) s += 60; // the frog always leads
  if (isBig(task, threshold)) s -= 12;          // nudge toward decomposing, not grinding
  if (task.context === 'work') s += 2;          // light tilt toward income-protecting work
  return Math.round(s);
}

// A task belongs on today's auto-filled plate unless it's still in the inbox,
// deferred to someday, or explicitly queued for tomorrow — those only appear if
// due/overdue, pinned, or the frog. 'today' and 'later' (backlog) auto-fill.
function onTodayPlate(t, today, pinned, frogId) {
  if (pinned.has(t.id) || t.bucket === 'today' || t.id === frogId) return true;
  const dl = t.deadline || t.dueDate;
  if (dl && daysUntil(dl, today) <= 0) return true;
  return !(t.bucket === 'inbox' || t.bucket === 'someday' || t.bucket === 'tomorrow');
}

// Build the day. Returns { mustDo, suggestions, parked, plannedMins, flagged, frogId }.
// opts: { today, budgetMins, bigThreshold, pinnedIds, frogId }
export function buildDailyList(state, opts = {}) {
  const today = opts.today || isoToday();
  const threshold = opts.bigThreshold ?? (state.settings && state.settings.bigThreshold) ?? 60;
  const budget = opts.budgetMins ?? (state.settings && state.settings.dailyBudgetMins) ?? 120;
  const frogId = opts.frogId ?? (state.frogByDate && state.frogByDate[today]) ?? null;
  // pinned = explicit pins + anything the user bucketed as 'today' + the frog
  const pinned = new Set(opts.pinnedIds || []);
  for (const t of state.tasks) if (t.bucket === 'today' && t.status !== 'done') pinned.add(t.id);
  if (frogId) pinned.add(frogId);

  const eligible = eligibleTasks(state, today)
    .filter((t) => onTodayPlate(t, today, pinned, frogId))
    .map((t) => ({ task: t, score: scoreTask(state, t, { today, bigThreshold: threshold, frogId }), eff: todayEffort(t, threshold) }));

  // pinned tasks (user already chose them) always sort first, then by score.
  eligible.sort((a, b) => {
    const pa = pinned.has(a.task.id) ? 1 : 0;
    const pb = pinned.has(b.task.id) ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return b.score - a.score;
  });

  const mustDo = [];
  const suggestions = [];
  const parked = [];
  let plannedMins = 0;

  for (const item of eligible) {
    const fits = plannedMins + item.eff <= budget;
    const forced = pinned.has(item.task.id);
    if ((mustDo.length < MAX_MUST_DO && (fits || mustDo.length < MIN_MUST_DO)) || forced) {
      mustDo.push(item);
      plannedMins += item.eff;
    } else if (suggestions.length < 4) {
      suggestions.push(item);
    } else {
      parked.push(item);
    }
  }

  const flagged = eligible.filter((i) => isBig(i.task, threshold)).map((i) => i.task);

  return {
    today, budget, plannedMins, frogId,
    mustDo, suggestions, parked, flagged,
  };
}

// Suggest the day's frog (Most Important Task) — the already-chosen one, else the
// highest-scored important task, else the top candidate. Pure; app persists via setFrog.
export function suggestFrog(state, opts = {}) {
  const today = opts.today || isoToday();
  const chosen = state.frogByDate && state.frogByDate[today];
  if (chosen) {
    const t = state.tasks.find((x) => x.id === chosen && x.status !== 'done');
    if (t) return { task: t, auto: false };
  }
  const r = buildDailyList(state, { today, budgetMins: opts.budgetMins });
  const cands = r.mustDo.concat(r.suggestions).map((i) => i.task);
  const pick = cands.find((t) => t.important) || cands[0] || null;
  return { task: pick, auto: true };
}

// Time-blocked day schedule (Deep Work): front-load a protected deep block up to
// the daily deep target, then interleave, inserting a break every ~90 minutes.
// Returns { slots:[{start,end,title,type,taskId?}], deepPlanned, unscheduled }.
export function planDay(state, opts = {}) {
  const today = opts.today || isoToday();
  const s = state.settings || {};
  const ws = timeToMin(s.workStart || '09:00');
  const we = timeToMin(s.workEnd || '18:00');
  const deepTarget = s.deepTargetMins || 120;
  const threshold = opts.bigThreshold ?? s.bigTaskThreshold ?? 60;
  const day = buildDailyList(state, { today, budgetMins: 24 * 60 });
  const cand = day.mustDo.concat(day.suggestions).map((i) => i.task);
  const deep = cand.filter((t) => t.depth === 'deep');
  const shallow = cand.filter((t) => t.depth !== 'deep');
  const slots = [];
  let cur = ws, deepUsed = 0, sinceBreak = 0;
  const est = (t) => todayEffort(t, threshold);
  const place = (t, type) => {
    const m = est(t);
    if (cur + m > we) return false;
    slots.push({ start: cur, end: cur + m, title: t.title, type, taskId: t.id });
    cur += m; sinceBreak += m;
    if (sinceBreak >= 90 && cur + 10 <= we) { slots.push({ start: cur, end: cur + 10, title: 'Break', type: 'break' }); cur += 10; sinceBreak = 0; }
    return true;
  };
  let di = 0, si = 0;
  while (di < deep.length && deepUsed < deepTarget && cur < we) { const t = deep[di++]; if (!place(t, 'deep')) break; deepUsed += est(t); }
  while ((di < deep.length || si < shallow.length) && cur < we) {
    const t = si < shallow.length ? shallow[si++] : deep[di++];
    if (!t || !place(t, t.depth === 'deep' ? 'deep' : 'shallow')) break;
  }
  const scheduled = slots.filter((x) => x.taskId).length;
  return { slots, deepPlanned: deepUsed, deepTarget, unscheduled: Math.max(0, cand.length - scheduled) };
}

function timeToMin(s) { const p = String(s || '09:00').split(':'); return (+p[0]) * 60 + (+p[1] || 0); }
export function minToTime(m) {
  m = Math.max(0, Math.min(1439, Math.round(m)));
  const h = Math.floor(m / 60), mm = m % 60, ap = h >= 12 ? 'PM' : 'AM', h12 = h % 12 || 12;
  return h12 + ':' + String(mm).padStart(2, '0') + ' ' + ap;
}

// Eisenhower quadrant for a task.
export function quadrant(t) {
  if (t.important && t.urgent) return { key: 'do', label: 'Do First' };
  if (t.important && !t.urgent) return { key: 'schedule', label: 'Schedule' };
  if (!t.important && t.urgent) return { key: 'delegate', label: 'Delegate' };
  return { key: 'drop', label: 'Later / Drop' };
}

// Convenience for the dashboard / nudges: big tasks anywhere that lack a next action.
export function tasksNeedingNextAction(state, threshold = 60) {
  return state.tasks.filter((t) => t.status !== 'done' && isBig(t, threshold));
}
