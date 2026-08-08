-- teller: campaigns, characters, and the event log.
-- Schema philosophy: a few real columns for what we query, a JSON `data`
-- blob for everything still finding its shape. Promote a field to a
-- column only when a query needs it.

CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  system TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE characters (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'pc',
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_characters_campaign ON characters(campaign_id);

-- Mutation log. Every state change appends a row — the seed for undo,
-- combat log, and "how did the wizard get to 4 HP". Cheap now, miserable
-- to retrofit.
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL,
  entity_id TEXT,
  actor TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_events_campaign ON events(campaign_id, id);
