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

export function parseQuick(raw, ctx = {}) {
  const f = {};
  const keep = [];
  const words = String(raw || '').trim().split(/\s+/);
  for (const w of words) {
    if (!w) continue;
    const lw = w.toLowerCase();
    if (w === '!' || w === '!!') { f.important = true; continue; }
    if (w === '*') { f.urgent = true; continue; }
    if (w === '~' || lw === 'deep') { f.depth = 'deep'; continue; }
    if (lw === 'shallow') { f.depth = 'shallow'; continue; }
    if (/^p[1-4]$/.test(lw)) { f.priority = lw; continue; }
    if (w[0] === '#' && w.length > 1) { f._projName = w.slice(1); continue; }
    if (w[0] === '@' && w.length > 1 && CONTEXTS.includes(lw.slice(1))) { f.context = lw.slice(1); continue; }
    const m = lw.match(/^(\d+)(m|min|mins|h|hr|hrs)$/);
    if (m) { const n = parseInt(m[1], 10); f.effortMins = (f.effortMins || 0) + (/h/.test(m[2]) ? n * 60 : n); continue; }
    if (BUCKET_WORDS.includes(lw)) { f.bucket = lw; continue; }
    keep.push(w);
  }
  f.title = keep.join(' ');
  return f;
}
