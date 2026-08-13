import type {
  CatalogItem,
  CharacterData,
  Counter,
  Field,
  Item,
  PackEntry,
  RulesPack,
} from '../../worker/types';
import { catalogOf } from '../../worker/items';
import { newLocalId } from './api';

// Character creation as COMPOSITION (TEL-75): every function here takes
// ordinary character data and returns ordinary character data — fields,
// counters, items — with the pack's declarations applied. Nothing is
// enforced afterward; a created character is a normal character, and
// skipping the flow to type one by hand stays a first-class path.
//
// Two surfaces drive this: the console dialog applies everything at
// once (`composeAll`); the rail builder applies one step per screen.
// Same functions either way, so the flows can't drift apart.

type Trade = NonNullable<RulesPack['trades']>[number];
type Creation = NonNullable<RulesPack['creation']>;
type Tier = NonNullable<Creation['tiers']>[number];

/** The first pack that declares trades speaks for the system. */
export function creationOf(packs: RulesPack[]): {
  trades: Trade[];
  creation: Creation;
  version: number;
} | null {
  const pack = packs.find((p) => p.trades?.length);
  if (!pack) return null;
  return {
    trades: pack.trades!,
    creation: pack.creation ?? {},
    version: pack.version ?? 0,
  };
}

/**
 * Where a pack's AUTHORED art lives.
 *
 * A minted key (a scene, a handout) names its own bytes and is used
 * bare — a new upload is a new URL. A pack's art key is a name a
 * PERSON chose, so the file behind it gets corrected in place, and a
 * screen that already cached it has no reason to ask again. The pack's
 * own version rides along as the buster, because that number already
 * means exactly "these contents changed" (rule 4a) — so bumping the
 * pack is how a corrected portrait reaches a panel that's holding the
 * old one.
 *
 * This matters more than it sounds: the alternative is clearing site
 * data on the device, and on a paired screen that takes the display id
 * with it (rule 7) — the panel would need re-adopting by code.
 */
export function packArtUrl(key: string, version: number): string {
  return `/api/maps/${key}?v=${version}`;
}

/**
 * What the pack says about each skill, keyed by the sheet's own label.
 *
 * Found by CONTENT, not by section title: the section that speaks for
 * the skills is the one that names the most of them, which is true of
 * a pack in any language and any arrangement. Matching a title like
 * "Skills" would be teller learning a game concept (rule 2), and
 * matching a bare entry name anywhere risks a status called "Nerve"
 * answering for the skill called Nerve.
 */
export function skillLore(
  packs: RulesPack[],
  labels: string[],
): Map<string, PackEntry> {
  const want = labels.map((l) => l.toLowerCase());
  let best: PackEntry[] = [];
  let bestHits = 0;
  for (const pack of packs) {
    for (const section of pack.sections ?? []) {
      const hits = (section.entries ?? []).filter((e) =>
        want.includes(e.name.toLowerCase()),
      );
      if (hits.length > bestHits) {
        bestHits = hits.length;
        best = hits;
      }
    }
  }
  return new Map(best.map((e) => [e.name.toLowerCase(), e]));
}

/** Set a field by label, if the sheet has one. */
function setField(fields: Field[], label: string, value: string): Field[] {
  return fields.map((f) => (f.label === label ? { ...f, value } : f));
}

/** Set a counter's current (and optionally max) by name, if present. */
function setCounter(
  counters: Counter[],
  name: string,
  current: number,
  max?: number | null,
): Counter[] {
  return counters.map((c) =>
    c.name === name ? { ...c, current, ...(max !== undefined ? { max } : {}) } : c,
  );
}

/** A catalog entry, instanced onto a character (ItemSection's shape). */
export function instanced(entry: CatalogItem): Item {
  return {
    id: newLocalId('itm'),
    name: entry.name,
    from: entry.id,
    fields: [],
    counters: (entry.counters ?? []).map((c) => ({
      ...c,
      id: newLocalId('ctr'),
    })),
    kind: entry.kind,
  };
}

/**
 * Step: the trade. Names the trade in its declared field and deals the
 * quick-build spread into the skill fields — a DEFAULT the skills step
 * then edits (the printed spread is a suggestion, p. 7).
 */
export function applyTrade(
  data: CharacterData,
  trade: Trade,
  creation: Creation,
): CharacterData {
  let fields = data.fields;
  const tradeLabel = creation.map?.trade;
  if (tradeLabel) fields = setField(fields, tradeLabel, trade.name);
  for (const [label, pool] of Object.entries(trade.skills ?? {})) {
    fields = setField(fields, label, pool);
  }
  return { ...data, fields };
}

/** Step: the skill spread, as edited — label → pool string. */
export function applySkills(
  data: CharacterData,
  skills: Record<string, string>,
): CharacterData {
  let fields = data.fields;
  for (const [label, pool] of Object.entries(skills)) {
    fields = setField(fields, label, pool);
  }
  return { ...data, fields };
}

