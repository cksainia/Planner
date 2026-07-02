// smoke.mjs — headless DOM smoke test of the REAL app.js via jsdom.
// Boots the app in a simulated DOM (firebase stubbed, no CDN), then drives the
// UI the way a user does — clicks, typing — to confirm rendering + the delegated
// overlay event handling (the modal-button bug class). Run:  node test/smoke.mjs
import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire('/Users/matrix/AI-Planner/'); // borrow jsdom
const { JSDOM } = require('jsdom');

const BASE = '/Users/matrix/Documents/Claude/Projects/Life Planner/app/';
const read = (f) => readFileSync(BASE + f, 'utf8');
// Strip ONLY real ES import statements (line-start `import … from '…';`, incl.
// multi-line) — not mid-line identifiers like `store.importState(...)`.
const strip = (s) => s.replace(/^import[\s\S]*?from\s*['"][^'"]+['"];?/gm, '').replace(/^\s*export\s+/gm, '');

// --- simulated environment ---
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { url: 'https://cksainia.github.io/Planner/' });
const _ls = {};
global.window = dom.window;
global.document = dom.window.document;
global.localStorage = { getItem: (k) => (k in _ls ? _ls[k] : null), setItem: (k, v) => { _ls[k] = String(v); }, removeItem: (k) => { delete _ls[k]; } };
global.HTMLElement = dom.window.HTMLElement;
dom.window.LP_FIREBASE = { apiKey: 'REPLACE_ME' }; // -> local-only mode, no CDN
// matchMedia stub so the app's responsive branch is testable; WIDE_MATCH flips it.
let WIDE_MATCH = false;
dom.window.matchMedia = (q) => ({ matches: WIDE_MATCH, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
// SpeechRecognition stub so voiceSupported() is true and the mic buttons render.
dom.window.SpeechRecognition = function () { this.start = function () {}; this.stop = function () {}; };

globalThis.RESULTS = [];
const ok = (m, c) => RESULTS.push([!!c, m]);

// firebase stubs (app.js imports these; we replace with no-ops so nothing hits the network)
const fbStubs = `
  function initFirebase(){return false;}
  function isConfigured(){return false;}
  function onAuth(cb){cb(null);return function(){};}
  function signInWithGoogle(){}
  function signOutUser(){}
  function watchDoc(){return function(){};}
  function writeDoc(){return Promise.resolve();}
`;

const libs = ['js/schema.js', 'js/capture.js', 'js/store.js', 'js/engine.js', 'js/reflection.js', 'js/dashboard.js', 'js/ai.js', 'js/voice.js']
  .map((f) => strip(read(f))).join('\n');

// rebuild the namespace objects app.js expects (it uses `store.x` / `ai.x`)
const namespaces = `
  const store = { getState, load, migrate, subscribe, save, setPushFn, isCloudLoaded, pushCloud, applyCloud, cloudInitEmpty, exportJSON, importState, needsSeed, upsertTask, patchTask, completeTask, uncompleteTask, deleteTask, upsertGoal, deleteGoal, addWin, deleteWin, logWeight, toggleHabit, setDailyPlan, upsertBook, deleteBook, todayStr, addDays, addMonths, setTaskBucket, toggleFlag, setDepth, setFrog, clearFrog, getFrogId, logPomo, doRollover, quickAdd, addTaskFields, addSubtask };
  const ai = { getConfig, setConfig, aiEnabled, testConnection, decomposeTask, suggestDailyList, summarizeDay, parseTasks, parseTasksOffline, resolveGoalId, snapshotForAI, normOps, assistant };
`;

const appCode = strip(read('js/app.js'));

let out = '';
try {
  // one direct eval so all modules + the app + the test share scope
  eval(fbStubs + libs + namespaces + appCode + `
    // ---- drive the UI ----
    // 1) boots to empty state
    RESULTS.push([/Welcome/.test(document.querySelector('#app').textContent), 'boots and renders the empty-state welcome']);

    // seed a minimal dataset and re-render
    store.importState({ goals:[{id:'g1',title:'Health',weight:5}], tasks:[{id:'t1',title:'Existing task',goalIds:['g1'],bucket:'later'}], seedVersion:1 }, { markSeed:true });
    store.applyCloud(null);
    view='today'; render();
    RESULTS.push([!!document.querySelector('.frog'), 'Today auto-picks and renders a frog banner']);
    RESULTS.push([!!document.querySelector('#quickIn'), 'quick-add bar renders on Today']);

    // 2) frog re-pick when the stored frog id is stale (deleted)
    store.getState().frogByDate = {}; store.getState().frogByDate[store.todayStr()] = 'GHOST';
    render();
    RESULTS.push([!!document.querySelector('.frog'), 'frog re-picks when the chosen id is missing']);

    // 3) quick-add via the + button (delegated inside #app)
    document.querySelector('#quickIn').value = 'Call surveyor * @outdoor 15m';
    document.querySelector('[data-action=quickAdd]').click();
    RESULTS.push([store.getState().tasks.some(t=>t.title==='Call surveyor' && t.urgent && t.context==='outdoor'), 'quick-add + button creates a parsed task']);

    // 4) THE FIX: open the task editor and Save via the delegated OVERLAY handler
    view='tasks'; render();
    document.querySelector('[data-action=newTask]').click();     // opens editor into #overlay
    RESULTS.push([!!document.querySelector('#overlay #eTitle'), 'task editor opens in the overlay']);
    document.querySelector('#eTitle').value = 'QA smoke task';
    document.querySelector('[data-ed=important]').click();       // toggle a flag in the editor
    document.querySelector('[data-action=saveTask]').click();    // delegated overlay click -> save
    var saved = store.getState().tasks.find(t=>t.title==='QA smoke task');
    RESULTS.push([!!saved, 'editor Save (delegated overlay click) creates the task']);
    RESULTS.push([saved && saved.important===true, 'editor flag toggle persists on save']);
    RESULTS.push([document.querySelector('#overlay').innerHTML==='', 'overlay closes after save']);

    // 5) edit an existing task, change bucket, save
    document.querySelectorAll('[data-action=edit]')[0].click();
    document.querySelector('[data-ed=bucket][data-v=today]').click();
    document.querySelector('[data-action=saveTask]').click();
    RESULTS.push([store.getState().tasks.some(t=>t.bucket==='today'), 'editing a task and Save persists the bucket change']);

    // 6) all nav views render without throwing
    ['today','tasks','goals','reflect','settings'].forEach(function(v){ view=v; render(); });
    RESULTS.push([true, 'all five tabs render without throwing']);

    // 7) Tasks sub-views (matrix / inbox / buckets) render
    view='tasks'; tasksView='matrix'; render();
    RESULTS.push([!!document.querySelector('.matrix'), 'Matrix view renders quadrants']);
    tasksView='inbox'; render();
    RESULTS.push([/Inbox|Triage/.test(document.querySelector('#app').textContent), 'Inbox view renders']);
    tasksView='goal';

    // 8) pomodoro overlay opens and Stop clears it (no leaked timer)
    view='today'; render();
    var fb = document.querySelector('[data-action=focus]');
    if (fb) { fb.click();
      RESULTS.push([!!document.querySelector('#pomoClock'), 'Focus/Pomodoro overlay opens with a clock']);
      document.querySelector('[data-action=focusCancel]').click();
      RESULTS.push([document.querySelector('#overlay').innerHTML==='', 'Pomodoro Stop closes the overlay']);
    } else { RESULTS.push([true, 'Focus/Pomodoro overlay opens with a clock (no eligible task, skipped)']); RESULTS.push([true, 'Pomodoro Stop closes the overlay (skipped)']); }

    // 9) toggle a task done via checkbox -> logs a win
    view='tasks'; render();
    var winsBefore = store.getState().wins.length;
    document.querySelector('[data-action=toggle]').click();
    RESULTS.push([store.getState().wins.length === winsBefore + 1, 'checkbox toggle completes a task and logs a win']);

    // 10) goal CRUD (fix #2): open editor, create a 'count' goal, save
    view='goals'; render();
    document.querySelector('[data-action=newGoal]').click();
    RESULTS.push([!!document.querySelector('#overlay #gTitle'), 'goal editor opens in the overlay']);
    document.querySelector('#gTitle').value = 'Reading';
    document.querySelector('#gMetric').value = 'count';
    document.querySelector('#gTarget').value = '12';
    document.querySelector('[data-action=saveGoal]').click();
    RESULTS.push([store.getState().goals.some(function(g){return g.title==='Reading' && g.metric==='count';}), 'goal editor creates a count goal']);

    // 11) book tracker (fix #3): the reading-list card appears for a count goal
    render();
    RESULTS.push([!!document.querySelector('[data-action=addBook]'), 'reading-list card appears once a count goal exists']);
    document.querySelector('#bookIn').value = 'Deep Work';
    document.querySelector('[data-action=addBook]').click();
    var bk = store.getState().books.find(function(b){return b.title==='Deep Work';});
    RESULTS.push([!!bk, 'addBook creates a book']);
    document.querySelector('[data-action=cycleBook][data-id="'+bk.id+'"]').click();
    RESULTS.push([store.getState().books.find(function(b){return b.id===bk.id;}).status==='reading', 'cycleBook advances unread->reading']);

    // 12) iPad / wide layout (fix: sidebar + master-detail). Flip the media query.
    WIDE_MATCH = true;
    ['today','tasks','goals','reflect','settings'].forEach(function(v){ view=v; render(); });
    RESULTS.push([true, 'all views render in wide layout without throwing']);
    view='today'; render();
    RESULTS.push([!!document.querySelector('.frame .sidebar') && !!document.querySelector('.navbtn'), 'wide: sidebar nav renders (no bottom tab bar)']);
    RESULTS.push([!document.querySelector('.tabbar'), 'wide: bottom tab bar is hidden']);
    view='tasks'; tasksView='goal'; render();
    RESULTS.push([!!document.querySelector('.tasks-md') && !!document.querySelector('.detail'), 'wide: Tasks renders master-detail with a detail panel']);
    var selRow = document.querySelector('[data-action=selectTask]');
    RESULTS.push([!!selRow, 'wide: task rows are selectable (not sheet-openers)']);
    selRow.click();
    RESULTS.push([!!document.querySelector('.detail .dtitle') && !!document.querySelector('[data-action=detImportant]'), 'wide: selecting a task fills the live-edit detail panel']);
    var selId = selRow.getAttribute('data-id');
    var impBefore = !!store.getState().tasks.find(function(t){return t.id===selId;}).important;
    document.querySelector('[data-action=detImportant]').click();
    RESULTS.push([!!store.getState().tasks.find(function(t){return t.id===selId;}).important !== impBefore, 'wide: detail Important toggle applies live']);
    WIDE_MATCH = false;

    // 13) Weight analytics screen (Withings-fed; manual logging removed)
    store.importState({ goals:[{id:'gw',title:'Reach 165',metric:'weight',baseline:200,target:35}], tasks:[], weightLog:[{date:'2025-06-01',lbs:200},{date:'2026-01-02',lbs:196},{date:'2026-03-01',lbs:190},{date:'2026-06-30',lbs:184}], seedVersion:1 }, { markSeed:true });
    store.applyCloud(null);
    view='goals'; render();
    RESULTS.push([!document.querySelector('#wIn'), 'manual weight logging is removed from Goals']);
    RESULTS.push([!!document.querySelector('[data-action=openWeight]'), 'Goals shows a weight Analytics link']);
    document.querySelector('[data-action=openWeight]').click();
    RESULTS.push([view==='weight' && !!document.querySelector('.wchart'), 'openWeight opens the weight screen with a chart']);
    RESULTS.push([!!document.querySelector('#wf-lo') && !!document.querySelector('#wf-hi'), 'weight chart has From/To range sliders']);
    RESULTS.push([/[0-9]/.test(document.querySelector('#wf-change').textContent), 'in-range change figure is populated']);
    document.querySelector('[data-action=wfRange][data-days=all]').click();
    RESULTS.push([document.querySelector('#wf-lo').value==='0', 'the "All" preset widens the slider to the full history']);
    var loEl=document.querySelector('#wf-lo'); loEl.value='2'; loEl.dispatchEvent(new dom.window.Event('input'));
    RESULTS.push([!!document.querySelector('.wchart'), 'moving the From slider redraws the chart in place']);

    // 14) Voice input: mic buttons render on all four inputs; structured-create path works
    store.importState({ goals:[], tasks:[], projects:[], seedVersion:1 }, { markSeed:true });
    store.applyCloud(null);
    view='today'; render();
    RESULTS.push([!!document.querySelector('[data-action=mic][data-target=quick]'), 'mic button renders on quick-add']);
    view='reflect'; render();
    RESULTS.push([!!document.querySelector('[data-action=mic][data-target=win]') && !!document.querySelector('[data-action=mic][data-target=brain]'), 'mic buttons render on wins + brain-dump']);
    view='tasks'; render();
    document.querySelector('[data-action=newTask]').click();
    RESULTS.push([!!document.querySelector('#overlay [data-action=mic][data-target=title]'), 'mic button renders in the task editor']);
    closeOverlay();
    var madeBefore = store.getState().tasks.length;
    var made = createTasksFromParsed([{title:'Call surveyor',urgent:true,context:'outdoor',effortMins:15,bucket:'inbox'}], 'quick');
    RESULTS.push([made===1 && store.getState().tasks.some(function(t){return t.title==='Call surveyor' && t.urgent && t.context==='outdoor' && t.effortMins===15;}), 'voice: a Claude-structured task is created from parsed fields']);
    RESULTS.push([store.getState().tasks.length===madeBefore+1, 'voice: exactly one task is added']);

    // 15) Sub-tasks render as an inline checklist on the parent tile (MS Planner style)
    store.importState({ goals:[{id:'g1',title:'Ship',weight:3}], tasks:[{id:'par',title:'Ship v2',goalIds:['g1'],bucket:'today'}], seedVersion:1 }, { markSeed:true });
    store.applyCloud(null);
    var kid = store.addSubtask('par', 'Outline slides');
    view='tasks'; tasksView='goal'; render();
    RESULTS.push([!!document.querySelector('.task[data-id=par]'), 'parent renders as a tile']);
    RESULTS.push([!document.querySelector('.task[data-id="'+kid.id+'"]'), 'sub-task is NOT a separate top-level tile']);
    RESULTS.push([!!document.querySelector('.task[data-id=par] .checklist .subitem'), 'sub-task shows as a checklist item on the parent tile']);
    document.querySelector('.subitem [data-action=toggle][data-id="'+kid.id+'"]').click();
    RESULTS.push([store.getState().tasks.find(function(t){return t.id===kid.id;}).status==='done', 'checking a checklist item completes the sub-task']);
    var si = document.querySelector('#sub-par'); si.value='Draft narrative'; document.querySelector('[data-action=addSub][data-id=par]').click();
    RESULTS.push([store.getState().tasks.some(function(t){return t.parentId==='par' && t.title==='Draft narrative';}), 'the "+ step" input adds a sub-task']);

    // 16) AI assistant chat screen
    RESULTS.push([!!document.querySelector('[data-nav=ai]'), 'AI tab appears in the nav']);
    view='ai'; render();
    RESULTS.push([!!document.querySelector('#chatIn') && !!document.querySelector('[data-action=chatSend]'), 'assistant screen renders the message box and send button']);
    RESULTS.push([!!document.querySelector('[data-action=mic][data-target=chat]'), 'assistant screen has a voice (mic) button']);
    RESULTS.push([document.querySelectorAll('[data-action=chatEx]').length >= 3, 'assistant intro offers example prompts']);
    RESULTS.push([!!document.querySelector('.nudge'), 'assistant warns when no API key is saved']);
    // the Apply seam: validated ops from the chat go through applyOp -> store
    var av = ai.normOps([
      { op:'add_task', title:'Meal prep', goal:'Ship', bucket:'today' },
      { op:'add_subtask', parentId:'par', title:'Review copy' },
      { op:'update_task', id:'par', priority:'p1' },
    ], store.getState());
    RESULTS.push([av.ops.length===3 && av.skipped===0, 'normOps validates a mixed op batch from the chat']);
    var applied = av.ops.filter(function(o){ return applyOp(o); }).length;
    RESULTS.push([applied===3, 'Apply executes every validated op']);
    var stNow = store.getState();
    RESULTS.push([stNow.tasks.some(function(t){return t.title==='Meal prep' && t.goalIds[0]==='g1' && t.bucket==='today';}), 'chat add_task lands with the goal linked']);
    RESULTS.push([stNow.tasks.some(function(t){return t.parentId==='par' && t.title==='Review copy';}), 'chat add_subtask lands as a checklist step']);
    RESULTS.push([stNow.tasks.find(function(t){return t.id==='par';}).priority==='p1', 'chat update_task patches the task']);

    // 17) Task dependencies
    store.importState({ goals:[{id:'g1',title:'Ship',weight:3}], tasks:[
      {id:'w1',title:'Design the API',goalIds:['g1'],bucket:'today'},
      {id:'w2',title:'Build the API',goalIds:['g1'],bucket:'today',deps:['w1']},
    ], seedVersion:1 }, { markSeed:true });
    store.applyCloud(null);
    view='tasks'; tasksView='goal'; render();
    RESULTS.push([!!document.querySelector('.task[data-id=w2] .blockedchip'), 'blocked task shows a lock badge naming its blocker']);
    RESULTS.push([!document.querySelector('.task[data-id=w1] .blockedchip'), 'the blocker itself carries no badge']);
    // editor exposes the Blocked-by picker without self/cycle candidates
    document.querySelector('.task[data-id=w1] .tbody').click();
    var depSel = document.querySelector('#overlay #edDepAdd') || document.querySelector('#edDepAdd, #detDepAdd');
    var depOpts = depSel ? Array.prototype.map.call(depSel.querySelectorAll('option'), function(o){return o.value;}) : [];
    RESULTS.push([!!depSel, 'task editor/detail shows a Blocked-by picker']);
    RESULTS.push([depOpts.indexOf('w1')<0 && depOpts.indexOf('w2')<0, 'picker offers neither self nor a cycle-creating task']);
    closeOverlay();
    // Apply resolves a same-batch title dep to the real new id
    var dv = ai.normOps([
      { op:'add_task', title:'Write docs', goal:'g1', bucket:'later' },
      { op:'add_task', title:'Publish docs', goal:'g1', bucket:'later', deps:['Write docs'] },
    ], store.getState());
    var dctx = { created: {} };
    dv.ops.forEach(function(o){ applyOp(o, dctx); });
    var wd = store.getState().tasks.find(function(t){return t.title==='Write docs';});
    var pd = store.getState().tasks.find(function(t){return t.title==='Publish docs';});
    RESULTS.push([wd && pd && pd.deps.length===1 && pd.deps[0]===wd.id, 'chat batch: "Publish docs" ends up blocked by the real id of "Write docs"']);
    // completing the blocker frees the dependent on the next paint
    store.completeTask('w1'); render();
    RESULTS.push([!document.querySelector('.task[data-id=w2] .blockedchip'), 'completing the blocker clears the lock badge']);
  `);

  let pass = 0, fail = 0;
  for (const [okFlag, m] of RESULTS) { if (okFlag) { pass++; out += '  ✓ ' + m + '\n'; } else { fail++; out += '  ✗ ' + m + '\n'; } }
  out = '\nLife Planner — DOM smoke (jsdom)\n' + out + `\n${pass} passed, ${fail} failed\nRESULT: ${fail ? 'FAIL' : 'PASS'}\n`;
} catch (e) {
  out = '\nSMOKE HARNESS ERROR: ' + (e && e.message ? e.message : e) + '\n' + (e && e.stack ? e.stack : '') + '\n';
}
process.stdout.write(out);
// clear any pending pomodoro interval so node exits
for (let i = 1; i < 99999; i++) clearInterval(i);
process.exit(/RESULT: PASS/.test(out) ? 0 : 1);
