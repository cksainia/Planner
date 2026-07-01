// dashboard.js — per-goal progress + rollups (spec §4.4). Pure compute.

import { todayStr } from './store.js';

export function goalTasks(state, goalId) {
  return (state.tasks || []).filter((t) => (t.goalIds || []).includes(goalId));
}

function pctDone(tasks) {
  if (!tasks.length) return 0;
  const done = tasks.filter((t) => t.status === 'done').length;
  return Math.round((done / tasks.length) * 100);
}

// Returns { pct (0-100, where defined), label, detail, sparkline? }.
export function goalProgress(state, goal) {
  const tasks = goalTasks(state, goal.id);
  const doneCount = tasks.filter((t) => t.status === 'done').length;

  switch (goal.metric) {
    case 'weight': {
      const log = (state.weightLog || []).slice().sort((a, b) => a.date.localeCompare(b.date));
      if (!log.length) return { pct: 0, label: 'No weigh-ins yet', detail: 'Log your weight to start the trend.', spark: [] };
      const baseline = goal.baseline ?? log[0].lbs;
      const current = log[log.length - 1].lbs;
      const lost = Math.max(0, baseline - current);
      const target = goal.target || 40;
      return {
        pct: Math.min(100, Math.round((lost / target) * 100)),
        label: `${lost.toFixed(1)} of ${target} lbs lost`,
        detail: `Now ${current} lbs (started ${baseline}).`,
        spark: log.map((e) => e.lbs),
      };
    }
    case 'count': {
      const finished = (state.books || []).filter((b) => b.status === 'finished').length;
      const target = goal.target || 12;
      return { pct: Math.min(100, Math.round((finished / target) * 100)), label: `${finished} of ${target} books`, detail: `${(state.books || []).filter((b) => b.status === 'reading').length} in progress.` };
    }
    case 'shipped': {
      return { pct: pctDone(tasks), label: `${doneCount} of ${tasks.length} shipped`, detail: `${tasks.filter((t) => t.status === 'in_progress').length} in progress.` };
    }
    case 'habit': {
      const habits = (state.settings && state.settings.habits) || [];
      const adh = habitAdherence(state, 7);
      return { pct: adh.pct, label: `${adh.pct}% habit adherence (7d)`, detail: `${habits.length} habits tracked.`, spark: adh.perDay };
    }
    case 'none':
    case 'taskPercent':
    default:
      return { pct: pctDone(tasks), label: `${doneCount} of ${tasks.length} tasks done`, detail: tasks.length ? '' : 'No tasks yet.' };
  }
}

// 7-day habit adherence across all defined habits.
export function habitAdherence(state, days = 7) {
  const habits = (state.settings && state.settings.habits) || [];
  if (!habits.length) return { pct: 0, perDay: [] };
  const today = todayStr();
  const perDay = [];
  let hit = 0, possible = 0;
  for (let i = days - 1; i >= 0; i--) {
    const d = shift(today, -i);
    const day = (state.habitsDaily || {})[d] || {};
    const got = habits.filter((h) => day[h.id]).length;
    perDay.push(got);
    hit += got;
    possible += habits.length;
  }
  return { pct: possible ? Math.round((hit / possible) * 100) : 0, perDay };
}

function shift(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return todayStr(d);
}

// Overview across all goals.
export function dashboard(state) {
  return (state.goals || []).map((g) => ({ goal: g, progress: goalProgress(state, g) }));
}

// ---------- weight analytics (Withings-fed) ----------

// The weigh-in log as a stable, oldest-first [{date, lbs}] series.
export function weightSeries(state) {
  return (state.weightLog || []).slice().filter((e) => e && e.date && typeof e.lbs === 'number')
    .sort((a, b) => a.date.localeCompare(b.date));
}

function dayGap(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }

// Analytics over a (pre-sorted) series, optionally restricted to [from, to] (inclusive
// 'YYYY-MM-DD' bounds). Returns {} when the window has no readings.
// change < 0 means weight went DOWN (loss). perWeek is the average lb/week over the span.
export function weightStats(series, from = null, to = null) {
  const win = series.filter((e) => (!from || e.date >= from) && (!to || e.date <= to));
  if (!win.length) return { count: 0 };
  const first = win[0], last = win[win.length - 1];
  let min = win[0], max = win[0];
  for (const e of win) { if (e.lbs < min.lbs) min = e; if (e.lbs > max.lbs) max = e; }
  const change = Math.round((last.lbs - first.lbs) * 10) / 10;
  const days = dayGap(first.date, last.date);
  const perWeek = days > 0 ? Math.round((change / days) * 7 * 10) / 10 : 0;
  return { count: win.length, first, last, min, max, change, days, perWeek };
}
