// Scripted-dialogue core — the AUTHORED (non-AI) conversation system: cutscenes,
// intros, tutorials. Deterministic, hand-written, i18n. Distinct from the runtime-AI
// free chat (umicat.ai.npc) — this plays a fixed node graph the creator authored.
//
// This module is the PORTABLE core (no Phaser): a script is a graph of nodes; the
// DialogueRunner walks it and calls a HOST (the game) to actually show lines /
// choices / spotlights and to read/write flags. Keeping it host-agnostic is
// deliberate — it's the shape we'll lift into an SDK primitive (`umicat.dialogue`)
// + a visual node-graph tool later; the game proves it first. The data format
// (`public/dialogue/*.json`) is the shared contract between runner, game, and tool.

/** A localized string: either a plain string or a per-locale map (`{ en, 'zh-CN' }`). */
export type LangText = string | Record<string, string>;

export interface DialogueLineNode {
  type: 'line';
  /** Speaker id (e.g. 'cato', 'player') — the host maps it to a name + portrait. */
  speaker?: string;
  /** Cato mood → portrait/emote (host maps via its emote table). */
  emote?: string;
  text: LangText;
  /** Free-form, game-interpreted key/values (the generic extension point):
   *  `{ spotlight: 'hotbar:hoe', sound: 'meow', … }`. Authored in the Dialogue tool. */
  data?: Record<string, string>;
  /** @deprecated legacy top-level convenience — read as a fallback for `data.spotlight`. */
  spotlight?: string;
  next?: string;
}
export interface DialogueChoiceNode {
  type: 'choice';
  speaker?: string;
  text?: LangText; // optional prompt shown above the options
  data?: Record<string, string>;
  options: Array<{ text: LangText; next?: string; set?: string }>;
}
export interface DialogueSetNode { type: 'set'; flag: string; value?: boolean; next?: string }
export interface DialogueIfNode { type: 'if'; flag: string; then?: string; else?: string }
export interface DialogueEndNode { type: 'end' }
export type DialogueNode = DialogueLineNode | DialogueChoiceNode | DialogueSetNode | DialogueIfNode | DialogueEndNode;

export interface DialogueScript {
  id: string;
  /** How it's launched — 'new-game' plays once on a fresh save; 'manual' = code calls it. */
  trigger?: 'new-game' | 'manual';
  start: string;
  nodes: Record<string, DialogueNode>;
}

/** The game implements this to render + persist for the runner. */
export interface DialogueHost {
  /** Show a spoken line; the host calls `runner.advance()` when the player continues.
   *  `focus` names an in-world object the camera should fly to (cinematic tool tour):
   *  'mailbox' | 'chest' | 'pad' | 'workstation' | 'cato' (null → back to Cato). */
  showLine(text: string, opts: { speaker?: string; emote?: string; spotlight?: string | null; focus?: string | null }): void;
  /** Show choices; the host calls `pick(i)` with the chosen option index. */
  showChoices(prompt: string | null, options: string[], pick: (i: number) => void): void;
  getFlag(flag: string): boolean;
  setFlag(flag: string, value: boolean): void;
  /** The script reached an end / fell off — tear down the cutscene UI. */
  finish(): void;
}

export class DialogueRunner {
  private current?: string;
  private done = false;

  constructor(
    private readonly script: DialogueScript,
    private readonly host: DialogueHost,
    private readonly tr: (t: LangText) => string,
  ) {}

  get isDone(): boolean { return this.done; }
  get id(): string { return this.script.id; }

  start(): void { this.go(this.script.start); }

  /** Player advanced past the current LINE → move to its `next` (choices advance via pick). */
  advance(): void {
    const n = this.current ? this.script.nodes[this.current] : undefined;
    if (n && n.type === 'line') this.go(n.next);
  }

  private go(id?: string): void {
    if (this.done) return;
    if (!id) return this.end();
    const n = this.script.nodes[id];
    if (!n) return this.end();
    this.current = id;
    switch (n.type) {
      case 'line':
        // spotlight now lives in `data.spotlight`; legacy top-level `spotlight` is a fallback.
        // `data.focus` names an in-world object the camera flies to (null → back to Cato).
        this.host.showLine(this.tr(n.text), { speaker: n.speaker, emote: n.emote, spotlight: (n.data?.spotlight ?? n.spotlight) ?? null, focus: n.data?.focus ?? null });
        return;
      case 'choice':
        this.host.showChoices(
          n.text ? this.tr(n.text) : null,
          n.options.map((o) => this.tr(o.text)),
          (i) => { const o = n.options[i]; if (o?.set) this.host.setFlag(o.set, true); this.go(o?.next); },
        );
        return;
      case 'set':
        this.host.setFlag(n.flag, n.value !== false);
        return this.go(n.next);
      case 'if':
        return this.go(this.host.getFlag(n.flag) ? n.then : n.else);
      case 'end':
      default:
        return this.end();
    }
  }

  private end(): void {
    if (this.done) return;
    this.done = true;
    this.host.finish();
  }
}

/** Resolve a LangText to the active locale, falling back to en → the first value. */
export function trDialogue(text: LangText, lang: string): string {
  if (typeof text === 'string') return text;
  if (!text) return '';
  return text[lang] ?? text.en ?? Object.values(text)[0] ?? '';
}
