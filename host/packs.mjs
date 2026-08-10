// The pack shelf — every rules pack on this host, in one folder.
//
//   ~/.teller/packs/pak_4f1c9a2b7e03.pack
//
// The books folder's twin, and deliberately so. Rule 9 says what a
// publisher wrote stays put and what you wrote travels; books have
// always obeyed that and packs never did — a `.story` used to carry pack
// bodies whole, which made it ~96% somebody's rules text while claiming
// to be safe to hand to anyone. Packs living here is what turns that
// line into a property of the format instead of a rule to remember.
//
// A `.pack` is just the JSON that was already being uploaded, given a
// home and an identity. Drop one in and it's installed; a campaign says
// which ones it needs and the host either has them or names what's
// missing.
//
// Where it differs from books, and why:
//
//   * A book is named by the hash of its own bytes, because a book never
//     changes. A pack is EDITED — so its id is minted once, at
//     authoring, and carried inside the file (see `RulesPack.id`).
//   * A book's file is the whole book. A pack's file is a copy of a row,
//     so the two can disagree, and `version` is what settles it: a file
//     supersedes the stored pack only when it is demonstrably newer.
//     Equal versions leave the stored one alone, because it may have
//     been edited here and that edit is a person's decision (rule 1).

import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export const packsDir = (data) => join(data, 'packs');

const log = (msg) => console.log(`  ${msg}`);

/** Minted, never hashed — a pack outlives its own edits. */
const mintId = () => `pak_${randomBytes(6).toString('hex')}`;

/**
 * Read one pack file, giving it an id if it hasn't got one.
 *
 * A pack written by hand won't have an id, and it needs one before it
 * can be referenced by anything. Minting it and writing it BACK into the
 * file is the important half: an id that only existed in the database
 * would be a different id on every host, which is the exact problem this
 * whole change exists to fix.
 */
async function readPack(path) {
  const pack = JSON.parse(await readFile(path, 'utf8'));
  if (!pack.system || !pack.name) {
    throw new Error('a pack needs at least system and name');
  }
  if (!pack.id) {
    pack.id = mintId();
    await writeFile(path, `${JSON.stringify(pack, null, 2)}\n`);
  }
  if (typeof pack.version !== 'number') pack.version = 1;
  return pack;
}

/** Store a pack, refusing to overwrite anything not demonstrably older. */
function store(db, pack) {
  const existing = db.prepare('SELECT data FROM packs WHERE id = ?').get(pack.id);
  if (!existing) {
    db.prepare(
      'INSERT INTO packs (id, system, name, data) VALUES (?, ?, ?, ?)',
    ).run(pack.id, pack.system, pack.name, JSON.stringify(pack));
    return 'added';
  }
  const stored = JSON.parse(existing.data);
  if (!(pack.version > (stored.version ?? 0))) return 'kept';
  db.prepare(
    `UPDATE packs SET system = ?, name = ?, data = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(pack.system, pack.name, JSON.stringify(pack), pack.id);
  return 'updated';
}

/**
 * Reconcile the folder with the database.
 *
 * Both directions, like the book sweep. A `.pack` dropped in by hand
 * becomes a pack; a file named anything at all is renamed to its id, so
 * the folder stays browsable and two copies of the same pack can't
 * masquerade as two packs.
 *
 * Packs in the database with no file are left completely alone. They got
 * there by upload, which is just as legitimate a way to own a pack —
 * this folder is a door, not the definition of what exists.
 */
export async function sweep(db, data, { quiet = false } = {}) {
  const dir = packsDir(data);
  await mkdir(dir, { recursive: true });
  const say = quiet ? () => {} : log;

  const files = (await readdir(dir).catch(() => [])).filter(
    (f) => !f.startsWith('.') && /\.(pack|json)$/i.test(f),
  );

  let added = 0;
  let updated = 0;
  const onDisk = new Set();
  for (const file of files) {
    const path = join(dir, file);
    let pack;
    try {
      pack = await readPack(path);
    } catch (e) {
      say(`could not read ${file}: ${e.message}`);
      continue;
    }

    const outcome = store(db, pack);
    if (outcome === 'added') {
      added++;
      say(`found ${pack.name}`);
    } else if (outcome === 'updated') {
      updated++;
      say(`${pack.name} updated to v${pack.version}`);
    }

    // Name the file after the pack, so the folder reads as a shelf and a
    // second copy of the same pack overwrites rather than doubling.
    const proper = join(dir, `${pack.id}.pack`);
    if (path !== proper && !(await stat(proper).catch(() => null))) {
      await rename(path, proper);
    }
    onDisk.add(pack.id);
  }

  // The other direction: a pack that arrived by upload, or predates this
  // folder existing, gets written out. Without this the shelf shows only
  // half of what the host has, and "share your homebrew as a .pack" has
  // no file to point at.
  let written = 0;
  for (const row of db.prepare('SELECT data FROM packs').all()) {
    const pack = JSON.parse(row.data);
    if (!pack.id || onDisk.has(pack.id)) continue;
    await writePack(data, pack);
    written++;
  }
  if (written) say(`wrote ${written} pack file(s) to ${dir}`);

  return { onDisk: onDisk.size, added, updated, written };
}

/**
 * Write a pack out to the folder.
 *
 * The other direction: a pack that arrived by upload should become a
 * file, or the folder would only ever show half of what this host has —
 * and there'd be nothing to hand someone when they ask for your
 * homebrew.
 */
export async function writePack(data, pack) {
  const dir = packsDir(data);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${pack.id}.pack`);
  await writeFile(path, `${JSON.stringify(pack, null, 2)}\n`);
  return path;
}
