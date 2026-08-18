import Phaser from 'phaser';
import type { TransitionScene, TransitionEffect } from './scenes/TransitionScene';

export type { TransitionEffect };

interface TransitionOpts {
  effect?: TransitionEffect;              // 'circle' | 'slide' | 'dissolve' (default dissolve)
  color?: number;
  ms?: number;
  focus?: { x: number; y: number };       // circle-iris centre
  onCovered?: () => void;                 // runs at full cover, before the scene switch
  loading?: boolean;                      // HOLD the cover (with "Loading") until the incoming scene finishes
}

/**
 * Switch scenes with a covering transition. The OUTGOING scene calls this; the
 * INCOMING scene calls {@link finishTransition} when it's ready to be shown (an 8s
 * safety uncovers regardless). Falls back to a plain `scene.start` if the overlay
 * scene isn't running yet.
 */
export function startTransition(from: Phaser.Scene, toKey: string, data: object = {}, opts: TransitionOpts = {}): void {
  const mgr = from.scene;
  const ts = mgr.get('TransitionScene') as TransitionScene | undefined;
  if (!ts || !mgr.isActive('TransitionScene')) {
    opts.onCovered?.();
    mgr.start(toKey, data);
    return;
  }
  ts.begin(from, toKey, data, opts);
}

/**
 * The incoming scene is ready — uncover. `onRevealed` (optional) runs once the reveal
 * animation fully completes — or immediately if there's no transition in progress (a
 * plain scene.start fallback), so a caller can chain an entrance animation reliably.
 */
export function finishTransition(scene: Phaser.Scene, onRevealed?: () => void): void {
  const ts = scene.scene.get('TransitionScene') as TransitionScene | undefined;
  if (ts?.isBusy()) ts.done(onRevealed);
  else onRevealed?.();
}

/**
 * Cover the screen with `effect`, then run `onCovered` and STOP (no scene switch,
 * no reveal). For return-to-title, which HARD-RELOADS the page — a reload (not a
 * Phaser scene restart) is used because the heavy game scene's instance is reused
 * across restarts and its state (gameReady, world collections…) wouldn't reset,
 * hanging the second entry on "loading". `onCovered` may be async (e.g. flush the
 * save, then `window.location.reload()`).
 */
export function coverAndReload(from: Phaser.Scene, effect: TransitionEffect, onCovered: () => void, ms?: number): void {
  const ts = from.scene.get('TransitionScene') as TransitionScene | undefined;
  if (!ts || !from.scene.isActive('TransitionScene')) { onCovered(); return; }
  ts.coverAndHold(effect, onCovered, { ms });
}

/**
 * Cover the screen, run `onCovered` at full cover (WITHOUT `scene.start` — the
 * caller does its own scene handoff there, e.g. pause one scene + launch another
 * OVER it), then WAIT for the incoming scene to call {@link finishTransition} to
 * uncover (an 8s safety uncovers regardless). This is the house enter/exit path:
 * entering pauses GameScene + launches HouseScene on top (island stays in memory,
 * so re-entry never hits the scene-reuse "stuck on loading" trap); exiting resumes
 * GameScene + stops HouseScene. Unlike {@link startTransition} it never shuts the
 * outgoing scene down; unlike {@link coverAndReload} it DOES reveal afterward.
 */
export function coverAndHandoff(from: Phaser.Scene, onCovered: () => void, opts: TransitionOpts = {}): void {
  const ts = from.scene.get('TransitionScene') as TransitionScene | undefined;
  if (!ts || !from.scene.isActive('TransitionScene')) { opts.onCovered = undefined; onCovered(); return; }
  ts.coverHandoff(onCovered, opts);
}
