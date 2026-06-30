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
