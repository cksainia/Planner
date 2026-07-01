// store.js — single source of truth. localStorage + Firestore bridge.
// Sync-safety lessons baked in (see aria-summer-tracker memory):
//   * seed-once: seeding only happens when there is no data; never clobber.
//   * cloudLoaded gate / read-before-write: we never push to cloud until the
//     first snapshot has been applied, so a stale local can't overwrite cloud.
// This module imports ONLY schema.js so it stays unit-testable in JXA (no firebase).

import {
  emptyState, normState, normTask, normGoal, normProject, uid,
  SYNC_FIELDS, SCHEMA_VERSION,
} from './schema.js';
import { parseQuick } from './capture.js';

const LS_KEY = 'lifeplanner.v1';

let state = emptyState();
let cloudLoaded = false;          // becomes true after first applyCloud / cloudInitEmpty
let pushFn = null;                // injected by app.js: (syncedObj) => writeDoc(...)
const listeners = new Set();

// ---------- core ----------
export function getState() { return state; }

export function load() {
  try {
    const raw = (typeof localStorage !== 'undefined') && localStorage.getItem(LS_KEY);
    if (raw) state = normState(JSON.parse(raw));
  } catch (e) { /* corrupt local — fall back to empty */ }
  migrate();
  return state;
}

// Non-destructive shape migration: only fills missing fields, never overwrites.
export function migrate() {
  const base = emptyState();
  for (const k of Object.keys(base)) if (state[k] === undefined) state[k] = base[k];
  state.settings = { ...base.settings, ...(state.settings || {}) };
}

function persistLocal() {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(LS_KEY, JSON.stringify(state)); }
  catch (e) { /* quota / unavailable */ }
}

function emit() { listeners.forEach((fn) => { try { fn(state); } catch (e) {} }); }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function save({ push = true } = {}) {
  persistLocal();
  emit();
  if (push) pushCloud();
}

// ---------- cloud bridge ----------
export function setPushFn(fn) { pushFn = fn; }
export function isCloudLoaded() { return cloudLoaded; }

function pickSynced() {
  const o = {};
  for (const k of SYNC_FIELDS) o[k] = state[k];
  return o;
}

export function pushCloud() {
  if (!cloudLoaded) return;          // read-before-write
  if (pushFn) pushFn(pickSynced());
}

// Apply a cloud snapshot (cloud is source of truth for synced fields).
export function applyCloud(cloud) {
  if (cloud && typeof cloud === 'object') {
    for (const k of SYNC_FIELDS) if (cloud[k] !== undefined) state[k] = cloud[k];
    state = normState(state);
    migrate();
  }
  cloudLoaded = true;
  persistLocal();
  emit();
}

// First run with no cloud doc yet: unlock pushing and seed cloud from local.
export function cloudInitEmpty() {
  cloudLoaded = true;
  pushCloud();
  emit();
}

// ---------- export / import / seed ----------
export function exportJSON() { return JSON.stringify(pickSynced(), null, 2); }

export function importState(obj, { markSeed = false } = {}) {
  if (typeof obj === 'string') obj = JSON.parse(obj);
  for (const k of SYNC_FIELDS) if (obj[k] !== undefined) state[k] = obj[k];
  if (markSeed) state.seedVersion = obj.seedVersion || SCHEMA_VERSION;
  state = normState(state);
  migrate();
  save();
  return state;
}

// True when nothing has been seeded yet (empty + never imported).
export function needsSeed() {
  return (state.goals || []).length === 0 && (state.seedVersion || 0) === 0;
}

// ---------- mutators (used by UI + engine) ----------
export function upsertTask(t) {
  t = normTask(t);
  const i = state.tasks.findIndex((x) => x.id === t.id);
  if (i >= 0) state.tasks[i] = { ...state.tasks[i], ...t };
  else state.tasks.push(t);
  save();
  return t;
}
export function patchTask(id, patch) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return null;
  Object.assign(t, patch);
  save();
  return t;
}
export function completeTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t || t.status === 'done') return t;
  t.status = 'done';
  t.completedAt = new Date().toISOString();
  // auto-credit a win (reflection loop)
  addWin({ text: 'Completed: ' + t.title, taskId: id, goalId: t.goalIds[0] || null }, { push: false });
  if (t.recur && t.recur !== 'none') spawnRecurrence(t);
  save();
  return t;
}

// Recurring tasks: on completion, schedule the next instance (later bucket).
// Idempotent — completing/uncompleting repeatedly never accumulates duplicates.
function spawnRecurrence(t) {
  if (!t.recur || t.recur === 'none') return;
  // Already spawned an untouched next instance? Don't create another.
  if (t.spawnedNextId && state.tasks.some((x) => x.id === t.spawnedNextId && x.status !== 'done')) return;
  const base = t.dueDate || t.deadline || todayStr();
  const next = t.recur === 'monthly' ? addMonths(base, 1) : addDays(base, { daily: 1, weekly: 7 }[t.recur] || 1);
  const hasDeadline = !!t.deadline;
  const child = normTask({
    title: t.title, notes: t.notes, ref: t.ref, goalIds: t.goalIds, projectId: t.projectId,
    context: t.context, priority: t.priority, effortMins: t.effortMins,
    important: t.important, urgent: t.urgent, depth: t.depth, recur: t.recur,
    // Always carry a sensible next date so "daily/weekly/monthly" actually schedules
    // forward (a hard deadline stays a deadline; otherwise it's a soft due date).
    dueDate: hasDeadline ? null : next, deadline: hasDeadline ? next : null,
    bucket: 'later', spawnedFrom: t.id,
  });
  state.tasks.push(child);
  t.spawnedNextId = child.id;
}

