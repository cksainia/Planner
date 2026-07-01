# Withings → Planner weight sync

Fully automatic: a scheduled GitHub Action pulls your Withings weigh-ins every 6
hours and writes them into the planner's Firestore `weightLog`. You step on the
scale; the trend + Goal 1 dashboard update on their own. No secrets live in the repo.

## How it works

```
Withings scale → Health Mate cloud → [GitHub Action cron] → Firestore weightLog → app (live)
```

- The rotating Withings **refresh token is stored in Firestore** (`integrations/withings`,
  Admin-only, invisible to the app), so each run persists the next token.
- Writes use a **Firebase service account** (Admin SDK), which safely bypasses the
  security rules — no change to `firestore.rules` needed.
- Weigh-ins are converted **kg → lbs** and upserted **one per day** (latest wins);
  manual entries you typed in the app are preserved.

## One-time setup (~10 min)

### 1. Create a Withings developer app
- Go to <https://developer.withings.com/> → **Create an application** (Public cloud / "Web").
- **Callback URL:** `https://cksainia.github.io/Planner/`
- Note the **Client ID** and **Client Secret**.

### 2. Get a Firebase service account key
- Firebase console → ⚙️ **Project settings → Service accounts** → **Generate new private key**.
- This downloads a JSON file. Keep it private (it's git-ignored here).

### 3. Add GitHub repo secrets
Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|--------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | the entire contents of the service-account JSON |
| `WITHINGS_CLIENT_ID` | from step 1 |
| `WITHINGS_CLIENT_SECRET` | from step 1 |
| `PLANNER_UID` | *(optional)* your Firebase uid; omit and it uses your sole planner doc |

### 4. Authorize once (locally)
From `integrations/withings/`:
```bash
npm install
# save the step-2 JSON here as service-account.json (git-ignored), then:
export WITHINGS_CLIENT_ID=...        # from step 1
export WITHINGS_CLIENT_SECRET=...
node authorize.mjs                   # prints a URL — open it, approve
node authorize.mjs <code>            # paste the ?code=... from the redirect
```
This saves your refresh token to Firestore. Done — you never touch tokens again.

### 5. Turn it on
- Repo → **Actions** → **Withings weight sync** → **Run workflow** (first manual run),
  then it runs every 6 hours automatically.

## Test locally
```bash
export FIREBASE_SERVICE_ACCOUNT="$(cat service-account.json)"
export WITHINGS_CLIENT_ID=...  WITHINGS_CLIENT_SECRET=...
node sync.mjs
```

## Note
If the app is open on a device at the exact moment a sync runs, a full-document
save from the app could briefly overwrite a just-synced weigh-in; the next 6-hour
run re-adds it. Weigh-ins are once-daily so this is effectively never an issue.
