// A pack, written out as several files instead of one.
//
// A `.pack` is an ARCHIVE — the same shape `.story` already is — because
// a pack has to carry its art (TEL-88). Once it's an archive there's no
// reason for the contents to stay crammed into a single JSON blob, so
// they aren't:
//
//   pack.json       who this pack is: id, system, name, version, rights, books
//   sections.json   the rulings
//   bestiary.json   the foes
//   catalog.json    items and upgrades
//   trades.json     the playable trades
//   creation.json   the creation flow's own prose
//   notes.json      the sheet's panel captions
//   art/…           the images, at whatever paths the pack references
//
// **The file split is a serialization, not a data model.** Everything
// here assembles back into exactly one `RulesPack`, which is what gets
// stored and what every consumer already reads. Splitting the FILE and
// splitting the TYPE are different changes and only the first one is
// wanted: `bestiary.ts`, `creation.ts` and the merge rules never learn
// that this happened.
//
// A folder is as valid as an archive. `~/.teller/packs/wiw-guidebook/`
// with these files in it installs exactly like `wiw-guidebook.pack`,
// which is what makes authoring bearable — edit `bestiary.json` in
// place, bump the version, done. The archive is for handing to someone.

import type { RulesPack } from './types';

/** `pack.json` holds what identifies a pack; the rest is content. */
const MANIFEST_KEYS = ['id', 'system', 'name', 'version', 'rights', 'books'] as const;

/**
 * File name → the `RulesPack` key it carries. One to one on purpose: a
 * reader should never have to know that two keys share a file.
 */
export const PACK_PARTS: Record<string, keyof RulesPack> = {
  'sections.json': 'sections',
  'bestiary.json': 'npcs',
  'catalog.json': 'catalog',
  'trades.json': 'trades',
  'creation.json': 'creation',
  'notes.json': 'notes',
};

/** Everything under here is bytes, not JSON, and travels with the pack. */
export const ART_PREFIX = 'art/';

/**
 * Where a pack's art lives in the object store, once it's installed.
 *
 * Under `art/<pack id>/`, and NOT under `packs/` — which was the first
 * shape tried and lasted about a minute. On a host the object store's
 * root IS the data directory, so a key of `packs/pak_…/art/x.png` writes
 * a real folder inside `~/.teller/packs/`, where the pack sweep then
 * finds it and reports a pack with no `pack.json`. The object store and
 * the pack shelf share a filesystem; their namespaces have to not
 * collide.
 *
 * The pack-relative `art/` is dropped rather than nested, so the key
 * reads as `art/pak_…/wiw/logo.png` instead of doubling the word.
 */
export const artKey = (packId: string, path: string) =>
  `${ART_PREFIX}${packId}/${path.slice(ART_PREFIX.length)}`;

export type PackParts = { name: string; json: unknown }[];

/**
 * Put a pack back together from its files.
 *
 * `pack.json` is required — it carries the identity. Every other part is
 * optional, which is the same "sections, not types" bargain a bundle
 * makes: a bestiary-only pack and a whole core book are the same format,
 * distinguished by what's in them rather than by a declared kind.
 */
export function assemble(files: Map<string, unknown>): RulesPack {
  const manifest = files.get('pack.json');
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('a pack needs a pack.json');
  }
  const pack = { ...(manifest as Record<string, unknown>) } as RulesPack;
  if (!pack.system || !pack.name) {
    throw new Error('a pack needs at least system and name');
  }
  if (typeof pack.version !== 'number') pack.version = 1;
  // `parts()` omits empty files, so absence must assemble back to what
  // emptiness meant. `sections` is the one key the type REQUIRES —
  // skipping this line shipped a bestiary-only pack with no `sections`
  // at all, and every screen that loads packs (consoles AND seats)
  // crashed mid-render on `pack.sections is not iterable`. The flash
  // of content before the fetch landed made it look like a display
  // bug; it was a serializer breaking its own round-trip contract.
  pack.sections ??= [];

  for (const [name, key] of Object.entries(PACK_PARTS)) {
    const part = files.get(name);
    if (part !== undefined) (pack as Record<string, unknown>)[key] = part;
  }
  return pack;
}

/**
 * Take a pack apart into the files it's written as.
 *
 * Empty parts are omitted rather than written as `[]`: a pack that has
 * no trades shouldn't ship a file claiming it thought about trades.
 */
export function parts(pack: RulesPack): PackParts {
  const manifest: Record<string, unknown> = {};
  for (const key of MANIFEST_KEYS) {
    const value = (pack as Record<string, unknown>)[key];
    if (value !== undefined) manifest[key] = value;
  }

  const out: PackParts = [{ name: 'pack.json', json: manifest }];
  for (const [name, key] of Object.entries(PACK_PARTS)) {
    const value = (pack as Record<string, unknown>)[key];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && !value.length) continue;
    if (!Array.isArray(value) && typeof value === 'object' && !Object.keys(value).length) {
      continue;
    }
    out.push({ name, json: value });
  }
  return out;
}

/**
 * Rewrite every art path in a pack, wherever one happens to live.
 *
 * A deep walk rather than a list of fields, and that's deliberate. Art
 * references are scattered — `creation.welcome.art`, a trade's `art`, a
 * catalogue entry's `art`, and whatever gets added next — so a field
 * list would be a thing to forget to update. Anything that reads like a
 * pack-relative art path IS one; nothing else in a pack begins `art/`.
 */
function rewrite(value: unknown, map: (s: string) => string): unknown {
  if (typeof value === 'string') return map(value);
  if (Array.isArray(value)) return value.map((v) => rewrite(v, map));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = rewrite(v, map);
    return out;
  }
  return value;
}

/**
 * Pack-relative art paths → object-store keys, on the way in.
 *
 * The author writes `art/logo.png` and never types a global key. That's
 * what makes a pack portable AND collision-proof: two people's packs
 * both containing `art/logo.png` land under their own ids and never
 * meet. Resolving here — once, at install — is also why no renderer
 * needed changing: the stored pack holds the same absolute keys it
 * always did, and `packArtUrl` is none the wiser.
 */
export function absolutizeArt(pack: RulesPack, id: string): RulesPack {
  return rewrite(pack, (s) =>
    s.startsWith(ART_PREFIX) && !s.startsWith(`${ART_PREFIX}${id}/`) ? artKey(id, s) : s,
  ) as RulesPack;
}

/** The mirror, for writing a pack back out as a file you can hand over. */
export function relativizeArt(pack: RulesPack, id: string): RulesPack {
  const prefix = `${ART_PREFIX}${id}/`;
  return rewrite(pack, (s) =>
    s.startsWith(prefix) ? `${ART_PREFIX}${s.slice(prefix.length)}` : s,
  ) as RulesPack;
}

/** Every art path a pack refers to, relative to the pack. */
export function artPaths(pack: RulesPack, id: string): string[] {
  const found = new Set<string>();
  const prefix = `${ART_PREFIX}${id}/`;
  rewrite(pack, (s) => {
    if (s.startsWith(prefix)) found.add(`${ART_PREFIX}${s.slice(prefix.length)}`);
    else if (s.startsWith(ART_PREFIX)) found.add(s);
    return s;
  });
  return [...found];
}
