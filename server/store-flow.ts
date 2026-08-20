// THE COUNTER — buying things, ported (§14, settled concretely).
//
// Named `store-flow` and not `store` because `core/store.ts` is the
// DATABASE and a file called `server/store.ts` beside it would be a
// coin-flip every time anyone read an import line.
//
// There are two halves here and the seam between them is the whole
// design:
//
//   * THE SHOP SESSION IS EPHEMERAL. Which vendor is open, what each
//     seat has gathered, whose cart is on the counter — nobody's
//     campaign, over the moment the shop closes, and held in memory off
//     the live Session by a WeakMap exactly the way passed notes are
//     (`server/notes.ts`). A campaign switch builds a new Session, so a
//     cart from the table you just left dies unreferenced and nothing
//     has to remember to clear anything. Losing it on a reboot is fine:
//     a cart nobody was in the room for is not owed to anyone.
//
//   * THE TRANSACTION IS PERMANENT, and goes through the ordinary
//     doors. Money leaves a counter, things land as carried children,
//     stock comes off the shelf — every one of them a stored value a
//     human can retype (rule 1) on an entity whose write is logged and
//     invertible (rule 3, `server/undo.ts`).
//
// §14, VERBATIM WHERE IT MATTERS: the vendor is instantiated as an
// entity at the FIRST TRANSACTION — never on browse — so "the shop went
// live" is one event, addressable and undoable. And it instantiates
// THIN: the entity stores only DEPLETED counts, one entry per line that
// has moved off the template's own `qty`. A thick-copied shop would be
// frozen at instantiation day; a thin one carries the pack's new items
// automatically, and a price correction in the book reaches the shelf
// at the next render.
//
// WHAT'S A VENDOR, THEN. The shop-as-written is a TEMPLATE — a row in
// the `vendors` slot, authored by the DM or shipped by a pack, carrying
// `lines` that name catalogue entries by id. It is not entity-shaped
// (a line is a ref plus a price plus a count, which is one thing more
// than an `Entry` leaf holds), so it rides `declarations('vendors')`
// rather than `templates('vendors')` — merged by NAME across the stack,
// campaign winning, like every other vocabulary-coupled slot (§10).
//
// NO GAME WORDS. "Vendor", "cart", "price" and "stock" are English. The
// name of the money is not: which counter a purchase debits, and which
// stat on a catalogue entry holds the asking price, both arrive from
// the `store` and `currency` records (rule 2). This file never learns
// the word "Dollars" and never learns the word "Cost".

import type { Entity, Entry } from '../core/entity.ts';
import { sameName } from '../core/entity.ts';
import { stamp, type Template } from '../core/stamp.ts';
import { adopted, canDm, type Auth } from './auth.ts';
import type { Session } from './session.ts';

// ---------------------------------------------------------------------
// What a vendor is, as written.

/**
 * One thing behind the counter.
 *
 * `ref` is a catalogue template id and is the line's IDENTITY — stock
 * is tracked against it, so a shop that renames an item still knows how
 * many are left. `name` is the cached spelling that degrades when the
 * pack is gone (the `Ref` bargain, §10), never the thing that resolves.
 */
export type VendorLine = {
  ref: string;
  /** What it was called at authoring — shown when the catalogue can't answer. */
  name?: string;
  /** This shop's asking price, over the book's — "$4.50". Absent = the entry's own. */
  price?: string;
  /**
   * Stock on hand. Absent or null = UNLIMITED, and that is the default
   * on purpose: counting boxes of matches is bookkeeping nobody asked
   * for. A finite count is the DM saying "he's only got three sticks of
   * dynamite", and only a finite count ever instantiates.
   */
  qty?: number | null;
};

/** The shop as written — prep, and the campaign's or a pack's to author. */
export type VendorTemplate = {
  id: string;
  name: string;
  /** One line of fiction for the masthead. */
  blurb?: string;
  lines: VendorLine[];
};

