# Packs

A pack is **the unit of content** for a system: the distilled rulings
that come up mid-game, and the bestiary that goes with them. Rulebook
excerpts for your own table, or homebrew.

**A pack is a file.** Drop a `.pack` into `~/.teller/packs/` and the host
sweeps it in within ten seconds — no restart, no upload step. The Rules
panel's "add a pack" does the same thing through the browser, and packs
that arrived that way get written back out to the folder, so the folder
is always the complete shelf and always something you can hand someone.

A pack needs **no PDF at all** to be useful — most Wardens own paper.
A book, when you have one, attaches by hash and adds the page and the
art. Enrichment, never a prerequisite.

**A pack may contain IP. The repo may not.** That's the whole of rule 4
(rewritten 2026-08-14), and the two halves are worth stating separately
because they used to be one blurry sentence:

- **The repo carries nobody's book — absolute.** `*.json` here is
  gitignored on purpose. Keep authoring copies in this folder locally;
  the host's own shelf is `~/.teller/packs/`; git never sees either.
- **A pack carries whatever its author has the right to put in it.**
  Rules, prose, descriptions, stat blocks — the lot. A pack built from
  a book you own is personal use, exactly like the notebook it replaces.
  A pack a publisher sanctions can carry their whole book.

What *does* vary is who may hand the file to someone else, and since
that outlives whoever knew, the pack says so itself — see `rights`.

A `.story` **references** packs and never carries them, so back up
`~/.teller/packs/` alongside your bundles — the bundle alone won't
rebuild a table. That's the price of the file being safe to hand to
anyone, and it's the same deal books have always had.

## Format

```json
{
  "id": "pak_4f1c9a2b7e03",
  "system": "wiw",
  "name": "My Guidebook Pack",
  "version": 1,
  "rights": { "status": "personal", "holder": "Example Games Ltd" },
  "books": ["bok_a23d630c48f7"],
  "sections": [
    {
      "title": "Statuses",
      "entries": [
        {
          "name": "Example Status",
          "meta": "Nerve",
          "text": "Your own words — short enough to read aloud mid-turn.",
          "page": 62
        }
      ]
    }
  ],
  "npcs": [
    {
      "id": "npc_example_varmint",
      "name": "Example Varmint",
      "fields": [{ "key": "defense", "label": "Defense", "value": "3G" }],
      "counters": [{ "id": "ctr_hp", "name": "Health", "current": 24, "max": 24 }],
      "tags": [],
      "page": 186
    }
  ]
}
```

Every value above is invented. A pack's contents are somebody's rules
text, and this file is public — so the example teaches the shape and
nothing else (rule 4).

- `system` matches a template's system id (`wiw`, `dnd5e`, …).
- `meta` is an optional short qualifier rendered next to the name
  (associated Skill, Grit cost, tier…).

### `id` — the pack's permanent name

`pak_` + 12 random hex, **assigned once and never changed**. Leave it out
and the host mints one on first sweep and writes it back into your file;
after that it's yours forever.

Deliberately *not* a content hash, unlike a book's id. A book never
changes, so hashing its bytes is a perfect name for it. A pack gets
edited — the day after the WiW pack was written, two page numbers were
corrected — and a content hash would have minted a new identity for it
and orphaned every reference. **Identity is the id, never the name**, so
renaming a pack is just a rename, and two people's homebrew "Bestiary"
don't collide.

`version` is yours to bump. It's what makes a campaign's `requires` list
a real statement, and it's how a file decides whether it supersedes what
the host already has: a file only overwrites a stored pack when its
version is strictly **greater**. Equal versions leave the stored one
alone, because it may have been edited on the host and that edit is a
person's decision (rule 1). Uploading through the console is explicit
intent and always replaces.

### Which packs a campaign uses

A campaign declares its packs by id, **in precedence order**, in the
console's Rules panel under "running on". When two packs print the same
foe, **the later one wins** — name the base, then what layers on top.
Per-foe exceptions are the "printed in 2 books" picker in the bestiary.

Declare nothing and every pack for the system applies, in the order they
arrived on the host. A one-pack host should never make anyone tick a box.

### `rights` — is this mine to share?

The one question a pack can't answer by being opened, and the one whose
answer outlives everybody who knew it. Three statuses, no fourth:

| `status` | what it means | may it travel? |
| --- | --- | --- |
| `homebrew` | the author's own work | yes, anywhere |
| `personal` | someone else's IP, for the author's own table | **no** |
| `licensed` | someone else's IP, sanctioned to travel | yes, on its `terms` |

```json
"rights": {
  "status": "licensed",
  "holder": "Example Games Ltd",
  "terms": "Distributed by the publisher; see examplegames.com/vtt"
}
```

`holder` is attribution in plain words. `terms` is prose on purpose —
the real answers are wider than an enum survives.

**Absent means unknown, and unknown reads as `personal`.** That's the
safe default both for packs that predate the field and for anything a
stranger hands you.

Three things this is NOT:

- **Not verified.** It's the author's claim, and teller has no way to
  check it. Anything showing it says *the author says* — never a badge
  implying somebody checked.
- **Not a gate.** A pack with no `rights` works completely: foes deploy,
  pages open, nothing asks permission. Same bargain `books` makes — the
  reference identifies, it never authorises.
