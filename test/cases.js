// cases.js — plain-JS test cases, concatenated after the stripped module sources
// and run in one direct eval (see run.jxa.js). Uses the global ok(cond, msg) and
// every exported name from schema/store/engine/reflection/dashboard.

// ---------------- ENGINE ----------------
(function () {
  var st = emptyState();
  st.goals = [normGoal({ id: 'g1', title: 'Health', weight: 5 }), normGoal({ id: 'g2', title: 'Misc', weight: 2 })];
  st.settings.dailyBudgetMins = 120; st.settings.bigTaskThreshold = 60;
  st.tasks = [
    normTask({ id: 'a', title: 'A', goalIds: ['g1'], priority: 'p1', effortMins: 30, deadline: '2026-06-30' }),
    normTask({ id: 'b', title: 'B', goalIds: ['g1'], priority: 'p2', effortMins: 30 }),
    normTask({ id: 'c', title: 'C', goalIds: ['g2'], priority: 'p4', effortMins: 30 }),
    normTask({ id: 'd', title: 'Dbig', goalIds: ['g1'], priority: 'p2', effortMins: 240 }),
    normTask({ id: 'e', title: 'Edep', goalIds: ['g1'], priority: 'p1', effortMins: 30, deps: ['b'] }),
  ];
  var T = '2026-06-30';
  var elig = eligibleTasks(st, T).map(function (x) { return x.id; });
  ok(elig.indexOf('e') < 0, 'dependency-gated task is not eligible');
  ok(elig.indexOf('a') >= 0, 'unblocked task is eligible');
  ok(scoreTask(st, st.tasks[0], { today: T }) > scoreTask(st, st.tasks[2], { today: T }), 'p1+deadline outscores p4');
  ok(isBig(st.tasks[3], 60) === true, 'big task (240m, no nextAction) is flagged big');
  ok(todayEffort(st.tasks[3], 60) === 15, 'big task w/o nextAction counts as 15m today');
  st.tasks[3].nextAction = 'start'; ok(todayEffort(st.tasks[3], 60) === 30, 'big task w/ nextAction capped to 30m today');
  st.tasks[3].nextAction = '';

  var r = buildDailyList(st, { today: T, budgetMins: 120 });
  ok(r.plannedMins <= 120, 'daily plan respects the budget cap');
  ok(r.mustDo.length >= 3, 'surfaces at least 3 must-dos when available');
  ok(r.mustDo.length <= 5, 'never more than 5 must-dos');
  ok(r.flagged.some(function (t) { return t.id === 'd'; }), 'big undecided task is flagged for decomposition');

  var r2 = buildDailyList(st, { today: T, budgetMins: 10, pinnedIds: ['c'] });
  ok(r2.mustDo.some(function (x) { return x.task.id === 'c'; }), 'pinned task is forced into must-do');
})();

// ---------------- STORE (mutators + sync gate) ----------------
(function () {
  var pushes = 0, lastPush = null;
  setPushFn(function (p) { pushes++; lastPush = p; });

  ok(needsSeed() === true, 'fresh store needs seeding');
  importState({ goals: [{ id: 'g1', title: 'G', weight: 3 }], tasks: [{ id: 't1', title: 'T', goalIds: ['g1'] }], seedVersion: 1 }, { markSeed: true });
  ok(needsSeed() === false, 'after import, seeding is no longer needed');
  ok(pushes === 0, 'cloudLoaded gate blocks pushes before the first snapshot');

  applyCloud(null); // first run, no cloud doc -> unlocks pushing, keeps local
  ok(isCloudLoaded() === true, 'cloudLoaded becomes true after applyCloud');
  ok(getState().tasks.length === 1, 'applyCloud(null) does not wipe local state');

  toggleHabit('h_x');
  ok(pushes >= 1, 'mutations push to cloud once loaded');
  ok(lastPush && Array.isArray(lastPush.tasks), 'pushed payload contains the synced tasks field');

  upsertTask({ id: 'tt', title: 'roundtrip', goalIds: [], effortMins: 10 });
  var w0 = getState().wins.length;
  completeTask('tt');
  ok(getState().tasks.find(function (x) { return x.id === 'tt'; }).status === 'done', 'completeTask marks done');
  ok(getState().wins.length === w0 + 1, 'completeTask auto-credits a win');
  uncompleteTask('tt');
  ok(getState().wins.length === w0, 'uncompleteTask removes the auto-win');

  var parsed = JSON.parse(exportJSON());
  ok(typeof parsed.tasks !== 'undefined' && typeof parsed.seedVersion !== 'undefined', 'export emits the synced shape');
})();