/** `/api/stack/record/store` — how buying works here, in the system's words. */
export type StoreRecord = {
  /** The single counter a purchase debits, for a system whose money is one number. */
  counter?: string;
  /** The stat holding a price — matched case-insensitively against a catalogue entry's own. */
  costField?: string;
  /** Kinds consumed at the counter and never carried away — a meal, a bath, a night's lodging. */
  consumes?: string[];
};

/** `/api/stack/record/currency` — coins, as ordinary counters. */
export type CurrencyRecord = {
  symbol?: string;
  denominations?: { counter: string; value: number }[];
};

export const VENDOR_SLOT = 'vendors';
export const CATALOG_SLOT = 'catalog';
/** What a vendor entity says it is — how the console tells one from a character. */
export const VENDOR_TYPE = 'vendor';
/** The one list a live vendor stores: line ref → what's left. */
export const STOCK_LIST = 'stock';

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

/** Whatever shape it arrived in, as a vendor — forgiving, like every read. */
export function toVendor(raw: unknown): VendorTemplate | undefined {
  const o = asRecord(raw);
  const id = String(o.id ?? '').trim();
  const name = String(o.name ?? '').trim();
  if (!id || !name) return undefined;
  const lines: VendorLine[] = [];
  // `stock` is the OLD world's spelling for the same list, and it is
  // accepted for the reason every coercer here accepts an old shape: a
  // file authored against a past model can arrive at any time, and a
  // migration cannot reach one that doesn't exist yet. Nothing writes
  // `stock`.
  const authored = Array.isArray(o.lines) ? o.lines : Array.isArray(o.stock) ? o.stock : [];
  for (const item of authored) {
    const line = asRecord(item);
    const ref = String(line.ref ?? '').trim();
    if (!ref) continue;
    const out: VendorLine = { ref };
    const lineName = String(line.name ?? '').trim();
    if (lineName) out.name = lineName;
    const price = String(line.price ?? '').trim();
    if (price) out.price = price;
    if (typeof line.qty === 'number' && Number.isFinite(line.qty)) {
      out.qty = Math.max(0, Math.floor(line.qty));
    }
    lines.push(out);
  }
  const vendor: VendorTemplate = { id, name, lines };
  const blurb = String(o.blurb ?? '').trim();
  if (blurb) vendor.blurb = blurb;
  return vendor;
}

/** Every shop this table knows about — system, packs, campaign, table. */
export function vendorsOf(session: Session): VendorTemplate[] {
  return session.loaded
    .declarations(VENDOR_SLOT)
    .map(toVendor)
    .filter((v): v is VendorTemplate => v !== undefined);
}

export function vendorOf(session: Session, id: string): VendorTemplate | undefined {
  return vendorsOf(session).find((v) => v.id === id);
}

export function storeRecord(session: Session): StoreRecord {
  return session.loaded.record('store') as StoreRecord;
}

export function currencyRecord(session: Session): CurrencyRecord | undefined {
  const held = session.loaded.record('currency') as CurrencyRecord;
  return held.denominations?.length ? held : undefined;
}

// ---------------------------------------------------------------------
// Money, as arithmetic. Ported from the old world's `worker/items.ts`,
// which had it right: integer minor units throughout, because floats
// drift and money is the one place nobody forgives it.

