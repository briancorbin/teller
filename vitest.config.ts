// Standalone on purpose: vitest would otherwise load vite.config.ts and
// drag the Cloudflare plugin into a test run that owes it nothing. The
// core is headless node code; it tests as exactly that.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `scripts/` too: the pack converter's boundary parse is the one
    // place a printed statblock is read apart, and a grammar nothing
    // tests is a grammar that quietly stops matching the book.
    include: ['core/**/*.test.ts', 'server/**/*.test.ts', 'scripts/**/*.test.mjs'],
    environment: 'node',
  },
});
