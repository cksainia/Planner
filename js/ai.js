// ai.js — optional, self-contained multi-provider client (Anthropic / OpenAI /
// Gemini). Browser-direct calls, key in device localStorage. EVERY function has
// an offline heuristic fallback so the planner is fully usable with no AI.
//
// Used for: task decomposition (smallest next action), daily-list suggestions,
// and end-of-day reflection summaries. See SCHEMA.md for the agentic data contract.

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
