// The counter (§14). Written as the LAWS read, because the laws are the
// feature:
//
//   * browsing instantiates NOTHING — the vendor entity does not exist
//     until money changes hands;
//   * the first sale instantiates the WHOLE vendor, once, as one event;
//   * and it instantiates THIN — only lines the DM chose to COUNT ever
//     appear in the stored stock, so a shop of unlimited goods stays an
//     empty entity forever and picks the pack's new items up for free;
//   * a seat writes its own cart and nobody else's;
//   * every figure that moves came from the console, and every write is
//     one `/undo` can step back.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCampaign, openShelf } from '../core/store.ts';
import { serve } from './index.ts';
import { Session } from './session.ts';
import { peekUndo, undo } from './undo.ts';
import type { Auth } from './auth.ts';
import {
  cartTotal,
  formatPrice,
  makePayment,
  parsePrice,
  priceSymbol,
  toVendor,
  vendorEntity,
  visibleCarts,
  type ShopSession,
} from './store-flow.ts';

const KEY = 'test-key-0123456789abcdef';

/** A tiny, complete world: two coins, three things for sale, one buyer. */
const SYSTEM = {
  id: 'sys_test',
  name: 'Testable',
  version: 1,
  data: {
    store: { costField: 'cost', consumes: ['service'] },
    currency: {
      symbol: '$',
      denominations: [
        { counter: 'Dollars', value: 100 },
        { counter: 'Dimes', value: 10 },
      ],
    },
    catalog: [
      {
        id: 'wpn_rifle',
        name: 'Used Rifle',
        type: 'weapon',
        lists: { stats: [{ name: 'Cost', value: '$20.00' }, { name: 'Grit', value: 4 }] },
      },
      {
        id: 'amo_rounds',
        name: 'Plain Rounds',
        type: 'ammo',
        lists: { stats: [{ name: 'Cost', value: '$0.50' }] },
      },
      {
        id: 'svc_bath',
        name: 'A Hot Bath',
        type: 'service',
        lists: { stats: [{ name: 'Cost', value: '$0.30' }] },
      },
    ],
    vendors: [
      {
        id: 'ven_general',
        name: "Curly's General Store",
        blurb: 'Dusty shelves, honest prices.',
        lines: [
          // Counted: three sticks, and the DM said so.
          { ref: 'wpn_rifle', qty: 3 },
          // Uncounted: nobody tallies boxes of matches.
          { ref: 'amo_rounds' },
          // The shop's own price, over the book's.
          { ref: 'svc_bath', price: '$0.50' },
        ],
      },
    ],
  },
};

describe('money, as arithmetic', () => {
  it('reads and writes prices in integer minor units', () => {
    expect(parsePrice('$4.50')).toBe(450);
    expect(parsePrice('$1,200')).toBe(120000);
    expect(parsePrice('$0.05')).toBe(5);
    expect(parsePrice('—')).toBe(null);
    expect(parsePrice(undefined)).toBe(null);
    expect(priceSymbol('$4.50')).toBe('$');
    expect(formatPrice(450)).toBe('$4.50');
    expect(formatPrice(5)).toBe('$0.05');
  });

  it('totals a cart against the shelf and NAMES what it could not price', () => {
    const shelf = [
      { ref: 'a', name: 'A', stats: [], price: '$2.00', qty: null },
      { ref: 'b', name: 'B', stats: [], price: null, qty: null },
    ];
    const out = cartTotal([{ ref: 'a', qty: 3 }, { ref: 'b', qty: 1 }, { ref: 'z', qty: 1 }], shelf);
    expect(out.cents).toBe(600);
    expect(out.symbol).toBe('$');
    // Missing beats forgetting it existed (rule 9's tail).
    expect(out.missing.sort()).toEqual(['b', 'z']);
  });

  it('pays with exact coins when the purse has them, largest first', () => {
    const purse = [
      { name: 'Dollars', value: 100, held: 3 },
      { name: 'Dimes', value: 10, held: 5 },
    ];
    expect(makePayment(purse, 230)).toEqual({
      counts: { Dollars: 1, Dimes: 2 },
      paid: 230,
      change: 0,
    });
  });

  it('overpays with the smallest coin that covers it and takes change back', () => {
    const purse = [
      { name: 'Dollars', value: 100, held: 2 },
      { name: 'Dimes', value: 10, held: 0 },
    ];
    const out = makePayment(purse, 150);
    expect(out).not.toBeNull();
    expect(out!.paid).toBe(200);
    expect(out!.change).toBe(50);
    // A dollar went across; nothing came back that this purse can hold.
    expect(out!.counts.Dollars).toBe(0);
  });

  it('refuses to propose a payment a purse cannot make — that ruling is the DM’s', () => {
    expect(makePayment([{ name: 'Dimes', value: 10, held: 2 }], 500)).toBeNull();
  });
});

