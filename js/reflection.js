// reflection.js — daily reflection loop (spec §4.3): win capture review,
// next-day priority review, and momentum/streak. Pure compute; mutations live
// in store.js (addWin, setDailyPlan).

import { addDays, todayStr } from './store.js';

// A day "counts" toward momentum if at least one win was logged that date
// (completed tasks auto-log wins, plus any unplanned wins).
export function activeDays(state) {
  return new Set((state.wins || []).map((w) => w.date));
}

// Current streak: consecutive active days ending at today (with a one-day grace
// so an as-yet-unlogged today doesn't read as a broken streak).
export function computeStreak(state, today) {
  today = today || todayStr();
  const active = activeDays(state);
  let cur = active.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (active.has(cur)) { streak++; cur = addDays(cur, -1); }
  return streak;
}

// Status of a given day's planned must-dos (for the evening review).
export function mustDoStatus(state, date) {
  const plan = (state.dailyPlan || {})[date];
  const ids = (plan && plan.mustDoIds) || [];
  const byId = Object.fromEntries(state.tasks.map((t) => [t.id, t]));
  const done = ids.filter((id) => byId[id] && byId[id].status === 'done');
  const pending = ids.filter((id) => byId[id] && byId[id].status !== 'done');
  return { planned: ids.length, done: done.length, pending, doneIds: done, metAll: ids.length > 0 && pending.length === 0 };
}

// Everything accomplished on a date (planned completions + unplanned wins).
export function daySummary(state, date) {
  date = date || todayStr();
  const wins = (state.wins || []).filter((w) => w.date === date);
  const completed = (state.tasks || []).filter((t) => t.completedAt && t.completedAt.slice(0, 10) === date);
  const md = mustDoStatus(state, date);
  return { date, wins, completed, mustDo: md, winCount: wins.length };
}

// 7-day (or n-day) rollup ending at endDate: completions, wins, minutes by goal.
export function rollup(state, endDate, days = 7) {
  endDate = endDate || todayStr();
  const start = addDays(endDate, -(days - 1));
  const inRange = (d) => d >= start && d <= endDate;
  const completed = (state.tasks || []).filter((t) => t.completedAt && inRange(t.completedAt.slice(0, 10)));
  const wins = (state.wins || []).filter((w) => inRange(w.date));
  const minutesByGoal = {};
  let totalMinutes = 0;
  for (const t of completed) {
    const m = t.effortMins || 0;
    totalMinutes += m;
    const gid = (t.goalIds && t.goalIds[0]) || 'standalone';
    minutesByGoal[gid] = (minutesByGoal[gid] || 0) + m;
  }
  return { start, end: endDate, days, completedCount: completed.length, winCount: wins.length, totalMinutes, minutesByGoal, completed, wins };
}
