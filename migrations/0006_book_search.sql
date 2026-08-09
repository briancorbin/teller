-- Book search that knows what a word is.
--
-- The first cut was `text LIKE '%q%'`, which is substring matching, not
-- word matching: "cover" hit "uncovered", "discovered" and "discovery",
-- so a real question drowned in sixty results in no particular order.
--
-- FTS5 fixes both halves. The tokenizer means a term matches whole words,
-- and `porter` stems them, so "grapple" also finds "grappled" — the thing
-- you actually wanted when you typed it. bm25() then ranks, so the page
-- that is ABOUT the term beats the page that mentions it once in passing,
-- and a cap becomes "the best forty" instead of "the first sixty".
--
-- book_pages stays the source of truth; this is an external-content index
-- over it, kept in step by triggers. That way there is one copy of the
-- text, and anything that writes pages — including a hand-run DELETE in
-- wrangler — updates search for free.

CREATE VIRTUAL TABLE book_fts USING fts5(
  text,
  content = 'book_pages',
  content_rowid = 'rowid',
  tokenize = 'porter unicode61'
);

-- Existing books were indexed before search grew up.
INSERT INTO book_fts (rowid, text) SELECT rowid, text FROM book_pages;

-- External-content tables don't read the content table on write; they're
-- told what changed. 'delete' rows must carry the OLD text, which is why
-- update deletes-then-inserts rather than just inserting.
CREATE TRIGGER book_pages_ai AFTER INSERT ON book_pages BEGIN
  INSERT INTO book_fts (rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TRIGGER book_pages_ad AFTER DELETE ON book_pages BEGIN
  INSERT INTO book_fts (book_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;

CREATE TRIGGER book_pages_au AFTER UPDATE ON book_pages BEGIN
  INSERT INTO book_fts (book_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  INSERT INTO book_fts (rowid, text) VALUES (new.rowid, new.text);
END;
