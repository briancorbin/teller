-- Rulebooks: the DM's own PDFs, uploaded to their own instance.
--
-- Same status as rules packs (rule 4): this is CONTENT, it is personal-use
-- data in a private database, and it never enters the repo or gets
-- distributed. Packs give tight structured entries for tag lookups; books
-- give the actual page and the art. They complement each other.
--
-- The PDF itself stays in the DM's browser (OPFS). What arrives here is
-- the derived index: page text, so search can say WHERE something is and
-- open the book there. No text layer (a scan) means no search — OCR is a
-- different project.

CREATE TABLE books (
  id TEXT PRIMARY KEY,
  -- Scoped like packs: a book belongs to a system, not a campaign.
  system TEXT NOT NULL,
  name TEXT NOT NULL,
  -- R2 object key, or NULL when the file lives on the DM's own device.
  -- Local is the default and the point: the book never leaves the
  -- machine of the person reading it, so no server ever stores a
  -- commercial rulebook. Only the derived page text comes here.
  key TEXT,
  pages INTEGER NOT NULL DEFAULT 0,
  -- False until the browser finishes extracting; search skips it.
  indexed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX books_system ON books (system);

CREATE TABLE book_pages (
  book_id TEXT NOT NULL REFERENCES books (id),
  page INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (book_id, page)
);
