import type { Env } from './db';
import { toCampaign, toCharacter } from './db';
import { getSystem, saveSystem } from './systems';
import { zipStream, jsonEntry, type ZipEntry } from './zip';
import type { Campaign, Character, SystemTemplate } from './types';

// `.tell` files — a whole game in one file.
//
// A bundle is a zip of OPTIONAL SECTIONS, and that's the entire design.
// There are no bundle "types": `wiw_core.tell` is one that happens to
// omit books, `wiw_books.tell` is one that carries only books, and a
// module is one that carries scenes and foes and requires a system it
// doesn't include. Nothing has to know which kind it's holding, because
// import is always the same operation — merge what's present, skip what
// isn't.
//
// Two things travel that are worth naming. Export is also the BACKUP:
// once the campaign lives on a host under your table, there is no cloud
// copy, and a dead drive is a dead campaign unless you've written one of
// these. And a bundle carrying a bestiary, a pack or a book carries
// rules CONTENT — fine to hold and to carry between your own tables,
// not fine to publish. The manifest says so out loud rather than leaving
// it to be assumed.

export const BUNDLE_VERSION = 1;

export type BundleManifest = {
  teller: number;
  name: string;
  /** The system these contents belong to. */
  system: string;
  /** What a reader will find inside, so it can be shown before unpacking. */
  contains: string[];
  /** Set when the bundle expects a system it does NOT itself provide. */
  requires?: { system: string };
  /**
   * True when anything in here is rules content — a bestiary, a pack,
   * a book. Only a bare `system.json` is genuinely safe to hand out.
   */
  personal: boolean;
  exportedAt: string;
};

type PackRow = { id: string; system: string; name: string; data: string };
type BookRow = { id: string; system: string; name: string; pages: number };

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
  const scenes = data.maps ?? [];
  const handouts = data.handouts ?? [];

  const packs = await env.DB.prepare('SELECT * FROM packs WHERE system = ?')
    .bind(campaign.system)
    .all();
  const books = opts.books
    ? await env.DB.prepare('SELECT * FROM books WHERE system = ?')
        .bind(campaign.system)
        .all()
    : { results: [] as unknown[] };

  if (template) contains.push('system');
  if (npcs.length) contains.push('bestiary');
  if (characters.length) contains.push('characters');
  if (packs.results.length) contains.push('pack');
  if (scenes.length) contains.push('scenes');
  if (handouts.length) contains.push('handouts');
  if (books.results.length) contains.push('books');

  const manifest: BundleManifest = {
    teller: BUNDLE_VERSION,
    name: campaign.name,
    system: campaign.system,
    contains,
    // Rules content is anything a publisher wrote. Structure isn't.
    personal:
      npcs.length > 0 || packs.results.length > 0 || books.results.length > 0,
    exportedAt: new Date().toISOString(),
  };
  if (!template) manifest.requires = { system: campaign.system };

  yield jsonEntry('teller.json', manifest);

  if (template) yield jsonEntry('system.json', template);

  // The campaign itself, minus anything derived or screen-specific.
  // Calibration is deliberately dropped: it belongs to a piece of glass,
  // and carrying one table's ppi to another table would be worse than
  // carrying nothing.
  yield jsonEntry('campaign.json', {
    name: campaign.name,
    system: campaign.system,
    vocabulary: data.vocabulary ?? {},
    counters: data.counters ?? [],
    states: data.states ?? [],
    reference: data.reference ?? '',
    activeMapId: data.activeMapId ?? null,
  });

  if (npcs.length) yield jsonEntry('bestiary.json', npcs);
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
  if (packs.results.length) {
    yield jsonEntry(
      'pack.json',
      (packs.results as unknown as PackRow[]).map((p) => ({
        name: p.name,
        system: p.system,
        pack: JSON.parse(p.data),
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

  // Books: the page index travels, so search works the moment this
  // lands. The PDFs themselves are held by whichever device imported
  // them, which is the bargain books have always made here.
  if (books.results.length) {
    const rows = books.results as unknown as BookRow[];
    yield jsonEntry(
      'books.json',
      rows.map((b) => ({ id: b.id, name: b.name, system: b.system, pages: b.pages })),
    );
    for (const book of rows) {
      const pages = await env.DB.prepare(
        'SELECT page, text FROM book_pages WHERE book_id = ? ORDER BY page',
      )
        .bind(book.id)
        .all();
      yield jsonEntry(`books/${book.id}.index.json`, pages.results);
    }
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

/** Filenames should look like what they are when they land in Downloads. */
export function bundleFilename(campaign: Campaign): string {
  const slug =
    campaign.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'campaign';
  return `${slug}.tell`;
}

export { getSystem, saveSystem, toCampaign, toCharacter };
