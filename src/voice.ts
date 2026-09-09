// Voice input for Catopia is now a thin shim over the SDK's GENERIC `umicat.voice`
// primitive (added so any game gets voice, not just this one). The SDK handles both
// paths: the browser's own `SpeechRecognition` in a browser, and — inside the native
// app's WKWebView, where that API doesn't exist — the platform recognizer via the
// host bridge. This file just holds the resolved Umicat handle so LaptopScene / the
// in-game chat don't each have to thread the instance through.
//
// Everything is still feature-detected: on a surface with no voice support,
// `voiceSupported()` is false and callers fall back to typing.

import { webVoiceSupported, type Umicat, type VoiceSession, type VoiceCallbacks } from '@umicat/phaser-sdk';

let host: Umicat | null = null;

/** Give the voice helpers the resolved Umicat handle. Call once after `Umicat.init()`. */
export function setVoiceHost(u: Umicat | null): void {
  host = u;
}

/**
 * True if voice input works here. Before the SDK handshake resolves we can only
 * best-effort from the browser (`webVoiceSupported`) — NATIVE-app support is known
 * only once `setVoiceHost` has run, so callers should re-check after `Umicat.init()`.
 */
export function voiceSupported(): boolean {
  return host ? host.voice.supported() : webVoiceSupported();
}

/** Start a voice session (→ null if unsupported / mic denied). */
export function startVoice(lang: string, cb: VoiceCallbacks): Promise<VoiceSession | null> {
  if (!host) return Promise.resolve(null); // recording only starts after init in practice
  return host.voice.start(lang, cb);
}

export type { VoiceSession };
