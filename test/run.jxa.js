// run.jxa.js — headless test runner for JavaScriptCore (Preview MCP is sandboxed
// in this env; see the testing-approach memory). Reads the ES-module sources,
// strips import/export, concatenates with test/cases.js, and runs in one direct
// eval so all modules + tests share a lexical scope.
//
//   osascript -l JavaScript test/run.jxa.js
//
'use strict';
ObjC.import('Foundation');

var BASE = '/Users/matrix/Documents/Claude/Projects/Life Planner/app/';

function read(rel) {
  var s = $.NSString.stringWithContentsOfFileEncodingError($(BASE + rel), $.NSUTF8StringEncoding, $());
  return ObjC.unwrap(s) || '';
}
function strip(src) {
  return src
    .replace(/^import[\s\S]*?from\s*['"][^'"]+['"];?/gm, '') // drop line-start (multi-line) imports only
    .replace(/^\s*export\s+/gm, '');                       // drop the export keyword
}

// in-memory shims so store.js persistence is a no-op-but-functional
var _ls = {};
globalThis.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(_ls, k) ? _ls[k] : null; },
  setItem: function (k, v) { _ls[k] = String(v); },
  removeItem: function (k) { delete _ls[k]; },
};
globalThis.console = globalThis.console || { log: function () {}, warn: function () {}, error: function () {} };

var SRC = [
  'js/schema.js', 'js/capture.js', 'js/store.js', 'js/engine.js', 'js/reflection.js', 'js/dashboard.js',
].map(function (f) { return strip(read(f)); }).join('\n');

var CASES = read('test/cases.js');

var out = '';
try {
  // direct eval: `var RESULTS` escapes to this scope; const/function from SRC are
  // visible to CASES because they're in the same eval string.
  var prelude = 'var RESULTS=[]; function ok(c,m){RESULTS.push([!!c,m]);}\n';
  eval(prelude + SRC + '\n' + CASES);

  var pass = 0, fail = 0;
  for (var i = 0; i < RESULTS.length; i++) {
    var r = RESULTS[i];
    if (r[0]) { pass++; out += '  ✓ ' + r[1] + '\n'; }
    else { fail++; out += '  ✗ ' + r[1] + '\n'; }
  }
  out = '\nLife Planner tests\n' + out + '\n' + pass + ' passed, ' + fail + ' failed\n';
  if (fail > 0) out += 'RESULT: FAIL\n'; else out += 'RESULT: PASS\n';
} catch (e) {
  out = '\nHARNESS ERROR: ' + (e && e.message ? e.message : e) + '\n' + (e && e.stack ? e.stack : '') + '\n';
}
out;
