import type { Env } from './db';
import { toCampaign, toCharacter } from './db';
import { packsFor } from './packs';
import { getSystem, saveSystem } from './systems';
import { zipStream, jsonEntry, type ZipEntry } from './zip';
import type { Campaign, Character, SystemTemplate } from './types';

// `.story` files — a whole game in one file.
//
// A bundle is a zip of OPTIONAL SECTIONS, and that's the entire design.
// There are no bundle "types": a system bundle is one that carries
// `system.json`, a module is one that carries scenes and foes and
// requires a system it doesn't include. Nothing has to know which kind
// it's holding, because import is always the same operation — merge
// what's present, skip what isn't.
//
// **What a publisher wrote stays put; what you wrote travels** (rule 9).
// Books were always referenced rather than carried. Packs are too, as of
// TEL-62 — and that closes a real hole, not a theoretical one: a bundle
// used to carry pack bodies whole, which made a WiW export ~124 KB of
// distilled rules text against 563 bytes of book references. 96% of the
// file was the thing the format claimed not to contain.
//
// So this file no longer writes rules content of any kind. It writes a
// `requires` list, and whoever opens it either has those packs or is
// told exactly which ones they're missing. The IP line stops being a
// rule someone has to remember and becomes a property of the format,
// which is what the old comment here claimed while `pack.json` sat
// directly beside it.
//
// Export is also the BACKUP. Once the campaign lives on a host under
// your table there is no cloud copy, and a dead drive is a dead campaign
// unless you've written one of these. Packs being referenced is the one
// cost: back up `~/.teller/packs/` alongside the `.story`.

/** 2: packs are referenced, not carried. 1 carried them whole. */
export const BUNDLE_VERSION = 2;

/** A pack the bundle expects the opener to have. */
export type PackRef = {
  id: string;
  /** For saying "you're missing the WiW Guidebook", not for matching. */
  name: string;
  version: number;
};

export type BundleManifest = {
  teller: number;
  name: string;
  /** The system these contents belong to. */
  system: string;
  /** What a reader will find inside, so it can be shown before unpacking. */
  contains: string[];
  /**
   * What this bundle needs and does NOT provide.
   *
   * `system` when it expects a system template it doesn't carry; `packs`
   * for the rules content it references. Ordered, and the order is the
   * precedence the campaign was built with — see `CampaignData.packs`.
   */
  requires?: { system?: string; packs?: PackRef[] };
  /**
   * True when this carries rules content of its own — a bestiary the
   * campaign wrote, which is somebody's stat blocks either way.
   *
   * References don't count, and that's now the whole point: a bundle
   * that only REFERENCES packs and books carries no publisher text, so
   * this flag finally means what it says. It was set on packs too, and
   * nothing ever read it.
   */
  personal: boolean;
  exportedAt: string;
};

/**
 * What kind of thing this bundle is — derived, never stored.
 *
 * A declared kind goes stale the moment the bundle is edited; a derived
 * one can't lie. The console reads this to say "starting kit" versus
 * "an adventure you can run tonight". The importer never branches on it:
 * import is one operation regardless.
 */
export function bundleKind(contains: string[]): string {
  const has = (s: string) => contains.includes(s);
  if (has('encounters') || has('scenes')) return 'an adventure';
  if (has('system')) return 'a starting kit';
  return 'a campaign';
}

type BookRow = {
  id: string;
  name: string;
  pages: number;
  /** Object-storage key, or null for a book the host doesn't hold. */
  key: string | null;
};

/**
 * Everything about one campaign, as a stream of zip entries.
 *
 * Yielded lazily so the archive is written as it's read: a bundle with
 * scene art in it should never be assembled in memory first.
 */
