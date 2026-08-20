// THE SEAT'S SHELF — what a player sees when the Warden opens a shop.
//
// Ported twice now: out of the old app's `src/components/sheet/
// ShopScreen.tsx` into teller's own `client/components/items/Shop.tsx`,
// and out of teller into the store plugin's own pane (§15) when the
// counter left the repo. The grammar is kept whole through both moves,
// because the grammar was the work:
//
//   * a CHIP ROW that narrows the whole store to one shelf, because
//     three hundred goods in one undifferentiated run is a wall, not a
//     shop;
//   * a shelf of tiles, each one −/+ and a price, panning on mounted
//     glass and wrapping on a phone (rule 6's deliberate shelf — the
//     store's own shelf is what won that argument in the first place);
//   * a DETAIL face for one thing up close, filing stats first, because
//     the quality tier and the price are most of the decision;
//   * and a CART FOOTER pinned to the bottom, so what you've gathered
//     and what it comes to is never something you scroll back to find.
//
// Where the numbers live moved with it. The old screen resolved the
// shelf itself out of packs the browser held; the block version was
// handed a resolved `ShopView` by the seat chrome. This one ASKS for
// its own, through the `shop` door and nothing else, and asks again on
// every nudge — so the shelf keeps up when the DM sells something
// without anybody wiring a prop through the chrome. Stock, prices and
// who-sees-whose cart are all the plugin's rulings (`store.mjs`); this
// does no arithmetic beyond adding up the tiles it's showing.
//
// ONE CONSTRAINT THIS PANE DOESN'T SHARE WITH THE FILE IT CAME FROM.
// Tailwind builds teller's stylesheet by scanning teller's OWN source,
// and a shelf folder isn't in it — so a pane may only wear the
// utilities teller's client already uses somewhere. Arbitrary values
// (`w-[19rem]`, `text-[11px]`) compile to nothing, and this file was
// their only user before it moved: the shelf rendered as unstyled
// vertical slivers the first time it ran outside the repo. So every
// bracketed utility here is an inline `style` instead, pixel for pixel.
// A pane wanting more than that brings its own stylesheet (rung 3).
//
// Nothing here BUYS. A cart is a proposal put on a counter; the sale is
// the DM's, at the console. That is the same shape as everything else a
// seat may do — it moves its own numbers and asks for the rest.

import { useMemo, useState } from 'react';
import { SheetPanel, StatRow, useLive, type BlockCtx, type Entity, type Glass } from 'teller';
import { formatPrice, parsePrice } from '../store.mjs';

// ---- what the doors answer with ---------------------------------------
// The same shapes the console pane names, and for the same reason: this
// is the wire between the plugin's two halves, and `store.mjs` carries
// arithmetic rather than types.

type Entry = { name: string; value?: unknown };

type StockLine = {
  ref: string;
  name: string;
  type?: string;
  /** The catalogue's shelf label — what the chip row narrows by. */
  group?: string;
  stats: Entry[];
  price: string | null;
  /** null = unlimited, and that is the ordinary case. */
  qty: number | null;
  missing?: true;
};

type CartLine = { ref: string; qty: number };

type ShopQuote = {
  entityId: string;
  name: string;
  lines: (CartLine & { name: string; price: string | null; each: number | null })[];
  offered: boolean;
  total: number;
  symbol: string;
  missing: string[];
  held?: number;
};

type ShopView = {
  vendor: { id: string; name: string; blurb?: string; live: boolean };
  shelf: StockLine[];
  carts: ShopQuote[];
};

/** A pane always has its plugin — that is what makes it a pane (§15). */
type PaneProps = BlockCtx & { plugin: NonNullable<BlockCtx['plugin']> };

/** The two families' tile (rule 6): fixed on mounted glass so the shelf
 * pans, elastic on a phone so it wraps. The widths are inline for the
 * reason the header gives — they are the classes that vanished. */
