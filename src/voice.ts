// Browser-native speech-to-text + a live mic amplitude (for a pixel waveform). NO server of ours:
// `SpeechRecognition` is the browser/OS's OWN built-in recognition (on Chrome/Android it routes to
// Google, on Safari to Apple dictation — either way it's the device's, not ours, and needs no API
// key). The amplitude for the waveform comes from a Web Audio `AnalyserNode` on a `getUserMedia`
// stream; recognition + analyser both tap the mic at once. Everything is FEATURE-DETECTED — on a
// browser/WebView without SpeechRecognition or mic access (Firefox, many embedded WebViews incl.
// iOS WKWebView), `voiceSupported()` is false / `startVoice()` returns null and callers fall back
// to typing.

type SRWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  webkitAudioContext?: typeof AudioContext;
};

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((ev: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

/** True if the browser can do speech-to-text (its own recognition) AND give us the mic. */
export function voiceSupported(): boolean {
  const w = window as SRWindow;
  const hasSR = !!(w.SpeechRecognition || w.webkitSpeechRecognition);
  const hasMic = !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');
  const secure = window.isSecureContext !== false; // getUserMedia needs a secure context (https)
  return hasSR && hasMic && secure;
}

export interface VoiceCallbacks {
  onPartial?: (text: string) => void; // interim transcript (updates live; may change)
  onFinal: (text: string) => void;    // the recognized text — fires once, on a clean stop
  onEnd: () => void;                   // recognition finished (always fires, after onFinal or on cancel/error)
  onError?: (kind: string) => void;   // 'not-allowed' | 'no-speech' | 'network' | 'start' | ...
}

export interface VoiceSession {
  level(): number; // 0..1 current mic loudness (RMS) — drive the waveform bars with this
  stop(): void;    // finish + transcribe (→ onFinal if there was speech)
  cancel(): void;  // abort with no transcript
}

/** Start a voice session. Resolves to a VoiceSession, or null if unsupported / mic denied. */
export async function startVoice(lang: string, cb: VoiceCallbacks): Promise<VoiceSession | null> {
  const w = window as SRWindow;
  const SRClass = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!SRClass || !navigator.mediaDevices?.getUserMedia) return null;

  // 1) Mic stream + analyser for the live waveform.
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    cb.onError?.('not-allowed'); // denied / no mic
    return null;
  }
  const AC = window.AudioContext || w.webkitAudioContext;
  const ctx = new AC();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);

  // 2) Speech recognition (the browser's own).
  const rec = new SRClass();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;

  let finalText = '';
  let cancelled = false;
  let ended = false;

  const cleanup = (): void => {
    try { rec.onresult = null; rec.onerror = null; } catch { /* ignore */ }
    try { stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    try { source.disconnect(); analyser.disconnect(); } catch { /* ignore */ }
    try { void ctx.close(); } catch { /* ignore */ }
  };

  rec.onresult = (ev): void => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i]!;
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    if (interim) cb.onPartial?.(interim);
  };
  rec.onerror = (ev): void => { if (!cancelled) cb.onError?.(ev.error || 'error'); };
  rec.onend = (): void => {
    if (ended) return;
    ended = true;
    cleanup();
    if (!cancelled) { const t = finalText.trim(); if (t) cb.onFinal(t); }
    cb.onEnd();
  };

  try {
    rec.start();
  } catch {
    cleanup();
    cb.onError?.('start');
    return null;
  }

  return {
    level(): number {
      try {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const x = (buf[i]! - 128) / 128; sum += x * x; }
        return Math.min(1, Math.sqrt(sum / buf.length) * 3.2); // speech is quiet → scale up
      } catch { return 0; }
    },
    stop(): void {
      try { rec.stop(); } catch {
        if (!ended) { ended = true; cleanup(); const t = finalText.trim(); if (t) cb.onFinal(t); cb.onEnd(); }
      }
    },
    cancel(): void {
      cancelled = true;
      try { rec.abort(); } catch { /* ignore */ }
      if (!ended) { ended = true; cleanup(); cb.onEnd(); }
    },
  };
}
