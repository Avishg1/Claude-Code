import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./src/client', import.meta.url)),
  base: '/',
  build: {
    outDir: fileURLToPath(new URL('./dist/client', import.meta.url)),
    emptyOutDir: true,
    // No inline module-preload polyfill: keeps the bundle CSP-friendly (script-src 'self').
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
  },
});