// --- methodology mutators (AI-Planner) ---
export function setTaskBucket(id, bucket) { return patchTask(id, { bucket }); }
export function toggleFlag(id, flag) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return null;
  t[flag] = !t[flag];
  save();
  return t;
}
export function setDepth(id, depth) { return patchTask(id, { depth: depth === 'deep' ? 'deep' : 'shallow' }); }

export function setFrog(taskId, date = null) { state.frogByDate[date || todayStr()] = taskId; save(); }
export function clearFrog(date = null) { delete state.frogByDate[date || todayStr()]; save(); }
export function getFrogId(date = null) { return state.frogByDate[date || todayStr()] || null; }

export function logPomo(taskId, mins) {
  state.pomos.push({ id: uid('pm'), date: todayStr(), taskId: taskId || null, mins, at: new Date().toISOString() });
  save();
}

// Gentle, no-guilt rollover: promote yesterday's 'tomorrow' tasks to 'today'.
// Idempotent per day via lastRollover. Safe to call on every load.
export function doRollover(today = null) {
  today = today || todayStr();
  if (state.lastRollover === today) return false;
  const prev = state.lastRollover;
  if (prev) {
    for (const t of state.tasks) {
      if (t.status === 'done') continue;
      if (t.bucket === 'tomorrow') t.bucket = 'today';
    }
  }
  state.lastRollover = today;
  save({ push: !!prev }); // first-ever run just records the date, no cloud churn
  return true;
}

// Quick capture: parse a natural-language line into a task (defaults to inbox).
export function quickAdd(raw) {
  const fields = parseQuick(raw, { goals: state.goals, projects: state.projects });
  if (!fields.title) return null;
  // resolve #project name -> id (create if new)
  if (fields._projName) {
    let p = state.projects.find((x) => x.title.toLowerCase() === fields._projName.toLowerCase());
    if (!p) { p = normProject({ title: fields._projName }); state.projects.push(p); }
    fields.projectId = p.id;
    delete fields._projName;
  }
  return upsertTask({ bucket: 'inbox', ...fields });
}
export function uncompleteTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return null;
  t.status = 'todo';
  t.completedAt = null;
  state.wins = state.wins.filter((w) => w.taskId !== id);
  // Undo the recurrence spawn from this completion, but only if it's still
  // untouched (no work logged) — never delete an instance the user acted on.
  if (t.spawnedNextId) {
    const child = state.tasks.find((x) => x.id === t.spawnedNextId);
    if (child && child.status !== 'done' && !child.completedAt) {
      state.tasks = state.tasks.filter((x) => x.id !== child.id);
    }
    t.spawnedNextId = null;
  }
  save();
  return t;
}
export function deleteTask(id) {
  state.tasks = state.tasks.filter((x) => x.id !== id && x.parentId !== id);
  save();
}

export function upsertGoal(g) {
  g = normGoal(g);
  const i = state.goals.findIndex((x) => x.id === g.id);
  if (i >= 0) state.goals[i] = { ...state.goals[i], ...g };
  else state.goals.push(g);
  save();
  return g;
}

export function deleteGoal(id) {
  state.goals = state.goals.filter((g) => g.id !== id);
  // detach the goal from any tasks so they don't dangle (keep the tasks).
  for (const t of state.tasks) if ((t.goalIds || []).includes(id)) t.goalIds = t.goalIds.filter((g) => g !== id);
  save();
}

export function addWin({ text, goalId = null, taskId = null, date = null }, { push = true } = {}) {
  const w = { id: uid('w'), date: date || todayStr(), text, goalId, taskId };
  state.wins.push(w);
  if (push) save();
  return w;
}
export function deleteWin(id) { state.wins = state.wins.filter((w) => w.id !== id); save(); }

export function logWeight(lbs, date = null) {
  date = date || todayStr();
  const ix = state.weightLog.findIndex((e) => e.date === date);
  if (ix >= 0) state.weightLog[ix].lbs = lbs;
  else state.weightLog.push({ date, lbs });
  state.weightLog.sort((a, b) => a.date.localeCompare(b.date));
  save();
}

export function toggleHabit(habitId, date = null) {
  date = date || todayStr();
  if (!state.habitsDaily[date]) state.habitsDaily[date] = {};
  state.habitsDaily[date][habitId] = !state.habitsDaily[date][habitId];
  save();
}

export function setDailyPlan(date, patch) {
  date = date || todayStr();
  const cur = state.dailyPlan[date] || { capacityMins: state.settings.dailyBudgetMins, mustDoIds: [], pickedIds: [] };
  state.dailyPlan[date] = { ...cur, ...patch };
  save();
}

export function upsertBook(b) {
  b = { id: b.id || uid('bk'), title: b.title || 'Untitled', author: b.author || '', status: b.status || 'unread', finishedDate: b.finishedDate || null };
  const i = state.books.findIndex((x) => x.id === b.id);
  if (i >= 0) state.books[i] = { ...state.books[i], ...b };
  else state.books.push(b);
  save();
  return b;
}
export function deleteBook(id) { state.books = state.books.filter((b) => b.id !== id); save(); }

// ---------- date helpers ----------
export function todayStr(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return todayStr(d);
}
// Calendar-month step (clamps overflow: Jan 31 + 1mo -> Feb 28/29, not Mar 3).
export function addMonths(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return todayStr(d);
}
