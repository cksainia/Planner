// ai.js — optional, self-contained multi-provider client (Anthropic / OpenAI /
// Gemini). Browser-direct calls, key in device localStorage. EVERY function has
// an offline heuristic fallback so the planner is fully usable with no AI.
//
// Used for: task decomposition (smallest next action), daily-list suggestions,
// end-of-day reflection summaries, and structuring dictated (voice) capture into
// tasks. See SCHEMA.md for the agentic data contract.

import { parseQuick } from './capture.js';

const AI_KEY = 'lifeplanner.ai.v1';

const DEFAULTS = {
  provider: 'anthropic',
  model: 'claude-sonnet-5',   // current Sonnet; good + cheap for these utility calls
  apiKey: '',
};

export function getConfig() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(AI_KEY) || '{}') }; }
  catch (e) { return { ...DEFAULTS }; }
}
export function setConfig(patch) {
  const cfg = { ...getConfig(), ...patch };
  try { localStorage.setItem(AI_KEY, JSON.stringify(cfg)); } catch (e) {}
  return cfg;
}
export function aiEnabled() { return !!getConfig().apiKey; }

// Definitive connectivity check — makes one tiny call and surfaces the real
// error (401 = bad key, 400/402 = billing/credits) instead of silently falling back.
export async function testConnection() {
  if (!aiEnabled()) return { ok: false, error: 'No API key saved.' };
  try {
    const out = await callModel('Reply with the single word: OK', 'ping', 16);
    return { ok: true, sample: (out || '').trim().slice(0, 40) };
  } catch (e) { return { ok: false, error: e.message || String(e) }; }
}

// ---------- provider transport ----------
async function callModel(system, user, maxTokens = 700) {
  const { provider, model, apiKey } = getConfig();
  if (!apiKey) throw new Error('no-key');

  if (provider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
    });
    if (!r.ok) throw new Error('anthropic ' + r.status);
    const j = await r.json();
    return (j.content || []).map((c) => c.text || '').join('');
  }

  if (provider === 'openai') {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    if (!r.ok) throw new Error('openai ' + r.status);
    const j = await r.json();
    return j.choices?.[0]?.message?.content || '';
  }

  if (provider === 'gemini') {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ parts: [{ text: user }] }] }),
    });
    if (!r.ok) throw new Error('gemini ' + r.status);
    const j = await r.json();
    return j.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  }

  throw new Error('unknown-provider');
}

function extractJSON(text) {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (e) { return null; }
}

// ---------- voice capture → structured tasks ----------
const V_CONTEXTS = ['work', 'home', 'outdoor', 'digital', 'family', 'personal'];
const V_BUCKETS = ['inbox', 'today', 'tomorrow', 'later', 'someday'];

