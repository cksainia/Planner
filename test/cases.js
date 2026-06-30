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
