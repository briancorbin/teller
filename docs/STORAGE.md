# STORAGE — everything Core can hold, as it stands

Mapped 2026-08-17, from a live install (`~/.teller`, 3 campaigns, 37
characters, 3,387 events). This is the BEFORE picture: the baseline the
entity model is derived from, and the thing to check a proposal against
when it claims to simplify something.

Counts are from that install and are illustrative, not limits.

---

## 1 · The tables

Nine, plus `d1_migrations` and the book FTS shadow tables.

| Table | Real columns | Blob | Rows |
|---|---|---|---|
| `campaigns` | id · name · system · created_at | `data` | 3 |
| `characters` | id · campaign_id · **kind** · name · created_at · updated_at | `data` | 37 |
| `systems` | system (PK) · name · version · builtin · created_at | `data` | 2 |
| `packs` | id · system · name · created_at · updated_at | `data` | 2 |
| `books` | id · name · key · pages · indexed · created_at | — | 10 |
| `book_pages` | book_id · page · text | — | 417 |
| `displays` | id · campaign_id · name · color · role · code · code_expires_at · last_seen_at · ppi · ppi_y · vw · vh | `params` | 42 |
| `events` | id · campaign_id · **entity_id** · actor · kind · created_at | `payload` | 3,387 |
| `do_storage` | instance · key · value | — | 3 |

Rule 8 throughout: few real columns, one JSON blob, promoted only when a
query needs it. `characters.kind` and `displays.role` are the only
discriminators anywhere in the schema.

---

## 2 · What a character holds (`characters.data`)

```
CharacterData {
  fields    Field[]                // { key, label, value: string, filing? }
  counters  Counter[]              // { id, name, current, max|null, display?, symbol?, hidden? }
  tags      Tag[]                  // { name, value?: number | string }
  kinds?    Record<string, Tag[]>  // system-declared kinds — 'mark', 'standing', …
  notes     string
  items?    Item[]
  draft?    boolean                // mid-creation flow state
  blueprintId? string              // provenance, not a live link
}
```

And an `Item` is:

```
Item {
  name · fields[] · counters[] · tags[] · notes? · kind? ·
  id · from? (catalogue id) · upgrades? · history? (Deed[]) · loaded?
}
```

**An Item carries the same primitive set as its owner** — fields,
counters, tags, notes — minus `kinds`. It is an entity nested inside an
entity, stored as JSON inside the owner's blob.

### The primitives, reduced

Four leaves and one container:

| | shape | reading |
|---|---|---|
| **Field** | `{ key, label, value: string }` | a named string |
| **Counter** | `{ id, name, current, max, … }` | a named number **with a ceiling** |
| **Tag** | `{ name, value?: number \| string }` | a named thing held, optionally with an amount or a rung |
| **notes** | `string` | prose |
| **Item** | container of the above | an entity inside an entity |

`kinds` is not a fifth primitive — it is `Record<string, Tag[]>`, a
namespace over Tag. Adding it cost zero storage types, which was the
point (`docs/ARCHITECTURE.md`, door 1).

**Counter and Tag are the same spine — a name and a value — differing in
what zero means.** A counter at zero is a fact you read off the sheet
(this install has a character holding seven counters at 0); a tag at
zero is deleted, because absence *is* the state. The ceiling differs
only in scope: a Counter's `max` is per instance, a status's cap is
`statuses.cap` per kind.

---

## 3 · What a campaign holds (`campaigns.data`)

Twenty keys, and this is where the interesting problem is.

**Vocabulary and refs**
`vocabulary` · `books[]` (ids) · `packs[]` (ids, precedence order) ·
`originId` · `reference`

