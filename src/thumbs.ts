import * as THREE from 'three';

/**
 * A picture of a tower, made from the tower.
 *
 * The hotbar used emoji — 🏹 for the ballista, 🏰 for the bastion, 🔮 for the
 * spire — which are three problems at once. An emoji is a different drawing in
 * every platform's font. None of them is the thing you are about to place; the
 * bastion is a cannon on masonry and the glyph was a Japanese castle. And they
 * go stale silently: swap a model and the picture of it keeps saying whatever
 * it always said.
 *
 * So the icon IS the model, rendered once at boot into a data URL. Change the
 * model and the icon changes with it, because there is nothing else to change.
 *
 * Rendered with the GAME's renderer into an offscreen target rather than a
 * second WebGL context: a second context on the same page is a second set of
 * every shader and buffer, and browsers cap how many can exist at all.
 */

const SIZE = 128;

export interface ThumbMaker {
  /** A transparent PNG data URL of `obj`, framed and lit. */
  make(obj: THREE.Object3D): string;
  dispose(): void;
}

export function createThumbMaker(renderer: THREE.WebGLRenderer): ThumbMaker {
  const target = new THREE.WebGLRenderTarget(SIZE, SIZE, {
    // The hotbar cell has its own background; the icon has to sit on it rather
    // than in a grey box.
    format: THREE.RGBAFormat,
    colorSpace: THREE.SRGBColorSpace,
  });
  const scene = new THREE.Scene();
  // Bright and frontal, not the board's sun: this is a catalogue photograph,
  // and a tower lit from the side at eight in the morning is half in shadow.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 2.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.0);
  key.position.set(2, 3, 4);
  scene.add(key);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);

  const buf = new Uint8Array(SIZE * SIZE * 4);
  const cv = document.createElement('canvas');
  cv.width = SIZE; cv.height = SIZE;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(SIZE, SIZE);

  return {
    make(obj: THREE.Object3D): string {
      scene.add(obj);
      obj.position.set(0, 0, 0);
      obj.rotation.set(0, 0, 0);
      obj.updateMatrixWorld(true);

      // Frame it on what it MEASURES, not on a number typed in here: these
      // range from a ballista under a metre to a spire on three sections of
      // masonry, and one fixed zoom makes the small ones specks.
      const box = new THREE.Box3().setFromObject(obj);
      const size = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());
      const reach = Math.max(size.x, size.y, size.z) * 0.72 + 0.05;

      // Three-quarter view, slightly above: the angle a thing is drawn at in a
      // catalogue, and the one the board itself is seen from.
      const dir = new THREE.Vector3(1, 0.78, 1.25).normalize();
      camera.position.copy(centre).addScaledVector(dir, reach * 4);
      camera.lookAt(centre);
      camera.left = -reach; camera.right = reach;
      camera.top = reach; camera.bottom = -reach;
      camera.near = 0.01; camera.far = reach * 9;
      camera.updateProjectionMatrix();

      const prevTarget = renderer.getRenderTarget();
      const prevAlpha = renderer.getClearAlpha();
      renderer.setRenderTarget(target);
      renderer.setClearAlpha(0);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, buf);
      renderer.setRenderTarget(prevTarget);
      renderer.setClearAlpha(prevAlpha);
      scene.remove(obj);

      // A render target is bottom-up and a canvas is top-down, so the rows go
      // back in reverse or every tower is upside down.
      for (let y = 0; y < SIZE; y++) {
        const src = (SIZE - 1 - y) * SIZE * 4;
        img.data.set(buf.subarray(src, src + SIZE * 4), y * SIZE * 4);
      }
      ctx.putImageData(img, 0, 0);
      return cv.toDataURL('image/png');
    },
    dispose(): void {
      target.dispose();
    },
  };
}
