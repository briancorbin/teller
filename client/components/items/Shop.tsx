// THE SEAT'S SHELF — what a player sees when the Warden opens a shop.
//
// The last piece `Screen.tsx`'s header said "isn't part of this port".
// Ported from the old app's `src/components/sheet/ShopScreen.tsx`, and
// the grammar is kept whole because the grammar was the work:
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
// What's new is where the numbers live. The old screen resolved the
// shelf itself out of packs the browser held; this one is handed a
// resolved `ShopView` from `/api/shop` and does no arithmetic beyond
// adding up the tiles it's showing. Stock, prices and who-sees-whose
// cart are all the server's rulings (`server/store-flow.ts`).
//
// Nothing here BUYS. A cart is a proposal put on a counter; the sale is
// the DM's, at the console. That is the same shape as everything else a
// seat may do — it moves its own numbers and asks for the rest.

import { useMemo, useState } from 'react';
import type { Entity } from '../../../core/entity.ts';
import { writeCart, type CartLine, type ShopView, type StockLine } from '../../lib/api.ts';
import { formatPrice, parsePrice } from '../../lib/money.ts';
import type { Glass } from '../../panels/render.tsx';
import { SheetPanel } from '../sheet/SheetPanel.tsx';
import { StatRow } from './Track.tsx';

const TILE_WIDTH = {
  mounted: 'w-[19rem] shrink-0 snap-start self-stretch',
  held: 'min-w-[13rem] flex-1 self-start',
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
          className="text-left text-[0.65rem] uppercase tracking-widest text-stone-500 hover:text-stone-300"
          onClick={onOpen}
          aria-label={`look at ${line.name}`}
        >
          {line.type ?? 'goods'} · look closer
        </button>
        {line.missing && (
          <span className="font-mono text-[11px] text-amber-500/80">not on this host</span>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-2">
          <span
            className="font-mono text-base tabular-nums"
            style={{ color: 'var(--sheet-accent, #f59e0b)' }}
          >
            {line.price ?? '—'}
          </span>
          {line.qty !== null && (
            <span className="text-[11px] text-stone-500">{line.qty} left</span>
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
      <span className="text-[11px] uppercase tracking-widest text-stone-500">cart</span>
      <span className="font-mono text-sm text-stone-100">{formatPrice(total, symbol)}</span>
      {short && <span className="text-[11px] text-red-400">more than you're carrying</span>}
      {offered ? (
        <>
          <span className="text-[12px] text-amber-300">on the counter — waiting on the {gm}</span>
          <button
            type="button"
            className="ml-auto rounded-md bg-stone-800 px-3 py-1.5 text-[12px] text-stone-200 hover:bg-stone-700"
            onClick={() => onOffer(false)}
          >
            take it back
          </button>
        </>
      ) : (
        <button
          type="button"
          className="ml-auto rounded-md px-3 py-1.5 text-[12px] font-medium text-stone-950"
          style={{ background: 'var(--sheet-accent, #f59e0b)' }}
          onClick={() => onOffer(true)}
        >
          put it on the counter
        </button>
      )}
    </div>
  );
}

export function ShopShelf({
  view,
  entity,
  glass,
  gm,
  onChanged,
}: {
  view: ShopView;
  entity: Entity | undefined;
  glass: Glass;
  /** The system's word for the DM — 'Warden' at this table, `vocabulary.gm`. */
  gm: string;
  onChanged: () => void;
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
    writeCart(entity.id, next, offered)
      .then(onChanged)
      .catch(() => {});
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
          <span className="min-w-0 text-[12px] italic text-stone-500">{view.vendor.blurb}</span>
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
                  className={`max-w-[7rem] break-words rounded-md px-2 py-1.5 text-left text-[0.65rem] uppercase tracking-[0.14em] transition-colors ${
                    kind === k
                      ? 'text-stone-950'
                      : 'bg-stone-900 text-stone-400 hover:bg-stone-800 hover:text-stone-100'
                  }`}
                  style={kind === k ? { background: 'var(--sheet-accent, #f59e0b)' } : undefined}
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
              <div key={line.ref} className={`flex flex-col gap-2 ${TILE_WIDTH[glass]}`}>
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