async function* campaignEntries(
  env: Env,
  campaign: Campaign,
  characters: Character[],
  template: SystemTemplate | undefined,
  opts: { books: boolean; assets: boolean },
): AsyncGenerator<ZipEntry> {
  const data = campaign.data ?? {};
  const contains: string[] = ['campaign'];

  const npcs = data.npcs ?? [];
  const encounters = data.encounters ?? [];
  const scenes = data.maps ?? [];
  const handouts = data.handouts ?? [];

  // The packs this campaign RUNS ON, in its own precedence order —
  // referenced, never carried. `packsFor` falls back to every pack for
  // the system when the campaign hasn't declared a list, which is what
  // makes this work for campaigns that predate the claim existing.
  const packs = await packsFor(env, campaign);
  // The books this campaign CLAIMS, not every book on the host. A book
  // has no system to be selected by (migration 0008) and never did have
  // one worth trusting; `data.books` is the campaign saying which
  // rulebooks it expects, which is the only relationship that was ever
  // true.
  const claimed = data.books ?? [];
  const books =
    opts.books && claimed.length
      ? await env.DB.prepare(
          `SELECT * FROM books WHERE id IN (${claimed.map(() => '?').join(',')})`,
        )
          .bind(...claimed)
          .all()
      : { results: [] as unknown[] };

  if (template) contains.push('system');
  if (npcs.length) contains.push('bestiary');
  if (encounters.length) contains.push('encounters');
  if (characters.length) contains.push('characters');
  if (scenes.length) contains.push('scenes');
  if (handouts.length) contains.push('handouts');
  if (books.results.length) contains.push('books');

  const manifest: BundleManifest = {
    teller: BUNDLE_VERSION,
    name: campaign.name,
    system: campaign.system,
    contains,
    // Rules content is anything a publisher wrote. Structure isn't, and
    // neither is a reference to a pack or a book you both happen to own.
    personal: npcs.length > 0,
    exportedAt: new Date().toISOString(),
  };
  if (!template || packs.length) {
    manifest.requires = {
      ...(template ? {} : { system: campaign.system }),
      ...(packs.length
        ? {
            packs: packs.map((p) => ({
              id: p.id,
              name: p.name,
              version: p.pack.version ?? 1,
            })),
          }
        : {}),
    };
  }

  yield jsonEntry('teller.json', manifest);

  if (template) yield jsonEntry('system.json', template);

  // The campaign itself, minus anything derived or screen-specific.
  // Calibration is deliberately dropped: it belongs to a piece of glass,
  // and carrying one table's ppi to another table would be worse than
  // carrying nothing.
  yield jsonEntry('campaign.json', {
    // Identity travels so a re-import can recognise its own kin and
    // offer to layer, instead of silently producing a second campaign
    // that looks identical and diverges from here on.
    id: campaign.data.originId ?? campaign.id,
    name: campaign.name,
    system: campaign.system,
    vocabulary: data.vocabulary ?? {},
    counters: data.counters ?? [],
    states: data.states ?? [],
    reference: data.reference ?? '',
    activeMapId: data.activeMapId ?? null,
    // The claim travels with the campaign, so an import lands with the
    // same packs in the same precedence — the manifest's `requires` is
    // for a human reading the box, this is what the importer restores.
    packs: packs.map((p) => p.id),
    // Which printing this table uses where a foe is in two packs. A
    // decision a person made; it would be silently re-defaulted
    // otherwise, which is rule 1 in miniature.
    foePicks: data.foePicks ?? {},
    // The table's own inventions travel with it (rule 9: what you
    // wrote travels; what a publisher wrote stays in the pack this
    // bundle references). Kitbashed gear and the world's shops are
    // both yours — a shop's stock references catalogue ids exactly
    // the way a character's items do.
    ...(data.catalog ? { catalog: data.catalog } : {}),
    ...(data.vendors?.length ? { vendors: data.vendors } : {}),
  });

  if (npcs.length) yield jsonEntry('bestiary.json', npcs);
  // Prepared fights. Most of what an adventure module actually is —
  // and they're recipes, so they carry no live state and can be run
  // again for the next group.
  if (encounters.length) yield jsonEntry('encounters.json', encounters);
  if (characters.length) {
    yield jsonEntry(
      'characters.json',
      characters.map((c) => ({
        name: c.name,
        kind: c.kind,
        data: c.data,
      })),
    );
  }
  if (scenes.length) yield jsonEntry('scenes.json', scenes);
  if (handouts.length) yield jsonEntry('handouts.json', handouts);

  // Scene art and handout images. These have to travel: the table TV is
  // a different machine from the console, so anything a second screen
  // renders lives on the host and belongs in the bundle.
  if (opts.assets) {
    const keys = new Set<string>();
    for (const scene of scenes) if (scene.key) keys.add(scene.key);
    for (const handout of handouts) if (handout.key) keys.add(handout.key);
    if (data.map?.key) keys.add(data.map.key);
    for (const key of keys) {
      const object = await env.MAPS.get(key);
      if (!object?.body) continue;
      yield { name: `assets/${key}`, data: object.body };
    }
  }

  // Books are REFERENCED, never carried.
  //
  // You own the rulebooks; a campaign refers to them. So a bundle says
  // "this expects the WiW Guidebook, bok_a23d…" and stays small enough
  // to email. Two consequences, both wanted:
  //
  // A `.story` contains no rules content — no PDF, no page text, and
  // since TEL-62 no pack bodies either — so it is safe to hand to
  // someone. That claim used to sit here while `pack.json` was written
  // twenty lines above it; it is true now because the packs left, not
  // because the sentence was reworded.
  //
  // And because a book's id is the hash of its own bytes, a reference
  // resolves on any host that has that book, with no registry and no
  // coordination. Whoever opens this either owns the book or is told
  // exactly which one they're missing.
  if (books.results.length) {
    const rows = books.results as unknown as BookRow[];
    yield jsonEntry(
      'books.json',
      rows.map((b) => ({ id: b.id, name: b.name })),
    );
  }
}

export function exportCampaign(
  env: Env,
  campaign: Campaign,
  characters: Character[],
  template: SystemTemplate | undefined,
  opts: { books: boolean; assets: boolean },
): ReadableStream<Uint8Array> {
  return zipStream(campaignEntries(env, campaign, characters, template, opts));
}

/**
 * Filenames should look like what they are when they land in Downloads.
 *
 * `.story`, not `.tell`. The pun was nice and completely opaque; this
 * explains itself. There is deliberately no second extension for the
 * "starting kit" case — kit and adventure differ only in how FULL they
 * are, which is fuzzy and unfixable once someone holds the file. A new
 * extension tracks a different KIND of thing, which is why `.pack` earns
 * one: different folder, different lifecycle, different identity scheme,
 * and it never travels with a campaign.
 */
export function bundleFilename(campaign: Campaign): string {
  const slug =
    campaign.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'campaign';
  return `${slug}.story`;
}

export { getSystem, saveSystem, toCampaign, toCharacter };
