# teller

**teller.ink** — an in-person TTRPG companion. The table plays; teller
keeps the books.

## The thesis (load-bearing — every feature decision derives from it)

> Anything players physically touch stays physical (dice, minis, 3D
> terrain). Anything that's bookkeeping goes virtual (initiative, HP,
> statuses, fog, ambience). **The humans at the table are the rules
> engine.**

teller exists because Foundry/Arkenforge are built for *remote* play
(simulation engines), and D&D Beyond is slow and not-quite-right. An
in-person tool is presentation + bookkeeping software, not a rules
simulator.

## Relationship to the-shed-next

Standalone on purpose (the sidewalk precedent): own repo, own infra,
own auth, no `@shed/*` imports ever. Patterns are COPIED from the shed
(DO + SSE + role clients from gameday, worker-row serializers, D1
habits) — never imported. Duplication between repos with different
futures is insulation, not debt. Open-sourcing someday is plausible;
keep the repo clean of personal-infra references.

## Stack

Single package (no workspace): Vite + React + Tailwind v4 +
`@cloudflare/vite-plugin`. One Cloudflare Worker (`worker/`) serves the
SPA (`src/`) as static assets and the `/api/*` routes; `CampaignDO`
(Durable Object, SQLite-backed) holds live session state; D1 (`teller`)
holds durable data. Domain: `teller.ink` via Workers custom domain
(route auto-manages DNS on deploy; zone is on Cloudflare).

- `pnpm dev` — Vite dev server (port 4525) with the worker + local D1/DO.
- `pnpm db:migrate:local` / `db:migrate:remote` — D1 migrations.
- `pnpm typecheck` / `pnpm build` / `pnpm deploy`.
- Secrets: `DM_KEY` (`.dev.vars` locally, `wrangler secret put` in prod).

## RULES — settled decisions; don't re-litigate

### 1. Track, don't compute — override IS the architecture

Every stat is a stored, hand-entered value. There is NO rules engine. If
one ever exists, it only *proposes* defaults into the same slots; the
stored value stays authoritative. Never build automation that a human
can't override by just typing a number.

### 2. Generic primitives, not game concepts

The character model is: `fields` (key/label/value), `counters`
({name, current, max}), `tags`, `notes`. HP, spell slots, Prestige, ammo,
ki — ALL are counters. Conditions are tags. Do not add a game-specific
column or type (no `hp`, no `spellSlots`). Counters can belong to a
character or to the campaign (party resources).

### 3. Every mutation appends to the event log

`events` (D1) gets a row for every state change: who, what, payload.
This is the seed for undo / combat log / history. Never mutate without
logging.

### 4. System templates are data, never code — and never rules text

A template (`worker/templates.ts`) = structure + vocabulary (field
lists, counter names, "Warden" vs "DM"). NEVER rules content: no spell
descriptions, no stat blocks, no game text. This is the IP bright line
and what makes community templates safe. Templates are starting kits —
after creation, everything is editable and the template is irrelevant.
Every template carries `system` + `version` from day one.

### 5. Turn order is a manually ordered list — hard commitment

teller never models any system's initiative *mechanics* (rolls, cards,
popcorn). The table determines order physically; the DM drags the list
to match. Output is always "an ordered list + current index"; that's
universal across systems.

### 6. Web-first; hardware is optional flare

Four client surfaces, all browsers on the same worker:
- `/dm/:campaignId` — DM console (authoritative controls)
- `/table/:campaignId` — table TV renderer (passive, player-safe)
- `/board/:campaignId` — vertical player-facing companion display in
  front of the DM (passive, player-safe: consumes only the `/public`
  endpoint — seat tokens + notes stripped, NPC numbers never shown)
- `/seat/:characterId?token=…` — per-player card (self-serve counters)

Seats run on phones first; the custom rail panels (12.6" 1920×515 touch
bars + Pi kiosks on the Wyrmwood rail — see project memory) are just
dedicated hardware for the same URLs. Nothing may ever *require* the
panels or the table TV. Seat UI must work as a short-and-wide strip
(~1920×515) AND as a phone portrait card.

### 7. Auth: DM key + seat claims — no accounts

DM mutations require `x-teller-key` (= `DM_KEY` secret). A seat is a
claim, not an account: knowing a character's `seatToken` = being that
character. Seat tokens are never patchable via the API. No user tables,
no OAuth, no sessions — this is a home game. (SSE streams are
unauthenticated in v0: they carry initiative labels only. Keep secrets
out of the stream.)

### 8. Schema: few real columns + JSON `data` blob

Promote a blob key to a column only when a query needs it. Raw D1 rows
never cross the API boundary — per-resource serializers in
`worker/db.ts` (`toCampaign`, `toCharacter`) parse/coerce.

## Deferred on purpose (documented so they aren't re-invented badly)

- Battlemap / scenes / fog on the table TV (phase 2 — canvas work;
  calibrated true-1-inch grid is a launch requirement THERE, since
  physical minis and terrain must fit squares).
- Tokens (deliberately dumb when they come: image, position, size — no
  vision, no auras). Tokens may be linked to a character
  (`characterId`), which unlocks **reactive tile effects**: because the
  table client already receives session + character state over SSE, the
  map can react to bookkeeping with zero new plumbing — pulsing glow
  under the tile of whoever's turn it is, wound/blood states when a
  linked character drops below HP thresholds, condition auras. This
  works for PHYSICAL minis too: a position-tracked square lights up
  UNDER the physical mini standing on the glass (state is virtual,
  action is physical — the map is the ground, the effects are the
  bookkeeping made visible). Effects are pure render-layer on the
  table client; no new data model beyond token positions.
- SRD content import, character builder, level-up wizard.
- Community template distribution (v0 of that is a GitHub repo of JSON,
  not a platform).