// ---------------- REFLECTION ----------------
(function () {
  var today = '2026-06-30';
  var rs = emptyState();
  rs.wins = [{ id: '1', date: today, text: 'x' }, { id: '2', date: addDays(today, -1), text: 'y' }, { id: '3', date: addDays(today, -2), text: 'z' }];
  ok(computeStreak(rs, today) === 3, 'streak counts 3 consecutive active days');
  rs.wins = [{ id: '1', date: today, text: 'x' }, { id: '3', date: addDays(today, -2), text: 'z' }];
  ok(computeStreak(rs, today) === 1, 'streak breaks on a gap');

  rs.tasks = [normTask({ id: 'a', status: 'done' }), normTask({ id: 'b' })];
  rs.dailyPlan = {}; rs.dailyPlan[today] = { mustDoIds: ['a', 'b'], capacityMins: 120, pickedIds: [] };
  var md = mustDoStatus(rs, today);
  ok(md.done === 1 && md.metAll === false, 'mustDoStatus reports partial completion');
  rs.tasks[1].status = 'done';
  ok(mustDoStatus(rs, today).metAll === true, 'mustDoStatus reports met when all done');

  var rr = emptyState();
  rr.tasks = [normTask({ id: 'a', effortMins: 60, status: 'done', completedAt: today + 'T10:00:00.000Z', goalIds: ['g1'] })];
  var ro = rollup(rr, today, 7);
  ok(ro.completedCount === 1 && ro.totalMinutes === 60, 'rollup sums completed minutes in range');
})();

// ---------------- CAPTURE (quick-add parser) ----------------
(function () {
  var f = parseQuick('Draft Q3 deck ! ~ 2h #Q3 @work tomorrow p1', {});
  ok(f.title === 'Draft Q3 deck', 'parser strips tokens from title');
  ok(f.important === true, 'parser: ! => important');
  ok(f.depth === 'deep', 'parser: ~ => deep');
  ok(f.effortMins === 120, 'parser: 2h => 120 min');
  ok(f._projName === 'Q3', 'parser: #Q3 => project name');
  ok(f.context === 'work', 'parser: @work => context');
  ok(f.bucket === 'tomorrow', 'parser: tomorrow => bucket');
  ok(f.priority === 'p1', 'parser: p1 => priority');
  var f2 = parseQuick('Call plumber * 30m', {});
  ok(f2.urgent === true && f2.effortMins === 30 && f2.title === 'Call plumber', 'parser: * urgent + 30m');
})();

// ---------------- METHODOLOGY ENGINE ----------------
(function () {
  var st = emptyState();
  st.goals = [normGoal({ id: 'g1', title: 'G', weight: 3 })];
  var T = '2026-06-30';
  var imp = normTask({ id: 'imp', title: 'important+urgent', goalIds: ['g1'], important: true, urgent: true, bucket: 'later', effortMins: 30 });
  var norm = normTask({ id: 'norm', title: 'normal', goalIds: ['g1'], bucket: 'later', effortMins: 30 });
  st.tasks = [imp, norm];
  ok(scoreTask(st, imp, { today: T }) > scoreTask(st, norm, { today: T }), 'important+urgent outscores plain');
  ok(scoreTask(st, imp, { today: T, frogId: 'imp' }) > scoreTask(st, imp, { today: T }), 'frog boost raises score');
  var q = quadrant(imp); ok(q.key === 'do', 'quadrant: important+urgent => Do First');
  ok(quadrant(norm).key === 'drop', 'quadrant: neither => Later/Drop');

  // bucket eligibility: inbox & someday excluded from auto-fill unless due
  st.tasks = [
    normTask({ id: 'a', title: 'later', goalIds: ['g1'], bucket: 'later', effortMins: 20 }),
    normTask({ id: 'b', title: 'inbox', goalIds: ['g1'], bucket: 'inbox', effortMins: 20 }),
    normTask({ id: 'c', title: 'someday', goalIds: ['g1'], bucket: 'someday', effortMins: 20 }),
    normTask({ id: 'd', title: 'today-bucket', goalIds: ['g1'], bucket: 'today', effortMins: 20 }),
  ];
  var r = buildDailyList(st, { today: T, budgetMins: 120 });
  var ids = r.mustDo.concat(r.suggestions).concat(r.parked).map(function (i) { return i.task.id; });
  ok(ids.indexOf('a') >= 0, "bucket 'later' auto-fills today");
  ok(ids.indexOf('b') < 0, "bucket 'inbox' excluded from today");
  ok(ids.indexOf('c') < 0, "bucket 'someday' excluded from today");
  ok(r.mustDo.some(function (i) { return i.task.id === 'd'; }), "bucket 'today' is pinned into must-do");

  // planDay produces a schedule with a deep block
  st.tasks = [normTask({ id: 'x', title: 'deep', goalIds: ['g1'], depth: 'deep', bucket: 'later', effortMins: 50 }),
    normTask({ id: 'y', title: 'shallow', goalIds: ['g1'], bucket: 'later', effortMins: 30 })];
  var pd = planDay(st, { today: T });
  ok(pd.slots.length >= 2 && pd.deepPlanned >= 50, 'planDay schedules a deep block');
})();

