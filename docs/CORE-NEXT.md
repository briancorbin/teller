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

List name → section heading. Entity name → title. Notes → textarea.
Everything writes. That is a complete, ugly, fully-operable sheet with
zero declaration — the floor, made concrete.

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

### 11 · The campaign is the file — held loosely

*(2026-08-18. Brian: "go with it for now" — explicitly NOT 100% sold;
keep thinking. This is the one Settled section marked provisional.)*

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
```

The campaign manifest is the root entity row (`parent_id IS NULL`).
Characters are promoted children. `children` holds INSTANCES only
(§13): the campaign's own blueprints, encounters, vendors and catalog
are its TEMPLATE half and live in the manifest, not as child entities.
**No new table per type, ever.**

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

### E · What `.panel` actually is

Six ad-hoc `Record`s already do this job: `groups`, `accents`, `pins`,
`dials`, `icons`, `screens`. `.panel` is their **consolidation**, not a
new invention. Constraints already settled in `ARCHITECTURE.md`: two
authored arrangements (mounted / held), never one responsive layout; a
panel proposes and the **role** decides; layout + components only, never
control flow.

*Settles by:* doing D first. Don't design a layout language before
knowing what data it lays out.

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

### H · The convergence path

Storage first (inside `data`, no schema change, old accessors as views),
then declaration, then panels. Boards/placements are independent and
smaller — can go first or last.

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