/**
 * Step: the tier. Routes the table's numbers onto whatever counters
 * the pack's `map` names — teller never learns a counter is called
 * "Wallet ($)" (rule 2). `wallet` may be overridden by the rolled
 * amount (Tenderfoot rolls; higher tiers take the table's figure).
 */
export function applyTier(
  data: CharacterData,
  tier: Tier,
  creation: Creation,
  walletOverride?: number,
): CharacterData {
  let counters = data.counters;
  const map = creation.map ?? {};
  const names = (v?: string | string[]) =>
    v === undefined ? [] : Array.isArray(v) ? v : [v];
  for (const name of names(map.prestige)) {
    counters = setCounter(counters, name, tier.prestige);
  }
  for (const name of names(map.wallet)) {
    counters = setCounter(counters, name, walletOverride ?? tier.wallet ?? 0);
  }
  for (const name of names(map.scrap)) {
    counters = setCounter(counters, name, tier.scrap ?? 0);
  }
  return { ...data, counters };
}

/**
 * Step: what they carry out the door — the ability picks (the chosen
 * edge + the first Ace-in-the-Hole), the starting weapons, and the
 * chosen equipment packs. All instanced references; the catalogue
 * stays where it is.
 */
export function applyGear(
  data: CharacterData,
  packs: RulesPack[],
  ids: string[],
): CharacterData {
  const { items: catalog } = catalogOf(packs);
  const have = new Set((data.items ?? []).map((i) => i.from));
  const added = ids
    .filter((id) => !have.has(id))
    .map((id) => catalog.get(id))
    .filter((e): e is CatalogItem => Boolean(e))
    // A bundle unpacks: what lands in the inventory is its CONTENTS,
    // each occurrence its own item ("2× Pain Pills" lists the id
    // twice, and gets two). Deliberately no dedupe inside a bundle —
    // repeats there are the author's intent.
    .flatMap((e) =>
      e.contents?.length
        ? e.contents
            .map((cid) => catalog.get(cid))
            .filter((c): c is CatalogItem => Boolean(c))
        : [e],
    )
    .map(instanced);
  return { ...data, items: [...(data.items ?? []), ...added] };
}

/** Every id a set of bundles could have granted — for a clean re-swap. */
export function bundleGrantIds(
  packs: RulesPack[],
  bundleIds: string[],
): string[] {
  const { items: catalog } = catalogOf(packs);
  return bundleIds.flatMap((id) => {
    const e = catalog.get(id);
    return e ? [id, ...(e.contents ?? [])] : [id];
  });
}

/**
 * Step: keepsakes land in notes — flavor the sheet carries, editable.
 * REPLACES any previous keepsakes line, so walking back through the
 * flow re-decides instead of piling up.
 */
export function applyKeepsakes(
  data: CharacterData,
  keepsakes: string[],
): CharacterData {
  const kept = data.notes
    .split('\n')
    .filter((l) => !l.startsWith('Keepsakes: '))
    .join('\n');
  if (!keepsakes.length) return { ...data, notes: kept };
  const line = `Keepsakes: ${keepsakes.join('; ')}`;
  return { ...data, notes: kept ? `${kept}\n${line}` : line };
}

/** Drop carried items instanced from any of these catalog ids/kinds. */
export function withoutInstanced(
  data: CharacterData,
  opts: { kinds?: string[]; from?: string[] },
): CharacterData {
  const kinds = new Set(opts.kinds ?? []);
  const from = new Set(opts.from ?? []);
  return {
    ...data,
    items: (data.items ?? []).filter(
      (i) => !(kinds.has(i.kind ?? '') || (i.from && from.has(i.from))),
    ),
  };
}

/** Draw from the naming well. */
export function gimmeName(creation: Creation): string {
  const first = creation.names?.first ?? [];
  const last = creation.names?.last ?? [];
  const pick = (list: string[]) =>
    list.length ? list[Math.floor(Math.random() * list.length)] : '';
  return [pick(first), pick(last)].filter(Boolean).join(' ');
}

/** Sum a spread like {Charm:'3B',…} in the budget's die. */
export function spreadTotal(skills: Record<string, string>, die: string): number {
  return Object.values(skills).reduce((sum, pool) => {
    const n = parseInt(pool, 10);
    return sum + (Number.isFinite(n) && pool.endsWith(die) ? n : 0);
  }, 0);
}

/** The console path: every step at once. */
export function composeAll(
  data: CharacterData,
  args: {
    packs: RulesPack[];
    trade: Trade;
    creation: Creation;
    tier: Tier;
    skills?: Record<string, string>;
    abilityIds: string[];
    equipmentPackIds: string[];
    keepsakes?: string[];
    wallet?: number;
  },
): CharacterData {
  let next = applyTrade(data, args.trade, args.creation);
  if (args.skills) next = applySkills(next, args.skills);
  next = applyTier(next, args.tier, args.creation, args.wallet);
  next = applyGear(next, args.packs, [
    ...args.abilityIds,
    ...(args.creation.weapons ?? []),
    ...args.equipmentPackIds,
  ]);
  next = applyKeepsakes(next, args.keepsakes ?? []);
  return next;
}