// ---------------- STORE: rollover + recurrence ----------------
(function () {
  importState({ goals: [], tasks: [], seedVersion: 1 }, { markSeed: true });
  applyCloud(null);
  // recurrence: completing a daily task spawns the next instance
  var t = upsertTask({ id: 'rec', title: 'daily standup', recur: 'daily', dueDate: '2026-06-30', bucket: 'later' });
  var before = getState().tasks.length;
  completeTask('rec');
  ok(getState().tasks.length === before + 1, 'completing a recurring task spawns the next instance');
  var spawned = getState().tasks.filter(function (x) { return x.id !== 'rec' && x.title === 'daily standup'; })[0];
  ok(spawned && spawned.dueDate === '2026-07-01', 'recurrence advances the due date by one day');

  // rollover: tomorrow -> today, idempotent
  getState().lastRollover = '2026-06-29';
  upsertTask({ id: 'tm', title: 'tmrw task', bucket: 'tomorrow' });
  var ran = doRollover('2026-06-30');
  ok(ran === true && getState().tasks.find(function (x) { return x.id === 'tm'; }).bucket === 'today', 'rollover promotes tomorrow->today');
  ok(doRollover('2026-06-30') === false, 'rollover is idempotent within a day');

  // quickAdd lands in inbox by default and parses flags
  var qa = quickAdd('Buy milk * @home 15m');
  ok(qa && qa.bucket === 'inbox' && qa.urgent === true && qa.context === 'home' && qa.effortMins === 15, 'quickAdd captures to inbox with parsed flags');
})();

// ---------------- QA: edge cases ----------------
(function () {
  // parser edge cases
  ok(parseQuick('!! ~ 30m', {}).title === '', 'parser: tokens-only yields empty title');
  ok(parseQuick('Ping @bogus team', {}).title === 'Ping @bogus team', 'parser: unknown @context stays in title');
  ok(parseQuick('Report 1h 30m', {}).effortMins === 90, 'parser: multiple estimates sum (1h+30m)');
  ok(parseQuick('Read book', {}).bucket === undefined, 'parser: no bucket token -> undefined (defaults later/inbox downstream)');

  // store: quickAdd guards + toggles
  importState({ goals: [{ id: 'g1', title: 'G', weight: 3 }], tasks: [], seedVersion: 1 }, { markSeed: true });
  applyCloud(null);
  ok(quickAdd('   ') === null, 'quickAdd: blank input returns null (no task created)');
  ok(quickAdd('!! ~') === null, 'quickAdd: tokens-only (no title) returns null');
  var qt = quickAdd('Design review ~ #Roadmap 45m');
  ok(qt && qt.depth === 'deep' && qt.effortMins === 45, 'quickAdd: parses depth + estimate');
  ok(getState().projects.some(function (p) { return p.title === 'Roadmap'; }), 'quickAdd: #project auto-creates the project');
  toggleFlag(qt.id, 'important'); ok(getState().tasks.find(function (x) { return x.id === qt.id; }).important === true, 'toggleFlag flips important on');
  toggleFlag(qt.id, 'important'); ok(getState().tasks.find(function (x) { return x.id === qt.id; }).important === false, 'toggleFlag flips important off');
  setDepth(qt.id, 'shallow'); ok(getState().tasks.find(function (x) { return x.id === qt.id; }).depth === 'shallow', 'setDepth normalizes');

  // delete cascades subtasks
  var par = upsertTask({ id: 'par', title: 'parent' });
  upsertTask({ id: 'kid', title: 'child', parentId: 'par' });
  deleteTask('par');
  ok(!getState().tasks.find(function (x) { return x.id === 'par' || x.id === 'kid'; }), 'deleteTask cascades to subtasks');

  // recurrence with NO dates -> spawns a later task, no due, recur preserved
  var rec2 = upsertTask({ id: 'rec2', title: 'weekly sync', recur: 'weekly', bucket: 'later' });
  var n0 = getState().tasks.length;
  completeTask('rec2');
  var sp = getState().tasks.filter(function (x) { return x.id !== 'rec2' && x.title === 'weekly sync'; })[0];
  ok(getState().tasks.length === n0 + 1 && sp && sp.recur === 'weekly' && sp.dueDate === null && sp.bucket === 'later', 'recurrence w/o dates spawns clean later task');

  // import roundtrip preserves methodology fields
  importState({ goals: [], tasks: [{ id: 'z', title: 'z', bucket: 'today', important: true, depth: 'deep', urgent: true }], seedVersion: 1 }, { markSeed: true });
  var z = getState().tasks.find(function (x) { return x.id === 'z'; });
  ok(z.bucket === 'today' && z.important === true && z.urgent === true && z.depth === 'deep', 'import preserves bucket/important/urgent/depth');

  // doRollover first-ever run does NOT promote (no prior day)
  getState().lastRollover = null;
  upsertTask({ id: 'tm2', title: 'tmrw', bucket: 'tomorrow' });
  var ran1 = doRollover('2026-07-01');
  ok(ran1 === true && getState().tasks.find(function (x) { return x.id === 'tm2'; }).bucket === 'tomorrow', 'first-ever rollover records date but does not promote');
})();

