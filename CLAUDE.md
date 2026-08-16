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
out is the thing that actually matters: **no publisher text in the
REPO** (rule 4 — the one absolute line; what a pack may carry and who
may distribute it is the author's affair). Reference and prep live
per-instance, on the DM's own host.

"The humans are the rules engine" is about AUTHORITY, not arithmetic
(amended 2026-08-10). teller may roll dice and derive defaults; every
result lands somewhere a human can overrule it, and the table's ruling
beats the book's. What it must never do is decide something nobody can
change.

## Relationship to the-shed-next

Standalone on purpose (the sidewalk precedent): own repo, own infra,
own auth, no `@shed/*` imports ever. Patterns are COPIED from the shed
(DO + SSE + role clients from gameday, worker-row serializers, D1
habits) — never imported. Duplication between repos with different
futures is insulation, not debt.

That boundary now extends to ownership (2026-08-15): the repo is
**public, AGPL-3.0, at `teller-ink/teller`** — its own org, not a
personal namespace — with a Homebrew tap at `teller-ink/homebrew-tap`.
"Open-sourcing someday" happened; keep the repo clean of personal-infra
references because strangers can now read it.

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
hash), `packs/` (pack archives and authoring folders, named by minted
id or by their author), `art/` (installed pack art, keyed
`art/<pak_id>/…`), `map/`, `dm.key`.

- `pnpm dev` — Vite dev server (port 4525) with the worker + local D1/DO.
- `pnpm db:migrate:local` / `db:migrate:remote` — D1 migrations. The host
  applies the same `migrations/` on boot.
