import { parsePool } from './dice';
import type {
  CatalogItem,
  CatalogUpgrade,
  Field,
  Item,
  PoolEffect,
  RulesPack,
  SystemTemplate,
} from './types';

// What a thing's numbers actually are once it's been modified.
//
// teller ships the arithmetic; the pack ships the weapons and what
// bolting something onto them does. That split is rule 4's: mechanics
// belong in code, the publisher's tables belong in the reader's own
// pack, and a new system arrives as data rather than a code change.
//
// **Everything here PROPOSES** (rule 1). A derived pool fills a field
// that nobody typed over; the moment a person writes a number down, that
// number wins and the derivation steps aside. It has to work that way —
// the table's ruling beats the book's, a homebrew part has no catalogue
// entry, and a Warden saying "it's jammed, one die" must be able to say
// so without arguing with a spreadsheet.
//
// Pure and dependency-free, so the same function answers on the seat,
// on the console and on either runtime.

/** Merge the catalogues of every pack, later packs winning on an id. */
export function catalogOf(packs: RulesPack[]): {
  items: Map<string, CatalogItem>;
  upgrades: Map<string, CatalogUpgrade>;
} {
  const items = new Map<string, CatalogItem>();
  const upgrades = new Map<string, CatalogUpgrade>();
  for (const pack of packs) {
    for (const item of pack.catalog?.items ?? []) items.set(item.id, item);
    for (const up of pack.catalog?.upgrades ?? []) upgrades.set(up.id, up);
  }
  return { items, upgrades };
}

/**
 * A pool as counts per die, so effects can be applied as arithmetic
 * rather than as string surgery. "2B1G" ⇄ `{ B: 2, G: 1 }`.
 */
type Counts = Record<string, number>;

function toCounts(value: string, faces: Record<string, string[]>): Counts {
  const counts: Counts = {};
  for (const { die, count } of parsePool(value, faces)) {
    counts[die] = (counts[die] ?? 0) + count;
  }
  return counts;
}

/**
 * Back to the notation the sheet uses, in the order the SYSTEM declares
 * its dice — so a pool always reads the same way round rather than in
 * whatever order effects happened to touch it.
 */
function toPool(counts: Counts, faces: Record<string, string[]>): string {
  return Object.keys(faces)
    .filter((die) => (counts[die] ?? 0) > 0)
    .map((die) => `${counts[die]}${die}`)
    .join('');
}

/** One effect against one pool. Returns the pool unchanged if it can't apply. */
function apply(counts: Counts, effect: PoolEffect, faces: Record<string, string[]>): Counts {
  const next = { ...counts };
  if (effect.op === 'add') {
    for (const { die, count } of parsePool(effect.dice, faces)) {
      next[die] = (next[die] ?? 0) + count;
    }
    return next;
  }
  // Convert exchanges one colour for another, and can only exchange what
  // is THERE: "3B to 3G" against a pool holding two Blacks converts two.
  // Silently converting dice a weapon doesn't have would invent damage.
  const available = next[effect.from] ?? 0;
  const moved = Math.min(available, effect.count);
  if (moved <= 0) return next;
  next[effect.from] = available - moved;
  next[effect.to] = (next[effect.to] ?? 0) + moved;
  return next;
}

export type DerivedField = Field & {
  /** True when a person typed this and the derivation stepped aside. */
  overridden?: boolean;
  /** What the catalogue and upgrades worked out, when that differs. */
  derived?: string;
};

/**
 * The item as it should be read: catalogue base, upgrades applied, and
 * anything a person typed on top.
 *
 * An item with no `from` is returned as-is — its stored fields ARE its
 * stats, which is what makes hand-written gear a first-class citizen
 * rather than a degraded case.
 */
export function resolveItem(
  item: Item,
  packs: RulesPack[],
  dice?: SystemTemplate['dice'],
): { name: string; fields: DerivedField[]; slots?: number; slotsUsed: number } {
  const { items, upgrades } = catalogOf(packs);
  const base = item.from ? items.get(item.from) : undefined;
  const fitted = (item.upgrades ?? [])
    .map((f) => ({ fit: f, up: upgrades.get(f.from) }))
    .filter((x): x is { fit: (typeof x)['fit']; up: CatalogUpgrade } => Boolean(x.up));

  const slotsUsed = fitted.reduce((n, { up }) => n + (up.slotsUsed ?? 1), 0);
  const typed = new Map(item.fields.map((f) => [f.key, f]));

  if (!base) {
    return {
      name: item.name,
      fields: item.fields.map((f) => ({ ...f })),
      slotsUsed,
    };
  }

  const faces = dice?.faces ?? {};
  // Start from the catalogue, keyed so effects can find a range by name.
  const pools = new Map<string, Counts>();
  const plain = new Map<string, Field>();
  for (const field of base.fields) {
    if (Object.keys(faces).length && parsePool(field.value, faces).length) {
      pools.set(field.key, toCounts(field.value, faces));
    } else {
      plain.set(field.key, field);
    }
  }

  for (const { fit, up } of fitted) {
    for (const effect of up.effects ?? []) {
      // The player's choice beats the effect's own default, because
      // "Add 1B to Short or Long" is a decision the catalogue can't make.
      const key = fit.range ?? effect.range;
      const current = pools.get(key);
      if (!current) continue;
      pools.set(key, apply(current, effect, faces));
    }
  }

  // Catalogue order, so the sheet's rows stay in the sheet's order.
  const out: DerivedField[] = base.fields.map((field) => {
    const derived = pools.has(field.key)
      ? toPool(pools.get(field.key)!, faces)
      : (plain.get(field.key)?.value ?? field.value);
    const override = typed.get(field.key);
    if (override && override.value.trim()) {
      return {
        ...field,
        value: override.value,
        overridden: override.value !== derived,
        derived,
      };
    }
    return { ...field, value: derived };
  });

  // Anything typed that the catalogue never had — a note, a homebrew
  // stat, an upgrade someone wrote out by hand. Appended rather than
  // dropped: nothing a person entered disappears (rule 1).
  for (const field of item.fields) {
    if (!base.fields.some((f) => f.key === field.key)) {
      out.push({ ...field, overridden: true });
    }
  }

  return { name: item.name || base.name, fields: out, slots: base.slots, slotsUsed };
}

/** The fitted upgrades, resolved for display. */
export function fittedUpgrades(
  item: Item,
  packs: RulesPack[],
): { upgrade: CatalogUpgrade; range?: string }[] {
  const { upgrades } = catalogOf(packs);
  const out: { upgrade: CatalogUpgrade; range?: string }[] = [];
  for (const fit of item.upgrades ?? []) {
    const upgrade = upgrades.get(fit.from);
    // An upgrade whose pack isn't installed is skipped rather than
    // guessed at — the same way a missing pack is reported elsewhere.
    if (upgrade) out.push({ upgrade, range: fit.range });
  }
  return out;
}
