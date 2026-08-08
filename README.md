# teller

**teller.ink** — an in-person TTRPG companion. The table plays; teller
keeps the books.

Dice stay physical. Minis stay physical. The bookkeeping — initiative,
HP, conditions, party resources — goes on screens: a DM console, a
table display, and a per-player seat card that runs on anything with a
browser.

System-agnostic by construction: characters are generic primitives
(fields, counters, tags, notes) seeded by per-system templates that
carry structure and vocabulary, never rules text.

## Dev

```bash
pnpm install
cp .dev.vars.example .dev.vars
pnpm db:migrate:local
pnpm dev          # http://localhost:4525
```

## Deploy

```bash
pnpm db:migrate:remote   # first time + on new migrations
pnpm deploy              # builds the SPA + deploys worker to teller.ink
wrangler secret put DM_KEY   # first deploy only
```

See `CLAUDE.md` for architecture and the rules of the road.
