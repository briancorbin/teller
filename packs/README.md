# Rules packs

A pack is reference **content** for a system — rulebook excerpts for
your own table, or homebrew — uploaded to your teller instance via the
console's Rules panel (or `PUT /api/packs`). Packs are searched live
from the DM console.

**Content never ships in this repo.** `*.json` here is gitignored on
purpose: rulebook text is typically copyrighted, and your paste of it
is personal use — the moment it's committed to a public repo it's
redistribution. Keep pack files in this folder locally; upload them to
your instance; git never sees them. (Homebrew you own the rights to
can of course be shared anywhere.)

## Format

```json
{
  "system": "wiw",
  "name": "My Guidebook Pack",
  "version": 1,
  "sections": [
    {
      "title": "Statuses",
      "entries": [
        {
          "name": "Burned",
          "meta": "Finesse",
          "text": "−Health equal to Severity. Lasting: Max −2."
        }
      ]
    }
  ]
}
```

- `system` matches a template's system id (`wiw`, `dnd5e`, …).
- `meta` is an optional short qualifier rendered next to the name
  (associated Skill, Grit cost, tier…).
- Re-uploading a pack with the same `system` + `name` replaces it.