describe('the vendor, read defensively', () => {
  it('needs an id and a name, and drops a line with no ref', () => {
    expect(toVendor({ id: 'v', name: 'Shop', lines: [{ ref: 'a' }, { price: '$1' }] })).toEqual({
      id: 'v',
      name: 'Shop',
      lines: [{ ref: 'a' }],
    });
    expect(toVendor({ name: 'Shop' })).toBeUndefined();
    expect(toVendor({ id: 'v' })).toBeUndefined();
    expect(toVendor(null)).toBeUndefined();
  });

  it('eats the old world’s `stock` spelling — a file authored before today still opens', () => {
    expect(
      toVendor({ id: 'v', name: 'S', stock: [{ ref: 'a', price: '$1.50', qty: 11 }] })!.lines,
    ).toEqual([{ ref: 'a', price: '$1.50', qty: 11 }]);
  });

  it('keeps a finite count and lets an absent one mean unlimited', () => {
    const v = toVendor({ id: 'v', name: 'S', lines: [{ ref: 'a', qty: 3 }, { ref: 'b' }] })!;
    expect(v.lines[0].qty).toBe(3);
    expect(v.lines[1].qty).toBeUndefined();
  });
});

describe('who sees whose cart', () => {
  const shop: ShopSession = {
    vendorId: 'ven_general',
    carts: { ent_a: [{ ref: 'x', qty: 1 }], ent_b: [{ ref: 'y', qty: 2 }] },
    offered: { ent_a: true },
  };
  const seat = (entityId: string): Auth => ({
    key: false,
    display: { id: 'd', role: 'seat', params: { entityId } } as never,
  });

  it('shows the DM every cart — ruling on them is the whole job', () => {
    expect(visibleCarts(shop, { key: true }).map((c) => c.entityId).sort()).toEqual([
      'ent_a',
      'ent_b',
    ]);
    expect(visibleCarts(shop, { key: true }).find((c) => c.entityId === 'ent_a')!.offered).toBe(true);
  });

  it('shows a seat its own and nobody else’s', () => {
    expect(visibleCarts(shop, seat('ent_b'))).toEqual([
      { entityId: 'ent_b', lines: [{ ref: 'y', qty: 2 }], offered: false },
    ]);
  });

  it('shows every other role nothing at all', () => {
    for (const role of ['table', 'board', 'badge', 'art', 'blank']) {
      expect(
        visibleCarts(shop, { key: false, display: { id: 'd', role, params: {} } as never }),
      ).toEqual([]);
    }
    // An unadopted screen is still holding its pairing code.
    expect(
      visibleCarts(shop, {
        key: false,
        display: { id: 'd', code: '4821', role: 'seat', params: { entityId: 'ent_a' } } as never,
      }),
    ).toEqual([]);
  });
});