const TILE = {
  mounted: {
    className: 'shrink-0 snap-start self-stretch',
    style: { width: '19rem' },
  },
  held: {
    className: 'flex-1 self-start',
    style: { minWidth: '13rem' },
  },
};

/** How many of this line are already in the cart. */
function inCart(cart: CartLine[], ref: string): number {
  return cart.find((l) => l.ref === ref)?.qty ?? 0;
}

function Stepper({
  line,
  have,
  onSet,
}: {
  line: StockLine;
  have: number;
  onSet: (qty: number) => void;
}) {
  // Stock caps what you can gather; unlimited caps at something sane so
  // a stuck finger doesn't put ninety-nine rifles on the counter.
  const ceiling = line.qty === null ? 99 : line.qty;
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label={`one fewer ${line.name}`}
        disabled={have === 0}
        onClick={() => onSet(have - 1)}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-stone-800 text-stone-200 hover:bg-stone-700 disabled:opacity-30"
      >
        −
      </button>
      <span className="w-7 text-center font-mono text-sm tabular-nums text-stone-100">{have}</span>
      <button
        type="button"
        aria-label={`one more ${line.name}`}
        disabled={have >= ceiling}
        onClick={() => onSet(have + 1)}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-stone-800 text-stone-200 hover:bg-stone-700 disabled:opacity-30"
      >
        +
      </button>
    </div>
  );
}

