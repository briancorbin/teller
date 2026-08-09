import type { Env } from './db';
import { toCampaign } from './db';
import { saveSystem, getSystem } from './systems';
import { readZip, readJson, type ZipFile } from './unzip';
import type { BundleManifest } from './bundle';
import type {
  Campaign,
  CampaignData,
  CharacterData,
  EncounterState,
  Handout,
  NpcBlueprint,
  Scene,
  SystemTemplate,
} from './types';

// Importing a `.tell` file: merge what's present, skip what isn't.
//
// Two passes, because you should be able to see what's in a box before
// you open it. `inspect` reads the manifest and counts what's inside;
// `apply` does the work, and only for the sections you said yes to.
//
// The governing rule when something already exists is rule 1: **the
// stored value wins.** An imported foe you've since edited stays edited,
// and the import says what it left alone. Anything else would mean a
// bundle update quietly overwriting a Warden's own decisions, which is
// the exact thing "override IS the architecture" was written to prevent.

export type BundleSummary = {
  manifest: BundleManifest;
  sections: { name: string; count: number; label: string }[];
  /** Set when the bundle needs a system this instance doesn't have. */
  missingSystem?: string;
};

type PackEntry = { name: string; system: string; pack: unknown };
type CharacterEntry = { name: string; kind: string; data: CharacterData };
type BookEntry = { id: string; name: string; system: string; pages: number };

