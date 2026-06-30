// schema.js — data model, enums, defaults. NO personal content lives here.
// All confidential goals/tasks are bootstrapped at runtime from seed.local.json
// into Firestore (see store.js / privacy note in README).

export const CONTEXTS = ['work', 'home', 'outdoor', 'digital', 'family', 'personal'];
export const STATUSES = ['todo', 'in_progress', 'blocked', 'done'];
export const PRIORITIES = ['p1', 'p2', 'p3', 'p4']; // p1 highest .. p4 lowest/default
export const METRICS = ['none', 'weight', 'count', 'taskPercent', 'shipped', 'habit'];

// Fields that are synced to Firestore (one doc per owner). Anything not listed
// stays device-local (e.g. AI config, parentMode-style local prefs).
export const SYNC_FIELDS = [
  'goals', 'projects', 'tasks',
  'weightLog', 'habitsDaily', 'books', 'dailyPlan', 'wins',
  'seedVersion', 'settings',
];

// Schema/seed version. Bump only to intentionally rebuild config from seed
// (non-destructive — preserves status by id). Used by store.migrate().
export const SCHEMA_VERSION = 1;

// Empty initial state. The app ships with NOTHING personal; the owner imports
// seed.local.json once on a signed-in device to populate Firestore.
export function emptyState() {
  return {
    goals: [],
    projects: [],
    tasks: [],
    weightLog: [],          // [{date:'YYYY-MM-DD', lbs:number}]
    habitsDaily: {},        // {'YYYY-MM-DD': {habitId:true}}
    books: [],              // [{id, title, author?, status:'unread'|'reading'|'finished', finishedDate?}]
    dailyPlan: {},          // {'YYYY-MM-DD': {capacityMins, mustDoIds:[], pickedIds:[]}}
    wins: [],               // [{id, date, text, goalId?, taskId?}]
    seedVersion: 0,         // set to SCHEMA_VERSION once seeded
    settings: {
      dailyBudgetMins: 120, // default discretionary focus budget
      bigTaskThreshold: 60, // tasks over this (mins) are "big" -> need a nextAction
      habits: [],           // [{id, label, schedule:'daily'}]  (defines the G2 checklist)
    },
  };
}

// --- factories / helpers (id generation, normalization) ---

export function uid(prefix = 'id') {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function normGoal(g) {
  return {
    id: g.id || uid('g'),
    num: g.num ?? null,
    title: g.title || 'Untitled goal',
    description: g.description || '',
    category: g.category || '',
    metric: METRICS.includes(g.metric) ? g.metric : 'taskPercent',
    target: g.target ?? null,         // numeric target where relevant (40 lbs, 12 books)
    baseline: g.baseline ?? null,     // starting value (e.g. start weight)
    deadline: g.deadline || null,     // 'YYYY-MM-DD'
    status: STATUSES.includes(g.status) ? g.status : 'in_progress',
    weight: g.weight ?? 3,            // importance 1..5 (drives priority engine)
  };
}

export function normTask(t) {
  return {
    id: t.id || uid('t'),
    ref: t.ref || null,               // human ref from the spec (W1, D3, B2...)
    title: t.title || 'Untitled task',
    goalIds: Array.isArray(t.goalIds) ? t.goalIds : (t.goalId ? [t.goalId] : []),
    projectId: t.projectId || null,
    parentId: t.parentId || null,     // sub-task -> parent task id
    status: STATUSES.includes(t.status) ? t.status : 'todo',
    priority: PRIORITIES.includes(t.priority) ? t.priority : 'p4',
    effortMins: Number.isFinite(t.effortMins) ? t.effortMins : 30,
    dueDate: t.dueDate || null,       // soft target 'YYYY-MM-DD'
    deadline: t.deadline || null,     // immovable 'YYYY-MM-DD'
    deps: Array.isArray(t.deps) ? t.deps : [],   // task ids that must be done first
    context: CONTEXTS.includes(t.context) ? t.context : 'personal',
    notes: t.notes || '',
    nextAction: t.nextAction || '',   // the smallest concrete next step (anti-procrastination)
    createdAt: t.createdAt || new Date().toISOString(),
    completedAt: t.completedAt || null,
  };
}

export function normProject(p) {
  return { id: p.id || uid('pj'), goalId: p.goalId || null, title: p.title || 'Project' };
}

// Normalize a full state object (used after import / seed). Idempotent.
export function normState(s) {
  const base = emptyState();
  const out = { ...base, ...s };
  out.goals = (s.goals || []).map(normGoal);
  out.projects = (s.projects || []).map(normProject);
  out.tasks = (s.tasks || []).map(normTask);
  out.settings = { ...base.settings, ...(s.settings || {}) };
  return out;
}