function StockTile({
  line,
  have,
  fill,
  onSet,
  onOpen,
}: {
  line: StockLine;
  have: number;
  fill: boolean;
  onSet: (qty: number) => void;
  onOpen: () => void;
}) {
  return (
    <SheetPanel title={line.name} fill={fill} className="w-full">
      <div className={`flex flex-col gap-1 ${fill ? 'min-h-0 flex-1' : ''}`}>
        <button
          type="button"
          className="text-left uppercase tracking-widest text-stone-500 hover:text-stone-300"
          style={{ fontSize: '0.65rem' }}
          onClick={onOpen}
          aria-label={`look at ${line.name}`}
        >
          {line.type ?? 'goods'} · look closer
        </button>
        {line.missing && (
          <span className="font-mono text-amber-500/80" style={{ fontSize: '11px' }}>
            not on this host
          </span>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-2">
          <span
            className="font-mono text-base tabular-nums"
            style={{ color: 'var(--sheet-accent, #f59e0b)' }}
          >
            {line.price ?? '—'}
          </span>
          {line.qty !== null && (
            <span className="text-stone-500" style={{ fontSize: '11px' }}>
              {line.qty} left
            </span>
          )}
          <span className="ml-auto">
            <Stepper line={line} have={have} onSet={onSet} />
          </span>
        </div>
      </div>
    </SheetPanel>
  );
}

/** One thing up close — its stats in the catalogue's own order, and the stepper. */
function Detail({
  line,
  have,
  onSet,
  onBack,
}: {
  line: StockLine;
  have: number;
  onSet: (qty: number) => void;
  onBack: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-md bg-stone-800 px-3 py-1.5 text-sm text-stone-200 hover:bg-stone-700"
          onClick={onBack}
        >
          ← back to the shelf
        </button>
        <span className="ml-auto">
          <Stepper line={line} have={have} onSet={onSet} />
        </span>
      </div>
      <SheetPanel title={line.name} className="w-full">
        <div className="flex flex-col gap-1">
          <StatRow label="price" value={line.price ?? '—'} />
          {line.qty !== null && <StatRow label="in stock" value={String(line.qty)} />}
          {line.stats.map((stat) => (
            <StatRow key={stat.name} label={stat.name} value={String(stat.value ?? '')} />
          ))}
        </div>
      </SheetPanel>
    </div>
  );
}

/** What you've gathered, and the one verb: put it on the counter. */
function Cart({
  cart,
  total,
  symbol,
  short,
  offered,
  gm,
  onOffer,
}: {
  cart: CartLine[];
  total: number;
  symbol: string;
  short: boolean;
  offered: boolean;
  gm: string;
  onOffer: (on: boolean) => void;
}) {
  if (!cart.length) return null;
  return (
    <div
      className={`flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 ${
        offered ? 'border-amber-600/60 bg-amber-950/95' : 'border-stone-800 bg-stone-950/95'
      }`}
    >
      <span className="uppercase tracking-widest text-stone-500" style={{ fontSize: '11px' }}>
        cart
      </span>
      <span className="font-mono text-sm text-stone-100">{formatPrice(total, symbol)}</span>
      {short && (
        <span className="text-red-400" style={{ fontSize: '11px' }}>
          more than you're carrying
        </span>
      )}
      {offered ? (
        <>
          <span className="text-amber-300" style={{ fontSize: '12px' }}>
            on the counter — waiting on the {gm}
          </span>
          <button
            type="button"
            className="ml-auto rounded-md bg-stone-800 px-3 py-1.5 text-stone-200 hover:bg-stone-700"
            style={{ fontSize: '12px' }}
            onClick={() => onOffer(false)}
          >
            take it back
          </button>
        </>
      ) : (
        <button
          type="button"
          className="ml-auto rounded-md px-3 py-1.5 font-medium text-stone-950"
          style={{ background: 'var(--sheet-accent, #f59e0b)', fontSize: '12px' }}
          onClick={() => onOffer(true)}
        >
          put it on the counter
        </button>
      )}
    </div>
  );
}

function ShopShelf({
  view,
  entity,
  glass,
  gm,
  onWrite,
}: {
  view: ShopView;
  entity: Entity | undefined;
  glass: Glass;
  /** The system's word for the DM — 'Warden' at this table, `vocabulary.gm`. */
  gm: string;
  /** One cart, replaced whole, through the plugin's own `cart` door. */
  onWrite: (entityId: string, lines: CartLine[], offered?: boolean) => void;
}) {
  const [kind, setKind] = useState('');
  const [detail, setDetail] = useState<string | null>(null);

  const mine = view.carts.find((c) => c.entityId === entity?.id);
  const cart = useMemo(
    () => (mine?.lines ?? []).map((l) => ({ ref: l.ref, qty: l.qty })),
    [mine],
  );

  // The store's own shelves — the catalogue entry's `group`, which is
  // the axis a player browses on ("show me the rifles") and is the same
  // word a derived shop names when it says which shelves it keeps. A
  // catalogue that files nothing falls back to KIND, so a shelf without
  // labels still narrows instead of presenting one undifferentiated
  // wall.
  const shelfOf = (l: StockLine) => l.group ?? l.type ?? '';
  const kinds = useMemo(
    () => [...new Set(view.shelf.map(shelfOf).filter(Boolean))],
    [view.shelf],
  );
  const shown = kind ? view.shelf.filter((l) => shelfOf(l) === kind) : view.shelf;

  const total = cart.reduce((sum, l) => {
    const each = parsePrice(view.shelf.find((s) => s.ref === l.ref)?.price);
    return sum + (each ?? 0) * l.qty;
  }, 0);
  const symbol = mine?.symbol ?? '$';
  const short = mine?.held !== undefined && mine.held < total;

  const write = (next: CartLine[], offered?: boolean) => {
    if (!entity) return;
    onWrite(entity.id, next, offered);
  };

  const setQty = (ref: string, qty: number) => {
    const clamped = Math.max(0, qty);
    const next = cart.filter((l) => l.ref !== ref);
    if (clamped > 0) next.push({ ref, qty: clamped });
    // Changing the cart takes it back off the counter — editing means
    // you're still browsing, and the DM shouldn't rule on a moving
    // target.
    write(next, false);
  };

  if (!entity) return <p className="p-4 text-sm text-stone-500">no entity to shop for</p>;

  const detailLine = detail ? view.shelf.find((l) => l.ref === detail) : undefined;
  const mounted = glass === 'mounted';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-serif text-lg font-bold text-stone-100">{view.vendor.name}</span>
        {view.vendor.blurb && (
          <span className="min-w-0 italic text-stone-500" style={{ fontSize: '12px' }}>
            {view.vendor.blurb}
          </span>
        )}
      </div>

      {detailLine ? (
        <Detail
          line={detailLine}
          have={inCart(cart, detailLine.ref)}
          onSet={(q) => setQty(detailLine.ref, q)}
          onBack={() => setDetail(null)}
        />
      ) : (
        <div className={`flex min-h-0 flex-1 gap-2 ${mounted ? '' : 'flex-col'}`}>
          {kinds.length > 1 && (
            <div
              className={`flex shrink-0 gap-1 self-start ${
                mounted ? 'flex-col' : 'w-full flex-wrap'
              }`}
            >
              {['', ...kinds].map((k) => (
                <button
                  key={k || 'all'}
                  type="button"
                  onClick={() => setKind(k)}
                  aria-pressed={kind === k}
                  className={`break-words rounded-md px-2 py-1.5 text-left uppercase transition-colors ${
                    kind === k
                      ? 'text-stone-950'
                      : 'bg-stone-900 text-stone-400 hover:bg-stone-800 hover:text-stone-100'
                  }`}
                  style={{
                    maxWidth: '7rem',
                    fontSize: '0.65rem',
                    letterSpacing: '0.14em',
                    ...(kind === k ? { background: 'var(--sheet-accent, #f59e0b)' } : {}),
                  }}
                >
                  {k || 'all'}
                </button>
              ))}
            </div>
          )}
          <div
            className={`flex min-h-0 min-w-0 flex-1 gap-2 ${
              mounted
                ? 'snap-x snap-mandatory flex-nowrap items-stretch overflow-x-auto overflow-y-hidden'
                : 'flex-wrap content-start'
            }`}
          >
            {shown.length === 0 && (
              <p className="p-4 text-sm text-stone-600 italic">the shelves are bare</p>
            )}
            {shown.map((line) => (
              <div
                key={line.ref}
                className={`flex flex-col gap-2 ${TILE[glass].className}`}
                style={TILE[glass].style}
              >
                <StockTile
                  line={line}
                  have={inCart(cart, line.ref)}
                  fill={mounted}
                  onSet={(q) => setQty(line.ref, q)}
                  onOpen={() => setDetail(line.ref)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <Cart
        cart={cart}
        total={total}
        symbol={symbol}
        short={short}
        offered={mine?.offered ?? false}
        gm={gm}
        onOffer={(on) => write(cart, on)}
      />
    </div>
  );
}

export default function ShopPane({ entity, glass, records, plugin }: PaneProps) {
  // Its own fetch, on its own nudges. `useLive` re-runs on every SSE
  // stir, so a sale at the console empties this cart without the seat
  // chrome knowing the store exists.
  const { data: view, reload } = useLive<ShopView | null>(
    () => plugin.call<ShopView | null>('shop'),
    [],
  );

  const write = (entityId: string, lines: CartLine[], offered?: boolean) => {
    plugin
      .call<ShopView | null>('cart', {
        method: 'PUT',
        path: [entityId],
        body: { lines, ...(offered === undefined ? {} : { offered }) },
      })
      .then(reload)
      .catch(() => {});
  };

  // Nothing while the answer's still coming; the shut shop says so. The
  // tab is gated on this same door (`when: 'shop'` in plugin.json), so
  // the second line is the rare race rather than the ordinary state.
  if (view === undefined) return null;
  if (!view) return <p className="p-4 text-sm text-stone-500">the shop is shut</p>;

  return (
    <ShopShelf
      view={view}
      entity={entity as Entity | undefined}
      glass={glass}
      gm={String(records.vocabulary?.gm ?? 'DM')}
      onWrite={write}
    />
  );
}
