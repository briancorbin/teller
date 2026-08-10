# teller

An in-person TTRPG companion. The table plays; teller keeps the books.

**teller runs on the table's own machine.** One person types `teller
host`, and every other screen in the room opens the address it prints.
`teller.ink` is where you get the software — a landing page, not the
place anyone plays.

## The thesis (load-bearing — every feature decision derives from it)

> Anything players physically touch stays physical (dice, minis, 3D
> terrain). Anything that's bookkeeping goes virtual (initiative, HP,
> statuses, fog, ambience). **The humans at the table are the rules
> engine.**

teller exists because Foundry/Arkenforge are built for *remote* play
(simulation engines), and D&D Beyond is slow and not-quite-right. An
in-person tool is presentation + bookkeeping software, not a rules
simulator.

**Prep is in scope** (Brian, 2026-08-09). The thesis governs PLAY — what
happens at the table stays physical — but building encounters, bestiaries
and reference libraries beforehand is a fair thing for teller to grow
into, and it feeds the table rather than competing with it. What stays
out is unchanged and is what actually matters: no rules engine (rule 1),
and no rules CONTENT in the repo or distributed to anyone (rule 4).
Reference and prep live per-instance, in the DM's own books.

## Relationship to the-shed-next

Standalone on purpose (the sidewalk precedent): own repo, own infra,
own auth, no `@shed/*` imports ever. Patterns are COPIED from the shed
(DO + SSE + role clients from gameday, worker-row serializers, D1
habits) — never imported. Duplication between repos with different
futures is insulation, not debt. Open-sourcing someday is plausible;
keep the repo clean of personal-infra references.

## Stack

Single package (no workspace): Vite + React + Tailwind v4 +
`@cloudflare/vite-plugin`. `worker/` serves the SPA (`src/`) as static
assets plus the `/api/*` routes; `CampaignDO` holds live session state;
a SQL database holds durable data.

**One codebase, two runtimes, and no fork.** The same built bundle runs
on Cloudflare Workers and on Node. The Cloudflare coupling was only ever
three things — `env.ASSETS.fetch`, one `crypto.subtle` call, and the
Durable Object — so `host/*.mjs` supplies each of them against
`node:sqlite` and the local disk: `d1.mjs`, `r2.mjs`, `durable.mjs`,
`assets.mjs`. **Keep route handlers runtime-agnostic or this dies.** No
`env.` API that only one runtime has, reached for directly from a route.

The local runtime is the one that matters (`bin/teller` → `host/cli.mjs`):

- `teller host [path]` — serve this table. `--data` (default `~/.teller`)
  or a bare path, so a campaign can live on a stick you carry.
- `teller key` / `teller where` / `teller version`.

Data lives in `~/.teller/`: `teller.db`, `books/` (PDFs named by content
hash), `map/`, `dm.key`.

- `pnpm dev` — Vite dev server (port 4525) with the worker + local D1/DO.
- `pnpm db:migrate:local` / `db:migrate:remote` — D1 migrations. The host
  applies the same `migrations/` on boot.
- `pnpm typecheck` / `pnpm build` / `pnpm pack` (installable tarball).
- Secrets: `DM_KEY` (`.dev.vars` locally; on a host, `~/.teller/dm.key`,
  minted on first run).

The Cloudflare deployment still exists (worker `teller`, D1 `teller`, R2
`teller-maps`, custom domain) and is where the landing page will live.
It is no longer where play happens.

## Design docs — read before touching their subject

- **`docs/BATTLEMAP.md`** — everything map-related, and it describes what
  actually SHIPPED: coordinate spaces, scale, the calibrated 1-inch grid,
  tokens, fog, hidden-means-stripped. Scenes, fog and tokens are built;
  don't design them again from this file.
- **`packs/README.md`** — the pack format. The JSON itself is gitignored.

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

The `events` table gets a row for every state change: who, what,
payload. Never mutate without logging.

It is already load-bearing: `/undo` walks it backward, writing a
`revert` event pointing at what it undid, so repeated undos keep
stepping back instead of fighting each other. What doesn't exist yet is
a *readable* combat log or history for the DM (TEL-5) — the data is
there, nothing renders it.

### 4. System templates are data, never code — and never rules text

A template = structure + vocabulary (field lists, counter names,
"Warden" vs "DM"). NEVER rules content: no spell descriptions, no stat
blocks, no game text. This is the IP bright line and what makes
community templates safe. Templates are starting kits — after creation,
everything is editable and the template is irrelevant. Every template
carries `system` + `version` from day one.

Templates live in the **`systems` table** (migration 0007), not in code.
`worker/templates.ts` is a *seed* — `seedSystems` inserts with `INSERT
OR IGNORE`, so a counter someone renamed survives the next reboot
(rule 1). A system added by a person and a system that shipped with
teller are the same kind of thing and neither outranks the other.

### 4a. A pack is the unit of content

Rules CONTENT has a sanctioned home: **packs** — JSON uploaded to the
instance's `packs` table. A pack carries the distilled rulings that come
up mid-game AND the bestiary that goes with them; the campaign's foe
list is the pack catalogue merged with the campaign's own, campaign
winning on an id collision.

A pack works with **no PDF at all**. A book is optional enrichment,
attached by content hash: a book's id is `bok_` + sha-256 of its own
bytes, so two people who own the same rulebook derive the same id
without coordinating and a reference resolves on any host that has it —
no registry, no ids handed out by anyone.

Pack files live in `packs/` locally and are **gitignored**: rulebook
text is personal-use data in a private DB, never repo content. See
`packs/README.md` for the format.

**teller hosts no content.** Not packs, not books. Listing anything is
possible only with a rightsholder's sanction, and even then the
publisher distributes it themselves. What people do with files they
have is between them and the publisher.

### 5. Turn order is a manually ordered list — hard commitment

teller never models any system's initiative *mechanics* (rolls, cards,
popcorn). The table determines order physically; the DM drags the list
to match. Output is always "an ordered list + current index"; that's
universal across systems.

### 6. Web-first; hardware is optional flare

**There is ONE url per table — the host's.** Every screen — phone,
tablet, table TV, rail panel — opens the address `teller host` prints,
shows a pairing code, and the DM types that code into their console to
adopt it. What a screen *is* is an assignment the DM makes and changes
at will; no surface is addressable by URL and nothing is provisioned
per-device. A Pi kiosk boots to the same address forever.

The address is now the table's, not teller.ink's — that's the only
change the pivot made here, and it's what makes a table with no
internet work at all.

The direction matters: the screen shows the code and the DM types it,
so the dumbest panel in the room needs no keyboard.

Roles a screen can be assigned:
- `console` — the DM console, with all the authority that implies.
  `params.pane` narrows it to one slice; one pane per panel is the
  digital DM screen. The pane list is **`src/lib/panes.ts`, and only
  there** — the console renders from it and the Displays panel offers it
  when assigning. A pane the console can show but nobody can be assigned
  to is a pane that doesn't exist.
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

**A LAN host is served over plain HTTP, and that constrains the
client.** Two consequences that have already bitten:

- **It is not a secure context.** `crypto.randomUUID`, `crypto.subtle`,
  OPFS and PWA install are all unavailable on a `192.168.x.x` origin —
  loopback is trusted, the LAN is not. Use `crypto.getRandomValues`, and
  have the server compute anything that needs real crypto (the SSE
  handle comes back from `/displays/hello` for exactly this reason).
- **HTTP/1.1 allows six connections per origin and an SSE stream never
  releases one.** Exhaust the pool and every later request on that
  origin queues forever — it presents as "everything disconnected". HTTPS
  hides this completely, which is why it survived months of hosted
  play. Keep it to **one stream per resource per tab** with a subscriber
  set (`src/lib/use-session.ts`); never let component count set socket
  count.

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
yet. That's the DM's own device, unlocked at the same address every
other screen opens. On a host the key is minted on first run into
`~/.teller/dm.key` — `teller key` prints it.

A display's `id` is capability-bearing — it's what the server checks —
so it's high-entropy, lives only in that device's storage, and is never
rendered. The **pairing code** is the opposite: short, readable across
a room, short-lived, and it only ever means "adopt this screen", never
"grant this power". Where a screen must be named in a URL (the SSE
stream can't send headers), use its **handle** — `sha-256(id)`, which
identifies but never authorises.

**Accounts are allowed, but never required** (Brian, 2026-08-09,
replacing a blanket "no accounts" that shipped in the foundation commit
and was never actually a decision). A campaign must always be playable
with nothing but the DM's key and screens that pair by code — showing
up at a friend's table must never mean signing up for anything. Any
identity layer is additive on top of that, for the things it genuinely
unlocks: a character that follows a player between tables, a screen a
player owns and carries, history across campaigns.

Prefer the smallest thing that does the job. A character sheet carried
ON the player's own device gets "walk in and your character loads"
without a server owning anyone's character; reach for real accounts when
the requirement is genuinely cross-device or cross-table, not before.

**The stream is authenticated, by ticket.** An `EventSource` can't send
headers, so anything that must be named in a URL gets a short-lived HMAC
ticket signed with the one key over subject + expiry
(`worker/tickets.ts`) — same trick for a book's bytes in an iframe. The
signature covers the *presented* expiry, so a client can't extend its
own. Watching requires being a screen the DM adopted; a ticket
identifies, it never grants a power the assignment didn't already have.
Keep secrets out of the stream regardless.

### 8. Schema: few real columns + JSON `data` blob

Promote a blob key to a column only when a query needs it. Raw database
rows never cross the API boundary — per-resource serializers in
`worker/db.ts` (`toCampaign`, `toCharacter`) parse/coerce — so a route
never sees an integer where it wanted a boolean, whichever engine
answered.

The mirror of that rule lives in `host/d1.mjs`, which normalises what
goes *in*: D1 quietly accepts a JS boolean as a bind parameter and
`node:sqlite` throws, so the shim converts. Two engines, one contract —
keep both edges honest and route code never learns which is running.

### 9. What lives on the host, and what travels

**State that more than one screen argues about lives on the host.
Everything else lives as close to the person as possible.** That single
line explains the pivot, why seat tokens died, why books stopped living
in browser storage, and why there is no cloud in the play path.

Its companion, for content: **what a publisher wrote stays put; what you
wrote travels.** A bundle carries your campaign — characters, encounters,
scenes — and **references books by id, never carries them**. A rulebook
is downloaded once, by the person who owns it, onto the machine that
serves the table.

**That does not yet hold for packs, and it is the open gap.** A bundle
carries pack bodies whole: exporting a WiW campaign yields ~124 KB of
`pack.json` against 563 bytes of `books.json` — 96% of the file is
distilled rules text and stat blocks. So a bundle is safe to hand to
someone who owns the same books, and not otherwise. The manifest already
marks it (`personal: true`) and nothing reads that. TEL-62 closes it:
packs become `.pack` files on the host and a bundle *references* them,
which is what turns the IP line into a property of the format instead of
a rule someone has to remember.

Bundle rules that follow from this (`worker/bundle.ts`, `worker/import.ts`):

- **Sections, not types** — a bundle declares what it contains, so a
  system-only pack and a whole campaign are the same file format.
- **The extension is a label; the manifest is the truth.** Settled
  2026-08-09: ONE bundle format, renaming `.tell` → `.story`, with
  "starting kit" vs "runnable adventure" **derived from `contains`,
  never stored** — a declared kind goes stale the moment the bundle is
  edited. No second extension for the kit case: that would track degree
  of completeness, which is fuzzy (a kit that grows two encounters is
  what?) and unfixable once someone holds the file. `.pack` gets its own
  extension because it is a different KIND of thing — different folder,
  lifecycle and identity scheme. **A new extension tracks a different
  kind of thing, not a different degree of completeness.** Not yet
  renamed in code; see TEL-62.
- **Import layers onto a running table** rather than replacing it, and
  on a collision the **stored value wins** (rule 1 again — an import is
  a proposal, not an authority).
- A book that's referenced but absent is reported as missing, never
  silently dropped: "you don't have this" beats forgetting it existed.

## Deferred on purpose (documented so they aren't re-invented badly)

- SRD content import, character builder, level-up wizard.
- Remote seats and hybrid tables — a player joining over the network,
  their camera on a panel, their dice rolled physically on the far end
  (TEL-55/56/57). The local-first architecture is what makes this
  coherent: the host is already the authority, so a remote seat is a
  screen that happens to be far away.
- Community template distribution (v0 of that is a GitHub repo of JSON,
  not a platform).
