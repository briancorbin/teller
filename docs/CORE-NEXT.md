# CORE-NEXT — the working doc

> **This is a workbench, not a spec.** It lives on `design/core-next` and
> nothing in it is built. Everything else in `docs/` describes what
> shipped; this describes where we're going and is expected to be wrong
> in places. Squash it into `main` when it stops being wrong.
>
> Started 2026-08-17 (Brian + Claude), out of a conversation that began
> as "rework the Warden console" and ended up two layers underneath it.

**Read first:** `docs/STORAGE.md` is the BEFORE picture and the evidence
base for everything here — mapped off a live install, not off the types.
`docs/ARCHITECTURE.md` is the law this has to satisfy.

**The working posture** (Brian, 2026-08-18): teller is pre-alpha, and
this doc is not chasing perfect or final. The bar is *thought through
enough that iteration is cheap when justified* — settle the shapes that
would be expensive to change (storage, references, the merge), stay
loose on everything that's one migration away, and expect "Settled"
sections to be amended by contact with WiW. Building starts before this
doc is finished, on purpose.

---

## Why this exists

Five bugs in one week, all the same bug:

1. Severity on the end of a tag string (`"Trapped 4"`)
2. A Talent's category behind a `"Talent: "` prefix
3. A status's relieving skill in a pack entry's free-text `meta`
4. A standing behind a `rep_` field-key prefix
5. Descriptors and conditions sharing one list, so **Gunslinger renders
   as a condition at severity 1** — still live

I kept calling this "a mechanic hiding in a text field," which is the
symptom. The cause:

> The character has four generic buckets. The system has 26 declarations,
> several of which are the same concept. Each concept lands in the
> nearest bucket, and whatever distinguishes it gets encoded into
> whatever that bucket allows — a string, a key prefix, a position.

The kind store (`worker/kinds.ts`, shipped) fixed the *storage* half for
two of them. It was scoped too small.

---

## What must remain true

Any proposal here has to satisfy all of these, or it's wrong:

- **The degradation contract.** Nothing above Core is required. A core
  type is the most a human can still operate with no help.
- **Rule 1.** Every value lands somewhere a human can type over.
- **Rule 2.** No game concept in Core. No `hp`, no Skill, no Trapped.
- **One merge shape.** system → packs (declared order) → campaign, later
  wins by name.
- **Reading forgiving, writing strict.** Permanently, not as a window.
- **Rule 7.** Authority is role-derived. Core still owns who may edit and
  who may see — that part is not "semantics."

---

## Settled

### 1 · Core has no semantics

Core **stores**. The system **declares meaning**. The panel **decides
presentation**. (Brian, 2026-08-17.)

The corollary that unlocked the rest: a discriminator like *"does zero
mean absent or mean zero?"* belongs on the **declaration**, not on each
stored value. On the value it's a mechanic hiding in a field; on the
declaration it's the system layer doing its job.

### 2 · Core stores named lists of named values, prose, and nested entities

```
entity {
  name
  lists   Record<string, Entry[]>     // 'skills' · 'resources' · 'conditions' · 'marks' · …
  notes   string
  children?                            // entities inside entities
}

Entry { name · value?: number | string · max? }
```

`fields`, `counters`, `tags` and `kinds` all collapse into `lists`.
`kinds` was already the right idea; it was scoped to two of the four.

Counter and Tag share one spine and differ **only in what zero means** —
a counter at zero is a fact you read off the sheet (a live character
holds seven at 0); a tag at zero is deleted, because absence *is* the
state. The ceiling differs only in scope: `Counter.max` is per instance,
`statuses.cap` is per kind.

### 3 · Entity, not character

Core has no concept of a character. Evidence, not preference:

- **Seven entity types already exist without a table** — blueprints,
  catalogue items, upgrades, encounters, vendors, scenes, handouts —
  each a named thing with its own id, stored as a JSON array inside
  `campaigns.data`. Only `characters` was ever promoted.
- An **Item** already carries its owner's primitive set.
- **`characters.kind`** (`pc` | `npc`) is the only type discriminator in
  the schema, gates 33 sites, and has no answer for a horse owned by a
  player (`docs/SYSTEMS.md` §18 refuses to decide entity-or-item).
- The **event log** — oldest part of the schema, foundation commit — has
  always said `entity_id`.

### 4 · Boards are assets; placements are live

A Scene today is a board with a fight smeared onto it:

```
id · key(image) · name · widthInches · grid      ← the BOARD
tokens[] · zones[] · terrain[] · fog · view      ← what's ON it now
```

Live proof: one scene mid-fight is 2,725 bytes; two empty ones are ~290.
The difference is entirely session state.

A board is an **asset**, the same category as a book or pack art —
reusable across campaigns, keyed by its image, referenced by id.
`widthInches` + `grid` + the display's `ppi` exist to make a screen
render *a real physical inch* so drawn squares line up with the minis.
That is calibration between pixels and the room: teller-the-program, not
campaign content.

```
board      { id · key(image) · name · widthInches · grid }
placement  { boardId · entityId? · u · v · sizeInches · rot · shape · hidden · label? · color? }
fog        per campaign + board
```

**Bug this fixes:** `worker/bundle.ts:288` writes the whole Scene into
`scenes.json`, so exporting a `.story` mid-fight ships token positions
and revealed fog. Session state inside a Campaign file, which the layer
stack forbids.

### 5 · A token links to an entity by id — and owns its own appearance

The link is already load-bearing (`TableView.tsx:266`). The split, which
the code already follows and nobody wrote down:

> **The token stores where it is and what it looks like. The entity
> supplies how it's doing.**

