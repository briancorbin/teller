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
// A `.pack` is an ARCHIVE — pack.json, the parts, and `art/` — because a
// pack carries its own pictures (TEL-88). Drop one in and it's
// installed; a campaign says which ones it needs and the host either has
// them or names what's missing.
//
// **A folder is a pack too**, and that's the half that matters daily:
//
//   ~/.teller/packs/wiw-guidebook/pack.json, bestiary.json, art/…
//
// Authoring against an archive would mean zip, copy, upload after every
// corrected page number. Authoring against a folder means opening
// `bestiary.json`, fixing the foe and bumping the version. Same format,
// same sweep, no build step — which is the deal books and packs have
// always offered: the folder is the door.
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
import { dirname, join, relative, sep } from 'node:path';
import { randomBytes } from 'node:crypto';

export const packsDir = (data) => join(data, 'packs');

const log = (msg) => console.log(`  ${msg}`);

/** Minted, never hashed — a pack outlives its own edits. */
const mintId = () => `pak_${randomBytes(6).toString('hex')}`;

const isArt = (name, ART_PREFIX) => name.startsWith(ART_PREFIX);

/** Enough of a guess to serve the picture back with the right header. */
const contentTypeFor = (path) =>
  /\.png$/i.test(path)
    ? 'image/png'
    : /\.jpe?g$/i.test(path)
      ? 'image/jpeg'
      : /\.webp$/i.test(path)
        ? 'image/webp'
        : /\.svg$/i.test(path)
          ? 'image/svg+xml'
          : 'application/octet-stream';

/** Every file in a folder, named relative to it — the archive's shape. */
async function* walk(dir, base = dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path, base);
    else yield { name: relative(base, path).split(sep).join('/'), path };
  }
}

/**
 * Read a pack from a folder or an archive, into the same two halves.
 *
 * `json` is the parts that assemble into a row; `art` is bytes that have
 * to be written somewhere. Deliberately identical for both sources —
 * the difference between a folder and a zip is where the bytes came
 * from, and nothing downstream should be able to tell.
 */
async function readParts(path, isDir, w) {
  const json = new Map();
  const art = new Map();

  if (isDir) {
    for await (const file of walk(path)) {
      if (isArt(file.name, w.ART_PREFIX)) {
        art.set(file.name, () => readFile(file.path));
      } else if (file.name.endsWith('.json') && !file.name.includes('/')) {
        json.set(file.name, JSON.parse(await readFile(file.path, 'utf8')));
      }
    }
    return { json, art };
  }

  const buffer = await readFile(path);
  const files = await w.readZip(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  );
  const decoder = new TextDecoder();
  for (const [name, file] of files) {
    if (isArt(name, w.ART_PREFIX)) art.set(name, () => file.bytes());
    else if (name.endsWith('.json') && !name.includes('/')) {
      json.set(name, JSON.parse(decoder.decode(await file.bytes())));
    }
  }
  return { json, art };
}

/**
 * Read one pack, giving it an id if it hasn't got one.
 *
 * A pack written by hand won't have an id, and it needs one before it
 * can be referenced by anything. Minting it and writing it BACK is the
 * important half: an id that only existed in the database would be a
 * different id on every host, which is the exact problem this whole
 * arrangement exists to fix. A folder can be written back to; an archive
 * gets its id at install and keeps it in the row.
 */
async function readPack(path, isDir, w) {
  const { json, art } = await readParts(path, isDir, w);
  const pack = w.assemble(json);

  if (!pack.id) {
    pack.id = mintId();
    if (isDir) {
      const manifest = json.get('pack.json');
      manifest.id = pack.id;
      await writeFile(join(path, 'pack.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    }
  }
  return { pack, art };
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
export async function sweep(db, data, { quiet = false, maps, worker } = {}) {
  const dir = packsDir(data);
  await mkdir(dir, { recursive: true });
  const say = quiet ? () => {} : log;

  // Without the bundle's helpers there is no format to read, so say so
  // once rather than failing per file. (Only the boot path has the
  // worker; a caller that forgot it is a bug worth naming.)
  if (!worker?.assemble) throw new Error('the pack sweep needs the worker bundle');

  const entries = (await readdir(dir, { withFileTypes: true }).catch(() => [])).filter(
    (e) => !e.name.startsWith('.') && (e.isDirectory() || /\.pack$/i.test(e.name)),
  );

  let added = 0;
  let updated = 0;
  const onDisk = new Set();
  for (const entry of entries) {
    const path = join(dir, entry.name);
    const isDir = entry.isDirectory();
    let pack;
    let art;
    try {
      ({ pack, art } = await readPack(path, isDir, worker));
    } catch (e) {
      say(`could not read ${entry.name}: ${e.message}`);
      continue;
    }

    // Art paths become object keys under this pack's id, once, here —
    // so nothing downstream ever sees a relative one and no two packs
    // can name the same picture.
    const resolved = worker.absolutizeArt(pack, pack.id);
    const outcome = store(db, resolved);
    if (outcome === 'added') {
      added++;
      say(`found ${pack.name}`);
    } else if (outcome === 'updated') {
      updated++;
      say(`${pack.name} updated to v${pack.version}`);
    }

    // Only write pictures for a pack that actually won. A proposal that
    // lost on version must not replace the art of the pack it lost to.
    if (outcome !== 'kept' && maps) {
      for (const [name, bytes] of art) {
        await maps.put(worker.artKey(pack.id, name), await bytes(), {
          httpMetadata: { contentType: contentTypeFor(name) },
        });
      }
    }

    // Name the file after the pack, so the folder reads as a shelf and a
    // second copy of the same pack overwrites rather than doubling. A
    // folder keeps whatever name its author gave it: that name is what
    // they're editing in, and renaming someone's working directory out
    // from under them is not a tidy-up.
    if (!isDir) {
      const proper = join(dir, `${pack.id}.pack`);
      if (path !== proper && !(await stat(proper).catch(() => null))) {
        await rename(path, proper);
      }
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
    await writePack(data, pack, { maps, worker });
    written++;
  }
  if (written) say(`wrote ${written} pack file(s) to ${dir}`);

  return { onDisk: onDisk.size, added, updated, written };
}

/**
 * Write a pack out to the shelf, as a FOLDER.
 *
 * The other direction: a pack that arrived by upload should appear on
 * the shelf, or the folder would only ever show half of what this host
 * has. It lands unzipped because that's the form you can work in — the
 * archive is for handing over, and `GET /api/packs/:id/file` builds one
 * on demand, so nothing is lost by not writing one here.
 *
 * Art paths go back to pack-relative on the way out. A file that named
 * this host's object keys would be a file that only worked on this host.
 */
export async function writePack(data, pack, { maps, worker } = {}) {
  const dir = join(packsDir(data), pack.id);
  await mkdir(dir, { recursive: true });

  const relative = worker ? worker.relativizeArt(pack, pack.id) : pack;
  for (const part of worker.parts(relative)) {
    await writeFile(join(dir, part.name), `${JSON.stringify(part.json, null, 2)}\n`);
  }

  if (maps && worker) {
    for (const path of worker.artPaths(pack, pack.id)) {
      const object = await maps.get(worker.artKey(pack.id, path));
      if (!object) continue;
      const target = join(dir, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(await object.arrayBuffer()));
    }
  }
  return dir;
}
