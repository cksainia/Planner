// lib.mjs — shared Withings + Firestore helpers (no secrets; values come from env).
import admin from 'firebase-admin';

const TOKEN_URL = 'https://wbsapi.withings.net/v2/oauth2';
const MEAS_URL = 'https://wbsapi.withings.net/measure';

export function initFirebase() {
  if (!admin.apps.length) {
    const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(svc) });
  }
  return admin.firestore();
}

// Call the Withings OAuth2 token endpoint. `params` provides grant_type + code/refresh_token.
export async function withingsToken(params) {
  const body = new URLSearchParams({
    action: 'requesttoken',
    client_id: process.env.WITHINGS_CLIENT_ID,
    client_secret: process.env.WITHINGS_CLIENT_SECRET,
    ...params,
  });
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const j = await r.json();
  if (j.status !== 0) throw new Error('Withings token error: ' + JSON.stringify(j));
  return j.body; // { access_token, refresh_token, userid, expires_in }
}

// Fetch weight measurements (meastype 1) since `sinceEpoch`. Returns {date->lbs} (latest per day).
export async function fetchWeights(accessToken, sinceEpoch) {
  const body = new URLSearchParams({ action: 'getmeas', meastype: '1', category: '1', startdate: String(sinceEpoch) });
  const r = await fetch(MEAS_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const j = await r.json();
  if (j.status !== 0) throw new Error('Withings getmeas error: ' + JSON.stringify(j));
  const grps = (j.body.measuregrps || []).slice().sort((a, b) => a.date - b.date); // oldest first
  const byDate = {};
  for (const g of grps) {
    const m = (g.measures || []).find((x) => x.type === 1);
    if (!m) continue;
    const kg = m.value * Math.pow(10, m.unit);
    const lbs = Math.round(kg * 2.2046226 * 10) / 10;
    const d = new Date(g.date * 1000);
    const date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    byDate[date] = lbs; // later group (higher epoch) overwrites -> latest weigh-in of the day wins
  }
  return byDate;
}

// Resolve the single planner doc (or a specific uid via PLANNER_UID).
export async function plannerDocRef(db) {
  const uid = process.env.PLANNER_UID;
  if (uid) return db.doc('planners/' + uid);
  const col = await db.collection('planners').limit(1).get();
  if (col.empty) throw new Error('No planner document found. Sign in + import your seed first.');
  return col.docs[0].ref;
}
