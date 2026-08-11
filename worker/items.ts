import { isPool, parsePool } from './dice';
import type {
  CampaignData,
  CatalogItem,
  CatalogUpgrade,
  Field,
  Item,
  PoolEffect,
  RulesPack,
  SystemTemplate,
} from './types';

/** The campaign's own gear, which outranks any pack's. */
export type OwnCatalog = CampaignData['catalog'];

// What a thing's numbers actually are once it's been modified.
//
// teller ships the arithmetic; the catalogue ships the weapons and what
// bolting something onto them does. That split is rule 4's: mechanics
// belong in code, the publisher's tables belong in the reader's own
// pack, and a new system arrives as data rather than a code change.
//
// **There are two catalogues, and they are not interchangeable.** A pack
// is a BOOK — static, as its author wrote it, upgradable underneath you.
// The campaign holds what your table invented. Kitbashed gear belongs on
// the campaign, not stuffed into the publisher's pack, or installing the
// next version of the book would clobber it and your inventions would
// masquerade as the publisher's. It's also the only way homebrew travels
// (rule 9) — a `.story` carries the campaign and merely references packs.
//
// **Everything here PROPOSES** (rule 1). A derived pool fills a field
// that nobody typed over; the moment a person writes a number down, that
// number wins and the derivation steps aside. That's for the RULING —
// "it's jammed, one die" — not for homebrew, which deserves a catalogue
// entry of its own rather than a pile of typed-over fields.
//
// Pure and dependency-free, so the same function answers on the seat,
// on the console and on either runtime.

/**
 * Everything a campaign can reach: every pack's catalogue, plus its own.
 *
 * A UNION, not an override — and that's the one place this deliberately
 * parts company with `bestiaryFor`. A foe you retune is still that foe,
 * so the bestiary lets a campaign shadow a pack's id. A weapon you
 * modify is a DIFFERENT WEAPON: copying one out of a book mints a new id
 * on the campaign, and the book's entry goes on existing beside it.
 *
 * Which means an item's `from` always names exactly one thing. Under
 * shadowing it wouldn't: a character pointing at the book's rifle would
 * silently start meaning something else the day someone retuned it, and
 * nothing on the card would say so.
 *
 * Ids are therefore expected to be distinct across sources. Campaign
 * entries are read last so a collision resolves deterministically rather
 * than by map order, but that's damage control for bad data, not a
 * feature to rely on.
 */