Derived through the link at render, never stored: status ring
(`linked.data.tags`), bloodied/critical/down glow (`vitality`), turn
highlight. So a token can't go stale.

The token keeps `label` and `color` because it must work **unlinked** (a
rock, something in the dark), and because colour is a deployment choice
about sides — three Bark Watchers wear amber, green and teal; four
Vargas-side tokens share one blue.

### 6 · Four tiers, each additive, none required

| tier | supplies | exists today |
|---|---|---|
| **Bare panel** | controls derived from the value's shape | ✅ 5 of 6 seat layouts |
| **System** | labels, order, caps, value domains, vocabulary | ✅ 26 keys, unorganised |
| **Plugin** | automation, mechanics, computed values | ⚠️ `assistant.ts` only |
| **Custom panel** | it looks like the paper | ✅ `sheet` + ~20 components |

We built the top first and never built the bottom for anything but
counters — that's the actual gap.

### 7 · The bare-panel rule

**The control follows the value's shape, not a declaration.**

| entry | bare control |
|---|---|
| `{name}` | a chip — tap to remove, `+ add` to create |
| `{name, value: number}` | the number, with − / + |
| `{name, value: number, max}` | a bar or a ring, capped |
| `{name, value: string}` | an inline text field |
| child entity | a titled sub-block, recursive |
| **ref** | **a link chip — cached name; marked when dangling; clear / retarget** |

List name → section heading. Entity name → title. Notes → textarea.
`type` → an editable word. Everything writes. That is a complete, ugly,
fully-operable sheet with zero declaration — the floor, made concrete.

*Checked against the full entity type, 2026-08-18 — it holds, with the
ref row added above and one scoping note:* the bare panel is an
**instance** surface (§13). Template halves — a pack's bestiary, the
campaign's own catalog — are authored on prep surfaces, which are the
console's business, not this rule's. Every field of
`Entity { name, type, lists, notes, children, refs }` now has a bare
control; the only thing never rendered is `id`.

Already shipped as proof: `Gauges`' own blurb is the rule out loud —
*"bars for anything with a ceiling; the rest tucked underneath."*

### 8 · Derived readings are computed at the point of use

Never stored. Confirmed: `vitality` is computed in `toPublicCharacter`
(`worker/db.ts:268`) and appears in **zero** rows, and the table has been
drawing token glow off it all along. That closes the question
`ARCHITECTURE.md` left open about Bloodied/Down returning as something
computed — it already did.

---

### 9 · An item is an entity; where it's stored is a promotion decision

*(Settled 2026-08-18 — was open questions A and B.)*

"Container or entity" turned out to be a false question conflating two
things that come apart:

- **What it IS:** an entity. Same type as its owner.
- **Where it's STORED:** inside the parent's blob vs its own row —
  which is **rule 8 applied to entities**: promote a nested entity to a
  row when something outside needs to address it, the same law that
  promotes a blob key to a column when a query needs it.

Containment is an ordinary relationship between entities, not a second
kind of thing. Authority follows it (rule 7 stays simple): a seat edits
its one entity and everything nested inside.

The evidence, from the live install:

- **Live items are stamps.** All 14 sampled: `from` set, zero local
  fields/counters — a name, a catalogue reference, a grouping word.
  And `Item.from` is `CharacterData.blueprintId` wearing another name:
  provenance of a stamp, typed values beating derived ones. One
  concept, currently two spellings.
- **Items already hold cross-references.** `loaded` points at a SIBLING
  (the comment says it: "a SELECTION, not containment"); `upgrades[].from`
  points into the catalogue; `worker/items.ts:719` addresses `item.id`
  from outside the owner.
- **`history` (Deeds) is a private event log** — `{what, where, round,
  when}` — re-implemented small inside the blob because an item had no
  `entity_id` to log against. Core already has that table.

What dissolves: Item-the-type (`fields/counters/tags/notes` → lists +
prose; `from` → provenance; `loaded`/`upgrades` → references; `history`
→ events; `kind` → question C). The horse hard case (an entity contained
by a character AND addressable on the board — promotion, not
reclassification). Trade-as-copy-and-delete (handing over a pistol is
reparenting; the history rides along).

This also settles old question A: **entries stay strictly name/value**,
because anything richer was an entity all along.

---

### 10 · The entity type, drafted — and every reference walks through it

*(2026-08-18. Settles B′'s shape question; C stays open and has a
marked slot.)*

```
Ref    { id · name }                     // id resolves; name degrades
Entry  { name · value?: number|string · max? }   // strictly a leaf (§9)
Entity {
  id · name · type?                      // type? = question C, unresolved
  lists    Record<string, Entry[]>
  notes?
  children? Entity[]                     // inline until promoted (rule 8)
  refs?    Record<string, Ref>           // 'from' · 'loaded' · 'system' · …
}
```

**The Ref shape was found, not invented**: encounter foes are already
`{blueprintId, name, u, v, hidden}` — id to resolve, cached name to
degrade to. The encounter runner needed it and built it locally.

Every existing reference, walked:

| today | becomes | degrades to |
|---|---|---|
| `Item.from` | `refs.from` | cached name; local values are all it has |
| `blueprintId` | `refs.from` — same slot | ordinary character |
| `Item.loaded` | `refs.loaded` | name shows; firing can't decrement |
| `FittedUpgrade` | child entity, `refs.from` + range entry | a named lump |
| placement `entityId` | already conforms — `label` is the degrade name | unlinked marker |
| encounter foes | already literally `{blueprintId, name}` | blank you type over |
| containment | inline children; promoted child carries parent ref | — |
| `campaign.system` | `refs.system` — door 2 becomes just another ref | vocabulary + dice lost, table plays on |

