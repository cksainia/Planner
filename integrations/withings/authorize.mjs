// authorize.mjs — RUN LOCALLY ONCE to bootstrap the Withings connection.
//
//   node authorize.mjs            -> prints the authorization URL
//   node authorize.mjs <code>     -> exchanges the code, saves the refresh token to Firestore
//
// Env needed: WITHINGS_CLIENT_ID, WITHINGS_CLIENT_SECRET, FIREBASE_SERVICE_ACCOUNT
// (or a local ./service-account.json). Optional: WITHINGS_REDIRECT (defaults to the live app).
import fs from 'fs';
import { withingsToken } from './lib.mjs';
import admin from 'firebase-admin';

const REDIRECT = process.env.WITHINGS_REDIRECT || 'https://cksainia.github.io/Planner/';
const code = process.argv[2];

if (!code) {
  const url = 'https://account.withings.com/oauth2_user/authorize2?response_type=code'
    + '&client_id=' + encodeURIComponent(process.env.WITHINGS_CLIENT_ID || 'SET_WITHINGS_CLIENT_ID')
    + '&scope=user.metrics'
    + '&redirect_uri=' + encodeURIComponent(REDIRECT)
    + '&state=planner';
  console.log('\n1) Open this URL, sign in to Withings and approve:\n\n' + url
    + '\n\n2) You will be redirected to ' + REDIRECT + '?code=XXXX&state=planner'
    + '\n   Copy the code value from the address bar and run:\n\n   node authorize.mjs <code>\n');
  process.exit(0);
}

if (!process.env.FIREBASE_SERVICE_ACCOUNT && fs.existsSync('./service-account.json')) {
  process.env.FIREBASE_SERVICE_ACCOUNT = fs.readFileSync('./service-account.json', 'utf8');
}
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}

const tok = await withingsToken({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT });
await admin.firestore().doc('integrations/withings').set(
  { refresh_token: tok.refresh_token, userid: tok.userid, updatedAt: new Date().toISOString() },
  { merge: true },
);
console.log('✓ Saved Withings refresh token to Firestore (integrations/withings). The scheduled sync can now run.');
