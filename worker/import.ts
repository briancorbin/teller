import type { Env } from './db';
import { toCampaign } from './db';
import { saveSystem, getSystem } from './systems';
import { readZip, readJson, type ZipFile } from './unzip';
import type { BundleManifest, PackRef } from './bundle';
import { savePack } from './packs';
import type {
  Campaign,
  CampaignData,
  CharacterData,
  Encounter,
  EncounterState,
  Handout,
  NpcBlueprint,
  RulesPack,
  Scene,
  SystemTemplate,
} from './types';
import { bestiaryFor } from './bestiary';

// Importing a `.story` file: merge what's present, skip what isn't.
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
  /**
   * Packs it references that aren't on this host.
   *
   * Reported, never silently dropped — the books precedent. Importing
   * anyway is fine and often right: the campaign works, the foes those
   * packs bring just aren't there until you drop the `.pack` in.
   */
  missingPacks?: PackRef[];
  /**
   * A campaign on this host that came from the same bundle.
   *
   * Importing without a target always makes a NEW campaign, which for a
   * module you've already loaded means a silent twin: same name, same
   * maps, and the one you've actually been playing sitting next to it.
   * Saying so lets the answer be "layer onto that one instead".
   */
  kin?: { id: string; name: string };
};

type PackEntry = { name: string; system: string; pack: unknown };
type CharacterEntry = { name: string; kind: string; data: CharacterData };
type BookEntry = { id: string; name: string };

