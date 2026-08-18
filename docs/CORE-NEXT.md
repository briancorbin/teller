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

## Open — with what would settle each

### B′ · References — now the biggest open question

Settling §9 promoted this from "one credible future Core addition"
(`ARCHITECTURE.md`) to **the connective tissue of the whole model**:
`from`, `loaded`, `upgrades[].from`, a placement's `entityId`, and
containment itself are all ids pointing at ids.

Every reference needs the resolve-AND-degrade answer: a stable id for
machines plus a human-readable name that survives the target vanishing —
an opaque id fails "the most a human can still operate," a bare name
silently breaks on rename. Open: one reference shape for all of these,
or is containment special? What does a dangling reference render as?

*Settles by:* writing the entity type with references in it and walking
the five existing cases through it.

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

`Field` is `{key, label, value}`; `Counter` and `Tag` are `{name, …}`.
Identity-vs-display, spelled two ways. Does `Entry` need a stable id
separate from its name?

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