function normParsed(o) {
  o = o || {};
  const eff = Number.isFinite(o.effortMins) ? o.effortMins : (o.effortMins != null && Number.isFinite(+o.effortMins) ? +o.effortMins : null);
  return {
    title: String(o.title || '').trim().replace(/[.\s]+$/, ''),
    important: !!o.important, urgent: !!o.urgent, deep: !!o.deep,
    effortMins: eff && eff > 0 ? eff : null,
    context: V_CONTEXTS.includes(o.context) ? o.context : null,
    priority: /^p[1-4]$/.test(o.priority) ? o.priority : null,
    bucket: V_BUCKETS.includes(o.bucket) ? o.bucket : null,
    project: o.project ? String(o.project).trim() : null,
    goal: o.goal ? String(o.goal).trim() : null,
  };
}
// Resolve a goal reference (id, exact title, or partial title) to a goal id.
export function resolveGoalId(state, ref) {
  if (!ref) return null;
  const goals = (state && state.goals) || [];
  const s = String(ref).trim().toLowerCase();
  if (!s) return null;
  let g = goals.find((x) => x.id === ref);
  if (!g) g = goals.find((x) => x.title.toLowerCase() === s);
  if (!g) g = goals.find((x) => x.title.toLowerCase().split(':')[0].trim() === s);
  if (!g) g = goals.find((x) => x.title.toLowerCase().includes(s));
  if (!g) g = goals.find((x) => s.includes(x.title.split(':')[0].trim().toLowerCase()));
  return g ? g.id : null;
}
// One-line goal directory for prompts: "gl_1: Lose 40 lbs | gl_2: Ship MVP …"
function goalDirectory(state) {
  const goals = (state && state.goals) || [];
  if (!goals.length) return '';
  return goals.map((g) => `${g.id}: ${g.title}`).join(' | ');
}
// Deterministic fallback (no AI): split into utterances, run the shorthand parser.
export function parseTasksOffline(transcript, multi = false) {
  const text = String(transcript || '').trim();
  if (!text) return [];
  const parts = multi ? text.split(/\n|[.;]|\b(?:and then|then also|then|also|next)\b/i) : [text];
  return parts.map((s) => s.trim()).filter(Boolean).map((s) => {
    const f = parseQuick(s);
    return normParsed({ title: f.title || s, important: f.important, urgent: f.urgent, deep: f.depth === 'deep', effortMins: f.effortMins, context: f.context, priority: f.priority, bucket: f.bucket, project: f._projName });
  }).filter((t) => t.title);
}
// Structure a spoken transcript into task objects via Claude; deterministic fallback.
// Pass `state` so the model can link each task to the user's actual goals.
export async function parseTasks(transcript, { multi = false, state = null } = {}) {
  const text = String(transcript || '').trim();
  if (!text) return [];
  if (aiEnabled()) {
    try {
      const dir = goalDirectory(state);
      const sys = 'You convert spoken task capture into structured tasks. Reply ONLY with JSON: an array of task objects. Each object: {"title":string,"important":bool,"urgent":bool,"deep":bool,"effortMins":number|null,"context":"work"|"home"|"outdoor"|"digital"|"family"|"personal"|null,"priority":"p1"|"p2"|"p3"|"p4"|null,"bucket":"inbox"|"today"|"tomorrow"|"later"|"someday"|null,"project":string|null,"goal":string|null}. '
        + (multi ? 'The speech may list SEVERAL tasks — split them into separate objects. ' : 'Return exactly one task object. ')
        + 'Infer flags from natural phrasing ("urgent", "important", "deep focus/deep work"→deep, "by tomorrow"→bucket tomorrow, "about 20 minutes"→effortMins 20, "#project or for the X project"→project). Title is a short imperative with no trailing punctuation. Use null when unsure. '
        + (dir ? `The user's goals are: ${dir}. Set "goal" to the goal ID that each task clearly serves (null if none fits).` : '');
      const out = await callModel(sys, text, 600);
      const j = extractJSON(out);
      const arr = Array.isArray(j) ? j : (j && j.tasks ? j.tasks : (j && j.title ? [j] : null));
      if (arr && arr.length) { const mapped = arr.map(normParsed).filter((t) => t.title); if (mapped.length) return mapped; }
    } catch (e) { /* fall through to offline */ }
  }
  return parseTasksOffline(text, multi);
}

// ---------- features (each with offline fallback) ----------

// Break a big task into a smallest next action + concrete sub-steps.
export async function decomposeTask(task) {
  if (aiEnabled()) {
    try {
      const sys = 'You help someone who procrastinates on big tasks. Break a task into the smallest possible concrete first action plus 3-6 short sub-steps. Reply ONLY as JSON: {"nextAction": "...", "subtasks": ["...", "..."]}. Each item is a short imperative phrase, doable in one sitting.';
      const out = await callModel(sys, `Task: ${task.title}\nNotes: ${task.notes || '(none)'}\nEstimated effort: ${task.effortMins} min`, 500);
      const j = extractJSON(out);
      if (j && j.nextAction) return { nextAction: j.nextAction, subtasks: Array.isArray(j.subtasks) ? j.subtasks : [], source: 'ai' };
    } catch (e) { /* fall through */ }
  }
  return decomposeFallback(task);
}

