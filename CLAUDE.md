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

Rules CONTENT has a sanctioned home: **rules packs** — JSON uploaded
to the instance's `packs` table, searchable from the console's Rules
panel. Pack files live in `packs/` locally and are gitignored:
rulebook text is personal-use data in a private DB, never repo
content. See `packs/README.md` for the format.

### 5. Turn order is a manually ordered list — hard commitment

teller never models any system's initiative *mechanics* (rolls, cards,
popcorn). The table determines order physically; the DM drags the list
to match. Output is always "an ordered list + current index"; that's
universal across systems.

### 6. Web-first; hardware is optional flare

**There is ONE url.** Every screen — phone, tablet, table TV, rail
panel — loads `teller.ink`, shows a pairing code, and the DM types that
code into their console to adopt it. What a screen *is* is an
assignment the DM makes and changes at will; no surface is addressable
by URL and nothing is provisioned per-device. A Pi kiosk boots to the
same address forever.

The direction matters: the screen shows the code and the DM types it,
so the dumbest panel in the room needs no keyboard.

Roles a screen can be assigned:
- `console` — the DM console, with all the authority that implies.
  `params.pane` narrows it to one slice (session · map · characters ·
  library · displays); one pane per panel is the digital DM screen.
- `table` — the table TV renderer (passive, player-safe).
  **The table is the GROUND, nothing else**: the active scene
  full-bleed (+ grid overlay), or idle branding. No bookkeeping, no
  notices, and NO controls of any kind — even display-ish settings
  (grid calibration) are driven from the console and arrive over SSE.
  Passive surfaces never grow buttons.
- `board` — vertical player-facing companion display in front of the
  DM (passive, player-safe: consumes only the `/public` endpoint —
  notes stripped, NPC numbers never shown)
- `art` — fullscreen frame for the active handout (passive,
  player-safe: public snapshot only)
- `seat` — one player's own card (self-serve counters), for the one
  character it was pointed at
- `badge` — outward-facing per-player display (passive, player-safe:
  public snapshot only) — the table-facing back panel of a rail unit
- `blank` — claimed, no job yet

Identify (flash a screen's name and colour) is console-driven over SSE
— the sanctioned way anything reaches a passive surface.

Seats run on phones first; the custom rail panels (12.6" 1920×515 touch
bars + Pi kiosks on the Wyrmwood rail — see project memory) are just
dedicated hardware doing the same thing. Nothing may ever *require* the
panels or the table TV. Seat UI must work as a short-and-wide strip
(~1920×515) AND as a phone portrait card.

### 7. Auth: one key, and assignments — no accounts, no other secrets

**There is exactly one secret in teller: `DM_KEY`.** It is the root of
trust and the only thing that ever confers authority by being known.
Everything else is an assignment: the server looks up what a display
was assigned and allows exactly that. A `console` screen has full power
over *its own campaign*; a `seat` screen may edit *its one character*
and no other; passive screens may only receive the player-safe
snapshot. Authorization is role-derived — never re-derive it from a
secret the client holds.

This replaces seat tokens, which are gone: a seat used to be "whoever
knows this string", carried in a shareable URL that never expired. It's
now "whoever the DM pointed at this character", revocable from the
console.

The one irreducible asymmetry: something must hold the key first,
because a console can't be assigned by a console that doesn't exist
yet. That's the DM's own device, unlocked at the same single URL.

A display's `id` is capability-bearing — it's what the server checks —
so it's high-entropy, lives only in that device's storage, and is never
rendered. The **pairing code** is the opposite: short, readable across
a room, short-lived, and it only ever means "adopt this screen", never
"grant this power". Where a screen must be named in a URL (the SSE
stream can't send headers), use its **handle** — `sha-256(id)`, which
identifies but never authorises.

No user tables, no OAuth, no sessions — this is a home game. (SSE
streams are unauthenticated in v0: they carry initiative labels only.
Keep secrets out of the stream.)

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
