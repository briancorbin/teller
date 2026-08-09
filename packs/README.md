# Packs

A pack is **the unit of content** for a system: the distilled rulings
that come up mid-game, and the bestiary that goes with them. Rulebook
excerpts for your own table, or homebrew. Upload one through the
console's Rules panel (or `PUT /api/packs`); it's searched live from the
console and its foes appear in every campaign on that system.

A pack needs **no PDF at all** to be useful — most Wardens own paper.
A book, when you have one, attaches by hash and adds the page and the
art. Enrichment, never a prerequisite.

**Content never ships in this repo.** `*.json` here is gitignored on
purpose: rulebook text is typically copyrighted, and your paste of it
is personal use — the moment it's committed to a public repo it's
redistribution. Keep pack files in this folder locally; upload them to
your instance; git never sees them. (Homebrew you own the rights to
can of course be shared anywhere.)

Consequence worth knowing: a pack you build has **no version history**.
Export a `.tell` now and then — it's the poor man's backup, and it's
what a `.tell` is for.

## Format

```json
{
  "system": "wiw",
  "name": "My Guidebook Pack",
  "version": 1,
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
- Re-uploading a pack with the same `system` + `name` replaces it.

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
