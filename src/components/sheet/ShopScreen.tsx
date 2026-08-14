import { Fragment, useMemo, useState } from 'react';
import type { Counter } from '../../../worker/types';
import {
  cartTotal,
  formatPrice,
  parsePrice,
  purseTotal,
  type StockLine,
} from '../../../worker/items';
import { moneyText, type CounterViewProps } from '../counters/shared';
import { Glyph } from './glyphs';
import { SheetPanel } from './SheetPanel';
import { StatRow } from './StatRow';

// The seat's side of an open shop: browse the shelf, look closely at
// one thing, gather a cart, put it on the counter.
//
// Deliberately NOT a checkout. The book's own economy is "prices are
// often negotiable" (p. 63) — the haggle happens out loud at the
// table, and the ruling is the DM's confirm on the console (rule 1).
// Everything here is live session state: closing the shop clears it,
// and no number a seat produces is ever a purchase.
//
// **A shelf is a TABLE, so every card is the same card** (Brian,
// 2026-08-14). Cards sized to their own contents made a jumble that
// read as damage rather than as stock; they now share a grid row's
// height, and a long name wraps inside it rather than being cut (the
// name rule holds here too — nothing truncates, ever).
//
// The card is a summary and nothing more: a name, what shelf it's off,
// and the price. Everything else — the dice a weapon rolls, what a
// tonic does, what's inside a pack — lives one tap away, because
// choosing between thirty things and studying one are different jobs.

type Shop = NonNullable<CounterViewProps['shop']>;

