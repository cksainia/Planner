// firebase.js — thin wrapper over Firebase Auth + Firestore (CDN ESM).
// Config is injected via window.LP_FIREBASE (public-safe web keys, set in index.html).
// All personal data is protected by Firestore security rules (owner email only),
// NOT by hiding the config. Keep this file free of any personal content.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, onSnapshot, setDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

let app, auth, db, docRef;
let configured = false;

export function initFirebase() {
  const cfg = window.LP_FIREBASE;
  if (!cfg || !cfg.apiKey || cfg.apiKey.startsWith('REPLACE')) {
    console.warn('[firebase] not configured — running local-only');
    return false;
  }
  app = initializeApp(cfg);
  auth = getAuth(app);
  db = getFirestore(app);
  // single document per owner; owner id is derived from the signed-in uid
  configured = true;
  return true;
}

export function isConfigured() { return configured; }

export function onAuth(cb) {
  if (!configured) { cb(null); return () => {}; }
  return onAuthStateChanged(auth, cb);
}

export async function signIn(email, password) {
  if (!configured) throw new Error('Firebase not configured');
  // allow a bare username -> map to the owner email convention
  if (email && !email.includes('@')) email = email + '@planner.local';
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  return cred.user;
}

export async function signOutUser() { if (configured) await signOut(auth); }

// One doc per user: families/{uid}. Returns an unsubscribe fn.
export function watchDoc(uid, cb) {
  if (!configured) return () => {};
  docRef = doc(db, 'planners', uid);
  return onSnapshot(docRef, (snap) => cb(snap.exists() ? snap.data() : null),
    (err) => console.warn('[firebase] snapshot error', err));
}

export async function writeDoc(uid, data) {
  if (!configured) return;
  const ref = doc(db, 'planners', uid);
  // full-doc write (no merge): the cloudLoaded gate in store.js guarantees we
  // never push before we've read, so this can't clobber good cloud data.
  await setDoc(ref, { ...data, updatedAt: new Date().toISOString() });
}