Two findings bigger than the walk:

**The campaign is the root entity.** Counters are lists, reference is
notes, npcs/encounters/vendors/scenes are children, books/packs/system
are refs. This dissolves STORAGE.md's headline anomaly: the seven
tableless entity types are children of the campaign entity, each
individually promotable under rule 8. `characters` is just the one
that got promoted first.

**Identity couples by id; vocabulary couples by name.** Entities point
at entities by Ref. Kind entries match declarations BY NAME — a
condition its StatusDef, a standing its party, a mark its category —
deliberately, because the whole merge system runs on later-wins-by-name
and a campaign overrides a status by restating it. A dangling ref
renders its cached name, marked missing — never dropped (rule 9),
never a bare id (degradation).

### 11 · The campaign is the file

*(2026-08-18. Brian: "go with it for now" — explicitly NOT 100% sold;
keep thinking. **Confirmed later the same day** ("yeah 11 is good"),
re-raised before H step 1 as the handoff required — no longer
provisional. The two probes that were chewed on: a character following
a player between tables is a file op, and switching campaigns is a
restart; both accepted.)*

A campaign row turned out to be: a small MANIFEST (name, system ref,
pack/book lists in precedence order, vocabulary, party counters), plus
everything it contains, plus a little live state. Of the three live
campaigns one is real and two are test furniture; nothing crosses
between them, and 35 of 42 displays belong to NO campaign — a symptom
of instance-level things stuffed into a campaign-scoped table.

So the campaign isn't a special table or a merged root row — **it's the
boundary of the database file.** Boot-time loading is the resolution law
finding its home: teller starts, reads the manifest, resolves
system/packs against the shelf, reports what's missing, degrades. Once,
at boot — not per-request. The CLI already half-says this: `teller host
[path]` exists so "a campaign can live on a stick you carry."

The split falls exactly on rule 9's line — what a publisher wrote stays
put (shelf), what you wrote travels (the campaign file):

```
~/.teller/
  shelf.db          books · packs · systems · boards · displays
  books/ packs/ art/ dm.key
  campaigns/
    the-unlikely-duo.db      entities · events · board_state
```

What it deletes: `root_id` from entities/events/board_state (scoping IS
the file); per-request campaign checks (rule 7's one key unlocks the
loaded campaign); the SSE scoping question; ever importing the Guidebook
twice. Backup becomes copying one file.

**The three costs, named:**

1. **Switching campaigns = restarting teller.** Probably correct — a
   game night is one campaign; `teller host` with no arg lists
   `campaigns/` and asks.