/** The rule between shelves, when the whole store is on display. */
function GroupRule({ label, strip }: { label: string; strip: boolean }) {
  if (strip) {
    // On the panning bar the rule stands UP, so a shelf change is
    // visible as you sweep past it.
    return (
      <div className="flex shrink-0 flex-col items-center gap-1 self-stretch px-1">
        <div className="w-px flex-1 bg-stone-800" />
        <span
          className="whitespace-nowrap text-[0.6rem] uppercase tracking-[0.2em] text-stone-500"
          style={{ writingMode: 'vertical-rl' }}
        >
          {label}
        </span>
        <div className="w-px flex-1 bg-stone-800" />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="text-[0.65rem] uppercase tracking-widest text-stone-500">
        {label}
      </span>
      <div className="h-px flex-1 bg-stone-800" />
    </div>
  );
}

export function ShopScreen({
  shop,
  counters,
  dice,
  mounted = false,
  strip = false,
}: {
  shop: Shop;
  /** The character's counters, for the balance line. */
  counters: Counter[];
  /** The system's dice, so a weapon's ranges draw as tracks. */
  dice?: CounterViewProps['dice'];
  mounted?: boolean;
  strip?: boolean;
}) {
  const { vendor, shelf, cart, offered, onCart, onOffer } = shop;
  const [group, setGroup] = useState('');
  /** The thing being examined, by catalogue id. Null = the shelf. */
  const [detail, setDetail] = useState<string | null>(null);

  const groups = useMemo(
    () => [
      ...new Set(
        shelf.map((l) => l.entry?.group ?? '').filter((g) => g !== ''),
      ),
    ],
    [shelf],
  );

  /**
   * The shelf, in sections. One chosen group is one section with no
   * rule over it (the chip already said which shelf you're on); ALL is
   * every shelf in turn, each under its own rule — three hundred goods
   * in one undifferentiated run is a wall, not a shop.
   */
  const sections = useMemo(() => {
    if (group) return [{ name: group, lines: shelf.filter((l) => (l.entry?.group ?? '') === group) }];
    const out = groups.map((g) => ({
      name: g,
      lines: shelf.filter((l) => (l.entry?.group ?? '') === g),
    }));
    const loose = shelf.filter((l) => !(l.entry?.group ?? ''));
    // Anything the catalogue never filed still gets a home, and says so.
    if (loose.length) out.push({ name: 'unfiled', lines: loose });
    return out.filter((s) => s.lines.length);
  }, [shelf, groups, group]);

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
    'flex h-8 min-w-8 shrink-0 select-none items-center justify-center rounded-lg bg-stone-800 text-lg text-stone-200 transition-colors hover:bg-stone-700 active:bg-amber-700 active:text-stone-950 disabled:pointer-events-none disabled:opacity-30';

  /** The −/+ pair, identical on the card and in the detail. */
  const quantity = (line: StockLine, big = false) => {
    const held = inCart(line.ref);
    const soldOut = line.qty !== null && line.qty <= 0;
    const name = line.entry?.name ?? line.ref;
    return (
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          className={`${stepBtn} ${held === 0 ? 'invisible' : ''} ${big ? 'h-10 min-w-10' : ''}`}
          aria-label={`fewer ${name}`}
          onClick={() => setQty(line.ref, held - 1)}
        >
          −
        </button>
        {held > 0 && (
          <span
            className={`min-w-5 text-center font-mono tabular-nums ${
              big ? 'text-base' : 'text-sm'
            }`}
            style={{ color: 'var(--sheet-accent, #f59e0b)' }}
          >
            {held}
          </span>
        )}
        <button
          type="button"
          disabled={soldOut || parsePrice(line.price) === null}
          className={`${stepBtn} ${big ? 'h-10 min-w-10' : ''}`}
          aria-label={`add ${name}`}
          onClick={() => setQty(line.ref, held + 1)}
        >
          +
        </button>
      </div>
    );
  };

  /**
   * One thing on the shelf: a name, its filing, its price, and the
   * count you're taking. Same card every time — `h-full` hands it the
   * grid row's height, so a row of goods lines up whatever the names
   * did (and a name that needs three lines grows its own row rather
   * than being cut).
   */
  const stockCard = (line: StockLine) => {
    const held = inCart(line.ref);
    const soldOut = line.qty !== null && line.qty <= 0;
    const missing = !line.entry;
    const quality = line.entry?.fields.find(
      (f) => f.filing && f.key !== 'cost',
    )?.value;
    return (
      <div
        key={line.ref}
        className={`flex h-full flex-col rounded-lg border bg-stone-900/60 transition-colors ${
          held > 0 ? '' : 'border-stone-800'
        } ${strip ? 'snap-start' : ''} ${soldOut ? 'opacity-50' : ''}`}
        style={held > 0 ? { borderColor: 'var(--sheet-accent, #f59e0b)' } : undefined}
      >
        {/* The whole upper card opens it. A shelf label is a thing you
            point at, so the target is the card, not a chevron. */}
        <button
          type="button"
          className="flex min-h-0 flex-1 flex-col items-start gap-1 px-3 pt-2 text-left"
          onClick={() => !missing && setDetail(line.ref)}
          aria-label={`${line.entry?.name ?? line.ref} — look closer`}
          disabled={missing}
        >
          {/* Two lines of room, so nearly every card is the same height
              without a single name being cut off. */}
          <span className="min-h-[2.4em] break-words font-serif text-[0.9rem] leading-tight text-stone-100">
            {/* A stocked ref whose pack isn't installed is a hole to
                REPORT, never to hide (rule 9) — the DM stocked it, and
                "you don't have this" beats it silently not existing. */}
            {line.entry?.name ?? (
              <span className="text-amber-700/80">
                {line.ref} — not in your books
              </span>
            )}
          </span>
          {/* Always a LINE, even with nothing to say — an entry with no
              quality tier (a box of rounds) would otherwise stand a
              line shorter than the rifle beside it, and that, not the
              names, was what made the shelf ragged. A blank space
              rather than a guessed `min-height`: the placeholder is a
              real line of this exact type, so it can't drift from one. */}
          <span className="flex flex-wrap gap-x-2 text-[0.6rem] uppercase tracking-widest text-stone-500">
            {quality && <span>{quality}</span>}
            {line.qty !== null && (
              <span className={soldOut ? 'text-red-400/80' : ''}>
                {soldOut ? 'sold out' : `${line.qty} left`}
              </span>
            )}
            {!quality && line.qty === null && <span>&nbsp;</span>}
          </span>
        </button>
        {/* The price and the count, on the same line at the same height
            on every card — the row of them reads as one price list. */}
        <div className="flex items-center gap-2 px-3 pb-2 pt-1">
          <span
            className="min-w-0 flex-1 font-mono text-sm tabular-nums"
            style={{ color: 'var(--sheet-accent, #f59e0b)' }}
          >
            {line.price ?? '—'}
          </span>
          {quantity(line)}
        </div>
      </div>
    );
  };

  /**
   * One thing, up close: what it is, what it does, and what it costs.
   *
   * The stats are the CATALOGUE's own fields drawn by the sheet's own
   * row renderer — so a rifle's ranges arrive as dice tracks here
   * exactly as they will once it's in your hands, and this file learns
   * nothing about ranges, Grit or tonics to do it (rule 2).
   */
  const detailView = (line: StockLine) => {
    const entry = line.entry!;
    const stats = entry.fields.filter((f) => !f.filing);
    const filing = entry.fields.filter((f) => f.filing);
    // A bundle's contents, resolved — but only when the pack hasn't
    // already narrated them. An entry carrying a FIELD by the same
    // name as the structural list has said this in the book's own
    // words (and said it better: "…compass (+1B to Intuition rolls
    // made to navigate)"), and printing both gave the card a CONTENTS
    // paragraph directly above a CONTAINS list of the same eight
    // things. The pack's own words win.
    const narrated = entry.fields.some((f) => f.key === 'contents');
    const bundle = narrated
      ? []
      : (entry.contents ?? [])
          .map((id) => shop.catalog?.get(id))
          .filter((e): e is NonNullable<typeof e> => Boolean(e));
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <button
          type="button"
          className="shrink-0 self-start text-[0.7rem] uppercase tracking-widest text-stone-400 transition-colors hover:text-stone-100"
          onClick={() => setDetail(null)}
        >
          ◂ the shelf
        </button>
        <div
          className={`flex min-h-0 flex-1 flex-col gap-2 ${
            mounted ? 'overflow-y-auto' : ''
          }`}
        >
          <SheetPanel title={entry.name}>
            <div className="flex flex-col gap-2">
              {/* The picture, when the pack has one — art lives on the
                  host beside the books and is referenced by key, never
                  carried in the repo (rule 4, the same bargain the
                  trade cards struck). No art, and its mark stands in;
                  no mark either, and the block simply isn't there. */}
              {(entry.art || entry.icon) && (
                <div className="flex justify-center py-1">
                  {entry.art ? (
                    <img
                      src={`/api/maps/${entry.art}`}
                      alt={entry.name}
                      className="max-h-32 w-auto max-w-full object-contain"
                    />
                  ) : (
                    <Glyph
                      name={entry.icon!}
                      className="h-14 w-14 text-[color:var(--sheet-accent,#f59e0b)]"
                    />
                  )}
                </div>
              )}

              {/* Filing first, because this IS the moment you're
                  choosing the thing — Quality and Cost are most of the
                  decision at the gunsmith's (see `Field.filing`). */}
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                {filing.map((f) => (
                  <span key={f.key} className="text-[0.7rem] text-stone-400">
                    <span className="uppercase tracking-widest text-stone-600">
                      {f.label}{' '}
                    </span>
                    <span className="font-mono text-stone-200">{f.value}</span>
                  </span>
                ))}
                {line.price && line.price !== filing.find((f) => f.key === 'cost')?.value && (
                  <span className="text-[0.7rem] text-stone-400">
                    <span className="uppercase tracking-widest text-stone-600">
                      here{' '}
                    </span>
                    <span
                      className="font-mono"
                      style={{ color: 'var(--sheet-accent, #f59e0b)' }}
                    >
                      {line.price}
                    </span>
                  </span>
                )}
                {entry.group && (
                  <span className="text-[0.6rem] uppercase tracking-widest text-stone-600">
                    {entry.group}
                  </span>
                )}
              </div>

              {stats.length > 0 && (
                <div className="flex flex-col gap-1 border-t border-stone-800 pt-2">
                  {stats.map((f) => (
                    <StatRow key={f.key} label={f.label} value={f.value} dice={dice} />
                  ))}
                </div>
              )}

              {/* What's in the box — an equipment pack is a card on the
                  shelf and a fistful of separate things once bought,
                  so it says which. */}
              {bundle.length > 0 && (
                <div className="flex flex-col gap-0.5 border-t border-stone-800 pt-2">
                  <span className="text-[0.65rem] uppercase tracking-widest text-stone-500">
                    contains
                  </span>
                  {bundle.map((e, i) => (
                    <span key={`${e.id}${i}`} className="text-[0.8rem] text-stone-300">
                      {e.name}
                    </span>
                  ))}
                </div>
              )}

              {(entry.counters ?? []).length > 0 && (
                <div className="flex flex-wrap gap-2 border-t border-stone-800 pt-2">
                  {(entry.counters ?? []).map((c) => (
                    <span key={c.id} className="text-[0.7rem] text-stone-400">
                      <span className="uppercase tracking-widest text-stone-600">
                        {c.name}{' '}
                      </span>
                      <span className="font-mono text-stone-200">{c.current}</span>
                    </span>
                  ))}
                </div>
              )}

              {entry.page !== undefined && (
                <span className="text-[0.65rem] uppercase tracking-widest text-stone-600">
                  page {entry.page}
                </span>
              )}
            </div>
          </SheetPanel>

          {/* Take it, from right here — walking back to the shelf to
              pick up the thing you just decided on is a step nobody
              wants. */}
          <div className="flex shrink-0 items-center gap-3 rounded-lg border border-stone-800 bg-stone-900/60 px-3 py-2">
            <span className="min-w-0 flex-1 font-mono text-base tabular-nums text-stone-100">
              {line.price ?? '—'}
            </span>
            {line.qty !== null && (
              <span className="text-[0.65rem] uppercase tracking-widest text-stone-500">
                {line.qty <= 0 ? 'sold out' : `${line.qty} left`}
              </span>
            )}
            {quantity(line, true)}
          </div>
        </div>
      </div>
    );
  };

  const open = detail ? shelf.find((l) => l.ref === detail) : undefined;

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

      {/* One thing up close OWNS the screen — the shelf's chips and
          cards would only compete with the thing you opened them to
          read (the trade card's rule, 2026-08-14). */}
      {open?.entry ? (
        detailView(open)
      ) : (
        <>
          {groups.length > 1 && (
            <div className="flex shrink-0 flex-wrap gap-1">
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
              touch glass (an iPad on the table) it wraps into rows and
              the REGION scrolls down — the store is the one screen
              whose content is genuinely unbounded (Brian, 2026-08-14,
              extending the shelf's amendment: the page never scrolls,
              a deliberate shelf may). Held glass stacks and the card
              scrolls, as it always did. */}
          <div
            key={`shop:${group}`}
            className={`flex min-h-0 flex-1 gap-2 ${
              strip
                ? 'snap-x snap-mandatory flex-nowrap items-stretch overflow-x-auto overflow-y-hidden'
                : mounted
                  ? 'flex-col overflow-y-auto'
                  : 'flex-col'
            }`}
          >
            {sections.map((section) => (
              <Fragment key={section.name}>
                {/* Only when the whole store is on show. With one shelf
                    chosen, the chip above already named it. */}
                {!group && <GroupRule label={section.name} strip={strip} />}
                <div
                  className={`grid gap-2 ${strip ? 'shrink-0' : ''}`}
                  style={
                    strip
                      ? {
                          // The bar pans sideways, so the shelf fills
                          // DOWN first and then marches right — one
                          // 500px-tall card per item would waste the
                          // rail on four goods. How many fit per
                          // column is derived from the card's own
                          // height against the glass, never declared.
                          gridAutoFlow: 'column',
                          gridTemplateRows: 'repeat(auto-fill, 6.7rem)',
                          gridAutoColumns: '16rem',
                        }
                      : {
                          // Derived, never declared (the columns rule):
                          // as many cards as fit at a floor width, one
                          // column in a hand, every row one height.
                          gridTemplateColumns:
                            'repeat(auto-fill, minmax(min(100%, 15rem), 1fr))',
                          gridAutoRows: 'minmax(5.5rem, auto)',
                        }
                  }
                >
                  {section.lines.map(stockCard)}
                </div>
              </Fragment>
            ))}
            {sections.length === 0 && (
              <p className="p-2 text-[12px] text-stone-600">
                nothing on this shelf
              </p>
            )}
          </div>
        </>
      )}

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
