import { newId, toPackRecord, type Env } from './db';
import type { CharacterData, NpcBlueprint, Placement } from './types';

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

export type SourcedNpc = NpcBlueprint & {
  /** Which pack it came from, or undefined for the campaign's own. */
  from?: string;
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
  system: string,
  own: NpcBlueprint[] = [],
): Promise<SourcedNpc[]> {
  const rows = await env.DB.prepare('SELECT * FROM packs WHERE system = ? ORDER BY name')
    .bind(system)
    .all();

  const byId = new Map<string, SourcedNpc>();
  for (const row of rows.results) {
    const record = toPackRecord(row as never);
    // A foe printed in a book belongs to that book. The pack knows which
    // one, the foe usually doesn't, so resolve it here rather than
    // making every client re-derive it — and never overwrite a foe that
    // named its own book.
    const book = record.pack.books?.[0];
    for (const npc of record.pack.npcs ?? []) {
      // First pack wins over a later one; both lose to the campaign.
      if (!byId.has(npc.id)) {
        byId.set(npc.id, { ...npc, book: npc.book ?? book, from: record.pack.name });
      }
    }
  }
  for (const npc of own) byId.set(npc.id, npc);

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
    tags: [...blueprint.tags, ...(placement?.tags ?? [])],
    notes: '',
    blueprintId: blueprint.id,
  };
}

/** Find one foe by id, wherever it lives. */
export async function findBlueprint(
  env: Env,
  system: string,
  own: NpcBlueprint[],
  npcId: string,
): Promise<NpcBlueprint | undefined> {
  return (await bestiaryFor(env, system, own)).find((n) => n.id === npcId);
}
