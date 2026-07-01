// sync.mjs — scheduled job (GitHub Action). Refreshes the Withings token,
// pulls recent weigh-ins, and merges them into the planner's Firestore weightLog.
//
// The rotating refresh_token is stored in Firestore at integrations/withings
// (Admin-only; invisible to the app), so each run persists the next token.
import { initFirebase, withingsToken, fetchWeights, plannerDocRef } from './lib.mjs';

async function main() {
  const db = initFirebase();
  const intRef = db.doc('integrations/withings');
  const intSnap = await intRef.get();
  let refresh = intSnap.exists ? intSnap.data().refresh_token : process.env.WITHINGS_REFRESH_TOKEN;
  if (!refresh) throw new Error('No Withings refresh token. Run `node authorize.mjs <code>` once to bootstrap.');

  // 1) refresh access token (Withings rotates the refresh token every time)
  const tok = await withingsToken({ grant_type: 'refresh_token', refresh_token: refresh });
  await intRef.set({ refresh_token: tok.refresh_token, userid: tok.userid, updatedAt: new Date().toISOString() }, { merge: true });

  // 2) pull the last 30 days of weight
  const since = Math.floor(Date.now() / 1000) - 30 * 86400;
  const byDate = await fetchWeights(tok.access_token, since);

  // 3) merge into the planner doc's weightLog (upsert by date, keep manual entries)
  const ref = await plannerDocRef(db);
  const snap = await ref.get();
  const data = snap.exists ? snap.data() : {};
  const log = Array.isArray(data.weightLog) ? data.weightLog.slice() : [];
  const idx = Object.fromEntries(log.map((e, i) => [e.date, i]));
  let added = 0, updated = 0;
  for (const [date, lbs] of Object.entries(byDate)) {
    if (date in idx) {
      if (log[idx[date]].lbs !== lbs) { log[idx[date]] = { ...log[idx[date]], lbs, source: 'withings' }; updated++; }
    } else {
      log.push({ date, lbs, source: 'withings' });
      added++;
    }
  }
  log.sort((a, b) => a.date.localeCompare(b.date));
  await ref.set({ weightLog: log }, { merge: true });

  console.log(`Withings sync ok — ${added} added, ${updated} updated, ${log.length} total weigh-ins.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
