import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // relative paths, so the build works under any sub-path
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // three rarely changes between game patches, so splitting it lets the
        // browser keep it cached across rebuilds.
        manualChunks: { three: ['three'] },
      },
    },
  },
});
