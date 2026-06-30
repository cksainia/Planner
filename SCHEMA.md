# Life Planner — Data Schema & Agentic Integration Contract

This documents the data model so external agents (Claude Cowork, Gemini Spark, Home
Assistant MCPs) can read tasks, push updates, and send nudges **without fighting over
state**. See the "Concurrency" section for the rules that keep that safe.

## Where the data lives

- **Firestore:** one document per user at `planners/{uid}`. It contains exactly the
  synced fields below. Locked by `firestore.rules` to that user's auth uid.
- **Local mirror:** `localStorage["lifeplanner.v1"]` (a full copy; cloud is source of truth).
- **Device-local only (NOT synced):** AI config at `localStorage["lifeplanner.ai.v1"]`.

## Synced document shape

```jsonc
{
  "goals":       [Goal],
  "projects":    [Project],
  "tasks":       [Task],
  "weightLog":   [{ "date": "YYYY-MM-DD", "lbs": number }],
  "habitsDaily": { "YYYY-MM-DD": { "<habitId>": true } },
  "books":       [{ "id", "title", "author", "status": "unread|reading|finished", "finishedDate" }],
  "dailyPlan":   { "YYYY-MM-DD": { "capacityMins": number, "mustDoIds": [taskId], "pickedIds": [taskId] } },
  "wins":        [{ "id", "date": "YYYY-MM-DD", "text", "goalId?", "taskId?" }],
  "seedVersion": number,
  "settings":    { "dailyBudgetMins": number, "bigTaskThreshold": number, "habits": [{ "id", "label", "schedule" }] },
  "updatedAt":   "ISO8601"   // written by clients on every push
}
```

### Goal
`{ id, num, title, description, category, metric, target?, baseline?, deadline?, status, weight }`
- `metric`: `none | weight | count | taskPercent | shipped | habit` (drives the dashboard).
- `weight`: 1–5 importance; feeds the priority engine.

### Project (optional)
`{ id, goalId, title }`

### Task
`{ id, ref?, title, goalIds[], projectId?, parentId?, status, priority, effortMins,
   dueDate?, deadline?, deps[], context, notes, nextAction?, createdAt, completedAt? }`
- `status`: `todo | in_progress | blocked | done`
- `priority`: `p1`(highest) … `p4`(default)
- `context`: `work | home | outdoor | digital | family | personal`
- `deadline` is immovable (weighs heavily in urgency); `dueDate` is a soft target.
- `deps[]` are task ids that must be `done` before this task is eligible.
- `parentId` makes a task a sub-task; `nextAction` is the smallest concrete next step.
- A task with `goalIds: []` is in the standalone/uncategorized bucket.

## How agents should use this

**Read** the daily plan: a "today" agent can read `dailyPlan[<today>].mustDoIds` plus
the `tasks` array to know what matters, or replicate the priority engine
(`js/engine.js → buildDailyList(state, {budgetMins})`) which is pure and dependency-free.

**Write** updates: agents may
- flip a task's `status` to `done` and set `completedAt` (the app auto-credits a win),
- append to `wins` (accountability: "I noticed you shipped X"),
- set a task's `nextAction` / add sub-tasks (decomposition),
- set `dailyPlan[<tomorrow>].mustDoIds` (propose a plan).

**Nudge/digest** automations (news digest, email triage, reminders) live entirely
agent-side; they only need read access to `tasks` + `goals` to know what to protect
focus for. Nothing in this app pulls news/email itself.

## Concurrency — don't clobber state

The app writes the **whole document** on each change (no field merge), but only **after
it has read the latest snapshot once** (the `cloudLoaded` gate in `js/store.js`). Agents
writing directly to Firestore should follow the same discipline:

1. **Read the current doc first**, modify the specific field(s), write the merged result.
   Prefer Firestore `update()` on individual fields (e.g. a single task) over a full
   `set()` to minimize the race window.
2. **Treat `tasks`/`wins` as append/patch-by-id**, never wholesale replace, unless you
   just read the latest copy.
3. Bump nothing in `settings.habits` ids — they key `habitsDaily`.

The app uses live `onSnapshot`, so any agent write is reflected on the user's devices
within seconds.

## JSON export/import

Settings → **Export JSON** produces exactly the synced shape above (a portable backup
and a clean hand-off format for agents). Settings → **Import** accepts the same shape
(used for first-run seeding and restores).