2. **Displays move to the shelf** — fixes the orphan problem (a kiosk is
   the ROOM's, pairs once, survives switches), and a stale assignment
   pointing into an unloaded campaign is just a dangling ref: cached
   name, degrade to standby. The model handles it for free.
3. **Cloudflare doesn't do multiple database files.** D1 is one binding.
   Costs nothing today (play is local-first; CF is the landing page) but
   it is the dual-runtime seam genuinely strained for the first time —
   written down here so it's a decision, not a discovery.

Also: `cmp_` ids stop scoping requests, which touches most route
signatures — so this lands WITH the entity migration in H, not
separately.

### 12 · The table schema, after

*(As amended by §11. Nine tables become 4 + 4, split by file.)*

**`campaigns/<name>.db` — one campaign:**

```sql
entities (
  id          TEXT PRIMARY KEY,   -- ent_…
  parent_id   TEXT,               -- containment when promoted (§9); NULL at root
  name        TEXT NOT NULL,
  type        TEXT,               -- question C — loose; nothing branches on it
  data        TEXT NOT NULL,      -- { lists, notes, refs, children[] inline }
  created_at, updated_at
)
events      ( id, entity_id, actor, kind, payload, created_at )   -- unchanged shape
board_state ( board_id PRIMARY KEY, data )                        -- placements + fog + view; NEVER in a .story
templates   ( id, slot, name, data, … )                           -- the template half; slot is a COLUMN (contact log)
```

The campaign manifest is the root entity row (`parent_id IS NULL`).
Characters are promoted children. `children` holds INSTANCES only
(§13): the campaign's own blueprints, encounters, vendors and catalog
are its TEMPLATE half — first written as "live in the manifest", which
contact proved unbuildable (see the log); they live in the `templates`
table, one table for the whole half, the slot a column. **No new table
per TYPE, ever.**

Promoted columns, each earning its keep: `parent_id` (fetch children),
`type` (filter + strip). Everything else is blob (rule 8).

**`shelf.db` — this machine:**

```sql
systems  ( id sys_…, name, version, data, builtin )   -- door 2 done: minted id, 'wiw' demotes to a name
packs    ( id pak_…, system, name, data, … )          -- unchanged
books    ( id bok_…, … ) + book_pages                 -- unchanged
boards   ( id brd_…, key, name, width_inches, grid )  -- NEW: the asset half of §4
displays ( id, name, color, role, params, code, ppi… )-- campaign_id GONE; the room's screens
```

Gone entirely: `characters` (→ entities), `campaigns` (→ the file),
Scene-as-campaign-content (→ boards + board_state), `do_storage`
(session state; the DO's cache lives wherever the runtime puts it).

**Fork noted, default standing:** placements stay a blob per board
(rule 8 — nothing addresses one from outside yet; a player moving only
their own token would be the promotion trigger).

### 13 · An entity is an instance

*(Brian, 2026-08-18: "an entity is simply an instantiated instance of
something else… the monster in a bestiary is NOT an entity; the
instantiated version that has hp and statuses and exists in an
encounter is." Confirmed, with two sharpenings.)*

> **An entity is a thing in play at this table — usually stamped from a
> template, never required to be.** `refs.from` is the stamp mark; its
> absence is fine (a character invented at the table has no template,
> and degradation demands templates stay optional).

| template (content) | instance (entity) |
|---|---|
| bestiary blueprint | the foe on the board, at Health 5 |
| trade | the character a player built from it |
| catalogue item | the pistol in Barrett's belt |
| encounter | the deployed fight |
| board (asset) | board_state |

The encounter runner proves it was already true: an encounter's foes
are `{blueprintId, name, u, v}` — instructions for instantiation — and
deploying stamps real characters.

**The campaign layer has two halves.** Its OWN bestiary, catalog and
statuses are templates — the campaign's contribution to the merge
(system → packs → campaign, wins on collision), authored content that
travels. Its characters and deployed foes are instances — in no merge,
because they aren't content, they're the game. Templates change by
version bump; instances change by logged, undoable events (rule 3).
This is also why a blueprint correction never reaches creatures already
on the table — `blueprintId` was documented "provenance, not a live
link" from the start.

**Amendment to §12:** `children` holds INSTANCES only. The campaign's
template half (own blueprints, encounters, vendors, catalog, statuses)
lives in the manifest, not as child entities. A vendor is the boundary
case that shows the seam working: the shop-as-written is template; the
moment the table tracks depleted stock, THAT is the instantiation.

Noted for later, not pursued now: prep vs play — the console split
Brian asked for at the very start — is exactly template vs instance.
Prep authors templates and arrangements; play manipulates instances.

### 14 · The stamp — one link, variable thickness

*(2026-08-18, out of "how does the gun know its template, how does the
npc know its monster, and should a store instantiate whole?")*

**The link is always `refs.from`**, holding a template id minted at
authoring (`npc_wiw_bark_watcher`, a catalogue `id`) plus the cached
name. Resolution goes through **the same merge that presents content**
(the `bestiaryFor`/`catalogOf` path) — deliberately, because that is
how corrections propagate: fix a stat in the pack and every thin stamp
reads the fix at render. The cached name degrades it when the pack is
gone. "Stock is part of the store" is the OTHER relationship —
containment — and stock lines match template lines by name (vocabulary
coupling, §10).

**Thickness is a property of the stamping ACTION, not the link.** Today
there are secretly two behaviours: the gun is a THIN stamp (stores only
overrides, derives the rest through `from`, rule 1), and the character
is a THICK one (creation copies everything at birth; `blueprintId` is
documented "provenance, not a live link"). Unified: everything derives
through `from` and stored values win — a thick stamp is just a stamp
that stored every value at birth. The character behaves exactly as
today, but stops being a special case.

> Copy as little as the thing's nature allows. Characters copy
> everything, because creation is authorship. Guns copy nothing,
> because it's the book's gun until the table says otherwise. Shops
> copy nothing and instantiate late.

**Vendors, settled concretely** (amends the lazy-per-line sketch in
§13's vendor note): instantiate the WHOLE vendor as an entity at first
transaction or first DM edit — never on browse — so "the shop went
live" is one event, addressable and undoable, and the console can show
as-written vs live. But instantiate THIN: store only depleted counts
(`VendorLine.qty` is the template default; an entry exists only once it
moves off it — the defaultStep pattern). A thick-copied shop would be
frozen at instantiation day; a thin one carries the pack's new items
automatically.

### 15 · How a plugin loads

*(2026-08-18, confirmed. The assistant is the proof port.)*

A plugin is a **folder on the shelf** — `~/.teller/plugins/<name>/` —
manifest beside code: `plugin.json` (`plg_` id, name, version, tiers,
`provides`, `needs`) + `host.mjs` (proposer/effectful entry) +
`panel.mjs` (surface entry, served to the browser).

**The sweep DISCOVERS; only a human ENABLES.** Discovery lists it as
available in the console; enabling is an explicit per-plugin act where
the manifest's claims are shown app-permissions style (`needs: []` is a
meaningful, checkable claim). Enablement lives in **shelf.db, never the
campaign** — trust is a fact about this machine. Content may REQUIRE a
plugin by ref; requirement is a claim and cannot grant trust. Missing or
disabled → reported and degraded, like a missing pack. Uninstall-and-look
stays the compliance test.

**Boot:** read enabled list → `import()` each entry → the module exports
implementations keyed by **extension point**:

```js
export const provides = {
  'propose.turn':  (snapshot, question) => …,
  'control.clock': …,   // served from panel.mjs, client-registered
  'pane.scan':     …,
}
```

Points live in ONE registry file (the `panes.ts` precedent: a point not
in the registry isn't a point), starting tiny — `propose.*`, `control.*`
(generalising `dials`), `pane.*` — growing only when a real plugin needs
a real point.

**The call boundary is async and message-shaped from day one** —
serializable snapshots in, proposals out, no live objects — even though
v1 runs in-process. Moving to `worker_threads`/subprocess later is then
a transport change, not an API break. Stated honestly: in-process code
is NOT sandboxed; pre-alpha, the enable gate is the security model, and
real isolation arrives with the transport swap, before any registry of
third-party plugins exists.

**Held line:** plugins get snapshots PUSHED; they never query. It keeps
proposers pure, portable, cacheable. The first plugin that genuinely
can't live with it makes the argument (the empirical-ceiling rule).

**Plugin №1 is the assistant.** It already passes the three-question
test, already has the config precedent (`assistant.json` — absent means
no button), and already is two proposers: `suggestTurn` and
`narrateOutcome` are `propose.turn` and `propose.narrate` wearing
today's names. Porting it validates manifest, enable gate, registry and
degradation against working code. Per-plugin config generalises
`assistant.json`: one blob per plugin id, on the shelf.

**There are no builtin plugins, and there never will be** (Brian,
2026-08-18: "None required or given by default. Download/install the
ones you want"). teller ships with ZERO plugins — the same posture rule
4 takes for content, now taken for code: teller ships empty and stays
empty, in both domains. Two consequences:

- The assistant is not ported INTO the new core; it is ported OUT of
  teller. `worker/assistant.ts` dies in the sweep, and the assistant
  becomes an ordinary installed plugin — first among equals, no
  special discovery path, the same enable gate as anything else. Its
  authoring copy lives where a pack's does: the shelf folder IS the
  authoring copy. Distribution, when it matters, is the
  already-deferred answer (a git repo, not a platform).
- The degradation contract gets its strongest reading for free: a
  teller with no plugins isn't degraded, it's COMPLETE.

**Sequencing amendment (contact, same day):** the assistant port rides
BEHIND the minimal loop, not ahead of it. `propose.turn` wants a
session snapshot — turn order, the round — and session state doesn't
exist in the new core until the server layer ports (DO → class, step
3). The load path is already proven against real fixture plugins; the
assistant is the proof of the SNAPSHOT CONTRACT, and that contract has
nothing to describe until there's a session to describe. Step 2's
machinery half is done; its proof half lands with step 3.

### 16 · One runtime — Cloudflare is a brochure

*(Brian, 2026-08-18: "CF doesn't need to know anything at all about
teller as a program. It's just a landing page." Supersedes the
dual-runtime rule in CLAUDE.md — fold on merge.)*

"One codebase, two runtimes, no fork" existed only to keep play possible
on Cloudflare, and play left. Consequences:

- `host/*.mjs` stop being shims and become the implementation:
  `node:sqlite` direct, no D1 interface contract, no boolean-bind
  coercion, `CampaignDO` → a plain class.
- "Keep route handlers runtime-agnostic or this dies" — retired.
- §11 cost 3 (D1 can't do per-campaign files) — evaporates.
- §15's CF caveat — evaporates.
- The landing page is a static site with zero teller code.

**The nuance kept:** TEL-84 (remote reachability) may someday put a
relay on teller.ink for remote seats. A relay is a dumb pipe —
rendezvous infrastructure, not teller-the-program.

> **teller.ink may carry bytes; it never runs the game.**

---

## Open — with what would settle each

### B′ · References — shape settled in §10; two residues

One Ref shape covers all five existing cases (see §10's walk). Left:

- Does a Ref ever need to say what it EXPECTS to point at? (C's
  territory — a typed ref is half an entity type.)
- Staleness: the cached `name` goes stale on rename while the target
  is still present. Refresh on write? On read? Never (it only matters
  when dangling)? Leaning: refresh opportunistically on any write that
  touches the ref, accept staleness otherwise — it is display, not
  identity.

### C · Does an entity have a TYPE, and whose is it?

Core needs none for storage. But something has to answer "is this a
party member, a foe, a horse, a scene?" for filtering and for the
player-safe snapshot. Candidates: a Core field; a system declaration; or
list-membership (the campaign holds a `party` list of references).

Note `pc | npc` is already too coarse — a horse owned by a player is
neither, and gets stripped or exposed wrongly either way.

*Settles by:* §18 (horses). It's the first real thing the binary can't
hold.

### D · The unified kind declaration

The three kinds share a spine — **a population** (`list` / `categories`
/ pack `section`), **a value domain** (count-with-cap / none / ordered
steps), **a label and note**. Per-kind extras (`relief`, `effect`, `mod`)
ride on the entries.

Open: whether the kind declares its **control** or only its value
domain, with the control derived. `dials` (`counter → 'cylinder' |
'cards'`) already does the former, for counters, in two lines.

### E · What `.panel` actually is — SETTLED (2026-08-18, with Brian)

Six ad-hoc `Record`s already did this job: `groups`, `accents`, `pins`,
`dials`, `icons`, `screens`. `.panel` is their **consolidation**, not a
new invention. The blocker ("settles by doing D first") dissolved when
D got its real contact, and the precondition of step 5 ("once real
panels exist to arrange") was met the same day: two seat layouts and
eight console panels existed as code. Brian: do the format now.

**A `.panel` is a named declaration that arranges components on a
surface.** It rides the same stack as every other declaration —
vocabulary-coupled, merged by NAME, later wins — in a `panels` slot on
any layer. teller itself supplies the STANDARD collection as a base
layer BELOW the system (`core/panels.ts`, source `teller`), so a
system, pack, or campaign overrides a standard panel by restating its
word. Furniture, not content: shipping arrangements is teller's job;
they gate nothing and a human's layer always wins (rule 1 for UI).

```jsonc
{
  "name": "sheet",            // the word; restate it to override
  "label": "Sheet",
  "blurb": "Arranged like the paper you already know.",
  "subject": "entity",        // what it arranges: 'entity' | 'none'
  "mounted": [ …blocks ],     // TWO AUTHORED ARRANGEMENTS —
  "held":    [ …blocks ]      //   never one responsive layout
}
```

The constraints from `ARCHITECTURE.md` hold structurally:

- **Mounted / held are authored separately.** The sheet's brief
  media-query era is repealed: a renderer picks the arrangement by
  which family of glass the ASSIGNMENT says this screen is
  (`params.glass`, defaulting by aspect), and never reflows one layout
  into the other.
- **A panel proposes; the role decides.** A `.panel` never grants: a
  seat rendering `sheet` still edits only its one entity, a passive
  screen showing a panel still writes nothing. Surface follows
  assignment (`params.pane` for a console slice, `params.layout` for a
  seat), and the same merged list feeds the console directory, the
  hash routes, and the Screens panel's assignment picker — the
  `panes.ts` law: a panel nobody can be assigned to doesn't exist.
- **Layout + components only, never control flow.** Blocks are nouns:
  `columns` (layout), `header`, `list` (with `list` name, a
  presentation word `as`: `auto · chips · rows · bars · big · ledger`,
  and an optional `filter`: `capped · uncapped`), `statuses` (the
  system list with a severity box each), `rest` (every list not placed
  elsewhere — strays SURFACE, the degradation contract applied to
  arrangement), `notes`, `children`, `turn`, and `tool` (a named
  built-in component: `roster · runner · encounters · screens · shelf
  · plugins · boards · log`). `as: 'auto'` means §7's grammar — the
  floor is the default presentation, declarations only dress it.
- **Degradation.** A block kind this build doesn't know renders as a
  labeled refusal, out loud (the registry posture). A panel that fails
  entirely falls back to the bare panel. A subject-entity panel with
  no entity says so. Nothing blank, nothing silent.

**Two kinds of panel, one collection.** Arrangement panels (`sheet`,
`bare`) declare blocks over an entity. Tool panels (`screens`,
`plugins`, `shelf`, …) are teller furniture whose body is one `tool`
block — declared in the same collection so they're addressable,
assignable and overridable like everything else, while their behavior
stays code. §15's "enablement is a human act in the console" finally
has its room: the `plugins` tool panel.

### F · `Field`'s key/label split

`Field` is `{key, label, value}`; Entry is `{name, …}`. §10's coupling
line sharpens this: `key` exists so DECLARATIONS could match a field
while its label stayed editable — the id-vs-name split, inside a leaf.
Under name-coupling, renaming an entry breaks its declaration match
(rename Charm and `groups.skills` loses it). One known tension now,
not a smell. Options: entries keep an optional stable key; or renames
are edits to the DECLARATION layer, not the entry; or accept the break
and let strays-promise catch it.

### G · Where prose lives

One `notes` per entity, or a note per list, or notes as a list of their
own? Prose is the ultimate degradation target and shouldn't be squeezed.

### H · The path — a clean break at the core *(drafted 2026-08-18)*

**The premise changed and the plan changed with it.** Convergence was
chosen to protect a live table; Brian, 2026-08-18: nothing is live,
nothing is shared, all testing. So: **rebuild the data core in place as
a break** — delete the old types, write the new core fresh, seed a fresh
database, let typecheck drive the sweep. No migrations, no
views-over-lists shims, no reading two shapes. The tags refactor proved
the method; this is the same move at full scale.

NOT a rewrite of the repo: SSE/leader election, display pairing and
tickets, battlemap rendering, dice, pack sweep, book FTS, the builder,
the sheet components — working, orthogonal, kept. The shelf's packs and
books are template content and survive as-is.

**The last free format break** (dated, deliberate): with no third-party
files in existence, `.story`, `.pack` and the db may all break once,
cleanly. The moment anything is shared — a playtester, the Boylei
proposal — the window closes and reading-forgiving hardens into the
permanent contract it was written to be.

**Parallel worlds:** the rebuild runs against `--data ~/.teller-next`
from day one; old teller keeps running against `~/.teller` as the
reference. The clean break's classic failure (a long dark stretch with
nothing runnable) is mitigated by never turning the old one off and by
lighting a minimal loop early.

**The porting filter IS the console redesign.** Surfaces port one at a
time, and porting is an editorial act: every pane answers "does this
earn porting, and is it prep or play?" (template vs instance, §13). The
"full" pane doesn't get ported; it gets deleted — which is what the
redesign was going to do anyway.

The sequence:

1. **The core, fresh** — Entity/Entry/Ref, the kind declaration, stamp/
   resolve (§14), the merge, shelf.db + campaign files (§11/12), boards
   + board_state, events. Single-runtime (§16): `node:sqlite` direct,
   DO → class. Headless-testable. *Settles D and F by contact; G falls
   out.*
2. **Plugin registry + the assistant ported as plugin №1** (§15) —
   proves the load path while the surface area is small.
3. **The bare panel** — first UI on the new core; the floor (§7).
   *Minimal loop lights up here: console roster + one bare seat + a
   board.*
4. **Port surfaces through the filter** — seat layouts, table/board/
   badge, console panes in dependency order; design tokens ride along;
   delete what doesn't earn porting. *Settles C when the first horse
   gets stamped.*
5. **Declared panels** — the six layout Records consolidate into
   `.panel`-shaped declarations once real panels exist to arrange.
   *Settled — see E; pulled forward by Brian the same day step 4
   landed, once two seat layouts and eight console panels existed.*

### Contact log — H step 1 *(started 2026-08-18, `feat/core-next`, `core/`)*

The doc said building would amend it. What building found, first day:

- **A ref slot holds one ref OR an ordered list** (`Ref | Ref[]`).
  §10's drafted `Record<string, Ref>` had no home for the campaign's
  packs, where precedence order is the whole point. `refIn`/`refsIn`
  are the two readers.
- **Question D has a draft** (`core/kind.ts`): the spine is
  name/label/note + a domain — `count` (with `zero: 'clears' | 'stays'`
  and a presented-never-enforced `cap`), `steps` (with `rest`, the
  defaultStep pattern generalised), or `text`. The zero rule sits on
  the declaration exactly as §1 demanded. The UNDECLARED default is
  `'stays'`: deleting a value nobody declared deletable is automation
  past a human, so an undeclared list behaves like the old counters and
  a system opts a kind into clearing.
- **A value write never re-spells the name.** `setEntry` keeps the
  stored entry's own casing when updating in place — caught by a test
  asserting `charm` over `Charm`; changing a value is not permission to
  re-case the table's word.
- **Event ids are the rowid** — a single-writer local file wants
  insertion order, not minted strings. Updates log `{before, after}`,
  deletes log `{before}` and cascade one event per row, so `/undo`
  stays a reader of the log rather than a feature.
- **`core/` imports carry explicit `.ts` extensions** so node's native
  type stripping runs the core with no build step —
  `node core/anything.ts` is the whole harness. Headless-testable,
  literally.
- **`core/` typechecks as its own project** (`tsconfig.core.json`,
  node types): workers-types and node ambients can't share a tsconfig.
  A deliberate scar of the half-done sweep — it retires with `worker/`
  when §16 finishes.

Second pass, same day — the boot loader (`core/boot.ts`):

- **The template half's home.** §12/§13 said the campaign's own
  bestiary/statuses/catalog "live in the manifest" — unbuildable: the
  manifest is an entity row, entries are strictly leaves, and
  entity-shaped content cannot ride through the coercer. It lives in a
  fourth campaign table, `templates (id, slot, name, data)` — ONE table
  for the whole half, the slot ('bestiary' · 'statuses' · …) a column
  and the format's word. "No new table per type" holds; §12 amended in
  place. Rows log `template.updated`/`.deleted` like everything else.
- **The coupling line reached storage**: `mergeNamed` (vocabulary) and
  `mergeById` (identity) are one `mergeBy` with two keys. A campaign
  overrides a status by restating its NAME and a pack's monster by
  restating its ID — both verified in tests.
- **`loadCampaign(shelf, campaign)` is the resolution law, once**:
  resolves the manifest's refs, reports `missing` as `{slot, ref}`
  (never dropped), degrades (a missing system loads with empty
  declarations and the table plays on), and with NO declared pack list
  applies every pack for the system in arrival order. `Loaded` hands
  out `declarations(slot)` (by name), `templates(slot)` (by id),
  `templateOf(…slots)` for `resolve()`, and `sourceOf(slot, name)` —
  provenance, so a console can say "campaign, overriding the
  Guidebook".

Third pass — the plugin load path (`core/registry.ts`,
`core/plugins.ts`; step 2's machinery, ahead of the assistant port):

- **"The sweep discovers; only a human enables" is structural now**:
  discovery reads disk and the trust table and writes NEITHER — a
  trust row exists only once a human acted, so the sweep cannot enable
  anything even by bug. Trust and per-plugin config live in a
  `plugins` table on the shelf (config generalises `assistant.json`).
- **The registry opens with two points** — `propose.turn`,
  `propose.narrate` — exactly what plugin №1 needs and nothing
  speculative. A provide against an unregistered point is refused out
  loud in the load report (tested with a plugin claiming
  `decide.turn`, a name chosen to remember why).
- **The message boundary is enforced, not promised**: every call
  crosses `structuredClone` both ways, so a plugin returning a live
  object fails TODAY, in process — not the day the transport changes.
  Tested.
- **A broken plugin degrades like a missing pack**: import throws, no
  entry file, malformed manifest — each a problem in the report, none
  a crash.

**Noted for the porting era** (Brian, 2026-08-18): retiring the old
Guidebook pack via a conversion script — `fields`/`counters`/`tags` →
`lists` — is the FIRST EXERCISE of the new pack format, not a chore.
It lands with step 4 / the WiW move-in, inside the last free format
break.

Fourth pass — **the minimal loop is lit** (`server/`, H step 3):

- **`CampaignDO` became `Session`** — a plain class holding one loaded
  campaign and an SSE subscriber set; every mutation is a store-write
  plus a room-nudge, so forgetting to broadcast is unrepresentable.
  The server is `node server/index.ts --data ~/.teller-next --campaign
  <slug>` — no build, no bundler. Deliberately keyless for exactly one
  day — rule 7 ported in the fifth pass, below.
- **The bare panel exists and is the floor made real** (`server/
  public/panel.js`, vanilla ESM, view-source IS the source): every
  §7 control derived from value shape alone, everything writes,
  verified live — a Grit bump through the bar landed in the store and
  the log with its actor. **The Gunslinger bug is structurally dead**:
  descriptors render as chips in their own list, conditions count in
  theirs, and there is no un-kinded bucket for them to collide in.
- **A thin stamp's panel is honest and nearly empty** — stored values
  only, the `from` chip, and a read-only "reads as" block showing the
  resolved reading. Editing resolved values while storing only what
  you touch (resolve-with-sparse-write) is SEAT design work for step
  4, deliberately not smuggled into the floor.
- **The board view derives `who` through the link** (§5) at render —
  a placement shows its entity's current name, `label` covers the
  unlinked rock, and a dangling `entityId` prints as missing rather
  than as a bare id.

Green at day's end: 72 tests (`pnpm test`), both typecheck projects,
and the loop live at `localhost:4526` against `~/.teller-next` —
console roster, stamping from the merged bestiary, two seats' worth of
entities, a board with placements, and the event log rendering rule 3
back at you.

Fifth pass — **H step 4, the porting era** (2026-08-18, evening — auth,
seat, runner, plugin №1, and the old world moving in):

- **Rule 7 ported, and the move SIMPLIFIED it**: displays lost their
  campaign column. The room's screens belong to the machine (rule 9),
  the host runs one campaign at a time, so "bring a screen over" — the
  old cross-campaign dance — dissolved; adoption is a consumed pairing
  code, and `adopted(display)` is just "has no code". Tickets went
  `node:crypto`-synchronous. The one key prints at boot: the host's
  terminal IS the DM's device. A seat's actor is derived from its
  assignment, never from what the client claims.
- **Resolve-with-sparse-write got its design, and it's per-entry
  copy-on-write**: the seat edits the READING; touching an entry that
  lives only in the template copies exactly that entry down into the
  stored half first — max and spelling ride along — then the write goes
  through `setEntry`, so a declared kind's zero-rule answers the same
  at the seat as everywhere. One door: `POST /entities/:id/entry`.
  **Known hole, deliberately open**: storing "absent" over a template
  that has the entry (a tombstone) has no spelling yet — removing a
  stored entry resurrects the template's reading. Nothing at the table
  needs it yet; design it when something does.
- **The turn order ported with its home upgraded** (rule 5): the op
  machine moved verbatim from the v0 runner — every case was found by a
  real fight — but state lives in a campaign-file table now and every
  op lands in the event log, which the old DO never managed. Entries
  link entities and derive names at render (§5). An encounter is PREP —
  a campaign template in slot `encounters`; deploy stamps numbered thin
  instances and the recipe stays pristine. A seat may say exactly one
  thing into the order: a score for its own row.
- **Plugin №1 exists and is NOT a builtin** (`examples/plugins/
  assistant/` — source you copy onto your own shelf). Contact finding:
  a plugin had no way to receive its CONFIG, so the load path now hands
  it to every call as a cloned second argument — the plugin never reads
  the shelf, and the clone boundary guards config exactly as it guards
  payloads. The propose route assembles its snapshot server-side
  (resolved acting sheet, named order), because a fact the host holds
  and doesn't pass on is a fact the model invents.
- **The old world moved in, and the conversion taught three things**
  (`scripts/convert-pack.mjs`, `scripts/port-campaign.mjs`): the old
  statuses META (stack/cap/uncapped) was a kind declaration all along —
  it converts straight into `kinds: [{name: 'conditions', domain:
  {count, zero: 'clears', cap: 6}}]` with per-status `uncapped` riding
  on the status's own declaration. Severity hiding in tag strings gets
  unwound at the border (a trailing number becomes the value). And the
  id-coupling paid off in the wild: the Duo pack restates three
  Guidebook creature ids, 59 + 9 merge to 65, campaign pack winning —
  nobody had to be taught anything.
- **The sheet layout ported as the seat's first real arrangement**:
  layouts are data again (`sheet` · `bare`, on `params.layout` — a
  seat renders its assignment and doesn't negotiate), the skills ARE
  the left-hand column, and the statuses panel is the system list with
  a severity box each — a menu of what can happen, not a report of what
  has. Verified live on Barrett Vargas's ported sheet: Poisoned + wrote
  severity 1 through the conditions kind; easing to nothing cleared it
  by the declaration, not by the UI.

Sixth pass — **E settles: the collection is the console** (2026-08-18,
late — Brian pulled it forward the moment its precondition existed):

- **`.panel` is real** (§E above for the format). teller's standard
  collection is a base layer BELOW the system (`core/panels.ts`) — the
  one slot teller declares for itself — and `sourceOf('panels', …)`
  says `teller` until a layer restates the word. Ten panels: two
  arrangements (`sheet`, `bare`) and eight tools.
- **The console is a directory of the merged collection**, `#panel=`
  routes each panel, and the Screens tool offers the same list when
  assigning — one list, three consumers, the `panes.ts` law kept.
- **The media query is repealed**: `mounted` and `held` are authored
  separately in the declaration, the assignment (or aspect) picks, and
  mounted glass CLIPS overflow — the FitBox law, now in CSS.
- **Plugins management left the CLI**: toggle and config over HTTP
  reload the load path LIVE, so the enable gate and the running set
  cannot drift. §15's "enablement is a human act in the console" is now
  literally true; the CLI flags remain as the headless road.
- **The identity came back, split three ways** (Brian's question
  "does theming belong in the .panel?" — answered no, and the no is
  load-bearing): teller's IDENTITY is tokens in its own stylesheet
  (ink-and-brass, ported from ui.ts); the SYSTEM'S visual vocabulary
  (`accents`, `icons`) is declarations read through the new
  `Loaded.record(slot)` — shallow-merge, later layer wins per key —
  and consumed by blocks (a Marshal's sheet wears Marshal blue from
  the stack, verified live); the `.panel` stays arrangement only,
  never palette, so restating a panel can't fork the look.

### Still open from `ARCHITECTURE.md`

- **Door 2** — system identity is a hand-chosen slug; mint `sys_`.
- **Door 3** — don't serialise `.system` until the kind declaration
  exists, or two prefixes get frozen into a public format.

---

## Considered and rejected

- **Merging Counter and Tag into one primitive with a data flag.** The
  flag would be a mechanic hiding in a field. The zero-rule belongs on
  the declaration instead — which then makes the merge fine (settled §1).
- **Moving statuses into `kinds.status` under the CURRENT model.**
  Correct call at the time, and `ARCHITECTURE.md` records `tags` as
  "kind zero." **This doc supersedes that** — under §2 there is no
  un-kinded bucket, because every list is a list. Conditions and
  descriptors become two declared lists, which is what actually fixes
  the Gunslinger bug. Fold the `ARCHITECTURE.md` section when this
  merges.
- **A clean-slate rewrite of the seat.** Convergence instead: every step
  ships and the table keeps working.

---

## Evidence index

Everything above that cites a number comes from `docs/STORAGE.md`, which
was mapped from `~/.teller` on 2026-08-17: 3 campaigns · 37 characters ·
42 displays (35 blank) · 3,387 events · 2 packs · 10 books · 417 indexed
pages. Guidebook pack 273 KB against an 8 KB campaign.
