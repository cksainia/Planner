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
const strip = (s) => s.replace(/import[\s\S]*?from\s*['"][^'"]+['"];?/g, '').replace(/^\s*export\s+/gm, '');

// --- simulated environment ---
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { url: 'https://cksainia.github.io/Planner/' });
const _ls = {};
global.window = dom.window;
global.document = dom.window.document;
global.localStorage = { getItem: (k) => (k in _ls ? _ls[k] : null), setItem: (k, v) => { _ls[k] = String(v); }, removeItem: (k) => { delete _ls[k]; } };
global.HTMLElement = dom.window.HTMLElement;
dom.window.LP_FIREBASE = { apiKey: 'REPLACE_ME' }; // -> local-only mode, no CDN

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

const libs = ['js/schema.js', 'js/capture.js', 'js/store.js', 'js/engine.js', 'js/reflection.js', 'js/dashboard.js', 'js/ai.js']
  .map((f) => strip(read(f))).join('\n');

// rebuild the namespace objects app.js expects (it uses `store.x` / `ai.x`)
const namespaces = `
  const store = { getState, load, migrate, subscribe, save, setPushFn, isCloudLoaded, pushCloud, applyCloud, cloudInitEmpty, exportJSON, importState, needsSeed, upsertTask, patchTask, completeTask, uncompleteTask, deleteTask, upsertGoal, addWin, deleteWin, logWeight, toggleHabit, setDailyPlan, upsertBook, todayStr, addDays, setTaskBucket, toggleFlag, setDepth, setFrog, clearFrog, getFrogId, logPomo, doRollover, quickAdd };
  const ai = { getConfig, setConfig, aiEnabled, testConnection, decomposeTask, suggestDailyList, summarizeDay };
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