- `pnpm typecheck` / `pnpm build` / `pnpm pack` (release tarball via
  `scripts/pack.mjs` — prints the url + sha256 the tap's formula needs).
- Releasing: bump `package.json` version → `pnpm pack` → `gh release
  create vX.Y.Z build/teller-X.Y.Z.tar.gz` → paste the printed fields
  into `Formula/teller.rb` in `teller-ink/homebrew-tap`. Users install
  with `brew install teller-ink/tap/teller`.
- Secrets: `DM_KEY` (`.dev.vars` locally; on a host, `~/.teller/dm.key`,
  minted on first run). Optionally `~/.teller/assistant.json`
  (`{ url?, key?, model, style? }`) wires up the assistant (TEL-85);
  absent means no assistant and no button — never a nag.

The Cloudflare deployment still exists (worker `teller`, D1 `teller`, R2
`teller-maps`, custom domain) and is where the landing page will live.
It is no longer where play happens.

## Design docs — read before touching their subject

- **`docs/BATTLEMAP.md`** — everything map-related, and it describes what
  actually SHIPPED: coordinate spaces, scale, the calibrated 1-inch grid,
  tokens, fog, hidden-means-stripped. Scenes, fog and tokens are built;
  don't design them again from this file.
- **`docs/SYSTEMS.md`** — the WiW survey: every subsystem in the
  Guidebook, its data shape, its surface, and what's built. **Read the
  relevant entry before modelling any mechanic** — it exists because
  shaping features off one filled-in sheet produced three wrong
  guesses in a week. Mechanics only (rule 4); the book's prose stays
  in the pack. It maps the domain; screens are still designed one at
  a time.
- **`packs/README.md`** — the pack format (archive/folder layout,
  `rights`, art). The content itself never lives in the repo; the
  authoring copies are the shelf folders in `~/.teller/packs/`.

## RULES

Each rule says where it came from, because that turned out to matter.
Audited 2026-08-10: **seven of the nine original rules were written in a
single sitting** — the foundation commit `6c5197c`, before any of this
existed. Only two were learned from building. The file presented a
two-day-old guess and a hard-won constraint in identical voice under a
heading that said "don't re-litigate", and an assumption inherits no
authority from being written down early.

So: *assumed* means it was a starting guess and is fair game. *Learned*
means something broke, or shipped, and taught us this. Re-audit when a
rule starts feeling like an obstacle rather than a floor — and **audit
the whole file after any day that rewrites a rule** (learned 2026-08-15:
a rule's echoes — the summaries and asides that cite it elsewhere in the
file — go stale the moment the rule moves, and the thesis section spent
three days stating a version of rule 4 that no longer existed).

### 1. Override IS the architecture — never automate past a human

*Learned (the variant/placement/foePicks work) from an assumed start.*

Every stat is a stored value, and a human can always type over it.
Computation is ALLOWED — it *proposes* into the same slots and the
stored value stays authoritative. Roll dice, derive defaults, sort a
list: fine. What's forbidden is automation with no override, or a
number a human can't find and change.

This was originally written as "track, don't compute — there is NO
rules engine", which read as a ban on computing at all and was cited
that way. It never was: the rule is about **who wins**, not about
whether teller may do arithmetic.

### 2. Generic primitives, not game concepts

*Assumed, and it earned its keep — Health, Grit, Prestige, ammo and
spell slots are all just counters, and no game-specific column has ever
been needed.*

The character model is: `fields` (key/label/value), `counters`
({name, current, max}), `tags`, `notes`. HP, spell slots, Prestige, ammo,
ki — ALL are counters. Conditions are tags. Do not add a game-specific
column or type (no `hp`, no `spellSlots`). Counters can belong to a
character or to the campaign (party resources).

### 3. Every mutation appends to the event log

*Assumed, now load-bearing: `/undo` walks this log, so it stopped being
a someday-feature the moment undo shipped.*

The `events` table gets a row for every state change: who, what,
payload. Never mutate without logging.

It is already load-bearing: `/undo` walks it backward, writing a
`revert` event pointing at what it undid, so repeated undos keep
stepping back instead of fighting each other. What doesn't exist yet is
a *readable* combat log or history for the DM (TEL-5) — the data is
there, nothing renders it.

### 4. The REPO carries no publisher text — a pack may carry anything its author has the right to

*Split 2026-08-10; the IP half rewritten 2026-08-14 (Brian), because it
was aimed at the wrong object. Twice now this rule has been too broad
and had to be narrowed — both times because a real constraint was
stated as a wider one that was easier to remember.*

**The only place IP cannot exist is IN THE REPO. Full stop.** (Brian,
2026-08-14.) Everywhere else is fair game — packs, campaigns, `.story`
bundles, homebrew, whatever someone builds on their own host out of
their own books. The rule kept getting written as though publisher text
were radioactive, which is a different and wrong claim; it was only ever
about **where** it may live and **who** may hand it on.

Three separate things, and only the first is absolute:

- **The repo, and teller itself, carry nobody's book. Absolute.** No
  spell descriptions, no stat blocks, no prose lifted from a book, in
  `src/`, `worker/`, `host/`, docs or templates. `packs/*` is
  gitignored to enforce it (everything but the README — a pack is a
  folder now, and a rule naming only `*.json` would have let one walk
  in). teller is presentation and bookkeeping
  software; it ships empty and it stays empty. **teller hosts no
  content** — that half of 4a is unchanged and load-bearing.
- **A pack may contain IP. Done.** (Brian, 2026-08-14.) Rules, prose,
  descriptions, stat blocks, the lot — a pack is *the* sanctioned home
  for content, and pretending its contents had to be sanitized made the
  best version of a pack impossible to build. What a pack may contain is
  decided by what its author has the RIGHT to put in it, which is not
  teller's business to police and never was. The same goes for a
  campaign, a `.story`, a homebrew: content is the author's affair.
- **Distribution follows the content, not the format.** A pack holding
  someone's IP may be distributed only by that rightsholder, or by
  someone they've authorized — a licensee or a storefront counts; it
  needn't be the publisher personally. A pack that's all homebrew is its
  author's to hand out freely. **Both are ordinary packs.** Everything
  in between (homebrew for a licensed system, a pack quoting one table)
  is the author's call, and their assertion — teller cannot verify a
  claim about rights and must never present one as verified. **A pack
  says which it is, in `rights`** (`homebrew` | `personal` | `licensed`,
  plus holder and terms; absent reads as `personal`). It gates nothing
  at the table — it exists so the answer lives in the file instead of in
  whoever happened to know. See `packs/README.md`.

The everyday case is untouched and stays comfortable: **a DM's own pack,
built from their own book, on their own host, shared with nobody.** That
is personal use, it's what `~/.teller/packs/` is for, and rule 4a already
says what people do with files they have is between them and the
publisher.

**What this makes possible, and why it was worth rewriting** (Brian,
2026-08-14): the Wild Imaginary West pack is being built as a **proposal
to Boylei Hobby Time** — seeded with the book's rules, descriptions and
prose, complete rather than distilled, so there's something real to show
a publisher who might want to distribute it themselves. Under the old
wording, the most persuasive artifact teller could produce was the one
thing it forbade. Until such a pack is sanctioned it is personal-use and
goes to nobody — not playtesters, not a friend's table, not a bundle.

**TEL-62 now reads differently, and better.** A `.story` referencing
packs by id instead of carrying them was filed as an IP safety measure.
Its actual value is structural and survives this rewrite intact: **a
pack's distribution is decided by the pack, separately from the campaign
that names it.** That's exactly what makes a publisher-distributed pack
coherent — your campaign travels, and the licensed content it sits on
arrives from whoever has the right to send it.

**The line that's gone (2026-08-10).** "No mechanics in code" was never
an IP concern — game *mechanics* aren't protected, only their
expression. It was scope fear dressed as a legal rule, and it blocked
things the table actually wants, like rolling initiative.

So a template = structure + vocabulary + **mechanics**: field lists,
counter names, "Warden" vs "DM", and how this system rolls. Dice live
in the `systems` row as DATA, so teller ships one small evaluator and a
new system arrives as a row, not a code change. Templates are starting
kits — after creation everything is editable. Every template carries
`system` + `version` from day one.

**Statuses are part of that, and learning so cost a day** (Brian,
2026-08-16). Trapped, Afraid and Poisoned are not optional content a
pack brings — they are how Wild Imaginary West WORKS, and without them
you are not playing it. They had ended up in the Guidebook pack because
they arrived attached to their prose, so a host with the system and no
pack had no conditions at all, while the system knew Trapped was
uncapped without knowing Trapped existed. The line is this rule's own:
**the system carries the mechanic** (it exists, it's called Trapped,
Finesse or Nerve relieves it); **the pack carries the book's words about
it**. A pack may still ADD one — a supplement introducing a condition is
making a mechanical claim, which is the author's affair — and the
campaign may add its own and wins, the same merge the bestiary uses.

The general shape, which is worth having a name for: **a mechanic
hiding in a text field is the recurring bug in this codebase.** Severity
lived on the end of a tag string, a Talent's category lived behind a
`"Talent: "` prefix, and which skill relieves a status lived in a pack
entry's free-text `meta`. All three were found in one day, all three
type-checked, and all three were invisible until something needed to
read them back. When a value is doing two jobs, split it.

Templates live in the **`systems` table** (migration 0007), not in code.
`worker/templates.ts` is a *seed* — `seedSystems` inserts with `INSERT
OR IGNORE`, so a counter someone renamed survives the next reboot
(rule 1). A system added by a person and a system that shipped with
teller are the same kind of thing and neither outranks the other.

### 4a. A pack is the unit of content — and a file, with its own identity

*Learned, from building packs. Sharpened by TEL-62 (2026-08-10): a pack
is now a distributable artifact, not a row in someone's database.*

Rules CONTENT has a sanctioned home: **packs**. A pack carries the
rulings that come up mid-game AND the bestiary that goes with them; the
campaign's foe list is the pack catalogue merged with the campaign's
own, campaign winning on an id collision. **How complete a pack is, is
its author's choice** — a personal pack is usually distilled to what
gets looked up at the table, and a publisher's own could be the whole
book (rule 4). The format doesn't care which.

**A pack lives in `~/.teller/packs/`**, swept in on boot exactly like a
book — drop one in and it's installed. It carries a **minted `pak_` id,
assigned once at authoring and baked into the file**. Not a content
hash: a book can hash its own bytes because a book is immutable, but a
pack is edited, and hashing would rename it on every correction.
Identity is the id, never the name (the lesson blueprints already
taught).

**A pack is an ARCHIVE, and equally a FOLDER** (2026-08-15): `pack.json`
(id, system, name, version, rights, books) beside `sections.json`,
`statuses.json`, `bestiary.json`, `catalog.json`, `trades.json`,
`creation.json`, `notes.json` and `art/`. Zipped it's a `.pack` you hand
someone; unzipped it's a directory on the shelf you edit in place — same format,
same sweep, no build step. **The file split is a serialization, not a
data model**: everything assembles back into one `RulesPack`, so the
bestiary, creation and merge code never learned this happened.

Two consequences worth keeping:

- **A pack carries its art**, which is what makes it self-contained —
  the point of the change (TEL-88). Inside a pack, art is referenced
  RELATIVE (`art/logo.png`); teller resolves that to an object key
  (`art/<pak_id>/…`) at install, so nobody types a global key and two
  packs can't name the same picture. Export reverses it, so a pack
  installs under any id on any host and still finds its own pictures.
- **A book still doesn't ride along.** Referenced by hash, as ever — a
  book is a thing the recipient owns; a monster portrait isn't.

**A campaign declares which packs it runs on**, by id, **in precedence
order** — and later wins on a collision, the way an import layers. That
list is `campaign.data.packs`; with no list, every pack for the system
applies, in arrival order. A host with one pack must never make anyone
tick a box.

A pack works with **no PDF at all**. A book is optional enrichment,
attached by content hash: a book's id is `bok_` + sha-256 of its own
bytes, so two people who own the same rulebook derive the same id
without coordinating and a reference resolves on any host that has it —
no registry, no ids handed out by anyone.

**The shelf folder IS the authoring copy** (2026-08-15). Edit
`~/.teller/packs/<name>/bestiary.json` in place, bump `version` in
`pack.json`, and the ten-second sweep installs it — no copy, no upload.
The repo's `packs/` holds only the format README; everything else under
it is gitignored (`packs/*`), because whatever a pack carries, it is
never repo content (rule 4).

**teller hosts no content.** Not packs, not books. Listing anything is
possible only with a rightsholder's sanction, and even then it's
distributed by them or whoever they authorize — never by teller. What
people do with files they have is between them and the publisher.

### 5. Turn order is an ordered list + a current index

*Assumed, and amended 2026-08-10 — the prohibition is gone.*

The DATA SHAPE is the durable part and it stays: an ordered list and a
current index, which is universal whether a system rolls, deals cards
or passes popcorn. The DM can always drag, and dragging beats anything
teller worked out (rule 1).

What's gone is the sentence that said teller "never models any system's
initiative mechanics — hard commitment". It was written on day one with
nothing behind it, nothing in the codebase ever depended on it, and it
forbade the single most requested piece of bookkeeping at the table:
rolling for monsters. A system's dice live in its template (rule 4), so
teller rolls what the system declares and writes the result into a list
you can rearrange.

Where the table's own rules differ from the book's, the TABLE wins —
Brian's runs per-monster initiative although WiW says the Warden rolls
once for all enemies. teller carries out the table's ruling; it does
not enforce the publisher's.

### 6. Web-first; hardware is optional flare

*Assumed, then largely rewritten by the local-first pivot. The "ONE url
per table" framing and the plain-HTTP constraints below are learned —
the six-connection limit cost a day.*

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

**The short-and-wide strip is the DESIGN TARGET, not merely a size that
has to work** (Brian, 2026-08-10, weighing it against a 15.6" panel).
Two reasons, and the first is the thesis:

- **The panel must stay subordinate to the table.** A 15.6" screen at
  every seat is a wall of glass around a table whose whole point is the
  dice, the minis and the terrain on it. A 3.4"-tall bar sits under the
  sightline and stays secondary. A screen that competes with the minis
  has already lost the argument this project is making.
- **515px of height forces the editorial question** — what does a player
  need AT A GLANCE, mid-fight? A tall panel lets you dodge it, and
  dodging it is how a seat becomes a dense card nobody reads. Designing
  roomy-first and squeezing does not work: it produced a phone at scale
  0.64 with 10px headings the same day this was decided.

The corollary is structural, not optional: the seat is **several
screens** (a segmented bar you can also swipe between), because the
sheet's blocks do not fit one bar and never will. Deciding what earns a
place on the FIRST screen is the design work; the rest is arrangement.

**Two families of glass, and only one question tells them apart** —
is it MOUNTED or HELD? (See `wide` in `src/views/SeatView.tsx`.) Mounted
glass — rail panel, table TV, a propped tablet — has plentiful width and
FIXED height, because nobody flicks a screwed-down panel and a shared
screen must show everything at once: so it never scrolls — and never
scales either. Held glass — a phone in a hand — has scarce width and ELASTIC
height, because scrolling is free and universally understood: so it runs
full-width at natural size and may scroll down. Neither ever scrolls
sideways *by accident* — the PAGE never pans, and layout overflow is a
bug. **A deliberate shelf may** (Brian, 2026-08-12): on the touch bar a
full-height row of item panels pans past what fits, the same gesture
family as swiping between screens, with the visible count derived from
a panel min-width rather than declared. That is one decision point
instead of a per-device matrix, and there is deliberately no list of
devices anywhere in the client. Extended 2026-08-14 (Brian, from the
iPad): on mounted touch glass a deliberate shelf may also scroll DOWN,
inside its own bounded region — the store's shelf forced it, being the
first screen whose content is genuinely unbounded. The page still never
scrolls, and a screwed-down panel still never asks for a gesture nobody
can make at it.

**Content renders at designed size, always** (Brian, 2026-08-13 —
`FitBox` removed). There is no scale-to-fit anywhere in the seat: text
has exactly one size, the one it was designed at. A layout that
overflows mounted glass is CLIPPED, and the clip is the diagnostic —
it means the layout is wrong for that glass, and the fix is design
(fewer blocks on that screen, a shelf, a split), never a transform
quietly shrinking the type until nobody can read it.

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

*Learned, building displays (`28d707d`). One of only two rules that came
from experience rather than the opening sitting.*

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

*Assumed; the serializer discipline in the second half is learned, from
int-vs-boolean bugs across two engines.*

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

*Learned, from the local-first pivot. The newest rule and the one that
explains the most.*

**State that more than one screen argues about lives on the host.
Everything else lives as close to the person as possible.** That single
line explains the pivot, why seat tokens died, why books stopped living
in browser storage, and why there is no cloud in the play path.

Its companion, for content: **what a publisher wrote stays put; what you
wrote travels.** A bundle carries your campaign — characters, encounters,
scenes — and **references books AND packs by id, never carries them**. A
rulebook is downloaded once, by the person who owns it, onto the machine
that serves the table.

**Known crack, deliberately unpatched (TEL-87, 2026-08-15).** That
sentence assumes the campaign's author and the publisher are different
people, and a PUBLISHED campaign breaks it — there the publisher wrote
the campaign. Brian's container model is settled (**system** = how the
game works, **pack** = what exists in the world, **story** = one
table's arrangement stitching packs to a system), and a one-shot is a
campaign, not a pack. What's still open is whether a `.story` someone
distributes and a `.story` you back up are one format or two, plus
`rights` and identity on the manifest — decide it in TEL-87 before
authoring the Kickstarter campaign's adventure layer, not here by
accretion. Until then `BundleManifest.personal` (derived
`npcs.length > 0`) is a stale heuristic from old rule 4; don't trust
it, replace it as part of TEL-87.

**This now holds for packs too** (TEL-62, closed 2026-08-10). A bundle
used to carry pack bodies whole: a WiW export was ~124 KB of `pack.json`
against 563 bytes of `books.json` — 96% of the file was distilled rules
text and stat blocks, sitting directly beneath a comment promising the
format contained none. A `.story` now writes a `requires` list instead,
and the same export is ~21 KB of structure with the rules text left on
the host. Host content is books **and** packs; a campaign travels and
references both.

Two consequences worth keeping: **back up `~/.teller/packs/` alongside
your `.story` files** — the bundle is no longer self-contained, which is
the price of the IP line being structural. And a `.story` is only
runnable by someone who has the packs it names, exactly as it has always
been for books.

Bundle rules that follow from this (`worker/bundle.ts`, `worker/import.ts`):

- **Sections, not types** — a bundle declares what it contains, so a
  system-only pack and a whole campaign are the same file format.
- **The extension is a label; the manifest is the truth.** ONE bundle
  format, `.story` (renamed from `.tell` in TEL-62 — `.tell` was a nice
  pun and completely opaque). "Starting kit" vs "runnable adventure" is
  **derived from `contains`, never stored** (`bundleKind`) — a declared
  kind goes stale the moment the bundle is edited. No second extension
  for the kit case: that would track degree of completeness, which is
  fuzzy (a kit that grows two encounters is what?) and unfixable once
  someone holds the file. `.pack` gets its own extension because it is a
  different KIND of thing — different folder, lifecycle and identity
  scheme, and it never travels with a campaign. **A new extension tracks
  a different kind of thing, not a different degree of completeness.**
  `.tell` is still ACCEPTED on import; nothing writes one.
- **Import layers onto a running table** rather than replacing it, and
  on a collision the **stored value wins** (rule 1 again — an import is
  a proposal, not an authority). For packs that rule has a name and a
  home: `PackOrigin` in `worker/packs.ts`. An upload is intent and
  replaces; a file appearing on disk or a pack arriving inside something
  else is a proposal, and may install or upgrade but never clobber.
- A book or pack that's referenced but absent is reported as missing,
  never silently dropped: "you don't have this" beats forgetting it
  existed — and beats an encounter that deploys half-empty at the table.

## Deferred on purpose (documented so they aren't re-invented badly)

- SRD content import; the level-up wizard stays out permanently — the
  Prestige spend menu IS the advancement mechanism, and there is no
  second one. The **character builder shipped 2026-08-13** (TEL-75, a
  deliberate un-deferral): creation is COMPOSITION over the pack's
  `trades`/`creation` data — the console dialog and the rail builder
  ("what's yer trade?") drive the same `src/lib/creation.ts`, every
  step writes ordinary fields/counters/items, and a `draft` flag is
  the only trace until the last step clears it (rule 1 throughout).
- Remote seats and hybrid tables — a player joining over the network,
  their camera on a panel, their dice rolled physically on the far end
  (TEL-55/56/57). The local-first architecture is what makes this
  coherent: the host is already the authority, so a remote seat is a
  screen that happens to be far away.
- Community template distribution (v0 of that is a GitHub repo of JSON,
  not a platform).
