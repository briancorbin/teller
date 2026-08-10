-- A pack is a thing you can hand someone, so it needs a name that
-- travels with it.
--
-- Until now a pack's identity was `(system, name)`, enforced by a unique
-- index, and its row id was minted locally at upload. Both are wrong for
-- an artifact that leaves the host:
--
--  * Renaming a pack created a NEW pack and orphaned every reference to
--    the old one. "WiW Core" → "WiW Guidebook" was exactly that, and it
--    only went unnoticed because nothing referenced packs by id yet.
--  * Two people's homebrew "Bestiary" collided on import — the same
--    mistake same-named foes made before blueprints got stable ids.
--  * A locally-minted row id can't appear in a bundle's `requires` list,
--    because the same pack has a different id on every host that holds
--    it.
--
-- So the id is minted ONCE, at authoring, and lives INSIDE the file. A
-- book gets away with hashing its own bytes because a book is immutable;
-- a pack is edited (two page numbers were corrected the day after it was
-- written), and a content hash would mint a new id on every correction.
--
-- Existing rows are re-keyed here, and the id is written into the data
-- blob first so the row and the file agree from this point on. Anything
-- already carrying an id in its JSON keeps it — that's a pack that came
-- from a file, and the file is the authority.

UPDATE packs
SET data = json_set(data, '$.id', 'pak_' || lower(hex(randomblob(6))))
WHERE json_extract(data, '$.id') IS NULL;

UPDATE packs SET id = json_extract(data, '$.id');

-- Identity is the id. Name is a label, and two packs may share one —
-- a v1 you still run and a v2 you're trying out are both "WiW Guidebook".
DROP INDEX idx_packs_system_name;
