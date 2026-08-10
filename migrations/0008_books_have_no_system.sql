-- A book doesn't belong to a game. You own it.
--
-- `books.system` was written when a book was thought of as "scoped like
-- packs" (migration 0005). That lost to the design that actually
-- shipped: the library spans every system you own, and a campaign refers
-- to a book by id (`campaign.data.books`). Rule 9 — what a publisher
-- wrote stays put, what you wrote travels — puts the relationship on the
-- campaign side, not stamped into the book's row.
--
-- Three things made it untenable rather than merely unused:
--
--  * The main ingestion path can't fill it. A PDF dropped into the books
--    folder is a file, not a declaration; `sweep()` had nothing to infer
--    from and wrote ''. It needed a second pass over the packs to borrow
--    a system from whichever pack happened to name the book.
--  * Nothing read it. No client ever passed `?system=` to the list or
--    the search, and no UI rendered it — a write-only column.
--  * One string can't say the true thing anyway. A setting guide spans
--    systems and a monster book gets raided for another game. The claim
--    handles that: many campaigns, any systems, one book.

DROP INDEX books_system;

ALTER TABLE books DROP COLUMN system;
