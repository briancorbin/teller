-- Rules packs: system-scoped reference content (rulebook excerpts,
-- homebrew) uploaded as JSON. Content lives ONLY here in the DB —
-- never in the repo (personal-use line for commercial books).

CREATE TABLE packs (
  id TEXT PRIMARY KEY,
  system TEXT NOT NULL,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_packs_system_name ON packs(system, name);
