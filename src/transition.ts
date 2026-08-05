import Phaser from 'phaser';
import type { TransitionScene, TransitionEffect } from './scenes/TransitionScene';

export type { TransitionEffect };

interface TransitionOpts {
  effect?: TransitionEffect;              // 'circle' | 'slide' | 'dissolve' (default dissolve)
  color?: number;
  ms?: number;
  focus?: { x: number; y: number };       // circle-iris centre
  onCovered?: () => void;                 // runs at full cover, before the scene switch
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

/** The incoming scene is ready — uncover. No-op if no transition is in progress. */
export function finishTransition(scene: Phaser.Scene): void {
  (scene.scene.get('TransitionScene') as TransitionScene | undefined)?.done();
}
