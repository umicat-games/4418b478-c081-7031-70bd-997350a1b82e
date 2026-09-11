import Phaser from 'phaser';
import { voiceSupported, startVoice, setVoiceHost, type VoiceSession } from './voice';
import { playSfx, SFX_CLICK } from './sfx';
import type { Umicat } from '@umicat/phaser-sdk';

// Reusable voice-input UI (mic button + pixel WhatsApp-style waveform + a
// "getting ready" / "transcribing" hint), extracted so the laptop chat and the
// in-game Cato chat share one implementation — including the iOS fixes that were
// painful to find (see catopia/CLAUDE.md "Voice input"):
//   • start/stop on POINTER-UP, not down (else Phaser's touch pointer wedges).
//   • input.addPointer(2) slack.
//   • the invisible hit rect re-does setOrigin after setSize.
//   • the wave bar height has NO bar-width floor.
//
// ONE context-aware button, drawn from ART: mic (idle, empty) → stop (recording)
// → send (idle, input has text). Textures are the round-button atlases
// 'round-mic' / 'round-send' / 'round-stop', each with `idle` + `pressed` frames.

const WAVE_COLOR = 0xffffff;   // pixel waveform — white

const WAVE_BARS = 22;
const PREPARING = { en: 'Getting ready', 'zh-CN': '准备中' };
const TRANSCRIBING = { en: 'Transcribing', 'zh-CN': '识别中' };

export interface VoiceGeom {
  micX: number; micY: number; micS: number;
  waveX0: number; waveY: number; waveW: number; waveH: number;
  timerX: number; fs: number;
}

export interface VoiceControlsOpts {
  lang: () => string;
  isZh: () => boolean;
  onTranscript: (text: string) => void;
  hasText?: () => boolean;
  onSend?: () => void;
  onRecordingChange?: (active: boolean) => void;
  fontFamily?: string;
  timerColor?: string;
}

export class VoiceControls {
  private icon: Phaser.GameObjects.Image;   // mic / stop / send (texture swap)
  private micHit: Phaser.GameObjects.Rectangle;
  private waveG: Phaser.GameObjects.Graphics;
  private timer: Phaser.GameObjects.Text;

  private geom: VoiceGeom = { micX: 0, micY: 0, micS: 24, waveX0: 0, waveY: 0, waveW: 1, waveH: 10, timerX: 0, fs: 16 };
  private recording = false;
  private preparing = false;
  private transcribing = false;
  private available = false;
  private voice?: VoiceSession;
  private waveBuf: number[] = [];
  private waveSampleAt = 0;
  private recStartMs = 0;
  private pendingTranscript = '';

