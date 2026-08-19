import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The core-next client — React, bundled (§E extended: the ladder).
// Separate config from the old world's vite.config.ts on purpose: that
// one carries the cloudflare plugin and serves the OLD app on 4525 as
// the visual reference. This builds client/ into server/dist, which
// the node server prefers over server/public when it exists.
export default defineConfig({
  root: 'client',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../server/dist',
    emptyOutDir: true,
  },
  server: {
    port: 4527,
    host: true, // LAN-exposed so seat cards can be tested from phones
    proxy: {
      // The node server owns /api, /files and the SSE stream; the
      // proxy streams SSE fine (http-proxy does not buffer).
      '/api': { target: process.env.TELLER_DEV ?? 'http://localhost:4526' },
      '/files': { target: process.env.TELLER_DEV ?? 'http://localhost:4526' },
    },
  },
});
