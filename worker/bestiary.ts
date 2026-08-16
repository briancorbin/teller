import { newId, type Env } from './db';
import { packsFor } from './packs';
import { setTag, toTags } from './tags';
import type { Campaign, CharacterData, NpcBlueprint, Placement } from './types';

// Where foes come from.
//
// Two places, and the order matters. Packs bring a catalogue — having
// the pack means having the monsters, the way having the book on a shelf
// does. The campaign holds its own: homebrew, one-offs, and anything
// you've edited.
//
// When both have the same id, **the campaign's wins**. That's rule 1
// again: a stored value a human typed outranks whatever a pack proposes,
// so retuning a foe's Health for your table survives the pack being
// updated underneath it.

/**
 * One place a foe is printed. The same creature appears in more than one
 * book all the time — a core bestiary and the adventure that reprints it
 * — and each printing has its own page. Keeping them all is what lets
 * the console offer "Guidebook p.160 · Unlikely Duo p.36" instead of
 * silently picking one and throwing the other away.
 */
export type NpcSource = {
  packId: string;
  pack: string;
  book?: string;
  page?: number;
};

export type SourcedNpc = NpcBlueprint & {
  /** Which pack the WINNING copy came from; undefined for the campaign's own. */
  from?: string;
  /**
   * The winning pack's id.
   *
   * Sent rather than left to the client, because the default winner is
   * a property of the campaign's pack ORDER and no surface should have
   * to re-derive it. A console that guessed "the first source" was
   * right only by accident, and stopped being right the moment
   * precedence became explicit.
   */
  fromId?: string;
  /** Every pack that carries this id, in precedence order. */
  sources?: NpcSource[];
};

/**
 * Every foe available to a campaign.
 *
 * Pack foes carry `from` so the console can say where they came from and
 * treat them as a catalogue: editing one copies it into the campaign
 * rather than writing back into the pack, because a pack describes a
 * book and your table's changes aren't the book's business.
 */
export async function bestiaryFor(
  env: Env,
  campaign: Campaign,
): Promise<SourcedNpc[]> {
  const own = campaign.data?.npcs ?? [];
  /** npc id → pack id the DM chose, when a foe is printed more than once. */
  const picks = campaign.data?.foePicks ?? {};
  // In the campaign's declared order, which IS the precedence — not
  // alphabetical, which is what it used to be and which decided real
  // collisions by where a pack's name happened to fall.
  const packs = await packsFor(env, campaign);

  // Every printing, kept. Which one WINS is decided after, so that a
  // pick can name a pack that happens to sort last.
  const printings = new Map<string, { entry: SourcedNpc; source: NpcSource }[]>();
  for (const record of packs) {
    // A foe printed in a book belongs to that book. The pack knows which
    // one, the foe usually doesn't, so resolve it here rather than
    // making every client re-derive it — and never overwrite a foe that
    // named its own book.
    const book = record.pack.books?.[0];
    for (const npc of record.pack.npcs ?? []) {
      const entry: SourcedNpc = {
        ...npc,
        book: npc.book ?? book,
        from: record.pack.name,
      };
      const source: NpcSource = {
        packId: record.id,
        pack: record.pack.name,
        book: entry.book,
        page: npc.page,
      };
      const list = printings.get(npc.id);
      if (list) list.push({ entry, source });
      else printings.set(npc.id, [{ entry, source }]);
    }
  }

  const byId = new Map<string, SourcedNpc>();
  for (const [id, list] of printings) {
    // The DM's pick outranks pack order (rule 1). An unresolvable pick —
    // a pack since deleted or renamed — falls back rather than erroring:
    // the foe still works, it's just the default printing again.
    const picked = list.find((p) => p.source.packId === picks[id]);
    // LAST wins by default, because the campaign's pack list reads like
    // an import: name the base, then what goes on top of it.
    const win = picked ?? list[list.length - 1];
    byId.set(id, {
      ...win.entry,
      fromId: win.source.packId,
      sources: list.map((p) => p.source),
    });
  }

  // The campaign's own copy always wins the STATS — but it keeps the
  // pack sources, so a retuned foe can still say where it came from and
  // still open the page it was printed on.
  for (const npc of own) {
    const sources = printings.get(npc.id)?.map((p) => p.source);
    byId.set(npc.id, sources?.length ? { ...npc, sources } : npc);
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Stamp a blueprint into a character sheet.
 *
 * One place, because two callers need identical behaviour: spawning
 * from the bestiary, and deploying a prepared fight. The only
 * difference is the placement's diff, and a bare spawn is just a
 * placement with nothing overridden.
 *
 * A blueprint is a starting kit, so bounded counters come out FULL —
 * stamping a wounded sheet must not mint wounded creatures. Unbounded
 * ones keep whatever was saved, because there's no "full" to mean.
 */
export function stamp(
  blueprint: NpcBlueprint,
  placement?: Pick<Placement, 'overrides' | 'tags' | 'blueprintId'>,
): CharacterData {
  const fieldOverrides = placement?.overrides?.fields ?? {};
  const counterOverrides = placement?.overrides?.counters ?? {};

  return {
    fields: blueprint.fields.map((f) =>
      f.key in fieldOverrides ? { ...f, value: fieldOverrides[f.key] } : { ...f },
    ),
    // Fresh identities per copy, or every creature would share counter ids.
    counters: blueprint.counters.map((c) => {
      const over = counterOverrides[c.name];
      const max = over && 'max' in over ? (over.max ?? null) : c.max;
      const full = max !== null && max > 0 ? max : c.current;
      return {
        ...c,
        id: newId('ctr'),
        max,
        current: over?.current ?? full,
      };
    }),
    // The placement's conditions layer OVER the blueprint's rather than
    // sitting beside them: "already wounded" on this one Bloodsucker is
    // a statement about this one, and one condition is one tag.
    tags: toTags(placement?.tags).reduce(
      (tags, t) => setTag(tags, t.name, t.value),
      toTags(blueprint.tags),
    ),
    notes: '',
    blueprintId: blueprint.id,
  };
}

/** Find one foe by id, wherever it lives. */
export async function findBlueprint(
  env: Env,
  campaign: Campaign,
  npcId: string,
): Promise<NpcBlueprint | undefined> {
  return (await bestiaryFor(env, campaign)).find((n) => n.id === npcId);
}
