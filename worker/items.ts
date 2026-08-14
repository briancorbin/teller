import { isPool, parsePool } from './dice';
import type {
  CampaignData,
  CartLine,
  CatalogItem,
  CatalogUpgrade,
  Counter,
  Field,
  Deed,
  Item,
  PoolEffect,
  RulesPack,
  SystemTemplate,
  Vendor,
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

/**
 * One effect against one pool STRING — the spend menu's arithmetic
 * (Practice Skill converts a colour, Master Skill adds a die), sharing
 * `apply`'s rules: convert only exchanges what's there, and a value
 * that isn't a pool comes back untouched rather than mangled.
 */
export function amendPool(
  value: string,
  effect:
    | { op: 'add'; dice: string }
    | { op: 'convert'; from: string; to: string; count: number },
  faces: Record<string, string[]>,
): string {
  if (!isPool(value, faces)) return value;
  const next = apply(toCounts(value, faces), { ...effect, range: '' }, faces);
  return toPool(next, faces);
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

// --- The store --------------------------------------------------------------
// Shopping arithmetic — cart totals, a shop's shelf. Pure and shared for
// the same reason as everything above: the seat browsing and the console
// ruling must resolve the same shop to the same lines.

/**
 * A price string in integer minor units — "$4.50" → 450 — or null for
 * anything that isn't a price ("-", "", a word). Integer cents on
 * purpose: floats drift, and money is the one place nobody forgives it.
 */
export function parsePrice(value: string | undefined | null): number | null {
  if (!value) return null;
  const m = value.replace(/,/g, '').match(/(\d+)(?:\.(\d{1,2}))?/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0'));
}

/** The currency mark a sample price wears — "$4.50" → "$". Data, not ours. */
export function priceSymbol(sample: string | undefined | null): string {
  const m = (sample ?? '').match(/^[^\d\s]+/);
  return m ? m[0] : '';
}

/** Minor units back to the notation the samples use — 450 → "$4.50". */
export function formatPrice(cents: number, symbol = '$'): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${symbol}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** One line of a shop's shelf, resolved. */
export type StockLine = {
  ref: string;
  /** Absent when the entry's pack isn't installed — shown as missing, never dropped. */
  entry?: CatalogItem;
  /** The asking price — the vendor's override, else the entry's own. */
  price: string | null;
  /** Stock remaining. null = unlimited. */
  qty: number | null;
};

/**
 * What a vendor actually has on the shelf.
 *
 * Explicit stock resolves line by line; a vendor with no list carries
 * everything in reach that has a price, narrowed by `groups` and
 * `filters`. The price field's KEY comes from the template's store
 * declaration — this code never learns the word "cost" (rule 2).
 */
export function vendorStock(
  vendor: Vendor,
  packs: RulesPack[],
  own: OwnCatalog | undefined,
  store: NonNullable<SystemTemplate['store']>,
  /**
   * The ladder, when the system declares one — read ONLY for its
   * `unstocked` tiers, which derived stock leaves off the shelf so the
   * top of the ladder isn't for sale by accident.
   *
   * Explicit stock ignores this entirely, and that asymmetry is the
   * point: a curated list is a DM saying exactly what's behind this
   * counter, and teller does not overrule a person who typed something
   * (rule 1). Derived stock is a guess, so the guess is conservative.
   */
  growth?: SystemTemplate['growth'],
): StockLine[] {
  const { items } = catalogOf(packs, own);
  const priceOf = (entry: CatalogItem): string | null =>
    entry.fields.find((f) => f.key === store.costField)?.value ?? null;

  if (vendor.stock) {
    return vendor.stock.map((line) => {
      const entry = items.get(line.ref);
      return {
        ref: line.ref,
        entry,
        price: line.price ?? (entry ? priceOf(entry) : null),
        qty: line.qty ?? null,
      };
    });
  }

  const groups = vendor.groups?.length ? new Set(vendor.groups) : null;
  const offLimits =
    growth?.unstocked?.length && growth.field
      ? { field: growth.field, tiers: new Set(growth.unstocked) }
      : null;
  const out: StockLine[] = [];
  for (const entry of items.values()) {
    const price = priceOf(entry);
    if (parsePrice(price) === null) continue;
    if (groups && !groups.has(entry.group ?? '')) continue;
    if (offLimits) {
      const tier = entry.fields.find((f) => f.key === offLimits.field)?.value;
      if (tier !== undefined && offLimits.tiers.has(tier)) continue;
    }
    let carried = true;
    for (const [key, values] of Object.entries(vendor.filters ?? {})) {
      if (!values.length) continue;
      const value = entry.fields.find((f) => f.key === key)?.value;
      // An entry without the field passes: a filter narrows the things
      // it describes, it doesn't banish everything else — quality tiers
      // exist on weapons, and the general store still sells flour.
      if (value !== undefined && !values.includes(value)) carried = false;
    }
    if (carried) out.push({ ref: entry.id, entry, price, qty: null });
  }
  return out.sort((a, b) =>
    (a.entry?.group ?? '').localeCompare(b.entry?.group ?? '') ||
    (parsePrice(a.price) ?? 0) - (parsePrice(b.price) ?? 0),
  );
}

/** A cart against a shelf: line prices resolved, the book's total. */
export function cartTotal(
  lines: CartLine[],
  shelf: StockLine[],
): { cents: number; symbol: string; missing: string[] } {
  const byRef = new Map(shelf.map((l) => [l.ref, l]));
  let cents = 0;
  let symbol = '';
  const missing: string[] = [];
  for (const line of lines) {
    const stocked = byRef.get(line.ref);
    const price = parsePrice(stocked?.price);
    if (!stocked || price === null) {
      missing.push(line.ref);
      continue;
    }
    cents += price * line.qty;
    if (!symbol) symbol = priceSymbol(stocked.price);
  }
  return { cents, symbol: symbol || '$', missing };
}

// --- The purse --------------------------------------------------------------
// Physical money, when a system declares `currency`: denominations are
// ordinary counters, and these are the shopkeeper's arithmetic over
// them. Pure and shared, like everything else in this file.

type Currency = NonNullable<SystemTemplate['currency']>;

/** The declared denominations present on this character, largest first. */
export function purseOf(
  counters: Counter[],
  currency: Currency,
): { counter: Counter; value: number }[] {
  return currency.denominations
    .map((d) => {
      const counter = counters.find((c) => c.name === d.counter);
      return counter ? { counter, value: d.value } : null;
    })
    .filter((x): x is { counter: Counter; value: number } => x !== null)
    .sort((a, b) => b.value - a.value);
}

/** Everything in the pouch, in minor units. */
export function purseTotal(counters: Counter[], currency: Currency): number {
  return purseOf(counters, currency).reduce(
    (sum, { counter, value }) => sum + counter.current * value,
    0,
  );
}

/**
 * Pay a price out of the purse, the way a hand does it at a counter:
 * exact coins if they're there (largest first), otherwise the smallest
 * overpayment the pouch can make — and the shopkeeper's change comes
 * back in the biggest coins that fit.
 *
 * Returns the new count per denomination and the story of the exchange
 * ("paid 35¢, took 5¢ change"), or null when the whole purse can't
 * cover the price — that ruling belongs to the DM, not to arithmetic.
 * A PROPOSAL throughout (rule 1): every resulting count lands in a
 * counter someone can retype.
 */
export function makePayment(
  counters: Counter[],
  currency: Currency,
  price: number,
): { counts: Record<string, number>; paid: number; change: number } | null {
  const purse = purseOf(counters, currency);
  const total = purse.reduce((s, p) => s + p.counter.current * p.value, 0);
  if (total < price) return null;

  // First try exact: largest coins first, bounded by what's held.
  const counts: Record<string, number> = {};
  let remaining = price;
  for (const { counter, value } of purse) {
    const take = Math.min(Math.floor(remaining / value), counter.current);
    counts[counter.name] = counter.current - take;
    remaining -= take * value;
  }
  let paid = price - remaining;

  if (remaining > 0) {
    // No exact change — hand over more, smallest sufficient coin first
    // (the human move: cover a nickel gap with a dime before breaking
    // a dollar).
    for (const { counter, value } of [...purse].reverse()) {
      while (remaining > 0 && counts[counter.name] > 0) {
        counts[counter.name] -= 1;
        remaining -= value;
        paid += value;
      }
      if (remaining <= 0) break;
    }
    // The till's change, back in the biggest coins that fit.
    let change = -remaining;
    for (const { counter, value } of purse) {
      const back = Math.floor(change / value);
      counts[counter.name] = (counts[counter.name] ?? 0) + back;
      change -= back * value;
    }
    return { counts, paid, change: -remaining };
  }
  return { counts, paid, change: 0 };
}

// ── Notches ───────────────────────────────────────────────────────────
//
// What a well-used thing has been through, and where that puts it on
// the ladder its system declares (`SystemTemplate.growth`).
//
// Pure arithmetic over stored values, which is the only kind of
// computing rule 1 has ever forbidden teller from doing badly: every
// function here PROPOSES — a count to show, a rung that's now in reach
// — and none of them writes anything. Crossing a threshold makes an
// offer the DM rules on. It never promotes a weapon.

/** Where a thing stands on the ladder, and what's next. */
export type Standing = {
  /** Notches cut so far. Derived from the list; never stored beside it. */
  deeds: number;
  /** The tier it currently wears, as the growth field reads today. */
  tier?: string;
  /** The next rung, when there is one. Absent at the top of the ladder. */
  next?: { to: string; at: number };
  /** True when `deeds` has reached `next.at` — an offer, not a promotion. */
  ready: boolean;
};

/**
 * Read a thing's standing off its marks and its own tier field.
 *
 * `fields` is the RESOLVED list (catalogue base, upgrades, then
 * anything typed), so a tier a person typed by hand is read exactly
 * like one teller wrote — which is what lets a DM hand out a Premium
 * rifle that never cut a notch, and lets the ladder pick up from
 * wherever that lands.
 *
 * A tier the ladder doesn't list is not an error and not corrected: it
 * simply has no next rung. Homebrew vocabulary keeps working, it just
 * doesn't climb.
 */
export function standingOf(
  history: Deed[] | undefined,
  fields: Field[],
  growth: SystemTemplate['growth'],
): Standing {
  const count = history?.length ?? 0;
  if (!growth) return { deeds: count, ready: false };

  const tier = fields.find((f) => f.key === growth.field)?.value?.trim() || undefined;
  const at = growth.steps.findIndex((s) => s.to === tier);

  // Unlisted tier (or none yet): the next rung is the first one, so a
  // thing that arrived with no tier at all can still start climbing.
  const next = at === -1 ? growth.steps[0] : growth.steps[at + 1];
  return {
    deeds: count,
    tier,
    next,
    ready: next ? count >= next.at : false,
  };
}

/**
 * Who in the posse already holds something at each tier.
 *
 * For the rise proposal's one-of notice, and it is a NOTICE — teller
 * says "there's already a Legendary in this posse, and it's Sundowner";
 * it never refuses. Enforcing uniqueness would be rule 1 backwards, and
 * the DM is the only one who knows whether this is the campaign where
 * two of them is the point.
 *
 * Resolved rather than read off stored fields, so a weapon that ROSE to
 * a tier (a typed override) and one that was BOUGHT at it (the
 * catalogue's own value) both count. They should: the notice is about
 * how many exist, not how they got there.
 */
export function tierHolders(
  cast: { name: string; data: { items?: Item[] } }[],
  packs: RulesPack[],
  own: OwnCatalog | undefined,
  growth: NonNullable<SystemTemplate['growth']>,
  dice?: SystemTemplate['dice'],
): Map<string, { item: string; who: string; id: string }[]> {
  const out = new Map<string, { item: string; who: string; id: string }[]>();
  for (const who of cast) {
    for (const item of who.data.items ?? []) {
      const { name, fields } = resolveItem(item, packs, dice, own);
      const tier = fields.find((f) => f.key === growth.field)?.value?.trim();
      if (!tier) continue;
      out.set(tier, [...(out.get(tier) ?? []), { item: name, who: who.name, id: item.id }]);
    }
  }
  return out;
}

/**
 * May this thing be notched?
 *
 * One answer, so the seat's button and the console's rise proposal
 * can't disagree about what's notchable.
 *
 * A thing that ALREADY carries deeds always qualifies, whatever the
 * declaration says now. Someone wrote those, and a template edit — or
 * a kind renamed on an item — must never make a history unreachable
 * (rule 1). It only ever narrows what you can START.
 */
export function notchable(
  item: Item,
  growth: SystemTemplate['growth'],
): boolean {
  if (!growth) return false;
  if (item.history?.length) return true;
  return !growth.kinds?.length || growth.kinds.includes(item.kind ?? '');
}
