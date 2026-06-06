import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // Use relative paths so it works when served under any sub-path
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Split Phaser into its own chunk — it rarely changes between game
        // patches, so the browser keeps it cached across rebuilds.
        // (Borrowed from the Phaser Editor Vite template.)
        manualChunks: { phaser: ['phaser'] },
      },
    },
  },
});
