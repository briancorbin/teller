-- Displays: every screen is the same kind of thing.
--
-- A screen arrives knowing nothing, is minted an id it keeps forever,
-- and shows a short code. The DM types that code into the console and
-- the screen becomes theirs. What it may DO is its assigned role — the
-- server holds the assignment, the screen holds nothing but its id.
--
-- That id is capability-bearing (it is what the server checks), so it
-- is high-entropy and never displayed. The pairing code is the
-- opposite: short, readable across a room, short-lived, and it only
-- ever means "adopt this screen" — never "grant this power".

CREATE TABLE displays (
  id TEXT PRIMARY KEY,
  -- NULL until a DM claims it with the pairing code.
  campaign_id TEXT,
  name TEXT NOT NULL DEFAULT '',
  -- Identify colour; also tints the standby card.
  color TEXT NOT NULL DEFAULT '',
  -- blank | table | board | art | badge | seat | console
  role TEXT NOT NULL DEFAULT 'blank',
  -- Role arguments: { characterId } for seat/badge, { pane } for console.
  params TEXT NOT NULL DEFAULT '{}',
  -- Pairing code, cleared on claim. Unique among the screens still waiting.
  code TEXT,
  code_expires_at TEXT,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX displays_campaign ON displays (campaign_id);
-- SQLite treats NULLs as distinct, so claimed rows don't collide here.
CREATE UNIQUE INDEX displays_code ON displays (code);

-- Seat tokens are retired: authority now comes from what the DM pointed
-- a display at, not from knowing a string. Drop the stale secrets rather
-- than leaving them sitting in the blob.
UPDATE characters SET data = json_remove(data, '$.seatToken');
