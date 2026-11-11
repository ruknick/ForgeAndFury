import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  publicDir: 'public',
  server: {
    host: true, // reachable from a phone on the same network
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
