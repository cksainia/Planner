// capture.js — natural-language quick-add parser (ported/adapted from AI-Planner).
// Turns a single line into task fields so capture is near-frictionless:
//   "Draft Q3 deck ! ~ 2h #Q3 @work tomorrow p1"
//   -> important, deep, 120min, project Q3, context work, bucket tomorrow, priority p1
//
// Tokens:  !/!!=important  *=urgent  ~ or "deep"/"shallow"=work type
//          #name=project   @context=context (work|home|outdoor|digital|family|personal)
//          30m|45min|2h|1hr=estimate   p1..p4=priority
//          today|tomorrow|later|someday|inbox=bucket
import { CONTEXTS } from './schema.js';

const BUCKET_WORDS = ['today', 'tomorrow', 'later', 'someday', 'inbox'];

// Parse a duration token into minutes: 90m / 45min / 2h / 1hr / 2h30m (combined).
function parseDur(lw) {
  let m = lw.match(/^(\d+)(?:h|hr|hrs)(\d+)(?:m|min|mins)$/); // combined, e.g. 2h30m
  if (m) return (+m[1]) * 60 + (+m[2]);
  m = lw.match(/^(\d+)(h|hr|hrs)$/);
  if (m) return (+m[1]) * 60;
  m = lw.match(/^(\d+)(m|min|mins)$/);
  if (m) return +m[1];
  return null;
}

export function parseQuick(raw, ctx = {}) {
  const f = {};
  const keep = [];
  const words = String(raw || '').trim().split(/\s+/).filter(Boolean);
  // Pass 1 — unambiguous *symbolic* tokens are stripped anywhere in the line.
  for (const w of words) {
    const lw = w.toLowerCase();
    if (w === '!' || w === '!!') { f.important = true; continue; }
    if (w === '*') { f.urgent = true; continue; }
    if (w === '~') { f.depth = 'deep'; continue; }
    if (/^p[1-4]$/.test(lw)) { f.priority = lw; continue; }
    if (w[0] === '#' && w.length > 1) { f._projName = w.slice(1); continue; }
    if (w[0] === '@' && w.length > 1 && CONTEXTS.includes(lw.slice(1))) { f.context = lw.slice(1); continue; }
    const dur = parseDur(lw);
    if (dur != null) { f.effortMins = (f.effortMins || 0) + dur; continue; }
    keep.push(w);
  }
  // Pass 2 — bare English directives (bucket / deep / shallow) are only honoured
  // when TRAILING, so an ordinary word ("Today show notes", "deep dive") isn't
  // swallowed out of the title. Never consume the only remaining word.
  while (keep.length > 1) {
    const lw = keep[keep.length - 1].toLowerCase();
    if (f.bucket === undefined && BUCKET_WORDS.includes(lw)) { f.bucket = lw; keep.pop(); continue; }
    if (f.depth === undefined && (lw === 'deep' || lw === 'shallow')) { f.depth = lw; keep.pop(); continue; }
    break;
  }
  f.title = keep.join(' ');
  return f;
}