function decomposeFallback(task) {
  const t = (task.title || '').trim();
  return {
    source: 'offline',
    nextAction: `Spend 10 minutes starting: ${t}`,
    subtasks: [
      `List what "${t}" actually involves`,
      'Gather anything you need to begin',
      'Do the first 10-minute chunk',
      'Note where you stopped for next time',
    ],
  };
}

// Pick the top 3-5 for today from candidates that fit the budget, with rationale.
// `candidates` is the engine's scored list: [{task, score, eff}]. Returns
// [{id, why}] preserving engine order on fallback.
export async function suggestDailyList(candidates, budgetMins, contextLine = '') {
  const top = candidates.slice(0, 10);
  if (aiEnabled() && top.length) {
    try {
      const sys = 'You are a focus coach for someone who procrastinates. From the candidate tasks, choose the 3-5 highest-leverage ones that fit the time budget, favoring deadlines and high-value work over busywork. Reply ONLY as JSON: [{"id":"...","why":"<=12 words"}].';
      const list = top.map((c) => `- id=${c.task.id} | ${c.task.title} | ~${c.eff}m | pri ${c.task.priority}${c.task.deadline ? ' | deadline ' + c.task.deadline : ''}`).join('\n');
      const out = await callModel(sys, `Budget: ${budgetMins} min/day. ${contextLine}\nCandidates:\n${list}`, 500);
      const j = extractJSON(out);
      if (Array.isArray(j) && j.length) return j.filter((x) => x && x.id);
    } catch (e) { /* fall through */ }
  }
  return top.slice(0, 5).map((c) => ({ id: c.task.id, why: c.task.deadline ? 'Has a deadline' : 'High priority' }));
}

// ---------- planner assistant (free-form chat over the FULL planner state) ----------
// The assistant sees a compact JSON snapshot of goals/projects/tasks and replies
// with {reply, ops[]} — ops are validated by normOps() and applied only after the
// user taps Apply in the chat, so the model can never silently corrupt state.

// Compact state snapshot for the prompt: goals, projects, all open tasks (with
// sub-task links), and a little recent history for context.
export function snapshotForAI(state, today = null) {
  const st = state || {};
  const compactTask = (t) => {
    const o = { id: t.id, title: t.title };
    if ((t.goalIds || []).length) o.goalIds = t.goalIds;
    if (t.projectId) o.projectId = t.projectId;
    if (t.parentId) o.parentId = t.parentId;
    if (t.bucket) o.bucket = t.bucket;
    if (t.priority) o.priority = t.priority;
    if (t.effortMins) o.effortMins = t.effortMins;
    if (t.context) o.context = t.context;
    if (t.important) o.important = true;
    if (t.urgent) o.urgent = true;
    if (t.depth === 'deep') o.deep = true;
    if (t.dueDate) o.dueDate = t.dueDate;
    if (t.deadline) o.deadline = t.deadline;
    if (t.recur && t.recur !== 'none') o.recur = t.recur;
    if (t.nextAction) o.nextAction = t.nextAction;
    if (t.notes) o.notes = String(t.notes).slice(0, 140);
    return o;
  };
  const tasks = (st.tasks || []);
  const open = tasks.filter((t) => t.status !== 'done').slice(0, 250).map(compactTask);
  const doneRecent = tasks.filter((t) => t.status === 'done').slice(-15)
    .map((t) => ({ id: t.id, title: t.title, completedAt: (t.completedAt || '').slice(0, 10) }));
  return {
    today: today || undefined,
    goals: (st.goals || []).map((g) => ({ id: g.id, title: g.title, metric: g.metric, target: g.target, weight: g.weight })),
    projects: (st.projects || []).map((p) => ({ id: p.id, title: p.title })),
    openTasks: open,
    recentlyCompleted: doneRecent,
    winsToday: (st.wins || []).filter((w) => today && w.date === today).map((w) => w.text),
    frogTaskId: (today && st.frogByDate && st.frogByDate[today]) || null,
    dailyBudgetMins: st.settings ? st.settings.dailyBudgetMins : undefined,
  };
}

