// voice.js — speech-to-text capture via the browser's Web Speech API.
// Transcription happens on-device / by the browser's speech service (no audio is
// sent to our own API). The resulting TEXT is then structured by Claude.
//
// Two modes:
//  * startListening  — single utterance for short fields (quick-add, win, title):
//    auto-stops on a natural pause. Convenient for one-liners.
//  * startDictation  — long-form for the chat/debrief: keeps listening through
//    pauses (auto-restarts the recognizer when the browser times it out), streams
//    the accumulated transcript, and only finishes when the user taps stop or
//    says an end phrase ("Claude, I'm done" / "that's my dump" / …).

let rec = null;   // single-utterance session
let dict = null;  // long-form dictation session

export function voiceSupported() {
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// Start listening. Callbacks: onPartial(text) live, onFinal(text) once at the end,
// onError(code), onEnd(). Returns true if it started. Stops any in-flight session.
export function startListening({ onPartial, onFinal, onError, onEnd } = {}) {
  const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  if (!SR) { if (onError) onError('unsupported'); return false; }
  stopListening();
  stopDictationSilently();
  rec = new SR();
  rec.lang = 'en-US';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let finalText = '';
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += t + ' '; else interim += t;
    }
    if (onPartial) onPartial((finalText + interim).replace(/\s+/g, ' ').trim());
  };
  rec.onerror = (e) => { if (onError) onError((e && e.error) || 'error'); };
  rec.onend = () => { rec = null; if (onFinal) onFinal(finalText.replace(/\s+/g, ' ').trim()); if (onEnd) onEnd(); };
  try { rec.start(); return true; }
  catch (e) { rec = null; if (onError) onError('start-failed'); return false; }
}

export function stopListening() { if (rec) { try { rec.stop(); } catch (e) {} } }
export function isListening() { return !!rec; }

// ---------- long-form dictation ----------

// Spoken end-of-dump phrases, only honoured at the very END of the transcript.
// "claude" variants cover common mis-transcriptions (cloud/clod).
const END_RE = /(?:\b(?:ok(?:ay)?|alright)[,.\s]+)?(?:\b(?:claude|cloud|clod)[,.!\s]*)?\b(?:i\s*am\s+done|i'?m\s+done(?:\s+(?:with|giving)\s+(?:my|the)\s+dump)?|i'?m\s+finished|that'?s\s+(?:it|all|my\s+dump)|end\s+of\s+(?:my\s+)?dump|dump\s+(?:is\s+)?over|over\s+to\s+you)\b[\s.!,?]*$/i;

// Pure helper (unit-tested): does the transcript end with an end phrase?
// Returns { done, text } with the phrase stripped when found.
export function stripEndPhrase(t) {
  t = String(t || '').replace(/\s+/g, ' ').trim();
  const m = t.match(END_RE);
  if (!m) return { done: false, text: t };
  return { done: true, text: t.slice(0, m.index).trim().replace(/[,;\s]+$/, '') };
}

// Start a dictation session. onUpdate(text) streams the accumulated transcript
// (finalized + interim); onDone(text) fires exactly once — when stopDictation()
// is called or the user speaks an end phrase; onError(code, textSoFar) on fatal
// errors (textSoFar = everything captured before it died, so nothing is lost).
// `seed` = text already in the box (a recovered draft or typed prefix) — the
// session continues from it instead of overwriting it.
// The recognizer is restarted automatically whenever the browser ends it on a
// pause, and again when the app returns from the background (screen unlock,
// app switch) — mobile OSes kill the mic while hidden, but the session and its
// transcript survive and listening resumes on return.
export function startDictation({ onUpdate, onDone, onError, seed = '' } = {}) {
  const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  if (!SR) { if (onError) onError('unsupported', String(seed || '').trim()); return false; }
  stopListening();
  stopDictationSilently();

  const session = { finals: [], active: true, r: null, done: false, onVis: null };
  if (seed && String(seed).trim()) session.finals.push(String(seed).replace(/\s+/g, ' ').trim());
  const fullText = () => session.finals.join(' ').replace(/\s+/g, ' ').trim();
  const cleanup = () => {
    if (session.onVis && typeof document !== 'undefined') document.removeEventListener('visibilitychange', session.onVis);
    session.onVis = null;
  };
  const finish = (text) => {
    if (session.done) return;
    session.done = true;
    session.active = false;
    if (dict === session) dict = null;
    cleanup();
    try { if (session.r) session.r.stop(); } catch (e) {}
    if (onDone) onDone(text);
  };
  session.finish = () => finish(stripEndPhrase(fullText()).text);
  session.cleanup = cleanup;
  const fatal = (code) => {
    if (session.done) return;
    session.done = true;
    session.active = false;
    if (dict === session) dict = null;
    cleanup();
    if (onError) onError(code, stripEndPhrase(fullText()).text);
  };
  const retry = (ms) => setTimeout(() => { if (session.active && dict === session) spin(); }, ms);

  const spin = () => {
    let r;
    try { r = new SR(); } catch (e) { fatal('start-failed'); return; }
    session.r = r;
    r.lang = 'en-US';
    r.interimResults = true;
    r.continuous = true;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      if (session.r !== r || !session.active) return; // stale recognizer
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) session.finals.push(res[0].transcript.trim());
        else interim += res[0].transcript;
      }
      const chk = stripEndPhrase(fullText());
      if (chk.done) { finish(chk.text); return; }
      if (onUpdate) onUpdate((fullText() + (interim ? ' ' + interim : '')).trim());
    };
    r.onerror = (e) => {
      if (session.r !== r) return;
      const code = (e && e.error) || 'error';
      // transient: silence, our own restarts, flaky network/audio — onend restarts us
      if (code === 'no-speech' || code === 'aborted' || code === 'network' || code === 'audio-capture') return;
      // backgrounded (screen lock / app switch): the OS cut the mic. Keep the
      // session and transcript alive; the visibility handler resumes on return.
      if (typeof document !== 'undefined' && document.hidden) return;
      fatal(code);
    };
    // The browser ends recognition after a few seconds of silence even in
    // continuous mode — restart while the session is alive so pauses are free.
    r.onend = () => {
      if (session.r !== r) return;
      if (session.active && dict === session) retry(150);
    };
    try { r.start(); } catch (e) { retry(1000); }
  };

  if (typeof document !== 'undefined') {
    session.onVis = () => {
      if (!document.hidden && session.active && dict === session) {
        try { if (session.r) session.r.stop(); } catch (e) {}
        spin();
      }
    };
    document.addEventListener('visibilitychange', session.onVis);
  }

  dict = session;
  spin();
  return true;
}

// Finish the current dictation (fires onDone with the accumulated transcript).
export function stopDictation() { if (dict) dict.finish(); }
// Abandon a dictation without firing onDone (used when switching modes).
function stopDictationSilently() {
  if (!dict) return;
  const s = dict;
  dict = null;
  s.done = true; s.active = false;
  if (s.cleanup) s.cleanup();
  try { if (s.r) s.r.stop(); } catch (e) {}
}
export function isDictating() { return !!dict; }