/** "$4.50" → 450. Anything that isn't a price ("—", "", a word) → null. */
export function parsePrice(value: string | undefined | null): number | null {
  if (!value) return null;
  const m = value.replace(/,/g, '').match(/(\d+)(?:\.(\d{1,2}))?/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0'));
}

/** The mark a sample price wears — "$4.50" → "$". Data, not ours. */
export function priceSymbol(sample: string | undefined | null): string {
  const m = (sample ?? '').match(/^[^\d\s]+/);
  return m ? m[0] : '';
}

/** 450 → "$4.50". */
export function formatPrice(cents: number, symbol = '$'): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${symbol}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------
// The shelf: the shop as written, minus what the table has bought.

/** One line of a shop's shelf, resolved against the catalogue and the live stock. */
export type StockLine = {
  ref: string;
  name: string;
  type?: string;
  /** The catalogue entry's own stats, in its own order — what a tile draws. */
  stats: Entry[];
  /** The asking price — the vendor's override, else the entry's own. */
  price: string | null;
  /** What's left. null = unlimited. */
  qty: number | null;
  /** The catalogue entry isn't on this host — shown as missing, never dropped. */
  missing?: true;
};

/** Find a stat by name, case-insensitively — `costField` is 'cost', the entry says 'Cost'. */
function statNamed(template: Template | undefined, name: string | undefined): Entry | undefined {
  if (!template || !name) return undefined;
  for (const entries of Object.values(template.lists ?? {})) {
    const hit = entries.find((e) => sameName(e, name));
    if (hit) return hit;
  }
  return undefined;
}

/** Every stat the catalogue entry carries, flattened in its own order. */
function statsOf(template: Template | undefined): Entry[] {
  if (!template) return [];
  return Object.values(template.lists ?? {}).flat();
}

/**
 * What's behind the counter right now.
 *
 * The template's lines are the shop AS WRITTEN; the live vendor entity
 * (if the shop has ever transacted) restates a `qty` per line it has
 * sold down. A line the entity says nothing about is still at its
 * written count — that absence IS the thin instantiation (§14).
 */
export function shelfOf(
  session: Session,
  vendor: VendorTemplate,
  live?: Entity,
): StockLine[] {
  const catalog = session.loaded.templateOf(CATALOG_SLOT);
  const store = storeRecord(session);
  const depleted = new Map(
    (live?.lists?.[STOCK_LIST] ?? [])
      .filter((e) => typeof e.value === 'number')
      .map((e) => [e.name, e.value as number]),
  );
  return vendor.lines.map((line) => {
    const template = catalog(line.ref);
    const written = line.qty ?? null;
    const out: StockLine = {
      ref: line.ref,
      name: template?.name ?? line.name ?? line.ref,
      stats: statsOf(template),
      price: line.price ?? statNamed(template, store.costField)?.value?.toString() ?? null,
      // Depletion only ever applies to a line the DM chose to count.
      qty: written === null ? null : (depleted.get(line.ref) ?? written),
    };
    if (template?.type) out.type = template.type;
    if (!template) out.missing = true;
    return out;
  });
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

// ---------------------------------------------------------------------
// The purse. Denominations are ordinary counters (rule 2); this is the
// shopkeeper's arithmetic over them, and every figure it produces is a
// PROPOSAL the DM types over at the counter (rule 1).

type Denomination = { name: string; value: number; held: number };

/** The declared denominations this buyer actually holds, largest first. */
export function purseOf(reading: Entity, currency: CurrencyRecord): Denomination[] {
  const out: Denomination[] = [];
  for (const d of currency.denominations ?? []) {
    const found = entryAcross(reading, d.counter);
    if (found) out.push({ name: found.entry.name, value: d.value, held: countOf(found.entry) });
  }
  return out.sort((a, b) => b.value - a.value);
}

export function purseTotal(purse: Denomination[]): number {
  return purse.reduce((sum, d) => sum + d.held * d.value, 0);
}

/**
 * Pay a price out of the purse the way a hand does it at a counter:
 * exact coins if they're there (largest first), otherwise the smallest
 * overpayment the pouch can make — and the change comes back in the
 * biggest coins that fit.
 *
 * Null when the whole purse can't cover it. That ruling belongs to the
 * DM, not to arithmetic: the console shows "holds $2.10, costs $4.50"
 * and the sell button still works, because a shopkeeper may extend
 * credit and teller may not decide he can't.
 */
export function makePayment(
  purse: Denomination[],
  price: number,
): { counts: Record<string, number>; paid: number; change: number } | null {
  if (purseTotal(purse) < price) return null;

  const counts: Record<string, number> = {};
  let remaining = price;
  for (const d of purse) {
    const take = Math.min(Math.floor(remaining / d.value), d.held);
    counts[d.name] = d.held - take;
    remaining -= take * d.value;
  }
  let paid = price - remaining;
  if (remaining <= 0) return { counts, paid, change: 0 };

  // No exact change — hand over more, smallest sufficient coin first
  // (the human move: cover a nickel gap with a dime before breaking a
  // dollar).
  for (const d of [...purse].reverse()) {
    while (remaining > 0 && counts[d.name] > 0) {
      counts[d.name] -= 1;
      remaining -= d.value;
      paid += d.value;
    }
    if (remaining <= 0) break;
  }
  // The till's change, back in the biggest coins that fit.
  let change = -remaining;
  for (const d of purse) {
    const back = Math.floor(change / d.value);
    counts[d.name] = (counts[d.name] ?? 0) + back;
    change -= back * d.value;
  }
  return { counts, paid, change: -remaining };
}

// ---------------------------------------------------------------------
// The ephemeral half — one open shop, per-seat carts. `server/notes.ts`
// is the precedent and this is the same shape: a WeakMap off the live
// Session, so a campaign switch drops it without anything clearing it.

export type CartLine = { ref: string; qty: number };

export type ShopSession = {
  /** The vendor TEMPLATE's id — never the live entity's. */
  vendorId: string;
  /** entityId → what they've gathered. */
  carts: Record<string, CartLine[]>;
  /** entityId → the cart is on the counter, awaiting the DM. */
  offered: Record<string, boolean>;
};

const open = new WeakMap<Session, ShopSession>();

/** What's open at this table, if anything. */
export function shopOf(session: Session): ShopSession | undefined {
  return open.get(session);
}

/**
 * Open a vendor for the table.
 *
 * Stale carts are wiped per visit rather than kept: walking back into
 * the general store is a new visit, and a cart from an hour ago on
 * somebody's screen is a bug wearing a memory. Browsing instantiates
 * NOTHING (§14) — this touches no entity and writes no stock.
 */
export function openShop(session: Session, vendorId: string): ShopSession {
  const shop: ShopSession = { vendorId, carts: {}, offered: {} };
  open.set(session, shop);
  return shop;
}

export function closeShop(session: Session): void {
  open.delete(session);
}

/** One seat's cart, replaced whole. Editing takes it back off the counter. */
export function setCart(
  shop: ShopSession,
  entityId: string,
  lines: CartLine[],
  offered?: boolean,
): void {
  if (lines.length) shop.carts[entityId] = lines;
  else delete shop.carts[entityId];
  if (offered === undefined) delete shop.offered[entityId];
  else if (offered) shop.offered[entityId] = true;
  else delete shop.offered[entityId];
}

/**
 * WHO SEES WHOSE CART — the whole law, in one function so there is one
 * place to read it and one place to test it (`visibleTo`'s shape, in
 * `server/notes.ts`).
 *
 *   * the DM sees every cart: ruling on them is the DM's whole job at
 *     the counter, and a cart is put there to be seen;
 *   * a SEAT sees its own and nobody else's — not because another
 *     player's shopping is a secret, but because there is no way to
 *     phrase the question about somebody else's, and a door that can't
 *     be asked wrong can't be answered wrong;
 *   * every other role sees nothing. A passive screen renders the
 *     `/public` snapshot, which says the shop is OPEN and stops there.
 */
export function visibleCarts(
  shop: ShopSession,
  auth: Auth,
): { entityId: string; lines: CartLine[]; offered: boolean }[] {
  const all = Object.entries(shop.carts).map(([entityId, lines]) => ({
    entityId,
    lines,
    offered: shop.offered[entityId] === true,
  }));
  if (canDm(auth)) return all;
  const display = auth.display;
  if (!adopted(display) || display.role !== 'seat') return [];
  const mine = display.params.entityId;
  if (typeof mine !== 'string' || !mine) return [];
  return all.filter((c) => c.entityId === mine);
}

// ---------------------------------------------------------------------
// The permanent half — the transaction.

/** The live vendor, if this shop has ever transacted. Found by its stamp. */
export function vendorEntity(session: Session, vendorId: string): Entity | undefined {
  return session.campaign
    .children(session.loaded.manifest.id)
    .find((e) => e.type === VENDOR_TYPE && refFrom(e) === vendorId);
}

function refFrom(entity: Entity): string | undefined {
  const held = entity.refs?.from;
  const ref = Array.isArray(held) ? held[0] : held;
  return ref?.id;
}

function countOf(entry: Entry | undefined): number {
  return typeof entry?.value === 'number' ? entry.value : 0;
}

/** A named entry wherever it lives on this entity, and which list that was. */
function entryAcross(
  entity: Entity,
  name: string,
): { list: string; entry: Entry } | undefined {
  for (const [list, entries] of Object.entries(entity.lists ?? {})) {
    const entry = entries.find((e) => sameName(e, name));
    if (entry) return { list, entry };
  }
  return undefined;
}

/** What the counter proposes for one cart, before anybody rules on it. */
export type Quote = {
  entityId: string;
  name: string;
  lines: (CartLine & { name: string; price: string | null; each: number | null })[];
  offered: boolean;
  /** The book's total, in minor units. */
  total: number;
  symbol: string;
  /** Lines the catalogue couldn't price — named, never quietly dropped. */
  missing: string[];
  /** What this buyer holds, when the system declares coins. */
  purse?: { name: string; value: number; held: number }[];
  held?: number;
  /**
   * The proposed counts after paying — one per denomination, or one
   * entry for the single declared `store.counter`. Absent when the
   * purse can't cover it; the DM rules on that, not this.
   */
  payment?: { counters: { name: string; value: number }[]; paid: number; change: number };
  /** The one counter a purchase debits, when the system has no coins. */
  counter?: { name: string; value: number };
};

/** Price one cart, propose the payment. Writes nothing. */
export function quote(
  session: Session,
  shelf: StockLine[],
  entityId: string,
  lines: CartLine[],
  offered: boolean,
): Quote | undefined {
  const stored = session.campaign.get(entityId);
  if (!stored) return undefined;
  const reading = session.reading(stored);
  const byRef = new Map(shelf.map((l) => [l.ref, l]));
  const { cents, symbol, missing } = cartTotal(lines, shelf);
  const out: Quote = {
    entityId,
    name: stored.name,
    lines: lines.map((l) => {
      const stocked = byRef.get(l.ref);
      return {
        ...l,
        name: stocked?.name ?? l.ref,
        price: stocked?.price ?? null,
        each: parsePrice(stocked?.price),
      };
    }),
    offered,
    total: cents,
    symbol,
    missing,
  };

  const currency = currencyRecord(session);
  if (currency) {
    const purse = purseOf(reading, currency);
    out.purse = purse.map((d) => ({ name: d.name, value: d.value, held: d.held }));
    out.held = purseTotal(purse);
    const payment = makePayment(purse, cents);
    if (payment) {
      out.payment = {
        counters: Object.entries(payment.counts).map(([name, value]) => ({ name, value })),
        paid: payment.paid,
        change: payment.change,
      };
    }
    return out;
  }

  // No coins declared: one counter, debited by the price. Whether that
  // price is in minor units or whole ones is the system's business and
  // teller doesn't guess — the single-counter case debits MINOR units,
  // the same figure every other number here is in, and the DM types
  // over it if their table counts differently (rule 1).
  const store = storeRecord(session);
  if (store.counter) {
    const found = entryAcross(reading, store.counter);
    if (found) {
      out.held = countOf(found.entry);
      out.counter = { name: found.entry.name, value: Math.max(0, countOf(found.entry) - cents) };
    }
  }
  return out;
}

/** What the DM confirmed at the counter — every figure of it overridable. */
export type Sale = {
  entityId: string;
  /** What actually goes across the counter. Defaults to the cart. */
  lines?: CartLine[];
  /** The counter values AFTER paying, as the DM ruled them. */
  counters?: { name: string; value: number }[];
  /** For the receipt only — what was charged, in minor units. */
  total?: number;
};

export type Receipt = {
  vendor: { id: string; name: string; entityId: string };
  buyer: { id: string; name: string };
  total: number;
  lines: { ref: string; name: string; qty: number }[];
  /** Carried children minted by this sale — what an undo of the buyer's write removes. */
  carried: { id: string; name: string }[];
  /** Lines the counter refused to move, said out loud rather than skipped. */
  refused: string[];
};

/**
 * THE TRANSACTION. One sell, and the four things it does:
 *
 *   1. instantiate the vendor, if this is the first — one `entity.created`
 *      event, which IS "the shop went live" and is undoable on its own;
 *   2. write the depleted counts onto it — thin, only lines the DM chose
 *      to count, one `entity.updated`;
 *   3. take the payment and hand over the goods in ONE write on the
 *      buyer, so the purchase is one undo step rather than a dozen (the
 *      old world's own invariant, and it was right);
 *   4. append the receipt, for a log a human can read back.
 *
 * Every number that moves came from the console, where the DM could
 * type over it first. This function does no arithmetic of its own on
 * the buyer's money — `quote()` proposed, a human confirmed, and what
 * arrives here is the ruling.
 */
export function sell(
  session: Session,
  vendor: VendorTemplate,
  sale: Sale,
  actor: string,
): Receipt | { error: string } {
  const shop = shopOf(session);
  const buyer = session.campaign.get(sale.entityId);
  if (!buyer) return { error: `no entity ${sale.entityId}` };
  const lines = (sale.lines ?? shop?.carts[sale.entityId] ?? []).filter((l) => l.qty > 0);
  if (!lines.length) return { error: 'an empty cart is not a sale' };

  const catalog = session.loaded.templateOf(CATALOG_SLOT);
  const store = storeRecord(session);
  const consumed = new Set((store.consumes ?? []).map((k) => k.toLowerCase()));
  const refused: string[] = [];

  // 1 + 2 — the vendor goes live, and its shelf comes down.
  let live = vendorEntity(session, vendor.id);
  if (!live) {
    live = session.create(
      {
        name: vendor.name,
        type: VENDOR_TYPE,
        lists: {},
        refs: { from: { id: vendor.id, name: vendor.name } },
      },
      actor,
    );
  }
  const shelf = shelfOf(session, vendor, live);
  const written = new Map(vendor.lines.map((l) => [l.ref, l.qty ?? null]));
  const stock = [...(live.lists[STOCK_LIST] ?? [])];
  let depleted = false;
  for (const line of lines) {
    if (written.get(line.ref) === null || written.get(line.ref) === undefined) continue;
    const stocked = shelf.find((s) => s.ref === line.ref);
    const left = Math.max(0, (stocked?.qty ?? 0) - line.qty);
    const at = stock.findIndex((e) => e.name === line.ref);
    if (at >= 0) stock[at] = { ...stock[at], value: left };
    else stock.push({ name: line.ref, value: left });
    depleted = true;
  }
  if (depleted) {
    live = session.save({ ...live, lists: { ...live.lists, [STOCK_LIST]: stock } }, actor);
  }

  // 3 — one write on the buyer: the money out, the goods in.
  const reading = session.reading(buyer);
  const lists: Record<string, Entry[]> = { ...buyer.lists };
  for (const want of sale.counters ?? []) {
    const found = entryAcross(reading, want.name);
    if (!found) {
      refused.push(`nothing on ${buyer.name} is called ${want.name}`);
      continue;
    }
    // The sparse-write bargain (`Session.writeEntry`): touching an entry
    // that lives only in the template copies exactly that entry down
    // first, so its ceiling and its spelling survive.
    const held = [...(lists[found.list] ?? [])];
    const at = held.findIndex((e) => sameName(e, found.entry.name));
    if (at >= 0) held[at] = { ...held[at], value: want.value };
    else held.push({ ...found.entry, value: want.value });
    lists[found.list] = held;
  }

  const carried: { id: string; name: string }[] = [];
  const children = [...(buyer.children ?? [])];
  const receiptLines: Receipt['lines'] = [];
  for (const line of lines) {
    const template = catalog(line.ref);
    const stocked = shelf.find((s) => s.ref === line.ref);
    receiptLines.push({ ref: line.ref, name: stocked?.name ?? line.ref, qty: line.qty });
    if (!template) {
      refused.push(`${stocked?.name ?? line.ref} isn't on this host — nothing was carried away`);
      continue;
    }
    // A service is bought and consumed at the counter; nobody carries a
    // bath home. Which kinds those are is the system's declaration.
    if (consumed.has((template.type ?? '').toLowerCase())) continue;
    // One thin child per unit (§K): a ref to the template and nothing
    // else, so a correction in the book reaches it forever.
    for (let n = 0; n < Math.min(line.qty, 99); n++) {
      const child = stamp(template);
      children.push(child);
      carried.push({ id: child.id, name: child.name });
    }
  }

  const saved = session.save({ ...buyer, lists, children }, actor);

  // 4 — the receipt. A record, not a mutation: what it MOVED each has
  // its own invertible row above (`server/undo.ts` skips records for
  // exactly this reason).
  const total = sale.total ?? cartTotal(lines, shelf).cents;
  session.campaign.append(saved.id, actor, 'shop.sold', {
    vendorId: vendor.id,
    vendorName: vendor.name,
    vendorEntityId: live.id,
    buyerId: saved.id,
    buyerName: saved.name,
    total,
    lines: receiptLines,
    ...(refused.length ? { refused } : {}),
  });
  session.changed('entities');

  if (shop) setCart(shop, sale.entityId, []);
  return {
    vendor: { id: vendor.id, name: vendor.name, entityId: live.id },
    buyer: { id: saved.id, name: saved.name },
    total,
    lines: receiptLines,
    carried,
    refused,
  };
}

/** The resolved shop a screen renders — what both `/api/shop` doors answer with. */
export function shopView(
  session: Session,
  shop: ShopSession,
  auth: Auth,
): { vendor: { id: string; name: string; blurb?: string; live: boolean }; shelf: StockLine[]; carts: Quote[] } | undefined {
  const vendor = vendorOf(session, shop.vendorId);
  if (!vendor) return undefined;
  const live = vendorEntity(session, vendor.id);
  const shelf = shelfOf(session, vendor, live);
  const carts: Quote[] = [];
  for (const { entityId, lines, offered } of visibleCarts(shop, auth)) {
    const q = quote(session, shelf, entityId, lines, offered);
    if (q) carts.push(q);
  }
  return {
    vendor: {
      id: vendor.id,
      name: vendor.name,
      ...(vendor.blurb ? { blurb: vendor.blurb } : {}),
      live: live !== undefined,
    },
    shelf,
    carts,
  };
}

/**
 * The shop as the ROOM may see it — the name over the door and nothing
 * else. A passive screen has no cart and no business with anyone's
 * purse; "the store is open" is the whole of what it can usefully say,
 * and saying it is what lets a board announce the scene changed.
 */
export function publicShop(session: Session): { id: string; name: string; blurb?: string } | null {
  const shop = shopOf(session);
  if (!shop) return null;
  const vendor = vendorOf(session, shop.vendorId);
  if (!vendor) return null;
  return { id: vendor.id, name: vendor.name, ...(vendor.blurb ? { blurb: vendor.blurb } : {}) };
}