const newId = (prefix: string) =>
  `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

/** Any campaign already descended from this bundle's campaign. */
async function findKin(
  env: Env,
  originId: string | undefined,
): Promise<{ id: string; name: string } | undefined> {
  if (!originId) return undefined;
  const rows = await env.DB.prepare('SELECT id, name, data FROM campaigns').all();
  for (const r of rows.results as { id: string; name: string; data: string }[]) {
    if (r.id === originId) return { id: r.id, name: r.name };
    try {
      if ((JSON.parse(r.data) as CampaignData).originId === originId) {
        return { id: r.id, name: r.name };
      }
    } catch {
      // Unparseable rows aren't kin to anything.
    }
  }
  return undefined;
}

export async function inspect(buffer: ArrayBuffer, env: Env): Promise<BundleSummary> {
  const files = await readZip(buffer);
  const manifest = await readJson<BundleManifest>(files, 'teller.json');
  if (!manifest?.teller) {
    throw new Error('no teller.json — this zip is not a .story bundle');
  }

  const count = async (name: string) =>
    ((await readJson<unknown[]>(files, name)) ?? []).length;

  const sections: BundleSummary['sections'] = [];
  // Counts are read aloud beside the number, so they have to agree with
  // it — "1 foes" is the kind of small wrongness that makes a tool feel
  // unfinished.
  const add = (name: string, n: number, one: string, many = `${one}s`) => {
    if (n > 0) sections.push({ name, count: n, label: n === 1 ? one : many });
  };

  if (files.has('system.json')) add('system', 1, 'the system itself');
  if (files.has('campaign.json')) add('campaign', 1, 'campaign settings');
  add('bestiary', await count('bestiary.json'), 'foe');
  add('encounters', await count('encounters.json'), 'prepared fight');
  add('characters', await count('characters.json'), 'character');
  // Bundles written before TEL-62 carry pack bodies. Still readable —
  // someone may be holding one — but nothing writes them any more.
  add('pack', await count('pack.json'), 'rules pack (old format)');
  add('scenes', await count('scenes.json'), 'map');
  add('handouts', await count('handouts.json'), 'handout');
  add('books', await count('books.json'), 'book it expects', 'books it expects');

  const assets = [...files.keys()].filter((n) => n.startsWith('assets/')).length;
  add('assets', assets, 'image');

  const summary: BundleSummary = { manifest, sections };
  if (!files.has('system.json')) {
    summary.missingSystem = manifest.requires?.system ?? manifest.system;
  }

  // Packs this expects that aren't on this host. Answered BEFORE
  // unpacking, because "you're missing the Guidebook" is something you
  // want while deciding whether to import, not after an encounter
  // deploys half-empty at the table.
  const wanted = manifest.requires?.packs ?? [];
  if (wanted.length) {
    const here = await env.DB.prepare('SELECT id FROM packs').all();
    const have = new Set((here.results as { id: string }[]).map((r) => r.id));
    summary.missingPacks = wanted.filter((p) => !have.has(p.id));
  }

  const incoming = await readJson<{ id?: string }>(files, 'campaign.json');
  summary.kin = await findKin(env, incoming?.id);
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
  opts: { campaignId?: string; sections?: string[]; name?: string },
): Promise<ImportResult> {
  const files = await readZip(buffer);
  const manifest = await readJson<BundleManifest>(files, 'teller.json');
  if (!manifest?.teller) throw new Error('no teller.json — not a .story bundle');

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

  const incoming = await readJson<
    Partial<CampaignData> & { name?: string; id?: string }
  >(files, 'campaign.json');

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
    // What you call your table is yours to decide. A starter bundle
    // shouldn't dictate the name of every campaign built from it.
    const name =
      opts.name?.trim() || incoming?.name || manifest.name || 'Imported campaign';
    const data: CampaignData = {
      vocabulary: incoming?.vocabulary ?? {},
      counters: incoming?.counters ?? [],
      states: (incoming?.states as EncounterState[]) ?? [],
      // Which printing this table uses where a foe is in two packs. A
      // decision a person made about THIS campaign, so it travels with
      // it — losing it would silently re-default every one of them.
      foePicks: incoming?.foePicks ?? {},
      // Where it came from, so a later import of the same module can
      // tell "layer onto the table I already started" apart from
      // "start a second one".
      originId: incoming?.id,
      // The exporter's own inventions — homebrew gear, the shops.
      ...(incoming?.catalog ? { catalog: incoming.catalog } : {}),
      ...(incoming?.vendors?.length ? { vendors: incoming.vendors } : {}),
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

  // Packs are REFERENCED now, so importing them is a question rather
  // than a copy: does this host have them? The claim is restored either
  // way — a reference you can't resolve yet is still the truth about
  // what this campaign runs on, and it starts working the moment the
  // `.pack` lands in the folder.
  const required = manifest.requires?.packs ?? [];
  if (required.length && wants('packs')) {
    const here = await env.DB.prepare('SELECT id FROM packs').all();
    const have = new Set((here.results as { id: string }[]).map((r) => r.id));
    const missing = required.filter((p) => !have.has(p.id));
    const found = required.length - missing.length;
    if (found) applied.push(`${found} of ${required.length} packs already on this host`);
    for (const pack of missing) {
      skipped.push(`“${pack.name}” v${pack.version} — add the .pack to this host`);
    }
    // Order matters and comes from the bundle: it's the precedence the
    // campaign was built with. Merging with what's already claimed would
    // scramble it, so an explicit list wins outright.
    data.packs = required.map((p) => p.id);
  }

  // Legacy: a bundle written before TEL-62 carries pack bodies whole.
  // Still accepted, because someone may be holding one — but it INSTALLS
  // rather than overwrites, which was already the rule here and had
  // teeth: an adventure module bundles the core pack, so loading one
  // used to silently replace a pack you'd spent an evening adding page
  // references to, with whatever stale copy the module was built
  // against. `savePack(…, 'propose')` is that rule, moved somewhere it
  // can't be forgotten.
  const packs = await readJson<PackEntry[]>(files, 'pack.json');
  if (packs?.length && wants('pack')) {
    const outcomes = { added: 0, updated: 0, kept: 0 };
    const claimed = new Set(data.packs ?? []);
    for (const entry of packs) {
      const body = {
        system,
        ...(entry.pack as { id?: string }),
        name: entry.name,
      } as RulesPack;
      // A pre-TEL-62 pack has no id, and minting a fresh one every time
      // would install a duplicate on each re-import — the exact
      // duplication the old `(system, name)` unique index prevented. So
      // for legacy bodies only, fall back to matching on name.
      if (!body.id) {
        const twin = await env.DB.prepare(
          'SELECT id FROM packs WHERE system = ? AND name = ?',
        )
          .bind(body.system, body.name)
          .first<{ id: string }>();
        if (twin) body.id = twin.id;
      }
      const { pack, outcome } = await savePack(env, body, 'propose');
      outcomes[outcome]++;
      claimed.add(pack.id);
    }
    if (outcomes.added) applied.push(`${outcomes.added} rules pack${outcomes.added === 1 ? '' : 's'}`);
    if (outcomes.kept) {
      skipped.push(
        `${outcomes.kept} rules pack${outcomes.kept === 1 ? '' : 's'} you already had — yours kept`,
      );
    }
    data.packs = [...claimed];
  }

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

  // Prepared fights. Same identity rule as blueprints: keyed by id, so
  // re-importing updates nothing you already have.
  //
  // A placement points at a blueprint by id, which may live in a pack
  // this host doesn't have. That's reported rather than repaired — an
  // encounter that would deploy half-empty needs to say so BEFORE
  // someone runs it at a table.
  const encounters = await readJson<Encounter[]>(files, 'encounters.json');
  if (encounters?.length && wants('encounters')) {
    const existing = new Map((data.encounters ?? []).map((e) => [e.id, e]));
    let added = 0;
    let kept = 0;
    for (const encounter of encounters) {
      if (existing.has(encounter.id)) kept++;
      else {
        existing.set(encounter.id, encounter);
        added++;
      }
    }
    data.encounters = [...existing.values()];
    applied.push(`${added} encounter${added === 1 ? '' : 's'}`);
    if (kept) skipped.push(`${kept} encounter${kept === 1 ? '' : 's'} you already had`);

    // Against the campaign as it will be AFTER this import — including
    // the packs it just claimed — or every foe from a pack installed
    // moments ago would be reported missing.
    const reachable = new Set([
      ...(data.npcs ?? []).map((n) => n.id),
      ...(await bestiaryFor(env, { ...campaign, data })).map((n) => n.id),
    ]);
    const unresolved = new Set<string>();
    for (const encounter of encounters) {
      for (const foe of encounter.foes ?? []) {
        if (!reachable.has(foe.blueprintId)) unresolved.add(foe.blueprintId);
      }
    }
    if (unresolved.size) {
      skipped.push(
        `${unresolved.size} foe${unresolved.size === 1 ? '' : 's'} these encounters need aren’t on this host — install the pack they came from`,
      );
    }
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
    // Homebrew gear and shops layer by id, and the table's copy wins on
    // a collision — an import is a proposal, not an authority (rule 1).
    if (incoming.catalog) {
      const haveItems = new Set((data.catalog?.items ?? []).map((i) => i.id));
      const haveUps = new Set((data.catalog?.upgrades ?? []).map((u) => u.id));
      data.catalog = {
        items: [
          ...(data.catalog?.items ?? []),
          ...(incoming.catalog.items ?? []).filter((i) => !haveItems.has(i.id)),
        ],
        upgrades: [
          ...(data.catalog?.upgrades ?? []),
          ...(incoming.catalog.upgrades ?? []).filter((u) => !haveUps.has(u.id)),
        ],
      };
    }
    if (incoming.vendors?.length) {
      const have = new Set((data.vendors ?? []).map((v) => v.id));
      data.vendors = [
        ...(data.vendors ?? []),
        ...incoming.vendors.filter((v) => !have.has(v.id)),
      ];
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

  // Books arrive as metadata plus a page index — searchable immediately,
  // with no extraction wait. The PDF itself belongs to whichever device
  // holds it; a book listed but absent shows as "not on this screen"
  // rather than as a broken row.
  // Books are references, so importing one is a question, not a copy:
  // does this host have it? Anything missing is named rather than
  // silently absent — a campaign whose rulebook you don't own is a fact
  // you want at import time, not mid-session.
  // Which books this table expects.
  //
  // This arrived and was thrown away: the code counted what was here,
  // printed a line, and forgot. So nothing downstream could ever answer
  // "which of my ten rulebooks does THIS campaign use" — and the answer
  // was sitting in the bundle the whole time. Now it's kept, and the
  // console can lead with them.
  const books = await readJson<BookEntry[]>(files, 'books.json');
  if (books?.length && wants('books')) {
    const here = await env.DB.prepare('SELECT id FROM books').all();
    const have = new Set((here.results as { id: string }[]).map((r) => r.id));
    const missing = books.filter((b) => !have.has(b.id));
    const found = books.length - missing.length;
    if (found) applied.push(`${found} of ${books.length} books already on this host`);
    for (const book of missing) {
      skipped.push(`“${book.name}” — add the PDF to this host and it links up`);
    }

    // Expected whether or not you have them: a reference you can't
    // resolve yet is still the truth about what this adventure needs.
    const expects = new Set([...(data.books ?? []), ...books.map((b) => b.id)]);
    data.books = [...expects];
    await env.DB.prepare('UPDATE campaigns SET data = ? WHERE id = ?')
      .bind(JSON.stringify(data), campaign.id)
      .run();
  }

  return { campaignId: campaign.id, applied, skipped };
}

export type { ZipFile };