  constructor(private scene: Phaser.Scene, private opts: VoiceControlsOpts) {
    const depth = 1_000_000;
    this.icon = scene.add.image(0, 0, 'round-mic', 'idle').setOrigin(0.5).setDepth(depth).setScrollFactor(0).setVisible(false);
    this.micHit = scene.add.rectangle(0, 0, 10, 10, 0, 0).setDepth(depth).setScrollFactor(0)
      .setInteractive({ useHandCursor: true }).setVisible(false);
    this.waveG = scene.add.graphics().setDepth(depth).setScrollFactor(0).setVisible(false);
    this.timer = scene.add.text(0, 0, '', { fontFamily: opts.fontFamily ?? 'sans-serif', color: opts.timerColor ?? '#26384a' })
      .setOrigin(0, 0.5).setDepth(depth).setScrollFactor(0).setVisible(false);

    scene.input.addPointer(2);
    // Press feedback on pointer-DOWN (cheap, no wedge); the ACTION runs on
    // pointer-UP (the iOS pointer-wedge fix — heavy work must not run mid-gesture).
    this.micHit.on('pointerdown', () => { this.icon.setFrame('pressed'); playSfx(scene, SFX_CLICK); });
    this.micHit.on('pointerup', () => { this.icon.setFrame('idle'); this.tap(); });
    this.micHit.on('pointerout', () => this.icon.setFrame('idle'));

    scene.events.on(Phaser.Scenes.Events.UPDATE, this.tick, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  setHost(u: Umicat | null): void { setVoiceHost(u); }
  supported(): boolean { return voiceSupported(); }
  get busy(): boolean { return this.recording || this.transcribing; }

  place(geom: VoiceGeom): void {
    this.geom = geom;
    const g = geom;
    this.applyIcon();
    this.icon.setPosition(g.micX, g.micY).setDisplaySize(g.micS * 1.4, g.micS * 1.4);
    const w = g.micS * 1.6, h = g.micS * 1.6;
    this.micHit.setPosition(g.micX, g.micY).setSize(w, h).setOrigin(0.5, 0.5);
    const ha = this.micHit.input?.hitArea;
    if (ha instanceof Phaser.Geom.Rectangle) ha.setTo(0, 0, w, h);
    this.timer.setFontSize(Math.round(g.fs * 0.95)).setPosition(g.timerX, g.micY);
    if (this.recording && this.voice && !this.preparing) this.drawWave();
  }

  /** Set the round-button texture (idle frame) for the current state: stop · send · mic. */
  private applyIcon(): void {
    const tex = this.recording ? 'round-stop' : this.opts.hasText?.() ? 'round-send' : 'round-mic';
    if (this.icon.texture.key !== tex) this.icon.setTexture(tex, 'idle');
  }

  showMic(v: boolean): void {
    this.available = v;
    if (!v && this.busy) this.cancelAll();
    this.icon.setVisible(v && !this.transcribing);
    this.micHit.setVisible(v);
    if (!v) { this.waveG.setVisible(false); this.timer.setVisible(false); }
  }

  private tap(): void {
    if (this.transcribing) return;
    if (this.recording) { this.stop(); return; }
    if (this.opts.hasText?.()) { this.opts.onSend?.(); return; }
    void this.start();
  }

  private async start(): Promise<void> {
    if (this.recording || this.transcribing || !this.available) return;
    this.recording = true;
    this.preparing = true;
    this.waveBuf = [];
    this.opts.onRecordingChange?.(true);
    this.applyIcon();               // → stop icon
    this.icon.setVisible(true);
    this.timer.setVisible(true);    // "准备中…" via tick
    const s = await startVoice(this.opts.lang(), {
      onFinal: (t) => { this.pendingTranscript = t; },
      onEnd: () => { if (this.transcribing) this.finishTranscribing(); else this.endRecordingNoTranscript(); },
    });
    if (!this.recording) { s?.cancel(); return; } // stop tapped during "getting ready"
    if (!s) { this.endRecordingNoTranscript(); return; }
    this.preparing = false;
    this.recStartMs = this.scene.time.now;
    this.voice = s;
    this.waveG.setVisible(true);
  }

  private stop(): void {
    if (!this.recording) return;
    this.recording = false;
    this.preparing = false;
    const v = this.voice; this.voice = undefined;
    if (!v) { this.endRecordingNoTranscript(); return; }
    this.transcribing = true;
    this.waveG.setVisible(false);
    this.icon.setVisible(false);
    this.timer.setVisible(true);    // "识别中…"
    v.stop();
  }

  private finishTranscribing(): void {
    if (!this.transcribing) return;
    this.transcribing = false;
    this.timer.setVisible(false);
    const t = this.pendingTranscript; this.pendingTranscript = '';
    this.restoreIdle();
    this.opts.onTranscript(t);
  }

  private endRecordingNoTranscript(): void {
    this.recording = false;
    this.preparing = false;
    this.transcribing = false;
    this.voice = undefined;
    this.timer.setVisible(false);
    this.waveG.setVisible(false);
    const t = this.pendingTranscript; this.pendingTranscript = '';
    this.restoreIdle();
    if (t) this.opts.onTranscript(t);
  }

  private cancelAll(): void {
    const v = this.voice; this.voice = undefined;
    this.recording = false; this.preparing = false; this.transcribing = false;
    v?.cancel();
    this.waveG.setVisible(false); this.timer.setVisible(false);
    this.opts.onRecordingChange?.(false);
  }

  private restoreIdle(): void {
    this.opts.onRecordingChange?.(false);
    if (this.available) { this.place(this.geom); this.icon.setVisible(true); }
  }

  private tick = (): void => {
    const now = this.scene.time.now;
    if (this.preparing) {
      const dots = 1 + (Math.floor(now / 350) % 3);
      this.timer.setText((this.opts.isZh() ? PREPARING['zh-CN'] : PREPARING.en) + '.'.repeat(dots));
      return;
    }
    if (this.recording) {
      if (this.voice && now - this.waveSampleAt >= 65) {
        this.waveSampleAt = now;
        this.waveBuf.push(this.voice.level());
        if (this.waveBuf.length > WAVE_BARS * 2) this.waveBuf.splice(0, this.waveBuf.length - WAVE_BARS * 2);
        this.drawWave();
      }
      const secs = Math.floor((now - this.recStartMs) / 1000);
      this.timer.setText(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`);
    }
    if (this.transcribing) {
      const dots = 1 + (Math.floor(now / 350) % 3);
      this.timer.setText((this.opts.isZh() ? TRANSCRIBING['zh-CN'] : TRANSCRIBING.en) + '.'.repeat(dots));
    }
  };

  /** Pixel waveform — chunky WHITE bars (no rounded corners), integer positions. */
  private drawWave(): void {
    const g = this.waveG; g.clear();
    const { waveX0: x0, waveY: y, waveW: w, waveH: h } = this.geom;
    const n = WAVE_BARS;
    const gap = Math.max(1, Math.round(w * 0.012));
    const bw = Math.max(1, Math.floor((w - gap * (n - 1)) / n));
    g.fillStyle(WAVE_COLOR, 1);
    for (let i = 0; i < n; i++) {
      const amp = this.waveBuf[this.waveBuf.length - n + i] ?? 0;
      const bh = Math.max(2, Math.round(Math.min(h, amp * h * 1.8)));
      const bx = Math.round(x0 + i * (bw + gap));
      g.fillRect(bx, Math.round(y - bh / 2), bw, bh);
    }
  }

  destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.tick, this);
    this.voice?.cancel();
    this.icon.destroy(); this.micHit.destroy(); this.waveG.destroy(); this.timer.destroy();
  }
}