const OP_NAMES = ['add_task', 'add_subtask', 'update_task', 'complete_task', 'delete_task', 'add_win', 'add_goal', 'update_goal', 'set_frog'];
const OP_GOAL_METRICS = ['taskPercent', 'weight', 'count', 'shipped', 'habit', 'none'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Shared field normalizer for add_task / update_task ops. `partial` (updates)
// only keeps keys the model actually sent; adds fill sensible fields.
function opTaskFields(o, state, partial) {
  const f = {};
  const has = (k) => o[k] !== undefined && o[k] !== null;
  if (has('title') && String(o.title).trim()) f.title = String(o.title).trim();
  if (has('bucket') && V_BUCKETS.includes(o.bucket)) f.bucket = o.bucket;
  if (has('priority') && /^p[1-4]$/.test(o.priority)) f.priority = o.priority;
  if (has('context') && V_CONTEXTS.includes(o.context)) f.context = o.context;
  if (has('effortMins') && Number.isFinite(+o.effortMins) && +o.effortMins > 0) f.effortMins = Math.round(+o.effortMins);
  if (o.important !== undefined) f.important = !!o.important;
  if (o.urgent !== undefined) f.urgent = !!o.urgent;
  if (o.deep !== undefined) f.depth = o.deep ? 'deep' : 'shallow';
  if (has('dueDate') && DATE_RE.test(o.dueDate)) f.dueDate = o.dueDate;
  if (has('deadline') && DATE_RE.test(o.deadline)) f.deadline = o.deadline;
  if (has('recur') && ['none', 'daily', 'weekly', 'monthly'].includes(o.recur)) f.recur = o.recur;
  if (has('notes')) f.notes = String(o.notes);
  if (has('nextAction')) f.nextAction = String(o.nextAction);
  if (has('goal')) { const gid = resolveGoalId(state, o.goal); if (gid) f.goalIds = [gid]; }
  // project rename only on create — patchTask has no #project resolver
  if (!partial && has('project') && String(o.project).trim()) f._projName = String(o.project).trim();
  if (!partial && !f.bucket) f.bucket = 'inbox';
  return f;
}

function goalShort(state, gid) {
  const g = (state.goals || []).find((x) => x.id === gid);
  return g ? g.title.split(':')[0].trim() : null;
}
function taskTitle(state, id) {
  const t = (state.tasks || []).find((x) => x.id === id);
  return t ? t.title : null;
}

// Validate + normalize raw model ops against the current state. Returns
// { ops: [{op, …, label}], skipped } — invalid ops are dropped, never guessed.
export function normOps(raw, state) {
  const out = [];
  let skipped = 0;
  for (const o of (Array.isArray(raw) ? raw : [])) {
    if (!o || !OP_NAMES.includes(o.op)) { skipped++; continue; }
    if (o.op === 'add_task') {
      const fields = opTaskFields(o, state, false);
      if (!fields.title) { skipped++; continue; }
      const bits = [];
      if (fields.goalIds) bits.push(goalShort(state, fields.goalIds[0]));
      bits.push(fields.bucket);
      if (fields.priority) bits.push(fields.priority);
      if (fields.effortMins) bits.push(fields.effortMins + 'm');
      out.push({ op: 'add_task', fields, label: `Add task “${fields.title}” (${bits.filter(Boolean).join(' · ')})` });
    } else if (o.op === 'add_subtask') {
      let pid = o.parentId && (state.tasks || []).some((t) => t.id === o.parentId) ? o.parentId : null;
      if (!pid && o.parentTitle) { const m = (state.tasks || []).find((t) => t.status !== 'done' && t.title.toLowerCase() === String(o.parentTitle).toLowerCase()); if (m) pid = m.id; }
      const title = String(o.title || '').trim();
      if (!pid || !title) { skipped++; continue; }
      out.push({ op: 'add_subtask', parentId: pid, title, label: `Add step to “${taskTitle(state, pid)}”: ${title}` });
    } else if (o.op === 'update_task') {
      if (!o.id || !(state.tasks || []).some((t) => t.id === o.id)) { skipped++; continue; }
      const fields = opTaskFields(o, state, true);
      const keys = Object.keys(fields);
      if (!keys.length) { skipped++; continue; }
      const disp = keys.map((k) => k === 'goalIds' ? `goal → ${goalShort(state, fields.goalIds[0])}` : k === '_projName' ? `project → ${fields[k]}` : `${k} → ${fields[k]}`).join(', ');
      out.push({ op: 'update_task', id: o.id, fields, label: `Update “${taskTitle(state, o.id)}”: ${disp}` });
    } else if (o.op === 'complete_task' || o.op === 'delete_task' || o.op === 'set_frog') {
      if (!o.id || !(state.tasks || []).some((t) => t.id === o.id)) { skipped++; continue; }
      const verb = { complete_task: 'Complete', delete_task: 'Delete', set_frog: 'Make today’s frog:' }[o.op];
      out.push({ op: o.op, id: o.id, label: `${verb} “${taskTitle(state, o.id)}”` });
    } else if (o.op === 'add_win') {
      const text = String(o.text || '').trim();
      if (!text) { skipped++; continue; }
      const gid = o.goal ? resolveGoalId(state, o.goal) : null;
      out.push({ op: 'add_win', text, goalId: gid, label: `Log win: ${text}` });
    } else if (o.op === 'add_goal') {
      const title = String(o.title || '').trim();
      if (!title) { skipped++; continue; }
      const goal = {
        title,
        metric: OP_GOAL_METRICS.includes(o.metric) ? o.metric : 'taskPercent',
        target: Number.isFinite(+o.target) ? +o.target : null,
        baseline: Number.isFinite(+o.baseline) ? +o.baseline : null,
        weight: Number.isFinite(+o.weight) ? Math.max(1, Math.min(5, Math.round(+o.weight))) : 3,
      };
      out.push({ op: 'add_goal', goal, label: `Add goal “${title}”` });
    } else if (o.op === 'update_goal') {
      const g = (state.goals || []).find((x) => x.id === o.id);
      if (!g) { skipped++; continue; }
      const patch = {};
      if (o.title !== undefined && String(o.title).trim()) patch.title = String(o.title).trim();
      if (o.metric !== undefined && OP_GOAL_METRICS.includes(o.metric)) patch.metric = o.metric;
      if (o.target !== undefined && (o.target === null || Number.isFinite(+o.target))) patch.target = o.target === null ? null : +o.target;
      if (o.baseline !== undefined && (o.baseline === null || Number.isFinite(+o.baseline))) patch.baseline = o.baseline === null ? null : +o.baseline;
      if (o.weight !== undefined && Number.isFinite(+o.weight)) patch.weight = Math.max(1, Math.min(5, Math.round(+o.weight)));
      if (!Object.keys(patch).length) { skipped++; continue; }
      out.push({ op: 'update_goal', id: o.id, patch, label: `Update goal “${g.title.split(':')[0].trim()}”: ${Object.keys(patch).join(', ')}` });
    }
  }
  return { ops: out, skipped };
}

const ASSIST_SYS = 'You are the assistant inside "Life Planner", the user\'s personal goal & task planner. You receive their full planner state as JSON plus a request. Reply ONLY with JSON: {"reply": string, "ops": array}. '
  + '"reply" is a short, warm, direct answer in plain text (no markdown, under 90 words). "ops" is the list of concrete changes to make (empty array if the request is just a question). The app shows the ops to the user for one-tap approval, then applies them. '
  + 'Allowed ops: '
  + '{"op":"add_task","title":str,"goal":goalId|null,"project":str|null,"bucket":"inbox|today|tomorrow|later|someday","priority":"p1|p2|p3|p4","effortMins":num,"context":"work|home|outdoor|digital|family|personal","important":bool,"urgent":bool,"deep":bool,"dueDate":"YYYY-MM-DD"|null,"deadline":"YYYY-MM-DD"|null,"recur":"none|daily|weekly|monthly","notes":str|null} · '
  + '{"op":"add_subtask","parentId":taskId,"title":str} (a concrete checklist step under an existing task) · '
  + '{"op":"update_task","id":taskId, …any add_task fields to change…} · '
  + '{"op":"complete_task","id":taskId} · {"op":"delete_task","id":taskId} · '
  + '{"op":"add_win","text":str,"goal":goalId|null} · '
  + '{"op":"add_goal","title":str,"metric":"taskPercent|weight|count|shipped|habit|none","target":num|null,"weight":1-5} · '
  + '{"op":"update_goal","id":goalId,"title"?,"metric"?,"target"?,"baseline"?,"weight"?} · '
  + '{"op":"set_frog","id":taskId} (today\'s single most important task). '
  + 'Rules: use ids EXACTLY as they appear in the state. ALWAYS set "goal" on new tasks to the best-fitting goal id (null only if truly unrelated). When asked to break work down, add 3-6 add_subtask ops with short concrete steps. When categorizing or planning, prefer update_task over creating duplicates. If the request is ambiguous, ask one clarifying question in "reply" with empty ops. Never invent tasks the user didn\'t imply.';

// One assistant turn. `history` = [{role:'user'|'assistant', text}] (recent turns).
export async function assistant(userText, state, history = [], today = null) {
  const text = String(userText || '').trim();
  if (!text) return { reply: '', ops: [], skipped: 0 };
  if (!aiEnabled()) return { reply: 'The assistant needs an API key — add one in Setup → AI assist, then come back.', ops: [], skipped: 0, offline: true };
  const snap = snapshotForAI(state, today);
  const hist = (history || []).slice(-8).map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n');
  const user = `PLANNER STATE (JSON):\n${JSON.stringify(snap)}\n\n${hist ? `RECENT CONVERSATION:\n${hist}\n\n` : ''}USER REQUEST:\n${text}`;
  try {
    const out = await callModel(ASSIST_SYS, user, 2000);
    const j = extractJSON(out);
    if (j && (j.reply !== undefined || j.ops !== undefined)) {
      const { ops, skipped } = normOps(j.ops || [], state);
      return { reply: String(j.reply || '').trim() || (ops.length ? 'Here’s what I’d change — review below.' : 'Done.'), ops, skipped };
    }
    return { reply: (out || '').trim().slice(0, 600) || 'I couldn’t produce a structured answer — try rephrasing.', ops: [], skipped: 0 };
  } catch (e) {
    return { reply: 'AI call failed (' + (e.message || e) + '). Check your key in Setup → AI assist.', ops: [], skipped: 0, error: true };
  }
}

// A short, warm end-of-day reflection from the day's wins.
export async function summarizeDay(wins) {
  const texts = (wins || []).map((w) => '- ' + w.text);
  if (aiEnabled() && texts.length) {
    try {
      const sys = 'You are an encouraging accountability coach. In 2-3 sentences, acknowledge today\'s progress warmly and name one momentum-building focus for tomorrow. No lists.';
      const out = await callModel(sys, `Today's wins:\n${texts.join('\n')}`, 300);
      if (out && out.trim()) return out.trim();
    } catch (e) { /* fall through */ }
  }
  const n = texts.length;
  if (!n) return 'No wins logged yet today — even one small step counts. Pick the easiest must-do and start a 10-minute timer.';
  return `${n} win${n > 1 ? 's' : ''} today — that's real momentum. Keep the streak alive: line up tomorrow's top 3 tonight.`;
}