export function catalogOf(
  packs: RulesPack[],
  own?: OwnCatalog,
): {
  items: Map<string, CatalogItem>;
  upgrades: Map<string, CatalogUpgrade>;
} {
  const items = new Map<string, CatalogItem>();
  const upgrades = new Map<string, CatalogUpgrade>();
  for (const pack of packs) {
    for (const item of pack.catalog?.items ?? []) items.set(item.id, item);
    for (const up of pack.catalog?.upgrades ?? []) upgrades.set(up.id, up);
  }
  for (const item of own?.items ?? []) items.set(item.id, item);
  for (const up of own?.upgrades ?? []) upgrades.set(up.id, up);
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
  own?: OwnCatalog,
  /**
   * The item chambered in this one (`item.loaded`, resolved by the
   * caller, who holds the character's other items). Its catalogue
   * entry's effects apply after the upgrades' — what's loaded is the
   * last thing that happens to the pool before it's rolled.
   */
  chambered?: Item,
): { name: string; fields: DerivedField[]; slots?: number; slotsUsed: number } {
  const { items, upgrades } = catalogOf(packs, own);
  const base = item.from ? items.get(item.from) : undefined;
  const round = chambered?.from ? items.get(chambered.from) : undefined;
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
    if (Object.keys(faces).length && isPool(field.value, faces)) {
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

  // What's chambered, last: the round is the final thing that happens
  // to a pool before it's rolled. No range choice here — a round's
  // effect names its own range, and a weapon without that pool simply
  // isn't modified (the same skip an upgrade gets).
  for (const effect of round?.effects ?? []) {
    const current = pools.get(effect.range);
    if (!current) continue;
    pools.set(effect.range, apply(current, effect, faces));
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

/**
 * What an effect DOES, in the terms of the pool it lands on.
 *
 * Generated rather than written down, so it can name the range the
 * PLAYER chose — "Long Range +2B" for an upgrade the catalogue only
 * knows as "add 2B somewhere". A description typed into the pack could
 * never say that, because the choice isn't the pack's to make.
 *
 * `label` resolves a field key to the sheet's own word for it, so this
 * says "Long Range" rather than "long".
 */
export function describeEffect(
  effect: PoolEffect,
  range: string,
  label: (key: string) => string,
): string {
  const where = label(range);
  return effect.op === 'add'
    ? `${where} +${effect.dice}`
    : `${where} ${effect.count}${effect.from} → ${effect.count}${effect.to}`;
}

/**
 * The fields of a catalogue entry that hold a die pool — i.e. the
 * places an effect can land.
 *
 * Derived from the values rather than declared, the same way the sheet
 * decides a value is a track: "3B" is a pool and "Used" isn't, and
 * nothing here needs to know the word "range".
 */
export function poolFields(base: CatalogItem, dice?: SystemTemplate['dice']): Field[] {
  const faces = dice?.faces ?? {};
  if (!Object.keys(faces).length) return [];
  return base.fields.filter((f) => isPool(f.value, faces));
}

/**
 * Where an upgrade fitted to THIS item can be pointed.
 *
 * The same list `fittableUpgrades` hands out, for the upgrades already
 * on the thing — re-pointing one is an ordinary edit, not something you
 * have to unfit and refit to change.
 */
export function itemRanges(
  item: Item,
  packs: RulesPack[],
  dice?: SystemTemplate['dice'],
  own?: OwnCatalog,
): Field[] {
  const base = item.from ? catalogOf(packs, own).items.get(item.from) : undefined;
  return base ? poolFields(base, dice) : [];
}

/** An upgrade offered for an item, with what the book has to say about it. */
export type Fit = {
  upgrade: CatalogUpgrade;
  /** Pool fields it could be pointed at, in the item's own order. */
  ranges: Field[];
  /** Where to point it unless the person says otherwise. */
  range?: string;
  /**
   * What the book's own constraints say — one per type, and the slot
   * count. A WARNING, never a bar: the picker shows it and fits it
   * anyway if you say so, because the table's ruling beats the book's
   * (rule 1).
   */
  problem?: string;
  /**
   * True when this was written for this kind of thing — every effect's
   * declared range actually exists here. A Damage upgrade aimed at
   * Short Range is not native to a knife, which has none.
   */
  native: boolean;
};

/**
 * Every upgrade the catalogue offers for one item, in the order a
 * picker should show them.
 *
 * Nothing is withheld. Sorting puts the ones written for this kind of
 * weapon first and the ones the book would refuse last, which is the
 * useful part — a hard filter would silently hide the homebrew case,
 * and "your table can't do that" is not teller's call to make.
 */
export function fittableUpgrades(
  item: Item,
  packs: RulesPack[],
  dice?: SystemTemplate['dice'],
  own?: OwnCatalog,
): Fit[] {
  const { items, upgrades } = catalogOf(packs, own);
  const base = item.from ? items.get(item.from) : undefined;
  const ranges = base ? poolFields(base, dice) : [];
  const rangeKeys = new Set(ranges.map((f) => f.key));

  const fittedList = (item.upgrades ?? [])
    .map((f) => upgrades.get(f.from))
    .filter((u): u is CatalogUpgrade => Boolean(u));
  const used = fittedList.reduce((n, u) => n + (u.slotsUsed ?? 1), 0);
  // Types already spoken for, minus the ones that said they stack.
  const taken = new Set(fittedList.filter((u) => !u.stacks).map((u) => u.type));
  const slots = base?.slots;

  const out: Fit[] = [];
  for (const upgrade of upgrades.values()) {
    const declared = (upgrade.effects ?? []).map((e) => e.range);
    const native = declared.length === 0 || declared.every((r) => rangeKeys.has(r));
    const cost = upgrade.slotsUsed ?? 1;

    let problem: string | undefined;
    if (!upgrade.stacks && taken.has(upgrade.type)) {
      problem = `already has ${aOrAn(upgrade.type)} upgrade`;
    } else if (slots !== undefined && used + cost > slots) {
      problem =
        cost > 1
          ? `needs ${cost} slots — ${slots - used} left`
          : `no slots left — ${used} of ${slots} used`;
    }

    out.push({
      upgrade,
      ranges,
      // The effect's own range if this item has it, else the first pool
      // it does have — a proposal the picker lets you change.
      range: declared.find((r) => rangeKeys.has(r)) ?? ranges[0]?.key,
      problem,
      native,
    });
  }

  return out.sort(
    (a, b) =>
      Number(Boolean(a.problem)) - Number(Boolean(b.problem)) ||
      Number(!a.native) - Number(!b.native) ||
      a.upgrade.type.localeCompare(b.upgrade.type) ||
      (a.upgrade.level ?? 0) - (b.upgrade.level ?? 0) ||
      a.upgrade.name.localeCompare(b.upgrade.name),
  );
}

/** Only ever seen by a human, and only ever in a warning. */
function aOrAn(word: string): string {
  return /^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`;
}

/** The fitted upgrades, resolved for display. */
export function fittedUpgrades(
  item: Item,
  packs: RulesPack[],
  own?: OwnCatalog,
): { upgrade: CatalogUpgrade; range?: string }[] {
  const { upgrades } = catalogOf(packs, own);
  const out: { upgrade: CatalogUpgrade; range?: string }[] = [];
  for (const fit of item.upgrades ?? []) {
    const upgrade = upgrades.get(fit.from);
    // An upgrade whose pack isn't installed is skipped rather than
    // guessed at — the same way a missing pack is reported elsewhere.
    if (upgrade) out.push({ upgrade, range: fit.range });
  }
  return out;
}