- **Not enforcement.** It can't stop a file being copied and isn't
  trying to. It exists so an export path can warn you, and so the
  honest answer is in the file instead of in someone's memory.

### `books` — which rulebook this is about

A list of book ids. A book id is `bok_` + the first 12 hex of the
**sha-256 of the PDF's own bytes**, so it identifies a book without any
registry: two people who own the same file derive the same id without
ever talking to each other.

It's a LIST because the hash is of exact bytes — a corrected re-upload,
or the same book bought from a different store, is a different hash for
the same book. Attach both.

The reference identifies; it never authorises. A pack whose book isn't
on this host works completely — the console just says the book is
missing instead of offering a page you can't open. You can attach and
detach books from the Rules panel without editing JSON.

### `npcs` — the bestiary the pack brings

`NpcBlueprint`s: `id`, `name`, `fields`, `counters`, `tags`. Having the
pack means having the foes, the way having the book on the shelf does,
instead of every new campaign starting empty.

Ids must be **stable** — `npc_<system>_<name>` is the convention — and
they're what a campaign's own copy collides with. On a collision **the
campaign wins** (rule 1): retuning a foe for your table survives the
pack being updated underneath it.

**A reprint reuses the original's id.** When an adventure's appendix
reprints a creature from the core book, give it the SAME id, not a fresh
one. The id names the creature; it isn't a pointer. Both directions then
work: the adventure pack alone is still self-sufficient (a complete foe,
not a dangling reference), and holding both packs collapses them to one
bestiary entry that can open either page instead of two entries with the
same name.

This is convention, not enforcement, and it's meant to be: a stranger's
homebrew Bark Watcher carries its own id and shows up separately —
which is correct, because it genuinely is a different creature.

### `trades` and `creation` — starting kits (TEL-75)

The system's playable trades/classes, as data a creation flow composes
from. A trade **references the catalogue instead of carrying it**:

```json
{
  "trades": [
    {
      "id": "trd_example",
      "name": "Example Trade",
      "tagline": "Two-Word Category",
      "page": 10,
      "skills": { "Charm": "3B", "Nerve": "2B" },
      "abilities": ["abl_ex_first", "abl_ex_second"],
      "aceInTheHole": ["abl_ex_big", "abl_ex_bigger"]
    }
  ],
  "creation": {
    "page": 12,
    "start": { "abilities": 1, "aceInTheHole": 1 },
    "map": { "trade": "Class", "wallet": "Coins", "prestige": ["XP"] },
    "wallet": { "roll": "2B", "values": { "Ace": 2, "Hit": 1 } },
    "weapons": ["itm_ex_rustysword"],
    "equipmentPacks": ["itm_ex_wandererbundle"],
    "keepsakes": ["An example memento, in your own words"],
    "names": { "first": ["例"], "last": ["Example"] },
    "questions": ["An example prompt for the prose panels?"],
    "tiers": [
      {
        "name": "Example Tier", "prestige": 0,
        "ranged": "Basic", "melee": "Basic",
        "scrap": 0, "wallet": 5, "packs": 1, "items": 0
      }
    ]
  }
}
```

Again, every value is invented — the shape is public, the contents are
the book's. `skills` is keyed by whatever field labels the system's
sheet already uses; `abilities`/`aceInTheHole` are catalog item ids
(`kind: "ability"`, `group` = the trade's name), **in the printed
order — order is load-bearing**: `creation.start` counts how many of
each list a new character begins with, taken from the FRONT, preset
rather than picked (further unlocks are Prestige spends);
`creation.tiers` is the
starting-loadout table for a posse beginning at higher Prestige (its
`packs` column counts equipment-pack picks).

A catalog entry may be a **bundle**: `contents: ["itm_…", …]` lists
the catalog ids it unpacks into when acquired — an equipment pack
becomes its blanket, rations and compass as separate carried items,
never one word in an inventory. An id may repeat ("2× Pain Pills"
lists it twice, and grants two). The bundle entry itself is the picker
card; the contents are what land.

The rest of `creation` keeps teller generic (rule 2): `map` says where
tier numbers LAND (creation-schema key → this system's own counter and
field names, so no code ever knows a counter is called anything);
`wallet` is the starting-money roll — the player rolls PHYSICAL dice
and taps the result, teller does the face arithmetic; `weapons` and
`equipmentPacks` are catalog references; `keepsakes`, `names` (the
"gimme a name" well — personalities/features ride along for NPC
sparks) and `questions` are flavor lists the flow offers as chips and
prompts. Everything here **seeds ordinary editable state** — a created
character is a normal character, and none of this is enforced
afterward (rule 1).

### `page` — where it's printed

Optional, on entries and on foes. When the pack's book is on the host,
the console offers "open the book here" — for the art, the sidebar, and
everything the digest left out. A foe can override `book` too, if one
pack covers more than one book.

**Take these from the book's own index if it has one.** Counting where a
name appears most does not work: a status is named in every stat block
that inflicts it, so its *definition* loses to the bestiary by fifty to
one. Index folios are printed page numbers and `page` is the PDF page —
measure the offset from the folios themselves rather than assuming it,
and leave `page` out when you aren't sure. A wrong jump is worse than
no jump.
