import { useMemo, useState } from 'react';
import type { Counter } from '../../../worker/types';
import {
  cartTotal,
  formatPrice,
  parsePrice,
  purseTotal,
  type StockLine,
} from '../../../worker/items';
import { moneyText, type CounterViewProps } from '../counters/shared';

// The seat's side of an open shop: browse the shelf, gather a cart,
// put it on the counter.
//
// Deliberately NOT a checkout. The book's own economy is "prices are
// often negotiable" (p. 63) — the haggle happens out loud at the
// table, and the ruling is the DM's confirm on the console (rule 1).
// Everything here is live session state: closing the shop clears it,
// and no number a seat produces is ever a purchase.

type Shop = NonNullable<CounterViewProps['shop']>;

export function ShopScreen({
  shop,
  counters,
  mounted = false,
  strip = false,
}: {
  shop: Shop;
  /** The character's counters, for the balance line. */
  counters: Counter[];
  mounted?: boolean;
  strip?: boolean;
}) {
  const { vendor, shelf, cart, offered, onCart, onOffer } = shop;
  const [group, setGroup] = useState('');

  const groups = useMemo(
    () => [
      ...new Set(
        shelf.map((l) => l.entry?.group ?? '').filter((g) => g !== ''),
      ),
    ],
    [shelf],
  );
  const shown = useMemo(
    () =>
      group ? shelf.filter((l) => (l.entry?.group ?? '') === group) : shelf,
    [shelf, group],
  );

  const inCart = (ref: string) => cart.find((l) => l.ref === ref)?.qty ?? 0;
  const setQty = (ref: string, qty: number) => {
    const stocked = shelf.find((l) => l.ref === ref);
    const cap = stocked?.qty ?? null;
    const capped = cap === null ? qty : Math.min(qty, cap);
    const next =
      capped <= 0
        ? cart.filter((l) => l.ref !== ref)
        : cart.some((l) => l.ref === ref)
          ? cart.map((l) => (l.ref === ref ? { ...l, qty: capped } : l))
          : [...cart, { ref, qty: capped }];
    onCart(next);
  };

  const total = cartTotal(cart, shelf);
  // What this character is carrying: the purse when money is coins,
  // the single money counter otherwise. Null = the system said nothing.
  const wallet = shop.counter
    ? counters.find((c) => c.name === shop.counter)
    : undefined;
  const holding = shop.currency
    ? purseTotal(counters, shop.currency)
    : wallet && wallet.display === 'money'
      ? wallet.current
      : null;
  const short = holding !== null && holding < total.cents;

  const stepBtn =
    'flex h-8 min-w-8 shrink-0 select-none items-center justify-center rounded-lg bg-stone-800 text-lg text-stone-200 transition-colors hover:bg-stone-700 active:bg-amber-700 active:text-stone-950';

  /** One line of the shelf: the goods, the price, and the cart's count. */
  const stockRow = (line: StockLine) => {
    const held = inCart(line.ref);
    const soldOut = line.qty !== null && line.qty <= 0;
    return (
      <div
        key={line.ref}
        // Fixed card on the strip's pan; a wrapping ~two-across grid on
        // wider mounted glass; full-width rows in a hand.
        className={`flex items-center gap-2 rounded-lg border border-stone-800 bg-stone-900/60 px-3 py-2 ${
          strip
            ? 'w-[22rem] shrink-0 snap-start'
            : mounted
              ? 'min-w-[18rem] flex-1 basis-[18rem] self-start'
              : ''
        }`}
      >
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="break-words text-sm text-stone-100">
            {/* A stocked ref whose pack isn't installed is a hole to
                REPORT, never to hide (rule 9) — the DM stocked it, and
                "you don't have this" beats it silently not existing. */}
            {line.entry?.name ?? (
              <span className="text-amber-700/80">
                {line.ref} — not in your books
              </span>
            )}
          </span>
          <span className="flex flex-wrap gap-x-2 text-[11px] text-stone-500">
            {line.price && <span className="font-mono">{line.price}</span>}
            {line.entry?.group && (
              <span className="uppercase tracking-wider">{line.entry.group}</span>
            )}
            {line.qty !== null && (
              <span>{soldOut ? 'sold out' : `${line.qty} left`}</span>
            )}
          </span>
        </div>
        {held > 0 && (
          <span className="shrink-0 font-mono text-sm text-amber-400">
            ×{held}
          </span>
        )}
        <button
          type="button"
          className={`${stepBtn} ${held === 0 ? 'invisible' : ''}`}
          aria-label={`fewer ${line.entry?.name ?? line.ref}`}
          onClick={() => setQty(line.ref, held - 1)}
        >
          −
        </button>
        <button
          type="button"
          disabled={soldOut || parsePrice(line.price) === null}
          className={`${stepBtn} disabled:pointer-events-none disabled:opacity-30`}
          aria-label={`add ${line.entry?.name ?? line.ref}`}
          onClick={() => setQty(line.ref, held + 1)}
        >
          +
        </button>
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* The masthead: whose shop this is, and the seat's own means. */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="font-serif text-lg text-stone-100">{vendor.name}</span>
        {vendor.blurb && (
          <span className="text-[12px] italic text-stone-500">{vendor.blurb}</span>
        )}
        {holding !== null ? (
          <span className="ml-auto font-mono text-sm text-stone-300">
            {formatPrice(holding, shop.currency?.symbol ?? '$')}
          </span>
        ) : (
          wallet && (
            <span className="ml-auto font-mono text-sm text-stone-300">
              {moneyText(wallet)}
            </span>
          )
        )}
      </div>

      {groups.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {['', ...groups].map((g) => (
            <button
              key={g || 'all'}
              type="button"
              onClick={() => setGroup(g)}
              aria-pressed={group === g}
              className={`rounded-md px-2 py-1 text-[0.65rem] uppercase tracking-[0.14em] transition-colors ${
                group === g
                  ? 'text-stone-950'
                  : 'bg-stone-900 text-stone-400 hover:bg-stone-800 hover:text-stone-100'
              }`}
              style={
                group === g
                  ? { background: 'var(--sheet-accent, #f59e0b)' }
                  : undefined
              }
            >
              {g || 'all'}
            </button>
          ))}
        </div>
      )}

      {/* The shelf. On the strip it PANS sideways, the deliberate
          gesture the item shelves already taught; on other mounted
          touch glass (an iPad on the table) it wraps into rows and the
          REGION scrolls down — the store is the one screen whose
          content is genuinely unbounded, and no fixed layout holds
          three hundred goods (Brian, 2026-08-14, extending the
          shelf's amendment: the page never scrolls, a deliberate
          shelf may). Held glass stacks and the card scrolls, as it
          always did. */}
      <div
        key={`shop:${group}`}
        className={`flex min-h-0 flex-1 gap-2 ${
          strip
            ? 'snap-x snap-mandatory flex-nowrap items-start overflow-x-auto overflow-y-hidden'
            : mounted
              ? 'flex-wrap content-start overflow-y-auto'
              : 'flex-col content-start'
        }`}
      >
        {shown.map(stockRow)}
        {shown.length === 0 && (
          <p className="p-2 text-[12px] text-stone-600">nothing on this shelf</p>
        )}
      </div>

      {/* The cart, always in reach: what's gathered, what the book says
          it costs, and the one verb — put it on the counter. */}
      {cart.length > 0 && (
        <div
          className={`flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 ${
            offered
              ? 'border-amber-600/60 bg-amber-950/30'
              : 'border-stone-800 bg-stone-900/80'
          }`}
        >
          <span className="text-[11px] uppercase tracking-widest text-stone-500">
            cart
          </span>
          <span className="font-mono text-sm text-stone-100">
            {formatPrice(total.cents, total.symbol)}
          </span>
          {short && (
            <span className="text-[11px] text-red-400">
              more than you're carrying
            </span>
          )}
          {offered ? (
            <>
              <span className="text-[12px] text-amber-300">
                on the counter — waiting on the {shop.gm ?? 'DM'}
              </span>
              <button
                type="button"
                className="ml-auto rounded-md bg-stone-800 px-3 py-1.5 text-[12px] text-stone-200 transition-colors hover:bg-stone-700"
                onClick={() => onOffer(false)}
              >
                take it back
              </button>
            </>
          ) : (
            <button
              type="button"
              className="ml-auto rounded-md px-3 py-1.5 text-[12px] font-medium text-stone-950 transition-colors"
              style={{ background: 'var(--sheet-accent, #f59e0b)' }}
              onClick={() => onOffer(true)}
            >
              put it on the counter
            </button>
          )}
        </div>
      )}
    </div>
  );
}
