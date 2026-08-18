// Standalone on purpose: vitest would otherwise load vite.config.ts and
// drag the Cloudflare plugin into a test run that owes it nothing. The
// core is headless node code; it tests as exactly that.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['core/**/*.test.ts', 'server/**/*.test.ts'],
    environment: 'node',
  },
});
