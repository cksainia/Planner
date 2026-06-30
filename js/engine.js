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
  if (isBig(task, threshold)) s -= 12;          // nudge toward decomposing, not grinding
  if (task.context === 'work') s += 2;          // light tilt toward income-protecting work
  return Math.round(s);
}

// Build the day. Returns { mustDo, suggestions, parked, plannedMins, flagged }.
// opts: { today, budgetMins, bigThreshold, pinnedIds }
export function buildDailyList(state, opts = {}) {
  const today = opts.today || isoToday();
  const threshold = opts.bigThreshold ?? (state.settings && state.settings.bigThreshold) ?? 60;
  const budget = opts.budgetMins ?? (state.settings && state.settings.dailyBudgetMins) ?? 120;
  const pinned = new Set(opts.pinnedIds || []);

  const eligible = eligibleTasks(state, today)
    .map((t) => ({ task: t, score: scoreTask(state, t, { today, bigThreshold: threshold }), eff: todayEffort(t, threshold) }));

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
    today, budget, plannedMins,
    mustDo, suggestions, parked, flagged,
  };
}

// Convenience for the dashboard / nudges: big tasks anywhere that lack a next action.
export function tasksNeedingNextAction(state, threshold = 60) {
  return state.tasks.filter((t) => t.status !== 'done' && isBig(t, threshold));
}
