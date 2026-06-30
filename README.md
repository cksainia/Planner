# Life Planner

A private, multi-device PWA that turns 10 annual goals + a master task list into a
**realistic daily focus list**, a **daily reflection loop**, and **goal dashboards** —
built to beat procrastination by always surfacing the *smallest next action* and capping
the day so it stays achievable.

Vanilla JS ES modules (no build step), offline-first PWA, Firebase (Auth + Firestore)
for private cross-device sync, optional browser-direct AI for task breakdown.

## Privacy model (read this first)

GitHub Pages on a free account serves a **public** repo, but your goals/tasks are
**confidential**. So:

- **No personal content is in the code.** The repo ships empty.
- Your data is bootstrapped from **`seed.local.json`** (gitignored, never committed) and
  lives in **Firestore behind auth rules** (`firestore.rules`, locked to your uid).
- The Firebase web config in `index.html` is **public by design** — Firestore rules are
  what protect the data, not hiding those keys.

## Run locally

```bash
ruby server.rb            # -> http://localhost:8200/
# or: python3 -m http.server 8200
```

Until Firebase is configured it runs in **local-only mode** (data on this device only).
Auth/sync can only be exercised on the live HTTPS domain (or localhost).

## Run tests

```bash
osascript -l JavaScript test/run.jxa.js     # 30 logic checks, no browser needed
```

## First-run seeding

1. Open the app, sign in (once Firebase is set up).
2. **Setup → Import seed / backup** → choose `seed.local.json`.
3. Your 10 goals + full task list populate and sync to all your devices. Confidential
   content never touches git.

## Deploy (one-time)

### GitHub Pages
```bash
gh repo create cksainia/life-planner --public --source=. --remote=origin
git push -u origin main
gh api -X POST repos/cksainia/life-planner/pages -f 'source[branch]=main' -f 'source[path]=/'
# live at https://cksainia.github.io/life-planner/
```
`seed.local.json` is gitignored, so it will **not** be published. Verify with
`git status --porcelain` (it must not appear).

### Firebase
1. Create a project; **Authentication → Email/Password** → enable.
2. Create your user (your email + a password).
3. **Firestore** → create database; publish the rules from `firestore.rules`.
4. **Authentication → Settings → Authorized domains** → add `cksainia.github.io`.
5. Copy the web app config into `window.LP_FIREBASE` in `index.html`, commit, push.

## Architecture

| File | Role |
|------|------|
| `js/schema.js` | data model, enums, `SYNC_FIELDS`, empty defaults (no personal content) |
| `js/store.js` | localStorage + Firestore bridge; seed-once; `cloudLoaded` read-before-write gate; export/import |
| `js/firebase.js` | Auth + Firestore (`onSnapshot` live sync) |
| `js/engine.js` | daily priority engine — budget cap, top 3–5, big-task decomposition flag |
| `js/reflection.js` | win capture review, next-day planning, streak/momentum |
| `js/dashboard.js` | per-goal progress + 7-day rollups |
| `js/ai.js` | optional multi-provider client (offline fallbacks) |
| `js/app.js` | UI router + screens |
| `SCHEMA.md` | data contract for agentic tools (Cowork / Spark / Home Assistant) |

## Roadmap

- Phase 2: decompose fuzzy goals (Dubai IP/LinkedIn, EdTech) and the pool build into tasks.
- Phase 3: wire the agentic automations (news digest, email triage, nudges) onto the
  documented `SCHEMA.md` contract.
