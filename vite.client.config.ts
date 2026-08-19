import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The core-next client — React, bundled (§E extended: the ladder).
// Separate config from the old world's vite.config.ts on purpose: that
// one carries the cloudflare plugin and serves the OLD app on 4525 as
// the visual reference. This builds client/ into server/dist, which
// the node server prefers over server/public when it exists.

const runtimeEntries = {
  'runtime-react': fileURLToPath(new URL('client/runtime/react.ts', import.meta.url)),
  'runtime-jsx-runtime': fileURLToPath(
    new URL('client/runtime/jsx-runtime.ts', import.meta.url),
  ),
  'runtime-teller': fileURLToPath(new URL('client/runtime/teller.ts', import.meta.url)),
};

// The rung-4 import map (§E UN-DEFERRED) lives as a literal
// <script type="importmap"> in client/index.html, mapping 'react',
// 'react/jsx-runtime' and 'teller' to `/runtime-react.js` etc — the
// same urls in BOTH dev and prod, so the html file needs no forking:
//
// PROD: the three runtime-*.ts entries above ride the SAME rollup
// build as the app itself (see build.rollupOptions.input below) —
// that's what makes "one React instance" true: Rollup dedupes the
// 'react' module into a chunk both `main` and `runtime-react` share,
// rather than each entry bundling its own copy. `entryFileNames` keeps
// their OUTPUT names stable (unhashed) so index.html's import map
// never has to change between builds.
//
// DEV: `pnpm client:dev` never runs the bundler, so there's no built
// `/runtime-react.js` file to serve statically. This plugin's dev
// middleware answers those same urls anyway: it maps each to its
// `client/runtime/*.ts` source and calls Vite's own
// `server.transformRequest()` — the identical TS-module transform
// Vite would apply if a `<script type="module">` requested that file
// directly (module-graph resolution, HMR wiring and all). One url,
// one meaning, either way the client is served — no separate dev-mode
// import map to keep in sync.
const DEV_SOURCE: Record<string, string> = {
  '/runtime-react.js': '/runtime/react.ts',
  '/runtime-jsx-runtime.js': '/runtime/jsx-runtime.ts',
  '/runtime-teller.js': '/runtime/teller.ts',
};

function panelRuntimeDevPlugin(): Plugin {
  return {
    name: 'teller-panel-runtime-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0];
        const source = url ? DEV_SOURCE[url] : undefined;
        if (!source) return next();
        try {
          const result = await server.transformRequest(source);
          if (!result) return next();
          res.setHeader('Content-Type', 'text/javascript');
          res.end(result.code);
        } catch (err) {
          next(err instanceof Error ? err : new Error(String(err)));
        }
      });
    },
  };
}

export default defineConfig({
  root: 'client',
  plugins: [react(), tailwindcss(), panelRuntimeDevPlugin()],
  build: {
    outDir: '../server/dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('client/index.html', import.meta.url)),
        ...runtimeEntries,
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name.startsWith('runtime-') ? '[name].js' : 'assets/[name]-[hash].js',
      },
    },
  },
  server: {
    port: 4527,
    host: true, // LAN-exposed so seat cards can be tested from phones
    proxy: {
      // The node server owns /api, /files and the SSE stream; the
      // proxy streams SSE fine (http-proxy does not buffer).
      '/api': { target: process.env.TELLER_DEV ?? 'http://localhost:4526' },
      '/files': { target: process.env.TELLER_DEV ?? 'http://localhost:4526' },
      '/panel-code': { target: process.env.TELLER_DEV ?? 'http://localhost:4526' },
      // …and the pack's, including the generated `/pack-code/system.js`
      // the import map points `system` at (§L phase 2).
      '/pack-code': { target: process.env.TELLER_DEV ?? 'http://localhost:4526' },
    },
  },
});
