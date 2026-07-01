// voice.js — speech-to-text capture via the browser's Web Speech API.
// Transcription happens on-device / by the browser's speech service (no audio is
// sent to our own API). The resulting TEXT is then structured by Claude in
// ai.parseTasks(). Single-utterance: it auto-stops on a natural pause.

let rec = null;

export function voiceSupported() {
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// Start listening. Callbacks: onPartial(text) live, onFinal(text) once at the end,
// onError(code), onEnd(). Returns true if it started. Stops any in-flight session.
export function startListening({ onPartial, onFinal, onError, onEnd } = {}) {
  const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  if (!SR) { if (onError) onError('unsupported'); return false; }
  stopListening();
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