**Owned values**
`counters[]` (party resources) · `states?` (this table's own conditions) ·
`foePicks`

**Entity arrays — named things with their own ids, stored as JSON**
| key | what it is | live count |
|---|---|---|
| `npcs[]` | `NpcBlueprint` — id · name · fields · counters · tags · page · book | 0 |
| `catalog.items[]` | `CatalogItem` — id · name · group · kind · fields · counters · effects · … | 0 |
| `catalog.upgrades[]` | `CatalogUpgrade` | 0 |
| `encounters[]` | `Encounter` — id · name · sceneId · foes · notes | 2 |
| `vendors[]` | `Vendor` — id · name · blurb · stock · groups · filters | 6 |
| `maps[]` | `Scene` — id · key · name · widthInches · view · tokens · zones · terrain · fog · grid | 3 |
| `handouts[]` | `Handout` — id · key · name | 0 |

**Live table state**
`activeMapId` · `scene` · `grid` · `tableDisplay` · `activeHandoutId` ·
`handout` · `map`

> **Seven entity types already exist with no table.** Blueprints,
> catalogue items, upgrades, encounters, vendors, scenes and handouts
> are each a named thing with its own `id`, stored as an array inside one
> campaign row. Only `characters` got a table. That asymmetry is the
> single largest finding in this map — teller already has entities; it
> just spells most of them as JSON arrays and one of them as a table.

---

## 4 · What a system holds (`systems.data`)

`SystemTemplate`, 26 top-level keys, classified:

| Class | n | Keys |
|---|---|---|
| Identity | 3 | `system` `version` `name` |
| Vocabulary | 1 | `vocabulary` |
| Starting kits | 3 | `character` `npc` `campaign` |
| **Kinds** | 3 | `statuses` `marks` `ladders` |
| **Layout hints** | 6 | `groups` `accents` `pins` `dials` `icons` `screens` |
| Rules / mechanics | 10 | `space` `bands` `reload` `dice` `initiative` `use` `store` `growth` `currency` `spends` |

Two findings from the classification:

- **Three kinds, three shapes**, sharing one spine — a *population*
  (`list` / `categories` / pack `section`), a *value domain* (count with
  cap / none / ordered steps), a *label and note*. Per-kind extras
  (`relief`, `effect`, `mod`) ride on the entries, not on the kind.
- **The panel layer already exists as six ad-hoc `Record`s.** `dials`
  (`counter → 'cylinder' | 'cards'`) is already a *control* declaration —
  the mechanism a kind needs for its value domain exists, for counters,
  in two lines.

The starting kits are `{ fields, counters, tags }` — none has `kinds`,
so a system cannot currently seed a character with a Talent. Same leak
as `Item`.

---

## 5 · What a pack holds (`packs.data`)

`RulesPack`: `id` (`pak_`) · `system` · `name` · `version` · `rights` ·
`books[]` · `sections[]` (the prose) · `statuses[]` · `npcs[]` ·
`catalog{}` · `trades[]` · `creation{}` · `notes{}`.

Serialised as a folder or `.pack` archive (`worker/packfile.ts`), one
file per top-level key plus `art/`; reassembled into one `RulesPack` on
read, so nothing downstream knows the split exists.

Size is the thing to notice: **273 KB for the Guidebook pack against
8 KB for the campaign that uses it.** Content is large, structure is
small — which is why a `.story` references packs by id rather than
carrying them (rule 9).

---

## 6 · What a display holds

Columns carry identity, pairing and calibration; `params` is the role's
arguments:

```
DisplayParams { characterId? · pane? · layout? · glass? }
```

Roles: `blank` · `table` · `board` · `art` · `badge` · `seat` ·
`console`. Live: 35 blank, 4 console, 3 seat — blanks accumulate as test
furniture and are never swept.

---

## 7 · The event log

```
events { id · campaign_id · entity_id · actor · kind · payload · created_at }
```

Append-only, 3,387 rows, and `/undo` walks it backward writing a
`revert` event that points at what it undid. Live kinds: `character.updated`
(1,497) · `character.created` (1,024) · `campaign.updated` (537) ·
`encounter.deployed` (238) · `character.deleted` · `turn.resolved` ·
`table.cleared` · `encounter.cleared` · `turn.reloaded` · `campaign.created`.

> **The column is `entity_id`, not `character_id`.** The event log is the
> oldest part of the schema (rule 3, the foundation commit) and it has
> always been generic about what it points at. Core's own history already
> says *entity*.

---

## 8 · What lives on disk, not in the database

`~/.teller/`

| | |
|---|---|
| `teller.db` | everything above |
| `books/` | PDFs named by content hash (`bok_` = sha-256 of the bytes) |
| `packs/` | pack archives and authoring folders — the shelf |
| `art/<pak_id>/…` | installed pack art, keyed by pack id |
| `map/` | scene images |
| `dm.key` | the one secret, minted on first run |
| `assistant.json` | optional provider config; absent means no assistant |

A book's row carries `key` — an R2 object key, or **NULL when the file
lives on the DM's own machine**, which is the default and the point.
Only derived page text (`book_pages`, 417 rows here) enters the
database.

---

## Summary — the five things this map says

1. **Four leaf primitives and one container**, and two of the leaves
   (Counter, Tag) share a spine and differ only in what zero means.
2. **Seven entity types already exist without a table**, nested as JSON
   arrays inside `campaigns.data`; only `characters` was promoted.
3. **An Item is shaped like its owner** — same primitives, minus `kinds`.
4. **`characters.kind` (`pc` | `npc`) is the only type discriminator in
   the schema**, it gates 33 sites, and it has no answer for a horse
   owned by a player.
5. **The event log has always been generic** — `entity_id`.
