-- Systems become data, which rule 4 said they already were.
--
-- "System templates are data, never code" has been true in spirit and
-- false in fact: the templates lived in a TypeScript array, so adding a
-- game meant a pull request and a deploy, and Wild Imaginary West was
-- literally part of teller's source. You cannot export what only exists
-- as a deploy — which is why this had to come before bundles.
--
-- A template is still exactly what rule 4 says: structure and
-- vocabulary. Field lists, counter names, "Warden" instead of "DM".
-- Never rules content. Moving it into a row doesn't loosen that line, it
-- just means someone can bring their own game without touching the
-- repo.

CREATE TABLE systems (
  -- 'wiw', 'dnd5e' — the same key campaigns already store.
  system TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- Carried from day one so a template can change its mind later
  -- without orphaning the campaigns built from it.
  version INTEGER NOT NULL DEFAULT 1,
  -- The whole SystemTemplate: vocabulary, character kit, npc kit,
  -- campaign counters, states. One blob, per rule 8 — nothing queries
  -- inside it.
  data TEXT NOT NULL,
  -- True for the ones teller ships with. They're seeded on first run and
  -- reseeded if deleted; anything imported is not built-in and is only
  -- ever what someone chose to bring.
  builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