// ---------------- QA: engine edge cases ----------------
(function () {
  var st = emptyState();
  st.goals = [normGoal({ id: 'g1', title: 'G', weight: 3 })];
  var T = '2026-07-01';
  // a 'tomorrow'-bucket task that IS the frog must appear on today's plate
  st.tasks = [normTask({ id: 'ft', title: 'frog-in-tomorrow', goalIds: ['g1'], bucket: 'tomorrow', effortMins: 30 })];
  st.frogByDate = {}; st.frogByDate[T] = 'ft';
  var r = buildDailyList(st, { today: T, budgetMins: 120 });
  ok(r.mustDo.some(function (i) { return i.task.id === 'ft'; }), 'frog in tomorrow bucket still lands on today');
  ok(r.frogId === 'ft', 'buildDailyList reports the frog id');

  // suggestFrog prefers an important task
  st.frogByDate = {};
  st.tasks = [normTask({ id: 'lo', title: 'low', goalIds: ['g1'], bucket: 'later', priority: 'p4', effortMins: 20 }),
    normTask({ id: 'hi', title: 'important', goalIds: ['g1'], bucket: 'later', important: true, priority: 'p3', effortMins: 20 })];
  ok(suggestFrog(st, { today: T }).task.id === 'hi', 'suggestFrog prefers an important task');

  // planDay never schedules past work end
  st.settings.workStart = '09:00'; st.settings.workEnd = '10:00'; // only 60 min
  st.tasks = [normTask({ id: 'a', title: 'a', goalIds: ['g1'], bucket: 'later', effortMins: 40 }),
    normTask({ id: 'b', title: 'b', goalIds: ['g1'], bucket: 'later', effortMins: 40 }),
    normTask({ id: 'c', title: 'c', goalIds: ['g1'], bucket: 'later', effortMins: 40 })];
  var pd = planDay(st, { today: T });
  var pastEnd = pd.slots.some(function (s) { return s.end > 10 * 60; });
  ok(!pastEnd, 'planDay never schedules past work end');
})();

// ---------------- DASHBOARD ----------------
(function () {
  var ds = emptyState();
  ds.goals = [normGoal({ id: 'g1', title: 'G1', metric: 'taskPercent' })];
  ds.tasks = [normTask({ id: 'a', goalIds: ['g1'], status: 'done' }), normTask({ id: 'b', goalIds: ['g1'] })];
  ok(goalProgress(ds, ds.goals[0]).pct === 50, 'taskPercent goal = 50% (1 of 2)');

  var dw = emptyState();
  dw.goals = [normGoal({ id: 'gw', title: 'W', metric: 'weight', target: 40, baseline: 200 })];
  dw.weightLog = [{ date: '2026-06-01', lbs: 200 }, { date: '2026-06-30', lbs: 190 }];
  ok(goalProgress(dw, dw.goals[0]).pct === 25, 'weight goal = 25% (10 of 40 lbs)');

  var db = emptyState();
  db.goals = [normGoal({ id: 'gb', title: 'B', metric: 'count', target: 12 })];
  db.books = [{ id: '1', status: 'finished' }, { id: '2', status: 'finished' }, { id: '3', status: 'finished' }, { id: '4', status: 'reading' }];
  ok(goalProgress(db, db.goals[0]).pct === 25, 'reading goal = 25% (3 of 12 books)');
})();
