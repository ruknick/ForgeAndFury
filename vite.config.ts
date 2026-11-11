import { defineConfig } from 'vite';

const demo = process.env.VITE_DEMO === '1';

export default defineConfig({
  root: 'client',
  // The demo build is static and may be hosted under any path.
  base: demo ? './' : '/',
  publicDir: 'public',
  server: {
    host: true, // reachable from a phone on the same network
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: {
    outDir: demo ? '../dist-demo' : '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    // Demo: one JS bundle, so scripts/singlefile.mjs can inline everything into one HTML file.
    rollupOptions: demo ? { output: { inlineDynamicImports: true } } : undefined,
  },
});