const newId = (prefix: string) =>
  `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

export async function inspect(buffer: ArrayBuffer): Promise<BundleSummary> {
  const files = await readZip(buffer);
  const manifest = await readJson<BundleManifest>(files, 'teller.json');
  if (!manifest?.teller) {
    throw new Error('no teller.json — this zip is not a .tell bundle');
  }

  const count = async (name: string) =>
    ((await readJson<unknown[]>(files, name)) ?? []).length;

  const sections: BundleSummary['sections'] = [];
  const add = (name: string, n: number, label: string) => {
    if (n > 0) sections.push({ name, count: n, label });
  };

  if (files.has('system.json')) add('system', 1, 'the system itself');
  if (files.has('campaign.json')) add('campaign', 1, 'campaign settings');
  add('bestiary', await count('bestiary.json'), 'foes');
  add('characters', await count('characters.json'), 'characters');
  add('pack', await count('pack.json'), 'rules packs');
  add('scenes', await count('scenes.json'), 'maps');
  add('handouts', await count('handouts.json'), 'handouts');
  add('books', await count('books.json'), 'books (indexes only)');

  const assets = [...files.keys()].filter((n) => n.startsWith('assets/')).length;
  add('assets', assets, 'images');

  const summary: BundleSummary = { manifest, sections };
  if (!files.has('system.json')) {
    summary.missingSystem = manifest.requires?.system ?? manifest.system;
  }
  return summary;
}

export type ImportResult = {
  campaignId: string;
  applied: string[];
  skipped: string[];
};

/**
 * Unpack a bundle into this instance.
 *
 * `campaignId` targets an existing campaign; without it a new one is
 * created from `campaign.json`, which is the "new campaign, click
 * import, everything's there" path.
 */
export async function apply(
  env: Env,
  buffer: ArrayBuffer,
  opts: { campaignId?: string; sections?: string[] },
): Promise<ImportResult> {
  const files = await readZip(buffer);
  const manifest = await readJson<BundleManifest>(files, 'teller.json');
  if (!manifest?.teller) throw new Error('no teller.json — not a .tell bundle');

  const wants = (name: string) => !opts.sections || opts.sections.includes(name);
  const applied: string[] = [];
  const skipped: string[] = [];

  // The system first: everything else is shaped by it, and a campaign
  // for a system this instance has never heard of is a campaign with no
  // character sheet.
  const template = await readJson<SystemTemplate>(files, 'system.json');
  if (template && wants('system')) {
    await saveSystem(env, template);
    applied.push(`system “${template.name}”`);
  }
  const system = template?.system ?? manifest.system;
  if (!(await getSystem(env, system))) {
    throw new Error(
      `this bundle needs the “${system}” system, which isn't installed — import its core bundle first`,
    );
  }

  const incoming = await readJson<Partial<CampaignData> & { name?: string }>(
    files,
    'campaign.json',
  );

  // Find or make the campaign.
  let campaign: Campaign;
  if (opts.campaignId) {
    const row = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ?')
      .bind(opts.campaignId)
      .first();
    if (!row) throw new Error('campaign not found');
    campaign = toCampaign(row as never);
  } else {
    const id = newId('cmp');
    const name = incoming?.name ?? manifest.name ?? 'Imported campaign';
    const data: CampaignData = {
      vocabulary: incoming?.vocabulary ?? {},
      counters: incoming?.counters ?? [],
      states: (incoming?.states as EncounterState[]) ?? [],
    };
    await env.DB.prepare(
      'INSERT INTO campaigns (id, name, system, data) VALUES (?, ?, ?, ?)',
    )
      .bind(id, name, system, JSON.stringify(data))
      .run();
    const row = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ?')
      .bind(id)
      .first();
    campaign = toCampaign(row as never);
    applied.push(`campaign “${name}”`);
  }

  const data: CampaignData = { ...campaign.data };

  // Bestiary. Blueprints carry their ids, so re-importing an updated
  // bundle updates rather than duplicates — but only the ones nobody
  // has touched. Rule 1.
  const bestiary = await readJson<NpcBlueprint[]>(files, 'bestiary.json');
  if (bestiary?.length && wants('bestiary')) {
    const existing = new Map((data.npcs ?? []).map((n) => [n.id, n]));
    let added = 0;
    let kept = 0;
    for (const npc of bestiary) {
      if (existing.has(npc.id)) kept++;
      else {
        existing.set(npc.id, npc);
        added++;
      }
    }
    data.npcs = [...existing.values()];
    applied.push(`${added} foe${added === 1 ? '' : 's'}`);
    if (kept) skipped.push(`${kept} foe${kept === 1 ? '' : 's'} you already had`);
  }

  const scenes = await readJson<Scene[]>(files, 'scenes.json');
  if (scenes?.length && wants('scenes')) {
    const have = new Set((data.maps ?? []).map((s) => s.id));
    const fresh = scenes.filter((s) => !have.has(s.id));
    data.maps = [...(data.maps ?? []), ...fresh];
    applied.push(`${fresh.length} map${fresh.length === 1 ? '' : 's'}`);
    if (scenes.length - fresh.length) {
      skipped.push(`${scenes.length - fresh.length} maps you already had`);
    }
  }

  const handouts = await readJson<Handout[]>(files, 'handouts.json');
  if (handouts?.length && wants('handouts')) {
    const have = new Set((data.handouts ?? []).map((h) => h.id));
    const fresh = handouts.filter((h) => !have.has(h.id));
    data.handouts = [...(data.handouts ?? []), ...fresh];
    applied.push(`${fresh.length} handout${fresh.length === 1 ? '' : 's'}`);
  }

  if (incoming && opts.campaignId && wants('campaign')) {
    // Merging into an existing campaign adds vocabulary and party
    // counters it doesn't have; it never rewrites what's there.
    data.vocabulary = { ...(incoming.vocabulary ?? {}), ...data.vocabulary };
    if (!data.states?.length && incoming.states) {
      data.states = incoming.states as EncounterState[];
    }
  }

  await env.DB.prepare('UPDATE campaigns SET data = ? WHERE id = ?')
    .bind(JSON.stringify(data), campaign.id)
    .run();

  // Images. These have to land in object storage or the table renders a
  // scene with no ground under it.
  if (wants('assets')) {
    let stored = 0;
    for (const [name, file] of files) {
      if (!name.startsWith('assets/')) continue;
      const key = name.slice('assets/'.length);
      const existing = await env.MAPS.get(key);
      if (existing) continue;
      const contentType = key.endsWith('.png')
        ? 'image/png'
        : key.endsWith('.webp')
          ? 'image/webp'
          : 'image/jpeg';
      await env.MAPS.put(key, await file.bytes(), { httpMetadata: { contentType } });
      stored++;
    }
    if (stored) applied.push(`${stored} image${stored === 1 ? '' : 's'}`);
  }

  const characters = await readJson<CharacterEntry[]>(files, 'characters.json');
  if (characters?.length && wants('characters')) {
    const have = await env.DB.prepare(
      'SELECT name FROM characters WHERE campaign_id = ?',
    )
      .bind(campaign.id)
      .all();
    const names = new Set((have.results as { name: string }[]).map((r) => r.name));
    let added = 0;
    for (const character of characters) {
      if (names.has(character.name)) continue;
      await env.DB.prepare(
        'INSERT INTO characters (id, campaign_id, name, kind, data) VALUES (?, ?, ?, ?, ?)',
      )
        .bind(
          newId('chr'),
          campaign.id,
          character.name,
          character.kind === 'npc' ? 'npc' : 'pc',
          JSON.stringify(character.data),
        )
        .run();
      added++;
    }
    applied.push(`${added} character${added === 1 ? '' : 's'}`);
    if (characters.length - added) {
      skipped.push(`${characters.length - added} already at this table`);
    }
  }

  const packs = await readJson<PackEntry[]>(files, 'pack.json');
  if (packs?.length && wants('pack')) {
    for (const entry of packs) {
      await env.DB.prepare(
        `INSERT INTO packs (id, system, name, data) VALUES (?, ?, ?, ?)
         ON CONFLICT (system, name) DO UPDATE SET data = excluded.data,
           updated_at = datetime('now')`,
      )
        .bind(newId('pak'), entry.system ?? system, entry.name, JSON.stringify(entry.pack))
        .run();
    }
    applied.push(`${packs.length} rules pack${packs.length === 1 ? '' : 's'}`);
  }

  // Books arrive as metadata plus a page index — searchable immediately,
  // with no extraction wait. The PDF itself belongs to whichever device
  // holds it; a book listed but absent shows as "not on this screen"
  // rather than as a broken row.
  const books = await readJson<BookEntry[]>(files, 'books.json');
  if (books?.length && wants('books')) {
    let added = 0;
    for (const book of books) {
      const index = await readJson<{ page: number; text: string }[]>(
        files,
        `books/${book.id}.index.json`,
      );
      await env.DB.prepare(
        `INSERT INTO books (id, system, name, pages, indexed) VALUES (?, ?, ?, ?, 1)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name`,
      )
        .bind(book.id, book.system ?? system, book.name, book.pages ?? 0)
        .run();
      if (index?.length) {
        // Chunked: a 400-page book is 400 statements, and D1 has limits
        // on how much one batch may carry.
        for (let i = 0; i < index.length; i += 50) {
          await env.DB.batch(
            index.slice(i, i + 50).map((page) =>
              env.DB.prepare(
                `INSERT INTO book_pages (book_id, page, text) VALUES (?, ?, ?)
                 ON CONFLICT (book_id, page) DO UPDATE SET text = excluded.text`,
              ).bind(book.id, page.page, page.text),
            ),
          );
        }
      }
      added++;
    }
    applied.push(`${added} book${added === 1 ? '' : 's'}, already indexed`);
  }

  return { campaignId: campaign.id, applied, skipped };
}

export type { ZipFile };