describe('the doors', () => {
  let dir: string;
  let session: Session;
  let server: Server;
  let base: string;
  let barrett: string;

  async function call(
    method: string,
    path: string,
    opts: { key?: boolean; display?: string; body?: unknown } = {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<{ status: number; body: any }> {
    const headers: Record<string, string> = {};
    if (opts.key) headers['x-teller-key'] = KEY;
    if (opts.display) headers['x-teller-display'] = opts.display;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }

  /** A screen the DM adopted and pointed at a role. */
  async function screen(role: string, params?: Record<string, unknown>): Promise<string> {
    const hello = await call('POST', '/api/displays/hello', { body: {} });
    await call('POST', '/api/displays/claim', {
      key: true,
      body: { code: hello.body.display.code },
    });
    await call('PATCH', `/api/displays/${hello.body.display.id}`, {
      key: true,
      body: { role, ...(params ? { params } : {}) },
    });
    return hello.body.display.id;
  }

  const open = () =>
    call('POST', '/api/shop/open', { key: true, body: { vendorId: 'ven_general' } });

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'teller-shop-'));
    const shelf = openShelf(dir);
    shelf.putSystem(SYSTEM);
    const campaign = createCampaign(dir, 'duo', 'The Unlikely Duo');
    campaign.save(
      { ...campaign.root(), refs: { system: { id: 'sys_test', name: 'Testable' } } },
      'test',
    );
    session = new Session(shelf, campaign, dir);
    barrett = session.create(
      {
        name: 'Barrett',
        type: 'Gunslinger',
        lists: {
          resources: [
            { name: 'Dollars', value: 30 },
            { name: 'Dimes', value: 4 },
          ],
        },
      } as never,
      'console',
    ).id;
    server = serve(session, 0, KEY);
    await new Promise((r) => server.on('listening', r));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise((r) => server.close(r));
    session.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // -- the shelf ------------------------------------------------------

  it('lists the merged vendors and says which are the campaign’s own', async () => {
    const listed = await call('GET', '/api/vendors', { key: true });
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0]).toMatchObject({ id: 'ven_general', own: false });

    await call('POST', '/api/templates/vendors', {
      key: true,
      body: { template: { name: 'The Saloon', lines: [{ ref: 'svc_bath' }] } },
    });
    const after = await call('GET', '/api/vendors', { key: true });
    expect(after.body).toHaveLength(2);
    expect(after.body.find((v: { name: string }) => v.name === 'The Saloon').own).toBe(true);
  });

  it('resolves the shelf through the catalogue: the shop’s price beats the book’s', async () => {
    const shop = (await open()).body;
    expect(shop.vendor).toMatchObject({ name: "Curly's General Store", live: false });
    const byRef = Object.fromEntries(
      shop.shelf.map((l: { ref: string }) => [l.ref, l]),
    );
    expect(byRef.wpn_rifle).toMatchObject({ name: 'Used Rifle', price: '$20.00', qty: 3 });
    // Absent qty is unlimited on purpose.
    expect(byRef.amo_rounds.qty).toBe(null);
    // The vendor's own price, over the entry's $0.30.
    expect(byRef.svc_bath.price).toBe('$0.50');
  });

  it('BROWSING INSTANTIATES NOTHING — no vendor entity until money moves', async () => {
    await open();
    await call('GET', '/api/shop', { key: true });
    expect(vendorEntity(session, 'ven_general')).toBeUndefined();
    expect(session.campaign.children(session.loaded.manifest.id)).toHaveLength(1);
  });

  it('closes, and both open and close land in the log as table history', async () => {
    await open();
    expect((await call('POST', '/api/shop/open', { key: true, body: {} })).body).toBe(null);
    expect((await call('GET', '/api/shop', { key: true })).body).toBe(null);
    const kinds = session.campaign.events({ limit: 20 }).map((e) => e.kind);
    expect(kinds).toContain('shop.opened');
    expect(kinds).toContain('shop.closed');
  });

  it('refuses a vendor nobody declared', async () => {
    expect(
      (await call('POST', '/api/shop/open', { key: true, body: { vendorId: 'ven_ghost' } })).status,
    ).toBe(404);
  });

  // -- carts ----------------------------------------------------------

  it('lets a seat write its own cart and refuses it somebody else’s', async () => {
    await open();
    const hattie = session.create({ name: 'Hattie', lists: {} } as never, 'console').id;
    const seat = await screen('seat', { entityId: barrett });

    const mine = await call('PUT', `/api/shop/cart/${barrett}`, {
      display: seat,
      body: { lines: [{ ref: 'amo_rounds', qty: 2 }], offered: true },
    });
    expect(mine.status).toBe(200);
    expect(mine.body.carts).toHaveLength(1);
    expect(mine.body.carts[0]).toMatchObject({ entityId: barrett, total: 100, offered: true });

    expect(
      (await call('PUT', `/api/shop/cart/${hattie}`, { display: seat, body: { lines: [] } })).status,
    ).toBe(401);
  });

  it('proposes a payment out of the purse, and says what is held when it cannot', async () => {
    await open();
    await call('PUT', `/api/shop/cart/${barrett}`, {
      key: true,
      body: { lines: [{ ref: 'amo_rounds', qty: 3 }] },
    });
    const cart = (await call('GET', '/api/shop', { key: true })).body.carts[0];
    // 3 × $0.50 = $1.50, out of 30 dimes' worth of dollars and 4 dimes.
    expect(cart.total).toBe(150);
    expect(cart.held).toBe(3040);
    // No exact change in 30 dollars and 4 dimes: two dollars go across
    // and fifty cents comes back in dimes, which is what a hand does.
    expect(cart.payment.paid).toBe(240);
    expect(cart.payment.change).toBe(90);
    expect(
      Object.fromEntries(
        cart.payment.counters.map((c: { name: string; value: number }) => [c.name, c.value]),
      ),
    ).toEqual({ Dollars: 28, Dimes: 9 });

    // Beyond the purse: no proposal, but the door is not shut — a
    // shopkeeper may extend credit and teller may not decide he can't.
    await call('PUT', `/api/shop/cart/${barrett}`, {
      key: true,
      body: { lines: [{ ref: 'wpn_rifle', qty: 3 }] },
    });
    const big = (await call('GET', '/api/shop', { key: true })).body.carts[0];
    expect(big.total).toBe(6000);
    expect(big.payment).toBeUndefined();
  });

  it('shows the whole counter to the DM and one cart to a seat', async () => {
    await open();
    const hattie = session.create({ name: 'Hattie', lists: {} } as never, 'console').id;
    const seat = await screen('seat', { entityId: barrett });
    const table = await screen('table');
    for (const id of [barrett, hattie]) {
      await call('PUT', `/api/shop/cart/${id}`, {
        key: true,
        body: { lines: [{ ref: 'amo_rounds', qty: 1 }] },
      });
    }
    expect((await call('GET', '/api/shop', { key: true })).body.carts).toHaveLength(2);
    expect((await call('GET', '/api/shop', { display: seat })).body.carts).toHaveLength(1);
    // Player-facing glass reads the snapshot, and only the snapshot.
    expect((await call('GET', '/api/shop', { display: table })).status).toBe(401);
  });

  it('tells the room the store is OPEN and never whose cart is on the counter', async () => {
    expect((await call('GET', '/api/public', { key: true })).body.shop).toBe(null);
    await open();
    await call('PUT', `/api/shop/cart/${barrett}`, {
      key: true,
      body: { lines: [{ ref: 'amo_rounds', qty: 1 }] },
    });
    const snapshot = (await call('GET', '/api/public', { key: true })).body;
    expect(snapshot.shop).toEqual({
      id: 'ven_general',
      name: "Curly's General Store",
      blurb: 'Dusty shelves, honest prices.',
    });
    expect(JSON.stringify(snapshot)).not.toContain('amo_rounds');
  });

  // -- the sale -------------------------------------------------------

  it('instantiates the WHOLE vendor at the first sale, and instantiates it THIN', async () => {
    await open();
    await call('PUT', `/api/shop/cart/${barrett}`, {
      key: true,
      body: { lines: [{ ref: 'wpn_rifle', qty: 1 }, { ref: 'amo_rounds', qty: 4 }] },
    });
    const sold = await call('POST', '/api/shop/sell', {
      key: true,
      body: { sale: { entityId: barrett, counters: [{ name: 'Dollars', value: 8 }] } },
    });
    expect(sold.status).toBe(200);

    const live = vendorEntity(session, 'ven_general')!;
    expect(live).toBeDefined();
    expect(live.refs!.from).toEqual({ id: 'ven_general', name: "Curly's General Store" });
    // THIN: only the COUNTED line moved off its default. The unlimited
    // one is absent, which is what lets the pack add items for free.
    expect(live.lists.stock).toEqual([{ name: 'wpn_rifle', value: 2 }]);

    const shelf = (await call('GET', '/api/shop', { key: true })).body;
    expect(shelf.vendor.live).toBe(true);
    expect(shelf.shelf.find((l: { ref: string }) => l.ref === 'wpn_rifle').qty).toBe(2);
    // The cart is cleared by the sale, not by the seat.
    expect(shelf.carts).toHaveLength(0);
  });

  it('takes the payment the DM confirmed, not the one it proposed (rule 1)', async () => {
    await open();
    await call('PUT', `/api/shop/cart/${barrett}`, {
      key: true,
      body: { lines: [{ ref: 'amo_rounds', qty: 2 }] },
    });
    // The Warden haggled Curly down to nothing and typed a 30 back in.
    await call('POST', '/api/shop/sell', {
      key: true,
      body: { sale: { entityId: barrett, total: 0, counters: [{ name: 'Dollars', value: 30 }] } },
    });
    const buyer = session.campaign.get(barrett)!;
    expect(buyer.lists.resources.find((e) => e.name === 'Dollars')!.value).toBe(30);
    const receipt = session.campaign
      .events({ limit: 20 })
      .find((e) => e.kind === 'shop.sold')!;
    expect((receipt.payload as { total: number }).total).toBe(0);
  });

  it('hands over a thin child per unit, and consumes what the system says is consumed', async () => {
    await open();
    await call('PUT', `/api/shop/cart/${barrett}`, {
      key: true,
      body: {
        lines: [
          { ref: 'amo_rounds', qty: 2 },
          { ref: 'svc_bath', qty: 1 },
        ],
      },
    });
    const sold = await call('POST', '/api/shop/sell', { key: true, body: { sale: { entityId: barrett } } });
    expect(sold.body.carried).toHaveLength(2);

    const buyer = session.campaign.get(barrett)!;
    expect(buyer.children).toHaveLength(2);
    // Nobody carries a bath home — `store.consumes` said so.
    expect(buyer.children!.every((c) => c.name === 'Plain Rounds')).toBe(true);
    // THIN (§14/§K): a ref to the template and nothing else, so a
    // correction in the book reaches it forever.
    expect(buyer.children![0].lists).toEqual({});
    expect(buyer.children![0].refs!.from).toEqual({ id: 'amo_rounds', name: 'Plain Rounds' });
    // …and the reading fills the stats in from the catalogue.
    const read = session.reading(buyer);
    expect(read.children![0].lists.stats).toEqual([{ name: 'Cost', value: '$0.50' }]);
  });

  it('refuses an empty cart, an unopened shop, and everyone but the DM', async () => {
    const seat = await screen('seat', { entityId: barrett });
    expect(
      (await call('POST', '/api/shop/sell', { key: true, body: { sale: { entityId: barrett } } }))
        .status,
    ).toBe(409);
    await open();
    expect(
      (await call('POST', '/api/shop/sell', { key: true, body: { sale: { entityId: barrett } } }))
        .status,
    ).toBe(400);
    expect(
      (await call('POST', '/api/shop/sell', {
        display: seat,
        body: { sale: { entityId: barrett, lines: [{ ref: 'amo_rounds', qty: 1 }] } },
      })).status,
    ).toBe(401);
  });

  it('names a counter it cannot find rather than inventing a list for it', async () => {
    await open();
    const sold = await call('POST', '/api/shop/sell', {
      key: true,
      body: {
        sale: {
          entityId: barrett,
          lines: [{ ref: 'amo_rounds', qty: 1 }],
          counters: [{ name: 'Doubloons', value: 3 }],
        },
      },
    });
    expect(sold.body.refused[0]).toContain('Doubloons');
    expect(Object.keys(session.campaign.get(barrett)!.lists)).toEqual(['resources']);
  });

  // -- and back again -------------------------------------------------

  it('is undoable, piece by piece, through the ordinary walk', async () => {
    await open();
    await call('PUT', `/api/shop/cart/${barrett}`, {
      key: true,
      body: { lines: [{ ref: 'wpn_rifle', qty: 1 }] },
    });
    await call('POST', '/api/shop/sell', {
      key: true,
      body: { sale: { entityId: barrett, counters: [{ name: 'Dollars', value: 10 }] } },
    });

    // 1 — the buyer's write: money back, rifle gone. ONE step, because
    // the purchase is one write on the buyer (the old world's own
    // invariant, and it was right).
    expect(peekUndo(session)!.entityId).toBe(barrett);
    undo(session, 'test');
    const buyer = session.campaign.get(barrett)!;
    expect(buyer.children ?? []).toHaveLength(0);
    expect(buyer.lists.resources.find((e) => e.name === 'Dollars')!.value).toBe(30);

    // 2 — the shelf goes back up.
    undo(session, 'test');
    expect(vendorEntity(session, 'ven_general')!.lists.stock ?? []).toHaveLength(0);

    // 3 — and the shop was never live.
    undo(session, 'test');
    expect(vendorEntity(session, 'ven_general')).toBeUndefined();
  });

  it('keeps a live vendor out of the roster the room reads', async () => {
    await open();
    await call('POST', '/api/shop/sell', {
      key: true,
      body: { sale: { entityId: barrett, lines: [{ ref: 'amo_rounds', qty: 1 }] } },
    });
    const roster = (await call('GET', '/api/public', { key: true })).body.roster;
    expect(roster.map((e: { name: string }) => e.name)).toEqual(['Barrett']);
  });
});
