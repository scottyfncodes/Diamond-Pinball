import { defineConfig } from 'vite';

// Deployed to GitHub Pages at https://scottyfncodes.github.io/Diamond-Pinball/
// so every asset must be resolved relative to the repository sub-path.
export default defineConfig({
  base: '/Diamond-Pinball/',
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
  },
});
