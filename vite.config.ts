import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // relative paths, so the build works under any sub-path
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // Two pages: the game, and the gesture lab at /lab.html. The lab is a
      // measuring instrument, not a demo — it ships with the build so the
      // recogniser can be tuned on a real phone against the real browser, which
      // is the only place the numbers that matter come from.
      input: { main: 'index.html', lab: 'lab.html' },
      output: {
        // three and the physics WASM rarely change between game patches, so
        // splitting them lets the browser keep them cached across rebuilds.
        // Same reasoning as the 2D template's `phaser` chunk.
        manualChunks: {
          three: ['three'],
          physics: ['@dimforge/rapier3d-compat'],
        },
      },
    },
  },
});
